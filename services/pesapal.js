// services/pesapal.js
import axios from 'axios';
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger exists

export class PesapalService { // Ensure 'export' is here
    constructor(consumerKey, consumerSecret, isSandbox = true) {
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        // Ensure baseUrl ends without a trailing slash
        const rawBaseUrl = isSandbox
            ? 'https://cybqa.pesapal.com/pesapalv3' // Sandbox URL
            : 'https://pay.pesapal.com/v3';        // Production URL
        this.baseUrl = rawBaseUrl.replace(/\/$/, ''); // Remove trailing slash if present
        info(`PesapalService initialized for ${isSandbox ? 'Sandbox' : 'Production'} environment. Base URL: ${this.baseUrl}`);
    }

    // --- Get OAuth Token ---
    async getOAuthToken() {
        const url = `${this.baseUrl}/api/Auth/RequestToken`;
        try {
            info(`[PesapalService] Fetching OAuth token from ${url}...`);
            const payload = {
                consumer_key: this.consumerKey,
                consumer_secret: this.consumerSecret,
            };
            const response = await axios.post(url, payload, {
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                timeout: 10000 // 10 second timeout
            });
            // Robust check for token
            if (!response?.data?.token) {
                error(`[PesapalService] OAuth token not found in response. Data: ${JSON.stringify(response?.data)}`);
                throw new Error(`OAuth token not found in Pesapal response`);
            }
            info('[PesapalService] OAuth token obtained successfully.');
            return response.data.token;
        } catch (err) { // Changed variable name
            const status = err.response?.status;
            const errorData = err.response?.data;
            const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || err.message || 'Unknown error';
            error(`[PesapalService] Error fetching OAuth token from ${url}. Status: ${status}. Error: ${errorMsg}`);
            // Log request payload without secrets for debugging
            error(`[PesapalService] OAuth Request Payload (Secrets Redacted): { consumer_key: 'REDACTED', consumer_secret: 'REDACTED' }`);
            throw new Error(`Failed to fetch OAuth token: ${errorMsg}`);
        }
    }

