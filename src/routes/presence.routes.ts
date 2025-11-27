import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import * as presenceService from "../services/presence.service";
import { PresenceError } from "../services/presence.service";
import { z } from "zod";

const router = Router();

const setStatusSchema = z.object({
  status: z.enum(["online", "offline", "away"]),
  awayMessage: z
    .object({
      en: z.string().optional(),
      nl: z.string().optional(),
      de: z.string().optional(),
      fr: z.string().optional(),
    })
    .optional(),
});

// Set current user's status
router.post("/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = setStatusSchema.parse(req.body);
    const user = await presenceService.setUserStatus(
      req.user!.id,
      data.status,
      data.awayMessage
    );
    res.json(user);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof PresenceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Set status error:", error);
    res.status(500).json({ error: "Failed to set status" });
  }
});

// Get current user's status
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await presenceService.getUserStatus(req.user!.id);
    res.json(user);
  } catch (error) {
    if (error instanceof PresenceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get status error:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

// Get online users in workspace
router.get("/workspace/:workspaceId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const users = await presenceService.getWorkspaceOnlineUsers(req.params.workspaceId);
    res.json(users);
  } catch (error) {
    if (error instanceof PresenceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get workspace online users error:", error);
    res.status(500).json({ error: "Failed to get online users" });
  }
});

// Get online count in workspace
router.get("/workspace/:workspaceId/count", requireAuth, async (req: AuthRequest, res) => {
  try {
    const count = await presenceService.getWorkspaceOnlineCount(req.params.workspaceId);
    res.json({ count });
  } catch (error) {
    if (error instanceof PresenceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get workspace online count error:", error);
    res.status(500).json({ error: "Failed to get online count" });
  }
});

// Update last seen (heartbeat)
router.post("/heartbeat", requireAuth, async (req: AuthRequest, res) => {
  try {
    await presenceService.updateLastSeen(req.user!.id);
    res.json({ success: true });
  } catch (error) {
    console.error("Heartbeat error:", error);
    res.status(500).json({ error: "Failed to update heartbeat" });
  }
});

export default router;
