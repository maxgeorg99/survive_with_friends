import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';

// Roman numeral mapping (same as CurseUI)
const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 
                        'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

// Constants for responsive design
const RESPONSIVE_CONFIG = {
    // Add constants for future text and positioning if needed
    MIN_STROKE_WIDTH: 4
};

export default class CurseVictoryScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    
    // UI Elements
    private curseContainer!: Phaser.GameObjects.Container;
    private curseCard!: Phaser.GameObjects.Image;
    private curseCountText!: Phaser.GameObjects.Text;
    
    // Animation state tracking
    private isCardFlying: boolean = false;
    
    // Curse counting state
    private initialCurseCount: number = 0;
    private finalCurseCount: number = 0;

    constructor() {
        super('CurseVictoryScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("CurseVictoryScene constructor called");
    }

    preload() {
        // Load assets needed for the curse victory screen
        this.load.image('curse_bg', '/assets/curse_bg.png');
        this.load.image('curse_card', '/assets/curse_card.png');
        
        // Load curse-related sound effects
        this.load.audio('curse_incant', '/assets/sounds/curse_incant.mp3');
        this.load.audio('curse_created', '/assets/sounds/curse_created.mp3');
        
        // Preload class icons to keep them cached for ClassSelectScene transition
        this.load.image('fighter_icon', '/assets/attack_sword.png');
        this.load.image('rogue_icon', '/assets/attack_knife.png');
        this.load.image('mage_icon', '/assets/attack_wand.png');
        this.load.image('paladin_icon', '/assets/attack_shield.png');
        this.load.image('valkyrie_icon', '/assets/attack_horn.png');
        this.load.image('priestess_icon', '/assets/attack_staff.png');
        
        console.log('CurseVictoryScene: Preloading assets and sounds for curse victory screen');
    }

    create() {
        const { width, height } = this.scale;
        
        // Check current curse count to determine scene behavior
        this.checkCurrentCurseCount();
        
        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
            // Play curse_incant sound when entering curse victory scene
            try {
                soundManager.playSound('curse_incant', 1.0);
                console.log("CurseVictoryScene: curse_incant sound played successfully");
            } catch (error) {
                console.error("CurseVictoryScene: Error playing curse_incant sound:", error);
            }
        } else {
            console.warn("CurseVictoryScene: SoundManager not available");
        }
        
        // Initialize music manager
        this.musicManager = new MusicManager(this);
        this.musicManager.stopCurrentTrack();
        
        // Set background to a neutral color
        this.cameras.main.setBackgroundColor('#000000');
        
        try {
            if (this.textures.exists('curse_bg')) {
                const bg = this.add.image(width/2, height/2, 'curse_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0)
                    .setName('curse_bg');
                console.log("CurseVictoryScene: curse_bg background loaded successfully");
            }
        } catch (error) {
            console.error("Error loading curse background:", error);
        }
        
        // Add corner shading for better visual effects
        this.createCornerShading();
        
        // Create a container for all curse UI elements
        this.curseContainer = this.add.container(width/2, height/2);
        
        // Create curse card sprite at bottom of screen (initially invisible)
        this.createCurseCard();
        
        // Register event listeners
        this.registerEventListeners();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
        
        console.log("CurseVictoryScene created with curse_bg background");
    }
    
    private createCurseCard() {
        // ALWAYS create the bottom card that will fly up
        this.createCardAtBottom();
        
        // If there are already 2+ curses, also create a static card at top-right
        // showing the current count, so the flying card joins an existing "deck"
        if (this.initialCurseCount >= 1) {
            this.createStaticCardAtTopRight();
        }
    }
    
    private createCardAtBottom() {
        const { width, height } = this.scale;
        
        // Calculate responsive positioning for curse card at bottom of screen
        const cardLeftX = -width * 0.09;
        const cardBottomY = height * 0.3; // Position in bottom area relative to container center
        
        // Create curse card sprite
        this.curseCard = this.add.image(cardLeftX, cardBottomY, 'curse_card')
            .setName('curseCard')
            .setAlpha(0) // Start invisible
            .setDepth(10) // Ensure it's on top
            .setScale(1.35)
            .setRotation(-0.12);
        
        // Add to container
        this.curseContainer.add(this.curseCard);
        
        // Schedule fade-in animation to start after curse_incant sound has time to play
        this.time.addEvent({
            delay: 800, // Wait 800ms for sound to play
            callback: () => {
                this.fadeInCurseCard();
            }
        });
        
        console.log("CurseVictoryScene: Curse card created at bottom of screen (animation always happens)");
    }
    
    private createStaticCardAtTopRight() {
        const { width, height } = this.scale;
        
        // Create a static card at the final position (top-right corner)
        const staticCard = this.add.image(width - 80, 80, 'curse_card')
            .setName('staticCurseCard')
            .setScale(0.3)
            .setScrollFactor(0)
            .setDepth(100001);
        
        // Create Roman numeral text showing the current count
        this.createCurseCountText(this.initialCurseCount);
        
        console.log(`CurseVictoryScene: Created static card at top-right showing count ${this.initialCurseCount}`);
    }
    
    private createCurseCountText(count: number) {
        if (!this.curseCard) return;
        
        const { width, height } = this.scale;
        
        // Position text at same location as card (top-right corner)
        const targetX = width - 80; // Same as card position
        const targetY = 80; // Same as card position
        
        // Create Roman numeral text (same as CurseUI)
        const romanNumeral = count <= 20 ? ROMAN_NUMERALS[count] : 'XX+';
        
        this.curseCountText = this.add.text(targetX, targetY, romanNumeral, {
            fontSize: '24px',
            color: '#ffffff',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 2
        });
        this.curseCountText.setOrigin(0.5, 0.5);
        this.curseCountText.setScrollFactor(0);
        this.curseCountText.setDepth(100003); // Above the card
        this.curseCountText.setVisible(count > 0);
        
        console.log(`CurseVictoryScene: Created curse count text: ${romanNumeral}`);
    }
    
    private fadeInCurseCard() {
        if (!this.curseCard) {
            console.warn("CurseVictoryScene: Curse card not found for fade-in animation");
            return;
        }
        
        // Fade in the curse card
        this.tweens.add({
            targets: this.curseCard,
            alpha: 1,
            duration: 1000, // 1 second fade-in
            ease: 'Power2',
            onComplete: () => {
                console.log("CurseVictoryScene: Curse card fade-in complete");
                // Chain the card flight animation
                this.flyCardToTopRight();
            }
        });
        
        console.log("CurseVictoryScene: Curse card fade-in animation started");
    }
    
    private flyCardToTopRight() {
        if (!this.curseCard) {
            console.warn("CurseVictoryScene: Curse card not found for flight animation");
            return;
        }
        
        // Play curse_created sound when flight animation begins
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            try {
                soundManager.playSound('curse_created', 1.0);
                console.log("CurseVictoryScene: curse_created sound played successfully");
            } catch (error) {
                console.error("CurseVictoryScene: Error playing curse_created sound:", error);
            }
        }
        
        // Calculate target position (top-right corner matching curse UI)
        const { width, height } = this.scale;
        const targetX = width - 80; // 80 pixels from right edge (matching CurseUI)
        const targetY = 80; // 80 pixels from top (matching CurseUI)
        
        // Convert target position to container-relative coordinates
        const containerX = width / 2; // Container is centered
        const containerY = height / 2;
        const relativeTargetX = targetX - containerX;
        const relativeTargetY = targetY - containerY;
        
        // Calculate scale target (matching CurseUI scale of 0.3)
        const targetScale = 0.3;
        
        // Set flight state flag
        this.isCardFlying = true;
        
        // Animate card flying to top-right with smooth curve
        this.tweens.add({
            targets: this.curseCard,
            x: relativeTargetX,
            y: relativeTargetY,
            rotation: 0,
            scaleX: targetScale,
            scaleY: targetScale,
            duration: 1500, // 1.5 seconds for smooth flight
            ease: 'Power2',
            onComplete: () => {
                console.log("CurseVictoryScene: Card flight animation complete");
                // Handle different scenarios based on initial curse count
                this.handleCardReachedDestination();
            }
        });
        
        console.log(`CurseVictoryScene: Card flight animation started to position (${relativeTargetX}, ${relativeTargetY})`);
    }
    
    private handleCardReachedDestination() {
        if (this.initialCurseCount === 0) {
            // First curse: Show curse system appearing for the first time
            this.createCurseCountText(1); // Show "I" - the curse system is now visible
            console.log("CurseVictoryScene: First curse - showing curse system appearing");
        } else {
            // Existing curses: Text already exists from static card, just note this
            console.log(`CurseVictoryScene: Card joined existing deck - current count ${this.initialCurseCount}, will increment to ${this.finalCurseCount}`);
        }
        
        // Add visual feedback to represent the curse that was already added
        this.showCurseAddedFeedback();
    }
    
    private showCurseAddedFeedback() {
        console.log("CurseVictoryScene: Showing visual feedback for curse that was added");
        
        // If there are existing curses, increment the Roman numeral to show the new curse
        if (this.initialCurseCount > 0 && this.curseCountText) {
            // Small delay before incrementing to let the user see the current count first
            this.time.addEvent({
                delay: 300, // Brief pause to show current count
                callback: () => {
                    this.incrementCurseCountDisplay();
                }
            });
        }
        
        // Add visual feedback effects (pulse, glow) to represent the curse addition
        this.addCurseVisualFeedback();
    }
    
    private incrementCurseCountDisplay() {
        if (!this.curseCountText) return;
        
        const newCount = this.initialCurseCount + 1;
        const newRomanNumeral = newCount <= 20 ? ROMAN_NUMERALS[newCount] : 'XX+';
        
        // Animate the text change with a brief scale effect
        this.tweens.add({
            targets: this.curseCountText,
            scaleX: 1.2,
            scaleY: 1.2,
            duration: 150,
            ease: 'Power2',
            yoyo: true,
            onComplete: () => {
                // Update the text during the scale animation
                this.curseCountText.setText(newRomanNumeral);
                console.log(`CurseVictoryScene: Incremented curse count display to ${newRomanNumeral}`);
            }
        });
        
        // Update the text at the peak of the scale animation
        this.time.addEvent({
            delay: 75, // Halfway through the scale animation
            callback: () => {
                if (this.curseCountText) {
                    this.curseCountText.setText(newRomanNumeral);
                }
            }
        });
    }
    
    private addCurseVisualFeedback() {
        if (!this.curseCard) {
            console.warn("CurseVictoryScene: Cannot add visual feedback - card not found");
            return;
        }
        
        // Add a pulsing glow effect to indicate curse was successfully added
        this.tweens.add({
            targets: this.curseCard,
            scaleX: 0.35, // Slightly larger
            scaleY: 0.35,
            duration: 200,
            ease: 'Power2',
            yoyo: true,
            repeat: 2, // Pulse 3 times total
            onComplete: () => {
                console.log("CurseVictoryScene: Curse visual feedback complete");
            }
        });
        
        // Add a brief tint effect
        this.curseCard.setTint(0xffaa00); // Orange glow
        this.time.addEvent({
            delay: 600, // After pulsing
            callback: () => {
                if (this.curseCard) {
                    this.curseCard.clearTint();
                }
            }
        });
        
        console.log("CurseVictoryScene: Curse visual feedback animation started");
    }
    
    private registerEventListeners() {
        // Listen for account updates that might change our state
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
    }
    
    private handleAccountUpdated(ctx: any, oldAccount: any, newAccount: any) {
        console.log("Account updated in CurseVictoryScene", newAccount.state);
        
        // Check if this is our account
        if (newAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
            // Check if state changed away from CurseCutscene
            if (newAccount.state.tag !== 'CurseCutscene') {
                console.log("Account state changed from CurseCutscene to", newAccount.state.tag);
                
                // Transition to LoadingScene which will evaluate the new state
                this.scene.start('LoadingScene', { 
                    message: 'Evaluating account state...', 
                    waitingFor: 'account_evaluation'
                });
            }
        }
    }
    
    private handleConnectionLost() {
        console.log("Connection lost in CurseVictoryScene");
        // Don't show error text in curse scene, just transition to loading
        this.scene.start('LoadingScene', { 
            message: 'Connection lost. Reconnecting...', 
            waitingFor: 'connection'
        });
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        console.log(`CurseVictoryScene: Handling resize to ${width}x${height}`);
        
        // Update background image
        const backgroundImage = this.children.getByName('curse_bg') as Phaser.GameObjects.Image;
        if (backgroundImage) {
            backgroundImage.setPosition(width/2, height/2);
            backgroundImage.setDisplaySize(width, height);
            console.log(`CurseVictoryScene: Updated background image to ${width}x${height}`);
        }
        
        // Update container position to new center
        if (this.curseContainer) {
            this.curseContainer.setPosition(width/2, height/2);
            
            // Update curse card position within container (only if not currently flying)
            const curseCard = this.curseContainer.getByName('curseCard') as Phaser.GameObjects.Image;
            if (curseCard && !this.isCardFlying) {
                const cardBottomY = height * 0.4; // Recalculate responsive position
                curseCard.setPosition(0, cardBottomY);
                console.log(`CurseVictoryScene: Updated curse card position to (0, ${cardBottomY})`);
            } else if (this.isCardFlying) {
                console.log("CurseVictoryScene: Card is flying, skipping position update");
            }
        }
        
        // Update corner shading
        this.createCornerShading();
    }
    
    shutdown() {
        console.log("CurseVictoryScene shutdown called");
        
        // Stop music
        if (this.musicManager) {
            this.musicManager.stopCurrentTrack();
        }
        
        // Clean up event listeners
        this.scale.off('resize', this.handleResize, this);
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Clean up curse card, count text, and container
        if (this.curseCard) {
            this.curseCard.destroy();
        }
        
        if (this.curseCountText) {
            this.curseCountText.destroy();
        }
        
        if (this.curseContainer) {
            this.curseContainer.destroy();
        }
        
        console.log("CurseVictoryScene shutdown complete");
    }
    
    private createCornerShading() {
        const { width, height } = this.scale;
        
        // Remove existing corner shading if it exists
        const existingShading = this.children.getByName('cornerShading');
        if (existingShading) {
            existingShading.destroy();
        }
        
        // Create subtle corner shading for better visual depth
        const cornerShading = this.add.graphics({ fillStyle: { color: 0x000000 } });
        cornerShading.setName('cornerShading');
        cornerShading.setAlpha(0.3);
        cornerShading.setDepth(1);
        
        // Top-left corner
        cornerShading.fillTriangle(0, 0, width * 0.3, 0, 0, height * 0.3);
        
        // Top-right corner
        cornerShading.fillTriangle(width, 0, width * 0.7, 0, width, height * 0.3);
        
        // Bottom-left corner
        cornerShading.fillTriangle(0, height, width * 0.3, height, 0, height * 0.7);
        
        // Bottom-right corner
        cornerShading.fillTriangle(width, height, width * 0.7, height, width, height * 0.7);
        
        console.log("CurseVictoryScene: Corner shading created");
    }
    
    private checkCurrentCurseCount() {
        if (!this.spacetimeDBClient.isConnected || !this.spacetimeDBClient.sdkConnection?.db) {
            console.log("CurseVictoryScene: SpacetimeDB not connected, assuming first curse");
            this.initialCurseCount = 0;
            this.finalCurseCount = 1;
            return;
        }
        
        try {
            // Get current curse count from database
            // @ts-ignore - Handle potential binding issues
            if (this.spacetimeDBClient.sdkConnection.db.curses) {
                // @ts-ignore
                this.initialCurseCount = this.spacetimeDBClient.sdkConnection.db.curses.count() - 1;
                if(this.initialCurseCount < 0) {
                    this.initialCurseCount = 0;
                }
                this.finalCurseCount = this.initialCurseCount + 1;
                console.log(`CurseVictoryScene: Current curse count: ${this.initialCurseCount}`);
            } else {
                console.log("CurseVictoryScene: Curses table not available, assuming first curse");
                this.initialCurseCount = 0;
                this.finalCurseCount = 1;
            }
        } catch (error) {
            console.warn("CurseVictoryScene: Error checking curse count, assuming first curse:", error);
            this.initialCurseCount = 0;
            this.finalCurseCount = 1;
        }
    }
} 