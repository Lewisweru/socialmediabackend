// controllers/orderController.js (Complete Code - Verify Exports)

import Order from '../models/Order.js';
import User from '../models/User.js';
// NOTE: Import the CLASS from the service, not the router
import { PesapalService } from '../services/pesapal.js';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { info, warn, error, debug } from '../utils/logger.js';
import { calculatePrice } from '../utils/pricing.js';
import { getJeskieServiceId, placeJeskieOrder } from '../services/jeskieService.js';
import config from '../config.js';

// --- Pesapal Service Initialization ---
if (!config.pesapal.consumerKey || !config.pesapal.consumerSecret) {
  error("FATAL ERROR: Pesapal consumer key and secret must be defined.");
  process.exit(1);
}
const pesapalService = new PesapalService(
  config.pesapal.consumerKey,
  config.pesapal.consumerSecret,
  config.server.nodeEnv !== 'production'
);
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID;
if (!REGISTERED_IPN_ID) {
    warn("Warning: PESAPAL_IPN_ID environment variable not set.");
}
// --- Helper Function to Place Supplier Order ---
async function placeSupplierOrderAndUpdateStatus(order) {
    if (order.status !== 'Pending Payment' && order.status !== 'Payment Failed') {
        warn(`placeSupplierOrderAndUpdateStatus skipped for order ${order._id}, status: ${order.status}.`);
        return order.status;
    }
     if (order.supplierOrderId) {
         warn(`placeSupplierOrderAndUpdateStatus skipped for order ${order._id}, supplierOrderId already exists.`);
         if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
             order.status = 'Processing'; return 'Processing';
         } return order.status;
     }
    info(`[Supplier Order] Placing order for ${order._id}...`);
    try {
        const serviceId = getJeskieServiceId(order.platform, order.service);
        if (!serviceId) {
            error(`[Supplier Order Error - ${order._id}] Mapping failed.`);
            order.status = 'Supplier Error'; order.supplierStatus = 'Service ID mapping failed'; return 'Supplier Error';
        } info(`[Supplier Order - ${order._id}] Mapped to Jeskie ID: ${serviceId}.`);
        const supplierOrderId = await placeJeskieOrder(order.accountLink, order.quantity, serviceId);
        order.supplierOrderId = supplierOrderId.toString(); order.status = 'Processing'; order.supplierStatus = 'Pending';
        info(`[Supplier Order Success - ${order._id}] Placed Jeskie order ${supplierOrderId}.`);
        return 'Processing';
    } catch (supplierError) {
        error(`[Supplier Order Error - ${order._id}] Failed: ${supplierError.message}`, supplierError);
        order.status = 'Supplier Error'; order.supplierStatus = supplierError.message.substring(0, 97) + '...';
        return 'Supplier Error';
    }
}
// --- End Helper Function ---

// --- Controller Functions ---

