// --- START OF FILE controllers/orderController.js --- (Corrected getOrderStats)

import Order from '../models/Order.js';
import User from '../models/User.js';
import { PesapalService } from '../services/pesapal.js';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { info, warn, error, debug } from '../utils/logger.js';
import { calculatePrice } from '../utils/pricing.js';
import {
    getExoSupplierServiceDetails,
    placeExoSupplierOrder,
} from '../services/exoSupplierService.js';
import config from '../config.js'; // Assuming config.js is setup correctly
import asyncHandler from 'express-async-handler'; // Import asyncHandler

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
    warn("Warning: PESAPAL_IPN_ID environment variable not set. IPN handling might fail.");
}
// --- End Pesapal Service Initialization ---


// --- Helper Function to Place Supplier Order (Uses ExoSupplier) ---
async function placeSupplierOrderAndUpdateStatus(order) {
    if (order.status !== 'Pending Payment' && order.status !== 'Payment Failed') {
        warn(`[Supplier Order Skip] Order ${order._id} has status: ${order.status}.`);
        return order.status;
    }
     if (order.supplierOrderId) {
         warn(`[Supplier Order Skip] Order ${order._id} already has supplierOrderId: ${order.supplierOrderId}.`);
         if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
             order.status = 'Processing'; return 'Processing';
         }
         return order.status;
     }

    info(`[Supplier Order] Attempting placement for Order ${order._id} via ExoSupplier...`);
    try {
        const serviceDetails = getExoSupplierServiceDetails(
            order.platform,
            order.service,
            order.quality
        );
        if (!serviceDetails || !serviceDetails.id) {
            error(`[Supplier Order Error - ${order._id}] Failed to get ExoSupplier Service Details/ID for ${order.platform}/${order.service} (Quality: ${order.quality}). Check mapping.`);
            order.status = 'Supplier Error'; order.supplierStatus = 'Service ID/Details mapping failed';
            return 'Supplier Error';
        }
        const targetSupplierServiceId = serviceDetails.id;
        info(`[Supplier Order - ${order._id}] Mapped to ExoSupplier Service ID: ${targetSupplierServiceId} for quality '${order.quality}'. Min: ${serviceDetails.min}, Max: ${serviceDetails.max}.`);

        if (order.quantity < serviceDetails.min || order.quantity > serviceDetails.max) {
             error(`[Supplier Order Error - ${order._id}] Quantity ${order.quantity} outside supplier limits (${serviceDetails.min}-${serviceDetails.max}) for Service ID ${targetSupplierServiceId}.`);
             order.status = 'Supplier Error'; order.supplierStatus = `Invalid quantity for supplier (Min: ${serviceDetails.min}, Max: ${serviceDetails.max})`;
             return 'Supplier Error';
        }

        info(`[Supplier Order - ${order._id}] Calling placeExoSupplierOrder with ID ${targetSupplierServiceId}...`);
        const supplierOrderId = await placeExoSupplierOrder(
            targetSupplierServiceId,
            order.accountLink,
            order.quantity
            // Add runs/interval if needed
        );

        order.supplierOrderId = supplierOrderId.toString();
        order.status = 'Processing';
        order.supplierStatus = 'Pending';
        order.errorMessage = null;
        info(`[Supplier Order Success - ${order._id}] Placed ExoSupplier order ${supplierOrderId}. Internal status set to Processing.`);
        return 'Processing';

    } catch (supplierError) {
        error(`[Supplier Order Error - ${order._id}] Failed during ExoSupplier interaction: ${supplierError.message}`, supplierError);
        order.status = 'Supplier Error';
        order.supplierStatus = supplierError.message.substring(0, 100);
        return 'Supplier Error';
    }
}
// --- End Helper Function ---

// --- Controller Functions ---

