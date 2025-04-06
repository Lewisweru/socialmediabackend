// controllers/orderController.js (Standard JavaScript - Full)

import Order from '../models/Order.js'; // Adjust path to your Order model
import User from '../models/User.js';   // Adjust path to your User model (needed if populating)
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
    console.warn("Warning: PESAPAL_IPN_ID environment variable not set. IPN may not function correctly. Ensure it's set in your environment.");
    // Consider throwing an error or using a default *only* for non-production if IPN is critical
    // if (process.env.NODE_ENV === 'production') {
    //    console.error("FATAL ERROR: PESAPAL_IPN_ID must be set in production.");
    //    process.exit(1);
    // }
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
  const pesapalOrderId = uuidv4(); // Generate unique ID for this transaction attempt (Merchant Ref)

  try {
    // 1. Extract data from request body
    const {
      platform, service, quality, accountLink, quantity, // Order details
      amount, currency = 'KES', description, // Payment details
      callbackUrl // Frontend callback URL
    } = req.body;

    // 2. Get user details from request (populated by 'protect' middleware)
    const userId = req.user?._id; // Mongoose ObjectId as string or object depending on middleware
    const userEmail = req.user?.email;
    // Construct name carefully, handle potential missing fields
    const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;

    // 3. Validate incoming data and configuration
    if (!userId) {
        console.error("[Initiate Order] Error: Missing User ID in req.user. Middleware 'protect' might have failed.");
        return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
    }
    if (!userEmail || !userName) {
        console.error(`[Initiate Order] Error: Incomplete user details (email/name) for user ${userId}. User object:`, req.user);
        return res.status(401).json({ message: 'User details incomplete.' });
    }
    if (!platform || !service || !quality || !accountLink || !quantity || quantity <= 0 || !amount || amount <= 0 || !callbackUrl) {
        console.error(`[Initiate Order] Error: Missing required body params for user ${userId}`, req.body);
        return res.status(400).json({ message: 'Missing or invalid required order details.' });
    }
     if (!REGISTERED_IPN_ID) {
       console.error("[Initiate Order] Error: Server Misconfiguration - PESAPAL_IPN_ID environment variable is not set.");
       return res.status(500).json({ message: 'Server configuration error [IPN]. Please contact support.' });
     }

    // 4. Create Order document data - Ensure data types match schema
    const orderDescription = description || `${quantity} ${quality} ${platform} ${service}`;
    const orderData = {
      pesapalOrderId, // Use the generated UUID as our reference for Pesapal
      userId: String(userId), // Ensure userId is stored as string if Schema expects String _id
      platform: String(platform),
      service: String(service),
      quality: String(quality),
      accountLink: String(accountLink),
      quantity: Number(quantity), // Ensure number
      amount: Number(parseFloat(amount).toFixed(2)), // Ensure number, format to 2 decimal places
      currency: String(currency),
      description: String(orderDescription).substring(0, 100), // Ensure string, limit length
      status: 'Pending Payment', // Initial status
      paymentStatus: 'PENDING', // Initial Pesapal status assumption
      callbackUrlUsed: String(callbackUrl),
      // Initialize other fields if needed (pesapalTrackingId: null, errorMessage: null etc.)
    };

    // 5. Save Order to Database
    console.log(`[Order Initiate - Ref ${pesapalOrderId}] Attempting to save order to DB for user ${userId}... Data:`, orderData);
    savedOrder = new Order(orderData);
    await savedOrder.save(); // Mongoose validation based on models/Order.js schema happens here
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created successfully in DB. Status: Pending Payment.`);

    // 6. Register order with Pesapal
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Fetching Pesapal token...`);
    const token = await pesapalService.getOAuthToken();
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal token obtained. Registering order with Pesapal...`);
    // Prepare customer details for Pesapal
    const customerDetails = {
      firstName: userName.split(' ')[0] || 'Valued', // Ensure defaults if split fails
      lastName: userName.split(' ').slice(1).join(' ') || 'Customer',
      email: userEmail,
      // phone_number: req.user.phone || '', // Optional: Add if available on req.user
      // country_code: req.user.countryCode || '' // Optional: Add if available on req.user
    };
    // Call Pesapal service to register the order
    const pesapalOrderResponse = await pesapalService.registerOrder(
      token,
      pesapalOrderId,        // Our unique reference
      orderData.amount,      // Amount
      orderData.currency,    // Currency
      orderData.description, // Description
      orderData.callbackUrlUsed, // Frontend callback
      customerDetails,       // Customer info
      REGISTERED_IPN_ID      // Our registered IPN ID
    );
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration API response received:`, pesapalOrderResponse);

    // 7. Update local order with Pesapal Tracking ID from the response
    if (pesapalOrderResponse?.order_tracking_id) {
      savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
      await savedOrder.save(); // Save the tracking ID back to the order document
      console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Updated DB with Pesapal Tracking ID: ${savedOrder.pesapalTrackingId}`);
    } else {
       console.warn(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration response did not contain order_tracking_id. IPN might rely solely on MerchantRef.`);
    }

    // 8. Check for Redirect URL and respond to frontend
    if (!pesapalOrderResponse?.redirect_url) {
        // This is a critical failure if Pesapal accepts the order but gives no redirect URL
        savedOrder.status = 'Payment Failed';
        savedOrder.paymentStatus = 'FAILED';
        savedOrder.errorMessage = 'Pesapal registration did not return a payment redirect URL.';
        await savedOrder.save(); // Attempt to save failure status
        console.error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] CRITICAL ERROR: Pesapal registration failed. No redirect URL returned.`);
        // Throw error to be caught by the outer catch block
        throw new Error('Pesapal did not provide a payment redirect URL. Order marked as Failed.');
    }

    // Success: Send redirect URL and IDs back to the frontend
    console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Initiation successful. Returning redirect URL to frontend.`);
    res.status(200).json({
      redirectUrl: pesapalOrderResponse.redirect_url,
      orderTrackingId: pesapalOrderResponse.order_tracking_id, // Pass tracking ID if available
      orderId: savedOrder._id // Internal DB ID might be useful for frontend reference
    });

  } catch (error) { // Catch errors from any await call above
    console.error(`❌ Error during order initiation for PesaPal Ref ${pesapalOrderId}:`, error);
    // If an order document was successfully created but Pesapal steps failed, mark it as failed
    if (savedOrder && savedOrder.status === 'Pending Payment') {
        try {
             savedOrder.status = 'Payment Failed';
             savedOrder.paymentStatus = 'FAILED'; // Assume payment failed if initiation couldn't complete
             savedOrder.errorMessage = `Payment initiation failed: ${error.message}`;
             await savedOrder.save();
             console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Marked as Payment Failed due to error during initiation process.`);
        } catch (saveError) {
             // Log error if updating the status fails
             console.error(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] FAILED to update order status to Payment Failed after an initiation error:`, saveError);
        }
    }
    // Handle specific error types if needed
    if (error.name === 'ValidationError') { // Mongoose validation error during save
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: "Order data validation failed", details: messages });
    }
    // Send generic server error for other cases
    res.status(500).json({ message: 'Failed to initiate payment process.', error: error.message });
  }
};


