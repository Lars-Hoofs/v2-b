import OpenAI from 'openai';
import retry from 'async-retry';
import { env } from './env';
import logger from './logger';
import { CircuitBreaker } from './circuitBreaker';

export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 0, 
});

// Circuit breaker for OpenAI API
const openaiCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
  name: 'openai-api',
});

export async function generateChatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  model: string,
  options: Partial<OpenAI.Chat.ChatCompletionCreateParams> = {}
): Promise<OpenAI.Chat.ChatCompletion> {
  return await openaiCircuitBreaker.execute(async () => {
    return retry<OpenAI.Chat.ChatCompletion>(
    async (bail, attempt) => {
      try {
        const response = await openai.chat.completions.create({
          model,
          messages,
          stream: false,
          ...options,
        }) as OpenAI.Chat.ChatCompletion;
        return response;
      } catch (error: any) {
        if (error.status === 400 || error.status === 401 || error.status === 404) {
          logger.error('OpenAI API error (not retrying)', { error: error.message, status: error.status });
          bail(error);
          return {} as OpenAI.Chat.ChatCompletion;
        }
      
        if (error.status === 429 || error.status >= 500) {
          logger.warn(`OpenAI API error (attempt ${attempt})`, { error: error.message, status: error.status });
          throw error; 
        }
        
        logger.error('OpenAI API unexpected error', { error: error.message });
        bail(error);
        return {} as OpenAI.Chat.ChatCompletion;
      }
    },
    {
      retries: 3,
      minTimeout: 1000, 
      maxTimeout: 5000, 
      factor: 2, 
    }
    );
  });
}

export async function generateEmbedding(text: string, model: string): Promise<number[]> {
  return await openaiCircuitBreaker.execute(async () => {
    return retry(
    async (bail, attempt) => {
      try {
        const response = await openai.embeddings.create({ model, input: text });
        return response.data[0].embedding;
      } catch (error: any) {
        if (error.status === 400 || error.status === 401 || error.status === 404) {
          logger.error('OpenAI embeddings error (not retrying)', { error: error.message });
          bail(error);
          return [];
        }
        
        if (error.status === 429 || error.status >= 500) {
          logger.warn(`OpenAI embeddings error (attempt ${attempt})`, { error: error.message });
          throw error;
        }
        
        logger.error('OpenAI embeddings unexpected error', { error: error.message });
        bail(error);
        return [];
      }
    },
    { retries: 3, minTimeout: 1000, maxTimeout: 5000, factor: 2 }
    );
  });
}
