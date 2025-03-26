export const config = {
  cryptomus: {
    merchantId: process.env.CRYPTOMUS_MERCHANT_ID || '',
    apiKey: process.env.CRYPTOMUS_API_KEY || '',
  },
  email: {
    host: process.env.EMAIL_HOST || '',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: '24h',
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    apiUrl: process.env.API_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  }
};