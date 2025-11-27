import { prisma } from "../lib/prisma";
import OpenAI from "openai";

export class KnowledgeBaseError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "KnowledgeBaseError";
  }
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CreateKnowledgeBaseInput {
  workspaceId: string;
  name: string;
  description?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export async function createKnowledgeBase(input: CreateKnowledgeBaseInput) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: input.workspaceId, deletedAt: null },
  });

  if (!workspace) {
    throw new KnowledgeBaseError("Workspace not found", 404);
  }

  return prisma.knowledgeBase.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      embeddingModel: input.embeddingModel || "text-embedding-3-small",
      chunkSize: input.chunkSize || 1000,
      chunkOverlap: input.chunkOverlap || 200,
    },
  });
}

export async function getKnowledgeBase(kbId: string, workspaceId: string) {
  const kb = await prisma.knowledgeBase.findFirst({
    where: {
      id: kbId,
      workspaceId,
      deletedAt: null,
    },
    include: {
      documents: {
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { documents: true },
      },
    },
  });

  if (!kb) {
    throw new KnowledgeBaseError("Knowledge base not found", 404);
  }

  return kb;
}

export async function getWorkspaceKnowledgeBases(workspaceId: string) {
  return prisma.knowledgeBase.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    include: {
      _count: {
        select: { documents: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteKnowledgeBase(kbId: string, workspaceId: string) {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: kbId, workspaceId, deletedAt: null },
  });

  if (!kb) {
    throw new KnowledgeBaseError("Knowledge base not found", 404);
  }

  // Check if any agents are using this KB
  const agentsUsingKB = await prisma.agent.count({
    where: {
      knowledgeBaseId: kbId,
      deletedAt: null,
    },
  });

  if (agentsUsingKB > 0) {
    throw new KnowledgeBaseError(
      `Cannot delete knowledge base. ${agentsUsingKB} agent(s) are using it.`,
      400
    );
  }

  // Soft delete
  await prisma.knowledgeBase.update({
    where: { id: kbId },
    data: { deletedAt: new Date() },
  });

  return { success: true };
}

interface CreateDocumentInput {
  knowledgeBaseId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  metadata?: any;
  tags?: string[];
}

export async function createDocument(input: CreateDocumentInput) {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: input.knowledgeBaseId, deletedAt: null },
  });

  if (!kb) {
    throw new KnowledgeBaseError("Knowledge base not found", 404);
  }

  // Create document with PENDING status
  const document = await prisma.document.create({
    data: {
      knowledgeBaseId: input.knowledgeBaseId,
      title: input.title,
      content: input.content,
      sourceUrl: input.sourceUrl,
      metadata: input.metadata,
      tags: input.tags || [],
      status: "PROCESSING",
    },
  });

  // Process document asynchronously
  processDocument(document.id, kb.chunkSize, kb.chunkOverlap, kb.embeddingModel).catch((error) => {
    console.error("Document processing error:", error);
    prisma.document.update({
      where: { id: document.id },
      data: {
        status: "FAILED",
        errorMessage: error.message,
      },
    });
  });

  return document;
}

export async function processDocument(
  documentId: string,
  chunkSize: number,
  chunkOverlap: number,
  embeddingModel: string
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) return;

  try {
    // Split content into chunks
    const chunks = splitTextIntoChunks(document.content, chunkSize, chunkOverlap);

    // Generate embeddings and save chunks one by one
    // We can't use createMany because pgvector doesn't support it
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const embedding = await generateEmbedding(chunk.text, embeddingModel);
      
      // Convert embedding array to pgvector string format: '[0.1, 0.2, ...]'
      const vectorString = `[${embedding.join(',')}]`;
      
      // Insert with raw SQL to use pgvector
      await prisma.$executeRaw`
        INSERT INTO "document_chunks" (
          "id", "documentId", "content", "embedding", 
          "chunkIndex", "startChar", "endChar", "metadata", "createdAt"
        ) VALUES (
          gen_random_uuid()::text,
          ${document.id},
          ${chunk.text},
          ${vectorString}::vector(1536),
          ${index},
          ${chunk.startChar},
          ${chunk.endChar},
          ${JSON.stringify({ chunkLength: chunk.text.length })}::jsonb,
          NOW()
        )
      `;
    }

    // Update document status
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "COMPLETED",
        chunkCount: chunks.length,
      },
    });
  } catch (error: any) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "FAILED",
        errorMessage: error.message,
      },
    });
    throw error;
  }
}

function splitTextIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number
): Array<{ text: string; startChar: number; endChar: number }> {
  const chunks: Array<{ text: string; startChar: number; endChar: number }> = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunkText = text.slice(start, end);

    chunks.push({
      text: chunkText,
      startChar: start,
      endChar: end,
    });

    start += chunkSize - overlap;
  }

  return chunks;
}

async function generateEmbedding(text: string, model: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: model,
    input: text,
  });

  return response.data[0].embedding;
}

export async function searchKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  limit: number = 5
): Promise<Array<{ content: string; score: number; documentTitle: string; sourceUrl: string | null; chunkId: string }>> {
  // Generate embedding for query
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id: knowledgeBaseId },
  });

  if (!kb) {
    throw new KnowledgeBaseError("Knowledge base not found", 404);
  }

  const queryEmbedding = await generateEmbedding(query, kb.embeddingModel);
  const vectorString = `[${queryEmbedding.join(',')}]`;

  // Use pgvector for efficient cosine similarity search
  // The <=> operator computes cosine distance (1 - cosine similarity)
  // We order by distance ASC to get most similar chunks first
  const results = await prisma.$queryRaw<
    Array<{
      id: string;
      content: string;
      distance: number;
      title: string;
      sourceUrl: string | null;
    }>
  >`
    SELECT 
      dc.id,
      dc.content,
      dc.embedding <=> ${vectorString}::vector(1536) as distance,
      d.title,
      d."sourceUrl"
    FROM "document_chunks" dc
    INNER JOIN "documents" d ON dc."documentId" = d.id
    WHERE d."knowledgeBaseId" = ${knowledgeBaseId}
      AND d.status = 'COMPLETED'
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${vectorString}::vector(1536)
    LIMIT ${limit}
  `;

  // Convert distance to similarity score (1 - distance)
  // Since cosine distance = 1 - cosine similarity
  return results.map((result) => ({
    chunkId: result.id,
    content: result.content,
    score: 1 - result.distance, // Convert distance back to similarity
    documentTitle: result.title,
    sourceUrl: result.sourceUrl,
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export async function getDocument(documentId: string, workspaceId: string) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      knowledgeBase: {
        workspaceId,
      },
    },
    include: {
      knowledgeBase: {
        select: {
          id: true,
          name: true,
        },
      },
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          content: true,
        },
        orderBy: {
          chunkIndex: "asc",
        },
      },
    },
  });

  if (!document) {
    throw new KnowledgeBaseError("Document not found", 404);
  }

  return document;
}

export async function deleteDocument(documentId: string, workspaceId: string) {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      knowledgeBase: {
        workspaceId,
      },
    },
  });

  if (!document) {
    throw new KnowledgeBaseError("Document not found", 404);
  }

  // Delete chunks first
  await prisma.documentChunk.deleteMany({
    where: { documentId },
  });

  // Delete document
  await prisma.document.delete({
    where: { id: documentId },
  });

  return { success: true };
}
