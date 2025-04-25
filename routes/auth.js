// routes/auth.js
import express from "express";
import asyncHandler from "express-async-handler";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js"; // Import protect middleware
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger exists

const router = express.Router();

// Constants for default values
const DEFAULT_PROFILE_PIC = '/images/default-profile.png';
const DEFAULT_COUNTRY = 'Unknown';
const USERNAME_PREFIX = 'user_';

// Helper for consistent responses
const successRes = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const errorRes = (res, message, status = 400, code = 'ERROR', details = null) => {
    warn(`[AuthRoute] Error Response: ${status} - ${code} - ${message}`, details || '');
    return res.status(status).json({ success: false, error: { message, code, details } });
};


// --- [GET] /api/auth/current-user ---
// Fetches the currently logged-in user's data from MongoDB
router.get(
  '/current-user',
  protect, // Ensures user is authenticated via Firebase token
  asyncHandler(async (req, res) => {
    // req.user is attached by the 'protect' middleware and contains the MongoDB user doc
    if (!req.user) {
      // This case should theoretically not be reached if 'protect' works correctly
      warn('[GET /current-user] User object not found on request after protect middleware.');
      return errorRes(res, "Authentication data missing after verification.", 500, 'INTERNAL_AUTH_ERROR');
    }

    info(`[GET /current-user] Returning data for user: ${req.user.username} (ID: ${req.user._id})`);
    // Exclude sensitive or unnecessary fields if User model wasn't selected carefully
    const { _id, firebaseUid, username, email, name, profilePic, country, role, createdAt } = req.user;
    return successRes(res, {
        user: { _id, firebaseUid, username, email, name, profilePic, country, role, createdAt }
    });
  })
);


