import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import { validate, createInviteSchema, updateMemberRoleSchema } from "../middleware/validation";
import * as inviteService from "../services/invite.service";
import { WorkspaceError } from "../services/workspace.service";

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get workspace invites
router.get("/workspace/:workspaceId", async (req: AuthRequest, res) => {
  try {
    const invites = await inviteService.getWorkspaceInvites(req.params.workspaceId, req.user!.id);
    res.json(invites);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get invites error:", error);
    res.status(500).json({ error: "Failed to fetch invites" });
  }
});

// Create invite
router.post("/workspace/:workspaceId", validate(createInviteSchema), async (req: AuthRequest, res) => {
  try {
    const invite = await inviteService.createInvite({
      workspaceId: req.params.workspaceId,
      email: req.body.email,
      role: req.body.role,
      invitedById: req.user!.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json(invite);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create invite error:", error);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

// Get invite by token
router.get("/token/:token", async (req: AuthRequest, res) => {
  try {
    const invite = await inviteService.getInvite(req.params.token);
    res.json(invite);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get invite error:", error);
    res.status(500).json({ error: "Failed to fetch invite" });
  }
});

// Accept invite
router.post("/accept/:token", async (req: AuthRequest, res) => {
  try {
    const member = await inviteService.acceptInvite(
      req.params.token,
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(member);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Accept invite error:", error);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// Decline invite
router.post("/decline/:token", async (req: AuthRequest, res) => {
  try {
    const result = await inviteService.declineInvite(
      req.params.token,
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(result);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Decline invite error:", error);
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

// Revoke invite
router.delete("/:inviteId", async (req: AuthRequest, res) => {
  try {
    const result = await inviteService.revokeInvite(
      req.params.inviteId,
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(result);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Revoke invite error:", error);
    res.status(500).json({ error: "Failed to revoke invite" });
  }
});

// Remove member
router.delete("/workspace/:workspaceId/member/:userId", async (req: AuthRequest, res) => {
  try {
    const result = await inviteService.removeMember(
      req.params.workspaceId,
      req.params.userId,
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(result);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Remove member error:", error);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// Update member role
router.patch("/workspace/:workspaceId/member/:userId", validate(updateMemberRoleSchema), async (req: AuthRequest, res) => {
  try {
    const member = await inviteService.updateMemberRole(
      req.params.workspaceId,
      req.params.userId,
      req.body.role,
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(member);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update member role error:", error);
    res.status(500).json({ error: "Failed to update member role" });
  }
});

export default router;
