import Order from "../models/Order.js";

export const getOrders = async (req, res) => {
  try {
    const { sellerId } = req.query;

    if (!sellerId) {
      return res.status(400).json({ message: "Seller ID is required" });
    }

    const orders = await Order.find({ seller: sellerId });
    const stats = {
      totalSales: orders.reduce((sum, order) => sum + order.amount, 0),
      pendingOrders: orders.filter((o) => o.status === "pending").length,
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      message: "Error fetching orders",
      error: error.message,
    });
  }
};