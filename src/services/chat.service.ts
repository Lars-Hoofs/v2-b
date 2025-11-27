import { prisma } from "../lib/prisma";
import { nanoid } from "nanoid";
import OpenAI from "openai";
import socketService from "./socket.service";
import * as webhookService from "./webhook.service";
import * as workflowExecutor from "./workflowExecutor.service";
import * as presenceService from "./presence.service";
import logger from '../lib/logger';

export class ChatError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "ChatError";
  }
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface StartConversationInput {
  widgetId: string;
  visitorId?: string;
  visitorName?: string;
  visitorEmail?: string;
  visitorMetadata?: any;
}

export async function startConversation(input: StartConversationInput) {
  const widget = await prisma.widget.findFirst({
    where: {
      id: input.widgetId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      agent: true,
    },
  });

  if (!widget) {
    throw new ChatError("Widget not found or inactive", 404);
  }

  // Generate visitor ID if not provided
  const visitorId = input.visitorId || `visitor_${nanoid(12)}`;

  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: widget.workspaceId,
      widgetId: widget.id,
      agentId: widget.agentId,
      visitorId,
      visitorName: input.visitorName,
      visitorEmail: input.visitorEmail,
      visitorMetadata: input.visitorMetadata,
      source: "web",
    },
    include: {
      agent: {
        include: {
          workflow: true,
        },
      },
      widget: true,
    },
  });

  // Send greeting message if configured
  if (widget.greeting) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: widget.greeting,
      },
    });
  }

  // Initialize workflow if agent has one
  if (conversation.agent?.workflowId) {
    try {
      logger.info('Initializing workflow for conversation', {
        conversationId: conversation.id,
        workflowId: conversation.agent.workflowId,
      });
      
      await workflowExecutor.initializeWorkflowForConversation(
        conversation.id,
        conversation.agent.workflowId,
        {
          visitorName: conversation.visitorName,
          visitorEmail: conversation.visitorEmail,
          source: conversation.source,
        }
      );
      
      logger.info('Workflow initialized successfully', {
        conversationId: conversation.id,
        workflowId: conversation.agent.workflowId,
      });
    } catch (error: any) {
      logger.error('Failed to initialize workflow', {
        error: error?.message,
        stack: error?.stack,
        conversationId: conversation.id,
        workflowId: conversation.agent.workflowId,
      });
      // Continue without workflow - but log it prominently
    }
  } else {
    logger.info('No workflow assigned to agent', {
      conversationId: conversation.id,
      agentId: conversation.agentId,
    });
  }

  // Send webhook for new conversation
  await webhookService.sendWebhook(
    widget.workspaceId,
    webhookService.WEBHOOK_EVENTS.CONVERSATION_CREATED,
    {
      conversationId: conversation.id,
      visitorName: conversation.visitorName,
      visitorEmail: conversation.visitorEmail,
      source: conversation.source,
    }
  );

  return conversation;
}

export async function getConversation(conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
      agent: true,
      widget: true,
    },
  });

  if (!conversation) {
    throw new ChatError("Conversation not found", 404);
  }

  return conversation;
}

export async function getConversationMessages(
  conversationId: string,
  page: number = 1,
  pageSize: number = 50
) {
  const skip = (page - 1) * pageSize;
  
  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      skip,
      take: pageSize,
    }),
    prisma.message.count({
      where: { conversationId },
    }),
  ]);

  return {
    messages,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasMore: skip + messages.length < total,
    },
  };
}

interface SendMessageInput {
  conversationId: string;
  content: string;
  role?: "USER" | "AGENT";
  senderId?: string;
  currentPageUrl?: string; // URL of page user is on
}