/**
 * @desc    Handle Pesapal IPN (Instant Payment Notification) - REVISED FOR v3 STATUS CHECK
 * @route   POST /api/orders/ipn
 * @access  Public (Called directly by Pesapal)
 */
export const handleIpn = async (req, res) => {
  const ipnBody = req.body || {}; // Default to empty object if body is undefined/null
  // Extract fields, default to empty strings if missing
  const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
  const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
  const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || ''; // This is our pesapalOrderId

  // Prepare response structure EARLY, default to error
  const ipnResponse = {
      orderNotificationType: notificationType,
      orderTrackingId: orderTrackingId,
      orderMerchantReference: merchantReference,
      status: 500 // Default to error - explicitly set to 200 on successful processing
  };

  // --- Log Received IPN ---
  console.log(`--- Received IPN [${new Date().toISOString()}] ---`);
  console.log(`Raw Body:`, JSON.stringify(ipnBody, null, 2));
  console.log(`Extracted: TrackingID='${orderTrackingId}', Type='${notificationType}', MerchantRef='${merchantReference}'`);
  // --- End Logging ---


  // --- Validate IPN Payload ---
  // Check required fields and ensure type is 'IPNCHANGE'
  if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) {
    console.error(`[IPN Validation Error] Missing required fields or incorrect Type ('${notificationType}' != 'IPNCHANGE'). Ref: ${merchantReference}`);
    // Respond 200 OK with JSON body indicating error (as per Pesapal docs)
    return res.status(200).json(ipnResponse);
  }
  // --- End Validation ---

  let order = null; // Define order variable to track DB document

  try {
    // --- Find the corresponding order in our DB using Merchant Reference ---
    console.log(`[IPN Processing - Ref ${merchantReference}] Searching for Order with pesapalOrderId: ${merchantReference}`);
    try {
        // Find the order matching the unique Pesapal Order ID (Merchant Reference)
        order = await Order.findOne({ pesapalOrderId: merchantReference });
    } catch (dbError) {
        console.error(`[IPN DB Error - Ref ${merchantReference}] Error finding order in MongoDB:`, dbError);
        // Respond 200 OK / JSON status 500 - signifies internal server error during DB lookup
        return res.status(200).json(ipnResponse);
    }

    // Check if order was found
    if (!order) {
      console.error(`[IPN Processing Error - Ref ${merchantReference}] Order not found in DB.`);
      ipnResponse.status = 404; // Use internal status to indicate not found
      // Respond 200 OK / JSON status 404/500
      return res.status(200).json(ipnResponse);
    }
    console.log(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}. Current DB Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);


    // --- Query Pesapal for Actual Transaction Status using Tracking ID ---
    let transactionStatusData;
    try {
        console.log(`[IPN Processing - Order ${order._id}] Querying Pesapal status using Tracking ID: ${orderTrackingId}`);
        const token = await pesapalService.getOAuthToken(); // Get a fresh token
        transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
        console.log(`[IPN Processing - Order ${order._id}] Pesapal status check response:`, transactionStatusData);
        // Add basic check if Pesapal response itself indicates an issue getting status
        if(transactionStatusData?.error?.message || transactionStatusData?.status !== '200') {
             console.warn(`[IPN Status Query Warning - Order ${order._id}] Pesapal GetTransactionStatus responded with internal status ${transactionStatusData?.status} or error:`, transactionStatusData?.error);
             // Decide if you should proceed or treat as failure - maybe log and exit IPN processing?
        }
    } catch (statusError) {
         console.error(`[IPN Status Query Error - Order ${order._id}] Failed to query Pesapal status:`, statusError);
         // Respond 200 OK / JSON status 500 - indicates failure to confirm payment status
         return res.status(200).json(ipnResponse);
    }


    // --- Process Status Update based on *FETCHED* status from Pesapal ---
    // Normalize the fetched status description (e.g., "COMPLETED", "FAILED")
    const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
    const fetchedPesapalDesc = transactionStatusData?.description || ''; // Get reason description if available

    let internalStatusUpdate = order.status; // Start with current internal status
    let shouldSaveChanges = false; // Flag to track if DB update is needed
    let newErrorMessage = order.errorMessage; // Preserve existing error message unless overwritten

    console.log(`[IPN Processing - Order ${order._id}] Fetched Pesapal Status Desc: '${fetchedPesapalStatus}'. Comparing with DB Statuses...`);

    // --- Update stored Pesapal payment status ---
    // Always store the latest status reported by Pesapal if it's different from what we have or if ours is null
    if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') {
        console.log(`[IPN - Order ${order._id}] Updating DB paymentStatus from '${order.paymentStatus}' to '${fetchedPesapalStatus}'`);
        order.paymentStatus = fetchedPesapalStatus;
        shouldSaveChanges = true; // Mark that we need to save the order document
    }

    // --- Determine if *our internal processing status* needs changing ---
    // This logic primarily focuses on updating from 'Pending Payment'.
    // Add more conditions here if needed (e.g., handling reversals on 'Processing' orders)
    if (order.status === 'Pending Payment') {
        switch (fetchedPesapalStatus) {
            case 'COMPLETED': // Pesapal status_code: 1
                internalStatusUpdate = 'Processing'; // Move to active state, ready for fulfillment
                newErrorMessage = null; // Clear any previous errors
                shouldSaveChanges = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched COMPLETED. Setting Internal Status to 'Processing'.`);
                // ----- !!! TRIGGER SERVICE DELIVERY LOGIC HERE !!! -----
                // This is where you would call your function/service to actually
                // deliver the followers, likes, etc.
                // Example: triggerServiceDelivery(order);
                // ---------------------------------------------------------
                break;
            case 'FAILED': // Pesapal status_code: 2
                internalStatusUpdate = 'Payment Failed';
                newErrorMessage = fetchedPesapalDesc || 'Payment Failed (reported by Pesapal)';
                shouldSaveChanges = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched FAILED. Setting Internal Status to 'Payment Failed'. Reason: ${newErrorMessage}`);
                break;
            case 'INVALID': // Pesapal status_code: 0
            case 'REVERSED': // Pesapal status_code: 3
                internalStatusUpdate = 'Cancelled'; // Map these to Cancelled in our system
                newErrorMessage = `Payment status ${fetchedPesapalStatus}. ${fetchedPesapalDesc || ''}`.trim();
                shouldSaveChanges = true;
                console.log(`[IPN Update - Order ${order._id}] Fetched ${fetchedPesapalStatus}. Setting Internal Status to 'Cancelled'.`);
                break;
            case 'PENDING':
                 // If Pesapal *still* reports pending, no change needed for our internal status yet.
                 console.log(`[IPN Info - Order ${order._id}] Fetched status PENDING. Internal status remains 'Pending Payment'.`);
                 break;
            default: // Includes UNKNOWN or other unexpected values
                 console.warn(`[IPN Info - Order ${order._id}] Received unhandled fetched payment_status_description: '${fetchedPesapalStatus}'. No internal status change based on this.`);
        }
        // Apply the determined internal status update if it differs from current
        if (order.status !== internalStatusUpdate) {
            order.status = internalStatusUpdate;
            order.errorMessage = newErrorMessage; // Update error message too
            console.log(`[IPN Update - Order ${order._id}] Internal status has been changed to '${order.status}'.`);
            shouldSaveChanges = true; // Ensure save flag is set if internal status changes
        }
    } else {
        // If the order in our DB is already Processing, Completed, Failed, etc.
        // We generally don't revert status based on IPN, but we did update paymentStatus above if it changed.
        console.log(`[IPN Info - Order ${order._id}] Internal status is already '${order.status}'. Not changing internal status based on fetched status '${fetchedPesapalStatus}'. (Updated paymentStatus only if different).`);
    }

    // --- Save Updated Order to DB If Necessary ---
    if (shouldSaveChanges) {
      console.log(`[IPN Processing - Order ${order._id}] Changes detected, attempting to save DB document...`);
      try {
        await order.save(); // Save all accumulated changes
        console.log(`[IPN Processed - Order ${order._id}] Save successful. Final Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);
        ipnResponse.status = 200; // Indicate successful processing in JSON response to Pesapal
      } catch (saveError) {
        console.error(`[IPN Save Error - Order ${order._id}] FAILED TO SAVE DB update:`, saveError);
        ipnResponse.status = 500; // Indicate error in JSON response
        return res.status(200).json(ipnResponse); // Still respond HTTP 200 OK to Pesapal
      }
    } else {
      console.log(`[IPN Info - Order ${order._id}] No database changes were required saving.`);
      ipnResponse.status = 200; // Mark successful processing (even if no-op) in JSON response
    }

    // --- Acknowledge IPN Receipt to Pesapal using JSON ---
    console.log(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`);
    // Respond with HTTP 200 and the required JSON body
    res.status(200).json(ipnResponse);

  } catch (error) {
    console.error(`❌ Unhandled Error processing IPN for MerchantRef ${merchantReference}:`, error);
    ipnResponse.status = 500; // Set error status in JSON response
    // As per Pesapal docs, still respond HTTP 200 but indicate error in JSON body
    res.status(200).json(ipnResponse);
  }
};

