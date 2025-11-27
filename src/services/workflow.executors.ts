import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import logger from '../lib/logger';
import * as chatService from "./chat.service";
import { WorkflowError } from "./workflow.service";
import {
  WorkflowExecutionContext,
  NodeExecutionResult,
  TriggerWaitConfig,
  TriggerInactivityConfig,
  ConditionKeywordConfig,
  ConditionSentimentConfig,
  ConditionTimeConfig,
  ConditionCompareConfig,
  ActionMessageConfig,
  ActionEmailConfig,
  ActionApiCallConfig,
  ActionAssignHumanConfig,
  ActionVariableSetConfig,
  ActionDelayConfig,
  AIResponseConfig,
  AISearchKBConfig,
  AIClassifyIntentConfig,
  AIFunctionCallConfig,
  AISummarizeConfig,
  FlowLoopConfig,
  DataTransformConfig,
  DataValidateConfig,
} from "./workflow.types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Helper function to replace variables in strings
 */
function replaceVariables(template: string, variables: Record<string, any>): string {
  let result = template;
  
  // Replace {{variable}} syntax
  Object.keys(variables).forEach((key) => {
    const value = variables[key];
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, String(value ?? ''));
  });
  
  return result;
}

/**
 * Helper function to get variable value with fallback
 */
function getVariable(
  variables: Record<string, any>,
  path: string,
  defaultValue?: any
): any {
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

// ==================== TRIGGER EXECUTORS ====================

export async function executeTriggerWait(
  config: TriggerWaitConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const duration = config.duration || 5000;
  const startTime = Date.now();
  
  await new Promise((resolve) => setTimeout(resolve, duration));
  
  return {
    success: true,
    data: {
      waitCompleted: true,
      duration,
      actualWaitTime: Date.now() - startTime
    },
    shouldContinue: true
  };
}

export async function executeTriggerInactivity(
  config: TriggerInactivityConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  if (!context.conversationId) {
    return {
      success: true,
      data: { inactivityDetected: false, reason: 'No conversation' },
      shouldContinue: false
    };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: context.conversationId },
  });

  if (!conversation) {
    return {
      success: true,
      data: { inactivityDetected: false, reason: 'Conversation not found' },
      shouldContinue: false
    };
  }

  const timeSinceLastMessage = Date.now() - conversation.lastMessageAt.getTime();
  const threshold = config.thresholdMinutes * 60 * 1000;
  const isInactive = timeSinceLastMessage > threshold;

  return {
    success: true,
    data: {
      inactivityDetected: isInactive,
      minutesInactive: Math.floor(timeSinceLastMessage / 60000),
      threshold: config.thresholdMinutes
    },
    shouldContinue: isInactive
  };
}

// ==================== CONDITION EXECUTORS ====================

export async function executeConditionKeyword(
  config: ConditionKeywordConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const targetVar = config.targetVariable || 'lastMessage';
  const text = String(getVariable(context.variables, targetVar, ''));
  const keywords = config.keywords || [];
  const caseSensitive = config.caseSensitive || false;
  
  let matchedKeywords: string[] = [];
  
  if (config.matchType === 'exact') {
    const searchText = caseSensitive ? text : text.toLowerCase();
    matchedKeywords = keywords.filter(kw => {
      const keyword = caseSensitive ? kw : kw.toLowerCase();
      return searchText === keyword;
    });
  } else if (config.matchType === 'all') {
    matchedKeywords = keywords.filter(kw => {
      const keyword = caseSensitive ? kw : kw.toLowerCase();
      const searchText = caseSensitive ? text : text.toLowerCase();
      return searchText.includes(keyword);
    });
    if (matchedKeywords.length !== keywords.length) {
      matchedKeywords = [];
    }
  } else { // 'any'
    matchedKeywords = keywords.filter(kw => {
      const keyword = caseSensitive ? kw : kw.toLowerCase();
      const searchText = caseSensitive ? text : text.toLowerCase();
      return searchText.includes(keyword);
    });
  }

  const conditionMet = matchedKeywords.length > 0;

  return {
    success: true,
    data: {
      conditionMet,
      matchedKeywords,
      matchType: config.matchType,
      checkedText: text.substring(0, 100)
    },
    shouldContinue: conditionMet
  };
}

