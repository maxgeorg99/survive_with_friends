import Phaser from 'phaser';
import PlayerClass from '../autobindings/player_class_type';

interface PrologSceneData {
    classType: PlayerClass;
    onComplete: () => void;
}

export default class PrologScene extends Phaser.Scene {
    private translations: Record<string, string> = {};
    private storyIndex: number = 0;
    private isTyping: boolean = false;
    private typingTimer?: Phaser.Time.TimerEvent;
    private onComplete?: () => void;
    private background!: Phaser.GameObjects.Image;
    private container!: Phaser.GameObjects.Container;
    private textBox!: Phaser.GameObjects.Graphics;
    private frameGraphics!: Phaser.GameObjects.Graphics;
    private storyText!: Phaser.GameObjects.Text;
    private nextButton!: Phaser.GameObjects.Text;

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
        // Load translations synchronously
        this.load.json('translations', '/loca/en.json');
        // Ensure we wait for the file to load
        this.load.on('complete', () => {
            console.log('Translation file loaded successfully');
        });
        this.load.on('loaderror', (fileObj: any) => {
            console.error('Error loading translation file:', fileObj);
        });

        // Load background scenes
        this.load.image('scene_1', 'assets/scene_1.png');
        this.load.image('scene_2', 'assets/scene_2.png');
        this.load.image('scene_3', 'assets/scene_3.png');
    }

    private cleanupHTMLElements() {
        // Clean up any DOM elements that might have been created by previous scenes
        try {
            // Remove class select container if present
            const classContainer = document.getElementById('class-select-container');
            if (classContainer && classContainer.parentNode) {
                classContainer.remove();
            }
            // Remove all class select buttons
            document.querySelectorAll('.class-select-button').forEach(el => {
                if (el && el.parentNode) el.remove();
            });
            // Remove confirm button
            document.querySelectorAll('button').forEach(el => {
                const content = (el as HTMLElement).textContent;
                if (content && content.includes('Confirm Selection') && el.parentNode) {
                    el.remove();
                }
            });
        } catch (e) {
            console.error('Error in PrologScene cleanupHTMLElements:', e);
        }
    }

    create() {
        this.cleanupHTMLElements();
        // Get the loaded translations and verify they exist
        const translations = this.cache.json.get('translations');
        if (!translations) {
            console.error('Translations not found in cache!');
            return;
        }
        this.translations = translations;
        console.log('Loaded translations:', this.translations);

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

        // Create large text overlay with semi-transparent background
        this.storyText = this.add.text(width * 0.1, height * 0.65, '', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff',
            backgroundColor: '#000000CC', // More opaque background
            padding: { x: 40, y: 30 },
            wordWrap: { width: width * 0.8 },
            lineSpacing: 20
        });

        // Create next button
        this.nextButton = this.add.text(
            width - 80, 
            height - 80,
            '▼', 
            {
                fontFamily: 'Arial',
                fontSize: '24px',
                color: '#ffffff',
                backgroundColor: '#000000CC',
                padding: { x: 40, y: 30 }
            }
        )
        .setOrigin(1, 1)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.handleNext())
        .on('pointerover', () => this.nextButton.setAlpha(0.7))
        .on('pointerout', () => this.nextButton.setAlpha(1));

        // Add keyboard input
        this.input.keyboard?.on('keydown-ENTER', () => this.handleNext());
        this.input.keyboard?.on('keydown-SPACE', () => this.handleNext());

        // Display first text and background
        this.displayNextText();
        this.updateBackground();
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
        const text = this.translations[key];
        
        // Add error handling for missing translations
        if (!text) {
            console.error(`Translation missing for key: ${key}`);
            this.storyText.setText('Translation missing for: ' + key);
            return;
        }

        this.isTyping = true;
        this.nextButton.setText('▼');

        let currentChar = 0;
        this.storyText.setText('');

        this.typingTimer = this.time.addEvent({
            delay: 40,
            callback: () => {
                this.storyText.text += text[currentChar];
                currentChar++;

                if (currentChar === text.length) {
                    this.isTyping = false;
                    this.nextButton.setText('▼');
                }
            },
            repeat: text.length - 1
        });
    }

    private handleNext() {
        if (this.isTyping) {
            // Skip typing animation
            if (this.typingTimer) {
                this.typingTimer.remove();
            }
            const key = this.storyKeys[this.storyIndex];
            this.storyText.setText(this.translations[key]);
            this.isTyping = false;
            this.nextButton.setText('▼');
        } else {
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
                try {
                    // Remove class select container if present
                    const classContainer = document.getElementById('class-select-container');
                    if (classContainer && classContainer.parentNode) {
                        classContainer.remove();
                    }
                    // Remove all class select buttons
                    document.querySelectorAll('.class-select-button').forEach(el => {
                        if (el && el.parentNode) el.remove();
                    });
                    // Remove confirm button
                    document.querySelectorAll('button').forEach(el => {
                        const content = (el as HTMLElement).textContent;
                        if (content && content.includes('Confirm Selection') && el.parentNode) {
                            el.remove();
                        }
                    });
                } catch (e) {
                    console.error('Error in PrologScene cleanupHTMLElements (end):', e);
                }
                this.scene.start('GameScene');
            }
        }
    }
}