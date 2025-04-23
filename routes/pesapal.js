// routes/pesapal.js (Complete - Defines IPN route)
import express from 'express';
// Import the CONTROLLER function that handles the IPN logic
// Ensure handleIpn is exported from orderController.js
import { handleIpn } from '../controllers/orderController.js';

const router = express.Router();

// --- Define Pesapal Routes ---

// POST /api/pesapal/ipn - Endpoint for Pesapal IPN notifications
// This MUST be publicly accessible (no 'protect' middleware)
router.post('/ipn', handleIpn);

// Add any other routes specific to Pesapal interactions here if needed

// Export the router as the DEFAULT export
export default router;