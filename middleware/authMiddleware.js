// middleware/authMiddleware.js

import admin from '../config/firebaseAdmin.js'; // Adjust path if needed
import User from '../models/User.js';           // Adjust path if needed
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger exists

/**
 * @description Middleware to verify Firebase ID Token. Attaches user to req.user.
 */
export const protect = async (req, res, next) => { // Ensure 'export const' is used
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
      const uid = decodedToken.uid;
      debug(`[Auth Protect] Token verified for UID: ${uid}`);

      // IMPORTANT: Check if your User model's ID field is '_id' or 'firebaseUid'
      // Adjust the query accordingly. Assuming '_id' matches Firebase UID here.
      // If you store Firebase UID in a different field, change 'findById(uid)'
      // to 'findOne({ firebaseUid: uid })'
      const mongoUser = await User.findById(uid).select('-password'); // Exclude password

      if (!mongoUser) {
        warn(`[Auth Protect] User UID ${uid} verified, but NOT found in local DB.`);
        return res.status(401).json({ message: 'User not fully registered or synchronized' });
      }
      debug(`[Auth Protect] Found user in DB: ${mongoUser._id}`);

      req.user = mongoUser; // Attach Mongoose user document
      next();

    } catch (err) { // Changed variable name
      error('[Auth Protect] Token verification failed:', err.code, err.message);
      let errorMessage = 'Not authorized, token verification failed';
      let statusCode = 401;

      if (err.code === 'auth/id-token-expired') {
        errorMessage = 'Not authorized, token expired';
        statusCode = 403;
      } else if (err.code === 'auth/argument-error') {
          errorMessage = 'Not authorized, token malformed or invalid';
      } else if (err.code === 'auth/id-token-revoked') {
          errorMessage = 'Not authorized, token has been revoked';
          statusCode = 403;
      }
      res.status(statusCode).json({ message: errorMessage });
    }
  } else {
    warn('[Auth Protect] No token provided or invalid format.');
    res.status(401).json({ message: 'Not authorized, no token provided or invalid format' });
  }
};

// Optional: isAdmin middleware (ensure User model has 'role' field)
/*
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Forbidden: Admin privileges required' });
  }
};
*/