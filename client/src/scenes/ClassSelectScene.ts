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


const CLASS_INFO = {
    "Til": {
        description: "A melee specialist with high base damage.",
        weapon: "Sword Slash - A close-range piercing attack with high damage",
        strengths: "High base damage, Can hit multiple enemies",
        weaknesses: "Limited range"
    },
    "Marc": {
        description: "A swift assassin that excels at burst damage.",
        weapon: "Throwing Knives - Multiple fast projectiles in a spread pattern",
        strengths: "High attack speed, Multi-directional attacks",
        weaknesses: "Low individual projectile damage"
    },
    "Max": {
        description: "A ranged specialist with seeking projectiles.",
        weapon: "Magic Bolt - Homes in on the nearest enemy",
        strengths: "Auto-targeting attacks, Good single target damage",
        weaknesses: "Low armor piercing"
    },
    "Chris": {
        description: "A holy warrior protected by orbiting shields.",
        weapon: "Shield Bash - Rotating shield that damages nearby enemies",
        strengths: "Good defensive capabilities, Constant AoE damage",
        weaknesses: "Slower attack speed"
    }
} as const;

type ClassNames = keyof typeof CLASS_INFO;

export default class ClassSelectScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    
    // UI Elements
    private titleText!: Phaser.GameObjects.Text;
    private subtitleText!: Phaser.GameObjects.Text;
    private classButtonsContainer!: HTMLDivElement;
    private classInfoPanel!: HTMLDivElement;
    private fighterButton!: HTMLButtonElement;
    private rogueButton!: HTMLButtonElement;
    private mageButton!: HTMLButtonElement;
    private paladinButton!: HTMLButtonElement;
    private confirmButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private questButton!: HTMLButtonElement;
    
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
        // Load character class icons using the correct filenames
        this.load.image('fighter_icon', '/assets/class_fighter_1.png');
        this.load.image('rogue_icon', '/assets/class_rogue_1.png');
        this.load.image('mage_icon', '/assets/class_mage_1.png');
        this.load.image('paladin_icon', '/assets/class_paladin_1.png');
        this.load.image('attack_sword', '/assets/attack_sword.png');
        this.load.image('attack_knife', '/assets/attack_knife.png');
        this.load.image('attack_wand', '/assets/attack_wand.png');
        this.load.image('attack_shield', '/assets/attack_shield.png');
        
        // Add quest button image if you have one
        this.load.image('quest_icon', '/assets/white_pixel.png');
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
              
        // Add title - centered on screen
        this.titleText = this.add.text(width/2, height/4, 'SELECT YOUR CLASS', {
            fontFamily: 'Arial Black',
            fontSize: '48px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        
        // Add subtitle - centered on screen below title
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
        this.createConfirmButton();
        this.createClassInfoPanel();
        
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
        
        // Add quest button in top right corner
        const questButton = document.createElement('button');
        questButton.style.position = 'absolute';
        questButton.style.top = '50px';
        questButton.style.right = '50px';
        questButton.style.width = '180px';
        questButton.style.height = '50px';
        questButton.style.padding = '10px';
        questButton.style.backgroundColor = '#2c3e50';
        questButton.style.color = 'white';
        questButton.style.border = '2px solid #34495e';
        questButton.style.borderRadius = '5px';
        questButton.style.cursor = 'pointer';
        questButton.style.fontFamily = 'Arial';
        questButton.style.fontSize = '18px';
        questButton.style.transition = 'background-color 0.2s, border-color 0.2s';
        questButton.style.display = 'flex';
        questButton.style.alignItems = 'center';
        questButton.style.justifyContent = 'center';
        questButton.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        questButton.textContent = '📜 Quests';
        
        questButton.addEventListener('mouseover', () => {
            questButton.style.backgroundColor = '#3498db';
            questButton.style.borderColor = '#2980b9';
        });
        
        questButton.addEventListener('mouseout', () => {
            questButton.style.backgroundColor = '#2c3e50';
            questButton.style.borderColor = '#34495e';
        });
        
        questButton.addEventListener('click', () => {
            this.scene.start('QuestScene');
        });
        
        document.body.appendChild(questButton);
        
        // Store reference for cleanup
        this.questButton = questButton;
    }
    
    private createConfirmButton() {
        this.confirmButton = document.createElement('button');
        this.confirmButton.textContent = 'Confirm Selection';
        this.confirmButton.style.position = 'absolute';
        this.confirmButton.style.bottom = '0';
        this.confirmButton.style.left = '0';
        this.confirmButton.style.padding = '12px 24px';
        this.confirmButton.style.backgroundColor = '#27ae60';
        this.confirmButton.style.color = 'white';
        this.confirmButton.style.border = 'none';
        this.confirmButton.style.borderRadius = '5px';
        this.confirmButton.style.fontSize = '18px';
        this.confirmButton.style.cursor = 'pointer';
        this.confirmButton.style.transition = 'background-color 0.2s';
        this.confirmButton.style.display = 'none';
        this.confirmButton.style.width = '250px';  // Match the width of class buttons
        
        this.confirmButton.addEventListener('mouseover', () => {
            this.confirmButton.style.backgroundColor = '#219a52';  // Darker shade for hover
        });
        
        this.confirmButton.addEventListener('mouseout', () => {
            this.confirmButton.style.backgroundColor = '#27ae60';  // Return to original color
        });
        
        this.confirmButton.addEventListener('click', () => {
            this.spawnPlayer();
        });

        // Append to the class buttons container
        this.classButtonsContainer.appendChild(this.confirmButton);
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
        this.classButtonsContainer.style.width = '250px';
        this.classButtonsContainer.style.transform = 'translate(-50%, -50%)';
        // Set a fixed height that accounts for all buttons + confirm button
        this.classButtonsContainer.style.height = '400px'; // Adjust this value as needed
        document.body.appendChild(this.classButtonsContainer);
        
        const createClassButton = (name: string, classType: PlayerClass, iconName: string, imageFile: string) => {
            const button = document.createElement('button');
            button.className = 'class-select-button';
            button.style.position = 'relative';
            button.style.width = '250px';
            button.style.height = '70px';
            button.style.padding = '10px';
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
                    icon.src = '/assets/' + imageFile;
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
        this.fighterButton = createClassButton('Til', PlayerClass.Fighter as PlayerClass, 'fighter_icon', 'class_fighter_1.png');
        this.rogueButton = createClassButton('Marc', PlayerClass.Rogue as PlayerClass, 'rogue_icon', 'class_rogue_1.png');
        this.mageButton = createClassButton('Max', PlayerClass.Mage as PlayerClass, 'mage_icon', 'class_mage_1.png');
        this.paladinButton = createClassButton('Chris', PlayerClass.Paladin as PlayerClass, 'paladin_icon', 'class_paladin_1.png');
        
        // Add all buttons to container
        this.classButtonsContainer.appendChild(this.fighterButton);
        this.classButtonsContainer.appendChild(this.rogueButton);
        this.classButtonsContainer.appendChild(this.mageButton);
        this.classButtonsContainer.appendChild(this.paladinButton);
    }
    
    private createClassInfoPanel() {
        // Remove any existing panel
        const existingPanel = document.getElementById('class-info-panel');
        if (existingPanel) existingPanel.remove();

        // Create info panel container
        this.classInfoPanel = document.createElement('div');
        this.classInfoPanel.id = 'class-info-panel';
        this.classInfoPanel.style.position = 'absolute';
        this.classInfoPanel.style.width = '300px';
        this.classInfoPanel.style.padding = '20px';
        this.classInfoPanel.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.classInfoPanel.style.color = 'white';
        this.classInfoPanel.style.borderRadius = '8px';
        this.classInfoPanel.style.border = '2px solid #34495e';
        this.classInfoPanel.style.fontFamily = 'Arial';
        this.classInfoPanel.style.fontSize = '16px';
        this.classInfoPanel.style.display = 'none';
        this.classInfoPanel.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';

        document.body.appendChild(this.classInfoPanel);
    }
    
    private positionHTMLElements() {
        // Position class select container in the exact center
        this.classButtonsContainer.style.left = '50%';
        this.classButtonsContainer.style.top = '60%';
        
        // Position info panel to the right of the centered container
        if (this.classInfoPanel) {
            const containerWidth = 250;
            const spacing = 30;
            this.classInfoPanel.style.left = '50%';
            this.classInfoPanel.style.top = '60%';
            this.classInfoPanel.style.transform = `translate(calc(${(containerWidth/2 + spacing)}px), -55%)`;
            this.classInfoPanel.style.right = 'auto';
        }
    }
    
    private handleResize() {
        this.positionHTMLElements();
    }
    
    private registerEventListeners() {
        // Listen for player related events
        this.gameEvents.on(GameEvents.PLAYER_CREATED, this.handlePlayerCreated, this);
        this.gameEvents.on(GameEvents.PLAYER_DIED, this.handlePlayerDied, this);
        this.gameEvents.on(GameEvents.NAME_SET, this.handleNameSet, this);
        
        // Listen for connection events
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Listen for loading events
        this.gameEvents.on(GameEvents.LOADING_ERROR, this.handleLoadingError, this);
    }
    
    private handlePlayerCreated(player: any, isLocalPlayer = true) {
        console.log("Player created event received in ClassSelectScene");
        if (isLocalPlayer) {
            // This will be handled by the LoadingScene transition
            console.log("Our player was created. Will transition to GameScene.");
        }
    }
    
    private handlePlayerDied(player: any) {
        console.log("Player died event received in ClassSelectScene");
        // The player might have died while we were in GameScene and then transitioned here
        // So we should show a message that they died
        this.subtitleText.setText('Your previous character died. Choose a new class...');
    }
    
    private handleNameSet(account: any) {
        console.log("Name set event received in ClassSelectScene", account.name);
        // We might receive this if the name was just set and we were auto-transitioned here
    }
    
    private handleConnectionLost() {
        console.log("Connection lost event received in ClassSelectScene");
        this.showError('Connection to server lost. Please refresh the page.');
    }
    
    private handleLoadingError(message: string) {
        console.log("Loading error event received in ClassSelectScene", message);
        this.showError(message);
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

        // Update class info panel content
        const classNameMap: Record<string, string> = {
            'Fighter': "Til",
            'Rogue': "Marc",
            'Mage': "Max",
            'Paladin': "Chris"
        };
        const characterName = classNameMap[classType.tag];
        const info = CLASS_INFO[characterName as ClassNames];

        const weaponImageFile = classType.tag === 'Fighter' ? 'attack_sword.png' : 
                          classType.tag === 'Rogue' ? 'attack_knife.png' : 
                          classType.tag === 'Mage' ? 'attack_wand.png' : 
                          classType.tag === 'Paladin' ? 'attack_shield.png' : '';

        // Show and position the panel
        this.classInfoPanel.style.display = 'block';
        
        // Update panel content
        this.classInfoPanel.innerHTML = `
            <h2 style="margin: 0 0 15px 0; font-size: 24px; color: #3498db;">${characterName}</h2>
            <p style="margin: 0 0 15px 0;">${info.description}</p>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color:rgb(183, 204, 46);">Weapon</h3>
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <img src="/assets/${weaponImageFile}" style="height: 45px; width: 45px; margin-right: 10px;" alt="${info.weapon} icon" />
                <p style="margin: 0 0 0 10px;">${info.weapon}</p>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #2ecc71;">Strengths 💪</h3>
            <p style="margin: 0 0 15px 0;">${info.strengths}</p>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #e74c3c;">Weaknesses 👎</h3>
            <p style="margin: 0;">${info.weaknesses}</p>
        `;
        
        // Update positions to maintain alignment
        this.positionHTMLElements();
    }
    
    private spawnPlayer() 
    {
        if (!this.selectedClass) 
        {
            this.showError('Please select a class first');
            return;
        }
        
        try 
        {
            if (this.spacetimeDBClient.sdkConnection?.reducers) 
            {
                // Get class ID from the PlayerClass tag
                const classId = CLASS_ID_MAP[this.selectedClass.tag];
                console.log(`Spawning player with class: ${this.selectedClass.tag} (ID: ${classId})`);
                
                // Try to clean up HTML elements immediately before transition
                this.cleanupHTMLElements();

                console.log("Spawning player with class: " + this.selectedClass.tag + " (ID: " + classId + ")");
                
                // Show loading scene while player is being spawned
                this.scene.start('LoadingScene', { 
                    message: 'Creating your character...', 
                    nextScene: 'GameScene',
                    timeoutDuration: 10000 // 10 seconds timeout
                });
                
                // Call the spawnPlayer reducer with the numeric class ID
                this.spacetimeDBClient.sdkConnection.reducers.spawnPlayer(classId);
                
                // No need for timeout logic here as that's handled by LoadingScene
            } 
            else 
            {
                this.showError('Cannot spawn player: SpacetimeDB reducers not available');
            }
        } 
        catch (error) 
        {
            console.error('Error spawning player:', error);
            this.showError('An error occurred while spawning your player');
        }
    }
    
    // Add a dedicated cleanup method for HTML elements
    private cleanupHTMLElements() {
        console.log("Cleaning up ClassSelectScene HTML elements");
        try {
            // Method 1: Our class reference
            if (this.classButtonsContainer && this.classButtonsContainer.parentNode) {
                this.classButtonsContainer.remove();
            }
            
            if (this.classInfoPanel && this.classInfoPanel.parentNode) {
                this.classInfoPanel.remove();
            }

            if (this.questButton && this.questButton.parentNode) {
                this.questButton.remove();
            }
            
            // Method 2: Query by ID and class
            const container = document.getElementById('class-select-container');
            if (container && container.parentNode) {
                container.remove();
            }
            
            const infoPanel = document.getElementById('class-info-panel');
            if (infoPanel && infoPanel.parentNode) {
                infoPanel.remove();
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
                    (el as HTMLElement).textContent?.includes('Confirm Selection') ||
                    (el as HTMLElement).textContent?.includes('Quests')) {
                    if (el && el.parentNode) {
                        console.log("Removing button:", (el as HTMLElement).textContent);
                        el.remove();
                    }
                }
            });
            
            // Look for the container div and info panel
            document.querySelectorAll('div').forEach(el => {
                if (el.id === 'class-select-container' || 
                    el.id === 'class-info-panel' ||
                    (el.children.length > 0 && Array.from(el.children).some(child => 
                        (child as HTMLElement).className === 'class-select-button'))) {
                    if (el && el.parentNode) {
                        console.log("Removing div:", el.id || "unnamed");
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
        this.gameEvents.off(GameEvents.PLAYER_CREATED, this.handlePlayerCreated, this);
        this.gameEvents.off(GameEvents.PLAYER_DIED, this.handlePlayerDied, this);
        this.gameEvents.off(GameEvents.NAME_SET, this.handleNameSet, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        this.gameEvents.off(GameEvents.LOADING_ERROR, this.handleLoadingError, this);
        
        // Use our dedicated cleanup method
        this.cleanupHTMLElements();
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
}