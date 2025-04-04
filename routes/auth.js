import express from "express";
import User from "../models/User.js"; // Ensure you have a User model
import { loginUser } from "../controllers/authController.js";
import bcrypt from "bcrypt";
import { protect } from "../middleware/authMiddleware.js"; // Ensure you have a protect middleware


const router = express.Router();


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
  protect, // <-- USE YOUR FIREBASE AUTH MIDDLEWARE
  async (req, res) => {
    // 'protect' middleware already verified token and attached MongoDB user to req.user
    try {
      // req.user is already the validated user document from MongoDB (excluding password)
      if (!req.user) {
        // This case should ideally be caught by 'protect', but double-check
        return res.status(404).json({ message: "User not found after authentication" });
      }
      // Simply return the user object attached by the middleware
      res.status(200).json(req.user);
    } catch (error) {
        // This catch block might be less necessary if protect handles errors well
        console.error("Error fetching current user (after protect):", error);
        res.status(500).json({
            message: "Error retrieving user data",
            error: error.message
        });
    }
  }
);
// 🔥 Firebase User Sync Endpoint
router.post("/firebase-user", async (req, res) => {
  try {
    // Data received from frontend after Firebase googleSignIn() or potentially initial signup sync
    const { firebaseUid, email, name, profilePic } = req.body;
    console.log(`[firebase-user] Received request for UID: ${firebaseUid}, Email: ${email}`); // Log received data

    // --- Validation ---
    if (!firebaseUid || typeof firebaseUid !== "string" || firebaseUid.trim() === "") {
      console.error("[firebase-user] Invalid firebaseUid received.");
      return res.status(400).json({ error: "Invalid firebaseUid provided." });
    }
    if (!email) {
      console.error("[firebase-user] Email is missing for UID:", firebaseUid);
      return res.status(400).json({ error: "Email is required." });
    }
    // --- End Validation ---


    console.log(`[firebase-user] Searching for user with _id: ${firebaseUid}`);
    let user = await User.findById(firebaseUid); // Find using Firebase UID as the _id

    if (user) {
      // --- User Found: Optionally update details ---
      console.log(`[firebase-user] Found existing user: ${user._id}. Checking for updates.`);
      let updated = false;
      if (name && user.name !== name) {
          user.name = name;
          updated = true;
      }
      // Generate a default username if missing (might happen if created via email/pass first without username logic)
      if (!user.username) {
           user.username = `user_${firebaseUid.substring(0, 8)}`; // Ensure default username exists
           updated = true;
           console.log(`[firebase-user] Added default username for existing user ${user._id}`);
      }
      // Generate default country if missing
      if (!user.country) {
            user.country = 'Unknown'; // Ensure default country exists
            updated = true;
            console.log(`[firebase-user] Added default country for existing user ${user._id}`);
       }
      if (profilePic && user.profilePic !== profilePic) {
          user.profilePic = profilePic;
          updated = true;
      }
      if (updated) {
          await user.save();
          console.log(`[firebase-user] Updated details for user: ${user._id}`);
      }

    } else {
      // --- User Not Found: Create New User ---
      console.log(`[firebase-user] User not found. Creating new user for UID: ${firebaseUid}`);
      // Ensure required fields (username, country) have defaults for Google Sign-In
      const defaultUsername = `user_${firebaseUid.substring(0, 8)}`; // Generate default unique username
      const defaultCountry = 'Unknown'; // Default country

      user = new User({
        _id: firebaseUid, // Use firebaseUid as _id
        email: email.toLowerCase(),
        username: defaultUsername, // Assign default username
        country: defaultCountry,   // Assign default country
        name: name || defaultUsername, // Use Google name or default username as name
        profilePic: profilePic || "default-profile.png",
        // IMPORTANT: No password is set for Google Sign-In users
      });

      await user.save();
      console.log(`[firebase-user] Successfully created new user: ${user._id}`);
    }

    // Return user data (excluding password, although it shouldn't be set here anyway)
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({ message: "User sync/creation successful", user: userResponse }); // Use 200 OK for find or create

  } catch (error) {
    console.error("❌ Error in /firebase-user endpoint:", error);
    if (error.code === 11000) { // Handle potential duplicate key errors (e.g., email if somehow reused)
        console.error("[firebase-user] Duplicate key error during save:", error.keyValue);
        return res.status(409).json({ error: "User synchronization conflict (duplicate value)." }); // 409 Conflict
    }
    res.status(500).json({ error: "Internal Server Error during user sync" });
  }
});

// 🔹 Login Route
router.post("/login", loginUser);

// 🔹 Create User Route
router.post("/create-user", async (req, res) => { // Or the controller function
  try {
    // --- *** Make sure you extract username and country here *** ---
    const { firebaseUid, email, name, profilePic, password, username, country } = req.body;
    // --- ********************************************************* ---

    // Add console log to verify incoming data
    console.log("Received data for /create-user:", req.body);

    // --- *** Validation (Add checks for username and country) *** ---
    if (!firebaseUid || typeof firebaseUid !== "string" || firebaseUid.trim() === "") {
      return res.status(400).json({ error: "Invalid firebaseUid." });
    }
    if (!email) return res.status(400).json({ error: "Email is required!" });
    if (!password) return res.status(400).json({ error: "Password is required!" });
    if (!username || username.trim() === "") return res.status(400).json({ error: "Username is required!" }); // Added check
    if (!country) return res.status(400).json({ error: "Country is required!" }); // Added check
    // --- *********************************************************** ---


    // Check if the user already exists (using _id = firebaseUid)
    const existingUserById = await User.findById(firebaseUid);
    if (existingUserById) {
      return res.status(400).json({ error: "User with this ID already exists!" });
    }
    // Optional: Check if email or username already exists if they must be unique across all users
    const existingUserByEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingUserByEmail) {
       return res.status(400).json({ error: "Email already in use!" });
    }
    const existingUserByUsername = await User.findOne({ username: username.trim() });
     if (existingUserByUsername) {
        return res.status(400).json({ error: "Username already taken!" });
     }


    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user - **Pass username and country here**
    const user = new User({
      _id: firebaseUid,
      email: email.toLowerCase(), // Store lowercase
      username: username.trim(),   // Store trimmed
      country: country,          // Store country
      name: name || username.trim(), // Use provided name or default to username
      profilePic: profilePic || 'default-profile.png', // Add default
      password: hashedPassword,
    });

    await user.save(); // This should now work if username & country are provided

    // Exclude password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({ message: "User created successfully", user: userResponse });
  } catch (error) {
    // --- *** Improved Error Logging *** ---
    console.error("❌ Error creating user:", error);
    if (error.name === 'ValidationError') {
        // Mongoose validation error
         const messages = Object.values(error.errors).map(val => val.message);
         return res.status(400).json({ error: "Validation failed", details: messages });
    }
    if (error.code === 11000) {
        // Duplicate key error (e.g., email or username unique constraint)
        return res.status(400).json({ error: "Duplicate field value entered.", field: Object.keys(error.keyPattern)[0] });
    }
    // --- ******************************* ---
    res.status(500).json({ error: "Internal Server Error" });
  }
});
export default router;
