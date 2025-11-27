import { Router } from "express";
import { auth } from "../lib/auth";

const router = Router();

/**
 * GET /api/auth-helper/session
 * 
 * Returns the current session token explicitly for API clients like Postman.
 * Better Auth stores tokens in HTTP-only cookies, which makes them hard to extract.
 * This endpoint returns the token so you can use it as a Bearer token.
 */
router.get("/session", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers as any,
    });

    if (!session) {
      return res.status(401).json({
        error: "No active session",
        message: "Please sign in first to get a session token",
      });
    }

    // Extract token from cookies
    const cookieHeader = req.headers.cookie;
    let sessionToken = null;

    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map(c => c.trim());
      const sessionCookie = cookies.find(c => c.startsWith('enterprise_session.token='));
      if (sessionCookie) {
        sessionToken = sessionCookie.split('=')[1];
      }
    }

    res.json({
      user: session.user,
      session: session.session,
      token: sessionToken,
      instructions: {
        message: "Use this token in the Authorization header",
        example: "Authorization: Bearer " + sessionToken,
        postman: "Set this as a Bearer Token in the Authorization tab",
      }
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to get session",
      message: error.message,
    });
  }
});

export default router;
