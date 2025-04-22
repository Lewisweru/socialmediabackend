import Order from '../models/Order.js'; // Adjust path
// Import OrderStatusEnum if needed for validation, otherwise remove if unused
// import { OrderStatusEnum } from '../models/Order.js';
import User from '../models/User.js';   // Adjust path
import { PesapalService } from '../services/pesapal.js'; // Adjust path
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
// --- End Pesapal Service Initialization ---

// --- IPN Configuration ---
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID;
if (!REGISTERED_IPN_ID) {
    warn("Warning: PESAPAL_IPN_ID environment variable not set.");
    // if (config.server.nodeEnv === 'production') { process.exit(1); }
}
// --- End IPN Configuration ---

// --- Helper Function to Place Supplier Order ---
async function placeSupplierOrderAndUpdateStatus(order) { // REMOVED : Promise<OrderStatus> annotation
    // Double check: Only proceed if status indicates readiness
    if (order.status !== 'Pending Payment' && order.status !== 'Payment Failed') {
        warn(`placeSupplierOrderAndUpdateStatus called for order ${order._id} with unexpected status: ${order.status}. Skipping.`);
        return order.status; // Return current status
    }
     if (order.supplierOrderId) {
         warn(`placeSupplierOrderAndUpdateStatus called for order ${order._id}, but supplierOrderId (${order.supplierOrderId}) already exists. Skipping placement.`);
         if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
             order.status = 'Processing';
             return 'Processing';
         }
         return order.status;
     }

    info(`[Supplier Order] Attempting to place supplier order for internal order ${order._id}...`);
    try {
        const serviceId = getJeskieServiceId(order.platform, order.service);
        if (!serviceId) {
            error(`[Supplier Order Error - Order ${order._id}] Failed to get Jeskie Service ID (Platform: ${order.platform}, Service: ${order.service}). Check mapping.`);
            order.status = 'Supplier Error';
            order.supplierStatus = 'Service ID mapping failed';
            return 'Supplier Error'; // Return the new status
        }
        info(`[Supplier Order - Order ${order._id}] Mapped internal service '${order.service}' to Jeskie Service ID: ${serviceId}.`);

        const supplierOrderId = await placeJeskieOrder(order.accountLink, order.quantity, serviceId);

        order.supplierOrderId = supplierOrderId.toString();
        order.status = 'Processing';
        order.supplierStatus = 'Pending';
        info(`[Supplier Order Success - Order ${order._id}] Successfully placed Jeskie order ${supplierOrderId}. Internal status set to Processing.`);
        return 'Processing'; // Return the new status

    } catch (supplierError) {
        error(`[Supplier Order Error - Order ${order._id}] Failed to place Jeskie order: ${supplierError.message}`, supplierError);
        order.status = 'Supplier Error';
        order.supplierStatus = supplierError.message.length > 100 ? supplierError.message.substring(0, 97) + '...' : supplierError.message;
        return 'Supplier Error'; // Return the error status
    }
}
// --- End Helper Function ---


// --- Controller Functions ---

