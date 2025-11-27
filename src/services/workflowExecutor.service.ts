import { prisma } from "../lib/prisma";
import { NodeType } from "@prisma/client";
import OpenAI from "openai";
import logger from '../lib/logger';
import { sendWorkflowEmail } from '../lib/email';
import { WorkflowStateManager, ConversationExecutionContext } from '../lib/workflowStateManager';
import { RedisLock } from '../lib/redisLock';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class WorkflowExecutorError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "WorkflowExecutorError";
  }
}

/**
 * Initialize workflow for a conversation
 * Called when conversation starts or when workflow is assigned
 */
export async function initializeWorkflowForConversation(
  conversationId: string,
  workflowId: string,
  initialData?: any
) {
  // Check if workflow already running
  const existingContext = await WorkflowStateManager.getContext(conversationId);
  if (existingContext) {
    logger.info('Workflow already running for conversation', { 
      conversationId, 
      workflowId: existingContext.workflowId,
      currentNode: existingContext.currentNodeId,
      waitingForInput: existingContext.waitingForInput,
    });
    return existingContext;
  }
  
  logger.info('Starting workflow initialization', { 
    conversationId, 
    workflowId,
    initialData,
  });

  // Load workflow
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      nodes: true,
      edges: true,
    },
  });

  if (!workflow) {
    logger.error('Workflow not found or inactive', { workflowId, conversationId });
    throw new WorkflowExecutorError("Workflow not found or inactive", 404);
  }
  
  logger.info('Workflow loaded', {
    conversationId,
    workflowId,
    workflowName: workflow.name,
    nodeCount: workflow.nodes.length,
    edgeCount: workflow.edges.length,
    isActive: workflow.isActive,
  });

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
  
  logger.info('Workflow execution record created', {
    conversationId,
    executionId: execution.id,
  });

  // Find entry node
  const entryNode = workflow.nodes.find(
    (node) => !workflow.edges.some((edge) => edge.targetNodeId === node.id)
  );

  if (!entryNode) {
    logger.error('No entry node found in workflow', {
      conversationId,
      workflowId,
      nodeIds: workflow.nodes.map((n: any) => n.id),
    });
    throw new WorkflowExecutorError("No entry node found in workflow", 400);
  }
  
  logger.info('Entry node found', {
    conversationId,
    entryNodeId: entryNode.id,
    entryNodeLabel: entryNode.label,
    entryNodeType: entryNode.type,
  });

  // Initialize context
  const context: ConversationExecutionContext = {
    conversationId,
    workflowId,
    executionId: execution.id,
    currentNodeId: entryNode.id,
    variables: initialData || {},
    waitingForInput: false,
    workflow,
  };
  
  logger.info('Context initialized', {
    conversationId,
    executionId: execution.id,
    entryNodeId: entryNode.id,
  });

  // Save to Redis
  try {
    await WorkflowStateManager.saveContext(context);
    logger.info('Context saved to Redis', {
      conversationId,
      executionId: execution.id,
    });
  } catch (error: any) {
    logger.error('Failed to save context to Redis', {
      conversationId,
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }

  // Start execution (non-blocking)
  logger.info('Starting workflow execution (non-blocking)', {
    conversationId,
    executionId: execution.id,
  });
  
  processNextNode(context).catch((error) => {
    logger.error('Workflow execution error', { 
      conversationId, 
      executionId: execution.id,
      error: error?.message,
      stack: error?.stack,
    });
    markExecutionFailed(context.executionId, error.message);
  });

  logger.info('Workflow initialization complete', {
    conversationId,
    executionId: execution.id,
  });

  return execution;
}

/**
 * Handle incoming user message in workflow context
 * Called from chat.service when user sends message
 */
export async function handleMessageInWorkflow(
  conversationId: string,
  message: string,
  messageMetadata?: any
) {
  logger.info('handleMessageInWorkflow called', {
    conversationId,
    messageLength: message.length,
    hasMetadata: !!messageMetadata,
  });
  
  // Use distributed lock to prevent race conditions
  return await RedisLock.withLock(
    `workflow:exec:${conversationId}`,
    async () => {
      const context = await WorkflowStateManager.getContext(conversationId);

      if (!context) {
        logger.info('No workflow context found for conversation', { conversationId });
        return null;
      }
      
      logger.info('Workflow context found', {
        conversationId,
        workflowId: context.workflowId,
        currentNodeId: context.currentNodeId,
        waitingForInput: context.waitingForInput,
      });

  if (!context.waitingForInput) {
    logger.info('Workflow not waiting for input, ignoring message', { conversationId });
    return null;
  }

  // Add message to variables
  context.variables.lastUserMessage = message;
  context.variables.lastMessageMetadata = messageMetadata;

  // Validate input if needed
  if (context.expectedInputValidation) {
    const validation = await validateInput(message, context.expectedInputValidation);
    
    if (!validation.valid) {
      // Return validation error to user
      return {
        shouldRespond: true,
        response: validation.errorMessage || "Invalid input. Please try again.",
        continueWorkflow: false,
      };
    }

    context.variables.validatedInput = validation.extractedData;
  }

  // Clear waiting state
  context.waitingForInput = false;
  context.expectedInputType = undefined;
  context.expectedInputValidation = undefined;

  // Save updated context
  await WorkflowStateManager.saveContext(context);

  // Continue workflow (non-blocking)
  processNextNode(context).catch((error) => {
    logger.error('Workflow processing error', { conversationId, error: error.message });
    markExecutionFailed(context.executionId, error.message);
  });

      return {
        shouldRespond: false, // Workflow will send response
        continueWorkflow: true,
      };
    },
    { ttl: 30, retries: 5, waitMs: 200 }
  );
}

/**
 * Process next node in workflow
 * Runs asynchronously per conversation
 */
async function processNextNode(context: ConversationExecutionContext): Promise<void> {
  const { workflow, currentNodeId } = context;

  if (!currentNodeId) {
    // Workflow completed
    await markExecutionCompleted(context.executionId);
    await WorkflowStateManager.deleteContext(context.conversationId);
    return;
  }

  const node = workflow.nodes.find((n: any) => n.id === currentNodeId);

  if (!node) {
    throw new WorkflowExecutorError(`Node ${currentNodeId} not found`, 404);
  }

  // Log node execution
  await addExecutionLog(context.executionId, `Executing: ${node.label} (${node.type})`);

  try {
    // Execute node
    const result = await executeNode(node, context);

    // Merge result into variables
    if (result) {
      context.variables = { ...context.variables, ...result };
    }

    // Check if waiting for input
    if (context.waitingForInput) {
      // Stop execution, wait for user message
      await addExecutionLog(context.executionId, "Waiting for user input");
      // Save state before pausing
      await WorkflowStateManager.saveContext(context);
      return;
    }

    // Find next node
    const nextNodeId = await findNextNode(node, context);

    if (!nextNodeId) {
      // End of workflow
      await markExecutionCompleted(context.executionId);
      await WorkflowStateManager.deleteContext(context.conversationId);
      return;
    }

    // Update current node
    context.currentNodeId = nextNodeId;
    
    // Save progress
    await WorkflowStateManager.saveContext(context);

    // Continue to next node
    await processNextNode(context);
  } catch (error: any) {
    await addExecutionLog(context.executionId, `Error: ${error.message}`);
    throw error;
  }
}

/**
 * Execute individual node based on type
 */
async function executeNode(node: any, context: ConversationExecutionContext): Promise<any> {
  const { config } = node;
  const { conversationId, variables } = context;
  
  logger.info('Executing node', {
    conversationId,
    nodeId: node.id,
    nodeLabel: node.label,
    nodeType: node.type,
    config,
    variables,
  });

  switch (node.type) {
    // ============ TRIGGERS ============
    case "TRIGGER_WAIT":
      // Wait/Delay for a specific duration
      return await executeTriggerWait(config, context);

    case "TRIGGER_MESSAGE":
      // Detect if user message matches pattern
      return executeTriggerMessage(config, variables);

    case "TRIGGER_INTENT":
      // Classify user intent with AI
      return await executeTriggerIntent(config, variables);

    case "TRIGGER_USER_INPUT":
      // Wait for user input (marks context as waiting)
      return await executeTriggerUserInput(config, context);

    // ============ CONDITIONS ============
    case "CONDITION_KEYWORD":
      return executeConditionKeyword(config, variables);

    case "CONDITION_REGEX":
      return executeConditionRegex(config, variables);

    case "CONDITION_EQUALS":
      return executeConditionEquals(config, variables);

    case "CONDITION_CONTAINS":
      return executeConditionContains(config, variables);

    case "CONDITION_VARIABLE":
      return executeConditionVariable(config, variables);

    case "CONDITION_SENTIMENT":
      return await executeConditionSentiment(config, variables);

    case "CONDITION_TIME":
      return executeConditionTime(config);

    // ============ ACTIONS ============
    case "ACTION_MESSAGE":
      return await executeActionMessage(config, conversationId, variables, context);

    case "ACTION_WAIT_FOR_INPUT":
      return await executeActionWaitForInput(config, context);

    case "ACTION_VALIDATE_INPUT":
      return await executeActionValidateInput(config, variables);

    case "ACTION_SET_VARIABLE":
      return executeActionSetVariable(config, variables);

    case "ACTION_API_CALL":
      return await executeActionApiCall(config, variables);

    case "ACTION_EMAIL":
      return await executeActionEmail(config, variables);

    case "ACTION_ASSIGN_HUMAN":
      return await executeActionAssignHuman(config, conversationId);

    case "ACTION_END_CONVERSATION":
      return await executeActionEndConversation(conversationId);

    // ============ AI ACTIONS ============
    case "AI_RESPONSE":
      return await executeAIResponse(config, conversationId, variables);

    case "AI_SEARCH_KB":
      return await executeAISearchKB(config, variables);

    case "AI_CLASSIFY_INTENT":
      return await executeAIClassifyIntent(config, variables);

    case "AI_EXTRACT_INFO":
      return await executeAIExtractInfo(config, variables);

    case "AI_VALIDATE_FORMAT":
      return await executeAIValidateFormat(config, variables);

    default:
      logger.warn('Unknown node type', { nodeType: node.type, nodeId: node.id });
      return {};
  }
}

/**
 * Find next node based on edges and conditions
 */
async function findNextNode(currentNode: any, context: ConversationExecutionContext): Promise<string | null> {
  const { workflow, variables } = context;

  // Find outgoing edges from current node
  const outgoingEdges = workflow.edges.filter((e: any) => e.sourceNodeId === currentNode.id);

  logger.info('Finding next node', {
    conversationId: context.conversationId,
    currentNodeId: currentNode.id,
    currentNodeLabel: currentNode.label,
    outgoingEdgesCount: outgoingEdges.length,
    variables,
  });

  if (outgoingEdges.length === 0) {
    logger.info('No outgoing edges, ending workflow', {
      conversationId: context.conversationId,
      currentNodeId: currentNode.id,
    });
    return null;
  }

  // Evaluate conditions
  for (const edge of outgoingEdges) {
    if (edge.condition) {
      logger.info('Evaluating edge condition', {
        conversationId: context.conversationId,
        edgeId: edge.id,
        condition: edge.condition,
        variables,
      });
      
      const conditionMet = evaluateCondition(edge.condition, variables);
      
      logger.info('Edge condition evaluated', {
        conversationId: context.conversationId,
        edgeId: edge.id,
        conditionMet,
        condition: edge.condition,
        targetNodeId: edge.targetNodeId,
      });
      
      if (conditionMet) {
        const targetNode = workflow.nodes.find((n: any) => n.id === edge.targetNodeId);
        logger.info('Taking edge to next node', {
          conversationId: context.conversationId,
          targetNodeId: edge.targetNodeId,
          targetNodeLabel: targetNode?.label,
        });
        return edge.targetNodeId;
      }
    } else {
      logger.info('Edge has no condition, taking it', {
        conversationId: context.conversationId,
        edgeId: edge.id,
        targetNodeId: edge.targetNodeId,
      });
      return edge.targetNodeId;
    }
  }

  logger.warn('No edge condition met, ending workflow', {
    conversationId: context.conversationId,
    currentNodeId: currentNode.id,
    edgeCount: outgoingEdges.length,
  });
  
  return null;
}

/**
 * Evaluate edge conditions
 */
function evaluateCondition(condition: any, variables: Record<string, any>): boolean {
  const { field, operator, value } = condition;

  if (!field || !operator) return true;

  const fieldValue = variables[field];

  switch (operator) {
    case "equals":
      return fieldValue === value;
    case "notEquals":
      return fieldValue !== value;
    case "contains":
      return String(fieldValue).includes(value);
    case "notContains":
      return !String(fieldValue).includes(value);
    case "greaterThan":
      return Number(fieldValue) > Number(value);
    case "lessThan":
      return Number(fieldValue) < Number(value);
    case "exists":
      return fieldValue !== undefined && fieldValue !== null;
    case "notExists":
      return fieldValue === undefined || fieldValue === null;
    default:
      return true;
  }
}

// ============================================
// NODE EXECUTORS
// ============================================

async function executeTriggerWait(config: any, context: ConversationExecutionContext) {
  const duration = config.duration || 1000; // milliseconds, default 1 second
  const message = config.message; // Optional message to show user
  
  logger.info('Executing TRIGGER_WAIT', {
    conversationId: context.conversationId,
    duration,
    hasMessage: !!message,
  });
  
  // Send optional message to user
  if (message) {
    const interpolatedMessage = interpolateVariables(message, context.variables);
    await sendMessageToUser(context.conversationId, interpolatedMessage);
  }
  
  // Wait for the specified duration
  await new Promise(resolve => setTimeout(resolve, duration));
  
  logger.info('TRIGGER_WAIT completed', {
    conversationId: context.conversationId,
    duration,
  });
  
  return { waitCompleted: true, waitedMs: duration };
}

function executeTriggerMessage(config: any, variables: Record<string, any>) {
  const message = variables.lastUserMessage || "";
  const patterns = config.patterns || [];

  for (const pattern of patterns) {
    if (message.toLowerCase().includes(pattern.toLowerCase())) {
      return { triggerMatched: true, matchedPattern: pattern };
    }
  }

  return { triggerMatched: false };
}

async function executeTriggerIntent(config: any, variables: Record<string, any>) {
  const message = variables.lastUserMessage || "";
  const expectedIntents = config.intents || [];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Classify the user's intent. Possible intents: ${expectedIntents.join(", ")}. Respond with only the intent name.`,
      },
      { role: "user", content: message },
    ],
    temperature: 0,
  });

  const detectedIntent = response.choices[0].message.content?.trim() || "";

  return {
    intent: detectedIntent,
    triggerMatched: expectedIntents.includes(detectedIntent),
  };
}

