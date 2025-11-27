import { Prisma } from '@prisma/client';

// Workflow with includes
export type WorkflowWithNodes = Prisma.WorkflowGetPayload<{
  include: {
    nodes: true;
    edges: true;
  };
}>;

// Workflow node config types
export interface NodeConfig {
  [key: string]: unknown;
}

export interface TriggerMessageConfig extends NodeConfig {
  pattern?: string;
  matchType?: 'exact' | 'contains' | 'regex';
}

export interface ConditionConfig extends NodeConfig {
  keyword?: string;
  pattern?: string;
  variable?: string;
  value?: unknown;
  operator?: 'equals' | 'contains' | 'greater' | 'less';
}

export interface ActionMessageConfig extends NodeConfig {
  message?: string;
}

export interface ActionWaitForInputConfig extends NodeConfig {
  prompt?: string;
  inputType?: 'text' | 'email' | 'phone' | 'number';
}

export interface ActionValidateInputConfig extends NodeConfig {
  validationType?: 'email' | 'phone' | 'number' | 'regex' | 'text';
  regexPattern?: string;
}

export interface ActionSetVariableConfig extends NodeConfig {
  variableName?: string;
  value?: unknown;
}

export interface ActionApiCallConfig extends NodeConfig {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ActionEmailConfig extends NodeConfig {
  to?: string;
  subject?: string;
  body?: string;
}

export interface ActionAssignHumanConfig extends NodeConfig {
  userId?: string | null;
}

export interface AIResponseConfig extends NodeConfig {
  prompt?: string;
  model?: string;
  temperature?: number;
}

export interface AISearchKBConfig extends NodeConfig {
  knowledgeBaseId?: string;
  limit?: number;
}

export interface AIClassifyIntentConfig extends NodeConfig {
  intents?: string[];
}

export interface AIExtractInfoConfig extends NodeConfig {
  fields?: string[];
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  errorMessage?: string;
  extractedData?: unknown;
}

// Workflow execution result
export interface WorkflowMessageResult {
  shouldRespond: boolean;
  response?: string;
  continueWorkflow: boolean;
}

// Variable types
export interface WorkflowVariables {
  [key: string]: unknown;
  lastUserMessage?: string;
  lastMessageMetadata?: unknown;
  validatedInput?: unknown;
}

// Execution context
export interface ConversationExecutionContext {
  conversationId: string;
  workflowId: string;
  executionId: string;
  currentNodeId: string | null;
  variables: WorkflowVariables;
  waitingForInput: boolean;
  expectedInputType?: string;
  expectedInputValidation?: ValidationConfig;
  workflow: WorkflowWithNodes;
}

export interface ValidationConfig {
  type?: 'email' | 'phone' | 'number' | 'regex';
  pattern?: string;
  required?: boolean;
}
