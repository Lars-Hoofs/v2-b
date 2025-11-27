import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import multer from "multer";
import { promises as fs } from "fs";
import path from "path";

// Lazy-load media service to break circular dependency
let mediaService: any = null;
let MediaError: any = null;

async function getMediaService() {
  if (!mediaService) {
    const module = await import("../services/media.service");
    mediaService = module;
    MediaError = module.MediaError;
  }
  return mediaService;
}

const router = Router();

// Lazy-load multer to avoid blocking on import
let _upload: multer.Multer | null = null;
function getUpload() {
  if (!_upload) {
    _upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max (will be validated per type in service)
      },
    });
  }
  return _upload;
}

// Upload media (authenticated - for agent messages)
router.post(
  "/upload",
  requireAuth,
  (req, res, next) => getUpload().single("file")(req, res, next),
  async (req: AuthRequest, res) => {
    try {
      const service = await getMediaService();
      
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { messageId, width, height, duration } = req.body;

      if (!messageId) {
        return res.status(400).json({ error: "messageId is required" });
      }

      // Validate upload
      const validation = service.validateMediaUpload(
        req.file.originalname,
        req.file.mimetype,
        req.file.size
      );

      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Upload media
      const attachment = await service.uploadMedia({
        messageId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        buffer: req.file.buffer,
        width: width ? parseInt(width) : undefined,
        height: height ? parseInt(height) : undefined,
        duration: duration ? parseInt(duration) : undefined,
      });

      res.status(201).json(attachment);
    } catch (error: any) {
      if (MediaError && error instanceof MediaError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Upload media error:", error);
      res.status(500).json({ error: "Failed to upload media" });
    }
  }
);

// Upload media for public chat (no auth required)
router.post(
  "/upload-public",
  (req, res, next) => getUpload().single("file")(req, res, next),
  async (req, res) => {
    try {
      const service = await getMediaService();
      
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { messageId } = req.body;

      if (!messageId) {
        return res.status(400).json({ error: "messageId is required" });
      }

      // Validate upload
      const validation = service.validateMediaUpload(
        req.file.originalname,
        req.file.mimetype,
        req.file.size
      );

      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Upload media
      const attachment = await service.uploadMedia({
        messageId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        buffer: req.file.buffer,
      });

      res.status(201).json(attachment);
    } catch (error: any) {
      if (MediaError && error instanceof MediaError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Upload media error:", error);
      res.status(500).json({ error: "Failed to upload media" });
    }
  }
);

// Get media attachment
router.get("/:attachmentId", async (req, res) => {
  try {
    const service = await getMediaService();
    const attachment = await service.getMediaAttachment(req.params.attachmentId);
    res.json(attachment);
  } catch (error: any) {
    if (MediaError && error instanceof MediaError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get attachment error:", error);
    res.status(500).json({ error: "Failed to fetch attachment" });
  }
});

// Serve media file (PUBLIC)
router.get("/file/:type/:filename", async (req, res) => {
  try {
    const { type, filename } = req.params;
    const filePath = path.join(process.cwd(), "uploads", type, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: "File not found" });
    }

    // Send file
    res.sendFile(filePath);
  } catch (error) {
    console.error("Serve file error:", error);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

// Get message attachments
router.get("/message/:messageId/attachments", async (req, res) => {
  try {
    const service = await getMediaService();
    const attachments = await service.getMessageAttachments(req.params.messageId);
    res.json(attachments);
  } catch (error) {
    console.error("Get message attachments error:", error);
    res.status(500).json({ error: "Failed to fetch attachments" });
  }
});

// Delete media attachment (authenticated)
router.delete("/:attachmentId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const service = await getMediaService();
    const result = await service.deleteMediaAttachment(req.params.attachmentId);
    res.json(result);
  } catch (error: any) {
    if (MediaError && error instanceof MediaError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete attachment error:", error);
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// Get media config (PUBLIC - for widget to know limits)
router.get("/config", async (req, res) => {
  const service = await getMediaService();
  res.json(service.MEDIA_CONFIG);
});

export default router;