async function executeTriggerUserInput(config: any, context: ConversationExecutionContext) {
  // Mark context as waiting for input
  context.waitingForInput = true;

  // Optionally send prompt
  if (config.prompt) {
    await sendMessageToUser(context.conversationId, config.prompt);
  }

  return { waitingForInput: true };
}

function executeConditionKeyword(config: any, variables: Record<string, any>) {
  const text = variables.lastUserMessage || "";
  const keywords = config.keywords || [];
  const caseSensitive = config.caseSensitive || false;

  const matched = keywords.some((keyword: string) =>
    caseSensitive ? text.includes(keyword) : text.toLowerCase().includes(keyword.toLowerCase())
  );

  return { conditionMet: matched };
}

function executeConditionRegex(config: any, variables: Record<string, any>) {
  const text = variables.lastUserMessage || "";
  const pattern = config.pattern || "";
  
  // CRITICAL: Prevent ReDoS attacks
  if (pattern.length > 500) {
    logger.error('Regex pattern too long', { patternPreview: pattern.substring(0, 50) });
    return { conditionMet: false };
  }

  try {
    const regex = new RegExp(pattern, config.flags || "i");
    
    // Monitor regex execution time
    const startTime = Date.now();
    const match = regex.test(text);
    const executionTime = Date.now() - startTime;
    
    // Warn if regex takes too long (potential ReDoS)
    if (executionTime > 100) {
      logger.warn('Regex execution slow - potential ReDoS', { 
        executionTime, 
        patternPreview: pattern.substring(0, 50) 
      });
    }
    
    return { conditionMet: match };
  } catch (error) {
    logger.error('Invalid regex pattern', { pattern, error });
    return { conditionMet: false };
  }
}

