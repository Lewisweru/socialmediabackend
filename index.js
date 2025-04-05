import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import passport from "passport"; // Assuming passport setup is in config/googleAuth.js or similar
import session from "express-session";
// import path from "path"; // Not used in this snippet, remove if unnecessary elsewhere
import morgan from "morgan"; // HTTP request logger
import helmet from "helmet"; // Security headers

// Import Route Files (adjust paths if needed)
import userRoutes from "./routes/users.js";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import publicOrderRoutes from './routes/publicOrderRoutes.js'

// Load Environment Variables
dotenv.config();

// Database Connection (Ensure connectDB is defined and exported correctly)
import connectDB from "./config/db.js"; // Assuming db connection logic is here
connectDB();

// Initialize Express App
const app = express();

// --- Core Middleware ---

// Security Headers
app.use(helmet());

// Body Parsers
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: false })); // Parse URL-encoded bodies


app.use('/api/orders', publicOrderRoutes); // Mount public IPN handler first

// CORS Configuration
const allowedOrigins = [
  "https://socialmediakenya.netlify.app", // Netlify URL (Production Frontend)
  "http://localhost:5173", // Local Frontend Development
  // Add any other origins if necessary
];
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests) or from allowed list
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies/auth headers
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // Allow common methods
  allowedHeaders: ["Content-Type", "Authorization"], // Allow necessary headers
};
app.use(cors(corsOptions));
// Handle preflight requests for all routes
app.options('*', cors(corsOptions));


// HTTP Request Logging
if (process.env.NODE_ENV === "production") {
  app.use(morgan("combined")); // More detailed logging for production
} else {
  app.use(morgan("dev")); // Concise logging for development
}

// Session Middleware (Required for Passport Session Auth, configure secret properly)
// IMPORTANT: Use a strong, secret key stored in environment variables for production!
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-very-secret-key", // CHANGE THIS and use ENV var
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    // Configure cookie settings for production (secure, httpOnly, sameSite)
    // cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' }
  })
);

// Passport Middleware (Initialize after Session)
app.use(passport.initialize());
app.use(passport.session()); // Enable persistent login sessions

// --- API Routes ---
console.log("Registering API routes...");
app.use("/api/users", userRoutes); // User related endpoints
app.use("/api/auth", authRoutes); // API endpoints for auth (login, signup, firebase-sync etc.)
app.use("/auth", authRoutes); // Non-prefixed auth routes, likely for OAuth callbacks (e.g., /auth/google/callback)
app.use("/api/orders", orderRoutes); // Order creation, stats, IPN handler
app.use('/api/orders', orderRoutes);
// Removed: app.use('/api/pesapal', pesapalRoutes); // This was a duplicate mount of paymentRoutes

console.log("API routes registered.");

// --- Basic Root Route (Optional) ---
app.get('/', (req, res) => {
    res.send('API is running...');
});

// --- Error Handling Middleware (Place AFTER routes) ---
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack || err); // Log the full error stack
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode; // Use existing status code if set, else 500
  res.status(statusCode).json({
    message: err.message || "Internal Server Error",
    // Provide stack trace only in development for security
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});


// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});