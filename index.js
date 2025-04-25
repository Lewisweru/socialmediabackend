// --- START OF FILE index.js --- (Corrected End)
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

// Database & Services
import connectionPromise from './config/db.js';
import initializeFirebaseAdmin from './config/firebaseAdmin.js';
import { info, warn, error, debug } from './utils/logger.js';
import { loadExoSupplierServices } from './services/exoSupplierService.js';

// Routes
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import pesapalRoutes from './routes/pesapal.js';
import userRoutes from './routes/users.js';

// Load Environment Variables
dotenv.config();

// Initialize Express App
const app = express();

// Initialize Firebase Admin SDK Early
try {
    initializeFirebaseAdmin();
} catch (firebaseInitError) {
    error("CRITICAL: Firebase Admin SDK failed to initialize. Exiting.", firebaseInitError);
    process.exit(1);
}

// === Security Middleware ===
app.use(helmet());
const trustProxyLevel = parseInt(process.env.TRUST_PROXY_LEVEL || '1', 10);
app.set('trust proxy', trustProxyLevel);
info(`Trusting proxy headers (level: ${trustProxyLevel})`);

// CORS Configuration
const frontendUrl = process.env.FRONTEND_URL;
if (!frontendUrl) {
    warn('FRONTEND_URL environment variable not set. CORS might block frontend requests in production.');
}
const corsOptions = {
  origin: frontendUrl || '*', // Restrict in production!
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
info(`CORS configured to allow origin: ${corsOptions.origin}`);

// Rate Limiting Configuration
const rateLimitOptions = {
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: process.env.NODE_ENV === 'development' ? 500 : 150,
	standardHeaders: true,
	legacyHeaders: false,
    message: { message: 'Too many requests from this IP, please try again after 15 minutes', code: 'RATE_LIMITED' },
    keyGenerator: (req, res) => req.ip
};
const apiLimiter = rateLimit(rateLimitOptions);
app.use('/api/', apiLimiter);
info(`Global API rate limiting enabled (${rateLimitOptions.max} requests per ${rateLimitOptions.windowMs / 60000} minutes per IP)`);

// === Standard Middleware ===
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// === Application Setup (Async IIFE) ===
(async () => {
    try {
        // Connect to Database
        info('Waiting for MongoDB connection...');
        await connectionPromise;
        info('MongoDB connection established.');

        // Load External Services
        await loadExoSupplierServices();
        info('External services loaded.');

     

        // === Route Mounting ===
        info('Mounting API routes...');

        app.use('/api/orders', pesapalRoutes); // Add this temporarily


        app.use('/api/auth', authRoutes);
        app.use('/api/orders', orderRoutes);
      
        app.use('/api/pesapal', pesapalRoutes);
        app.use('/api/users', userRoutes);
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
        app.get('/', (req, res) => res.redirect(301, '/health'));

        // === 404 Handler (AFTER routes) ===
        app.use((req, res, next) => {
            warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
            // Create an error object to pass to the global handler
            const err = new Error(`Resource not found at ${req.originalUrl}`);
            err.status = 404; // Set status property for the error handler
            err.code = 'NOT_FOUND';
            next(err); // Pass error to the global error handler
        });

        // === Global Error Handler (MUST be last) ===
        // Needs all 4 arguments (err, req, res, next)
        app.use((err, req, res, next) => { // Correct signature
            error('Unhandled Error Caught:', {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : '[Stack Hidden]',
                url: req.originalUrl,
                method: req.method,
                status: err.status || 500,
                code: err.code // Use code from error object if available
            });

            const statusCode = err.status && typeof err.status === 'number' && err.status >= 400 && err.status < 600
                ? err.status
                : 500;

            const responseMessage = statusCode >= 500 && process.env.NODE_ENV === 'production'
                ? 'Internal Server Error'
                : err.message || 'An unexpected error occurred';

            const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'UNKNOWN_ERROR');

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

// === Process Event Handlers (Outside IIFE) ===
process.on('unhandledRejection', (reason, promise) => {
  error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optional: Add more robust handling like logging details or sending alerts
  // process.exit(1); // Consider implications before exiting automatically
});

process.on('uncaughtException', (err) => {
  error('Uncaught Exception:', err);
  // Optional: Add more robust handling
  // It's generally advised to exit on uncaught exceptions
  process.exit(1);
});

// --- END OF FILE index.js ---