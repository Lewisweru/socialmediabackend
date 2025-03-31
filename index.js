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

dotenv.config();
const app = express();

// Middleware
app.use(express.json());

const corsOptions = {
  origin: process.env.FRONTEND_URL, // Allow requests from your frontend
  credentials: true, // Allow cookies and headers
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

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

const PORT = process.env.PORT || 5000; // Use Render's dynamic port or fallback to 5000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, "frontend/build")));

  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "frontend", "build", "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal Server Error" });
});
