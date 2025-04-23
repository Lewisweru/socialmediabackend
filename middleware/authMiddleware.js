// middleware/authMiddleware.js (Corrected User Lookup for Option 1)

import admin from '../config/firebaseAdmin.js'; // Correct path assumed
import User from '../models/User.js';           // Correct path assumed
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger exists

/**
 * @description Middleware to verify Firebase ID Token. Attaches MongoDB user doc to req.user.
 */
export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      token = authHeader.split(' ')[1];
      if (!token) {
        warn('[Auth Protect] Token format invalid (empty after Bearer).');
        return res.status(401).json({ message: 'Not authorized, token format invalid' });
      }

      debug('[Auth Protect] Verifying Firebase ID Token...');
      const decodedToken = await admin.auth().verifyIdToken(token);
      const firebaseUserId = decodedToken.uid; // This is the Firebase UID string (e.g., '3Nr...')
      debug(`[Auth Protect] Token verified for Firebase UID: ${firebaseUserId}`);

      // FIX: Find user by the dedicated 'firebaseUid' field now
      info(`[Auth Protect] Searching DB for user with firebaseUid: ${firebaseUserId}`);
      const mongoUser = await User.findOne({ firebaseUid: firebaseUserId }).select('-password'); // Find by firebaseUid

      if (!mongoUser) {
        // User authenticated with Firebase, but no matching record in our DB via firebaseUid
        warn(`[Auth Protect] User UID ${firebaseUserId} verified, but NOT found in local DB via firebaseUid field.`);
        return res.status(401).json({ message: 'User not fully registered or synchronized' });
      }
      // SUCCESS: mongoUser is the full Mongoose document, including its MongoDB _id
      debug(`[Auth Protect] Found user in DB. MongoDB _id: ${mongoUser._id}, Firebase UID: ${mongoUser.firebaseUid}`);

      // Attach the full MongoDB user document (with its _id) to req.user
      req.user = mongoUser;
      next(); // Proceed to the next middleware/route handler

    } catch (err) { // Handle Firebase verification errors
      error('[Auth Protect] Token verification failed:', err.code || 'Unknown Code', err.message);
      let errorMessage = 'Not authorized, token verification failed';
      let statusCode = 401;

      if (err.code === 'auth/id-token-expired') { errorMessage = 'Not authorized, token expired'; statusCode = 403; }
      else if (err.code === 'auth/argument-error') { errorMessage = 'Not authorized, token malformed or invalid'; }
      else if (err.code === 'auth/id-token-revoked') { errorMessage = 'Not authorized, token has been revoked'; statusCode = 403; }

      res.status(statusCode).json({ message: errorMessage });
    }
  } else {
    // No Authorization header or incorrect format
    warn('[Auth Protect] No token provided or invalid format.');
    res.status(401).json({ message: 'Not authorized, no token provided or invalid format' });
  }
};

// Optional: isAdmin middleware (Unchanged, relies on req.user being set correctly by 'protect')
/*
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Forbidden: Admin privileges required' });
  }
};
*/