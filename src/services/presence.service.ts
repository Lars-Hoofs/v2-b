import { prisma } from "../lib/prisma";

export class PresenceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "PresenceError";
  }
}

export type UserStatus = "online" | "offline" | "away";

export interface AwayMessage {
  [language: string]: string;
}

/**
 * Set user status (online, offline, away)
 */
export async function setUserStatus(
  userId: string,
  status: UserStatus,
  awayMessage?: AwayMessage
) {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        status,
        lastSeenAt: new Date(),
        ...(status === "away" && awayMessage ? { awayMessage } : {}),
        ...(status !== "away" ? { awayMessage: null } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        lastSeenAt: true,
        awayMessage: true,
      },
    });

    return user;
  } catch (error: any) {
    console.error("Set user status error:", error);
    throw new PresenceError("Failed to update user status", 500);
  }
}

/**
 * Get user status
 */
export async function getUserStatus(userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        lastSeenAt: true,
        awayMessage: true,
      },
    });

    if (!user) {
      throw new PresenceError("User not found", 404);
    }

    return user;
  } catch (error: any) {
    if (error instanceof PresenceError) throw error;
    console.error("Get user status error:", error);
    throw new PresenceError("Failed to get user status", 500);
  }
}

/**
 * Get all online users in a workspace
 */
export async function getWorkspaceOnlineUsers(workspaceId: string) {
  try {
    const users = await prisma.user.findMany({
      where: {
        status: "online",
        workspaceMemberships: {
          some: {
            workspaceId,
            deletedAt: null,
          },
        },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        status: true,
        lastSeenAt: true,
      },
    });

    return users;
  } catch (error: any) {
    console.error("Get workspace online users error:", error);
    throw new PresenceError("Failed to get online users", 500);
  }
}

/**
 * Get count of online users in workspace
 */
export async function getWorkspaceOnlineCount(workspaceId: string) {
  try {
    const count = await prisma.user.count({
      where: {
        status: "online",
        workspaceMemberships: {
          some: {
            workspaceId,
            deletedAt: null,
          },
        },
        deletedAt: null,
      },
    });

    return count;
  } catch (error: any) {
    console.error("Get workspace online count error:", error);
    throw new PresenceError("Failed to get online count", 500);
  }
}

/**
 * Auto-update user last seen timestamp
 */
export async function updateLastSeen(userId: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  } catch (error: any) {
    console.error("Update last seen error:", error);
    // Don't throw error, this is a non-critical operation
  }
}

/**
 * Set all users to offline (e.g., on server restart)
 */
export async function resetAllUsersToOffline() {
  try {
    await prisma.user.updateMany({
      where: { status: { in: ["online", "away"] } },
      data: { status: "offline" },
    });
  } catch (error: any) {
    console.error("Reset users to offline error:", error);
  }
}