export async function sendMessage(input: SendMessageInput) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
    },
    include: {
      agent: {
        include: {
          knowledgeBase: true,
          workflow: true,
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 20, // Last 20 messages for context
      },
      assignedTo: true,
    },
  });

  if (!conversation) {
    throw new ChatError("Conversation not found", 404);
  }

  // If message is from an AGENT (human agent via dashboard), check if they are assigned
  if (input.role === "AGENT") {
    if (!conversation.assignedToId) {
      throw new ChatError("You must be assigned to this conversation before sending messages", 403);
    }
    
    // Check if the sender is the assigned agent
    if (input.senderId && conversation.assignedToId !== input.senderId) {
      throw new ChatError("Only the assigned agent can send messages to this conversation", 403);
    }
  }

  // Save user message
  const userMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: input.role || "USER",
      content: input.content,
      senderId: input.senderId,
      metadata: input.currentPageUrl ? { currentPageUrl: input.currentPageUrl } : null,
    },
  });
  
  // Debug: Log URL storage
  if (input.currentPageUrl) {
    console.log('🌐 Stored currentPageUrl:', input.currentPageUrl, 'for conversation:', conversation.id);
  }

  // Broadcast message via Socket.io
  socketService.broadcastMessage(conversation.id, userMessage);

  // Update conversation lastMessageAt
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  // Send webhook for new message from user
  if (input.role !== "AGENT") {
    await webhookService.sendWebhook(
      conversation.workspaceId,
      webhookService.WEBHOOK_EVENTS.MESSAGE_RECEIVED,
      {
        conversationId: conversation.id,
        messageId: userMessage.id,
        message: userMessage.content,
        visitorName: conversation.visitorName,
      }
    );
  }

  // If message is from an AGENT (dashboard user), don't generate AI response
  if (input.role === "AGENT") {
    return { userMessage, aiMessage: null };
  }

  // Check if user is requesting a human agent
  const isRequestingHuman = detectHumanAgentRequest(input.content);
  
  if (isRequestingHuman) {
    logger.info('User requesting human agent', { conversationId: conversation.id });
    
    // Check availability
    const availability = await checkAgentAvailability(
      conversation.workspaceId,
      conversation.widgetId
    );
    
    if (!availability.available) {
      // No agents available - send configured message
      const offlineMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: availability.message,
          metadata: { source: "agent_unavailable", reason: availability.reason },
        },
      });
      
      socketService.broadcastMessage(conversation.id, offlineMessage);
      return { userMessage, aiMessage: offlineMessage };
    } else {
      // Agents are available - mark conversation as WAITING and notify agents
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { 
          status: "WAITING",
          visibleInDashboard: true // Make visible when human agent is requested
        },
      });
      
      // Notify all online agents in the workspace via Socket.io
      socketService.notifyHumanAgentRequested(conversation.workspaceId, {
        conversationId: conversation.id,
        visitorName: conversation.visitorName || "Anonymous",
        lastMessage: input.content,
      });
      
      // Send message to user
      const notificationMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: "Een moment, ik verbind je door met een beschikbare medewerker...",
          metadata: { source: "agent_connecting" },
        },
      });
      
      socketService.broadcastMessage(conversation.id, notificationMessage);
      
      // Send webhook
      await webhookService.sendWebhook(
        conversation.workspaceId,
        webhookService.WEBHOOK_EVENTS.HUMAN_HANDOFF_REQUESTED,
        {
          conversationId: conversation.id,
          visitorName: conversation.visitorName,
          lastMessage: input.content,
        }
      );
      
      return { userMessage, aiMessage: notificationMessage };
    }
  }
  
  // If human agent has taken over, don't generate AI response for customer messages
  if (conversation.assignedToId) {
    return { userMessage, aiMessage: null };
  }

  // Check if workflow is handling this message (only for USER messages)
  const isUserMessage = !input.role || input.role === "USER";
  if (isUserMessage && conversation.agent?.workflowId) {
    logger.info('Checking workflow for message', {
      conversationId: conversation.id,
      workflowId: conversation.agent.workflowId,
    });
    
    let workflowResult = await workflowExecutor.handleMessageInWorkflow(
      conversation.id,
      input.content,
      { currentPageUrl: input.currentPageUrl }
    );
    
    // If workflow returned null but workflow should be running, try to reinitialize
    if (workflowResult === null) {
      logger.warn('Workflow returned null - attempting recovery', {
        conversationId: conversation.id,
        workflowId: conversation.agent.workflowId,
      });
      
      try {
        await workflowExecutor.initializeWorkflowForConversation(
          conversation.id,
          conversation.agent.workflowId,
          {
            visitorName: conversation.visitorName,
            visitorEmail: conversation.visitorEmail,
            source: conversation.source,
            recoveryMode: true,
          }
        );
        
        logger.info('Workflow recovery successful, retrying message', {
          conversationId: conversation.id,
        });
        
        // Try again with newly initialized workflow
        workflowResult = await workflowExecutor.handleMessageInWorkflow(
          conversation.id,
          input.content,
          { currentPageUrl: input.currentPageUrl }
        );
      } catch (error: any) {
        logger.error('Workflow recovery failed', {
          conversationId: conversation.id,
          error: error?.message,
        });
      }
    }

    if (workflowResult?.shouldRespond) {
      // Workflow wants to send a response (e.g., validation error)
      const errorMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "AGENT",
          content: workflowResult.response || "Error processing your request",
          metadata: { source: "workflow_validation" },
        },
      });

      socketService.broadcastMessage(conversation.id, errorMessage);
      return { userMessage, aiMessage: errorMessage };
    }

    if (workflowResult?.continueWorkflow) {
      // Workflow is handling the message, don't generate AI response
      logger.info('Workflow is handling message', { conversationId: conversation.id });
      return { userMessage, aiMessage: null };
    }
  }

  // Check if agent blocks competitor questions
  if (conversation.agent?.blockCompetitorQuestions && detectCompetitorQuestion(input.content)) {
    const competitorBlockMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "Sorry, ik kan geen informatie geven over andere bedrijven of concurrenten. Ik kan je wel helpen met vragen over onze eigen producten en diensten!",
        metadata: { source: "competitor_block" },
      },
    });
    
    socketService.broadcastMessage(conversation.id, competitorBlockMessage);
    return { userMessage, aiMessage: competitorBlockMessage };
  }

  // Broadcast AI thinking indicator
  socketService.broadcastAIResponseStarted(conversation.id);

  // Generate AI response with page context
  const aiMessage = await generateAIResponse(conversation, input.content, input.currentPageUrl);

  // Broadcast AI response
  if (aiMessage) {
    socketService.broadcastAIResponseCompleted(conversation.id, aiMessage);
  }

  return { userMessage, aiMessage };
}

