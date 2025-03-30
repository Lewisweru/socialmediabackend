import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import passport from "passport"; // ✅ Import passport
import session from "express-session"; // ✅ For session management
import accountRoutes from "./routes/Account.js";
import orderRoutes from "./routes/Order.js";
import listingRoutes from "./routes/listings.js";
import userRoutes from "./routes/users.js"; // ✅ Ensure this import exists
import authRoutes from "./routes/auth.js";  // ✅ Import your auth routes

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",  // Update with your frontend URL
    methods: ["GET", "POST"]
  }
});

// ✅ Middleware (Must Come BEFORE Routes)
app.use(cors());
app.use(express.json()); // ✅ Ensures JSON is parsed correctly
app.use(express.urlencoded({ extended: true })); // ✅ Ensures form data is parsed

// ✅ Session setup (For Passport.js session management)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using https
}));

// ✅ Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

// ✅ Debugging: Log incoming requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} Request to ${req.url}`, req.body);
  next();
});

// ✅ MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("✅ Connected to MongoDB Atlas!");
}).catch((error) => {
  console.error("❌ MongoDB Connection Failed:", error);
});

// ✅ API Routes
app.use("/api/accounts", accountRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes); // ✅ Add auth routes here

// ✅ Add a Ping Route for Keeping Backend Alive
app.get("/ping", (req, res) => {
  res.status(200).json({ message: "Server is alive! 🚀" });
});

// ✅ Start the Server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
