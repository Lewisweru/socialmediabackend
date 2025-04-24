// controllers/orderController.js (FULL CODE - Fixed userId CastError)

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
        if (!userMongoId) { error("[Initiate Order] Missing User ID."); return res.status(401).json({ message: 'Unauthorized.' }); }
        const parsedQuantity = parseInt(quantity, 10);
        if (!platform || !service || !quality || !accountLink || !parsedQuantity || parsedQuantity <= 0 || !callbackUrl) { error(`[Initiate Order] Missing params user ${userMongoId}`, req.body); return res.status(400).json({ message: 'Missing details.' }); }
        if (!REGISTERED_IPN_ID) { error("[Initiate Order] Server Misconfig - IPN ID"); return res.status(500).json({ message: 'Server config error [IPN].' }); }

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
        if (calculatedAmount <= 0) { error(`[Initiate Order] Price calc failed.`); return res.status(400).json({ message: 'Price error.' }); }

        // Prepare and Save Order
        const orderDescription = `${parsedQuantity} ${quality} ${platform} ${service}`;
        const orderData = {
            pesapalOrderId,
            userId: userMongoId, // Store the MongoDB ObjectId
            platform: String(platform).toLowerCase(), service: String(service), quality: String(quality),
            accountLink: String(accountLink), quantity: parsedQuantity, amount: calculatedAmount,
            currency: String(currency), description: String(orderDescription).substring(0, 100),
            status: 'Pending Payment', paymentStatus: 'PENDING', callbackUrlUsed: String(callbackUrl)
        };
        info(`[Order Initiate - Ref ${pesapalOrderId}] Saving order...`);
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
        if (savedOrder?.status === 'Pending Payment') { try { savedOrder.status = 'Payment Failed'; savedOrder.paymentStatus = 'FAILED'; savedOrder.errorMessage = `Init failed: ${err.message}`; await savedOrder.save(); info(`[Order ${savedOrder?._id}] Marked Failed.`); } catch (saveErr) { error(`[Order ${savedOrder?._id}] FAILED update status after error:`, saveErr); } }
        if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) });
        const userMessage = err.message.includes('Service') || err.message.includes('Quantity') ? err.message : 'Payment initiation failed.';
        res.status(500).json({ message: userMessage, error: err.message });
    }
};

/** Handle Pesapal IPN */
// controllers/orderController.js

