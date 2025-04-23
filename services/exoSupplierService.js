// services/exoSupplierService.js (Complete - Updated for ExoSupplier API)
import axios from 'axios';
import config from '../config.js';
import { info, warn, error, debug } from '../utils/logger.js';

// --- Axios Instance for ExoSupplier API ---
const exoSupplierApi = axios.create({
    baseURL: config.exoSupplier.apiUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000 // Set a reasonable global timeout (e.g., 30 seconds)
});

// --- Helper for Making Requests ---
const makeExoSupplierRequest = async (action, params = {}) => {
    if (!config.exoSupplier.apiKey) {
        error('[ExoSupplier Service] API Key is missing in configuration.');
        throw new Error('ExoSupplier API Key is not configured.');
    }
    // Ensure key and action are always present
    const requestParams = {
        key: config.exoSupplier.apiKey,
        action: action,
        ...params,
    };
    const requestData = new URLSearchParams(requestParams).toString();

    try {
        debug(`[ExoSupplier API Request] Action: ${action}, Params: ${JSON.stringify(params)}`); // Log params without key
        const response = await exoSupplierApi.post('', requestData); // POST with form data

        // Standard HTTP status check
        if (response.status !== 200) {
            error(`[ExoSupplier API Error] HTTP Status ${response.status} for Action: ${action}. Response: ${JSON.stringify(response.data)}`);
            throw new Error(`ExoSupplier API HTTP Error (${response.status}): ${response.statusText}`);
        }

        // Check for application-level errors within the JSON response (common pattern: {"error": "..."})
        if (response.data && typeof response.data === 'object' && 'error' in response.data && typeof response.data.error === 'string') {
             const errorMessage = response.data.error;
             warn(`[ExoSupplier API Response Error] Action: ${action}. Error: ${errorMessage}`);
             // Throw a more specific error based on the API's message
             throw new Error(`ExoSupplier API Error: ${errorMessage}`);
         }

        // Check for unexpected response formats (e.g., HTML error pages)
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
             warn(`[ExoSupplier API Warning] Unexpected Content-Type: ${contentType} for Action: ${action}. Body might not be JSON.`);
             // Decide if this should be an error or just logged
        }


        debug(`[ExoSupplier API Response] Action: ${action}. Data: ${JSON.stringify(response.data)}`);
        return response.data; // Return the parsed JSON data

    } catch (err) { // Catch axios errors and application-level errors thrown above
        const statusCode = err.response?.status;
        const responseData = err.response?.data;
        const errorMessage = responseData?.error || err.message || 'Unknown API error'; // Prioritize API's error message

        error(`[ExoSupplier API Failure] Action: ${action}. Status: ${statusCode || 'N/A'}. Error: ${errorMessage}`, { requestParams: params, responseData }); // Log details

        // Re-throw a potentially cleaner error message
        throw new Error(`ExoSupplier API action '${action}' failed. Status: ${statusCode || 'N/A'}. Reason: ${errorMessage}`);
    }
};

// --- Service Mapping Logic ---
let serviceMap = null; // Stores Map<NormalizedPlatform, Map<NormalizedService, ServiceDetails>>
const normalizeKey = (str) => str ? str.toLowerCase().replace(/[^a-z0-9]/gi, '') : '';

