import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import { validate, updateUserSchema } from "../middleware/validation";
import * as userService from "../services/user.service";
import { UserError } from "../services/user.service";

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get current user
router.get("/me", async (req: AuthRequest, res) => {
  try {
    const user = await userService.getUser(req.user!.id);
    res.json(user);
  } catch (error) {
    if (error instanceof UserError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Update user
router.patch("/me", validate(updateUserSchema), async (req: AuthRequest, res) => {
  try {
    const user = await userService.updateUser(
      req.user!.id,
      req.body,
      req.ip,
      req.get("user-agent")
    );

    res.json(user);
  } catch (error) {
    if (error instanceof UserError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete user
router.delete("/me", async (req: AuthRequest, res) => {
  try {
    const result = await userService.deleteUser(
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(result);
  } catch (error) {
    if (error instanceof UserError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
