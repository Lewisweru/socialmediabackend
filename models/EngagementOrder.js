import mongoose from "mongoose";

const EngagementOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    platform: { type: String, required: true },
    serviceType: { type: String, required: true }, // Followers, Likes, etc.
    link: { type: String, required: true },
    quantity: { type: Number, required: true },
    status: { type: String, default: "Pending" },
  },
  { timestamps: true }
);

const EngagementOrder = mongoose.model("EngagementOrder", EngagementOrderSchema);
export default EngagementOrder;