/**
 * Get Order Stats for Dashboard (User)
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
    console.log("[getUserOrders] Function called.");
    try {
        const userId = req.user?._id;
        if (!userId) {
             return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }

        // Basic validation for pagination parameters
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 10;
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100; // Max limit
        const skip = (page - 1) * limit;

        console.log(`[getUserOrders] Fetching orders for user ${userId}, Page: ${page}, Limit: ${limit}`);

        // Query orders and total count concurrently
        const [orders, totalOrders] = await Promise.all([
            Order.find({ userId: userId })
                 .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId') // Exclude fields
                 .sort({ createdAt: -1 }) // Newest first
                 .skip(skip)
                 .limit(limit)
                 .lean(), // Use .lean() for performance if not modifying docs
            Order.countDocuments({ userId: userId })
        ]);


        console.log(`[getUserOrders] Found ${orders.length} orders for user ${userId} on page ${page}. Total: ${totalOrders}`);
        res.status(200).json({
            orders,
            page,
            pages: Math.ceil(totalOrders / limit), // Total pages
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
    console.log("[getOrderDetails] Function called.");
    try {
        const userId = req.user?._id;
        const orderId = req.params.id; // MongoDB ObjectId from URL

        if (!userId) {
             return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             console.log(`[getOrderDetails] Invalid Order ID format received: ${orderId}`);
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        console.log(`[getOrderDetails] Fetching order ${orderId} for user ${userId}`);
        // Find order by ID and ensure it belongs to the requesting user
        const order = await Order.findOne({ _id: orderId, userId: userId });

        if (!order) {
            console.log(`[getOrderDetails] Order ${orderId} not found or access denied for user ${userId}.`);
            return res.status(404).json({ message: 'Order not found or access denied.' });
        }

        console.log(`[getOrderDetails] Successfully fetched details for Order ID ${orderId}`);
        res.status(200).json(order); // Return the full order document

    } catch (error) {
        console.error(`❌ Error fetching order details for Order ID ${req.params.id}, User ${req.user?._id}:`, error);
        res.status(500).json({ message: 'Failed to fetch order details', error: error.message });
    }
};

/**
 * Get Order Status by Merchant Reference (for Callback Page)
 */
