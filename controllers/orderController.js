// controllers/orderController.js
import Order from '../models/Order.js'; // Adjust path to your Order model
import User from '../models/User.js';   // Adjust path to your User model (needed for user details)
import { PesapalService } from '../services/pesapal.js'; // Adjust path to your Pesapal service
import { v4 as uuidv4 } from 'uuid'; // To generate unique order IDs

// --- Pesapal Service Initialization ---
// Ensure ENV variables are loaded (e.g., using dotenv) before this file is imported
if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
  console.error("FATAL ERROR: Pesapal consumer key and secret must be defined in environment variables.");
  process.exit(1); // Exit if keys are missing
}

// Initialize Pesapal Service (Consider making this more robust, e.g., singleton)
const pesapalService = new PesapalService(
  process.env.PESAPAL_CONSUMER_KEY,
  process.env.PESAPAL_CONSUMER_SECRET,
  process.env.NODE_ENV !== 'production' // Use sandbox unless NODE_ENV is 'production'
);

// --- IPN Configuration ---
// Get Registered IPN ID from ENV or use a placeholder (replace with your actual ID)
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID;
if (!REGISTERED_IPN_ID) {
    console.warn("Warning: PESAPAL_IPN_ID environment variable not set. IPN may not function correctly.");
    // You might need to handle this case more gracefully or provide a default if absolutely necessary for testing
}
// Construct expected IPN URL for logging/reference (optional)
const PESAPAL_IPN_URL = `${process.env.BACKEND_BASE_URL || 'http://localhost:5000'}/api/orders/ipn`;


// --- Controller Functions ---

/**
 * @desc    Initiate a new order, save it, register with Pesapal, return redirect URL
 * @route   POST /api/orders/initiate
 * @access  Private (requires user auth via middleware)
 */
export const initiateOrderAndPayment = async (req, res) => {
  let savedOrder = null; // Keep track of the order document
  const pesapalOrderId = uuidv4(); // Generate Pesapal order ID upfront (acts as Merchant Reference)

  try {
    const {
      platform, service, quality, accountLink, quantity, // Order details
      amount, currency = 'KES', description, // Payment details
      callbackUrl // Callback URL from frontend (where user returns after payment attempt)
    } = req.body;

    // User ID and details should be attached by the 'protect' middleware
    const userId = req.user?._id;
    const userEmail = req.user?.email;
    // Construct name carefully, handling cases where it might be missing/split differently
    const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Customer'} ${req.user?.lastName || 'User'}`;

    // --- Robust Validation ---
    if (!userId) {
        console.error("Initiate Order Error: Missing User ID in req.user");
        return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
    }
    if (!userEmail || !userName) {
        console.error(`Initiate Order Error: Incomplete user details for user ${userId}`);
        return res.status(401).json({ message: 'User details incomplete.' });
    }
    if (!platform || !service || !quality || !accountLink || !quantity || quantity <= 0 || !amount || amount <= 0 || !callbackUrl) {
        console.error(`Initiate Order Error: Missing details for user ${userId}`, req.body);
      return res.status(400).json({ message: 'Missing or invalid required order details.' });
    }
     if (!REGISTERED_IPN_ID) {
       console.error("Initiate Order Error: Server Misconfiguration - PESAPAL_IPN_ID is not set.");
       return res.status(500).json({ message: 'Server configuration error [IPN].' });
     }
    // --- End Validation ---

    // 1. Create Order in our DB
    const orderDescription = description || `${quantity} ${quality} ${platform} ${service}`;
    savedOrder = new Order({
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
      status: 'Pending Payment',
      paymentStatus: 'PENDING', // Initial assumption
      callbackUrlUsed: callbackUrl,
    });

    await savedOrder.save();
    console.log(`[Order ${savedOrder._id}] Created for user ${userId}. PesaPal Order ID (Merchant Ref): ${pesapalOrderId}. Status: Pending Payment.`);

    // 2. Register order with Pesapal
    console.log(`[Order ${savedOrder._id}] Attempting to fetch Pesapal token...`);
    const token = await pesapalService.getOAuthToken();
    console.log(`[Order ${savedOrder._id}] Pesapal token obtained. Registering order...`);

    const customerDetails = {
      firstName: userName.split(' ')[0] || 'Customer', // Basic split
      lastName: userName.split(' ').slice(1).join(' ') || 'User', // Basic split
      email: userEmail,
      // Add phone_number and country_code if available on req.user and needed by Pesapal/your requirements
      // phone_number: req.user.phone || '',
      // country_code: req.user.countryCode || ''
    };

    const pesapalOrderResponse = await pesapalService.registerOrder(
      token,
      pesapalOrderId, // Use the generated UUID as Pesapal's 'id' (Merchant Reference)
      amount,
      currency,
      orderDescription, // Use the consistent description
      callbackUrl,
      customerDetails,
      REGISTERED_IPN_ID // Your registered IPN ID
    );
     console.log(`[Order ${savedOrder._id}] Pesapal registration response:`, pesapalOrderResponse);

    // 3. Update our order with Pesapal Tracking ID if received
    if (pesapalOrderResponse?.order_tracking_id) {
      savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
      await savedOrder.save();
      console.log(`[Order ${savedOrder._id}] Updated with Pesapal Tracking ID: ${savedOrder.pesapalTrackingId}`);
    } else {
       console.warn(`[Order ${savedOrder._id}] Pesapal registration response did not contain order_tracking_id.`);
    }

    // 4. Check for Redirect URL and return it
    if (!pesapalOrderResponse?.redirect_url) {
        // Mark order as failed if redirect URL is missing
        savedOrder.status = 'Payment Failed';
        savedOrder.paymentStatus = 'FAILED';
        savedOrder.errorMessage = 'Pesapal registration did not return a redirect URL.';
        await savedOrder.save();
        console.error(`[Order ${savedOrder._id}] CRITICAL ERROR: Pesapal registration failed. No redirect URL returned.`);
        // Throw error to be caught below
        throw new Error('Pesapal did not provide a payment redirect URL.');
    }

    // 5. Success: Return redirect URL and IDs to frontend
    console.log(`[Order ${savedOrder._id}] Successfully initiated. Returning redirect URL to frontend.`);
    res.status(200).json({
      redirectUrl: pesapalOrderResponse.redirect_url,
      orderTrackingId: pesapalOrderResponse.order_tracking_id, // May be null/undefined
      orderId: savedOrder._id // Our internal DB order ID
    });

  } catch (error) {
    console.error(`❌ Error initiating order and payment for PesaPal Order ID ${pesapalOrderId}:`, error);
    // If an order document was created in step 1 but subsequent steps failed, mark it as failed
    if (savedOrder && savedOrder.status === 'Pending Payment') {
        try {
             savedOrder.status = 'Payment Failed';
             savedOrder.paymentStatus = 'FAILED'; // Assume failed if initiation errored out
             savedOrder.errorMessage = `Payment initiation failed: ${error.message}`;
             await savedOrder.save();
             console.log(`[Order ${savedOrder._id}] Marked as Payment Failed due to error during initiation.`);
        } catch (saveError) {
             console.error(`[Order ${savedOrder._id}] FAILED to update status to Payment Failed after initiation error:`, saveError);
        }
    }
    // Send generic error to client
    res.status(500).json({ message: 'Failed to initiate payment process.', error: error.message });
  }
};


