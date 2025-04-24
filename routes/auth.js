// routes/auth.js (FULL CODE with Handler Logic Included and Corrected)
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
router.post("/firebase-user", async (req, res) => {
  try {
    // Data received from frontend after successful Firebase sign-in
    const { firebaseUid, email, name, profilePic } = req.body; // Password not expected here
    info(`[firebase-user] Sync request for UID: ${firebaseUid}, Email: ${email}`);

    // Validation
    if (!firebaseUid || !email) {
      warn("[firebase-user] Missing firebaseUid or email in request.");
      return res.status(400).json({ error: "Firebase UID and Email are required." });
    }

    // Find user by the dedicated firebaseUid field
    debug(`[firebase-user] Searching DB for user with firebaseUid: ${firebaseUid}`);
    let user = await User.findOne({ firebaseUid: firebaseUid });

    if (user) {
      // --- User Found: Update if necessary ---
      info(`[firebase-user] Found existing user: ${user._id}. Checking for updates.`);
      let updated = false;
      if (name && user.name !== name) { user.name = name; updated = true; }
      if (profilePic && user.profilePic !== profilePic) { user.profilePic = profilePic; updated = true; }
      // Ensure required fields have defaults if missing
      if (!user.username) { user.username = `user_${firebaseUid.substring(0, 8)}`; updated = true; warn(`[firebase-user] Added default username: ${user.username}`); }
      if (!user.country) { user.country = 'Unknown'; updated = true; warn(`[firebase-user] Added default country: ${user.country}`); }

      if (updated) {
        await user.save();
        info(`[firebase-user] Updated details for user: ${user._id}`);
      } else {
        debug(`[firebase-user] No details needed updating for user: ${user._id}`);
      }

    } else {
      // --- User Not Found: Create New User ---
      // NOTE: This relies on frontend sending required info or having good defaults
      // Requires username and country from your schema! These might not come from Google Sign-In.
      // You might need to prompt the user for these on first login on the frontend.
      info(`[firebase-user] User not found. Creating new user for UID: ${firebaseUid}`);
      const defaultUsername = `user_${firebaseUid.substring(0, 8)}`; // Generate if not provided
      const defaultCountry = req.body.country || 'Unknown'; // Get country from body or use default

      user = new User({
        // _id handled by Mongoose
        firebaseUid: firebaseUid, // Set the firebaseUid field
        email: email.toLowerCase(),
        username: req.body.username || defaultUsername, // Use provided or default
        country: defaultCountry,                     // Use provided or default
        name: name || defaultUsername,               // Use Google name or default username
        profilePic: profilePic || "default-profile.png",
        // No password for users created via this sync endpoint (e.g., Google Sign In)
      });

      await user.save();
      info(`[firebase-user] Successfully created new user: ${user._id} (FirebaseUID: ${user.firebaseUid})`);
    }

    // Return user data (excluding password)
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({ message: "User sync/creation successful", user: userResponse });

  } catch (err) {
    error("❌ Error in /firebase-user endpoint:", err);
    if (err.code === 11000) { // Handle MongoDB duplicate key error
        warn("[firebase-user] Duplicate key error during save:", err.keyValue);
        // Check which field caused the duplicate error
        const duplicateField = Object.keys(err.keyValue)[0];
        return res.status(409).json({ error: `User synchronization conflict (${duplicateField} already exists).` }); // 409 Conflict
    }
    // Handle Mongoose validation errors
     if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        error("[firebase-user] Validation Error:", messages);
        return res.status(400).json({ error: "Validation failed", details: messages });
    }
    res.status(500).json({ error: "Internal Server Error during user sync" });
  }
});

