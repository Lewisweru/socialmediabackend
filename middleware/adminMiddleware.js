// middleware/adminMiddleware.js

/**
 * Middleware to check if the authenticated user has the 'admin' role.
 * This MUST run AFTER the 'protect' middleware (which attaches req.user).
 */
export const isAdmin = (req, res, next) => {
    // 'protect' should have attached the MongoDB user object to req.user already
    if (req.user && req.user.role === 'admin') {
      // User has the 'admin' role, allow access to the next handler
      next();
    } else {
      // User is either not logged in, user object wasn't attached, or role is not 'admin'
      const userId = req.user?._id || 'Unknown';
      const userRole = req.user?.role || 'N/A';
      console.warn(`Admin Access Denied: User ${userId} with role '${userRole}' attempted admin route.`);
      // Send 403 Forbidden status code
      res.status(403).json({ message: 'Forbidden: Admin privileges required.' });
    }
  };