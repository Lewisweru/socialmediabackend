// config.js (Updated for ExoSupplier)
import dotenv from 'dotenv';
dotenv.config();

const config = {
  // Assuming you might still use cryptomus or email, keep if needed
  cryptomus: {
    merchantId: process.env.CRYPTOMUS_MERCHANT_ID || '',
    apiKey: process.env.CRYPTOMUS_API_KEY || '',
    apiUrl: process.env.CRYPTOMUS_API_URL || 'https://api.cryptomus.com/v1',
  },
  email: {
    host: process.env.EMAIL_HOST || '',
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || '"SocialMediaKenya" <no-reply@yourdomain.com>', // Use a relevant default
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_jwt_secret_change_this_immediately', // Use a fallback reminder
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  server: {
    port: parseInt(process.env.PORT || '5000', 10), // Match Render port if needed
    apiUrl: process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`, // Default API URL
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  database: {
    mongoUri: process.env.MONGODB_URI || '', // Get from .env
  },
  pesapal: { // Keep Pesapal config
    consumerKey: process.env.PESAPAL_CONSUMER_KEY || '',
    consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || '',
    baseURL: process.env.PESAPAL_API_URL || 'https://cybqa.pesapal.com/pesapalv3', // Default to QA if needed
    ipnRegisterURL: '/api/v3/IPN/Register',
    ipnListURL: '/api/v3/IPN/Get',
    submitOrderURL: '/api/v3/Transactions/SubmitOrderRequest',
    transactionStatusURL: '/api/v3/Transactions/GetTransactionStatus',
    authTokenURL: '/api/v3/Auth/RequestToken',
    callbackUrlBase: process.env.FRONTEND_URL || 'http://localhost:5173', // Base URL for payment callback
  },
  // Use 'exoSupplier' section now
  exoSupplier: {
    apiUrl: process.env.EXOSUPPLIER_API_URL || 'https://exosupplier.com/api/v2', // Use new ENV var
    apiKey: process.env.EXOSUPPLIER_API_KEY || '', // Use new ENV var
  },
};

// --- Basic Validation Checks ---
if (!config.database.mongoUri) {
  console.error('FATAL ERROR: MONGODB_URI environment variable is not defined.');
  // Consider process.exit(1) if DB connection is mandatory for startup
}
if (!config.jwt.secret || config.jwt.secret === 'fallback_jwt_secret_change_this_immediately') {
  console.warn('SECURITY WARNING: JWT_SECRET is using a default or weak value. Set a strong secret in the .env file for production environments!');
}
if (!config.pesapal.consumerKey || !config.pesapal.consumerSecret) {
    console.warn('WARNING: Pesapal Consumer Key or Secret is missing in .env. Pesapal integration may fail.');
}
if (!process.env.PESAPAL_IPN_ID) { // Check specific ENV var for IPN ID
    console.warn('WARNING: PESAPAL_IPN_ID environment variable is not set. Pesapal IPN notifications might not be processed correctly.');
}
if (!config.exoSupplier.apiKey) {
    console.warn('WARNING: EXOSUPPLIER_API_KEY environment variable is missing. ExoSupplier order automation will fail.');
}

// Use export default for ESM compatibility
export default config;