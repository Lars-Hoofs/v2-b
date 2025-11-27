import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth.middleware";
import * as widgetService from "../services/widget.service";
import { WidgetError } from "../services/widget.service";
import { z } from "zod";

const router = Router();

const createWidgetSchema = z.object({
  // Required
  workspaceId: z.string(),
  agentId: z.string(),
  name: z.string().min(1).max(100),
  
  // Widget Type & Position
  widgetType: z.enum(["bubble", "searchbar", "custom-box"]).optional(),
  position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left", "top-center", "bottom-center", "middle-left", "middle-center", "middle-right"]).optional(),
  offsetX: z.number().int().min(-500).max(500).optional(),
  offsetY: z.number().int().min(-500).max(500).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  theme: z.enum(["light", "dark", "auto"]).optional(),
  
  // Advanced Layout
  layoutMode: z.enum(["fixed", "percentage", "full-height", "full-width", "custom"]).optional(),
  widthPercentage: z.number().int().min(10).max(100).optional(),
  heightPercentage: z.number().int().min(10).max(100).optional(),
  maxWidth: z.number().int().min(100).max(5000).optional(),
  maxHeight: z.number().int().min(100).max(5000).optional(),
  minWidth: z.number().int().min(100).max(5000).optional(),
  minHeight: z.number().int().min(100).max(5000).optional(),
  
  // Bubble Customization
  bubbleShape: z.enum(["circle", "square", "rounded-square"]).optional(),
  bubbleSize: z.enum(["small", "medium", "large", "custom"]).optional(),
  bubbleWidth: z.number().int().min(40).max(200).optional(),
  bubbleHeight: z.number().int().min(40).max(200).optional(),
  bubbleIcon: z.string().optional(),
  bubbleText: z.string().max(20).optional(),
  bubbleIconPosition: z.enum(["left", "center", "right"]).optional(),
  bubbleBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bubbleTextColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bubbleIconColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bubbleShadow: z.string().optional(),
  bubbleImageUrl: z.string().url().optional(),
  bubbleImageFit: z.enum(["cover", "contain", "fill"]).optional(),
  
  // Bubble Hover State
  bubbleHoverBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bubbleHoverTextColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bubbleHoverIconColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  bubbleHoverScale: z.number().min(0.8).max(1.5).optional(),
  
  // Animation System
  enableAnimation: z.boolean().optional(),
  animationType: z.enum(["slide", "fade", "scale", "bounce", "flip"]).optional(),
  animationDirection: z.enum(["top", "bottom", "left", "right", "center"]).optional(),
  animationDuration: z.number().int().min(100).max(2000).optional(),
  animationDelay: z.number().int().min(0).max(5000).optional(),
  hoverAnimation: z.enum(["none", "lift", "grow", "pulse", "rotate"]).optional(),
  
  // Icon/Image Relationship
  imageIconRelation: z.enum(["cover", "overlay", "grow-from", "side-by-side"]).optional(),
  imagePosition: z.enum(["top", "bottom", "left", "right", "background"]).optional(),
  imageFullHeight: z.boolean().optional(),
  
  // Legacy Animation (keep for backwards compatibility)
  bubbleAnimation: z.enum(["bounce", "pulse", "shake", "none"]).optional(),
  bubbleAnimationDelay: z.number().int().min(0).max(30000).optional(),
  openAnimation: z.enum(["slide-up", "fade", "scale", "none"]).optional(),
  
  // Chat Window
  chatWidth: z.number().int().min(300).max(800).optional(),
  chatHeight: z.number().int().min(400).max(900).optional(),
  chatBorderRadius: z.number().int().min(0).max(50).optional(),
  chatAnimation: z.enum(["none", "slide-up", "slide-down", "fade", "scale"]).optional(),
  chatOffsetX: z.number().int().min(-500).max(500).optional(),
  chatOffsetY: z.number().int().min(-500).max(500).optional(),
  
  // Header
  headerTitle: z.string().max(100).optional(),
  headerSubtitle: z.string().max(200).optional(),
  headerBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  headerTextColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  headerCloseIcon: z.string().optional(),
  headerCloseIconColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  headerCloseIconHoverColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  headerCloseIconBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  headerCloseIconHoverBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  showAgentAvatar: z.boolean().optional(),
  showOnlineStatus: z.boolean().optional(),
  onlineStatusColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  avatarBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  
  // Message Styling
  userMessageColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  userMessageTextColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  botMessageColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  botMessageTextColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  messageBorderRadius: z.number().int().min(0).max(50).optional(),
  borderColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  
  // Input Styling
  inputBorderColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  inputFocusBorderColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  inputBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  inputTextColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  inputPlaceholderColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  
  // Send Button Styling
  sendButtonIcon: z.string().optional(),
  sendButtonBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sendButtonIconColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sendButtonHoverBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sendButtonHoverIconColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  
  // Advanced Styling
  backgroundGradient: z.object({
    from: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    to: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    direction: z.string(),
  }).optional(),
  backdropBlur: z.number().int().min(0).max(40).optional(),
  borderWidth: z.number().int().min(0).max(10).optional(),
  shadowIntensity: z.enum(["none", "sm", "md", "lg", "xl"]).optional(),
  glassEffect: z.boolean().optional(),
  
  // Behavior
  greeting: z.string().max(500).optional(),
  placeholder: z.string().max(100).optional(),
  suggestedQuestions: z.array(z.string().max(200)).max(10).optional(),
  autoOpen: z.boolean().optional(),
  autoOpenDelay: z.number().int().min(0).max(60000).optional(),
  soundEnabled: z.boolean().optional(),
  
  // AI-Only Mode & Availability
  aiOnlyMode: z.boolean().optional(),
  aiOnlyMessage: z.record(z.string()).optional(), // { en: "...", nl: "..." }
  workingHours: z.record(z.object({
    enabled: z.boolean(),
    start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/), // HH:MM format
    end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  })).optional(), // { monday: { enabled: true, start: "09:00", end: "17:00" } }
  holidays: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    name: z.string().max(100),
    recurring: z.boolean().optional(),
  })).optional(),
  
  // Branding
  showBranding: z.boolean().optional(),
  brandingText: z.string().max(100).optional(),
  brandingUrl: z.string().url().optional(),
  
  // Advanced
  customCss: z.string().max(10000).optional(),
  customJs: z.string().max(10000).optional(),
  allowedDomains: z.array(z.string()).optional(),
  zIndex: z.number().int().min(1).max(999999).optional(),
});

