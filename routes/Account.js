import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'instagram' or 'twitter'
  age: { type: String, required: true },
  followers: { type: String, required: true },
  price: { type: Number, required: true },
  credentials: { type: String, required: true }, // Encrypted account credentials
  isReserved: { type: Boolean, default: false },
  reservedAt: { type: Date },
  reservedBy: { type: String },
  soldAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Account = mongoose.model("Account", accountSchema);
export default Account;
