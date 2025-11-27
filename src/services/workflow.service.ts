import { prisma } from "../lib/prisma";
import { NodeType, ExecutionStatus } from "@prisma/client";
import * as chatService from "./chat.service";
import OpenAI from "openai";
import logger from '../lib/logger';
import { WorkflowExecutionContext, NodeExecutionResult, BaseNodeConfig } from "./workflow.types";
import { WorkflowLogger } from "./workflow.logger";
import * as executors from "./workflow.executors";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CreateWorkflowInput {
  workspaceId: string;
  name: string;
  description?: string;
}

export async function createWorkflow(input: CreateWorkflowInput) {
  return prisma.workflow.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
    },
  });
}

export async function getWorkflow(workflowId: string, workspaceId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      workspaceId,
      deletedAt: null,
    },
    include: {
      nodes: {
        orderBy: { createdAt: "asc" },
      },
      edges: true,
    },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  return workflow;
}

export async function getWorkspaceWorkflows(workspaceId: string) {
  return prisma.workflow.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    include: {
      _count: {
        select: {
          nodes: true,
          edges: true,
          executions: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateWorkflow(
  workflowId: string,
  workspaceId: string,
  data: Partial<CreateWorkflowInput>
) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId, deletedAt: null },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  return prisma.workflow.update({
    where: { id: workflowId },
    data,
  });
}

export async function deleteWorkflow(workflowId: string, workspaceId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId, deletedAt: null },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  const agentsUsingWorkflow = await prisma.agent.count({
    where: {
      workflowId,
      deletedAt: null,
    },
  });

  if (agentsUsingWorkflow > 0) {
    throw new WorkflowError(
      `Cannot delete workflow. ${agentsUsingWorkflow} agent(s) are using it.`,
      400
    );
  }

  await prisma.workflow.update({
    where: { id: workflowId },
    data: { deletedAt: new Date() },
  });

  return { success: true };
}

export async function toggleWorkflowStatus(
  workflowId: string,
  workspaceId: string,
  isActive: boolean
) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId, deletedAt: null },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  return prisma.workflow.update({
    where: { id: workflowId },
    data: { isActive },
  });
}

interface CreateNodeInput {
  workflowId: string;
  nodeId: string;
  type: NodeType;
  label: string;
  config: any;
  positionX: number;
  positionY: number;
}

export async function createNode(input: CreateNodeInput, workspaceId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: input.workflowId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  return prisma.workflowNode.create({
    data: {
      workflowId: input.workflowId,
      nodeId: input.nodeId,
      type: input.type,
      label: input.label,
      config: input.config,
      positionX: input.positionX,
      positionY: input.positionY,
    },
  });
}

export async function updateNode(
  nodeId: string,
  workspaceId: string,
  data: Partial<CreateNodeInput>
) {
  const node = await prisma.workflowNode.findFirst({
    where: {
      id: nodeId,
      workflow: {
        workspaceId,
      },
    },
  });

  if (!node) {
    throw new WorkflowError("Node not found", 404);
  }

  return prisma.workflowNode.update({
    where: { id: nodeId },
    data,
  });
}

export async function deleteAllWorkflowNodes(workflowId: string, workspaceId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId, deletedAt: null },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const deletedEdges = await tx.workflowEdge.deleteMany({
        where: { workflowId },
      });
      logger.info('Deleted workflow edges', { workflowId, count: deletedEdges.count });

      const deletedNodes = await tx.workflowNode.deleteMany({
        where: { workflowId },
      });
      logger.info('Deleted workflow nodes', { workflowId, count: deletedNodes.count });

      return { success: true, deletedNodes: deletedNodes.count, deletedEdges: deletedEdges.count };
    });
  } catch (error: any) {
    logger.error('Failed to delete all workflow nodes', {
      workflowId,
      workspaceId,
      error: error?.message,
      stack: error?.stack,
    });
    throw new WorkflowError(`Failed to delete workflow nodes: ${error?.message}`, 500);
  }
}

export async function deleteNode(nodeId: string, workspaceId: string) {
  const node = await prisma.workflowNode.findFirst({
    where: {
      id: nodeId,
      workflow: {
        workspaceId,
      },
    },
  });

  if (!node) {
    throw new WorkflowError("Node not found", 404);
  }

  await prisma.workflowEdge.deleteMany({
    where: {
      OR: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
    },
  });

  await prisma.workflowNode.delete({
    where: { id: nodeId },
  });

  return { success: true };
}

