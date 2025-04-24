import admin from 'firebase-admin';
import { info, error } from '../utils/logger.js';

// Initialize Firebase Admin SDK
function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    info('Firebase Admin already initialized');
    return admin.app();
  }

  try {
    // Get service account from environment variables
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
    );

    info('Initializing Firebase Admin SDK...');

    const app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });

    // Configure session cookie options
    admin.auth().sessionCookieOptions = {
      expiresIn: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    };

    info('Firebase Admin SDK initialized successfully');
    return app;
  } catch (err) {
    error('Failed to initialize Firebase Admin SDK:', err);
    throw err;
  }
}

const firebaseAdmin = initializeFirebaseAdmin();

export const firebaseAdminAuth = admin.auth();
export const firestore = admin.firestore();
export { admin };