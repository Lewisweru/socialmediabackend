import mongoose from "mongoose";

const listingSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  platform: { type: String, required: true },
  username: { type: String, required: true },
  followers: { type: Number, required: true },
  price: { type: Number, required: true },
  description: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Listing = mongoose.model("Listing", listingSchema);
export default Listing;
