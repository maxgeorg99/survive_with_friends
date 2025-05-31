import Phaser from 'phaser';
import { GameEvents } from '../constants/GameEvents';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { AccountState } from '../autobindings/account_state_type';

export default class LoadingScene extends Phaser.Scene {
    private loadingText!: Phaser.GameObjects.Text;
    private spinner!: Phaser.GameObjects.Container;
    private dots!: Phaser.GameObjects.Text;
    private dotCount: number = 0;
    private dotTimer!: Phaser.Time.TimerEvent;
    private message: string = '';
    private gameEvents: Phaser.Events.EventEmitter;
    private waitingFor: string = ''; // What are we waiting for?
    private targetState: string = ''; // What account state are we waiting for?
    private spacetimeDBClient: SpacetimeDBClient;
    private timeoutTimer: Phaser.Time.TimerEvent | null = null;

    constructor() {
        super('LoadingScene');
        this.gameEvents = (window as any).gameEvents;
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
    }

    init(data: { message?: string, waitingFor?: string, targetState?: string }) {
        this.message = data.message || 'Loading...';
        this.waitingFor = data.waitingFor || '';
        this.targetState = data.targetState || '';
        console.log(`LoadingScene initialized with message: ${this.message}, waiting for: ${this.waitingFor}, target state: ${this.targetState}`);
    }

    preload() {
        // Load title background
        this.load.image('title_bg', '/assets/title_bg.png');
    }

