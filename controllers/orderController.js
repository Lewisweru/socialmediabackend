// controllers/orderController.js (Standard JavaScript)

import Order from '../models/Order.js'; // Adjust path
import User from '../models/User.js';   // Adjust path
import { PesapalService } from '../services/pesapal.js'; // Adjust path
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose'; // Needed for ObjectId validation

// --- Pesapal Service Initialization ---
if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
  console.error("FATAL ERROR: Pesapal consumer key and secret must be defined in environment variables.");
  process.exit(1);
}
const pesapalService = new PesapalService(
  process.env.PESAPAL_CONSUMER_KEY,
  process.env.PESAPAL_CONSUMER_SECRET,
  process.env.NODE_ENV !== 'production'
);
// --- End Pesapal Service Initialization ---


// --- IPN Configuration ---
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID;
if (!REGISTERED_IPN_ID) {
    console.warn("Warning: PESAPAL_IPN_ID environment variable not set. IPN may not function correctly.");
}
const PESAPAL_IPN_URL = `${process.env.BACKEND_BASE_URL || 'http://localhost:5000'}/api/orders/ipn`;
// --- End IPN Configuration ---


// --- Controller Functions ---

/**
 * @desc    Initiate a new order, save it, register with Pesapal, return redirect URL
 * @route   POST /api/orders/initiate
 * @access  Private (requires user auth via middleware)
 */
export const initiateOrderAndPayment = async (req, res) => {
  let savedOrder = null; // Keep track of the order document if created
  const pesapalOrderId = uuidv4(); // Generate unique ID for this transaction attempt (Merchant Ref)

  try {
    // 1. Extract data from request body
    const {
      platform, service, quality, accountLink, quantity, // Order details
      amount, currency = 'KES', description, // Payment details
      callbackUrl // Frontend callback URL
    } = req.body;

    // 2. Get user details from request (populated by 'protect' middleware)
    const userId = req.user?._id;
    const userEmail = req.user?.email;
    const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Customer'} ${req.user?.lastName || 'User'}`;

    // 3. Validate incoming data and configuration
    if (!userId) return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
    if (!userEmail || !userName) return res.status(401).json({ message: 'User details incomplete.' });
    if (!platform || !service || !quality || !accountLink || !quantity || quantity <= 0 || !amount || amount <= 0 || !callbackUrl) {
      return res.status(400).json({ message: 'Missing or invalid required order details.' });
    }
     if (!REGISTERED_IPN_ID) {
       console.error("[Initiate Order] Error: Server Misconfiguration - PESAPAL_IPN_ID is not set.");
       return res.status(500).json({ message: 'Server configuration error [IPN].' });
     }

    // 4. Create Order document data
    const orderDescription = description || `${quantity} ${quality} ${platform} ${service}`;
    const orderData = {
      pesapalOrderId, userId, platform, service, quality, accountLink, quantity,
      amount: parseFloat(amount), currency: String(currency), // Ensure types
      description: String(orderDescription).substring(0, 100), // Ensure string, limit length
      status: 'Pending Payment', paymentStatus: 'PENDING',
      callbackUrlUsed: String(callbackUrl),
    };

    // 5. Save Order to Database
    console.log(`[Order Initiate - Ref ${pesapalOrderId}] Attempting to save order to DB for user ${userId}...`);
    savedOrder = new Order(orderData);
    await savedOrder.save(); // Mongoose validation happens here
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created successfully. Status: Pending Payment.`);

    // 6. Register order with Pesapal
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Fetching Pesapal token...`);
    const token = await pesapalService.getOAuthToken();
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal token obtained. Registering order...`);
    const customerDetails = {
      firstName: userName.split(' ')[0] || 'Customer',
      lastName: userName.split(' ').slice(1).join(' ') || 'User',
      email: userEmail,
    };
    const pesapalOrderResponse = await pesapalService.registerOrder(
      token, pesapalOrderId, orderData.amount, orderData.currency, orderData.description,
      orderData.callbackUrlUsed, customerDetails, REGISTERED_IPN_ID
    );
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration API response:`, pesapalOrderResponse);

    // 7. Update local order with Pesapal Tracking ID
    if (pesapalOrderResponse?.order_tracking_id) {
      savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
      await savedOrder.save();
      console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Updated with Pesapal Tracking ID: ${savedOrder.pesapalTrackingId}`);
    } else {
       console.warn(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal response did not contain order_tracking_id.`);
    }

    // 8. Check for Redirect URL and respond to frontend
    if (!pesapalOrderResponse?.redirect_url) {
        savedOrder.status = 'Payment Failed';
        savedOrder.paymentStatus = 'FAILED';
        savedOrder.errorMessage = 'Pesapal registration did not return a redirect URL.';
        await savedOrder.save();
        console.error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] CRITICAL ERROR: Pesapal registration failed. No redirect URL.`);
        throw new Error('Pesapal did not provide a payment redirect URL.');
    }

    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Successfully initiated. Returning redirect URL.`);
    res.status(200).json({
      redirectUrl: pesapalOrderResponse.redirect_url,
      orderTrackingId: pesapalOrderResponse.order_tracking_id,
      orderId: savedOrder._id
    });

  } catch (error) {
    console.error(`❌ Error during order initiation for PesaPal Ref ${pesapalOrderId}:`, error);
    if (savedOrder && savedOrder.status === 'Pending Payment') {
        try {
             savedOrder.status = 'Payment Failed';
             savedOrder.paymentStatus = 'FAILED';
             savedOrder.errorMessage = `Payment initiation failed: ${error.message}`;
             await savedOrder.save();
             console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Marked as Payment Failed due to initiation error.`);
        } catch (saveError) {
             console.error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] FAILED to update status after initiation error:`, saveError);
        }
    }
    if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: "Order data validation failed", details: messages });
    }
    res.status(500).json({ message: 'Failed to initiate payment process.', error: error.message });
  }
};