// --- Custom Email/Password Signup Route ---
// This route creates BOTH a Firebase Auth user AND a MongoDB user
router.post("/create-user", async (req, res) => {
  // Extract required fields, matching User schema
  const { email, password, username, country, name, profilePic } = req.body;
  info("[create-user] Request received for email:", email);
  debug("[create-user] Request body:", req.body);

  // --- Validation ---
  if (!email || !password || !username || !country) {
    warn("[create-user] Missing required fields.");
    return res.status(400).json({ error: "Missing required fields (email, password, username, country)" });
  }
  // Add password strength check if desired
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }
  // --- End Validation ---

  let firebaseUser; // To store created Firebase user info

  try {
    // 1. Check if user already exists in *our* DB by email OR username
    // We don't check by firebaseUid here because we assume Firebase handles that uniqueness
    info(`[create-user] Checking existing DB user: ${email} / ${username}`);
    const existingUser = await User.findOne({ $or: [
        { email: email.toLowerCase() },
        { username: username.trim() }
    ]});
    if (existingUser) {
      warn(`[create-user] User already exists in DB: ${email} / ${username}`);
      const field = existingUser.email === email.toLowerCase() ? 'Email' : 'Username';
      return res.status(409).json({ error: `${field} already exists!` }); // 409 Conflict
    }

    // 2. Create user in Firebase Authentication
    info(`[create-user] Creating user in Firebase Auth for email: ${email}`);
    try {
        firebaseUser = await firebaseAdminAuth.createUser({
            email: email,
            password: password,
            displayName: name || username.trim(), // Use name or fallback to username
        });
        info(`[create-user] Firebase user created successfully. UID: ${firebaseUser.uid}`);
    } catch (fbError) { // Renamed variable
        error(`[create-user] Firebase user creation failed for email ${email}:`, fbError);
        let clientMessage = "Failed to create authentication account.";
        if (fbError.code === 'auth/email-already-exists') { clientMessage = "This email address is already registered with our authentication provider."; }
        else if (fbError.code === 'auth/invalid-password') { clientMessage = "Password must be at least 6 characters long."; }
        else if (fbError.code === 'auth/invalid-email') { clientMessage = "Invalid email format."; }
        // Important: Don't proceed to create DB user if Firebase creation failed
        return res.status(400).json({ message: clientMessage, code: fbError.code });
    }

    // 3. Hash the password (for storing in *your* DB)
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    debug(`[create-user] Password hashed for user ${firebaseUser.uid}`);

    // 4. Create the new user in your MongoDB database
    const newUser = new User({
      // _id: firebaseUid, // Let Mongoose handle _id
      firebaseUid: firebaseUser.uid, // Store the Firebase UID received from createUser
      email: email.toLowerCase(),
      password: hashedPassword,
      username: username.trim(),
      country: country,
      name: name || username.trim(),
      profilePic: profilePic || 'default-profile.png',
      // role defaults to 'user' via schema
    });

    info(`[create-user] Saving new user to MongoDB for UID: ${firebaseUser.uid}`);
    await newUser.save();
    info(`[create-user] User saved to MongoDB. ID: ${newUser._id}`);

    // 5. Respond to client
    const userResponse = newUser.toObject();
    delete userResponse.password; // Ensure password hash is not sent back

    res.status(201).json({
      message: "Signup successful",
      user: userResponse,
    });

  } catch (err) { // Catch errors from DB save or bcrypt
    error("❌ Error during signup process:", err);
    // If DB save failed *after* Firebase user was created, we should ideally delete the Firebase user
    if (firebaseUser && firebaseUser.uid && err.name !== 'ValidationError' && err.code !== 11000) { // Only cleanup if DB error is not validation/duplicate
      warn(`[create-user Cleanup] DB save failed for ${firebaseUser.uid}. Attempting to delete Firebase user.`);
      try {
          await firebaseAdminAuth.deleteUser(firebaseUser.uid);
          info(`[create-user Cleanup] Successfully deleted Firebase user ${firebaseUser.uid}.`);
      } catch (delErr) {
          error(`[create-user Cleanup FAILED] Could not delete Firebase user ${firebaseUser.uid} after DB error:`, delErr);
          // Log this critical state - user exists in Firebase but not your DB
      }
    }
    // Handle specific errors
    if (err.name === 'ValidationError') { const messages = Object.values(err.errors).map(val => val.message); return res.status(400).json({ error: "Validation failed", details: messages }); }
    if (err.code === 11000) { return res.status(409).json({ error: "Duplicate field value entered.", field: Object.keys(err.keyPattern)[0] }); } // Use 409 Conflict
    // General error
    res.status(500).json({ error: "Internal server error during signup" });
  }
});


// Export the router
export default router;