export const handleIpn = async (req, res) => {
    const ipnBody = req.body || {};
    const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
    const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
    const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || ''; // Our pesapalOrderId
    const ipnResponse = { /* ... default response ... */ };

    // ---> ADD LOG 1 <---
    info(`[handleIpn ENTRY] Ref: ${merchantReference}, Tracking: ${orderTrackingId}, Type: ${notificationType}`);
    debug(`[handleIpn BODY]`, JSON.stringify(ipnBody, null, 2));

    if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) {
        error(`[handleIpn Validation Error] Ref: ${merchantReference}`);
        return res.status(200).json(ipnResponse);
    }

    let order = null; let transactionStatusData = null;
    try {
        // ---> ADD LOG 2 <---
        info(`[handleIpn - Ref ${merchantReference}] Searching Order in DB...`);
        order = await Order.findOne({ pesapalOrderId: merchantReference });
        if (!order) { /* ... handle not found ... */ }
         // ---> ADD LOG 3 <---
        info(`[handleIpn - Ref ${merchantReference}] Found Order ${order._id}. Current Status: ${order.status}, Payment Status: ${order.paymentStatus}`);

        // ---> ADD LOG 4 <---
        info(`[handleIpn - Order ${order._id}] Querying Pesapal Status (Tracking ID: ${orderTrackingId})...`);
        const token = await pesapalService.getOAuthToken();
        transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
         // ---> ADD LOG 5 <---
        info(`[handleIpn - Order ${order._id}] Pesapal Status Response Received:`, transactionStatusData);
        const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';

        let internalStatusUpdate = order.status; let shouldSaveChanges = false; let newErrorMessage = order.errorMessage;
         // ---> ADD LOG 6 <---
        info(`[handleIpn - Order ${order._id}] Processing Pesapal Status: ${fetchedPesapalStatus}`);

        // --- Update stored Pesapal payment status ---
        if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') { info(`[handleIpn - Order ${order._id}] Updating DB paymentStatus -> '${fetchedPesapalStatus}'`); order.paymentStatus = fetchedPesapalStatus; shouldSaveChanges = true; }

        // --- Determine internal status changes ---
        if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
            switch (fetchedPesapalStatus) {
                case 'COMPLETED':
                     // ---> ADD LOG 7 <---
                    info(`[handleIpn - Order ${order._id}] Pesapal COMPLETED. Calling placeSupplierOrderAndUpdateStatus...`);
                    internalStatusUpdate = await placeSupplierOrderAndUpdateStatus(order); // This helper has its own logs now
                     // ---> ADD LOG 8 <---
                    info(`[handleIpn - Order ${order._id}] placeSupplierOrderAndUpdateStatus returned: ${internalStatusUpdate}`);
                    newErrorMessage = (internalStatusUpdate === 'Supplier Error') ? order.supplierStatus : null;
                    shouldSaveChanges = true;
                    break;
                // ... other cases ...
                case 'FAILED': internalStatusUpdate = 'Payment Failed'; /*...*/ info(`[handleIpn - Order ${order._id}] FAILED.`); shouldSaveChanges = true; break;
                case 'INVALID': case 'REVERSED': internalStatusUpdate = 'Cancelled'; /*...*/ info(`[handleIpn - Order ${order._id}] -> Cancelled.`); shouldSaveChanges = true; break;
                case 'PENDING': info(`[handleIpn - Order ${order._id}] PENDING.`); break;
                default: warn(`[handleIpn - Order ${order._id}] Unhandled status: '${fetchedPesapalStatus}'.`);
            }
            if (order.status !== internalStatusUpdate) {
                order.status = internalStatusUpdate; order.errorMessage = newErrorMessage;
                // ---> ADD LOG 9 <---
                info(`[handleIpn - Order ${order._id}] Internal status CHANGED to -> '${order.status}'.`);
                shouldSaveChanges = true; // Ensure flag is set
            }
        } else { info(`[handleIpn - Order ${order._id}] Internal status '${order.status}' not modified.`); }

        if (shouldSaveChanges) { /* ... save ... */ } else { /* ... log no changes ... */ }
        res.status(200).json(ipnResponse);
    } catch (err) { /* ... error handling ... */ }
};

/** Get Order Stats (User) - CORRECTED */
export const getOrderStats = async (req, res) => {
   info("[getOrderStats] Function called.");
   try {
       // Use the MongoDB _id from the attached req.user object
       const userMongoId = req.user?._id; // This should be the MongoDB ObjectId

       info(`[getOrderStats] User MongoDB ID from middleware: ${userMongoId}`);

       if (!userMongoId) {
           error("[getOrderStats] Error: MongoDB User ID (_id) not found on req.user.");
           return res.status(401).json({ message: 'Unauthorized: User session invalid or user data missing.' });
       }

       // Query using the correct MongoDB ObjectId
       info(`[getOrderStats] Querying counts for userId (MongoDB ObjectId): ${userMongoId}`);
       const [pendingCount, activeCount, completedCount] = await Promise.all([
           Order.countDocuments({ userId: userMongoId, status: { $in: ['Pending Payment', 'Payment Failed']} }),
           Order.countDocuments({ userId: userMongoId, status: { $in: ['Processing', 'In Progress', 'Partial', 'Supplier Error']} }),
           Order.countDocuments({ userId: userMongoId, status: 'Completed' })
       ]);
       info(`[getOrderStats] Counts for user ${userMongoId}: Pending=${pendingCount}, Active=${activeCount}, Completed=${completedCount}`);

       res.status(200).json({
           pendingOrders: pendingCount,
           activeOrders: activeCount,
           completedOrders: completedCount
       });

   } catch (err) {
       // Log the error regardless of type
       error(`❌ Error fetching order stats for user ${req.user?._id}:`, err);
       // Check if it's specifically a CastError (though it shouldn't be now)
       if (err.name === 'CastError') {
            warn(`[getOrderStats] Received unexpected CastError for user ${req.user?._id}. Check middleware/schema alignment.`);
            return res.status(400).json({ message: 'Invalid user identifier format.' }); // More specific if cast error reappears
       }
       // General error
       res.status(500).json({ message: 'Stats fetch failed', error: err.message });
   }
};