export const getOrderStatusByReference = async (req, res) => {
    console.log("[getOrderStatusByReference] Function called.");
    try {
        const { merchantRef } = req.params; // This is our pesapalOrderId (UUID)
        console.log(`[getOrderStatusByReference] Received MerchantRef: ${merchantRef}`);

        if (!merchantRef) {
            console.error("[getOrderStatusByReference] Error: Missing merchantRef.");
            return res.status(400).json({ message: 'Order reference is required.' });
        }

        // Find order using the pesapalOrderId field
        const order = await Order.findOne({ pesapalOrderId: merchantRef })
                                 .select('status paymentStatus _id'); // Select only necessary fields

        if (!order) {
            console.log(`[getOrderStatusByReference] Order not found for MerchantRef ${merchantRef}`);
            return res.status(404).json({ message: 'Order not found.' });
        }

        console.log(`[getOrderStatusByReference] Status check success for MerchantRef ${merchantRef}: DB Status='${order.status}', Payment Status='${order.paymentStatus}'`);
        res.status(200).json({
            status: order.status, // Our internal status
            paymentStatus: order.paymentStatus, // Pesapal's last reported status
            orderId: order._id, // Our internal ID
        });

    } catch (error) {
        console.error(`❌ Error fetching order status by reference ${req.params.merchantRef}:`, error);
        res.status(500).json({ message: 'Failed to fetch order status', error: error.message });
    }
};


