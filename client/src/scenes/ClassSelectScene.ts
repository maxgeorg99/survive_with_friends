import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Account } from '../autobindings';
import PlayerClass from '../autobindings/player_class_type';

// Map player class to numeric class ID
const CLASS_ID_MAP = {
    "Fighter": 0,
    "Rogue": 1,
    "Mage": 2,
    "Paladin": 3
};

export default class ClassSelectScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    
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
        console.log("ClassSelectScene constructor called");
    }

    preload() {
        // Load character class icons
        this.load.image('fighter_icon', '/assets/fighter_icon.png');
        this.load.image('rogue_icon', '/assets/rogue_icon.png');
        this.load.image('mage_icon', '/assets/mage_icon.png');
        this.load.image('paladin_icon', '/assets/paladin_icon.png');
        this.load.image('select_background', '/assets/select_background.png');
    }

    create() {
        // Set up background
        const { width, height } = this.scale;
        
        // Use a dark blue color if no background image
        this.cameras.main.setBackgroundColor('#042E64');
        
        try {
            if (this.textures.exists('select_background')) {
                this.add.image(width/2, height/2, 'select_background')
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
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Position HTML elements
        this.positionHTMLElements();
        
        // Register event handlers
        this.registerEventHandlers();
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
    
    private registerEventHandlers() {
        // Listen for player inserts
        if (this.spacetimeDBClient.sdkConnection?.db) {
            this.spacetimeDBClient.sdkConnection.db.player.onInsert((_ctx, player) => {
                console.log("Player inserted event received in ClassSelectScene");
                console.log("- Player data:", JSON.stringify(player));
                
                // Check if this is our player
                const localIdentity = this.spacetimeDBClient.identity;
                if (!localIdentity) return;
                
                const myAccount = this.spacetimeDBClient.sdkConnection?.db.account.identity.find(localIdentity);
                if (myAccount && myAccount.currentPlayerId === player.playerId) {
                    console.log("Our player was created. Starting game scene.");
                    this.startGameScene();
                }
            });
        }
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
        
        this.setLoading(true);
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                // Get class ID from the PlayerClass tag
                const classId = CLASS_ID_MAP[this.selectedClass.tag];
                console.log(`Spawning player with class: ${this.selectedClass.tag} (ID: ${classId})`);
                
                // Call the spawnPlayer reducer with the numeric class ID
                this.spacetimeDBClient.sdkConnection.reducers.spawnPlayer(classId);
                
                // Set a timeout to check if the player was spawned
                setTimeout(() => {
                    if (this.scene.key === 'ClassSelectScene') { // We're still in this scene
                        this.setLoading(false);
                        this.showError('Failed to spawn player. Please try again.');
                    }
                }, 5000);
            } else {
                this.setLoading(false);
                this.showError('Cannot spawn player: SpacetimeDB reducers not available');
            }
        } catch (error) {
            console.error('Error spawning player:', error);
            this.setLoading(false);
            this.showError('An error occurred while spawning your player');
        }
    }
    
    private setLoading(isLoading: boolean) {
        this.isLoading = isLoading;
        
        if (isLoading) {
            this.classButtonsContainer.style.display = 'none';
            this.titleText.setText('SPAWNING PLAYER...');
            this.subtitleText.setText('Please wait while your character enters the world...');
        } else {
            this.classButtonsContainer.style.display = 'flex';
            this.titleText.setText('SELECT YOUR CLASS');
            this.subtitleText.setText('Choose wisely, brave survivor...');
        }
    }
    
    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    private startGameScene() {
        console.log("Starting GameScene from ClassSelectScene");
        
        // Clean up HTML elements
        this.classButtonsContainer.remove();
        
        // Start the game scene
        this.scene.start('GameScene');
    }
    
    shutdown() {
        // Clean up HTML elements when the scene is shut down
        if (this.classButtonsContainer) {
            this.classButtonsContainer.remove();
        }
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
} 