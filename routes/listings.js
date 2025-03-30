import express from "express";
import { createListing, getListings } from "../controllers/listingController.js";

const router = express.Router();

router.post("/", createListing);
router.get("/", getListings);

export default router;
