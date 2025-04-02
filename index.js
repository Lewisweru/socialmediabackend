import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import passport from "passport";
import session from "express-session";
import path from "path";
import morgan from "morgan";
import helmet from "helmet";
import userRoutes from "./routes/users.js";
import authRoutes from "./routes/auth.js";
import listingRoutes from "./routes/listings.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payment.js";

dotenv.config();
const app = express();

// Middleware
app.use(express.json());

const corsOptions = {
  origin: [
    "https://socialmediakenya.netlify.app", // Netlify URL
    "http://localhost:3000", // Local development
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(helmet()); // Add security headers

if (process.env.NODE_ENV === "production") {
  app.use(morgan("combined")); // Use detailed logging in production
} else {
  app.use(morgan("dev")); // Use concise logging in development
}

// Routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/auth", authRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/orders", orderRoutes);
app.use('/api/payment', paymentRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

const PORT = process.env.PORT || 5000; // Use Render's dynamic port or fallback to 5000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});