export const initiateOrderAndPayment = async (req, res) => {
  // ... (rest of initiateOrderAndPayment remains the same) ...
  let savedOrder = null;
  const pesapalOrderId = uuidv4(); // Use UUID for Merchant Ref

  try {
    const {
      platform, service, quality, accountLink, quantity, // Order details
      currency = 'KES', // Payment details
      callbackUrl // Frontend callback URL
    } = req.body;

    const userId = req.user?._id; // From auth middleware
    const userEmail = req.user?.email;
    const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;

    // --- Validation ---
    if (!userId) {
        error("[Initiate Order] Error: Missing User ID.");
        return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
    }
    const parsedQuantity = parseInt(quantity, 10);
    if (!platform || !service || !quality || !accountLink || !parsedQuantity || parsedQuantity <= 0 || !callbackUrl) {
        error(`[Initiate Order] Error: Missing required body params for user ${userId}`, req.body);
        return res.status(400).json({ message: 'Missing or invalid required order details.' });
    }
     if (!REGISTERED_IPN_ID) {
       error("[Initiate Order] Error: Server Misconfiguration - PESAPAL_IPN_ID not set.");
       return res.status(500).json({ message: 'Server configuration error [IPN].' });
     }

    // --- Recalculate Price on Backend ---
    const calculatedAmount = calculatePrice(platform, service, quality, parsedQuantity);
    if (calculatedAmount <= 0) {
        error(`[Initiate Order] Price calculation failed or zero for order: ${platform}/${service}/${quality} x ${parsedQuantity}`);
        return res.status(400).json({ message: 'Could not determine price for the selected service.' });
    }
    // --- End Price Recalculation ---

    const orderDescription = `${parsedQuantity} ${quality} ${platform} ${service}`;
    const orderData = {
      pesapalOrderId,
      userId: String(userId),
      platform: String(platform).toLowerCase(),
      service: String(service),
      quality: String(quality),
      accountLink: String(accountLink),
      quantity: parsedQuantity,
      amount: calculatedAmount,
      currency: String(currency),
      description: String(orderDescription).substring(0, 100),
      status: 'Pending Payment',
      paymentStatus: 'PENDING',
      callbackUrlUsed: String(callbackUrl),
    };

    // --- Save Order to DB ---
    info(`[Order Initiate - Ref ${pesapalOrderId}] Saving order to DB for user ${userId}...`);
    savedOrder = new Order(orderData);
    await savedOrder.save();
    info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created in DB. Status: Pending Payment.`);

    // --- Register order with Pesapal ---
    info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Fetching Pesapal token...`);
    const token = await pesapalService.getOAuthToken();
    info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Registering order with Pesapal...`);
    const customerDetails = {
      firstName: userName.split(' ')[0] || 'Valued',
      lastName: userName.split(' ').slice(1).join(' ') || 'Customer',
      email: userEmail,
    };
    const pesapalOrderResponse = await pesapalService.registerOrder(
      token, pesapalOrderId, orderData.amount, orderData.currency,
      orderData.description, orderData.callbackUrlUsed, customerDetails, REGISTERED_IPN_ID
    );
    info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration response received:`, pesapalOrderResponse);

    // --- Update local order ---
    if (pesapalOrderResponse?.order_tracking_id) {
      savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
      await savedOrder.save();
      info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Updated DB with Pesapal Tracking ID: ${savedOrder.pesapalTrackingId}`);
    } else {
       warn(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration response missing order_tracking_id.`);
    }

    // --- Check for Redirect URL ---
    if (!pesapalOrderResponse?.redirect_url) {
        savedOrder.status = 'Payment Failed';
        savedOrder.paymentStatus = 'FAILED';
        savedOrder.errorMessage = 'Pesapal registration did not return a redirect URL.';
        await savedOrder.save();
        error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] CRITICAL ERROR: No Pesapal redirect URL.`);
        throw new Error('Pesapal did not provide a payment redirect URL.');
    }

    // --- Success Response ---
    info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Initiation successful. Returning redirect URL.`);
    res.status(200).json({
      redirectUrl: pesapalOrderResponse.redirect_url,
      orderTrackingId: pesapalOrderResponse.order_tracking_id,
      orderId: savedOrder._id // Internal DB ID
    });

  } catch (err) { // Catch errors
    error(`❌ Error during order initiation for PesaPal Ref ${pesapalOrderId}:`, err);
    if (savedOrder && savedOrder.status === 'Pending Payment') {
        try {
             savedOrder.status = 'Payment Failed';
             savedOrder.paymentStatus = 'FAILED';
             savedOrder.errorMessage = `Payment initiation failed: ${err.message}`;
             await savedOrder.save();
             info(`[Order ${savedOrder?._id} / Ref ${pesapalOrderId}] Marked as Payment Failed.`);
        } catch (saveError) {
             error(`[Order ${savedOrder?._id} / Ref ${pesapalOrderId}] FAILED to update status after initiation error:`, saveError);
        }
    }
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        return res.status(400).json({ message: "Order data validation failed", details: messages });
    }
    res.status(500).json({ message: 'Failed to initiate payment process.', error: err.message });
  }
};


