// middleware/authMiddleware.js
import { firebaseAdminAuth } from '../config/firebaseAdmin.js'; // Correct import
import User from '../models/User.js';
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger exists
import asyncHandler from 'express-async-handler'; // Use asyncHandler

/**
 * Middleware to protect routes by verifying Firebase ID Token.
 * Attaches the corresponding MongoDB user document to req.user.
 */
export const protect = asyncHandler(async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  const requestPath = req.originalUrl;

  info(`[Protect] Request to: ${requestPath}`);

  // 1. Check for Authorization header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    warn(`[Protect] No token provided for ${requestPath}`);
    res.status(401).json({
      message: 'Not authorized, no token provided',
      code: 'NO_TOKEN'
    });
    return; // Important to return after sending response
  }

  // 2. Extract token
  token = authHeader.split(' ')[1];
  debug(`[Protect] Token received: ${token.substring(0, 10)}...`);

  try {
    // 3. Verify Firebase token (checkRevoked is true by default now in newer SDKs, explicit is fine)
    const decodedToken = await firebaseAdminAuth().verifyIdToken(token, true); // Use verifyIdToken()
    const firebaseUserId = decodedToken.uid;
    debug(`[Protect] Token verified for Firebase UID: ${firebaseUserId}`);

    // // 4. Check token expiration (verifyIdToken already does this)
    // const expirationTime = new Date(decodedToken.exp * 1000);
    // if (expirationTime < new Date()) { ... } // Redundant

    // 5. Find user in MongoDB database using firebaseUid
    // It's efficient to find the user here and attach it for downstream middleware/routes
    const user = await User.findOne({ firebaseUid: firebaseUserId })
      .select('-password') // Ensure password is never selected
      .lean(); // Use lean() for performance if not modifying the user object here

    if (!user) {
      // This case might happen if a user was deleted from MongoDB but still has a valid Firebase token.
      // Or if the /sync-firebase-user endpoint hasn't run yet for a new Firebase user.
      warn(`[Protect] No matching MongoDB user found for Firebase UID: ${firebaseUserId}. Path: ${requestPath}`);
      res.status(401).json({
        message: 'User account not synchronized or found.',
        code: 'USER_NOT_FOUND_IN_DB'
      });
       return; // Stop processing
    }

    // 6. Attach MongoDB user object to request
    req.user = user; // Contains MongoDB _id, role, email, username etc.
    req.firebaseUser = decodedToken; // Optionally attach decoded token if needed downstream (e.g., for email_verified)
    info(`[Protect] User authenticated: ${user.username} (ID: ${user._id})`);
    next();

  } catch (err) {
    // Handle specific Firebase errors
    let statusCode = 401;
    let errorCode = 'AUTH_ERROR';
    let message = 'Authentication failed. Please log in again.';

    error(`[Protect] Token verification failed for ${requestPath}:`, err); // Log the full error

    switch (err.code) {
      case 'auth/id-token-expired':
        message = 'Session expired, please log in again.';
        errorCode = 'TOKEN_EXPIRED';
        break; // Status 401 is appropriate
      case 'auth/id-token-revoked':
        message = 'Your session has been revoked, please log in again.';
        errorCode = 'TOKEN_REVOKED';
        break; // Status 401 is appropriate
      case 'auth/argument-error':
        message = 'Invalid authentication token format.';
        errorCode = 'INVALID_TOKEN';
        break;
      case 'auth/user-disabled':
          message: 'Your account has been disabled.';
          errorCode = 'USER_DISABLED';
          statusCode = 403; // Forbidden
          break;
      // Add other specific Firebase auth errors if needed
      default:
        // Don't leak internal details for generic errors
        errorCode = 'AUTH_VERIFICATION_FAILED';
        break;
    }

    res.status(statusCode).json({
      message,
      code: errorCode,
      // Optionally include more details in development
      ...(process.env.NODE_ENV === 'development' && { errorDetail: err.message })
    });
  }
});

/**
 * Middleware to check if the authenticated user has 'admin' role.
 * Must be used *after* the `protect` middleware.
 */
export const isAdmin = (req, res, next) => {
  // protect middleware should have already run and attached req.user
  if (!req.user) {
     error("[isAdmin] Attempted admin check without prior authentication (req.user missing).");
    return res.status(401).json({
      message: 'Authentication required before checking admin status.',
      code: 'NOT_AUTHENTICATED'
    });
  }

  if (req.user.role !== 'admin') {
    warn(`[isAdmin] Admin access denied for user: ${req.user._id} (${req.user.username})`);
    return res.status(403).json({
      message: 'Forbidden: Admin privileges required.',
      code: 'ADMIN_REQUIRED'
    });
  }

  info(`[isAdmin] Admin access granted for user: ${req.user._id} (${req.user.username})`);
  next(); // User is authenticated and is an admin
};