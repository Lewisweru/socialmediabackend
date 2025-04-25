import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    // Keep MongoDB's default _id, but link primarily via firebaseUid
    firebaseUid: {
      type: String,
      required: [true, 'Firebase UID is required'],
      unique: true,
      index: true // Ensure efficient lookups
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      index: true,
      minlength: [3, 'Username must be at least 3 characters long']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/.+\@.+\..+/, 'Please enter a valid email address'], // Basic email format validation
      index: true
    },
    name: { // User's display name (can come from Firebase profile)
        type: String,
        trim: true
    },
    profilePic: { // URL to profile picture (can come from Firebase profile)
        type: String,
        trim: true,
        default: '/images/default-profile.png' // Example default, make configurable
    },
    country: {
      type: String,
      trim: true,
      default: 'Unknown'
    },
    role: {
      type: String,
      enum: {
          values: ['user', 'admin'],
          message: '{VALUE} is not a supported role'
      },
      default: 'user'
    },
    // Add any other non-auth fields specific to your application here
    // e.g., balance: { type: Number, default: 0 }

  },
  {
    timestamps: true // Automatically add createdAt and updatedAt
  }
);

// REMOVED password hashing pre-save hook

// Optional: Ensure necessary indexes exist (redundant if specified in schema, but doesn't hurt)
userSchema.index({ firebaseUid: 1 });
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

const User = mongoose.model("User", userSchema);
export default User;