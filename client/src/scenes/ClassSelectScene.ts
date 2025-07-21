import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Account } from '../autobindings';
import PlayerClass from '../autobindings/player_class_type';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';
import OptionsUI from '../ui/OptionsUI';
import CurseUI from '../ui/CurseUI';
import { isMobileDevice } from '../utils/device';

// Map player class to numeric class ID
const CLASS_ID_MAP: { [key: string]: number } = {
    "Fighter": 0,
    "Rogue": 1,
    "Mage": 2,
    "Paladin": 3,
    "Valkyrie": 4,
    "Priest": 5,
    "Football": 6,
    "Gambler": 7,
    "Athlete": 8,
    "Gourmand": 9,
    "Volleyball": 10,
    "Stoner": 11,
};

const CLASS_ICON_MAP : Record<string, string> = {
    "fighter_icon": "attack_sword",
    "rogue_icon": "attack_knife",
    "mage_icon": "attack_wand",
    "paladin_icon": "attack_shield",
    "valkyrie_icon": "attack_horn",
    "priestess_icon": "attack_staff",
    "football_icon": "attack_football",
    "gambler_icon": "attack_cards",
    "athlete_icon": "attack_dumbbell",
    "gourmand_icon": "attack_garlic",
    "volleyball_icon": "attack_volleyball",
    "stoner_icon": "attack_joint",
};

// Constants for responsive design
const RESPONSIVE_CONFIG = {
    TITLE_SIZE_RATIO: 0.06,
    TITLE_HEIGHT_RATIO: 0.09,
    MAX_TITLE_SIZE: 48,
    SUBTITLE_SIZE_RATIO: 0.025,
    SUBTITLE_HEIGHT_RATIO: 0.04,
    MAX_SUBTITLE_SIZE: 24,
    SUBTITLE_Y_OFFSET: 0.06,
    MIN_SUBTITLE_Y_OFFSET: 50,
    MIN_STROKE_WIDTH_TITLE: 3,
    MIN_STROKE_WIDTH_SUBTITLE: 2
};

