import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

export default class DeadScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    
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
        this.load.image('title_bg', '/assets/title_bg.png');
    }

    create() {
        const { width, height } = this.scale;
        
        // Set background to dark red
        this.cameras.main.setBackgroundColor('#3D0000');
        
        try {
            if (this.textures.exists('title_bg')) {
                const bg = this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
                // Tint the background red for death
                bg.setTint(0x660000);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all dead UI elements
        this.deadContainer = this.add.container(width/2, height/2);
        
        // Add "YOU DIED" text
        const deadText = this.add.text(0, -100, 'YOU DIED', {
            fontFamily: 'Arial Black',
            fontSize: '72px',
            color: '#ff3333',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.deadContainer.add(deadText);
        
        // Add flavor text
        const flavorText = this.add.text(0, -20, 'The void has claimed another soul...', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffaaaa',
            align: 'center'
        }).setOrigin(0.5);
        this.deadContainer.add(flavorText);
        
        // Add status text
        this.statusText = this.add.text(0, 40, 'Returning to character select...', {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
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
        const dotsText = this.add.text(0, 80, '', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.deadContainer.add(dotsText);
        
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
    
    private handleResize() {
        const { width, height } = this.scale;
        
        // Update container position to new center
        if (this.deadContainer) {
            this.deadContainer.setPosition(width/2, height/2);
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
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        console.log("DeadScene shutdown completed");
    }
} 