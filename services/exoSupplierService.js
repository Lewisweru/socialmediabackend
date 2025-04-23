// services/exoSupplierService.js (FINAL COMPLETE VERSION)
import axios from 'axios';
import config from '../config.js';
import { info, warn, error, debug } from '../utils/logger.js';

// --- Axios Instance ---
const exoSupplierApi = axios.create({
    baseURL: config.exoSupplier.apiUrl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000 // 30 second timeout
});

// --- Helper ---
const makeExoSupplierRequest = async (action, params = {}) => {
    if (!config.exoSupplier.apiKey) {
        error('[ExoSupplier Service] API Key missing.');
        throw new Error('ExoSupplier API Key is not configured.');
    }
    const requestParams = { key: config.exoSupplier.apiKey, action: action, ...params };
    const requestData = new URLSearchParams(requestParams).toString();
    try {
        debug(`[ExoSupplier Req] Action: ${action}, Params: ${JSON.stringify(params)}`);
        const response = await exoSupplierApi.post('', requestData);
        if (response.status !== 200) { error(`[ExoSupplier Err] HTTP ${response.status} for ${action}. Resp: ${JSON.stringify(response.data)}`); throw new Error(`HTTP Error (${response.status})`); }
        if (response.data && typeof response.data === 'object' && 'error' in response.data && typeof response.data.error === 'string') { warn(`[ExoSupplier Resp Err] Action: ${action}. Error: ${response.data.error}`); throw new Error(`API Error: ${response.data.error}`); }
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) { warn(`[ExoSupplier Warn] Unexpected Content-Type: ${contentType} for ${action}.`); }
        debug(`[ExoSupplier Resp OK] Action: ${action}.`);
        return response.data;
    } catch (err) {
        const statusCode = err.response?.status; const responseData = err.response?.data;
        const errorMessage = responseData?.error || err.message || 'Unknown API error';
        error(`[ExoSupplier Fail] Action: ${action}. Status: ${statusCode || 'N/A'}. Error: ${errorMessage}`, { requestParams: params, responseData });
        throw new Error(`API action '${action}' failed. Status: ${statusCode || 'N/A'}. Reason: ${errorMessage}`);
    }
};

// --- Service Data Storage & Mapping ---
let serviceDetailsById = new Map(); // Stores API details keyed by numeric Service ID
const normalizeKey = (str) => str ? str.toLowerCase().replace(/[^a-z0-9]/gi, '') : '';

// --- FINAL MANUAL MAPPING (HQ/LQ Specific) ---
// KEY FORMAT: `${normalizeKey(platform)}_${normalizeKey(baseServiceName)}`
// VALUE: { hq: HQ_SUPPLIER_ID, lq: LQ_SUPPLIER_ID }
// *** Verify these keys match your frontend's normalized platform + service name ***
const FRONTEND_SERVICE_TO_SUPPLIER_IDS_MAP = {
  // --- TikTok ---
  'tiktok_followers': { hq: 3037, lq: 3038 },
  'tiktok_likes':     { hq: 3049, lq: 3050 },
  'tiktok_views':     { hq: 3043, lq: 3044 },

  // --- Instagram ---
  'instagram_followers':     { hq: 2995, lq: 2994 },
  'instagram_likes':         { hq: 2999, lq: 2998 },
  'instagram_videoreelviews':{ hq: 3007, lq: 3000 }, // Combined key - VERIFY

  // --- Facebook ---
  'facebook_pagefollowers':   { hq: 2917, lq: 2920 },
  'facebook_profilefollowers':{ hq: 2925, lq: 2924 },
  'facebook_pagelikefollow':  { hq: 2926, lq: 2928 }, // VERIFY key
  'facebook_postlikes':       { hq: 3099, lq: 2934 },
  'facebook_videoreelviews':  { hq: 2981, lq: 2978 }, // Combined key - VERIFY

  // --- YouTube ---
  'youtube_subscribers': { hq: 3058, lq: 3056 },
  'youtube_views':       { hq: 3065, lq: 3061 },
  'youtube_likes':       { hq: 3077, lq: 3067 },

  // --- WhatsApp ---
  'whatsapp_channelmembers': { hq: 2878, lq: 2880 },
  'whatsapp_emojireactions': { hq: 2891, lq: 2884 }, // VERIFY key

  // --- Telegram ---
  'telegram_members':       { hq: 2877, lq: 2904 }, // VERIFY key
  'telegram_postviews':     { hq: 2801, lq: 2804 },
  'telegram_postreactions': { hq: 2805, lq: 2733 }, // VERIFY key

  // --- X / Twitter ---
  'x_followers': { hq: 3083, lq: 3082 }, // Assuming platform key 'x'
  'x_likes':     { hq: 3085, lq: 3084 },
  'x_retweets':  { hq: 3090, lq: 3096 }, // Assuming key "retweets"
};
// --- END MANUAL MAPPING ---


