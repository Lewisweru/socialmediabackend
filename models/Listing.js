import mongoose from "mongoose";

const ListingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    platform: { type: String, required: true, enum: ["Instagram", "TikTok", "Facebook", "YouTube"] },
    username: { type: String, required: true },
    audienceSize: { type: Number, required: true }, // Followers for IG/TikTok, Subscribers for YouTube
    niche: { type: String, required: true },
    price: { type: Number, required: true },
  },
  { timestamps: true }
);

const Listing = mongoose.model("Listing", ListingSchema);
export default Listing;
// This code defines a Mongoose schema for a listing in a marketplace application.
// The schema includes fields for the user who created the listing, the platform (Instagram, TikTok, Facebook, YouTube),
// the username of the influencer, their audience size (followers or subscribers), niche, and price.
// The schema also includes timestamps for when the listing was created and last updated.