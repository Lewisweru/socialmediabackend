import express from 'express';
// Import specific controller functions
import {
    getUserProfile,
    updateUserProfile,
    getUserById // Keep if needed for admin or other lookups
} from '../controllers/userController.js';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import { info, warn, error } from '../utils/logger.js'; // Assuming logger exists

const router = express.Router();

// GET Current Logged-in User's Profile
router.get('/profile/me', protect, getUserProfile);

// PUT Update Current Logged-in User's Profile
router.put('/profile/me', protect, updateUserProfile);

// --- Admin Route Example ---
// GET User by ID (Admin Only, potentially using MongoDB _id)
router.get(
    '/:id', // Example: Route expects MongoDB _id
    protect,
    isAdmin,
    getUserById // Controller should handle finding by req.params.id
);

// GET All Users (Admin Only)
// router.get('/', protect, isAdmin, getAllUsers); // Implement getAllUsers in controller if needed

export default router;