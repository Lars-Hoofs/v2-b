import { NodeType, ExecutionStatus } from "@prisma/client";

// ==================== Execution Context ====================

export interface WorkflowExecutionContext {
  executionId: string;
  workflowId: string;
  conversationId?: string;
  variables: Record<string, any>;
  metadata: Record<string, any>;
  startedAt: Date;
  currentNodeId?: string;
}

export interface NodeExecutionResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  logs?: string[];
  nextNodes?: string[];
  shouldContinue: boolean;
}

// ==================== Node Configuration Types ====================

// Base config that all nodes have
export interface BaseNodeConfig {
  // Display & Logging
  displayMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  
  // Execution Control
  timeout?: number; // milliseconds
  retryOnError?: boolean;
  maxRetries?: number;
  continueOnError?: boolean;
  
  // Variables
  saveResultAs?: string; // Variable name to save result
  
  // Conditional Execution
  executeWhen?: {
    variable: string;
    operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'exists';
    value?: any;
  };
}

// Trigger Nodes
export interface TriggerWaitConfig extends BaseNodeConfig {
  duration: number; // milliseconds
  message?: string;
}

export interface TriggerInactivityConfig extends BaseNodeConfig {
  thresholdMinutes: number;
  checkInterval?: number; // milliseconds
}

export interface TriggerMessageConfig extends BaseNodeConfig {
  messagePattern?: string; // regex pattern
  caseSensitive?: boolean;
}

export interface TriggerScheduleConfig extends BaseNodeConfig {
  cronExpression?: string;
  schedule?: {
    hour: number;
    minute: number;
    days?: number[]; // 0-6, Sunday = 0
  };
}

// Condition Nodes
export interface ConditionKeywordConfig extends BaseNodeConfig {
  keywords: string[];
  matchType: 'any' | 'all' | 'exact';
  caseSensitive?: boolean;
  targetVariable?: string; // Which variable to check (default: lastMessage)
}

export interface ConditionSentimentConfig extends BaseNodeConfig {
  expectedSentiment: 'positive' | 'negative' | 'neutral';
  confidenceThreshold?: number; // 0-1
  targetVariable?: string;
}

export interface ConditionTimeConfig extends BaseNodeConfig {
  timeRanges: Array<{
    startHour: number;
    endHour: number;
    days?: number[]; // 0-6
  }>;
  timezone?: string;
}

export interface ConditionCompareConfig extends BaseNodeConfig {
  variable: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'between';
  value: any;
  value2?: any; 
}

// Action Nodes
export interface ActionMessageConfig extends BaseNodeConfig {
  message: string;
  messageType?: 'text' | 'html' | 'markdown';
  variables?: Record<string, string>; 
  delay?: number; // Delay before sending
  attachments?: Array<{
    type: 'file' | 'image' | 'link';
    url: string;
    name?: string;
  }>;
}

export interface ActionEmailConfig extends BaseNodeConfig {
  to: string | string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
  variables?: Record<string, string>;
}

export interface ActionApiCallConfig extends BaseNodeConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  queryParams?: Record<string, string>;
  authentication?: {
    type: 'bearer' | 'basic' | 'apiKey';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    apiKeyHeader?: string;
  };
  responseMapping?: Record<string, string>; // Map response fields to variables
  validateResponse?: {
    statusCode?: number[];
    jsonSchema?: any;
  };
}

export interface ActionAssignHumanConfig extends BaseNodeConfig {
  userId?: string;
  teamId?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  note?: string;
  notifyUser?: boolean;
}

export interface ActionVariableSetConfig extends BaseNodeConfig {
  variables: Record<string, any>;
  operation?: 'set' | 'append' | 'increment' | 'decrement';
}

export interface ActionDelayConfig extends BaseNodeConfig {
  duration: number; 
  reason?: string;
}

// AI Nodes
export interface AIResponseConfig extends BaseNodeConfig {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  includeContext?: boolean;
  contextVariables?: string[]; 
}

