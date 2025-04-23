// routes/orders.js (Complete - Uses correct controller function names)
import express from 'express';
// Import controller functions explicitly using their CORRECT exported names
import {
    initiateOrderAndPayment,     // Matches export from controller
    getOrderStatusByReference, // Matches export from controller
    getUserOrders,             // Matches export from controller
    getOrderStats,             // Matches export from controller
    getOrderDetails            // Matches export from controller
    // Import admin functions if needed for admin routes below
    // getAllOrdersAdmin,
    // updateOrderStatusAdmin
} from '../controllers/orderController.js'; // Use .js extension

// Import the named export 'protect' from your authentication middleware
import { protect } from '../middleware/authMiddleware.js';
// Import admin middleware if you add admin routes that require it
// import { isAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// --- User Facing Order Routes (Protected) ---
router.post('/initiate', protect, initiateOrderAndPayment);
router.get('/status/:merchantReference', protect, getOrderStatusByReference); // Callback check needs auth
router.get('/my-orders', protect, getUserOrders);
router.get('/stats', protect, getOrderStats);
router.get('/:id', protect, getOrderDetails); // Get specific order by DB ID

// --- Admin Order Routes (Example - Requires protect + isAdmin) ---
// Uncomment and adjust if you implement these
// router.get('/admin/all', protect, isAdmin, getAllOrdersAdmin);
// router.put('/admin/status/:id', protect, isAdmin, updateOrderStatusAdmin);

// Use export default for the router
export default router;