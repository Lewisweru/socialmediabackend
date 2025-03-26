import express from "express";
import mongoose from "mongoose";
import Listing from "../models/Listing.js";

const router = express.Router();

// ✅ Create a New Listing
router.post("/", async (req, res) => {
  try {
    console.log("🔍 Incoming Request Body:", req.body);

    let { sellerId, platform, username, followers, price, description } = req.body;

    // ✅ Validate sellerId
    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ error: "Invalid sellerId format. Must be a valid MongoDB ObjectId." });
    }

    sellerId = new mongoose.Types.ObjectId(sellerId); // Convert to ObjectId

    const newListing = new Listing({
      sellerId,
      platform,
      username,
      followers,
      price,
      description
    });

    await newListing.save();
    res.status(201).json(newListing);
  } catch (error) {
    console.error("❌ Listing Creation Error:", error);
    res.status(500).json({ error: "Failed to create listing", details: error.message });
  }
});

// ✅ Get Listings (Filtered by Seller ID)
router.get("/", async (req, res) => {
  try {
    const { sellerId } = req.query;

    if (!sellerId) {
      return res.status(400).json({ error: "sellerId is required" });
    }

    const listings = await Listing.find({ sellerId }).sort({ createdAt: -1 });

    res.json(listings);
  } catch (error) {
    console.error("❌ Error fetching listings:", error);
    res.status(500).json({ error: "Failed to fetch listings" });
  }
});

// ✅ Delete a Listing
router.delete("/:id", async (req, res) => {
  try {
    await Listing.findByIdAndDelete(req.params.id);
    res.json({ message: "Listing deleted" });
  } catch (error) {
    console.error("❌ Delete Listing Error:", error);
    res.status(500).json({ error: "Failed to delete listing" });
  }
});

export default router;
