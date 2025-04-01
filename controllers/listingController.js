import Listing from "../models/Listing.js";

export const createListing = async (req, res) => {
  try {
    const listing = new Listing(req.body);
    await listing.save();
    res.status(201).json(listing);
  } catch (error) {
    res.status(400).json({ message: "Error creating listing", error });
  }
};

export const getListings = async (req, res) => {
  try {
    const { sellerId } = req.query;

    if (!sellerId) {
      return res.status(400).json({ message: "Seller ID is required" });
    }

    const listings = await Listing.find({ user: sellerId });
    res.status(200).json(listings);
  } catch (error) {
    console.error("Error fetching listings:", error);
    res.status(500).json({
      message: "Error fetching listings",
      error: error.message,
    });
  }
};