export const handleIpn = async (req, res) => {
  // ... (rest of handleIpn remains the same) ...
  const ipnBody = req.body || {};
  const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
  const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
  const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || ''; // Our pesapalOrderId

  const ipnResponse = { // Prepare response structure
      orderNotificationType: notificationType,
      orderTrackingId: orderTrackingId,
      orderMerchantReference: merchantReference,
      status: 500 // Default error
  };

  info(`--- Received IPN [${new Date().toISOString()}] --- Ref: ${merchantReference}, Tracking: ${orderTrackingId}, Type: ${notificationType}`);
  debug(`IPN Raw Body:`, JSON.stringify(ipnBody, null, 2));

  if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) {
    error(`[IPN Validation Error - Ref ${merchantReference}] Missing fields or incorrect Type.`);
    return res.status(200).json(ipnResponse); // Respond 200 OK with JSON indicating error
  }

  let order = null;
  let transactionStatusData = null;

  try {
    info(`[IPN Processing - Ref ${merchantReference}] Searching for Order...`);
    order = await Order.findOne({ pesapalOrderId: merchantReference });
    if (!order) {
      error(`[IPN Processing Error - Ref ${merchantReference}] Order not found.`);
      ipnResponse.status = 404;
      return res.status(200).json(ipnResponse);
    }
    info(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}. Current Status: ${order.status}`);

    info(`[IPN Processing - Order ${order._id}] Querying Pesapal status for Tracking ID: ${orderTrackingId}`);
    const token = await pesapalService.getOAuthToken();
    transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
    info(`[IPN Processing - Order ${order._id}] Pesapal status response:`, transactionStatusData);

    const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
    const fetchedPesapalDesc = transactionStatusData?.description || '';

    let internalStatusUpdate = order.status; // Start with current // REMOVED : OrderStatus annotation
    let shouldSaveChanges = false;
    let newErrorMessage = order.errorMessage;

    if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') {
        info(`[IPN - Order ${order._id}] Updating DB paymentStatus from '${order.paymentStatus}' to '${fetchedPesapalStatus}'`);
        order.paymentStatus = fetchedPesapalStatus;
        shouldSaveChanges = true;
    }

    if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
        switch (fetchedPesapalStatus) {
            case 'COMPLETED':
                info(`[IPN Update - Order ${order._id}] Fetched COMPLETED. Attempting to place supplier order...`);
                internalStatusUpdate = await placeSupplierOrderAndUpdateStatus(order);
                newErrorMessage = (internalStatusUpdate === 'Supplier Error') ? order.supplierStatus : null;
                shouldSaveChanges = true;
                info(`[IPN Update - Order ${order._id}] Supplier placement result status: '${internalStatusUpdate}'.`);
                break;
            case 'FAILED':
                internalStatusUpdate = 'Payment Failed';
                newErrorMessage = fetchedPesapalDesc || 'Payment Failed (Pesapal IPN)';
                shouldSaveChanges = true;
                info(`[IPN Update - Order ${order._id}] Fetched FAILED. Setting Internal Status to 'Payment Failed'.`);
                break;
            case 'INVALID':
            case 'REVERSED':
                internalStatusUpdate = 'Cancelled';
                newErrorMessage = `Payment ${fetchedPesapalStatus}. ${fetchedPesapalDesc || ''}`.trim();
                shouldSaveChanges = true;
                info(`[IPN Update - Order ${order._id}] Fetched ${fetchedPesapalStatus}. Setting Internal Status to 'Cancelled'.`);
                break;
            case 'PENDING':
                 info(`[IPN Info - Order ${order._id}] Fetched PENDING. Internal status remains '${order.status}'.`);
                 break;
            default:
                 warn(`[IPN Info - Order ${order._id}] Unhandled fetched status: '${fetchedPesapalStatus}'. No internal status change.`);
        }
        if (order.status !== internalStatusUpdate) {
            order.status = internalStatusUpdate;
            order.errorMessage = newErrorMessage;
            info(`[IPN Update - Order ${order._id}] Internal status set to '${order.status}'.`);
        }
    } else {
        info(`[IPN Info - Order ${order._id}] Internal status '${order.status}' not modified by IPN (paymentStatus updated if changed).`);
    }

    if (shouldSaveChanges) {
      info(`[IPN Processing - Order ${order._id}] Saving changes to DB...`);
      await order.save();
      info(`[IPN Processed - Order ${order._id}] Save successful. Final Status: ${order.status}, Payment: ${order.paymentStatus}`);
      ipnResponse.status = 200; // Success
    } else {
      info(`[IPN Info - Order ${order._id}] No database changes required.`);
      ipnResponse.status = 200; // Success (no-op)
    }

    info(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`);
    res.status(200).json(ipnResponse);

  } catch (err) {
    error(`❌ Unhandled Error processing IPN for MerchantRef ${merchantReference}:`, err);
    ipnResponse.status = 500;
    res.status(200).json(ipnResponse);
  }
};
/**
 * Get Order Stats for Dashboard (User)
 */