export const initiateOrderAndPayment = asyncHandler(async (req, res) => {
    let savedOrder = null;
    const pesapalOrderId = uuidv4();

    try {
        const { platform, service, quality, accountLink, quantity, currency = 'KES', callbackUrl } = req.body;
        const userMongoId = req.user?._id;
        const userEmail = req.user?.email;
        const userName = req.user?.name || `${req.user?.firstName || 'Valued'} ${req.user?.lastName || 'Customer'}`;

        if (!userMongoId) { error("[Initiate Order] Missing User ID."); return res.status(401).json({ message: 'Unauthorized.' }); }
        const parsedQuantity = parseInt(quantity, 10);
        if (!platform || !service || !quality || !accountLink || !parsedQuantity || parsedQuantity <= 0 || !callbackUrl) { error(`[Initiate Order] Missing params user ${userMongoId}`, req.body); return res.status(400).json({ message: 'Missing required order details.' }); }
        if (!REGISTERED_IPN_ID) { error("[Initiate Order] Server Misconfig - IPN ID not set."); return res.status(500).json({ message: 'Server configuration error [IPN].' }); }

        info(`[Initiate Order Pre-check] Getting details for ${platform}/${service} (Quality: ${quality})...`);
        const serviceDetailsCheck = getExoSupplierServiceDetails(platform, service, quality);
        if (!serviceDetailsCheck) {
             error(`[Initiate Order Pre-check] Invalid service/quality selected: ${platform}/${service}/${quality}.`);
             return res.status(400).json({ message: `Service '${service}' (Quality: ${quality}) for '${platform}' is unavailable.` });
        }
         if (parsedQuantity < serviceDetailsCheck.min || parsedQuantity > serviceDetailsCheck.max) {
              error(`[Initiate Order Pre-check] Quantity ${parsedQuantity} outside limits (${serviceDetailsCheck.min}-${serviceDetailsCheck.max}).`);
              return res.status(400).json({ message: `Quantity must be between ${serviceDetailsCheck.min} and ${serviceDetailsCheck.max}.` });
         }
        info(`[Initiate Order Pre-check] Service valid. Min: ${serviceDetailsCheck.min}, Max: ${serviceDetailsCheck.max}.`);

        const calculatedAmount = calculatePrice(platform, service, quality, parsedQuantity);
        if (calculatedAmount <= 0) { error(`[Initiate Order] Price calc failed or zero.`); return res.status(400).json({ message: 'Invalid calculated price.' }); }

        const orderDescription = `${parsedQuantity} ${quality} ${platform} ${service}`;
        const orderData = {
            pesapalOrderId, userId: userMongoId, platform: String(platform).toLowerCase(),
            service: String(service), quality: String(quality), accountLink: String(accountLink),
            quantity: parsedQuantity, amount: calculatedAmount, currency: String(currency),
            description: String(orderDescription).substring(0, 100), status: 'Pending Payment',
            paymentStatus: 'PENDING', callbackUrlUsed: String(callbackUrl)
        };
        info(`[Order Initiate - Ref ${pesapalOrderId}] Saving order with userId: ${userMongoId}...`);
        savedOrder = new Order(orderData);
        await savedOrder.save();
        info(`[Order ${savedOrder._id} / Ref ${pesapalOrderId}] Created in DB.`);

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
        if (savedOrder && savedOrder._id && savedOrder.status === 'Pending Payment') { try { await Order.findByIdAndUpdate(savedOrder._id, { status: 'Payment Failed', paymentStatus: 'FAILED', errorMessage: `Init failed: ${err.message}` }); info(`[Order ${savedOrder?._id}] Marked Failed due to error.`); } catch (saveErr) { error(`[Order ${savedOrder?._id}] FAILED update status after initiation error:`, saveErr); } }
        if (err.name === 'ValidationError') return res.status(400).json({ message: "Validation failed", details: Object.values(err.errors).map(val => val.message) });
        const userMessage = err.message.includes('Service') || err.message.includes('Quantity') ? err.message : 'Payment initiation failed.';
        res.status(500).json({ message: userMessage, error: err.message });
    }
});