/**
 * @desc    Handle Pesapal IPN (Instant Payment Notification) - REVISED FOR v3 STATUS CHECK
 * @route   POST /api/orders/ipn
 * @access  Public (Called directly by Pesapal)
 */
export const handleIpn = async (req, res) => {
  const ipnBody = req.body || {};
  const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
  const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
  const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || ''; // This is our pesapalOrderId

  // Prepare response structure EARLY
  const ipnResponse = {
      orderNotificationType: notificationType,
      orderTrackingId: orderTrackingId,
      orderMerchantReference: merchantReference,
      status: 500 // Default to error - explicitly set to 200 on success
  };

  console.log(`--- Received IPN [${new Date().toISOString()}] ---`);
  console.log(`Raw Body:`, JSON.stringify(ipnBody, null, 2));
  console.log(`Extracted: TrackingID='${orderTrackingId}', Type='${notificationType}', MerchantRef='${merchantReference}'`);

  // Validate required fields and IPN type
  if (!orderTrackingId || notificationType !== 'IPNCHANGE' || !merchantReference) {
    console.error(`[IPN Validation Error] Missing required fields or incorrect Type ('${notificationType}' != 'IPNCHANGE'). Ref: ${merchantReference}`);
    return res.status(200).json(ipnResponse); // Respond 200 OK but with status 500 inside JSON
  }

  let order = null;

  try {
    // Find the corresponding order
    console.log(`[IPN Processing - Ref ${merchantReference}] Searching for Order with pesapalOrderId: ${merchantReference}`);
    try {
        order = await Order.findOne({ pesapalOrderId: merchantReference });
    } catch (dbError) {
        console.error(`[IPN DB Error - Ref ${merchantReference}] Error finding order:`, dbError);
        return res.status(200).json(ipnResponse);
    }

    if (!order) {
      console.error(`[IPN Processing Error - Ref ${merchantReference}] Order not found in DB.`);
      ipnResponse.status = 404; // Indicate not found internally
      return res.status(200).json(ipnResponse); // Respond 200 OK / internal status 404/500
    }
    console.log(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}. Current DB Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);

    // --- Query Pesapal for Actual Transaction Status ---
    let transactionStatusData;
    try {
        console.log(`[IPN Processing - Order ${order._id}] Querying Pesapal status using Tracking ID: ${orderTrackingId}`);
        const token = await pesapalService.getOAuthToken();
        transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
        console.log(`[IPN Processing - Order ${order._id}] Pesapal status check response:`, transactionStatusData);
    } catch (statusError) {
         console.error(`[IPN Status Query Error - Order ${order._id}] Failed to query Pesapal status:`, statusError);
         // Respond 200 OK / status 500 JSON - indicates failure to confirm status
         return res.status(200).json(ipnResponse);
    }

    // --- Process Status Update based on *FETCHED* status ---
    const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
    const fetchedPesapalDesc = transactionStatusData?.description;

    let internalStatusUpdate = order.status;
    let shouldSave = false;
    let newErrorMessage = order.errorMessage;

    console.log(`[IPN Processing - Order ${order._id}] Fetched Status: '${fetchedPesapalStatus}'. Comparing with DB...`);

    // Update stored Pesapal status if different
    if (order.paymentStatus !== fetchedPesapalStatus && fetchedPesapalStatus !== 'UNKNOWN') {
        console.log(`[IPN - Order ${order._id}] Updating paymentStatus from '${order.paymentStatus}' to '${fetchedPesapalStatus}'`);
        order.paymentStatus = fetchedPesapalStatus;
        shouldSave = true;
    }

    // Determine internal status update (only if currently pending)
    if (order.status === 'Pending Payment') {
        switch (fetchedPesapalStatus) {
            case 'COMPLETED':
                internalStatusUpdate = 'Processing';
                newErrorMessage = null;
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched COMPLETED. Setting Internal Status to 'Processing'.`);
                // ----- !!! TRIGGER SERVICE DELIVERY LOGIC HERE !!! -----
                // triggerServiceDelivery(order);
                // ---------------------------------------------------------
                break;
            case 'FAILED':
                internalStatusUpdate = 'Payment Failed';
                newErrorMessage = fetchedPesapalDesc || 'Payment Failed via Pesapal Status Check.';
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched FAILED. Setting Internal Status to 'Payment Failed'.`);
                break;
            case 'INVALID':
            case 'REVERSED':
                internalStatusUpdate = 'Cancelled';
                newErrorMessage = `Payment status ${fetchedPesapalStatus} fetched. ${fetchedPesapalDesc || ''}`.trim();
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched ${fetchedPesapalStatus}. Setting Internal Status to 'Cancelled'.`);
                break;
            case 'PENDING':
                 console.log(`[IPN Info - Order ${order._id}] Fetched PENDING. Internal status remains 'Pending Payment'.`);
                 break;
            default:
                 console.warn(`[IPN Info - Order ${order._id}] Received unhandled fetched status: '${fetchedPesapalStatus}'.`);
        }
        if (order.status !== internalStatusUpdate) {
            order.status = internalStatusUpdate;
            order.errorMessage = newErrorMessage;
            console.log(`[IPN Update - Order ${order._id}] Internal status changed to '${order.status}'.`);
            shouldSave = true;
        }
    } else {
        console.log(`[IPN Info - Order ${order._id}] Internal status is already '${order.status}'. Only updating paymentStatus if changed.`);
    }

    // Save if needed
    if (shouldSave) {
      console.log(`[IPN Processing - Order ${order._id}] Attempting to save DB changes...`);
      try {
        await order.save();
        console.log(`[IPN Processed - Order ${order._id}] Save successful. Final Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);
        ipnResponse.status = 200; // Mark successful processing in JSON response
      } catch (saveError) {
        console.error(`[IPN Save Error - Order ${order._id}] FAILED TO SAVE DB update:`, saveError);
        ipnResponse.status = 500; // Mark error in JSON response
        return res.status(200).json(ipnResponse); // Still respond 200 OK to Pesapal HTTP
      }
    } else {
      console.log(`[IPN Info - Order ${order._id}] No database changes required saving.`);
      ipnResponse.status = 200; // Mark successful (no-op) processing in JSON response
    }

    // Acknowledge IPN Receipt to Pesapal using JSON
    console.log(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`);
    res.status(200).json(ipnResponse); // Send JSON 200 OK with internal status code

  } catch (error) {
    console.error(`❌ Unhandled Error processing IPN for MerchantRef ${merchantReference}:`, error);
    ipnResponse.status = 500;
    res.status(200).json(ipnResponse); // Respond 200 OK / status 500 JSON
  }
};

/**
 * Get Order Stats for Dashboard
 */
export const getOrderStats = async (req, res) => {
   console.log("[getOrderStats] Function called.");
   try {
       const userId = req.user?._id;
       console.log(`[getOrderStats] User ID from middleware: ${userId}`);
       if (!userId) {
           console.error("[getOrderStats] Error: User ID not found after protect middleware.");
           return res.status(401).json({ message: 'Unauthorized: User session invalid or middleware failed.' });
       }

       console.log(`[getOrderStats] Querying counts for userId: ${userId}`);
       const [pendingCount, activeCount, completedCount] = await Promise.all([
           Order.countDocuments({ userId: userId, status: 'Pending Payment' }),
           Order.countDocuments({ userId: userId, status: 'Processing' }),
           Order.countDocuments({ userId: userId, status: 'Completed' })
       ]);
       console.log(`[getOrderStats] Counts for user ${userId}: Pending=${pendingCount}, Active=${activeCount}, Completed=${completedCount}`);

       res.status(200).json({
           pendingOrders: pendingCount,
           activeOrders: activeCount,
           completedOrders: completedCount
       });

   } catch (error) {
       console.error(`❌ Error fetching order stats for user ${req.user?._id}:`, error);
       res.status(500).json({ message: 'Failed to fetch order statistics', error: error.message });
   }
};


/**
 * Get User's Orders (Paginated)
 */
export const getUserOrders = async (req, res) => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const orders = await Order.find({ userId: userId })
                                   .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId')
                                   .sort({ createdAt: -1 })
                                   .skip(skip)
                                   .limit(limit);

        const totalOrders = await Order.countDocuments({ userId: userId });

        console.log(`Fetched ${orders.length} orders for user ${userId}, page ${page}`);
        res.status(200).json({
            orders,
            page,
            pages: Math.ceil(totalOrders / limit),
            total: totalOrders
        });

    } catch (error) {
        console.error(`❌ Error fetching orders for user ${req.user?._id}:`, error);
        res.status(500).json({ message: 'Failed to fetch user orders', error: error.message });
    }
};

/**
 * Get Single Order Details (for User)
 */
export const getOrderDetails = async (req, res) => {
    try {
        const userId = req.user?._id;
        const orderId = req.params.id;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        const order = await Order.findOne({ _id: orderId, userId: userId });

        if (!order) {
            console.log(`Order details not found or access denied for Order ID ${orderId}, User ${userId}`);
            return res.status(404).json({ message: 'Order not found or access denied.' });
        }

        console.log(`Fetched details for Order ID ${orderId}`);
        const orderResponse = order.toObject();
        // delete orderResponse.paymentStatus; // Optionally exclude fields
        res.status(200).json(orderResponse);

    } catch (error) {
        console.error(`❌ Error fetching order details for Order ID ${req.params.id}, User ${req.user?._id}:`, error);
        res.status(500).json({ message: 'Failed to fetch order details', error: error.message });
    }
};

/**
 * Get Order Status by Merchant Reference (for Callback Page)
 */
export const getOrderStatusByReference = async (req, res) => {
    try {
        const { merchantRef } = req.params; // This is our pesapalOrderId

        if (!merchantRef) {
            return res.status(400).json({ message: 'Order reference is required.' });
        }

        const order = await Order.findOne({ pesapalOrderId: merchantRef })
                                 .select('status paymentStatus _id'); // Select necessary fields

        if (!order) {
            console.log(`Status check: Order not found for MerchantRef ${merchantRef}`);
            return res.status(404).json({ message: 'Order not found.' });
        }

        console.log(`Status check success for MerchantRef ${merchantRef}: Status=${order.status}`);
        res.status(200).json({
            status: order.status,
            paymentStatus: order.paymentStatus,
            orderId: order._id,
        });

    } catch (error) {
        console.error(`❌ Error fetching order status by reference ${req.params.merchantRef}:`, error);
        res.status(500).json({ message: 'Failed to fetch order status', error: error.message });
    }
};


// --- ADMIN CONTROLLER FUNCTIONS ---

/**
 * Get All Orders (Admin) with Pagination and Filtering
 */
export const getAllOrdersAdmin = async (req, res) => {
    try {
        // Note: Assumes 'protect' and 'isAdmin' middleware have run
        const filter = {};
        if (req.query.status) {
             const allowedStatuses = ['Processing', 'Pending Payment', 'Completed', 'Payment Failed', 'Cancelled'];
             const requestedStatus = req.query.status; // Already string | string[] | ParsedQs | ParsedQs[]
             // Ensure it's a string and valid
             if (typeof requestedStatus === 'string' && allowedStatuses.includes(requestedStatus)) {
                 filter.status = requestedStatus;
             } else if (typeof requestedStatus === 'string') { // Invalid status value
                 return res.status(400).json({ message: `Invalid status filter value: ${requestedStatus}` });
             } // Ignore if not a string (e.g., array)
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        const orders = await Order.find(filter)
                                 .populate('userId', 'email name username') // Populate linked user details
                                 .sort({ createdAt: -1 }) // Newest first
                                 .skip(skip)
                                 .limit(limit);

        const totalOrders = await Order.countDocuments(filter);

        console.log(`Admin ${req.user?._id} fetched ${orders.length} of ${totalOrders} orders. Filter:`, filter, `Page: ${page}, Limit: ${limit}`);

        res.status(200).json({
            orders,
            page,
            pages: Math.ceil(totalOrders / limit), // Calculate total pages
            total: totalOrders
        });

    } catch (error) {
        console.error("❌ Error fetching all orders for admin:", error);
        res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
    }
};

/**
 * Update Order Status (Admin)
 */
export const updateOrderStatusAdmin = async (req, res) => {
    try {
        // Note: Assumes 'protect' and 'isAdmin' middleware have run
        const orderId = req.params.id; // MongoDB ObjectId from URL param
        const { status } = req.body; // New status from request body

        // Define what statuses an admin can manually set
        const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled'];
        if (!status || !allowedAdminStatusUpdates.includes(status)) {
            return res.status(400).json({ message: `Invalid status provided. Allowed: ${allowedAdminStatusUpdates.join(', ')}` });
        }

        // Validate MongoDB ObjectId format
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        // Find the order by its MongoDB ID
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Optional: Add logic to prevent certain transitions, e.g., reopening a completed order
        if ((order.status === 'Completed' || order.status === 'Cancelled') && order.status !== status ) {
             console.warn(`Admin ${req.user?._id} attempting to update already finalized order ${orderId} from ${order.status} to ${status}.`);
             // return res.status(400).json({ message: `Order is already finalized as ${order.status}. Cannot change to ${status}.` });
        }

        // Update the status
        console.log(`Admin ${req.user?._id} attempting to update order ${orderId} status from '${order.status}' to '${status}'.`);
        order.status = status;

        // If admin marks Completed, potentially update paymentStatus for consistency?
        if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') {
             console.log(`Admin Update - Order ${orderId}: Marking Completed, also setting paymentStatus to COMPLETED.`);
             order.paymentStatus = 'COMPLETED'; // Align paymentStatus
        }
        // If moving back to Processing or marking Completed, clear previous errors
        if (status === 'Processing' || status === 'Completed') {
            order.errorMessage = null;
        }

        // Save the updated order
        const updatedOrder = await order.save();

        console.log(`Admin ${req.user?._id} successfully updated order ${orderId} status to ${status}`);
        // Return the updated order document (excluding sensitive fields if needed)
        const responseOrder = updatedOrder.toObject();
        // delete responseOrder.paymentStatus; // Example
        res.status(200).json(responseOrder);

    } catch (error) {
        console.error(`❌ Error updating order status for order ${req.params.id} by admin ${req.user?._id}:`, error);
        if (error.name === 'CastError') { // Handle Mongoose ID format errors
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }
        if (error.name === 'ValidationError') { // Handle potential validation errors on save
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: "Order update validation failed", details: messages });
        }
        res.status(500).json({ message: 'Failed to update order status', error: error.message });
    }
};