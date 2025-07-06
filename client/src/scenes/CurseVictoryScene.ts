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
            }
        });
        
        console.log("CurseVictoryScene: Curse card fade-in animation started");
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
            
            // Update curse card position within container
            const curseCard = this.curseContainer.getByName('curseCard') as Phaser.GameObjects.Image;
            if (curseCard) {
                const cardBottomY = height * 0.4; // Recalculate responsive position
                curseCard.setPosition(0, cardBottomY);
                console.log(`CurseVictoryScene: Updated curse card position to (0, ${cardBottomY})`);
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