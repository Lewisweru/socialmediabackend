// routes/auth.js (CLEANED UP VERSION)
import express from "express";
import User from "../models/User.js"; // Ensure path is correct
import bcrypt from "bcrypt";
import { protect } from "../middleware/authMiddleware.js"; // Ensure path is correct
import { info, warn, error, debug } from '../utils/logger.js'; // Assuming logger

// Assuming firebaseAdminAuth is correctly exported from your firebaseAdmin config
import { firebaseAdminAuth } from "../config/firebaseAdmin.js";

const router = express.Router();

// --- Get Current User Route ---
// Uses 'protect' middleware which finds user by firebaseUid and attaches mongo user doc
router.get(
  '/current-user',
  protect, // Middleware verifies token and finds user by firebaseUid
  async (req, res) => {
    // req.user is the full MongoDB document attached by 'protect'
    try {
      if (!req.user) {
        warn('[current-user] User object not found on request after protect middleware.');
        return res.status(401).json({ message: "Authentication successful but user data unavailable." });
      }
      info(`[current-user] Returning data for user MongoDB ID: ${req.user._id}`);
      // Return the user object (password should have been excluded by 'protect')
      res.status(200).json(req.user);
    } catch (err) {
      error(`[current-user] Error retrieving user data for ${req.user?._id}:`, err);
      res.status(500).json({ message: "Error retrieving user data", error: err.message });
    }
  }
);

// --- Firebase User Sync/Create Endpoint (On Google/Other Provider Sign-In) ---
// Called by frontend after successful Firebase sign-in
router.post("/firebase-user", async (req, res) => {
  try {
    // Data received from frontend after successful Firebase sign-in
    const { firebaseUid, email, name, profilePic, country } = req.body; // Password not expected here
    info(`[firebase-user] Sync request for UID: ${firebaseUid}, Email: ${email}`);

    // Validation
    if (!firebaseUid || !email) {
      warn("[firebase-user] Missing firebaseUid or email in request.");
      return res.status(400).json({ error: "Firebase UID and Email are required." });
    }

    // Find user by the dedicated firebaseUid field
    debug(`[firebase-user] Searching DB for user with firebaseUid: ${firebaseUid}`);
    let user = await User.findOne({ firebaseUid: firebaseUid }); // Use full Mongoose doc for potential save

    if (user) {
      // --- User Found: Update if necessary ---
      info(`[firebase-user] Found existing user: ${user._id}. Checking for updates.`);
      let updated = false;
      if (name && user.name !== name) { user.name = name; updated = true; }
      if (profilePic && user.profilePic !== profilePic) { user.profilePic = profilePic; updated = true; }
      if (!user.username) { user.username = `user_${firebaseUid.substring(0, 8)}`; updated = true; warn(`[firebase-user] Added default username: ${user.username}`); }
      const countryToSet = country || user.country || 'Unknown'; // Use provided country or existing or default
      if (user.country !== countryToSet) { user.country = countryToSet; updated = true; warn(`[firebase-user] Updated/set country: ${user.country}`); }

      if (updated) {
        await user.save(); // Call .save() on the Mongoose document
        info(`[firebase-user] Updated details saved for user: ${user._id}`);
      } else {
        debug(`[firebase-user] No details needed updating for user: ${user._id}`);
      }

    } else {
      // --- User Not Found: Create New User ---
      info(`[firebase-user] User not found. Creating new user for UID: ${firebaseUid}`);
      const defaultUsername = `user_${firebaseUid.substring(0, 8)}`;
      const defaultCountry = country || 'Unknown'; // Use provided country or default

      user = new User({
        // _id handled by Mongoose
        firebaseUid: firebaseUid, // Set the firebaseUid field
        email: email.toLowerCase(),
        username: req.body.username || defaultUsername, // If frontend sends username during sync use it
        country: defaultCountry,
        name: name || defaultUsername,
        profilePic: profilePic || "default-profile.png",
        // No password for users created via this sync endpoint
      });

      await user.save();
      info(`[firebase-user] Successfully created new user: ${user._id} (FirebaseUID: ${user.firebaseUid})`);
    }

    // Return user data (excluding password)
    const userResponse = user.toObject ? user.toObject() : user;
    delete userResponse.password;
    res.status(200).json({ message: "User sync/creation successful", user: userResponse });

  } catch (err) {
    error("❌ Error in /firebase-user endpoint:", err);
    if (err.code === 11000) { warn("[firebase-user] Duplicate key error:", err.keyValue); const field = Object.keys(err.keyValue)[0]; return res.status(409).json({ error: `Sync conflict (${field} already exists).` }); }
    if (err.name === 'ValidationError') { const messages = Object.values(err.errors).map(val => val.message); error("[firebase-user] Validation Error:", messages); return res.status(400).json({ error: "Validation failed", details: messages }); }
    res.status(500).json({ error: "Internal Server Error during user sync" });
  }
});

