import { prisma } from "../lib/prisma";
import { AuditAction } from "@prisma/client";
import { createAuditLog } from "./audit.service";
import { checkUserCanBeDeleted, getUserOwnedWorkspaces } from "./workspace.service";

export class UserError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "UserError";
  }
}

export async function deleteUser(
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  // Check if user owns any active workspaces
  const canDelete = await checkUserCanBeDeleted(userId);

  if (!canDelete) {
    const ownedWorkspaces = await getUserOwnedWorkspaces(userId);
    throw new UserError(
      `Cannot delete user. Please delete or transfer ownership of these workspaces first: ${ownedWorkspaces.map((w) => w.name).join(", ")}`,
      400
    );
  }

  // Soft delete user
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });

  // Delete all sessions
  await prisma.session.deleteMany({
    where: { userId },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.USER_DELETED,
    userId,
    metadata: { deletedAt: new Date().toISOString() },
    ipAddress,
    userAgent,
  });

  return { success: true };
}

export async function getUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      image: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new UserError("User not found", 404);
  }

  return user;
}

export async function updateUser(
  userId: string,
  data: { name?: string; image?: string },
  ipAddress?: string,
  userAgent?: string
) {
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      image: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.USER_UPDATED,
    userId,
    metadata: data,
    ipAddress,
    userAgent,
  });

  return user;
}
