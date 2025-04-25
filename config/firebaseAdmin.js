// config/firebaseAdmin.js (Keep as is - uses Base64 env var)
import admin from 'firebase-admin';
import { info, error } from '../utils/logger.js';

let firebaseAdminApp = null;

function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    info('Firebase Admin already initialized.');
    firebaseAdminApp = admin.apps[0]; // Use existing app
    return firebaseAdminApp;
  }

  try {
    // Ensure the environment variable is set
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is not set.');
    }

    // Get service account from environment variables
    const serviceAccountJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(serviceAccountJson);

    info('Initializing Firebase Admin SDK...');

    // Remove databaseURL if not using Realtime Database via Admin SDK
    const initializeOptions = {
      credential: admin.credential.cert(serviceAccount),
    };
    if (process.env.FIREBASE_DATABASE_URL) {
       initializeOptions.databaseURL = process.env.FIREBASE_DATABASE_URL;
       info(`Using Firebase Database URL: ${process.env.FIREBASE_DATABASE_URL}`);
    }

    firebaseAdminApp = admin.initializeApp(initializeOptions);

    info('Firebase Admin SDK initialized successfully');
    return firebaseAdminApp;
  } catch (err) {
    error('Failed to initialize Firebase Admin SDK:', err);
    if (err instanceof SyntaxError) {
        error('Possible issue parsing FIREBASE_SERVICE_ACCOUNT_BASE64 JSON.');
    }
    throw err; // Rethrow to prevent server start
  }
}

// Initialize on load
initializeFirebaseAdmin();

// Export auth instance correctly as a function
export const firebaseAdminAuth = () => {
    if (!firebaseAdminApp) throw new Error("Firebase Admin not initialized yet!");
    return firebaseAdminApp.auth();
};
export const firestore = () => {
    if (!firebaseAdminApp) throw new Error("Firebase Admin not initialized yet!");
    return firebaseAdminApp.firestore();
};

// Export the whole admin object if needed elsewhere
export { admin };
export default initializeFirebaseAdmin;