// Export with the name 'initiateOrderAndPayment'
export const initiateOrderAndPayment = async (req, res) => {
    let savedOrder = null; const pesapalOrderId = uuidv4();
    try {
        const { platform, service, quality, accountLink, quantity, currency = 'KES', callbackUrl } = req.body;
        const userId = req.user?._id; const userEmail = req.user?.email; const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;
        if (!userId) { error("[Initiate Order] Missing User ID."); return res.status(401).json({ message: 'Unauthorized.' }); }
        const parsedQuantity = parseInt(quantity, 10);
        if (!platform || !service || !quality || !accountLink || !parsedQuantity || parsedQuantity <= 0 || !callbackUrl) { error(`[Initiate Order] Missing params user ${userId}`, req.body); return res.status(400).json({ message: 'Missing details.' }); }
        if (!REGISTERED_IPN_ID) { error("[Initiate Order] Server Misconfig - IPN ID"); return res.status(500).json({ message: 'Server config error [IPN].' }); }
        const calculatedAmount = calculatePrice(platform, service, quality, parsedQuantity);
        if (calculatedAmount <= 0) { error(`[Initiate Order] Price calc failed.`); return res.status(400).json({ message: 'Price error.' }); }
        const orderDescription = `${parsedQuantity} ${quality} ${platform} ${service}`;
        const orderData = { pesapalOrderId, userId: String(userId), platform: String(platform).toLowerCase(), service: String(service), quality: String(quality), accountLink: String(accountLink), quantity: parsedQuantity, amount: calculatedAmount, currency: String(currency), description: String(orderDescription).substring(0, 100), status: 'Pending Payment', paymentStatus: 'PENDING', callbackUrlUsed: String(callbackUrl) };
        info(`[Order Initiate - Ref ${pesapalOrderId}] Saving...`); savedOrder = new Order(orderData); await savedOrder.save(); info(`[Order ${savedOrder._id}] Created.`);
        info(`[Order ${savedOrder._id}] Getting Pesapal token...`); const token = await pesapalService.getOAuthToken(); info(`[Order ${savedOrder._id}] Registering Pesapal order...`);
        const customerDetails = { firstName: userName.split(' ')[0] || 'Valued', lastName: userName.split(' ').slice(1).join(' ') || 'Customer', email: userEmail };
        const pesapalOrderResponse = await pesapalService.registerOrder(token, pesapalOrderId, orderData.amount, orderData.currency, orderData.description, orderData.callbackUrlUsed, customerDetails, REGISTERED_IPN_ID);
        info(`[Order ${savedOrder._id}] Pesapal response:`, pesapalOrderResponse);
        if (pesapalOrderResponse?.order_tracking_id) { savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id; await savedOrder.save(); info(`[Order ${savedOrder._id}] Saved Tracking ID.`); } else { warn(`[Order ${savedOrder._id}] Missing Pesapal tracking ID.`); }
        if (!pesapalOrderResponse?.redirect_url) { savedOrder.status = 'Payment Failed'; savedOrder.paymentStatus = 'FAILED'; savedOrder.errorMessage = 'No redirect URL.'; await savedOrder.save(); error(`[Order ${savedOrder._id}] CRITICAL: No redirect URL.`); throw new Error('No redirect URL.'); }
        info(`[Order ${savedOrder._id}] Success. Returning redirect.`); res.status(200).json({ redirectUrl: pesapalOrderResponse.redirect_url, orderTrackingId: pesapalOrderResponse.order_tracking_id, orderId: savedOrder._id });
    } catch (err) { error(`❌ Order initiation error Ref ${pesapalOrderId}:`, err); if (savedOrder?.status === 'Pending Payment') { try { savedOrder.status = 'Payment Failed'; savedOrder.paymentStatus = 'FAILED'; savedOrder.errorMessage = `Init failed: ${err.message}`; await savedOrder.save(); info(`[Order ${savedOrder?._id}] Marked Failed.`); } catch (saveErr) { error(`[Order ${savedOrder?._id}] FAILED update status after error:`, saveErr); } } if (err.name === 'ValidationError') { return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) }); } res.status(500).json({ message: 'Payment initiation failed.', error: err.message }); }
};

// Export with the name 'handleIpn'
export const handleIpn = async (req, res) => {
    const ipnBody = req.body || {}; const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || ''; const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || ''; const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || '';
    const ipnResponse = { orderNotificationType: notificationType, orderTrackingId: orderTrackingId, orderMerchantReference: merchantReference, status: 500 }; info(`--- Received IPN --- Ref: ${merchantReference}`); debug(`IPN Body:`, JSON.stringify(ipnBody, null, 2)); if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) { error(`[IPN Validation Error - Ref ${merchantReference}]`); return res.status(200).json(ipnResponse); }
    let order = null; let transactionStatusData = null;
    try { info(`[IPN Processing - Ref ${merchantReference}] Searching...`); order = await Order.findOne({ pesapalOrderId: merchantReference }); if (!order) { error(`[IPN Error - Ref ${merchantReference}] Not found.`); ipnResponse.status = 404; return res.status(200).json(ipnResponse); } info(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}.`); info(`[IPN Processing - Order ${order._id}] Querying Pesapal...`); const token = await pesapalService.getOAuthToken(); transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId); info(`[IPN Processing - Order ${order._id}] Pesapal status:`, transactionStatusData); const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN'; const fetchedPesapalDesc = transactionStatusData?.description || ''; let internalStatusUpdate = order.status; let shouldSaveChanges = false; let newErrorMessage = order.errorMessage;
        if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') { info(`[IPN - Order ${order._id}] Updating paymentStatus to '${fetchedPesapalStatus}'`); order.paymentStatus = fetchedPesapalStatus; shouldSaveChanges = true; }
        if (order.status === 'Pending Payment' || order.status === 'Payment Failed') { switch (fetchedPesapalStatus) { case 'COMPLETED': info(`[IPN Update - Order ${order._id}] COMPLETED. Placing supplier order...`); internalStatusUpdate = await placeSupplierOrderAndUpdateStatus(order); newErrorMessage = (internalStatusUpdate === 'Supplier Error') ? order.supplierStatus : null; shouldSaveChanges = true; info(`[IPN Update - Order ${order._id}] Supplier result: '${internalStatusUpdate}'.`); break; case 'FAILED': internalStatusUpdate = 'Payment Failed'; newErrorMessage = fetchedPesapalDesc || 'Payment Failed (IPN)'; shouldSaveChanges = true; info(`[IPN Update - Order ${order._id}] FAILED.`); break; case 'INVALID': case 'REVERSED': internalStatusUpdate = 'Cancelled'; newErrorMessage = `Payment ${fetchedPesapalStatus}. ${fetchedPesapalDesc || ''}`.trim(); shouldSaveChanges = true; info(`[IPN Update - Order ${order._id}] ${fetchedPesapalStatus} -> Cancelled.`); break; case 'PENDING': info(`[IPN Info - Order ${order._id}] PENDING.`); break; default: warn(`[IPN Info - Order ${order._id}] Unhandled status: '${fetchedPesapalStatus}'.`); } if (order.status !== internalStatusUpdate) { order.status = internalStatusUpdate; order.errorMessage = newErrorMessage; info(`[IPN Update - Order ${order._id}] Internal status -> '${order.status}'.`); } } else { info(`[IPN Info - Order ${order._id}] Status '${order.status}' not modified.`); }
        if (shouldSaveChanges) { info(`[IPN Processing - Order ${order._id}] Saving...`); await order.save(); info(`[IPN Processed - Order ${order._id}] Save OK.`); ipnResponse.status = 200; } else { info(`[IPN Info - Order ${order._id}] No DB changes.`); ipnResponse.status = 200; }
        info(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`); res.status(200).json(ipnResponse);
    } catch (err) { error(`❌ IPN Error Ref ${merchantReference}:`, err); ipnResponse.status = 500; res.status(200).json(ipnResponse); }
};

