const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // 🔥 Use Firebase UID as `_id`
  googleId: { type: String, unique: true },
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  profilePic: { type: String }
}, { timestamps: true });

export default mongoose.model("User", UserSchema);
