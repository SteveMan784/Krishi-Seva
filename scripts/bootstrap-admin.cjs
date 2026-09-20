// Run once in a trusted terminal with Application Default Credentials.
// FIREBASE_PROJECT_ID=your-project ADMIN_EMPLOYEE_ID=ADMIN-001 ADMIN_NAME='Administrator'
// ADMIN_PASSWORD must be supplied securely through the environment, never source control.
const {createRequire} = require('node:module');
const backendRequire = createRequire(require('node:path').resolve(__dirname, '../functions/package.json'));
const {initializeApp, applicationDefault} = backendRequire('firebase-admin/app');
const {getAuth} = backendRequire('firebase-admin/auth');
const {getFirestore, FieldValue} = backendRequire('firebase-admin/firestore');
const {employeeId, employeeEmail, password} = require('../functions/service.cjs');
async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID.');
  const empId = employeeId(process.env.ADMIN_EMPLOYEE_ID);
  const secret = password(process.env.ADMIN_PASSWORD);
  initializeApp({credential: applicationDefault(), projectId});
  const auth = getAuth();
  const db = getFirestore();
  const user = await auth.createUser({email: employeeEmail(empId), password: secret, displayName: process.env.ADMIN_NAME || 'Administrator', disabled: true});
  try {
    await auth.setCustomUserClaims(user.uid, {role: 'admin'});
    await db.doc(`employees/${user.uid}`).set({employeeId: empId, name: user.displayName, role: 'admin', active: true, centerId: null, createdAt: FieldValue.serverTimestamp()});
    await auth.updateUser(user.uid, {disabled: false});
    console.log(`Administrator ${empId} created. Sign in using the employee ID and password.`);
  } catch (error) {
    await db.doc(`employees/${user.uid}`).delete();
    await auth.deleteUser(user.uid);
    throw error;
  }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
