// config/firebaseAdmin.js (Checking Braces and Structure)

import * as admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Determine __dirname for ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load .env file relative to project root ---
const envPath = path.resolve(__dirname, '../.env');
console.log(`[Firebase Admin Config] Attempting to load env from: ${envPath}`);
dotenv.config({ path: envPath });

// --- Credential Handling ---
let firebaseCredential;

const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

console.log("[Firebase Admin Config] Checking for credentials...");

// 1. Check GOOGLE_APPLICATION_CREDENTIALS (Path)
if (googleAppCreds) { // <--- Brace 1 OPEN
    const keyPath = path.resolve(__dirname, '..', googleAppCreds);
    console.log(`[Firebase Admin Config] Attempting to load key from path: ${keyPath}`);
    try { // <--- Brace 2 OPEN
        firebaseCredential = admin.credential.cert(keyPath);
        console.log("[Firebase Admin Config] Using service account key from file path.");
    } catch (e) { // <--- Brace 2 CLOSE, Brace 3 OPEN
        console.error(`❌ Firebase Admin Config: Error loading key file from ${keyPath}.`);
        console.error(e);
        process.exit(1);
    } // <--- Brace 3 CLOSE
// 2. Check FIREBASE_SERVICE_ACCOUNT_BASE64 (Base64 JSON)
} else if (serviceAccountBase64) { // <--- Brace 4 OPEN (corresponds to Brace 1)
    console.log("[Firebase Admin Config] Found Base64 credential env var...");
    try { // <--- Brace 5 OPEN
        const serviceAccountJsonString = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
        const serviceAccount = JSON.parse(serviceAccountJsonString);
        firebaseCredential = admin.credential.cert(serviceAccount);
        console.log("[Firebase Admin Config] Using service account key from Base64 env var.");
    } catch (e) { // <--- Brace 5 CLOSE, Brace 6 OPEN
        console.error("❌ Firebase Admin Config: Error parsing FIREBASE_SERVICE_ACCOUNT_BASE64.");
        console.error(e);
        process.exit(1);
    } // <--- Brace 6 CLOSE
// 3. No credentials found
} else { // <--- Brace 7 OPEN (corresponds to Brace 1 & 4)
    console.error("❌ Firebase Admin Config: No Firebase credentials found.");
    process.exit(1);
} // <--- Brace 7 CLOSE (ends the if/else if/else block)

// --- Initialize Firebase Admin SDK ---
// This section seems correctly placed *after* the credential handling block
if (!admin.apps.length) { // <--- Brace 8 OPEN
    console.log("[Firebase Admin Config] Initializing Firebase Admin SDK...");
    try { // <--- Brace 9 OPEN
        admin.initializeApp({
            credential: firebaseCredential // Use the determined credential
        });
        console.log("✅ Firebase Admin SDK Initialized Successfully.");
    } catch (e) { // <--- Brace 9 CLOSE, Brace 10 OPEN
        console.error("❌ Firebase Admin SDK Initialization Failed:");
        console.error(e);
        process.exit(1);
    } // <--- Brace 10 CLOSE
} else { // <--- Brace 11 OPEN (corresponds to Brace 8)
    console.log(`[Firebase Admin Config] SDK already initialized. App name: ${admin.apps[0]?.name || '[DEFAULT]'}`);
} // <--- Brace 11 CLOSE (ends the initialization block)

// --- Export initialized services ---
// This seems correctly placed *after* the initialization block
export const firebaseAdminAuth = admin.auth(); // Line 91 according to error

// Problem Area likely starts here based on error line numbers:
// If there was extra code *between* the initialization block (ending Brace 11)
// and the export statement, it could cause the "Declaration or statement expected"
// error (line 58 might have been where the code expected the initialization block
// to end, or where an unexpected token started).

// Check carefully for any stray characters, comments, or incomplete statements
// *between* line ~84 (where Brace 11 closes) and line 91 (the export).

// Also, ensure there are no extra closing braces `}` anywhere after line 91.