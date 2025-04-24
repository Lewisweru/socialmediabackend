// controllers/orderController.js (FULL CODE - Fixed userId Usage)

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
        // 1. Get ExoSupplier Service Details (ID, min, max, etc.) based on BASE service name + quality
        const serviceDetails = getExoSupplierServiceDetails(
            order.platform,
            order.service,
            order.quality // Pass quality for HQ/LQ mapping
        );
        if (!serviceDetails || !serviceDetails.id) {
            error(`[Supplier Order Error - ${order._id}] Failed to get ExoSupplier Service Details/ID for ${order.platform}/${order.service} (Quality: ${order.quality}). Check mapping.`);
            order.status = 'Supplier Error'; order.supplierStatus = 'Service ID/Details mapping failed';
            return 'Supplier Error'; // Indicate failure
        }
        const targetSupplierServiceId = serviceDetails.id; // The specific HQ or LQ ID
        info(`[Supplier Order - ${order._id}] Mapped to ExoSupplier Service ID: ${targetSupplierServiceId} for quality '${order.quality}'. Min: ${serviceDetails.min}, Max: ${serviceDetails.max}.`);

        // 2. Validate quantity against supplier limits BEFORE placing order
        if (order.quantity < serviceDetails.min || order.quantity > serviceDetails.max) {
             error(`[Supplier Order Error - ${order._id}] Quantity ${order.quantity} outside supplier limits (${serviceDetails.min}-${serviceDetails.max}) for Service ID ${targetSupplierServiceId}.`);
             order.status = 'Supplier Error'; order.supplierStatus = `Invalid quantity for supplier (Min: ${serviceDetails.min}, Max: ${serviceDetails.max})`;
             return 'Supplier Error'; // Indicate failure
        }

        // 3. Place the order with ExoSupplier API using the specific mapped ID
        info(`[Supplier Order - ${order._id}] Calling placeExoSupplierOrder with ID ${targetSupplierServiceId}...`);
        const supplierOrderId = await placeExoSupplierOrder(
            targetSupplierServiceId, // Use the mapped HQ or LQ ID
            order.accountLink,
            order.quantity
            // Add runs/interval here if your Order model stores them:
            // order.runs,
            // order.interval
        );

        // 4. Update internal order document (in memory - save happens in caller)
        order.supplierOrderId = supplierOrderId.toString();
        order.status = 'Processing';
        order.supplierStatus = 'Pending'; // Initial status from supplier
        order.errorMessage = null;
        info(`[Supplier Order Success - ${order._id}] Placed ExoSupplier order ${supplierOrderId}. Internal status set to Processing.`);
        return 'Processing'; // Indicate success

    } catch (supplierError) {
        // Catch errors from getExoSupplierServiceDetails or placeExoSupplierOrder
        error(`[Supplier Order Error - ${order._id}] Failed during ExoSupplier interaction: ${supplierError.message}`, supplierError);
        order.status = 'Supplier Error';
        order.supplierStatus = supplierError.message.substring(0, 100); // Store concise error
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
        const userMongoId = req.user?._id; // Use the MongoDB _id attached by 'protect' middleware
        const userEmail = req.user?.email;
        const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;

        // Basic Validation
        if (!userMongoId) { error("[Initiate Order] Missing User ID from authentication context."); return res.status(401).json({ message: 'Unauthorized. User session might be invalid.' }); }
        const parsedQuantity = parseInt(quantity, 10);
        if (!platform || !service || !quality || !accountLink || !parsedQuantity || parsedQuantity <= 0 || !callbackUrl) { error(`[Initiate Order] Missing params user ${userMongoId}`, req.body); return res.status(400).json({ message: 'Missing required order details.' }); }
        if (!REGISTERED_IPN_ID) { error("[Initiate Order] Server Misconfig - IPN ID not set."); return res.status(500).json({ message: 'Server configuration error [IPN].' }); }

        // Pre-check with Supplier Service Details (uses HQ/LQ mapping internally now)
        info(`[Initiate Order Pre-check] Getting details for ${platform}/${service} (Quality: ${quality})...`);
        const serviceDetailsCheck = getExoSupplierServiceDetails(platform, service, quality); // Pass quality
        if (!serviceDetailsCheck) {
             error(`[Initiate Order Pre-check] Invalid service/quality selected: ${platform}/${service}/${quality}.`);
             return res.status(400).json({ message: `Service '${service}' (Quality: ${quality}) for '${platform}' is unavailable.` });
        }
         if (parsedQuantity < serviceDetailsCheck.min || parsedQuantity > serviceDetailsCheck.max) {
              error(`[Initiate Order Pre-check] Quantity ${parsedQuantity} outside limits (${serviceDetailsCheck.min}-${serviceDetailsCheck.max}).`);
              return res.status(400).json({ message: `Quantity must be between ${serviceDetailsCheck.min} and ${serviceDetailsCheck.max}.` });
         }
        info(`[Initiate Order Pre-check] Service valid. Min: ${serviceDetailsCheck.min}, Max: ${serviceDetailsCheck.max}.`);

        // Calculate Price (Using YOUR internal pricing)
        const calculatedAmount = calculatePrice(platform, service, quality, parsedQuantity);
        if (calculatedAmount <= 0) { error(`[Initiate Order] Price calc failed or zero.`); return res.status(400).json({ message: 'Invalid calculated price.' }); }

        // Prepare and Save Order
        const orderDescription = `${parsedQuantity} ${quality} ${platform} ${service}`;
        const orderData = {
            pesapalOrderId,
            userId: userMongoId, // ** IMPORTANT: Store the MongoDB ObjectId here **
            platform: String(platform).toLowerCase(), service: String(service), quality: String(quality),
            accountLink: String(accountLink), quantity: parsedQuantity, amount: calculatedAmount,
            currency: String(currency), description: String(orderDescription).substring(0, 100),
            status: 'Pending Payment', paymentStatus: 'PENDING', callbackUrlUsed: String(callbackUrl)
        };
        info(`[Order Initiate - Ref ${pesapalOrderId}] Saving order with userId: ${userMongoId}...`);
        savedOrder = new Order(orderData);
        await savedOrder.save();
        info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created in DB.`);

        // Initiate Pesapal Payment
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
        // Attempt to mark order as failed if it exists but something went wrong
        if (savedOrder && !savedOrder.__v && savedOrder.status === 'Pending Payment') { try { savedOrder.status = 'Payment Failed'; savedOrder.paymentStatus = 'FAILED'; savedOrder.errorMessage = `Init failed: ${err.message}`; await savedOrder.save(); info(`[Order ${savedOrder?._id}] Marked Failed due to error.`); } catch (saveErr) { error(`[Order ${savedOrder?._id}] FAILED update status after initiation error:`, saveErr); } }
        // Handle specific errors
        if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) });
        // Return appropriate message if pre-check failed
        const userMessage = err.message.includes('Service') || err.message.includes('Quantity') ? err.message : 'Payment initiation failed.';
        res.status(500).json({ message: userMessage, error: err.message });
    }
};

/** Handle Pesapal IPN */
export const handleIpn = async (req, res) => {
    const ipnBody = req.body || {};
    const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
    const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
    const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || ''; // Our pesapalOrderId (UUID)
    // Prepare response structure EARLY, default to error
    const ipnResponse = {
        orderNotificationType: notificationType,
        orderTrackingId: orderTrackingId,
        orderMerchantReference: merchantReference,
        status: 500 // Default error - explicitly set to 200 on successful processing
    };

    // ---> LOG 1 <---
    info(`[handleIpn ENTRY] Ref: ${merchantReference}, Tracking: ${orderTrackingId}, Type: ${notificationType}`);
    debug(`[handleIpn BODY]`, JSON.stringify(ipnBody, null, 2));

    if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) {
        error(`[handleIpn Validation Error] Ref: ${merchantReference}, Invalid Data Received.`);
        return res.status(200).json(ipnResponse); // Respond 200 OK but JSON indicates internal error code
    }

    let order = null; let transactionStatusData = null;
    try {
        // ---> LOG 2 <---
        info(`[handleIpn - Ref ${merchantReference}] Searching Order in DB by pesapalOrderId...`);
        order = await Order.findOne({ pesapalOrderId: merchantReference });
        if (!order) {
             error(`[handleIpn Error - Ref ${merchantReference}] Order not found in DB.`);
             ipnResponse.status = 404; // Not found internal code
             return res.status(200).json(ipnResponse);
        }
         // ---> LOG 3 <---
        info(`[handleIpn - Ref ${merchantReference}] Found Order ${order._id}. Current Status: ${order.status}, Payment Status: ${order.paymentStatus}`);

        // ---> LOG 4 <---
        info(`[handleIpn - Order ${order._id}] Querying Pesapal Status (Tracking ID: ${orderTrackingId})...`);
        const token = await pesapalService.getOAuthToken();
        transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
         // ---> LOG 5 <---
        info(`[handleIpn - Order ${order._id}] Pesapal Status Response Received:`, transactionStatusData);
        const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
        const fetchedPesapalDesc = transactionStatusData?.description || ''; // Capture reason if available

        let internalStatusUpdate = order.status; // Start with current internal status
        let shouldSaveChanges = false; // Flag to track if DB update is needed
        let newErrorMessage = order.errorMessage; // Preserve existing error unless overwritten

         // ---> LOG 6 <---
        info(`[handleIpn - Order ${order._id}] Processing Pesapal Status Description: ${fetchedPesapalStatus}`);

        // --- Update stored Pesapal payment status ---
        if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') {
            info(`[handleIpn - Order ${order._id}] Updating DB paymentStatus from '${order.paymentStatus}' to '${fetchedPesapalStatus}'`);
            order.paymentStatus = fetchedPesapalStatus;
            shouldSaveChanges = true; // Mark that we need to save the order document
        }

        // --- Determine internal status changes ---
        // Only process if the order is still awaiting payment confirmation or failed previously
        if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
            switch (fetchedPesapalStatus) {
                case 'COMPLETED': // Pesapal status_code: 1
                     // ---> LOG 7 <---
                    info(`[handleIpn - Order ${order._id}] Pesapal COMPLETED. Calling placeSupplierOrderAndUpdateStatus...`);
                    internalStatusUpdate = await placeSupplierOrderAndUpdateStatus(order); // Attempt to place order with supplier
                     // ---> LOG 8 <---
                    info(`[handleIpn - Order ${order._id}] placeSupplierOrderAndUpdateStatus returned: ${internalStatusUpdate}`);
                    // Update error message based on supplier placement outcome
                    newErrorMessage = (internalStatusUpdate === 'Supplier Error') ? order.supplierStatus : null;
                    shouldSaveChanges = true; // Changes were made (status or potentially supplier fields)
                    break;
                case 'FAILED': // Pesapal status_code: 2
                    internalStatusUpdate = 'Payment Failed';
                    newErrorMessage = fetchedPesapalDesc || 'Payment Failed (reported by Pesapal IPN)';
                    shouldSaveChanges = true;
                    info(`[handleIpn - Order ${order._id}] FAILED. Setting Internal Status to 'Payment Failed'.`);
                    break;
                case 'INVALID': // Pesapal status_code: 0
                case 'REVERSED': // Pesapal status_code: 3
                    internalStatusUpdate = 'Cancelled'; // Map these to Cancelled in our system
                    newErrorMessage = `Payment status ${fetchedPesapalStatus}. ${fetchedPesapalDesc || ''}`.trim();
                    shouldSaveChanges = true;
                    info(`[handleIpn - Order ${order._id}] ${fetchedPesapalStatus}. Setting Internal Status to 'Cancelled'.`);
                    break;
                case 'PENDING':
                     // If Pesapal *still* reports pending, no change needed for our internal status yet.
                     info(`[handleIpn - Order ${order._id}] PENDING. Internal status remains '${order.status}'.`);
                     break;
                default: // Includes UNKNOWN or other unexpected values
                     warn(`[handleIpn - Order ${order._id}] Received unhandled fetched payment_status_description: '${fetchedPesapalStatus}'.`);
                     // Decide if this should trigger an error state or just be logged
                     // Maybe set to 'Supplier Error' or keep 'Pending Payment'?
                     // internalStatusUpdate = 'Supplier Error';
                     // newErrorMessage = `Unhandled Pesapal status: ${fetchedPesapalStatus}`;
                     // shouldSaveChanges = true;
            }
            // Apply the determined internal status update if it differs
            if (order.status !== internalStatusUpdate) {
                order.status = internalStatusUpdate;
                order.errorMessage = newErrorMessage; // Update error message too
                 // ---> LOG 9 <---
                info(`[handleIpn - Order ${order._id}] Internal status CHANGED to -> '${order.status}'.`);
                shouldSaveChanges = true; // Ensure save flag is set if internal status changes
            }
        } else {
            // Order is already Processing, Completed, etc. Log but don't change internal status based on IPN.
            info(`[handleIpn - Order ${order._id}] Internal status '${order.status}' not modified by IPN.`);
        }

        // Save changes if any were made
        if (shouldSaveChanges) {
            info(`[handleIpn - Order ${order._id}] Saving changes to DB...`);
            await order.save();
            info(`[handleIpn Processed - Order ${order._id}] Save successful. Final Status: ${order.status}, Payment: ${order.paymentStatus}`);
            ipnResponse.status = 200; // Indicate successful processing in JSON response
        } else {
            info(`[handleIpn - Order ${order._id}] No database changes required.`);
            ipnResponse.status = 200; // Mark successful processing (even if no-op)
        }

        // Acknowledge IPN Receipt to Pesapal using JSON
        info(`[handleIpn Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`);
        res.status(200).json(ipnResponse);

    } catch (err) {
        error(`❌ Unhandled Error processing IPN for MerchantRef ${merchantReference}:`, err);
        ipnResponse.status = 500; // Set error status in JSON response
        // As per Pesapal docs, still respond HTTP 200 but indicate error in JSON body
        res.status(200).json(ipnResponse);
    }
};

/** Get Order Stats (User) - CORRECTED */
export const getOrderStats = async (req, res) => {
   info("[getOrderStats] Function called.");
   try {
       const userMongoId = req.user?._id; // Use the MongoDB _id from req.user
       info(`[getOrderStats] User MongoDB ID from middleware: ${userMongoId}`);
       if (!userMongoId) {
           error("[getOrderStats] Error: MongoDB User ID (_id) not found on req.user.");
           return res.status(401).json({ message: 'Unauthorized: User session invalid or user data missing.' });
       }
       info(`[getOrderStats] Querying counts for userId (ObjectId): ${userMongoId}`);
       const [pendingCount, activeCount, completedCount] = await Promise.all([
           Order.countDocuments({ userId: userMongoId, status: { $in: ['Pending Payment', 'Payment Failed']} }),
           Order.countDocuments({ userId: userMongoId, status: { $in: ['Processing', 'In Progress', 'Partial', 'Supplier Error']} }),
           Order.countDocuments({ userId: userMongoId, status: 'Completed' })
       ]);
       info(`[getOrderStats] Counts for user ${userMongoId}: Pending=${pendingCount}, Active=${activeCount}, Completed=${completedCount}`);
       res.status(200).json({ pendingOrders: pendingCount, activeOrders: activeCount, completedOrders: completedCount });
   } catch (err) {
       error(`❌ Error fetching order stats for user ${req.user?._id}:`, err);
       if (err.name === 'CastError') { warn(`[getOrderStats] Unexpected CastError user ${req.user?._id}.`); return res.status(400).json({ message: 'Invalid user identifier format.' }); }
       res.status(500).json({ message: 'Stats fetch failed', error: err.message });
   }
};

/** Get User Orders (Paginated) - CORRECTED */
export const getUserOrders = async (req, res) => {
    info("[getUserOrders] Function called.");
    try {
        const userMongoId = req.user?._id; // Use MongoDB _id
        if (!userMongoId) { return res.status(401).json({ message: 'Unauthorized: User session invalid.' }); }
        let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 10; if (page < 1) page = 1; if (limit < 1) limit = 1; if (limit > 100) limit = 100; const skip = (page - 1) * limit;
        info(`[getUserOrders] Fetching orders for user MongoDB ID ${userMongoId}, P:${page}, L:${limit}`);
        const [orders, totalOrders] = await Promise.all([
            Order.find({ userId: userMongoId }) // Query with MongoDB _id
                 .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId -callbackUrlUsed -__v')
                 .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Order.countDocuments({ userId: userMongoId }) // Query with MongoDB _id
        ]);
        info(`[getUserOrders] Found ${orders.length}/${totalOrders} orders.`);
        res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders });
    } catch (err) {
         error(`❌ Error fetching orders user ${req.user?._id}:`, err);
         if (err.name === 'CastError') { warn(`[getUserOrders] Unexpected CastError user ${req.user?._id}.`); return res.status(400).json({ message: 'Invalid user identifier format.' }); }
         res.status(500).json({ message: 'Order fetch failed', error: err.message });
    }
};

/** Get Single Order Details (User) - CORRECTED */
export const getOrderDetails = async (req, res) => {
    info("[getOrderDetails] Function called.");
    try {
        const userMongoId = req.user?._id; // Use MongoDB _id
        const orderId = req.params.id; // Order's _id (ObjectId)
        if (!userMongoId) { return res.status(401).json({ message: 'Unauthorized.' }); }
        if (!mongoose.Types.ObjectId.isValid(orderId)) { info(`[getOrderDetails] Invalid Order ID: ${orderId}`); return res.status(400).json({ message: 'Invalid Order ID.' }); }
        info(`[getOrderDetails] Fetching order ${orderId} for user MongoDB ID ${userMongoId}`);
        const order = await Order.findOne({ _id: orderId, userId: userMongoId }).select('-userId -__v'); // Query with Order ObjectId and User ObjectId
        if (!order) { info(`[getOrderDetails] Order ${orderId} not found/denied user ${userMongoId}.`); return res.status(404).json({ message: 'Order not found or access denied.' }); }
        info(`[getOrderDetails] Success for Order ID ${orderId}`); res.status(200).json(order);
    } catch (err) {
        error(`❌ Error fetching details order ${req.params.id}, User ${req.user?._id}:`, err);
         if (err.name === 'CastError') { warn(`[getOrderDetails] Unexpected CastError.`); return res.status(400).json({ message: 'Invalid identifier format.' }); }
        res.status(500).json({ message: 'Details fetch failed', error: err.message });
    }
};

/** Get Order Status by Merchant Reference (Callback Page) */
export const getOrderStatusByReference = async (req, res) => {
    info("[getOrderStatusByReference] Function called."); try { const { merchantRef } = req.params; info(`[getOrderStatusByReference] Ref: ${merchantRef}`); if (!merchantRef) { error("[getOrderStatusByReference] Missing merchantRef."); return res.status(400).json({ message: 'Order reference required.' }); } const order = await Order.findOne({ pesapalOrderId: merchantRef }).select('status paymentStatus _id supplierStatus'); if (!order) { info(`[getOrderStatusByReference] Order not found Ref ${merchantRef}`); return res.status(404).json({ message: 'Order not found.' }); } info(`[getOrderStatusByReference] Success Ref ${merchantRef}: Status='${order.status}', Payment='${order.paymentStatus}'`); res.status(200).json({ status: order.status, paymentStatus: order.paymentStatus, orderId: order._id, supplierStatus: order.supplierStatus }); } catch (err) { error(`❌ Error fetching status ref ${req.params.merchantRef}:`, err); res.status(500).json({ message: 'Status fetch failed', error: err.message }); }
};

// --- ADMIN FUNCTIONS ---

/** Get All Orders (Admin) */
export const getAllOrdersAdmin = async (req, res) => {
    info(`[getAllOrdersAdmin] Admin: ${req.user?._id}`); try { const filter = {}; if (req.query.status) { const OrderStatusEnum = ['Pending Payment', 'Payment Failed', 'Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled', 'Refunded', 'Supplier Error', 'Expired']; const requestedStatus = req.query.status; if (typeof requestedStatus === 'string' && OrderStatusEnum.includes(requestedStatus)) { filter.status = requestedStatus; } else if (typeof requestedStatus === 'string') { warn(`[getAllOrdersAdmin] Invalid status filter: ${requestedStatus}`); return res.status(400).json({ message: `Invalid status: ${requestedStatus}` }); } } let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 25; if (page < 1) page = 1; if (limit < 1) limit = 10; if (limit > 100) limit = 100; const skip = (page - 1) * limit; info(`[getAllOrdersAdmin] Querying. Filter: ${JSON.stringify(filter)}, P:${page}, L:${limit}`); const [orders, totalOrders] = await Promise.all([ Order.find(filter).populate('userId', 'email name username firebaseUid').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter) ]); info(`[getAllOrdersAdmin] Found ${orders.length}/${totalOrders}.`); res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders }); } catch (err) { error(`❌ Error fetching all orders admin ${req.user?._id}:`, err); res.status(500).json({ message: 'Fetch orders failed', error: err.message }); }
};

/** Update Order Status (Admin) */
export const updateOrderStatusAdmin = async (req, res) => {
    const orderId = req.params.id; const adminUserId = req.user?._id; info(`[updateOrderStatusAdmin] Admin: ${adminUserId} Order: ${orderId}`); try { const { status } = req.body; const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled', 'Refunded', 'Supplier Error']; if (!status || !allowedAdminStatusUpdates.includes(status)) { error(`[updateOrderStatusAdmin] Invalid status '${status}'.`); return res.status(400).json({ message: `Invalid status. Allowed: ${allowedAdminStatusUpdates.join(', ')}` }); } if (!mongoose.Types.ObjectId.isValid(orderId)) { error(`[updateOrderStatusAdmin] Invalid ID format: ${orderId}`); return res.status(400).json({ message: 'Invalid ID format.' }); } const order = await Order.findById(orderId); if (!order) { info(`[updateOrderStatusAdmin] Order ${orderId} not found.`); return res.status(404).json({ message: 'Order not found.' }); } if (order.status === status) { info(`[updateOrderStatusAdmin] Order ${orderId} already status '${status}'.`); return res.status(200).json(order); } info(`[updateOrderStatusAdmin] Admin ${adminUserId} changing ${orderId} status ${order.status} -> ${status}.`); order.status = status; if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') { info(`[updateOrderStatusAdmin - ${orderId}] Aligning paymentStatus.`); order.paymentStatus = 'COMPLETED'; } if ((status === 'Processing' || status === 'Completed') && order.errorMessage) { info(`[updateOrderStatusAdmin - ${orderId}] Clearing error.`); order.errorMessage = null; } const updatedOrder = await order.save(); info(`[updateOrderStatusAdmin] Admin ${adminUserId} updated order ${orderId} -> ${status}.`); res.status(200).json(updatedOrder); } catch (err) { error(`❌ Error updating order ${orderId} admin ${adminUserId}:`, err); if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid ID format.' }); if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) }); res.status(500).json({ message: 'Update failed', error: err.message }); }
};