// Loads all services from API to get details (min/max/rate etc.) for validation
export const loadExoSupplierServices = async () => {
    info('[ExoSupplier Service] Loading ALL services for details...');
    try {
        const services = await makeExoSupplierRequest('services');
        if (!Array.isArray(services)) { throw new Error('Invalid service list format.'); }

        let loadedCount = 0;
        const tempMap = new Map();
        for (const service of services) {
            // Initial check for required fields
            if (!service || service.service === undefined || service.service === null || service.service === '' ||
                !service.category || !service.name || service.rate === undefined || service.rate === null ||
                service.min === undefined || service.min === null || service.max === undefined || service.max === null) {
                warn(`[ExoSupplier Load] Skipping invalid service obj (missing fields):`, service); continue;
            }
            // Parse/Validate numeric fields
            const serviceIdNumber = parseInt(String(service.service), 10);
            const minVal = parseInt(String(service.min), 10);
            const maxVal = parseInt(String(service.max), 10);
            const rateVal = parseFloat(String(service.rate));
            if (isNaN(serviceIdNumber) || isNaN(minVal) || isNaN(maxVal) || isNaN(rateVal)) {
                warn(`[ExoSupplier Load] Skipping service obj (invalid numbers):`, service); continue;
            }

            // Store details keyed by numeric ID
            tempMap.set(serviceIdNumber, {
                id: serviceIdNumber, name: service.name, type: service.type, category: service.category,
                min: minVal, max: maxVal, refill: !!service.refill, cancel: !!service.cancel, rate: rateVal
            });
            loadedCount++;
        }
        serviceDetailsById = tempMap; // Update global map

        if (loadedCount > 0) { info(`[ExoSupplier Service] Loaded details for ${loadedCount} services.`); }
        else { warn(`[ExoSupplier Load] Mapped 0 valid services. Check API data/validation.`); }

        // Optional validation of manual map against loaded data
        for (const key in FRONTEND_SERVICE_TO_SUPPLIER_IDS_MAP) {
            const ids = FRONTEND_SERVICE_TO_SUPPLIER_IDS_MAP[key];
            if (ids.hq && !serviceDetailsById.has(ids.hq)) { warn(`[ExoSupplier Config Warn] Mapped HQ ID ${ids.hq} ('${key}') not found in loaded list!`); }
            if (ids.lq && !serviceDetailsById.has(ids.lq)) { warn(`[ExoSupplier Config Warn] Mapped LQ ID ${ids.lq} ('${key}') not found in loaded list!`); }
        }

    } catch (loadError) {
        error('[ExoSupplier Service] FATAL: Failed load services startup.', loadError.message);
        serviceDetailsById.clear();
        warn("[ExoSupplier Service] Service details unavailable.");
    }
};

// Gets details for the specific HQ or LQ ExoSupplier service ID mapped from the frontend choice
export const getExoSupplierServiceDetails = (platform, baseServiceName, quality) => {
    const lookupKey = `${normalizeKey(platform)}_${normalizeKey(baseServiceName)}`;
    const mappedIds = FRONTEND_SERVICE_TO_SUPPLIER_IDS_MAP[lookupKey];

    if (!mappedIds) { warn(`[ExoSupplier Map] No HQ/LQ map for key: '${lookupKey}'`); return null; }

    const targetServiceId = (quality === 'high') ? mappedIds.hq : mappedIds.lq;

    if (targetServiceId === undefined || targetServiceId === null) { warn(`[ExoSupplier Map] No ID for quality '${quality}' for key '${lookupKey}'.`); return null; }
    if (serviceDetailsById.size === 0) { error('[ExoSupplier Detail] Service map empty (load failed?).'); return null; }

    const serviceDetails = serviceDetailsById.get(targetServiceId);
    if (!serviceDetails) { error(`[ExoSupplier Detail] Details not loaded for mapped ID: ${targetServiceId} (Key: '${lookupKey}', Quality: '${quality}')`); return null; }

    debug(`[ExoSupplier Detail] Found map for ${platform}/${baseServiceName} (${quality}) -> Supplier ID ${targetServiceId}`);
    return serviceDetails;
};