function executeConditionEquals(config: any, variables: Record<string, any>) {
  const field = config.field || "lastUserMessage";
  const expectedValue = config.value || "";
  const fieldValue = variables[field];
  const caseSensitive = config.caseSensitive === true; // Default: case-INsensitive for better UX
  
  logger.info('Executing CONDITION_EQUALS', {
    field,
    expectedValue,
    fieldValue,
    caseSensitive,
    allVariables: variables,
  });
  
  let conditionMet = false;
  
  if (caseSensitive) {
    // Trim whitespace but keep case
    conditionMet = String(fieldValue || "").trim() === String(expectedValue).trim();
  } else {
    // Case-insensitive and trim whitespace
    conditionMet = String(fieldValue || "").trim().toLowerCase() === String(expectedValue).trim().toLowerCase();
  }
  
  logger.info('CONDITION_EQUALS result', {
    conditionMet,
    field,
    expectedValue,
    fieldValue,
    comparison: `"${String(fieldValue || "").trim()}" vs "${String(expectedValue).trim()}"`,
  });

  return { conditionMet };
}

function executeConditionContains(config: any, variables: Record<string, any>) {
  const field = config.field || "lastUserMessage";
  const value = config.value || "";
  const fieldValue = String(variables[field] || "");

  return { conditionMet: fieldValue.includes(value) };
}

