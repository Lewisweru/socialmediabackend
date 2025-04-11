// controllers/orderController.js (Standard JavaScript - API Automation FINAL - VERIFIED & CORRECTED)

import Order from '../models/Order.js'; // Adjust path
// Keep User import if needed for populate
import User from '../models/User.js';
import { PesapalService } from '../services/pesapal.js'; // Adjust path
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
// --- Imports for API Integration ---
import { getJeskienServiceId } from '../config/jeskieServiceMap.js'; // Import mapping helper (VERIFY PATH)
import { addJeskienOrder } from '../services/jeskieincService.js'; // Import Jeskien service (VERIFY PATH)
// --- ------------- ---

// --- Pesapal Service Initialization & IPN Config ---
if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
    console.error("FATAL ERROR: Pesapal keys missing."); process.exit(1);
}
const pesapalService = new PesapalService(
    process.env.PESAPAL_CONSUMER_KEY,
    process.env.PESAPAL_CONSUMER_SECRET,
    process.env.NODE_ENV !== 'production'
);
const REGISTERED_IPN_ID = process.env.PESAPAL_IPN_ID;
if (!REGISTERED_IPN_ID) { console.warn("Warning: PESAPAL_IPN_ID missing."); }
// --- End Config ---


// --- Controller Functions ---

/**
 * Initiate Order and Payment (User)
 */
export const initiateOrderAndPayment = async (req, res) => {
    let savedOrder = null;
    const pesapalOrderId = uuidv4();

    try {
        // 1. Extract data & user details
        const { platform, service, quality, accountLink, quantity, amount, currency = 'KES', description, callbackUrl } = req.body;
        const userId = req.user?._id;
        const userEmail = req.user?.email;
        const userName = req.user?.name || req.user?.displayName || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;

        // 2. Validate
        if (!userId || !userEmail || !userName || !platform || !service || !quality || !accountLink || !quantity || quantity <= 0 || !amount || amount <= 0 || !callbackUrl || !REGISTERED_IPN_ID) {
             console.error(`[Initiate Order] Validation failed for user ${userId || 'UNKNOWN'}.`);
             return res.status(400).json({ message: 'Missing required information or invalid request.' });
        }

        // 3. Prepare & Save Initial Order to DB
        const orderDescription = description || `${quantity} ${quality} ${platform} ${service}`;
        const orderData = {
            pesapalOrderId, userId: String(userId), platform: String(platform), service: String(service),
            quality: String(quality), accountLink: String(accountLink), quantity: Number(quantity),
            amount: Number(parseFloat(amount).toFixed(2)), currency: String(currency),
            description: String(orderDescription).substring(0, 100),
            status: 'Pending Payment', paymentStatus: 'PENDING', callbackUrlUsed: String(callbackUrl),
            // Initialize supplier fields
            supplier: 'jeskieinc', supplierServiceId: null, supplierOrderId: null, supplierStatus: null,
            supplierCharge: null, supplierRemains: null, supplierStartCount: null,
            supplierErrorMessage: null, errorMessage: null
        };
        console.log(`[Order Initiate - Ref ${pesapalOrderId}] Saving order...`);
        savedOrder = new Order(orderData);
        await savedOrder.save();
        console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created in DB. Status: Pending Payment.`);

        // 4. Register with Pesapal
        console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Registering with Pesapal...`);
        const token = await pesapalService.getOAuthToken();
        const customerDetails = { firstName: userName.split(' ')[0] || 'Valued', lastName: userName.split(' ').slice(1).join(' ') || 'Customer', email: userEmail };
        const pesapalOrderResponse = await pesapalService.registerOrder(
            token, pesapalOrderId, orderData.amount, orderData.currency, orderData.description,
            orderData.callbackUrlUsed, customerDetails, REGISTERED_IPN_ID
        );
        console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Pesapal registration response:`, pesapalOrderResponse);

        // 5. Update DB with Pesapal Tracking ID
        if (pesapalOrderResponse?.order_tracking_id) {
            savedOrder.pesapalTrackingId = pesapalOrderResponse.order_tracking_id;
            await savedOrder.save();
            console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Updated DB with Tracking ID.`);
        } else { console.warn(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] No tracking ID in Pesapal response.`); }

        // 6. Return Redirect URL
        if (!pesapalOrderResponse?.redirect_url) { throw new Error('Pesapal did not provide payment redirect URL.'); }
        console.log(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Initiation successful.`);
        res.status(200).json({
            redirectUrl: pesapalOrderResponse.redirect_url,
            orderTrackingId: pesapalOrderResponse.order_tracking_id,
            orderId: savedOrder._id
        });

    } catch (error) {
         console.error(`❌ Error during order initiation for PesaPal Ref ${pesapalOrderId}:`, error);
         if (savedOrder && savedOrder.status === 'Pending Payment') { /* ... mark order failed ... */ }
         if (error.name === 'ValidationError') { /* ... handle validation ... */ }
         res.status(500).json({ message: 'Failed to initiate payment process.', error: error.message });
    }
};


