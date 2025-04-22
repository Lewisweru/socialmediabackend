// services/jeskieService.js (ESM)
import axios from 'axios'; // Use import - ensure axios is installed
import config from '../config.js'; // Assuming config.js is generated or rename config.ts->config.js
import { info, warn, error, debug } from '../utils/logger.js'; // Use import

// --- Interfaces (optional in JS, but good for clarity) ---
// interface JeskieService { ... }
// interface JeskieOrderResponse { ... }
// interface JeskieStatusResponse { ... }
// interface JeskieBalanceResponse { ... }

// --- Axios Instance (Same as before) ---
const jeskieApi = axios.create({
    baseURL: config.jeskie.apiUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
});

// --- Helper (Same as before, ESM syntax) ---
const makeJeskieRequest = async (action, params) => {
    if (!config.jeskie.apiKey) {
        throw new Error('Jeskie API Key is not configured.');
    }
    const requestData = new URLSearchParams({
        key: config.jeskie.apiKey, action: action, ...params,
    }).toString();
    try {
        debug(`Calling Jeskie API - Action: ${action}, Params: ${JSON.stringify(params)}`);
        const response = await jeskieApi.post('', requestData);
        if (response.status !== 200) {
            throw new Error(`Jeskie API HTTP Error (${response.status}): ${response.statusText}`);
        }
         if (response.data && typeof response.data === 'object' && 'error' in response.data && typeof response.data.error === 'string') {
             const errorMessage = response.data.error;
             error(`Jeskie API Error Response for Action ${action}: ${errorMessage}`);
             throw new Error(`Jeskie API returned error: ${errorMessage}`);
         }
        debug(`Jeskie API Response for Action ${action}: ${JSON.stringify(response.data)}`);
        return response.data;
    } catch (err) { // Changed variable name to avoid conflict
        const errorMessage = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        error(`Error calling Jeskie API (${action}): ${err.message}`, { data: err.response?.data, status: err.response?.status });
        throw new Error(`Failed to execute Jeskie API action '${action}'. Error: ${err.message}`);
    }
};

// --- Service Mapping (Same as before, ESM syntax) ---
let serviceMap = null;
const normalizeKey = (str) => str ? str.toLowerCase().replace(/[^a-z0-9]/gi, '') : '';

export const loadJeskieServices = async () => { // Use export keyword
    info('Attempting to load Jeskie services...');
    try {
        const services = await makeJeskieRequest('services', {});
        const newMap = new Map();
        for (const service of services) {
            const platformKey = normalizeKey(service.category);
            const serviceNameKey = normalizeKey(service.name);
            const finalPlatformKey = platformKey; // Adjust if manual mapping needed

            if (!newMap.has(finalPlatformKey)) {
                newMap.set(finalPlatformKey, new Map());
            }
            const platformServices = newMap.get(finalPlatformKey);
            if (platformServices.has(serviceNameKey)) {
                 warn(`Duplicate normalized service key detected: Platform='${finalPlatformKey}', Service='${serviceNameKey}'. Overwriting with Service ID: ${service.service}.`);
            }
            platformServices.set(serviceNameKey, service.service);
        }
        serviceMap = newMap;
        info(`Successfully loaded and mapped ${services.length} Jeskie services. ${newMap.size} platforms detected.`);
    } catch (loadError) { // Changed variable name
        error('FATAL: Failed to load Jeskie services on startup.', loadError);
        serviceMap = null;
        // throw loadError; // Optional: Stop server start
    }
};

export const getJeskieServiceId = (platform, serviceName) => { // Use export keyword
    if (!serviceMap) {
        error('Jeskie service map is not loaded.');
        return null;
    }
    const platformKey = normalizeKey(platform);
    const serviceNameKey = normalizeKey(serviceName);
    const finalPlatformKey = platformKey; // Adjust if manual mapping needed

    const platformServices = serviceMap.get(finalPlatformKey);
    if (!platformServices) {
         warn(`No Jeskie services found for normalized platform key: '${finalPlatformKey}' (Original Platform: '${platform}')`);
        return null;
    }
    const serviceId = platformServices.get(serviceNameKey);
    if (!serviceId) {
        warn(`Jeskie Service ID not found for normalized service key: '${serviceNameKey}' within platform '${finalPlatformKey}' (Original Service: '${serviceName}')`);
        debug(`Available service keys for platform '${finalPlatformKey}': ${Array.from(platformServices.keys()).join(', ')}`);
        return null;
    }
    info(`Found Jeskie Service ID: ${serviceId} for Platform='${platform}', Service='${serviceName}' (Normalized: ${finalPlatformKey}/${serviceNameKey})`);
    return serviceId;
};

// --- API Functions (Same as before, ESM syntax) ---
export const placeJeskieOrder = async (link, quantity, serviceId) => { // Use export keyword
    info(`Attempting to place Jeskie order - ServiceID: ${serviceId}, Qty: ${quantity}, Link: ${link}`);
    const response = await makeJeskieRequest('add', { service: serviceId, link: link, quantity: quantity });
    if (!response || typeof response.order !== 'number') {
        error('Jeskie API did not return a valid order ID.', response);
        throw new Error('Jeskie API order placement failed: Invalid response or missing order ID.');
    }
    info(`Jeskie order placed successfully. Supplier Order ID: ${response.order}`);
    return response.order;
};

export const getJeskieOrderStatus = async (supplierOrderId) => { // Use export keyword
     debug(`Checking Jeskie order status for Supplier Order ID: ${supplierOrderId}`);
    return await makeJeskieRequest('status', { order: supplierOrderId });
};

export const getJeskieBalance = async () => { // Use export keyword
     debug('Fetching Jeskie balance...');
    return await makeJeskieRequest('balance', {});
};