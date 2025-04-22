// routes/orders.js (ESM)
import express from 'express';
// Import controller functions explicitly
import {
    initiateOrder,
    checkOrderStatusByReference,
    getUserOrders
} from '../controllers/orderController.js'; // Use .js extension
// Import your actual authentication middleware
import authMiddleware from '../middleware/authMiddleware.js'; // Use .js extension

const router = express.Router();

// POST /api/orders/initiate - Initiate a new order (requires auth)
router.post('/initiate', authMiddleware, initiateOrder);

// GET /api/orders/status/:merchantReference - Check status via callback (requires auth)
router.get('/status/:merchantReference', authMiddleware, checkOrderStatusByReference);

// GET /api/orders/my-orders - Fetch logged-in user's orders (requires auth)
router.get('/my-orders', authMiddleware, getUserOrders);

// Use export default for the router
export default router;