export async function executeConditionSentiment(
  config: ConditionSentimentConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const targetVar = config.targetVariable || 'lastMessage';
  const text = String(getVariable(context.variables, targetVar, ''));

  if (!text) {
    return {
      success: true,
      data: { sentiment: 'neutral', conditionMet: false },
      shouldContinue: false
    };
  }

  // Use OpenAI for sentiment analysis
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: 'Analyze the sentiment of the text. Respond with only: "positive", "negative", or "neutral"',
      },
      { role: "user", content: text },
    ],
    temperature: 0,
  });

  const sentiment = response.choices[0].message.content?.toLowerCase()?.trim() || "neutral";
  const conditionMet = sentiment === config.expectedSentiment;

  return {
    success: true,
    data: {
      sentiment,
      expectedSentiment: config.expectedSentiment,
      conditionMet,
      confidence: config.confidenceThreshold || 1.0
    },
    shouldContinue: conditionMet
  };
}

export async function executeConditionTime(
  config: ConditionTimeConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

  let isWithinTimeRange = false;

  for (const range of config.timeRanges) {
    const hourInRange = currentHour >= range.startHour && currentHour < range.endHour;
    const dayInRange = !range.days || range.days.includes(currentDay);
    
    if (hourInRange && dayInRange) {
      isWithinTimeRange = true;
      break;
    }
  }

  return {
    success: true,
    data: {
      conditionMet: isWithinTimeRange,
      currentHour,
      currentDay,
      timezone: config.timezone || 'local'
    },
    shouldContinue: isWithinTimeRange
  };
}

export async function executeConditionCompare(
  config: ConditionCompareConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const value1 = getVariable(context.variables, config.variable);
  const value2 = config.value;
  
  let conditionMet = false;

  switch (config.operator) {
    case 'equals':
      conditionMet = value1 === value2;
      break;
    case 'notEquals':
      conditionMet = value1 !== value2;
      break;
    case 'contains':
      conditionMet = String(value1).includes(String(value2));
      break;
    case 'greaterThan':
      conditionMet = Number(value1) > Number(value2);
      break;
    case 'lessThan':
      conditionMet = Number(value1) < Number(value2);
      break;
    case 'between':
      const num = Number(value1);
      conditionMet = num >= Number(value2) && num <= Number(config.value2);
      break;
  }

  return {
    success: true,
    data: {
      conditionMet,
      variable: config.variable,
      value1,
      operator: config.operator,
      value2
    },
    shouldContinue: conditionMet
  };
}

// ==================== ACTION EXECUTORS ====================

export async function executeActionMessage(
  config: ActionMessageConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  // Apply delay if specified
  if (config.delay) {
    await new Promise(resolve => setTimeout(resolve, config.delay));
  }

  // Replace variables in message
  let message = replaceVariables(config.message, context.variables);

  // Test mode check
  if (!context.conversationId || context.variables.testMode) {
    logger.info('[TEST MODE] Would send message', { message, config });
    return {
      success: true,
      data: { messageSent: false, message, testMode: true },
      shouldContinue: true
    };
  }

  // Send the message
  await chatService.sendMessage({
    conversationId: context.conversationId,
    content: message,
    role: "AGENT",
  });

  return {
    success: true,
    data: {
      messageSent: true,
      message,
      messageType: config.messageType || 'text',
      attachmentCount: config.attachments?.length || 0
    },
    shouldContinue: true
  };
}

export async function executeActionEmail(
  config: ActionEmailConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  // Replace variables in email fields
  const to = Array.isArray(config.to) ? config.to : [config.to];
  const subject = replaceVariables(config.subject, context.variables);
  const body = replaceVariables(config.body, context.variables);

  // TODO: Integrate with actual email service (SendGrid, AWS SES, etc.)
  logger.info('Workflow email action triggered', {
    to,
    subject,
    bodyPreview: body.substring(0, 100)
  });

  return {
    success: true,
    data: {
      emailSent: true,
      to,
      subject,
      bodyType: config.bodyType || 'text',
      cc: config.cc,
      bcc: config.bcc,
      attachmentCount: config.attachments?.length || 0
    },
    shouldContinue: true
  };
}

