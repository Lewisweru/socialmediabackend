import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true }, // Store Firebase UID
  email: { type: String, required: true, unique: true },
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);
export default User;
