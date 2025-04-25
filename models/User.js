// models/User.js
import mongoose from 'mongoose';
// import bcrypt from 'bcrypt'; // REMOVED - Firebase handles passwords

const userSchema = new mongoose.Schema(
  {
    // Use firebaseUid as the primary link, but keep MongoDB's default _id
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true // Ensure efficient lookups
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /.+\@.+\..+/, // Basic email format validation
      index: true
    },
    name: { // User's display name (can come from Firebase profile)
        type: String,
        trim: true
    },
    profilePic: { // URL to profile picture (can come from Firebase profile)
        type: String,
        trim: true,
        default: '/images/default-profile.png' // Example default
    },
    country: {
      type: String,
      trim: true,
      default: 'Unknown'
    },
    role: {
      type: String,
      enum: ['user', 'admin'], // Define possible roles
      default: 'user'
    },
    // Add any other fields specific to your application
    // e.g., balance: { type: Number, default: 0 }
    // e.g., orderHistory: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }]

    // REMOVED password field
    // REMOVED password reset fields (handled by Firebase)
    // REMOVED email verification fields (can use Firebase email verification status if needed)

  },
  {
    timestamps: true // Automatically add createdAt and updatedAt
  }
);

// REMOVED pre-save hook for password hashing

const User = mongoose.model("User", userSchema);
export default User;