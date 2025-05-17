/**
 * Utilities for responsive design and mobile device detection
 */

/**
 * Detects if the current device is a mobile device
 * @returns true if the device is a mobile device
 */
export const isMobileDevice = (): boolean => {
  // Check for touch capability and screen size
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < 768;
  
  // Check for mobile user agent (fallback method)
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const isMobileUserAgent = mobileRegex.test(navigator.userAgent);
  
  // Consider it a mobile device if it has a touch screen and is either small or has a mobile user agent
  return hasTouchScreen && (isSmallScreen || isMobileUserAgent);
};

/**
 * Gets the appropriate font size based on screen width
 * @param baseFontSize The base font size for desktop
 * @returns The responsive font size
 */
export const getResponsiveFontSize = (baseFontSize: number): string => {
  const screenWidth = window.innerWidth;
  
  if (screenWidth < 360) {
    return `${Math.max(10, Math.floor(baseFontSize * 0.6))}px`;
  } else if (screenWidth < 480) {
    return `${Math.max(12, Math.floor(baseFontSize * 0.7))}px`;
  } else if (screenWidth < 768) {
    return `${Math.max(14, Math.floor(baseFontSize * 0.8))}px`;
  }
  
  return `${baseFontSize}px`;
};

/**
 * Gets responsive dimensions as percentage of screen size
 * @param baseWidth Base width in pixels for desktop
 * @param baseHeight Base height in pixels for desktop
 * @returns Object with width and height as percentage strings
 */
export const getResponsiveDimensions = (
  baseWidth: number,
  baseHeight: number
): { width: string; height: string } => {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  // Calculate percentages based on a reference desktop size (1920x1080)
  const widthPercent = (baseWidth / 1920) * 100;
  const heightPercent = (baseHeight / 1080) * 100;
  
  // Adjust for smaller screens
  const scale = screenWidth < 768 ? 1.2 : 1;
  
  return {
    width: `${widthPercent * scale}vw`,
    height: `${heightPercent * scale}vh`,
  };
};

/**
 * Applies responsive styles to an HTML element
 * @param element The HTML element to style
 * @param options Styling options
 */
export const applyResponsiveStyles = (
  element: HTMLElement,
  options: {
    baseFontSize?: number;
    baseWidth?: number;
    baseHeight?: number;
    mobileStyles?: Partial<CSSStyleDeclaration>;
    desktopStyles?: Partial<CSSStyleDeclaration>;
  }
): void => {
  const isMobile = isMobileDevice();
  
  // Apply font size if specified
  if (options.baseFontSize) {
    element.style.fontSize = getResponsiveFontSize(options.baseFontSize);
  }
  
  // Apply dimensions if specified
  if (options.baseWidth && options.baseHeight) {
    const { width, height } = getResponsiveDimensions(
      options.baseWidth,
      options.baseHeight
    );
    element.style.width = width;
    element.style.height = height;
  }
  
  // Apply device-specific styles
  const styles = isMobile ? options.mobileStyles : options.desktopStyles;
  if (styles) {
    Object.keys(styles).forEach((key) => {
      const value = styles[key as keyof typeof styles];
      if (value) {
        (element.style as any)[key] = value;
      }
    });
  }
};

/**
 * Gets responsive position for centered elements
 * @param verticalOffset Offset from center (negative = up, positive = down)
 * @returns CSS position object with top and left values
 */
export const getResponsiveCenteredPosition = (
  verticalOffset: number = 0
): { top: string; left: string; transform: string } => {
  const isMobile = isMobileDevice();
  const mobileOffset = isMobile ? verticalOffset * 0.7 : verticalOffset;
  
  return {
    top: `calc(50% + ${mobileOffset}px)`,
    left: '50%',
    transform: 'translate(-50%, -50%)',
  };
};

/**
 * Create a readable text style for Phaser text elements based on screen size
 * @param baseSize The base font size for desktop
 * @returns TextStyle object with enhanced readability properties
 */
export const getReadableTextStyle = (baseSize: number): any => {
  const fontSize = getResponsiveFontSize(baseSize);
  
  return {
    fontFamily: 'Arial Black, Arial Bold, Gadget, sans-serif',
    fontSize: fontSize,
    color: '#ffffff',
    align: 'center',
    stroke: '#000000',
    strokeThickness: Math.max(3, Math.floor(baseSize / 10)),
    shadow: {
      offsetX: 2,
      offsetY: 2,
      color: '#000000',
      blur: 5,
      stroke: true,
      fill: true
    },
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: {
      left: 15,
      right: 15,
      top: 8, 
      bottom: 8
    }
  };
};

/**
 * Add a semi-transparent background to text for better readability
 * @param text The Phaser Text object to enhance
 * @param padding Optional padding override
 */
export const addTextBackground = (text: Phaser.GameObjects.Text, padding?: {x: number, y: number}): void => {
  const paddingX = padding?.x || 10;
  const paddingY = padding?.y || 5;
  
  // Create a background rectangle
  const graphics = text.scene.add.graphics();
  graphics.fillStyle(0x000000, 0.6);
  graphics.fillRoundedRect(
    text.x - text.width / 2 - paddingX,
    text.y - text.height / 2 - paddingY,
    text.width + paddingX * 2,
    text.height + paddingY * 2,
    8
  );
  
  // Ensure the background is behind the text
  graphics.setDepth(text.depth - 1);
  
  // Add the background as data to the text for reference
  text.setData('background', graphics);
};