export default class ClassSelectScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    
    // UI Elements
    private titleText!: Phaser.GameObjects.Text;
    private subtitleText!: Phaser.GameObjects.Text;
    private classButtonsContainer!: HTMLDivElement;
    private fighterButton!: HTMLButtonElement;
    private rogueButton!: HTMLButtonElement;
    private mageButton!: HTMLButtonElement;
    private paladinButton!: HTMLButtonElement;
    private valkyrieButton!: HTMLButtonElement;
    private priestessButton!: HTMLButtonElement;
    private footballButton!: HTMLButtonElement;
    private gamblerButton!: HTMLButtonElement;
    private athleteButton!: HTMLButtonElement;
    private gourmandButton!: HTMLButtonElement;
    private volleyballButton!: HTMLButtonElement;
    private stonerButton!: HTMLButtonElement;
    private confirmButton!: HTMLButtonElement;
    private errorText!: Phaser.GameObjects.Text;
    private optionsUI!: OptionsUI;
    private curseUI!: CurseUI;
    
    // New UI elements for Bestiary and Achievements
    private bestiaryButton!: HTMLButtonElement;
    //private achievementsButton!: HTMLButtonElement;

    // Add status text for game state
    private statusText!: Phaser.GameObjects.Text;
    private statusBackground!: Phaser.GameObjects.Rectangle;
    private statusContainer!: Phaser.GameObjects.Container;
    
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
        // Load character class icons (these should already be loaded by LoadingScene, but ensure they're available)
        this.load.image('fighter_icon', '/assets/attack_sword.png');
        this.load.image('rogue_icon', '/assets/attack_knife.png');
        this.load.image('mage_icon', '/assets/attack_wand.png');
        this.load.image('paladin_icon', '/assets/attack_shield.png');
        this.load.image('valkyrie_icon', '/assets/attack_horn.png');
        this.load.image('priestess_icon', '/assets/attack_staff.png');
        this.load.image('title_bg', '/assets/title_bg.png');
        
        // Load new class icons
        this.load.image('football_icon', '/assets/attack_football.png');
        this.load.image('gambler_icon', '/assets/attack_cards.png');
        this.load.image('athlete_icon', '/assets/attack_dumbbell.png');
        this.load.image('gourmand_icon', '/assets/attack_garlic.png');
        this.load.image('volleyball_icon', '/assets/attack_volleyball.png');
        this.load.image('stoner_icon', '/assets/attack_joint.png');

        // Load new Valkyrie class sprite
        this.load.image('player_valkyrie', '/assets/class_valkyrie_1.png');
        
        // Load Priest class sprite
        this.load.image('player_priest', '/assets/class_priest_1.png');
        
        // Load new Thunder Horn attack assets
        this.load.image('attack_horn', '/assets/attack_horn.png');
        this.load.image('attack_lightning', '/assets/attack_lightning.png');
        
        // Load thunder sound effect
        this.load.audio('thunder', '/assets/sounds/thunder.mp3');
        
        // Load assets for options menu
        this.load.image('icon_music', '/assets/icon_music.png');
        this.load.image('icon_sound', '/assets/icon_sound.png');
        
        // Load Curse UI assets
        this.load.image('curse_card', '/assets/curse_card.png');
        
        // Add load completion listener to ensure assets are ready
        this.load.on('complete', () => {
            console.log('ClassSelectScene: All assets loaded successfully');
        });
        
        this.load.on('loaderror', (fileObj: any) => {
            console.error('ClassSelectScene: Error loading asset:', fileObj.key, fileObj.url);
        });
    }

    create() {
        console.log("ClassSelectScene create() started - ensuring clean transition");
        
        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
            // Play voice class cue when entering class select
            soundManager.playSound('voice_class', 0.9);
        }
        
        // Initialize music manager
        this.musicManager = new MusicManager(this);
        this.musicManager.playTrack('title');
        
        // IMPORTANT: Ensure any previous scenes are fully stopped
        // This is critical when transitioning from GameScene -> DeadScene -> ClassSelectScene
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.scene.isActive()) {
            console.log("ClassSelectScene: Stopping GameScene to prevent visual artifacts");
            this.scene.stop('GameScene');
        }
        
        const deadScene = this.scene.get('DeadScene');
        if (deadScene && deadScene.scene.isActive()) {
            console.log("ClassSelectScene: Stopping DeadScene");
            this.scene.stop('DeadScene');
        }
        
        // Set up background with explicit clearing
        const { width, height } = this.scale;
        
        // Clear the camera and set a solid background color first
        this.cameras.main.setBackgroundColor('#042E64');
        this.cameras.main.fadeIn(0); // Ensure immediate visibility
        
        // Clear any existing display objects
        this.children.removeAll(true);
        
        // Add a full-screen rectangle to ensure complete background coverage
        const backgroundRect = this.add.rectangle(width/2, height/2, width, height, 0x042E64);
        backgroundRect.setDepth(-100); // Ensure it's behind everything
        backgroundRect.setName('backgroundRect');
        
        // Create status container at the top of the screen
        this.createStatusUI();

        try {
            if (this.textures.exists('title_bg')) {
                const bgImage = this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(-50) // Behind UI elements but in front of background rect
                    .setName('title_bg');
                console.log("ClassSelectScene: Background image loaded successfully");
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Calculate responsive font sizes based on screen dimensions
        const baseTitleSize = Math.min(width * RESPONSIVE_CONFIG.TITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.TITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_TITLE_SIZE);
        const baseSubtitleSize = Math.min(width * RESPONSIVE_CONFIG.SUBTITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.SUBTITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_SUBTITLE_SIZE);
        console.log(`ClassSelectScene: Responsive text sizing - Title: ${baseTitleSize}px, Subtitle: ${baseSubtitleSize}px for screen ${width}x${height}`);
        
        // Add title
        this.titleText = this.add.text(width/2, height/4, 'SELECT YOUR CLASS', {
            fontFamily: 'Arial Black',
            fontSize: `${baseTitleSize}px`,
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH_TITLE, baseTitleSize / 8)
        }).setOrigin(0.5).setName('titleText');
        
        // Add subtitle
        this.subtitleText = this.add.text(width/2, height/4 + Math.max(RESPONSIVE_CONFIG.MIN_SUBTITLE_Y_OFFSET, height * RESPONSIVE_CONFIG.SUBTITLE_Y_OFFSET), 'Choose wisely, brave survivor...', {
            fontFamily: 'Arial',
            fontSize: `${baseSubtitleSize}px`,
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH_SUBTITLE, baseSubtitleSize / 8)
        }).setOrigin(0.5).setName('subtitleText');
        
        // Wait for assets to be fully loaded before creating HTML elements
        if (this.load.isLoading()) {
            console.log('ClassSelectScene: Assets still loading, waiting for completion');
            this.load.once('complete', () => {
                this.createClassButtons();
                this.positionHTMLElements(); // Position after creation
            });
        } else {
            console.log('ClassSelectScene: Assets already loaded, creating buttons immediately');
            // Small delay to ensure textures are registered
            this.time.delayedCall(50, () => {
                this.createClassButtons();
                this.positionHTMLElements(); // Position after creation
            });
        }
        
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
        
        // Position HTML elements - REMOVED from here since buttons don't exist yet
        
        // Initialize options UI
        this.optionsUI = new OptionsUI(this);
        
        // Initialize Curse UI for curse display and management
        this.curseUI = new CurseUI(this, this.spacetimeDBClient);
        
        // Handle options toggle key
        this.input.keyboard?.on('keydown-O', () => {
            this.optionsUI.toggle();
        });
        
        // Handle debug key to test curse victory screen (C key)
        this.input.keyboard?.on('keydown-C', () => {
            this.launchCurseVictoryScreenDebug();
        });

        // Handle debug key to add random curse (X key)
        this.input.keyboard?.on('keydown-X', () => {
            this.addRandomCurseDebug();
        });

        // Handle debug key to clear all curses (Z key)
        this.input.keyboard?.on('keydown-Z', () => {
            this.clearAllCursesDebug();
        });

        // Handle debug key to add debug curse (V key)
        this.input.keyboard?.on('keydown-V', () => {
            this.addDebugCurseDebug();
        });
        
        // Only clean up when the scene is actually shut down
        this.events.on('shutdown', this.shutdown, this);
        
        console.log("ClassSelectScene create() completed");
    }
    
    private createClassButtons() {
        // Remove any existing elements
        const existingContainer = document.getElementById('class-select-container');
        if (existingContainer) existingContainer.remove();
        
        // Create class selection container with grid layout
        this.classButtonsContainer = document.createElement('div');
        this.classButtonsContainer.id = 'class-select-container';
        this.classButtonsContainer.style.position = 'absolute';
        this.classButtonsContainer.style.display = 'grid';
        this.classButtonsContainer.style.gridTemplateColumns = isMobileDevice() ? '1fr 1fr' : '1fr 1fr 1fr'; // 2 columns for mobile, 3 for desktop
        this.classButtonsContainer.style.gridGap = isMobileDevice() ? '10px' : '20px';
        this.classButtonsContainer.style.justifyItems = 'center';
        this.classButtonsContainer.style.alignItems = 'center';
        document.body.appendChild(this.classButtonsContainer);
        
        const createClassButton = (name: string, classType: PlayerClass, iconName: string) => {
            const button = document.createElement('button');
            button.className = 'class-select-button';
            button.style.position = 'relative';
            const isMobile = isMobileDevice();
            button.style.width = isMobile ? '150px' : '250px';
            button.style.height = isMobile ? '60px' : '70px';
            button.style.padding = '10px';
            button.style.margin = '5px';
            button.style.backgroundColor = '#2c3e50';
            button.style.color = 'white';
            button.style.border = '2px solid #34495e';
            button.style.borderRadius = '5px';
            button.style.cursor = 'pointer';
            button.style.fontFamily = 'Arial';
            button.style.fontSize = isMobile ? '14px' : '18px';
            button.style.textAlign = 'center';
            button.style.transition = 'background-color 0.2s, border-color 0.2s';
            button.style.display = 'flex';
            button.style.alignItems = 'center';
            
            // Add icon if available
            try {
                const iconTexture = CLASS_ICON_MAP[iconName];
                console.log(`ClassSelectScene: Checking icon for ${name}, iconName: ${iconName}, texture: ${iconTexture}`);
                
                if (this.textures.exists(iconName) && iconTexture) {
                    // Wait a bit for texture to be fully processed
                    const leftIcon = document.createElement('img');
                    leftIcon.src = '/assets/' + iconTexture + '.png';
                    leftIcon.style.width = isMobile ? '30px' : '50px';
                    leftIcon.style.height = isMobile ? '30px' : '50px';
                    leftIcon.style.marginRight = '10px';
                    
                    // Add load event to ensure image displays
                    leftIcon.onload = () => {
                        console.log(`ClassSelectScene: Icon loaded successfully for ${name}`);
                    };
                    
                    leftIcon.onerror = () => {
                        console.error(`ClassSelectScene: Error loading icon for ${name}: ${leftIcon.src}`);
                    };
                    
                    button.appendChild(leftIcon);
                } else {
                    console.warn(`ClassSelectScene: Icon texture not available for ${name} (${iconName})`);
                }
            } catch (error) {
                console.error(`Error adding left icon for ${name}:`, error);
            }
            
            // Add text
            const textSpan = document.createElement('span');
            textSpan.textContent = name;
            textSpan.style.position = 'absolute';
            textSpan.style.left = '10px';
            textSpan.style.right = '0';
            textSpan.style.textAlign = 'center';
            button.appendChild(textSpan);
            
            // Add selection circle on the right
            const selectionCircle = document.createElement('div');
            selectionCircle.className = 'selection-circle';
            selectionCircle.style.width = '20px';
            selectionCircle.style.height = '20px';
            selectionCircle.style.borderRadius = '50%';
            selectionCircle.style.border = '2px solid #34495e';
            selectionCircle.style.backgroundColor = 'transparent';
            selectionCircle.style.position = 'absolute';
            selectionCircle.style.right = '15px';
            selectionCircle.style.top = '50%';
            selectionCircle.style.transform = 'translateY(-50%)';
            selectionCircle.style.transition = 'background-color 0.2s';
            button.appendChild(selectionCircle);
            
            // Add event listener
            button.addEventListener('click', () => {
                this.selectClass(classType, button);
            });
            
            // Add hover effects
            button.addEventListener('mouseenter', () => {
                if (button.style.backgroundColor !== 'rgb(52, 152, 219)') { // Not selected (selected color is #3498db)
                    button.style.backgroundColor = '#34495e';
                    button.style.borderColor = '#4a6074';
                    // Fill the selection circle on hover
                    const circle = button.querySelector('.selection-circle') as HTMLElement;
                    if (circle) {
                        circle.style.backgroundColor = '#5a6c7d';
                        circle.style.borderColor = '#6a7a8a';
                    }
                }
            });
            
            button.addEventListener('mouseleave', () => {
                if (button.style.backgroundColor !== 'rgb(52, 152, 219)') { // Not selected
                    button.style.backgroundColor = '#2c3e50';
                    button.style.borderColor = '#34495e';
                    // Clear the selection circle on mouse leave
                    const circle = button.querySelector('.selection-circle') as HTMLElement;
                    if (circle) {
                        circle.style.backgroundColor = 'transparent';
                        circle.style.borderColor = '#34495e';
                    }
                }
            });
            
            return button;
        };
        
        // Create all class buttons using the correct PlayerClass types
        this.fighterButton = createClassButton('Til', PlayerClass.Fighter as PlayerClass, 'fighter_icon');
        this.rogueButton = createClassButton('Marc', PlayerClass.Rogue as PlayerClass, 'rogue_icon');
        this.mageButton = createClassButton('Max', PlayerClass.Mage as PlayerClass, 'mage_icon');
        this.paladinButton = createClassButton('Chris', PlayerClass.Paladin as PlayerClass, 'paladin_icon');
        this.valkyrieButton = createClassButton('Gwen', PlayerClass.Valkyrie as PlayerClass, 'valkyrie_icon');
        this.priestessButton = createClassButton('Enno', PlayerClass.Priest as PlayerClass, 'priestess_icon');
        this.footballButton = createClassButton('Football Til', PlayerClass.Football as PlayerClass, 'football_icon');
        this.gamblerButton = createClassButton('Yu-Gi-Oh Marc', PlayerClass.Gambler as PlayerClass, 'gambler_icon');
        this.athleteButton = createClassButton('Gym Max', PlayerClass.Athlete as PlayerClass, 'athlete_icon');
        this.gourmandButton = createClassButton('Chef Chris', PlayerClass.Gourmand as PlayerClass, 'gourmand_icon');
        this.volleyballButton = createClassButton('Volleyball Gwen', PlayerClass.Volleyball as PlayerClass, 'volleyball_icon');
        this.stonerButton = createClassButton('Stoner Enno', PlayerClass.Stoner as PlayerClass, 'stoner_icon');
        
        // Add buttons to container in the desired order
        this.classButtonsContainer.appendChild(this.fighterButton);
        this.classButtonsContainer.appendChild(this.footballButton);
        this.classButtonsContainer.appendChild(this.rogueButton);
        this.classButtonsContainer.appendChild(this.gamblerButton);
        this.classButtonsContainer.appendChild(this.mageButton);
        this.classButtonsContainer.appendChild(this.athleteButton);
        this.classButtonsContainer.appendChild(this.paladinButton);
        this.classButtonsContainer.appendChild(this.gourmandButton);
        this.classButtonsContainer.appendChild(this.valkyrieButton);
        this.classButtonsContainer.appendChild(this.volleyballButton);
        this.classButtonsContainer.appendChild(this.priestessButton);
        this.classButtonsContainer.appendChild(this.stonerButton);
        
        // Create a separate container for the confirm button to keep it below the grid
        const confirmContainer = document.createElement('div');
        confirmContainer.style.gridColumn = '1 / -1'; // Span across all columns
        confirmContainer.style.display = 'flex';
        confirmContainer.style.justifyContent = 'center';
        confirmContainer.style.marginTop = '20px';
        
        // Add confirm button
        this.confirmButton = document.createElement('button');
        this.confirmButton.textContent = 'Confirm Selection';
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
        
        // Add hover effects to confirm button
        this.confirmButton.addEventListener('mouseenter', () => {
            if (!this.confirmButton.disabled) {
                this.confirmButton.style.backgroundColor = '#2ecc71';
            }
        });
        
        this.confirmButton.addEventListener('mouseleave', () => {
            if (!this.confirmButton.disabled) {
                this.confirmButton.style.backgroundColor = '#27ae60';
            }
        });
        
        confirmContainer.appendChild(this.confirmButton);
        this.classButtonsContainer.appendChild(confirmContainer);
        
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
        bestiaryButton.textContent = '🐺 Bestiary';
        
        bestiaryButton.addEventListener('mouseover', () => {
            bestiaryButton.style.backgroundColor = '#3498db';
            bestiaryButton.style.borderColor = '#2980b9';
        });
        
        bestiaryButton.addEventListener('mouseout', () => {
            bestiaryButton.style.backgroundColor = '#2c3e50';
            bestiaryButton.style.borderColor = '#34495e';
        });
        
        bestiaryButton.addEventListener('click', () => {
            this.showBestiary();
        });
        
        document.body.appendChild(bestiaryButton);
        this.bestiaryButton = bestiaryButton;
        console.log(`ClassSelectScene: Class buttons created successfully with ${isMobileDevice() ? '2-column' : '3-column'} layout`);
    }
    
    private positionHTMLElements() {
        // Add null check to prevent crashes
        if (!this.classButtonsContainer) {
            console.warn('ClassSelectScene: Cannot position HTML elements - classButtonsContainer not created yet');
            return;
        }
        
        const { width, height } = this.scale;
        
        // Position class select container - adjust for grid layout
        const containerWidth = isMobileDevice() ? 320 : 810; // Width for 2 vs 3 columns
        this.classButtonsContainer.style.left = `${width / 2 - containerWidth / 2}px`;
        this.classButtonsContainer.style.top = `${height / 2 - (isMobileDevice() ? 200 : 120)}px`;
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        console.log(`ClassSelectScene: Handling resize to ${width}x${height}`);
        
        // Update background rectangle
        const backgroundRect = this.children.getByName('backgroundRect') as Phaser.GameObjects.Rectangle;
        if (backgroundRect) {
            backgroundRect.setPosition(width/2, height/2);
            backgroundRect.setSize(width, height);
        }
        
        // Update background image
        const backgroundImage = this.children.getByName('title_bg') as Phaser.GameObjects.Image;
        if (backgroundImage) {
            backgroundImage.setPosition(width/2, height/2);
            backgroundImage.setDisplaySize(width, height);
            console.log(`ClassSelectScene: Updated background image to ${width}x${height}`);
        }
        
        // Update title text position and size
        if (this.titleText) {
            const baseTitleSize = Math.min(width * RESPONSIVE_CONFIG.TITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.TITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_TITLE_SIZE);
            this.titleText.setPosition(width/2, height/4);
            this.titleText.setFontSize(baseTitleSize);
            this.titleText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH_TITLE, baseTitleSize / 8));
            console.log(`ClassSelectScene: Updated title text - size: ${baseTitleSize}px, position: (${width/2}, ${height/4})`);
        }
        
        // Update subtitle text position and size
        if (this.subtitleText) {
            const baseSubtitleSize = Math.min(width * RESPONSIVE_CONFIG.SUBTITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.SUBTITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_SUBTITLE_SIZE);
            const subtitleY = height/4 + Math.max(RESPONSIVE_CONFIG.MIN_SUBTITLE_Y_OFFSET, height * RESPONSIVE_CONFIG.SUBTITLE_Y_OFFSET);
            this.subtitleText.setPosition(width/2, subtitleY);
            this.subtitleText.setFontSize(baseSubtitleSize);
            this.subtitleText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH_SUBTITLE, baseSubtitleSize / 8));
            console.log(`ClassSelectScene: Updated subtitle text - size: ${baseSubtitleSize}px, position: (${width/2}, ${subtitleY})`);
        }
        
        // Update error text position
        if (this.errorText) {
            this.errorText.setPosition(width/2, height * 0.85);
        }
        
        // Update class button layout if device type changes
        if (this.classButtonsContainer) {
            this.classButtonsContainer.style.gridTemplateColumns = isMobileDevice() ? '1fr 1fr' : '1fr 1fr 1fr';
        }

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
        [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton, this.valkyrieButton, this.priestessButton, this.footballButton, this.gamblerButton, this.athleteButton, this.gourmandButton, this.volleyballButton, this.stonerButton].forEach(btn => {
            if (btn) {
                btn.style.backgroundColor = '#2c3e50';
                btn.style.borderColor = '#34495e';
                // Reset all selection circles
                const circle = btn.querySelector('.selection-circle') as HTMLElement;
                if (circle) {
                    circle.style.backgroundColor = 'transparent';
                    circle.style.borderColor = '#34495e';
                }
            }
        });
        
        // Highlight selected button
        button.style.backgroundColor = '#3498db';
        button.style.borderColor = '#2980b9';
        
        // Update selected button's circle to match blue theme
        const selectedCircle = button.querySelector('.selection-circle') as HTMLElement;
        if (selectedCircle) {
            selectedCircle.style.backgroundColor = '#5dade2';
            selectedCircle.style.borderColor = '#3498db';
        }
        
        // Set selected class
        this.selectedClass = classType;
        console.log(`Selected class: ${classType.tag}`);
        
        // Play choose sound effect for confirming character (was incorrectly trying to play 'select')
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.playSound('choose', 0.8);
        }
        
        // Show confirm button
        this.confirmButton.style.display = 'block';
        
        // Hide any error message
        this.errorText.setVisible(false);
        
        // Show Bestiary and Achievements buttons
        this.bestiaryButton.style.display = 'inline-block';
    }
    
    private spawnPlayer() {
        if (!this.selectedClass) {
            this.showError('Please select a class first');
            return;
        }
        
        console.log("ClassSelectScene: Starting spawnPlayer");
        
        // Play choose sound effect for confirming character (was incorrectly trying to play 'select')
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.playSound('choose', 0.8);
        }
        
        // Disable buttons to prevent double-clicking
        this.confirmButton.disabled = true;
        this.confirmButton.textContent = 'Creating...';
        
        [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton, this.valkyrieButton, this.priestessButton, this.footballButton, this.gamblerButton, this.athleteButton, this.gourmandButton, this.volleyballButton, this.stonerButton].forEach(btn => {
            if (btn) btn.disabled = true;
        });
        
        // Hide Bestiary and Achievements buttons during player spawn
        this.bestiaryButton.style.display = 'none';
        
        // Add a small delay to let the sound start before scene transition
        this.time.delayedCall(200, () => {
            // Check current account state before spawning
            if (this.spacetimeDBClient.sdkConnection?.db && this.spacetimeDBClient.identity) {
                const currentAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
                if (currentAccount) {
                    console.log("ClassSelectScene: Current account state:", currentAccount.state.tag);
                    console.log("ClassSelectScene: Current player ID:", currentAccount.currentPlayerId);
                    console.log("ClassSelectScene: Account name:", currentAccount.name);
                }
            }
            
            try {
                if (this.spacetimeDBClient.sdkConnection?.reducers) {
                    // Check if selectedClass is still valid
                    if (!this.selectedClass) {
                        this.showError('Please select a class first');
                        this.resetButtons();
                        return;
                    }
                    
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
        });
    }
    
    private resetButtons() {
        this.confirmButton.disabled = false;
        this.confirmButton.textContent = 'Confirm Selection';
        
        [this.fighterButton, this.rogueButton, this.mageButton, this.paladinButton, this.valkyrieButton, this.priestessButton, this.footballButton, this.gamblerButton, this.athleteButton, this.gourmandButton, this.volleyballButton, this.stonerButton].forEach(btn => {
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
            
            if (this.bestiaryButton) {
                this.bestiaryButton.remove();
            }

            // Method 4: Look for any buttons that might be ours
            document.querySelectorAll('button').forEach(el => {
                if ((el as HTMLElement).textContent?.includes('Fighter') || 
                    (el as HTMLElement).textContent?.includes('Rogue') ||
                    (el as HTMLElement).textContent?.includes('Mage') ||
                    (el as HTMLElement).textContent?.includes('Paladin') ||
                    (el as HTMLElement).textContent?.includes('Valkyrie') ||
                    (el as HTMLElement).textContent?.includes('Priestess') ||
                    (el as HTMLElement).textContent?.includes('Football') ||
                    (el as HTMLElement).textContent?.includes('Gambler') ||
                    (el as HTMLElement).textContent?.includes('Athlete') ||
                    (el as HTMLElement).textContent?.includes('Gourmand') ||
                    (el as HTMLElement).textContent?.includes('Volleyball') ||
                    (el as HTMLElement).textContent?.includes('Stoner') ||
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
    
    private createStatusUI() {
        // Create container for status UI
        this.statusContainer = this.add.container(0, 0);
        this.statusContainer.setDepth(1000); // High depth to stay on top

        // Create background for status text
        this.statusBackground = this.add.rectangle(0, 0, 300, 40, 0x000000, 0.7);
        this.statusBackground.setStrokeStyle(2, 0x444444);
        this.statusBackground.setOrigin(0.5, 0.5);

        // Create status text
        this.statusText = this.add.text(0, 0, "", {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
            align: 'center'
        });
        this.statusText.setOrigin(0.5, 0.5);

        // Add elements to container
        this.statusContainer.add([this.statusBackground, this.statusText]);

        // Position at top center of screen
        const camera = this.cameras.main;
        if (camera) {
            this.statusContainer.setPosition(
                camera.scrollX + camera.width / 2,
                camera.scrollY + 40
            );
        }

        // Add update callback to scene
        this.events.on('update', this.updateStatus, this);
    }

    private updateStatus() {
        if (!this.spacetimeDBClient.sdkConnection?.db) return;

        const gameState = this.spacetimeDBClient.sdkConnection.db.gameState.id.find(0);
        if (!gameState) {
            this.statusContainer.setVisible(false);
            return;
        }

        // Check if boss is active
        if (gameState.bossActive) {
            this.statusText.setText("Boss Fight in Progress");
            this.statusContainer.setVisible(true);
            return;
        }

        // Check for boss spawn timer
        const bossTimers = Array.from(this.spacetimeDBClient.sdkConnection.db.bossSpawnTimer.iter());
        if (bossTimers.length > 0) {
            const now = Date.now();
            const timestamp = this.extractTimestampFromTimer(bossTimers[0]);
            if (timestamp) {
                const timeRemaining = Math.max(0, (timestamp - now) / 1000); // Convert to seconds
                const minutes = Math.floor(timeRemaining / 60);
                const seconds = Math.floor(timeRemaining % 60);
                
                if (timeRemaining > 0) {
                    this.statusText.setText(`Run in Progress: ${minutes}:${seconds.toString().padStart(2, '0')}`);
                    this.statusContainer.setVisible(true);
                    return;
                }
            }
        }

        // No active game state to show
        this.statusContainer.setVisible(false);
    }

    private extractTimestampFromTimer(timer: any): number | null {
        try {
            // First check if we have a scheduledAt property
            if (!timer || !timer.scheduledAt) {
                return null;
            }
            
            // Handle scheduledAt property based on its type
            const scheduledAt = timer.scheduledAt;
            
            // If scheduled_at has a microsSinceUnixEpoch property (common timestamp format)
            if (scheduledAt.microsSinceUnixEpoch !== undefined) {
                // Convert microseconds to milliseconds for JS Date
                const microsValue = scheduledAt.microsSinceUnixEpoch;
                if (typeof microsValue === 'bigint') {
                    return Number(microsValue) / 1000;
                } else if (typeof microsValue === 'number') {
                    return microsValue / 1000;
                }
            }
            
            // If it has a time_ms field
            if (scheduledAt.timeMs !== undefined) {
                return typeof scheduledAt.timeMs === 'bigint' 
                    ? Number(scheduledAt.timeMs) 
                    : scheduledAt.timeMs;
            }
            
            // If it's a structured object with tag and value
            if (typeof scheduledAt === 'object' && scheduledAt.tag && scheduledAt.value) {
                if (scheduledAt.tag === 'Time') {
                    const timeValue = scheduledAt.value;
                    
                    // Direct BigInt handling
                    if (typeof timeValue === 'bigint') {
                        return Number(timeValue) / 1000;
                    }
                    
                    // Handle case where value is a string (could be with or without 'n')
                    if (typeof timeValue === 'string') {
                        // Check if it's a BigInt string (ends with 'n')
                        if (timeValue.endsWith('n')) {
                            // Remove the 'n' suffix and convert to number
                            const valueWithoutN = timeValue.slice(0, -1);
                            // This is microseconds since epoch, convert to ms
                            return Number(valueWithoutN) / 1000;
                        } else {
                            // It's a regular string number, convert directly
                            return Number(timeValue) / 1000;
                        }
                    }
                    
                    // Check for microsSinceUnixEpoch in the value
                    if (timeValue && typeof timeValue === 'object' && timeValue.microsSinceUnixEpoch !== undefined) {
                        const microsValue = timeValue.microsSinceUnixEpoch;
                        if (typeof microsValue === 'bigint') {
                            return Number(microsValue) / 1000;
                        } else if (typeof microsValue === 'number') {
                            return microsValue / 1000;
                        }
                    }
                    
                    // Check for timeMs in the value
                    if (timeValue && typeof timeValue === 'object' && timeValue.timeMs !== undefined) {
                        return typeof timeValue.timeMs === 'bigint' 
                            ? Number(timeValue.timeMs) 
                            : timeValue.timeMs;
                    }

                    // Try direct conversion as a fallback
                    if (timeValue) {
                        const timestamp = Number(timeValue);
                        if (!isNaN(timestamp) && timestamp > 0) {
                            return timestamp / 1000; // Convert microseconds to milliseconds
                        }
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error("Error extracting timestamp:", error);
            return null;
        }
    }

    private launchCurseVictoryScreenDebug() {
        console.log("ClassSelectScene: Debug command - launching CurseVictoryScene for testing");
        
        // Start the CurseVictoryScene for testing
        this.scene.start('CurseVictoryScene');
    }

    private addRandomCurseDebug() {
        console.log("ClassSelectScene: Debug command - adding random curse via admin reducer");
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log("ClassSelectScene: Calling adminAddCurse reducer");
                this.spacetimeDBClient.sdkConnection.reducers.adminAddCurse();
                console.log("ClassSelectScene: adminAddCurse reducer call completed successfully");
                
                // Play a sound effect to confirm the command was executed
                const soundManager = (window as any).soundManager;
                if (soundManager) {
                    soundManager.playSound('curse_created', 0.8);
                }
            } else {
                console.error("ClassSelectScene: Cannot add curse - no reducers available");
                this.showError('Cannot add curse: Server connection not available');
            }
        } catch (error) {
            console.error('ClassSelectScene: Error calling adminAddCurse reducer:', error);
            this.showError('Error adding curse: ' + (error as Error).message);
        }
    }

    private clearAllCursesDebug() {
        console.log("ClassSelectScene: Debug command - clearing all curses via admin reducer");
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log("ClassSelectScene: Calling adminClearCurses reducer");
                this.spacetimeDBClient.sdkConnection.reducers.adminClearCurses();
                console.log("ClassSelectScene: adminClearCurses reducer call completed successfully");
                
                // Play a different sound effect to confirm curses were cleared
                const soundManager = (window as any).soundManager;
                if (soundManager) {
                    soundManager.playSound('spell_cast', 0.8);
                }
            } else {
                console.error("ClassSelectScene: Cannot clear curses - no reducers available");
                this.showError('Cannot clear curses: Server connection not available');
            }
        } catch (error) {
            console.error('ClassSelectScene: Error calling adminClearCurses reducer:', error);
            this.showError('Error clearing curses: ' + (error as Error).message);
        }
    }

    private addDebugCurseDebug() {
        console.log("ClassSelectScene: Debug command - adding debug curse via admin reducer");
        
        try {
            if (this.spacetimeDBClient.sdkConnection?.reducers) {
                console.log("ClassSelectScene: Calling adminAddDebugCurse reducer");
                this.spacetimeDBClient.sdkConnection.reducers.adminAddDebugCurse();
                console.log("ClassSelectScene: adminAddDebugCurse reducer call completed successfully");
                
                // Play a sound effect to confirm the command was executed
                const soundManager = (window as any).soundManager;
                if (soundManager) {
                    soundManager.playSound('curse_created', 0.8);
                }
            } else {
                console.error("ClassSelectScene: Cannot add debug curse - no reducers available");
                this.showError('Cannot add debug curse: Server connection not available');
            }
        } catch (error) {
            console.error('ClassSelectScene: Error calling adminAddDebugCurse reducer:', error);
            this.showError('Error adding debug curse: ' + (error as Error).message);
        }
    }

    shutdown() {
        console.log("ClassSelectScene shutdown called");
        
        // Cleanup options UI
        if (this.optionsUI) {
            this.optionsUI.destroy();
        }
        
        // Cleanup curse UI
        if (this.curseUI) {
            this.curseUI.destroy();
        }
        
        // Cleanup music manager
        if (this.musicManager) {
            this.musicManager.cleanup();
        }
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Remove keyboard listeners
        if (this.input.keyboard) {
            this.input.keyboard.off('keydown-O'); // Options toggle key
            this.input.keyboard.off('keydown-C'); // Debug curse victory screen key
            this.input.keyboard.off('keydown-X'); // Debug add curse key
            this.input.keyboard.off('keydown-Z'); // Debug clear curses key
            this.input.keyboard.off('keydown-V'); // Debug add debug curse key
        }
        
        // Use our dedicated cleanup method
        this.cleanupHTMLElements();
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        // Remove update callback
        this.events.off('update', this.updateStatus, this);
    }

    private showBestiary() {
        // Play button click sound
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.playSound('ui_click', 0.7);
        }
        this.scene.start('BestaryScene', { spacetimeDBClient: this.spacetimeDBClient });
    }
}