// =============================================
// == ADMIN CONTROLLER FUNCTIONS ===============
// =============================================

/**
 * Get All Orders (Admin) with Pagination and Filtering
 */
export const getAllOrdersAdmin = async (req, res) => {
    console.log(`[getAllOrdersAdmin] Function called by Admin: ${req.user?._id}`);
    try {
        // --- Filtering ---
        const filter = {}; // Initialize empty filter object
        if (req.query.status) {
             const allowedStatuses = ['Processing', 'Pending Payment', 'Completed', 'Payment Failed', 'Cancelled', 'Expired', 'Supplier Error']; // Add all relevant statuses
             const requestedStatus = req.query.status;
             if (typeof requestedStatus === 'string' && allowedStatuses.includes(requestedStatus)) {
                 filter.status = requestedStatus;
             } else if (typeof requestedStatus === 'string') {
                 console.warn(`[getAllOrdersAdmin] Invalid status filter value received: ${requestedStatus}`);
                 return res.status(400).json({ message: `Invalid status filter value: ${requestedStatus}` });
             }
        }

        // --- Pagination ---
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 25;
        if (page < 1) page = 1;
        if (limit < 1) limit = 10;
        if (limit > 100) limit = 100; // Sensible max limit
        const skip = (page - 1) * limit;

        console.log(`[getAllOrdersAdmin] Querying orders. Filter: ${JSON.stringify(filter)}, Page: ${page}, Limit: ${limit}`);

        // --- Query Database ---
        // Run find and count in parallel
        const [orders, totalOrders] = await Promise.all([
            Order.find(filter)
                 .populate('userId', 'email name username') // Populate basic user info
                 .sort({ createdAt: -1 }) // Newest first
                 .skip(skip)
                 .limit(limit)
                 .lean(), // Use lean for performance in read-only lists
             Order.countDocuments(filter) // Count documents matching the filter
        ]);

        console.log(`[getAllOrdersAdmin] Found ${orders.length} orders on page ${page}. Total matching filter: ${totalOrders}.`);

        // --- Send Response ---
        res.status(200).json({
            orders,
            page,
            pages: Math.ceil(totalOrders / limit), // Total pages
            total: totalOrders
        });

    } catch (error) {
        console.error(`❌ Error fetching all orders for admin ${req.user?._id}:`, error);
        res.status(500).json({ message: 'Failed to fetch orders', error: error.message });
    }
};

