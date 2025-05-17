import Phaser from 'phaser';
import { UpgradeOptionData, UpgradeType } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { ChooseUpgrade } from '../autobindings';

// Define a type for our attack graphic data with prediction capabilities
interface AttackGraphicData {
    graphic: Phaser.GameObjects.Graphics;
    sprite: Phaser.GameObjects.Sprite | null;
    radius: number;
    baseRadius: number; // Store the base radius from attack data for scaling calculation
    alpha: number;
    // Add prediction-related properties
    lastUpdateTime: number;
    predictedPosition: Phaser.Math.Vector2;
    serverPosition: Phaser.Math.Vector2;
    direction: Phaser.Math.Vector2;
    speed: number;
    isShield: boolean;
    playerId: number | null;
    parameterU: number;
    ticksElapsed: number;
    attackType: string;
}

// Constants
const CARD_WIDTH = 180; // Reduced from 200 to 180
const CARD_HEIGHT = 250; // Reduced from 260 to 250
const CARD_SPACING = 10; // Reduced from 20 to 10
const CARD_SCALE_DESKTOP = 0.8;
const CARD_SCALE_MOBILE = 0.65; // Smaller scale for mobile devices
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements
const MOBILE_BOTTOM_MARGIN = 5; // Reduced bottom margin on mobile (from 20)
const DESKTOP_BOTTOM_MARGIN = 20; // Original bottom margin for desktop

// Define upgrade icon mapping
const UPGRADE_ICON_MAP: { [key: string]: string } = {
    'MaxHp': 'upgrade_maxHP',
    'HpRegen': 'upgrade_regenHP',
    'Speed': 'upgrade_speed',
    'Armor': 'upgrade_armor',
    'AttackSword': 'attack_sword',
    'AttackWand': 'attack_wand',
    'AttackKnives': 'attack_knife',
    'AttackShield': 'attack_shield',
    'AttackFootball': 'attack_football',
    'AttackCards': 'attack_cards',
    'AttackDumbbell': 'attack_dumbbell',
    'AttackGarlic': 'attack_garlic'
};

export default class UpgradeUI {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private container: Phaser.GameObjects.Container;
    private cards: Phaser.GameObjects.Container[] = [];
    private localPlayerId: number = 0;
    private upgradeOptions: UpgradeOptionData[] = [];
    private isVisible: boolean = false;
    private keyListeners: Phaser.Input.Keyboard.Key[] = [];
    private rerollText: Phaser.GameObjects.Text | null = null;
    private isMobile: boolean = false;

