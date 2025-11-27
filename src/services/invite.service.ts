import { prisma } from "../lib/prisma";
import { WorkspaceRole, InviteStatus, AuditAction } from "@prisma/client";
import { nanoid } from "nanoid";
import { createAuditLog } from "./audit.service";
import { WorkspaceError } from "./workspace.service";

interface CreateInviteInput {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedById: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function createInvite(input: CreateInviteInput) {
  const { workspaceId, email, role, invitedById, ipAddress, userAgent } = input;

  // Check if inviter has permission
  const inviter = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: invitedById,
      deletedAt: null,
      role: {
        in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN],
      },
    },
  });

  if (!inviter) {
    throw new WorkspaceError("Only workspace owners and admins can invite members", 403);
  }

  // Check if user is already a member
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    const existingMember = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: existingUser.id,
        deletedAt: null,
      },
    });

    if (existingMember) {
      throw new WorkspaceError("User is already a member of this workspace", 409);
    }
  }

  // Check for pending invites
  const pendingInvite = await prisma.workspaceInvite.findFirst({
    where: {
      workspaceId,
      email,
      status: InviteStatus.PENDING,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (pendingInvite) {
    throw new WorkspaceError("An invite is already pending for this email", 409);
  }

  // Create invite with 7-day expiration
  const token = nanoid(32);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId,
      email,
      token,
      role,
      invitedById,
      expiresAt,
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      invitedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.INVITE_SENT,
    userId: invitedById,
    workspaceId,
    metadata: { email, role, inviteId: invite.id },
    ipAddress,
    userAgent,
  });

  return invite;
}

export async function getInvite(token: string) {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { token },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
        },
      },
      invitedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!invite) {
    throw new WorkspaceError("Invite not found", 404);
  }

  if (invite.status !== InviteStatus.PENDING) {
    throw new WorkspaceError(`Invite has been ${invite.status.toLowerCase()}`, 400);
  }

  if (invite.expiresAt < new Date()) {
    // Update status to expired
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: InviteStatus.EXPIRED },
    });
    throw new WorkspaceError("Invite has expired", 400);
  }

  return invite;
}

export async function acceptInvite(
  token: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const invite = await getInvite(token);

  // Verify email matches
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.email !== invite.email) {
    throw new WorkspaceError("This invite is for a different email address", 403);
  }

  // Check if already a member
  const existingMember = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: invite.workspaceId,
      userId,
      deletedAt: null,
    },
  });

  if (existingMember) {
    throw new WorkspaceError("You are already a member of this workspace", 409);
  }

  // Create membership and update invite status in transaction
  const result = await prisma.$transaction([
    prisma.workspaceMember.create({
      data: {
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
      },
    }),
    prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: InviteStatus.ACCEPTED },
    }),
  ]);

  // Create audit log
  await createAuditLog({
    action: AuditAction.INVITE_ACCEPTED,
    userId,
    workspaceId: invite.workspaceId,
    metadata: { inviteId: invite.id, role: invite.role },
    ipAddress,
    userAgent,
  });

  await createAuditLog({
    action: AuditAction.MEMBER_JOINED,
    userId,
    workspaceId: invite.workspaceId,
    metadata: { role: invite.role },
    ipAddress,
    userAgent,
  });

  return result[0];
}

export async function declineInvite(
  token: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const invite = await getInvite(token);

  // Verify email matches
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.email !== invite.email) {
    throw new WorkspaceError("This invite is for a different email address", 403);
  }

  await prisma.workspaceInvite.update({
    where: { id: invite.id },
    data: { status: InviteStatus.DECLINED },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.INVITE_DECLINED,
    userId,
    workspaceId: invite.workspaceId,
    metadata: { inviteId: invite.id },
    ipAddress,
    userAgent,
  });

  return { success: true };
}

export async function revokeInvite(
  inviteId: string,
  userId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { id: inviteId },
  });

  if (!invite) {
    throw new WorkspaceError("Invite not found", 404);
  }

  // Check if user has permission
  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: invite.workspaceId,
      userId,
      deletedAt: null,
      role: {
        in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN],
      },
    },
  });

  if (!member) {
    throw new WorkspaceError("Only workspace owners and admins can revoke invites", 403);
  }

  await prisma.workspaceInvite.update({
    where: { id: inviteId },
    data: { status: InviteStatus.REVOKED },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.INVITE_REVOKED,
    userId,
    workspaceId: invite.workspaceId,
    metadata: { inviteId, email: invite.email },
    ipAddress,
    userAgent,
  });

  return { success: true };
}

export async function getWorkspaceInvites(workspaceId: string, userId: string) {
  // Check if user has permission
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
    throw new WorkspaceError("Only workspace owners and admins can view invites", 403);
  }

  return prisma.workspaceInvite.findMany({
    where: { workspaceId },
    include: {
      invitedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function removeMember(
  workspaceId: string,
  memberUserId: string,
  requesterId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  });

  if (!workspace) {
    throw new WorkspaceError("Workspace not found", 404);
  }

  // Cannot remove the owner
  if (workspace.ownerId === memberUserId) {
    throw new WorkspaceError("Cannot remove workspace owner", 400);
  }

  // Check if requester has permission
  const requester = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: requesterId,
      deletedAt: null,
      role: {
        in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN],
      },
    },
  });

  if (!requester) {
    throw new WorkspaceError("Only workspace owners and admins can remove members", 403);
  }

  // Soft delete the member
  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: memberUserId,
      deletedAt: null,
    },
  });

  if (!member) {
    throw new WorkspaceError("Member not found", 404);
  }

  await prisma.workspaceMember.update({
    where: { id: member.id },
    data: { deletedAt: new Date() },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.MEMBER_REMOVED,
    userId: requesterId,
    workspaceId,
    metadata: { removedUserId: memberUserId },
    ipAddress,
    userAgent,
  });

  return { success: true };
}

export async function updateMemberRole(
  workspaceId: string,
  memberUserId: string,
  newRole: WorkspaceRole,
  requesterId: string,
  ipAddress?: string,
  userAgent?: string
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  });

  if (!workspace) {
    throw new WorkspaceError("Workspace not found", 404);
  }

  // Cannot change owner's role
  if (workspace.ownerId === memberUserId) {
    throw new WorkspaceError("Cannot change workspace owner's role", 400);
  }

  // Only owner can change roles
  if (workspace.ownerId !== requesterId) {
    throw new WorkspaceError("Only workspace owner can change member roles", 403);
  }

  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: memberUserId,
      deletedAt: null,
    },
  });

  if (!member) {
    throw new WorkspaceError("Member not found", 404);
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: member.id },
    data: { role: newRole },
  });

  // Create audit log
  await createAuditLog({
    action: AuditAction.MEMBER_ROLE_CHANGED,
    userId: requesterId,
    workspaceId,
    metadata: {
      targetUserId: memberUserId,
      oldRole: member.role,
      newRole,
    },
    ipAddress,
    userAgent,
  });

  return updated;
}
