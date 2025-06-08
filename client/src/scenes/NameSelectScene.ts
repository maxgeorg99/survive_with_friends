import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';
import OptionsUI from '../ui/OptionsUI';

export default class NameSelectScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    
    // UI Elements
    private nameContainer!: Phaser.GameObjects.Container;
    private nameInput!: HTMLInputElement;
    private nameButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private optionsUI!: OptionsUI;
    private optionsKey!: Phaser.Input.Keyboard.Key;

    constructor() {
        super('NameSelectScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("NameSelectScene constructor called");
    }

    preload() {
        // Load assets needed for the name select screen
        this.load.image('title_bg', '/assets/title_bg.png');
        
        // Load assets for options menu
        this.load.image('icon_music', '/assets/icon_music.png');
        this.load.image('icon_sound', '/assets/icon_sound.png');
    }

    create() {
        console.log("NameSelectScene create() called");
        const { width, height } = this.scale;
        
        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
            // Play voice name cue when entering name select
            soundManager.playSound('voice_name', 0.9);
        }
        
        // Initialize music manager and continue title music
        this.musicManager = new MusicManager(this);
        this.musicManager.playTrack('title');
        
        // Set background
        this.cameras.main.setBackgroundColor('#042E64');
        
        try {
            if (this.textures.exists('title_bg')) {
                this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all name UI elements
        this.nameContainer = this.add.container(width/2, height/2);
        
        // Add game title
        const titleText = this.add.text(0, -150, 'VIBE SURVIVORS', {
            fontFamily: 'Arial Black',
            fontSize: '64px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.nameContainer.add(titleText);
        
        // Add instruction text
        const instructionText = this.add.text(0, -80, 'Enter your name to begin your journey:', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        this.nameContainer.add(instructionText);
        
        // Create HTML elements for input
        this.createHTMLElements();
        
        // Add error text (initially hidden)
        this.errorText = this.add.text(0, 120, '', {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#ff0000',
            align: 'center'
        }).setOrigin(0.5).setVisible(false);
        this.nameContainer.add(this.errorText);
        
        // Register event listeners
        this.registerEventListeners();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
        
        // Initialize options UI
        this.optionsUI = new OptionsUI(this);
        
                // Handle options toggle key
        if (this.input.keyboard) {
            this.optionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.O);
            this.optionsKey.on('down', () => {
                this.optionsUI.toggle();
            });
        }
        
        // Focus on the input
        setTimeout(() => {
            this.nameInput.focus();
        }, 100);
        
        console.log("NameSelectScene create() completed successfully");
    }
    
    private createHTMLElements() {
        // Remove any existing elements
        const existingInput = document.getElementById('name-select-input');
        if (existingInput) existingInput.remove();
        
        const existingButtons = document.querySelectorAll('.name-select-button');
        existingButtons.forEach(btn => btn.remove());
        
        // Create name input
        this.nameInput = document.createElement('input');
        this.nameInput.id = 'name-select-input';
        this.nameInput.type = 'text';
        this.nameInput.placeholder = 'Enter your name';
        this.nameInput.maxLength = 16;
        this.nameInput.style.position = 'absolute';
        this.nameInput.style.fontFamily = 'Arial';
        this.nameInput.style.fontSize = '20px';
        this.nameInput.style.padding = '10px';
        this.nameInput.style.width = '300px';
        this.nameInput.style.textAlign = 'center';
        this.nameInput.style.borderRadius = '4px';
        this.nameInput.style.border = '2px solid #ccc';
        this.nameInput.style.left = '50%';
        this.nameInput.style.transform = 'translateX(-50%)';
        document.body.appendChild(this.nameInput);
        
        // Create Set Name button
        this.nameButton = document.createElement('button');
        this.nameButton.textContent = 'Set Name';
        this.nameButton.className = 'name-select-button';
        this.nameButton.style.position = 'absolute';
        this.nameButton.style.fontFamily = 'Arial';
        this.nameButton.style.fontSize = '20px';
        this.nameButton.style.padding = '10px 20px';
        this.nameButton.style.width = '150px';
        this.nameButton.style.borderRadius = '4px';
        this.nameButton.style.backgroundColor = '#4CAF50';
        this.nameButton.style.color = 'white';
        this.nameButton.style.border = 'none';
        this.nameButton.style.cursor = 'pointer';
        this.nameButton.style.left = '50%';
        this.nameButton.style.transform = 'translateX(-50%)';
        document.body.appendChild(this.nameButton);
        
        // Add event listeners
        this.nameButton.addEventListener('click', () => this.setPlayerName());
        this.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.setPlayerName();
            }
        });
        
        // Prevent Phaser from capturing keyboard events when input has focus
        this.nameInput.addEventListener('focus', () => {
            console.log("NameSelectScene: Input focused, disabling Phaser keyboard capture");
            // Disable Phaser keyboard input entirely
            if (this.input.keyboard) {
                this.input.keyboard.enabled = false;
            }
        });
        
        // Re-enable Phaser keyboard capture when input loses focus
        this.nameInput.addEventListener('blur', () => {
            console.log("NameSelectScene: Input blurred, re-enabling Phaser keyboard capture");
            // Re-enable Phaser keyboard input
            if (this.input.keyboard) {
                this.input.keyboard.enabled = true;
            }
        });
        
        // Add additional keydown event handler to prevent Phaser from capturing events
        this.nameInput.addEventListener('keydown', (e) => {
            // Stop the event from propagating to Phaser
            e.stopPropagation();
        });
        
        // Position elements initially
        this.positionHTMLElements();
    }
    
    private positionHTMLElements() {
        const { height } = this.scale;
        
        this.nameInput.style.top = `${height/2 - 10}px`;
        this.nameButton.style.top = `${height/2 + 50}px`;
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        
        if (this.nameContainer) {
            this.nameContainer.setPosition(width/2, height/2);
        }
        
        this.positionHTMLElements();
    }
    
    private registerEventListeners() {
        // Listen for account updates to see if name was set
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
    }
    
    private handleAccountUpdated(ctx: any, oldAccount: any, newAccount: any) {
        console.log("NameSelectScene: Account updated event received");
        console.log("NameSelectScene: Old state:", oldAccount.state.tag, "New state:", newAccount.state.tag);
        console.log("NameSelectScene: Old name:", oldAccount.name, "New name:", newAccount.name);
        
        // Check if this is our account and state changed
        if (newAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
            if (newAccount.state.tag !== 'ChoosingName') {
                console.log("NameSelectScene: Account state changed from ChoosingName to", newAccount.state.tag, "- navigating away");
                
                // Transition to LoadingScene which will evaluate the new state
                this.scene.start('LoadingScene', { 
                    message: 'Evaluating account state...', 
                    waitingFor: 'account_evaluation'
                });
            } else {
                console.log("NameSelectScene: Account updated but still in ChoosingName state");
                // Check if the name actually got set but state didn't change
                if (newAccount.name && newAccount.name !== oldAccount.name) {
                    console.log("NameSelectScene: Name was set but state didn't change. Name:", newAccount.name);
                }
            }
        }
    }
    
    private handleConnectionLost() {
        console.log("Connection lost in NameSelectScene");
        this.showError('Connection lost. Please refresh the page.');
    }
    
    private setPlayerName() {
        // Check if DOM elements still exist (in case of race condition cleanup)
        if (!this.nameInput || !this.nameInput.parentNode || !this.nameButton || !this.nameButton.parentNode) {
            console.warn("NameSelectScene: DOM elements were cleaned up, cannot set name");
            this.showError('Interface was reset. Please try again.');
            return;
        }
        
        const name = this.nameInput.value.trim();
        
        if (!name || name.length < 1 || name.length > 16) {
            this.showError('Please enter a valid name (1-16 characters)');
            return;
        }
        
        console.log("NameSelectScene: Starting setPlayerName with name:", name);
        
        // Hide error and disable input
        this.errorText.setVisible(false);
        this.nameInput.disabled = true;
        this.nameButton.disabled = true;
        this.nameButton.textContent = 'Setting...';
        
        try {
            console.log("NameSelectScene: Checking spacetimeDBClient connection...");
            console.log("NameSelectScene: isConnected:", this.spacetimeDBClient.isConnected);
            console.log("NameSelectScene: sdkConnection exists:", !!this.spacetimeDBClient.sdkConnection);
            console.log("NameSelectScene: reducers exists:", !!this.spacetimeDBClient.sdkConnection?.reducers);
            
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log("NameSelectScene: About to call setName reducer with name:", name);
                
                // Call the reducer and catch any errors
                try {
                    this.spacetimeDBClient.sdkConnection.reducers.setName(name);
                    console.log("NameSelectScene: setName reducer call completed successfully");
                    
                    // Play choose sound effect when name is set
                    const soundManager = (window as any).soundManager;
                    if (soundManager) {
                        soundManager.playSound('choose', 0.8);
                    }
                } catch (reducerError) {
                    console.error("NameSelectScene: Error calling setName reducer:", reducerError);
                    this.showError('Error calling setName reducer: ' + (reducerError as Error).message);
                    this.resetInput();
                    return;
                }
                
                console.log("NameSelectScene: Transitioning to LoadingScene");
                
                // Add a small delay to let the sound start before scene transition
                this.time.delayedCall(200, () => {
                    // Show loading scene while waiting for account state change
                    this.scene.start('LoadingScene', { 
                        message: 'Setting your name...', 
                        waitingFor: 'target_state',
                        targetState: 'ChoosingClass'
                    });
                });
            } else {
                console.error("NameSelectScene: Cannot set name - no reducers available");
                console.log("NameSelectScene: sdkConnection:", this.spacetimeDBClient.sdkConnection);
                this.showError('Cannot set name: Server connection not available');
                this.resetInput();
            }
        } catch (error) {
            console.error('NameSelectScene: Error in setPlayerName:', error);
            this.showError('An error occurred while setting your name: ' + (error as Error).message);
            this.resetInput();
        }
    }
    
    private resetInput() {
        // Check if DOM elements still exist before trying to reset them
        if (this.nameInput && this.nameInput.parentNode) {
            this.nameInput.disabled = false;
        }
        if (this.nameButton && this.nameButton.parentNode) {
            this.nameButton.disabled = false;
            this.nameButton.textContent = 'Set Name';
        }
    }
    
    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    shutdown() {
        // Cleanup options UI
        if (this.optionsUI) {
            this.optionsUI.destroy();
        }
        
        // Cleanup music manager
        if (this.musicManager) {
            this.musicManager.cleanup();
        }
        
        // Remove HTML elements
        try {
            if (this.nameInput && this.nameInput.parentNode) {
                this.nameInput.remove();
            }
            if (this.nameButton && this.nameButton.parentNode) {
                this.nameButton.remove();
            }
            
            // Clean up any other elements that might be lingering
            const input = document.getElementById('name-select-input');
            if (input) input.remove();
            
            document.querySelectorAll('.name-select-button').forEach(el => el.remove());
        } catch (e) {
            console.error("Error cleaning up NameSelectScene HTML elements:", e);
        }
        
        // Remove keyboard listeners and ensure keyboard is re-enabled
        if (this.optionsKey) {
            this.optionsKey.removeAllListeners();
        }
        if (this.input.keyboard) {
            this.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.O);
            this.input.keyboard.enabled = true; // Ensure keyboard is enabled for next scene
        }
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        console.log("NameSelectScene shutdown completed");
    }
} 