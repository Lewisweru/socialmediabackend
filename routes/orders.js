// routes/orders.js
import express from 'express';

// --- Import Controller Functions (Remove Admin ones) ---
import {
  initiateOrderAndPayment,
  // handleIpn, // Should be in publicOrderRoutes now
  getOrderStats,
  getUserOrders,
  getOrderDetails,
  getOrderStatusByReference
  // REMOVED: getAllOrdersAdmin, updateOrderStatusAdmin
} from '../controllers/orderController.js'; // Adjust path

// --- Import Authentication Middleware ---
import { protect } from '../middleware/authMiddleware.js'; // Adjust path
// REMOVED: import { isAdmin } from '../middleware/adminMiddleware.js';

const router = express.Router();

// --- User Routes (Protected) ---
router.post('/initiate', protect, initiateOrderAndPayment);
router.get('/stats', protect, getOrderStats);
router.get('/', protect, getUserOrders);
router.get('/:id', protect, getOrderDetails);

// --- Status Check Route (Can be public or protected) ---
router.get('/status-by-ref/:merchantRef', getOrderStatusByReference); // Currently public

// --- Admin Routes REMOVED ---
// router.get('/admin/all', protect, isAdmin, getAllOrdersAdmin);
// router.put('/admin/:id/status', protect, isAdmin, updateOrderStatusAdmin);

export default router;