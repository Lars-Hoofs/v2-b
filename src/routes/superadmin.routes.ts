import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";
import { z } from "zod";

const router = Router();

// Middleware to check if user is superadmin
const requireSuperAdmin = async (req: AuthRequest, res: any, next: any) => {
  console.log('[SuperAdmin] User check:', {
    userId: req.user?.id,
    email: req.user?.email,
    role: req.user?.role,
    userObject: req.user
  });
  
  if (!req.user) {
    return res.status(403).json({ error: "Authentication required" });
  }
  
  // If role is not available in session, fetch from database
  if (!req.user.role) {
    try {
      const userWithRole = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true }
      });
      console.log('[SuperAdmin] Fetched role from DB:', userWithRole?.role);
      req.user.role = userWithRole?.role || 'user';
    } catch (error) {
      console.error('[SuperAdmin] Error fetching user role:', error);
      return res.status(500).json({ error: "Failed to verify user permissions" });
    }
  }
  
  if (req.user.role !== 'admin') {
    console.log('[SuperAdmin] Access denied - role:', req.user.role);
    return res.status(403).json({ 
      error: "Super admin access required",
      currentRole: req.user.role,
      requiredRole: "admin"
    });
  }
  
  console.log('[SuperAdmin] Access granted for user:', req.user.email);
  next();
};

// Get all users with their workspaces
router.get("/users", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        ownedWorkspaces: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
          },
        },
        workspaceMemberships: {
          include: {
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        _count: {
          select: {
            assignedConversations: true,
            messages: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(users);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get all workspaces with details
router.get("/workspaces", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            agents: true,
            widgets: true,
            conversations: true,
            knowledgeBases: true,
            workflows: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(workspaces);
  } catch (error) {
    console.error("Get workspaces error:", error);
    res.status(500).json({ error: "Failed to fetch workspaces" });
  }
});

// Get all agents across all workspaces
router.get("/agents", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const agents = await prisma.agent.findMany({
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            owner: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        knowledgeBase: {
          select: {
            id: true,
            name: true,
          },
        },
        workflow: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            widgets: true,
            conversations: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(agents);
  } catch (error) {
    console.error("Get agents error:", error);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

// Get all knowledge bases
router.get("/knowledge-bases", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const knowledgeBases = await prisma.knowledgeBase.findMany({
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            owner: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            documents: true,
            agents: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(knowledgeBases);
  } catch (error) {
    console.error("Get knowledge bases error:", error);
    res.status(500).json({ error: "Failed to fetch knowledge bases" });
  }
});

// Get all workflows
router.get("/workflows", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const workflows = await prisma.workflow.findMany({
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            owner: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            agents: true,
            nodes: true,
            executions: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(workflows);
  } catch (error) {
    console.error("Get workflows error:", error);
    res.status(500).json({ error: "Failed to fetch workflows" });
  }
});

// Get all widgets
router.get("/widgets", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const widgets = await prisma.widget.findMany({
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            owner: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            conversations: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(widgets);
  } catch (error) {
    console.error("Get widgets error:", error);
    res.status(500).json({ error: "Failed to fetch widgets" });
  }
});

// Get all conversations across all workspaces
router.get("/conversations", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            owner: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100, // Limit to latest 100 conversations for performance
    });

    res.json(conversations);
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// User management routes
const updateUserSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(["user", "admin"]).optional(),
  banned: z.boolean().optional(),
  banReason: z.string().optional(),
});

// Update user
router.put("/users/:userId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const data = updateUserSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      include: {
        ownedWorkspaces: {
          select: {
            id: true,
            name: true,
          },
        },
        workspaceMemberships: {
          select: {
            workspace: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.json(user);
  } catch (error: any) {
    console.error("Update user error:", error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete user (soft delete)
router.delete("/users/:userId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    // Check if user owns any workspaces
    const ownedWorkspaces = await prisma.workspace.count({
      where: { ownerId: userId, deletedAt: null },
    });

    if (ownedWorkspaces > 0) {
      return res.status(400).json({ 
        error: "Cannot delete user who owns workspaces. Transfer ownership first." 
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { 
        deletedAt: new Date(),
        banned: true,
        banReason: "Account deleted by superadmin",
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete user error:", error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Get platform stats
router.get("/stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalWorkspaces,
      totalAgents,
      totalConversations,
      totalKnowledgeBases,
      totalWorkflows,
      totalWidgets,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ 
        where: { 
          deletedAt: null, 
          lastSeenAt: { 
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Active in last 7 days
          } 
        } 
      }),
      prisma.workspace.count({ where: { deletedAt: null } }),
      prisma.agent.count({ where: { deletedAt: null } }),
      prisma.conversation.count(),
      prisma.knowledgeBase.count({ where: { deletedAt: null } }),
      prisma.workflow.count({ where: { deletedAt: null } }),
      prisma.widget.count({ where: { deletedAt: null } }),
    ]);

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      workspaces: totalWorkspaces,
      agents: totalAgents,
      conversations: totalConversations,
      knowledgeBases: totalKnowledgeBases,
      workflows: totalWorkflows,
      widgets: totalWidgets,
    });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;