/**
 * @desc    Handle Pesapal IPN (Instant Payment Notification)
 * @route   POST /api/orders/ipn
 * @access  Public (Called directly by Pesapal)
 */
export const handleIpn = async (req, res) => {
  const ipnBody = req.body;
  // Extract key fields (case might vary slightly depending on Pesapal exact spec, but these are common)
  const { OrderTrackingId, OrderNotificationType, OrderMerchantReference } = ipnBody;

  // Log the full raw IPN body for debugging - VERY IMPORTANT
  console.log(`--- Received IPN [${new Date().toISOString()}] ---`);
  console.log(`Body:`, JSON.stringify(ipnBody, null, 2)); // Pretty print JSON
  console.log(`Extracted: TrackingID=${OrderTrackingId}, Type=${OrderNotificationType}, MerchantRef=${OrderMerchantReference}`);
  console.log(`Expected IPN URL: ${PESAPAL_IPN_URL}`); // Log expected URL
  console.log(`-------------------------------------------`);


  // --- Basic IPN Validation ---
  if (!OrderTrackingId || !OrderNotificationType || !OrderMerchantReference) {
    console.error(`IPN Validation Error: Missing required fields.`);
    // Respond to Pesapal indicating error, use plain text
    return res.status(400).type('text').send(`IPN Error: Missing required fields.`);
  }
  // --- End Validation ---

  try {
    // --- Find Order ---
    // Use OrderMerchantReference (our pesapalOrderId) to find the order reliably
    const order = await Order.findOne({ pesapalOrderId: OrderMerchantReference });

    if (!order) {
      console.error(`IPN Processing Error: Order not found for MerchantRef (pesapalOrderId) ${OrderMerchantReference}`);
      // Respond to Pesapal that we couldn't find the order
      return res.status(404).type('text').send(`IPN Error: Order with MerchantRef ${OrderMerchantReference} not found.`);
    }
    console.log(`[IPN for Order ${order._id}] Found order. Current Status: Internal=${order.status}, Payment=${order.paymentStatus}`);

    // Optional: Update pesapalTrackingId if it wasn't set during initiation and is present in IPN
    if (!order.pesapalTrackingId && OrderTrackingId) {
        console.log(`[IPN for Order ${order._id}] Updating missing pesapalTrackingId to ${OrderTrackingId}`);
        order.pesapalTrackingId = OrderTrackingId;
    }

    // --- Update Order Status based on IPN ---
    let updatedInternalStatus = order.status;
    const pesapalStatus = OrderNotificationType.toUpperCase(); // Normalize status from Pesapal

    // --- Idempotency Logic ---
    // Check if this status update has already been processed or is redundant
    if (order.paymentStatus === pesapalStatus && order.status !== 'Pending Payment') {
        // If Pesapal status hasn't changed AND our status is already beyond Pending, likely a duplicate IPN
        console.log(`[IPN for Order ${order._id}] Received redundant status ${pesapalStatus}. Current internal status ${order.status}. No update needed.`);
    }
    // --- Process Status Change ---
    else {
        order.paymentStatus = pesapalStatus; // Always store the latest status from Pesapal

        switch (pesapalStatus) {
          case 'COMPLETED':
            // Only change to Processing if currently Pending Payment
            // Avoid changing if it's already Completed, Processing, or Failed/Cancelled
            if (order.status === 'Pending Payment') {
                updatedInternalStatus = 'Processing'; // Set to Processing, requires further action (delivery)
                console.log(`[IPN Update - Order ${order._id}] Payment COMPLETED. Changing status to Processing.`);
                // ----- !!! IMPORTANT: Trigger Service Delivery !!! -----
                // This is where you integrate with the logic that actually delivers
                // the followers/likes/views etc. based on the order details.
                // This could be:
                // - Calling another function: await deliverService(order);
                // - Adding to a queue (Redis, RabbitMQ): queueJob('deliverOrder', { orderId: order._id });
                // - Directly updating another system's state
                // ---------------------------------------------------------

            } else {
                 console.log(`[IPN Info - Order ${order._id}] Received COMPLETED status, but internal status was already ${order.status}. Not changing internal status.`);
            }
            break; // End COMPLETED case

          case 'FAILED':
             // Only change to Failed if currently Pending Payment
             // Avoid changing if it's already Completed, Processing, or Cancelled
             if (order.status === 'Pending Payment') {
                updatedInternalStatus = 'Payment Failed';
                order.errorMessage = 'Payment Failed via IPN.'; // Store basic reason
                console.log(`[IPN Update - Order ${order._id}] Payment FAILED. Changing status to Payment Failed.`);
             } else {
                 console.log(`[IPN Info - Order ${order._id}] Received FAILED status, but internal status was already ${order.status}. Not changing internal status.`);
             }
            break; // End FAILED case

          case 'INVALID':
          case 'CANCELLED': // Treat other non-success statuses similarly?
             if (order.status === 'Pending Payment') {
                updatedInternalStatus = 'Cancelled'; // Or map appropriately based on Pesapal status meaning
                order.errorMessage = `Payment status ${pesapalStatus} via IPN.`;
                console.log(`[IPN Update - Order ${order._id}] Payment ${pesapalStatus}. Changing status to Cancelled.`);
             } else {
                  console.log(`[IPN Info - Order ${order._id}] Received ${pesapalStatus} status, but internal status was already ${order.status}. Not changing internal status.`);
             }
             break; // End INVALID/CANCELLED case

           case 'PENDING':
                // Usually no action needed if IPN says PENDING and we are already Pending Payment
                console.log(`[IPN Info - Order ${order._id}] Received PENDING status. No status change needed.`);
                break; // End PENDING case

          default:
            // Log unhandled statuses but don't necessarily fail
            console.warn(`[IPN Info - Order ${order._id}] Received unhandled OrderNotificationType: ${pesapalStatus}. No status change.`);
        }

        // Apply the internal status change if it was modified
        if (order.status !== updatedInternalStatus) {
             order.status = updatedInternalStatus;
        }

        // Save the updated order document
        await order.save();
        console.log(`[IPN Processed - Order ${order._id}] Saved. Final Status: Internal=${order.status}, Payment=${order.paymentStatus}`);
    }

    // --- Respond to Pesapal acknowledging receipt ---
    // Format: OrderTrackingId={ Pesapal Tracking ID }&OrderMerchantReference={ Your Order ID }&status=COMPLETED/FAILED
    // Use "COMPLETED" to indicate your server *successfully processed* the IPN, not the payment status itself.
    const responseText = `OrderTrackingId=${OrderTrackingId}&OrderMerchantReference=${OrderMerchantReference}&status=COMPLETED`;
    console.log(`[IPN Response Sent - Order ${order._id}]: ${responseText}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(responseText); // Send plain text 200 OK

  } catch (error) {
    console.error(`❌ Unhandled Error processing IPN for MerchantRef ${OrderMerchantReference}:`, error);
    // Respond with a server error status, avoid detailed messages
    res.status(500).type('text').send(`IPN Server Error`);
  }
};


/**
 * @desc    Get order statistics for the dashboard for the logged-in user
 * @route   GET /api/orders/stats
 * @access  Private (requires user auth via middleware)
 */
export const getOrderStats = async (req, res) => {
   try {
       const userId = req.user?._id; // User ID from auth middleware

       if (!userId) {
           console.error("Get Stats Error: User ID not found in request.");
           return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
       }

       // Use Promise.all for concurrent database counts
       // Define "active" based on your business logic (e.g., 'Processing')
       const [pendingCount, activeCount, completedCount] = await Promise.all([
           Order.countDocuments({ userId: userId, status: 'Pending Payment' }),
           Order.countDocuments({ userId: userId, status: 'Processing' }), // Count 'Processing' orders as Active
           Order.countDocuments({ userId: userId, status: 'Completed' })
       ]);

       console.log(`Fetched stats for user ${userId}: Pending=${pendingCount}, Active=${activeCount}, Completed=${completedCount}`);

       // Return the counts in the expected format for the frontend
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
 * @desc    Get a list of orders for the logged-in user (Example: Add Pagination later)
 * @route   GET /api/orders
 * @access  Private (requires user auth via middleware)
 */
export const getUserOrders = async (req, res) => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User session invalid.' });
        }

        // Basic query: Find orders for the user, sort by newest first
        // TODO: Add pagination (e.g., using req.query.page and req.query.limit)
        const orders = await Order.find({ userId: userId })
                                   .sort({ createdAt: -1 }) // Sort by creation date, newest first
                                   .limit(20); // Example: Limit to latest 20 orders

        console.log(`Fetched ${orders.length} orders for user ${userId}`);
        res.status(200).json(orders);

    } catch (error) {
        console.error(`❌ Error fetching orders for user ${req.user?._id}:`, error);
        res.status(500).json({ message: 'Failed to fetch user orders', error: error.message });
    }
};

/**
 * @desc    Get details of a specific order by its MongoDB ID
 * @route   GET /api/orders/:id
 * @access  Private (requires user auth via middleware - ensures user owns the order)
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

        // Find the order by its MongoDB ID *AND* ensure it belongs to the logged-in user
        const order = await Order.findOne({ _id: orderId, userId: userId });

        if (!order) {
            console.log(`Order details not found or access denied for Order ID ${orderId}, User ${userId}`);
            return res.status(404).json({ message: 'Order not found or access denied.' });
        }

        console.log(`Fetched details for Order ID ${orderId}`);
        res.status(200).json(order);

    } catch (error) {
        console.error(`❌ Error fetching order details for Order ID ${req.params.id}, User ${req.user?._id}:`, error);
        res.status(500).json({ message: 'Failed to fetch order details', error: error.message });
    }
};

export const getOrderStatusByReference = async (req, res) => {
  try {
      const { merchantRef } = req.params;

      if (!merchantRef) {
          return res.status(400).json({ message: 'Order reference is required.' });
      }

      // Find order using the pesapalOrderId field
      const order = await Order.findOne({ pesapalOrderId: merchantRef });

      if (!order) {
          console.log(`Status check: Order not found for MerchantRef ${merchantRef}`);
          return res.status(404).json({ message: 'Order not found.' });
      }

      // Optional: Check if the logged-in user owns this order if endpoint is protected
      // if (req.user && order.userId.toString() !== req.user._id.toString()) {
      //     console.log(`Status check: Access denied for Order ${order._id}, User ${req.user._id}`);
      //     return res.status(403).json({ message: 'Access denied to this order.' });
      // }

      console.log(`Status check success for MerchantRef ${merchantRef}: Status=${order.status}`);
      // Return relevant status info
      res.status(200).json({
          status: order.status, // Your internal status ('Processing', 'Completed', 'Payment Failed', etc.)
          paymentStatus: order.paymentStatus, // Pesapal's last reported status
          orderId: order._id, // Your internal ID
      });

  } catch (error) {
      console.error(`❌ Error fetching order status by reference ${req.params.merchantRef}:`, error);
      res.status(500).json({ message: 'Failed to fetch order status', error: error.message });
  }
};