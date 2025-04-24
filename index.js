import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import config from './config.js';
import { info, warn, error, debug } from './utils/logger.js';
import { loadExoSupplierServices } from './services/exoSupplierService.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import pesapalRoutes from './routes/pesapal.js';
import userRoutes from './routes/users.js';
import MongoStore from 'connect-mongo';

dotenv.config();

const app = express();

// --- Critical Security Middleware ---

// 1. Enhanced CORS Configuration
const corsOptions = {
  origin: config.server.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['set-cookie'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
info(`CORS configured to allow origin: ${config.server.frontendUrl}`);

// 2. Cookie Parser (must come before session middleware)
app.use(cookieParser());

// 3. Session Configuration with MongoStore
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-strong-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 7 * 24 * 60 * 60, // 7 days
    autoRemove: 'native'
  }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// --- Body Parsers ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Request Logging ---
app.use((req, res, next) => {
  info(`REQ: ${req.method} ${req.originalUrl} from ${req.ip}`);
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    debug(`RES: ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// --- Database and Services Initialization ---
const startServer = async () => {
  try {
    await connectDB();
    info('MongoDB Connected successfully.');

    await loadExoSupplierServices();
    info('ExoSupplier services loaded.');

    // --- Route Mounting ---
    app.use('/api/auth', authRoutes);
    app.use('/api/orders', orderRoutes);
    app.use('/api/pesapal', pesapalRoutes);
    app.use('/api/users', userRoutes);

    // --- Health Check ---
    app.get('/', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: config.server.nodeEnv
      });
    });

    // --- Global Error Handler ---
    app.use((err, req, res, next) => {
      error('Unhandled Error:', {
        message: err.message,
        stack: config.server.nodeEnv === 'development' ? err.stack : undefined,
        url: req.originalUrl,
        method: req.method
      });

      res.status(err.status || 500).json({
        error: {
          message: err.message || 'Internal Server Error',
          ...(config.server.nodeEnv === 'development' && { stack: err.stack })
        }
      });
    });

    // --- Server Start ---
    const PORT = config.server.port || 5000;
    app.listen(PORT, () => {
      info(`Server running in ${config.server.nodeEnv} mode on port ${PORT}`);
      info(`Allowed origin: ${config.server.frontendUrl}`);
      info(`Session store: MongoDB (TTL: 7 days)`);
    });

  } catch (err) {
    error('Server startup failed:', err);
    process.exit(1);
  }
};

startServer();