function executeConditionVariable(config: any, variables: Record<string, any>) {
  const variableName = config.variable || "";
  const exists = variables[variableName] !== undefined && variables[variableName] !== null;

  return { conditionMet: exists };
}

async function executeConditionSentiment(config: any, variables: Record<string, any>) {
  const text = variables.lastUserMessage || "";
  const expectedSentiment = config.sentiment || "positive";

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: 'Analyze sentiment. Respond with only: "positive", "negative", or "neutral"',
      },
      { role: "user", content: text },
    ],
    temperature: 0,
  });

  const sentiment = response.choices[0].message.content?.toLowerCase() || "neutral";

  return {
    sentiment,
    conditionMet: sentiment === expectedSentiment,
  };
}

function executeConditionTime(config: any) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  const startHour = config.startHour || 9;
  const endHour = config.endHour || 17;
  const workDays = config.workDays || [1, 2, 3, 4, 5];

  const isBusinessHours = hour >= startHour && hour < endHour && workDays.includes(day);

  return { isBusinessHours, conditionMet: isBusinessHours };
}

async function executeActionMessage(
  config: any, 
  conversationId: string, 
  variables: Record<string, any>,
  context?: ConversationExecutionContext
) {
  let message = config.message || "";

  // Replace variables {{variableName}}
  message = interpolateVariables(message, variables);

  await sendMessageToUser(conversationId, message);
  
  logger.info('ACTION_MESSAGE sent', {
    conversationId,
    message: message.substring(0, 100),
    config,
  });
  
  // Check if we should wait for user response
  // If waitForResponse is explicitly set, use that
  // Otherwise, check if the next node is a condition (auto-detect)
  const shouldWait = config.waitForResponse === true || 
    (config.waitForResponse !== false && context && isNextNodeCondition(context));
  
  if (shouldWait && context) {
    logger.info('ACTION_MESSAGE waiting for user response', {
      conversationId,
      explicitWait: config.waitForResponse === true,
      autoDetected: isNextNodeCondition(context),
    });
    
    context.waitingForInput = true;
    return { messageSent: true, waitingForInput: true };
  }

  return { messageSent: true };
}

