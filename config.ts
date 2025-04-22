// config.ts (MERGED - Add Pesapal and Jeskie sections)
import dotenv from 'dotenv';
dotenv.config(); // Ensure dotenv is loaded

// Define interfaces for stricter typing (optional but recommended)
interface PesapalConfig {
  consumerKey: string;
  consumerSecret: string;
  baseURL: string;
  ipnRegisterURL: string;
  ipnListURL: string;
  submitOrderURL: string;
  transactionStatusURL: string;
  authTokenURL: string;
  callbackUrlBase: string; // Base URL for frontend callback
}

interface JeskieConfig {
    apiUrl: string;
    apiKey: string;
}

export const config = {
  cryptomus: { // Keep your existing config
    merchantId: process.env.CRYPTOMUS_MERCHANT_ID || '',
    apiKey: process.env.CRYPTOMUS_API_KEY || '',
    // Assuming Cryptomus has an API URL as well
    apiUrl: process.env.CRYPTOMUS_API_URL || 'https://api.cryptomus.com/v1', // Example
  },
  email: { // Keep your existing config
    host: process.env.EMAIL_HOST || '',
    port: parseInt(process.env.EMAIL_PORT || '587', 10), // Ensure base 10
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || '"Your App Name" <no-reply@example.com>', // Add a default FROM
  },
  jwt: { // Keep your existing config
    secret: process.env.JWT_SECRET || 'your-very-secret-key-please-change', // Use a strong default reminder
    expiresIn: process.env.JWT_EXPIRES_IN || '1d', // Match your package.json if different
  },
  server: { // Keep your existing config
    port: parseInt(process.env.PORT || '3000', 10), // Ensure base 10
    apiUrl: process.env.API_URL || 'http://localhost:3000', // Backend API URL itself
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173', // Frontend URL
    nodeEnv: process.env.NODE_ENV || 'development', // Add Node Env
  },
  database: { // Add Database config section
    mongoUri: process.env.MONGODB_URI || '', // Get from .env
  },
  pesapal: <PesapalConfig>{ // Add Pesapal config section
    consumerKey: process.env.PESAPAL_CONSUMER_KEY || '',
    consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || '',
    baseURL: process.env.PESAPAL_API_URL || 'https://cybqa.pesapal.com/pesapalv3', // Default to QA
    ipnRegisterURL: '/api/v3/IPN/Register',
    ipnListURL: '/api/v3/IPN/Get',
    submitOrderURL: '/api/v3/Transactions/SubmitOrderRequest',
    transactionStatusURL: '/api/v3/Transactions/GetTransactionStatus',
    authTokenURL: '/api/v3/Auth/RequestToken',
    callbackUrlBase: process.env.FRONTEND_URL || 'http://localhost:5173', // Base URL for callback
  },
  jeskie: <JeskieConfig>{ // Add Jeskie config section
    apiUrl: process.env.JESKIE_API_URL || 'https://jeskieinc.com/api/v2',
    apiKey: process.env.JESKIE_API_KEY || '', // IMPORTANT: Get from .env!
  },
};

// --- Add Basic Validation ---
if (!config.database.mongoUri) {
  console.error('FATAL ERROR: MONGODB_URI is not defined in environment variables.');
  // process.exit(1); // Consider exiting if DB is essential
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

// Export requires a default export if using `import config from ...` later
// Or use named export: export { config };
// Default export is often simpler for config files.
export default config;