interface CreateEdgeInput {
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition?: any;
  label?: string;
}

export async function createEdge(input: CreateEdgeInput, workspaceId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: input.workflowId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!workflow) {
    logger.error('Workflow not found when creating edge', { workflowId: input.workflowId, workspaceId });
    throw new WorkflowError("Workflow not found", 404);
  }

  const [sourceNode, targetNode] = await Promise.all([
    prisma.workflowNode.findFirst({
      where: {
        id: input.sourceNodeId,
        workflowId: input.workflowId,
      },
    }),
    prisma.workflowNode.findFirst({
      where: {
        id: input.targetNodeId,
        workflowId: input.workflowId,
      },
    }),
  ]);

  if (!sourceNode) {
    logger.error('Source node not found when creating edge', {
      workflowId: input.workflowId,
      sourceNodeId: input.sourceNodeId,
      requestedBy: workspaceId,
    });
    throw new WorkflowError(
      `Source node ${input.sourceNodeId} not found in workflow ${input.workflowId}`,
      404
    );
  }

  if (!targetNode) {
    logger.error('Target node not found when creating edge', {
      workflowId: input.workflowId,
      targetNodeId: input.targetNodeId,
      requestedBy: workspaceId,
    });
    throw new WorkflowError(
      `Target node ${input.targetNodeId} not found in workflow ${input.workflowId}`,
      404
    );
  }

  const existingEdge = await prisma.workflowEdge.findFirst({
    where: {
      workflowId: input.workflowId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
    },
  });

  if (existingEdge) {
    logger.warn('Edge already exists, returning existing edge', {
      edgeId: existingEdge.id,
      workflowId: input.workflowId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
    });
    return existingEdge;
  }

  try {
    logger.info('Creating workflow edge', {
      workflowId: input.workflowId,
      sourceNode: { id: sourceNode.id, nodeId: sourceNode.nodeId, label: sourceNode.label },
      targetNode: { id: targetNode.id, nodeId: targetNode.nodeId, label: targetNode.label },
      condition: input.condition,
      label: input.label,
    });

    const edge = await prisma.workflowEdge.create({
      data: {
        workflowId: input.workflowId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        condition: input.condition || null,
        label: input.label || null,
      },
    });

    logger.info('Successfully created workflow edge', {
      edgeId: edge.id,
      workflowId: input.workflowId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
    });

    return edge;
  } catch (error: any) {
    logger.error('Failed to create edge - database error', {
      workflowId: input.workflowId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      errorName: error?.name,
      errorMessage: error?.message,
      errorCode: error?.code,
      errorMeta: error?.meta,
      stack: error?.stack,
    });
    throw new WorkflowError(
      `Failed to create edge: ${error?.message || 'Unknown database error'}`,
      500
    );
  }
}

