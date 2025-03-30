import express from "express";
import passport from "../config/googleAuth.js"; // Import Google auth strategy

const router = express.Router();

// Start Google authentication
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Handle Google callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login", session: true }),
  (req, res) => {
    res.redirect(`${process.env.FRONTEND_URL}/dashboard`); // Redirect user after login
  }
);

// Logout
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ message: "Logout failed", error: err });
    res.redirect(`${process.env.FRONTEND_URL}/login`);
  });
});

// Get the current logged-in user
router.get("/current-user", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  res.status(401).json({ message: "Not authenticated" });
});

export default router;