// --- Custom Email/Password Signup Route ---
// This route ONLY creates the MongoDB record, assumes Firebase user ALREADY created by client SDK
router.post("/create-user", async (req, res) => {
  // Extract required fields, matching User schema
  const { firebaseUid, email, password, username, country, name, profilePic } = req.body;
  info("[create-user] Request received to create DB record for UID:", firebaseUid);
  debug("[create-user] Request body:", req.body);

  // Validation
  if (!firebaseUid || !email || !username || !country || !password) { // Password needed for hashing
    warn("[create-user] Missing required fields.");
    return res.status(400).json({ error: "Missing required fields (firebaseUid, email, password, username, country)" });
  }
   if (password.length < 6) { return res.status(400).json({ error: "Password must be at least 6 characters." }); }


  try {
    // 1. Check if user already exists in DB (by firebaseUid, email, or username)
    info(`[create-user] Checking existing DB user: ${firebaseUid} / ${email} / ${username}`);
    const existingUser = await User.findOne({ $or: [
        { firebaseUid: firebaseUid },
        { email: email.toLowerCase() },
        { username: username.trim() }
    ]});
    if (existingUser) {
      warn(`[create-user] User already exists in DB: ${firebaseUid} / ${email} / ${username}`);
      const field = existingUser.firebaseUid === firebaseUid ? 'Account' : (existingUser.email === email.toLowerCase() ? 'Email' : 'Username');
      return res.status(409).json({ error: `${field} already linked to an account.` }); // Use 409 Conflict
    }

    // 2. Hash the password provided from frontend signup form
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    debug(`[create-user] Password hashed for user ${firebaseUid}`);

    // 3. Create the new user in MongoDB database
    const newUser = new User({
      // _id is handled by Mongoose
      firebaseUid: firebaseUid, // Store the Firebase UID provided by client
      email: email.toLowerCase(),
      password: hashedPassword, // Store the hash
      username: username.trim(),
      country: country,
      name: name || username.trim(), // Default name to username if not provided
      profilePic: profilePic || 'default-profile.png',
      // role defaults to 'user' via schema
    });

    info(`[create-user] Saving new user to MongoDB for UID: ${firebaseUid}`);
    await newUser.save();
    info(`[create-user] User saved to MongoDB. ID: ${newUser._id}`);

    // 4. Respond to client
    const userResponse = newUser.toObject();
    delete userResponse.password; // Ensure password hash is not sent back
    res.status(201).json({ message: "User record created successfully", user: userResponse });

  } catch (err) {
    error("❌ Error during /create-user DB record creation:", err);
    if (err.name === 'ValidationError') { const messages = Object.values(err.errors).map(val => val.message); return res.status(400).json({ error: "Validation failed", details: messages }); }
    if (err.code === 11000) { return res.status(409).json({ error: "Duplicate field value entered.", field: Object.keys(err.keyPattern)[0] }); }
    res.status(500).json({ error: "Internal server error during user creation" });
  }
});

// Export the router
export default router;