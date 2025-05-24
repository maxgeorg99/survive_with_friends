import Phaser from 'phaser';
import { UpgradeOptionData, UpgradeType, AttackType, ChosenUpgradeData } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Constants
const CARD_WIDTH = 180; 
const CARD_HEIGHT = 250;
const CARD_SPACING = 10;
const CARD_SCALE_DESKTOP = 0.8;
const CARD_SCALE_MOBILE = 0.65;
const UI_DEPTH = 100000; // Much higher depth to ensure UI stays above all game elements including monsters
const MOBILE_BOTTOM_MARGIN = 5;
const DESKTOP_BOTTOM_MARGIN = 20;

// Animation constants for weapon fusion
const FUSION_ANIMATION = {
    WEAPON_SCALE: 1.0,
    FUSION_DURATION: 2500,
    WEAPON_MOVE_DURATION: 800,
    MERGE_PAUSE_DURATION: 400,
    RESULT_REVEAL_DURATION: 600,
    PARTICLE_BURST_COUNT: 50,
    ENERGY_STREAM_COUNT: 12
};

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

// Weapon asset mapping for combinations - Fix TypeScript errors by using string keys
const WEAPON_ASSET_MAP: Record<string, string> = {
    'Sword': 'attack_sword',
    'Wand': 'attack_wand',
    'Knives': 'attack_knife',
    'Shield': 'attack_shield',
    'Football': 'attack_football',
    'Cards': 'attack_cards',
    'Dumbbell': 'attack_dumbbell',
    'Garlic': 'attack_garlic',
    'Shuriken': 'attack_shuriken',
    'FireSword': 'attack_fire_sword',
    'HolyHammer': 'attack_holy_hammer',
    'MagicDagger': 'attack_magic_dagger',
    'ThrowingShield': 'attack_throwing_shield',
    'EnergyOrb': 'attack_energy_orb'
};

// Weapon name mapping for combinations - Fix TypeScript errors by using string keys
const WEAPON_NAME_MAP: Record<string, string> = {
    'Sword': "Sword",
    'Wand': "Wand",
    'Knives': "Knives",
    'Shield': "Shield",
    'Football': "Football",
    'Cards': "Cards",
    'Dumbbell': "Dumbbell",
    'Garlic': "Garlic",
    'Shuriken': "Shuriken",
    'FireSword': "Fire Sword",
    'HolyHammer': "Holy Hammer",
    'MagicDagger': "Magic Dagger",
    'ThrowingShield': "Throwing Shield",
    'EnergyOrb': "Energy Orb"
};

export default class UpgradeUI {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private upgradeContainer: Phaser.GameObjects.Container;
    private combinationContainer: Phaser.GameObjects.Container;
    private cards: Phaser.GameObjects.Container[] = [];
    private localPlayerId: number = 0;
    private upgradeOptions: UpgradeOptionData[] = [];
    private isVisible: boolean = false;
    private keyListeners: Phaser.Input.Keyboard.Key[] = [];
    private rerollText: Phaser.GameObjects.Text | null = null;
    private isMobile: boolean = false;
    private gameEvents: Phaser.Events.EventEmitter;

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
        this.gameEvents = (window as any).gameEvents;
        
        // Detect if we're on a mobile device
        this.isMobile = this.detectMobile();
        console.log(`UpgradeUI initialized on ${this.isMobile ? 'mobile' : 'desktop'} device`);
        
        // Create container for upgrade UI elements
        this.upgradeContainer = this.scene.add.container(0, 0);
        this.upgradeContainer.setDepth(UI_DEPTH);
        this.upgradeContainer.setVisible(false);
        
        // Create container for weapon combination UI elements
        this.combinationContainer = this.scene.add.container(0, 0);
        this.combinationContainer.setDepth(UI_DEPTH);
        this.combinationContainer.setVisible(false);

