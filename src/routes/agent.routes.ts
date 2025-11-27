import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import * as agentService from "../services/agent.service";
import { AgentError } from "../services/agent.service";
import { z } from "zod";

const router = Router();

// All routes require authentication
router.use(requireAuth);

const createAgentSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  aiModel: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(100000).optional(),
  systemPrompt: z.string().min(1),
  personality: z.any().optional(),
  fallbackMessage: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  blockCompetitorQuestions: z.boolean().optional(),
  workflowId: z.string().optional(),
  customFunctions: z.any().optional(),
});

// Create agent
router.post("/", async (req: AuthRequest, res) => {
  try {
    const data = createAgentSchema.parse(req.body);
    // @ts-ignore
    const agent = await agentService.createAgent(data);
    res.status(201).json(agent);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof AgentError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create agent error:", error);
    res.status(500).json({ error: "Failed to create agent" });
  }
});

// Get workspace agents
router.get("/workspace/:workspaceId", async (req: AuthRequest, res) => {
  try {
    const agents = await agentService.getWorkspaceAgents(req.params.workspaceId);
    res.json(agents);
  } catch (error) {
    console.error("Get agents error:", error);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

// Get single agent
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const agent = await agentService.getAgent(req.params.id, workspaceId);
    res.json(agent);
  } catch (error) {
    if (error instanceof AgentError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get agent error:", error);
    res.status(500).json({ error: "Failed to fetch agent" });
  }
});

// Update agent
router.patch("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, ...data } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    const agent = await agentService.updateAgent(req.params.id, workspaceId, data);
    res.json(agent);
  } catch (error) {
    if (error instanceof AgentError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update agent error:", error);
    res.status(500).json({ error: "Failed to update agent" });
  }
});

// Delete agent
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await agentService.deleteAgent(req.params.id, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof AgentError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete agent error:", error);
    res.status(500).json({ error: "Failed to delete agent" });
  }
});

// Toggle agent status
router.post("/:id/toggle", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, isActive } = req.body;
    if (!workspaceId || typeof isActive !== "boolean") {
      return res.status(400).json({ error: "workspaceId and isActive required" });
    }
    const agent = await agentService.toggleAgentStatus(req.params.id, workspaceId, isActive);
    res.json(agent);
  } catch (error) {
    if (error instanceof AgentError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Toggle agent error:", error);
    res.status(500).json({ error: "Failed to toggle agent status" });
  }
});

export default router;
