// routes/orders.js (Corrected Controller Import Names)
import express from 'express';
// Import controller functions explicitly using their CORRECT exported names
import {
    initiateOrderAndPayment,     // Corrected name from orderController.js
    getOrderStatusByReference, // Corrected name from orderController.js
    getUserOrders              // This name was likely correct
} from '../controllers/orderController.js'; // Use .js extension

// Import the named export 'protect' from your authentication middleware
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST /api/orders/initiate - Initiate a new order (requires auth)
// Use the correctly imported 'initiateOrderAndPayment' function
router.post('/initiate', protect, initiateOrderAndPayment);

// GET /api/orders/status/:merchantReference - Check status via callback (requires auth)
// Use the correctly imported 'getOrderStatusByReference' function
router.get('/status/:merchantReference', protect, getOrderStatusByReference);

// GET /api/orders/my-orders - Fetch logged-in user's orders (requires auth)
// Use the correctly imported 'getUserOrders' function
router.get('/my-orders', protect, getUserOrders);

// Use export default for the router
export default router;