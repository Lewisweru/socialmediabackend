import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
  email: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "pending" }, // 'pending', 'completed', 'failed'
  paymentId: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);
export default Order;
