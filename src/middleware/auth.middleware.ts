import { Response, NextFunction } from "express";
import { Request } from "express-serve-static-core";
import "multer";
import { auth } from "../lib/auth";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string;
    emailVerified: boolean;
    role?: string;
  };
  session?: any;
  // @ts-ignore
  file?: Express.Multer.File;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    console.log('[Auth] Headers:', {
      cookie: req.headers.cookie?.substring(0, 100),
      authorization: req.headers.authorization?.substring(0, 50),
    });
    
    // Try cookie-based session first (Better Auth default)
    let session = await auth.api.getSession({
      headers: req.headers as any,
    });

    // If no session from cookies, try Bearer token (for Postman/API clients)
    if (!session) {
      const authHeader = req.headers.authorization;
      console.log('[Auth] No cookie session, checking Bearer token:', authHeader?.substring(0, 50));
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        console.log('[Auth] Using Bearer token:', token.substring(0, 20) + '...');
        
        // Create headers object with the session token as a cookie
        // Better Auth uses multi-session format
        const headers = {
          ...req.headers,
          cookie: `enterprise.session_token_multi-${token.toLowerCase()}=${token}`,
        };
        
        session = await auth.api.getSession({
          headers: headers as any,
        });
      }
    }

    if (!session) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "You must be logged in to access this resource. Please provide session token in Cookie or Authorization header.",
      });
    }

    req.user = session.user as any;
    req.session = session.session;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired session",
    });
  }
}

export function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  auth.api
    .getSession({
      headers: req.headers as any,
    })
    .then((session) => {
      if (session) {
        req.user = session.user as any;
        req.session = session.session;
      }
      next();
    })
    .catch(() => {
      next();
    });
}
