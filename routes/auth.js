// routes/auth.js (Use verifyTokenOnly for sync route)
import express from "express";
import asyncHandler from "express-async-handler";
import { body, validationResult } from "express-validator";
import mongoose from 'mongoose';
import User from "../models/User.js";
// Import BOTH middlewares
import { protect } from "../middleware/authMiddleware.js";
import { verifyTokenOnly } from "../middleware/verifyTokenOnly.js"; // <-- Import new middleware
import { info, warn, error, debug } from '../utils/logger.js';

const router = express.Router();

// Constants and Helpers (keep as before)
const DEFAULT_PROFILE_PIC = '/images/default-profile.png';
const DEFAULT_COUNTRY = 'Unknown';
const USERNAME_PREFIX = 'user_';
const successRes = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const errorRes = (res, message, status = 400, code = 'ERROR', details = null) => { /* ... */ };

// --- [GET] /api/auth/current-user ---
// This route requires the user to exist in MongoDB, so use 'protect'
router.get(
  '/current-user',
  protect, // Keep using protect here
  asyncHandler(async (req, res) => {
    // ... (keep existing handler logic) ...
     if (!req.user) {
      warn('[GET /current-user] User object not found on request after protect middleware.');
      return errorRes(res, "Authentication data missing after verification.", 500, 'INTERNAL_AUTH_ERROR');
    }
    info(`[GET /current-user] Returning data for user: ${req.user.username} (ID: ${req.user._id})`);
    return successRes(res, { user: req.user });
  })
);