// Export with the name 'getOrderStats'
export const getOrderStats = async (req, res) => {
    info("[getOrderStats] Function called.");
   try { const userId = req.user?._id; info(`[getOrderStats] User ID: ${userId}`); if (!userId) { error("[getOrderStats] User ID not found."); return res.status(401).json({ message: 'Unauthorized.' }); } info(`[getOrderStats] Querying counts for userId: ${userId}`); const [pendingCount, activeCount, completedCount] = await Promise.all([ Order.countDocuments({ userId: userId, status: { $in: ['Pending Payment', 'Payment Failed']} }), Order.countDocuments({ userId: userId, status: { $in: ['Processing', 'In Progress', 'Partial', 'Supplier Error']} }), Order.countDocuments({ userId: userId, status: 'Completed' }) ]); info(`[getOrderStats] Counts: P=${pendingCount}, A=${activeCount}, C=${completedCount}`); res.status(200).json({ pendingOrders: pendingCount, activeOrders: activeCount, completedOrders: completedCount }); } catch (err) { error(`❌ Error fetching order stats user ${req.user?._id}:`, err); res.status(500).json({ message: 'Stats fetch failed', error: err.message }); }
};

// Export with the name 'getUserOrders'
export const getUserOrders = async (req, res) => {
    info("[getUserOrders] Function called.");
    try { const userId = req.user?._id; if (!userId) { return res.status(401).json({ message: 'Unauthorized.' }); } let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 10; if (page < 1) page = 1; if (limit < 1) limit = 1; if (limit > 100) limit = 100; const skip = (page - 1) * limit; info(`[getUserOrders] Fetching user ${userId}, P:${page}, L:${limit}`); const [orders, totalOrders] = await Promise.all([ Order.find({ userId: userId }).select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId -callbackUrlUsed -__v').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments({ userId: userId }) ]); info(`[getUserOrders] Found ${orders.length}/${totalOrders} orders.`); res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders }); } catch (err) { error(`❌ Error fetching orders user ${req.user?._id}:`, err); res.status(500).json({ message: 'Order fetch failed', error: err.message }); }
};

// Export with the name 'getOrderDetails'
export const getOrderDetails = async (req, res) => {
    info("[getOrderDetails] Function called.");
    try { const userId = req.user?._id; const orderId = req.params.id; if (!userId) { return res.status(401).json({ message: 'Unauthorized.' }); } if (!mongoose.Types.ObjectId.isValid(orderId)) { info(`[getOrderDetails] Invalid ID: ${orderId}`); return res.status(400).json({ message: 'Invalid Order ID.' }); } info(`[getOrderDetails] Fetching order ${orderId} for user ${userId}`); const order = await Order.findOne({ _id: orderId, userId: userId }).select('-userId -__v'); if (!order) { info(`[getOrderDetails] Order ${orderId} not found/denied user ${userId}.`); return res.status(404).json({ message: 'Order not found/access denied.' }); } info(`[getOrderDetails] Success for Order ID ${orderId}`); res.status(200).json(order); } catch (err) { error(`❌ Error fetching details order ${req.params.id}, User ${req.user?._id}:`, err); res.status(500).json({ message: 'Details fetch failed', error: err.message }); }
};

// Export with the name 'getOrderStatusByReference'
export const getOrderStatusByReference = async (req, res) => {
    info("[getOrderStatusByReference] Function called.");
    try { const { merchantRef } = req.params; info(`[getOrderStatusByReference] Ref: ${merchantRef}`); if (!merchantRef) { error("[getOrderStatusByReference] Missing merchantRef."); return res.status(400).json({ message: 'Order reference required.' }); } const order = await Order.findOne({ pesapalOrderId: merchantRef }).select('status paymentStatus _id supplierStatus'); if (!order) { info(`[getOrderStatusByReference] Order not found Ref ${merchantRef}`); return res.status(404).json({ message: 'Order not found.' }); } info(`[getOrderStatusByReference] Success Ref ${merchantRef}: Status='${order.status}', Payment='${order.paymentStatus}'`); res.status(200).json({ status: order.status, paymentStatus: order.paymentStatus, orderId: order._id, supplierStatus: order.supplierStatus }); } catch (err) { error(`❌ Error fetching status ref ${req.params.merchantRef}:`, err); res.status(500).json({ message: 'Status fetch failed', error: err.message }); }
};

// Export with the name 'getAllOrdersAdmin'
export const getAllOrdersAdmin = async (req, res) => {
    info(`[getAllOrdersAdmin] Admin: ${req.user?._id}`); try { const filter = {}; if (req.query.status) { const OrderStatusEnum = ['Pending Payment', 'Payment Failed', 'Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled', 'Refunded', 'Supplier Error', 'Expired']; const requestedStatus = req.query.status; if (typeof requestedStatus === 'string' && OrderStatusEnum.includes(requestedStatus)) { filter.status = requestedStatus; } else if (typeof requestedStatus === 'string') { warn(`[getAllOrdersAdmin] Invalid status filter: ${requestedStatus}`); return res.status(400).json({ message: `Invalid status: ${requestedStatus}` }); } } let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 25; if (page < 1) page = 1; if (limit < 1) limit = 10; if (limit > 100) limit = 100; const skip = (page - 1) * limit; info(`[getAllOrdersAdmin] Querying. Filter: ${JSON.stringify(filter)}, P:${page}, L:${limit}`); const [orders, totalOrders] = await Promise.all([ Order.find(filter).populate('userId', 'email name username').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter) ]); info(`[getAllOrdersAdmin] Found ${orders.length}/${totalOrders}.`); res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders }); } catch (err) { error(`❌ Error fetching all orders admin ${req.user?._id}:`, err); res.status(500).json({ message: 'Fetch orders failed', error: err.message }); }
};

