// models/Order.js
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    // --- Identifiers & Linking ---
    pesapalOrderId: { // The UUID generated before sending to Pesapal (Merchant Reference)
      type: String,
      required: [true, 'Pesapal Order ID (Merchant Reference) is required.'],
      unique: true,
      index: true,
    },
    pesapalTrackingId: { // The ID received FROM Pesapal after registration
      type: String,
      index: true,
      sparse: true, // Allows null/undefined initially if using unique index
    },
    userId: { // Reference to the User who placed the order
      type: String, // Assuming User model uses Firebase UID (_id: String)
      ref: 'User', // Link to your User model
      required: [true, 'User ID is required.'],
      index: true,
    },

    // --- Order Details ---
    platform: { type: String, required: [true, 'Platform is required.'] },
    service: { type: String, required: [true, 'Service is required.'] },
    quality: { type: String, enum: { values: ['standard', 'high'], message: 'Quality must be standard or high.' }, required: [true, 'Quality is required.'] },
    accountLink: { type: String, required: [true, 'Account link is required.'] },
    quantity: { type: Number, required: [true, 'Quantity is required.'], min: [1, 'Quantity must be at least 1.'] },

    // --- Payment Details ---
    amount: { type: Number, required: [true, 'Amount is required.'] },
    currency: { type: String, required: true, default: 'KES' },
    description: { type: String, maxlength: [100, 'Description cannot exceed 100 characters.'] },

    // --- Status Tracking ---
    status: { // Your internal workflow status
      type: String,
      required: true,
      enum: ['Pending Payment', 'Payment Failed', 'SentToSupplier', 'Supplier Error', 'Processing', 'Partially Completed', 'Completed', 'Cancelled', 'Expired'],
      default: 'Pending Payment',
      index: true,
    },
    paymentStatus: { // Last known status description from Pesapal
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'INVALID', 'REVERSED', 'UNKNOWN', null],
      default: null,
    },

    // --- Supplier Integration Fields ---
    supplier: { type: String, default: 'jeskieinc', index: true },
    supplierServiceId: { type: String, index: true, sparse: true },
    supplierOrderId: { type: String, index: true, sparse: true },
    supplierStatus: { type: String, enum: ['Pending', 'In progress', 'Processing', 'Completed', 'Partial', 'Canceled', 'Error', null], default: null },
    supplierCharge: { type: String },
    supplierRemains: { type: String },
    supplierStartCount: { type: String },
    supplierErrorMessage: { type: String },

    // --- Callback & Error Info ---
    callbackUrlUsed: { type: String },
    errorMessage: { type: String }, // General/Pesapal errors

  },
  { timestamps: true } // Adds createdAt and updatedAt
);

// --- Indexes ---
orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ status: 1, createdAt: 1 });
orderSchema.index({ supplierOrderId: 1, supplier: 1 });
orderSchema.index({ createdAt: -1 });

// --- Model ---
const Order = mongoose.model("Order", orderSchema);

export default Order;