async function generateAIResponse(conversation: any, userMessage: string, currentPageUrl?: string) {
  const agent = conversation.agent;
  const startTime = Date.now();

  try {
    // Get page-specific context if user is on a specific page
    let pageContext = "";
    let pageSources: any[] = [];
    
    if (currentPageUrl && agent.knowledgeBaseId) {
      const { getPageContext } = await import("./scraper.service");
      try {
        const context = await getPageContext(currentPageUrl, agent.knowledgeBaseId);
        if (context) {
          pageContext = `\n\nContext from current page (${currentPageUrl}):\n${context.content}\n`;
          pageSources = context.sources;
        }
      } catch (error) {
        console.error("Page context error:", error);
      }
    }
    
    // Search knowledge base if agent has one
    let kbContext = "";
    let kbSources: any[] = [];
    
    if (agent.knowledgeBaseId) {
      const { searchKnowledgeBase } = await import("./knowledgeBase.service");
      try {
        const results = await searchKnowledgeBase(agent.knowledgeBaseId, userMessage, 3);
        if (results.length > 0) {
          kbContext = "\n\nRelevant information from knowledge base:\n" + 
            results.map((r, i) => `Source ${i + 1}: ${r.content}`).join("\n");
          
          // Extract sources with URLs
          kbSources = results.map((r, i) => ({
            id: i + 1,
            content: r.content.substring(0, 200),
            documentTitle: r.documentTitle,
            sourceUrl: r.sourceUrl,
            score: r.score,
          }));
        }
      } catch (error) {
        console.error("KB search error:", error);
      }
    }

    // Build conversation history with page and KB context
    const systemPrompt = agent.systemPrompt + pageContext + kbContext + 
      "\n\nIMPORTANT: When answering, if you use information from the sources, mention which source you used (e.g., 'According to the current page...' or 'Based on Source 1...')";
    
    const messages: any[] = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Add conversation history
    conversation.messages.forEach((msg: any) => {
      if (msg.role === "USER") {
        messages.push({ role: "user", content: msg.content });
      } else if (msg.role === "ASSISTANT") {
        messages.push({ role: "assistant", content: msg.content });
      }
    });

    // Add current message
    messages.push({ role: "user", content: userMessage });

    // Call OpenAI (or other LLM based on agent.aiModel)
    const response = await openai.chat.completions.create({
      model: agent.aiModel,
      messages,
      temperature: agent.temperature,
      max_tokens: agent.maxTokens,
    });

    const aiResponse = response.choices[0].message.content || agent.fallbackMessage || "I'm sorry, I couldn't generate a response.";
    const tokens = response.usage?.total_tokens || 0;
    const latency = Date.now() - startTime;

    // Save AI message with sources
    const aiMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: aiResponse,
        metadata: {
          model: agent.aiModel,
          finishReason: response.choices[0].finish_reason,
          sources: [...pageSources, ...kbSources],
          currentPageUrl,
        },
        tokens,
        latency,
      },
    });

    return aiMessage;
  } catch (error: any) {
    console.error("AI response error:", error);

    // Save fallback message
    return prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: agent.fallbackMessage || "I'm experiencing technical difficulties. Please try again.",
        metadata: {
          error: error.message,
        },
        latency: Date.now() - startTime,
      },
    });
  }
}