/** Get User Orders (Paginated) - CORRECTED */
export const getUserOrders = async (req, res) => {
    info("[getUserOrders] Function called.");
    try {
        const userMongoId = req.user?._id; // Use MongoDB _id
        if (!userMongoId) {
             return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }
        let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 10; if (page < 1) page = 1; if (limit < 1) limit = 1; if (limit > 100) limit = 100; const skip = (page - 1) * limit;

        info(`[getUserOrders] Fetching orders for user MongoDB ID ${userMongoId}, P:${page}, L:${limit}`);
        const [orders, totalOrders] = await Promise.all([
            Order.find({ userId: userMongoId }) // Query with MongoDB _id
                 .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId -callbackUrlUsed -__v')
                 .sort({ createdAt: -1 })
                 .skip(skip)
                 .limit(limit)
                 .lean(),
            Order.countDocuments({ userId: userMongoId }) // Query with MongoDB _id
        ]);

        info(`[getUserOrders] Found ${orders.length}/${totalOrders} orders.`);
        res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders });
    } catch (err) {
         error(`❌ Error fetching orders user ${req.user?._id}:`, err);
         // Check for CastError specifically
         if (err.name === 'CastError') {
            warn(`[getUserOrders] Received unexpected CastError for user ${req.user?._id}. Check middleware/schema alignment.`);
            return res.status(400).json({ message: 'Invalid user identifier format.' });
         }
         res.status(500).json({ message: 'Order fetch failed', error: err.message });
    }
};

/** Get Single Order Details (User) - CORRECTED */
export const getOrderDetails = async (req, res) => {
    info("[getOrderDetails] Function called.");
    try {
        const userMongoId = req.user?._id; // Use MongoDB _id
        const orderId = req.params.id; // This is the Order's _id (ObjectId)
        if (!userMongoId) { return res.status(401).json({ message: 'Unauthorized.' }); }
        if (!mongoose.Types.ObjectId.isValid(orderId)) { info(`[getOrderDetails] Invalid Order ID format: ${orderId}`); return res.status(400).json({ message: 'Invalid Order ID.' }); }

        info(`[getOrderDetails] Fetching order ${orderId} for user MongoDB ID ${userMongoId}`);
        // Query by Order's _id (ObjectId) and User's _id (ObjectId)
        const order = await Order.findOne({ _id: orderId, userId: userMongoId }).select('-userId -__v');

        if (!order) { info(`[getOrderDetails] Order ${orderId} not found/denied user ${userMongoId}.`); return res.status(404).json({ message: 'Order not found or access denied.' }); }
        info(`[getOrderDetails] Success for Order ID ${orderId}`); res.status(200).json(order);
    } catch (err) {
        error(`❌ Error fetching details order ${req.params.id}, User ${req.user?._id}:`, err);
         if (err.name === 'CastError') {
            // This could happen if orderId is invalid format, already checked by isValid
            // Or if userMongoId was somehow not an ObjectId (should be caught earlier)
            warn(`[getOrderDetails] Received unexpected CastError. OrderID: ${req.params.id}, UserID: ${req.user?._id}.`);
            return res.status(400).json({ message: 'Invalid identifier format during lookup.' });
         }
        res.status(500).json({ message: 'Details fetch failed', error: err.message });
    }
};

/** Get Order Status by Merchant Reference (Callback Page) */
export const getOrderStatusByReference = async (req, res) => {
    // This function uses pesapalOrderId (string) so no change needed here
    info("[getOrderStatusByReference] Function called."); try { const { merchantRef } = req.params; info(`[getOrderStatusByReference] Ref: ${merchantRef}`); if (!merchantRef) { error("[getOrderStatusByReference] Missing merchantRef."); return res.status(400).json({ message: 'Order reference required.' }); } const order = await Order.findOne({ pesapalOrderId: merchantRef }).select('status paymentStatus _id supplierStatus'); if (!order) { info(`[getOrderStatusByReference] Order not found Ref ${merchantRef}`); return res.status(404).json({ message: 'Order not found.' }); } info(`[getOrderStatusByReference] Success Ref ${merchantRef}: Status='${order.status}', Payment='${order.paymentStatus}'`); res.status(200).json({ status: order.status, paymentStatus: order.paymentStatus, orderId: order._id, supplierStatus: order.supplierStatus }); } catch (err) { error(`❌ Error fetching status ref ${req.params.merchantRef}:`, err); res.status(500).json({ message: 'Status fetch failed', error: err.message }); }
};

