import express from "express";
import session from "express-session";
import passport from "./config/googleAuth.js";
import authRoutes from "./routes/auth.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import MongoStore from "connect-mongo"; // Import connect-mongo

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI, // Ensure this is correctly set in .env
      ttl: 14 * 24 * 60 * 60, // Session expires in 14 days
    }),
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
