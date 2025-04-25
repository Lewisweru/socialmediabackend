// controllers/userController.js (REVISED - No TypeScript Syntax)
import User from "../models/User.js";
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';

// GET Current Logged-in User's Profile
export const getUserProfile = asyncHandler(async (req, res) => {
    // req.user is attached by the 'protect' middleware
    if (!req.user) {
        warn('[getUserProfile] User object not found on request after protect middleware.');
        return res.status(401).json({ message: "Not authorized, user data missing." });
    }

    info(`[getUserProfile] Returning profile for user: ${req.user.username} (ID: ${req.user._id})`);
    // req.user is already lean and has password excluded by protect middleware
    res.status(200).json(req.user);
});


// PUT Update Current Logged-in User's Profile
export const updateUserProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id; // Get user's MongoDB ID from the protect middleware
    info(`[updateUserProfile] Attempting profile update for user: ${userId}`);

    const { name, country, profilePic, username } = req.body; // Fields allowed for update

    const updateData = {}; // Standard JavaScript object
    // Only add fields to updateData if they are actually provided in the request body
    if (name !== undefined) updateData.name = name.trim();
    if (country !== undefined) updateData.country = country.trim();
    if (profilePic !== undefined) updateData.profilePic = profilePic.trim(); // Basic validation, could add URL check

    // Handle username update separately due to uniqueness
    if (username !== undefined && username.trim() !== req.user.username) {
        const trimmedUsername = username.trim();
         if (trimmedUsername.length < 3) {
             return res.status(400).json({ message: 'Username must be at least 3 characters', code: 'VALIDATION_ERROR' });
         }
        // Check if the new username is already taken by another user
        const existingUser = await User.findOne({ username: trimmedUsername, _id: { $ne: userId } });
        if (existingUser) {
            warn(`[updateUserProfile] Username "${trimmedUsername}" is already taken.`);
            return res.status(409).json({ message: 'Username already taken', code: 'USERNAME_CONFLICT' });
        }
        updateData.username = trimmedUsername;
    }


    if (Object.keys(updateData).length === 0) {
         info(`[updateUserProfile] No valid fields provided for update for user: ${userId}`);
         return res.status(400).json({ message: 'No fields provided for update', code: 'NO_UPDATE_DATA' });
    }

    try {
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true, select: '-password' } // Return updated doc, run schema validators, exclude password
        ).lean(); // Use lean for response

        if (!updatedUser) {
             error(`[updateUserProfile] User not found during update attempt: ${userId}`);
            return res.status(404).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
        }

        info(`[updateUserProfile] Profile updated successfully for user: ${userId}`);
        res.status(200).json(updatedUser); // Send back the updated user profile

    } catch (err) { // Removed : any type annotation
         error(`[updateUserProfile] Error updating profile for user ${userId}:`, err);
         if (err.code === 11000 || (err.message && err.message.includes('duplicate key error'))) {
             const field = Object.keys(err.keyValue || {})[0] || 'field';
             warn(`[updateUserProfile] Duplicate key error on ${field} during update for user: ${userId}`);
             return res.status(409).json({ message: `Update failed: ${field} already exists.`, code: 'UPDATE_CONFLICT' });
         }
         if (err.name === 'ValidationError') {
             const messages = Object.values(err.errors).map((val) => val.message); // Removed type assertion
             return res.status(400).json({ message: 'Validation failed', code: 'VALIDATION_ERROR', details: messages });
         }
         // Generic fallback error
         res.status(500).json({ message: 'Error updating profile', code: 'INTERNAL_SERVER_ERROR' });
    }
});


// GET User by ID (e.g., for Admin lookup)
// Expects MongoDB _id or firebaseUid in params - adjust query accordingly
export const getUserById = asyncHandler(async (req, res) => {
  const idParam = req.params.id; // ID from the URL parameter
  info(`[getUserById] Admin/lookup request for ID: ${idParam}`);

  if (!idParam) {
    warn('[getUserById] No ID provided in request params.');
    return res.status(400).json({ message: "User ID parameter is missing." });
  }

  try {
    let user = null;
    // Attempt to find by MongoDB ObjectId first (more common for direct lookups)
    if (mongoose.Types.ObjectId.isValid(idParam)) {
         debug(`[getUserById] Attempting lookup by MongoDB ObjectId: ${idParam}`);
         user = await User.findById(idParam).select('-password').lean();
    }

    // If not found by ObjectId, try finding by Firebase UID
    if (!user) {
        debug(`[getUserById] Not found by ObjectId, attempting lookup by Firebase UID: ${idParam}`);
        user = await User.findOne({ firebaseUid: idParam }).select('-password').lean();
    }

    if (!user) {
      info(`[getUserById] User not found for ID: ${idParam}`);
      return res.status(404).json({ message: "User not found" });
    }

    info(`[getUserById] Successfully found user for ID: ${idParam} (MongoDB ID: ${user._id})`);
    res.status(200).json(user);

  } catch (error) { // Removed : any type annotation
    error(`[getUserById] Error fetching user for ID ${idParam}:`, error);
    // Don't need CastError check if we validate ObjectId format first
    res.status(500).json({
      message: "Error fetching user",
      error: error.message
    });
  }
});