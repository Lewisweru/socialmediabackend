// config/db.js (Corrected - Uses imported config)
import mongoose from "mongoose";
import config from '../config.js'; // Import the config object
// Optional: Import logger if you want more detailed logs here
// import { info, error } from '../utils/logger.js';

const connectDB = async () => {
  try {
    // Get the URI from the imported config object
    const mongoUri = config.database.mongoUri;

    // Add a check here to ensure the URI is actually loaded
    if (!mongoUri) {
      console.error('❌ MongoDB Connection Error: URI is undefined. Check config.js and .env / environment variables.');
      process.exit(1);
    }

    console.log(`Attempting to connect to MongoDB at: ${mongoUri.substring(0, mongoUri.indexOf('@'))}...`); // Log URI without credentials

    const conn = await mongoose.connect(mongoUri, {
      // Remove deprecated options for Mongoose v6+
      // useNewUrlParser: true, // Deprecated
      // useUnifiedTopology: true, // Deprecated
      // Add other options if needed, like dbName if not in URI
      // dbName: 'yourDatabaseName'
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`❌ MongoDB Connection Error: ${err.message}`);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;