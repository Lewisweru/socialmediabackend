import express from "express";
import User from "../models/User.js";

const router = express.Router();

// ✅ Create a New User (Runs on Signup)
router.post("/", async (req, res) => {
  try {
    const { firebaseUid, email } = req.body;

    // ✅ Check if user already exists
    let user = await User.findOne({ firebaseUid });
    if (user) return res.status(200).json(user); // Return existing user

    // ✅ Create new user in MongoDB
    user = new User({ firebaseUid, email });
    await user.save();

    res.status(201).json(user);
  } catch (error) {
    console.error("❌ User Creation Error:", error);
    res.status(500).json({ error: "Failed to create account", details: error.message });
  }
});

// ✅ Get User by Firebase UID
router.get("/:firebaseUid", async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.params.firebaseUid });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("❌ Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
