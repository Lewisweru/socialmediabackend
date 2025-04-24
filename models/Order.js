// models/Order.js (Corrected userId Type)
import mongoose from 'mongoose';
const { Schema } = mongoose;

export const OrderStatusEnum = [ /* ... enum values ... */ ];

const OrderSchema = new Schema({
  userId: {
    type: String, // <<< CHANGE: Use String to store the Firebase UID
    required: true,
    index: true
    // ref: 'User' // <<< REMOVE or comment out: 'ref' works best with ObjectIds
  },
  pesapalOrderId: { type: String, required: true, unique: true, index: true },
  pesapalTrackingId: { type: String, index: true },
  platform: { type: String, required: true, lowercase: true },
  service: { type: String, required: true },
  quality: { type: String, enum: ['standard', 'high'], required: true },
  accountLink: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'KES' },
  status: { type: String, enum: OrderStatusEnum, required: true, default: 'Pending Payment', index: true },
  paymentStatus: { type: String },
  supplierOrderId: { type: String },
  supplierStatus: { type: String },
  errorMessage: { type: String }, // Added based on controller code
  callbackUrlUsed: { type: String } // Added based on controller code
}, { timestamps: true });

export default mongoose.model('Order', OrderSchema);