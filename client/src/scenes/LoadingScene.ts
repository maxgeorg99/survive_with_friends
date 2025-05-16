import Phaser from 'phaser';
import { GameEvents } from '../constants/GameEvents';

export default class LoadingScene extends Phaser.Scene {
    private loadingText!: Phaser.GameObjects.Text;
    private spinner!: Phaser.GameObjects.Container;
    private dots!: Phaser.GameObjects.Text;
    private dotCount: number = 0;
    private dotTimer!: Phaser.Time.TimerEvent;
    private nextScene: string = '';
    private message: string = '';
    private timeoutDuration: number = 10000; // 10 seconds timeout by default
    private timeoutTimer: Phaser.Time.TimerEvent | null = null;
    private gameEvents: Phaser.Events.EventEmitter;
    private waitingFor: string = ''; // What are we waiting for? 'name', 'player', etc.

    constructor() {
        super('LoadingScene');
        this.gameEvents = (window as any).gameEvents;
    }

    init(data: { message?: string, nextScene?: string, timeoutDuration?: number, waitingFor?: string }) {
        this.message = data.message || 'Loading...';
        this.nextScene = data.nextScene || '';
        this.timeoutDuration = data.timeoutDuration || 10000;
        this.waitingFor = data.waitingFor || '';
        console.log(`LoadingScene initialized with message: ${this.message}, next scene: ${this.nextScene}, waiting for: ${this.waitingFor}`);
    }

    preload() {
        // Load title background
        this.load.image('title_bg', 'assets/title_bg.png');
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
        
        // Set timeout to prevent indefinite loading
        if (this.nextScene) {
            this.timeoutTimer = this.time.delayedCall(this.timeoutDuration, () => {
                console.log(`Loading timed out after ${this.timeoutDuration}ms, proceeding to ${this.nextScene}`);
                this.proceedToNextScene();
            });
        }
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
    }
    
    private registerEventListeners() {
        // Listen for loading complete event
        this.gameEvents.on(GameEvents.LOADING_COMPLETE, this.completeLoading, this);
        
        // Listen for connection lost event
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Listen for specific events based on what we're waiting for
        if (this.waitingFor === 'name') {
            console.log("done waiting for name");
            this.gameEvents.on(GameEvents.NAME_SET, this.completeLoading, this);
        } else if (this.waitingFor === 'player') {
            console.log("done waiting for player");
            this.gameEvents.on(GameEvents.PLAYER_CREATED, this.completeLoading, this);
        }

        this.events.on("shutdown", this.shutdown, this);
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
        this.timeoutTimer?.remove();
        this.timeoutTimer = null;
    }
    
    /**
     * Call this method to complete loading and move to the next scene
     */
    public completeLoading() {
        if (this.timeoutTimer) {
            this.timeoutTimer.remove();
            this.timeoutTimer = null;
        }
        
        if (this.nextScene) {
            this.proceedToNextScene();
            this.nextScene = "";
        }
    }
    
    private proceedToNextScene() {
        if (this.nextScene) {
            console.log(`Loading complete, proceeding to ${this.nextScene}`);
            this.scene.start(this.nextScene);
        } else {
            console.warn('No next scene specified, staying in LoadingScene');
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
        this.gameEvents.off(GameEvents.LOADING_COMPLETE, this.completeLoading, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        if (this.waitingFor === 'name') {
            this.gameEvents.off(GameEvents.NAME_SET, this.completeLoading, this);
        } else if (this.waitingFor === 'player') {
            this.gameEvents.off(GameEvents.PLAYER_CREATED, this.completeLoading, this);
        }
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);

        this.nextScene = "";
    }
    
    private cleanupLingeringUIElements() {
        console.log("LoadingScene: Cleaning up any lingering UI elements from other scenes");
        
        try {
            // Clean up login scene elements
            const loginInput = document.getElementById('login-name-input');
            if (loginInput && loginInput.parentNode) {
                console.log("Removing lingering login input");
                loginInput.remove();
            }
            
            document.querySelectorAll('.login-button').forEach(el => {
                if (el && el.parentNode) {
                    console.log("Removing lingering login button");
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
                if (el.id === 'login-name-input' && el.parentNode) {
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