// middleware/verifyTokenOnly.js
import { firebaseAdminAuth } from '../config/firebaseAdmin.js';
import { info, warn, error, debug } from '../utils/logger.js';
import asyncHandler from 'express-async-handler';

/**
 * Middleware to verify Firebase ID Token ONLY.
 * Attaches the decoded token to req.firebaseUser.
 * Does NOT require the user to exist in the MongoDB database.
 * Used specifically for the user sync endpoint.
 */
export const verifyTokenOnly = asyncHandler(async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  const requestPath = req.originalUrl;

  info(`[VerifyTokenOnly] Request to: ${requestPath}`);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    warn(`[VerifyTokenOnly] No token provided for ${requestPath}`);
    return res.status(401).json({ message: 'Not authorized, no token provided', code: 'NO_TOKEN' });
  }

  token = authHeader.split(' ')[1];
  debug(`[VerifyTokenOnly] Token received: ${token.substring(0, 10)}...`);

  try {
    // Verify Firebase token (checkRevoked = true ensures revoked tokens are rejected)
    const decodedToken = await firebaseAdminAuth().verifyIdToken(token, true);
    req.firebaseUser = decodedToken; // Attach the decoded token
    info(`[VerifyTokenOnly] Token verified for Firebase UID: ${decodedToken.uid}`);
    next(); // Proceed to the route handler

  } catch (err) {
    // Handle token verification errors identically to the 'protect' middleware
    let statusCode = 401;
    let errorCode = 'AUTH_ERROR';
    let message = 'Authentication failed. Please log in again.';

    error(`[VerifyTokenOnly] Token verification failed for ${requestPath}:`, err);

    switch (err.code) {
      case 'auth/id-token-expired':
        message = 'Session expired, please log in again.';
        errorCode = 'TOKEN_EXPIRED';
        break;
      case 'auth/id-token-revoked':
        message = 'Your session has been revoked, please log in again.';
        errorCode = 'TOKEN_REVOKED';
        break;
      case 'auth/argument-error':
        message = 'Invalid authentication token format.';
        errorCode = 'INVALID_TOKEN';
        break;
       case 'auth/user-disabled':
          message = 'Your account has been disabled.';
          errorCode = 'USER_DISABLED';
          statusCode = 403; // Forbidden
          break;
      default:
        errorCode = 'AUTH_VERIFICATION_FAILED';
        break;
    }

    return res.status(statusCode).json({
      message,
      code: errorCode,
      ...(process.env.NODE_ENV === 'development' && { errorDetail: err.message })
    });
  }
});