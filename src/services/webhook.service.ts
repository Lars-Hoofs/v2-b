import axios from 'axios';
import { prisma } from '../lib/prisma';
import crypto from 'crypto';
import logger from '../lib/logger';

export interface WebhookEvent {
  event: string;
  data: any;
  timestamp: Date;
  workspaceId: string;
}

/**
 * Send webhook to workspace URL
 */
export async function sendWebhook(
  workspaceId: string,
  event: string,
  data: any
): Promise<void> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        webhookUrl: true,
        webhookSecret: true,
        webhookEvents: true,
      },
    });

    if (!workspace?.webhookUrl) {
      return; // No webhook configured
    }

    // Check if this event is enabled
    const enabledEvents = (workspace.webhookEvents as string[]) || [];
    if (enabledEvents.length > 0 && !enabledEvents.includes(event)) {
      return; // Event not enabled
    }

    const payload: WebhookEvent = {
      event,
      data,
      timestamp: new Date(),
      workspaceId,
    };

    // Generate HMAC signature for verification
    const signature = crypto
      .createHmac('sha256', workspace.webhookSecret || 'default-secret')
      .update(JSON.stringify(payload))
      .digest('hex');

    // Send webhook
    await axios.post(workspace.webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': event,
        'User-Agent': 'AI-Chat-Platform/1.0',
      },
      timeout: 5000, // 5 second timeout
    });

    logger.info('Webhook sent successfully', { event, workspaceId });
  } catch (error: any) {
    logger.error('Webhook delivery failed', { event, workspaceId, error: error.message });
    // Don't throw - webhooks should not break main flow
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

/**
 * Webhook events available
 */
export const WEBHOOK_EVENTS = {
  // Conversations
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_ASSIGNED: 'conversation.assigned',
  CONVERSATION_RESOLVED: 'conversation.resolved',
  CONVERSATION_RATED: 'conversation.rated',
  
  // Messages
  MESSAGE_RECEIVED: 'message.received',
  HUMAN_HANDOFF_REQUESTED: 'human_handoff.requested',
  
  // Agent
  AGENT_ONLINE: 'agent.online',
  AGENT_OFFLINE: 'agent.offline',
  
  // Quality
  LOW_SATISFACTION: 'quality.low_satisfaction',
  HIGH_WAIT_TIME: 'quality.high_wait_time',
} as const;

/**
 * Get all available webhook events with descriptions
 */
export function getAvailableWebhookEvents() {
  return [
    {
      event: WEBHOOK_EVENTS.CONVERSATION_CREATED,
      description: 'Triggered when a new conversation is started',
    },
    {
      event: WEBHOOK_EVENTS.CONVERSATION_ASSIGNED,
      description: 'Triggered when a conversation is assigned to a human agent',
    },
    {
      event: WEBHOOK_EVENTS.CONVERSATION_RESOLVED,
      description: 'Triggered when a conversation is resolved/closed',
    },
    {
      event: WEBHOOK_EVENTS.CONVERSATION_RATED,
      description: 'Triggered when a visitor rates a conversation',
    },
    {
      event: WEBHOOK_EVENTS.MESSAGE_RECEIVED,
      description: 'Triggered when a new message is received from a visitor',
    },
    {
      event: WEBHOOK_EVENTS.HUMAN_HANDOFF_REQUESTED,
      description: 'Triggered when AI requests human handoff or agent takes over',
    },
    {
      event: WEBHOOK_EVENTS.AGENT_ONLINE,
      description: 'Triggered when an agent comes online',
    },
    {
      event: WEBHOOK_EVENTS.AGENT_OFFLINE,
      description: 'Triggered when an agent goes offline',
    },
    {
      event: WEBHOOK_EVENTS.LOW_SATISFACTION,
      description: 'Triggered when a conversation receives low satisfaction rating (≤2)',
    },
    {
      event: WEBHOOK_EVENTS.HIGH_WAIT_TIME,
      description: 'Triggered when conversation wait time exceeds threshold',
    },
  ];
}
