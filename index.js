import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import accountRoutes from "./routes/Account.js";
import orderRoutes from "./routes/Order.js";
import listingRoutes from "./routes/listings.js";
import userRoutes from "./routes/users.js"; // ✅ Ensure this import exist


dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// ✅ Middleware (Must Come BEFORE Routes)
app.use(cors());
app.use(express.json()); // ✅ Ensures JSON is parsed correctly
app.use(express.urlencoded({ extended: true })); // ✅ Ensures form data is parsed

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
//app.use("/api/users", userRoutes); // Add this

// ✅ Start the Server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
