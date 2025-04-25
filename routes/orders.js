// --- START OF FILE routes/orders.js --- (Corrected Import)
import express from 'express';
// Import controller functions explicitly using their CORRECT exported names
import {
    initiateOrderAndPayment,     // Matches export from controller
    getOrderStatusByReference, // Matches export from controller
    getUserOrders,             // Matches export from controller
    getOrderStats,             // Matches export from controller
    getOrderDetails,           // Matches export from controller

    // Import admin functions using the CORRECT exported names
    getAllOrdersAdmin,      // CORRECTED NAME
    updateOrderStatusAdmin  // Matches export from controller
} from '../controllers/orderController.js'; // Use .js extension

// Import the named export 'protect' from your authentication middleware
import { protect, isAdmin } from '../middleware/authMiddleware.js'; // Also import isAdmin

const router = express.Router();

// --- User Facing Order Routes (Protected) ---
router.post('/initiate', protect, initiateOrderAndPayment);
router.get('/status-by-ref/:merchantReference', protect, getOrderStatusByReference); // Keep protected
router.get('/my-orders', protect, getUserOrders);
router.get('/stats', protect, getOrderStats);
router.get('/:id', protect, getOrderDetails); // Get specific order by DB ID

// --- Admin Order Routes (Requires protect + isAdmin) ---
router.get('/admin/all', protect, isAdmin, getAllOrdersAdmin); // Use correct function name
router.put('/admin/:orderId/status', protect, isAdmin, updateOrderStatusAdmin); // Use :orderId for consistency

// Use export default for the router
export default router;
// --- END OF FILE routes/orders.js ---