// Export with the name 'updateOrderStatusAdmin'
export const updateOrderStatusAdmin = async (req, res) => {
    const orderId = req.params.id; const adminUserId = req.user?._id; info(`[updateOrderStatusAdmin] Admin: ${adminUserId} Order: ${orderId}`); try { const { status } = req.body; const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled', 'Refunded', 'Supplier Error']; if (!status || !allowedAdminStatusUpdates.includes(status)) { error(`[updateOrderStatusAdmin] Invalid status '${status}'.`); return res.status(400).json({ message: `Invalid status. Allowed: ${allowedAdminStatusUpdates.join(', ')}` }); } if (!mongoose.Types.ObjectId.isValid(orderId)) { error(`[updateOrderStatusAdmin] Invalid ID format: ${orderId}`); return res.status(400).json({ message: 'Invalid ID format.' }); } const order = await Order.findById(orderId); if (!order) { info(`[updateOrderStatusAdmin] Order ${orderId} not found.`); return res.status(404).json({ message: 'Order not found.' }); } if (order.status === status) { info(`[updateOrderStatusAdmin] Order ${orderId} already status '${status}'.`); return res.status(200).json(order); } info(`[updateOrderStatusAdmin] Admin ${adminUserId} changing ${orderId} status ${order.status} -> ${status}.`); order.status = status; if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') { info(`[updateOrderStatusAdmin - ${orderId}] Aligning paymentStatus.`); order.paymentStatus = 'COMPLETED'; } if ((status === 'Processing' || status === 'Completed') && order.errorMessage) { info(`[updateOrderStatusAdmin - ${orderId}] Clearing error.`); order.errorMessage = null; } const updatedOrder = await order.save(); info(`[updateOrderStatusAdmin] Admin ${adminUserId} updated order ${orderId} -> ${status}.`); res.status(200).json(updatedOrder); } catch (err) { error(`❌ Error updating order ${orderId} admin ${adminUserId}:`, err); if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid ID format.' }); if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) }); res.status(500).json({ message: 'Update failed', error: err.message }); }
};