export async function batchCreateNodesAndEdges(
  workflowId: string,
  workspaceId: string,
  nodes: CreateNodeInput[],
  edges: CreateEdgeInput[],
  startNodeIds?: string[] 
) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId, deletedAt: null },
  });

  if (!workflow) {
    throw new WorkflowError("Workflow not found", 404);
  }

  logger.info('Starting batch create nodes and edges', {
    workflowId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const deletedEdges = await tx.workflowEdge.deleteMany({
        where: { workflowId },
      });
      logger.info('Cleaned up old edges', { count: deletedEdges.count });

      const deletedNodes = await tx.workflowNode.deleteMany({
        where: { workflowId },
      });
      logger.info('Cleaned up old nodes', { count: deletedNodes.count });

      const createdNodes: any[] = [];
      const reactFlowIdToDbId = new Map<string, string>();

      for (const nodeInput of nodes) {
        const node = await tx.workflowNode.create({
          data: {
            workflowId: nodeInput.workflowId,
            nodeId: nodeInput.nodeId,
            type: nodeInput.type,
            label: nodeInput.label,
            config: nodeInput.config,
            positionX: nodeInput.positionX,
            positionY: nodeInput.positionY,
          },
        });
        createdNodes.push(node);
        
        const reactFlowId = (nodeInput as any)._reactFlowId;
        if (reactFlowId) {
          reactFlowIdToDbId.set(reactFlowId, node.id);
        }
        
        logger.info('Created node', { 
          nodeId: node.nodeId, 
          dbId: node.id, 
          label: node.label,
          reactFlowId 
        });
      }

      logger.info('ReactFlow ID to DB ID mapping built', { 
        mappingSize: reactFlowIdToDbId.size,
        mapping: Array.from(reactFlowIdToDbId.entries()) 
      });

      const createdEdges: any[] = [];
      for (const edgeInput of edges) {
        const sourceReactFlowId = (edgeInput as any)._sourceReactFlowId;
        const targetReactFlowId = (edgeInput as any)._targetReactFlowId;
        
        if (!sourceReactFlowId || !targetReactFlowId) {
          logger.warn('Edge missing ReactFlow IDs', { edgeInput });
          continue;
        }
        
        const sourceDbId = reactFlowIdToDbId.get(sourceReactFlowId);
        const targetDbId = reactFlowIdToDbId.get(targetReactFlowId);

        if (!sourceDbId) {
          logger.warn('Skipping edge - source node not found in mapping', {
            sourceReactFlowId,
            targetReactFlowId,
          });
          continue;
        }

        if (!targetDbId) {
          logger.warn('Skipping edge - target node not found in mapping', {
            sourceReactFlowId,
            targetReactFlowId,
          });
          continue;
        }

        logger.info('Creating edge', {
          sourceReactFlowId,
          targetReactFlowId,
          sourceDbId,
          targetDbId,
        });

        const edge = await tx.workflowEdge.create({
          data: {
            workflowId: edgeInput.workflowId,
            sourceNodeId: sourceDbId,
            targetNodeId: targetDbId,
            condition: edgeInput.condition || null,
            label: edgeInput.label || null,
          },
        });
        createdEdges.push(edge);
        logger.info('Created edge', {
          edgeId: edge.id,
          source: sourceDbId,
          target: targetDbId,
        });
      }

      let startNodeDbIds: string[] = [];
      if (startNodeIds && startNodeIds.length > 0) {
        startNodeDbIds = startNodeIds
          .map(reactFlowId => reactFlowIdToDbId.get(reactFlowId))
          .filter(dbId => dbId !== undefined) as string[];
        
        logger.info('Mapping START nodes', {
          startNodeReactFlowIds: startNodeIds,
          startNodeDbIds,
        });
        
        await tx.workflow.update({
          where: { id: workflowId },
          data: {
            startNodeIds: startNodeDbIds,
          },
        });
        
        logger.info('Updated workflow with start nodes', {
          workflowId,
          startNodeIds: startNodeDbIds,
        });
      }

      logger.info('Batch create completed successfully', {
        nodesCreated: createdNodes.length,
        edgesCreated: createdEdges.length,
        startNodesConfigured: startNodeDbIds.length,
      });

      return {
        success: true,
        nodes: createdNodes,
        edges: createdEdges,
        startNodeIds: startNodeDbIds,
      };
    }, {
      maxWait: 10000, // 10 seconds
      timeout: 30000, // 30 seconds
    });
  } catch (error: any) {
    logger.error('Batch create failed', {
      workflowId,
      error: error?.message,
      stack: error?.stack,
    });
    throw new WorkflowError(`Failed to save workflow: ${error?.message}`, 500);
  }
}

export async function deleteEdge(edgeId: string, workspaceId: string) {
  const edge = await prisma.workflowEdge.findFirst({
    where: {
      id: edgeId,
      workflow: {
        workspaceId,
      },
    },
  });

  if (!edge) {
    throw new WorkflowError("Edge not found", 404);
  }

  await prisma.workflowEdge.delete({
    where: { id: edgeId },
  });

  return { success: true };
}

// Workflow Execution Engine
export async function executeWorkflow(
  workflowId: string,
  conversationId?: string,
  initialData?: any
) {
  const startTime = Date.now();
  
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      nodes: true,
      edges: true,
    },
  });

  if (!workflow || !workflow.isActive) {
    throw new WorkflowError("Workflow not found or inactive", 404);
  }

  // Create execution record
  const execution = await prisma.workflowExecution.create({
    data: {
      workflowId,
      conversationId,
      status: "RUNNING",
      executionData: initialData || {},
      logs: [],
    },
  });

  // Initialize execution context
  const context: WorkflowExecutionContext = {
    executionId: execution.id,
    workflowId,
    conversationId,
    variables: {
      ...initialData,
      workflowId,
      executionId: execution.id,
      startTime: new Date().toISOString(),
    },
    metadata: {},
    startedAt: new Date(),
  };

  // Initialize logger
  const workflowLogger = new WorkflowLogger(execution.id);
  await workflowLogger.workflowStart(workflowId, workflow.name, initialData);

  try {
    // Find entry nodes (start nodes or nodes with no incoming edges)
    let entryNodes = workflow.nodes.filter((node) =>
      workflow.startNodeIds && workflow.startNodeIds.length > 0
        ? workflow.startNodeIds.includes(node.id)
        : !workflow.edges.some((edge) => edge.targetNodeId === node.id)
    );

    if (entryNodes.length === 0) {
      throw new WorkflowError("No entry node found in workflow", 400);
    }

    // Execute all entry nodes
    for (const entryNode of entryNodes) {
      await executeNode(
        entryNode.id,
        workflow,
        context,
        workflowLogger
      );
    }

    // Calculate duration
    const duration = Date.now() - startTime;
    await workflowLogger.workflowComplete(duration, context.variables);

    // Mark as completed
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        executionData: context.variables,
      },
    });

    return execution;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    await workflowLogger.workflowFailed(error, duration);

    // Mark as failed
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: "FAILED",
        error: error.message,
        completedAt: new Date(),
        executionData: context.variables,
      },
    });

    throw error;
  }
}

