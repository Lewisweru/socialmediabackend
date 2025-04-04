// models/Order.js
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    // Our internal Order ID is the default MongoDB ObjectId `_id`

    pesapalOrderId: { // The UUID generated on frontend/backend before sending to Pesapal
      type: String,
      required: [true, 'Pesapal Order ID is required.'],
      unique: true, // Ensure we don't process the same logical order twice
      index: true,
    },
    pesapalTrackingId: { // The ID received FROM Pesapal after registration
      type: String,
      index: true,
      sparse: true, // Allows null/undefined values in unique index if needed initially
    },
    userId: { // Reference to the User who placed the order
      type: String, // Assuming you store Firebase UID as string _id in User model
      ref: 'User', // Link to your User model (ensure 'User' matches your model name)
      required: [true, 'User ID is required.'],
      index: true,
    },
    // Details from EngagementPage
    platform: {
        type: String,
        required: [true, 'Platform is required.']
    },
    service: {
        type: String,
        required: [true, 'Service is required.']
     },
    quality: {
        type: String,
        enum: { values: ['standard', 'high'], message: 'Quality must be standard or high.' },
        required: [true, 'Quality is required.']
    },
    accountLink: {
        type: String,
        required: [true, 'Account link is required.']
    },
    quantity: {
        type: Number,
        required: [true, 'Quantity is required.'],
        min: [1, 'Quantity must be at least 1.'] // Example validation
     },
    // Payment details
    amount: {
        type: Number,
        required: [true, 'Amount is required.']
    },
    currency: {
        type: String,
        required: true,
        default: 'KES' // Default currency
    },
    description: { type: String }, // Description sent to Pesapal
    // Status tracking
    status: {
      type: String,
      required: true,
      enum: ['Pending Payment', 'Payment Failed', 'Processing', 'Completed', 'Cancelled'],
      default: 'Pending Payment',
      index: true,
    },
    paymentStatus: { // Store Pesapal's reported status
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'INVALID', null], // Added null for initial state
      default: null,
    },
    // Optional: Store callback URL used
    callbackUrlUsed: { type: String },
    // Optional: Store any error messages during processing
    errorMessage: { type: String },

  },
  { timestamps: true } // Adds createdAt and updatedAt automatically
);

// Optional: Index for common queries
orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ createdAt: -1 });

const Order = mongoose.model("Order", orderSchema);

export default Order;