// Loads services and builds the map
export const loadExoSupplierServices = async () => {
    info('[ExoSupplier Service] Attempting to load services...');
    try {
        // API returns an array of service objects directly
        const services = await makeExoSupplierRequest('services');

        if (!Array.isArray(services)) {
             error('[ExoSupplier Service] Failed to load services: API did not return an array.', services);
             throw new Error('Invalid format received for services list.');
        }

        const newMap = new Map();
        let serviceCount = 0;
        for (const service of services) {
            // Validate basic service structure
            if (!service || typeof service.service !== 'number' || !service.category || !service.name || !service.rate || !service.min || !service.max) {
                warn(`[ExoSupplier Service] Skipping invalid service object:`, service);
                continue;
            }

            const platformKey = normalizeKey(service.category);
            const serviceNameKey = normalizeKey(service.name);
            const finalPlatformKey = platformKey; // Assuming category maps directly for now

            if (!newMap.has(finalPlatformKey)) {
                newMap.set(finalPlatformKey, new Map());
            }
            const platformServices = newMap.get(finalPlatformKey);

            // Store relevant details, parsing numbers
            const serviceDetails = {
                id: service.service,
                name: service.name, // Store original name too
                type: service.type,
                category: service.category,
                min: parseInt(service.min, 10) || 0,
                max: parseInt(service.max, 10) || 0,
                refill: !!service.refill, // Convert to boolean
                cancel: !!service.cancel, // Convert to boolean
                rate: parseFloat(service.rate) || 0.0
            };

            if (platformServices.has(serviceNameKey)) {
                 warn(`[ExoSupplier Service] Duplicate normalized service key detected: Platform='${finalPlatformKey}', Service='${serviceNameKey}'. Overwriting with Service ID: ${serviceDetails.id}.`);
            }
            platformServices.set(serviceNameKey, serviceDetails);
            serviceCount++;
        }
        serviceMap = newMap;
        info(`[ExoSupplier Service] Successfully loaded and mapped ${serviceCount} valid services across ${newMap.size} platforms.`);

    } catch (loadError) {
        error('[ExoSupplier Service] FATAL: Failed to load services during startup.', loadError.message);
        serviceMap = null; // Ensure map is null on failure
        warn("[ExoSupplier Service] Service map is unavailable. Order placement and lookups will fail.");
        // Optional: re-throw to halt server startup if services are essential
        // throw new Error(`Failed to load ExoSupplier services: ${loadError.message}`);
    }
};

// Gets full details object for a service
export const getExoSupplierServiceDetails = (platform, serviceName) => {
    if (!serviceMap) {
        error('[ExoSupplier Service] Service map is not loaded, cannot get service details.');
        return null;
    }
    const platformKey = normalizeKey(platform);
    const serviceNameKey = normalizeKey(serviceName);
    const finalPlatformKey = platformKey;

    const platformServices = serviceMap.get(finalPlatformKey);
    if (!platformServices) {
         warn(`[ExoSupplier Service] No services found for platform key: '${finalPlatformKey}' (Platform: '${platform}')`);
        return null;
    }
    const serviceDetails = platformServices.get(serviceNameKey);
    if (!serviceDetails) {
        warn(`[ExoSupplier Service] Details not found for service key: '${serviceNameKey}' (Platform: '${finalPlatformKey}', Service: '${serviceName}')`);
        debug(`[ExoSupplier Service] Available keys for ${finalPlatformKey}: ${Array.from(platformServices.keys()).join(', ')}`);
        return null;
    }
    debug(`[ExoSupplier Service] Found details for ${platform}/${serviceName}`);
    return serviceDetails; // Returns { id, name, type, category, min, max, refill, cancel, rate }
};

// --- API Action Functions ---

/** Places a new order */
export const placeExoSupplierOrder = async (serviceId, link, quantity, runs = null, interval = null) => {
    info(`[ExoSupplier Service] Placing order - ServiceID: ${serviceId}, Qty: ${quantity}, Link: ${link}`);
    const params = { service: serviceId, link: link, quantity: quantity };
    // Add optional parameters only if they have a value
    if (runs !== null && runs !== undefined) params.runs = runs;
    if (interval !== null && interval !== undefined) params.interval = interval;

    const response = await makeExoSupplierRequest('add', params);

    // Validate response structure specifically for 'add' action
    if (!response || typeof response.order !== 'number') {
        error('[ExoSupplier Service] Place order failed: API did not return a numeric order ID.', response);
        throw new Error('ExoSupplier order placement failed: Invalid response format or missing order ID.');
    }
    info(`[ExoSupplier Service] Order placed successfully. Supplier Order ID: ${response.order}`);
    return response.order; // Return the numeric order ID
};

/** Checks status of a single order */
export const getExoSupplierOrderStatus = async (supplierOrderId) => {
     debug(`[ExoSupplier Service] Checking status for Order ID: ${supplierOrderId}`);
    const response = await makeExoSupplierRequest('status', { order: supplierOrderId });
    // Response could be { status: "...", ... } or { error: "..." }
    return response;
};