export async function assignConversationToHuman(
  conversationId: string,
  userId: string
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new ChatError("Conversation not found", 404);
  }

  // Get the agent/user information to include their name
  const agent = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      assignedToId: userId,
      status: "ACTIVE",
      visibleInDashboard: true, // Ensure visible when agent takes over
    },
  });

  // Broadcast agent assignment
  socketService.broadcastAgentAssigned(conversationId, userId);

  // Send system message with agent name
  const agentName = agent?.name || "A support agent";
  const systemMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "SYSTEM",
      content: `${agentName} has joined the conversation.`,
    },
  });

  // Broadcast system message
  socketService.broadcastMessage(conversationId, systemMessage);

  // Send webhook for human handoff
  await webhookService.sendWebhook(
    conversation.workspaceId,
    webhookService.WEBHOOK_EVENTS.HUMAN_HANDOFF_REQUESTED,
    {
      conversationId: conversation.id,
      assignedToId: userId,
      visitorName: conversation.visitorName,
    }
  );

  return { success: true };
}

export async function resolveConversation(
  conversationId: string,
  rating?: number,
  feedback?: string
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new ChatError("Conversation not found", 404);
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      rating,
      feedback,
    },
  });

  // Send webhook for resolved conversation
  await webhookService.sendWebhook(
    conversation.workspaceId,
    webhookService.WEBHOOK_EVENTS.CONVERSATION_RESOLVED,
    {
      conversationId: conversation.id,
      visitorName: conversation.visitorName,
      rating,
      feedback,
    }
  );

  // Send webhook if rating is provided
  if (rating) {
    await webhookService.sendWebhook(
      conversation.workspaceId,
      webhookService.WEBHOOK_EVENTS.CONVERSATION_RATED,
      {
        conversationId: conversation.id,
        rating,
        feedback,
      }
    );

    // Send low satisfaction webhook if rating <= 2
    if (rating <= 2) {
      await webhookService.sendWebhook(
        conversation.workspaceId,
        webhookService.WEBHOOK_EVENTS.LOW_SATISFACTION,
        {
          conversationId: conversation.id,
          rating,
          feedback,
          visitorName: conversation.visitorName,
        }
      );
    }
  }

  return { success: true };
}

export async function getWorkspaceConversations(
  workspaceId: string,
  filters?: {
    status?: string;
    agentId?: string;
    assignedToId?: string;
  }
) {
  const where: any = {
    workspaceId,
    visibleInDashboard: true, // Only show conversations where human agent was requested
    ...(filters?.agentId && { agentId: filters.agentId }),
    ...(filters?.assignedToId && { assignedToId: filters.assignedToId }),
  };

  if (filters?.status) {
    if (filters.status === 'open') {
      where.status = { not: 'RESOLVED' };
    } else if (filters.status !== 'all') {
      where.status = filters.status.toUpperCase();
    }
  }

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
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
      // Get all messages to find URL and last message
      messages: {
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true,
          content: true,
          role: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      lastMessageAt: "desc",
    },
  });

  // Transform conversations to include currentPageUrl and lastMessage
  return conversations.map(conv => {
    let currentPageUrl = null;
    const lastMessage = conv.messages[0]; // First message in desc order = most recent
    
    // Find the most recent message with a URL (check all messages)
    for (const message of conv.messages) {
      if (message.role === 'USER' && message.metadata && typeof message.metadata === 'object') {
        const metadata = message.metadata as any;
        if (metadata.currentPageUrl) {
          currentPageUrl = metadata.currentPageUrl;
          console.log('🔍 Found URL for conversation', conv.id, ':', currentPageUrl);
          break; // Found the most recent URL, stop looking
        }
      }
    }
    
    return {
      ...conv,
      currentPageUrl,
      messageCount: conv._count.messages,
      lastMessage: lastMessage ? {
        content: lastMessage.content,
        sender: lastMessage.role.toLowerCase(),
      } : undefined,
      // Remove the messages array and _count to match expected interface
      messages: undefined,
      _count: undefined,
    };
  });
}

