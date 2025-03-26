import express from "express";
import User from "server\models\User.js";

const router = express.Router();

// ✅ Signup - Save Users in MongoDB
router.post("/signup", async (req, res) => {
  try {
    const { uid, email } = req.body;

    // ✅ Check if user already exists
    let user = await User.findOne({ uid });
    if (user) return res.status(400).json({ error: "User already exists" });

    // ✅ Create user in MongoDB
    user = new User({ uid, email });
    await user.save();

    res.status(201).json({ message: "User registered successfully", userId: user._id });
  } catch (error) {
    console.error("❌ Signup Error:", error);
    res.status(500).json({ error: "Signup failed", details: error.message });
  }
});

export default router;