export const getOrderStats = async (req, res) => {
   // ... (Keep existing getOrderStats logic - no changes needed here) ...
   info("[getOrderStats] Function called.");
   try {
       const userId = req.user?._id;
       info(`[getOrderStats] User ID from middleware: ${userId}`);
       if (!userId) {
           error("[getOrderStats] Error: User ID not found after protect middleware.");
           return res.status(401).json({ message: 'Unauthorized: User session invalid or middleware failed.' });
       }

       info(`[getOrderStats] Querying counts for userId: ${userId}`);
       const [pendingCount, activeCount, completedCount] = await Promise.all([
           Order.countDocuments({ userId: userId, status: { $in: ['Pending Payment', 'Payment Failed']} }), // Pending might include failed retries
           Order.countDocuments({ userId: userId, status: { $in: ['Processing', 'In Progress', 'Partial', 'Supplier Error']} }), // Active/Problematic
           Order.countDocuments({ userId: userId, status: 'Completed' })
       ]);
       info(`[getOrderStats] Counts for user ${userId}: Pending=${pendingCount}, Active=${activeCount}, Completed=${completedCount}`);

       res.status(200).json({
           pendingOrders: pendingCount,
           activeOrders: activeCount,
           completedOrders: completedCount
       });

   } catch (err) {
       error(`❌ Error fetching order stats for user ${req.user?._id}:`, err);
       res.status(500).json({ message: 'Failed to fetch order statistics', error: err.message });
   }
};

/**
 * Get User's Orders (Paginated)
 */
