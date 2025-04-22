import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';

export default class LoginScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    
    // UI Elements
    private statusText!: Phaser.GameObjects.Text;
    private nameInput!: HTMLInputElement;
    private nameButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private loginContainer!: Phaser.GameObjects.Container;

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
    
    private checkConnectionState() {
        
        if (this.spacetimeDBClient.isConnected) 
        {
            console.log("Connected to server");
        } 
        else 
        {
            this.statusText.setText('Connecting to server...');
        }
    }
    
    private setPlayerName() {
        const name = this.nameInput.value.trim();
        
        if (!name || name.length < 1 || name.length > 16) {
            this.showError('Please enter a valid name (1-16 characters)');
            return;
        }
        
        // Show loading scene while setting name
        this.scene.start('LoadingScene', { 
            message: 'Setting your name...', 
            nextScene: 'ClassSelectScene',
            timeoutDuration: 10000 // 10 seconds timeout
        });
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log(`Setting name to: ${name}`);
                this.spacetimeDBClient.sdkConnection.reducers.setName(name);
                
                // No need for timeout logic here as that's handled by LoadingScene
            } else {
                // If reducers aren't available, go back to LoginScene with error
                this.scene.start('LoginScene');
                setTimeout(() => {
                    this.showError('Cannot set name: SpacetimeDB reducers not available');
                }, 100);
            }
        } catch (error) {
            console.error('Error setting name:', error);
            // If there's an error, go back to LoginScene with error
            this.scene.start('LoginScene');
            setTimeout(() => {
                this.showError('An error occurred while setting your name');
            }, 100);
        }
    }
    
    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    shutdown() {
        // Clean up HTML elements when the scene is shut down
        this.nameInput.remove();
        this.nameButton.remove();
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
} 