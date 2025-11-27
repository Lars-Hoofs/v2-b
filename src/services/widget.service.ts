import { prisma } from "../lib/prisma";
import { nanoid } from "nanoid";

export class WidgetError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "WidgetError";
  }
}

interface CreateWidgetInput {
  workspaceId: string;
  agentId: string;
  name: string;
  widgetType?: string;
  position?: string;
  offsetX?: number;
  offsetY?: number;
  primaryColor?: string;
  theme?: string;
  greeting?: string;
  placeholder?: string;
  suggestedQuestions?: string[];
  showBranding?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  customCss?: string;
  allowedDomains?: string[];
  [key: string]: any; // Allow other widget customization fields
}

export async function createWidget(input: CreateWidgetInput) {
  // Verify agent exists and belongs to workspace
  const agent = await prisma.agent.findFirst({
    where: {
      id: input.agentId,
      workspaceId: input.workspaceId,
      deletedAt: null,
    },
  });

  if (!agent) {
    throw new WidgetError("Agent not found in this workspace", 404);
  }

  // Generate unique install code
  const installCode = nanoid(16);

  // Extract all widget fields from input
  const { workspaceId, agentId, name, ...widgetConfig } = input;
  
  const widget = await prisma.widget.create({
    data: {
      workspaceId,
      agentId,
      name,
      widgetType: widgetConfig.widgetType || "bubble",
      position: widgetConfig.position || "bottom-right",
      offsetX: widgetConfig.offsetX || 0,
      offsetY: widgetConfig.offsetY || 0,
      primaryColor: widgetConfig.primaryColor || "#6366f1",
      theme: widgetConfig.theme || "light",
      
      // Bubble customization
      bubbleIcon: widgetConfig.bubbleIcon,
      bubbleText: widgetConfig.bubbleText,
      bubbleShape: widgetConfig.bubbleShape || "circle",
      bubbleSize: widgetConfig.bubbleSize || "medium",
      bubbleWidth: widgetConfig.bubbleWidth,
      bubbleHeight: widgetConfig.bubbleHeight,
      bubbleBackgroundColor: widgetConfig.bubbleBackgroundColor || "#6366f1",
      bubbleTextColor: widgetConfig.bubbleTextColor || "#ffffff",
      
      // Chat window
      chatWidth: widgetConfig.chatWidth || 400,
      chatHeight: widgetConfig.chatHeight || 600,
      chatBorderRadius: widgetConfig.chatBorderRadius || 16,
      
      // Header
      headerTitle: widgetConfig.headerTitle,
      headerSubtitle: widgetConfig.headerSubtitle,
      headerBackgroundColor: widgetConfig.headerBackgroundColor || "#6366f1",
      headerTextColor: widgetConfig.headerTextColor || "#ffffff",
      
      // Messages
      userMessageColor: widgetConfig.userMessageColor || "#6366f1",
      userMessageTextColor: widgetConfig.userMessageTextColor || "#ffffff",
      botMessageColor: widgetConfig.botMessageColor || "#f3f4f6",
      botMessageTextColor: widgetConfig.botMessageTextColor || "#111827",
      messageBorderRadius: widgetConfig.messageBorderRadius || 12,
      
      // Behavior
      greeting: widgetConfig.greeting,
      placeholder: widgetConfig.placeholder || "Type your message...",
      suggestedQuestions: widgetConfig.suggestedQuestions || [],
      autoOpen: widgetConfig.autoOpen ?? false,
      autoOpenDelay: widgetConfig.autoOpenDelay || 5000,
      
      // Branding & advanced
      showBranding: widgetConfig.showBranding ?? true,
      customCss: widgetConfig.customCss,
      allowedDomains: widgetConfig.allowedDomains || [],
      zIndex: widgetConfig.zIndex || 999999,
      
      installCode,
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
  });

  return widget;
}

export async function getWidget(widgetId: string, workspaceId: string) {
  const widget = await prisma.widget.findFirst({
    where: {
      id: widgetId,
      workspaceId,
      deletedAt: null,
    },
    include: {
      agent: true,
      _count: {
        select: {
          conversations: true,
        },
      },
    },
  });

  if (!widget) {
    throw new WidgetError("Widget not found", 404);
  }

  return widget;
}

export async function getWidgetByInstallCode(installCode: string) {
  const widget = await prisma.widget.findFirst({
    where: {
      installCode,
      isActive: true,
      deletedAt: null,
    },
    include: {
      agent: {
        include: {
          knowledgeBase: true,
          workflow: true,
        },
      },
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!widget) {
    throw new WidgetError("Widget not found or inactive", 404);
  }

  return widget;
}

export async function getWorkspaceWidgets(workspaceId: string) {
  return prisma.widget.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
      _count: {
        select: {
          conversations: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function updateWidget(
  widgetId: string,
  workspaceId: string,
  data: Partial<CreateWidgetInput>
) {
  const widget = await prisma.widget.findFirst({
    where: {
      id: widgetId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!widget) {
    throw new WidgetError("Widget not found", 404);
  }

  // Prepare update data
  const updateData: any = { ...data };
  
  // If changing agent, verify new agent exists and use nested update
  if (data.agentId) {
    const agent = await prisma.agent.findFirst({
      where: {
        id: data.agentId,
        workspaceId,
        deletedAt: null,
      },
    });

    if (!agent) {
      throw new WidgetError("Agent not found in this workspace", 404);
    }
    
    // Convert agentId to nested relation update
    updateData.agent = {
      connect: { id: data.agentId }
    };
    delete updateData.agentId;
  }
  
  // Remove workspaceId from update data if present
  delete updateData.workspaceId;

  return prisma.widget.update({
    where: { id: widgetId },
    data: updateData,
  });
}

export async function deleteWidget(widgetId: string, workspaceId: string) {
  const widget = await prisma.widget.findFirst({
    where: {
      id: widgetId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!widget) {
    throw new WidgetError("Widget not found", 404);
  }

  // Soft delete
  await prisma.widget.update({
    where: { id: widgetId },
    data: { deletedAt: new Date(), isActive: false },
  });

  return { success: true };
}

export async function toggleWidgetStatus(
  widgetId: string,
  workspaceId: string,
  isActive: boolean
) {
  const widget = await prisma.widget.findFirst({
    where: {
      id: widgetId,
      workspaceId,
      deletedAt: null,
    },
  });

  if (!widget) {
    throw new WidgetError("Widget not found", 404);
  }

  return prisma.widget.update({
    where: { id: widgetId },
    data: { isActive },
  });
}

export function generateEmbedCode(installCode: string, apiUrl: string): string {
  return `<!-- AI Chat Widget -->
<script>
  (function() {
    window.aiChatConfig = {
      installCode: "${installCode}",
      apiUrl: "${apiUrl}"
    };
    var script = document.createElement('script');
    script.src = "${apiUrl}/widget.js";
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`;
}

export function generateWidgetScript(): string {
  // This is the loader script served as /widget.js
  return `
(function() {
  'use strict';
  
  const config = window.aiChatConfig;
  if (!config || !config.installCode) {
    console.error('AI Chat: Missing configuration');
    return;
  }
  
  // Helper function to convert React icon name to Remixicon CSS class with debugging
  function getRemixiconClass(iconName) {
    if (!iconName || !iconName.startsWith('Ri')) {
      console.warn('AI Chat: Invalid icon name:', iconName);
      return null;
    }
    
    // Determine suffix (Line or Fill)
    const hasFill = iconName.endsWith('Fill');
    const suffix = hasFill ? '-fill' : '-line';
    
    // Remove Ri prefix and Line/Fill suffix
    let baseName = iconName.replace(/^Ri/, '').replace(/Line$|Fill$/, '');
    
    // Convert to kebab-case with proper number handling:
    // RiAccountCircle2Fill -> AccountCircle2 -> account-circle-2
    // RiChat1Line -> Chat1 -> chat-1  
    // RiAiGenerate3dFill -> AiGenerate3d -> ai-generate-3d
    baseName = baseName
      .replace(/([a-z])([A-Z])/g, '$1-$2')      // lowercase followed by uppercase
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // uppercase followed by uppercase+lowercase
      .replace(/([a-z])([0-9])/g, '$1-$2')     // lowercase followed by number
      .replace(/([0-9])([A-Z])/g, '$1-$2')     // number followed by uppercase
      .toLowerCase();
    
    const finalClass = 'ri-' + baseName + suffix;
    console.log('AI Chat: Icon conversion:', iconName, '->', finalClass);
    return finalClass;
  }
  
  
  // Simple function to get icon HTML  
  function getIconHtml(iconName, size = 24, color = 'currentColor') {
    if (!iconName) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" style="color: ' + color + ';"><path d="M10 3h4a8 8 0 1 1 0 16v3.5c-5-2-12-5-12-11.5a8 8 0 0 1 8-8Z"/></svg>';
    }
    
    const remixClass = getRemixiconClass(iconName);
    if (remixClass) {
      return '<i class="' + remixClass + '" style="font-size: ' + size + 'px; color: ' + color + '; display: inline-block; line-height: 1; font-weight: 100;"></i>';
    }
    
    // Return simple SVG fallback for unknown icons
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" style="color: ' + color + ';"><path d="M10 3h4a8 8 0 1 1 0 16v3.5c-5-2-12-5-12-11.5a8 8 0 0 1 8-8Z"/></svg>';
  }

  const apiUrl = config.apiUrl || window.location.origin;
  const installCode = config.installCode;
  
  let widgetLoaded = false;
  
  // Function to load widget after CSS is ready
  function loadWidget() {
    if (widgetLoaded) return;
    widgetLoaded = true;
    
    fetch(apiUrl + '/api/widgets/config/' + installCode)
      .then(res => res.json())
      .then(widgetConfig => {
        renderWidget(widgetConfig, apiUrl);
      })
      .catch(err => console.error('AI Chat: Failed to load widget', err));
  }
  
  // Simple and reliable Remixicon loading with debugging
  function loadRemixiconCSS() {
    // Check if already loaded
    const existingLink = document.getElementById('remixicon-css');
    if (existingLink) {
      console.log('AI Chat: Remixicon CSS link already exists, checking if loaded...');
      // Test if actually working
      setTimeout(function() {
        testRemixiconLoaded();
        loadWidget();
      }, 100);
      return;
    }
    
    console.log('AI Chat: Loading Remixicon CSS from CDN...');
    const link = document.createElement('link');
    link.id = 'remixicon-css';
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = 'https://cdn.jsdelivr.net/npm/remixicon@4.7.0/fonts/remixicon.css';
    link.crossOrigin = 'anonymous';
    
    let loaded = false;
    
    link.onload = function() {
      if (loaded) return;
      loaded = true;
      console.log('AI Chat: Remixicon CSS onload event fired');
      setTimeout(function() {
        testRemixiconLoaded();
        loadWidget();
      }, 300);
    };
    
    link.onerror = function() {
      if (loaded) return;
      loaded = true;
      console.error('AI Chat: Failed to load Remixicon CSS from CDN');
      loadWidget();
    };
    
    document.head.appendChild(link);
    console.log('AI Chat: Remixicon link added to head');
    
    // Fallback timeout
    setTimeout(function() {
      if (!loaded) {
        loaded = true;
        console.warn('AI Chat: Remixicon loading timeout (3s), proceeding anyway');
        testRemixiconLoaded();
        loadWidget();
      }
    }, 3000);
  }
  
  function testRemixiconLoaded() {
    const testEl = document.createElement('i');
    testEl.className = 'ri-chat-1-line';
    testEl.style.cssText = 'position: absolute; top: -9999px; left: -9999px; font-size: 16px;';
    document.body.appendChild(testEl);
    
    setTimeout(function() {
      const computedStyle = window.getComputedStyle(testEl);
      const fontFamily = computedStyle.fontFamily || '';
      const isLoaded = fontFamily.toLowerCase().includes('remixicon');
      
      console.log('AI Chat: Remixicon test - Font family:', fontFamily, 'Loaded:', isLoaded);
      
      document.body.removeChild(testEl);
    }, 100);
  }
  
  
  loadRemixiconCSS();

  function renderWidget(cfg, apiUrl) {
    // Inject common styles
    if (!document.getElementById('ai-chat-common-styles')) {
      const commonStyle = document.createElement('style');
      commonStyle.id = 'ai-chat-common-styles';
      commonStyle.textContent = \`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        [class^="ri-"], [class*=" ri-"] {
          font-weight: 100 !important;
        }
        #ai-chat-messages::-webkit-scrollbar {
          width: 6px;
        }
        #ai-chat-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        #ai-chat-messages::-webkit-scrollbar-thumb {
          background-color: rgba(0,0,0,0.1);
          border-radius: 3px;
        }
        #ai-chat-messages::-webkit-scrollbar-thumb:hover {
          background-color: rgba(0,0,0,0.2);
        }
      \`;
      document.head.appendChild(commonStyle);
    }

    // Create container
    const container = document.createElement('div');
    container.id = 'ai-chat-widget-container';
    container.style.cssText = 'position: fixed; z-index: ' + cfg.zIndex + ';';
    
    // Position with offset support
    const offsetX = cfg.offsetX || 0;
    const offsetY = cfg.offsetY || 0;
    const positions = {
      'bottom-right': 'bottom: ' + (20 - offsetY) + 'px; right: ' + (20 - offsetX) + 'px;',
      'bottom-left': 'bottom: ' + (20 - offsetY) + 'px; left: ' + (20 + offsetX) + 'px;',
      'bottom-center': 'bottom: ' + (20 - offsetY) + 'px; left: 50%; transform: translateX(calc(-50% + ' + offsetX + 'px));',
      'top-right': 'top: ' + (20 + offsetY) + 'px; right: ' + (20 - offsetX) + 'px;',
      'top-left': 'top: ' + (20 + offsetY) + 'px; left: ' + (20 + offsetX) + 'px;',
      'top-center': 'top: ' + (20 + offsetY) + 'px; left: 50%; transform: translateX(calc(-50% + ' + offsetX + 'px));',
      'middle-left': 'top: 50%; left: ' + (20 + offsetX) + 'px; transform: translateY(calc(-50% + ' + offsetY + 'px));',
      'middle-center': 'top: 50%; left: 50%; transform: translate(calc(-50% + ' + offsetX + 'px), calc(-50% + ' + offsetY + 'px));',
      'middle-right': 'top: 50%; right: ' + (20 - offsetX) + 'px; transform: translateY(calc(-50% + ' + offsetY + 'px));'
    };
    container.style.cssText += positions[cfg.position] || positions['bottom-right'];
    
    // Create bubble based on widgetType
    const widgetType = cfg.widgetType || 'bubble';
    const bubble = document.createElement('div');
    bubble.id = 'ai-chat-bubble';
    
    if (widgetType === 'searchbar') {
      bubble.style.cssText = getSearchbarStyles(cfg);
      bubble.innerHTML = getSearchbarHTML(cfg);
    } else if (widgetType === 'custom-box') {
      bubble.style.cssText = getCustomBoxStyles(cfg);
      bubble.innerHTML = getCustomBoxHTML(cfg);
    } else {
      // Default bubble
      bubble.style.cssText = getBubbleStyles(cfg);
      bubble.innerHTML = getBubbleHTML(cfg);
    }
    
    
    // Chat window
    const chatWindow = document.createElement('div');
    chatWindow.id = 'ai-chat-window';
    chatWindow.style.cssText = getChatWindowStyles(cfg);
    chatWindow.style.display = 'none';
    chatWindow.innerHTML = getChatWindowHTML(cfg, apiUrl);
    
    container.appendChild(bubble);
    container.appendChild(chatWindow);
    document.body.appendChild(container);
    
    // Apply animations
    if (cfg.bubbleAnimation !== 'none') {
      setTimeout(() => {
        bubble.style.animation = getAnimation(cfg.bubbleAnimation) + ' 1s ease';
      }, cfg.bubbleAnimationDelay);
    }
    
    // Auto open
    if (cfg.autoOpen) {
      setTimeout(() => {
        chatWindow.style.display = 'flex';
        bubble.style.display = 'none';
        initializeChat(cfg, apiUrl);
      }, cfg.autoOpenDelay);
    }
    
    // Toggle chat - different behavior for searchbar
    bubble.addEventListener('click', () => {
      if (widgetType === 'searchbar') {
        // Inline expansion for searchbar
        expandSearchbar(bubble, cfg, apiUrl);
      } else {
        // Normal popup for bubble and custom-box
        chatWindow.style.display = 'flex';
        bubble.style.display = 'none';
        applyOpenAnimation(chatWindow, cfg.openAnimation);
        initializeChat(cfg, apiUrl);
      }
    });
    
    // Close button
    const closeBtn = chatWindow.querySelector('#ai-chat-close');
    closeBtn.addEventListener('click', () => {
      chatWindow.style.display = 'none';
      bubble.style.display = 'flex';
    });
    
    // Apply custom CSS
    if (cfg.customCss) {
      const style = document.createElement('style');
      style.textContent = cfg.customCss;
      document.head.appendChild(style);
    }
  }
  
  function getBubbleHTML(cfg) {
    const iconColor = cfg.bubbleIconColor || cfg.bubbleTextColor;
    
    if (cfg.bubbleIcon && cfg.bubbleText) {
      const iconHtml = getIconHtml(cfg.bubbleIcon, 24, iconColor);
      return '<div style="display: flex; align-items: center; gap: 8px; justify-content: ' + (cfg.bubbleIconPosition === 'left' ? 'flex-start' : cfg.bubbleIconPosition === 'right' ? 'flex-end' : 'center') + ';">' +
        iconHtml +
        '<span class="ai-bubble-text" style="transition: color 0.2s;">' + cfg.bubbleText + '</span>' +
        '</div>';
    } else if (cfg.bubbleIcon) {
      const justifyContent = cfg.bubbleIconPosition === 'left' ? 'flex-start' : cfg.bubbleIconPosition === 'right' ? 'flex-end' : 'center';
      const iconHtml = getIconHtml(cfg.bubbleIcon, 24, iconColor);
      return '<div style="display: flex; width: 100%; justify-content: ' + justifyContent + ';">' +
        iconHtml +
        '</div>';
    } else if (cfg.bubbleText) {
      return '<span class="ai-bubble-text" style="transition: color 0.2s;">' + cfg.bubbleText + '</span>';
    } else {
      return '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="color: ' + iconColor + ';"><path d="M10 3h4a8 8 0 1 1 0 16v3.5c-5-2-12-5-12-11.5a8 8 0 0 1 8-8Z"/></svg>';
    }
  }
  
  function getBubbleStyles(cfg) {
    let size = { width: 64, height: 64 };
    if (cfg.bubbleSize === 'small') size = { width: 48, height: 48 };
    if (cfg.bubbleSize === 'large') size = { width: 80, height: 80 };
    if (cfg.bubbleSize === 'custom' && cfg.bubbleWidth && cfg.bubbleHeight) {
      size = { width: cfg.bubbleWidth, height: cfg.bubbleHeight };
    }
    
    let borderRadius = '50%';
    if (cfg.bubbleShape === 'square') borderRadius = '0';
    if (cfg.bubbleShape === 'rounded-square') borderRadius = '16px';
    
    // Create hover styles if configured
    const bubbleId = 'ai-chat-bubble';
    if (cfg.bubbleHoverBackgroundColor || cfg.bubbleHoverTextColor || cfg.bubbleHoverIconColor || cfg.bubbleHoverScale) {
      const hoverStyle = document.createElement('style');
      let hoverCss = '#' + bubbleId + ':hover { ';
      if (cfg.bubbleHoverBackgroundColor) hoverCss += 'background: ' + cfg.bubbleHoverBackgroundColor + ' !important; ';
      if (cfg.bubbleHoverScale) hoverCss += 'transform: scale(' + cfg.bubbleHoverScale + ') !important; ';
      hoverCss += '} ';
      if (cfg.bubbleHoverTextColor) hoverCss += '#' + bubbleId + ':hover .ai-bubble-text { color: ' + cfg.bubbleHoverTextColor + ' !important; } ';
      if (cfg.bubbleHoverIconColor) hoverCss += '#' + bubbleId + ':hover .ai-bubble-icon { color: ' + cfg.bubbleHoverIconColor + ' !important; } ';
      hoverStyle.textContent = hoverCss;
      document.head.appendChild(hoverStyle);
    }
    
    return 'width: ' + size.width + 'px; ' +
           'height: ' + size.height + 'px; ' +
           'background: ' + cfg.bubbleBackgroundColor + '; ' +
           'color: ' + cfg.bubbleTextColor + '; ' +
           'border-radius: ' + borderRadius + '; ' +
           'display: flex; align-items: center; justify-content: center; ' +
           'cursor: pointer; ' +
           'box-shadow: ' + (cfg.bubbleShadow || '0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)') + '; ' +
           'transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s, background 0.2s, color 0.2s; ' +
           'font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; ' +
           'font-weight: 600; ' +
           'font-size: 14px; ' +
           'z-index: 2147483647;';
  }
  
  function getSearchbarStyles(cfg) {
    return 'background: ' + cfg.bubbleBackgroundColor + '; ' +
           'color: ' + cfg.bubbleTextColor + '; ' +
           'border-radius: 24px; ' +
           'padding: 12px 20px; ' +
           'display: flex; align-items: center; gap: 12px; ' +
           'box-shadow: ' + (cfg.bubbleShadow || '0 4px 12px rgba(0,0,0,0.15)') + '; ' +
           'min-width: 280px; ' +
           'cursor: text; ' +
           'transition: transform 0.2s, box-shadow 0.2s; ' +
           'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
  }
  
  function getSearchbarHTML(cfg) {
    const iconHtml = cfg.bubbleIcon ? getIconHtml(cfg.bubbleIcon, 20) : getIconHtml('RiSearchLine', 20);
    
    return iconHtml + '<span id="searchbar-placeholder" style="font-size: 14px; opacity: 0.8;">' + (cfg.placeholder || 'Type je bericht...') + '</span>';
  }
  
  function getCustomBoxStyles(cfg) {
    return 'background: ' + cfg.bubbleBackgroundColor + '; ' +
           'color: ' + cfg.bubbleTextColor + '; ' +
           'border-radius: 12px; ' +
           'padding: 16px 24px; ' +
           'display: flex; flex-direction: column; align-items: center; gap: 8px; ' +
           'box-shadow: ' + (cfg.bubbleShadow || '0 4px 12px rgba(0,0,0,0.15)') + '; ' +
           'cursor: pointer; ' +
           'max-width: 200px; ' +
           'transition: transform 0.2s, box-shadow 0.2s; ' +
           'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
  }
  
  function getCustomBoxHTML(cfg) {
    const iconHtml = cfg.bubbleIcon ? getIconHtml(cfg.bubbleIcon, 32) : getIconHtml('RiChat1Line', 32);
    
    let html = iconHtml;
    
    if (cfg.bubbleText) {
      html += '<span style="font-size: 14px; font-weight: 600; text-align: center;">' + cfg.bubbleText + '</span>';
    }
    
    if (cfg.greeting) {
      const shortGreeting = cfg.greeting.substring(0, 40) + (cfg.greeting.length > 40 ? '...' : '');
      html += '<span style="font-size: 12px; opacity: 0.8; text-align: center;">' + shortGreeting + '</span>';
    }
    
    return html;
  }
  
  function getChatWindowStyles(cfg) {
    const layoutMode = cfg.layoutMode || 'fixed';
    const chatOffsetX = cfg.chatOffsetX || 0;
    const chatOffsetY = cfg.chatOffsetY || 0;
    let sizeStyles = '';
    let positionStyles = '';
    
    // Determine size based on layout mode
    switch (layoutMode) {
      case 'full-height':
        sizeStyles = 'width: ' + (cfg.chatWidth || 400) + 'px; height: 98vh; ';
        positionStyles = 'position: fixed; top: ' + (1 - chatOffsetY/100) + 'vh; bottom: ' + (1 + chatOffsetY/100) + 'vh; right: ' + (-chatOffsetX) + 'px; ';
        break;
      
      case 'full-width':
        sizeStyles = 'width: 100vw; height: ' + (cfg.chatHeight || 600) + 'px; ';
        positionStyles = 'position: fixed; bottom: ' + (-chatOffsetY) + 'px; left: ' + chatOffsetX + 'px; right: ' + (-chatOffsetX) + 'px; ';
        break;
      
      case 'percentage':
        const widthPct = cfg.widthPercentage || 80;
        const heightPct = cfg.heightPercentage || 80;
        sizeStyles = 'width: ' + widthPct + 'vw; height: ' + heightPct + 'vh; ';
        
        // Apply constraints if provided
        if (cfg.minWidth) sizeStyles += 'min-width: ' + cfg.minWidth + 'px; ';
        if (cfg.maxWidth) sizeStyles += 'max-width: ' + cfg.maxWidth + 'px; ';
        if (cfg.minHeight) sizeStyles += 'min-height: ' + cfg.minHeight + 'px; ';
        if (cfg.maxHeight) sizeStyles += 'max-height: ' + cfg.maxHeight + 'px; ';
        
        positionStyles = 'position: absolute; bottom: ' + (-chatOffsetY) + 'px; right: ' + (-chatOffsetX) + 'px; ';
        break;
      
      case 'custom':
        // Use percentages with custom constraints
        const customWidthPct = cfg.widthPercentage || 50;
        const customHeightPct = cfg.heightPercentage || 50;
        sizeStyles = 'width: ' + customWidthPct + 'vw; height: ' + customHeightPct + 'vh; ';
        
        if (cfg.minWidth) sizeStyles += 'min-width: ' + cfg.minWidth + 'px; ';
        if (cfg.maxWidth) sizeStyles += 'max-width: ' + cfg.maxWidth + 'px; ';
        if (cfg.minHeight) sizeStyles += 'min-height: ' + cfg.minHeight + 'px; ';
        if (cfg.maxHeight) sizeStyles += 'max-height: ' + cfg.maxHeight + 'px; ';
        
        positionStyles = 'position: absolute; bottom: ' + (-chatOffsetY) + 'px; right: ' + (-chatOffsetX) + 'px; ';
        break;
      
      case 'fixed':
      default:
        sizeStyles = 'width: ' + (cfg.chatWidth || 400) + 'px; height: ' + (cfg.chatHeight || 600) + 'px; ';
        positionStyles = 'position: absolute; bottom: ' + (-chatOffsetY) + 'px; right: ' + (-chatOffsetX) + 'px; ';
        break;
    }
    
    return sizeStyles + positionStyles +
           'background: white; ' +
           'border-radius: ' + (cfg.chatBorderRadius || 16) + 'px; ' +
           'box-shadow: 0 12px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.04); ' +
           'border: 1px solid rgba(0,0,0,0.08); ' +
           'display: flex; flex-direction: column; ' +
           'overflow: hidden; ' +
           'font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif; ' +
           'transition: opacity 0.2s, transform 0.2s;';
  }
  
  function getChatWindowHTML(cfg, apiUrl) {
    // Close button customization
    const closeIconColor = cfg.headerCloseIconColor || cfg.headerTextColor;
    const closeIconBg = cfg.headerCloseIconBackgroundColor || 'rgba(255,255,255,0.1)';
    const closeIconHtml = cfg.headerCloseIcon ? getIconHtml(cfg.headerCloseIcon, 20, closeIconColor) : '&times;';
    
    // Add hover styles for close button
    if (cfg.headerCloseIconHoverColor || cfg.headerCloseIconHoverBackgroundColor) {
      const hoverStyle = document.createElement('style');
      let css = '#ai-chat-close:hover { ';
      if (cfg.headerCloseIconHoverColor) css += 'color: ' + cfg.headerCloseIconHoverColor + ' !important; ';
      if (cfg.headerCloseIconHoverBackgroundColor) css += 'background: ' + cfg.headerCloseIconHoverBackgroundColor + ' !important; ';
      css += '}';
      hoverStyle.textContent = css;
      document.head.appendChild(hoverStyle);
    }
    
    // Avatar and online status colors
    const avatarBg = cfg.avatarBackgroundColor || 'rgba(255,255,255,0.15)';
    const onlineColor = cfg.onlineStatusColor || '#22c55e';
    
    // Input field customization
    const inputBorderColor = cfg.inputBorderColor || '#e5e7eb';
    const inputFocusBorderColor = cfg.inputFocusBorderColor || cfg.primaryColor;
    const inputBgColor = cfg.inputBackgroundColor || '#ffffff';
    const inputTextColor = cfg.inputTextColor || '#1f2937';
    
    // Add placeholder color style if set
    if (cfg.inputPlaceholderColor) {
      const style = document.createElement('style');
      style.textContent = '#ai-chat-input::placeholder { color: ' + cfg.inputPlaceholderColor + '; }';
      document.head.appendChild(style);
    }
    
    // Send button customization
    const sendBtnBg = cfg.sendButtonBackgroundColor || cfg.primaryColor;
    const sendBtnIconColor = cfg.sendButtonIconColor || '#ffffff';
    const sendIconHtml = cfg.sendButtonIcon ? getIconHtml(cfg.sendButtonIcon, 20, sendBtnIconColor) : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
    
    // Add hover styles for send button
    if (cfg.sendButtonHoverBackgroundColor || cfg.sendButtonHoverIconColor) {
      const hoverStyle = document.createElement('style');
      let css = '#ai-chat-send:hover { ';
      if (cfg.sendButtonHoverBackgroundColor) css += 'background: ' + cfg.sendButtonHoverBackgroundColor + ' !important; ';
      if (cfg.sendButtonHoverIconColor) css += 'color: ' + cfg.sendButtonHoverIconColor + ' !important; ';
      css += '}';
      hoverStyle.textContent = css;
      document.head.appendChild(hoverStyle);
    }
    
    return '<div style=\"background: ' + cfg.headerBackgroundColor + '; color: ' + cfg.headerTextColor + '; padding: 20px; display: flex; align-items: center; justify-content: space-between;\">' +
      '<div style=\"display: flex; align-items: center; gap: 16px;\">' +
        (cfg.showAgentAvatar ? '<div style=\"width: 44px; height: 44px; border-radius: 50%; background: ' + avatarBg + '; display: flex; align-items: center; justify-content: center; overflow: hidden; backdrop-filter: blur(4px); box-shadow: 0 2px 8px rgba(0,0,0,0.1);\">👤</div>' : '') +
        '<div>' +
          '<div style=\"font-weight: 700; font-size: 18px; letter-spacing: -0.02em;\">' + (cfg.headerTitle || 'Chat Support') + '</div>' +
          (cfg.headerSubtitle ? '<div style=\"font-size: 13px; opacity: 0.9; margin-top: 2px;\">' + cfg.headerSubtitle + '</div>' : '') +
          (cfg.showOnlineStatus ? '<div style=\"display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.9; margin-top: 4px;\"><span style=\"width: 8px; height: 8px; background: ' + onlineColor + '; border-radius: 50%; display: inline-block; border: 1.5px solid rgba(255,255,255,0.5);\"></span> Online</div>' : '') +
        '</div>' +
      '</div>' +
      '<button id=\"ai-chat-close\" style=\"background: ' + closeIconBg + '; border: none; color: ' + closeIconColor + '; font-size: 20px; cursor: pointer; padding: 0; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background 0.2s, color 0.2s;\">' +
        closeIconHtml +
      '</button>' +
    '</div>' +
    '<div id=\"ai-chat-messages\" style=\"flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; background: #f9fafb;\"></div>' +
    '<div style=\"padding: 20px; border-top: 1px solid #f3f4f6; background: white;\">' +
      '<div id=\"ai-chat-typing\" style=\"display: none; color: #6b7280; font-size: 12px; margin-bottom: 12px; padding-left: 4px;\">AI is typing...</div>' +
      '<div style=\"display: flex; gap: 12px; align-items: flex-end;\">' +
        '<input id=\"ai-chat-input\" type=\"text\" placeholder=\"' + cfg.placeholder + '\" style=\"flex: 1; padding: 12px 16px; border: 1px solid ' + inputBorderColor + '; border-radius: 12px; font-size: 15px; outline: none; transition: border-color 0.2s, box-shadow 0.2s; background: ' + inputBgColor + '; color: ' + inputTextColor + ';\" onfocus=\"this.style.borderColor=\\'' + inputFocusBorderColor + '\\'; this.style.boxShadow=\\'0 0 0 3px rgba(99, 102, 241, 0.1)\\';\" onblur=\"this.style.borderColor=\\'' + inputBorderColor + '\\'; this.style.boxShadow=\\'none\\';\" />' +
        '<button id=\"ai-chat-send\" style=\"background: ' + sendBtnBg + '; color: ' + sendBtnIconColor + '; border: none; padding: 0; width: 46px; height: 46px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: transform 0.1s, background 0.2s, color 0.2s; box-shadow: 0 4px 12px rgba(0,0,0,0.1);\" onmousedown=\"this.style.transform=\\'scale(0.95)\\'\" onmouseup=\"this.style.transform=\\'scale(1)\\'\">' +
          sendIconHtml +
        '</button>' +
      '</div>' +
    '</div>' +
    (cfg.showBranding ? '<div style=\"padding: 8px; text-align: center; font-size: 11px; color: #9ca3af; background: #f9fafb; border-top: 1px solid #f3f4f6;\">' + cfg.brandingText + '</div>' : '');
  }
  
  function getAnimation(type) {
    const animations = {
      bounce: '@keyframes aiBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }',
      pulse: '@keyframes aiPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }',
      shake: '@keyframes aiShake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }'
    };
    if (animations[type]) {
      const style = document.createElement('style');
      style.textContent = animations[type];
      document.head.appendChild(style);
      return 'ai' + type.charAt(0).toUpperCase() + type.slice(1);
    }
    return 'none';
  }
  
  function applyOpenAnimation(el, type) {
    if (type === 'slide-up') {
      el.style.animation = 'slideUp 0.3s ease';
      const style = document.createElement('style');
      style.textContent = '@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
      document.head.appendChild(style);
    } else if (type === 'fade') {
      el.style.animation = 'fadeIn 0.3s ease';
      const style = document.createElement('style');
      style.textContent = '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }';
      document.head.appendChild(style);
    } else if (type === 'scale') {
      el.style.animation = 'scaleIn 0.3s ease';
      const style = document.createElement('style');
      style.textContent = '@keyframes scaleIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }';
      document.head.appendChild(style);
    }
  }
  
  function expandSearchbar(searchbar, cfg, apiUrl) {
    // Determine height based on layout mode
    const layoutMode = cfg.layoutMode || 'fixed';
    let expandHeight = '400px';
    let expandWidth = '360px';
    
    if (layoutMode === 'full-height') {
      expandHeight = '98vh';
      expandWidth = (cfg.chatWidth || 400) + 'px';
    } else if (layoutMode === 'percentage') {
      expandHeight = (cfg.heightPercentage || 80) + 'vh';
      expandWidth = (cfg.widthPercentage || 30) + 'vw';
    } else if (layoutMode === 'custom') {
      expandHeight = (cfg.heightPercentage || 50) + 'vh';
      expandWidth = (cfg.widthPercentage || 30) + 'vw';
    } else {
      expandHeight = (cfg.chatHeight || 400) + 'px';
      expandWidth = (cfg.chatWidth || 360) + 'px';
    }
    
    // Add expansion keyframe if not exists
    if (!document.getElementById('searchbar-expand-style')) {
      const style = document.createElement('style');
      style.id = 'searchbar-expand-style';
      style.textContent = '@keyframes expandHeight { from { height: 44px; } to { height: ' + expandHeight + '; } }';
      document.head.appendChild(style);
    }
    
    // Replace placeholder with input
    const placeholder = searchbar.querySelector('#searchbar-placeholder');
    if (placeholder) {
      placeholder.remove();
    }
    
    // Update searchbar styles for expansion
    searchbar.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    searchbar.style.flexDirection = 'column';
    searchbar.style.alignItems = 'stretch';
    searchbar.style.height = expandHeight;
    searchbar.style.minWidth = expandWidth;
    searchbar.style.padding = '0';
    searchbar.style.borderRadius = '16px';
    searchbar.style.cursor = 'default';
    
    // Create inline chat interface
    setTimeout(() => {
      const icon = searchbar.querySelector('i');
      if (icon) icon.remove();
      
      searchbar.innerHTML = 
        '<div style="background: ' + cfg.headerBackgroundColor + '; color: ' + cfg.headerTextColor + '; padding: 16px; display: flex; align-items: center; justify-content: space-between; border-radius: 16px 16px 0 0;">' +
          '<div style="font-weight: 600; font-size: 16px;">' + (cfg.headerTitle || 'Chat Support') + '</div>' +
          '<button id="searchbar-close" style="background: none; border: none; color: ' + cfg.headerTextColor + '; font-size: 20px; cursor: pointer; padding: 0; width: 28px; height: 28px; opacity: 0.8; hover:opacity: 1;">&times;</button>' +
        '</div>' +
        '<div id="searchbar-messages" style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #fafafa;"></div>' +
        '<div style="padding: 16px; border-top: 1px solid #e5e7eb; background: white; border-radius: 0 0 16px 16px;">' +
          '<div id="searchbar-typing" style="display: none; color: #6b7280; font-size: 12px; margin-bottom: 8px;">AI is typing...</div>' +
          '<div style="display: flex; gap: 8px;">' +
            '<input id="searchbar-input" type="text" placeholder="' + cfg.placeholder + '" autofocus style="flex: 1; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none;" />' +
            '<button id="searchbar-send" style="background: ' + cfg.bubbleBackgroundColor + '; color: ' + cfg.bubbleTextColor + '; border: none; padding: 12px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; white-space: nowrap;">Send</button>' +
          '</div>' +
        '</div>';
      
      // Close button handler
      const closeBtn = document.getElementById('searchbar-close');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseSearchbar(searchbar, cfg);
      });
      
      // Initialize inline chat
      initializeInlineChat(cfg, apiUrl);
      
      // Focus input
      const input = document.getElementById('searchbar-input');
      if (input) input.focus();
    }, 100);
  }
  
  function collapseSearchbar(searchbar, cfg) {
    searchbar.style.height = '44px';
    searchbar.style.minWidth = '280px';
    searchbar.style.padding = '12px 20px';
    searchbar.style.flexDirection = 'row';
    searchbar.style.alignItems = 'center';
    searchbar.style.borderRadius = '24px';
    searchbar.style.cursor = 'text';
    
    setTimeout(() => {
      searchbar.innerHTML = getSearchbarHTML(cfg);
    }, 400);
  }
  
  let socket = null;
  let currentConversationId = null;
  
  function initializeInlineChat(cfg, apiUrl) {
    const messagesContainer = document.getElementById('searchbar-messages');
    const input = document.getElementById('searchbar-input');
    const sendBtn = document.getElementById('searchbar-send');
    const typingIndicator = document.getElementById('searchbar-typing');
    
    // Initialize Socket.io
    if (!socket) {
      socket = io(apiUrl);
      
      socket.on('connect', () => {
        // Connection established
      });
      
      socket.on('message:new', (data) => {
        // Ignore own messages to avoid duplication and wrong role assignment
        if (data.role && data.role.toLowerCase() === 'user') return;
        appendInlineMessage(data.content, false, cfg);
      });
      
      socket.on('ai:thinking', () => {
        if (typingIndicator) typingIndicator.style.display = 'block';
      });
      
      socket.on('ai:response', (data) => {
        if (typingIndicator) typingIndicator.style.display = 'none';
        appendInlineMessage(data.content, false, cfg, data.metadata?.sources);
        if (cfg.soundEnabled) playNotificationSound();
      });
    }
    
    // Create conversation
    if (!currentConversationId) {
      fetch(apiUrl + '/api/widgets/config/' + cfg.installCode)
        .then(res => res.json())
        .then(widgetData => {
          return fetch(apiUrl + '/api/chat/conversations/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              widgetId: widgetData.id,
              visitorMetadata: {
                userAgent: navigator.userAgent,
                language: navigator.language,
                referrer: document.referrer,
                currentUrl: window.location.href
              }
            })
          });
        })
        .then(res => res.json())
        .then(data => {
          currentConversationId = data.id;
          socket.emit('join:conversation', { conversationId: currentConversationId });
          
          if (cfg.greeting) {
            appendInlineMessage(cfg.greeting, false, cfg);
          }
        })
        .catch(err => {
          console.error('Failed to create conversation:', err);
          if (messagesContainer) {
            messagesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ef4444;">Failed to connect. Please refresh.</div>';
          }
        });
    }
    
    function sendMessage() {
      const message = input.value.trim();
      if (!message) return;
      
      appendInlineMessage(message, true, cfg);
      input.value = '';
      
      socket.emit('message:send', {
        conversationId: currentConversationId,
        content: message
      });
      
      fetch(apiUrl + '/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          conversationId: currentConversationId,
          content: message,
          role: 'USER',
          currentPageUrl: window.location.href
        })
      });
    }
    
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }
  
  function appendInlineMessage(content, isUser, cfg, sources) {
    const messagesContainer = document.getElementById('searchbar-messages');
    if (!messagesContainer) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'max-width: 80%; padding: 12px 16px; border-radius: ' + (cfg.messageBorderRadius || 12) + 'px; ' +
      'background: ' + (isUser ? cfg.userMessageColor : cfg.botMessageColor) + '; ' +
      'color: ' + (isUser ? (cfg.userMessageTextColor || '#ffffff') : (cfg.botMessageTextColor || cfg.messageTextColor)) + '; ' +
      'align-self: ' + (isUser ? 'flex-end' : 'flex-start') + '; ' +
      'font-size: 14px; line-height: 1.5; word-wrap: break-word;';
    msgDiv.textContent = content;
    
    if (!isUser && sources && sources.length > 0) {
      const sourcesDiv = document.createElement('div');
      sourcesDiv.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 11px; opacity: 0.8;';
      sourcesDiv.innerHTML = '<strong>📚 Bronnen:</strong><br>' + sources.map(s => {
        if (s.url) {
          return '<a href="' + s.url + '" target="_blank" style="color: ' + cfg.bubbleBackgroundColor + '; text-decoration: underline;">' + (s.title || s.url) + '</a>';
        }
        return s.title || 'Knowledge Base';
      }).join('<br>');
      msgDiv.appendChild(sourcesDiv);
    }
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function initializeChat(cfg, apiUrl) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-chat-send');
    const typingIndicator = document.getElementById('ai-chat-typing');
    
    // Initialize Socket.io
    if (!socket) {
      socket = io(apiUrl);
      
      socket.on('connect', () => {
        // Connection established - no logging needed in widget
      });
      
      socket.on('message:new', (data) => {
        // Ignore own messages to avoid duplication and wrong role assignment
        if (data.role && data.role.toLowerCase() === 'user') return;
        appendMessage(data.content, false, cfg);
      });
      
      socket.on('ai:thinking', () => {
        typingIndicator.style.display = 'block';
      });
      
      socket.on('ai:response', (data) => {
        typingIndicator.style.display = 'none';
        appendMessage(data.content, false, cfg, data.metadata?.sources);
        if (cfg.soundEnabled) playNotificationSound();
      });
    }
    
    // Create conversation on first load
    if (!currentConversationId) {
      // First, get the full widget config to find widgetId
      fetch(apiUrl + '/api/widgets/config/' + cfg.installCode)
        .then(res => res.json())
        .then(widgetData => {
          // Get widgetId from config endpoint
          const widgetId = widgetData.id || cfg.installCode; // fallback to installCode if id not present
          
          // Now create conversation with correct endpoint
          return fetch(apiUrl + '/api/chat/conversations/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              widgetId: widgetId,
              visitorMetadata: {
                userAgent: navigator.userAgent,
                language: navigator.language,
                referrer: document.referrer,
                currentUrl: window.location.href
              }
            })
          });
        })
        .then(res => res.json())
        .then(data => {
          currentConversationId = data.id;
          socket.emit('join:conversation', { conversationId: currentConversationId });
          
          // Show greeting from widget config or conversation greeting
          if (cfg.greeting) {
            appendMessage(cfg.greeting, false, cfg);
          }
          
          // Show suggested questions
          if (cfg.suggestedQuestions && cfg.suggestedQuestions.length > 0) {
            showSuggestedQuestions(cfg.suggestedQuestions, cfg);
          }
        })
        .catch(err => {
          console.error('Failed to create conversation:', err);
          messagesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ef4444;">Failed to connect. Please refresh the page.</div>';
        });
    }
    
    function sendMessage() {
      const message = input.value.trim();
      if (!message) return;
      
      appendMessage(message, true, cfg);
      input.value = '';
      
      // Send via Socket.io
      socket.emit('message:send', {
        conversationId: currentConversationId,
        content: message
      });
      
      // Also send via REST API for persistence with current page URL
      fetch(apiUrl + '/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          conversationId: currentConversationId,
          content: message,
          role: 'USER',
          currentPageUrl: window.location.href
        })
      });
    }
    
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    
    // Typing indicator
    let typingTimeout;
    input.addEventListener('input', () => {
      socket.emit('typing:start', { conversationId: currentConversationId });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        socket.emit('typing:stop', { conversationId: currentConversationId });
      }, 1000);
    });
  }
  
  function appendMessage(content, isUser, cfg, sources) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'max-width: 80%; padding: 12px 16px; border-radius: ' + cfg.messageBorderRadius + 'px; ' +
      'background: ' + (isUser ? cfg.userMessageColor : cfg.botMessageColor) + '; ' +
      'color: ' + (isUser ? (cfg.userMessageTextColor || '#ffffff') : (cfg.botMessageTextColor || cfg.messageTextColor)) + '; ' +
      'align-self: ' + (isUser ? 'flex-end' : 'flex-start') + '; ' +
      'font-size: 15px; line-height: 1.5; word-wrap: break-word; ' +
      'box-shadow: 0 1px 2px rgba(0,0,0,0.05); ' +
      'animation: slideIn 0.3s ease-out;';
    msgDiv.textContent = content;
    
    // Add sources if available (for AI messages)
    if (!isUser && sources && sources.length > 0) {
      const sourcesDiv = document.createElement('div');
      sourcesDiv.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 11px; opacity: 0.8;';
      sourcesDiv.innerHTML = '<strong>📚 Bronnen:</strong><br>' + sources.map(s => {
        if (s.url) {
          return '<a href="' + s.url + '" target="_blank" style="color: ' + cfg.primaryColor + '; text-decoration: underline;">' + (s.title || s.url) + '</a>';
        }
        return s.title || 'Knowledge Base';
      }).join('<br>');
      msgDiv.appendChild(sourcesDiv);
    }
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function showSuggestedQuestions(questions, cfg) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;';
    
    questions.forEach(q => {
      const btn = document.createElement('button');
      btn.textContent = q;
      btn.style.cssText = 'padding: 8px 12px; background: white; border: 1px solid ' + cfg.primaryColor + '; ' +
        'color: ' + cfg.primaryColor + '; border-radius: 16px; font-size: 13px; cursor: pointer; ' +
        'transition: all 0.2s;';
      btn.addEventListener('click', () => {
        document.getElementById('ai-chat-input').value = q;
        document.getElementById('ai-chat-send').click();
      });
      container.appendChild(btn);
    });
    
    messagesContainer.appendChild(container);
  }
  
  function playNotificationSound() {
    // Simple beep sound
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyv2YdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAdFnuHyvmYdBTGB0fPTgjMGHm7A7+OZUQ0PVKzn77BhGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGAZFnuHyvmUhBTGB0fPTgzQIHm7A7+OZUA8PVKzn77BiGA');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  }
  
  // Load Socket.io client
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.6.1/socket.io.min.js';
  document.head.appendChild(script);
})();
`;
}
