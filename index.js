// index.js (ESM)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// Use .js extension for local file imports in ESM
import connectDB from './config/db.js';
import config from './config.js'; // Assumes compiled config.js or renamed .ts
import { info, error } from './utils/logger.js'; // Import logger functions
import { loadJeskieServices } from './services/jeskieService.js';

// Import Middleware (adjust path and name as needed)
import authMiddleware from './middleware/authMiddleware.js';
// You might not need firebaseAdmin middleware directly here if authMiddleware handles it
// import { firebaseAdminAuth } from './middleware/firebaseAdminAuth.js'; // If separate

// Import Routes (use .js extension)
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import pesapalRoutes from './routes/pesapal.js'; // Assuming path/name
import userRoutes from './routes/users.js';
// import engagementRoutes from './routes/engagement.js'; // If you have these
// import transactionRoutes from './routes/transactions.js';
// import publicOrderRoutes from './routes/publicOrderRoutes.js';

dotenv.config(); // Load .env variables

const app = express();

// --- Database Connection and Service Loading ---
const startServer = async () => {
    try {
        await connectDB();
        info('MongoDB Connected successfully.');

        await loadJeskieServices(); // Load services after DB connection
        info('Jeskie services loading attempted (check logs).');

        // --- Start Express Server ---
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
    origin: config.server.frontendUrl,
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Optional: HTTP Request Logging (using morgan if installed, or custom logger)
// import morgan from 'morgan'; // If you decide to install and use morgan
// app.use(morgan('dev')); // Or 'combined'

app.use((req, res, next) => { // Basic request logging with our logger
    info(`REQ: ${req.method} ${req.originalUrl}`);
    next();
});


// --- API Routes ---
// Note: Apply auth middleware within the route file (like in orders.js)
// or here if ALL routes under a path need it. orders.js already applies it.
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes); // Already protected by middleware in orders.js
app.use('/api/pesapal', pesapalRoutes);
app.use('/api/users', userRoutes); // Apply authMiddleware if needed: app.use('/api/users', authMiddleware, userRoutes);
// Mount other routes...
// app.use('/api/engagements', engagementRoutes);
// app.use('/api/transactions', transactionRoutes);
// app.use('/api/public/orders', publicOrderRoutes); // Example


// --- Simple Root Route ---
app.get('/', (req, res) => res.send('API is alive!'));

// --- Global Error Handler (Basic) ---
// Place this AFTER all routes
app.use((err, req, res, next) => {
    error('Unhandled Error:', err.stack || err); // Log stack trace
    res.status(err.status || 500).json({
        message: err.message || 'Internal Server Error',
        // error: config.server.nodeEnv === 'development' ? err : {} // Only expose error details in dev
    });
});

// --- Start the Server ---
startServer();