export const handleIpn = asyncHandler(async (req, res) => {
    const ipnBody = req.body || {};
    const orderTrackingId = ipnBody.OrderTrackingId || ipnBody.orderTrackingId || '';
    const notificationType = ipnBody.OrderNotificationType || ipnBody.orderNotificationType || '';
    const merchantReference = ipnBody.OrderMerchantReference || ipnBody.orderMerchantReference || '';
    const ipnResponse = { orderNotificationType: notificationType, orderTrackingId: orderTrackingId, orderMerchantReference: merchantReference, status: 500 };

    info(`[handleIpn ENTRY] Ref: ${merchantReference}, Tracking: ${orderTrackingId}, Type: ${notificationType}`);
    debug(`[handleIpn BODY]`, JSON.stringify(ipnBody, null, 2));

    if (!orderTrackingId || notificationType.toUpperCase() !== 'IPNCHANGE' || !merchantReference) {
        error(`[handleIpn Validation Error] Ref: ${merchantReference}, Invalid Data Received.`);
        return res.status(200).json(ipnResponse);
    }

    let order = null; let transactionStatusData = null;
    try {
        info(`[handleIpn - Ref ${merchantReference}] Searching Order in DB by pesapalOrderId...`);
        order = await Order.findOne({ pesapalOrderId: merchantReference });
        if (!order) {
             error(`[handleIpn Error - Ref ${merchantReference}] Order not found in DB.`);
             ipnResponse.status = 404;
             return res.status(200).json(ipnResponse);
        }
        info(`[handleIpn - Ref ${merchantReference}] Found Order ${order._id}. Current Status: ${order.status}, Payment Status: ${order.paymentStatus}`);

        info(`[handleIpn - Order ${order._id}] Querying Pesapal Status (Tracking ID: ${orderTrackingId})...`);
        const token = await pesapalService.getOAuthToken();
        transactionStatusData = await pesapalService.getTransactionStatus(token, orderTrackingId);
        info(`[handleIpn - Order ${order._id}] Pesapal Status Response Received:`, transactionStatusData);
        const fetchedPesapalStatus = transactionStatusData?.payment_status_description?.toUpperCase() || 'UNKNOWN';
        const fetchedPesapalDesc = transactionStatusData?.description || '';

        let internalStatusUpdate = order.status;
        let shouldSaveChanges = false;
        let newErrorMessage = order.errorMessage;

        info(`[handleIpn - Order ${order._id}] Processing Pesapal Status Description: ${fetchedPesapalStatus}`);

        if ((order.paymentStatus !== fetchedPesapalStatus) && fetchedPesapalStatus !== 'UNKNOWN') {
            info(`[handleIpn - Order ${order._id}] Updating DB paymentStatus from '${order.paymentStatus}' to '${fetchedPesapalStatus}'`);
            order.paymentStatus = fetchedPesapalStatus;
            shouldSaveChanges = true;
        }

        if (order.status === 'Pending Payment' || order.status === 'Payment Failed') {
            switch (fetchedPesapalStatus) {
                case 'COMPLETED':
                    info(`[handleIpn - Order ${order._id}] Pesapal COMPLETED. Calling placeSupplierOrderAndUpdateStatus...`);
                    internalStatusUpdate = await placeSupplierOrderAndUpdateStatus(order);
                    info(`[handleIpn - Order ${order._id}] placeSupplierOrderAndUpdateStatus returned: ${internalStatusUpdate}`);
                    newErrorMessage = (internalStatusUpdate === 'Supplier Error') ? order.supplierStatus : null;
                    shouldSaveChanges = true;
                    break;
                case 'FAILED':
                    internalStatusUpdate = 'Payment Failed';
                    newErrorMessage = fetchedPesapalDesc || 'Payment Failed (reported by Pesapal IPN)';
                    shouldSaveChanges = true;
                    info(`[handleIpn - Order ${order._id}] FAILED. Setting Internal Status to 'Payment Failed'.`);
                    break;
                case 'INVALID':
                case 'REVERSED':
                    internalStatusUpdate = 'Cancelled';
                    newErrorMessage = `Payment status ${fetchedPesapalStatus}. ${fetchedPesapalDesc || ''}`.trim();
                    shouldSaveChanges = true;
                    info(`[handleIpn - Order ${order._id}] ${fetchedPesapalStatus}. Setting Internal Status to 'Cancelled'.`);
                    break;
                case 'PENDING':
                     info(`[handleIpn - Order ${order._id}] PENDING. Internal status remains '${order.status}'.`);
                     break;
                default:
                     warn(`[handleIpn - Order ${order._id}] Received unhandled fetched payment_status_description: '${fetchedPesapalStatus}'.`);
            }
            if (order.status !== internalStatusUpdate) {
                order.status = internalStatusUpdate;
                order.errorMessage = newErrorMessage;
                info(`[handleIpn - Order ${order._id}] Internal status CHANGED to -> '${order.status}'.`);
                shouldSaveChanges = true;
            }
        } else {
            info(`[handleIpn - Order ${order._id}] Internal status '${order.status}' not modified by IPN.`);
        }

        if (shouldSaveChanges) {
            info(`[handleIpn - Order ${order._id}] Saving changes to DB...`);
            await order.save();
            info(`[handleIpn Processed - Order ${order._id}] Save successful. Final Status: ${order.status}, Payment: ${order.paymentStatus}`);
            ipnResponse.status = 200;
        } else {
            info(`[handleIpn - Order ${order._id}] No database changes required.`);
            ipnResponse.status = 200;
        }

        info(`[handleIpn Response Sent - Order ${order._id}]: ${JSON.stringify(ipnResponse)}`);
        res.status(200).json(ipnResponse);

    } catch (err) {
        error(`❌ Unhandled Error processing IPN for MerchantRef ${merchantReference}:`, err);
        ipnResponse.status = 500;
        res.status(200).json(ipnResponse);
    }
});