async function executeNode(
  nodeId: string,
  workflow: any,
  context: WorkflowExecutionContext,
  workflowLogger: WorkflowLogger
) {
  const node = workflow.nodes.find((n: any) => n.id === nodeId);

  if (!node) {
    throw new WorkflowError(`Node ${nodeId} not found`, 404);
  }

  const config: BaseNodeConfig = node.config || {};

  // Check conditional execution
  if (config.executeWhen) {
    const condition = config.executeWhen;
    const conditionMet = evaluateCondition(condition, context.variables);
    
    if (!conditionMet) {
      await workflowLogger.info(
        nodeId,
        node.label,
        node.type,
        `Skipped: Condition not met`,
        { condition }
      );
      return;
    }
  }

  // Update current node
  await prisma.workflowExecution.update({
    where: { id: context.executionId },
    data: {
      currentNodeId: nodeId,
    },
  });
  context.currentNodeId = nodeId;

  // Log node start
  await workflowLogger.nodeStart(nodeId, node.label, node.type, config);

  // Execute node with timeout and retry logic
  let nodeResult: NodeExecutionResult;
  let attempts = 0;
  const maxRetries = config.retryOnError ? (config.maxRetries || 3) : 1;

  while (attempts < maxRetries) {
    attempts++;

    try {
      // Execute with timeout if configured
      if (config.timeout) {
        nodeResult = await Promise.race([
          executeNodeByType(node, context),
          new Promise<NodeExecutionResult>((_, reject) =>
            setTimeout(
              () => reject(new WorkflowError(`Node timeout after ${config.timeout}ms`, 408)),
              config.timeout
            )
          ),
        ]);
      } else {
        nodeResult = await executeNodeByType(node, context);
      }

      // Log success
      await workflowLogger.nodeSuccess(
        nodeId,
        node.label,
        node.type,
        nodeResult.data,
        config
      );

      // Save result to variable if configured
      if (config.saveResultAs && nodeResult.data) {
        context.variables[config.saveResultAs] = nodeResult.data;
        await workflowLogger.variableSet(
          nodeId,
          node.label,
          node.type,
          config.saveResultAs,
          nodeResult.data
        );
      }

      // Merge node result data into context variables
      if (nodeResult.data) {
        Object.assign(context.variables, nodeResult.data);
      }

      break; // Success, exit retry loop
    } catch (error: any) {
      const isLastAttempt = attempts >= maxRetries;

      if (isLastAttempt) {
        await workflowLogger.nodeError(nodeId, node.label, node.type, error, config);

        // If continueOnError is set, don't throw
        if (config.continueOnError) {
          await workflowLogger.warn(
            nodeId,
            node.label,
            node.type,
            `Continuing despite error: ${error.message}`,
            { error: error.message }
          );
          nodeResult = {
            success: false,
            error: error.message,
            shouldContinue: true,
          };
          break;
        }

        throw error;
      } else {
        // Retry
        await workflowLogger.warn(
          nodeId,
          node.label,
          node.type,
          `Retry ${attempts}/${maxRetries} after error: ${error.message}`,
          { attempt: attempts, maxRetries }
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
      }
    }
  }

  // Check if we should continue to next nodes
  if (!nodeResult!.shouldContinue) {
    await workflowLogger.info(
      nodeId,
      node.label,
      node.type,
      'Workflow stopped: shouldContinue = false'
    );
    return;
  }

  // Find next nodes
  const outgoingEdges = workflow.edges.filter((e: any) => e.sourceNodeId === nodeId);

  if (outgoingEdges.length === 0) {
    await workflowLogger.debug(
      nodeId,
      node.label,
      node.type,
      'No outgoing edges, node is terminal'
    );
    return;
  }

  // Execute next nodes
  for (const edge of outgoingEdges) {
    // Check edge condition if present
    if (edge.condition) {
      const conditionMet = evaluateCondition(edge.condition, context.variables);
      
      await workflowLogger.conditionEvaluated(
        nodeId,
        node.label,
        node.type,
        conditionMet,
        edge.condition
      );

      if (!conditionMet) {
        await workflowLogger.debug(
          nodeId,
          node.label,
          node.type,
          `Edge to ${edge.targetNodeId} skipped: condition not met`,
          { condition: edge.condition }
        );
        continue;
      }
    }

    // Execute next node
    await executeNode(edge.targetNodeId, workflow, context, workflowLogger);
  }
}

async function executeNodeByType(
  node: any,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const config = node.config;

  switch (node.type) {
    // Triggers
    case "TRIGGER_WAIT":
      return executors.executeTriggerWait(config, context);

    case "TRIGGER_INACTIVITY":
      return executors.executeTriggerInactivity(config, context);

    // Conditions
    case "CONDITION_KEYWORD":
      return executors.executeConditionKeyword(config, context);

    case "CONDITION_SENTIMENT":
      return executors.executeConditionSentiment(config, context);

    case "CONDITION_TIME":
      return executors.executeConditionTime(config, context);

    case "CONDITION_COMPARE":
      return executors.executeConditionCompare(config, context);

    // Actions
    case "ACTION_MESSAGE":
      return executors.executeActionMessage(config, context);

    case "ACTION_EMAIL":
      return executors.executeActionEmail(config, context);

    case "ACTION_API_CALL":
      return executors.executeActionApiCall(config, context);

    case "ACTION_ASSIGN_HUMAN":
      return executors.executeActionAssignHuman(config, context);

    case "ACTION_VARIABLE_SET":
      return executors.executeActionVariableSet(config, context);

    case "ACTION_DELAY":
      return executors.executeActionDelay(config, context);

    // AI
    case "AI_RESPONSE":
      return executors.executeAIResponse(config, context);

    case "AI_SEARCH_KB":
      return executors.executeAISearchKB(config, context);

    case "AI_CLASSIFY_INTENT":
      return executors.executeAIClassifyIntent(config, context);

    case "AI_SUMMARIZE":
      return executors.executeAISummarize(config, context);

    // Flow Control
    case "FLOW_LOOP":
      return executors.executeFlowLoop(config, context);

    // Data
    case "DATA_TRANSFORM":
      return executors.executeDataTransform(config, context);

    case "DATA_VALIDATE":
      return executors.executeDataValidate(config, context);

    default:
      throw new WorkflowError(`Unknown node type: ${node.type}`, 400);
  }
}

// Old executor functions removed - now using executors from workflow.executors.ts

/**
 * Helper function to get nested variable value
 */
function getVariableValue(variables: Record<string, any>, path: string, defaultValue?: any): any {
  const keys = path.split('.');
  let value: any = variables;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return defaultValue;
    }
  }
  
  return value !== undefined ? value : defaultValue;
}

/**
 * Evaluate condition for edge routing or node execution
 */
function evaluateCondition(condition: any, variables: Record<string, any>): boolean {
  if (!condition) return true;

  const { field, operator, value, variable, negate } = condition;
  
  // Support both 'field' (legacy) and 'variable' (new)
  const varName = variable || field;
  if (!varName || !operator) return true;

  const fieldValue = getVariableValue(variables, varName);
  let result = false;

  switch (operator) {
    case "equals":
      result = fieldValue === value;
      break;
    case "notEquals":
      result = fieldValue !== value;
      break;
    case "contains":
      result = String(fieldValue).includes(String(value));
      break;
    case "greaterThan":
      result = Number(fieldValue) > Number(value);
      break;
    case "lessThan":
      result = Number(fieldValue) < Number(value);
      break;
    case "exists":
      result = fieldValue !== undefined && fieldValue !== null;
      break;
    case "matches":
      try {
        const regex = new RegExp(value);
        result = regex.test(String(fieldValue));
      } catch {
        result = false;
      }
      break;
    default:
      result = true;
  }

  // Apply negation if specified
  return negate ? !result : result;
}
