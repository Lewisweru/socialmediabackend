import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, unique: true, sparse: true }, // For Firebase users
    googleId: { type: String, unique: true, sparse: true }, // For Google OAuth users
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    picture: { type: String }, // Profile picture
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
export default User;