    create() {
        // Global cleanup - remove any lingering UI elements from previous scenes
        this.cleanupLingeringUIElements();
        
        const { width, height } = this.scale;
        
        // Set background color
        this.cameras.main.setBackgroundColor('#042E64');
        
        // Add title background
        try {
            if (this.textures.exists('title_bg')) {
                this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create loading text
        this.loadingText = this.add.text(width / 2, height / 2 - 50, this.message, {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        
        // Create animated dots
        this.dots = this.add.text(width / 2, height / 2 - 20, '', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);
        
        // Create spinner animation
        this.createSpinner(width / 2, height / 2 + 50);
        
        // Start dot animation
        this.dotTimer = this.time.addEvent({
            delay: 500,
            callback: this.updateDots,
            callbackScope: this,
            loop: true
        });
        
        // Register event listeners based on what we're waiting for
        this.registerEventListeners();
        
        // Start account state evaluation only if we're doing initial evaluation
        // If we have a target state, we wait for account updates instead of polling
        if (this.waitingFor === 'account_evaluation') {
            console.log("LoadingScene: Starting initial account state evaluation");
            this.evaluateAccountState();
        } else if (this.targetState) {
            console.log("LoadingScene: Waiting for account state to change to:", this.targetState);
            // Check if we're already in the target state
            this.checkCurrentStateAgainstTarget();
            
            // Add timeout fallback to prevent getting stuck
            const timeoutDuration = 15000; // 15 seconds
            this.timeoutTimer = this.time.delayedCall(timeoutDuration, () => {
                console.warn("LoadingScene: Timeout waiting for target state:", this.targetState);
                console.log("LoadingScene: Falling back to account evaluation");
                this.loadingText.setText('Timeout - evaluating current state...');
                this.evaluateAccountState();
            });
            console.log("LoadingScene: Set timeout fallback for", timeoutDuration, "ms");
        } else {
            console.log("LoadingScene: No specific target state, waiting for events");
        }
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
    }
    
    private registerEventListeners() {
        // Listen for connection lost event
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Always listen for account updates for target state detection
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);

        this.events.on("shutdown", this.shutdown, this);
    }
    
    private checkCurrentStateAgainstTarget() {
        if (!this.targetState) return;
        
        console.log("LoadingScene: Checking current state against target:", this.targetState);
        
        if (!this.spacetimeDBClient.isConnected || !this.spacetimeDBClient.identity) {
            console.log("LoadingScene: Not connected or no identity, waiting...");
            return;
        }
        
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.log("LoadingScene: No database connection, waiting...");
            return;
        }
        
        // Get our account
        const account = db.account.identity.find(this.spacetimeDBClient.identity);
        if (!account) {
            console.log("LoadingScene: No account found, waiting...");
            return;
        }
        
        console.log("LoadingScene: Current state:", account.state.tag, "Target state:", this.targetState);
        
        // If we're already in the target state, navigate immediately
        if (account.state.tag === this.targetState) {
            console.log("LoadingScene: Already in target state, navigating immediately");
            this.navigateBasedOnAccountState(account.state);
        }
    }
    
    private evaluateAccountState() {
        if (!this.spacetimeDBClient.isConnected || !this.spacetimeDBClient.identity) {
            console.log("Not connected or no identity, waiting...");
            return;
        }
        
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.log("No database connection, waiting...");
            return;
        }
        
        // Get our account
        const account = db.account.identity.find(this.spacetimeDBClient.identity);
        if (!account) {
            console.log("No account found, staying in loading...");
            return;
        }
        
        console.log("Current account state:", account.state.tag);
        
        // Navigate based on account state
        this.navigateBasedOnAccountState(account.state);
    }
    
    private navigateBasedOnAccountState(accountState: any) {
        console.log("LoadingScene: Navigating based on account state:", accountState.tag);
        
        // Clear any active timers since we're about to transition
        if (this.dotTimer) {
            this.dotTimer.remove();
        }
        if (this.timeoutTimer) {
            this.timeoutTimer.remove();
            this.timeoutTimer = null;
        }
        
        // Add a small delay to prevent conflicts with other navigation
        this.time.delayedCall(100, () => {
            console.log("LoadingScene: Executing navigation to", accountState.tag);
            
            switch (accountState.tag) {
                case 'ChoosingName':
                    console.log("LoadingScene: Starting NameSelectScene");
                    this.scene.start('NameSelectScene');
                    break;
                    
                case 'ChoosingClass':
                    console.log("LoadingScene: Starting ClassSelectScene");
                    this.scene.start('ClassSelectScene');
                    break;
                    
                case 'Playing':
                    console.log("LoadingScene: Starting GameScene");
                    this.scene.start('GameScene');
                    break;
                    
                case 'Dead':
                    console.log("LoadingScene: Starting DeadScene");
                    this.scene.start('DeadScene');
                    break;
                    
                case 'Winner':
                    console.log("LoadingScene: Starting VictoryScene");
                    this.scene.start('VictoryScene');
                    break;
                    
                default:
                    console.warn("LoadingScene: Unknown account state:", accountState.tag);
                    // Default to title scene if state is unrecognized
                    console.log("LoadingScene: Starting TitleScene as fallback");
                    this.scene.start('TitleScene');
                    break;
            }
        });
    }
    
    private createSpinner(x: number, y: number) {
        // Create a container for the spinner
        this.spinner = this.add.container(x, y);
        
        // Create spinner circles
        const radius = 30;
        const numDots = 8;
        
        for (let i = 0; i < numDots; i++) {
            const angle = (i / numDots) * Math.PI * 2;
            const dotX = Math.cos(angle) * radius;
            const dotY = Math.sin(angle) * radius;
            const dotSize = 8;
            const alpha = 0.3 + (0.7 * i / numDots);
            
            const dot = this.add.circle(dotX, dotY, dotSize, 0xffffff, alpha);
            this.spinner.add(dot);
        }
        
        // Animate spinner rotation
        this.tweens.add({
            targets: this.spinner,
            angle: 360,
            duration: 2000,
            repeat: -1,
            ease: 'Linear'
        });
    }
    
    private updateDots() {
        this.dotCount = (this.dotCount + 1) % 4;
        this.dots.setText('.'.repeat(this.dotCount));
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        
        if (this.loadingText) {
            this.loadingText.setPosition(width / 2, height / 2 - 50);
        }
        
        if (this.dots) {
            this.dots.setPosition(width / 2, height / 2 - 20);
        }
        
        if (this.spinner) {
            this.spinner.setPosition(width / 2, height / 2 + 50);
        }
    }
    
    private handleConnectionLost() {
        console.log("Connection lost during loading");
        this.loadingText.setText('Connection lost. Please refresh the page.');
        
        // Clear any active timers
        if (this.dotTimer) {
            this.dotTimer.remove();
        }
        if (this.timeoutTimer) {
            this.timeoutTimer.remove();
            this.timeoutTimer = null;
        }
    }
    
    private handleAccountUpdated(ctx: any, oldAccount: any, newAccount: any) {
        // Check if this is our account
        if (newAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
            console.log("LoadingScene: Our account updated - old state:", oldAccount.state.tag, "new state:", newAccount.state.tag);
            
            // If we're waiting for a specific target state, check if we reached it
            if (this.targetState && newAccount.state.tag === this.targetState) {
                console.log("LoadingScene: Reached target state:", this.targetState, "- navigating");
                
                // Clear timeout since we successfully reached target state
                if (this.timeoutTimer) {
                    this.timeoutTimer.remove();
                    this.timeoutTimer = null;
                }
                
                this.navigateBasedOnAccountState(newAccount.state);
            } else if (this.targetState) {
                console.log("LoadingScene: State changed but not to target state. Current:", newAccount.state.tag, "Target:", this.targetState);
            } else {
                console.log("LoadingScene: Account updated but no target state specified");
            }
        }
    }
    
    shutdown() {
        // Clean up timers
        if (this.dotTimer) {
            this.dotTimer.remove();
        }
        if (this.timeoutTimer) {
            this.timeoutTimer.remove();
            this.timeoutTimer = null;
        }
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
    
    private cleanupLingeringUIElements() {
        console.log("LoadingScene: Cleaning up any lingering UI elements from other scenes");
        
        try {
            // Clean up login/name select scene elements
            const nameInput = document.getElementById('name-select-input');
            if (nameInput && nameInput.parentNode) {
                console.log("Removing lingering name input");
                nameInput.remove();
            }
            
            const loginInput = document.getElementById('login-name-input');
            if (loginInput && loginInput.parentNode) {
                console.log("Removing lingering login input");
                loginInput.remove();
            }
            
            document.querySelectorAll('.name-select-button, .login-button').forEach(el => {
                if (el && el.parentNode) {
                    console.log("Removing lingering button");
                    el.remove();
                }
            });
            
            // Clean up class select scene elements
            const classContainer = document.getElementById('class-select-container');
            if (classContainer && classContainer.parentNode) {
                console.log("Removing lingering class container");
                classContainer.remove();
            }
            
            document.querySelectorAll('.class-select-button').forEach(el => {
                if (el && el.parentNode) {
                    console.log("Removing lingering class button");
                    el.remove();
                }
            });
            
            // General cleanup for buttons and inputs that might be left over
            document.querySelectorAll('input[type="text"]').forEach(el => {
                const id = el.id;
                if ((id === 'login-name-input' || id === 'name-select-input') && el.parentNode) {
                    console.log("Removing generic text input");
                    el.remove();
                }
            });
            
            document.querySelectorAll('button').forEach(el => {
                const buttonText = (el as HTMLElement).textContent || '';
                if ((buttonText.includes('Set Name') || 
                     buttonText.includes('Fighter') || 
                     buttonText.includes('Rogue') || 
                     buttonText.includes('Mage') || 
                     buttonText.includes('Paladin') || 
                     buttonText.includes('Confirm')) && 
                    el.parentNode) {
                    console.log("Removing generic button:", buttonText);
                    el.remove();
                }
            });
        } catch (e) {
            console.error("Error in cleanupLingeringUIElements:", e);
        }
    }
} 