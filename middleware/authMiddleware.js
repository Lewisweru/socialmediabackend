// middleware/authMiddleware.js (Corrected - Find User by String _id)

import admin from '../config/firebaseAdmin.js';
import User from '../models/User.js';
import { info, warn, error, debug } from '../utils/logger.js';

export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;
  const requestPath = req.originalUrl;

  info(`[Auth Protect ENTRY] Path: ${requestPath}. Auth Header Present: ${!!authHeader}`);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      token = authHeader.split(' ')[1];
      if (!token) { /* ... handle error ... */ }

      debug(`[Auth Protect - ${requestPath}] Verifying Token...`);
      const decodedToken = await firebaseAdminAuth.verifyIdToken(token);
      const firebaseUserId = decodedToken.uid; // This is the string ID
      debug(`[Auth Protect - ${requestPath}] Token verified for UID: ${firebaseUserId}`);

      // FIX: Find user by _id, which IS the Firebase UID string in this schema
      info(`[Auth Protect - ${requestPath}] Searching DB for user with _id: ${firebaseUserId}`);
      let mongoUser = null;
      try {
          // Use findById because _id is the string firebaseUid
          mongoUser = await User.findById(firebaseUserId).select('-password').lean();
      } catch (dbError) { /* ... handle DB error ... */ }

      if (!mongoUser) {
        warn(`[Auth Protect - ${requestPath}] User UID ${firebaseUserId} NOT found in DB via _id.`);
        return res.status(401).json({ message: 'User not registered in application database.' });
      } else {
        info(`[Auth Protect - ${requestPath}] Found user in DB via _id.`);
        debug(`[Auth Protect - ${requestPath}] mongoUser object found:`, JSON.stringify(mongoUser, null, 2));
        // Check for _id (which should be the firebaseUid string)
        if (!mongoUser._id) { error(`[Auth Protect CRITICAL - ${requestPath}] User doc missing _id!`); return res.status(500).json({ message: 'User data integrity issue.' }); }
        else { debug(`[Auth Protect - ${requestPath}] mongoUser._id is present: ${mongoUser._id}`); }
      }

      // Assign to req.user
      req.user = mongoUser;
      info(`[Auth Protect - ${requestPath}] Assigned found user to req.user. User _id: ${req.user?._id}`);

      // Proceed
      debug(`[Auth Protect - ${requestPath}] Calling next().`);
      next();

    } catch (err) { /* ... error handling ... */ }
  } else { /* ... handle missing token ... */ }
};