// --- ADMIN FUNCTIONS --- (No changes needed based on userId fix)

/** Get All Orders (Admin) */
export const getAllOrdersAdmin = async (req, res) => {
    info(`[getAllOrdersAdmin] Admin: ${req.user?._id}`); try { const filter = {}; if (req.query.status) { const OrderStatusEnum = ['Pending Payment', 'Payment Failed', 'Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled', 'Refunded', 'Supplier Error', 'Expired']; const requestedStatus = req.query.status; if (typeof requestedStatus === 'string' && OrderStatusEnum.includes(requestedStatus)) { filter.status = requestedStatus; } else if (typeof requestedStatus === 'string') { warn(`[getAllOrdersAdmin] Invalid status filter: ${requestedStatus}`); return res.status(400).json({ message: `Invalid status: ${requestedStatus}` }); } } let page = parseInt(req.query.page) || 1; let limit = parseInt(req.query.limit) || 25; if (page < 1) page = 1; if (limit < 1) limit = 10; if (limit > 100) limit = 100; const skip = (page - 1) * limit; info(`[getAllOrdersAdmin] Querying. Filter: ${JSON.stringify(filter)}, P:${page}, L:${limit}`); const [orders, totalOrders] = await Promise.all([ Order.find(filter).populate('userId', 'email name username firebaseUid').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter) ]); info(`[getAllOrdersAdmin] Found ${orders.length}/${totalOrders}.`); res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders }); } catch (err) { error(`❌ Error fetching all orders admin ${req.user?._id}:`, err); res.status(500).json({ message: 'Fetch orders failed', error: err.message }); }
};

/** Update Order Status (Admin) */
export const updateOrderStatusAdmin = async (req, res) => {
    const orderId = req.params.id; const adminUserId = req.user?._id; info(`[updateOrderStatusAdmin] Admin: ${adminUserId} Order: ${orderId}`); try { const { status } = req.body; const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled', 'Refunded', 'Supplier Error']; if (!status || !allowedAdminStatusUpdates.includes(status)) { error(`[updateOrderStatusAdmin] Invalid status '${status}'.`); return res.status(400).json({ message: `Invalid status. Allowed: ${allowedAdminStatusUpdates.join(', ')}` }); } if (!mongoose.Types.ObjectId.isValid(orderId)) { error(`[updateOrderStatusAdmin] Invalid ID format: ${orderId}`); return res.status(400).json({ message: 'Invalid ID format.' }); } const order = await Order.findById(orderId); if (!order) { info(`[updateOrderStatusAdmin] Order ${orderId} not found.`); return res.status(404).json({ message: 'Order not found.' }); } if (order.status === status) { info(`[updateOrderStatusAdmin] Order ${orderId} already status '${status}'.`); return res.status(200).json(order); } info(`[updateOrderStatusAdmin] Admin ${adminUserId} changing ${orderId} status ${order.status} -> ${status}.`); order.status = status; if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') { info(`[updateOrderStatusAdmin - ${orderId}] Aligning paymentStatus.`); order.paymentStatus = 'COMPLETED'; } if ((status === 'Processing' || status === 'Completed') && order.errorMessage) { info(`[updateOrderStatusAdmin - ${orderId}] Clearing error.`); order.errorMessage = null; } const updatedOrder = await order.save(); info(`[updateOrderStatusAdmin] Admin ${adminUserId} updated order ${orderId} -> ${status}.`); res.status(200).json(updatedOrder); } catch (err) { error(`❌ Error updating order ${orderId} admin ${adminUserId}:`, err); if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid ID format.' }); if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) }); res.status(500).json({ message: 'Update failed', error: err.message }); }
};