// models/Order.js (ESM)
import mongoose from 'mongoose'; // Use import
const { Schema } = mongoose;

// Define OrderStatus values (as strings for direct use in enum)
// Export if needed elsewhere
export const OrderStatusEnum = [
  'Pending Payment', 'Payment Failed', 'Processing', 'In Progress',
  'Completed', 'Partial', 'Cancelled', 'Refunded', 'Supplier Error', 'Expired'
];

const OrderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  pesapalOrderId: { type: String, required: true, unique: true, index: true },
  pesapalTrackingId: { type: String, index: true },
  platform: { type: String, required: true, lowercase: true },
  service: { type: String, required: true },
  quality: { type: String, enum: ['standard', 'high'], required: true },
  accountLink: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: 'KES' },
  status: {
    type: String,
    enum: OrderStatusEnum,
    required: true,
    default: 'Pending Payment',
    index: true
  },
  paymentStatus: { type: String },
  supplierOrderId: { type: String }, // Added field
  supplierStatus: { type: String },  // Added field
}, { timestamps: true });

// Use export default for the model
export default mongoose.model('Order', OrderSchema);