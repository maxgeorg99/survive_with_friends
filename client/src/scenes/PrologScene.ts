import Phaser from 'phaser';
import PlayerClass from '../autobindings/player_class_type';
import { localization } from '../utils/localization';
import { isMobileDevice, getResponsiveFontSize, getResponsiveDimensions } from '../utils/responsive';

interface PrologSceneData {
    classType: PlayerClass;
    onComplete: () => void;
}

export default class PrologScene extends Phaser.Scene {
    private storyIndex: number = 0;
    private isTyping: boolean = false;
    private typingTimer?: Phaser.Time.TimerEvent;
    private onComplete?: () => void;
    private background!: Phaser.GameObjects.Image;
    private container!: Phaser.GameObjects.Container;
    private textBox!: Phaser.GameObjects.Graphics;
    private storyText!: Phaser.GameObjects.Text;
    private nextIndicator!: Phaser.GameObjects.Text;
    private languageSelector!: HTMLSelectElement;
    private indicatorTween!: Phaser.Tweens.Tween;
    private isSkipping: boolean = false;

    private readonly storyKeys = [
        "story.intro.1",
        "story.intro.2",
        "story.intro.3",
        "story.intro.4",
        "story.intro.5",
        "story.intro.6",
        "story.intro.7"
    ];

    constructor() {
        super({ key: 'PrologScene' });
    }

    init(data: PrologSceneData) {
        this.onComplete = data.onComplete;
    }

    async preload() {
        // Load background scenes
        this.load.image('scene_1', 'assets/scene_1.png');
        this.load.image('scene_2', 'assets/scene_2.png');
        this.load.image('scene_3', 'assets/scene_3.png');
        
        // We're not using an image for the indicator now
    }

