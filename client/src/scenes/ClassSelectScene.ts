import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Account } from '../autobindings';
import PlayerClass from '../autobindings/player_class_type';
import { GameEvents } from '../constants/GameEvents';
import { localization } from '../utils/localization';
import { isMobileDevice, getResponsiveFontSize, applyResponsiveStyles } from '../utils/responsive';
import { QuestType } from '../autobindings';

// Map player class to numeric class ID
const CLASS_ID_MAP = {
    "Fighter": 0,
    "Rogue": 1,
    "Mage": 2,
    "Paladin": 3,
    "Football": 4,
    "Gambler": 5,
    "Athlete": 6,
    "Gourmand": 7,
    "Valkyrie": 8,
    "Volleyball": 9
};

const CLASS_NAME_MAP = {
    'Fighter': "Til",
    'Rogue': "Marc",
    'Mage': "Max",
    'Paladin': "Chris",
    'Football': "Dominik",
    'Gambler': "Robin",
    'Athlete': "David",
    'Gourmand': "Benni",
    'Valkyrie': "Gwen",
    'Volleyball': "Volleyball Gwen"
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
        altName: "Gym Rat Max",
        altClass: "Athlete"
    },
    "Chris": {
        description: "class.chris.description",
        weapon: "class.chris.weapon",
        strengths: "class.chris.strengths",
        weaknesses: "class.chris.weaknesses",
        altName: "Chef Chris",
        altClass: "Gourmand"
    },
    "Gwen": {
        description: "class.gwen.description",
        weapon: "class.gwen.weapon",
        strengths: "class.gwen.strengths",
        weaknesses: "class.gwen.weaknesses",
        altName: "Volleyball Gwen",
        altClass: "Volleyball"
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
    private gwenButton!: HTMLButtonElement;  // Add Gwen button property
    private confirmButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private questButton!: HTMLButtonElement;
    private footballButton!: HTMLButtonElement;
    private gamblerButton!: HTMLButtonElement;
    private athleteButton!: HTMLButtonElement;
    private gourmandButton!: HTMLButtonElement;
    private bestiaryButton!: HTMLButtonElement;
    private achievementsButton!: HTMLButtonElement; // New achievements button
    private burgerMenuButton!: HTMLButtonElement; // Burger menu button for mobile
    private burgerMenuContainer!: HTMLDivElement; // Container for burger menu options
    private weaponCombosButton!: HTMLButtonElement; // Weapon combos button
    
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
    private isBurgerMenuOpen: boolean = false; // Track burger menu state

    constructor() {
        super('ClassSelectScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("ClassSelectScene constructor called");
    }

    preload() {
        // Load character class icons using the correct filenames
        this.load.image('fighter_icon', 'assets/class_fighter_1.png');
        this.load.image('rogue_icon', 'assets/class_rogue_1.png');
        this.load.image('mage_icon', 'assets/class_mage_1.png');
        this.load.image('paladin_icon', 'assets/class_paladin_1.png');
        this.load.image('football_icon', 'assets/class_football_1.png');
        this.load.image('gambler_icon', 'assets/class_gambler_1.png');
        this.load.image('athlete_icon', 'assets/class_athlete_1.png');
        this.load.image('gourmand_icon', 'assets/class_chef_1.png');
        this.load.image('valkyrie_icon', 'assets/class_valkyrie.png');
        this.load.image('volleyball_icon', 'assets/class_volleyball.png');
        
        // Load weapon icons
        this.load.image('attack_sword', 'assets/attack_sword.png');
        this.load.image('attack_knife', 'assets/attack_knife.png');
        this.load.image('attack_wand', 'assets/attack_wand.png');
        this.load.image('attack_shield', 'assets/attack_shield.png');
        this.load.image('attack_football', 'assets/attack_football.png');
        this.load.image('attack_cards', 'assets/attack_cards.png');
        this.load.image('attack_dumbbell', 'assets/attack_dumbbell.png');
        this.load.image('attack_garlic', 'assets/attack_garlic.png');
        this.load.image('attack_throwing_shield', 'assets/attack_throwing_shield.png');
        this.load.image('attack_energy_orb', 'assets/attack_energy_orb.png');
        
        // Add quest button image if you have one
        this.load.image('quest_icon', 'assets/white_pixel.png');
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
        
        // Check if we're on mobile
        const isMobile = isMobileDevice();
              
        // Add title - centered on screen (only on desktop)
        if (!isMobile) {
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
        } else {
            // On mobile, create empty text objects to avoid null references
            // but position them off-screen
            this.titleText = this.add.text(-1000, -1000, '', {
                fontFamily: 'Arial Black',
                fontSize: '1px'
            }).setVisible(false);
            
            this.subtitleText = this.add.text(-1000, -1000, '', {
                fontFamily: 'Arial',
                fontSize: '1px'
            }).setVisible(false);
        }
        
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
        questButton.textContent = '📜 ' + localization.getText('ui.quests');
        
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
        
        // Add bestiary button below quest button
        const bestiaryButton = document.createElement('button');
        bestiaryButton.style.position = 'absolute';
        bestiaryButton.style.top = '110px'; // Position below quest button
        bestiaryButton.style.right = '50px';
        bestiaryButton.style.width = '180px';
        bestiaryButton.style.height = '50px';
        bestiaryButton.style.padding = '10px';
        bestiaryButton.style.backgroundColor = '#2c3e50';
        bestiaryButton.style.color = 'white';
        bestiaryButton.style.border = '2px solid #34495e';
        bestiaryButton.style.borderRadius = '5px';
        bestiaryButton.style.cursor = 'pointer';
        bestiaryButton.style.fontFamily = 'Arial';
        bestiaryButton.style.fontSize = '18px';
        bestiaryButton.style.transition = 'background-color 0.2s, border-color 0.2s';
        bestiaryButton.style.display = 'flex';
        bestiaryButton.style.alignItems = 'center';
        bestiaryButton.style.justifyContent = 'center';
        bestiaryButton.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        bestiaryButton.textContent = '🐺 ' + localization.getText('ui.bestiary');
        
        bestiaryButton.addEventListener('mouseover', () => {
            bestiaryButton.style.backgroundColor = '#3498db';
            bestiaryButton.style.borderColor = '#2980b9';
        });
        
        bestiaryButton.addEventListener('mouseout', () => {
            bestiaryButton.style.backgroundColor = '#2c3e50';
            bestiaryButton.style.borderColor = '#34495e';
        });
        
        bestiaryButton.addEventListener('click', () => {
            this.scene.start('BestaryScene', { spacetimeDBClient: this.spacetimeDBClient });
        });
        
        document.body.appendChild(bestiaryButton);
        
        // Store reference for cleanup
        this.bestiaryButton = bestiaryButton;
        
        // Add achievements button below bestiary button
        const achievementsButton = document.createElement('button');
        achievementsButton.style.position = 'absolute';
        achievementsButton.style.top = '170px'; // Position below bestiary button
        achievementsButton.style.right = '50px';
        achievementsButton.style.width = '180px';
        achievementsButton.style.height = '50px';
        achievementsButton.style.padding = '10px';
        achievementsButton.style.backgroundColor = '#2c3e50';
        achievementsButton.style.color = 'white';
        achievementsButton.style.border = '2px solid #34495e';
        achievementsButton.style.borderRadius = '5px';
        achievementsButton.style.cursor = 'pointer';
        achievementsButton.style.fontFamily = 'Arial';
        achievementsButton.style.fontSize = '18px';
        achievementsButton.style.transition = 'background-color 0.2s, border-color 0.2s';
        achievementsButton.style.display = 'flex';
        achievementsButton.style.alignItems = 'center';
        achievementsButton.style.justifyContent = 'center';
        achievementsButton.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        achievementsButton.textContent = '🏆 ' + localization.getText('ui.achievements');
        
        achievementsButton.addEventListener('mouseover', () => {
            achievementsButton.style.backgroundColor = '#3498db';
            achievementsButton.style.borderColor = '#2980b9';
        });
        
        achievementsButton.addEventListener('mouseout', () => {
            achievementsButton.style.backgroundColor = '#2c3e50';
            achievementsButton.style.borderColor = '#34495e';
        });
        
        achievementsButton.addEventListener('click', () => {
            this.scene.start('AchievementScene');
        });
        
        document.body.appendChild(achievementsButton);
        
        // Store reference for cleanup
        this.achievementsButton = achievementsButton;
        
        // Add weapon combinations button below achievements button
        const weaponCombosButton = document.createElement('button');
        weaponCombosButton.style.position = 'absolute';
        weaponCombosButton.style.top = '230px'; // Position below achievements button
        weaponCombosButton.style.right = '50px';
        weaponCombosButton.style.width = '180px';
        weaponCombosButton.style.height = '50px';
        weaponCombosButton.style.padding = '10px';
        weaponCombosButton.style.backgroundColor = '#2c3e50';
        weaponCombosButton.style.color = 'white';
        weaponCombosButton.style.border = '2px solid #34495e';
        weaponCombosButton.style.borderRadius = '5px';
        weaponCombosButton.style.cursor = 'pointer';
        weaponCombosButton.style.fontFamily = 'Arial';
        weaponCombosButton.style.fontSize = '18px';
        weaponCombosButton.style.transition = 'background-color 0.2s, border-color 0.2s';
        weaponCombosButton.style.display = 'flex';
        weaponCombosButton.style.alignItems = 'center';
        weaponCombosButton.style.justifyContent = 'center';
        weaponCombosButton.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        weaponCombosButton.textContent = '🔨 ' + localization.getText('ui.weapon_combinations');
        
        weaponCombosButton.addEventListener('mouseover', () => {
            weaponCombosButton.style.backgroundColor = '#3498db';
            weaponCombosButton.style.borderColor = '#2980b9';
        });
        
        weaponCombosButton.addEventListener('mouseout', () => {
            weaponCombosButton.style.backgroundColor = '#2c3e50';
            weaponCombosButton.style.borderColor = '#34495e';
        });
        
        weaponCombosButton.addEventListener('click', () => {
            this.scene.start('WeaponCombinationsScene');
        });
        
        document.body.appendChild(weaponCombosButton);
        
        // Store reference for cleanup
        this.weaponCombosButton = weaponCombosButton;
        
        // Add burger menu button for mobile
        const burgerMenuButton = document.createElement('button');
        burgerMenuButton.style.position = 'absolute';
        burgerMenuButton.style.top = '20px';
        burgerMenuButton.style.right = '20px';
        burgerMenuButton.style.width = '50px';
        burgerMenuButton.style.height = '50px';
        burgerMenuButton.style.backgroundColor = '#2c3e50';
        burgerMenuButton.style.border = '2px solid #34495e';
        burgerMenuButton.style.borderRadius = '5px';
        burgerMenuButton.style.cursor = 'pointer';
        burgerMenuButton.style.zIndex = '1001';
        burgerMenuButton.style.display = 'flex';
        burgerMenuButton.style.flexDirection = 'column';
        burgerMenuButton.style.justifyContent = 'center';
        burgerMenuButton.style.alignItems = 'center';
        
        // Add burger icon (three horizontal lines)
        for (let i = 0; i < 3; i++) {
            const line = document.createElement('div');
            line.style.width = '25px';
            line.style.height = '3px';
            line.style.backgroundColor = 'white';
            line.style.margin = '3px 0';
            burgerMenuButton.appendChild(line);
        }
        
        // Create burger menu container (hidden by default)
        const burgerMenuContainer = document.createElement('div');
        burgerMenuContainer.style.position = 'absolute';
        burgerMenuContainer.style.top = '80px';
        burgerMenuContainer.style.right = '20px';
        burgerMenuContainer.style.width = '200px';
        burgerMenuContainer.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        burgerMenuContainer.style.color = 'white';
        burgerMenuContainer.style.borderRadius = '8px';
        burgerMenuContainer.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
        burgerMenuContainer.style.zIndex = '1000';
        burgerMenuContainer.style.display = 'none'; // Hidden by default
        
        // Add menu options
        const menuOptions = [
            { text: '📜 Quests', scene: 'QuestScene' },
            { text: '🐺 Bestiary', scene: 'BestaryScene' },
            { text: '🏆 Achievements', scene: 'AchievementScene' },
            { text: '🔨 Combinations', scene: 'WeaponCombinationsScene' } // Add weapon combos to menu
        ];
        
        menuOptions.forEach(option => {
            const menuButton = document.createElement('button');
            menuButton.textContent = option.text;
            menuButton.style.width = '100%';
            menuButton.style.padding = '15px';
            menuButton.style.backgroundColor = 'transparent';
            menuButton.style.color = 'white';
            menuButton.style.border = 'none';
            menuButton.style.borderBottom = '1px solid #34495e';
            menuButton.style.cursor = 'pointer';
            menuButton.style.fontFamily = 'Arial';
            menuButton.style.fontSize = '18px';
            menuButton.style.transition = 'background-color 0.2s';
            menuButton.style.textAlign = 'left';
            
            menuButton.addEventListener('mouseover', () => {
                menuButton.style.backgroundColor = '#3498db';
            });
            
            menuButton.addEventListener('mouseout', () => {
                menuButton.style.backgroundColor = 'transparent';
            });
            
            menuButton.addEventListener('click', () => {
                if (option.scene === 'BestaryScene') {
                    this.scene.start(option.scene, { spacetimeDBClient: this.spacetimeDBClient });
                } else {
                    this.scene.start(option.scene);
                }
            });
            
            burgerMenuContainer.appendChild(menuButton);
        });
        
        // Add burger menu toggle functionality
        burgerMenuButton.addEventListener('click', () => {
            this.isBurgerMenuOpen = !this.isBurgerMenuOpen;
            burgerMenuContainer.style.display = this.isBurgerMenuOpen ? 'block' : 'none';
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isBurgerMenuOpen && 
                e.target !== burgerMenuButton && 
                !burgerMenuButton.contains(e.target as Node) && 
                !burgerMenuContainer.contains(e.target as Node)) {
                this.isBurgerMenuOpen = false;
                burgerMenuContainer.style.display = 'none';
            }
        });
        
        document.body.appendChild(burgerMenuButton);
        document.body.appendChild(burgerMenuContainer);
        
        // Store references for cleanup
        this.burgerMenuButton = burgerMenuButton;
        this.burgerMenuContainer = burgerMenuContainer;
        
        // Make sure correct UI elements are shown based on device type right from the start
        if (isMobileDevice()) {
            // On mobile: show burger menu, hide individual buttons
            if (this.burgerMenuButton) this.burgerMenuButton.style.display = 'flex';
            if (this.questButton) this.questButton.style.display = 'none';
            if (this.bestiaryButton) this.bestiaryButton.style.display = 'none';
            if (this.achievementsButton) this.achievementsButton.style.display = 'none';
            if (this.weaponCombosButton) this.weaponCombosButton.style.display = 'none';
        } else {
            // On desktop: hide burger menu, show individual buttons
            if (this.burgerMenuButton) this.burgerMenuButton.style.display = 'none';
            if (this.burgerMenuContainer) this.burgerMenuContainer.style.display = 'none';
            if (this.questButton) this.questButton.style.display = 'flex';
            if (this.bestiaryButton) this.bestiaryButton.style.display = 'flex';
            if (this.achievementsButton) this.achievementsButton.style.display = 'flex';
            if (this.weaponCombosButton) this.weaponCombosButton.style.display = 'flex';
        }
    }
    
    private createConfirmButton() {
        this.confirmButton = document.createElement('button');
        this.confirmButton.textContent = localization.getText('ui.confirm_selection');
        
        // Update button styles to fix positioning
        this.confirmButton.style.position = 'relative';  // Changed from absolute to relative
        this.confirmButton.style.padding = '12px 24px';
        this.confirmButton.style.backgroundColor = '#27ae60';
        this.confirmButton.style.color = 'white';
        this.confirmButton.style.border = 'none';
        this.confirmButton.style.borderRadius = '5px';
        this.confirmButton.style.fontSize = '18px';
        this.confirmButton.style.cursor = 'pointer';
        this.confirmButton.style.transition = 'background-color 0.2s';
        this.confirmButton.style.display = 'none';
        this.confirmButton.style.width = '100%';
        this.confirmButton.style.marginTop = '20px';  // Added margin top
        this.confirmButton.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';  // Added shadow for better visibility
        
        this.confirmButton.addEventListener('mouseover', () => {
            this.confirmButton.style.backgroundColor = '#219a52';
        });
        
        this.confirmButton.addEventListener('mouseout', () => {
            this.confirmButton.style.backgroundColor = '#27ae60';
        });
        
        this.confirmButton.addEventListener('click', () => {
            this.spawnPlayer();
        });

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
        
        const isMobile = isMobileDevice();
        
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
                    icon.src = 'assets/' + imageFile;
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

            // Remove the lock indicator from here - it will be added to the version toggle button instead

            // Add info button for mobile view
            if (isMobile) {
                const infoBtn = document.createElement('button');
                infoBtn.className = 'class-info-button';
                infoBtn.innerHTML = '<span style="font-size: 20px">ℹ️</span>';
                infoBtn.style.position = 'absolute';
                infoBtn.style.right = '10px';
                infoBtn.style.backgroundColor = 'transparent';
                infoBtn.style.border = 'none';
                infoBtn.style.cursor = 'pointer';
                infoBtn.style.width = '36px';
                infoBtn.style.height = '36px';
                infoBtn.style.borderRadius = '50%';
                infoBtn.style.display = 'flex';
                infoBtn.style.alignItems = 'center';
                infoBtn.style.justifyContent = 'center';
                infoBtn.style.padding = '0';
                
                infoBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering the parent button click
                    this.selectClass(classType, button);
                    this.showClassInfoModal(classType);
                });
                
                button.appendChild(infoBtn);
            }
            
            button.addEventListener('click', () => {
                this.selectClass(classType, button);
                
                // On mobile, don't automatically show the info panel when clicking the button
                // This is handled by the info button instead
                if (!isMobile && this.classInfoPanel) {
                    this.classInfoPanel.style.display = 'block';
                }
            });
            
            return button;
        };
        
        // Create class buttons
        this.fighterButton = createClassButton('Til', PlayerClass.Fighter as PlayerClass, 'fighter_icon', 'class_fighter_1.png');
        this.rogueButton = createClassButton('Marc', PlayerClass.Rogue as PlayerClass, 'rogue_icon', 'class_rogue_1.png');
        this.mageButton = createClassButton('Max', PlayerClass.Mage as PlayerClass, 'mage_icon', 'class_mage_1.png');
        this.paladinButton = createClassButton('Chris', PlayerClass.Paladin as PlayerClass, 'paladin_icon', 'class_paladin_1.png');
        this.gwenButton = createClassButton('Gwen', PlayerClass.Valkyrie as PlayerClass, 'valkyrie_icon', 'class_valkyrie.png');
        
        // Add all buttons to container
        this.classButtonsContainer.appendChild(this.fighterButton);
        this.classButtonsContainer.appendChild(this.rogueButton);
        this.classButtonsContainer.appendChild(this.mageButton);
        this.classButtonsContainer.appendChild(this.paladinButton);
        this.classButtonsContainer.appendChild(this.gwenButton);
        
        // Check quest completion status after buttons are created
        this.updateQuestLockStatus();
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
        this.classInfoPanel.style.display = 'none'; // Initially hidden
        this.classInfoPanel.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        
        // For mobile, add a close button
        if (isMobileDevice()) {
            const closeButton = document.createElement('button');
            closeButton.textContent = '✕';
            closeButton.style.position = 'absolute';
            closeButton.style.top = '10px';
            closeButton.style.right = '10px';
            closeButton.style.background = 'transparent';
            closeButton.style.border = 'none';
            closeButton.style.color = 'white';
            closeButton.style.fontSize = '20px';
            closeButton.style.cursor = 'pointer';
            closeButton.style.padding = '5px 10px';
            closeButton.addEventListener('click', () => {
                this.hideClassInfoModal();
            });
            this.classInfoPanel.appendChild(closeButton);
        }

        document.body.appendChild(this.classInfoPanel);
        
        // Create modal overlay for mobile
        if (isMobileDevice()) {
            const overlay = document.createElement('div');
            overlay.id = 'modal-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            overlay.style.zIndex = '1000';
            overlay.style.display = 'none';
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hideClassInfoModal();
                }
            });
            
            document.body.appendChild(overlay);
        }
    }
    
    private showClassInfoModal(classType: PlayerClass) {
        if (!this.classInfoPanel) return;
        
        if (isMobileDevice()) {
            // Mobile specific panel positioning
            const overlay = document.getElementById('modal-overlay');
            if (!overlay) return;
            
            // Position the panel in the center of the screen for mobile
            this.classInfoPanel.style.left = '50%';
            this.classInfoPanel.style.top = '50%';
            this.classInfoPanel.style.transform = 'translate(-50%, -50%)';
            this.classInfoPanel.style.zIndex = '1001';
            this.classInfoPanel.style.width = '85%';
            this.classInfoPanel.style.maxWidth = '400px';
            this.classInfoPanel.style.maxHeight = '80%';
            this.classInfoPanel.style.overflowY = 'auto';
            
            // Show the overlay and panel
            overlay.style.display = 'block';
            this.classInfoPanel.style.display = 'block';
        } else {
            // Desktop specific panel positioning - we handle this in selectClass method
            // This is shown automatically when selecting a class on desktop
            this.classInfoPanel.style.display = 'block';
            this.positionHTMLElements(); // Ensure proper positioning
        }
    }
    
    private hideClassInfoModal() {
        if (!isMobileDevice()) return;
        
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
        
        if (this.classInfoPanel) {
            this.classInfoPanel.style.display = 'none';
        }
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
        
        const isQuestCompleted = this.isCharacterQuestCompleted(originalCharName);
        
        const currentClass = isAltVersion ? info.altClass : classType.tag;
        const currentName = isAltVersion ? info.altName : originalCharName;
        
        let actualClassType = classType;
        if (isAltVersion && info.altClass) {
            // Find the alt class PlayerClass object
            const classKey = Object.keys(PlayerClass).find(key => 
                typeof PlayerClass[key as keyof typeof PlayerClass] === 'object' && 
                (PlayerClass[key as keyof typeof PlayerClass] as PlayerClass).tag === info.altClass
            );
            if (classKey) {
                actualClassType = PlayerClass[classKey as keyof typeof PlayerClass] as PlayerClass;
            }
        }

        // Get localization keys
        const baseKey = `class.${originalCharName.toLowerCase()}`;
        const altKey = `class.${this.getAltVersionKey(originalCharName)}`;
        const currentKey = isAltVersion ? altKey : baseKey;

        // Get the correct weapon image file based on the selected class variant
        const weaponImageFile = this.getWeaponImageFile(currentClass);

        // Update button content first
        const iconElement = document.getElementById(`${originalCharName.toLowerCase()}-icon`) as HTMLImageElement;
        const textElement = document.getElementById(`${originalCharName.toLowerCase()}-text`);
        
        if (iconElement) {
            const iconFile = isAltVersion ? this.getAltClassIcon(info.altClass) : this.getClassIcon(classType.tag);
            iconElement.src = `assets/${iconFile}`;
        }
        
        if (textElement) {
            textElement.textContent = currentName;
        }

        // Create toggle button - with lock icon if quest is not completed
        const toggleHtml = info.altClass ? `
            <button id="version-toggle" style="
                position: absolute;
                right: 10px;
                background-color: ${isQuestCompleted ? '#3498db' : '#95a5a6'};
                border: none;
                border-radius: 15px;
                padding: 6px 12px;
                color: white;
                cursor: ${isQuestCompleted ? 'pointer' : 'not-allowed'};
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                transition: background-color 0.2s;
                opacity: ${isQuestCompleted ? '1' : '0.6'};
            " ${!isQuestCompleted ? 'disabled' : ''}>
            <span>Version</span>
            <span style="font-size: 18px;">${isQuestCompleted ? '🔁' : '🔒'}</span>
            </button>
        ` : '';

        // Update the actual panel content
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
                <img src="assets/${weaponImageFile}" style="height: 45px; width: 45px; margin-right: 10px;" 
                    alt="${localization.getText(`${currentKey}.weapon`)} icon" />
                <p style="margin: 0 0 0 10px;">
                    ${localization.getText(`${currentKey}.weapon`)}
                </p>
            </div>
            <h3 style="margin: 0 0 10px 0; fontSize: 18px; color: #2ecc71;">Strengths 💪</h3>
            <p style="margin: 0 0 15px 0;">
                ${localization.getText(`${currentKey}.strengths`)}
            </p>
            <h3 style="margin: 0 0 10px 0; fontSize: 18px; color: #e74c3c;">Weaknesses 👎</h3>
            <p style="margin: 0;">
                ${localization.getText(`${currentKey}.weaknesses`)}
            </p>
        `;

        // Add event listener to toggle button only if quest is completed
        const toggleButton = document.getElementById('version-toggle');
        if (toggleButton && isQuestCompleted) {
            toggleButton.addEventListener('click', () => {
                // Toggle the alt version state for this character
                this.selectedAltVersions[originalCharName] = !this.selectedAltVersions[originalCharName];
                
                // Update the selected class to the appropriate one
                if (this.selectedAltVersions[originalCharName] && info.altClass) {
                    // Find the alt class PlayerClass object
                    const classKey = Object.keys(PlayerClass).find(key => 
                        typeof PlayerClass[key as keyof typeof PlayerClass] === 'object' && 
                        (PlayerClass[key as keyof typeof PlayerClass] as PlayerClass).tag === info.altClass
                    );
                    if (classKey) {
                        this.selectedClass = PlayerClass[classKey as keyof typeof PlayerClass] as PlayerClass;
                    }
                } else {
                    // Switch back to original class
                    const classKey = Object.keys(PlayerClass).find(key => 
                        typeof PlayerClass[key as keyof typeof PlayerClass] === 'object' && 
                        (PlayerClass[key as keyof typeof PlayerClass] as PlayerClass).tag === classType.tag
                    );
                    if (classKey) {
                        this.selectedClass = PlayerClass[classKey as keyof typeof PlayerClass] as PlayerClass;
                    }
                }
                
                // Update the UI to reflect the change
                this.updateClassInfoPanel(originalCharName, classType, info);
                
                // Update the button style to show it's been toggled
                if (this.selectedClass) {
                    const button = this.getButtonForClass(this.selectedClass);
                    if (button) {
                        this.selectClass(this.selectedClass, button);
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
            'Gourmand': 'attack_garlic.png',
            'Valkyrie': 'attack_throwing_shield.png',
            'Volleyball': 'attack_energy_orb.png'
        };
        return weaponMap[classTag] || 'attack_sword.png';
    }
    
    private positionHTMLElements() {
        const isMobile = isMobileDevice();
        
        // Position class select container
        if (isMobile) {
            // On mobile, position the class buttons container in the center
            // with a mobile-friendly layout
            this.classButtonsContainer.style.left = '50%';
            this.classButtonsContainer.style.top = '50%';
            this.classButtonsContainer.style.width = '90%';
            this.classButtonsContainer.style.maxWidth = '300px';
            
            // Show info panel below class buttons on mobile
            if (this.classInfoPanel && this.classInfoPanel.style.display !== 'none') {
                this.classInfoPanel.style.left = '50%';
                this.classInfoPanel.style.top = 'calc(50% + 220px)';
                this.classInfoPanel.style.transform = 'translate(-50%, 0)';
                this.classInfoPanel.style.width = '90%';
                this.classInfoPanel.style.maxWidth = '300px';
                this.classInfoPanel.style.maxHeight = 'calc(100% - 450px)';
                this.classInfoPanel.style.overflowY = 'auto';
            }
            
            // Show burger menu, hide individual buttons on mobile
            if (this.burgerMenuButton) {
                this.burgerMenuButton.style.display = 'flex';
            }
            
            if (this.questButton) {
                this.questButton.style.display = 'none';
            }
            
            if (this.bestiaryButton) {
                this.bestiaryButton.style.display = 'none';
            }
            
            if (this.achievementsButton) {
                this.achievementsButton.style.display = 'none';
            }
            
            if (this.weaponCombosButton) {
                this.weaponCombosButton.style.display = 'none';
            }
        } else {
            // Desktop layout - horizontal arrangement
            this.classButtonsContainer.style.left = '50%';
            this.classButtonsContainer.style.top = '60%';
            this.classButtonsContainer.style.width = '250px';
            
            // Position info panel to the right of the centered container
            if (this.classInfoPanel && this.classInfoPanel.style.display !== 'none') {
                const containerWidth = 250;
                const spacing = 30;
                this.classInfoPanel.style.left = '50%';
                this.classInfoPanel.style.top = '60%';
                this.classInfoPanel.style.transform = `translate(calc(${(containerWidth/2 + spacing)}px), -55%)`;
                this.classInfoPanel.style.width = '300px';
                this.classInfoPanel.style.maxHeight = '450px';
            }
            
            // Hide burger menu, show individual buttons on desktop
            if (this.burgerMenuButton) {
                this.burgerMenuButton.style.display = 'none';
            }
            
            if (this.burgerMenuContainer) {
                this.burgerMenuContainer.style.display = 'none';
                this.isBurgerMenuOpen = false;
            }
            
            // Standard position for quest and bestiary buttons
            if (this.questButton) {
                this.questButton.style.display = 'flex';
                this.questButton.style.top = '50px';
                this.questButton.style.right = '50px';
                this.questButton.style.width = '180px';
                this.questButton.style.height = '50px';
                this.questButton.style.fontSize = '18px';
            }
            
            if (this.bestiaryButton) {
                this.bestiaryButton.style.display = 'flex';
                this.bestiaryButton.style.top = '110px';
                this.bestiaryButton.style.right = '50px';
                this.bestiaryButton.style.width = '180px';
                this.bestiaryButton.style.height = '50px';
                this.bestiaryButton.style.fontSize = '18px';
            }
            
            if (this.achievementsButton) {
                this.achievementsButton.style.display = 'flex';
                this.achievementsButton.style.top = '170px';
                this.achievementsButton.style.right = '50px';
                this.achievementsButton.style.width = '180px';
                this.achievementsButton.style.height = '50px';
                this.achievementsButton.style.fontSize = '18px';
            }
            
            if (this.weaponCombosButton) {
                this.weaponCombosButton.style.display = 'flex';
                this.weaponCombosButton.style.top = '230px'; // Position below achievements button
                this.weaponCombosButton.style.right = '50px';
                this.weaponCombosButton.style.width = '180px';
                this.weaponCombosButton.style.height = '50px';
                this.weaponCombosButton.style.fontSize = '18px';
            }
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
        const allButtons = [
            this.fighterButton, 
            this.rogueButton, 
            this.mageButton, 
            this.paladinButton,
            this.gwenButton
        ];
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
        
        // On desktop, update and show the info panel
        if (!isMobileDevice() && this.classInfoPanel) {
            this.classInfoPanel.style.display = 'block';
            this.positionHTMLElements();
        }
        
        // Update the info panel content - this will also handle icon updates correctly
        this.updateClassInfoPanel(baseClassName, classType, info);
    }

    private getButtonForClass(classType: PlayerClass): HTMLButtonElement | null {
        const buttonMap: Record<string, HTMLButtonElement> = {
            'Fighter': this.fighterButton,
            'Rogue': this.rogueButton,
            'Mage': this.mageButton,
            'Paladin': this.paladinButton,
            'Valkyrie': this.gwenButton
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

            if (this.bestiaryButton && this.bestiaryButton.parentNode) {
                this.bestiaryButton.remove();
            }

            if (this.achievementsButton && this.achievementsButton.parentNode) {
                this.achievementsButton.remove();
            }
            
            // Add cleanup for weapon combos button
            if (this.weaponCombosButton && this.weaponCombosButton.parentNode) {
                this.weaponCombosButton.remove();
            }
            
            // Clean up burger menu elements
            if (this.burgerMenuButton && this.burgerMenuButton.parentNode) {
                this.burgerMenuButton.remove();
            }
            
            if (this.burgerMenuContainer && this.burgerMenuContainer.parentNode) {
                this.burgerMenuContainer.remove();
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
            'Gourmand': 'class_chef_1.png',
            'Valkyrie': 'class_valkyrie.png',
            'Volleyball': 'class_volleyball.png'
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
            'Gourmand': 'class_chef_1.png',
            'Valkyrie': 'class_valkyrie.png',
            'Volleyball': 'class_volleyball.png'
        };
        return altIconMap[classType] || this.getClassIcon(classType);
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

    private updateQuestLockStatus() {
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.isConnected) {
            return;
        }

        try {
            const ctx = this.spacetimeDBClient.sdkConnection;
            if (!ctx || !ctx.db) {
                return;
            }

            const localIdentity = this.spacetimeDBClient.identity;
            if (!localIdentity) {
                return;
            }

            // Get all quests for the current player
            const playerQuests: any[] = [];
            try {
                for (const quest of ctx.db.gameQuests.iter()) {
                    if (quest.accountIdentity && quest.accountIdentity.isEqual(localIdentity)) {
                        playerQuests.push(quest);
                    }
                }
            } catch (err) {
                console.error("Error getting player quests for lock status:", err);
                return;
            }

            // Refresh the class info panel if it's currently showing to update lock status
            if (this.selectedClass && this.classInfoPanel && this.classInfoPanel.style.display !== 'none') {
                const baseClassName = CLASS_NAME_MAP[this.selectedClass.tag as keyof typeof CLASS_NAME_MAP];
                const info = CLASS_INFO[baseClassName as ClassNames];
                this.updateClassInfoPanel(baseClassName, this.selectedClass, info);
            }

        } catch (error) {
            console.error("Error updating quest lock status:", error);
        }
    }

    private isCharacterQuestCompleted(characterName: string): boolean {
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.isConnected) {
            return false;
        }

        try {
            const ctx = this.spacetimeDBClient.sdkConnection;
            if (!ctx || !ctx.db) {
                return false;
            }

            const localIdentity = this.spacetimeDBClient.identity;
            if (!localIdentity) {
                return false;
            }

            // Map character names to quest types
            const questTypeMap: Record<string, string> = {
                'Til': 'Til',
                'Marc': 'Marc', 
                'Max': 'Max',
                'Chris': 'Chris'
            };

            const questTypeName = questTypeMap[characterName];
            if (!questTypeName) {
                return false;
            }

            // Look for the specific quest for this character
            for (const quest of ctx.db.gameQuests.iter()) {
                if (quest.accountIdentity && 
                    quest.accountIdentity.isEqual(localIdentity) && 
                    quest.questTypeType && 
                    quest.questTypeType.tag === questTypeName) {
                    return quest.isCompleted || false;
                }
            }

            return false;
        } catch (error) {
            console.error('Error checking quest completion:', error);
            return false;
        }
    }
}