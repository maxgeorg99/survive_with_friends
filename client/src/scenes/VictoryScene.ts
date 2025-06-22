import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';

// Constants for responsive design
const RESPONSIVE_CONFIG = {
    VICTORY_SIZE_RATIO: 0.1,
    VICTORY_HEIGHT_RATIO: 0.15,
    MAX_VICTORY_SIZE: 84,
    SURVIVOR_SIZE_RATIO: 0.045,
    SURVIVOR_HEIGHT_RATIO: 0.07,
    MAX_SURVIVOR_SIZE: 36,
    FLAVOR_SIZE_RATIO: 0.025,
    FLAVOR_HEIGHT_RATIO: 0.04,
    MAX_FLAVOR_SIZE: 24,
    STATUS_SIZE_RATIO: 0.02,
    STATUS_HEIGHT_RATIO: 0.035,
    MAX_STATUS_SIZE: 20,
    // Improved vertical spacing for better hierarchy
    VICTORY_Y_OFFSET: 0.18,    // Top: "VICTORY!" - moved higher
    SURVIVOR_Y_OFFSET: 0.08,   // Upper middle: "TRUE SURVIVOR" - better gap
    FLAVOR_Y_OFFSET: -0.08,    // Lower middle: flavor text - proper spacing
    STATUS_Y_OFFSET: -0.16,    // Bottom: status text - clear separation
    MIN_STROKE_WIDTH: 4
};

