import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          details: error.errors,
        });
      }
      next(error);
    }
  };
}

// Workspace validation schemas
export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
  description: z.string().max(500).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens")
    .optional(),
  description: z.string().max(500).optional(),
});

// Invite validation schemas
export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});

// User validation schemas
export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  image: z.string().url().optional(),
});