// --- [POST] /api/auth/sync-firebase-user ---
// This route only needs token verification, not necessarily a pre-existing DB user
router.post(
  "/sync-firebase-user",
  verifyTokenOnly, // <-- Use the new middleware here
  [ // Validation for body data still applies
    body('country').optional().isString().trim().escape(),
    body('name').optional().isString().trim().escape(),
    body('profilePic').optional().isURL(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // ... validation error handling ...
        return errorRes(res, "Invalid input data", 400, 'VALIDATION_FAILED', errors.array());
    }

    // Get decoded token details from verifyTokenOnly middleware
    const firebaseUser = req.firebaseUser;
    // We CANNOT assume req.user exists here yet
    const firebaseUid = firebaseUser?.uid;
    const firebaseEmail = firebaseUser?.email?.toLowerCase();
    const firebaseNameFromToken = firebaseUser?.name;
    const firebaseProfilePicFromToken = firebaseUser?.picture;

    info(`[POST /sync-firebase-user] Sync request for Firebase UID: ${firebaseUid}`);

    if (!firebaseUid || !firebaseEmail) {
        error("[POST /sync-firebase-user] Missing UID or Email from verified token (should not happen if verifyTokenOnly worked).");
        return errorRes(res, "Incomplete authentication data.", 500, 'INTERNAL_AUTH_ERROR');
    }

    const clientProvidedName = req.body.name;
    const clientProvidedCountry = req.body.country;
    const clientProvidedProfilePic = req.body.profilePic;

    try {
        // Explicitly look for the user in DB *inside* the handler now
        let user = await User.findOne({ firebaseUid: firebaseUid }).lean();
        let message = "User data synchronized.";
        let statusCode = 200;
        let isNewUser = false;

        if (!user) {
            // User NOT found, create them
            isNewUser = true;
            info(`[POST /sync-firebase-user] User not found in DB, creating new entry for UID: ${firebaseUid}`);
            // ... (keep the email conflict check and username generation logic as before) ...
             const emailConflict = await User.findOne({ email: firebaseEmail }).lean(); // Check if email exists at all
             if (emailConflict) {
                  warn(`[POST /sync-firebase-user] Conflict detected: Email ${firebaseEmail} already exists for user ${emailConflict._id} (UID: ${emailConflict.firebaseUid})`);
                  return errorRes(res, `Email ${firebaseEmail} is already associated with a different account.`, 409, 'EMAIL_CONFLICT');
             }
            const baseUsername = `${USERNAME_PREFIX}${firebaseUid.substring(0, 8)}`;
            let username = baseUsername;
            let attempt = 0;
             while (await User.exists({ username: username })) { /* ... username generation loop ... */
                attempt++;
                username = `${baseUsername}_${attempt}`;
                if (attempt > 10) {
                    error(`[POST /sync-firebase-user] Could not generate unique username for ${firebaseUid}`);
                    return errorRes(res, "Failed to generate unique username.", 500, 'USERNAME_GENERATION_FAILED');
                }
             }
            debug(`[POST /sync-firebase-user] Generated username: ${username}`);


            const newUserDoc = new User({
                firebaseUid: firebaseUid,
                email: firebaseEmail,
                username: username,
                name: clientProvidedName || firebaseNameFromToken || username,
                country: clientProvidedCountry || DEFAULT_COUNTRY,
                profilePic: clientProvidedProfilePic || firebaseProfilePicFromToken || DEFAULT_PROFILE_PIC,
                role: 'user'
            });

            await newUserDoc.save();
            user = newUserDoc.toObject({ versionKey: false });
            delete user.password;

            info(`[POST /sync-firebase-user] New user created in MongoDB: ${user._id}`);
            message = "User account created and synchronized.";
            statusCode = 201;

        } else {
            // User FOUND, check for updates
            info(`[POST /sync-firebase-user] Found existing user: ${user._id}. Checking for updates.`);
            const updates = {};
            // ... (keep the logic for checking/applying updates based on client/token data) ...
             const nameToSet = clientProvidedName || firebaseNameFromToken;
             if (nameToSet && user.name !== nameToSet) updates.name = nameToSet;
             const picToSet = clientProvidedProfilePic || firebaseProfilePicFromToken;
             if (picToSet && user.profilePic !== picToSet) updates.profilePic = picToSet;
             if (clientProvidedCountry && user.country !== clientProvidedCountry) updates.country = clientProvidedCountry;
             if (user.email !== firebaseEmail) {
                 const emailConflict = await User.findOne({ email: firebaseEmail, _id: { $ne: user._id } }).lean();
                 if (emailConflict) {
                     warn(`[POST /sync-firebase-user] Cannot update email for ${user._id}, ${firebaseEmail} is already taken by ${emailConflict._id}`);
                 } else {
                     updates.email = firebaseEmail;
                     warn(`[POST /sync-firebase-user] Updating email for user ${user._id} from ${user.email} to ${firebaseEmail}`);
                 }
             }

            if (Object.keys(updates).length > 0) {
                debug(`[POST /sync-firebase-user] Applying updates to user ${user._id}:`, updates);
                const updatedUser = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true, runValidators: true, lean: true, select: '-password' });
                if (!updatedUser) { /* ... error handling ... */ }
                user = updatedUser;
                info(`[POST /sync-firebase-user] User details updated in MongoDB: ${user._id}`);
                message = "User data updated and synchronized.";
            } else {
                info(`[POST /sync-firebase-user] No updates needed for user: ${user._id}`);
            }
        }

        // ... (keep final null check and response logic) ...
        if (!user) {
             error("[POST /sync-firebase-user] User object is unexpectedly null before sending response.");
             return errorRes(res, "Internal error during user sync finalization.", 500, 'INTERNAL_SYNC_ERROR');
        }
        const { password, __v, ...userResponse } = user;
        return successRes(res, { message, user: userResponse }, statusCode);

    } catch (err) {
        // ... (keep existing catch block logic) ...
        error("❌ Error in /sync-firebase-user endpoint:", err);
        if (err.code === 11000) { /* ... */ }
        if (err.name === 'ValidationError') { /* ... */ }
        return errorRes(res, "Internal Server Error during user sync.", 500, 'INTERNAL_SERVER_ERROR');
    }
  })
);

export default router;
// --- END OF FILE routes/auth.js ---