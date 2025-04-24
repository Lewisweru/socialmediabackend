// middleware/authMiddleware.js (Corrected - Removed .lean())

import { firebaseAdminAuth } from '../config/firebaseAdmin.js';
import User from '../models/User.js';
import { info, warn, error, debug } from '../utils/logger.js';

/**
 * @description Middleware to verify Firebase ID Token. Attaches MongoDB user doc to req.user.
 */
export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  const requestPath = req.originalUrl; // Get path for context

  info(`[Auth Protect ENTRY] Path: ${requestPath}. Auth Header Present: ${!!authHeader}`);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      token = authHeader.split(' ')[1];
      if (!token) {
        warn(`[Auth Protect - ${requestPath}] Token format invalid.`);
        // Ensure response is sent and function exits
        return res.status(401).json({ message: 'Not authorized, token format invalid' });
      }

      debug(`[Auth Protect - ${requestPath}] Verifying Firebase ID Token...`);
      const decodedToken = await firebaseAdminAuth.verifyIdToken(token);
      const firebaseUserId = decodedToken.uid; // This is the Firebase UID string
      debug(`[Auth Protect - ${requestPath}] Token verified for Firebase UID: ${firebaseUserId}`);

      // Find user by the dedicated 'firebaseUid' field
      info(`[Auth Protect - ${requestPath}] Searching DB for user with firebaseUid: ${firebaseUserId}`);
      let mongoUser = null;
      try {
          // FIX: Remove .lean() to get full Mongoose document instead of plain object
          mongoUser = await User.findOne({ firebaseUid: firebaseUserId }).select('-password');
      } catch (dbError) {
           error(`[Auth Protect - ${requestPath}] Database error during findOne({ firebaseUid: ${firebaseUserId} }):`, dbError);
           // Ensure response is sent and function exits
           return res.status(500).json({ message: 'Database error during authentication.' });
      }

      // Check if User Found and Log Result
      if (!mongoUser) {
        warn(`[Auth Protect - ${requestPath}] User UID ${firebaseUserId} verified, but NOT found in DB.`);
        // Ensure response is sent and function exits
        return res.status(401).json({ message: 'User not found in application database.' });
      } else {
        info(`[Auth Protect - ${requestPath}] Found user document in DB via firebaseUid.`);
        // Log the Mongoose document's _id directly
        // Mongoose documents have an _id property which should be the ObjectId
        debug(`[Auth Protect - ${requestPath}] mongoUser object found (Mongoose doc). _id: ${mongoUser._id}`);
        if (!mongoUser._id) {
             // This check is still valid, even without .lean()
             error(`[Auth Protect CRITICAL - ${requestPath}] Found user document BUT it's missing the _id field! UID: ${firebaseUserId}`);
             // Ensure response is sent and function exits
             return res.status(500).json({ message: 'User data integrity issue.' });
        } else {
             // Log the type as well, it should be 'object' for a Mongoose doc _id (ObjectId)
             debug(`[Auth Protect - ${requestPath}] mongoUser._id is present: ${mongoUser._id} (Type: ${typeof mongoUser._id})`);
        }
      }

      // Assign the full Mongoose document to req.user
      req.user = mongoUser;
      // Log after assignment, checking req.user._id directly
      info(`[Auth Protect - ${requestPath}] Assigned found user (Mongoose doc) to req.user. User _id: ${req.user?._id} (Type: ${typeof req.user?._id})`);

      // Proceed to next middleware/controller ONLY if user is found and assigned
      debug(`[Auth Protect - ${requestPath}] Calling next().`);
      next();

    } catch (err) { // Catch Firebase verification errors or others
      error(`[Auth Protect ERROR - ${requestPath}] Token verification/processing failed:`, err.code || 'Unknown Code', err.message);
      let errorMessage = 'Not authorized, token verification failed';
      let statusCode = 401;
      if (err.code === 'auth/id-token-expired') { errorMessage = 'Not authorized, token expired'; statusCode = 403; }
      else if (err.code === 'auth/argument-error') { errorMessage = 'Not authorized, token malformed'; }
      else if (err.code === 'auth/id-token-revoked') { errorMessage = 'Not authorized, token revoked'; statusCode = 403; }
      // Ensure we return here
      return res.status(statusCode).json({ message: errorMessage });
    }
  } else {
    warn(`[Auth Protect - ${requestPath}] No token/invalid format.`);
    // Ensure we return here
    return res.status(401).json({ message: 'Not authorized, no token provided or invalid format' });
  }
};

// Optional: isAdmin middleware
/*
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Forbidden: Admin privileges required' });
  }
};
*/