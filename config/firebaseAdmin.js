// config/firebaseAdmin.js (Prioritizing Base64 Env Var)

import admin from 'firebase-admin'; // Default import for CommonJS package
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // Import fs for potential fallback or other uses if needed

// --- Determine __dirname for ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load .env file relative to project root ---
// This ensures variables are loaded if running locally
const envPath = path.resolve(__dirname, '../.env');
console.log(`[Firebase Admin Config] Attempting to load .env file from: ${envPath}`);
dotenv.config({ path: envPath });

// --- Credential Handling ---
let firebaseCredentialObject; // Variable to hold the credential object

// Read both potential environment variables
const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS; // Path to JSON file
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64; // Base64 encoded JSON content

console.log("[Firebase Admin Config] Checking for credentials...");
console.log(`[Firebase Admin Config] GOOGLE_APPLICATION_CREDENTIALS env var is ${googleAppCreds ? `SET to "${googleAppCreds}"` : 'NOT SET'}`);
console.log(`[Firebase Admin Config] FIREBASE_SERVICE_ACCOUNT_BASE64 env var is ${serviceAccountBase64 ? 'SET' : 'NOT SET'}`);


// --- Determine Credential Method ---

// 1. PRIORITIZE Base64 Environment Variable
if (serviceAccountBase64) {
    console.log("[Firebase Admin Config] Using Base64 credential env var. Attempting to parse...");
    try {
        // Decode Base64 string into JSON string
        const serviceAccountJsonString = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
        // Parse the JSON string into an object
        const serviceAccount = JSON.parse(serviceAccountJsonString);

        // Log the Project ID found inside the credentials for verification
        console.log(`[Firebase Admin Config] Project ID found in Base64 credentials: ${serviceAccount.project_id}`);
        // ---> IMPORTANT: Compare this logged ID with your Frontend Firebase config projectId <---

        // Create credential object using admin.credential namespace
        firebaseCredentialObject = admin.credential.cert(serviceAccount);
        console.log("[Firebase Admin Config] Successfully created credential from Base64 env var.");

    } catch (e) {
        console.error("❌ Firebase Admin Config: Error parsing FIREBASE_SERVICE_ACCOUNT_BASE64 variable. Ensure it's valid Base64 encoded JSON.");
        console.error(e); // Log the specific parsing error
        process.exit(1); // Exit on critical configuration error
    }
// 2. Fallback to GOOGLE_APPLICATION_CREDENTIALS (File Path) if Base64 is not set
} else if (googleAppCreds) {
    console.warn("[Firebase Admin Config] Base64 env var not set, falling back to GOOGLE_APPLICATION_CREDENTIALS path.");
    // Construct absolute path relative to the project root (where .env is)
    const keyPath = path.resolve(__dirname, '..', googleAppCreds);
    console.log(`[Firebase Admin Config] Attempting to load key from path: ${keyPath}`);
    try {
        // Check if file exists before reading
        if (!fs.existsSync(keyPath)) {
             console.error(`❌ Firebase Admin Config: Service account key file NOT FOUND at path specified by GOOGLE_APPLICATION_CREDENTIALS: ${keyPath}`);
             throw new Error(`Service account key file not found at path: ${keyPath}`);
        }
        // Read and parse the file content
        const keyFileContent = fs.readFileSync(keyPath, 'utf8');
        const serviceAccount = JSON.parse(keyFileContent);

        // Log the Project ID found inside the credentials for verification
        console.log(`[Firebase Admin Config] Project ID found in key file: ${serviceAccount.project_id}`);
         // ---> IMPORTANT: Compare this logged ID with your Frontend Firebase config projectId <---

        // Create credential object using admin.credential namespace
        firebaseCredentialObject = admin.credential.cert(serviceAccount);
        console.log("[Firebase Admin Config] Successfully created credential from file path.");

    } catch (e) {
        console.error(`❌ Firebase Admin Config: Error loading or parsing key file from ${keyPath}.`);
        console.error(e); // Log the specific error
        process.exit(1); // Exit on critical configuration error
    }
// 3. No credentials found by either method
} else {
    console.error("❌ Firebase Admin Config: NEITHER FIREBASE_SERVICE_ACCOUNT_BASE64 NOR GOOGLE_APPLICATION_CREDENTIALS environment variables are set. Cannot initialize Admin SDK.");
    process.exit(1); // Exit as Firebase Admin cannot initialize
}

// --- Initialize Firebase Admin SDK ---
// Check if the default app is already initialized to prevent errors
if (!admin.apps.length) {
    console.log("[Firebase Admin Config] Initializing Firebase Admin SDK...");
    try {
        // Use the credential object determined above
        admin.initializeApp({
            credential: firebaseCredentialObject
            // You might need to add databaseURL if using Firebase Realtime Database
            // databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${firebaseCredentialObject.projectId}.firebaseio.com` // Example
        });
        console.log("✅ Firebase Admin SDK Initialized Successfully.");
    } catch (e) {
        console.error("❌ Firebase Admin SDK Initialization Failed:");
        console.error(e); // Log the full initialization error
        process.exit(1);
    }
} else {
    // Log details if already initialized
    console.log(`[Firebase Admin Config] SDK already initialized. App count: ${admin.apps.length}. Default app name: ${admin.apps[0]?.name || '[DEFAULT]'}`);
}

// --- Export initialized services ---
// Use admin.auth() from the default import
export const firebaseAdminAuth = admin.auth();

// Optionally export other Firebase services if needed
// import { getFirestore } from 'firebase-admin/firestore';
// export const db = getFirestore(); // Example for Firestore

// Example export for the main admin object if absolutely needed elsewhere (usually not required just for auth)
// export { admin };