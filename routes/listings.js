import express from "express";
import Listing from "../models/Listing.js"; // Ensure the path is correct
import { getListings } from "../controllers/listingController.js";

const router = express.Router();

// GET /api/listings - Fetch listings
router.get("/", getListings);

// POST /api/listings - Create a new listing
router.post("/", async (req, res) => {
  try {
    const { user, platform, username, audienceSize, niche, price } = req.body;

    // Validate required fields
    if (!user || !platform || !username || !audienceSize || !niche || !price) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Create a new listing
    const listing = new Listing({
      user, // Firebase UID as a string
      platform,
      username,
      audienceSize,
      niche,
      price,
    });

    await listing.save();

    res.status(201).json({ message: "Listing created successfully", listing });
  } catch (error) {
    console.error("Error creating listing:", error);
    res.status(500).json({ message: "Error creating listing", error: error.message });
  }
});

export default router;