export async function executeActionApiCall(
  config: ActionApiCallConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  // Replace variables in URL
  let url = replaceVariables(config.url, context.variables);
  
  // Add query params
  if (config.queryParams) {
    const params = new URLSearchParams();
    Object.entries(config.queryParams).forEach(([key, value]) => {
      params.append(key, replaceVariables(value, context.variables));
    });
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  // Prepare headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers
  };

  // Add authentication
  if (config.authentication) {
    const auth = config.authentication;
    if (auth.type === 'bearer' && auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth.type === 'apiKey' && auth.apiKey) {
      const headerName = auth.apiKeyHeader || 'X-API-Key';
      headers[headerName] = auth.apiKey;
    } else if (auth.type === 'basic' && auth.username && auth.password) {
      const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }
  }

  // Prepare body
  let body: string | undefined;
  if (config.body && config.method !== 'GET') {
    if (typeof config.body === 'string') {
      body = replaceVariables(config.body, context.variables);
    } else {
      body = JSON.stringify(config.body);
      body = replaceVariables(body, context.variables);
    }
  }

  // Make the API call
  const response = await fetch(url, {
    method: config.method,
    headers,
    body
  });

  let responseData: any;
  const contentType = response.headers.get('content-type');
  
  if (contentType?.includes('application/json')) {
    responseData = await response.json();
  } else {
    responseData = await response.text();
  }

  // Validate response if configured
  if (config.validateResponse) {
    const { statusCode, jsonSchema } = config.validateResponse;
    
    if (statusCode && !statusCode.includes(response.status)) {
      throw new WorkflowError(
        `API call failed validation: expected status ${statusCode.join('|')}, got ${response.status}`,
        response.status
      );
    }
  }

  // Map response to variables if configured
  const mappedData: Record<string, any> = {};
  if (config.responseMapping && typeof responseData === 'object') {
    Object.entries(config.responseMapping).forEach(([responsePath, variableName]) => {
      mappedData[variableName] = getVariable(responseData, responsePath);
    });
  }

  return {
    success: response.ok,
    data: {
      apiCallCompleted: true,
      statusCode: response.status,
      response: responseData,
      ...mappedData
    },
    shouldContinue: response.ok
  };
}

export async function executeActionAssignHuman(
  config: ActionAssignHumanConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  if (!context.conversationId || context.variables.testMode) {
    logger.info('[TEST MODE] Would assign to human', { config });
    return {
      success: true,
      data: { assignedToHuman: false, testMode: true },
      shouldContinue: true
    };
  }

  const userId = config.userId;
  
  if (!userId) {
    throw new WorkflowError('userId is required for ACTION_ASSIGN_HUMAN', 400);
  }
  
  // TODO: Implement team-based assignment if teamId is specified
  await chatService.assignConversationToHuman(context.conversationId, userId);

  return {
    success: true,
    data: {
      assignedToHuman: true,
      userId,
      teamId: config.teamId,
      priority: config.priority || 'normal',
      note: config.note
    },
    shouldContinue: true
  };
}

export async function executeActionVariableSet(
  config: ActionVariableSetConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const updatedVariables: Record<string, any> = {};
  const operation = config.operation || 'set';

  Object.entries(config.variables).forEach(([key, value]) => {
    // Resolve value if it's a variable reference
    let resolvedValue = value;
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const varName = value.slice(2, -2).trim();
      resolvedValue = getVariable(context.variables, varName, value);
    }

    switch (operation) {
      case 'set':
        updatedVariables[key] = resolvedValue;
        break;
      case 'append':
        const existing = context.variables[key];
        if (Array.isArray(existing)) {
          updatedVariables[key] = [...existing, resolvedValue];
        } else if (typeof existing === 'string') {
          updatedVariables[key] = existing + String(resolvedValue);
        } else {
          updatedVariables[key] = resolvedValue;
        }
        break;
      case 'increment':
        updatedVariables[key] = (Number(context.variables[key]) || 0) + Number(resolvedValue);
        break;
      case 'decrement':
        updatedVariables[key] = (Number(context.variables[key]) || 0) - Number(resolvedValue);
        break;
    }
  });

  return {
    success: true,
    data: updatedVariables,
    shouldContinue: true
  };
}

