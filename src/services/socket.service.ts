import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { prisma } from '../lib/prisma';
import jwt from 'jsonwebtoken';
import logger from '../lib/logger';
import { env } from '../lib/env';

interface SocketData {
  conversationId?: string;
  userId?: string;
  visitorId?: string;
}

class SocketService {
  private io: SocketIOServer | null = null;
  private activeTyping: Map<string, Set<string>> = new Map(); // conversationId -> Set of socketIds

  initialize(httpServer: HTTPServer) {
    // Socket.io CORS configuration - secure in production
    const allowedOrigins = env.NODE_ENV === 'development'
      ? '*' // Allow all in development
      : [env.BETTER_AUTH_URL]; // Production: only allow auth URL

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Authentication middleware (optional - allows anonymous visitors)
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        // If token provided, verify it
        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.BETTER_AUTH_SECRET!) as any;
            
            // Load user data
            const user = await prisma.user.findUnique({
              where: { id: decoded.userId || decoded.sub },
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
                workspaceMemberships: {
                  select: { workspaceId: true, role: true }
                }
              }
            });

            if (user) {
              socket.data.user = user;
              socket.data.userId = user.id;
            }
          } catch (error) {
            // Invalid token, but allow connection for visitors
            logger.warn('Invalid token, allowing as visitor', { error: (error as Error)?.message });
          }
        }
        
        // Allow connection (with or without auth)
        next();
      } catch (error) {
        logger.error('Socket auth middleware error', { error: (error as Error)?.message });
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      logger.info('Socket connected', { socketId: socket.id });
      
      // If user is authenticated, join their user room for direct messages
      if (socket.data.userId) {
        socket.join(`user:${socket.data.userId}`);
        logger.info('User joined personal room', { userId: socket.data.userId });
      }

      // Handle join workspace (for agents to receive notifications)
      socket.on('join:workspace', async (data: { workspaceId: string }) => {
        try {
          const { workspaceId } = data;
          
          // Only authenticated users can join workspace rooms
          if (!socket.data.userId) {
            socket.emit('error', { message: 'Authentication required' });
            return;
          }
          
          // Verify user has access to workspace
          const membership = await prisma.workspaceMember.findFirst({
            where: {
              workspaceId,
              userId: socket.data.userId,
              deletedAt: null
            }
          });
          
          if (!membership) {
            socket.emit('error', { message: 'Not a member of this workspace' });
            return;
          }
          
          // Join workspace room
          socket.join(`workspace:${workspaceId}`);
          
          logger.info('Socket joined workspace', {
            socketId: socket.id,
            userId: socket.data.userId,
            workspaceId
          });
          
          // Send confirmation
          socket.emit('workspace:joined', {
            workspaceId,
            timestamp: new Date()
          });
        } catch (error) {
          logger.error('Error joining workspace', {
            error: (error as Error)?.message,
            socketId: socket.id
          });
          socket.emit('error', { message: 'Failed to join workspace' });
        }
      });
      
      // Handle authentication and join conversation
      socket.on('join:conversation', async (data: { conversationId: string; visitorId?: string }) => {
        try {
          const { conversationId, visitorId } = data;

          // Verify conversation exists
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { widget: true }
          });

          if (!conversation) {
            socket.emit('error', { message: 'Conversation not found' });
            return;
          }

          // Store conversation data
          socket.data = {
            conversationId,
            visitorId
          } as SocketData;

          // Join conversation room
          socket.join(`conversation:${conversationId}`);

          // Notify room that someone joined
          socket.to(`conversation:${conversationId}`).emit('user:joined', {
            socketId: socket.id,
            timestamp: new Date()
          });

          // Send confirmation
          socket.emit('conversation:joined', {
            conversationId,
            timestamp: new Date()
          });

          logger.info('Socket joined conversation', { socketId: socket.id, conversationId });
        } catch (error) {
          logger.error('Error joining conversation', { error: (error as Error)?.message, socketId: socket.id });
          socket.emit('error', { message: 'Failed to join conversation' });
        }
      });

      // Handle new message
      socket.on('message:send', async (data: { conversationId: string; content: string; metadata?: any }) => {
        try {
          const { conversationId, content, metadata } = data;
          const socketData = socket.data as SocketData;

          // Verify socket is in conversation
          if (socketData.conversationId !== conversationId) {
            socket.emit('error', { message: 'Not authorized for this conversation' });
            return;
          }

          // Message will be created by REST API, socket just broadcasts the event
          // Emit to all clients in conversation including sender
          this.io!.to(`conversation:${conversationId}`).emit('message:received', {
            conversationId,
            content,
            metadata,
            timestamp: new Date(),
            socketId: socket.id
          });

          // Stop typing indicator for this user
          this.stopTyping(conversationId, socket.id);
        } catch (error) {
          logger.error('Error sending message', { error: (error as Error)?.message, socketId: socket.id });
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle typing indicator
      socket.on('typing:start', (data: { conversationId: string }) => {
        try {
          const { conversationId } = data;
          const socketData = socket.data as SocketData;

          if (socketData.conversationId !== conversationId) {
            return;
          }

          this.startTyping(conversationId, socket.id);

          // Broadcast to others in conversation
          socket.to(`conversation:${conversationId}`).emit('typing:start', {
            socketId: socket.id,
            timestamp: new Date()
          });
        } catch (error) {
          logger.error('Error starting typing', { error: (error as Error)?.message, socketId: socket.id });
        }
      });

      socket.on('typing:stop', (data: { conversationId: string }) => {
        try {
          const { conversationId } = data;
          const socketData = socket.data as SocketData;

          if (socketData.conversationId !== conversationId) {
            return;
          }

          this.stopTyping(conversationId, socket.id);

          // Broadcast to others in conversation
          socket.to(`conversation:${conversationId}`).emit('typing:stop', {
            socketId: socket.id,
            timestamp: new Date()
          });
        } catch (error) {
          logger.error('Error stopping typing', { error: (error as Error)?.message, socketId: socket.id });
        }
      });

      // Handle agent online status
      socket.on('agent:online', async (data: { agentId: string; workspaceId: string }) => {
        try {
          const { agentId, workspaceId } = data;

          // Broadcast to workspace room
          socket.join(`workspace:${workspaceId}`);
          this.io!.to(`workspace:${workspaceId}`).emit('agent:status', {
            agentId,
            status: 'online',
            timestamp: new Date()
          });
        } catch (error) {
          logger.error('Error setting agent online', { error: (error as Error)?.message, socketId: socket.id });
        }
      });

      socket.on('agent:offline', async (data: { agentId: string; workspaceId: string }) => {
        try {
          const { agentId, workspaceId } = data;

          // Broadcast to workspace room
          this.io!.to(`workspace:${workspaceId}`).emit('agent:status', {
            agentId,
            status: 'offline',
            timestamp: new Date()
          });
        } catch (error) {
          logger.error('Error setting agent offline', { error: (error as Error)?.message, socketId: socket.id });
        }
      });

      // Handle conversation close
      socket.on('conversation:close', async (data: { conversationId: string }) => {
        try {
          const { conversationId } = data;
          const socketData = socket.data as SocketData;

          if (socketData.conversationId !== conversationId) {
            socket.emit('error', { message: 'Not authorized for this conversation' });
            return;
          }

          // Broadcast to all in conversation
          this.io!.to(`conversation:${conversationId}`).emit('conversation:closed', {
            conversationId,
            timestamp: new Date()
          });

          // Leave room
          socket.leave(`conversation:${conversationId}`);
        } catch (error) {
          logger.error('Error closing conversation', { error: (error as Error)?.message, socketId: socket.id });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        const socketData = socket.data as SocketData;
        
        if (socketData?.conversationId) {
          // Clean up typing indicators
          this.stopTyping(socketData.conversationId, socket.id);

          // Notify room
          socket.to(`conversation:${socketData.conversationId}`).emit('user:left', {
            socketId: socket.id,
            timestamp: new Date()
          });
        }

        // CRITICAL: Remove all listeners to prevent memory leak
        socket.removeAllListeners();

        logger.info('Socket disconnected', { socketId: socket.id });
      });
    });

    // Listen to media events (from media.service) to avoid circular dependency
    this.setupMediaEventListeners();

    logger.info('Socket.io initialized');
  }

  // Broadcast new message to conversation
  broadcastMessage(conversationId: string, message: any) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('message:new', {
      ...message,
      timestamp: new Date()
    });
  }

  // Broadcast AI response started
  broadcastAIResponseStarted(conversationId: string) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('ai:thinking', {
      conversationId,
      timestamp: new Date()
    });
  }

  // Broadcast AI response completed
  broadcastAIResponseCompleted(conversationId: string, message: any) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('ai:response', {
      ...message,
      timestamp: new Date()
    });
  }

  // Broadcast agent assignment
  broadcastAgentAssigned(conversationId: string, agentId: string) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('agent:assigned', {
      conversationId,
      agentId,
      timestamp: new Date()
    });
  }
  
  // Notify online agents in workspace that human handoff was requested
  notifyHumanAgentRequested(workspaceId: string, data: {
    conversationId: string;
    visitorName: string;
    lastMessage: string;
  }) {
    if (!this.io) return;
    
    this.io.to(`workspace:${workspaceId}`).emit('conversation:human-requested', {
      ...data,
      timestamp: new Date()
    });
    
    logger.info('Human agent request notification sent', {
      workspaceId,
      conversationId: data.conversationId
    });
  }

  // Broadcast media attachment uploaded
  broadcastMediaAttachment(conversationId: string, attachment: any) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('media:uploaded', {
      conversationId,
      attachment,
      timestamp: new Date()
    });
  }

  // Broadcast media upload progress (for large files)
  broadcastMediaProgress(conversationId: string, data: {
    messageId: string;
    fileName: string;
    progress: number; // 0-100
    uploaded: number; // bytes
    total: number; // bytes
  }) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('media:progress', {
      conversationId,
      ...data,
      timestamp: new Date()
    });
  }

  // Broadcast media processing (e.g., thumbnail generation, compression)
  broadcastMediaProcessing(conversationId: string, data: {
    attachmentId: string;
    status: 'processing' | 'completed' | 'failed';
    message?: string;
  }) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('media:processing', {
      conversationId,
      ...data,
      timestamp: new Date()
    });
  }

  // Broadcast media deleted
  broadcastMediaDeleted(conversationId: string, attachmentId: string) {
    if (!this.io) return;
    
    this.io.to(`conversation:${conversationId}`).emit('media:deleted', {
      conversationId,
      attachmentId,
      timestamp: new Date()
    });
  }

  // Helper methods for typing indicators
  private startTyping(conversationId: string, socketId: string) {
    if (!this.activeTyping.has(conversationId)) {
      this.activeTyping.set(conversationId, new Set());
    }
    this.activeTyping.get(conversationId)!.add(socketId);
  }

  private stopTyping(conversationId: string, socketId: string) {
    const typing = this.activeTyping.get(conversationId);
    if (typing) {
      typing.delete(socketId);
      if (typing.size === 0) {
        this.activeTyping.delete(conversationId);
      }
    }
  }

  getIO(): SocketIOServer | null {
    return this.io;
  }
  
  // Emit event to specific user by userId
  emitToUser(userId: string, event: string, data: any) {
    if (!this.io) return;
    
    this.io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  // Setup listeners for media events (avoids circular dependency)
  private setupMediaEventListeners() {
    // Import media events dynamically to break circular dependency
    import('../services/media.service').then(({ mediaEvents }) => {
      mediaEvents.on('media:uploaded', ({ conversationId, attachment }) => {
        this.broadcastMediaAttachment(conversationId, attachment);
      });

      mediaEvents.on('media:deleted', ({ conversationId, attachmentId }) => {
        this.broadcastMediaDeleted(conversationId, attachmentId);
      });

      logger.info('Media event listeners registered');
    }).catch(error => {
      logger.error('Failed to setup media event listeners', { error: error.message });
    });
  }
}

export default new SocketService();
