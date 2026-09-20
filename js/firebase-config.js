// Public Firebase web configuration, NOT a service-account key.
// Copy the web app configuration from Firebase Console > Project settings.
// Enable Email/Password (employees) and Phone (farmers), create Firestore,
// authorize your hosting domain, and deploy the rules/indexes/functions first.
window.KRISHI_FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: ''
};
window.KRISHI_FUNCTIONS_REGION = 'asia-south1';
// Only honored on localhost. Run npm run emulators for local integration tests.
window.KRISHI_USE_EMULATORS = false;
