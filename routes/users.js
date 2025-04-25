// routes/users.js (EXAMPLE - Apply 'protect' middleware)
import express from 'express';
import { getUser } from '../controllers/userController.js'; // Assuming getUser is here
import { protect } from '../middleware/authMiddleware.js'; // Import protect

const router = express.Router();

// Example: Get user profile - requires authentication
// The :id in the route should correspond to the Firebase UID
router.get('/:id', protect, getUser);

// Example: Update user profile - requires authentication and user must be self
router.put('/:id/profile', protect, async (req, res) => {
    // Ensure the logged-in user (req.user._id from MongoDB) matches the
    // MongoDB user corresponding to the Firebase UID in the URL param (req.params.id).
    // Or more simply, ensure req.user.firebaseUid === req.params.id
    if (req.user.firebaseUid !== req.params.id) {
         return res.status(403).json({ message: 'Forbidden: Cannot update another user profile' });
    }
    // ... proceed with update logic ...
    res.json({ message: 'Profile update endpoint placeholder' });
});


export default router;