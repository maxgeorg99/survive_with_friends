import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';

// Constants for responsive design
const RESPONSIVE_CONFIG = {
    DEAD_SIZE_RATIO: 0.09,
    DEAD_HEIGHT_RATIO: 0.13,
    MAX_DEAD_SIZE: 72,
    FLAVOR_SIZE_RATIO: 0.025,
    FLAVOR_HEIGHT_RATIO: 0.04,
    MAX_FLAVOR_SIZE: 24,
    STATUS_SIZE_RATIO: 0.02,
    STATUS_HEIGHT_RATIO: 0.035,
    MAX_STATUS_SIZE: 20,
    // Improved vertical spacing for better hierarchy
    DEAD_Y_OFFSET: 0.15,       // Top: "YOU ARE NO SURVIVOR" - moved higher
    FLAVOR_Y_OFFSET: -0.05,    // Middle: flavor text - proper spacing
    STATUS_Y_OFFSET: 0.025,     // Bottom: status text - moved DOWN to bottom
    MIN_STROKE_WIDTH: 4
};

export default class DeadScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    
    // UI Elements
    private deadContainer!: Phaser.GameObjects.Container;
    private statusText!: Phaser.GameObjects.Text;

    constructor() {
        super('DeadScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("DeadScene constructor called");
    }

    preload() {
        // Load assets needed for the dead screen
        this.load.image('loss_screen', '/assets/loss_screen.png');
        
        // Preload class icons to keep them cached for ClassSelectScene transition
        this.load.image('fighter_icon', '/assets/attack_sword.png');
        this.load.image('rogue_icon', '/assets/attack_knife.png');
        this.load.image('mage_icon', '/assets/attack_wand.png');
        this.load.image('paladin_icon', '/assets/attack_shield.png');
        
        console.log('DeadScene: Preloading class icons for ClassSelectScene');
    }

    create() {
        const { width, height } = this.scale;
        
        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
            // Play voice lose cue when entering dead scene
            soundManager.playSound('voice_lose', 1.0);
        }
        
        // Initialize music manager and play game over sting
        this.musicManager = new MusicManager(this);
        this.musicManager.playTrack('game_over_sting');
        
        // Set background to a neutral color
        this.cameras.main.setBackgroundColor('#000000');
        
        try {
            if (this.textures.exists('loss_screen')) {
                const bg = this.add.image(width/2, height/2, 'loss_screen')
                    .setDisplaySize(width, height)
                    .setDepth(0)
                    .setName('loss_screen');
                // No tinting to preserve the original loss screen appearance
            }
        } catch (error) {
            console.error("Error loading loss background:", error);
        }
        
        // Add corner shading for better text readability
        this.createCornerShading();
        
        // Create a container for all dead UI elements
        this.deadContainer = this.add.container(width/2, height/2);
        
        // Calculate responsive font sizes based on screen dimensions
        const baseDeadSize = Math.min(width * RESPONSIVE_CONFIG.DEAD_SIZE_RATIO, height * RESPONSIVE_CONFIG.DEAD_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_DEAD_SIZE);
        const baseFlavorSize = Math.min(width * RESPONSIVE_CONFIG.FLAVOR_SIZE_RATIO, height * RESPONSIVE_CONFIG.FLAVOR_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_FLAVOR_SIZE);
        const baseStatusSize = Math.min(width * RESPONSIVE_CONFIG.STATUS_SIZE_RATIO, height * RESPONSIVE_CONFIG.STATUS_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_STATUS_SIZE);
        console.log(`DeadScene: Responsive text sizing - Dead: ${baseDeadSize}px, Flavor: ${baseFlavorSize}px, Status: ${baseStatusSize}px for screen ${width}x${height}`);
        
        // Add "You are no survivor" text
        const deadText = this.add.text(0, -height * RESPONSIVE_CONFIG.DEAD_Y_OFFSET, 'YOU ARE NO SURVIVOR', {
            fontFamily: 'Arial Black',
            fontSize: `${baseDeadSize}px`,
            color: '#ff3333',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseDeadSize / 9)
        }).setOrigin(0.5).setName('deadText');
        this.deadContainer.add(deadText);
        
        // Add flavor text
        const flavorText = this.add.text(0, height * RESPONSIVE_CONFIG.FLAVOR_Y_OFFSET, 'The void has claimed another soul...', {
            fontFamily: 'Arial',
            fontSize: `${baseFlavorSize}px`,
            color: '#FFFFFF',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseFlavorSize / 6)
        }).setOrigin(0.5).setName('flavorText');
        this.deadContainer.add(flavorText);
        
        // Add status text
        this.statusText = this.add.text(0, height * RESPONSIVE_CONFIG.STATUS_Y_OFFSET, 'Returning to character select...', {
            fontFamily: 'Arial',
            fontSize: `${baseStatusSize}px`,
            color: '#CCCCCC',  // Softer color for less prominence
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(2, baseStatusSize / 8)  // Lighter stroke
        }).setOrigin(0.5).setName('statusText');
        this.deadContainer.add(this.statusText);
        
        // Add animated dots for waiting
        this.createWaitingDots();
        
        // Register event listeners
        this.registerEventListeners();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
        
        console.log("DeadScene created, waiting for server to transition account state");
    }
    
    private createWaitingDots() {
        // Animate the dots at the end of the status text
        const baseText = 'Returning to character select';
        let dotCount = 0;
        
        this.time.addEvent({
            delay: 600,  // Slower animation
            callback: () => {
                dotCount = (dotCount % 3) + 1; // Cycle 1, 2, 3 dots
                const dotsText = '.'.repeat(dotCount);
                this.statusText.setText(`${baseText}${dotsText}`);
            },
            loop: true
        });
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        console.log(`DeadScene: Handling resize to ${width}x${height}`);
        
        // Update background image
        const backgroundImage = this.children.getByName('loss_screen') as Phaser.GameObjects.Image;
        if (backgroundImage) {
            backgroundImage.setPosition(width/2, height/2);
            backgroundImage.setDisplaySize(width, height);
            console.log(`DeadScene: Updated background image to ${width}x${height}`);
        }
        
        // Update container position to new center
        if (this.deadContainer) {
            this.deadContainer.setPosition(width/2, height/2);
            
            // Update text elements within the container
            const deadText = this.deadContainer.getByName('deadText') as Phaser.GameObjects.Text;
            const flavorText = this.deadContainer.getByName('flavorText') as Phaser.GameObjects.Text;
            const statusText = this.deadContainer.getByName('statusText') as Phaser.GameObjects.Text;
            
            if (deadText) {
                const baseDeadSize = Math.min(width * RESPONSIVE_CONFIG.DEAD_SIZE_RATIO, height * RESPONSIVE_CONFIG.DEAD_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_DEAD_SIZE);
                deadText.setPosition(0, -height * RESPONSIVE_CONFIG.DEAD_Y_OFFSET);
                deadText.setFontSize(baseDeadSize);
                deadText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseDeadSize / 9));
                console.log(`DeadScene: Updated dead text - size: ${baseDeadSize}px, position: (0, ${-height * RESPONSIVE_CONFIG.DEAD_Y_OFFSET})`);
            }
            
            if (flavorText) {
                const baseFlavorSize = Math.min(width * RESPONSIVE_CONFIG.FLAVOR_SIZE_RATIO, height * RESPONSIVE_CONFIG.FLAVOR_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_FLAVOR_SIZE);
                flavorText.setPosition(0, height * RESPONSIVE_CONFIG.FLAVOR_Y_OFFSET);
                flavorText.setFontSize(baseFlavorSize);
                flavorText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseFlavorSize / 6));
                console.log(`DeadScene: Updated flavor text - size: ${baseFlavorSize}px, position: (0, ${height * RESPONSIVE_CONFIG.FLAVOR_Y_OFFSET})`);
            }
            
            if (statusText) {
                const baseStatusSize = Math.min(width * RESPONSIVE_CONFIG.STATUS_SIZE_RATIO, height * RESPONSIVE_CONFIG.STATUS_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_STATUS_SIZE);
                statusText.setPosition(0, height * RESPONSIVE_CONFIG.STATUS_Y_OFFSET);
                statusText.setFontSize(baseStatusSize);
                statusText.setStroke('#000000', Math.max(3, baseStatusSize / 7));
                console.log(`DeadScene: Updated status text - size: ${baseStatusSize}px, position: (0, ${height * RESPONSIVE_CONFIG.STATUS_Y_OFFSET})`);
            }
        }
    }
    
    private registerEventListeners() {
        // Listen for account updates that might change our state
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
    }
    
    private handleAccountUpdated(ctx: any, oldAccount: any, newAccount: any) {
        console.log("Account updated in DeadScene", newAccount.state);
        
        // Check if this is our account
        if (newAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
            // Check if state changed away from Dead
            if (newAccount.state.tag !== 'Dead') {
                console.log("Account state changed from Dead to", newAccount.state.tag);
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
        console.log("Connection lost in DeadScene");
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
        
        console.log("DeadScene shutdown completed");
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