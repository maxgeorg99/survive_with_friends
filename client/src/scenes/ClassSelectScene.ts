import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Account } from '../autobindings';
import PlayerClass from '../autobindings/player_class_type';
import { GameEvents } from '../constants/GameEvents';

// Map player class to numeric class ID
const CLASS_ID_MAP = {
    "Fighter": 0,
    "Rogue": 1,
    "Mage": 2,
    "Paladin": 3
};

export default class ClassSelectScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    
    // UI Elements
    private titleText!: Phaser.GameObjects.Text;
    private subtitleText!: Phaser.GameObjects.Text;
    private classButtonsContainer!: HTMLDivElement;
    private fighterButton!: HTMLButtonElement;
    private rogueButton!: HTMLButtonElement;
    private mageButton!: HTMLButtonElement;
    private paladinButton!: HTMLButtonElement;
    private confirmButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    
    // State tracking
    private selectedClass: PlayerClass | null = null;
    private isLoading: boolean = false;

    constructor() {
        super('ClassSelectScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("ClassSelectScene constructor called");
    }

    preload() {
        // Load character class icons
        this.load.image('fighter_icon', '/assets/fighter_icon.png');
        this.load.image('rogue_icon', '/assets/rogue_icon.png');
        this.load.image('mage_icon', '/assets/mage_icon.png');
        this.load.image('paladin_icon', '/assets/paladin_icon.png');
        this.load.image('title_bg', '/assets/title_bg.png');
    }

    create() {
        // Set up background
        const { width, height } = this.scale;
        
        // Use a dark blue color if no background image
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
        
        // Add title
        this.titleText = this.add.text(width/2, height/4, 'SELECT YOUR CLASS', {
            fontFamily: 'Arial Black',
            fontSize: '48px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        
        // Add subtitle
        this.subtitleText = this.add.text(width/2, height/4 + 60, 'Choose wisely, brave survivor...', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);
        
        // Create HTML elements for class selection
        this.createClassButtons();
        
        // Add error text (initially hidden)
        this.errorText = this.add.text(width/2, height * 0.85, '', {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#ff0000',
            align: 'center'
        }).setOrigin(0.5).setVisible(false);
        
        // Register event listeners
        this.registerEventListeners();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Position HTML elements
        this.positionHTMLElements();    
        
        // Only clean up when the scene is actually shut down, not at scene start
        this.events.on('shutdown', this.shutdown, this);
    }
    
    private createClassButtons() {
        // Remove any existing elements
        const existingContainer = document.getElementById('class-select-container');
        if (existingContainer) existingContainer.remove();
        
        // Create class selection container
        this.classButtonsContainer = document.createElement('div');
        this.classButtonsContainer.id = 'class-select-container';
        this.classButtonsContainer.style.position = 'absolute';
        this.classButtonsContainer.style.display = 'flex';
        this.classButtonsContainer.style.flexDirection = 'column';
        this.classButtonsContainer.style.alignItems = 'center';
        this.classButtonsContainer.style.gap = '20px';
        document.body.appendChild(this.classButtonsContainer);
        
        const createClassButton = (name: string, classType: PlayerClass, iconName: string) => {
            const button = document.createElement('button');
            button.className = 'class-select-button';
            button.style.position = 'relative';
            button.style.width = '250px';
            button.style.height = '70px';
            button.style.padding = '10px';
            button.style.margin = '5px';
            button.style.backgroundColor = '#2c3e50';
            button.style.color = 'white';
            button.style.border = '2px solid #34495e';
            button.style.borderRadius = '5px';
            button.style.cursor = 'pointer';
            button.style.fontFamily = 'Arial';
            button.style.fontSize = '18px';
            button.style.textAlign = 'left';
            button.style.transition = 'background-color 0.2s, border-color 0.2s';
            button.style.display = 'flex';
            button.style.alignItems = 'center';
            
            // Add icon if available
            try {
                if (this.textures.exists(iconName)) {
                    const icon = document.createElement('img');
                    icon.src = '/assets/' + iconName + '.png';
                    icon.style.width = '50px';
                    icon.style.height = '50px';
                    icon.style.marginRight = '10px';
                    button.appendChild(icon);
                }
            } catch (error) {
                console.error(`Error adding icon for ${name}:`, error);
            }
            
            // Add text
            const textSpan = document.createElement('span');
            textSpan.textContent = name;
            button.appendChild(textSpan);
            
            // Add event listener
            button.addEventListener('click', () => {
                this.selectClass(classType, button);
            });
            
            return button;
        };
        
        // Create all class buttons using the correct PlayerClass types
        this.fighterButton = createClassButton('Fighter', PlayerClass.Fighter as PlayerClass, 'fighter_icon');
        this.rogueButton = createClassButton('Rogue', PlayerClass.Rogue as PlayerClass, 'rogue_icon');
        this.mageButton = createClassButton('Mage', PlayerClass.Mage as PlayerClass, 'mage_icon');
        this.paladinButton = createClassButton('Paladin', PlayerClass.Paladin as PlayerClass, 'paladin_icon');
        
        // Add all buttons to container
        this.classButtonsContainer.appendChild(this.fighterButton);
        this.classButtonsContainer.appendChild(this.rogueButton);
        this.classButtonsContainer.appendChild(this.mageButton);
        this.classButtonsContainer.appendChild(this.paladinButton);
        
        // Add confirm button
        this.confirmButton = document.createElement('button');
        this.confirmButton.textContent = 'Confirm Selection';
        this.confirmButton.style.marginTop = '20px';
        this.confirmButton.style.padding = '12px 24px';
        this.confirmButton.style.backgroundColor = '#27ae60';
        this.confirmButton.style.color = 'white';
        this.confirmButton.style.border = 'none';
        this.confirmButton.style.borderRadius = '5px';
        this.confirmButton.style.fontSize = '18px';
        this.confirmButton.style.cursor = 'pointer';
        this.confirmButton.style.transition = 'background-color 0.2s';
        this.confirmButton.style.display = 'none'; // Hidden until a class is selected
        
        this.confirmButton.addEventListener('click', () => {
            this.spawnPlayer();
        });
        
        this.classButtonsContainer.appendChild(this.confirmButton);
    }
    
    private positionHTMLElements() {
        const { width, height } = this.scale;
        
        // Position class select container
        this.classButtonsContainer.style.left = `${width / 2 - 125}px`; // Centered
        this.classButtonsContainer.style.top = `${height / 2 - 100}px`;
    }
    
    private handleResize() {
        this.positionHTMLElements();
    }
    
    private registerEventListeners() {
        // Listen for account updates to see if class was selected
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        
        // Listen for connection events
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
    }
    
    private handleAccountUpdated(ctx: any, oldAccount: any, newAccount: any) {
        console.log("ClassSelectScene: Account updated event received");
        console.log("ClassSelectScene: Old state:", oldAccount.state.tag, "New state:", newAccount.state.tag);
        console.log("ClassSelectScene: Old player ID:", oldAccount.currentPlayerId, "New player ID:", newAccount.currentPlayerId);
        
        // Check if this is our account and state changed
        if (newAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
            if (newAccount.state.tag !== 'ChoosingClass') {
                console.log("ClassSelectScene: Account state changed from ChoosingClass to", newAccount.state.tag, "- navigating away");
                
                // Transition to LoadingScene which will evaluate the new state
                this.scene.start('LoadingScene', { 
                    message: 'Evaluating account state...', 
                    waitingFor: 'account_evaluation'
                });
            } else {
                console.log("ClassSelectScene: Account updated but still in ChoosingClass state");
                // Check if player was created but state didn't change
                if (newAccount.currentPlayerId !== oldAccount.currentPlayerId) {
                    console.log("ClassSelectScene: Player ID changed but state didn't change. New player ID:", newAccount.currentPlayerId);
                }
            }
        }
    }
    
    private handleConnectionLost() {
        console.log("Connection lost event received in ClassSelectScene");
        this.showError('Connection to server lost. Please refresh the page.');
    }
    
    private selectClass(classType: PlayerClass, button: HTMLButtonElement) {
        // Reset all button styles
        [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton].forEach(btn => {
            if (btn) {
                btn.style.backgroundColor = '#2c3e50';
                btn.style.borderColor = '#34495e';
            }
        });
        
        // Highlight selected button
        button.style.backgroundColor = '#3498db';
        button.style.borderColor = '#2980b9';
        
        // Set selected class
        this.selectedClass = classType;
        console.log(`Selected class: ${classType.tag}`);
        
        // Show confirm button
        this.confirmButton.style.display = 'block';
        
        // Hide any error message
        this.errorText.setVisible(false);
    }
    
    private spawnPlayer() {
        if (!this.selectedClass) {
            this.showError('Please select a class first');
            return;
        }
        
        console.log("ClassSelectScene: Starting spawnPlayer");
        
        // Check current account state before spawning
        if (this.spacetimeDBClient.sdkConnection?.db && this.spacetimeDBClient.identity) {
            const currentAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
            if (currentAccount) {
                console.log("ClassSelectScene: Current account state:", currentAccount.state.tag);
                console.log("ClassSelectScene: Current player ID:", currentAccount.currentPlayerId);
                console.log("ClassSelectScene: Account name:", currentAccount.name);
            }
        }
        
        // Disable buttons to prevent double-clicking
        this.confirmButton.disabled = true;
        this.confirmButton.textContent = 'Creating...';
        
        [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton].forEach(btn => {
            if (btn) btn.disabled = true;
        });
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                // Get class ID from the PlayerClass tag
                const classId = CLASS_ID_MAP[this.selectedClass.tag];
                console.log(`ClassSelectScene: About to call spawnPlayer with class: ${this.selectedClass.tag} (ID: ${classId})`);
                
                // Add error handling for the reducer call
                try {
                    this.spacetimeDBClient.sdkConnection.reducers.spawnPlayer(classId);
                    console.log("ClassSelectScene: spawnPlayer reducer call completed");
                } catch (reducerError) {
                    console.error("ClassSelectScene: Error calling spawnPlayer reducer:", reducerError);
                    this.showError('Error calling spawnPlayer reducer: ' + (reducerError as Error).message);
                    this.resetButtons();
                    return;
                }
                
                console.log("ClassSelectScene: Transitioning to LoadingScene");
                
                // Show loading scene while waiting for account state change
                this.scene.start('LoadingScene', { 
                    message: 'Creating your character...', 
                    waitingFor: 'target_state',
                    targetState: 'Playing'
                });
            } else {
                console.error("ClassSelectScene: Cannot spawn player - no reducers available");
                this.showError('Cannot spawn player: Server connection not available');
                this.resetButtons();
            }
        } catch (error) {
            console.error('ClassSelectScene: Error in spawnPlayer:', error);
            this.showError('An error occurred while spawning your player: ' + (error as Error).message);
            this.resetButtons();
        }
    }
    
    private resetButtons() {
        this.confirmButton.disabled = false;
        this.confirmButton.textContent = 'Confirm Selection';
        
        [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton].forEach(btn => {
            if (btn) btn.disabled = false;
        });
    }
    
    // Add a dedicated cleanup method for HTML elements
    private cleanupHTMLElements() {
        console.log("Cleaning up ClassSelectScene HTML elements");
        try {
            // Method 1: Our class reference
            if (this.classButtonsContainer && this.classButtonsContainer.parentNode) {
                this.classButtonsContainer.remove();
            }
            
            // Method 2: Query by ID and class
            const container = document.getElementById('class-select-container');
            if (container && container.parentNode) {
                container.remove();
            }
            
            // Method 3: Query by class
            document.querySelectorAll('.class-select-button').forEach(el => {
                if (el && el.parentNode) {
                    el.remove();
                }
            });
            
            // Method 4: Look for any buttons that might be ours
            document.querySelectorAll('button').forEach(el => {
                if ((el as HTMLElement).textContent?.includes('Fighter') || 
                    (el as HTMLElement).textContent?.includes('Rogue') ||
                    (el as HTMLElement).textContent?.includes('Mage') ||
                    (el as HTMLElement).textContent?.includes('Paladin') ||
                    (el as HTMLElement).textContent?.includes('Confirm Selection')) {
                    if (el && el.parentNode) {
                        console.log("Removing class button:", (el as HTMLElement).textContent);
                        el.remove();
                    }
                }
            });
            
            // Look for the container div
            document.querySelectorAll('div').forEach(el => {
                if (el.id === 'class-select-container' || 
                    (el.children.length > 0 && Array.from(el.children).some(child => 
                        (child as HTMLElement).className === 'class-select-button'))) {
                    if (el && el.parentNode) {
                        console.log("Removing class container div");
                        el.remove();
                    }
                }
            });
        } catch (e) {
            console.error("Error in cleanupHTMLElements:", e);
        }
    }
    
    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    shutdown() {
        console.log("ClassSelectScene shutdown called");
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Use our dedicated cleanup method
        this.cleanupHTMLElements();
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
} 