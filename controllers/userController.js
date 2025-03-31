import User from "../models/User.js";

/**
 * Create a new user
 */
export const createUser = async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: "Error creating user", error });
  }
};

/**
 * Get a user by ID
 */
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user", error });
  }
};

/**
 * Sync Firebase User - ✅ FIX for missing route
 */
export const syncFirebaseUser = async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePic } = req.body;

    if (!firebaseUid || !email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Check if user exists
    let user = await User.findOne({ firebaseUid });

    if (!user) {
      user = new User({ firebaseUid, email, name: name || "Unnamed", profilePic: profilePic || "" });
      await user.save();
    }

    res.status(200).json({ message: "User synced successfully", user });
  } catch (error) {
    res.status(500).json({ message: "Error syncing Firebase user", error });
  }
};
