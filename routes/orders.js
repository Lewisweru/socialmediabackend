// routes/orders.js (Keep as provided by user - looks correct)
import express from 'express';
import {
    initiateOrderAndPayment,
    getOrderStatusByReference,
    getUserOrders,
    getOrderStats,
    getOrderDetails,
    // Import admin functions if needed for admin routes below
    getAllAdminOrders,
    updateOrderStatusAdmin
} from '../controllers/orderController.js'; // Use .js extension
import { protect, isAdmin } from '../middleware/authMiddleware.js'; // Import protect and isAdmin

const router = express.Router();

// --- User Facing Order Routes (Protected) ---
router.post('/initiate', protect, initiateOrderAndPayment);
router.get('/status-by-ref/:merchantReference', protect, getOrderStatusByReference); // Callback check needs auth if user-specific
router.get('/my-orders', protect, getUserOrders);
router.get('/stats', protect, getOrderStats);       // User getting their own stats
router.get('/:id', protect, getOrderDetails);       // User getting their own order details

// --- Admin Order Routes (Protected + Admin Check) ---
router.get('/admin/all', protect, isAdmin, getAllAdminOrders);
router.put('/admin/:orderId/status', protect, isAdmin, updateOrderStatusAdmin); // Use :orderId to match controller likely

export default router;