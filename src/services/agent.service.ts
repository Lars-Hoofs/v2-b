import { prisma } from "../lib/prisma";
import { nanoid } from "nanoid";

export class AgentError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "AgentError";
  }
}

interface CreateAgentInput {
  workspaceId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  aiModel?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  personality?: any;
  fallbackMessage?: string;
  knowledgeBaseId?: string;
  workflowId?: string;
  customFunctions?: any;
}

export async function createAgent(input: CreateAgentInput) {
  // Check workspace access
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: input.workspaceId,
      deletedAt: null,
    },
  });

  if (!workspace) {
    throw new AgentError("Workspace not found", 404);
  }

  const agent = await prisma.agent.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      avatarUrl: input.avatarUrl,
      aiModel: input.aiModel || "gpt-4o-mini",
      temperature: input.temperature ?? 0.7,
      maxTokens: input.maxTokens || 1000,
      systemPrompt: input.systemPrompt,
      personality: input.personality,
      fallbackMessage: input.fallbackMessage,
      knowledgeBaseId: input.knowledgeBaseId,
      workflowId: input.workflowId,
      customFunctions: input.customFunctions,
    },
    include: {
      workspace: {
        select: { id: true, name: true },
      },
      knowledgeBase: {
        select: { id: true, name: true },
      },
      workflow: {
        select: { id: true, name: true },
      },
    },
  });

  return agent;
}

export async function getAgent(agentId: string, workspaceId: string) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId,
      deletedAt: null,
    },
    include: {
      knowledgeBase: true,
      workflow: {
        include: {
          nodes: true,
          edges: true,
        },
      },
      _count: {
        select: {
          conversations: true,
          widgets: true,
        },
      },
    },
  });

  if (!agent) {
    throw new AgentError("Agent not found", 404);
  }

  return agent;
}

export async function getWorkspaceAgents(workspaceId: string) {
  return prisma.agent.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    include: {
      knowledgeBase: {
        select: { id: true, name: true },
      },
      workflow: {
        select: { id: true, name: true, isActive: true },
      },
      _count: {
        select: {
          conversations: true,
          widgets: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function updateAgent(
  agentId: string,
  workspaceId: string,
  data: Partial<CreateAgentInput>
) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!agent) {
    throw new AgentError("Agent not found", 404);
  }

  return prisma.agent.update({
    where: { id: agentId },
    data: {
      ...data,
    },
  });
}

export async function deleteAgent(agentId: string, workspaceId: string) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!agent) {
    throw new AgentError("Agent not found", 404);
  }

  // Check if agent has active widgets
  const activeWidgets = await prisma.widget.count({
    where: {
      agentId,
      isActive: true,
      deletedAt: null,
    },
  });

  if (activeWidgets > 0) {
    throw new AgentError(
      `Cannot delete agent. ${activeWidgets} active widget(s) are using this agent. Please deactivate or delete them first.`,
      400
    );
  }

  // Soft delete
  await prisma.agent.update({
    where: { id: agentId },
    data: { deletedAt: new Date(), isActive: false },
  });

  return { success: true };
}

export async function toggleAgentStatus(
  agentId: string,
  workspaceId: string,
  isActive: boolean
) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!agent) {
    throw new AgentError("Agent not found", 404);
  }

  return prisma.agent.update({
    where: { id: agentId },
    data: { isActive },
  });
}
