import express from "express";
import { getUser } from "../controllers/userController.js";

const router = express.Router();

// Route to fetch user by Firebase UID (or MongoDB _id)
router.get("/:id", getUser);

export default router;