    private createLanguageSelector() {
        const languageSelector = document.createElement('select');
        languageSelector.style.position = 'absolute';
        languageSelector.style.top = '20px';
        languageSelector.style.right = '20px';
        languageSelector.style.padding = '8px';
        languageSelector.style.fontFamily = 'Arial';
        languageSelector.style.fontSize = '16px';
        languageSelector.style.backgroundColor = '#2c3e50';
        languageSelector.style.color = 'white';
        languageSelector.style.border = '2px solid #34495e';
        languageSelector.style.borderRadius = '5px';
        languageSelector.style.cursor = 'pointer';
        languageSelector.style.zIndex = '1000';

        const languages = [
            { code: 'en', name: 'English' },
            { code: 'de', name: 'Deutsch' }
        ];

        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            languageSelector.appendChild(option);
        });

        // Set initial value
        languageSelector.value = localization.getLanguage();

        // Add change event listener
        languageSelector.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            localization.setLanguage(target.value);
            
            // Stop the current typing animation
            if (this.typingTimer) {
                this.typingTimer.remove();
            }
            this.isTyping = false;
            this.isSkipping = false;
            
            // Refresh current text immediately
            const key = this.storyKeys[this.storyIndex];
            const text = localization.getText(key);
            this.storyText.setText(text);
            this.nextIndicator.visible = true;
        });

        document.body.appendChild(languageSelector);
        this.languageSelector = languageSelector;
    }

    private cleanupHTMLElements() {
        console.log("PrologScene: Cleaning up HTML elements");
        try {
            // Remove any class select elements that might have been left over
            const classContainer = document.getElementById('class-select-container');
            if (classContainer && classContainer.parentNode) {
                console.log("Removing class select container");
                classContainer.remove();
            }

            // Remove all class select buttons
            document.querySelectorAll('.class-select-button').forEach(el => {
                if (el && el.parentNode) {
                    console.log("Removing class select button");
                    el.remove();
                }
            });

            // Remove confirm button
            document.querySelectorAll('button').forEach(el => {
                const content = (el as HTMLElement).textContent;
                if (content && (
                    content.includes('Confirm Selection') || 
                    content.includes('Set Name') ||
                    content.includes('Quests')
                )) {
                    if (el && el.parentNode) {
                        console.log("Removing button:", content);
                        el.remove();
                    }
                }
            });

            // Remove any login elements that might have been left over
            const loginInput = document.getElementById('login-name-input');
            if (loginInput && loginInput.parentNode) {
                console.log("Removing login input");
                loginInput.remove();
            }

            // Remove any info panels
            const infoPanel = document.getElementById('class-info-panel');
            if (infoPanel && infoPanel.parentNode) {
                console.log("Removing info panel");
                infoPanel.remove();
            }

            // Remove any quest buttons
            document.querySelectorAll('button').forEach(el => {
                if ((el as HTMLElement).textContent?.includes('📜 Quests')) {
                    if (el && el.parentNode) {
                        console.log("Removing quest button");
                        el.remove();
                    }
                }
            });

            // Remove language selector
            if (this.languageSelector && this.languageSelector.parentNode) {
                this.languageSelector.remove();
            }

            console.log("PrologScene HTML elements cleaned up successfully");
        } catch (e) {
            console.error("Error in PrologScene cleanupHTMLElements:", e);
        }
    }

    create() {
        this.cleanupHTMLElements();
        
        // Clear background to black
        this.cameras.main.setBackgroundColor('#000000');
        
        const { width, height } = this.scale;
        
        // Create background that takes up most of the screen
        this.background = this.add.image(width * 0.5, height * 0.5, 'scene_1')
            .setOrigin(0.5)
            .setAlpha(0);

        // Scale background to fit screen
        const scaleX = width / this.background.width;
        const scaleY = height / this.background.height;
        const scale = Math.min(scaleX, scaleY);
        this.background.setScale(scale);

        // Create a stylish dialog box container
        this.createDialogBox();

        // Create language selector
        this.createLanguageSelector();

        // Add keyboard input
        this.input.keyboard?.on('keydown-ENTER', () => this.handleNext());
        this.input.keyboard?.on('keydown-SPACE', () => this.handleNext());
        
        // Add touch input for the entire screen
        this.input.on('pointerdown', () => this.handleNext());

        // Display first text and background
        this.displayNextText();
        this.updateBackground();
    }

    private createDialogBox() {
        const { width, height } = this.scale;
        const isMobile = isMobileDevice();
        
        // Container for all dialog elements
        this.container = this.add.container(0, 0);
        
        // Create a temporary text object to measure the text size
        const textPadding = isMobile ? 12 : 25;
        const fontSize = isMobile ? 16 : 24;
        const responsiveFontSize = parseInt(getResponsiveFontSize(fontSize).replace('px', ''));
        const boxWidth = isMobile ? width * 0.9 : width * 0.85;
        
        // Create a temporary text to calculate height
        const tempText = this.add.text(
            0, 0, 
            localization.getText(this.storyKeys[this.storyIndex]), 
            {
                fontFamily: '"Trebuchet MS", "Arial", sans-serif',
                fontSize: `${responsiveFontSize}px`,
                color: '#ffffff',
                wordWrap: { width: boxWidth - textPadding * 2 },
                lineSpacing: isMobile ? 3 : 8
            }
        );
        
        // Calculate dynamic box height based on text content
        // Get text height + padding on each side + minimum space for indicator
        let textHeight = tempText.height + textPadding * 2;
        // Ensure minimum height (for very short messages)
        const minHeight = isMobile ? height * 0.15 : height * 0.18;
        // Ensure maximum height (for very long messages)
        const maxHeight = isMobile ? height * 0.25 : height * 0.28;
        const boxHeight = Math.max(minHeight, Math.min(maxHeight, textHeight));
        
        // Remove the temporary text object since we no longer need it
        tempText.destroy();
        
        const boxY = height - boxHeight * 0.65;
        const boxX = width * 0.5;
        const cornerRadius = isMobile ? 8 : 16;
        
        // Create darker semi-transparent textbox (Zelda-style)
        this.textBox = this.add.graphics();
        this.textBox.fillStyle(0x1a2942, 0.85);
        this.textBox.fillRoundedRect(
            boxX - boxWidth / 2,
            boxY - boxHeight / 2,
            boxWidth,
            boxHeight,
            cornerRadius
        );
        this.container.add(this.textBox);

        // Add a decorative border
        const border = this.add.graphics();
        border.lineStyle(3, 0xffffff, 0.4);
        border.strokeRoundedRect(
            boxX - boxWidth / 2 + 3,
            boxY - boxHeight / 2 + 3,
            boxWidth - 6,
            boxHeight - 6,
            cornerRadius - 2
        );
        this.container.add(border);
        
        // Create the story text - white text for contrast with dark background
        this.storyText = this.add.text(
            boxX - boxWidth / 2 + textPadding,
            boxY - boxHeight / 2 + textPadding,
            '', 
            {
                fontFamily: '"Trebuchet MS", "Arial", sans-serif',
                fontSize: `${responsiveFontSize}px`,
                color: '#ffffff',
                wordWrap: { width: boxWidth - textPadding * 2 },
                lineSpacing: isMobile ? 3 : 8
            }
        );
        this.container.add(this.storyText);

        // Create a text-based triangle indicator (▼) at the bottom right - smaller on mobile
        this.nextIndicator = this.add.text(
            boxX + boxWidth / 2 - textPadding,
            boxY + boxHeight / 2 - textPadding,
            '▼',
            {
                fontFamily: 'Arial',
                fontSize: `${Math.floor(responsiveFontSize * (isMobile ? 1.0 : 1.2))}px`,
                color: '#ffffff'
            }
        ).setOrigin(1, 1);
        
        this.container.add(this.nextIndicator);
        
        // Add bouncing animation for the indicator
        this.indicatorTween = this.tweens.add({
            targets: this.nextIndicator,
            y: '+=5',
            duration: 800,
            yoyo: true,
            repeat: -1
        });
        
        // Initially hide the next indicator until typing is complete
        this.nextIndicator.visible = false;
    }

    private updateBackground() {
        let sceneName = 'scene_1';
        if (this.storyIndex >= 3 && this.storyIndex <= 4) {
            sceneName = 'scene_2';
        } else if (this.storyIndex >= 5) {
            sceneName = 'scene_3';
        }

        // Fade out current background
        this.tweens.add({
            targets: this.background,
            alpha: 0,
            duration: 300,
            onComplete: () => {
                // Change texture
                this.background.setTexture(sceneName);
                
                // Special handling for scene_2 panorama
                if (sceneName === 'scene_2') {
                    this.background.setRotation(-Math.PI/2);
                    
                    // For rotated panorama, swap width/height in scale calculation
                    const { width, height } = this.scale;
                    const scaleX = height / this.background.width;
                    const scaleY = width / this.background.height;
                    const scale = Math.min(scaleX, scaleY);
                    this.background.setScale(scale);
                } else {
                    this.background.setRotation(0);
                    const { width, height } = this.scale;
                    const scaleX = width / this.background.width;
                    const scaleY = height / this.background.height;
                    const scale = Math.min(scaleX, scaleY);
                    this.background.setScale(scale);
                }
                
                // Fade in
                this.tweens.add({
                    targets: this.background,
                    alpha: 1,
                    duration: 300
                });
            }
        });
    }

    private displayNextText() {
        const key = this.storyKeys[this.storyIndex];
        const text = localization.getText(key);
        
        // Add error handling for missing translations
        if (!text) {
            console.error(`Translation missing for key: ${key}`);
            this.storyText.setText('Translation missing for: ' + key);
            this.nextIndicator.visible = true;
            return;
        }

        // Recreate the dialog box to adjust to the new text size
        if (this.container) {
            this.container.removeAll(true);
            this.createDialogBox();
        }

        this.isTyping = true;
        this.isSkipping = false;
        this.nextIndicator.visible = false;
        this.storyText.setText('');

        // Calculate typing speed based on text length (faster for longer text)
        const baseDelay = isMobileDevice() ? 30 : 40;
        const typingDelay = Math.max(10, baseDelay - (text.length / 100));

        let currentChar = 0;
        this.typingTimer = this.time.addEvent({
            delay: typingDelay,
            callback: () => {
                // Add character-by-character with a subtle typing sound effect
                if (currentChar < text.length) {
                    this.storyText.text += text[currentChar];
                    currentChar++;
                }

                if (currentChar >= text.length) {
                    this.isTyping = false;
                    this.nextIndicator.visible = true;
                }
            },
            repeat: text.length - 1
        });
    }

    private handleNext() {
        if (this.isTyping && !this.isSkipping) {
            // Skip typing animation
            this.isSkipping = true;
            if (this.typingTimer) {
                this.typingTimer.remove();
            }
            const key = this.storyKeys[this.storyIndex];
            this.storyText.setText(localization.getText(key));
            this.isTyping = false;
            this.nextIndicator.visible = true;
        } else if (!this.isTyping) {
            const previousIndex = this.storyIndex;
            this.storyIndex++;

            if (this.storyIndex < this.storyKeys.length) {
                // Check if we need to change background
                if (
                    (previousIndex < 3 && this.storyIndex >= 3) ||
                    (previousIndex < 5 && this.storyIndex >= 5)
                ) {
                    this.updateBackground();
                }
                this.displayNextText();
            } else {
                // No more story text, proceed to next scene
                // Clean up DOM before transitioning
                this.cleanupHTMLElements();
                this.scene.start('ClassSelectScene');
            }
        }
    }

    resize() {
        // Re-create dialog box with new dimensions
        if (this.container) {
            this.container.removeAll(true);
            this.createDialogBox();
            
            // Restart typing animation with current text if needed
            if (this.storyIndex < this.storyKeys.length) {
                const key = this.storyKeys[this.storyIndex];
                const text = localization.getText(key);
                
                if (this.isTyping) {
                    this.displayNextText();
                } else {
                    this.storyText.setText(text);
                    this.nextIndicator.visible = true;
                }
            }
        }
    }

    shutdown() {
        // Clean up event listeners
        this.input.keyboard?.off('keydown-ENTER');
        this.input.keyboard?.off('keydown-SPACE');
        this.input.off('pointerdown');
        
        // Stop tweens
        if (this.indicatorTween) {
            this.indicatorTween.stop();
        }
        
        // Clean up HTML elements
        this.cleanupHTMLElements();
    }
}