export const getOrderStats = asyncHandler(async (req, res) => {
   info("[getOrderStats] Function called.");
   const userMongoId = req.user?._id; // Use the MongoDB _id from req.user set by 'protect'

   if (!userMongoId) {
       error("[getOrderStats] Error: User ID not found on req.user.");
       return res.status(401).json({ message: 'Unauthorized: User session invalid or user data missing.' });
   }

   info(`[getOrderStats] Querying counts for specific userId: ${userMongoId}`);

   // Query orders specifically for the logged-in user
   const [pendingCount, activeCount, completedCount] = await Promise.all([
       Order.countDocuments({ userId: userMongoId, status: { $in: ['Pending Payment', 'Payment Failed']} }),
       Order.countDocuments({ userId: userMongoId, status: { $in: ['Processing', 'In Progress', 'Partial', 'Supplier Error']} }), // Define what counts as "Active" clearly
       Order.countDocuments({ userId: userMongoId, status: 'Completed' })
   ]);

   info(`[getOrderStats] Counts for user ${userMongoId}: Pending=${pendingCount}, Active=${activeCount}, Completed=${completedCount}`);
   res.status(200).json({ pendingOrders: pendingCount, activeOrders: activeCount, completedOrders: completedCount });

});

export const getUserOrders = asyncHandler(async (req, res) => {
    info("[getUserOrders] Function called.");
    const userMongoId = req.user?._id;
    if (!userMongoId) { return res.status(401).json({ message: 'Unauthorized: User session invalid.' }); }

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (limit > 100) limit = 100;
    const skip = (page - 1) * limit;

    info(`[getUserOrders] Fetching orders for user MongoDB ID ${userMongoId}, P:${page}, L:${limit}`);

    const [orders, totalOrders] = await Promise.all([
        Order.find({ userId: userMongoId })
             .select('-paymentStatus -errorMessage -userId -pesapalTrackingId -pesapalOrderId -callbackUrlUsed -__v') // Select fields to return
             .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Order.countDocuments({ userId: userMongoId })
    ]);

    info(`[getUserOrders] Found ${orders.length}/${totalOrders} orders.`);
    res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders });
});

export const getOrderDetails = asyncHandler(async (req, res) => {
    info("[getOrderDetails] Function called.");
    const userMongoId = req.user?._id;
    const orderId = req.params.id;

    if (!userMongoId) { return res.status(401).json({ message: 'Unauthorized.' }); }
    if (!mongoose.Types.ObjectId.isValid(orderId)) { info(`[getOrderDetails] Invalid Order ID: ${orderId}`); return res.status(400).json({ message: 'Invalid Order ID.' }); }

    info(`[getOrderDetails] Fetching order ${orderId} for user MongoDB ID ${userMongoId}`);

    const order = await Order.findOne({ _id: orderId, userId: userMongoId }).select('-userId -__v').lean(); // Use lean

    if (!order) { info(`[getOrderDetails] Order ${orderId} not found/denied user ${userMongoId}.`); return res.status(404).json({ message: 'Order not found or access denied.' }); }

    info(`[getOrderDetails] Success for Order ID ${orderId}`);
    res.status(200).json(order);
});