/**
 * Update Order Status (Admin)
 */
export const updateOrderStatusAdmin = async (req, res) => {
    const orderId = req.params.id; // MongoDB ObjectId from URL param
    const adminUserId = req.user?._id;
    console.log(`[updateOrderStatusAdmin] Request received from Admin: ${adminUserId} for Order ID: ${orderId}`);

    try {
        const { status } = req.body; // New status from request body

        // Define statuses admin can set
        const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled'];
        if (!status || !allowedAdminStatusUpdates.includes(status)) {
            console.error(`[updateOrderStatusAdmin] Invalid target status '${status}' provided by Admin ${adminUserId}.`);
            return res.status(400).json({ message: `Invalid target status provided. Allowed: ${allowedAdminStatusUpdates.join(', ')}` });
        }

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
             console.error(`[updateOrderStatusAdmin] Invalid Order ID format: ${orderId}`);
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }

        // Find the order
        const order = await Order.findById(orderId);
        if (!order) {
            console.log(`[updateOrderStatusAdmin] Order ${orderId} not found.`);
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Prevent unnecessary updates or invalid transitions
        if (order.status === status) {
            console.log(`[updateOrderStatusAdmin] Order ${orderId} is already in status '${status}'. No update needed.`);
            return res.status(200).json(order); // Return current order as no change occurred
        }
        if ((order.status === 'Completed' || order.status === 'Cancelled') && status !== order.status) {
             console.warn(`[updateOrderStatusAdmin] Admin ${adminUserId} attempted to change finalized order ${orderId} from '${order.status}' to '${status}'.`);
             // Decide whether to allow this or return an error
             // return res.status(400).json({ message: `Order is already finalized as ${order.status}. Cannot change to ${status}.` });
        }

        // Log the change and update
        console.log(`[updateOrderStatusAdmin] Admin ${adminUserId} changing order ${orderId} status from '${order.status}' to '${status}'.`);
        const oldStatus = order.status;
        order.status = status;

        // Align paymentStatus if admin marks Completed
        if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') {
             console.log(`[updateOrderStatusAdmin - Order ${orderId}] Aligning paymentStatus to COMPLETED.`);
             order.paymentStatus = 'COMPLETED';
        }
        // Clear errors if moving to Processing or Completed
        if ((status === 'Processing' || status === 'Completed') && order.errorMessage) {
            console.log(`[updateOrderStatusAdmin - Order ${orderId}] Clearing error message.`);
            order.errorMessage = null;
        }

        // Save the updated document
        const updatedOrder = await order.save();

        console.log(`[updateOrderStatusAdmin] Admin ${adminUserId} successfully updated order ${orderId} status to ${status}.`);
        res.status(200).json(updatedOrder); // Return the full updated order document

    } catch (error) {
        console.error(`❌ Error updating order status for order ${orderId} by admin ${adminUserId}:`, error);
        if (error.name === 'CastError') {
             return res.status(400).json({ message: 'Invalid Order ID format.' });
        }
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: "Order update validation failed", details: messages });
        }
        res.status(500).json({ message: 'Failed to update order status', error: error.message });
    }
};