import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';

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
    
    // Animation state tracking
    private isCardFlying: boolean = false;

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
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
        
        console.log("CurseVictoryScene created with curse_bg background");
    }
    
    private createCurseCard() {
        const { width, height } = this.scale;
        
        // Calculate responsive positioning for curse card at bottom of screen
        const cardBottomY = height * 0.4; // Position in bottom area relative to container center
        
        // Create curse card sprite
        this.curseCard = this.add.image(0, cardBottomY, 'curse_card')
            .setName('curseCard')
            .setAlpha(0) // Start invisible
            .setDepth(10); // Ensure it's on top
        
        // Add to container
        this.curseContainer.add(this.curseCard);
        
        // Schedule fade-in animation to start after curse_incant sound has time to play
        this.time.addEvent({
            delay: 800, // Wait 800ms for sound to play
            callback: () => {
                this.fadeInCurseCard();
            }
        });
        
        console.log("CurseVictoryScene: Curse card created at bottom of screen (invisible)");
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
            scaleX: targetScale,
            scaleY: targetScale,
            duration: 1500, // 1.5 seconds for smooth flight
            ease: 'Power2',
            onComplete: () => {
                console.log("CurseVictoryScene: Card flight animation complete");
                // Schedule transition delay after card reaches target
                this.time.addEvent({
                    delay: 1000, // 1 second delay 
                    callback: () => {
                        this.returnToCharacterSelect();
                    }
                });
            }
        });
        
        console.log(`CurseVictoryScene: Card flight animation started to position (${relativeTargetX}, ${relativeTargetY})`);
    }
    
    private returnToCharacterSelect() {
        console.log("CurseVictoryScene: Returning to character select");
        // TODO: Implement in Task 6 - transition back to character select
        this.scene.start('ClassSelectScene');
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
        
        // Clean up curse card and container
        if (this.curseCard) {
            this.curseCard.destroy();
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
} 