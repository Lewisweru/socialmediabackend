// services/pesapal.js
import axios from 'axios';

export class PesapalService {
    constructor(consumerKey, consumerSecret, isSandbox = true) {
        this.consumerKey = consumerKey;
        this.consumerSecret = consumerSecret;
        const rawBaseUrl = isSandbox ? 'https://cybqa.pesapal.com/pesapalv3' : 'https://pay.pesapal.com/v3';
        this.baseUrl = rawBaseUrl.replace(/\/$/, ''); // Remove trailing slash
        console.log(`PesapalService initialized for ${isSandbox ? 'Sandbox' : 'Production'}. Base URL: ${this.baseUrl}`);
    }

    // --- Get OAuth Token ---
    async getOAuthToken() {
        const url = `${this.baseUrl}/api/Auth/RequestToken`;
        try {
            console.log(`[PesapalService] Fetching OAuth token from ${url}...`);
            const payload = { consumer_key: this.consumerKey, consumer_secret: this.consumerSecret };
            const response = await axios.post(url, payload, {
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                timeout: 10000
            });
            if (!response?.data?.token) throw new Error(`OAuth token not found: ${JSON.stringify(response?.data)}`);
            console.log('[PesapalService] OAuth token obtained.');
            return response.data.token;
        } catch (error) {
            const status = error.response?.status;
            const errorData = error.response?.data;
            const errorMsg = errorData?.message || JSON.stringify(errorData) || error.message || 'Unknown token error';
            console.error(`[PesapalService] Error fetching OAuth token. Status: ${status}. Error: ${errorMsg}`);
            throw new Error(`Failed to fetch OAuth token: ${errorMsg}`);
        }
    }

    // --- Register Payment Order ---
    async registerOrder(token, orderId, amount, currency, description, callbackUrl, customer, notificationId) {
         const url = `${this.baseUrl}/api/Transactions/SubmitOrderRequest`;
         const payload = {
            id: String(orderId), currency: String(currency), amount: parseFloat(amount),
            description: String(description).substring(0, 100), callback_url: String(callbackUrl),
            notification_id: String(notificationId),
            billing_address: {
                email_address: customer?.email || null, phone_number: customer?.phone || null,
                country_code: customer?.countryCode || '', first_name: customer?.firstName || '',
                middle_name: '', last_name: customer?.lastName || '',
                line_1: '', line_2: '', city: '', state: '',
                postal_code: null, zip_code: null,
            },
        };
        try {
            console.log(`[PesapalService] Registering Order Payload:`, JSON.stringify(payload));
            const response = await axios.post(url, payload, {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
                 timeout: 15000
            });
            console.log('[PesapalService] Register Order API Response:', response.data);
            if (response?.data?.status !== "200" || !response?.data?.order_tracking_id || !response?.data?.redirect_url) {
                const errorDetail = response?.data?.error ? JSON.stringify(response.data.error) : JSON.stringify(response?.data);
                throw new Error(`Required fields missing or status not 200: ${errorDetail}`);
            }
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const errorData = error.response?.data;
            const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || error.message || 'Unknown order registration error';
            console.error(`[PesapalService] Error registering order. Status: ${status}. Error: ${errorMsg}. Payload:`, JSON.stringify(payload));
            throw new Error(`Failed to register order with Pesapal: ${errorMsg}`);
        }
    }

    // --- Get Transaction Status ---
    async getTransactionStatus(token, orderTrackingId) {
        const url = `${this.baseUrl}/api/Transactions/GetTransactionStatus`;
        try {
            if (!orderTrackingId) throw new Error('Order Tracking ID required.');
            console.log(`[PesapalService] Querying Status for Tracking ID: ${orderTrackingId}`);
            const response = await axios.get(url, {
                params: { orderTrackingId: String(orderTrackingId) },
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
                timeout: 10000
            });
            console.log('[PesapalService] Get Transaction Status Response:', response.data);
            if (response?.data?.status && response.data.status !== "200") {
                 console.warn(`[PesapalService] GetTransactionStatus non-200 internal status: ${response.data.status}`, response.data);
            }
             if (response?.data?.status_code === undefined || !response?.data?.payment_status_description) {
                 console.warn(`[PesapalService] Status response missing expected fields:`, response.data);
             }
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const errorData = error.response?.data;
            const errorMsg = errorData?.error?.message || errorData?.message || JSON.stringify(errorData) || error.message || 'Unknown status query error';
            console.error(`[PesapalService] Error querying status for ${orderTrackingId}. Status: ${status}. Error: ${errorMsg}`);
            throw new Error(`Failed to query Pesapal status: ${errorMsg}`);
        }
    }

    // --- Register IPN URL ---
    async registerIPN(token, ipnUrl, ipnNotificationType = 'POST') {
        const url = `${this.baseUrl}/api/URLSetup/RegisterIPN`;
         try {
             if (!ipnUrl) throw new Error('IPN URL required.');
             const payload = { url: ipnUrl, ipn_notification_type: ipnNotificationType.toUpperCase() };
             console.log(`[PesapalService] Registering IPN: ${ipnUrl} (${ipnNotificationType})`);
             const response = await axios.post(url, payload, {
                 headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
                  timeout: 10000
             });
             console.log('[PesapalService] Register IPN Response:', response.data);
             if (response?.data?.status !== "200" || !response?.data?.ipn_id) {
                 const errorDetail = response?.data?.error ? JSON.stringify(response.data.error) : JSON.stringify(response?.data);
                 throw new Error(`Failed to register IPN. Response: ${errorDetail}`);
             }
             console.log(`[PesapalService] IPN URL registered. IPN ID: ${response.data.ipn_id}`);
             return response.data;
         } catch (error) { /* ... error handling ... */ }
    }

    // --- Get Registered IPNs ---
    async getRegisteredIPNs(token) {
        const url = `${this.baseUrl}/api/URLSetup/GetIpnList`;
        try {
             console.log(`[PesapalService] Fetching IPN list...`);
             const response = await axios.get(url, { headers: { /* ... */ }, timeout: 10000 });
             console.log('[PesapalService] Get Registered IPNs Response:', response.data);
             if (!Array.isArray(response?.data)) throw new Error(/* ... */);
             console.log(`[PesapalService] Found ${response.data.length} IPNs.`);
             return response.data;
         } catch (error) { /* ... error handling ... */ }
    }
}