export default class VictoryScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    
    // UI Elements
    private victoryContainer!: Phaser.GameObjects.Container;
    private statusText!: Phaser.GameObjects.Text;
    private fireworks: Phaser.GameObjects.Sprite[] = [];

    constructor() {
        super('VictoryScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("VictoryScene constructor called");
    }

    preload() {
        // Load assets needed for the victory screen
        this.load.image('victory_screen', '/assets/victory_screen.png');
        
        // Preload class icons to keep them cached for ClassSelectScene transition
        this.load.image('fighter_icon', '/assets/attack_sword.png');
        this.load.image('rogue_icon', '/assets/attack_knife.png');
        this.load.image('mage_icon', '/assets/attack_wand.png');
        this.load.image('paladin_icon', '/assets/attack_shield.png');
        this.load.image('valkyrie_icon', '/assets/attack_horn.png');
        
        console.log('VictoryScene: Preloading class icons for ClassSelectScene');
    }

    create() {
        const { width, height } = this.scale;
        
        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
            // Play voice win cue when entering victory scene
            soundManager.playSound('voice_win', 1.0);
        }
        
        // Initialize music manager and play victory sting
        this.musicManager = new MusicManager(this);
        this.musicManager.playTrack('win_sting');
        
        // Set background to a neutral color
        this.cameras.main.setBackgroundColor('#000000');
        
        try {
            if (this.textures.exists('victory_screen')) {
                const bg = this.add.image(width/2, height/2, 'victory_screen')
                    .setDisplaySize(width, height)
                    .setDepth(0)
                    .setName('victory_screen');
                // No tinting to preserve the original victory screen appearance
            }
        } catch (error) {
            console.error("Error loading victory background:", error);
        }
        
        // Add corner shading for better text readability
        this.createCornerShading();
        
        // Create a container for all victory UI elements
        this.victoryContainer = this.add.container(width/2, height/2);
        
        // Calculate responsive font sizes based on screen dimensions
        const baseVictorySize = Math.min(width * RESPONSIVE_CONFIG.VICTORY_SIZE_RATIO, height * RESPONSIVE_CONFIG.VICTORY_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_VICTORY_SIZE);
        const baseSurvivorSize = Math.min(width * RESPONSIVE_CONFIG.SURVIVOR_SIZE_RATIO, height * RESPONSIVE_CONFIG.SURVIVOR_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_SURVIVOR_SIZE);
        const baseFlavorSize = Math.min(width * RESPONSIVE_CONFIG.FLAVOR_SIZE_RATIO, height * RESPONSIVE_CONFIG.FLAVOR_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_FLAVOR_SIZE);
        const baseStatusSize = Math.min(width * RESPONSIVE_CONFIG.STATUS_SIZE_RATIO, height * RESPONSIVE_CONFIG.STATUS_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_STATUS_SIZE);
        console.log(`VictoryScene: Responsive text sizing - Victory: ${baseVictorySize}px, Survivor: ${baseSurvivorSize}px, Flavor: ${baseFlavorSize}px, Status: ${baseStatusSize}px for screen ${width}x${height}`);
        
        // Add "VICTORY!" text
        const victoryText = this.add.text(0, -height * RESPONSIVE_CONFIG.VICTORY_Y_OFFSET, 'VICTORY!', {
            fontFamily: 'Arial Black',
            fontSize: `${baseVictorySize}px`,
            color: '#FFD700',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseVictorySize / 10)
        }).setOrigin(0.5).setName('victoryText');
        this.victoryContainer.add(victoryText);
        
        // Add "TRUE SURVIVOR" text
        const survivorText = this.add.text(0, -height * RESPONSIVE_CONFIG.SURVIVOR_Y_OFFSET, 'TRUE SURVIVOR', {
            fontFamily: 'Arial Black',
            fontSize: `${baseSurvivorSize}px`,
            color: '#FF6B35',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseSurvivorSize / 6)
        }).setOrigin(0.5).setName('survivorText');
        this.victoryContainer.add(survivorText);
        
        // Status text placeholder (hidden, but needed for event handling)
        this.statusText = this.add.text(0, height * RESPONSIVE_CONFIG.STATUS_Y_OFFSET, '', {
            fontFamily: 'Arial',
            fontSize: `${baseStatusSize}px`,
            color: '#CCCCCC',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(2, baseStatusSize / 8)
        }).setOrigin(0.5).setName('statusText').setVisible(false);
        this.victoryContainer.add(this.statusText);
        
        // Add animated dots for waiting
        this.createWaitingDots();
        
        // Create celebration effects
        this.createCelebrationEffects();
        
        // Register event listeners
        this.registerEventListeners();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
        
        console.log("VictoryScene created, waiting for server to transition account state");
    }
    
    private createWaitingDots() {
        const { height } = this.scale;
        // Position dots below status text with proper spacing
        const dotsText = this.add.text(0, height * -0.10, '', {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#888888'  // Much more subtle color
        }).setOrigin(0.5);
        this.victoryContainer.add(dotsText);
        
        let dotCount = 0;
        this.time.addEvent({
            delay: 600,  // Slower animation
            callback: () => {
                dotCount = (dotCount + 1) % 4;
                dotsText.setText('.'.repeat(dotCount));
            },
            loop: true
        });
    }
    
    private createCelebrationEffects() {
        const { width, height } = this.scale;
        
        // Create sparkle effects
        this.time.addEvent({
            delay: 200,
            callback: () => {
                // Create random sparkles
                const x = Phaser.Math.Between(50, width - 50);
                const y = Phaser.Math.Between(50, height - 50);
                
                const sparkle = this.add.circle(x, y, 4, 0xFFFFFF);
                
                // Animate sparkle
                this.tweens.add({
                    targets: sparkle,
                    alpha: 0,
                    scaleX: 2,
                    scaleY: 2,
                    duration: 1000,
                    onComplete: () => {
                        sparkle.destroy();
                    }
                });
            },
            loop: true
        });
        
        // Pulse the victory text
        const victoryText = this.victoryContainer.getAt(0) as Phaser.GameObjects.Text;
        this.tweens.add({
            targets: victoryText,
            scaleX: 1.1,
            scaleY: 1.1,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        console.log(`VictoryScene: Handling resize to ${width}x${height}`);
        
        // Update background image
        const backgroundImage = this.children.getByName('victory_screen') as Phaser.GameObjects.Image;
        if (backgroundImage) {
            backgroundImage.setPosition(width/2, height/2);
            backgroundImage.setDisplaySize(width, height);
            console.log(`VictoryScene: Updated background image to ${width}x${height}`);
        }
        
        // Update container position to new center
        if (this.victoryContainer) {
            this.victoryContainer.setPosition(width/2, height/2);
            
            // Update text elements within the container
            const victoryText = this.victoryContainer.getByName('victoryText') as Phaser.GameObjects.Text;
            const survivorText = this.victoryContainer.getByName('survivorText') as Phaser.GameObjects.Text;
            const statusText = this.victoryContainer.getByName('statusText') as Phaser.GameObjects.Text;
            
            if (victoryText) {
                const baseVictorySize = Math.min(width * RESPONSIVE_CONFIG.VICTORY_SIZE_RATIO, height * RESPONSIVE_CONFIG.VICTORY_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_VICTORY_SIZE);
                victoryText.setPosition(0, -height * RESPONSIVE_CONFIG.VICTORY_Y_OFFSET);
                victoryText.setFontSize(baseVictorySize);
                victoryText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseVictorySize / 10));
                console.log(`VictoryScene: Updated victory text - size: ${baseVictorySize}px, position: (0, ${-height * RESPONSIVE_CONFIG.VICTORY_Y_OFFSET})`);
            }
            
            if (survivorText) {
                const baseSurvivorSize = Math.min(width * RESPONSIVE_CONFIG.SURVIVOR_SIZE_RATIO, height * RESPONSIVE_CONFIG.SURVIVOR_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_SURVIVOR_SIZE);
                survivorText.setPosition(0, -height * RESPONSIVE_CONFIG.SURVIVOR_Y_OFFSET);
                survivorText.setFontSize(baseSurvivorSize);
                survivorText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseSurvivorSize / 6));
                console.log(`VictoryScene: Updated survivor text - size: ${baseSurvivorSize}px, position: (0, ${-height * RESPONSIVE_CONFIG.SURVIVOR_Y_OFFSET})`);
            }
            

            
            if (statusText) {
                const baseStatusSize = Math.min(width * RESPONSIVE_CONFIG.STATUS_SIZE_RATIO, height * RESPONSIVE_CONFIG.STATUS_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_STATUS_SIZE);
                statusText.setPosition(0, height * RESPONSIVE_CONFIG.STATUS_Y_OFFSET);
                statusText.setFontSize(baseStatusSize);
                statusText.setStroke('#000000', Math.max(3, baseStatusSize / 7));
                console.log(`VictoryScene: Updated status text - size: ${baseStatusSize}px, position: (0, ${height * RESPONSIVE_CONFIG.STATUS_Y_OFFSET})`);
            }
        }
    }
    
    private registerEventListeners() {
        // Listen for account updates that might change our state
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
    }
    
    private handleAccountUpdated(ctx: any, oldAccount: any, newAccount: any) {
        console.log("Account updated in VictoryScene", newAccount.state);
        
        // Check if this is our account
        if (newAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
            // Check if state changed away from Winner
            if (newAccount.state.tag !== 'Winner') {
                console.log("Account state changed from Winner to", newAccount.state.tag);
                this.statusText.setText('State changed, transitioning...');
                
                // Transition to LoadingScene which will evaluate the new state
                this.scene.start('LoadingScene', { 
                    message: 'Evaluating account state...', 
                    waitingFor: 'account_evaluation'
                });
            }
        }
    }
    
    private handleConnectionLost() {
        console.log("Connection lost in VictoryScene");
        this.statusText.setText('Connection lost. Please refresh the page.');
    }
    
    shutdown() {
        // Cleanup music manager
        if (this.musicManager) {
            this.musicManager.cleanup();
        }
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        console.log("VictoryScene shutdown completed");
    }
    
    private createCornerShading() {
        const { width, height } = this.scale;
        const cornerRadius = 150;
        const shadowColor = 0x000000;
        const shadowAlpha = 0.6;
        
        // Top-left corner
        const topLeft = this.add.circle(0, 0, cornerRadius, shadowColor, shadowAlpha)
            .setOrigin(1, 1)
            .setDepth(1);
            
        // Top-right corner  
        const topRight = this.add.circle(width, 0, cornerRadius, shadowColor, shadowAlpha)
            .setOrigin(0, 1)
            .setDepth(1);
            
        // Bottom-left corner
        const bottomLeft = this.add.circle(0, height, cornerRadius, shadowColor, shadowAlpha)
            .setOrigin(1, 0)
            .setDepth(1);
            
        // Bottom-right corner
        const bottomRight = this.add.circle(width, height, cornerRadius, shadowColor, shadowAlpha)
            .setOrigin(0, 0)
            .setDepth(1);
    }
} 