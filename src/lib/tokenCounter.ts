import { encode } from 'gpt-tokenizer';
import logger from './logger';

/**
 * Count tokens in a text string
 */
export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch (error) {
    logger.error('Failed to count tokens', { error });
    // Fallback: rough estimation (1 token ≈ 4 characters)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens in messages array
 */
export function countMessageTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  
  for (const message of messages) {
    // Account for message overhead (~4 tokens per message)
    total += 4;
    total += countTokens(message.role);
    total += countTokens(message.content);
  }
  
  // Account for response priming
  total += 3;
  
  return total;
}

interface TruncateOptions {
  maxTokens?: number;
  systemMessage?: { role: string; content: string };
  preserveRecent?: number;
}

/**
 * Truncate messages to fit within token limit
 * Always preserves system message and most recent messages
 */
export function truncateMessages(
  messages: Array<{ role: string; content: string }>,
  options: TruncateOptions = {}
): Array<{ role: string; content: string }> {
  const {
    maxTokens = 4000,
    systemMessage,
    preserveRecent = 5,
  } = options;

  let result: Array<{ role: string; content: string }> = [];
  let totalTokens = 0;

  // Always include system message first
  if (systemMessage) {
    result.push(systemMessage);
    totalTokens += countTokens(systemMessage.content) + 4;
  }

  // Preserve most recent messages
  const recentMessages = messages.slice(-preserveRecent);
  const olderMessages = messages.slice(0, -preserveRecent);

  // Add recent messages (in reverse to prioritize newest)
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    const tokens = countTokens(msg.content) + 4;
    
    if (totalTokens + tokens > maxTokens) {
      logger.warn('Truncating messages to fit token limit', {
        totalTokens,
        maxTokens,
        messagesIncluded: result.length,
      });
      break;
    }
    
    result.unshift(msg);
    totalTokens += tokens;
  }

  // Try to add older messages if space available
  for (let i = olderMessages.length - 1; i >= 0; i--) {
    const msg = olderMessages[i];
    const tokens = countTokens(msg.content) + 4;
    
    if (totalTokens + tokens > maxTokens) {
      break;
    }
    
    // Insert after system message but before recent messages
    result.splice(systemMessage ? 1 : 0, 0, msg);
    totalTokens += tokens;
  }

  logger.debug('Message truncation complete', {
    originalCount: messages.length,
    truncatedCount: result.length - (systemMessage ? 1 : 0),
    totalTokens,
    maxTokens,
  });

  return result;
}

/**
 * Check if text fits within token limit
 */
export function fitsInTokenLimit(text: string, limit: number): boolean {
  return countTokens(text) <= limit;
}

/**
 * Truncate text to fit within token limit
 */
export function truncateText(text: string, maxTokens: number): string {
  const tokens = countTokens(text);
  
  if (tokens <= maxTokens) {
    return text;
  }

  // Rough estimation: remove characters proportionally
  const ratio = maxTokens / tokens;
  const targetLength = Math.floor(text.length * ratio * 0.95); // 5% buffer
  
  const truncated = text.substring(0, targetLength);
  
  logger.debug('Text truncated', {
    originalTokens: tokens,
    targetTokens: maxTokens,
    originalLength: text.length,
    truncatedLength: truncated.length,
  });
  
  return truncated + '...';
}

/**
 * Get model-specific token limits
 */
export function getModelTokenLimit(model: string): number {
  const limits: Record<string, number> = {
    'gpt-4': 8192,
    'gpt-4-32k': 32768,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-3.5-turbo': 4096,
    'gpt-3.5-turbo-16k': 16384,
  };

  return limits[model] ?? 4096; // Default to conservative limit
}

/**
 * Calculate remaining tokens for response
 */
export function getRemainingTokens(
  messages: Array<{ role: string; content: string }>,
  model: string
): number {
  const limit = getModelTokenLimit(model);
  const used = countMessageTokens(messages);
  const remaining = limit - used;

  return Math.max(0, remaining);
}
