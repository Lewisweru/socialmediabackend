// routes/pesapal.js
import express from 'express';
// Import the CONTROLLER function that handles the IPN logic
// Make sure handleIpn is exported from your orderController.js or a dedicated pesapalController.js
import { handleIpn } from '../controllers/orderController.js'; // Assuming it's in orderController for now

const router = express.Router();

// --- Define Pesapal Routes ---

// POST /api/pesapal/ipn - Endpoint to receive Instant Payment Notifications from Pesapal
// This route MUST be publicly accessible (no 'protect' middleware)
router.post('/ipn', handleIpn);

// Add other Pesapal-specific routes here if needed in the future
// For example, a route to manually trigger IPN registration (maybe admin-only)
// import { protect, isAdmin } from '../middleware/authMiddleware.js';
// import { someAdminPesapalFunction } from '../controllers/adminController.js'; // Example
// router.post('/admin/register-ipn', protect, isAdmin, someAdminPesapalFunction);


// Export the configured router as the DEFAULT export
export default router;