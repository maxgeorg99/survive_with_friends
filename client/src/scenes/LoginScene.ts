import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import { localization } from '../utils/localization';
import { isMobileDevice, getResponsiveFontSize, applyResponsiveStyles, getResponsiveDimensions } from '../utils/responsive';

export default class LoginScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    
    // UI Elements
    private statusText!: Phaser.GameObjects.Text;
    private nameInput!: HTMLInputElement;
    private nameButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private loginContainer!: Phaser.GameObjects.Container;
    private nameInputContainer!: HTMLDivElement;

    constructor() {
        super('LoginScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("LoginScene constructor called");
    }

    preload() {
        // Load assets needed for the login screen
        this.load.image('title_bg', 'assets/title_bg.png');
    }

    create() {
        // Set up background
        const { width, height } = this.scale;
        
        // Use a dark blue color if no background image
        this.cameras.main.setBackgroundColor('#042E64');
        
        // Add fade-in effect for smoother transitions
        this.cameras.main.fadeIn(500);
        
        try {
            if (this.textures.exists('title_bg')) {
                this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all login UI elements
        this.loginContainer = this.add.container(width/2, height/2);
        
        // Add game title
        const titleText = this.add.text(0, -150, 'SURVIVE WITH FRIENDS', {
            fontFamily: 'Arial Black',
            fontSize: isMobileDevice() ? '32px' : '64px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.loginContainer.add(titleText);
        
        // Add status text (only for connection status, not for name prompt)
        this.statusText = this.add.text(0, -80, 'Connecting to server...', {
            fontFamily: 'Arial',
            fontSize: isMobileDevice() ? '20px' : '24px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        this.loginContainer.add(this.statusText);
        
        // Create HTML elements for input
        this.createHTMLElements();
        
        // Add error text (initially hidden)
        this.errorText = this.add.text(0, 200, '', {
            fontFamily: 'Arial',
            fontSize: isMobileDevice() ? '18px' : '18px',
            color: '#ff0000',
            align: 'center'
        }).setOrigin(0.5).setVisible(false);
        this.loginContainer.add(this.errorText);
        
        // Register game event listeners
        this.registerEventListeners();
        
        // Check initial connection state
        this.updateConnectionStatus();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);

        this.events.on("shutdown", this.shutdown, this);
    }
    
    private createHTMLElements() {
        // Remove any existing elements
        const existingInput = document.getElementById('login-name-input-container');
        if (existingInput) existingInput.remove();
        
        const existingButtons = document.querySelectorAll('.login-button');
        existingButtons.forEach(btn => btn.remove());
        
        const isMobile = isMobileDevice();
        const { width, height } = this.scale;
        
        // Create a wrapper container for the input field and button
        this.nameInputContainer = document.createElement('div');
        this.nameInputContainer.id = 'login-name-input-container';
        this.nameInputContainer.className = 'login-input-container';
        this.nameInputContainer.style.position = 'absolute';
        this.nameInputContainer.style.left = '50%';
        this.nameInputContainer.style.transform = 'translateX(-50%)';
        this.nameInputContainer.style.width = isMobile ? '80%' : '300px';
        this.nameInputContainer.style.maxWidth = '300px';
        this.nameInputContainer.style.display = 'none'; // Initially hidden
        this.nameInputContainer.style.zIndex = '1000';
        
        // Position in the center vertically on mobile too - using percentage instead of fixed value
        const topPosition = height * 0.4; // 40% from the top
        this.nameInputContainer.style.top = `${topPosition}px`;
        
        document.body.appendChild(this.nameInputContainer);
        
        // Create name input with improved styling
        this.nameInput = document.createElement('input');
        this.nameInput.id = 'login-name-input';
        this.nameInput.type = 'text';
        this.nameInput.placeholder = 'Enter your name';
        this.nameInput.maxLength = 16;
        this.nameInput.style.width = '100%';
        this.nameInput.style.fontFamily = 'Arial';
        this.nameInput.style.fontSize = isMobile ? '18px' : '16px';
        this.nameInput.style.padding = isMobile ? '15px' : '10px';
        this.nameInput.style.textAlign = 'center';
        this.nameInput.style.borderRadius = '8px';
        this.nameInput.style.marginBottom = '15px';
        this.nameInput.style.boxSizing = 'border-box';
        this.nameInput.style.border = '2px solid #34495e';
        this.nameInput.style.backgroundColor = '#fff';
        this.nameInput.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
        this.nameInputContainer.appendChild(this.nameInput);
        
        // Create Set Name button with improved styling
        this.nameButton = document.createElement('button');
        this.nameButton.textContent = 'Set Name';
        this.nameButton.className = 'login-button';
        this.nameButton.style.width = '100%';
        this.nameButton.style.boxSizing = 'border-box';
        this.nameButton.style.fontFamily = 'Arial';
        this.nameButton.style.fontSize = isMobile ? '18px' : '16px';
        this.nameButton.style.padding = isMobile ? '15px' : '12px';
        this.nameButton.style.borderRadius = '8px';
        this.nameButton.style.backgroundColor = '#4CAF50';
        this.nameButton.style.color = 'white';
        this.nameButton.style.border = 'none';
        this.nameButton.style.cursor = 'pointer';
        this.nameButton.style.textAlign = 'center';
        this.nameButton.style.fontWeight = 'bold';
        this.nameButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
        this.nameInputContainer.appendChild(this.nameButton);
        
        // Create a mobile-optimized wrapper container for visual enhancement
        if (isMobile) {
            this.nameInputContainer.style.backgroundColor = 'rgba(0,0,0,0.7)';
            this.nameInputContainer.style.padding = '20px';
            this.nameInputContainer.style.borderRadius = '12px';
            this.nameInputContainer.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
        }
        
        // Add event listeners
        this.nameButton.addEventListener('click', () => this.setPlayerName());
        this.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.setPlayerName();
            }
        });
        
        // Handle keyboard visibility changes on mobile without extreme positioning
        // We'll use a more subtle approach that doesn't jump as drastically
        if (isMobile) {
            // Store the original position
            const originalTopPosition = topPosition;
            
            // On iOS, use the visualViewport API if available
            if (window.visualViewport) {
                // Listen for resize events on the viewport (keyboard opening/closing)
                window.visualViewport.addEventListener('resize', () => {
                    if (document.activeElement === this.nameInput) {
                        // Check if the keyboard is likely open (viewport height reduced)
                        if (window.visualViewport.height < window.innerHeight * 0.75) {
                            // Adjust position to be visible with keyboard, but not too high
                            const adjustedPosition = Math.max(height * 0.2, window.visualViewport.height * 0.25);
                            this.nameInputContainer.style.top = `${adjustedPosition}px`;
                        } else {
                            // Restore the original position
                            this.nameInputContainer.style.top = `${originalTopPosition}px`;
                        }
                    }
                });
            } else {
                // Fallback for browsers without visualViewport API
                this.nameInput.addEventListener('focus', () => {
                    // Add a small class to flag that the keyboard is open
                    document.body.classList.add('keyboard-open');
                    
                    // Move only slightly up instead of jumping to the very top
                    const adjustedPosition = Math.max(height * 0.25, originalTopPosition * 0.6);
                    this.nameInputContainer.style.top = `${adjustedPosition}px`;
                    
                    // Use a timeout to ensure repositioning after keyboard is fully shown
                    setTimeout(() => {
                        // Only adjust if still focused
                        if (document.activeElement === this.nameInput) {
                            this.nameInputContainer.style.top = `${adjustedPosition}px`;
                        }
                    }, 300);
                });
                
                this.nameInput.addEventListener('blur', () => {
                    document.body.classList.remove('keyboard-open');
                    this.nameInputContainer.style.top = `${originalTopPosition}px`;
                });
            }
        }
    }
    
    private positionHTMLElements() {
        // No need to reposition - we're using fixed positioning now
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        const isMobile = isMobileDevice();
        
        // Update container position to new center
        if (this.loginContainer) {
            this.loginContainer.setPosition(width/2, height/2);
            
            // Update title text size based on screen width
            const titleText = this.loginContainer.getAt(0) as Phaser.GameObjects.Text;
            if (titleText) {
                titleText.setFontSize(isMobile ? parseInt(getResponsiveFontSize(48)) : 64);
            }
            
            // Update status text size
            if (this.statusText) {
                this.statusText.setFontSize(isMobile ? parseInt(getResponsiveFontSize(20)) : 24);
            }
            
            // Update error text size
            if (this.errorText) {
                this.errorText.setFontSize(isMobile ? parseInt(getResponsiveFontSize(16)) : 18);
            }
        }
        
        // Update HTML element positions - use percentage-based positioning for more stability
        if (this.nameInputContainer) {
            const topPosition = height * 0.4; // 40% from the top for consistency
            
            // Only update if not currently focused, to avoid jumping during typing
            if (document.activeElement !== this.nameInput) {
                this.nameInputContainer.style.top = `${topPosition}px`;
            }
            
            this.nameInputContainer.style.width = isMobile ? '80%' : '300px';
        }
    }
    
    private registerEventListeners() {
        // Connection events
        this.gameEvents.on(GameEvents.CONNECTION_ESTABLISHED, this.handleConnectionEstablished, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Account events
        this.gameEvents.on(GameEvents.ACCOUNT_CREATED, this.handleAccountCreated, this);
        this.gameEvents.on(GameEvents.NAME_SET, this.handleNameSet, this);
        
        // Loading events
        this.gameEvents.on(GameEvents.LOADING_ERROR, this.handleLoadingError, this);
    }
    
    private handleConnectionEstablished() {
        console.log("Connection established event received in LoginScene");
        this.updateConnectionStatus();
    }
    
    private handleConnectionLost() {
        console.log("Connection lost event received in LoginScene");
        this.updateConnectionStatus();
        this.statusText.setText('Disconnected. Please refresh the page.');
        this.hideAllInputs();
    }
    
    private handleAccountCreated(account: any) {
        console.log("Account created event received in LoginScene");
        if (!account.name) {
            this.showNameInput();
        }
    }
    
    private handleNameSet() {
        console.log("Name set event received in LoginScene");
        // If we're in the login scene when name is set, we should go to class select
        // This will happen automatically through LoadingScene transitions
    }
    
    private handleLoadingError(message: string) {
        console.log("Loading error event received in LoginScene", message);
        this.showError(message);
    }
    
    private updateConnectionStatus() {
        if (this.spacetimeDBClient.isConnected) {
            console.log("Connected to server in LoginScene");
            this.statusText.setText(''); // Remove any status text after connection
            
            // Check if we already have an account with a name
            if (this.spacetimeDBClient.sdkConnection?.db?.account) {
                const myAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
                if (myAccount && myAccount.name) {
                    console.log("Already have an account with name in LoginScene, redirecting to SplashScene");
                    this.hideAllInputs();
                    this.scene.start('SplashScene');
                    return;
                }
            }
            
            this.showNameInput();
        } else {
            this.statusText.setText('Connecting to server...');
            this.hideAllInputs();
        }
    }
    
    private setPlayerName() {
        const name = this.nameInput.value.trim();
        
        if (!name || name.length < 1 || name.length > 16) {
            this.showError('Please enter a valid name (1-16 characters)');
            return;
        }
        
        // Hide elements immediately before scene transition
        this.hideAllInputs();
        
        // Show loading scene while setting name
        this.scene.start('LoadingScene', { 
            message: 'Setting your name...', 
            nextScene: 'PrologScene',
            timeoutDuration: 10000, // 10 seconds timeout
            waitingFor: 'name'  // Explicitly wait for the name to be set
        });
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log(`Setting name to: ${name}`);
                this.spacetimeDBClient.sdkConnection.reducers.setName(name);
            } else {
                console.error("Cannot set name: SpacetimeDB reducers not available");
                this.gameEvents.emit(GameEvents.LOADING_ERROR, "Connection to server failed");
            }
        } catch (error) {
            console.error('Error setting name:', error);
            this.gameEvents.emit(GameEvents.LOADING_ERROR, "Failed to set your name");
        }
    }
    
    private hideAllInputs() {
        if (this.nameInputContainer) {
            this.nameInputContainer.style.display = 'none';
        }
    }
    
    private showNameInput() {
        if (this.nameInputContainer) {
            this.nameInputContainer.style.display = 'block';
            // Focus on the input field so mobile keyboard appears
            setTimeout(() => {
                if (this.nameInput) {
                    this.nameInput.focus();
                }
            }, 300); // Short delay to ensure the input is visible
        }
    }
    
    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    shutdown() {
        // First hide all inputs
        this.hideAllInputs();
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.CONNECTION_ESTABLISHED, this.handleConnectionEstablished, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        this.gameEvents.off(GameEvents.ACCOUNT_CREATED, this.handleAccountCreated, this);
        this.gameEvents.off(GameEvents.NAME_SET, this.handleNameSet, this);
        this.gameEvents.off(GameEvents.LOADING_ERROR, this.handleLoadingError, this);
        
        // Clean up HTML elements more thoroughly
        try {
            // Find elements by multiple methods to ensure we get them all
            let inputElements = [];
            let buttonElements = [];
            
            // Method 1: Our class references
            if (this.nameInputContainer) inputElements.push(this.nameInputContainer);
            
            // Method 2: Query by ID
            const containerById = document.getElementById('login-name-input-container');
            if (containerById) inputElements.push(containerById);
            
            // Method 3: Query by class
            document.querySelectorAll('.login-button').forEach(el => buttonElements.push(el));
            
            // Remove all found elements
            inputElements.forEach(el => {
                if (el && el.parentNode) {
                    console.log("Removing login input container element:", el.id);
                    el.remove();
                }
            });
            
            buttonElements.forEach(el => {
                if (el && el.parentNode) {
                    console.log("Removing login button element:", (el as HTMLElement).className);
                    el.remove();
                }
            });
            
            console.log("LoginScene HTML elements cleaned up");
        } catch (e) {
            console.error("Error cleaning up LoginScene HTML elements:", e);
        }
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }

    // Add a dedicated aggressive DOM cleanup method
    private forceCleanupDOMElements() {
        console.log("LoginScene: Force cleaning up all DOM elements");
        
        try {
            // Immediately hide any input elements we might have reference to
            if (this.nameInputContainer) {
                this.nameInputContainer.style.display = 'none';
            }
            
            // Find ALL possible login elements in the document and remove them
            // By ID
            const nameInputContainer = document.getElementById('login-name-input-container');
            if (nameInputContainer) {
                console.log("Force-removing login input container by ID");
                nameInputContainer.remove();
            }
            
            // By class name
            document.querySelectorAll('.login-button').forEach(el => {
                console.log("Force-removing login button by class");
                el.remove();
            });
            
            // By input type
            document.querySelectorAll('input[type="text"]').forEach(el => {
                if (el.id === 'login-name-input') {
                    console.log("Force-removing text input");
                    el.remove();
                }
            });
            
            // By content
            document.querySelectorAll('button').forEach(el => {
                if ((el as HTMLElement).textContent === 'Set Name') {
                    console.log("Force-removing button by text content");
                    el.remove();
                }
            });
        } catch (e) {
            console.error("Error in forceCleanupDOMElements:", e);
        }
    }
}