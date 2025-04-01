import express from "express";
import { 
  getUser, 
  syncUser, 
  getUsers 
} from "../controllers/userController.js";

const router = express.Router();

// Get all users
router.get("/", getUsers);

// Get user by Firebase UID
router.get("/firebase/:uid", getUser);

// Get user by MongoDB ID
router.get("/:id", getUser);

// Sync user data
router.post("/sync", syncUser);

export default router;