    // Helper to detect mobile devices
    private detectMobile(): boolean {
        const userAgent = navigator.userAgent.toLowerCase();
        return /android|webos|iphone|ipad|ipod|blackberry|windows phone/i.test(userAgent) 
            || (window.innerWidth <= 800);
    }

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient, localPlayerId: number) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.localPlayerId = localPlayerId;
        
        // Detect if we're on a mobile device
        this.isMobile = this.detectMobile();
        console.log(`UpgradeUI initialized on ${this.isMobile ? 'mobile' : 'desktop'} device`);
        
        // Create container for all upgrade UI elements
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(UI_DEPTH);
        this.container.setVisible(false);

        // Create keyboard input for number keys 1-3
        this.keyListeners = [
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.THREE)
        ].filter((key): key is Phaser.Input.Keyboard.Key => key !== undefined);

        // Create reroll text with instruction 
        /*
        this.rerollText = this.scene.add.text(0, -CARD_HEIGHT, "Press R to reroll (Available: 0)", {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.rerollText.setOrigin(0.5);
        this.container.add(this.rerollText);
        */

        console.log('UpgradeUI initialized');
    }

    public update(time: number, delta: number): void {
        if (!this.isVisible) return;

        // Position the container at the bottom of the camera
        const camera = this.scene.cameras.main;
        if (camera) {
            this.container.x = camera.scrollX + camera.width / 2;
            
            // Use different vertical positioning based on device type
            const bottomMargin = this.isMobile ? MOBILE_BOTTOM_MARGIN : DESKTOP_BOTTOM_MARGIN;
            this.container.y = camera.scrollY + camera.height - (CARD_HEIGHT / 2) - bottomMargin;
        }

        // Check for number key presses
        for (let i = 0; i < this.keyListeners.length; i++) {
            if (Phaser.Input.Keyboard.JustDown(this.keyListeners[i])) {
                this.chooseUpgrade(i);
                break;
            }
        }
    }

    public setUpgradeOptions(options: UpgradeOptionData[]): void {
        console.log('Setting upgrade options:', options);
        this.upgradeOptions = options;
        
        // Update reroll text with current count if player data is available
        if (this.rerollText && this.spacetimeClient.sdkConnection?.db) {
            const player = this.spacetimeClient.sdkConnection.db.player.playerId.find(this.localPlayerId);
            if (player && player.rerolls !== undefined) {
                this.rerollText.setText(`Press R to reroll (Available: ${player.rerolls})`);
            }
        }
        
        if (options.length > 0) {
            this.createUpgradeCards();
            this.show();
        } else {
            this.hide();
        }
    }

    private createUpgradeCards(): void {
        // Clear any existing cards
        this.cards.forEach(card => card.destroy());
        this.cards = [];

        // Use different spacing for mobile
        const effectiveCardWidth = this.isMobile ? CARD_WIDTH * CARD_SCALE_MOBILE : CARD_WIDTH * CARD_SCALE_DESKTOP;
        const effectiveCardSpacing = this.isMobile ? CARD_SPACING / 2 : CARD_SPACING; // Even tighter spacing on mobile

        // Calculate total width of all cards with spacing
        const totalWidth = (this.upgradeOptions.length * effectiveCardWidth) + 
                          ((this.upgradeOptions.length - 1) * effectiveCardSpacing);
        const startX = -totalWidth / 2 + effectiveCardWidth / 2;

        // Create a card for each option
        this.upgradeOptions.forEach((option, index) => {
            const x = startX + (index * (effectiveCardWidth + effectiveCardSpacing));
            const card = this.createCard(x, 0, option, index);
            this.cards.push(card);
            this.container.add(card);
        });
    }

    private createCard(x: number, y: number, option: UpgradeOptionData, index: number): Phaser.GameObjects.Container {
        const card = this.scene.add.container(x, y);
        
        // Use different scale based on device type
        const cardScale = this.isMobile ? CARD_SCALE_MOBILE : CARD_SCALE_DESKTOP;
        
        // Card background
        const background = this.scene.add.image(0, 0, 'card_blank');
        background.setScale(cardScale);
        card.add(background);
        
        // Make card interactive
        background.setInteractive({ useHandCursor: true });
        background.on('pointerdown', () => this.chooseUpgrade(index));
        background.on('pointerover', () => background.setTint(0xdddddd));
        background.on('pointerout', () => background.clearTint());
        
        // Add number text (1, 2, or 3)
        const numberText = this.scene.add.text(0, background.height * cardScale, `${index + 1}`, {
            fontSize: this.isMobile ? '36px' : '48px', // Smaller font on mobile
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: this.isMobile ? 3 : 4 // Reduced stroke thickness on mobile
        });
        numberText.setOrigin(0.5);
        card.add(numberText);
        
        // Get the appropriate icon based on upgrade type
        const upgradeType = option.upgradeType.tag;
        const iconKey = UPGRADE_ICON_MAP[upgradeType] || 'white_pixel';
        
        // Add upgrade icon - position higher on mobile
        const iconY = this.isMobile ? -10 : -20;
        const icon = this.scene.add.image(0, iconY, iconKey);
        icon.setScale(this.isMobile ? 0.65 : 0.8); // Smaller icon on mobile
        card.add(icon);
        
        // Create upgrade text - position higher on mobile
        let upgradeText = this.getUpgradeDescription(option);
        const descText = this.scene.add.text(0, background.height * cardScale * 0.28, upgradeText, {
            fontSize: this.isMobile ? '16px' : '18px', // Smaller font on mobile
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: this.isMobile ? 2 : 3, // Reduced stroke thickness on mobile
            align: 'center',
            wordWrap: { width: background.width * cardScale * 0.85 } // Slightly wider text area
        });
        descText.setOrigin(0.5);
        card.add(descText);
        
        return card;
    }
    
    private getUpgradeDescription(option: UpgradeOptionData): string {
        const upgradeType = option.upgradeType.tag;
        
        // Handle base stat upgrades
        switch (upgradeType) {
            case 'MaxHp':
                return `HP`;
            case 'HpRegen':
                return `Regen`;
            case 'Speed':
                return `Speed`;
            case 'Armor':
                return `Armor`;
        }
        
        // Handle attack upgrades
        if (option.isNewAttack) {
            return "New"
        }
        
        // Handle attack stat upgrades
        if (option.damage > 0) {
            return `Atk`;
        } else if (option.cooldownRatio > 0) {
            return `CD`;
        } else if (option.projectiles > 0) {
            return `Count`;
        } else if (option.speed > 0) {
            return `Speed`;
        } else if (option.radius > 0) {
            return `Size`;
        }
        
        return upgradeType;
    }

    private chooseUpgrade(index: number): void {
        if (!this.isVisible || index >= this.upgradeOptions.length) return;
        
        console.log(`Choosing upgrade at index ${index}`);
        
        // Get the upgrade option and index
        const option = this.upgradeOptions[index];
        if (!option) return;
        
        // Call the ChooseUpgrade reducer
        if (this.spacetimeClient.sdkConnection?.reducers) {
            this.spacetimeClient.sdkConnection.reducers.chooseUpgrade(
                this.localPlayerId,
                option.upgradeIndex
            );
            console.log(`Sent ChooseUpgrade reducer call for index ${option.upgradeIndex}`);
            
            // Play upgrade applied effect
            const player = this.scene.registry.get('localPlayerSprite');
            this.createUpgradeAppliedEffect(player);
            
            // Hide the UI
            this.hide();
        } else {
            console.error("Cannot choose upgrade: SpacetimeDB connection not available");
        }
    }
    
    private createUpgradeAppliedEffect(playerSprite: Phaser.Physics.Arcade.Sprite): void {
        if (!playerSprite) return;
        
        console.log("Playing upgrade applied effect");
        
        // Store initial tint
        const initialTint = playerSprite.tintTopLeft;
        
        // Add a flash effect (white -> bright color -> back to normal)
        playerSprite.setTint(0xffffff); // White flash
        
        // Create a glow effect
        const glow = this.scene.add.circle(
            playerSprite.x,
            playerSprite.y,
            playerSprite.width / 1.5,
            0x00ffff, // Cyan color
            0.7 // Semi-transparent
        );
        glow.setDepth(playerSprite.depth - 1); // Just below player
        
        // Create particle effect
        const particles = this.scene.add.particles(playerSprite.x, playerSprite.y, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 500,
            gravityY: -20,
            tint: 0x00ffff, // Cyan particles
            emitting: false
        });
        
        // Emit particles in a burst
        particles.explode(20, playerSprite.x, playerSprite.y);
        
        // Sequence the animation
        this.scene.time.delayedCall(100, () => {
            playerSprite.setTint(0x00ffff); // Cyan flash
            
            this.scene.time.delayedCall(200, () => {
                playerSprite.setTint(initialTint); // Reset
            });
        });
        
        // Expand and fade the glow
        this.scene.tweens.add({
            targets: glow,
            scale: 2.5,
            alpha: 0,
            duration: 400,
            ease: 'Sine.easeOut',
            onComplete: () => {
                glow.destroy();
            }
        });
        
        // Clean up particles
        this.scene.time.delayedCall(600, () => {
            particles.destroy();
        });
    }

    public show(): void {
        this.isVisible = true;
        this.container.setVisible(true);
    }

    public hide(): void {
        this.isVisible = false;
        this.container.setVisible(false);
    }

    public destroy(): void {
        this.keyListeners.forEach(key => key.destroy());
        this.cards.forEach(card => card.destroy());
        this.container.destroy();
    }
}