// --- API Action Functions ---
// These remain unchanged as they operate on the serviceId provided by the controller

/** Places a new order */
export const placeExoSupplierOrder = async (serviceId, link, quantity, runs = null, interval = null) => {
    info(`[ExoSupplier Service] Placing order - ID: ${serviceId}, Qty: ${quantity}, Link: ${link}`);
    const params = { service: serviceId, link: link, quantity: quantity };
    if (runs !== null && runs !== undefined) params.runs = runs;
    if (interval !== null && interval !== undefined) params.interval = interval;
    const response = await makeExoSupplierRequest('add', params);
    if (!response || typeof response.order !== 'number') { error('[ExoSupplier Order Err] Invalid response/order ID.', response); throw new Error('Order failed: Invalid response.'); }
    info(`[ExoSupplier Order OK] Supplier Order ID: ${response.order}`);
    return response.order;
};

/** Checks status of a single order */
export const getExoSupplierOrderStatus = async (supplierOrderId) => {
     debug(`[ExoSupplier Service] Checking status ID: ${supplierOrderId}`);
    return await makeExoSupplierRequest('status', { order: supplierOrderId });
};

/** Checks status of multiple orders */
export const getExoSupplierMultiOrderStatus = async (supplierOrderIds) => {
    const idsArray = Array.isArray(supplierOrderIds) ? supplierOrderIds : String(supplierOrderIds).split(',').map(id => id.trim()).filter(id => id); if (idsArray.length === 0) return {}; if (idsArray.length > 100) { throw new Error('Max 100 orders for multi-status.'); } const idsString = idsArray.join(','); debug(`[ExoSupplier Service] Multi-status IDs: ${idsString}`); return await makeExoSupplierRequest('status', { orders: idsString });
};

/** Gets user balance */
export const getExoSupplierBalance = async () => {
     debug('[ExoSupplier Service] Fetching balance...'); const response = await makeExoSupplierRequest('balance'); if (!response || typeof response.balance !== 'string' || typeof response.currency !== 'string') { error('[ExoSupplier Balance Err] Invalid response.', response); throw new Error('Balance check failed: Invalid response.'); } info(`[ExoSupplier Balance OK] ${response.balance} ${response.currency}`); return response;
};

/** Creates a refill request for a single order */
export const createExoSupplierRefill = async (supplierOrderId) => {
    info(`[ExoSupplier Service] Refill request ID: ${supplierOrderId}`); return await makeExoSupplierRequest('refill', { order: supplierOrderId });
};

/** Creates refill requests for multiple orders */
export const createExoSupplierMultiRefill = async (supplierOrderIds) => {
     const idsArray = Array.isArray(supplierOrderIds) ? supplierOrderIds : String(supplierOrderIds).split(',').map(id => id.trim()).filter(id => id); if (idsArray.length === 0) return []; if (idsArray.length > 100) { throw new Error('Max 100 orders for multi-refill.'); } const idsString = idsArray.join(','); info(`[ExoSupplier Service] Multi-refill IDs: ${idsString}`); return await makeExoSupplierRequest('refill', { orders: idsString });
};

/** Gets status of a single refill request */
export const getExoSupplierRefillStatus = async (refillId) => {
    debug(`[ExoSupplier Service] Checking refill status ID: ${refillId}`); return await makeExoSupplierRequest('refill_status', { refill: refillId });
};

/** Gets status of multiple refill requests */
export const getExoSupplierMultiRefillStatus = async (refillIds) => {
     const idsArray = Array.isArray(refillIds) ? refillIds : String(refillIds).split(',').map(id => id.trim()).filter(id => id); if (idsArray.length === 0) return []; if (idsArray.length > 100) { throw new Error('Max 100 refills for multi-status.'); } const idsString = idsArray.join(','); debug(`[ExoSupplier Service] Multi-refill status IDs: ${idsString}`); return await makeExoSupplierRequest('refill_status', { refills: idsString });
};

/** Creates cancel requests for multiple orders */
export const createExoSupplierCancel = async (supplierOrderIds) => {
     const idsArray = Array.isArray(supplierOrderIds) ? supplierOrderIds : String(supplierOrderIds).split(',').map(id => id.trim()).filter(id => id); if (idsArray.length === 0) return []; if (idsArray.length > 100) { throw new Error('Max 100 orders for multi-cancel.'); } const idsString = idsArray.join(','); info(`[ExoSupplier Service] Cancel request IDs: ${idsString}`); return await makeExoSupplierRequest('cancel', { orders: idsString });
};