/**
 * Check if the next node from current node is a condition node
 */
function isNextNodeCondition(context: ConversationExecutionContext): boolean {
  const { workflow, currentNodeId } = context;
  
  // Find the current node
  const currentNode = workflow.nodes.find((n: any) => n.id === currentNodeId);
  if (!currentNode) return false;
  
  // Find outgoing edges
  const outgoingEdges = workflow.edges.filter((e: any) => e.sourceNodeId === currentNode.id);
  if (outgoingEdges.length === 0) return false;
  
  // Check if any of the target nodes are condition nodes
  for (const edge of outgoingEdges) {
    const targetNode = workflow.nodes.find((n: any) => n.id === edge.targetNodeId);
    if (targetNode && targetNode.type.startsWith('CONDITION_')) {
      return true;
    }
  }
  
  return false;
}

async function executeActionWaitForInput(config: any, context: ConversationExecutionContext) {
  context.waitingForInput = true;
  context.expectedInputType = config.inputType || "text";

  if (config.prompt) {
    const prompt = interpolateVariables(config.prompt, context.variables);
    await sendMessageToUser(context.conversationId, prompt);
  }

  return { waitingForInput: true };
}

async function executeActionValidateInput(config: any, variables: Record<string, any>) {
  const input = variables.lastUserMessage || "";
  const validationType = config.validationType || "text";

  let isValid = false;
  let extractedData = input;

  switch (validationType) {
    case "email":
      isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
      break;
    case "phone":
      isValid = /^\+?[\d\s\-()]+$/.test(input);
      break;
    case "number":
      isValid = !isNaN(Number(input));
      extractedData = Number(input);
      break;
    case "regex":
      const regex = new RegExp(config.regexPattern || ".*");
      isValid = regex.test(input);
      break;
    default:
      isValid = input.length > 0;
  }

  return {
    isValid,
    validatedInput: extractedData,
    inputType: validationType,
  };
}

