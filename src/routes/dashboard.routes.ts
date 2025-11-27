import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import * as analyticsService from '../services/analytics.service';
import { prisma } from '../lib/prisma';
import socketService from '../services/socket.service';
import { z } from 'zod';

const router = Router();

// Get workspace analytics
router.get('/analytics', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId, startDate, endDate } = req.query;
    
    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId required' });
    }
    
    const analytics = await analyticsService.getWorkspaceAnalytics(
      workspaceId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    
    res.json(analytics);
  } catch (error: any) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get real-time dashboard stats
router.get('/realtime', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    
    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId required' });
    }
    
    const stats = await analyticsService.getRealtimeStats(workspaceId);
    res.json(stats);
  } catch (error: any) {
    console.error('Realtime stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set agent presence status
router.post('/presence', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { status, awayMessage } = req.body;
    const userId = req.user!.id;
    
    if (!['online', 'offline', 'away'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await prisma.user.update({
      where: { id: userId },
      data: {
        status,
        awayMessage: awayMessage || undefined,
        lastSeenAt: new Date()
      }
    });
    
    // Broadcast presence change via Socket.io
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        status: true,
        workspaceMemberships: {
          select: { workspaceId: true }
        }
      }
    });
    
    // Broadcast to all workspaces user is member of
    user?.workspaceMemberships.forEach(membership => {
      socketService.getIO()?.to(`workspace:${membership.workspaceId}`).emit('agent:status', {
        agentId: userId,
        agentName: user.name,
        status,
        timestamp: new Date()
      });
    });
    
    res.json({ success: true, status });
  } catch (error: any) {
    console.error('Presence error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get online agents for workspace
router.get('/agents', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId, status } = req.query;
    
    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId required' });
    }
    
    const agents = await prisma.user.findMany({
      where: {
        workspaceMemberships: {
          some: {
            workspaceId,
            deletedAt: null
          }
        },
        ...(status && { status: status as string })
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        status: true,
        lastSeenAt: true,
        workspaceMemberships: {
          where: { workspaceId },
          select: { role: true }
        }
      }
    });
    
    res.json(agents);
  } catch (error: any) {
    console.error('Get agents error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List conversations for team inbox
router.get('/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { 
      workspaceId, 
      status, 
      assignedTo, 
      page = '1', 
      pageSize = '20',
      search 
    } = req.query;
    
    if (!workspaceId || typeof workspaceId !== 'string') {
      return res.status(400).json({ error: 'workspaceId required' });
    }
    
    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
    const skip = (pageNum - 1) * pageSizeNum;
    
    // Build where clause
    const where: any = {
      workspaceId,
      deletedAt: null
    };
    
    if (status) {
      where.status = status;
    }
    
    if (assignedTo) {
      if (assignedTo === 'me') {
        where.assignedToId = req.user!.id;
      } else if (assignedTo === 'unassigned') {
        where.assignedToId = null;
      } else {
        where.assignedToId = assignedTo;
      }
    }
    
    if (search) {
      where.OR = [
        { visitorName: { contains: search as string, mode: 'insensitive' } },
        { visitorEmail: { contains: search as string, mode: 'insensitive' } }
      ];
    }
    
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          agent: {
            select: { id: true, name: true, avatarUrl: true }
          },
          assignedTo: {
            select: { id: true, name: true, image: true }
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          _count: {
            select: { messages: true }
          }
        },
        orderBy: {
          lastMessageAt: 'desc'
        },
        skip,
        take: pageSizeNum
      }),
      prisma.conversation.count({ where })
    ]);
    
    // Format response
    const formattedConversations = conversations.map(conv => ({
      id: conv.id,
      visitorName: conv.visitorName,
      visitorEmail: conv.visitorEmail,
      status: conv.status,
      agent: conv.agent,
      assignedTo: conv.assignedTo,
      messageCount: conv._count.messages,
      lastMessage: conv.messages[0]?.content || null,
      lastMessageAt: conv.lastMessageAt,
      createdAt: conv.createdAt,
      rating: conv.rating
    }));
    
    res.json({
      conversations: formattedConversations,
      pagination: {
        total,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil(total / pageSizeNum)
      }
    });
  } catch (error: any) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
