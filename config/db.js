// config/db.js (Revised to connect on import and export promise)
import mongoose from 'mongoose';
import { info, error } from '../utils/logger.js'; // Assuming logger exists

info('Attempting to connect to MongoDB...'); // Log when module is loaded

// Ensure MONGO_URI is available
if (!process.env.MONGODB_URI) {
    error('FATAL: MONGODB_URI environment variable is not set.');
    process.exit(1); // Exit immediately if URI is missing
}

// Immediately attempt connection when module is loaded
const connectionPromise = mongoose.connect(process.env.MONGODB_URI)
    .then(conn => {
        info(`MongoDB Connected: ${conn.connection.host}`);
        return conn; // Resolve the promise with the connection object
    })
    .catch(err => {
        error(`MongoDB Connection Error: ${err.message}`);
        process.exit(1); // Exit process with failure if DB connection fails
    });

// Export the promise directly
export default connectionPromise;