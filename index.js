// index.js (Complete - Correct Imports)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import config from './config.js'; // Assumes config.js exists and uses ESM export
import { info, warn, error, debug } from './utils/logger.js'; // Import logger
// Import the correct service loader function
import { loadExoSupplierServices } from './services/exoSupplierService.js'; // Use ExoSupplier

// Import Routers from their respective files in the 'routes' directory
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import pesapalRoutes from './routes/pesapal.js'; // Imports the default export (router)
import userRoutes from './routes/users.js';
// Import other routers if you have them
// import engagementRoutes from './routes/engagement.js';
// import transactionRoutes from './routes/transactions.js';
// import publicOrderRoutes from './routes/publicOrderRoutes.js';

dotenv.config(); // Load .env variables early

const app = express();

// --- Database Connection and Service Loading ---
const startServer = async () => {
    try {
        await connectDB();
        info('MongoDB Connected successfully.');

        // Call the correct service loader function
        await loadExoSupplierServices(); // Use ExoSupplier
        info('ExoSupplier services loading attempted. Check logs for success/errors.');

        // --- Start Express Server ---
        const PORT = config.server.port || 5000; // Use configured port
        app.listen(PORT, () => {
            info(`Server running in ${config.server.nodeEnv} mode on port ${PORT}`);
            info(`Accepting requests from: ${config.server.frontendUrl}`);
        });
    } catch (err) {
        error('FATAL: Server startup failed.', err);
        process.exit(1); // Exit if essential services fail
    }
};

// --- Core Middleware Setup ---
app.use(cors({
    origin: config.server.frontendUrl, // Restrict to your frontend URL
    credentials: true, // Allow cookies/auth headers if using sessions/cookies
}));
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- Basic Request Logger Middleware ---
app.use((req, res, next) => {
    // Log basic request info
    info(`REQ: ${req.method} ${req.originalUrl} from ${req.ip}`);
    // Optional: Log response status on finish
    res.on('finish', () => {
        debug(`RES: ${req.method} ${req.originalUrl} - Status: ${res.statusCode}`);
    });
    next();
});

// --- API Routes Mounting ---
// Mount the imported routers to their base paths
// Authentication/Authorization middleware (like 'protect' or 'isAdmin')
// should be applied WITHIN the specific route files (e.g., routes/orders.js)
// where protection is needed.
app.use('/api/auth', authRoutes);       // Handles /api/auth/...
app.use('/api/orders', orderRoutes);      // Handles /api/orders/...
app.use('/api/pesapal', pesapalRoutes);  // Handles /api/pesapal/ipn etc.
app.use('/api/users', userRoutes);        // Handles /api/users/...
// Add other routers here if created, e.g.:
// app.use('/api/engagements', engagementRoutes);
// app.use('/api/transactions', transactionRoutes);
// app.use('/api/public', publicOrderRoutes); // If you have public routes


// --- Simple Root Route for Health Check ---
app.get('/', (req, res) => {
    res.status(200).send('API is running and healthy!');
});

// --- Global Error Handler Middleware (Place AFTER all routes) ---
// Catches errors passed via next(err) or uncaught exceptions in async handlers
app.use((err, req, res, next) => {
    error('Unhandled Error Caught:', err.stack || err); // Log the full error stack for debugging
    const statusCode = err.status || err.statusCode || 500; // Use error's status or default to 500
    res.status(statusCode).json({
        message: err.message || 'An unexpected server error occurred. Please try again later.',
        // Avoid sending the stack trace in production environment for security
        stack: config.server.nodeEnv === 'development' ? err.stack : undefined,
    });
});

// --- Start the Server ---
startServer();