export async function executeActionDelay(
  config: ActionDelayConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const startTime = Date.now();
  await new Promise(resolve => setTimeout(resolve, config.duration));
  
  return {
    success: true,
    data: {
      delayCompleted: true,
      duration: config.duration,
      actualDelay: Date.now() - startTime,
      reason: config.reason
    },
    shouldContinue: true
  };
}

// ==================== AI EXECUTORS ====================

export async function executeAIResponse(
  config: AIResponseConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  if (!context.conversationId || context.variables.testMode) {
    logger.info('[TEST MODE] Would generate AI response', { config });
    return {
      success: true,
      data: { aiResponseGenerated: false, testMode: true },
      shouldContinue: true
    };
  }

  // Build context from specified variables
  let contextText = '';
  if (config.includeContext && config.contextVariables) {
    const contextParts = config.contextVariables.map(varName => {
      const value = getVariable(context.variables, varName);
      return value ? `${varName}: ${JSON.stringify(value)}` : null;
    }).filter(Boolean);
    
    if (contextParts.length > 0) {
      contextText = '\n\nContext:\n' + contextParts.join('\n');
    }
  }

  // Generate AI response
  const messages: any[] = [];
  
  if (config.systemPrompt) {
    messages.push({ role: 'system', content: config.systemPrompt });
  }
  
  messages.push({
    role: 'user',
    content: replaceVariables(config.prompt, context.variables) + contextText
  });

  const response = await openai.chat.completions.create({
    model: config.model || 'gpt-4o-mini',
    messages,
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens
  });

  const aiMessage = response.choices[0].message.content || '';

  // Send the AI response
  await chatService.sendMessage({
    conversationId: context.conversationId,
    content: aiMessage,
    role: "AGENT",
  });

  return {
    success: true,
    data: {
      aiResponseGenerated: true,
      aiResponse: aiMessage,
      model: config.model || 'gpt-4o-mini',
      tokensUsed: response.usage?.total_tokens
    },
    shouldContinue: true
  };
}

export async function executeAISearchKB(
  config: AISearchKBConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const query = config.query 
    ? replaceVariables(config.query, context.variables)
    : getVariable(context.variables, 'lastMessage', '');

  if (!config.knowledgeBaseId) {
    throw new WorkflowError("Knowledge base ID required for search", 400);
  }

  // Import knowledge base service
  const { searchKnowledgeBase } = await import("./knowledgeBase.service");
  const results = await searchKnowledgeBase(
    config.knowledgeBaseId,
    query,
    config.limit || 3
  );

  // Filter by min score if configured
  const filteredResults = config.minScore
    ? results.filter((r: any) => r.score >= config.minScore!)
    : results;

  const searchContext = filteredResults.map((r: any) => r.content).join("\n\n");

  return {
    success: true,
    data: {
      searchCompleted: true,
      results: filteredResults,
      context: searchContext,
      resultCount: filteredResults.length,
      query
    },
    shouldContinue: true
  };
}

export async function executeAIClassifyIntent(
  config: AIClassifyIntentConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const text = getVariable(context.variables, 'lastMessage', '');
  const intents = config.intents || ["general"];

  const systemPrompt = config.description
    ? `Classify the user's intent. Possible intents: ${intents.join(", ")}.\n${config.description}\nRespond with only the intent name.`
    : `Classify the user's intent. Possible intents: ${intents.join(", ")}. Respond with only the intent name.`;

  const response = await openai.chat.completions.create({
    model: config.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
    temperature: 0,
  });

  const intent = response.choices[0].message.content?.trim() || "general";
  
  // Validate intent is in the list
  const validIntent = intents.includes(intent) ? intent : "general";

  return {
    success: true,
    data: {
      intent: validIntent,
      rawIntent: intent,
      intents,
      confidence: config.includeConfidence ? 1.0 : undefined
    },
    shouldContinue: true
  };
}

export async function executeAISummarize(
  config: AISummarizeConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const targetVar = config.targetVariable || 'lastMessage';
  const text = String(getVariable(context.variables, targetVar, ''));

  if (!text) {
    return {
      success: true,
      data: { summary: '', originalLength: 0 },
      shouldContinue: true
    };
  }

  const stylePrompts = {
    'brief': 'Provide a very brief summary in 1-2 sentences.',
    'detailed': 'Provide a detailed summary covering all key points.',
    'bullet-points': 'Provide a summary as bullet points.'
  };

  const systemPrompt = stylePrompts[config.style || 'brief'];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
    max_tokens: config.maxLength || 200
  });

  const summary = response.choices[0].message.content || '';

  return {
    success: true,
    data: {
      summary,
      originalLength: text.length,
      summaryLength: summary.length,
      style: config.style || 'brief'
    },
    shouldContinue: true
  };
}

