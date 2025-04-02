import express from "express";
import passport from "../config/googleAuth.js";
import User from "../models/User.js"; // Ensure you have a User model
import { loginUser } from "../controllers/authController.js";
import bcrypt from "bcrypt";

const router = express.Router();


// 🔹 Google Authentication
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// 🔹 Google OAuth Callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login", session: true }),
  (req, res) => {
    console.log("✅ User Authenticated:", req.user);
    res.redirect(`${process.env.FRONTEND_URL}/`);
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


router.get(
  '/current-user', 
  passport.authenticate('jwt', { session: false }), 
  async (req, res) => {
    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json(user);
    } catch (error) {
      console.error("Error fetching current user:", error);
      res.status(500).json({ 
        message: "Error fetching current user", 
        error: error.message 
      });
    }
  }
);
// 🔥 Firebase User Sync Endpoint
router.post("/firebase-user", async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePic } = req.body;

    if (!firebaseUid || typeof firebaseUid !== "string") {
      return res.status(400).json({ error: "Invalid firebaseUid. It is required and must be a string." });
    }

    if (!email) {
      return res.status(400).json({ error: "Email is required!" });
    }

    // Use firebaseUid as _id
    let user = await User.findById(firebaseUid);

    if (!user) {
      user = new User({
        _id: firebaseUid, // Use firebaseUid as _id
        email,
        name,
        profilePic,
      });

      await user.save();
    }

    res.json({ message: "User authenticated successfully", user });
  } catch (error) {
    console.error("❌ Firebase User Auth Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 🔹 Login Route
router.post("/login", loginUser);

// 🔹 Create User Route
router.post("/create-user", async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePic, password } = req.body;

    // Validate input
    if (!firebaseUid || typeof firebaseUid !== "string" || firebaseUid.trim() === "") {
      return res.status(400).json({ error: "Invalid firebaseUid. It is required and must be a non-empty string." });
    }
    if (!email) {
      return res.status(400).json({ error: "Email is required!" });
    }
    if (!password) {
      return res.status(400).json({ error: "Password is required!" });
    }

    // Check if the user already exists
    const existingUser = await User.findById(firebaseUid);
    if (existingUser) {
      return res.status(400).json({ error: "User already exists!" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user
    const user = new User({
      _id: firebaseUid, // Use firebaseUid as the _id
      email,
      name,
      profilePic,
      password: hashedPassword, // Store the hashed password
    });

    await user.save();

    res.status(201).json({ message: "User created successfully", user });
  } catch (error) {
    console.error("❌ Error creating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
