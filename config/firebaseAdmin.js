// server/src/config/firebaseAdmin.ts

import * as admin from 'firebase-admin';
// --- Explicitly import credential ---
import { credential as adminCredential } from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
console.log(`[Firebase Admin Config] Attempting to load env from: ${envPath}`);
dotenv.config({ path: envPath });

let firebaseCredential; // Use a different variable name to avoid conflict

const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
// ... other credential vars

console.log("Firebase Admin Config: Checking credentials...");

if (googleAppCreds) {
    const keyPath = path.resolve(__dirname, '../../', googleAppCreds);
    console.log(`Firebase Admin Config: Attempting to load key from path: ${keyPath}`);
    try {
        // --- Use the imported credential object ---
        firebaseCredential = adminCredential.cert(keyPath);
        console.log("Firebase Admin Config: Using service account key from file path.");
    } catch(e: any) {
        console.error(`❌ Firebase Admin Config: Error loading key file from ${keyPath}: ${e.message}.`);
        process.exit(1);
    }
} else if (serviceAccountBase64) {
    try {
        const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
         // --- Use the imported credential object ---
        firebaseCredential = adminCredential.cert(JSON.parse(serviceAccountJson));
        console.log("Firebase Admin Config: Using service account key from Base64 env var.");
    } catch (error) {
        console.error("❌ Firebase Admin Config: Error parsing FIREBASE_SERVICE_ACCOUNT_BASE64:", error);
        process.exit(1);
    }
}
// ... Handle other credential methods similarly using adminCredential.cert(...)
else {
    console.error("❌ Firebase Admin Config: Credentials not found in server/.env.");
    process.exit(1);
}


if (!admin.apps.length) {
    try {
        admin.initializeApp({
            // --- Use the assigned credential variable ---
            credential: firebaseCredential
        });
        console.log("✅ Firebase Admin SDK Initialized Successfully.");
    } catch (error) {
        console.error("❌ Firebase Admin SDK Initialization Failed:", error);
        process.exit(1);
    }
} else {
    console.log("Firebase Admin SDK already initialized.");
}

export const firebaseAdminAuth = admin.auth();