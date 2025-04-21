import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Account } from '../autobindings';
import { Identity } from '@clockworklabs/spacetimedb-sdk';

export default class LoginScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    
    // UI Elements
    private statusText!: Phaser.GameObjects.Text;
    private nameInput!: HTMLInputElement;
    private nameButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private loginContainer!: Phaser.GameObjects.Container;
    
    // State tracking
    private hasAccount: boolean = false;
    private hasName: boolean = false;
    private hasLivingPlayer: boolean = false;
    private isConnected: boolean = false;
    private isLoading: boolean = false;

    constructor() {
        super('LoginScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        console.log("LoginScene constructor called");
    }

    preload() {
        // Load assets needed for the login screen
        this.load.image('login_background', '/assets/login_background.png');
        this.load.image('button', '/assets/button.png');
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
    
    private positionHTMLElements() {
        const { width, height } = this.scale;
        
        // Position the name input
        this.nameInput.style.left = `${width/2 - 150}px`;
        this.nameInput.style.top = `${height/2 - 50}px`;
        
        // Position the name button
        this.nameButton.style.left = `${width/2 - 75}px`;
        this.nameButton.style.top = `${height/2 + 20}px`;
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
    }
    
    private showNameInput() {
        this.nameInput.style.display = 'block';
        this.nameButton.style.display = 'block';
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
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
} 