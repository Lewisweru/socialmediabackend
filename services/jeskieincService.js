// services/jeskieincService.js
import axios from 'axios';
import { URLSearchParams } from 'url'; // Use Node's built-in URLSearchParams

const API_URL = 'https://jeskieinc.com/api/v2'; // Ensure HTTPS
const API_KEY = process.env.JESKIEINC_API_KEY;

// --- Jeskie Inc API Interaction Functions ---

/**
 * Helper to make POST requests to Jeskie API using x-www-form-urlencoded
 */
const _makeJeskienRequest = async (action, params) => {
    if (!API_KEY) {
        console.error(`[Jeskien Service - ${action}] API Key missing!`);
        throw new ValueError("Supplier API Key is not configured.");
    }

    const payload = new URLSearchParams({
        key: API_KEY,
        action: action,
        ...params // Spread action-specific parameters
    });

    console.debug(`[Jeskien Service - ${action}] Request URL: ${API_URL}`);
    // Avoid logging full payload with key in production if possible
    // console.debug(`[Jeskien Service - ${action}] Request Payload: ${payload.toString()}`);

    try {
        const response = await axios.post(API_URL, payload.toString(), { // Send encoded string
             headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
             timeout: 30000 // 30 second timeout
        });
        console.debug(`[Jeskien Service - ${action}] Response Status: ${response.status}`);
        console.debug(`[Jeskien Service - ${action}] Response Body:`, response.data);

        // Check for explicit error field in the JSON response
        if (response.data?.error) {
            throw new Error(`API Error: ${response.data.error}`);
        }
        // Perform basic check if response is an object (expected for success/status)
        if (typeof response.data !== 'object' || response.data === null) {
             throw new Error(`Unexpected API response format: ${JSON.stringify(response.data)}`);
        }

        return response.data; // Return parsed JSON

    } catch (error) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        const errorMsg = errorData?.error // Explicit error field
                         || errorData?.message
                         || (typeof errorData === 'string' ? errorData : null) // Plain text?
                         || error.message // Axios/network error
                         || 'Unknown error';
        console.error(`[Jeskien Service - ${action}] Request Failed. Status: ${status}. Error: ${errorMsg}`);
        throw new Error(`Supplier API request failed: ${errorMsg}`); // Rethrow standardized error
    }
};


/**
 * Places an order with the Jeskie Inc API.
 * @returns {Promise<string>} - The Jeskie Inc numeric order ID (as a string).
 */
export const addJeskienOrder = async (serviceId, link, quantity) => {
    console.log(`[Jeskien Service] Placing order: Service=${serviceId}, Link=${link}, Qty=${quantity}`);
    if (!serviceId || !link || !quantity) {
        throw new Error("Missing required parameters for Jeskien order.");
    }
    const params = {
        service: String(serviceId),
        link: String(link),
        quantity: String(quantity),
    };
    const responseData = await _makeJeskienRequest('add', params);

    // Check if the mandatory order ID is present and seems valid
    if (!responseData.order || typeof responseData.order !== 'number') {
        throw new Error(`Supplier order ID missing or invalid in response: ${JSON.stringify(responseData)}`);
    }
    const supplierOrderId = String(responseData.order);
    console.log(`[Jeskien Service - Add Order] Success. Supplier Order ID: ${supplierOrderId}`);
    return supplierOrderId;
};

/**
 * Checks the status of one or more orders with the Jeskie Inc API.
 * @param {string} supplierOrderIds - A single ID or comma-separated string of IDs.
 * @returns {Promise<object>} - The status response object from Jeskie Inc.
 */
export const getJeskienOrderStatus = async (supplierOrderIds) => {
    const idsString = String(supplierOrderIds).trim();
    console.log(`[Jeskien Service] Checking status for IDs: ${idsString.substring(0,100)}...`);
    if (!idsString) throw new Error("Supplier Order ID(s) required.");

    const params = { orders: idsString };
    const responseData = await _makeJeskienRequest('status', params);

    // The response itself is the object { "id1": {status...}, "id2": {error...}}
    console.debug(`[Jeskien Service - Status Check] Parsed Response Data:`, responseData);
    return responseData;
};

/**
 * Gets the current balance from Jeskie Inc API.
 */
export const getJeskienBalance = async () => {
     console.log(`[Jeskien Service] Checking balance...`);
     const params = {}; // No extra params needed for balance action
     const responseData = await _makeJeskienRequest('balance', params);
     if (!responseData.balance || !responseData.currency) {
          throw new Error(`Invalid balance response format: ${JSON.stringify(responseData)}`);
     }
     console.log(`[Jeskien Service - Balance Check] Success. Balance: ${responseData.balance} ${responseData.currency}`);
     return responseData; // { balance: "100.84", currency: "USD" }
};

// Add other Jeskie Inc API functions here if needed (refill, cancel, etc.)