export interface AISearchKBConfig extends BaseNodeConfig {
  knowledgeBaseId: string;
  query?: string; 
  limit?: number;
  minScore?: number;
  includeMetadata?: boolean;
}

export interface AIClassifyIntentConfig extends BaseNodeConfig {
  intents: string[];
  description?: string;
  model?: string;
  includeConfidence?: boolean;
}

export interface AIFunctionCallConfig extends BaseNodeConfig {
  functionName: string;
  parameters?: Record<string, any>;
  model?: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters: any;
  }>;
}

export interface AISummarizeConfig extends BaseNodeConfig {
  targetVariable?: string;
  maxLength?: number;
  style?: 'brief' | 'detailed' | 'bullet-points';
}

// Flow Control Nodes
export interface FlowSplitConfig extends BaseNodeConfig {
  branches: Array<{
    id: string;
    name: string;
    condition?: {
      variable: string;
      operator: string;
      value: any;
    };
  }>;
  defaultBranch?: string;
}

export interface FlowJoinConfig extends BaseNodeConfig {
  waitForAll?: boolean; 
  timeout?: number;
}

export interface FlowLoopConfig extends BaseNodeConfig {
  iterateOver?: string; 
  maxIterations?: number;
  breakWhen?: {
    variable: string;
    operator: string;
    value: any;
  };
}

export interface FlowParallelConfig extends BaseNodeConfig {
  branches: string[]; 
  waitForAll?: boolean;
  continueOnAnyComplete?: boolean;
  timeout?: number;
}

// Data Transformation Nodes
export interface DataTransformConfig extends BaseNodeConfig {
  transformations: Array<{
    sourceVariable: string;
    targetVariable: string;
    operation: 'map' | 'filter' | 'reduce' | 'sort' | 'format';
    params?: any;
  }>;
}

export interface DataValidateConfig extends BaseNodeConfig {
  validations: Array<{
    variable: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url';
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
    customValidator?: string; 
  }>;
  onValidationFailed?: 'error' | 'continue' | 'skip';
}

export type NodeConfig =
  | TriggerWaitConfig
  | TriggerInactivityConfig
  | TriggerMessageConfig
  | TriggerScheduleConfig
  | ConditionKeywordConfig
  | ConditionSentimentConfig
  | ConditionTimeConfig
  | ConditionCompareConfig
  | ActionMessageConfig
  | ActionEmailConfig
  | ActionApiCallConfig
  | ActionAssignHumanConfig
  | ActionVariableSetConfig
  | ActionDelayConfig
  | AIResponseConfig
  | AISearchKBConfig
  | AIClassifyIntentConfig
  | AIFunctionCallConfig
  | AISummarizeConfig
  | FlowSplitConfig
  | FlowJoinConfig
  | FlowLoopConfig
  | FlowParallelConfig
  | DataTransformConfig
  | DataValidateConfig;

// ==================== Execution Logging ====================

export interface ExecutionLog {
  timestamp: Date;
  nodeId: string;
  nodeLabel: string;
  nodeType: NodeType;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: any;
  duration?: number; 
}

// ==================== Node Type Metadata ====================

export interface NodeTypeMetadata {
  type: NodeType;
  category: 'trigger' | 'condition' | 'action' | 'ai' | 'flow' | 'data';
  label: string;
  description: string;
  icon?: string;
  color?: string;
  configSchema?: any; 
  inputs?: number;
  outputs?: number; 
  async?: boolean; 
}

// ==================== Workflow Validation ====================

export interface WorkflowValidationResult {
  valid: boolean;
  errors: Array<{
    nodeId?: string;
    edgeId?: string;
    type: 'error' | 'warning';
    message: string;
  }>;
}

// ==================== Edge Conditions ====================

export interface EdgeCondition {
  field: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'exists' | 'matches';
  value?: any;
  negate?: boolean;
}

// ==================== Helper Types ====================

export interface VariableReference {
  name: string;
  type: 'context' | 'node' | 'conversation' | 'user';
  defaultValue?: any;
}

export interface WorkflowMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDuration: number;
  nodeExecutionCounts: Record<string, number>;
  errorCounts: Record<string, number>;
}