export const getUserOrders = async (req, res) => {
    // ... (Keep existing getUserOrders logic - no changes needed here) ...
    info("[getUserOrders] Function called.");
    try {
        const userId = req.user?._id;
        if (!userId) {
             return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 10;
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;
        const skip = (page - 1) * limit;

        info(`[getUserOrders] Fetching orders for user ${userId}, Page: ${page}, Limit: ${limit}`);
        const [orders, totalOrders] = await Promise.all([
            Order.find({ userId: userId })
                 .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId -callbackUrlUsed -__v') // Exclude more fields
                 .sort({ createdAt: -1 })
                 .skip(skip)
                 .limit(limit)
                 .lean(),
            Order.countDocuments({ userId: userId })
        ]);

        info(`[getUserOrders] Found ${orders.length} orders for user ${userId} on page ${page}. Total: ${totalOrders}`);
        res.status(200).json({
            orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders
        });
    } catch (err) {
        error(`❌ Error fetching orders for user ${req.user?._id}:`, err);
        res.status(500).json({ message: 'Failed to fetch user orders', error: err.message });
    }
};

/**
 * Get Single Order Details (for User)
 */
export const getOrderDetails = async (req, res) => {
    // ... (Keep existing getOrderDetails logic - no changes needed here) ...
    info("[getOrderDetails] Function called.");
    try {
        const userId = req.user?._id;
        const orderId = req.params.id;

        if (!userId) {
             return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             info(`[getOrderDetails] Invalid Order ID format: ${orderId}`);
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        info(`[getOrderDetails] Fetching order ${orderId} for user ${userId}`);
        const order = await Order.findOne({ _id: orderId, userId: userId })
                                 .select('-userId -__v'); // Exclude internal fields

        if (!order) {
            info(`[getOrderDetails] Order ${orderId} not found or access denied for user ${userId}.`);
            return res.status(404).json({ message: 'Order not found or access denied.' });
        }

        info(`[getOrderDetails] Successfully fetched details for Order ID ${orderId}`);
        res.status(200).json(order);

    } catch (err) {
        error(`❌ Error fetching order details for Order ID ${req.params.id}, User ${req.user?._id}:`, err);
        res.status(500).json({ message: 'Failed to fetch order details', error: err.message });
    }
};

/**
 * Get Order Status by Merchant Reference (for Callback Page)
 */
export const getOrderStatusByReference = async (req, res) => {
    // --- Keep existing logic - This endpoint only RETURNS status ---
    // --- No Jeskie trigger added here unless specifically desired for redundancy ---
    info("[getOrderStatusByReference] Function called.");
    try {
        const { merchantRef } = req.params; // This is our pesapalOrderId (UUID)
        info(`[getOrderStatusByReference] Received MerchantRef: ${merchantRef}`);

        if (!merchantRef) {
            error("[getOrderStatusByReference] Error: Missing merchantRef.");
            return res.status(400).json({ message: 'Order reference is required.' });
        }

        // Find order using the pesapalOrderId field
        const order = await Order.findOne({ pesapalOrderId: merchantRef })
                                 .select('status paymentStatus _id supplierStatus'); // Include supplierStatus

        if (!order) {
            info(`[getOrderStatusByReference] Order not found for MerchantRef ${merchantRef}`);
            return res.status(404).json({ message: 'Order not found.' });
        }

        info(`[getOrderStatusByReference] Status check success for MerchantRef ${merchantRef}: DB Status='${order.status}', Payment='${order.paymentStatus}', Supplier='${order.supplierStatus || 'N/A'}'`);
        res.status(200).json({
            status: order.status, // Our internal status
            paymentStatus: order.paymentStatus, // Pesapal's last reported status
            orderId: order._id, // Our internal ID
            supplierStatus: order.supplierStatus // Supplier status if available
        });

    } catch (err) {
        error(`❌ Error fetching order status by reference ${req.params.merchantRef}:`, err);
        res.status(500).json({ message: 'Failed to fetch order status', error: err.message });
    }
};


// =============================================
// == ADMIN CONTROLLER FUNCTIONS ===============
// =============================================

/**
 * Get All Orders (Admin) with Pagination and Filtering
 */
export const getAllOrdersAdmin = async (req, res) => {
    // ... (Keep existing getAllOrdersAdmin logic - no changes needed here) ...
     info(`[getAllOrdersAdmin] Function called by Admin: ${req.user?._id}`);
    try {
        const filter = {};
        if (req.query.status) {
             // Ensure your OrderStatusEnum includes all filterable statuses
             const allowedStatuses = OrderStatusEnum; // Use enum from model if exported
             const requestedStatus = req.query.status;
             if (typeof requestedStatus === 'string' && allowedStatuses.includes(requestedStatus)) {
                 filter.status = requestedStatus;
             } else if (typeof requestedStatus === 'string') {
                 warn(`[getAllOrdersAdmin] Invalid status filter: ${requestedStatus}`);
                 return res.status(400).json({ message: `Invalid status filter: ${requestedStatus}` });
             }
        }
         // Add other filters like user email, platform, etc. if needed
         // if (req.query.userEmail) { ... find user by email then filter by user._id ... }

        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 25;
        if (page < 1) page = 1;
        if (limit < 1) limit = 10;
        if (limit > 100) limit = 100;
        const skip = (page - 1) * limit;

        info(`[getAllOrdersAdmin] Querying orders. Filter: ${JSON.stringify(filter)}, Page: ${page}, Limit: ${limit}`);
        const [orders, totalOrders] = await Promise.all([
            Order.find(filter)
                 .populate('userId', 'email name username')
                 .sort({ createdAt: -1 })
                 .skip(skip)
                 .limit(limit)
                 .lean(),
             Order.countDocuments(filter)
        ]);

        info(`[getAllOrdersAdmin] Found ${orders.length} orders on page ${page}. Total matching: ${totalOrders}.`);
        res.status(200).json({
            orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders
        });
    } catch (err) {
        error(`❌ Error fetching all orders for admin ${req.user?._id}:`, err);
        res.status(500).json({ message: 'Failed to fetch orders', error: err.message });
    }
};

/**
 * Update Order Status (Admin)
 */
export const updateOrderStatusAdmin = async (req, res) => {
    // ... (Keep existing updateOrderStatusAdmin logic - no changes needed here) ...
     const orderId = req.params.id;
    const adminUserId = req.user?._id;
    info(`[updateOrderStatusAdmin] Request from Admin: ${adminUserId} for Order ID: ${orderId}`);
    try {
        const { status } = req.body;
        const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled', 'Refunded', 'Supplier Error']; // Add Refunded, Supplier Error
        if (!status || !allowedAdminStatusUpdates.includes(status)) {
            error(`[updateOrderStatusAdmin] Invalid target status '${status}'.`);
            return res.status(400).json({ message: `Invalid target status. Allowed: ${allowedAdminStatusUpdates.join(', ')}` });
        }
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             error(`[updateOrderStatusAdmin] Invalid Order ID format: ${orderId}`);
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }
        const order = await Order.findById(orderId);
        if (!order) {
            info(`[updateOrderStatusAdmin] Order ${orderId} not found.`);
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (order.status === status) {
            info(`[updateOrderStatusAdmin] Order ${orderId} already status '${status}'.`);
            return res.status(200).json(order);
        }
        // Maybe allow changing from Completed/Cancelled/Refunded if needed? Be careful.
        // if ((order.status === 'Completed' || order.status === 'Cancelled' || order.status === 'Refunded') && status !== order.status) { ... }

        info(`[updateOrderStatusAdmin] Admin ${adminUserId} changing order ${orderId} status from '${order.status}' to '${status}'.`);
        order.status = status;

        // Optionally add notes or update other fields based on admin action
        // if (status === 'Refunded') { order.paymentStatus = 'REFUNDED'; } // Example alignment

        const updatedOrder = await order.save();
        info(`[updateOrderStatusAdmin] Admin ${adminUserId} updated order ${orderId} status to ${status}.`);
        res.status(200).json(updatedOrder);

    } catch (err) {
        error(`❌ Error updating order status for ${orderId} by admin ${adminUserId}:`, err);
        // ... specific error handling (CastError, ValidationError) ...
        if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid Order ID format.' });
        if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) });
        res.status(500).json({ message: 'Failed to update order status', error: err.message });
    }
};