// scripts/registerPesapalIPN.js
import dotenv from 'dotenv';
import path from 'path'; // Import path for resolving .env
import { fileURLToPath } from 'url'; // Helper for __dirname in ES Modules
import { PesapalService } from '../services/pesapal.js'; // Adjust path to your Pesapal service

// --- Configuration ---

// Load environment variables from the main .env file in the project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Assumes your .env file is one level up from the 'scripts' directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// --- !! IMPORTANT !! ---
// THIS SCRIPT REGISTERS YOUR *PRODUCTION* IPN URL.
// Ensure your BACKEND_BASE_URL environment variable is set correctly
// to your DEPLOYED backend URL (e.g., https://socialmediabackend-r3fd.onrender.com)
const ipnUrlToRegister = `${process.env.BACKEND_BASE_URL}/api/orders/ipn`;
const ipnMethod = 'POST'; // Must match the method your handleIpn expects

// --- End Configuration ---


// --- Main Execution Function ---
const runRegistration = async () => {
    console.log("--- Pesapal IPN Registration Script ---");

    // Validate required environment variables
    if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
        console.error("❌ ERROR: Missing PESAPAL_CONSUMER_KEY or PESAPAL_CONSUMER_SECRET in .env file.");
        return;
    }
    if (!process.env.BACKEND_BASE_URL) {
        console.error("❌ ERROR: Missing BACKEND_BASE_URL in .env file (needed to construct IPN URL).");
        return;
    }
    if (!ipnUrlToRegister.startsWith('https://')) {
        console.warn(`⚠️ WARNING: IPN URL "${ipnUrlToRegister}" does not start with https://. Production IPNs require HTTPS.`);
        // Decide if you want to proceed or exit based on warning
        // return; // Uncomment to stop if not HTTPS
    }

    console.log(`Target IPN URL: ${ipnUrlToRegister}`);
    console.log(`Target IPN Method: ${ipnMethod}`);
    console.log("Initializing Pesapal Service for PRODUCTION environment...");

    // --- Instantiate PesapalService for PRODUCTION ---
    const pesapalService = new PesapalService(
        process.env.PESAPAL_CONSUMER_KEY,
        process.env.PESAPAL_CONSUMER_SECRET,
        false // FORCE PRODUCTION (isSandbox = false) for this registration script
    );

    try {
        // 1. Get OAuth Token
        console.log("\nRequesting OAuth Token...");
        const token = await pesapalService.getOAuthToken();
        console.log("OAuth Token obtained.");

        // 2. Register the IPN URL
        console.log(`\nRegistering IPN URL with Pesapal...`);
        const result = await pesapalService.registerIPN(token, ipnUrlToRegister, ipnMethod);

        // 3. Display Result
        console.log("\n✅ IPN Registration Successful!");
        console.log("-----------------------------------------");
        console.log("Registered URL:", result.url);
        console.log("Notification Method:", result.ipn_notification_type_description);
        console.log("Status:", result.ipn_status_description);
        console.log("Created Date:", result.created_date);
        console.log("➡️ IPN ID (Use this for PESAPAL_IPN_ID env var):", result.ipn_id);
        console.log("-----------------------------------------");
        console.log("\nACTION REQUIRED: Copy the IPN ID above and set it as the PESAPAL_IPN_ID environment variable in your production environment (e.g., on Render) and your local .env file.");

    } catch (error) {
        console.error("\n❌ IPN Registration Script Failed:");
        console.error("Error Message:", error.message);
        // Log additional details if available (e.g., from Axios error response)
        if (error.response?.data) {
             console.error("Pesapal Error Response:", error.response.data);
        }
    }
};

// --- Run the script ---
runRegistration();