// Create widget (authenticated)
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = createWidgetSchema.parse(req.body);
    // @ts-ignore
    const widget = await widgetService.createWidget(data);
    
    // Generate embed code
    const apiUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const embedCode = widgetService.generateEmbedCode(widget.installCode, apiUrl);
    
    res.status(201).json({ ...widget, embedCode });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Create widget error:", error);
    res.status(500).json({ error: "Failed to create widget" });
  }
});

// Get workspace widgets (authenticated)
router.get("/workspace/:workspaceId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const widgets = await widgetService.getWorkspaceWidgets(req.params.workspaceId);
    res.json(widgets);
  } catch (error) {
    console.error("Get widgets error:", error);
    res.status(500).json({ error: "Failed to fetch widgets" });
  }
});

// Get widget (authenticated)
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const widget = await widgetService.getWidget(req.params.id, workspaceId);
    
    // Generate embed code
    const apiUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const embedCode = widgetService.generateEmbedCode(widget.installCode, apiUrl);
    
    res.json({ ...widget, embedCode });
  } catch (error) {
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get widget error:", error);
    res.status(500).json({ error: "Failed to fetch widget" });
  }
});

// Update widget (authenticated)
router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId, ...data } = req.body;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId required" });
    }
    const widget = await widgetService.updateWidget(req.params.id, workspaceId, data);
    res.json(widget);
  } catch (error) {
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Update widget error:", error);
    res.status(500).json({ error: "Failed to update widget" });
  }
});

// Delete widget (authenticated)
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    const result = await widgetService.deleteWidget(req.params.id, workspaceId);
    res.json(result);
  } catch (error) {
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Delete widget error:", error);
    res.status(500).json({ error: "Failed to delete widget" });
  }
});

