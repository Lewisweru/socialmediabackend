import express from "express";
import passport from "../config/googleAuth.js";

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

// Get Current User
router.get("/current-user", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  res.status(401).json({ message: "Not authenticated" });
});

export default router;
