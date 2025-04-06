// routes/orders.js
import express from 'express';
import {
  initiateOrderAndPayment,
  // handleIpn, // This should be in publicOrderRoutes now
  getOrderStats,
  getUserOrders,
  getOrderDetails,
  getOrderStatusByReference, // Keep this here (can be public or private)
  // --- Import Admin Controllers ---
  getAllOrdersAdmin,
  updateOrderStatusAdmin
} from '../controllers/orderController.js'; // Adjust path
import { protect } from '../middleware/authMiddleware.js'; // Adjust path
import { isAdmin } from '../middleware/adminMiddleware.js'; // <-- Import admin middleware

const router = express.Router();

// --- User Routes (Protected) ---
router.post('/initiate', protect, initiateOrderAndPayment);
router.get('/stats', protect, getOrderStats);
router.get('/', protect, getUserOrders); // Route for listing user's own orders
router.get('/:id', protect, getOrderDetails); // Route for user getting own specific order

// --- Status Check Route (Can be public or protected) ---
// Decide if user needs to be logged in to check status via callback link
router.get('/status-by-ref/:merchantRef', getOrderStatusByReference); // Currently public

// --- Admin Routes (Protected + Admin Check) ---
// Prefix routes with /admin to avoid conflicts (e.g., GET /api/orders/ vs GET /api/orders/admin/all)
router.get('/admin/all', protect, isAdmin, getAllOrdersAdmin);
router.put('/admin/:id/status', protect, isAdmin, updateOrderStatusAdmin);

export default router;