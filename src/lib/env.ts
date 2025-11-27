import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file BEFORE validation
dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be a valid URL'),

  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // OpenAI
  OPENAI_API_KEY: z.string().startsWith('sk-', 'OPENAI_API_KEY must start with sk-'),

  // Email (Resend)
  RESEND_API_KEY: z.string().startsWith('re_', 'RESEND_API_KEY must start with re_'),
  EMAIL_FROM: z.string().email().optional().default('noreply@yourdomain.com'),

  // Optional
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function validateEnv(): Env {
  // Return cached env if already validated
  if (cachedEnv) {
    return cachedEnv;
  }

  try {
    cachedEnv = envSchema.parse(process.env);
    return cachedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('\n❌ Environment validation failed:\n');
      error.errors.forEach((err) => {
        console.error(`  • ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\nPlease check your .env file and ensure all required variables are set.\n');
      process.exit(1);
    }
    throw error;
  }
}

// Export validated env for use throughout the app
export const env = validateEnv();
