import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import * as chatService from "../services/chat.service";
import { ChatError } from "../services/chat.service";
import { z } from "zod";

const router = Router();

// PUBLIC endpoints (for embedded widget)
const startConversationSchema = z.object({
  widgetId: z.string(),
  visitorId: z.string().optional(),
  visitorName: z.string().optional(),
  visitorEmail: z.string().email().optional(),
  visitorMetadata: z.any().optional(),
});

// Start conversation (PUBLIC)
router.post("/conversations/start", async (req, res) => {
  try {
    const data = startConversationSchema.parse(req.body);
    // @ts-ignore
    const conversation = await chatService.startConversation(data);
    res.status(201).json(conversation);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof ChatError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Start conversation error:", error);
    res.status(500).json({ error: "Failed to start conversation" });
  }
});

// Get conversation (PUBLIC - needs conversationId)
router.get("/conversations/:id", async (req, res) => {
  try {
    const conversation = await chatService.getConversation(req.params.id);
    res.json(conversation);
  } catch (error) {
    if (error instanceof ChatError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get conversation error:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// Get messages (PUBLIC) - with pagination support
router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    
    const result = await chatService.getConversationMessages(
      req.params.id,
      page,
      pageSize
    );
    res.json(result);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

const sendMessageSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1),
  role: z.enum(["USER", "AGENT"]).optional(),
  senderId: z.string().optional(),
  currentPageUrl: z.string().optional(),
});

// Send message (PUBLIC for USER, authenticated for AGENT)
router.post("/messages", async (req, res) => {
  try {
    const data = sendMessageSchema.parse(req.body);
    
    // If role is AGENT, require authentication and extract user ID from session
    if (data.role === "AGENT") {
      // Import auth dynamically to avoid circular dependencies
      const { auth } = await import("../lib/auth");
      
      // Get session from Better Auth (uses cookies)
      const session = await auth.api.getSession({
        headers: req.headers as any,
      });
      
      if (!session || !session.user) {
        return res.status(401).json({ error: "Authentication required for agent messages" });
      }
      
      // Automatically set senderId from authenticated user
      data.senderId = session.user.id;
    }
    
    // @ts-ignore
    const result = await chatService.sendMessage(data);
    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof ChatError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Send message error:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Resolve conversation (PUBLIC - visitor can close)
router.post("/conversations/:id/resolve", async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    const result = await chatService.resolveConversation(
      req.params.id,
      rating,
      feedback
    );
    res.json(result);
  } catch (error) {
    if (error instanceof ChatError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Resolve conversation error:", error);
    res.status(500).json({ error: "Failed to resolve conversation" });
  }
});

// AUTHENTICATED endpoints (for dashboard)

// Get workspace conversations (authenticated)
router.get("/workspace/:workspaceId/conversations", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { status, agentId, assignedToId } = req.query;
    const conversations = await chatService.getWorkspaceConversations(
      req.params.workspaceId,
      {
        status: status as string,
        agentId: agentId as string,
        assignedToId: assignedToId as string,
      }
    );
    res.json(conversations);
  } catch (error) {
    console.error("Get workspace conversations error:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Assign conversation to human (authenticated)
router.post("/conversations/:id/assign", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.body;
    const result = await chatService.assignConversationToHuman(
      req.params.id,
      userId || req.user!.id
    );
    res.json(result);
  } catch (error) {
    if (error instanceof ChatError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Assign conversation error:", error);
    res.status(500).json({ error: "Failed to assign conversation" });
  }
});

export default router;