    // --- Register Payment Order ---
    async registerOrder(token, orderId, amount, currency, description, callbackUrl, customer, notificationId) {
         const url = `${this.baseUrl}/api/Transactions/SubmitOrderRequest`;
         // Ensure payload matches expected structure and types
         const payload = {
            id: String(orderId), // Ensure string
            currency: String(currency),
            amount: parseFloat(amount), // Ensure float/number
            description: String(description).substring(0, 100), // Ensure string, limit length
            callback_url: String(callbackUrl),
            notification_id: String(notificationId),
            billing_address: {
                email_address: customer?.email || null, // Handle potential null/undefined
                phone_number: customer?.phone || null,
                country_code: customer?.countryCode || '',
                first_name: customer?.firstName || '',
                middle_name: '',
                last_name: customer?.lastName || '',
                line_1: '', line_2: '', city: '', state: '',
                postal_code: null, zip_code: null, // Use null if empty and type is number
            },
        };
        try {
            info(`[PesapalService] Registering Order ${orderId} at ${url}`);
            debug(`[PesapalService] Register Order Payload:`, JSON.stringify(payload)); // Log full payload in debug
            const response = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
                 timeout: 15000 // 15 second timeout
            });
            info(`[PesapalService] Register Order ${orderId} Response:`, response.data);
            // Check essential fields in response more robustly
            if (response?.data?.status !== "200" || !response?.data?.order_tracking_id || !response?.data?.redirect_url) {
                const errorDetail = response?.data?.error ? JSON.stringify(response.data.error) : JSON.stringify(response?.data);
                error(`[PesapalService] Invalid Pesapal registration response for ${orderId}: ${errorDetail}`);
                throw new Error(`Order tracking ID or redirect URL missing, or status not 200 in Pesapal response: ${errorDetail}`);
            }
            info(`[PesapalService] Order ${orderId} registered successfully.`);
            return response.data; // Contains order_tracking_id, merchant_reference, redirect_url
        } catch (err) { // Changed variable name
            const status = err.response?.status;
            const errorData = err.response?.data;
            const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || err.message || 'Unknown error';
            error(`[PesapalService] Error registering order ${orderId} at ${url}. Status: ${status}. Error: ${errorMsg}. Payload Sent:`, JSON.stringify(payload));
            throw new Error(`Failed to register order with Pesapal: ${errorMsg}`);
        }
    }

    // --- Get Transaction Status ---
    async getTransactionStatus(token, orderTrackingId) {
        const url = `${this.baseUrl}/api/Transactions/GetTransactionStatus`;
        try {
            if (!orderTrackingId) {
                warn('[PesapalService] getTransactionStatus called without Tracking ID.');
                throw new Error('Order Tracking ID is required to query status.');
            }
            info(`[PesapalService] Querying Payment Status for Tracking ID: ${orderTrackingId} at ${url}`);

            const response = await axios.get(url, {
                params: { orderTrackingId: String(orderTrackingId) }, // Ensure string
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                timeout: 10000 // 10 second timeout
            });

            info(`[PesapalService] Get Transaction Status Response for ${orderTrackingId}:`, response.data);

            // Basic validation of the response
            if (response?.data?.status && response.data.status !== "200") {
                 warn(`[PesapalService] GetTransactionStatus API call successful but returned non-200 internal status: ${response.data.status} for Tracking ID ${orderTrackingId}`);
            }
            // Check if the essential status description is present
             if (response?.data?.status_code === undefined || !response?.data?.payment_status_description) {
                 warn(`[PesapalService] Status response for ${orderTrackingId} missing expected fields (status_code or payment_status_description). Response:`, response.data);
                 // Consider returning a standardized "unknown" object if needed by calling code
                 // return { status_code: -1, payment_status_description: 'UNKNOWN', message: 'Incomplete response from Pesapal status check', error: { code: 'INCOMPLETE_RESPONSE'} };
             }

            return response.data;

        } catch (err) { // Changed variable name
            const status = err.response?.status;
            const errorData = err.response?.data;
            const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || err.message || 'Unknown error';
            error(`[PesapalService] Error querying payment status for Tracking ID ${orderTrackingId} at ${url}. Status: ${status}. Error: ${errorMsg}`);
            throw new Error(`Failed to query Pesapal payment status: ${errorMsg}`);
        }
    }

    // --- Register IPN URL ---
    async registerIPN(token, ipnUrl, ipnNotificationType = 'POST') {
        const url = `${this.baseUrl}/api/URLSetup/RegisterIPN`;
         try {
             if (!ipnUrl) throw new Error('IPN URL is required.');
             const payload = { url: ipnUrl, ipn_notification_type: ipnNotificationType.toUpperCase() };
             info(`[PesapalService] Registering IPN URL: ${ipnUrl} (${ipnNotificationType}) at ${url}`);
             debug('[PesapalService] Register IPN Payload:', payload);
             const response = await axios.post(url, payload, {
                 headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
                  timeout: 10000
             });
             info('[PesapalService] Register IPN Response:', response.data);
             if (response?.data?.status !== "200" || !response?.data?.ipn_id) {
                const errorDetail = response?.data?.error ? JSON.stringify(response.data.error) : JSON.stringify(response?.data);
                error(`[PesapalService] Failed to register IPN URL. Pesapal response: ${errorDetail}`);
                throw new Error(`Failed to register IPN URL. Pesapal response: ${errorDetail}`);
             }
             info(`[PesapalService] IPN URL registered successfully. IPN ID: ${response.data.ipn_id}`);
             return response.data;
         } catch (err) { // Changed variable name
             const status = err.response?.status;
             const errorData = err.response?.data;
             const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || err.message || 'Unknown error';
             error(`[PesapalService] Error registering IPN URL ${ipnUrl} at ${url}. Status: ${status}. Error: ${errorMsg}`);
             throw new Error(`Failed to register IPN URL: ${errorMsg}`);
         }
    }

    // --- Get Registered IPNs ---
    async getRegisteredIPNs(token) {
         const url = `${this.baseUrl}/api/URLSetup/GetIpnList`;
        try {
             info(`[PesapalService] Fetching registered IPN list from ${url}...`);
             const response = await axios.get(url, {
                 headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
                 timeout: 10000
             });
             info('[PesapalService] Get Registered IPNs Response:', response.data);
             if (!Array.isArray(response?.data)) {
                 error(`[PesapalService] Unexpected response format when fetching IPN list: ${JSON.stringify(response?.data)}`);
                 throw new Error(`Unexpected response format when fetching IPN list: ${JSON.stringify(response?.data)}`);
             }
             info(`[PesapalService] Found ${response.data.length} registered IPN URLs.`);
             return response.data;
         } catch (err) { // Changed variable name
             const status = err.response?.status;
             const errorData = err.response?.data;
             const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || err.message || 'Unknown error';
             error(`[PesapalService] Error fetching registered IPN URLs from ${url}. Status: ${status}. Error: ${errorMsg}`);
             throw new Error(`Failed to fetch registered IPN URLs: ${errorMsg}`);
         }
    }
}

// NO 'export default router;' HERE