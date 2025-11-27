import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import { validate, createWorkspaceSchema, updateWorkspaceSchema } from "../middleware/validation";
import * as workspaceService from "../services/workspace.service";
import { WorkspaceError } from "../services/workspace.service";
import * as webhookService from "../services/webhook.service";
import { prisma } from "../lib/prisma";
import crypto from "crypto";

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Create workspace
router.post("/", validate(createWorkspaceSchema), async (req: AuthRequest, res) => {
  try {
    const workspace = await workspaceService.createWorkspace({
      ...req.body,
      ownerId: req.user!.id,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json(workspace);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create workspace error:", error);
    res.status(500).json({ error: "Failed to create workspace" });
  }
});

// Get user's workspaces
router.get("/", async (req: AuthRequest, res) => {
  try {
    const workspaces = await workspaceService.getUserWorkspaces(req.user!.id);
    res.json(workspaces);
  } catch (error) {
    console.error("Get workspaces error:", error);
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
});

// Get single workspace
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const workspace = await workspaceService.getWorkspace(req.params.id, req.user!.id);
    res.json(workspace);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get workspace error:", error);
    res.status(500).json({ error: "Failed to fetch workspace" });
  }
});

// Update workspace
router.patch("/:id", validate(updateWorkspaceSchema), async (req: AuthRequest, res) => {
  try {
    const workspace = await workspaceService.updateWorkspace(
      req.params.id,
      req.user!.id,
      req.body,
      req.ip,
      req.get("user-agent")
    );

    res.json(workspace);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update workspace error:", error);
    res.status(500).json({ error: "Failed to update workspace" });
  }
});

// Delete workspace
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const result = await workspaceService.deleteWorkspace(
      req.params.id,
      req.user!.id,
      req.ip,
      req.get("user-agent")
    );

    res.json(result);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete workspace error:", error);
    res.status(500).json({ error: "Failed to delete workspace" });
  }
});

// ============================================
// WEBHOOK MANAGEMENT
// ============================================

// Get available webhook events
router.get("/:id/webhooks/events", async (req: AuthRequest, res) => {
  try {
    const events = webhookService.getAvailableWebhookEvents();
    res.json(events);
  } catch (error) {
    console.error("Get webhook events error:", error);
    res.status(500).json({ error: "Failed to get webhook events" });
  }
});

// Get webhook configuration
router.get("/:id/webhooks", async (req: AuthRequest, res) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.params.id },
      select: {
        webhookUrl: true,
        webhookEvents: true,
        // Don't send secret to client
      },
    });

    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    res.json(workspace);
  } catch (error) {
    console.error("Get webhook config error:", error);
    res.status(500).json({ error: "Failed to get webhook configuration" });
  }
});

// Configure webhooks
router.patch("/:id/webhooks", async (req: AuthRequest, res) => {
  try {
    const { webhookUrl, webhookSecret, webhookEvents } = req.body;

    // Validate URL if provided
    if (webhookUrl) {
      try {
        new URL(webhookUrl);
      } catch (e) {
        return res.status(400).json({ error: "Invalid webhook URL" });
      }
    }

    // Generate secret if not provided
    const secret = webhookSecret || crypto.randomBytes(32).toString("hex");

    const workspace = await prisma.workspace.update({
      where: { id: req.params.id },
      data: {
        webhookUrl: webhookUrl || null,
        webhookSecret: webhookUrl ? secret : null,
        webhookEvents: webhookEvents || [],
      },
      select: {
        id: true,
        webhookUrl: true,
        webhookSecret: true,
        webhookEvents: true,
      },
    });

    res.json(workspace);
  } catch (error) {
    console.error("Configure webhooks error:", error);
    res.status(500).json({ error: "Failed to configure webhooks" });
  }
});

// Test webhook
router.post("/:id/webhooks/test", async (req: AuthRequest, res) => {
  try {
    await webhookService.sendWebhook(req.params.id, "test.ping", {
      message: "Webhook test successful",
      timestamp: new Date(),
      userId: req.user!.id,
    });

    res.json({ success: true, message: "Test webhook sent" });
  } catch (error) {
    console.error("Test webhook error:", error);
    res.status(500).json({ error: "Failed to send test webhook" });
  }
});

export default router;
