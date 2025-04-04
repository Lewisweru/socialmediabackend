// controllers/orderController.js (Standard JavaScript)

import Order from '../models/Order.js'; // Adjust path to your Order model
import User from '../models/User.js';   // Adjust path to your User model (needed for user details)
import { PesapalService } from '../services/pesapal.js'; // Adjust path to your Pesapal service
import { v4 as uuidv4 } from 'uuid'; // To generate unique order IDs
import mongoose from 'mongoose'; // Needed for ObjectId validation

// --- Pesapal Service Initialization ---
// Ensure ENV variables are loaded (e.g., using dotenv) before this file is imported
if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
  console.error("FATAL ERROR: Pesapal consumer key and secret must be defined in environment variables.");
  process.exit(1); // Exit if keys are missing
}
const pesapalService = new PesapalService(
  process.env.PESAPAL_CONSUMER_KEY,
  process.env.PESAPAL_CONSUMER_SECRET,
  process.env.NODE_ENV !== 'production' // Use sandbox unless NODE_ENV is 'production'
);
// --- End Pesapal Service Initialization ---


// --- IPN Configuration ---
// Get Registered IPN ID from ENV or use a placeholder (replace with your actual ID)
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID;
if (!REGISTERED_IPN_ID) {
    console.warn("Warning: PESAPAL_IPN_ID environment variable not set. IPN may not function correctly.");
    // Consider adding a fallback or throwing an error if IPN is critical
}
// Construct expected IPN URL for logging/reference (optional)
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
  const pesapalOrderId = uuidv4(); // Generate unique ID for this transaction attempt

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
    // Construct name carefully
    const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Customer'} ${req.user?.lastName || 'User'}`;

    // 3. Validate incoming data and configuration
    if (!userId) {
        console.error("[Initiate Order] Error: Missing User ID in req.user");
        return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
    }
    if (!userEmail || !userName) {
        console.error(`[Initiate Order] Error: Incomplete user details for user ${userId}`);
        return res.status(401).json({ message: 'User details incomplete.' });
    }
    if (!platform || !service || !quality || !accountLink || !quantity || quantity <= 0 || !amount || amount <= 0 || !callbackUrl) {
        console.error(`[Initiate Order] Error: Missing required body params for user ${userId}`, req.body);
        return res.status(400).json({ message: 'Missing or invalid required order details.' });
    }
     if (!REGISTERED_IPN_ID) {
       console.error("[Initiate Order] Error: Server Misconfiguration - PESAPAL_IPN_ID is not set.");
       return res.status(500).json({ message: 'Server configuration error [IPN].' });
     }

    // 4. Create Order document data
    const orderDescription = description || `${quantity} ${quality} ${platform} ${service}`;
    const orderData = {
      pesapalOrderId, // Use the generated UUID as our reference for Pesapal
      userId,
      platform,
      service,
      quality,
      accountLink,
      quantity,
      amount,
      currency,
      description: orderDescription,
      status: 'Pending Payment', // Initial status
      paymentStatus: 'PENDING', // Initial Pesapal status assumption
      callbackUrlUsed: callbackUrl,
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
      // phone_number: req.user.phone || '', // Optional
      // country_code: req.user.countryCode || '' // Optional
    };
    const pesapalOrderResponse = await pesapalService.registerOrder(
      token, pesapalOrderId, amount, currency, orderDescription,
      callbackUrl, customerDetails, REGISTERED_IPN_ID
    );
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration API response:`, pesapalOrderResponse);

    // 7. Update local order with Pesapal Tracking ID
    if (pesapalOrderResponse?.order_tracking_id) {
      savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
      // Save again to store the tracking ID
      await savedOrder.save(); // Consider combining with initial save if possible, or handle potential failure here
      console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Updated with Pesapal Tracking ID: ${savedOrder.pesapalTrackingId}`);
    } else {
       // Log warning if tracking ID is missing but proceed if redirect URL is present
       console.warn(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal response did not contain order_tracking_id.`);
    }

    // 8. Check for Redirect URL and respond to frontend
    if (!pesapalOrderResponse?.redirect_url) {
        // If registration failed critically (no redirect URL)
        savedOrder.status = 'Payment Failed';
        savedOrder.paymentStatus = 'FAILED';
        savedOrder.errorMessage = 'Pesapal registration did not return a redirect URL.';
        await savedOrder.save(); // Attempt to save failure status
        console.error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] CRITICAL ERROR: Pesapal registration failed. No redirect URL.`);
        throw new Error('Pesapal did not provide a payment redirect URL.'); // Caught by outer catch block
    }

    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Successfully initiated. Returning redirect URL.`);
    res.status(200).json({
      redirectUrl: pesapalOrderResponse.redirect_url,
      orderTrackingId: pesapalOrderResponse.order_tracking_id,
      orderId: savedOrder._id // Internal DB ID
    });

  } catch (error) {
    console.error(`❌ Error during order initiation for PesaPal Ref ${pesapalOrderId}:`, error);
    // If an order document was created but something failed afterwards, mark it as failed
    if (savedOrder && savedOrder.status === 'Pending Payment') {
        try {
             savedOrder.status = 'Payment Failed';
             savedOrder.paymentStatus = 'FAILED';
             savedOrder.errorMessage = `Payment initiation failed: ${error.message}`;
             await savedOrder.save();
             console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Marked as Payment Failed due to error during initiation.`);
        } catch (saveError) {
             console.error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] FAILED to update status after initiation error:`, saveError);
        }
    }
    // Handle Mongoose Validation Errors specifically
    if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: "Order data validation failed", details: messages });
    }
    // Send generic error for other cases
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

  console.log(`--- Received IPN [${new Date().toISOString()}] ---`);
  console.log(`Body:`, JSON.stringify(ipnBody, null, 2));
  console.log(`Extracted: TrackingID='${orderTrackingId}', Type='${notificationType}', MerchantRef='${merchantReference}'`);

  // Validate required fields and IPN type
  if (!orderTrackingId || notificationType !== 'IPNCHANGE' || !merchantReference) {
    console.error(`[IPN Validation Error] Missing required fields or incorrect Type ('${notificationType}' != 'IPNCHANGE'). Ref: ${merchantReference}`);
    return res.status(400).json({
        orderNotificationType: notificationType, orderTrackingId: orderTrackingId,
        orderMerchantReference: merchantReference, status: 500 // Error code for Pesapal
    });
  }

  let order = null;

  try {
    // Find the corresponding order using our pesapalOrderId (Merchant Reference)
    console.log(`[IPN Processing - Ref ${merchantReference}] Searching for Order with pesapalOrderId: ${merchantReference}`);
    try {
        order = await Order.findOne({ pesapalOrderId: merchantReference });
    } catch (dbError) {
        console.error(`[IPN DB Error - Ref ${merchantReference}] Error finding order:`, dbError);
        return res.status(500).json({ status: 500, /* ... other fields ... */ }); // Respond error to Pesapal
    }

    if (!order) {
      console.error(`[IPN Processing Error - Ref ${merchantReference}] Order not found in DB.`);
      return res.status(404).json({ status: 500, /* ... other fields ... */ }); // Respond error to Pesapal
    }
    console.log(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}. Current DB Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);

    // Query Pesapal for the actual transaction status using the OrderTrackingId
    let transactionStatusData;
    try {
        console.log(`[IPN Processing - Order ${order._id}] Querying Pesapal status using Tracking ID: ${orderTrackingId}`);
        const token = await pesapalService.getOAuthToken();
        transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
        console.log(`[IPN Processing - Order ${order._id}] Pesapal status response:`, transactionStatusData);
    } catch (statusError) {
         console.error(`[IPN Status Query Error - Order ${order._id}] Failed to query Pesapal status:`, statusError);
         // Respond error to Pesapal - indicates failure to confirm status
         return res.status(500).json({ status: 500, /* ... other fields ... */ });
    }

    // Process the status update based on the *fetched* status description
    const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
    let internalStatusUpdate = order.status; // Start with current status
    let shouldSave = false; // Flag if DB update is needed
    let newErrorMessage = order.errorMessage; // Preserve existing error message unless overwritten

    console.log(`[IPN Processing - Order ${order._id}] Fetched Pesapal Status: '${fetchedPesapalStatus}'. Comparing with DB...`);

    // Always update the stored Pesapal status if it's different or currently null
    if (order.paymentStatus !== fetchedPesapalStatus && fetchedPesapalStatus !== 'UNKNOWN') {
        console.log(`[IPN - Order ${order._id}] Updating paymentStatus from '${order.paymentStatus}' to '${fetchedPesapalStatus}'`);
        order.paymentStatus = fetchedPesapalStatus;
        shouldSave = true;
    }

    // Determine if *our internal* status needs changing, primarily if it's still Pending
    if (order.status === 'Pending Payment') {
        switch (fetchedPesapalStatus) {
            case 'COMPLETED':
                internalStatusUpdate = 'Processing'; // Move to active state
                newErrorMessage = null; // Clear any previous errors
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched status COMPLETED. Setting Internal Status to 'Processing'.`);
                // ----- !!! TRIGGER SERVICE DELIVERY LOGIC HERE !!! -----
                break;
            case 'FAILED':
                internalStatusUpdate = 'Payment Failed';
                newErrorMessage = transactionStatusData?.description || 'Payment Failed via Pesapal Status Check.';
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched status FAILED. Setting Internal Status to 'Payment Failed'.`);
                break;
            case 'INVALID':
            case 'REVERSED':
                internalStatusUpdate = 'Cancelled'; // Or 'Refunded' etc.
                newErrorMessage = `Payment status ${fetchedPesapalStatus} fetched. ${transactionStatusData?.description || ''}`.trim();
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched status ${fetchedPesapalStatus}. Setting Internal Status to 'Cancelled'.`);
                break;
            case 'PENDING':
                 console.log(`[IPN Info - Order ${order._id}] Fetched status PENDING. Internal status remains 'Pending Payment'.`);
                 break;
            default:
                 console.warn(`[IPN Info - Order ${order._id}] Received unhandled fetched status: '${fetchedPesapalStatus}'.`);
        }
        // Apply the determined internal status update
        if (order.status !== internalStatusUpdate) {
            order.status = internalStatusUpdate;
            order.errorMessage = newErrorMessage;
            console.log(`[IPN Update - Order ${order._id}] Internal status changed to '${order.status}'.`);
            shouldSave = true; // Ensure save happens if internal status changes
        }
    } else {
        // If internal status is already Processing, Completed, Failed, etc.
        console.log(`[IPN Info - Order ${order._id}] Internal status is already '${order.status}'. Only updating paymentStatus if changed.`);
    }

    // Save if any changes were flagged
    if (shouldSave) {
      console.log(`[IPN Processing - Order ${order._id}] Attempting to save DB changes...`);
      try {
        await order.save();
        console.log(`[IPN Processed - Order ${order._id}] Save successful. Final Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);
      } catch (saveError) {
        console.error(`[IPN Save Error - Order ${order._id}] FAILED TO SAVE DB update:`, saveError);
        return res.status(500).json({ /* ... Respond JSON error to Pesapal ... */ status: 500 });
      }
    } else {
      console.log(`[IPN Info - Order ${order._id}] No database changes required saving.`);
    }

    // Acknowledge IPN Receipt to Pesapal using required JSON format
    const responseJson = {
        orderNotificationType: notificationType, // Echo back received type
        orderTrackingId: orderTrackingId,
        orderMerchantReference: merchantReference,
        status: 200 // Indicate successful *processing* of the IPN by your server
    };
    console.log(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(responseJson)}`);
    res.status(200).json(responseJson); // Send JSON 200 OK

  } catch (error) {
    console.error(`❌ Unhandled Error processing IPN for MerchantRef ${merchantReference}:`, error);
    // Send JSON error response
    res.status(500).json({
         orderNotificationType: notificationType, orderTrackingId: orderTrackingId,
         orderMerchantReference: merchantReference, status: 500
    });
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
           Order.countDocuments({ userId: userId, status: 'Processing' }), // 'Processing' is Active
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
        const limit = parseInt(req.query.limit) || 10; // Default 10 per page
        const skip = (page - 1) * limit;

        const orders = await Order.find({ userId: userId })
                                   .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId') // Exclude sensitive/redundant fields
                                   .sort({ createdAt: -1 }) // Newest first
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
        const orderId = req.params.id; // MongoDB ObjectId

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        // Find order by its MongoDB ID AND ensure it belongs to the requesting user
        const order = await Order.findOne({ _id: orderId, userId: userId });

        if (!order) {
            console.log(`Order details not found or access denied for Order ID ${orderId}, User ${userId}`);
            return res.status(404).json({ message: 'Order not found or access denied.' });
        }

        console.log(`Fetched details for Order ID ${orderId}`);
        // Decide which fields to return - maybe exclude paymentStatus?
        const orderResponse = order.toObject();
        // delete orderResponse.paymentStatus; // Example exclusion
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

        // Find order using the pesapalOrderId field
        const order = await Order.findOne({ pesapalOrderId: merchantRef })
                                 .select('status paymentStatus _id'); // Only select needed fields

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
        const filter = {};
        if (req.query.status) {
             const allowedStatuses = ['Processing', 'Pending Payment', 'Completed', 'Payment Failed', 'Cancelled'];
             const requestedStatus = req.query.status;
             if (allowedStatuses.includes(requestedStatus)) {
                 filter.status = requestedStatus;
             } else {
                 return res.status(400).json({ message: 'Invalid status filter value.' });
             }
        }
        // Add more filters based on query params if needed (e.g., email, date range)

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25; // Admin might see more per page
        const skip = (page - 1) * limit;

        const orders = await Order.find(filter)
                                 .populate('userId', 'email name username') // Populate user details
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
        const orderId = req.params.id; // MongoDB ObjectId
        const { status } = req.body; // Expecting { status: 'Completed' | 'Processing' | 'Cancelled' }

        // Define what statuses an admin can manually set
        const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled'];
        if (!status || !allowedAdminStatusUpdates.includes(status)) {
            return res.status(400).json({ message: `Invalid status provided. Allowed: ${allowedAdminStatusUpdates.join(', ')}` });
        }

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        // Find the order by its MongoDB ID
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Optional: Add logic to prevent certain transitions if needed
        // e.g., prevent changing status if already 'Completed' or 'Cancelled'
        if ((order.status === 'Completed' || order.status === 'Cancelled') && order.status !== status ) {
             console.warn(`Admin ${req.user?._id} attempting to update already finalized order ${orderId} from ${order.status} to ${status}.`);
             // return res.status(400).json({ message: `Order is already finalized as ${order.status}.` }); // Uncomment to prevent
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


        const updatedOrder = await order.save();

        console.log(`Admin ${req.user?._id} successfully updated order ${orderId} status to ${status}`);
        res.status(200).json(updatedOrder); // Return the updated order document

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