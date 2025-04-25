// index.js
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
// import session from 'express-session'; // REMOVED
// import MongoStore from 'connect-mongo'; // REMOVED
import dotenv from 'dotenv';
import helmet from 'helmet'; // Added Helmet
import morgan from 'morgan'; // Added Morgan for logging
import rateLimit from 'express-rate-limit';

import connectDB from './config/db.js';
import initializeFirebaseAdmin from './config/firebaseAdmin.js'; // Import initializer
import config from './config.js';
import { info, warn, error, debug } from './utils/logger.js'; // Assuming logger exists
import { loadExoSupplierServices } from './services/exoSupplierService.js';

// Import Routes
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import pesapalRoutes from './routes/pesapal.js';
import userRoutes from './routes/users.js';

// --- Load Environment Variables ---
dotenv.config();

// --- Initialize Express App ---
const app = express();

// --- Initialize Firebase Admin ---
try {
    initializeFirebaseAdmin(); // Initialize Firebase early
} catch (firebaseInitError) {
    error("CRITICAL: Firebase Admin SDK failed to initialize. Exiting.", firebaseInitError);
    process.exit(1);
}

// --- Security Middleware ---
app.use(helmet()); // Apply security headers

// Trust proxy headers (important if behind a load balancer like on Render)
app.set('trust proxy', 1);

// Enhanced CORS Configuration
const corsOptions = {
  origin: config.server.frontendUrl || process.env.FRONTEND_URL, // Use config or env
  credentials: true, // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  // exposedHeaders: ['set-cookie'], // Not needed without session cookies
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
info(`CORS configured to allow origin: ${corsOptions.origin}`);

// Rate Limiting (Apply globally or more selectively)
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per windowMs
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use('/api/', apiLimiter); // Apply to all API routes
info('Global API rate limiting enabled (100 requests per 15 minutes per IP)');

// --- Body Parsers & Cookie Parser ---
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded bodies
app.use(cookieParser()); // Parse cookies (might still be useful)

// --- Request Logging ---
// Use morgan for standard logging or keep custom logger
app.use(morgan('dev')); // Example: Use morgan 'dev' format
// Keep custom logger if preferred:
// app.use((req, res, next) => { ... });

// --- Database Connection ---
connectDB()
  .then(() => {
    info('MongoDB Connected successfully.');
    // --- Load Services (if needed after DB connection) ---
    return loadExoSupplierServices();
  })
  .then(() => {
    info('ExoSupplier services loaded.');

    // --- Route Mounting ---
    info('Mounting API routes...');
    app.use('/api/auth', authRoutes);
    app.use('/api/orders', orderRoutes); // Assume protected internally or via middleware applied in the file
    app.use('/api/pesapal', pesapalRoutes); // Likely doesn't need auth protection
    app.use('/api/users', userRoutes); // Assume protected internally or via middleware applied in the file
    info('API routes mounted.');

    // --- Health Check ---
    app.get('/', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        message: 'Backend is running',
        timestamp: new Date().toISOString(),
        environment: config.server.nodeEnv || process.env.NODE_ENV
      });
    });

    // --- 404 Handler ---
    app.use((req, res, next) => {
        res.status(404).json({ message: `Not Found - ${req.originalUrl}` });
    });


    // --- Global Error Handler ---
    // Ensure this is the LAST middleware
    app.use((err, req, res, next) => {
      error('Unhandled Error:', {
        message: err.message,
        stack: config.server.nodeEnv === 'development' ? err.stack : 'Stack trace hidden in production',
        url: req.originalUrl,
        method: req.method,
        status: err.status || 500
      });

      // Avoid sending stack trace in production
      const errorResponse = {
          message: err.message || 'Internal Server Error',
          code: err.code || 'INTERNAL_SERVER_ERROR',
          ...(config.server.nodeEnv === 'development' && { stack: err.stack }) // Conditionally include stack
      };

      res.status(err.status || 500).json({ error: errorResponse });
    });

    // --- Start Server ---
    const PORT = config.server.port || process.env.PORT || 5000;
    app.listen(PORT, () => {
      info(`Server running in ${config.server.nodeEnv || process.env.NODE_ENV} mode on port ${PORT}`);
    });

  })
  .catch((err) => {
    error('Server startup failed:', err);
    process.exit(1);
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optionally exit process or implement more robust error handling
});

process.on('uncaughtException', (err) => {
  error('Uncaught Exception:', err);
  // Optionally exit process or implement more robust error handling
  process.exit(1); // Often recommended to restart on uncaught exceptions
});