import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  firebaseUid: { type: String, unique: true }, // Store Firebase UID
  googleId: { type: String, unique: true }, // Store Google ID
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  profilePic: { type: String }
}, { timestamps: true });

export default mongoose.model("User", UserSchema);
