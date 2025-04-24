// middleware/authMiddleware.js (Enhanced Debugging)

import { firebaseAdminAuth } from '../config/firebaseAdmin.js';
import User from '../models/User.js';
import { info, warn, error, debug } from '../utils/logger.js';

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
        return res.status(401).json({ message: 'Not authorized, token format invalid' });
      }

      debug(`[Auth Protect - ${requestPath}] Verifying Firebase ID Token...`);
      const decodedToken = await firebaseAdminAuth.verifyIdToken(token);
      const firebaseUserId = decodedToken.uid;
      debug(`[Auth Protect - ${requestPath}] Token verified for Firebase UID: ${firebaseUserId}`);

      // --- Database Lookup ---
      info(`[Auth Protect - ${requestPath}] Searching DB for user with firebaseUid: ${firebaseUserId}`);
      let mongoUser = null; // Initialize explicitly
      try {
          mongoUser = await User.findOne({ firebaseUid: firebaseUserId }).select('-password').lean(); // Use .lean() for plain object
          // Note: .lean() returns a plain JS object, not a Mongoose document. Might be relevant.
      } catch (dbError) {
           error(`[Auth Protect - ${requestPath}] Database error during findOne({ firebaseUid: ${firebaseUserId} }):`, dbError);
           // Decide if this is a 500 or should still be 401
           return res.status(500).json({ message: 'Database error during authentication.' });
      }
      // --- End Database Lookup ---


      // --- Check if User Found and Log Result ---
      if (!mongoUser) {
        warn(`[Auth Protect - ${requestPath}] User UID ${firebaseUserId} verified, but NOT found in DB.`);
        return res.status(401).json({ message: 'User not found in application database.' });
      } else {
        info(`[Auth Protect - ${requestPath}] Found user in DB via firebaseUid.`);
        // Log the structure *before* assigning to req.user
        debug(`[Auth Protect - ${requestPath}] mongoUser object found:`, JSON.stringify(mongoUser, null, 2));
        // Explicitly check for _id *on the found object*
        if (!mongoUser._id) {
             error(`[Auth Protect CRITICAL - ${requestPath}] Found user document BUT it's missing the _id field! UID: ${firebaseUserId}`);
             // This indicates a serious data integrity issue if it happens
             return res.status(500).json({ message: 'User data integrity issue.' });
        } else {
             debug(`[Auth Protect - ${requestPath}] mongoUser._id is present: ${mongoUser._id}`);
        }
      }
      // --- End Check ---


      // --- Assign to req.user ---
      req.user = mongoUser; // Assign the plain JS object (from .lean()) or Mongoose doc
      info(`[Auth Protect - ${requestPath}] Assigned found user to req.user. Type: ${typeof req.user}, Has _id: ${!!req.user?._id}`);
      // --- End Assignment ---


      // --- Proceed ---
      debug(`[Auth Protect - ${requestPath}] Calling next().`);
      next();
      // --- End Proceed ---

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

// Removed isAdmin for brevity unless needed