export const getOrderStatusByReference = asyncHandler(async (req, res) => {
    info("[getOrderStatusByReference] Function called.");
    const { merchantReference } = req.params; // Corrected destructuring
    info(`[getOrderStatusByReference] Ref: ${merchantReference}`);

    if (!merchantReference) {
        error("[getOrderStatusByReference] Missing merchantReference.");
        return res.status(400).json({ message: 'Order reference required.' });
    }

    const order = await Order.findOne({ pesapalOrderId: merchantReference }).select('status paymentStatus _id supplierStatus').lean(); // Use lean

    if (!order) {
        info(`[getOrderStatusByReference] Order not found Ref ${merchantReference}`);
        return res.status(404).json({ message: 'Order not found.' });
    }

    info(`[getOrderStatusByReference] Success Ref ${merchantReference}: Status='${order.status}', Payment='${order.paymentStatus}'`);
    res.status(200).json({ status: order.status, paymentStatus: order.paymentStatus, orderId: order._id, supplierStatus: order.supplierStatus });
});

// --- ADMIN FUNCTIONS ---
export const getAllOrdersAdmin = asyncHandler(async (req, res) => {
    info(`[getAllOrdersAdmin] Admin: ${req.user?._id}`);
    const filter = {};
    if (req.query.status) {
        const OrderStatusEnum = ['Pending Payment', 'Payment Failed', 'Processing', 'In Progress', 'Completed', 'Partial', 'Cancelled', 'Refunded', 'Supplier Error', 'Expired'];
        const requestedStatus = req.query.status;
        if (typeof requestedStatus === 'string' && OrderStatusEnum.includes(requestedStatus)) {
            filter.status = requestedStatus;
        } else if (typeof requestedStatus === 'string') {
            warn(`[getAllOrdersAdmin] Invalid status filter: ${requestedStatus}`);
            return res.status(400).json({ message: `Invalid status: ${requestedStatus}` });
        }
    }

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 25;
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (limit > 100) limit = 100;
    const skip = (page - 1) * limit;

    info(`[getAllOrdersAdmin] Querying. Filter: ${JSON.stringify(filter)}, P:${page}, L:${limit}`);

    const [orders, totalOrders] = await Promise.all([
        Order.find(filter).populate('userId', 'email name username firebaseUid').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Order.countDocuments(filter)
    ]);

    info(`[getAllOrdersAdmin] Found ${orders.length}/${totalOrders}.`);
    res.status(200).json({ orders, page, pages: Math.ceil(totalOrders / limit), total: totalOrders });
});

export const updateOrderStatusAdmin = asyncHandler(async (req, res) => {
    const orderId = req.params.orderId; // Changed from req.params.id to match route
    const adminUserId = req.user?._id;
    info(`[updateOrderStatusAdmin] Admin: ${adminUserId} Order: ${orderId}`);

    const { status } = req.body;
    const allowedAdminStatusUpdates = ['Processing', 'Completed', 'Cancelled', 'Refunded', 'Supplier Error'];
    if (!status || !allowedAdminStatusUpdates.includes(status)) {
        error(`[updateOrderStatusAdmin] Invalid status '${status}'.`);
        return res.status(400).json({ message: `Invalid status. Allowed: ${allowedAdminStatusUpdates.join(', ')}` });
    }
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        error(`[updateOrderStatusAdmin] Invalid ID format: ${orderId}`);
        return res.status(400).json({ message: 'Invalid ID format.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
        info(`[updateOrderStatusAdmin] Order ${orderId} not found.`);
        return res.status(404).json({ message: 'Order not found.' });
    }
    if (order.status === status) {
        info(`[updateOrderStatusAdmin] Order ${orderId} already status '${status}'.`);
        return res.status(200).json(order); // Return existing order if status is same
    }

    info(`[updateOrderStatusAdmin] Admin ${adminUserId} changing ${orderId} status ${order.status} -> ${status}.`);
    order.status = status;
    if (status === 'Completed' && order.paymentStatus !== 'COMPLETED') {
        info(`[updateOrderStatusAdmin - ${orderId}] Aligning paymentStatus.`);
        order.paymentStatus = 'COMPLETED';
    }
    if ((status === 'Processing' || status === 'Completed') && order.errorMessage) {
        info(`[updateOrderStatusAdmin - ${orderId}] Clearing error.`);
        order.errorMessage = null;
    }

    const updatedOrder = await order.save();
    info(`[updateOrderStatusAdmin] Admin ${adminUserId} updated order ${orderId} -> ${status}.`);
    // Return lean object for consistency if needed, or the full Mongoose doc
    res.status(200).json(updatedOrder.toObject({ versionKey: false }));
});

// --- END OF FILE controllers/orderController.js ---