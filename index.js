import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import connectDB from './config/db.js';
import initializeFirebaseAdmin from './config/firebaseAdmin.js';
import { info, warn, error, debug } from './utils/logger.js';
import { loadExoSupplierServices } from './services/exoSupplierService.js';

// Import Routes
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
// Helmet (Basic security headers)
app.use(helmet());

// Trust Proxy Headers (Important for deployments like Render/Heroku)
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

// Rate Limiting (Apply to all API routes)
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: process.env.NODE_ENV === 'development' ? 500 : 150, // More requests in dev
	standardHeaders: true,
	legacyHeaders: false,
    message: { message: 'Too many requests from this IP, please try again after 15 minutes', code: 'RATE_LIMITED' },
    keyGenerator: (req, res) => req.ip // Use IP address
});
app.use('/api/', apiLimiter);
info(`Global API rate limiting enabled (${apiLimiter.options.max} requests per ${apiLimiter.options.windowMs / 60000} minutes per IP)`);


// === Standard Middleware ===
// Request Logging (Morgan)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie Parser (Keep if needed for non-auth purposes)
app.use(cookieParser());

// === Application Setup (Async IIFE) ===
(async () => {
    try {
        // Connect to Database
        await connectDB();

        // Load External Services (Example)
        await loadExoSupplierServices();

        // === Route Mounting ===
        info('Mounting API routes...');
        app.use('/api/auth', authRoutes);
        app.use('/api/orders', orderRoutes);
        app.use('/api/pesapal', pesapalRoutes);
        app.use('/api/users', userRoutes);
        info('API routes mounted.');

        // === Health Check Endpoint ===
        app.get('/health', (req, res) => { // Changed path for clarity
            res.status(200).json({
                status: 'healthy',
                message: 'Backend API is operational',
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development'
            });
        });
        app.get('/', (req, res) => res.redirect(301, '/health')); // Redirect base path

        // === 404 Handler (Not Found) ===
        app.use((req, res, next) => {
            warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
            res.status(404).json({
                 error: { message: `Resource not found at ${req.originalUrl}`, code: 'NOT_FOUND' }
            });
        });

        // === Global Error Handler (MUST be last) ===
        app.use((err, req, res, next) => {
            error('Unhandled Error:', {
                message: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : 'Stack trace hidden',
                url: req.originalUrl,
                method: req.method,
                status: err.status || 500,
                code: err.code || 'INTERNAL_SERVER_ERROR'
            });

            const statusCode = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
            const responseMessage = statusCode >= 500 && process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message || 'An unexpected error occurred';
            const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'UNKNOWN_ERROR');

            res.status(statusCode).json({
                error: {
                    message: responseMessage,
                    code: errorCode,
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
        error('FATAL: Server startup failed:', startupError);
        process.exit(1); // Exit if essential setup fails
    }
})(); // End of IIFE

// Optional: Graceful shutdown and process error handling
process.on('unhandledRejection', (reason, promise) => {
  error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  error('Uncaught Exception:', err);
  process.exit(1); // Exit on uncaught exceptions
});