import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

export default class VictoryScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    
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
        this.load.image('title_bg', '/assets/title_bg.png');
    }

    create() {
        const { width, height } = this.scale;
        
        // Set background to golden yellow
        this.cameras.main.setBackgroundColor('#FFD700');
        
        try {
            if (this.textures.exists('title_bg')) {
                const bg = this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
                // Tint the background gold for victory
                bg.setTint(0xFFD700);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all victory UI elements
        this.victoryContainer = this.add.container(width/2, height/2);
        
        // Add "VICTORY!" text
        const victoryText = this.add.text(0, -120, 'VICTORY!', {
            fontFamily: 'Arial Black',
            fontSize: '84px',
            color: '#FFD700',
            align: 'center',
            stroke: '#8B4513',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.victoryContainer.add(victoryText);
        
        // Add "TRUE SURVIVOR" text
        const survivorText = this.add.text(0, -40, 'TRUE SURVIVOR', {
            fontFamily: 'Arial Black',
            fontSize: '36px',
            color: '#FF6B35',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);
        this.victoryContainer.add(survivorText);
        
        // Add flavor text
        const flavorText = this.add.text(0, 20, 'You have conquered the void and emerged victorious!', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#8B4513',
            align: 'center'
        }).setOrigin(0.5);
        this.victoryContainer.add(flavorText);
        
        // Add status text
        this.statusText = this.add.text(0, 60, 'Basking in glory...', {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#654321',
            align: 'center'
        }).setOrigin(0.5);
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
        const dotsText = this.add.text(0, 100, '', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#654321'
        }).setOrigin(0.5);
        this.victoryContainer.add(dotsText);
        
        let dotCount = 0;
        this.time.addEvent({
            delay: 500,
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
        
        // Update container position to new center
        if (this.victoryContainer) {
            this.victoryContainer.setPosition(width/2, height/2);
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
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        console.log("VictoryScene shutdown completed");
    }
} 