import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true }, // ✅ Firebase UID
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    profilePic: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
