// controllers/authController.js or wherever signupUser is defined

import bcrypt from "bcrypt";
import User from "../models/User.js";
import { info, warn, error, debug } from '../utils/logger.js';
// Import the initialized firebaseAdminAuth from your config
import { firebaseAdminAuth } from "../config/firebaseAdmin.js";

export const signupUser = async (req, res) => {
  // Extract required fields, including those needed for User schema
  const { email, password, username, country, name } = req.body; // Add username, country

  // Basic validation
  if (!email || !password || !username || !country) {
    return res.status(400).json({ message: "Missing required fields (email, password, username, country)" });
  }
  // Add more validation if needed (password strength, etc.)

  try {
    // 1. Check if user already exists in *your* DB by email OR username
    info(`[Signup] Checking existing user for email: ${email} or username: ${username}`);
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      warn(`[Signup] Attempted signup for existing email/username: ${email}/${username}`);
      return res.status(400).json({ message: "User with this email or username already exists" });
    }

    // 2. Create user in Firebase Authentication
    info(`[Signup] Creating user in Firebase Auth for email: ${email}`);
    let firebaseUser;
    try {
        firebaseUser = await firebaseAdminAuth.createUser({
            email: email,
            password: password,
            displayName: name || username, // Use name or fallback to username for Firebase display name
            // emailVerified: false, // Optional: set based on your flow
        });
        info(`[Signup] Firebase user created successfully. UID: ${firebaseUser.uid}`);
    } catch (firebaseError) {
        error(`[Signup] Firebase user creation failed for email ${email}:`, firebaseError);
        // Provide specific feedback if possible (e.g., weak password, email exists in Firebase)
        let clientMessage = "Failed to create user account.";
        if (firebaseError.code === 'auth/email-already-exists') {
            clientMessage = "This email address is already registered.";
            // Consider checking if the user exists in *your* DB again here, maybe sync is needed
        } else if (firebaseError.code === 'auth/invalid-password') {
             clientMessage = "Password must be at least 6 characters long.";
        }
        return res.status(400).json({ message: clientMessage });
    }


    // 3. Hash the password (for storing in *your* DB - optional but good practice if you ever allow non-Firebase login)
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    info(`[Signup] Password hashed for user ${firebaseUser.uid}`);

    // 4. Create the new user in your MongoDB database
    const newUser = new User({
      firebaseUid: firebaseUser.uid, // Store the Firebase UID
      email: email,
      password: hashedPassword,      // Store the hashed password
      username: username,            // Store username
      country: country,              // Store country
      name: name || username,        // Store name (or default to username)
      // Let Mongoose handle _id
      // role is defaulted to 'user' by the schema
    });

    info(`[Signup] Saving new user to MongoDB for UID: ${firebaseUser.uid}`);
    await newUser.save();
    info(`[Signup] User saved to MongoDB. ID: ${newUser._id}`);

    // 5. Respond to client (don't send password back)
    // You might want to generate a JWT token here if using sessionless auth
    res.status(201).json({
      message: "Signup successful",
      user: { // Return only necessary, non-sensitive info
        _id: newUser._id, // MongoDB ID
        firebaseUid: newUser.firebaseUid,
        email: newUser.email,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role,
        country: newUser.country,
        // profilePic: newUser.profilePic // Optional
      },
      // token: generateJwtToken(newUser._id) // Example if using JWT
    });

  } catch (error) {
    // Handle potential DB errors during save or other unexpected errors
    error("❌ Error during signup:", error);
    // If Firebase user was created but DB save failed, consider deleting the Firebase user for consistency
    // if (firebaseUser && firebaseUser.uid) {
    //   try { await firebaseAdminAuth.deleteUser(firebaseUser.uid); info(`[Signup Cleanup] Deleted Firebase user ${firebaseUser.uid} due to DB save error.`); } catch (delErr) { error(`[Signup Cleanup Failed] Could not delete Firebase user ${firebaseUser.uid}:`, delErr);}
    // }
    res.status(500).json({ message: "Internal server error during signup" });
  }
};

export const getUser = async (req, res) => {
  try {
    const firebaseUserId = req.params.id; // The ID from the URL IS the Firebase UID
    info(`[getUser] Received request for Firebase UID: ${firebaseUserId}`);

    if (!firebaseUserId) {
        warn('[getUser] No Firebase UID provided in request params.');
        return res.status(400).json({ message: "User ID parameter is missing." });
    }

    // FIX: Find the user by the 'firebaseUid' field
    debug(`[getUser] Searching DB for user with firebaseUid: ${firebaseUserId}`);
    const user = await User.findOne({ firebaseUid: firebaseUserId }).select('-password'); // Exclude password

    if (!user) {
      info(`[getUser] User not found for Firebase UID: ${firebaseUserId}`);
      return res.status(404).json({ message: "User not found" });
    }

    info(`[getUser] Successfully found user for Firebase UID: ${firebaseUserId} (MongoDB ID: ${user._id})`);
    res.status(200).json(user); // Return the found user document

  } catch (error) {
    // Don't expect CastError here anymore, but handle other potential DB errors
    error(`[getUser] Error fetching user for Firebase UID ${req.params.id}:`, error);
    res.status(500).json({
      message: "Error fetching user",
      error: error.message
    });
  }
};