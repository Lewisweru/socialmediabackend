import express from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import asyncHandler from "express-async-handler";
import { body, validationResult } from "express-validator";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { info, warn, error, debug } from '../utils/logger.js';
import { firebaseAdminAuth } from "../config/firebaseAdmin.js";
import { sendVerificationEmail } from "../services/emailService.js";

const router = express.Router();

// Constants
const config = {
  DEFAULT_PROFILE_PIC: 'default-profile.png',
  DEFAULT_COUNTRY: 'Unknown',
  USERNAME_PREFIX: 'user_',
  MIN_PASSWORD_LENGTH: 8,
  SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10
};

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});

const strictAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Very strict limit for sensitive operations
  message: 'Too many attempts, please try again later'
});

// Response helpers
const successRes = (res, data, status = 200) => {
  return res.status(status).json({
    success: true,
    ...data
  });
};

const errorRes = (res, message, status = 400, details = null) => {
  return res.status(status).json({
    success: false,
    error: message,
    ...(details && { details })
  });
};

// --- Get Current User Route ---
router.get(
  '/current-user',
  protect,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      warn('[current-user] User object not found on request after protect middleware.');
      return errorRes(res, "Authentication successful but user data unavailable", 401);
    }
    
    info(`[current-user] Returning data for user MongoDB ID: ${req.user._id}`);
    return successRes(res, { user: req.user });
  })
);

// --- Firebase User Sync/Create Endpoint ---
router.post(
  "/firebase-user",
  [
    body('firebaseUid').notEmpty().isString(),
    body('email').isEmail().normalizeEmail(),
    body('name').optional().isString().trim(),
    body('profilePic').optional().isURL(),
    body('country').optional().isString().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      warn("[firebase-user] Validation errors:", errors.array());
      return errorRes(res, "Validation failed", 400, errors.array());
    }

    const { firebaseUid, email, name, profilePic, country } = req.body;
    info(`[firebase-user] Sync request for UID: ${firebaseUid}, Email: ${email}`);

    try {
      let user = await User.findOne({ firebaseUid });

      if (user) {
        info(`[firebase-user] Found existing user: ${user._id}. Checking for updates.`);
        const updates = {};
        
        if (name && user.name !== name) updates.name = name;
        if (profilePic && user.profilePic !== profilePic) updates.profilePic = profilePic;
        if (!user.username) {
          updates.username = `${config.USERNAME_PREFIX}${firebaseUid.substring(0, 8)}`;
          warn(`[firebase-user] Added default username: ${updates.username}`);
        }
        
        const countryToSet = country || user.country || config.DEFAULT_COUNTRY;
        if (user.country !== countryToSet) updates.country = countryToSet;

        if (Object.keys(updates).length > 0) {
          user = await User.findByIdAndUpdate(user._id, updates, { new: true });
          info(`[firebase-user] Updated details saved for user: ${user._id}`);
        }
      } else {
        info(`[firebase-user] Creating new user for UID: ${firebaseUid}`);
        const username = `${config.USERNAME_PREFIX}${firebaseUid.substring(0, 8)}`;
        
        user = new User({
          firebaseUid,
          email: email.toLowerCase(),
          username,
          country: country || config.DEFAULT_COUNTRY,
          name: name || username,
          profilePic: profilePic || config.DEFAULT_PROFILE_PIC
        });

        if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
          user.verified = false;
          await sendVerificationEmail(user.email, user._id);
        }

        await user.save();
        info(`[firebase-user] Created new user: ${user._id}`);
      }

      // Prepare response
      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.__v;

      return successRes(res, { 
        message: "User sync/creation successful", 
        user: userResponse 
      });

    } catch (err) {
      error("❌ Error in /firebase-user endpoint:", err);

      if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        warn(`[firebase-user] Duplicate key error: ${field}`);
        return errorRes(res, `Account with this ${field} already exists`, 409);
      }

      if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        error("[firebase-user] Validation Error:", messages);
        return errorRes(res, "Validation failed", 400, messages);
      }

      return errorRes(res, "Internal Server Error", 500);
    }
  })
);

// --- Email/Password Signup Route ---
router.post(
  "/create-user",
  authLimiter,
  [
    body('firebaseUid').notEmpty().isString(),
    body('email').isEmail().normalizeEmail(),
    body('password')
      .isLength({ min: config.MIN_PASSWORD_LENGTH })
      .matches(/(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}/),
    body('username').notEmpty().isString().trim(),
    body('country').optional().isString().trim(),
    body('name').optional().isString().trim(),
    body('profilePic').optional().isURL()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      warn("[create-user] Validation errors:", errors.array());
      return errorRes(res, "Validation failed", 400, errors.array());
    }

    const { firebaseUid, email, password, username, country, name, profilePic } = req.body;
    info("[create-user] Request received for UID:", firebaseUid);

    try {
      // Check existing users
      const existingUser = await User.findOne({ 
        $or: [
          { firebaseUid },
          { email: email.toLowerCase() },
          { username: username.trim() }
        ]
      });

      if (existingUser) {
        warn(`[create-user] User exists: ${existingUser._id}`);
        const field = existingUser.firebaseUid === firebaseUid ? 'Account' : 
                     (existingUser.email === email.toLowerCase() ? 'Email' : 'Username');
        return errorRes(res, `${field} already exists`, 409);
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, config.SALT_ROUNDS);
      debug(`[create-user] Password hashed for ${firebaseUid}`);

      // Create user
      const newUser = new User({
        firebaseUid,
        email: email.toLowerCase(),
        password: hashedPassword,
        username: username.trim(),
        country: country || config.DEFAULT_COUNTRY,
        name: name || username.trim(),
        profilePic: profilePic || config.DEFAULT_PROFILE_PIC
      });

      if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
        newUser.verified = false;
        await sendVerificationEmail(newUser.email, newUser._id);
      }

      await newUser.save();
      info(`[create-user] User created: ${newUser._id}`);

      // Prepare response
      const userResponse = newUser.toObject();
      delete userResponse.password;
      delete userResponse.__v;

      return successRes(res, { 
        message: "User created successfully", 
        user: userResponse 
      }, 201);

    } catch (err) {
      error("❌ Error in /create-user:", err);

      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        warn(`[create-user] Duplicate key error: ${field}`);
        return errorRes(res, `${field} already exists`, 409);
      }

      if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        error("[create-user] Validation Error:", messages);
        return errorRes(res, "Validation failed", 400, messages);
      }

      return errorRes(res, "Internal Server Error", 500);
    }
  })
);

// --- Password Reset Request ---
router.post(
  "/request-password-reset",
  strictAuthLimiter,
  [body('email').isEmail().normalizeEmail()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return errorRes(res, "Invalid email", 400);
    }

    const { email } = req.body;
    info(`[password-reset] Request for: ${email}`);

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        warn(`[password-reset] Email not found: ${email}`);
        return successRes(res, { message: "If an account exists, a reset email was sent" });
      }

      // Generate and save reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      user.resetToken = {
        token: resetToken,
        expires: new Date(Date.now() + parseInt(process.env.PASSWORD_RESET_EXPIRY || '3600000'))
      };
      await user.save();

      // Send email
      await sendPasswordResetEmail(email, resetToken);
      return successRes(res, { message: "Password reset email sent" });

    } catch (err) {
      error("❌ Error in /request-password-reset:", err);
      return errorRes(res, "Internal Server Error", 500);
    }
  })
);

export default router;