// middleware/authMiddleware.js
import admin from '../config/firebaseAdmin.js'; // Adjust path to your Firebase Admin init file
import User from '../models/User.js'; // Adjust path to your User model

/**
 * Middleware to protect routes by verifying Firebase ID token.
 * Attaches the MongoDB user document (excluding password) to req.user if successful.
 */
export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  // Check if Authorization header exists and starts with 'Bearer'
  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      // Extract token from "Bearer <token>"
      token = authHeader.split(' ')[1];

      if (!token) {
        console.warn('Auth Middleware: Token format invalid or missing.');
        return res.status(401).json({ message: 'Not authorized, token invalid format' });
      }

      // Verify the ID token using Firebase Admin SDK.
      // This checks if the token is valid and not expired.
      const decodedToken = await admin.auth().verifyIdToken(token);
      const uid = decodedToken.uid; // Get Firebase User ID

      // Find the user in *your MongoDB database* using the UID.
      // Exclude the password field for security.
      const mongoUser = await User.findById(uid).select('-password');

      if (!mongoUser) {
         // The user is authenticated with Firebase, but doesn't exist in your DB.
         // This could happen if the signup sync failed. Handle as appropriate.
         // For now, deny access as the user isn't fully registered in *your* system.
         console.warn(`Auth Middleware: User UID ${uid} verified, but not found in local DB.`);
         return res.status(401).json({ message: 'User not fully registered or found' });
      }

      // Attach the MongoDB user object to the request object.
      // Route handlers can now access user info via req.user.
      req.user = mongoUser;

      next(); // Proceed to the next middleware or route handler

    } catch (error) {
      // Handle token verification errors (e.g., expired, invalid signature)
      console.error('Authentication Error:', error.message);
      let errorMessage = 'Not authorized, token failed verification';
      if (error.code === 'auth/id-token-expired') {
        errorMessage = 'Not authorized, token expired';
      } else if (error.code === 'auth/argument-error') {
          errorMessage = 'Not authorized, token malformed';
      }
      res.status(401).json({ message: errorMessage });
    }
  }

  // If no token was found in the header at all
  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token provided' });
  }
};

// Optional: Middleware to check for specific roles if you implement them
// export const adminOnly = (req, res, next) => {
//   if (req.user && req.user.role === 'admin') {
//     next();
//   } else {
//     res.status(403).json({ message: 'Not authorized as an admin' });
//   }
// };