// routes/publicOrderRoutes.js
import express from 'express';
import { handleIpn } from '../controllers/orderController.js'; // Adjust path

const router = express.Router();

// ONLY the public IPN route goes here
router.post('/ipn', handleIpn);

export default router;