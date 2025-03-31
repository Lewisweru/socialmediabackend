import express from "express";
import { syncUser, getUser } from "../controllers/userController.js";

const router = express.Router();

router.post("/sync", syncUser);
router.get("/:id", getUser);

export default router;
