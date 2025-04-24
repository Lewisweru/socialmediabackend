// controllers/userController.js or wherever getUser is defined

import User from "../models/User.js";
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger

// Get User by Firebase UID
export const getUser = async (req, res) => {
  try {
    const firebaseUserId = req.params.id; // The ID from the URL IS the Firebase UID
    info(`[getUser] Received request for Firebase UID: ${firebaseUserId}`);

    if (!firebaseUserId) {
        warn('[getUser] No Firebase UID provided in request params.');
        return res.status(400).json({ message: "User ID parameter is missing." });
    }

    // FIX: Find the user by the 'firebaseUid' field
    debug(`[getUser] Searching DB for user with firebaseUid: ${firebaseUserId}`);
    const user = await User.findOne({ firebaseUid: firebaseUserId }).select('-password'); // Exclude password

    if (!user) {
      info(`[getUser] User not found for Firebase UID: ${firebaseUserId}`);
      return res.status(404).json({ message: "User not found" });
    }

    info(`[getUser] Successfully found user for Firebase UID: ${firebaseUserId} (MongoDB ID: ${user._id})`);
    res.status(200).json(user); // Return the found user document

  } catch (error) {
    // Don't expect CastError here anymore, but handle other potential DB errors
    error(`[getUser] Error fetching user for Firebase UID ${req.params.id}:`, error);
    res.status(500).json({
      message: "Error fetching user",
      error: error.message
    });
  }
};