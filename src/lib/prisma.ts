import { PrismaClient } from "@prisma/client";
import logger from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Models WITHOUT deletedAt column (hard delete)
const MODELS_WITHOUT_SOFT_DELETE = new Set([
  'WorkflowNode',
  'WorkflowEdge', 
  'WorkflowExecution',
  'Document',
  'DocumentChunk',
  'ScrapeJob',
  'MediaAttachment',
  'AuditLog',
  'WorkspaceMember',
  'WorkspaceInvite',
  'Message',
]);

const prismaBase = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Soft delete extension for Prisma 6.x
export const prisma = prismaBase.$extends({
  query: {
    $allModels: {
      async findUnique({ model, operation, args, query }) {
        if (!MODELS_WITHOUT_SOFT_DELETE.has(model)) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findFirst({ model, operation, args, query }) {
        if (!MODELS_WITHOUT_SOFT_DELETE.has(model)) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findMany({ model, operation, args, query }) {
        if (!MODELS_WITHOUT_SOFT_DELETE.has(model)) {
          if (args.where) {
            if ((args.where as any).deletedAt === undefined) {
              (args.where as any).deletedAt = null;
            }
          } else {
            args.where = { deletedAt: null } as any;
          }
        }
        return query(args);
      },
      async delete({ model, operation, args, query }) {
        if (!MODELS_WITHOUT_SOFT_DELETE.has(model)) {
          return (prismaBase as any)[model].update({
            ...args,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
      async deleteMany({ model, operation, args, query }) {
        if (!MODELS_WITHOUT_SOFT_DELETE.has(model)) {
          return (prismaBase as any)[model].updateMany({
            ...args,
            data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
    },
  },
}) as any as PrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Log database connection
prisma.$connect()
  .then(() => logger.info('Database connected successfully'))
  .catch((error) => logger.error('Database connection error', { error }));
