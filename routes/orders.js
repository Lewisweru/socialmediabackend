// routes/orders.js (or your actual route filename for orders)
import express from 'express';

// --- Import Controller Functions ---
// Make sure the path to your controller file is correct
import {
  initiateOrderAndPayment, // For starting the payment process
  getOrderStatusByReference,
  getOrderStats,         // For the dashboard stats
  getUserOrders,         // For listing user's orders (Added example)
  getOrderDetails        // For getting a single order's details (Added example)
} from '../controllers/orderController.js';

// --- Import Authentication Middleware ---
// Make sure the path to your middleware file is correct
import { protect } from '../middleware/authMiddleware.js';

// --- Create Router Instance ---
const router = express.Router();

// --- Define Routes ---

// POST   /api/orders/initiate
// Desc:  Create order in DB, register with Pesapal, get redirect URL
// Access: Private (User must be logged in)
router.post('/initiate', protect, initiateOrderAndPayment);



// GET    /api/orders/stats
// Desc:  Get dashboard statistics (counts) for the logged-in user
// Access: Private (User must be logged in)
router.get('/stats', protect, getOrderStats); // <-- Corrected path

// GET    /api/orders
// Desc:   Get a list of orders placed by the logged-in user
// Access: Private (User must be logged in)
// Note: Controller needs pagination logic for production
router.get('/', protect, getUserOrders); // <-- Added route for listing orders

// GET    /api/orders/:id
// Desc:   Get the details of a specific order by its MongoDB ID
// Access: Private (User must be logged in and own the order)
router.get('/:id', protect, getOrderDetails); // <-- Added route for single order details

router.get('/status-by-ref/:merchantRef', getOrderStatusByReference)
// --- Export Router ---
export default router;