function executeActionSetVariable(config: any, variables: Record<string, any>) {
  const variableName = config.variableName || "customVar";
  const value = config.value || "";

  // Interpolate value if it contains variables
  const interpolatedValue = interpolateVariables(String(value), variables);

  return { [variableName]: interpolatedValue };
}

function validateApiUrl(url: string): void {
  try {
    const parsed = new URL(url);
    
    // Block internal networks
    const blockedHosts = [
      'localhost', '127.0.0.1', '0.0.0.0', '::1'
    ];
    
    if (blockedHosts.includes(parsed.hostname.toLowerCase())) {
      throw new Error('Cannot call localhost or internal addresses');
    }
    
    // Block private IP ranges (SSRF protection)
    if (parsed.hostname.startsWith('192.168.') ||
        parsed.hostname.startsWith('10.') ||
        parsed.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
        parsed.hostname.startsWith('169.254.')) {
      throw new Error('Cannot call private networks');
    }
    
    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP(S) URLs allowed');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cannot')) {
      throw error;
    }
    throw new Error('Invalid URL format');
  }
}

async function executeActionApiCall(config: any, variables: Record<string, any>) {
  const url = interpolateVariables(config.url || "", variables);
  
  // CRITICAL: Validate URL to prevent SSRF attacks
  validateApiUrl(url);
  
  const method = config.method || "GET";
  const headers = config.headers || {};
  const body = config.body ? interpolateVariables(JSON.stringify(config.body), variables) : undefined;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: method !== "GET" && body ? body : undefined,
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(30000), // 30s timeout
    });

    const data = await response.json();

    return {
      apiResponse: data,
      apiStatusCode: response.status,
      apiSuccess: response.ok,
    };
  } catch (error: any) {
    return {
      apiError: error.message,
      apiSuccess: false,
    };
  }
}

async function executeActionEmail(config: any, variables: Record<string, any>) {
  const to = interpolateVariables(config.to || "", variables);
  const subject = interpolateVariables(config.subject || "", variables);
  const body = interpolateVariables(config.body || "", variables);

  try {
    await sendWorkflowEmail(to, subject, body);
    logger.info('Workflow email sent', { to, subject });
    return { emailSent: true };
  } catch (error) {
    logger.error('Workflow email failed', { to, subject, error });
    return { emailSent: false, emailError: 'Failed to send email' };
  }
}

async function executeActionAssignHuman(config: any, conversationId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      assignedToId: config.userId || null,
      status: "WAITING",
    },
  });

  await sendMessageToUser(conversationId, "A human agent will assist you shortly.");

  return { assignedToHuman: true };
}

async function executeActionEndConversation(conversationId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "RESOLVED" },
  });

  return { conversationEnded: true };
}

async function executeAIResponse(config: any, conversationId: string, variables: Record<string, any>) {
  const prompt = interpolateVariables(config.prompt || "Respond to the user", variables);

  const response = await openai.chat.completions.create({
    model: config.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: variables.lastUserMessage || "" },
    ],
    temperature: config.temperature || 0.7,
  });

  const aiMessage = response.choices[0].message.content || "";

  await sendMessageToUser(conversationId, aiMessage);

  return { aiResponse: aiMessage };
}

async function executeAISearchKB(config: any, variables: Record<string, any>) {
  const knowledgeBaseId = config.knowledgeBaseId;
  const query = variables.lastUserMessage || variables.query || "";

  if (!knowledgeBaseId) return { kbResults: [] };

  const { searchKnowledgeBase } = await import("./knowledgeBase.service");
  const results = await searchKnowledgeBase(knowledgeBaseId, query, config.limit || 3);

  return {
    kbResults: results,
    kbContext: results.map((r) => r.content).join("\n\n"),
  };
}

