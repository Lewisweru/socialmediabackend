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
    const listings = await Listing.find().populate("user", "name email");
    res.status(200).json(listings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching listings" });
  }
};
