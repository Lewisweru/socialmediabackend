import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // Use firebaseUid as the _id field
    email: { type: String, required: true, unique: true, match: /.+\@.+\..+/ },
    name: { type: String },
    profilePic: { type: String },
    password: { type: String }, // Store hashed passwords
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