// --- [POST] /api/auth/sync-firebase-user ---
// Creates or updates a user in MongoDB based on a verified Firebase Auth session.
// This should be called by the frontend *after* a successful Firebase login/signup.
router.post(
  "/sync-firebase-user",
  protect, // CRITICAL: Ensure only authenticated users can call this
  [ // Validate any *additional* info coming from frontend (country is common)
    body('country').optional().isString().trim().escape(),
    body('name').optional().isString().trim().escape(), // Allow frontend to provide initial name/country
    body('profilePic').optional().isURL(),
    // REMOVED firebaseUid, email, username from body validation - get from req.firebaseUser
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        warn("[POST /sync-firebase-user] Validation errors:", errors.array());
        return errorRes(res, "Invalid input data", 400, 'VALIDATION_FAILED', errors.array());
    }

    // Get authenticated user details from the protect middleware
    const firebaseUser = req.firebaseUser; // Decoded token from Firebase
    const mongoUserId = req.user?._id; // MongoDB user ID (if already exists)
    const firebaseUid = firebaseUser.uid;
    const firebaseEmail = firebaseUser.email?.toLowerCase(); // Ensure lowercase
    const firebaseName = firebaseUser.name;
    const firebaseProfilePic = firebaseUser.picture;

    info(`[POST /sync-firebase-user] Sync request for Firebase UID: ${firebaseUid}`);

    if (!firebaseUid || !firebaseEmail) {
        error("[POST /sync-firebase-user] Missing UID or Email from verified token.");
        return errorRes(res, "Incomplete authentication data.", 500, 'INTERNAL_AUTH_ERROR');
    }

    try {
        let user = req.user; // User doc from MongoDB found by 'protect' middleware
        let message = "User data synchronized.";
        let statusCode = 200;

        const clientProvidedName = req.body.name;
        const clientProvidedCountry = req.body.country;
        const clientProvidedProfilePic = req.body.profilePic;

        if (!user) {
            // User exists in Firebase, but not yet in MongoDB - Create new user
            info(`[POST /sync-firebase-user] User not found in DB, creating new entry for UID: ${firebaseUid}`);

            // Generate a default username if none provided (less common now)
            const username = `${USERNAME_PREFIX}${firebaseUid.substring(0, 8)}`;
            debug(`[POST /sync-firebase-user] Generated username: ${username}`);

            // Basic check if generated username exists (rare edge case)
            const usernameExists = await User.exists({ username });
            if (usernameExists) {
                warn(`[POST /sync-firebase-user] Generated username ${username} conflicts. Need a better strategy.`);
                // Consider appending random chars or prompting user later
                // For now, return an error or use a different default
                 return errorRes(res, "Username conflict during sync.", 500, 'USERNAME_CONFLICT');
            }

            user = new User({
                _id: new mongoose.Types.ObjectId(), // Use standard MongoDB ObjectId
                firebaseUid: firebaseUid,
                email: firebaseEmail,
                username: username, // Use generated username
                // Prefer client-provided name/country/pic first, then Firebase profile, then defaults
                name: clientProvidedName || firebaseName || username,
                country: clientProvidedCountry || DEFAULT_COUNTRY,
                profilePic: clientProvidedProfilePic || firebaseProfilePic || DEFAULT_PROFILE_PIC,
                role: 'user' // Default role
            });

            await user.save();
            info(`[POST /sync-firebase-user] New user created in MongoDB: ${user._id}`);
            message = "User account created and synchronized.";
            statusCode = 201;

        } else {
            // User exists in MongoDB - Check for necessary updates
            info(`[POST /sync-firebase-user] Found existing user: ${user._id}. Checking for updates.`);
            const updates = {};

            // Update name/pic/country if provided by client or different from Firebase profile
            const nameToSet = clientProvidedName || firebaseName;
            if (nameToSet && user.name !== nameToSet) updates.name = nameToSet;

            const picToSet = clientProvidedProfilePic || firebaseProfilePic;
            if (picToSet && user.profilePic !== picToSet) updates.profilePic = picToSet;

            const countryToSet = clientProvidedCountry || user.country; // Keep existing if client doesn't provide
            if (countryToSet && countryToSet !== 'Unknown' && user.country !== countryToSet) updates.country = countryToSet;

            // Ensure email is up-to-date (Firebase is source of truth)
             if (user.email !== firebaseEmail) {
                updates.email = firebaseEmail;
                warn(`[POST /sync-firebase-user] Updating email for user ${user._id} to ${firebaseEmail}`);
            }

            // Only update if there are changes
            if (Object.keys(updates).length > 0) {
                debug(`[POST /sync-firebase-user] Applying updates to user ${user._id}:`, updates);
                const updatedUser = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true, lean: true });
                 if (!updatedUser) {
                     error(`[POST /sync-firebase-user] Failed to apply updates for user ${user._id}`);
                     return errorRes(res, "Failed to update user data during sync.", 500, 'DB_UPDATE_FAILED');
                 }
                user = updatedUser; // Use the updated user data
                info(`[POST /sync-firebase-user] User details updated in MongoDB: ${user._id}`);
                message = "User data updated and synchronized.";
            } else {
                 info(`[POST /sync-firebase-user] No updates needed for user: ${user._id}`);
            }
        }

        // Prepare response (exclude sensitive fields)
        const { password, __v, ...userResponse } = user;

        return successRes(res, {
          message,
          user: userResponse
        }, statusCode);

    } catch (err) {
        error("❌ Error in /sync-firebase-user endpoint:", err);
        // Handle potential database errors (like unique constraint if username generation failed)
        if (err.code === 11000) {
            const field = Object.keys(err.keyValue)[0];
            warn(`[POST /sync-firebase-user] Duplicate key error on field: ${field}`);
             // This might happen if two requests race to create the user, or username conflict
            return errorRes(res, `An account conflict occurred (${field}). Please try logging in again.`, 409, 'SYNC_CONFLICT');
        }
        return errorRes(res, "Internal Server Error during user sync.", 500, 'INTERNAL_SERVER_ERROR');
    }
  })
);


// --- REMOVED /create-user route ---
// --- REMOVED /request-password-reset route ---

export default router;