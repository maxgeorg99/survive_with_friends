import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';

// Curse name mapping dictionary for display
const CURSE_NAMES: { [key: string]: string } = {
    // Monster enhancements
    'MonsterMoreHp': 'Monstrous Vitality',
    'MonsterMoreDamage': 'Savage Beasts',
    'MonsterMoreSpeed': 'Swift Predators',
    'MonsterHealthRegen': 'Regenerating Horrors',
    'CursedMonstersSpawn': 'Cursed Spawns',
    
    // Player restrictions
    'NoFreeReroll': 'No Free Choices',
    'NoHealOnLevelUp': 'Weakened Growth',
    'NegativeHealthRegen': 'Withering Curse',
    'PlayersStartLessHp': 'Fragile Beginning',
    'PlayersStartLessSpeed': 'Sluggish Start',
    
    // Loot restrictions
    'NoDiceDrops': 'Dice Drought',
    'NoFoodDrops': 'Food Famine',
    'NoBoosterPackDrops': 'Pack Prohibition',
    'NoStructureLoot': 'Barren Structures',
    'OneLessVoidChest': 'Void Scarcity',
    'OneLessVoidChestSecond': 'Greater Void Scarcity',
    'MonstersDropFewerGems': 'Meager Rewards',
    
    // Game progression
    'BossAppearsSooner': 'Hastened Doom',
    'DeadlierBosses': 'Empowered Bosses',
    'DeadlierBossesTwo': 'Supremely Deadly Bosses',
    
    // Scaling curse
    'Scaling': 'Endless Suffering'
};

// Roman numeral mapping
const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 
                        'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

export default class CurseUI {
    protected scene: Phaser.Scene;
    protected spaceTimeClient: SpacetimeDBClient;
    
    // UI Elements
    protected curseCard!: Phaser.GameObjects.Image;
    protected curseCountText!: Phaser.GameObjects.Text;
    protected cursesMenuContainer!: Phaser.GameObjects.Container;
    
    // State
    protected isMenuVisible: boolean = false;
    protected activeCurses: any[] = [];

    constructor(scene: Phaser.Scene, spaceTimeClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spaceTimeClient = spaceTimeClient;
        
        this.createUI();
        this.setupCurseSubscription();
    }

    protected createUI(): void {
        // Create curse card in top-right corner
        const cardX = this.scene.scale.width - 80;
        const cardY = 80;
        
        this.curseCard = this.scene.add.image(cardX, cardY, 'curse_card');
        this.curseCard.setScale(0.3); // Scale down to reasonable size
        this.curseCard.setScrollFactor(0); // Fixed position on screen
        this.curseCard.setDepth(100000); // Very high priority
        this.curseCard.setVisible(false); // Initially hidden
        this.curseCard.setInteractive(); // Make clickable
        
        // Create curse count text (Roman numerals)
        this.curseCountText = this.scene.add.text(cardX, cardY, '', {
            fontSize: '24px',
            color: '#ffffff',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 2
        });
        this.curseCountText.setOrigin(0.5, 0.5);
        this.curseCountText.setScrollFactor(0);
        this.curseCountText.setDepth(100001); // Above the card
        this.curseCountText.setVisible(false);
        
        // Create curse details menu (initially hidden)
        this.createCursesMenu();
        
        // Handle curse card click
        this.curseCard.on('pointerdown', () => {
            this.toggleCursesMenu();
        });
    }

    protected createCursesMenu(): void {
        // Position menu on the right side of screen instead of center
        const menuX = this.scene.scale.width - 200; // Right side positioning
        const menuY = this.scene.scale.height / 2;
        
        this.cursesMenuContainer = this.scene.add.container(menuX, menuY);
        this.cursesMenuContainer.setScrollFactor(0);
        this.cursesMenuContainer.setDepth(100002); // Above everything
        this.cursesMenuContainer.setVisible(false);
        
        // Create background
        const menuBg = this.scene.add.rectangle(0, 0, 400, 500, 0x000000, 0.9);
        menuBg.setStrokeStyle(3, 0xff0000, 1.0); // Red border for curse theme
        
        // Create title
        const titleText = this.scene.add.text(0, -220, 'Active Curses', {
            fontSize: '24px',
            color: '#ffffff',
            fontStyle: 'bold'
        });
        titleText.setOrigin(0.5, 0.5);
        
        // Create close button using same pattern as OptionsUI
        const closeButton = this.scene.add.text(150, -220, 'Close', {
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold',
            backgroundColor: '#666666',
            padding: { x: 12, y: 6 }
        });
        closeButton.setOrigin(0.5, 0.5);
        closeButton.setScrollFactor(0);
        closeButton.setInteractive({ useHandCursor: true });
        
        // Add hover effects like OptionsUI
        closeButton.on('pointerover', () => {
            closeButton.setBackgroundColor('#888888');
        });
        
        closeButton.on('pointerout', () => {
            closeButton.setBackgroundColor('#666666');
        });
        
        // Close menu when clicked
        closeButton.on('pointerdown', () => {
            // Play sound effect like OptionsUI
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
            
            this.hideCursesMenu();
        });
        
        // Add to container
        this.cursesMenuContainer.add([menuBg, titleText, closeButton]);
    }

