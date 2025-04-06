// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    _id: { // Firebase UID used as _id
      type: String,
      required: true
    },
    username: { // Added username field
      type: String,
      required: true,
      unique: true, // Ensure usernames are unique
      trim: true,   // Remove leading/trailing whitespace
      index: true   // Add index for faster lookups
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true, // Store emails consistently
      match: /.+\@.+\..+/, // Basic email format validation
      index: true
    },
    country: { // Added country field
        type: String,
        required: true,
        trim: true
    },
    name: { // Keep name field - maybe for full name display later?
        type: String,
        trim: true
    },
    profilePic: {
        type: String
    },
    password: { // For users signing up with email/password
        type: String
        // select: false // Consider adding if you NEVER want password included by default
    },
    // --- NEW ROLE FIELD ---
    role: {
        type: String,
        enum: ['user', 'admin'], // Define possible roles
        default: 'user'        // Default new users to 'user'
    },
    // --- END NEW ROLE FIELD ---
  },
  { timestamps: true } // Adds createdAt and updatedAt automatically
);

// Optional: Pre-save hook if you want to automatically populate 'name' from 'username' if 'name' is empty
userSchema.pre('save', function(next) {
  if (!this.name && this.username) {
    this.name = this.username; // Default name to username if not provided
  }
  next();
});


const User = mongoose.model("User", userSchema);

export default User;