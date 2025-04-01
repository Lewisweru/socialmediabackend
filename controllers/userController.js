import User from "../models/User.js";

// Sync Firebase User
export const syncUser = async (req, res) => {
  try {
    const { firebaseUid, email, name, profilePic } = req.body;
    
    if (!firebaseUid || !email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    let user = await User.findOne({ _id: firebaseUid });

    if (!user) {
      user = new User({ 
        _id: firebaseUid,
        email, 
        name, 
        profilePic 
      });
      await user.save();
    }

    res.status(200).json({ message: "User synced successfully", user });
  } catch (error) {
    console.error("Error syncing user:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get User by ID or Firebase UID
export const getUser = async (req, res) => {
  try {
    let user;
    
    if (req.path.includes('firebase')) {
      // Find by Firebase UID (which is stored as _id)
      user = await User.findById(req.params.uid);
    } else {
      // Find by MongoDB ID
      user = await User.findById(req.params.id);
    }
    
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

// Get All Users
export const getUsers = async (req, res) => {
  try {
    const users = await User.find({});
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ 
      message: "Error fetching users", 
      error: error.message 
    });
  }
};