    protected setupCurseSubscription(): void {
        // Wait for SpacetimeDB connection to be established
        const checkConnection = () => {
            if (this.spaceTimeClient.isConnected && this.spaceTimeClient.sdkConnection) {
                try {
                    // Subscribe to curses table events
                    // @ts-ignore - Handle potential binding issues
                    if (this.spaceTimeClient.sdkConnection.db.curses) {
                        // @ts-ignore
                        this.spaceTimeClient.sdkConnection.db.curses.onInsert((ctx: any, curse: any) => {
                            console.log('Curse added:', curse);
                            this.updateCursesDisplay();
                        });
                        
                        // @ts-ignore
                        this.spaceTimeClient.sdkConnection.db.curses.onDelete((ctx: any, curse: any) => {
                            console.log('Curse removed:', curse);
                            this.updateCursesDisplay();
                        });
                        
                        console.log('Successfully subscribed to curses table');
                        this.updateCursesDisplay(); // Initial update
                    }
                } catch (e) {
                    console.warn('Could not subscribe to curses table - may not be in bindings yet:', e);
                    // Retry in 1 second
                    setTimeout(checkConnection, 1000);
                }
            } else {
                // Retry in 500ms
                setTimeout(checkConnection, 500);
            }
        };
        
        checkConnection();
    }

    protected updateCursesDisplay(): void {
        if (!this.spaceTimeClient.isConnected || !this.spaceTimeClient.sdkConnection) {
            return;
        }
        
        try {
            // @ts-ignore - Handle potential binding issues
            if (this.spaceTimeClient.sdkConnection.db.curses) {
                // @ts-ignore
                this.activeCurses = Array.from(this.spaceTimeClient.sdkConnection.db.curses.iter());
                
                const curseCount = this.activeCurses.length;
                
                if (curseCount > 0) {
                    // Show curse card and count
                    this.curseCard.setVisible(true);
                    this.curseCountText.setVisible(true);
                    
                    // Set Roman numeral (cap at XX for readability)
                    const romanNumeral = curseCount <= 20 ? ROMAN_NUMERALS[curseCount] : 'XX+';
                    this.curseCountText.setText(romanNumeral);
                    
                    console.log(`Displaying ${curseCount} active curses: ${romanNumeral}`);
                } else {
                    // Hide curse card when no curses active
                    this.curseCard.setVisible(false);
                    this.curseCountText.setVisible(false);
                    
                    // Also hide menu if it's open
                    if (this.isMenuVisible) {
                        this.hideCursesMenu();
                    }
                }
                
                // Update menu content if it's currently visible
                if (this.isMenuVisible) {
                    this.updateCursesMenuContent();
                }
            }
        } catch (e) {
            console.warn('Error updating curses display:', e);
        }
    }

    protected updateCursesMenuContent(): void {
        // Clear existing curse list
        const existingCurseTexts = this.cursesMenuContainer.list.filter(child => 
            child instanceof Phaser.GameObjects.Text && (child as any).isCurseListItem
        );
        existingCurseTexts.forEach(text => {
            this.cursesMenuContainer.remove(text);
            text.destroy();
        });
        
        // Add curse names to menu
        const startY = -180;
        const lineHeight = 25;
        
        this.activeCurses.forEach((curse, index) => {
            // Safely get curse name with better error handling
            let curseName = 'Unknown Curse';
            try {
                if (curse && curse.curseType) {
                    curseName = CURSE_NAMES[curse.curseType] || curse.curseType.toString();
                } else {
                    console.warn('Curse object missing curseType:', curse);
                }
            } catch (e) {
                console.error('Error processing curse name:', e, curse);
            }
            
            const curseText = this.scene.add.text(0, startY + (index * lineHeight), `• ${curseName}`, {
                fontSize: '16px',
                color: '#ffaaaa',
                wordWrap: { width: 350 }
            });
            curseText.setOrigin(0.5, 0.5);
            (curseText as any).isCurseListItem = true; // Mark for cleanup
            
            this.cursesMenuContainer.add(curseText);
        });
        
        // Remove the redundant count summary text - it's already shown via Roman numerals on the card
    }

    protected toggleCursesMenu(): void {
        if (this.isMenuVisible) {
            this.hideCursesMenu();
        } else {
            this.showCursesMenu();
        }
    }

    protected showCursesMenu(): void {
        this.isMenuVisible = true;
        this.cursesMenuContainer.setVisible(true);
        this.updateCursesMenuContent();
    }

    protected hideCursesMenu(): void {
        this.isMenuVisible = false;
        this.cursesMenuContainer.setVisible(false);
    }

    public updatePosition(): void {
        // Update positions based on current screen size
        const cardX = this.scene.scale.width - 80;
        const cardY = 80;
        
        this.curseCard.setPosition(cardX, cardY);
        this.curseCountText.setPosition(cardX, cardY);
        
        // Update menu position to right side (consistent with createCursesMenu)
        const menuX = this.scene.scale.width - 200;
        const menuY = this.scene.scale.height / 2;
        this.cursesMenuContainer.setPosition(menuX, menuY);
    }

    public destroy(): void {
        if (this.curseCard) {
            this.curseCard.destroy();
        }
        if (this.curseCountText) {
            this.curseCountText.destroy();
        }
        if (this.cursesMenuContainer) {
            this.cursesMenuContainer.destroy();
        }
    }
}
