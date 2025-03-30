import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true }, // Store Google ID
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    picture: { type: String }, // Optional: store the user's profile picture
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
export default User;
