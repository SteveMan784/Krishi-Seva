const {test, before, after, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where} = require('firebase/firestore');
const {createRequire} = require('node:module');
const backendRequire = createRequire(require('node:path').resolve(__dirname, '../functions/package.json'));
const {initializeApp, deleteApp} = backendRequire('firebase-admin/app');
const {getFirestore, FieldValue} = backendRequire('firebase-admin/firestore');
const {createService} = require('../functions/service.cjs');
let env, app, db, service;
const projectId = 'demo-krishi-seva';
const authContext = (uid, provider = 'password', claims = {}) => env.authenticatedContext(uid, {firebase: {sign_in_provider: provider}, ...claims}).firestore();
before(async () => {
  env = await initializeTestEnvironment({projectId, firestore: {host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8')}});
  app = initializeApp({projectId}, 'integration'); db = getFirestore(app);
  service = createService({db, auth: {}, timestamp: () => FieldValue.serverTimestamp(), now: () => +new Date('2026-09-20T01:00:00Z')});
});
after(async () => {await env?.cleanup(); if (app) await deleteApp(app);});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    for (const [path, data] of Object.entries({
      'employees/admin': {role: 'admin', active: true},
      'employees/staff': {role: 'staff', active: true, centerId: 'center-a'},
      'employees/other-staff': {role: 'staff', active: true, centerId: 'center-b'},
      'employees/removed': {role: 'staff', active: false, centerId: 'center-a'},
      'centers/center-a': {name: 'Mandi A'},
      'slots/available': {centerId: 'center-a', date: '2026-09-21', capacity: 1, booked: 0, remaining: 1},
      'slots/full': {centerId: 'center-a', date: '2026-09-21', capacity: 1, booked: 1, remaining: 0},
      'bookings/one': {farmerUid: 'farmer-a', centerId: 'center-a'},
      'bookings/two': {farmerUid: 'farmer-b', centerId: 'center-b'}
    })) await setDoc(doc(database, path), data);
  });
});
test('unauthenticated users cannot read private data or availability', async () => {
  const database = env.unauthenticatedContext().firestore();
  for (const path of ['slots/available', 'centers/center-a', 'employees/admin', 'bookings/one']) await assertFails(getDoc(doc(database, path)));
});
test('arbitrary Auth signup and forged claims grant no employee access', async () => {
  const database = authContext('self-signup', 'password', {role: 'admin'});
  await assertFails(getDocs(collection(database, 'centers')));
  await assertFails(setDoc(doc(database, 'employees/self-signup'), {role: 'admin', active: true}));
});
test('only admin lists staff and reads another employee profile', async () => {
  await assertSucceeds(getDocs(collection(authContext('admin'), 'employees')));
  await assertSucceeds(getDoc(doc(authContext('staff'), 'employees/staff')));
  await assertFails(getDoc(doc(authContext('staff'), 'employees/other-staff')));
  await assertFails(getDocs(collection(authContext('farmer-a', 'phone'), 'employees')));
});
test('no browser role may directly write capacity, bookings or employee roles', async () => {
  for (const [uid, provider] of [['admin','password'], ['staff','password'], ['farmer-a','phone']]) {
    const database = authContext(uid, provider);
    await assertFails(updateDoc(doc(database, 'slots/available'), {capacity: 999}));
    await assertFails(setDoc(doc(database, 'bookings/forged'), {farmerUid: uid}));
    await assertFails(updateDoc(doc(database, 'employees/staff'), {role: 'admin'}));
    await assertFails(setDoc(doc(database, 'centers/forged'), {name: 'fake'}));
  }
});
test('farmer reads only own bookings and must scope list queries', async () => {
  const database = authContext('farmer-a', 'phone');
  await assertSucceeds(getDoc(doc(database, 'bookings/one')));
  await assertFails(getDoc(doc(database, 'bookings/two')));
  await assertSucceeds(getDocs(query(collection(database, 'bookings'), where('farmerUid', '==', 'farmer-a'))));
  await assertFails(getDocs(collection(database, 'bookings')));
});
test('staff booking visibility is mandi-scoped', async () => {
  const database = authContext('staff');
  await assertSucceeds(getDoc(doc(database, 'bookings/one')));
  await assertFails(getDoc(doc(database, 'bookings/two')));
  await assertSucceeds(getDocs(query(collection(database, 'bookings'), where('centerId', '==', 'center-a'))));
  await assertFails(getDocs(collection(database, 'bookings')));
});
test('inactive staff cannot read booking or slot data despite an existing token', async () => {
  const database = authContext('removed', 'password', {role: 'staff'});
  await assertFails(getDoc(doc(database, 'slots/available')));
  await assertFails(getDoc(doc(database, 'bookings/one')));
});
test('available slot query excludes exhausted shifts', async () => {
  const database = authContext('farmer-a', 'phone');
  const result = await assertSucceeds(getDocs(query(collection(database, 'slots'), where('centerId', '==', 'center-a'), where('date', '==', '2026-09-21'), where('remaining', '>', 0))));
  assert.deepEqual(result.docs.map(doc => doc.id), ['available']);
});
test('real Firestore transactions serialize competing bookings for the last slot', async () => {
  const data = {centerId: 'center-a', date: '2026-09-21', shift: 'morning', capacity: 1};
  const {slotId} = await service.saveSlot({auth: {uid: 'admin'}, data});
  const request = uid => ({auth: {uid, token: {firebase: {sign_in_provider: 'phone'}}}, data: {slotId, farmerName: 'Test farmer', crop: 'Wheat', quantity: 20, vehicle: 'KA01AB1234'}});
  const results = await Promise.allSettled([service.bookSlot(request('farmer-a')), service.bookSlot(request('farmer-b'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'resource-exhausted');
  const stored = (await db.doc(`slots/${slotId}`).get()).data();
  assert.equal(stored.booked, 1); assert.equal(stored.remaining, 0);
});
test('real transaction retries preserve one booking for duplicate requests', async () => {
  const {slotId} = await service.saveSlot({auth: {uid: 'admin'}, data: {centerId: 'center-a', date: '2026-09-21', shift: 'morning', capacity: 2}});
  const request = {auth: {uid: 'farmer-a', token: {firebase: {sign_in_provider: 'phone'}}}, data: {slotId, farmerName: 'Farmer', crop: 'Wheat', quantity: 20, vehicle: 'KA01AB1234'}};
  const results = await Promise.all([service.bookSlot(request), service.bookSlot(request)]);
  assert.equal(results[0].bookingId, results[1].bookingId);
  assert.equal((await db.doc(`slots/${slotId}`).get()).data().booked, 1);
});
