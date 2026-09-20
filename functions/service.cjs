const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const SHIFTS = {
  morning: {label: '07:00–10:00', end: '10:00'},
  midday: {label: '10:00–13:00', end: '13:00'},
  afternoon: {label: '13:30–16:30', end: '16:30'},
  evening: {label: '16:30–19:00', end: '19:00'}
};
function fail(code, message) { throw new HttpsError(code, message); }
function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('invalid-argument', `Invalid ${label}.`);
  return value.trim();
}
function employeeId(value) {
  const id = text(value, 'employee ID', 32).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(id)) fail('invalid-argument', 'Employee ID must be 3–32 letters, numbers, hyphens or underscores.');
  return id;
}
function employeeEmail(value) { return `${employeeId(value).toLowerCase()}@employees.krishi-seva.invalid`; }
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail('invalid-argument', 'Password must contain 12–128 characters.');
  return value;
}
function id(value) {
  const result = text(value, 'identifier', 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) fail('invalid-argument', 'Invalid identifier.');
  return result;
}
function windowDate(date, shift, now) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !SHIFTS[shift]) fail('invalid-argument', 'Select a valid date and shift.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) fail('invalid-argument', 'Invalid date.');
  if (+new Date(`${date}T${SHIFTS[shift].end}:00+05:30`) <= now) fail('failed-precondition', 'This shift has already ended.');
  if (+parsed > now + 180 * 86400000) fail('invalid-argument', 'Bookings may be scheduled up to 180 days ahead.');
}
function slotKey(centerId, date, shift) { return createHash('sha256').update(`${centerId}|${date}|${shift}`).digest('hex'); }
function bookingKey(uid, slotId) { return createHash('sha256').update(`${uid}|${slotId}`).digest('hex'); }
function createService({ db, auth, timestamp, now = Date.now }) {
  // Always re-read the protected profile. Removed employees lose access even with an unexpired ID token.
  async function employee(request, roles = ['admin', 'staff'], tx) {
    if (!request.auth) fail('unauthenticated', 'Please sign in.');
    const ref = db.doc(`employees/${request.auth.uid}`);
    const snapshot = tx ? await tx.get(ref) : await ref.get();
    const profile = snapshot.data();
    if (!profile?.active || !roles.includes(profile.role)) fail('permission-denied', 'Your employee account is not authorized.');
    return profile;
  }
  async function createStaff(request) {
    await employee(request, ['admin']);
    const data = request.data || {};
    const empId = employeeId(data.employeeId);
    const displayName = text(data.name, 'name', 100);
    const centerId = id(data.centerId);
    const secret = password(data.password);
    if (!(await db.doc(`centers/${centerId}`).get()).exists) fail('not-found', 'Choose an existing mandi.');
    let user;
    try {
      user = await auth.createUser({email: employeeEmail(empId), password: secret, displayName, disabled: true});
      await auth.setCustomUserClaims(user.uid, {role: 'staff'});
      await db.doc(`employees/${user.uid}`).set({employeeId: empId, name: displayName, centerId, role: 'staff', active: true, createdBy: request.auth.uid, createdAt: timestamp()});
      await auth.updateUser(user.uid, {disabled: false});
      return {uid: user.uid, employeeId: empId};
    } catch (error) {
      if (user) {
        // Keep the account disabled if provisioning fails; never leave a usable partial account.
        await db.doc(`employees/${user.uid}`).set({active: false}, {merge: true}).catch(() => {});
        await auth.deleteUser(user.uid).catch(() => {});
      }
      if (error.code === 'auth/email-already-exists') fail('already-exists', 'This employee ID is already in use.');
      fail('internal', 'Staff account could not be created. Please retry.');
    }
  }
  async function removeStaff(request) {
    const uid = id(request.data?.uid);
    await db.runTransaction(async tx => {
      await employee(request, ['admin'], tx);
      const ref = db.doc(`employees/${uid}`);
      const record = (await tx.get(ref)).data();
      if (!record || record.role !== 'staff') fail('permission-denied', 'Only staff accounts can be removed.');
      tx.update(ref, {active: false, removedBy: request.auth.uid, removedAt: timestamp()});
    });
    // Disable in Firestore first. Retrying also finishes a partially completed Auth deletion.
    try {
      await auth.updateUser(uid, {disabled: true});
      await auth.revokeRefreshTokens(uid);
      await auth.deleteUser(uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') fail('unavailable', 'Access is blocked, but Auth deletion needs retrying.');
    }
    return {removed: true};
  }
  async function saveCenter(request) {
    const data = request.data || {};
    const centerId = id(data.centerId);
    const center = {name: text(data.name, 'mandi name'), state: text(data.state, 'state', 80), district: text(data.district, 'district', 80)};
    await db.runTransaction(async tx => {
      await employee(request, ['admin'], tx);
      const ref = db.doc(`centers/${centerId}`);
      if ((await tx.get(ref)).exists) fail('already-exists', 'This mandi ID already exists. Use a different ID.');
      tx.create(ref, {...center, createdBy: request.auth.uid, createdAt: timestamp()});
    });
    return {centerId};
  }
  async function saveSlot(request) {
    const data = request.data || {};
    const centerId = id(data.centerId);
    windowDate(data.date, data.shift, now());
    if (!Number.isInteger(data.capacity) || data.capacity < 0 || data.capacity > 10000) fail('invalid-argument', 'Capacity must be a whole number from 0 to 10000.');
    const key = slotKey(centerId, data.date, data.shift);
    await db.runTransaction(async tx => {
      const profile = await employee(request, ['admin', 'staff'], tx);
      if (profile.role === 'staff' && profile.centerId !== centerId) fail('permission-denied', 'Staff can edit only their assigned mandi.');
      const center = (await tx.get(db.doc(`centers/${centerId}`))).data();
      if (!center) fail('not-found', 'Mandi not found.');
      const ref = db.doc(`slots/${key}`);
      const current = (await tx.get(ref)).data();
      const booked = current?.booked || 0;
      if (data.capacity < booked) fail('failed-precondition', `Capacity cannot be lower than ${booked} confirmed bookings.`);
      tx.set(ref, {centerId, centerName: center.name, date: data.date, shift: data.shift, capacity: data.capacity, booked, remaining: data.capacity - booked, updatedBy: request.auth.uid, updatedAt: timestamp()});
    });
    return {slotId: key};
  }
  async function bookSlot(request) {
    if (!request.auth) fail('unauthenticated', 'Please sign in.');
    if (request.auth.token?.firebase?.sign_in_provider !== 'phone') fail('permission-denied', 'A verified farmer phone login is required.');
    const data = request.data || {};
    const slotId = id(data.slotId);
    const bookingId = bookingKey(request.auth.uid, slotId);
    const details = {farmerName: text(data.farmerName, 'farmer name', 100), crop: text(data.crop, 'crop', 80), vehicle: text(data.vehicle, 'vehicle', 30).toUpperCase()};
    if (typeof data.quantity !== 'number' || !Number.isFinite(data.quantity) || data.quantity < 5 || data.quantity > 500) fail('invalid-argument', 'Quantity must be between 5 and 500 quintals.');
    return db.runTransaction(async tx => {
      const bookingRef = db.doc(`bookings/${bookingId}`);
      const previous = await tx.get(bookingRef);
      if (previous.exists) return {bookingId, alreadyBooked: true}; // Safe across double-clicks, retries and devices.
      const ref = db.doc(`slots/${slotId}`);
      const slot = (await tx.get(ref)).data();
      if (!slot) fail('not-found', 'This slot no longer exists.');
      windowDate(slot.date, slot.shift, now());
      if (slot.booked >= slot.capacity || slot.remaining <= 0) fail('resource-exhausted', 'This shift has just filled up. Please choose another slot.');
      tx.update(ref, {booked: slot.booked + 1, remaining: slot.capacity - slot.booked - 1, updatedAt: timestamp()});
      tx.create(bookingRef, {...details, quantity: data.quantity, farmerUid: request.auth.uid, slotId, centerId: slot.centerId, centerName: slot.centerName, date: slot.date, shift: slot.shift, status: 'confirmed', createdAt: timestamp()});
      return {bookingId, alreadyBooked: false};
    });
  }
  return {createStaff, removeStaff, saveCenter, saveSlot, bookSlot};
}
module.exports = {createService, employeeId, employeeEmail, password, windowDate, slotKey, bookingKey, SHIFTS};
