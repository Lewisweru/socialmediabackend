import User from "../models/User.js";

// Get User by Firebase UID (or MongoDB _id, since they are the same)
export const getUser = async (req, res) => {
  try {
    const { id } = req.params; // Use `id` as the parameter name for consistency

    // Find the user by _id (which is the same as Firebase UID)
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ 
      message: "Error fetching user", 
      error: error.message 
    });
  }
};