        // Create keyboard input for number keys 1-3
        this.keyListeners = [
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.THREE)
        ].filter((key): key is Phaser.Input.Keyboard.Key => key !== undefined);

        // Register for weapon combination events
        this.registerCombinationEventListeners();

        console.log('UpgradeUI initialized');
    }

    public update(time: number, delta: number): void {
        if (!this.isVisible) return;

        // Position the container at the bottom of the camera
        const camera = this.scene.cameras.main;
        if (camera) {
            this.upgradeContainer.x = camera.scrollX + camera.width / 2;
            
            // Use different vertical positioning based on device type
            const bottomMargin = this.isMobile ? MOBILE_BOTTOM_MARGIN : DESKTOP_BOTTOM_MARGIN;
            this.upgradeContainer.y = camera.scrollY + camera.height - (CARD_HEIGHT / 2) - bottomMargin;
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
        
        if (options.length > 0) {
            this.createUpgradeCards();
            this.showUpgradeUI();
        } else {
            this.hideUpgradeUI();
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
            this.upgradeContainer.add(card);
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
        
        // Show special indication if this is a weapon combination
        // Check for both possible property naming conventions (snake_case from C# and camelCase in TypeScript)
        if (option.isCombinationTrigger || (option as any).is_combination_trigger) {
            upgradeText = "⚔COMBO⚔";
            
            // Debug log to help diagnose property naming
            console.log("Found combination trigger option:", option);
        }
        
        const descText = this.scene.add.text(0, background.height * cardScale * 0.28, upgradeText, {
            fontSize: this.isMobile ? '16px' : '18px', // Smaller font on mobile
            fontFamily: 'Arial',
            color: (option.isCombinationTrigger || (option as any).is_combination_trigger) ? '#FFD700' : '#ffffff', // Gold color for combinations
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
            return "New";
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
            this.hideUpgradeUI();
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

    // ------ Weapon Combination UI Methods ------
    
    private registerCombinationEventListeners(): void {
        // Listen for chosen upgrade events that might be combinations
        if (this.spacetimeClient.sdkConnection) {
            this.spacetimeClient.sdkConnection.db.chosenUpgrades.onInsert((ctx, chosenUpgrade: ChosenUpgradeData) => {
                console.log("ChosenUpgrade insert detected:", chosenUpgrade);
                
                // Check both camelCase and snake_case property names for combination trigger
                const isCombination = chosenUpgrade.isCombinationTrigger || (chosenUpgrade as any).is_combination_trigger;
                
                if (isCombination && chosenUpgrade.playerId === this.localPlayerId) {
                    // Log the raw object to help with debugging
                    console.log("Weapon combination detected with properties:", 
                        "isCombinationTrigger:", chosenUpgrade.isCombinationTrigger,
                        "is_combination_trigger:", (chosenUpgrade as any).is_combination_trigger);
                    
                    // Get the weapon types, checking both naming conventions
                    const firstWeapon = chosenUpgrade.firstWeaponToCombine || (chosenUpgrade as any).first_weapon_to_combine;
                    const secondWeapon = chosenUpgrade.secondWeaponToCombine || (chosenUpgrade as any).second_weapon_to_combine;
                    const combinedWeapon = chosenUpgrade.combinedWeaponResult || (chosenUpgrade as any).combined_weapon_result;
                    
                    this.handleWeaponCombination(
                        firstWeapon as AttackType,
                        secondWeapon as AttackType,
                        combinedWeapon as AttackType
                    );
                }
            });
        }
    }

    private handleWeaponCombination(firstWeapon: AttackType, secondWeapon: AttackType, combinedWeapon: AttackType): void {
        console.log("Local player received weapon combination trigger:", 
            this.getWeaponDisplayName(firstWeapon), "+", this.getWeaponDisplayName(secondWeapon), "->", this.getWeaponDisplayName(combinedWeapon));
        this.showWeaponCombinationNotification(firstWeapon, secondWeapon, combinedWeapon);
    }
    
    private showWeaponCombinationNotification(firstWeapon: AttackType, secondWeapon: AttackType, combinedWeapon: AttackType): void {
        console.log("Starting weapon combination animation...");
        this.combinationContainer.removeAll(true);
        
        // Get camera position for proper positioning
        const camera = this.scene.cameras.main;
        const { width, height } = this.scene.scale;
        
        // Position relative to camera viewport, not world coordinates
        this.combinationContainer.x = camera.scrollX + width / 2;
        this.combinationContainer.y = camera.scrollY + height / 2 - 100;
        
        console.log(`Combination container positioned at: ${this.combinationContainer.x}, ${this.combinationContainer.y}`);
        
        // Create animated background with growing effect
        const background = this.scene.add.rectangle(0, 0, 600, 250, 0x000000, 0.9);
        background.setStrokeStyle(6, 0xFFD700);
        background.setScale(0.1);
        
        // Animate background entrance
        this.scene.tweens.add({
            targets: background,
            scaleX: 1,
            scaleY: 1,
            duration: 400,
            ease: 'Back.easeOut'
        });
        
        const titleText = this.scene.add.text(0, -100, "WEAPON FUSION!", { 
            fontFamily: 'Arial Black', 
            fontSize: '32px', 
            color: '#FFD700', 
            stroke: '#000000', 
            strokeThickness: 6,
            fontStyle: 'bold'
        }).setOrigin(0.5);
        
        // Animate title with glow effect
        titleText.setScale(0);
        this.scene.tweens.add({
            targets: titleText,
            scaleX: 1,
            scaleY: 1,
            duration: 500,
            delay: 200,
            ease: 'Elastic.easeOut'
        });
        
        // Create weapon sprites for fusion animation
        const firstWeaponKey = this.getWeaponAssetKey(firstWeapon);
        const secondWeaponKey = this.getWeaponAssetKey(secondWeapon);
        const combinedWeaponKey = this.getWeaponAssetKey(combinedWeapon);
        
        console.log(`Weapon assets: ${firstWeaponKey}, ${secondWeaponKey} -> ${combinedWeaponKey}`);
        
        // Position weapons far apart initially
        const leftWeapon = this.scene.add.image(-200, 0, firstWeaponKey)
            .setScale(FUSION_ANIMATION.WEAPON_SCALE)
            .setAlpha(0);
        const rightWeapon = this.scene.add.image(200, 0, secondWeaponKey)
            .setScale(FUSION_ANIMATION.WEAPON_SCALE)
            .setAlpha(0);
        
        // Create combined weapon (hidden initially)
        const resultWeapon = this.scene.add.image(0, 0, combinedWeaponKey)
            .setScale(0)
            .setAlpha(0);
        
        // Add glow effects to weapons
        const leftGlow = this.scene.add.circle(-200, 0, 40, 0x00FFFF, 0.3);
        const rightGlow = this.scene.add.circle(200, 0, 40, 0xFF6B6B, 0.3);
        const resultGlow = this.scene.add.circle(0, 0, 60, 0xFFD700, 0.5).setScale(0);
        
        this.combinationContainer.add([
            background, titleText, leftGlow, rightGlow, resultGlow,
            leftWeapon, rightWeapon, resultWeapon
        ]);
        
        // Ensure the container is visible and has proper depth
        this.combinationContainer.setVisible(true);
        this.combinationContainer.setDepth(UI_DEPTH + 10); // Extra high depth
        this.combinationContainer.setAlpha(1); // Start visible instead of 0
        
        console.log("Combination container setup complete, starting animation...");
        
        // Start the fusion animation sequence
        this.startFusionAnimation(leftWeapon, rightWeapon, resultWeapon, leftGlow, rightGlow, resultGlow, firstWeapon, secondWeapon, combinedWeapon);
    }
    
    private startFusionAnimation(
        leftWeapon: Phaser.GameObjects.Image, 
        rightWeapon: Phaser.GameObjects.Image, 
        resultWeapon: Phaser.GameObjects.Image,
        leftGlow: Phaser.GameObjects.Arc,
        rightGlow: Phaser.GameObjects.Arc,
        resultGlow: Phaser.GameObjects.Arc,
        firstWeapon: AttackType, 
        secondWeapon: AttackType, 
        combinedWeapon: AttackType
    ): void {
        console.log("Starting fusion animation phases...");
        
        // Get camera position for proper relative positioning
        const camera = this.scene.cameras.main;
        const { height } = this.scene.scale;
        
        // Phase 1: Container and weapons appear
        console.log("Phase 1: Container appears");
        this.scene.tweens.add({
            targets: this.combinationContainer,
            alpha: 1,
            y: camera.scrollY + height / 2 - 50, // Position relative to camera
            duration: 400,
            ease: 'Power2.easeOut',
            onComplete: () => {
                console.log("Phase 2: Weapons fade in");
                // Phase 2: Weapons fade in with rotation
                this.scene.tweens.add({
                    targets: [leftWeapon, rightWeapon],
                    alpha: 1,
                    rotation: Math.PI * 2,
                    duration: 600,
                    ease: 'Power2.easeOut'
                });
                
                // Glow pulse animation
                this.scene.tweens.add({
                    targets: [leftGlow, rightGlow],
                    scale: { from: 1, to: 1.5 },
                    alpha: { from: 0.3, to: 0.6 },
                    duration: 500,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
                
                // Phase 3: Move weapons towards center with energy streams
                this.scene.time.delayedCall(800, () => {
                    console.log("Phase 3: Weapons moving to center");
                    this.createEnergyStreams(leftWeapon.x, leftWeapon.y, rightWeapon.x, rightWeapon.y);
                    
                    this.scene.tweens.add({
                        targets: [leftWeapon, leftGlow],
                        x: -50,
                        rotation: leftWeapon.rotation + Math.PI,
                        duration: FUSION_ANIMATION.WEAPON_MOVE_DURATION,
                        ease: 'Power2.easeInOut'
                    });
                    
                    this.scene.tweens.add({
                        targets: [rightWeapon, rightGlow],
                        x: 50,
                        rotation: rightWeapon.rotation - Math.PI,
                        duration: FUSION_ANIMATION.WEAPON_MOVE_DURATION,
                        ease: 'Power2.easeInOut',
                        onComplete: () => {
                            console.log("Phase 4: Starting merge effect");
                            // Phase 4: Merge effect
                            this.createMergeEffect(leftWeapon, rightWeapon, resultWeapon, leftGlow, rightGlow, resultGlow, firstWeapon, secondWeapon, combinedWeapon);
                        }
                    });
                });
            }
        });
    }
    
    private createEnergyStreams(x1: number, y1: number, x2: number, y2: number): void {
        for (let i = 0; i < FUSION_ANIMATION.ENERGY_STREAM_COUNT; i++) {
            const delay = i * 50;
            
            this.scene.time.delayedCall(delay, () => {
                // Create energy particle that travels between weapons
                const energy = this.scene.add.circle(x1, y1, 3, 0x00FFFF, 0.8);
                energy.setBlendMode(Phaser.BlendModes.ADD);
                this.combinationContainer.add(energy);
                
                this.scene.tweens.add({
                    targets: energy,
                    x: x2,
                    y: y2,
                    scale: { from: 1, to: 0.1 },
                    alpha: { from: 0.8, to: 0 },
                    duration: 400,
                    ease: 'Power2.easeOut',
                    onComplete: () => {
                        energy.destroy();
                    }
                });
                
                // Reverse energy stream
                const reverseEnergy = this.scene.add.circle(x2, y2, 3, 0xFF6B6B, 0.8);
                reverseEnergy.setBlendMode(Phaser.BlendModes.ADD);
                this.combinationContainer.add(reverseEnergy);
                
                this.scene.tweens.add({
                    targets: reverseEnergy,
                    x: x1,
                    y: y1,
                    scale: { from: 1, to: 0.1 },
                    alpha: { from: 0.8, to: 0 },
                    duration: 400,
                    delay: 100,
                    ease: 'Power2.easeOut',
                    onComplete: () => {
                        reverseEnergy.destroy();
                    }
                });
            });
        }
    }
    
    private createMergeEffect(
        leftWeapon: Phaser.GameObjects.Image, 
        rightWeapon: Phaser.GameObjects.Image, 
        resultWeapon: Phaser.GameObjects.Image,
        leftGlow: Phaser.GameObjects.Arc,
        rightGlow: Phaser.GameObjects.Arc,
        resultGlow: Phaser.GameObjects.Arc,
        firstWeapon: AttackType, 
        secondWeapon: AttackType, 
        combinedWeapon: AttackType
    ): void {
        // Create brilliant flash effect
        const flash = this.scene.add.circle(0, 0, 100, 0xFFFFFF, 0.8);
        flash.setBlendMode(Phaser.BlendModes.ADD);
        this.combinationContainer.add(flash);
        
        // Flash animation
        this.scene.tweens.add({
            targets: flash,
            scale: { from: 0.1, to: 3 },
            alpha: { from: 0.8, to: 0 },
            duration: 500,
            ease: 'Power3.easeOut',
            onComplete: () => {
                flash.destroy();
            }
        });
        
        // Create massive particle burst at merge point
        this.createFusionParticles(0, 0);
        
        // Weapons merge and disappear
        this.scene.tweens.add({
            targets: [leftWeapon, rightWeapon],
            x: 0,
            y: 0,
            scale: 0.1,
            alpha: 0,
            rotation: `+=${Math.PI * 3}`,
            duration: FUSION_ANIMATION.MERGE_PAUSE_DURATION,
            ease: 'Power3.easeIn',
            onComplete: () => {
                leftWeapon.setVisible(false);
                rightWeapon.setVisible(false);
                
                // Hide old glows
                leftGlow.setVisible(false);
                rightGlow.setVisible(false);
                
                // Reveal the result weapon with dramatic effect
                this.revealResultWeapon(resultWeapon, resultGlow, firstWeapon, secondWeapon, combinedWeapon);
            }
        });
    }
    
    private createFusionParticles(x: number, y: number): void {
        const worldX = this.combinationContainer.x + x;
        const worldY = this.combinationContainer.y + y;
        
        // Main fusion burst
        const fusionBurst = this.scene.add.particles(worldX, worldY, 'white_pixel', {
            speed: { min: 100, max: 300 },
            scale: { start: 1, end: 0 },
            blendMode: 'ADD',
            tint: [0xFFD700, 0x00FFFF, 0xFF6B6B, 0xFFFFFF],
            lifespan: 1500,
            quantity: 3,
            frequency: 20,
            emitting: true
        });
        fusionBurst.setDepth(UI_DEPTH + 2);
        
        // Swirling energy particles
        const energySwirl = this.scene.add.particles(worldX, worldY, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            tint: [0x00FFFF, 0xFFD700],
            lifespan: 2000,
            quantity: 2,
            frequency: 30,
            emitting: true,
            gravityY: -50,
            rotate: { min: 0, max: 360 }
        });
        energySwirl.setDepth(UI_DEPTH + 1);
        
        // Stop particles after animation
        this.scene.time.delayedCall(1000, () => {
            fusionBurst.stop();
            energySwirl.stop();
        });
        
        this.scene.time.delayedCall(3000, () => {
            fusionBurst.destroy();
            energySwirl.destroy();
        });
    }
    
    private revealResultWeapon(
        resultWeapon: Phaser.GameObjects.Image,
        resultGlow: Phaser.GameObjects.Arc,
        firstWeapon: AttackType, 
        secondWeapon: AttackType, 
        combinedWeapon: AttackType
    ): void {
        const firstWeaponName = this.getWeaponDisplayName(firstWeapon);
        const secondWeaponName = this.getWeaponDisplayName(secondWeapon);
        const combinedWeaponName = this.getWeaponDisplayName(combinedWeapon);
        
        // Create result text
        const resultText = this.scene.add.text(0, 80, `${firstWeaponName} + ${secondWeaponName}`, {
            fontFamily: 'Arial', 
            fontSize: '18px', 
            color: '#CCCCCC', 
            align: 'center'
        }).setOrigin(0.5).setAlpha(0);
        
        const transformText = this.scene.add.text(0, 100, "▼ TRANSFORMS INTO ▼", {
            fontFamily: 'Arial', 
            fontSize: '14px', 
            color: '#FFD700', 
            align: 'center'
        }).setOrigin(0.5).setAlpha(0);
        
        const newWeaponText = this.scene.add.text(0, 130, combinedWeaponName, {
            fontFamily: 'Arial Black', 
            fontSize: '28px', 
            color: '#00FFFF', 
            stroke: '#000000', 
            strokeThickness: 4,
            fontStyle: 'bold'
        }).setOrigin(0.5).setAlpha(0);
        
        this.combinationContainer.add([resultText, transformText, newWeaponText]);
        
        // Dramatic weapon reveal
        resultWeapon.setAlpha(1);
        resultGlow.setAlpha(1);
        
        this.scene.tweens.add({
            targets: [resultWeapon, resultGlow],
            scale: { from: 0, to: 1.5 },
            duration: FUSION_ANIMATION.RESULT_REVEAL_DURATION,
            ease: 'Elastic.easeOut',
            onComplete: () => {
                // Scale back to normal size
                this.scene.tweens.add({
                    targets: resultWeapon,
                    scale: 1.2,
                    duration: 300,
                    ease: 'Power2.easeOut'
                });
                
                // Pulsing glow effect
                this.scene.tweens.add({
                    targets: resultGlow,
                    scale: { from: 1.5, to: 2 },
                    alpha: { from: 0.5, to: 0.2 },
                    duration: 1000,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        });
        
        // Fade in text elements sequentially
        this.scene.tweens.add({
            targets: resultText,
            alpha: 1,
            y: 70,
            duration: 400,
            delay: 200,
            ease: 'Power2.easeOut'
        });
        
        this.scene.tweens.add({
            targets: transformText,
            alpha: 1,
            duration: 400,
            delay: 600,
            ease: 'Power2.easeOut'
        });
        
        this.scene.tweens.add({
            targets: newWeaponText,
            alpha: 1,
            scale: { from: 0.5, to: 1 },
            duration: 500,
            delay: 1000,
            ease: 'Back.easeOut'
        });
        
        // Final celebration particles around result weapon
        this.scene.time.delayedCall(1200, () => {
            this.createCelebrationParticles(resultWeapon.x, resultWeapon.y);
        });
        
        // Auto-hide after extended duration
        this.scene.time.delayedCall(6000, () => {
            this.scene.tweens.add({
                targets: this.combinationContainer,
                alpha: 0,
                y: this.combinationContainer.y - 100,
                duration: 800,
                ease: 'Power2.easeIn',
                onComplete: () => {
                    this.combinationContainer.setVisible(false);
                }
            });
        });
    }
    
    private createCelebrationParticles(x: number, y: number): void {
        const worldX = this.combinationContainer.x + x;
        const worldY = this.combinationContainer.y + y;
        
        // Golden sparkles around the new weapon
        const celebration = this.scene.add.particles(worldX, worldY, 'white_pixel', {
            speed: { min: 30, max: 80 },
            scale: { start: 0.8, end: 0 },
            blendMode: 'ADD',
            tint: [0xFFD700, 0xFFA500, 0xFFFF00],
            lifespan: 2000,
            quantity: 1,
            frequency: 100,
            emitting: true,
            gravityY: -20,
            alpha: { start: 0.8, end: 0 }
        });
        celebration.setDepth(UI_DEPTH + 3);
        
        // Stop and cleanup
        this.scene.time.delayedCall(3000, () => {
            celebration.stop();
        });
        
        this.scene.time.delayedCall(5000, () => {
            celebration.destroy();
        });
    }
    
    // Update the simple particle method to be more spectacular
    private createCombinationParticles(x: number, y: number): void {
        // This method is kept for backward compatibility but enhanced
        this.createCelebrationParticles(x, y);
    }

    // ------ Helper Methods for Weapon Information ------
    
    private getWeaponAssetKey(weaponType: AttackType): string {
        // Handle AttackType objects by accessing their tag property
        const weaponTag = typeof weaponType === 'object' && weaponType.tag ? weaponType.tag : weaponType;
        return WEAPON_ASSET_MAP[weaponTag] || 'white_pixel';
    }
    
    private getWeaponDisplayName(weaponType: AttackType): string {
        // Handle AttackType objects by accessing their tag property
        const weaponTag = typeof weaponType === 'object' && weaponType.tag ? weaponType.tag : weaponType;
        return WEAPON_NAME_MAP[weaponTag] || 'Unknown Weapon';
    }

    // ------ Debug and Safety Methods ----__
    
    /**
     * Force the combination container to be visible for debugging
     */
    public forceCombinationVisible(): void {
        console.log("Forcing combination container visibility...");
        
        const camera = this.scene.cameras.main;
        const { width, height } = this.scene.scale;
        
        // Position in the center of the screen
        this.combinationContainer.x = camera.scrollX + width / 2;
        this.combinationContainer.y = camera.scrollY + height / 2;
        
        // Force visibility and high depth
        this.combinationContainer.setVisible(true);
        this.combinationContainer.setAlpha(1);
        this.combinationContainer.setDepth(UI_DEPTH + 20);
        
        console.log(`Combination container forced to position: ${this.combinationContainer.x}, ${this.combinationContainer.y}`);
        console.log(`Combination container properties: visible=${this.combinationContainer.visible}, alpha=${this.combinationContainer.alpha}, depth=${this.combinationContainer.depth}`);
    }
    
    /**
     * Check if the combination container is properly set up
     */
    public debugCombinationContainer(): void {
        console.log("=== Combination Container Debug Info ===");
        console.log(`Container exists: ${!!this.combinationContainer}`);
        console.log(`Container visible: ${this.combinationContainer?.visible}`);
        console.log(`Container alpha: ${this.combinationContainer?.alpha}`);
        console.log(`Container depth: ${this.combinationContainer?.depth}`);
        console.log(`Container position: x=${this.combinationContainer?.x}, y=${this.combinationContainer?.y}`);
        console.log(`Container children count: ${this.combinationContainer?.list?.length || 0}`);
        
        const camera = this.scene.cameras.main;
        if (camera) {
            console.log(`Camera position: scrollX=${camera.scrollX}, scrollY=${camera.scrollY}`);
            console.log(`Camera size: width=${camera.width}, height=${camera.height}`);
        }
        
        // Check if container is within camera bounds
        if (this.combinationContainer && camera) {
            const containerInView = (
                this.combinationContainer.x >= camera.scrollX - 100 &&
                this.combinationContainer.x <= camera.scrollX + camera.width + 100 &&
                this.combinationContainer.y >= camera.scrollY - 100 &&
                this.combinationContainer.y <= camera.scrollY + camera.height + 100
            );
            console.log(`Container in camera view: ${containerInView}`);
        }
        console.log("=== End Debug Info ===");
    }

    // ------ UI Visibility Methods ------
    
    public showUpgradeUI(): void {
        this.isVisible = true;
        this.upgradeContainer.setVisible(true);
    }

    public hideUpgradeUI(): void {
        this.isVisible = false;
        this.upgradeContainer.setVisible(false);
    }
    
    // Alias methods for backward compatibility
    public show(): void {
        this.showUpgradeUI();
    }

    public hide(): void {
        this.hideUpgradeUI();
    }

    public destroy(): void {
        this.keyListeners.forEach(key => key.destroy());
        this.cards.forEach(card => card.destroy());
        this.upgradeContainer.destroy();
        this.combinationContainer.destroy();
    }
}