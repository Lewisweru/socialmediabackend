// controllers/orderController.js (Complete - Updated for ExoSupplier)

import Order from '../models/Order.js';
import User from '../models/User.js';
// NOTE: Import the CLASS from the service, not the router
import { PesapalService } from '../services/pesapal.js';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { info, warn, error, debug } from '../utils/logger.js';
import { calculatePrice } from '../utils/pricing.js'; // Your internal pricing logic
// Import ExoSupplier functions
import {
    getExoSupplierServiceDetails, // Use this to get ID, min, max
    placeExoSupplierOrder,       // Use this to place order
} from '../services/exoSupplierService.js'; // Use the renamed service file
import config from '../config.js';

// --- Pesapal Service Initialization ---
if (!config.pesapal.consumerKey || !config.pesapal.consumerSecret) {
  error("FATAL ERROR: Pesapal consumer key and secret must be defined.");
  process.exit(1); // Exit if keys are missing
}
const pesapalService = new PesapalService(
  config.pesapal.consumerKey,
  config.pesapal.consumerSecret,
  config.server.nodeEnv !== 'production' // Use sandbox unless NODE_ENV is 'production'
);
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID; // Get from ENV
if (!REGISTERED_IPN_ID) {
    warn("Warning: PESAPAL_IPN_ID environment variable not set. IPN handling might fail.");
}
// --- End Pesapal Service Initialization ---


// --- Helper Function to Place Supplier Order (Uses ExoSupplier) ---
async function placeSupplierOrderAndUpdateStatus(order) {
    // Double check: Only proceed if status indicates readiness
    if (order.status !== 'Pending Payment' && order.status !== 'Payment Failed') {
        warn(`[Supplier Order Skip] Order ${order._id} has status: ${order.status}.`);
        return order.status; // Return current status
    }
     // Double check: Ensure supplier order ID doesn't already exist
     if (order.supplierOrderId) {
         warn(`[Supplier Order Skip] Order ${order._id} already has supplierOrderId: ${order.supplierOrderId}.`);
         // If it already exists, ensure status reflects this
         if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
             order.status = 'Processing'; return 'Processing';
         }
         return order.status;
     }

    info(`[Supplier Order] Attempting placement for Order ${order._id} via ExoSupplier...`);
    try {
        // 1. Get ExoSupplier Service Details (ID, min, max, etc.)
        const serviceDetails = getExoSupplierServiceDetails(order.platform, order.service);
        if (!serviceDetails || !serviceDetails.id) {
            error(`[Supplier Order Error - ${order._id}] Failed to get ExoSupplier Service Details/ID for ${order.platform}/${order.service}. Check mapping.`);
            order.status = 'Supplier Error'; order.supplierStatus = 'Service ID/Details mapping failed';
            return 'Supplier Error'; // Indicate failure
        }
        const serviceId = serviceDetails.id;
        info(`[Supplier Order - ${order._id}] Mapped to ExoSupplier Service ID: ${serviceId}. Min: ${serviceDetails.min}, Max: ${serviceDetails.max}.`);

        // 2. Validate quantity against supplier limits BEFORE placing order
        if (order.quantity < serviceDetails.min || order.quantity > serviceDetails.max) {
             error(`[Supplier Order Error - ${order._id}] Quantity ${order.quantity} is outside supplier limits (${serviceDetails.min}-${serviceDetails.max}) for Service ID ${serviceId}.`);
             order.status = 'Supplier Error'; order.supplierStatus = `Invalid quantity for supplier (Min: ${serviceDetails.min}, Max: ${serviceDetails.max})`;
             return 'Supplier Error'; // Indicate failure
        }

        // 3. Place the order with ExoSupplier API
        info(`[Supplier Order - ${order._id}] Calling placeExoSupplierOrder...`);
        const supplierOrderId = await placeExoSupplierOrder(
            serviceId,
            order.accountLink,
            order.quantity
            // Add runs/interval here if your Order model stores them:
            // order.runs,
            // order.interval
        );

        // 4. Update internal order document (in memory - save happens in caller)
        order.supplierOrderId = supplierOrderId.toString(); // Store the ID received from ExoSupplier
        order.status = 'Processing'; // Update our internal status
        order.supplierStatus = 'Pending'; // Set initial supplier status (can be updated later by a status check job)
        order.errorMessage = null; // Clear previous errors if placement was successful
        info(`[Supplier Order Success - ${order._id}] Placed ExoSupplier order ${supplierOrderId}. Internal status set to Processing.`);
        return 'Processing'; // Indicate success

    } catch (supplierError) {
        // Catch errors from getExoSupplierServiceDetails or placeExoSupplierOrder
        error(`[Supplier Order Error - ${order._id}] Failed during ExoSupplier interaction: ${supplierError.message}`, supplierError);
        order.status = 'Supplier Error';
        // Store a concise error message for display/debugging
        order.supplierStatus = supplierError.message.length > 100 ? supplierError.message.substring(0, 97) + '...' : supplierError.message;
        return 'Supplier Error'; // Indicate failure
    }
}
// --- End Helper Function ---