/**
 * Detect if user message is requesting a human agent
 */
function detectHumanAgentRequest(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  const patterns = [
    // Dutch
    /\b(wil|kan|mag)\s+(ik\s+)?(graag\s+)?(met\s+)?(een\s+)?medewerker\b/i,
    /\bmedewerker\s+spreken\b/i,
    /\becht\s+iemand\b/i,
    /\bmens\s+spreken\b/i,
    /\blevend\s+persoon\b/i,
    /\becht\s+persoon\b/i,
    // English
    /\bhuman\s+agent\b/i,
    /\breal\s+person\b/i,
    /\bspeak\s+(to|with)\s+(a\s+)?human\b/i,
    /\btalk\s+to\s+(a\s+)?(human|person|agent|representative)\b/i,
    /\bconnect\s+(me\s+)?(to|with)\s+(a\s+)?(human|agent|representative)\b/i,
    /\btransfer\s+(me\s+)?(to|with)\s+(a\s+)?(human|agent)\b/i,
    /\bcustomer\s+(service|support)\b/i,
  ];
  
  return patterns.some(pattern => pattern.test(lowerMessage));
}

/**
 * Detect if user question is about competitors
 */
function detectCompetitorQuestion(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  const patterns = [
    // Dutch
    /\bconcurrent(en|ie)?\b/i,
    /\bandere\s+(bedrijven|partijen|leveranciers|aanbieders)\b/i,
    /\bvergelijk(en|ing)?\s+(met|tussen)\b/i,
    /\b(wat|waarom)\s+(zijn|is)\s+jullie\s+beter\s+dan\b/i,
    /\bverschil\s+(tussen|met)\b/i,
    // English
    /\bcompetitor(s)?\b/i,
    /\bother\s+(companies|businesses|vendors|providers)\b/i,
    /\bcompare\s+(to|with|against)\b/i,
    /\bwhy\s+(are\s+you|is\s+\w+)\s+better\s+than\b/i,
    /\bdifference\s+(between|with)\b/i,
    /\balternative(s)?\s+to\b/i,
    /\bvs\b/i,
    /\bversus\b/i,
  ];
  
  return patterns.some(pattern => pattern.test(lowerMessage));
}

/**
 * Check if human agents are available
 */
async function checkAgentAvailability(
  workspaceId: string,
  widgetId: string | null
): Promise<{ available: boolean; reason?: string; message: string }> {
  // Get widget configuration if widgetId is provided
  let widget = null;
  if (widgetId) {
    widget = await prisma.widget.findUnique({
      where: { id: widgetId },
      select: {
        aiOnlyMode: true,
        aiOnlyMessage: true,
        workingHours: true,
        holidays: true,
      },
    });
  }
  
  // Check AI-only mode
  if (widget?.aiOnlyMode) {
    const message = (widget.aiOnlyMessage as any)?.nl || 
      "Sorry, op dit moment zijn er geen medewerkers beschikbaar. Ik help je graag verder!";
    return {
      available: false,
      reason: "ai_only_mode",
      message,
    };
  }
  
  // Check holidays
  if (widget?.holidays) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const holidays = widget.holidays as any[];
    const isHoliday = holidays.some((h: any) => h.date === today);
    
    if (isHoliday) {
      return {
        available: false,
        reason: "holiday",
        message: "Sorry, vandaag is het een feestdag. We zijn gesloten. Ik help je graag verder!",
      };
    }
  }
  
  // Check working hours
  if (widget?.workingHours) {
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[now.getDay()];
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
    
    const workingHours = widget.workingHours as any;
    const todayHours = workingHours[currentDay];
    
    if (!todayHours?.enabled || currentTime < todayHours.start || currentTime > todayHours.end) {
      return {
        available: false,
        reason: "outside_working_hours",
        message: "Sorry, we zijn op dit moment buiten onze werktijden. Ik help je graag verder!",
      };
    }
  }
  
  // Check if there are online agents
  const onlineCount = await presenceService.getWorkspaceOnlineCount(workspaceId);
  
  if (onlineCount === 0) {
    return {
      available: false,
      reason: "no_agents_online",
      message: "Sorry, er zijn momenteel geen medewerkers online. Ik help je graag verder!",
    };
  }
  
  return {
    available: true,
    message: "Een medewerker neemt zo contact met je op.",
  };
}