// Toggle widget status (authenticated)
router.post("/:id/toggle", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId, isActive } = req.body;
    if (!workspaceId || typeof isActive !== "boolean") {
      return res.status(400).json({ error: "workspaceId and isActive required" });
    }
    const widget = await widgetService.toggleWidgetStatus(req.params.id, workspaceId, isActive);
    res.json(widget);
  } catch (error) {
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Toggle widget error:", error);
    res.status(500).json({ error: "Failed to toggle widget status" });
  }
});

// Get widget config by install code (PUBLIC - for embedded widget)
router.get("/config/:installCode", async (req, res) => {
  try {
    const widget = await widgetService.getWidgetByInstallCode(req.params.installCode);
    
    // Return full widget configuration for rendering
    res.json({
      id: widget.id, // CRITICAL: Widget ID needed for conversation creation
      installCode: widget.installCode,
      widgetType: widget.widgetType,
      position: widget.position,
      offsetX: widget.offsetX,
      offsetY: widget.offsetY,
      primaryColor: widget.primaryColor,
      theme: widget.theme,
      
      // Advanced Layout
      layoutMode: widget.layoutMode,
      widthPercentage: widget.widthPercentage,
      heightPercentage: widget.heightPercentage,
      maxWidth: widget.maxWidth,
      maxHeight: widget.maxHeight,
      minWidth: widget.minWidth,
      minHeight: widget.minHeight,
      
      // Bubble customization
      bubbleShape: widget.bubbleShape,
      bubbleSize: widget.bubbleSize,
      bubbleWidth: widget.bubbleWidth,
      bubbleHeight: widget.bubbleHeight,
      bubbleIcon: widget.bubbleIcon,
      bubbleText: widget.bubbleText,
      bubbleIconPosition: widget.bubbleIconPosition,
      bubbleBackgroundColor: widget.bubbleBackgroundColor,
      bubbleTextColor: widget.bubbleTextColor,
      bubbleIconColor: widget.bubbleIconColor,
      bubbleShadow: widget.bubbleShadow,
      bubbleImageUrl: widget.bubbleImageUrl,
      bubbleImageFit: widget.bubbleImageFit,
      
      // Bubble Hover
      bubbleHoverBackgroundColor: widget.bubbleHoverBackgroundColor,
      bubbleHoverTextColor: widget.bubbleHoverTextColor,
      bubbleHoverIconColor: widget.bubbleHoverIconColor,
      bubbleHoverScale: widget.bubbleHoverScale,
      
      // Animation System
      enableAnimation: widget.enableAnimation,
      animationType: widget.animationType,
      animationDirection: widget.animationDirection,
      animationDuration: widget.animationDuration,
      animationDelay: widget.animationDelay,
      hoverAnimation: widget.hoverAnimation,
      
      // Icon/Image Relationship
      imageIconRelation: widget.imageIconRelation,
      imagePosition: widget.imagePosition,
      imageFullHeight: widget.imageFullHeight,
      
      // Legacy Animation
      bubbleAnimation: widget.bubbleAnimation,
      bubbleAnimationDelay: widget.bubbleAnimationDelay,
      openAnimation: widget.openAnimation,
      
      // Chat window
      chatWidth: widget.chatWidth,
      chatHeight: widget.chatHeight,
      chatBorderRadius: widget.chatBorderRadius,
      chatAnimation: widget.chatAnimation,
      chatOffsetX: widget.chatOffsetX,
      chatOffsetY: widget.chatOffsetY,
      
      // Advanced Styling
      backgroundGradient: widget.backgroundGradient,
      backdropBlur: widget.backdropBlur,
      borderWidth: widget.borderWidth,
      borderColor: widget.borderColor,
      shadowIntensity: widget.shadowIntensity,
      glassEffect: widget.glassEffect,
      
      // Header
      headerTitle: widget.headerTitle || widget.agent.name,
      headerSubtitle: widget.headerSubtitle,
      headerBackgroundColor: widget.headerBackgroundColor,
      headerTextColor: widget.headerTextColor,
      headerCloseIcon: widget.headerCloseIcon,
      headerCloseIconColor: widget.headerCloseIconColor,
      headerCloseIconHoverColor: widget.headerCloseIconHoverColor,
      headerCloseIconBackgroundColor: widget.headerCloseIconBackgroundColor,
      headerCloseIconHoverBackgroundColor: widget.headerCloseIconHoverBackgroundColor,
      showAgentAvatar: widget.showAgentAvatar,
      showOnlineStatus: widget.showOnlineStatus,
      onlineStatusColor: widget.onlineStatusColor,
      avatarBackgroundColor: widget.avatarBackgroundColor,
      
      // Messages
      userMessageColor: widget.userMessageColor,
      userMessageTextColor: widget.userMessageTextColor,
      botMessageColor: widget.botMessageColor,
      botMessageTextColor: widget.botMessageTextColor,
      messageBorderRadius: widget.messageBorderRadius,
      
      // Input
      inputBorderColor: widget.inputBorderColor,
      inputFocusBorderColor: widget.inputFocusBorderColor,
      inputBackgroundColor: widget.inputBackgroundColor,
      inputTextColor: widget.inputTextColor,
      inputPlaceholderColor: widget.inputPlaceholderColor,
      
      // Send Button
      sendButtonIcon: widget.sendButtonIcon,
      sendButtonBackgroundColor: widget.sendButtonBackgroundColor,
      sendButtonIconColor: widget.sendButtonIconColor,
      sendButtonHoverBackgroundColor: widget.sendButtonHoverBackgroundColor,
      sendButtonHoverIconColor: widget.sendButtonHoverIconColor,
      
      // Behavior
      greeting: widget.greeting,
      placeholder: widget.placeholder,
      suggestedQuestions: widget.suggestedQuestions,
      autoOpen: widget.autoOpen,
      autoOpenDelay: widget.autoOpenDelay,
      soundEnabled: widget.soundEnabled,
      
      // AI-Only Mode & Availability
      aiOnlyMode: widget.aiOnlyMode,
      aiOnlyMessage: widget.aiOnlyMessage,
      workingHours: widget.workingHours,
      holidays: widget.holidays,
      
      // Branding
      showBranding: widget.showBranding,
      brandingText: widget.brandingText,
      brandingUrl: widget.brandingUrl,
      
      // Advanced
      customCss: widget.customCss,
      customJs: widget.customJs,
      zIndex: widget.zIndex,
      
      agent: {
        id: widget.agent.id,
        name: widget.agent.name,
        avatarUrl: widget.agent.avatarUrl,
      },
    });
  } catch (error) {
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Get widget config error:", error);
    res.status(500).json({ error: "Failed to fetch widget configuration" });
  }
});

