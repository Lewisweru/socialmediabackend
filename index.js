// --- START OF FILE index.js ---
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
// import session from 'express-session'; // REMOVED
// import MongoStore from 'connect-mongo'; // REMOVED
import dotenv from 'dotenv';
import helmet from 'helmet'; // Added Helmet
import morgan from 'morgan'; // Added Morgan for logging
import rateLimit from 'express-rate-limit';

// Use the default export (the promise) from db.js
import connectionPromise from './config/db.js';
import initializeFirebaseAdmin from './config/firebaseAdmin.js'; // Import initializer
// import config from './config.js'; // Using process.env directly now
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

// === Security Middleware ===
// Helmet (Basic security headers)
app.use(helmet());

// Trust Proxy Headers (Important for deployments like Render/Heroku)
// Adjust '1' if you have more proxies in front
const trustProxyLevel = parseInt(process.env.TRUST_PROXY_LEVEL || '1', 10);
app.set('trust proxy', trustProxyLevel);
info(`Trusting proxy headers (level: ${trustProxyLevel})`);

// Enhanced CORS Configuration
const frontendUrl = process.env.FRONTEND_URL;
if (!frontendUrl) {
    warn('FRONTEND_URL environment variable not set. CORS might block frontend requests in production.');
}
const corsOptions = {
  origin: frontendUrl || '*', // Restrict in production! Should be your specific frontend URL.
  credentials: true, // Allow cookies/auth headers to be sent from frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allowed methods
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'], // Allowed headers
  optionsSuccessStatus: 200 // For legacy browser compatibility
};
app.use(cors(corsOptions));
info(`CORS configured to allow origin: ${corsOptions.origin}`);

// Rate Limiting Configuration
const rateLimitOptions = {
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: process.env.NODE_ENV === 'development' ? 500 : 150, // Max requests per windowMs (adjust as needed)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { message: 'Too many requests from this IP, please try again after 15 minutes', code: 'RATE_LIMITED' },
    keyGenerator: (req, res) => req.ip // Use IP address (ensure trust proxy is set correctly)
};

// Create the limiter instance
const apiLimiter = rateLimit(rateLimitOptions);

// Apply limiter to API routes
app.use('/api/', apiLimiter);

// Log the configuration using the stored options object
info(`Global API rate limiting enabled (${rateLimitOptions.max} requests per ${rateLimitOptions.windowMs / 60000} minutes per IP)`);


// === Standard Middleware ===
// Request Logging (Morgan)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')); // 'combined' for prod, 'dev' for dev

// Body Parsers
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded bodies

// Cookie Parser (Keep if needed for non-auth purposes or other libraries)
app.use(cookieParser());

// --- REMOVED Session Middleware ---

// === Application Setup (Async IIFE) ===
(async () => {
    try {
        // Connect to Database by awaiting the promise from db.js
        info('Waiting for MongoDB connection...');
        await connectionPromise;
        info('MongoDB connection established.');

        // Load External Services (Example)
        // Ensure this function exists and works as expected
        await loadExoSupplierServices();
        info('ExoSupplier services loaded (if applicable).');

        // === Route Mounting ===
        info('Mounting API routes...');
        app.use('/api/auth', authRoutes);
        app.use('/api/orders', orderRoutes); // Protection applied within the route file
        app.use('/api/pesapal', pesapalRoutes); // Public IPN/callback routes likely here
        app.use('/api/users', userRoutes); // Protection applied within the route file
        info('API routes mounted.');

        // === Health Check Endpoint ===
        app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'healthy',
                message: 'Backend API is operational',
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development'
            });
        });
        // Redirect root path to health check for simple verification
        app.get('/', (req, res) => res.redirect(301, '/health'));

        // === 404 Handler (Not Found - Place after all valid routes) ===
        app.use((req, res, next) => {
            warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
            res.status(404).json({
                 error: { message: `Resource not found at ${req.originalUrl}`, code: 'NOT_FOUND' }
            });
        });

        // === Global Error Handler (MUST be last middleware) ===
        // Needs all 4 arguments (err, req, res, next) to be recognized as an error handler
        app.use((err, req, res, next) => {
            error('Unhandled Error Caught:', {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : '[Stack Hidden]', // Hide stack in prod
                url: req.originalUrl,
                method: req.method,
                status: err.status || 500,
                code: err.code // Pass custom code if available
            });

            // Determine status code safely
            const statusCode = typeof err.status === 'number' && err.status >= 400 && err.status < 600
                ? err.status
                : 500;

            // Determine message safely (hide internal details in production for 500 errors)
            const responseMessage = statusCode >= 500 && process.env.NODE_ENV === 'production'
                ? 'Internal Server Error'
                : err.message || 'An unexpected error occurred';

            // Determine error code
            const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'UNKNOWN_ERROR');

            // Send JSON response
            res.status(statusCode).json({
                error: {
                    message: responseMessage,
                    code: errorCode,
                    // Conditionally include stack in development ONLY
                    ...(process.env.NODE_ENV === 'development' && err.stack && { stack: err.stack })
                }
            });
        });

        // === Start Server ===
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => {
            info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
        });

    } catch (startupError) {
        error('FATAL: Server startup failed during async setup:', startupError);
        process.exit(1); // Exit if essential setup fails
    }
})(); // End of IIFE

// Optional: Graceful shutdown and process error handling
process.on('unhandledRejection', (reason, promise) => {
  error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Consider more sophisticated error reporting (e.g., Sentry)
  // Depending on the reason, you might want to gracefully shut down
  // process.exit(1); // Use with caution
});

process.on('uncaughtException', (err) => {
  error('Uncaught Exception:', err);
  // Consider more sophisticated error reporting
  // It's generally recommended to exit on uncaught exceptions as the application state might be corrupted
  process.exit(1);
});

// --- END OF FILE index.js ---