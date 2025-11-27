import { prisma } from "../lib/prisma";
import { WorkspaceRole, AuditAction } from "@prisma/client";
import { nanoid } from "nanoid";
import { createAuditLog } from "./audit.service";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  description?: string;
}

export async function createWorkspace(input: CreateWorkspaceInput) {
  const { name, slug, description, ownerId, ipAddress, userAgent } = input;

  const existing = await prisma.workspace.findFirst({
    where: { slug, deletedAt: null },
  });

  if (existing) {
    throw new WorkspaceError("Workspace slug already exists", 409);
  }

  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug,
      description,
      ownerId,
      members: {
        create: {
          userId: ownerId,
          role: WorkspaceRole.OWNER,
        },
      },
    },
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      },
      members: {
        where: { deletedAt: null },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
            },
          },
        },
      },
    },
  });

  await createAuditLog({
    action: AuditAction.WORKSPACE_CREATED,
    userId: ownerId,
    workspaceId: workspace.id,
    metadata: { name, slug },
    ipAddress,
    userAgent,
  });

  return workspace;
}

export async function getWorkspace(workspaceId: string, userId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      deletedAt: null,
    },
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      },
      members: {
        where: { deletedAt: null },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
            },
          },
        },
      },
      _count: {
        select: {
          members: true,
        },
      },
    },
  });

  if (!workspace) {
    throw new WorkspaceError("Workspace not found", 404);
  }

  const isMember = workspace.members.some((m) => m.userId === userId);
  if (!isMember) {
    throw new WorkspaceError("Access denied", 403);
  }

  return workspace;
}

export async function getUserWorkspaces(userId: string) {
  const workspaces = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
      members: {
        some: {
          userId,
          deletedAt: null,
        },
      },
    },
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      },
      _count: {
        select: {
          members: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return workspaces;
}

export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  input: UpdateWorkspaceInput,
  ipAddress?: string,
  userAgent?: string
) {
  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId,
      deletedAt: null,
      role: {
        in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN],
      },
    },
  });

  if (!member) {
    throw new WorkspaceError("Only workspace owners and admins can update the workspace", 403);
  }

  if (input.slug) {
    const existing = await prisma.workspace.findFirst({
      where: {
        slug: input.slug,
        deletedAt: null,
        NOT: {
          id: workspaceId,
        },
      },
    });

    if (existing) {
      throw new WorkspaceError("Workspace slug already exists", 409);
    }
  }

  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: input,
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      },
    },
  });

  await createAuditLog({
    action: AuditAction.WORKSPACE_UPDATED,
    userId,
    workspaceId,
    metadata: input,
    ipAddress,
    userAgent,
  });

  return workspace;
}

export async function deleteWorkspace(
  workspaceId: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      deletedAt: null,
    },
  });

  if (!workspace) {
    throw new WorkspaceError("Workspace not found", 404);
  }

  if (workspace.ownerId !== userId) {
    throw new WorkspaceError("Only workspace owner can delete the workspace", 403);
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { deletedAt: new Date() },
  });

  await prisma.workspaceMember.updateMany({
    where: { workspaceId },
    data: { deletedAt: new Date() },
  });

  await createAuditLog({
    action: AuditAction.WORKSPACE_DELETED,
    userId,
    workspaceId,
    metadata: { workspaceName: workspace.name },
    ipAddress,
    userAgent,
  });

  return { success: true };
}

export async function checkUserCanBeDeleted(userId: string): Promise<boolean> {
  const ownedWorkspaces = await prisma.workspace.count({
    where: {
      ownerId: userId,
      deletedAt: null,
    },
  });

  return ownedWorkspaces === 0;
}

export async function getUserOwnedWorkspaces(userId: string) {
  return prisma.workspace.findMany({
    where: {
      ownerId: userId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });
}
