// config.js (Corrected - Plain JavaScript with ESM)
import dotenv from 'dotenv'; // Use import with "type": "module"
dotenv.config();

// REMOVED interface definitions - they are invalid in JS files

const config = {
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
    from: process.env.EMAIL_FROM || '"Your App Name" <no-reply@example.com>',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-very-secret-key-please-change',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  database: {
    mongoUri: process.env.MONGODB_URI || '',
  },
  // REMOVED <PesapalConfig> type assertion
  pesapal: {
    consumerKey: process.env.PESAPAL_CONSUMER_KEY || '',
    consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || '',
    baseURL: process.env.PESAPAL_API_URL || 'https://cybqa.pesapal.com/pesapalv3',
    ipnRegisterURL: '/api/v3/IPN/Register',
    ipnListURL: '/api/v3/IPN/Get',
    submitOrderURL: '/api/v3/Transactions/SubmitOrderRequest',
    transactionStatusURL: '/api/v3/Transactions/GetTransactionStatus',
    authTokenURL: '/api/v3/Auth/RequestToken',
    callbackUrlBase: process.env.FRONTEND_URL || 'http://localhost:5173',
  },
  // REMOVED <JeskieConfig> type assertion
  jeskie: {
    apiUrl: process.env.JESKIE_API_URL || 'https://jeskieinc.com/api/v2',
    apiKey: process.env.JESKIE_API_KEY || '',
  },
};

// --- Add Basic Validation ---
if (!config.database.mongoUri) {
  console.error('FATAL ERROR: MONGODB_URI is not defined in environment variables.');
  // process.exit(1); // Consider uncommenting if DB is essential
}
if (!config.jwt.secret || config.jwt.secret === 'your-very-secret-key-please-change') {
  console.warn('WARNING: JWT_SECRET is using a default or weak value. Set a strong secret in .env for production.');
}
if (!config.pesapal.consumerKey || !config.pesapal.consumerSecret) {
    console.warn('WARNING: Pesapal Consumer Key or Secret is missing in .env.');
}
if (!config.jeskie.apiKey) {
    console.warn('WARNING: JESKIE_API_KEY is missing in .env. Jeskie order automation will fail.');
}

// Use export default for ESM
export default config;