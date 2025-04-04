// middleware/authMiddleware.js

// --- Dependencies ---
import admin from '../config/firebaseAdmin.js'; // Adjust path to your Firebase Admin init file
import User from '../models/User.js'; // Adjust path to your User model

/**
 * @description Middleware to verify Firebase ID Token sent in the Authorization header.
 *              If valid, fetches the corresponding user from MongoDB and attaches
 *              it to `req.user`. Protects routes requiring authentication.
 * @param {object} req - Express request object. Expected header: Authorization: Bearer <Firebase ID Token>
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 */
export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization; // Get the Authorization header

  // 1. Check if Authorization header exists and starts with 'Bearer '
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // 2. Extract the Firebase ID Token (remove 'Bearer ')
      token = authHeader.split(' ')[1];

      if (!token) {
        // This case should be rare if startsWith('Bearer ') is true, but good to check
        console.warn('Auth Middleware: Token format invalid (empty after Bearer).');
        // Send 401 Unauthorized - Invalid request format
        return res.status(401).json({ message: 'Not authorized, token format invalid' });
      }

      // 3. Verify the Firebase ID Token using Firebase Admin SDK
      // This communicates with Google servers to check signature, expiration, and issuer.
      const decodedToken = await admin.auth().verifyIdToken(token);
      const uid = decodedToken.uid; // Get the unique Firebase User ID from the verified token

      // 4. Find the corresponding user in *your MongoDB database* using the Firebase UID.
      // The UID should match the `_id` field in your User model.
      // IMPORTANT: Exclude the password field from the returned user object for security.
      const mongoUser = await User.findById(uid).select('-password');

      // 5. Check if the user exists in your local database
      if (!mongoUser) {
         // This means the token was valid (user exists in Firebase Auth),
         // but the user record is missing from your MongoDB database.
         // This can happen if the backend sync during signup/google-signin failed.
         console.warn(`Auth Middleware: User UID ${uid} verified by Firebase, but NOT found in local DB.`);
         // Deny access because the user isn't fully registered within your application's context.
         return res.status(401).json({ message: 'User not fully registered or synchronized' });
      }

      // 6. Attach the MongoDB user object (Mongoose document) to the request object.
      // Subsequent middleware and route handlers can now access `req.user`.
      req.user = mongoUser;

      // 7. Proceed to the next middleware or the route handler
      next();

    } catch (error) {
      // Handle errors during token verification (e.g., expired, invalid signature)
      console.error('Authentication Error during token verification:', error.code, error.message);
      let errorMessage = 'Not authorized, token verification failed';
      let statusCode = 401; // Default to Unauthorized

      // Provide more specific error messages based on common Firebase error codes
      if (error.code === 'auth/id-token-expired') {
        errorMessage = 'Not authorized, token expired';
        statusCode = 403; // 403 Forbidden might be more appropriate for expired tokens
      } else if (error.code === 'auth/argument-error') {
          errorMessage = 'Not authorized, token malformed or invalid';
      } else if (error.code === 'auth/id-token-revoked') {
          // This happens if the user's session was manually revoked in Firebase Console
          errorMessage = 'Not authorized, token has been revoked';
          statusCode = 403;
      }
      // Add more specific error code checks if needed based on Firebase Admin SDK docs

      // Respond with the determined error status and message
      res.status(statusCode).json({ message: errorMessage });
    }
  } else {
    // 8. If no 'Authorization' header or it doesn't start with 'Bearer '
    res.status(401).json({ message: 'Not authorized, no token provided or invalid format' });
  }
};


// Optional: Middleware to check for specific roles if you implement them
/*
export const isAdmin = (req, res, next) => {
  // This middleware should run *after* the 'protect' middleware
  // It assumes 'protect' has successfully run and attached req.user

  if (req.user && req.user.role === 'admin') { // Check for 'role' field on your User model
    next(); // User has the 'admin' role, proceed
  } else {
    // User is authenticated but does not have the required role
    res.status(403).json({ message: 'Forbidden: Admin privileges required' });
  }
};
*/