// Widget preview (authenticated - for testing widget appearance)
router.get("/preview/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || typeof workspaceId !== "string") {
      return res.status(400).json({ error: "workspaceId query parameter required" });
    }
    
    const widget = await widgetService.getWidget(req.params.id, workspaceId);
    
    // Generate preview HTML
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Widget Preview - ${widget.name}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .preview-info {
      position: fixed;
      top: 20px;
      left: 20px;
      background: white;
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      max-width: 300px;
    }
    .preview-info h3 {
      margin: 0 0 12px 0;
      font-size: 18px;
    }
    .preview-info p {
      margin: 4px 0;
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="preview-info">
    <h3>Widget Preview</h3>
    <p><strong>Name:</strong> ${widget.name}</p>
    <p><strong>Position:</strong> ${widget.position}</p>
    <p><strong>Shape:</strong> ${widget.bubbleShape}</p>
    <p><strong>Size:</strong> ${widget.bubbleSize}</p>
    <p><strong>Animation:</strong> ${widget.bubbleAnimation}</p>
    <p style="margin-top: 12px; font-size: 12px; color: #9ca3af;">This is a live preview. Try clicking the bubble!</p>
  </div>
  
  <script>
    window.aiChatConfig = {
      installCode: "${widget.installCode}",
      apiUrl: "${process.env.BETTER_AUTH_URL || "http://localhost:3000"}"
    };
  </script>
  <script src="/widget.js"></script>
</body>
</html>`;
    
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    if (error instanceof WidgetError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error("Widget preview error:", error);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

export default router;