// ==================== FLOW CONTROL EXECUTORS ====================

export async function executeFlowLoop(
  config: FlowLoopConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  // TODO: Implement loop logic - requires execution engine support
  // This is a placeholder that returns iteration data
  
  const arrayVar = config.iterateOver 
    ? getVariable(context.variables, config.iterateOver, [])
    : [];
  
  const items = Array.isArray(arrayVar) ? arrayVar : [arrayVar];
  const maxIterations = config.maxIterations || items.length;
  
  return {
    success: true,
    data: {
      loopItems: items.slice(0, maxIterations),
      totalItems: items.length,
      maxIterations
    },
    shouldContinue: true
  };
}

// ==================== DATA TRANSFORMATION EXECUTORS ====================

export async function executeDataTransform(
  config: DataTransformConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const transformedData: Record<string, any> = {};

  for (const transform of config.transformations) {
    const sourceValue = getVariable(context.variables, transform.sourceVariable);
    
    let result: any;
    switch (transform.operation) {
      case 'map':
        result = Array.isArray(sourceValue) 
          ? sourceValue.map((item: any) => item[transform.params?.key])
          : sourceValue;
        break;
      case 'filter':
        result = Array.isArray(sourceValue)
          ? sourceValue.filter((item: any) => item[transform.params?.key] === transform.params?.value)
          : sourceValue;
        break;
      case 'sort':
        result = Array.isArray(sourceValue)
          ? [...sourceValue].sort((a: any, b: any) => {
              const aVal = a[transform.params?.key];
              const bVal = b[transform.params?.key];
              return transform.params?.order === 'desc' ? bVal - aVal : aVal - bVal;
            })
          : sourceValue;
        break;
      case 'format':
        result = String(sourceValue);
        break;
      default:
        result = sourceValue;
    }
    
    transformedData[transform.targetVariable] = result;
  }

  return {
    success: true,
    data: transformedData,
    shouldContinue: true
  };
}

export async function executeDataValidate(
  config: DataValidateConfig,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const validationErrors: string[] = [];

  for (const validation of config.validations) {
    const value = getVariable(context.variables, validation.variable);
    
    // Check required
    if (validation.required && (value === undefined || value === null || value === '')) {
      validationErrors.push(`${validation.variable} is required`);
      continue;
    }

    if (value !== undefined && value !== null) {
      // Check type
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (validation.type && actualType !== validation.type) {
        validationErrors.push(`${validation.variable} must be of type ${validation.type}`);
      }

      // Check min/max for numbers and strings
      if (validation.min !== undefined) {
        if (typeof value === 'number' && value < validation.min) {
          validationErrors.push(`${validation.variable} must be >= ${validation.min}`);
        } else if (typeof value === 'string' && value.length < validation.min) {
          validationErrors.push(`${validation.variable} length must be >= ${validation.min}`);
        }
      }

      if (validation.max !== undefined) {
        if (typeof value === 'number' && value > validation.max) {
          validationErrors.push(`${validation.variable} must be <= ${validation.max}`);
        } else if (typeof value === 'string' && value.length > validation.max) {
          validationErrors.push(`${validation.variable} length must be <= ${validation.max}`);
        }
      }

      // Check pattern
      if (validation.pattern && typeof value === 'string') {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(value)) {
          validationErrors.push(`${validation.variable} does not match required pattern`);
        }
      }
    }
  }

  const isValid = validationErrors.length === 0;
  const onFailedStrategy = config.onValidationFailed || 'error';

  if (!isValid && onFailedStrategy === 'error') {
    throw new WorkflowError(`Validation failed: ${validationErrors.join(', ')}`, 400);
  }

  return {
    success: isValid,
    data: {
      validationPassed: isValid,
      errors: validationErrors,
      strategy: onFailedStrategy
    },
    shouldContinue: onFailedStrategy !== 'skip' || isValid
  };
}
