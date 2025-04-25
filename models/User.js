// --- START OF FILE models/User.js --- (Corrected)
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: [true, 'Firebase UID is required'],
      unique: true,
      index: true
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
      match: [/.+\@.+\..+/, 'Please enter a valid email address'],
      index: true
    },
    name: {
        type: String,
        trim: true
    },
    profilePic: {
        type: String,
        trim: true,
        default: '/images/default-profile.png'
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
  },
  {
    timestamps: true
  }
);

const User = mongoose.model("User", userSchema);
export default User;
// --- END OF FILE models/User.js ---