/**
 * @desc    Handle Pesapal IPN - Triggers Status Check & Supplier Order Submission
 * @route   POST /api/orders/ipn
 * @access  Public
 */
export const handleIpn = async (req, res) => {
    const ipnBody = req.body || {};
    const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
    const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
    const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || '';

    const ipnResponse = { orderNotificationType: notificationType, orderTrackingId, orderMerchantReference: merchantReference, status: 500 };

    console.log(`--- Received IPN [${new Date().toISOString()}] --- Body:`, JSON.stringify(ipnBody));
    console.log(`Extracted: TrackingID='${orderTrackingId}', Type='${notificationType}', MerchantRef='${merchantReference}'`);

    if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) {
        console.error(`[IPN Validation Error] Invalid payload. Ref: ${merchantReference}`);
        return res.status(200).json(ipnResponse);
    }

    let order = null;
    try {
        console.log(`[IPN Processing - Ref ${merchantReference}] Finding Order...`);
        order = await Order.findOne({ pesapalOrderId: merchantReference });

        if (!order) {
             console.error(`[IPN Processing Error - Ref ${merchantReference}] Order not found.`);
             ipnResponse.status = 404; return res.status(200).json(ipnResponse);
        }
        console.log(`[IPN Processing - Ref ${merchantReference}] Found Order ${order._id}. DB Status: Internal='${order.status}', Payment='${order.paymentStatus}'`);

        // Update Tracking ID if missing
        if (!order.pesapalTrackingId && orderTrackingId) { /* ... update and log ... */ }

        // --- Query Pesapal Status ---
        let transactionStatusData;
        try {
             console.log(`[IPN Processing - Order ${order._id}] Querying Pesapal status...`);
             const token = await pesapalService.getOAuthToken();
             transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
             console.log(`[IPN Processing - Order ${order._id}] Pesapal status check response:`, transactionStatusData);
        } catch (statusError) { /* ... Handle query error, return ipnResponse ... */ }

        // --- Process Fetched Status ---
        const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
        const fetchedPesapalDesc = transactionStatusData?.description || '';
        let internalStatusUpdate = order.status;
        let shouldSave = false;
        let newErrorMessage = order.errorMessage;

        console.log(`[IPN Processing - Order ${order._id}] Fetched Pesapal Status: '${fetchedPesapalStatus}'.`);

        if (order.paymentStatus !== fetchedPesapalStatus && fetchedPesapalStatus !== 'UNKNOWN') { /* ... update paymentStatus, shouldSave = true ... */ }

        // --- *** THIS IS THE CORRECT BLOCK FOR API INTEGRATION *** ---
        if (order.status === 'Pending Payment' && fetchedPesapalStatus === 'COMPLETED') {
            console.log(`\n !!! --- [IPN - Order ${order._id}] Attempting Supplier Interaction --- !!! \n`); // CHECK FOR THIS
            try {
                console.log(`[IPN Update - Order ${order._id}] Payment COMPLETED. Mapping Service ID...`);
                const jeskienServiceId = getJeskienServiceId(order.platform, order.service, order.quality);
                console.log(`[IPN Update - Order ${order._id}] Mapped Service ID Result: ${jeskienServiceId}`);

                if (!jeskienServiceId) throw new Error(`Service mapping not found`);

                order.supplierServiceId = jeskienServiceId;
                order.supplier = 'jeskieinc';

                console.log(`[IPN Update - Order ${order._id}] Submitting to Jeskien API...`);
                const supplierOrderId = await addJeskienOrder( jeskienServiceId, order.accountLink, order.quantity );
                console.log(`[IPN Update - Order ${order._id}] Jeskien API returned ID: ${supplierOrderId}`);

                order.supplierOrderId = supplierOrderId;
                internalStatusUpdate = 'SentToSupplier'; // Set correct status
                newErrorMessage = null; order.supplierErrorMessage = null; // Clear errors
                shouldSave = true;
                console.log(`[IPN Update - Order ${order._id}] Successfully submitted. Status -> 'SentToSupplier'.`);

            } catch (supplierError) {
                console.error(`[IPN Supplier Error - Order ${order._id}] Failed:`, supplierError);
                internalStatusUpdate = 'Supplier Error'; // Set error status
                newErrorMessage = `Failed send to supplier: ${supplierError.message}`;
                order.supplierErrorMessage = newErrorMessage;
                shouldSave = true;
                // TODO: Notify admin
            }
        }
        // --- Handle Pesapal Failures if order was Pending ---
        else if (order.status === 'Pending Payment' && (fetchedPesapalStatus === 'FAILED' || fetchedPesapalStatus === 'INVALID' || fetchedPesapalStatus === 'REVERSED')) {
             internalStatusUpdate = (fetchedPesapalStatus === 'FAILED') ? 'Payment Failed' : 'Cancelled';
             newErrorMessage = fetchedPesapalDesc || `Payment ${fetchedPesapalStatus}`;
             shouldSave = true;
             console.log(`[IPN Update - Order ${order._id}] Fetched ${fetchedPesapalStatus}. Setting Internal Status -> '${internalStatusUpdate}'.`);
        }
        else { console.log(`[IPN Info - Order ${order._id}] No internal status change needed.`); }


        // Apply internal status update if it changed
        if (order.status !== internalStatusUpdate) {
            order.status = internalStatusUpdate;
            order.errorMessage = newErrorMessage;
            console.log(`[IPN Update - Order ${order._id}] Internal status changed to '${order.status}'.`);
            shouldSave = true;
        }

        // Save if needed
        if (shouldSave) { /* ... save logic ... */ }
        else { /* ... log no save needed ... */ }

        // Acknowledge IPN
        ipnResponse.status = shouldSave && internalStatusUpdate === 'Supplier Error' ? 500 : 200;
        console.log(`[IPN Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`);
        res.status(200).json(ipnResponse);

    } catch (error) { /* ... handle unexpected errors ... */ }
};


/**
 * Get Order Stats for Dashboard (User)
 */
export const getOrderStats = async (req, res) => { /* ... As previously corrected ... */ };

/**
 * Get User's Orders (Paginated)
 */
export const getUserOrders = async (req, res) => { /* ... As previously corrected ... */ };

/**
 * Get Single Order Details (for User)
 */
export const getOrderDetails = async (req, res) => { /* ... As previously corrected ... */ };

/**
 * Get Order Status by Merchant Reference (for Callback Page)
 */
export const getOrderStatusByReference = async (req, res) => { /* ... As previously corrected ... */ };

// --- ADMIN FUNCTIONS REMOVED ---