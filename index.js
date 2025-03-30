import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo"; // Import connect-mongo
import passport from "./config/googleAuth.js";
import authRoutes from "./routes/auth.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true })); // Allow frontend requests

// Use MongoDB for session storage
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecretkey", // Ensure this is stored in .env
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI, // MongoDB connection string
      collectionName: "sessions", // Collection to store sessions
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
      secure: process.env.NODE_ENV === "production", // Secure in production
      httpOnly: true,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/api/auth", authRoutes);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
