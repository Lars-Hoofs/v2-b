import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import * as kbService from "../services/knowledgeBase.service";
import { KnowledgeBaseError } from "../services/knowledgeBase.service";
import { z } from "zod";

const router = Router();

// All routes require authentication
router.use(requireAuth);

const createKBSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  embeddingModel: z.string().optional(),
  chunkSize: z.number().min(100).max(5000).optional(),
  chunkOverlap: z.number().min(0).max(1000).optional(),
});

const createDocumentSchema = z.object({
  knowledgeBaseId: z.string(),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  metadata: z.any().optional(),
  tags: z.array(z.string()).optional(),
});

// Create knowledge base
router.post("/", async (req: AuthRequest, res) => {
  try {
    const data = createKBSchema.parse(req.body);
    // @ts-ignore
    const kb = await kbService.createKnowledgeBase(data);
    res.status(201).json(kb);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create knowledge base error:", error);
    res.status(500).json({ error: "Failed to create knowledge base" });
  }
});

// Get workspace knowledge bases
router.get("/workspace/:workspaceId", async (req: AuthRequest, res) => {
  try {
    const kbs = await kbService.getWorkspaceKnowledgeBases(req.params.workspaceId);
    res.json(kbs);
  } catch (error) {
    console.error("Get knowledge bases error:", error);
    res.status(500).json({ error: "Failed to fetch knowledge bases" });
  }
});

// Get knowledge base
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const kb = await kbService.getKnowledgeBase(req.params.id, workspaceId);
    res.json(kb);
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get knowledge base error:", error);
    res.status(500).json({ error: "Failed to fetch knowledge base" });
  }
});

// Delete knowledge base
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await kbService.deleteKnowledgeBase(req.params.id, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete knowledge base error:", error);
    res.status(500).json({ error: "Failed to delete knowledge base" });
  }
});

// Create document
router.post("/documents", async (req: AuthRequest, res) => {
  try {
    const data = createDocumentSchema.parse(req.body);
    // @ts-ignore
    const document = await kbService.createDocument(data);
    res.status(201).json(document);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create document error:", error);
    res.status(500).json({ error: "Failed to create document" });
  }
});

// Get document
router.get("/documents/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const document = await kbService.getDocument(req.params.id, workspaceId);
    res.json(document);
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get document error:", error);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// Delete document
router.delete("/documents/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await kbService.deleteDocument(req.params.id, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete document error:", error);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// Search knowledge base
router.post("/:id/search", async (req: AuthRequest, res) => {
  try {
    const { query, limit } = req.body;
    if (!query) {
      return res.status(400).json({ error: "query required" });
    }
    const results = await kbService.searchKnowledgeBase(req.params.id, query, limit);
    res.json(results);
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Search knowledge base error:", error);
    res.status(500).json({ error: "Failed to search knowledge base" });
  }
});

export default router;
