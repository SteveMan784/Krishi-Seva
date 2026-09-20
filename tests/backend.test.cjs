const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createService, employeeId, employeeEmail, windowDate, slotKey} = require('../functions/service.cjs');
const now = +new Date('2026-09-20T01:00:00Z');
const employee = (uid, data) => ({auth: {uid, token: {}}, data});
const farmer = (uid, slotId, extra = {}) => ({auth: {uid, token: {firebase: {sign_in_provider: 'phone'}}}, data: {slotId, farmerName: 'Farmer One', crop: 'Wheat', quantity: 50, vehicle: 'KA-04-AB-1234', ...extra}});
const slot = {centerId: 'center-a', date: '2026-09-21', shift: 'morning', capacity: 2};
function fixture() {
  const records = new Map(Object.entries({
    'employees/admin': {role: 'admin', active: true},
    'employees/staff': {role: 'staff', active: true, centerId: 'center-a'},
    'employees/removed': {role: 'staff', active: false, centerId: 'center-a'},
    'centers/center-a': {name: 'Mandi A'}, 'centers/center-b': {name: 'Mandi B'}
  }));
  const events = []; let queue = Promise.resolve();
  const snapshot = path => ({exists: records.has(path), data: () => structuredClone(records.get(path))});
  const db = {
    doc(path) {return {path, get: async () => snapshot(path), set: async (data, options) => {records.set(path, options?.merge ? {...records.get(path), ...data} : structuredClone(data));}};},
    runTransaction(callback) {
      const run = queue.then(async () => {
        const writes = [];
        const tx = {get: async ref => snapshot(ref.path), set: (ref, data) => writes.push(() => records.set(ref.path, structuredClone(data))),
          update: (ref, data) => writes.push(() => {records.set(ref.path, {...records.get(ref.path), ...structuredClone(data)}); events.push(`write:${ref.path}`);}),
          create: (ref, data) => writes.push(() => {assert.equal(records.has(ref.path), false); records.set(ref.path, structuredClone(data));})};
        const result = await callback(tx); writes.forEach(write => write()); return result;
      }); queue = run.catch(() => {}); return run;
    }
  };
  const users = new Map();
  const auth = {
    async createUser(data) {
      if ([...users.values()].some(user => user.email === data.email)) throw Object.assign(new Error('duplicate'), {code: 'auth/email-already-exists'});
      const uid = `uid-${users.size + 1}`; users.set(uid, {...data, uid}); return users.get(uid);
    },
    async setCustomUserClaims(uid, claims) {users.get(uid).claims = claims;},
    async updateUser(uid, data) {events.push('auth:disable'); users.set(uid, {...users.get(uid), ...data});},
    async revokeRefreshTokens() {events.push('auth:revoke');},
    async deleteUser(uid) {events.push('auth:delete'); users.delete(uid);}
  };
  return {records, users, events, auth, service: createService({db, auth, now: () => now, timestamp: () => 'server-time'})};
}
async function rejects(promise, code) {await assert.rejects(promise, error => error.code === code);}
test('employee IDs normalize to a single internal login identity', () => {
  assert.equal(employeeId(' stf-001 '), 'STF-001'); assert.equal(employeeEmail('StF-001'), 'stf-001@employees.krishi-seva.invalid');
  for (const invalid of ['a', '../admin', 'admin@example.com', '', null]) assert.throws(() => employeeId(invalid));
});
test('window validation rejects invalid, ended, inherited and far-future shifts', () => {
  for (const [date, shift] of [['2026-02-30','morning'], ['2026-09-19','morning'], ['2026-09-21','toString'], ['2028-01-01','morning']]) assert.throws(() => windowDate(date, shift, now));
  assert.doesNotThrow(() => windowDate(slot.date, slot.shift, now));
});
test('admin publishes capacity and staff edits their own mandi only', async () => {
  const {service, records} = fixture();
  const result = await service.saveSlot(employee('admin', slot));
  await service.saveSlot(employee('staff', {...slot, capacity: 3}));
  assert.equal(records.get(`slots/${result.slotId}`).remaining, 3);
  await rejects(service.saveSlot(employee('staff', {...slot, centerId: 'center-b'})), 'permission-denied');
});
test('farmer, self-registered, removed and unauthenticated users cannot set capacity', async () => {
  const {service} = fixture();
  for (const uid of ['farmer', 'self-registered', 'removed']) await rejects(service.saveSlot(employee(uid, slot)), 'permission-denied');
  await rejects(service.saveSlot({data: slot}), 'unauthenticated');
});
test('invalid capacities and unknown mandi are rejected', async () => {
  const {service} = fixture();
  for (const capacity of [-1, 1.5, '5', NaN, Infinity, 10001]) await rejects(service.saveSlot(employee('admin', {...slot, capacity})), 'invalid-argument');
  await rejects(service.saveSlot(employee('admin', {...slot, centerId: 'missing'})), 'not-found');
});
test('booking deducts exactly one remaining slot', async () => {
  const {service, records} = fixture();
  const {slotId} = await service.saveSlot(employee('admin', slot));
  const {bookingId} = await service.bookSlot(farmer('farmer1', slotId));
  assert.equal(records.get(`slots/${slotId}`).remaining, 1); assert.equal(records.get(`slots/${slotId}`).booked, 1);
  assert.equal(records.get(`bookings/${bookingId}`).farmerUid, 'farmer1');
});
test('many concurrent farmers cannot overbook the last slot', async () => {
  const {service, records} = fixture();
  const {slotId} = await service.saveSlot(employee('admin', {...slot, capacity: 1}));
  const results = await Promise.allSettled(Array.from({length: 20}, (_, i) => service.bookSlot(farmer(`farmer${i}`, slotId))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'resource-exhausted'));
  assert.equal(records.get(`slots/${slotId}`).remaining, 0);
});
test('simultaneous duplicate requests are idempotent even when full', async () => {
  const {service, records} = fixture();
  const {slotId} = await service.saveSlot(employee('admin', {...slot, capacity: 1}));
  const results = await Promise.all(Array.from({length: 5}, () => service.bookSlot(farmer('same', slotId))));
  assert.equal(new Set(results.map(r => r.bookingId)).size, 1);
  assert.equal(results.filter(r => !r.alreadyBooked).length, 1);
  assert.equal(records.get(`slots/${slotId}`).booked, 1);
});
test('capacity cannot drop below booked count; raising capacity reopens availability', async () => {
  const {service, records} = fixture();
  const {slotId} = await service.saveSlot(employee('admin', {...slot, capacity: 1}));
  await service.bookSlot(farmer('one', slotId));
  await rejects(service.saveSlot(employee('staff', {...slot, capacity: 0})), 'failed-precondition');
  await service.saveSlot(employee('staff', {...slot, capacity: 3}));
  assert.equal(records.get(`slots/${slotId}`).remaining, 2); assert.equal(records.get(`slots/${slotId}`).booked, 1);
});
test('date, mandi and shift quotas are independent', async () => {
  const {service, records} = fixture();
  const first = await service.saveSlot(employee('admin', {...slot, capacity: 1}));
  const second = await service.saveSlot(employee('admin', {...slot, date: '2026-09-22'}));
  await service.bookSlot(farmer('one', first.slotId));
  assert.equal(records.get(`slots/${second.slotId}`).remaining, 2);
  assert.notEqual(slotKey('center-a', slot.date, slot.shift), slotKey('center-b', slot.date, slot.shift));
});
test('only phone-verified farmers may book; caller-supplied uid is ignored', async () => {
  const {service, records} = fixture();
  const {slotId} = await service.saveSlot(employee('admin', slot));
  await rejects(service.bookSlot(employee('staff', farmer('one', slotId).data)), 'permission-denied');
  await rejects(service.bookSlot({data: farmer('one', slotId).data}), 'unauthenticated');
  const {bookingId} = await service.bookSlot(farmer('one', slotId, {farmerUid: 'someone-else'}));
  assert.equal(records.get(`bookings/${bookingId}`).farmerUid, 'one');
});
test('failed booking input cannot consume capacity', async () => {
  const {service, records} = fixture();
  const {slotId} = await service.saveSlot(employee('admin', slot));
  for (const quantity of [0, 501, '50', Infinity]) await rejects(service.bookSlot(farmer('one', slotId, {quantity})), 'invalid-argument');
  await rejects(service.bookSlot(farmer('one', 'missing')), 'not-found');
  assert.equal(records.get(`slots/${slotId}`).remaining, 2);
});
test('admin creates staff only with a valid center; password never stored in Firestore', async () => {
  const {service, records, users} = fixture();
  const data = {employeeId: 'stf-123', name: 'Staff One', password: 'A secure password 123', centerId: 'center-a', role: 'admin'};
  const result = await service.createStaff(employee('admin', data));
  const profile = records.get(`employees/${result.uid}`);
  assert.equal(profile.role, 'staff'); assert.equal(profile.password, undefined);
  assert.equal(users.get(result.uid).disabled, false); assert.deepEqual(users.get(result.uid).claims, {role: 'staff'});
  await rejects(service.createStaff(employee('admin', data)), 'already-exists');
  await rejects(service.createStaff(employee('staff', {...data, employeeId: 'STF-999'})), 'permission-denied');
  await rejects(service.createStaff(employee('admin', {...data, centerId: 'missing'})), 'not-found');
  await rejects(service.createStaff(employee('admin', {...data, password: '1234'})), 'invalid-argument');
});
test('failed staff provisioning rolls back usable access', async () => {
  const {service, records, users, auth} = fixture();
  auth.setCustomUserClaims = async () => {throw new Error('down');};
  await rejects(service.createStaff(employee('admin', {employeeId: 'STF-111', name: 'Staff', password: 'Long password 123', centerId: 'center-a'})), 'internal');
  assert.equal(users.size, 0); assert.equal(records.get('employees/uid-1').active, false);
});
test('removal blocks profile first, revokes sessions and deletes Auth; cannot remove admins', async () => {
  const {service, records, events} = fixture();
  await service.removeStaff(employee('admin', {uid: 'staff'}));
  assert.equal(records.get('employees/staff').active, false);
  assert.deepEqual(events, ['write:employees/staff', 'auth:disable', 'auth:revoke', 'auth:delete']);
  await rejects(service.saveSlot(employee('staff', slot)), 'permission-denied');
  await rejects(service.removeStaff(employee('admin', {uid: 'admin'})), 'permission-denied');
});
test('only admins create mandis or remove staff', async () => {
  const {service} = fixture();
  const data = {centerId: 'new', name: 'Mandi', state: 'State', district: 'District'};
  await rejects(service.saveCenter(employee('staff', data)), 'permission-denied');
  await rejects(service.removeStaff(employee('staff', {uid: 'removed'})), 'permission-denied');
  await service.saveCenter(employee('admin', data));
  await rejects(service.saveCenter(employee('admin', data)), 'already-exists');
});
