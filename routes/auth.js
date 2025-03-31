import express from "express";
import passport from "../config/googleAuth.js";
import User from "../models/User.js"; // Ensure you have a User model

const router = express.Router();

// 🔹 Google Authentication
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// 🔹 Google OAuth Callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login", session: true }),
  (req, res) => {
    console.log("✅ User Authenticated:", req.user);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  }
);

// 🔹 Logout
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect(`${process.env.FRONTEND_URL}/login`);
    });
  });
});

// 🔹 Get Current User
router.get("/current-user", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  res.status(401).json({ message: "Not authenticated" });
});

// 🔥 New: Firebase User Sync Endpoint
router.post("/firebase-user", async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePic } = req.body;
    console.log("🔥 Firebase User Data Received:", req.body);

    if (!firebaseUid || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let user = await User.findOne({ firebaseUid });

    if (!user) {
      user = new User({ firebaseUid, email, name, profilePic });
      await user.save();
      console.log("✅ New Firebase User Created:", user);
    } else {
      console.log("🔄 Existing Firebase User Found:", user);
    }

    res.status(201).json({ message: "User synced successfully", user });
  } catch (error) {
    console.error("🚨 Firebase User Sync Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
