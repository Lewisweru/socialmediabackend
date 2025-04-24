import { firebaseAdminAuth } from '../config/firebaseAdmin.js';
import User from '../models/User.js';
import { info, warn, error, debug } from '../utils/logger.js';

/**
 * Enhanced auth middleware with:
 * - Better token verification
 * - Session persistence checks
 * - Improved error handling
 */
export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  const requestPath = req.originalUrl;

  info(`[Auth] Request to protected route: ${requestPath}`);

  // 1. Check for Authorization header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    warn(`[Auth] No token provided for ${requestPath}`);
    return res.status(401).json({ 
      message: 'Not authorized, no token provided',
      code: 'MISSING_TOKEN'
    });
  }

  // 2. Extract token
  token = authHeader.split(' ')[1];
  
  try {
    // 3. Verify Firebase token with checkRevoked
    debug(`[Auth] Verifying token for ${requestPath}`);
    const decodedToken = await firebaseAdminAuth.verifyIdToken(token, true);
    const firebaseUserId = decodedToken.uid;
    
    // 4. Check token expiration
    const expirationTime = new Date(decodedToken.exp * 1000);
    if (expirationTime < new Date()) {
      warn(`[Auth] Expired token for UID: ${firebaseUserId}`);
      return res.status(401).json({ 
        message: 'Session expired, please login again',
        code: 'TOKEN_EXPIRED'
      });
    }

    // 5. Find user in database
    debug(`[Auth] Finding user for UID: ${firebaseUserId}`);
    const user = await User.findOne({ firebaseUid: firebaseUserId })
      .select('-password')
      .lean();

    if (!user) {
      warn(`[Auth] No user found for UID: ${firebaseUserId}`);
      return res.status(404).json({ 
        message: 'User account not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // 6. Attach user to request
    req.user = user;
    debug(`[Auth] User authenticated: ${user._id}`);
    next();

  } catch (err) {
    // Handle specific Firebase errors
    let statusCode = 401;
    let errorCode = 'AUTH_ERROR';
    let message = 'Not authorized';

    switch (err.code) {
      case 'auth/id-token-expired':
        message = 'Session expired, please login again';
        errorCode = 'TOKEN_EXPIRED';
        statusCode = 403;
        break;
      case 'auth/id-token-revoked':
        message = 'Session revoked, please login again';
        errorCode = 'TOKEN_REVOKED';
        statusCode = 403;
        break;
      case 'auth/argument-error':
        message = 'Invalid authentication token';
        errorCode = 'INVALID_TOKEN';
        break;
      default:
        statusCode = 500;
        errorCode = 'SERVER_ERROR';
        message = 'Authentication failed';
    }

    error(`[Auth] Error: ${err.code || err.message}`);
    return res.status(statusCode).json({ 
      message,
      code: errorCode
    });
  }
};

/**
 * Admin check middleware
 */
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  if (req.user.role !== 'admin') {
    warn(`[Auth] Admin access denied for user: ${req.user._id}`);
    return res.status(403).json({ 
      message: 'Admin privileges required',
      code: 'ADMIN_REQUIRED'
    });
  }

  next();
};