import express from "express";
import { syncUser, getUser } from "../controllers/userController.js";

const router = express.Router();

// Route to sync a user
router.post("/sync", syncUser);

// Route to get a user by ID
router.get("/:id", getUser);

export default router;
