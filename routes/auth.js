import { Router } from "express";
import passport from "../config/googleauth.js"; // Path to your googleauth.js file
import User from "server/models/User.js";  // Ensure this path is correct

const router = Router();

// Route to initiate Google login
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback route where Google will redirect after successful authentication
router.get('/google/callback', 
  passport.authenticate('google', {
    failureRedirect: '/login',  // Redirect to login if authentication fails
    successRedirect: '/'         // Redirect to home/dashboard on success
  })
);

export default router;
