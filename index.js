// server.js / index.js

import dotenv from "dotenv"; // Import dotenv FIRST
dotenv.config(); // <-- LOAD ENV VARS IMMEDIATELY!

// --- NOW import everything else ---
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import passport from "passport";
import session from "express-session";
import morgan from "morgan";
import helmet from "helmet";
import connectDB from "./config/db.js"; // Adjust path
import { startSupplierStatusChecker } from './scheduler/supplierStatusCheck.js'; // Adjust path
import userRoutes from "./routes/users.js";   // Adjust path
import authRoutes from "./routes/auth.js";     // Adjust path
import orderRoutes from "./routes/orders.js"; // Adjust path (Protected Routes)
import publicOrderRoutes from './routes/publicOrderRoutes.js'; // Adjust path (Public Routes like IPN)

// --- Optional Test Log (Can stay here or move after imports) ---
console.log('------------------------------------');
console.log('[Server Start] Environment Variables Check Post-dotenv...');
// ... (rest of your console.log checks for variables) ...
console.log('[Server Start] JESKIEINC_API_KEY loaded:', process.env.JESKIEINC_API_KEY ? 'Yes' : 'NO!'); // Check AGAIN here if needed
console.log('------------------------------------');
// --- End Test Log ---


// --- Database Connection ---
// This now correctly runs *after* dotenv has loaded MONGO_URI
connectDB();

// --- Initialize Express App ---
const app = express();

// --- Core Middleware ---
app.use(helmet()); // Security headers first

// --- Body Parsers (BEFORE routes needing req.body) ---
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// --- HTTP Request Logging ---
if (process.env.NODE_ENV === "production") {
  app.use(morgan("combined"));
} else {
  app.use(morgan("dev"));
}

// --- PUBLIC API Routes (Mounted BEFORE CORS) ---
console.log("Registering PUBLIC routes...");
app.use('/api/orders', publicOrderRoutes); // Mount public IPN handler (/api/orders/ipn)
console.log("Public routes registered.");

// --- STRICT CORS Configuration for subsequent API routes ---
const allowedOrigins = [
  process.env.FRONTEND_URL, // Use env variable for frontend URL
  "http://localhost:5173",  // Keep for local dev if needed
].filter(Boolean); // Filter out undefined/null values

console.log("Allowed CORS Origins:", allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions)); // Apply CORS middleware
app.options('*', cors(corsOptions)); // Handle preflight OPTIONS requests


// --- Session & Passport Middleware ---
if (!process.env.SESSION_SECRET) {
    console.warn("WARNING: SESSION_SECRET environment variable not set. Using insecure default.");
}
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-insecure-secret-key-please-change", // Use ENV Var!
    resave: false, // Explicitly set
    saveUninitialized: false, // Explicitly set
    // cookie: { /* Production settings */ }
    // store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }) // Optional store
  })
);
app.use(passport.initialize());
app.use(passport.session()); // If using Passport sessions


// --- PROTECTED/CORE API Routes (Mounted AFTER CORS/Auth middleware setup) ---
console.log("Registering protected API routes...");
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/auth", authRoutes); // For potential OAuth callbacks defined in authRoutes
app.use("/api/orders", orderRoutes); // Mount PROTECTED order routes (initiate, stats, admin, etc.)
console.log("API routes registered.");


// --- Basic Root Route (Optional Health Check) ---
app.get('/', (req, res) => {
    res.status(200).send('API is running and healthy!');
});


// --- Not Found Handler (Catch 404s - Place After All Valid Routes) ---
app.use((req, res, next) => {
    res.status(404).json({ message: `Not Found - ${req.method} ${req.originalUrl}` });
});


// --- Global Error Handling Middleware (Place LAST) ---
// Catches errors passed by next(err) or thrown in async handlers
app.use((err, req, res, next) => { // Must have 4 arguments
  console.error("Unhandled Error:", err.stack || err);
  const statusCode = err.status || err.statusCode || res.statusCode < 400 ? 500 : res.statusCode; // Use error status or default to 500
  res.status(statusCode).json({
    message: err.message || "Internal Server Error",
    // Only provide stack trace in development
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});


// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);

  // --- Start Scheduled Jobs ---
  if (process.env.NODE_ENV !== 'test') { // Avoid running jobs during tests
      console.log("Starting scheduled jobs...");
      startSupplierStatusChecker(); // Start the supplier check job
      // cleanupPendingOrdersTask.start(); // Start cleanup job if implemented
  }
});