// --- Controller Functions ---

/** Initiate Order and Payment */
export const initiateOrderAndPayment = async (req, res) => {
    let savedOrder = null;
    const pesapalOrderId = uuidv4(); // Unique ID for this payment attempt

    try {
        const { platform, service, quality, accountLink, quantity, currency = 'KES', callbackUrl } = req.body;
        const userId = req.user?._id;
        const userEmail = req.user?.email;
        const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;

        // --- Basic Validation ---
        if (!userId) { error("[Initiate Order] Missing User ID."); return res.status(401).json({ message: 'Unauthorized.' }); }
        const parsedQuantity = parseInt(quantity, 10);
        if (!platform || !service || !quality || !accountLink || !parsedQuantity || parsedQuantity <= 0 || !callbackUrl) { error(`[Initiate Order] Missing params user ${userId}`, req.body); return res.status(400).json({ message: 'Missing details.' }); }
        if (!REGISTERED_IPN_ID) { error("[Initiate Order] Server Misconfig - IPN ID"); return res.status(500).json({ message: 'Server config error [IPN].' }); }

        // --- Pre-check with Supplier Service Details ---
        info(`[Initiate Order Pre-check] Getting details for ${platform}/${service}...`);
        const serviceDetailsCheck = getExoSupplierServiceDetails(platform, service);
        if (!serviceDetailsCheck) {
             error(`[Initiate Order Pre-check] Invalid service selected: ${platform}/${service}.`);
             return res.status(400).json({ message: `Service '${service}' for '${platform}' is unavailable.` });
        }
         if (parsedQuantity < serviceDetailsCheck.min || parsedQuantity > serviceDetailsCheck.max) {
              error(`[Initiate Order Pre-check] Quantity ${parsedQuantity} outside limits (${serviceDetailsCheck.min}-${serviceDetailsCheck.max}).`);
              return res.status(400).json({ message: `Quantity must be between ${serviceDetailsCheck.min} and ${serviceDetailsCheck.max}.` });
         }
        info(`[Initiate Order Pre-check] Service valid. Min: ${serviceDetailsCheck.min}, Max: ${serviceDetailsCheck.max}.`);
        // --- End Pre-check ---

        // --- Calculate Price (Using YOUR internal pricing) ---
        const calculatedAmount = calculatePrice(platform, service, quality, parsedQuantity);
        if (calculatedAmount <= 0) { error(`[Initiate Order] Price calc failed.`); return res.status(400).json({ message: 'Price error.' }); }

        // --- Prepare and Save Order ---
        const orderDescription = `${parsedQuantity} ${quality} ${platform} ${service}`;
        const orderData = { pesapalOrderId, userId: String(userId), platform: String(platform).toLowerCase(), service: String(service), quality: String(quality), accountLink: String(accountLink), quantity: parsedQuantity, amount: calculatedAmount, currency: String(currency), description: String(orderDescription).substring(0, 100), status: 'Pending Payment', paymentStatus: 'PENDING', callbackUrlUsed: String(callbackUrl) };
        info(`[Order Initiate - Ref ${pesapalOrderId}] Saving order...`);
        savedOrder = new Order(orderData);
        await savedOrder.save();
        info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created in DB.`);

        // --- Initiate Pesapal Payment ---
        info(`[Order ${savedOrder._id}] Getting Pesapal token...`);
        const token = await pesapalService.getOAuthToken();
        info(`[Order ${savedOrder._id}] Registering Pesapal order...`);
        const customerDetails = { firstName: userName.split(' ')[0] || 'Valued', lastName: userName.split(' ').slice(1).join(' ') || 'Customer', email: userEmail };
        const pesapalOrderResponse = await pesapalService.registerOrder(token, pesapalOrderId, orderData.amount, orderData.currency, orderData.description, orderData.callbackUrlUsed, customerDetails, REGISTERED_IPN_ID);
        info(`[Order ${savedOrder._id}] Pesapal register response:`, pesapalOrderResponse);

        if (pesapalOrderResponse?.order_tracking_id) {
            savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
            await savedOrder.save();
            info(`[Order ${savedOrder._id}] Saved Pesapal Tracking ID.`);
        } else { warn(`[Order ${savedOrder._id}] Missing Pesapal tracking ID in response.`); }

        if (!pesapalOrderResponse?.redirect_url) {
             savedOrder.status = 'Payment Failed'; savedOrder.paymentStatus = 'FAILED'; savedOrder.errorMessage = 'No redirect URL from Pesapal.'; await savedOrder.save(); error(`[Order ${savedOrder._id}] CRITICAL: No redirect URL.`); throw new Error('Pesapal did not provide redirect URL.');
        }

        info(`[Order ${savedOrder._id}] Initiation successful. Returning redirect URL.`);
        res.status(200).json({ redirectUrl: pesapalOrderResponse.redirect_url, orderTrackingId: pesapalOrderResponse.order_tracking_id, orderId: savedOrder._id });

    } catch (err) {
        error(`❌ Order initiation error Ref ${pesapalOrderId}:`, err);
        if (savedOrder?.status === 'Pending Payment') { try { savedOrder.status = 'Payment Failed'; savedOrder.paymentStatus = 'FAILED'; savedOrder.errorMessage = `Init failed: ${err.message}`; await savedOrder.save(); info(`[Order ${savedOrder?._id}] Marked Failed.`); } catch (saveErr) { error(`[Order ${savedOrder?._id}] FAILED update status after error:`, saveErr); } }
        if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) });
        // Distinguish between supplier pre-check errors and payment errors
        const userMessage = err.message.includes('Service') || err.message.includes('Quantity') ? err.message : 'Payment initiation failed.';
        res.status(500).json({ message: userMessage, error: err.message }); // Send specific message if possible
    }
};

/** Handle Pesapal IPN */
export const handleIpn = async (req, res) => {
    const ipnBody = req.body || {}; const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || ''; const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || ''; const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || ''; // Our pesapalOrderId
    const ipnResponse = { orderNotificationType: notificationType, orderTrackingId: orderTrackingId, orderMerchantReference: merchantReference, status: 500 };
    info(`--- Received IPN --- Ref: ${merchantReference}, Tracking: ${orderTrackingId}, Type: ${notificationType}`); debug(`IPN Body:`, JSON.stringify(ipnBody, null, 2)); if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) { error(`[IPN Validation Error - Ref ${merchantReference}]`); return res.status(200).json(ipnResponse); }
    let order = null; let transactionStatusData = null;
    try {
        info(`[IPN Processing - Ref ${merchantReference}] Searching Order...`);
        order = await Order.findOne({ pesapalOrderId: merchantReference }); if (!order) { error(`[IPN Error - Ref ${merchantReference}] Not found.`); ipnResponse.status = 404; return res.status(200).json(ipnResponse); } info(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}. Status: ${order.status}`);
        info(`[IPN Processing - Order ${order._id}] Querying Pesapal Status ID: ${orderTrackingId}`); const token = await pesapalService.getOAuthToken(); transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId); info(`[IPN Processing - Order ${order._id}] Pesapal Status Resp:`, transactionStatusData); const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN'; const fetchedPesapalDesc = transactionStatusData?.description || '';
        let internalStatusUpdate = order.status; let shouldSaveChanges = false; let newErrorMessage = order.errorMessage;
        if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') { info(`[IPN - Order ${order._id}] Updating paymentStatus -> '${fetchedPesapalStatus}'`); order.paymentStatus = fetchedPesapalStatus; shouldSaveChanges = true; }
        if (order.status === 'Pending Payment' || order.status === 'Payment Failed') { switch (fetchedPesapalStatus) { case 'COMPLETED': info(`[IPN Update - Order ${order._id}] COMPLETED. Placing supplier order...`); internalStatusUpdate = await placeSupplierOrderAndUpdateStatus(order); newErrorMessage = (internalStatusUpdate === 'Supplier Error') ? order.supplierStatus : null; shouldSaveChanges = true; info(`[IPN Update - Order ${order._id}] Supplier result: '${internalStatusUpdate}'.`); break; case 'FAILED': internalStatusUpdate = 'Payment Failed'; newErrorMessage = fetchedPesapalDesc || 'Payment Failed (IPN)'; shouldSaveChanges = true; info(`[IPN Update - Order ${order._id}] FAILED.`); break; case 'INVALID': case 'REVERSED': internalStatusUpdate = 'Cancelled'; newErrorMessage = `Payment ${fetchedPesapalStatus}. ${fetchedPesapalDesc || ''}`.trim(); shouldSaveChanges = true; info(`[IPN Update - Order ${order._id}] ${fetchedPesapalStatus} -> Cancelled.`); break; case 'PENDING': info(`[IPN Info - Order ${order._id}] PENDING.`); break; default: warn(`[IPN Info - Order ${order._id}] Unhandled status: '${fetchedPesapalStatus}'.`); } if (order.status !== internalStatusUpdate) { order.status = internalStatusUpdate; order.errorMessage = newErrorMessage; info(`[IPN Update - Order ${order._id}] Internal status -> '${order.status}'.`); } } else { info(`[IPN Info - Order ${order._id}] Status '${order.status}' not modified.`); }
        if (shouldSaveChanges) { info(`[IPN Processing - Order ${order._id}] Saving...`); await order.save(); info(`[IPN Processed - Order ${order._id}] Save OK. Status: ${order.status}`); ipnResponse.status = 200; } else { info(`[IPN Info - Order ${order._id}] No DB changes.`); ipnResponse.status = 200; }
        info(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`); res.status(200).json(ipnResponse);
    } catch (err) { error(`❌ IPN Error Ref ${merchantReference}:`, err); ipnResponse.status = 500; res.status(200).json(ipnResponse); }
};

/** Get Order Stats (User) */
export const getOrderStats = async (req, res) => {
   info("[getOrderStats] Function called."); try { const userId = req.user?._id; info(`[getOrderStats] User ID: ${userId}`); if (!userId) { error("[getOrderStats] User ID not found."); return res.status(401).json({ message: 'Unauthorized.' }); } info(`[getOrderStats] Querying counts user ${userId}`); const [pendingCount, activeCount, completedCount] = await Promise.all([ Order.countDocuments({ userId: userId, status: { $in: ['Pending Payment', 'Payment Failed']} }), Order.countDocuments({ userId: userId, status: { $in: ['Processing', 'In Progress', 'Partial', 'Supplier Error']} }), Order.countDocuments({ userId: userId, status: 'Completed' }) ]); info(`[getOrderStats] Counts: P=${pendingCount}, A=${activeCount}, C=${completedCount}`); res.status(200).json({ pendingOrders: pendingCount, activeOrders: activeCount, completedOrders: completedCount }); } catch (err) { error(`❌ Error fetching stats user ${req.user?._id}:`, err); res.status(500).json({ message: 'Stats fetch failed', error: err.message }); }
};

/** Get User Orders (Paginated) */
export const getUserOrders = async (req, res) => {
    info("[getUserOrders] Function called."); try { const userId = req.user?._id; if (!userId) { return res.status(401).json({ message: 'Unauthorized.' }); } let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 10; if (page < 1) page = 1; if (limit < 1) limit = 1; if (limit > 100) limit = 100; const skip = (page - 1) * limit; info(`[getUserOrders] Fetching user ${userId}, P:${page}, L:${limit}`); const [orders, totalOrders] = await Promise.all([ Order.find({ userId: userId }).select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId -callbackUrlUsed -__v').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments({ userId: userId }) ]); info(`[getUserOrders] Found ${orders.length}/${totalOrders} orders.`); res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders }); } catch (err) { error(`❌ Error fetching orders user ${req.user?._id}:`, err); res.status(500).json({ message: 'Order fetch failed', error: err.message }); }
};

/** Get Single Order Details (User) */
export const getOrderDetails = async (req, res) => {
    info("[getOrderDetails] Function called."); try { const userId = req.user?._id; const orderId = req.params.id; if (!userId) { return res.status(401).json({ message: 'Unauthorized.' }); } if (!mongoose.Types.ObjectId.isValid(orderId)) { info(`[getOrderDetails] Invalid ID: ${orderId}`); return res.status(400).json({ message: 'Invalid Order ID.' }); } info(`[getOrderDetails] Fetching order ${orderId} for user ${userId}`); const order = await Order.findOne({ _id: orderId, userId: userId }).select('-userId -__v'); if (!order) { info(`[getOrderDetails] Order ${orderId} not found/denied user ${userId}.`); return res.status(404).json({ message: 'Order not found/access denied.' }); } info(`[getOrderDetails] Success for Order ID ${orderId}`); res.status(200).json(order); } catch (err) { error(`❌ Error fetching details order ${req.params.id}, User ${req.user?._id}:`, err); res.status(500).json({ message: 'Details fetch failed', error: err.message }); }
};

/** Get Order Status by Merchant Reference (Callback Page) */
export const getOrderStatusByReference = async (req, res) => {
    info("[getOrderStatusByReference] Function called."); try { const { merchantRef } = req.params; info(`[getOrderStatusByReference] Ref: ${merchantRef}`); if (!merchantRef) { error("[getOrderStatusByReference] Missing merchantRef."); return res.status(400).json({ message: 'Order reference required.' }); } const order = await Order.findOne({ pesapalOrderId: merchantRef }).select('status paymentStatus _id supplierStatus'); if (!order) { info(`[getOrderStatusByReference] Order not found Ref ${merchantRef}`); return res.status(404).json({ message: 'Order not found.' }); } info(`[getOrderStatusByReference] Success Ref ${merchantRef}: Status='${order.status}', Payment='${order.paymentStatus}'`); res.status(200).json({ status: order.status, paymentStatus: order.paymentStatus, orderId: order._id, supplierStatus: order.supplierStatus }); } catch (err) { error(`❌ Error fetching status ref ${req.params.merchantRef}:`, err); res.status(500).json({ message: 'Status fetch failed', error: err.message }); }
};

// --- ADMIN FUNCTIONS ---

/** Get All Orders (Admin) */
export const getAllOrdersAdmin = async (req, res) => {
    info(`[getAllOrdersAdmin] Admin: ${req.user?._id}`); try { const filter = {}; if (req.query.status) { const OrderStatusEnum = ['Pending Payment', 'Payment Failed', 'Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled', 'Refunded', 'Supplier Error', 'Expired']; const requestedStatus = req.query.status; if (typeof requestedStatus === 'string' && OrderStatusEnum.includes(requestedStatus)) { filter.status = requestedStatus; } else if (typeof requestedStatus === 'string') { warn(`[getAllOrdersAdmin] Invalid status filter: ${requestedStatus}`); return res.status(400).json({ message: `Invalid status: ${requestedStatus}` }); } } let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 25; if (page < 1) page = 1; if (limit < 1) limit = 10; if (limit > 100) limit = 100; const skip = (page - 1) * limit; info(`[getAllOrdersAdmin] Querying. Filter: ${JSON.stringify(filter)}, P:${page}, L:${limit}`); const [orders, totalOrders] = await Promise.all([ Order.find(filter).populate('userId', 'email name username').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter) ]); info(`[getAllOrdersAdmin] Found ${orders.length}/${totalOrders}.`); res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders }); } catch (err) { error(`❌ Error fetching all orders admin ${req.user?._id}:`, err); res.status(500).json({ message: 'Fetch orders failed', error: err.message }); }
};

/** Update Order Status (Admin) */
export const updateOrderStatusAdmin = async (req, res) => {
    const orderId = req.params.id; const adminUserId = req.user?._id; info(`[updateOrderStatusAdmin] Admin: ${adminUserId} Order: ${orderId}`); try { const { status } = req.body; const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled', 'Refunded', 'Supplier Error']; if (!status || !allowedAdminStatusUpdates.includes(status)) { error(`[updateOrderStatusAdmin] Invalid status '${status}'.`); return res.status(400).json({ message: `Invalid status. Allowed: ${allowedAdminStatusUpdates.join(', ')}` }); } if (!mongoose.Types.ObjectId.isValid(orderId)) { error(`[updateOrderStatusAdmin] Invalid ID format: ${orderId}`); return res.status(400).json({ message: 'Invalid ID format.' }); } const order = await Order.findById(orderId); if (!order) { info(`[updateOrderStatusAdmin] Order ${orderId} not found.`); return res.status(404).json({ message: 'Order not found.' }); } if (order.status === status) { info(`[updateOrderStatusAdmin] Order ${orderId} already status '${status}'.`); return res.status(200).json(order); } info(`[updateOrderStatusAdmin] Admin ${adminUserId} changing ${orderId} status ${order.status} -> ${status}.`); order.status = status; if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') { info(`[updateOrderStatusAdmin - ${orderId}] Aligning paymentStatus.`); order.paymentStatus = 'COMPLETED'; } if ((status === 'Processing' || status === 'Completed') && order.errorMessage) { info(`[updateOrderStatusAdmin - ${orderId}] Clearing error.`); order.errorMessage = null; } const updatedOrder = await order.save(); info(`[updateOrderStatusAdmin] Admin ${adminUserId} updated order ${orderId} -> ${status}.`); res.status(200).json(updatedOrder); } catch (err) { error(`❌ Error updating order ${orderId} admin ${adminUserId}:`, err); if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid ID format.' }); if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) }); res.status(500).json({ message: 'Update failed', error: err.message }); }
};