async function executeAIClassifyIntent(config: any, variables: Record<string, any>) {
  const text = variables.lastUserMessage || "";
  const intents = config.intents || ["general", "support", "sales"];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Classify intent. Options: ${intents.join(", ")}. Respond with only the intent name.`,
      },
      { role: "user", content: text },
    ],
    temperature: 0,
  });

  const intent = response.choices[0].message.content?.trim() || "general";

  return { classifiedIntent: intent };
}

async function executeAIExtractInfo(config: any, variables: Record<string, any>) {
  const text = variables.lastUserMessage || "";
  const fieldsToExtract = config.fields || ["email", "name", "phone"];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extract the following information from the text: ${fieldsToExtract.join(", ")}. Respond with JSON only.`,
      },
      { role: "user", content: text },
    ],
    temperature: 0,
  });

  try {
    const extracted = JSON.parse(response.choices[0].message.content || "{}");
    return { extractedInfo: extracted };
  } catch {
    return { extractedInfo: {} };
  }
}

async function executeAIValidateFormat(config: any, variables: Record<string, any>) {
  const text = variables.lastUserMessage || "";
  const expectedFormat = config.format || "text";

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Validate if the text matches the format: ${expectedFormat}. Respond with JSON: {"valid": true/false, "reason": "..."}`,
      },
      { role: "user", content: text },
    ],
    temperature: 0,
  });

  try {
    const validation = JSON.parse(response.choices[0].message.content || '{"valid": false}');
    return { formatValid: validation.valid, validationReason: validation.reason };
  } catch {
    return { formatValid: false };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const MAX_VARIABLE_SIZE = 10000; // 10KB per variable

function interpolateVariables(text: string, variables: Record<string, any>): string {
  let result = text;

  Object.keys(variables).forEach((key) => {
    const value = String(variables[key] || "");
    
    // Prevent memory issues with large variables
    if (value.length > MAX_VARIABLE_SIZE) {
      logger.warn('Variable too large, truncating', { variableName: key, size: value.length });
      const truncated = value.substring(0, MAX_VARIABLE_SIZE) + "...";
      result = result.replace(new RegExp(`{{${key}}}`, "g"), truncated);
    } else {
      result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
    }
  });

  return result;
}

async function validateInput(input: string, validation: any): Promise<{ valid: boolean; errorMessage?: string; extractedData?: any }> {
  const { type, pattern, errorMessage } = validation;

  switch (type) {
    case "regex":
      const regex = new RegExp(pattern);
      return {
        valid: regex.test(input),
        errorMessage: errorMessage || "Invalid format",
        extractedData: input,
      };

    case "email":
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
      return {
        valid: emailValid,
        errorMessage: errorMessage || "Please enter a valid email address",
        extractedData: input,
      };

    case "phone":
      const phoneValid = /^\+?[\d\s\-()]+$/.test(input);
      return {
        valid: phoneValid,
        errorMessage: errorMessage || "Please enter a valid phone number",
        extractedData: input,
      };

    default:
      return { valid: true, extractedData: input };
  }
}

async function sendMessageToUser(conversationId: string, message: string) {
  const msg = await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: message,
      metadata: { source: "workflow" },
    },
  });

  // Broadcast via Socket.io
  const socketService = await import("./socket.service");
  socketService.default.broadcastMessage(conversationId, msg);
}

async function markExecutionCompleted(executionId: string) {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}

async function markExecutionFailed(executionId: string, error: string) {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
    },
  });
}

async function addExecutionLog(executionId: string, message: string, data?: any) {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
  });

  if (!execution) return;

  const logs = (execution.logs as any[]) || [];
  logs.push({
    timestamp: new Date().toISOString(),
    message,
    data,
  });

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { logs },
  });
}

/**
 * Stop workflow for conversation
 */
export async function stopWorkflowForConversation(conversationId: string): Promise<void> {
  await WorkflowStateManager.deleteContext(conversationId);
}

/**
 * Get workflow state for conversation
 */
export async function getWorkflowState(conversationId: string): Promise<ConversationExecutionContext | null> {
  return await WorkflowStateManager.getContext(conversationId);
}
