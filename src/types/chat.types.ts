import { Prisma } from '@prisma/client';

// Conversation with includes
export type ConversationWithAgent = Prisma.ConversationGetPayload<{
  include: {
    agent: {
      include: {
        knowledgeBase: true;
        workflow: true;
      };
    };
    messages: true;
  };
}>;

// Message with user
export type MessageWithUser = Prisma.MessageGetPayload<{
  include: {
    sender: true;
  };
}>;

// Agent with relations
export type AgentWithKB = Prisma.AgentGetPayload<{
  include: {
    knowledgeBase: true;
    workflow: true;
  };
}>;

// KB search result
export interface KBSearchResult {
  content: string;
  score: number;
  documentTitle: string;
}

// KB source for response
export interface KBSource {
  id: number;
  content: string;
  documentTitle: string;
  score: number;
}

// Page context result
export interface PageContextResult {
  content: string;
  sources: KBSource[];
}

// Chat message metadata
export interface MessageMetadata {
  source?: string;
  timestamp?: Date;
  [key: string]: unknown;
}
