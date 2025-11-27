-- Enable pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create database if not exists (already created by POSTGRES_DB env var, but keeping for reference)
-- The database is created automatically by the postgres container

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE ai_chat_platform TO postgres;
