import Phaser from 'phaser';
import { isMobileDevice } from '../utils/responsive';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

export default class SplashScene extends Phaser.Scene {
    private logo!: Phaser.GameObjects.Image;
    private loadingText!: Phaser.GameObjects.Text;
    private loadingProgress: number = 0;
    private assetsLoaded: boolean = false;
    private fadeStarted: boolean = false;
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private connectionChecked: boolean = false;
    private authCheckTimer: Phaser.Time.TimerEvent | null = null;
    private minimumDisplayTime: number = 1000; // Increased to 5 seconds for better visibility
    private displayStartTime: number = 0;
    private minimumTimeElapsed: boolean = false;
    private nextSceneDetermined: boolean = false;
    private nextScene: string = '';
    private debugText: Phaser.GameObjects.Text | null = null;

    constructor() {
        super('SplashScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
    }

    preload() {
        // Load minimal assets for splash screen
        this.load.image('game_logo', 'assets/game_logo.png'); // Using title_bg as a fallback if no logo exists
        this.load.image('title_bg', 'assets/title_bg.png');

        this.load.on('complete', () => {
            this.assetsLoaded = true;
            console.log("SplashScene assets loaded");
        });
    }

    create() {
        console.log("SplashScene create method started");
        
        // Record start time to ensure minimum display duration
        this.displayStartTime = this.time.now;
        this.minimumTimeElapsed = false;
        this.nextSceneDetermined = false;
        this.nextScene = '';
        
        const { width, height } = this.scale;
        
        // Set background color to black
        this.cameras.main.setBackgroundColor('#000000');
               
        // Add logo with animation
        this.logo = this.add.image(width/2, height/2, 'game_logo')
            .setOrigin(0.5)
            .setScale(0.5)
            .setAlpha(0);
            
        // Animate the logo
        this.tweens.add({
            targets: this.logo,
            alpha: 1,
            scale: 0.8,
            duration: 1000,
            ease: 'Bounce.Out',
            delay: 500
        });
        
        // Register event listeners
        this.registerEventListeners();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Set up a timer to check connection state periodically
        this.authCheckTimer = this.time.addEvent({
            delay: 500, 
            callback: this.checkConnectionState,
            callbackScope: this,
            loop: true
        });
        
        // Add a timer to enforce minimum display time
        this.time.delayedCall(this.minimumDisplayTime, () => {
            console.log("Minimum display time elapsed");
            this.minimumTimeElapsed = true;
            this.attemptSceneTransition();
        });
        
        console.log("SplashScene created successfully");
    }
    
    private registerEventListeners() {
        // Connection events
        this.gameEvents.on(GameEvents.CONNECTION_ESTABLISHED, this.handleConnectionEstablished, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        this.gameEvents.on(GameEvents.SUBSCRIPTION_APPLIED, this.handleSubscriptionApplied, this);
        
        this.events.once("shutdown", this.shutdown, this);
    }
    
    private handleConnectionEstablished() {
        // Wait a bit to ensure DB is available
        this.time.delayedCall(500, this.checkConnectionState, [], this);
    }
    
    private handleConnectionLost() {
        console.log("Connection lost event received in SplashScene");
    }
    
    private handleSubscriptionApplied() {
        this.time.delayedCall(500, this.checkConnectionState, [], this);
    }
    
    update() {        
        // Check for minimum time and assets loaded
        if (this.assetsLoaded && !this.fadeStarted && 
            this.time.now > this.displayStartTime + this.minimumDisplayTime) {
            this.minimumTimeElapsed = true;
            this.attemptSceneTransition();
        }
    }
    
    private checkConnectionState() {
        // Don't check multiple times or if we're already fading out
        if (this.connectionChecked || this.fadeStarted) {
            return;
        }
        
        // Check for minimum display time
        const currentTime = this.time.now;
        const elapsedTime = currentTime - this.displayStartTime;
        if (elapsedTime < this.minimumDisplayTime) {
            // Not enough time has passed, wait longer
            console.log(`Splash screen minimum display time not reached yet (${elapsedTime}/${this.minimumDisplayTime}ms)`);
            return;
        }
        
        // Check if we're connected and have a valid identity
        if (!this.spacetimeDBClient.isConnected || 
            !this.spacetimeDBClient.identity || 
            !this.spacetimeDBClient.sdkConnection?.db) {
            return;
        }
        
        try {
            // Mark as checked to avoid duplicate transitions
            this.connectionChecked = true;
            
            // Get the user identity
            const localIdentity = this.spacetimeDBClient.identity;
            
            // Try to access account table
            if (!this.spacetimeDBClient.sdkConnection.db.account) {
                console.log("Account table not available yet");
                this.connectionChecked = false; // Try again later
                return;
            }
            
            // Find the account by identity
            const myAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(localIdentity);
            
            if (myAccount) {
                console.log("Found existing account in SplashScene:", myAccount);
                
                if (!myAccount.name) {
                    // No name set, go to login screen
                    console.log("Account has no name. Going to LoginScene.");
                    this.nextScene = 'LoginScene';
                } else if (myAccount.currentPlayerId === 0) {
                    // Has name but no player, go directly to class select (skip prolog)
                    console.log("Account has name but no player. Skipping PrologScene and going directly to ClassSelectScene.");
                    this.nextScene = 'ClassSelectScene';
                } else {
                    // Check if the player exists and is alive
                    try {
                        if (!this.spacetimeDBClient.sdkConnection.db.player) {
                            console.log("Player table not available yet");
                            this.connectionChecked = false; // Try again later
                            return;
                        }
                        
                        const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.playerId.find(myAccount.currentPlayerId);
                        
                        if (localPlayer) {
                            console.log("Account has a valid player. Going to GameScene.");
                            this.nextScene = 'GameScene';
                        } else {
                            // Check if player is in dead_players table
                            if (!this.spacetimeDBClient.sdkConnection.db.deadPlayers) {
                                console.log("DeadPlayers table not available yet");
                                this.connectionChecked = false; // Try again later
                                return;
                            }
                            
                            const deadPlayer = this.spacetimeDBClient.sdkConnection.db.deadPlayers.playerId.find(myAccount.currentPlayerId);
                            
                            if (deadPlayer) {
                                console.log("Player is dead. Going to ClassSelectScene.");
                            } else {
                                console.log("Player not found. Going to ClassSelectScene.");
                            }
                            
                            // Player not found or dead, go to class select
                            this.nextScene = 'ClassSelectScene';
                        }
                    } catch (e) {
                        console.error("Error checking player state:", e);
                        this.connectionChecked = false; // Try again later
                    }
                }
            } else {
                // No account found, go to login screen
                console.log("No account found. Going to LoginScene.");
                this.nextScene = 'LoginScene';
            }
            
            // Mark that we've determined the next scene
            this.nextSceneDetermined = true;
            
            // Attempt transition if minimum time has elapsed
            this.attemptSceneTransition();
            
        } catch (e) {
            console.error("Error in checkConnectionState:", e);
            this.connectionChecked = false; // Try again later
        }
    }
    
    private attemptSceneTransition() {
        // Only transition if both conditions are met:
        // 1. Minimum display time has elapsed
        // 2. We've determined which scene to go to next
        if (this.minimumTimeElapsed && this.nextSceneDetermined && !this.fadeStarted) {
            console.log(`SplashScene transitioning to ${this.nextScene} after minimum display time`);
            this.startTransition(this.nextScene);
        } else {
            if (!this.minimumTimeElapsed) {
                console.log("Can't transition yet: minimum display time not elapsed");
            }
            if (!this.nextSceneDetermined) {
                console.log("Can't transition yet: next scene not determined");
            }
        }
    }
    
    private startTransition(targetScene: string = 'LoginScene') {
        if (this.fadeStarted) return;
        
        this.fadeStarted = true;
        
        // Cancel the auth check timer
        if (this.authCheckTimer) {
            this.authCheckTimer.remove();
            this.authCheckTimer = null;
        }
        
        // Fade out effect
        this.cameras.main.fadeOut(1000, 0, 0, 0);
        
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {            
            // Clean up any lingering HTML elements
            this.cleanupLingeringUIElements();
            
            // Start the target scene when fade completes
            this.scene.start(targetScene);
        });
    }
    
    private cleanupLingeringUIElements() {
        console.log("SplashScene: Cleaning up any lingering UI elements");
        
        try {
            // Clean up login scene elements
            const loginInput = document.getElementById('login-name-input');
            if (loginInput && loginInput.parentNode) {
                console.log("SplashScene: Removing lingering login input");
                loginInput.remove();
            }
            
            const loginContainer = document.getElementById('login-name-input-container');
            if (loginContainer && loginContainer.parentNode) {
                console.log("SplashScene: Removing login container");
                loginContainer.remove();
            }
            
            // Clean up class select scene elements
            const classContainer = document.getElementById('class-select-container');
            if (classContainer && classContainer.parentNode) {
                console.log("SplashScene: Removing lingering class container");
                classContainer.remove();
            }
            
            document.querySelectorAll('.login-button').forEach(el => {
                if (el && el.parentNode) {
                    console.log("SplashScene: Removing lingering login button");
                    el.remove();
                }
            });
            
            document.querySelectorAll('.class-select-button').forEach(el => {
                if (el && el.parentNode) {
                    console.log("SplashScene: Removing lingering class button");
                    el.remove();
                }
            });
        } catch (e) {
            console.error("Error in SplashScene cleanupLingeringUIElements:", e);
        }
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        
        if (this.logo) {
            this.logo.setPosition(width/2, height/2);
        }
        
        if (this.loadingText) {
            this.loadingText.setPosition(width/2, height/2 + 120);
        }
    }
    
    shutdown() {
        // Cancel the auth check timer
        if (this.authCheckTimer) {
            this.authCheckTimer.remove();
            this.authCheckTimer = null;
        }
        
        // Clean up event listeners
        this.gameEvents.off(GameEvents.CONNECTION_ESTABLISHED, this.handleConnectionEstablished, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        this.gameEvents.off(GameEvents.SUBSCRIPTION_APPLIED, this.handleSubscriptionApplied, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
}