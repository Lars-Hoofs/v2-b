import { prisma } from "../lib/prisma";
import { MediaType } from "@prisma/client";
import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import logger from "../lib/logger";
import { EventEmitter } from "events";

// Event emitter for media events (to avoid circular dependency with socket.service)
export const mediaEvents = new EventEmitter();

export class MediaError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "MediaError";
  }
}

// File type validation
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg"];

// Max file sizes (in bytes)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

interface UploadFileInput {
  messageId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  buffer: Buffer;
  width?: number;
  height?: number;
  duration?: number;
}

export async function uploadMedia(input: UploadFileInput) {
  // Validate file type and get media type
  const mediaType = getMediaType(input.mimeType);
  
  if (!mediaType) {
    throw new MediaError(`Unsupported file type: ${input.mimeType}`, 400);
  }

  // Validate file size
  validateFileSize(input.fileSize, mediaType);

  // Verify message exists
  const message = await prisma.message.findUnique({
    where: { id: input.messageId },
  });

  if (!message) {
    throw new MediaError("Message not found", 404);
  }

  // Generate unique filename
  const ext = path.extname(input.fileName);
  const uniqueFileName = `${nanoid()}-${Date.now()}${ext}`;
  
  // Determine storage path
  const uploadDir = path.join(process.cwd(), "uploads", mediaType.toLowerCase());
  const filePath = path.join(uploadDir, uniqueFileName);

  try {
    // Ensure directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    // Save file to disk
    await fs.writeFile(filePath, input.buffer);

    // Generate thumbnail for images/videos if needed
    let thumbnailUrl: string | undefined;
    if (mediaType === "IMAGE" || mediaType === "VIDEO") {
      thumbnailUrl = await generateThumbnail(filePath, mediaType);
    }

    // Create database record
    const attachment = await prisma.mediaAttachment.create({
      data: {
        messageId: input.messageId,
        type: mediaType,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        url: `/uploads/${mediaType.toLowerCase()}/${uniqueFileName}`,
        thumbnailUrl,
        width: input.width,
        height: input.height,
        duration: input.duration,
        isProcessed: true,
      },
    });

    logger.info("Media uploaded successfully", {
      attachmentId: attachment.id,
      messageId: input.messageId,
      type: mediaType,
      size: input.fileSize,
    });

    // Emit event for socket broadcasting (avoids circular dependency)
    const message = await prisma.message.findUnique({
      where: { id: input.messageId },
      select: { conversationId: true },
    });

    if (message) {
      mediaEvents.emit('media:uploaded', {
        conversationId: message.conversationId,
        attachment
      });
    }

    return attachment;
  } catch (error: any) {
    logger.error("Media upload failed", { error: error.message, messageId: input.messageId });
    
    // Clean up file if database operation failed
    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      logger.error("Failed to clean up file after error", { path: filePath });
    }

    throw new MediaError("Failed to upload media", 500);
  }
}

function getMediaType(mimeType: string): MediaType | null {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return "IMAGE";
  if (ALLOWED_FILE_TYPES.includes(mimeType)) return "FILE";
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return "AUDIO";
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return "VIDEO";
  return null;
}

function validateFileSize(fileSize: number, mediaType: MediaType): void {
  let maxSize: number;

  switch (mediaType) {
    case "IMAGE":
      maxSize = MAX_IMAGE_SIZE;
      break;
    case "FILE":
      maxSize = MAX_FILE_SIZE;
      break;
    case "AUDIO":
      maxSize = MAX_AUDIO_SIZE;
      break;
    case "VIDEO":
      maxSize = MAX_VIDEO_SIZE;
      break;
    default:
      throw new MediaError("Unknown media type", 400);
  }

  if (fileSize > maxSize) {
    throw new MediaError(
      `File too large. Maximum size for ${mediaType} is ${maxSize / 1024 / 1024}MB`,
      400
    );
  }
}

