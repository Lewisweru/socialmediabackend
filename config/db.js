// config/db.js (Corrected - Uses imported config)
import mongoose from "mongoose";
import mongoose from 'mongoose';
import { info, error } from '../utils/logger.js'; // Assuming logger exists

const connectDB = async () => {
  try {
     // Ensure MONGO_URI is loaded from .env
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is not set.');
    }
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    error(`MongoDB Connection Error: ${err.message}`);
    process.exit(1); // Exit process with failure if DB connection fails
  }
};

export default connectDB;