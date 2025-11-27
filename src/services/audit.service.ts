import { prisma } from "../lib/prisma";
import { AuditAction } from "@prisma/client";

interface CreateAuditLogInput {
  action: AuditAction;
  userId?: string;
  workspaceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export async function createAuditLog(input: CreateAuditLogInput) {
  return prisma.auditLog.create({
    data: {
      action: input.action,
      userId: input.userId,
      workspaceId: input.workspaceId,
      metadata: input.metadata as any,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}

export async function getUserAuditLogs(userId: string, limit: number = 50) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getWorkspaceAuditLogs(workspaceId: string, limit: number = 50) {
  return prisma.auditLog.findMany({
    where: { workspaceId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
