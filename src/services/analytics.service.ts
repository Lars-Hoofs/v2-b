import { prisma } from '../lib/prisma';

export interface AnalyticsMetrics {
  overview: {
    totalConversations: number;
    activeConversations: number;
    resolvedConversations: number;
    aiAutomationRate: number; // % without human intervention
  };
  performance: {
    avgResponseTime: number; // in seconds
    avgResolutionTime: number; // in seconds
    avgMessagesPerConversation: number;
    avgCustomerSatisfaction: number; // 1-5
  };
  trends: {
    conversationsToday: number;
    conversationsThisWeek: number;
    conversationsThisMonth: number;
    conversationsChange: number; // % change vs last period
  };
  topQuestions: Array<{
    question: string;
    count: number;
  }>;
  agentPerformance: Array<{
    agentId: string;
    agentName: string;
    conversationsHandled: number;
    avgResponseTime: number;
    satisfaction: number;
  }>;
}

/**
 * Get analytics metrics for workspace
 */
export async function getWorkspaceAnalytics(
  workspaceId: string,
  startDate?: Date,
  endDate?: Date
): Promise<AnalyticsMetrics> {
  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
  const end = endDate || new Date();

  // Overview metrics
  const totalConversations = await prisma.conversation.count({
    where: {
      workspaceId,
      createdAt: { gte: start, lte: end },
      deletedAt: null,
    },
  });

  const activeConversations = await prisma.conversation.count({
    where: {
      workspaceId,
      status: { in: ['ACTIVE', 'WAITING'] },
      deletedAt: null,
    },
  });

  const resolvedConversations = await prisma.conversation.count({
    where: {
      workspaceId,
      status: 'RESOLVED',
      createdAt: { gte: start, lte: end },
      deletedAt: null,
    },
  });

  // AI automation rate (conversations without human assignment)
  const automatedConversations = await prisma.conversation.count({
    where: {
      workspaceId,
      assignedToId: null,
      createdAt: { gte: start, lte: end },
      deletedAt: null,
    },
  });

  const aiAutomationRate = totalConversations > 0
    ? (automatedConversations / totalConversations) * 100
    : 0;

  // Response time metrics
  const conversations = await prisma.conversation.findMany({
    where: {
      workspaceId,
      createdAt: { gte: start, lte: end },
      deletedAt: null,
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 2,
      },
      _count: {
        select: { messages: true },
      },
    },
  });

  let totalResponseTime = 0;
  let totalResolutionTime = 0;
  let totalMessages = 0;
  let validResponseTimes = 0;

  conversations.forEach(conv => {
    // Calculate first response time
    if (conv.messages.length >= 2) {
      const firstUserMsg = conv.messages[0];
      const firstBotMsg = conv.messages[1];
      if (firstUserMsg && firstBotMsg) {
        const responseTime = (firstBotMsg.createdAt.getTime() - firstUserMsg.createdAt.getTime()) / 1000;
        totalResponseTime += responseTime;
        validResponseTimes++;
      }
    }

    // Calculate resolution time
    if (conv.resolvedAt) {
      const resolutionTime = (conv.resolvedAt.getTime() - conv.createdAt.getTime()) / 1000;
      totalResolutionTime += resolutionTime;
    }

    totalMessages += conv._count.messages;
  });

  const avgResponseTime = validResponseTimes > 0
    ? totalResponseTime / validResponseTimes
    : 0;

  const avgResolutionTime = resolvedConversations > 0
    ? totalResolutionTime / resolvedConversations
    : 0;

  const avgMessagesPerConversation = totalConversations > 0
    ? totalMessages / totalConversations
    : 0;

  // Customer satisfaction
  const satisfactionData = await prisma.conversation.aggregate({
    where: {
      workspaceId,
      rating: { not: null },
      createdAt: { gte: start, lte: end },
      deletedAt: null,
    },
    _avg: {
      rating: true,
    },
  });

  const avgCustomerSatisfaction = satisfactionData._avg.rating || 0;

  // Trends
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const conversationsToday = await prisma.conversation.count({
    where: {
      workspaceId,
      createdAt: { gte: today },
      deletedAt: null,
    },
  });

  const conversationsThisWeek = await prisma.conversation.count({
    where: {
      workspaceId,
      createdAt: { gte: thisWeek },
      deletedAt: null,
    },
  });

  const conversationsThisMonth = await prisma.conversation.count({
    where: {
      workspaceId,
      createdAt: { gte: thisMonth },
      deletedAt: null,
    },
  });

  // Previous period for comparison
  const lastMonthStart = new Date(thisMonth.getTime() - 30 * 24 * 60 * 60 * 1000);
  const lastMonthConversations = await prisma.conversation.count({
    where: {
      workspaceId,
      createdAt: { gte: lastMonthStart, lt: thisMonth },
      deletedAt: null,
    },
  });

  const conversationsChange = lastMonthConversations > 0
    ? ((conversationsThisMonth - lastMonthConversations) / lastMonthConversations) * 100
    : 0;

  // Top questions (first user message in conversations)
  const firstMessages = await prisma.message.findMany({
    where: {
      conversation: {
        workspaceId,
        createdAt: { gte: start, lte: end },
        deletedAt: null,
      },
      role: 'USER',
    },
    select: {
      content: true,
      conversationId: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  // Group by similar questions (simplified - just count exact matches)
  const questionCounts = new Map<string, number>();
  const seenConversations = new Set<string>();

  firstMessages.forEach(msg => {
    if (!seenConversations.has(msg.conversationId)) {
      seenConversations.add(msg.conversationId);
      const question = msg.content.trim().toLowerCase();
      questionCounts.set(question, (questionCounts.get(question) || 0) + 1);
    }
  });

  const topQuestions = Array.from(questionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([question, count]) => ({ question, count }));

  // Agent performance
  const agentStats = await prisma.user.findMany({
    where: {
      assignedConversations: {
        some: {
          workspaceId,
          createdAt: { gte: start, lte: end },
          deletedAt: null,
        },
      },
    },
    select: {
      id: true,
      name: true,
      assignedConversations: {
        where: {
          workspaceId,
          createdAt: { gte: start, lte: end },
          deletedAt: null,
        },
        include: {
          messages: {
            where: { role: 'AGENT' },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      },
    },
  });

  const agentPerformance = agentStats.map(agent => {
    const conversations = agent.assignedConversations;
    let totalAgentResponseTime = 0;
    let validResponseTimes = 0;
    let totalRating = 0;
    let ratedConversations = 0;

    conversations.forEach(conv => {
      // Calculate agent response time (time to first agent message after assignment)
      if (conv.messages.length > 0) {
        const firstAgentMsg = conv.messages[0];
        const timeDiff = (firstAgentMsg.createdAt.getTime() - conv.createdAt.getTime()) / 1000;
        if (timeDiff > 0 && timeDiff < 3600) { // Only count if < 1 hour
          totalAgentResponseTime += timeDiff;
          validResponseTimes++;
        }
      }

      // Calculate satisfaction
      if (conv.rating) {
        totalRating += conv.rating;
        ratedConversations++;
      }
    });

    return {
      agentId: agent.id,
      agentName: agent.name || 'Unknown',
      conversationsHandled: conversations.length,
      avgResponseTime: validResponseTimes > 0 ? totalAgentResponseTime / validResponseTimes : 0,
      satisfaction: ratedConversations > 0 ? totalRating / ratedConversations : 0,
    };
  });

  return {
    overview: {
      totalConversations,
      activeConversations,
      resolvedConversations,
      aiAutomationRate: Math.round(aiAutomationRate * 10) / 10,
    },
    performance: {
      avgResponseTime: Math.round(avgResponseTime * 10) / 10,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      avgMessagesPerConversation: Math.round(avgMessagesPerConversation * 10) / 10,
      avgCustomerSatisfaction: Math.round(avgCustomerSatisfaction * 10) / 10,
    },
    trends: {
      conversationsToday,
      conversationsThisWeek,
      conversationsThisMonth,
      conversationsChange: Math.round(conversationsChange * 10) / 10,
    },
    topQuestions,
    agentPerformance,
  };
}

/**
 * Get real-time dashboard stats
 */
export async function getRealtimeStats(workspaceId: string) {
  const [
    activeConversations,
    waitingForAgent,
    onlineAgents,
    avgWaitTime
  ] = await Promise.all([
    // Active conversations
    prisma.conversation.count({
      where: {
        workspaceId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    }),
    
    // Waiting for human agent
    prisma.conversation.count({
      where: {
        workspaceId,
        status: 'WAITING',
        deletedAt: null,
      },
    }),
    
    // Online agents
    prisma.user.count({
      where: {
        status: 'online',
        workspaceMemberships: {
          some: {
            workspaceId,
            deletedAt: null,
          },
        },
      },
    }),
    
    // Average wait time for waiting conversations
    prisma.conversation.findMany({
      where: {
        workspaceId,
        status: 'WAITING',
        deletedAt: null,
      },
      select: {
        createdAt: true,
      },
    }),
  ]);

  const now = Date.now();
  const totalWaitTime = avgWaitTime.reduce((sum, conv) => {
    return sum + (now - conv.createdAt.getTime());
  }, 0);

  const avgWaitTimeSeconds = avgWaitTime.length > 0
    ? (totalWaitTime / avgWaitTime.length) / 1000
    : 0;

  return {
    activeConversations,
    waitingForAgent,
    onlineAgents,
    avgWaitTime: Math.round(avgWaitTimeSeconds * 10) / 10,
  };
}
