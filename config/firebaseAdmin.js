// config/firebaseAdmin.js (Corrected - Using fs to load JSON)

import admin from 'firebase-admin'; // Default import for CommonJS package
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // Import the Node.js File System module

// --- Determine __dirname for ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load .env file relative to project root ---
const envPath = path.resolve(__dirname, '../.env');
console.log(`[Firebase Admin Config] Attempting to load env from: ${envPath}`);
dotenv.config({ path: envPath });

// --- Credential Handling ---
let firebaseCredentialObject;

const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

console.log("[Firebase Admin Config] Checking for credentials...");

// 1. Check GOOGLE_APPLICATION_CREDENTIALS (Path)
if (googleAppCreds) {
    const keyPath = path.resolve(__dirname, '..', googleAppCreds);
    console.log(`[Firebase Admin Config] Attempting to load key from path: ${keyPath}`);
    try {
        // FIX: Read the file using fs and parse it
        if (!fs.existsSync(keyPath)) {
             throw new Error(`Service account key file not found at path: ${keyPath}`);
        }
        const keyFileContent = fs.readFileSync(keyPath, 'utf8');
        const serviceAccount = JSON.parse(keyFileContent);
        firebaseCredentialObject = admin.credential.cert(serviceAccount);
        console.log("[Firebase Admin Config] Using service account key from file path.");
    } catch (e) {
        console.error(`❌ Firebase Admin Config: Error loading or parsing key file from ${keyPath}.`);
        console.error(e);
        process.exit(1);
    }
// 2. Check FIREBASE_SERVICE_ACCOUNT_BASE64 (Base64 JSON)
} else if (serviceAccountBase64) {
    console.log("[Firebase Admin Config] Found Base64 credential env var...");
    try {
        const serviceAccountJsonString = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
        const serviceAccount = JSON.parse(serviceAccountJsonString);
        firebaseCredentialObject = admin.credential.cert(serviceAccount);
        console.log("[Firebase Admin Config] Using service account key from Base64 env var.");
    } catch (e) {
        console.error("❌ Firebase Admin Config: Error parsing FIREBASE_SERVICE_ACCOUNT_BASE64.");
        console.error(e);
        process.exit(1);
    }
// 3. No credentials found
} else {
    console.error("❌ Firebase Admin Config: No Firebase credentials found.");
    process.exit(1);
}

// --- Initialize Firebase Admin SDK ---
if (!admin.apps.length) {
    console.log("[Firebase Admin Config] Initializing Firebase Admin SDK...");
    try {
        admin.initializeApp({
            credential: firebaseCredentialObject
        });
        console.log("✅ Firebase Admin SDK Initialized Successfully.");
    } catch (e) {
        console.error("❌ Firebase Admin SDK Initialization Failed:");
        console.error(e);
        process.exit(1);
    }
} else {
    console.log(`[Firebase Admin Config] SDK already initialized.`);
}

// --- Export initialized services ---
export const firebaseAdminAuth = admin.auth();