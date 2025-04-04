// config/firebaseAdmin.js
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config(); // Ensure environment variables are loaded

try {
  // Option 1: Using GOOGLE_APPLICATION_CREDENTIALS environment variable (Recommended)
  // Make sure this variable is set in your .env file or system environment
  // Example .env: GOOGLE_APPLICATION_CREDENTIALS="./path/to/your/serviceAccountKey.json"
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          // Optional: Add databaseURL if using Realtime Database features
          // databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      console.log("Firebase Admin SDK initialized using Application Default Credentials.");

  }
  // Option 2: Using separate environment variables (Less common for key file)
  // else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  //     const serviceAccount = await import(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, { assert: { type: 'json' } });
  //     admin.initializeApp({
  //         credential: admin.credential.cert(serviceAccount.default),
  //         // databaseURL: process.env.FIREBASE_DATABASE_URL
  //     });
  //     console.log("Firebase Admin SDK initialized using Service Account Path.");
  // }
  else {
    throw new Error("Firebase Admin SDK credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS environment variable.");
  }

} catch (error) {
  console.error('❌ Firebase Admin SDK initialization error:', error);
  process.exit(1); // Exit if initialization fails
}

export default admin;