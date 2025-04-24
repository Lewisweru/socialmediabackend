// models/User.js (Keep As Is - Using String _id = FirebaseUID)
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    _id: { // Firebase UID used as _id
      type: String,
      required: true
    },
    firebaseUid: { // Keep this field even if it duplicates _id for now
      type: String,
      required: true,
      unique: true,
      index: true
    },
    username: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /.+\@.+\..+/, index: true },
    country: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    profilePic: { type: String },
    password: { type: String },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true }
);

userSchema.pre('save', function(next) { /* ... */ });
const User = mongoose.model("User", userSchema);
export default User;