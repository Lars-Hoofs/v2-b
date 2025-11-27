import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { createServer } from "http";

// Load environment variables FIRST
dotenv.config();

// Then validate environment (this imports './lib/env' which validates)
import './lib/env'; 
import logger from './lib/logger';
import { requestLogger } from './middleware/requestLogger';
import { authLimiter, apiLimiter, scrapingLimiter, singlePageScrapeLimiter } from './middleware/rateLimits';
import { auth } from "./lib/auth";
// Set timeout to prevent hanging on circular dependencies
setTimeout(() => {
  if (!(global as any).serverStarted) {
    logger.warn('Server taking too long to start - possible circular dependency in imports');
    logger.info('Attempting to start server anyway...');
  }
}, 5000);

import workspaceRoutes from "./routes/workspace.routes";
import inviteRoutes from "./routes/invite.routes";
import userRoutes from "./routes/user.routes";
import authHelperRoutes from "./routes/auth-helper.routes";
import agentRoutes from "./routes/agent.routes";
import widgetRoutes from "./routes/widget.routes";
import chatRoutes from "./routes/chat.routes";
import workflowRoutes from "./routes/workflow.routes";
import knowledgeBaseRoutes from "./routes/knowledgeBase.routes";
// import mediaRoutes from "./routes/media.routes"; // Loaded dynamically to avoid circular dependency
import scraperRoutes from "./routes/scraper.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import presenceRoutes from "./routes/presence.routes";
import superadminRoutes from "./routes/superadmin.routes";
import { generateWidgetScript } from "./services/widget.service";
import socketService from "./services/socket.service";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // Allow cross-origin for widget.js to be embedded anywhere
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false,
}));

// CORS configuration - allow all in development
const allowedOrigins = [
  process.env.BETTER_AUTH_URL || "http://localhost:3000",
  "https://Ai.bonsaimedia.nl",
  "https://Api.bonsaimedia.nl"
];

app.use(cors({
  origin: (origin, callback) => {
    if (process.env.NODE_ENV === 'development' || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging middleware
app.use(requestLogger);

// Rate limiting (Redis-backed)
app.use("/api/", apiLimiter);

// Trust proxy - needed for rate limiting and IP logging
app.set("trust proxy", 1);

// Graceful shutdown flag
let isShuttingDown = false;

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  if (isShuttingDown) {
    return res.status(503).json({ 
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
    });
  }
  
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Better-auth routes - mount on /api/auth
app.use("/api/auth", authLimiter, auth.handler);
// Serve widget.js (PUBLIC) with explicit CORS headers
app.get("/widget.js", (req, res) => {
  // Explicit CORS headers for widget to work on ANY website
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", "application/javascript");
  res.send(generateWidgetScript());
});

// API routes - BASIC ONLY FOR NOW
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/invites", inviteRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth-helper", authHelperRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/widgets", widgetRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/knowledge-bases", knowledgeBaseRoutes);

// Load media routes dynamically to avoid circular dependency at startup
import("./routes/media.routes").then((module) => {
  app.use("/api/media", module.default);
  logger.info("Media routes loaded");
}).catch((error) => {
  logger.error("Failed to load media routes", { error: error.message });
});

// Scraper routes with special rate limiting
app.use("/api/scraper/scrape-website", scrapingLimiter);
app.use("/api/scraper/scrape-url", singlePageScrapeLimiter);
app.use("/api/scraper", scraperRoutes);

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/presence", presenceRoutes);
app.use("/api/superadmin", superadminRoutes);
// app.use("/api/dashboard", dashboardRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    message: "The requested resource does not exist",
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  logger.error('Request error', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  // Use AppError if available
  if (err.statusCode && err.code) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    });
  }

  // Generic error for unexpected issues
  const isDev = process.env.NODE_ENV === "development";
  res.status(err.statusCode || 500).json({
    error: 'INTERNAL_ERROR',
    message: isDev ? err.message : "An unexpected error occurred",
    ...(isDev && { stack: err.stack }),
  });
});

// Initialize Socket.io
socketService.initialize(httpServer);

// Start server
httpServer.listen(PORT, () => {
  (global as any).serverStarted = true;
  logger.info(`
🚀 AI Customer Support Platform (Sleek/Watermelon Clone)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Server running on port ${PORT}
✅ Environment: ${process.env.NODE_ENV || "development"}
✅ Health check: http://localhost:${PORT}/health
✅ Auth endpoint: http://localhost:${PORT}/api/auth
✅ API endpoint: http://localhost:${PORT}/api
✅ Socket.io: Real-time communication enabled

🤖 AI Features:
   • Agents: http://localhost:${PORT}/api/agents
   • Widgets: http://localhost:${PORT}/api/widgets
   • Chat: http://localhost:${PORT}/api/chat
   • Workflows: http://localhost:${PORT}/api/workflows
   • Knowledge Base: http://localhost:${PORT}/api/knowledge-bases
   • Widget Script: http://localhost:${PORT}/widget.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, starting graceful shutdown...`);

  // Stop accepting new connections
  httpServer.close(() => {
    logger.info('HTTP server closed');
  });

  // Give active requests 30 seconds to complete
  setTimeout(() => {
    logger.error('Forcefully shutting down after timeout');
    process.exit(1);
  }, 30000);

  try {
    // Close Socket.io connections
    logger.info('Closing Socket.io connections...');

    // Disconnect Prisma
    const { prisma } = await import('./lib/prisma');
    await prisma.$disconnect();
    logger.info('Database disconnected');

    // Close Redis connection
    const { closeRedis } = await import('./lib/redis');
    await closeRedis();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
