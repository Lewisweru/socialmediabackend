// index.js (FULL CODE - Corrected CORS Configuration)
import express from 'express';
import cors from 'cors'; // Make sure cors is imported
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

// --- Core Middleware Setup ---

// FIX: Configure CORS properly before other middleware/routes
// Read the allowed origin from config (which reads from ENV)
const allowedOrigin = config.server.frontendUrl;
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests) or from the specified frontend URL
    // For production, you might want to be stricter and ONLY allow allowedOrigin
    if (!origin || origin === allowedOrigin) {
      callback(null, true);
    } else {
      error(`CORS Error: Origin ${origin} not allowed.`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS", // Allow standard methods + OPTIONS for preflight
  credentials: true, // IMPORTANT: Allow sending cookies or Authorization headers
  allowedHeaders: "Content-Type, Authorization, X-Requested-With", // Allow necessary headers, especially Authorization
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

info(`CORS configured to allow origin: ${allowedOrigin}`);
// Apply CORS middleware globally FIRST
app.use(cors(corsOptions));

// THEN apply body parsers
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies


// --- Basic Request Logger Middleware ---
app.use((req, res, next) => {
    info(`REQ: ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.on('finish', () => {
        // Log response status code for debugging
        debug(`RES: ${req.method} ${req.originalUrl} - Status: ${res.statusCode}`);
    });
    next();
});


// --- Database Connection and Service Loading ---
const startServer = async () => {
    try {
        await connectDB(); // Ensure DB connects before proceeding
        info('MongoDB Connected successfully.');

        // Load supplier services after DB is connected
        await loadExoSupplierServices(); // Use ExoSupplier
        info('ExoSupplier services loading attempted. Check startup logs for details.');

        // --- Start Express Server ---
        const PORT = config.server.port || 5000; // Use configured port
        app.listen(PORT, () => {
            info(`Server running in ${config.server.nodeEnv} mode on port ${PORT}`);
            info(`Accepting requests from: ${config.server.frontendUrl}`); // Log allowed origin
        });
    } catch (err) {
        error('FATAL: Server startup failed.', err);
        process.exit(1); // Exit if essential services fail
    }
};


// --- API Routes Mounting ---
// Mount the imported routers to their base paths.
// Middleware like 'protect' is applied within the specific route files.
app.use('/api/auth', authRoutes);       // Handles /api/auth/...
app.use('/api/orders', orderRoutes);    // Handles /api/orders/...
app.use('/api/pesapal', pesapalRoutes); // Handles /api/pesapal/ipn etc.
app.use('/api/users', userRoutes);      // Handles /api/users/...
// Add other base routes if you have them
// app.use('/api/engagements', engagementRoutes);


// --- Simple Root Route for Health Check ---
app.get('/', (req, res) => {
    res.status(200).send('API is running and healthy!');
});

// --- Global Error Handler Middleware (Place AFTER all routes) ---
// Catches errors passed via next(err) or uncaught exceptions in async handlers
app.use((err, req, res, next) => {
    error('Unhandled Error Caught:', err.stack || err); // Log the full error stack for debugging
    const statusCode = err.status || err.statusCode || 500; // Use error's status or default to 500
    // Send a generic error message in production, potentially more details in development
    res.status(statusCode).json({
        message: err.message || 'An unexpected server error occurred.',
        // Only include stack in development for security
        stack: config.server.nodeEnv === 'development' ? err.stack : undefined,
    });
});

// --- Start the Server ---
startServer(); // Call the async function to start everything