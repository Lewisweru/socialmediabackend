import express from "express";
import { getListings } from "../controllers/listingController.js";

const router = express.Router();
router.get("/", getListings);

router.post("/", async (req, res) => {
  try {
    const { user, platform, username, audienceSize, niche, price } = req.body;

    if (!user || !platform || !username || !audienceSize || !niche || !price) {
      return res.status(400).json({ message: "All fields are required" });
    }

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
