import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, DeadPlayer, Account } from '../autobindings';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import PlayerClass from '../autobindings/player_class_type';

export default class LoginScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    
    // UI Elements
    private statusText!: Phaser.GameObjects.Text;
    private nameInput!: HTMLInputElement;
    private nameButton!: HTMLButtonElement;
    private spawnButton!: HTMLButtonElement;
    private respawnButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private loginContainer!: Phaser.GameObjects.Container;
    
    // Class Selection Elements
    private classButtonsContainer!: HTMLDivElement;
    private fighterButton!: HTMLButtonElement;
    private rogueButton!: HTMLButtonElement;
    private mageButton!: HTMLButtonElement;
    private paladinButton!: HTMLButtonElement;
    private confirmClassButton!: HTMLButtonElement;
    
    // State tracking
    private hasAccount: boolean = false;
    private hasName: boolean = false;
    private hasLivingPlayer: boolean = false;
    private hasDeadPlayer: boolean = false;
    private isConnected: boolean = false;
    private isLoading: boolean = false;
    private selectedClass: PlayerClass | null = null;

    constructor() {
        super('LoginScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        console.log("LoginScene constructor called");
    }

    preload() {
        // Load assets needed for the login screen
        this.load.image('login_background', '/assets/login_background.png');
        this.load.image('button', '/assets/button.png');
        
        // Load class icons if available
        this.load.image('fighter_icon', '/assets/fighter_icon.png');
        this.load.image('rogue_icon', '/assets/rogue_icon.png');
        this.load.image('mage_icon', '/assets/mage_icon.png');
        this.load.image('paladin_icon', '/assets/paladin_icon.png');
    }

    create() {
        // Set up background
        const { width, height } = this.scale;
        
        // Use a dark blue color if no background image
        this.cameras.main.setBackgroundColor('#042E64');
        
        try {
            if (this.textures.exists('login_background')) {
                this.add.image(width/2, height/2, 'login_background')
                    .setDisplaySize(width, height)
                    .setDepth(0);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all login UI elements
        this.loginContainer = this.add.container(width/2, height/2);
        
        // Add game title
        const titleText = this.add.text(0, -200, 'VIBE SURVIVORS', {
            fontFamily: 'Arial Black',
            fontSize: '64px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.loginContainer.add(titleText);
        
        // Add status text
        this.statusText = this.add.text(0, -120, 'Connecting to server...', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        this.loginContainer.add(this.statusText);
        
        // Create HTML elements for input
        this.createHTMLElements();
        
        // Add error text (initially hidden)
        this.errorText = this.add.text(0, 200, '', {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#ff0000',
            align: 'center'
        }).setOrigin(0.5).setVisible(false);
        this.loginContainer.add(this.errorText);
        
        // Register event handlers for SpacetimeDB client
        this.registerEventHandlers();
        
        // Check initial connection state
        this.checkConnectionState();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
    }
    
    private createHTMLElements() {
        // Remove any existing elements
        const existingInput = document.getElementById('login-name-input');
        if (existingInput) existingInput.remove();
        
        const existingButtons = document.querySelectorAll('.login-button');
        existingButtons.forEach(btn => btn.remove());
        
        const existingClassContainer = document.getElementById('class-buttons-container');
        if (existingClassContainer) existingClassContainer.remove();
        
        // Create name input
        this.nameInput = document.createElement('input');
        this.nameInput.id = 'login-name-input';
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
        this.nameInput.style.display = 'none';
        document.body.appendChild(this.nameInput);
        
        // Create Set Name button
        this.nameButton = document.createElement('button');
        this.nameButton.textContent = 'Set Name';
        this.nameButton.className = 'login-button';
        this.nameButton.style.position = 'absolute';
        this.nameButton.style.fontFamily = 'Arial';
        this.nameButton.style.fontSize = '20px';
        this.nameButton.style.padding = '10px 20px';
        this.nameButton.style.borderRadius = '4px';
        this.nameButton.style.backgroundColor = '#4CAF50';
        this.nameButton.style.color = 'white';
        this.nameButton.style.border = 'none';
        this.nameButton.style.cursor = 'pointer';
        this.nameButton.style.display = 'none';
        document.body.appendChild(this.nameButton);
        
        // Create Spawn button
        this.spawnButton = document.createElement('button');
        this.spawnButton.textContent = 'Enter Game';
        this.spawnButton.className = 'login-button';
        this.spawnButton.style.position = 'absolute';
        this.spawnButton.style.fontFamily = 'Arial';
        this.spawnButton.style.fontSize = '20px';
        this.spawnButton.style.padding = '10px 20px';
        this.spawnButton.style.borderRadius = '4px';
        this.spawnButton.style.backgroundColor = '#2196F3';
        this.spawnButton.style.color = 'white';
        this.spawnButton.style.border = 'none';
        this.spawnButton.style.cursor = 'pointer';
        this.spawnButton.style.display = 'none';
        document.body.appendChild(this.spawnButton);
        
        // Create Respawn button
        this.respawnButton = document.createElement('button');
        this.respawnButton.textContent = 'Respawn';
        this.respawnButton.className = 'login-button';
        this.respawnButton.style.position = 'absolute';
        this.respawnButton.style.fontFamily = 'Arial';
        this.respawnButton.style.fontSize = '20px';
        this.respawnButton.style.padding = '10px 20px';
        this.respawnButton.style.borderRadius = '4px';
        this.respawnButton.style.backgroundColor = '#FF5722';
        this.respawnButton.style.color = 'white';
        this.respawnButton.style.border = 'none';
        this.respawnButton.style.cursor = 'pointer';
        this.respawnButton.style.display = 'none';
        document.body.appendChild(this.respawnButton);
        
        // Create class selection container
        this.classButtonsContainer = document.createElement('div');
        this.classButtonsContainer.id = 'class-buttons-container';
        this.classButtonsContainer.style.position = 'absolute';
        this.classButtonsContainer.style.display = 'none';
        this.classButtonsContainer.style.flexDirection = 'column';
        this.classButtonsContainer.style.alignItems = 'center';
        this.classButtonsContainer.style.gap = '15px';
        document.body.appendChild(this.classButtonsContainer);
        
        // Create class buttons
        this.createClassButtons();
        
        // Add event listeners
        this.nameButton.addEventListener('click', () => this.setPlayerName());
        this.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.setPlayerName();
            }
        });
        
        // Position elements initially
        this.positionHTMLElements();
    }
    
    private createClassButtons() {
        const createClassButton = (name: string, className: string, iconName: string) => {
            const button = document.createElement('button');
            button.className = 'class-button';
            button.style.display = 'flex';
            button.style.alignItems = 'center';
            button.style.padding = '10px 15px';
            button.style.margin = '5px';
            button.style.backgroundColor = '#333';
            button.style.color = 'white';
            button.style.border = '2px solid #666';
            button.style.borderRadius = '5px';
            button.style.cursor = 'pointer';
            button.style.width = '250px';
            button.style.justifyContent = 'space-between';
            
            // Create inner container for icon and text
            const innerContainer = document.createElement('div');
            innerContainer.style.display = 'flex';
            innerContainer.style.alignItems = 'center';
            innerContainer.style.gap = '10px';
            
            // Try to add an icon if it exists
            const icon = document.createElement('img');
            icon.src = `assets/${iconName}`;
            icon.style.width = '40px';
            icon.style.height = '40px';
            icon.style.marginRight = '10px';
            icon.onerror = () => {
                icon.style.display = 'none';
            };
            innerContainer.appendChild(icon);
            
            // Add class name text
            const text = document.createElement('span');
            text.textContent = name;
            text.style.fontFamily = 'Arial';
            text.style.fontSize = '20px';
            innerContainer.appendChild(text);
            
            button.appendChild(innerContainer);
            
            // Add a selection indicator
            const selectionIndicator = document.createElement('div');
            selectionIndicator.className = 'selection-indicator';
            selectionIndicator.style.width = '20px';
            selectionIndicator.style.height = '20px';
            selectionIndicator.style.borderRadius = '50%';
            selectionIndicator.style.backgroundColor = 'transparent';
            selectionIndicator.style.border = '2px solid #fff';
            button.appendChild(selectionIndicator);
            
            button.addEventListener('click', () => {
                // Reset all other buttons
                document.querySelectorAll('.class-button').forEach(btn => {
                    (btn as HTMLElement).style.backgroundColor = '#333';
                    (btn as HTMLElement).style.border = '2px solid #666';
                    (btn.querySelector('.selection-indicator') as HTMLElement).style.backgroundColor = 'transparent';
                });
                
                // Highlight this button
                button.style.backgroundColor = '#4c1d95';
                button.style.border = '2px solid #8b5cf6';
                (button.querySelector('.selection-indicator') as HTMLElement).style.backgroundColor = '#10b981';
                
                // Set selected class using proper type assertions
                switch (className) {
                    case 'Fighter':
                        this.selectedClass = { tag: "Fighter" } as PlayerClass.Fighter;
                        break;
                    case 'Rogue':
                        this.selectedClass = { tag: "Rogue" } as PlayerClass.Rogue;
                        break;
                    case 'Mage':
                        this.selectedClass = { tag: "Mage" } as PlayerClass.Mage;
                        break;
                    case 'Paladin':
                        this.selectedClass = { tag: "Paladin" } as PlayerClass.Paladin;
                        break;
                }
                
                if (this.selectedClass) {
                    console.log(`Selected class: ${this.selectedClass.tag}`);
                    
                    // Enable confirm button
                    this.confirmClassButton.disabled = false;
                }
            });
            
            return button;
        };
        
        // Create class buttons
        this.fighterButton = createClassButton('Fighter', 'Fighter', 'fighter_icon.png');
        this.rogueButton = createClassButton('Rogue', 'Rogue', 'rogue_icon.png');
        this.mageButton = createClassButton('Mage', 'Mage', 'mage_icon.png');
        this.paladinButton = createClassButton('Paladin', 'Paladin', 'paladin_icon.png');
        
        // Create class description element
        const classDescription = document.createElement('div');
        classDescription.id = 'class-description';
        classDescription.style.marginTop = '20px';
        classDescription.style.marginBottom = '20px';
        classDescription.style.padding = '15px';
        classDescription.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        classDescription.style.borderRadius = '5px';
        classDescription.style.color = 'white';
        classDescription.style.fontFamily = 'Arial';
        classDescription.style.fontSize = '16px';
        classDescription.style.maxWidth = '400px';
        classDescription.style.textAlign = 'center';
        classDescription.textContent = 'Select a class to begin your adventure. Each class has unique strengths.';
        
        // Create confirm button
        this.confirmClassButton = document.createElement('button');
        this.confirmClassButton.textContent = 'Confirm Selection';
        this.confirmClassButton.style.marginTop = '20px';
        this.confirmClassButton.style.padding = '12px 25px';
        this.confirmClassButton.style.fontFamily = 'Arial';
        this.confirmClassButton.style.fontSize = '18px';
        this.confirmClassButton.style.backgroundColor = '#4CAF50';
        this.confirmClassButton.style.color = 'white';
        this.confirmClassButton.style.border = 'none';
        this.confirmClassButton.style.borderRadius = '4px';
        this.confirmClassButton.style.cursor = 'pointer';
        this.confirmClassButton.disabled = true;
        this.confirmClassButton.addEventListener('click', () => this.confirmClassSelection());
        
        // Add buttons to container
        this.classButtonsContainer.appendChild(this.fighterButton);
        this.classButtonsContainer.appendChild(this.rogueButton);
        this.classButtonsContainer.appendChild(this.mageButton);
        this.classButtonsContainer.appendChild(this.paladinButton);
        this.classButtonsContainer.appendChild(classDescription);
        this.classButtonsContainer.appendChild(this.confirmClassButton);
    }
    
    private positionHTMLElements() {
        const { width, height } = this.scale;
        
        // Position the name input
        this.nameInput.style.left = `${width/2 - 150}px`;
        this.nameInput.style.top = `${height/2 - 50}px`;
        
        // Position the name button
        this.nameButton.style.left = `${width/2 - 75}px`;
        this.nameButton.style.top = `${height/2 + 20}px`;
        
        // Position the spawn button
        this.spawnButton.style.left = `${width/2 - 75}px`;
        this.spawnButton.style.top = `${height/2 + 20}px`;
        
        // Position the respawn button
        this.respawnButton.style.left = `${width/2 - 75}px`;
        this.respawnButton.style.top = `${height/2 + 80}px`;
        
        // Position the class buttons container
        this.classButtonsContainer.style.left = `${width/2 - 125}px`;
        this.classButtonsContainer.style.top = `${height/2 - 150}px`;
    }
    
    private handleResize() {
        this.positionHTMLElements();
    }
    
    private registerEventHandlers() {
        // Handle connection events
        this.spacetimeDBClient.onConnect = () => {
            console.log("Connected to SpacetimeDB");
            this.isConnected = true;
            this.updateLoginState();
        };
        
        this.spacetimeDBClient.onDisconnect = () => {
            console.log("Disconnected from SpacetimeDB");
            this.isConnected = false;
            this.statusText.setText('Disconnected. Please refresh the page.');
            this.hideAllInputs();
        };
        
        // Handle subscription
        this.spacetimeDBClient.onSubscriptionApplied = () => {
            console.log("Subscription applied");
            if (this.isConnected) {
                this.checkPlayerState();
            }
        };
        
        // Register table listeners for account and player updates
        if (this.spacetimeDBClient.sdkConnection?.db) {
            // Account table listeners
            this.spacetimeDBClient.sdkConnection.db.account.onInsert((_ctx, account) => {
                if (this.isMyAccount(account)) {
                    console.log("My account inserted", account);
                    this.hasAccount = true;
                    this.hasName = !!account.name && account.name.trim().length > 0;
                    this.updateLoginState();
                }
            });
            
            this.spacetimeDBClient.sdkConnection.db.account.onUpdate((_ctx, _oldAccount, newAccount) => {
                if (this.isMyAccount(newAccount)) {
                    console.log("My account updated", newAccount);
                    this.hasName = !!newAccount.name && newAccount.name.trim().length > 0;
                    this.updateLoginState();
                }
            });
            
            // Player table listeners
            this.spacetimeDBClient.sdkConnection.db.player.onInsert((_ctx, player) => {
                this.checkIfMyPlayer(player);
            });
            
            this.spacetimeDBClient.sdkConnection.db.player.onUpdate((_ctx, _oldPlayer, newPlayer) => {
                this.checkIfMyPlayer(newPlayer);
            });
            
            this.spacetimeDBClient.sdkConnection.db.player.onDelete((_ctx, player) => {
                const myAccount = this.getMyAccount();
                if (myAccount && myAccount.currentPlayerId === player.playerId) {
                    this.hasLivingPlayer = false;
                    this.updateLoginState();
                }
            });
            
            // Dead players table listener
            this.spacetimeDBClient.sdkConnection.db.deadPlayers.onInsert((_ctx, deadPlayer) => {
                const myAccount = this.getMyAccount();
                if (myAccount && myAccount.currentPlayerId === deadPlayer.playerId) {
                    this.hasDeadPlayer = true;
                    this.updateLoginState();
                }
            });
        }
    }
    
    private checkIfMyPlayer(player: Player) {
        const myAccount = this.getMyAccount();
        if (myAccount && myAccount.currentPlayerId === player.playerId) {
            console.log("My player found or updated", player);
            this.hasLivingPlayer = true;
            this.updateLoginState();
        }
    }
    
    private isMyAccount(account: Account): boolean {
        return this.spacetimeDBClient.identity !== null && 
               account.identity.isEqual(this.spacetimeDBClient.identity);
    }
    
    private getMyAccount(): Account | null {
        if (!this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            return null;
        }
        
        const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
        return account || null;
    }
    
    private checkConnectionState() {
        this.isConnected = this.spacetimeDBClient.isConnected;
        
        if (this.isConnected) {
            this.checkPlayerState();
        } else {
            this.statusText.setText('Connecting to server...');
        }
    }
    
    private checkPlayerState() {
        if (!this.spacetimeDBClient.sdkConnection?.db || !this.spacetimeDBClient.identity) {
            return;
        }
        
        const account = this.getMyAccount();
        this.hasAccount = !!account;
        
        if (account) {
            this.hasName = !!account.name && account.name.trim().length > 0;
            
            // Check for living player
            if (account.currentPlayerId > 0) {
                const player = this.spacetimeDBClient.sdkConnection.db.player.player_id.find(account.currentPlayerId);
                this.hasLivingPlayer = !!player;
                
                // Check for dead player if no living player
                if (!this.hasLivingPlayer) {
                    const deadPlayer = this.spacetimeDBClient.sdkConnection.db.deadPlayers.player_id.find(account.currentPlayerId);
                    this.hasDeadPlayer = !!deadPlayer;
                }
            }
        }
        
        this.updateLoginState();
    }
    
    private updateLoginState() {
        if (!this.isConnected) {
            this.statusText.setText('Connecting to server...');
            this.hideAllInputs();
            return;
        }
        
        if (this.isLoading) {
            return; // Skip updates while loading
        }
        
        // Clear any previous error
        this.errorText.setVisible(false);
        
        // Handle different states
        if (this.hasLivingPlayer) {
            // Has a living player - move to game scene
            this.statusText.setText('Player ready! Entering game...');
            this.hideAllInputs();
            this.startGameScene();
            return;
        }
        
        if (!this.hasAccount) {
            // Waiting for account creation
            this.statusText.setText('Creating account...');
            this.hideAllInputs();
            return;
        }
        
        if (!this.hasName) {
            // Need to set name
            this.statusText.setText('Please enter your name:');
            this.showNameInput();
            return;
        }
        
        // If we have a name but no player, move to ClassSelectScene
        this.statusText.setText('Name set! Moving to character selection...');
        this.hideAllInputs();
        this.startClassSelectScene();
    }
    
    private hideAllInputs() {
        this.nameInput.style.display = 'none';
        this.nameButton.style.display = 'none';
        this.spawnButton.style.display = 'none';
        this.respawnButton.style.display = 'none';
        this.classButtonsContainer.style.display = 'none';
    }
    
    private showNameInput() {
        this.nameInput.style.display = 'block';
        this.nameButton.style.display = 'block';
        this.spawnButton.style.display = 'none';
        this.respawnButton.style.display = 'none';
        this.classButtonsContainer.style.display = 'none';
    }
    
    private showClassSelection() {
        this.nameInput.style.display = 'none';
        this.nameButton.style.display = 'none';
        this.spawnButton.style.display = 'none';
        this.respawnButton.style.display = 'none';
        this.classButtonsContainer.style.display = 'flex';
    }
    
    private showSpawnButton() {
        this.nameInput.style.display = 'none';
        this.nameButton.style.display = 'none';
        this.spawnButton.style.display = 'block';
        this.respawnButton.style.display = 'none';
        this.classButtonsContainer.style.display = 'none';
    }
    
    private showRespawnButton() {
        this.nameInput.style.display = 'none';
        this.nameButton.style.display = 'none';
        this.spawnButton.style.display = 'none';
        this.respawnButton.style.display = 'block';
        this.classButtonsContainer.style.display = 'none';
        // Reset selected class when showing respawn button
        this.selectedClass = null;
    }
    
    private setPlayerName() {
        const name = this.nameInput.value.trim();
        
        if (!name || name.length < 1 || name.length > 16) {
            this.showError('Please enter a valid name (1-16 characters)');
            return;
        }
        
        this.setLoading(true);
        this.statusText.setText('Setting name...');
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log(`Setting name to: ${name}`);
                this.spacetimeDBClient.sdkConnection.reducers.setName(name);
                
                // Set a timeout to check if the name was set
                setTimeout(() => {
                    if (!this.hasName) {
                        this.setLoading(false);
                        this.showError('Failed to set name. Please try again.');
                    }
                }, 5000);
            } else {
                this.setLoading(false);
                this.showError('Cannot set name: SpacetimeDB reducers not available');
            }
        } catch (error) {
            console.error('Error setting name:', error);
            this.setLoading(false);
            this.showError('An error occurred while setting your name');
        }
    }
    
    private confirmClassSelection() {
        if (!this.selectedClass) {
            this.showError('Please select a class before continuing');
            return;
        }
        
        console.log(`Confirmed class selection: ${this.selectedClass.tag}`);
        this.updateLoginState();
    }
    
    private setLoading(isLoading: boolean) {
        this.isLoading = isLoading;
        
        if (isLoading) {
            this.hideAllInputs();
        } else {
            this.updateLoginState();
        }
    }
    
    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    private startGameScene() {
        // Clean up HTML elements
        this.hideAllInputs();
        
        // Start the game scene
        this.scene.start('GameScene');
    }
    
    private startClassSelectScene() {
        console.log("Starting ClassSelectScene");
        
        // Clean up HTML elements when transitioning scenes
        this.hideAllInputs();
        
        // Start the class select scene
        this.scene.start('ClassSelectScene');
    }
    
    shutdown() {
        // Clean up HTML elements when the scene is shut down
        this.nameInput.remove();
        this.nameButton.remove();
        this.spawnButton.remove();
        this.respawnButton.remove();
        this.classButtonsContainer.remove();
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
} 