async function generateThumbnail(
  filePath: string,
  mediaType: MediaType
): Promise<string | undefined> {
  // Placeholder for thumbnail generation
  // In production, use sharp for images, ffmpeg for videos
  // For now, return undefined (thumbnail generation is optional)
  
  // Example with sharp (uncomment when sharp is installed):
  // if (mediaType === "IMAGE") {
  //   const sharp = require("sharp");
  //   const thumbnailPath = filePath.replace(/\.[^.]+$/, "-thumb.jpg");
  //   await sharp(filePath)
  //     .resize(200, 200, { fit: "inside" })
  //     .jpeg({ quality: 80 })
  //     .toFile(thumbnailPath);
  //   return thumbnailPath.replace(process.cwd(), "");
  // }

  return undefined;
}

export async function getMediaAttachment(attachmentId: string) {
  const attachment = await prisma.mediaAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      message: {
        select: {
          id: true,
          conversationId: true,
        },
      },
    },
  });

  if (!attachment) {
    throw new MediaError("Media attachment not found", 404);
  }

  return attachment;
}

export async function deleteMediaAttachment(attachmentId: string) {
  const attachment = await prisma.mediaAttachment.findUnique({
    where: { id: attachmentId },
  });

  if (!attachment) {
    throw new MediaError("Media attachment not found", 404);
  }

  try {
    // Delete file from disk
    const filePath = path.join(process.cwd(), attachment.url);
    await fs.unlink(filePath);

    // Delete thumbnail if exists
    if (attachment.thumbnailUrl) {
      const thumbnailPath = path.join(process.cwd(), attachment.thumbnailUrl);
      await fs.unlink(thumbnailPath).catch(() => {
        // Ignore thumbnail deletion errors
      });
    }
  } catch (error) {
    logger.error("Failed to delete media file", { 
      attachmentId, 
      url: attachment.url,
      error,
    });
    // Continue with database deletion even if file deletion fails
  }

  // Delete database record
  await prisma.mediaAttachment.delete({
    where: { id: attachmentId },
  });

  logger.info("Media attachment deleted", { attachmentId });

  // Emit event for socket broadcasting (avoids circular dependency)
  const message = await prisma.message.findUnique({
    where: { id: attachment.messageId },
    select: { conversationId: true },
  });

  if (message) {
    mediaEvents.emit('media:deleted', {
      conversationId: message.conversationId,
      attachmentId
    });
  }

  return { success: true };
}

export async function getMessageAttachments(messageId: string) {
  return prisma.mediaAttachment.findMany({
    where: { messageId },
    orderBy: { createdAt: "asc" },
  });
}

// Helper to get file stats
export function getFileStats(buffer: Buffer) {
  return {
    size: buffer.length,
    // Add more stats as needed (e.g., image dimensions, video duration)
  };
}

// Validate and parse multipart form data
export function validateMediaUpload(
  fileName: string,
  mimeType: string,
  fileSize: number
): { valid: boolean; error?: string } {
  if (!fileName || fileName.trim() === "") {
    return { valid: false, error: "Filename is required" };
  }

  if (fileSize === 0) {
    return { valid: false, error: "File is empty" };
  }

  const mediaType = getMediaType(mimeType);
  if (!mediaType) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}`,
    };
  }

  try {
    validateFileSize(fileSize, mediaType);
  } catch (error: any) {
    return { valid: false, error: error.message };
  }

  return { valid: true };
}

// Export allowed types for reference
export const MEDIA_CONFIG = {
  image: {
    types: ALLOWED_IMAGE_TYPES,
    maxSize: MAX_IMAGE_SIZE,
  },
  file: {
    types: ALLOWED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
  },
  audio: {
    types: ALLOWED_AUDIO_TYPES,
    maxSize: MAX_AUDIO_SIZE,
  },
  video: {
    types: ALLOWED_VIDEO_TYPES,
    maxSize: MAX_VIDEO_SIZE,
  },
};
