const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall } = require('firebase-functions/v2/https');
const { createService } = require('./service.cjs');
initializeApp();
const service = createService({db: getFirestore(), auth: getAuth(), timestamp: () => FieldValue.serverTimestamp()});
for (const [name, handler] of Object.entries(service)) {
  exports[name] = onCall({region: 'asia-south1', maxInstances: 10}, handler);
}
