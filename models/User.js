import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // Firebase UID used as _id
    email: {
      type: String,
      required: true,
      unique: true,
      match: /.+\@.+\..+/,
    },
    name: { type: String },
    profilePic: { type: String },
    password: { type: String }, // Store hashed passwords
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;