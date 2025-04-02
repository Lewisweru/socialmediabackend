import express from 'express';
import { PesapalService } from '../services/pesapal.js';

const router = express.Router();

// Ensure environment variables are defined
if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
  throw new Error('Pesapal consumer key and secret must be defined in environment variables.');
}

const pesapalService = new PesapalService(
  process.env.PESAPAL_CONSUMER_KEY,
  process.env.PESAPAL_CONSUMER_SECRET,
  false // Set to false for production
);

// Step 1: Get OAuth Token (POST request)
router.post('/token', async (req, res) => {
  try {
    const token = await pesapalService.getOAuthToken();
    console.log('OAuth token fetched successfully:', token);
    res.status(200).json({ token });
  } catch (error) {
    console.error('Error fetching OAuth token:', error);
    res.status(500).json({ message: 'Failed to fetch OAuth token', error: error.message });
  }
});

// Step 2: Register Payment Order
router.post('/order', async (req, res) => {
  try {
    const { orderId, amount, currency, description, callbackUrl, customer } = req.body;

    // Validate required fields
    if (!orderId || !amount || !currency || !description || !callbackUrl || !customer) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Validate customer object
    if (!customer.firstName || !customer.lastName || !customer.email) {
      return res.status(400).json({ message: 'Customer details are incomplete' });
    }

    const token = await pesapalService.getOAuthToken();
    const ipnId = "9aeab972-0332-4ff4-be6b-dbf93f65fdf5"; // Use the registered IPN ID here

    const order = await pesapalService.registerOrder(
      token,
      orderId,
      amount,
      currency,
      description,
      callbackUrl,
      customer,
      ipnId // Pass the IPN ID to the registerOrder method
    );

    console.log('Order registered successfully:', order);
    res.status(201).json(order);
  } catch (error) {
    console.error('Error registering payment order:', error);
    res.status(500).json({ message: 'Failed to register payment order', error: error.message });
  }
});

// Step 3: Query Payment Status
router.get('/status/:orderTrackingId', async (req, res) => {
  try {
    const { orderTrackingId } = req.params;

    if (!orderTrackingId) {
      return res.status(400).json({ message: 'Order tracking ID is required' });
    }

    const token = await pesapalService.getOAuthToken();
    const status = await pesapalService.queryPaymentStatus(token, orderTrackingId);
    res.status(200).json(status);
  } catch (error) {
    console.error('Error querying payment status:', error);
    res.status(500).json({ message: 'Failed to query payment status', error: error.message });
  }
});

export default router;