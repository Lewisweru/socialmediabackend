// models/User.js (Corrected for Option 1)
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // REMOVED custom _id definition. Mongoose will add default ObjectId _id.

    firebaseUid: { // ADDED dedicated field for Firebase UID
      type: String,
      required: true,
      unique: true, // Ensures only one document per Firebase user
      index: true   // Index for fast lookups in 'protect' middleware
    },
    username: { // Kept from your schema
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    email: { // Kept from your schema
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /.+\@.+\..+/, // Basic email validation
      index: true
    },
    country: { // Kept from your schema
        type: String,
        required: true,
        trim: true
    },
    name: { // Kept from your schema
        type: String,
        trim: true
    },
    profilePic: { // Kept from your schema
        type: String
    },
    password: { // Kept from your schema - for non-Firebase auth methods
        type: String
        // select: false // Optional: uncomment if you usually want to hide it
    },
    role: { // Kept from your schema
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
  },
  { timestamps: true } // Keep timestamps
);

// Optional pre-save hook (remains the same)
userSchema.pre('save', function(next) {
  if (!this.name && this.username) {
    this.name = this.username;
  }
  next();
});


const User = mongoose.model("User", userSchema);

export default User;