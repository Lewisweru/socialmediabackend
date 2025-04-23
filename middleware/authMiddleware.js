// middleware/authMiddleware.js (Corrected Import)

// Import the specific named export 'firebaseAdminAuth'
import { firebaseAdminAuth } from '../config/firebaseAdmin.js'; // Use { }
import User from '../models/User.js';
import { info, warn, error, debug } from '../utils/logger.js';

/**
 * @description Middleware to verify Firebase ID Token. Attaches user to req.user.
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
      // Use the imported firebaseAdminAuth object
      const decodedToken = await firebaseAdminAuth.verifyIdToken(token); // Use imported variable
      const uid = decodedToken.uid;
      debug(`[Auth Protect] Token verified for UID: ${uid}`);

      // Adjust query based on how you link User model to Firebase UID (_id or firebaseUid field)
      const mongoUser = await User.findById(uid).select('-password'); // Or User.findOne({ firebaseUid: uid })

      if (!mongoUser) {
        warn(`[Auth Protect] User UID ${uid} verified, but NOT found in local DB.`);
        return res.status(401).json({ message: 'User not fully registered or synchronized' });
      }
      debug(`[Auth Protect] Found user in DB: ${mongoUser._id}`);

      req.user = mongoUser;
      next();

    } catch (err) {
      error('[Auth Protect] Token verification failed:', err.code, err.message);
      let errorMessage = 'Not authorized, token verification failed';
      let statusCode = 401;

      if (err.code === 'auth/id-token-expired') { errorMessage = 'Not authorized, token expired'; statusCode = 403; }
      else if (err.code === 'auth/argument-error') { errorMessage = 'Not authorized, token malformed or invalid'; }
      else if (err.code === 'auth/id-token-revoked') { errorMessage = 'Not authorized, token has been revoked'; statusCode = 403; }

      res.status(statusCode).json({ message: errorMessage });
    }
  } else {
    warn('[Auth Protect] No token provided or invalid format.');
    res.status(401).json({ message: 'Not authorized, no token provided or invalid format' });
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