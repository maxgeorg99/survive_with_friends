import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Account } from '../autobindings';
import PlayerClass from '../autobindings/player_class_type';
import { GameEvents } from '../constants/GameEvents';
import { localization } from '../utils/localization';

// Map player class to numeric class ID
const CLASS_ID_MAP = {
    "Fighter": 0,
    "Rogue": 1,
    "Mage": 2,
    "Paladin": 3,
    "Football": 4,
    "Gambler": 5,
    "Athlete": 6,
    "Gourmand": 7
};

const CLASS_NAME_MAP = {
    'Fighter': "Til",
    'Rogue': "Marc",
    'Mage': "Max",
    'Paladin': "Chris",
    'Football': "Dominik",
    'Gambler': "Robin",
    'Athlete': "David",
    'Gourmand': "Benni"
} as const;

const CLASS_INFO = {
    "Til": {
        description: "class.til.description",
        weapon: "class.til.weapon",
        strengths: "class.til.strengths",
        weaknesses: "class.til.weaknesses",
        altName: "Football Til",
        altClass: "Football"
    },
    "Marc": {
        description: "class.marc.description",
        weapon: "class.marc.weapon",
        strengths: "class.marc.strengths",
        weaknesses: "class.marc.weaknesses",
        altName: "Yu-gi-oh Marc",
        altClass: "Gambler"
    },
    "Max": {
        description: "class.max.description",
        weapon: "class.max.weapon",
        strengths: "class.max.strengths",
        weaknesses: "class.max.weaknesses",
        altName: "Gym Addict Max",
        altClass: "Athlete"
    },
    "Chris": {
        description: "class.chris.description",
        weapon: "class.chris.weapon",
        strengths: "class.chris.strengths",
        weaknesses: "class.chris.weaknesses",
        altName: "Chef Chris",
        altClass: "Gourmand"
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
    private footballButton!: HTMLButtonElement;
    private gamblerButton!: HTMLButtonElement;
    private athleteButton!: HTMLButtonElement;
    private gourmandButton!: HTMLButtonElement;
    
    // State tracking
    private selectedClass: PlayerClass | null = null;
    private isLoading: boolean = false;
    private titleElement: HTMLDivElement | null = null;
    private subtitleElement: HTMLDivElement | null = null;
    private selectedAltVersion: boolean = false;
    private selectedAltVersions: Record<string, boolean> = {
        'Til': false,
        'Marc': false,
        'Max': false,
        'Chris': false
    };

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
        // Temporarily use fighter sprite as placeholder for new classes
        this.load.image('football_icon', '/assets/class_football_1.png');
        this.load.image('gambler_icon', '/assets/class_fighter_1.png');
        this.load.image('athlete_icon', '/assets/class_fighter_1.png');
        this.load.image('gourmand_icon', '/assets/class_chef_1.png');
        
        // Load weapon icons
        this.load.image('attack_sword', '/assets/attack_sword.png');
        this.load.image('attack_knife', '/assets/attack_knife.png');
        this.load.image('attack_wand', '/assets/attack_wand.png');
        this.load.image('attack_shield', '/assets/attack_shield.png');
        // Temporarily use sword sprite as placeholder for new weapons
        this.load.image('attack_football', '/assets/attack_football.png');
        this.load.image('attack_cards', '/assets/attack_cards.png');
        this.load.image('attack_dumbbell', '/assets/attack_dumbbell.png');
        this.load.image('attack_garlic', '/assets/attack_garlic.png');
        
        // Add quest button image if you have one
        this.load.image('quest_icon', '/assets/white_pixel.png');
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        
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
        this.titleText = this.add.text(width/2, height/4, localization.getText('ui.select_class.title'), {
            fontFamily: 'Arial Black',
            fontSize: '48px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        
        // Add subtitle - centered on screen below title
        this.subtitleText = this.add.text(width/2, height/4 + 60, localization.getText('ui.select_class.subtitle'), {
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
        this.createLanguageSelector();
        
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
        this.confirmButton.textContent = localization.getText('ui.confirm_selection');
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
        this.classButtonsContainer.style.height = '400px';
        document.body.appendChild(this.classButtonsContainer);
        
        const createClassButton = (name: string, classType: PlayerClass, iconName: string, imageFile: string) => {
            const button = document.createElement('button');
            button.className = 'class-select-button';
            button.setAttribute('data-class-type', classType.tag);
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
            
            // Add icon if available and give it an ID for later updates
            try {
                if (this.textures.exists(iconName)) {
                    const icon = document.createElement('img');
                    icon.id = `${name.toLowerCase()}-icon`;
                    icon.src = '/assets/' + imageFile;
                    icon.style.width = '50px';
                    icon.style.height = '50px';
                    icon.style.marginRight = '10px';
                    button.appendChild(icon);
                }
            } catch (error) {
                console.error(`Error adding icon for ${name}:`, error);
            }
            
            // Add text span with an ID
            const textSpan = document.createElement('span');
            textSpan.id = `${name.toLowerCase()}-text`;
            textSpan.textContent = name;
            button.appendChild(textSpan);
            
            button.addEventListener('click', () => {
                this.selectClass(classType, button);
            });
            
            return button;
        };
        
        // Create only the original 4 class buttons
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

    private getAltVersionKey(characterName: string): string {
        const keyMap: Record<string, string> = {
            'Til': 'football_til',
            'Marc': 'yugioh_marc',
            'Max': 'gym_max',
            'Chris': 'chef_chris'
        };
        return keyMap[characterName] || characterName.toLowerCase();
    }

    private getOriginalCharacterName(classType: PlayerClass | string): string {
        // If it's already a base character name, return it
        if (['Til', 'Marc', 'Max', 'Chris'].includes(classType as string)) {
            return classType as string;
        }

        // Map alt classes back to their original character
        const altToOriginal: Record<string, string> = {
            'Football': 'Til',
            'Gambler': 'Marc',
            'Athlete': 'Max',
            'Gourmand': 'Chris'
        };

        // If it's a PlayerClass, use its tag
        const classTag = typeof classType === 'string' ? classType : classType.tag;
        return altToOriginal[classTag] || classTag;
    }

    private updateClassInfoPanel(characterName: string, classType: PlayerClass, info: any) {
        if (!info) return;

        const originalCharName = this.getOriginalCharacterName(characterName);
        const isAltVersion = this.selectedAltVersions[originalCharName] || false;
        const currentName = isAltVersion ? info.altName : originalCharName;
        const currentClass = isAltVersion ? info.altClass : classType.tag;

        // Get localization keys
        const baseKey = `class.${originalCharName.toLowerCase()}`;
        const altKey = `class.${this.getAltVersionKey(originalCharName)}`;
        const currentKey = isAltVersion ? altKey : baseKey;

        // Update button content synchronously
        const iconElement = document.getElementById(`${originalCharName.toLowerCase()}-icon`) as HTMLImageElement;
        const textElement = document.getElementById(`${originalCharName.toLowerCase()}-text`);
        
        if (iconElement) {
            const iconFile = isAltVersion ? this.getAltClassIcon(info.altClass) : this.getClassIcon(classType.tag);
            iconElement.src = `/assets/${iconFile}`;
        }
        
        if (textElement) {
            textElement.textContent = currentName;
        }
        
        const weaponImageFile = this.getWeaponImageFile(currentClass);

        // Create toggle button
        const toggleHtml = info.altClass ? `
            <button id="version-toggle" style="
                position: absolute;
                right: 20px;
                background-color: #3498db;
                border: none;
                border-radius: 15px;
                padding: 6px 12px;
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                transition: background-color 0.2s;
            ">
            <span style="font-size: 18px;">🔒</span>
            <span>${isAltVersion ? originalCharName : info.altName}</span>
            </button>
        ` : '';

        // Update panel content
        this.classInfoPanel.innerHTML = `
            <div style="position: relative; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
                <h2 style="margin: 0; font-size: 24px; color: #3498db;">
                    ${currentName}
                </h2>
                ${toggleHtml}
            </div>
            <p style="margin: 0 0 15px 0;">${localization.getText(`${currentKey}.description`)}</p>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color:rgb(183, 204, 46);">Weapon</h3>
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <img src="/assets/${weaponImageFile}" style="height: 45px; width: 45px; margin-right: 10px;" 
                    alt="${localization.getText(`${currentKey}.weapon`)} icon" />
                <p style="margin: 0 0 0 10px;">
                    ${localization.getText(`${currentKey}.weapon`)}
                </p>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #2ecc71;">Strengths 💪</h3>
            <p style="margin: 0 0 15px 0;">
                ${localization.getText(`${currentKey}.strengths`)}
            </p>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #e74c3c;">Weaknesses 👎</h3>
            <p style="margin: 0;">
                ${localization.getText(`${currentKey}.weaknesses`)}
            </p>
        `;

        // Add event listener to toggle button
        const toggleButton = document.getElementById('version-toggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                // Toggle the alt version state
                this.selectedAltVersions[originalCharName] = !this.selectedAltVersions[originalCharName];
                const newIsAlt = this.selectedAltVersions[originalCharName];
                
                // Immediately update button text and icon
                if (iconElement) {
                    const iconFile = newIsAlt ? this.getAltClassIcon(info.altClass) : this.getClassIcon(classType.tag);
                    iconElement.src = `/assets/${iconFile}`;
                }
                
                if (textElement) {
                    textElement.textContent = newIsAlt ? info.altName : originalCharName;
                }

                // Now handle class selection
                const button = this.getButtonForClass(classType);
                if (button) {
                    if (newIsAlt && info.altClass) {
                        const altClassEnum = PlayerClass[info.altClass as keyof typeof PlayerClass] as PlayerClass;
                        this.selectClass(altClassEnum, button);
                    } else {
                        this.selectClass(classType, button);
                    }
                }
            });
        }
    }

    private getWeaponImageFile(classTag: string): string {
        const weaponMap: Record<string, string> = {
            'Fighter': 'attack_sword.png',
            'Rogue': 'attack_knife.png',
            'Mage': 'attack_wand.png',
            'Paladin': 'attack_shield.png',
            'Football': 'attack_football.png',
            'Gambler': 'attack_cards.png',
            'Athlete': 'attack_dumbbell.png',
            'Gourmand': 'attack_garlic.png'
        };
        return weaponMap[classTag] || 'attack_sword.png';
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
        const allButtons = [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton];
        allButtons.forEach(btn => {
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
        
        // Show confirm button
        this.confirmButton.style.display = 'block';
        
        // Hide any error message
        this.errorText.setVisible(false);

        // Get class info based on the original character name
        const baseClassName = CLASS_NAME_MAP[classType.tag as keyof typeof CLASS_NAME_MAP];
        const info = CLASS_INFO[baseClassName as ClassNames];

        // Show and update the info panel
        this.classInfoPanel.style.display = 'block';
        this.updateClassInfoPanel(baseClassName, classType, info);
        
        // Update positions to maintain alignment
        this.positionHTMLElements();
    }

    private getButtonForClass(classType: PlayerClass): HTMLButtonElement | null {
        const buttonMap: Record<string, HTMLButtonElement> = {
            'Fighter': this.fighterButton,
            'Rogue': this.rogueButton,
            'Mage': this.mageButton,
            'Paladin': this.paladinButton
        };
        return buttonMap[classType.tag] || null;
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

            // Remove language selector
            const languageSelector = document.querySelector('select');
            if (languageSelector && languageSelector.parentNode) {
                languageSelector.remove();
            }
        } catch (e) {
            console.error("Error in cleanupHTMLElements:", e);
        }
    }

    private showError(message: string) {
        this.errorText.setText(message);
        this.errorText.setVisible(true);
    }
    
    private createLanguageSelector() {
        const languageSelector = document.createElement('select');
        languageSelector.style.position = 'absolute';
        languageSelector.style.bottom = '20px';
        languageSelector.style.right = '20px';
        languageSelector.style.padding = '8px';
        languageSelector.style.fontFamily = 'Arial';
        languageSelector.style.fontSize = '16px';
        languageSelector.style.backgroundColor = '#2c3e50';
        languageSelector.style.color = 'white';
        languageSelector.style.border = '2px solid #34495e';
        languageSelector.style.borderRadius = '5px';
        languageSelector.style.cursor = 'pointer';

        const languages = [
            { code: 'en', name: 'English' },
            { code: 'de', name: 'Deutsch' }
        ];

        languages.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.code;
            option.textContent = lang.name;
            languageSelector.appendChild(option);
        });

        // Set initial value
        languageSelector.value = localization.getLanguage();

        // Add change event listener
        languageSelector.addEventListener('change', (event) => {
            const target = event.target as HTMLSelectElement;
            localization.setLanguage(target.value);
            
            // Update all text elements
            this.titleText.setText(localization.getText('ui.select_class.title'));
            this.subtitleText.setText(localization.getText('ui.select_class.subtitle'));
            
            // Update class descriptions
            if (this.selectedClass) {
                const button = this.getButtonForClass(this.selectedClass);
                if (button) {
                    this.selectClass(this.selectedClass, button);
                }
            }
            
            // Update confirm button text
            if (this.confirmButton) {
                this.confirmButton.textContent = localization.getText('ui.confirm_selection');
            }
        });

        document.body.appendChild(languageSelector);
    }

    private getClassIcon(classType: string): string {
        const iconMap: Record<string, string> = {
            'Fighter': 'class_fighter_1.png',
            'Rogue': 'class_rogue_1.png',
            'Mage': 'class_mage_1.png',
            'Paladin': 'class_paladin_1.png',
            'Football': 'class_football_1.png',
            'Gambler': 'class_gambler_1.png',
            'Athlete': 'class_athlete_1.png',
            'Gourmand': 'class_chef_1.png'
        };
        return iconMap[classType] || 'class_fighter_1.png';
    }

    private getClassIconKey(classType: string): string {
        const iconKeyMap: Record<string, string> = {
            'Fighter': 'fighter_icon',
            'Rogue': 'rogue_icon',
            'Mage': 'mage_icon',
            'Paladin': 'paladin_icon',
            'Football': 'football_icon',
            'Gambler': 'gambler_icon',
            'Athlete': 'athlete_icon',
            'Gourmand': 'gourmand_icon'
        };
        return iconKeyMap[classType] || 'fighter_icon';
    }

    private getAltClassIcon(classType: string): string {
        const altIconMap: Record<string, string> = {
            'Football': 'class_football_1.png',
            'Gambler': 'class_gambler_1.png',
            'Athlete': 'class_athlete_1.png',
            'Gourmand': 'class_chef_1.png'
        };
        return altIconMap[classType] || 'class_fighter_1.png';
    }

    shutdown() {
        console.log("ClassSelectScene shutdown called");
        
        // Remove event listeners
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