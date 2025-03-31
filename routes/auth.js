import express from "express";
import passport from "../config/googleAuth.js";
import User from "../models/User.js"; // ✅ Import User model

const router = express.Router();

// Google Authentication
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google OAuth Callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login", session: true }),
  (req, res) => {
    console.log("✅ User Authenticated:", req.user);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  }
);

// Logout
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect(`${process.env.FRONTEND_URL}/login`);
    });
  });
});

// Get Current Authenticated User
router.get("/current-user", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  res.status(401).json({ message: "Not authenticated" });
});

// ✅ Fix: Ensure User model is imported before using it in Firebase user sync
router.post("/firebase-user", async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePic } = req.body;

    // Check if the user already exists
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({ googleId: firebaseUid, email, name, profilePic });
      await user.save();
    }

    res.status(200).json({ message: "User synced to MongoDB", user });
  } catch (error) {
    console.error("Error syncing Firebase user:", error);
    res.status(500).json({ message: "Failed to sync user" });
  }
});

export default router;
