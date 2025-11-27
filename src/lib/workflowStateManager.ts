import { redis } from './redis';
import logger from './logger';

export interface ConversationExecutionContext {
  conversationId: string;
  workflowId: string;
  executionId: string;
  currentNodeId: string | null;
  variables: Record<string, unknown>;
  waitingForInput: boolean;
  expectedInputType?: string;
  expectedInputValidation?: {
    type?: string;
    pattern?: string;
    errorMessage?: string;
  };
  workflow: {
    nodes: Array<{
      id: string;
      type: string;
      config: unknown;
      [key: string]: unknown;
    }>;
    edges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      condition?: unknown;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
}

const STATE_PREFIX = 'workflow:state:';
const STATE_TTL = 3600; // 1 hour

export class WorkflowStateManager {
  /**
   * Save workflow execution context to Redis
   */
  static async saveContext(context: ConversationExecutionContext): Promise<void> {
    try {
      const key = `${STATE_PREFIX}${context.conversationId}`;
      await redis.setex(key, STATE_TTL, JSON.stringify(context));
      logger.debug('Workflow state saved', { 
        conversationId: context.conversationId,
        executionId: context.executionId 
      });
    } catch (error) {
      logger.error('Failed to save workflow state', { 
        conversationId: context.conversationId, 
        error 
      });
      throw error;
    }
  }

  /**
   * Load workflow execution context from Redis
   */
  static async getContext(conversationId: string): Promise<ConversationExecutionContext | null> {
    try {
      const key = `${STATE_PREFIX}${conversationId}`;
      const data = await redis.get(key);
      
      if (!data) {
        return null;
      }

      const context = JSON.parse(data) as ConversationExecutionContext;
      logger.debug('Workflow state loaded', { 
        conversationId,
        executionId: context.executionId 
      });
      
      return context;
    } catch (error) {
      logger.error('Failed to load workflow state', { conversationId, error });
      return null;
    }
  }

  /**
   * Delete workflow execution context
   */
  static async deleteContext(conversationId: string): Promise<void> {
    try {
      const key = `${STATE_PREFIX}${conversationId}`;
      await redis.del(key);
      logger.debug('Workflow state deleted', { conversationId });
    } catch (error) {
      logger.error('Failed to delete workflow state', { conversationId, error });
    }
  }

  /**
   * Check if workflow is running for conversation
   */
  static async hasContext(conversationId: string): Promise<boolean> {
    try {
      const key = `${STATE_PREFIX}${conversationId}`;
      const exists = await redis.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Failed to check workflow state', { conversationId, error });
      return false;
    }
  }

  /**
   * Extend TTL for active workflow
   */
  static async extendTTL(conversationId: string, ttlSeconds: number = STATE_TTL): Promise<void> {
    try {
      const key = `${STATE_PREFIX}${conversationId}`;
      await redis.expire(key, ttlSeconds);
    } catch (error) {
      logger.error('Failed to extend workflow state TTL', { conversationId, error });
    }
  }

  /**
   * Get all active workflow conversations (for monitoring/debugging)
   * Uses SCAN instead of KEYS for production safety
   */
  static async getActiveConversations(): Promise<string[]> {
    try {
      const conversations: string[] = [];
      let cursor = '0';
      const pattern = `${STATE_PREFIX}*`;
      
      // Use SCAN to avoid blocking Redis
      do {
        const result = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = result[0];
        const keys = result[1];
        
        conversations.push(
          ...keys.map(key => key.replace(STATE_PREFIX, ''))
        );
      } while (cursor !== '0');
      
      return conversations;
    } catch (error) {
      logger.error('Failed to get active workflows', { error });
      return [];
    }
  }
}
