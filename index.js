// index.js (Corrected - Imports Routers Correctly)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import config from './config.js'; // Assumes config.js exists and uses ESM export
import { info, error } from './utils/logger.js';
import { loadJeskieServices } from './services/jeskieService.js';

// Import Routers from their respective files in the 'routes' directory
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import pesapalRoutes from './routes/pesapal.js'; // Imports the default export (router)
import userRoutes from './routes/users.js';

dotenv.config();

const app = express();

// --- Database Connection and Service Loading ---
const startServer = async () => {
    try {
        await connectDB();
        info('MongoDB Connected successfully.');
        await loadJeskieServices(); // Load services after DB connection
        info('Jeskie services loading attempted.'); // Check logs for success/failure
        const PORT = config.server.port || 3000;
        app.listen(PORT, () => {
            info(`Server running in ${config.server.nodeEnv} mode on port ${PORT}`);
            info(`Accepting requests from: ${config.server.frontendUrl}`);
        });
    } catch (err) {
        error('FATAL: Server startup failed.', err);
        process.exit(1);
    }
};

// --- Middleware Setup ---
app.use(cors({
    origin: config.server.frontendUrl, // Restrict to frontend URL
    credentials: true, // Allow cookies/auth headers if needed
}));
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- Basic Request Logger ---
app.use((req, res, next) => {
    info(`REQ: ${req.method} ${req.originalUrl}`); // Log incoming requests
    next();
});

// --- API Routes ---
// Mount the imported routers to their base paths
// Middleware (like authentication) should be applied WITHIN the route files where needed
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);      // Handles /api/orders/... routes
app.use('/api/pesapal', pesapalRoutes);  // Handles /api/pesapal/ipn, etc.
app.use('/api/users', userRoutes);        // Handles /api/users/... routes
// Add other base routes like '/api/engagements', '/api/transactions' if you have them

// --- Simple Root Route ---
app.get('/', (req, res) => {
    res.send('API is alive and running!');
});

// --- Global Error Handler (Place AFTER all specific routes) ---
app.use((err, req, res, next) => {
    error('Unhandled Error:', err.stack || err); // Log the full error stack
    res.status(err.status || 500).json({
        message: err.message || 'An unexpected server error occurred.',
        // Avoid sending detailed error stack in production environment
        // stack: config.server.nodeEnv === 'development' ? err.stack : undefined,
    });
});

// --- Start the Server ---
startServer();