import express from "express";
import { getOrders } from "../controllers/orderController.js";

const router = express.Router();

// Define the route for fetching orders
router.get("/", getOrders);

export default router;