/** Checks status of multiple orders */
export const getExoSupplierMultiOrderStatus = async (supplierOrderIds) => {
    const idsArray = Array.isArray(supplierOrderIds) ? supplierOrderIds : String(supplierOrderIds).split(',').map(id => id.trim()).filter(id => id);
    if (idsArray.length === 0) return {}; // Return empty object if no valid IDs
    if (idsArray.length > 100) {
        warn('[ExoSupplier Service] Attempted to check status for more than 100 orders.');
        throw new Error('Cannot check status for more than 100 orders at once.');
    }
    const idsString = idsArray.join(',');
    debug(`[ExoSupplier Service] Checking multi-order status for IDs: ${idsString}`);
    // Response is an object keyed by order ID: { "1": { status: ... }, "10": { error: ... } }
    return await makeExoSupplierRequest('status', { orders: idsString });
};

/** Gets user balance */
export const getExoSupplierBalance = async () => {
     debug('[ExoSupplier Service] Fetching balance...');
     const response = await makeExoSupplierRequest('balance');
     // Validate response
     if (!response || typeof response.balance !== 'string' || typeof response.currency !== 'string') {
          error('[ExoSupplier Service] Get balance failed: Invalid response format.', response);
          throw new Error('ExoSupplier get balance failed: Invalid response format.');
     }
     info(`[ExoSupplier Service] Balance received: ${response.balance} ${response.currency}`);
    return response;
};

/** Creates a refill request for a single order */
export const createExoSupplierRefill = async (supplierOrderId) => {
    info(`[ExoSupplier Service] Requesting refill for Order ID: ${supplierOrderId}`);
    const response = await makeExoSupplierRequest('refill', { order: supplierOrderId });
    // Response: { "refill": "1" } or { "error": "..." }
    return response;
};

/** Creates refill requests for multiple orders */
export const createExoSupplierMultiRefill = async (supplierOrderIds) => {
     const idsArray = Array.isArray(supplierOrderIds) ? supplierOrderIds : String(supplierOrderIds).split(',').map(id => id.trim()).filter(id => id);
     if (idsArray.length === 0) return [];
     if (idsArray.length > 100) {
          warn('[ExoSupplier Service] Attempted multi-refill for more than 100 orders.');
         throw new Error('Cannot request refill for more than 100 orders at once.');
     }
    const idsString = idsArray.join(',');
    info(`[ExoSupplier Service] Requesting multi-refill for IDs: ${idsString}`);
    // Response: [ { "order": 1, "refill": 1 }, { "order": 3, "refill": {"error": ...} } ]
    return await makeExoSupplierRequest('refill', { orders: idsString });
};

/** Gets status of a single refill request */
export const getExoSupplierRefillStatus = async (refillId) => {
    debug(`[ExoSupplier Service] Checking refill status for Refill ID: ${refillId}`);
    // Response: { "status": "Completed" } or { "error": "..." }
    return await makeExoSupplierRequest('refill_status', { refill: refillId });
};

/** Gets status of multiple refill requests */
export const getExoSupplierMultiRefillStatus = async (refillIds) => {
     const idsArray = Array.isArray(refillIds) ? refillIds : String(refillIds).split(',').map(id => id.trim()).filter(id => id);
     if (idsArray.length === 0) return [];
     if (idsArray.length > 100) {
         warn('[ExoSupplier Service] Attempted multi-refill-status for more than 100 refills.');
         throw new Error('Cannot check status for more than 100 refills at once.');
     }
    const idsString = idsArray.join(',');
    debug(`[ExoSupplier Service] Checking multi-refill status for Refill IDs: ${idsString}`);
    // Response: [ { "refill": 1, "status": "Completed"}, {"refill": 3, "status": {"error": ...}} ]
    return await makeExoSupplierRequest('refill_status', { refills: idsString });
};

/** Creates cancel requests for multiple orders */
export const createExoSupplierCancel = async (supplierOrderIds) => {
     const idsArray = Array.isArray(supplierOrderIds) ? supplierOrderIds : String(supplierOrderIds).split(',').map(id => id.trim()).filter(id => id);
     if (idsArray.length === 0) return [];
     if (idsArray.length > 100) {
          warn('[ExoSupplier Service] Attempted multi-cancel for more than 100 orders.');
         throw new Error('Cannot request cancellation for more than 100 orders at once.');
     }
    const idsString = idsArray.join(',');
    info(`[ExoSupplier Service] Requesting cancellation for Order IDs: ${idsString}`);
    // Response: [ { "order": 2, "cancel": 1 }, { "order": 9, "cancel": {"error": ...} } ]
    return await makeExoSupplierRequest('cancel', { orders: idsString });
};