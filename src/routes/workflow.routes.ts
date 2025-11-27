import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import * as workflowService from "../services/workflow.service";
import { WorkflowError } from "../services/workflow.service";
import { z } from "zod";

const router = Router();

// All routes require authentication
router.use(requireAuth);

const createWorkflowSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

// Create workflow
router.post("/", async (req: AuthRequest, res) => {
  try {
    const data = createWorkflowSchema.parse(req.body);
    // @ts-ignore
    const workflow = await workflowService.createWorkflow(data);
    res.status(201).json(workflow);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create workflow error:", error);
    res.status(500).json({ error: "Failed to create workflow" });
  }
});

// Get workspace workflows
router.get("/workspace/:workspaceId", async (req: AuthRequest, res) => {
  try {
    const workflows = await workflowService.getWorkspaceWorkflows(req.params.workspaceId);
    res.json(workflows);
  } catch (error) {
    console.error("Get workflows error:", error);
    res.status(500).json({ error: "Failed to fetch workflows" });
  }
});

// Get workflow
router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const workflow = await workflowService.getWorkflow(req.params.id, workspaceId);
    res.json(workflow);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get workflow error:", error);
    res.status(500).json({ error: "Failed to fetch workflow" });
  }
});

// Update workflow
router.patch("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, ...data } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    const workflow = await workflowService.updateWorkflow(req.params.id, workspaceId, data);
    res.json(workflow);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update workflow error:", error);
    res.status(500).json({ error: "Failed to update workflow" });
  }
});

// Delete workflow
router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await workflowService.deleteWorkflow(req.params.id, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete workflow error:", error);
    res.status(500).json({ error: "Failed to delete workflow" });
  }
});

// Toggle workflow status
router.post("/:id/toggle", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, isActive } = req.body;
    if (!workspaceId || typeof isActive !== "boolean") {
      return res.status(400).json({ error: "workspaceId and isActive required" });
    }
    const workflow = await workflowService.toggleWorkflowStatus(req.params.id, workspaceId, isActive);
    res.json(workflow);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Toggle workflow error:", error);
    res.status(500).json({ error: "Failed to toggle workflow status" });
  }
});

// Create node
router.post("/:workflowId/nodes", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, ...data } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    const node = await workflowService.createNode(
      { ...data, workflowId: req.params.workflowId },
      workspaceId
    );
    res.status(201).json(node);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create node error:", error);
    res.status(500).json({ error: "Failed to create node" });
  }
});

// Update node
router.patch("/nodes/:nodeId", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, ...data } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    const node = await workflowService.updateNode(req.params.nodeId, workspaceId, data);
    res.json(node);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update node error:", error);
    res.status(500).json({ error: "Failed to update node" });
  }
});

// Delete ALL nodes of a workflow
router.delete("/:workflowId/nodes", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    
    // Delete all nodes (and edges via cascade)
    const result = await workflowService.deleteAllWorkflowNodes(req.params.workflowId, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete all workflow nodes error:", error);
    res.status(500).json({ error: "Failed to delete workflow nodes" });
  }
});

// Delete node
router.delete("/nodes/:nodeId", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await workflowService.deleteNode(req.params.nodeId, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete node error:", error);
    res.status(500).json({ error: "Failed to delete node" });
  }
});

// Batch save nodes and edges (atomic operation)
router.post("/:workflowId/batch-save", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, nodes, edges, startNodeIds } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    if (!Array.isArray(nodes)) {
      return res.status(400).json({ error: "nodes array required" });
    }
    if (!Array.isArray(edges)) {
      return res.status(400).json({ error: "edges array required" });
    }

    console.log('[BATCH SAVE] Request:', {
      workflowId: req.params.workflowId,
      workspaceId,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      startNodeCount: startNodeIds?.length || 0,
    });

    const result = await workflowService.batchCreateNodesAndEdges(
      req.params.workflowId,
      workspaceId,
      nodes,
      edges,
      startNodeIds
    );

    console.log('[BATCH SAVE] Success:', {
      nodesCreated: result.nodes.length,
      edgesCreated: result.edges.length,
    });

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof WorkflowError) {
      console.error('[BATCH SAVE] WorkflowError:', error.message);
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[BATCH SAVE] Unexpected error:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    res.status(500).json({ 
      error: "Failed to batch save workflow",
      details: error?.message,
    });
  }
});

// Create edge
router.post("/:workflowId/edges", async (req: AuthRequest, res) => {
  try {
    const { workspaceId, ...data } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    
    // Log incoming edge data for debugging
    console.log('[CREATE EDGE] Request:', {
      workflowId: req.params.workflowId,
      workspaceId,
      data,
    });
    
    const edge = await workflowService.createEdge(
      { ...data, workflowId: req.params.workflowId },
      workspaceId
    );
    
    console.log('[CREATE EDGE] Success:', edge.id);
    res.status(201).json(edge);
  } catch (error: any) {
    if (error instanceof WorkflowError) {
      console.error('[CREATE EDGE] WorkflowError:', error.message);
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('[CREATE EDGE] Unexpected error:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    res.status(500).json({ 
      error: "Failed to create edge",
      details: error?.message,
    });
  }
});

// Delete edge
router.delete("/edges/:edgeId", async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await workflowService.deleteEdge(req.params.edgeId, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete edge error:", error);
    res.status(500).json({ error: "Failed to delete edge" });
  }
});

// Execute workflow
router.post("/:id/execute", async (req: AuthRequest, res) => {
  try {
    const { conversationId, initialData } = req.body;
    const execution = await workflowService.executeWorkflow(
      req.params.id,
      conversationId,
      initialData
    );
    res.json(execution);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Execute workflow error:", error);
    res.status(500).json({ error: "Failed to execute workflow" });
  }
});

export default router;
