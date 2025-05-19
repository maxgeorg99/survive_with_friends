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
const UI_DEPTH = 100000;
const MOBILE_BOTTOM_MARGIN = 5;
const DESKTOP_BOTTOM_MARGIN = 20;

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

// Weapon asset mapping for combinations
const WEAPON_ASSET_MAP: Partial<Record<number, string>> = {
    [AttackType.Sword]: 'attack_sword',
    [AttackType.Wand]: 'attack_wand',
    [AttackType.Knives]: 'attack_knife',
    [AttackType.Shield]: 'attack_shield',
    [AttackType.Football]: 'attack_football',
    [AttackType.Cards]: 'attack_cards',
    [AttackType.Dumbbell]: 'attack_dumbbell',
    [AttackType.Garlic]: 'attack_garlic',
    [AttackType.Shuriken]: 'attack_shuriken',
    [AttackType.FireSword]: 'attack_fire_sword',
    [AttackType.HolyHammer]: 'attack_holy_hammer',
    [AttackType.MagicDagger]: 'attack_magic_dagger',
    [AttackType.ThrowingShield]: 'attack_throwing_shield',
    [AttackType.EnergyOrb]: 'attack_energy_orb'
};

// Weapon name mapping for combinations
const WEAPON_NAME_MAP: Partial<Record<number, string>> = {
    [AttackType.Sword]: "Sword",
    [AttackType.Wand]: "Wand",
    [AttackType.Knives]: "Knives",
    [AttackType.Shield]: "Shield",
    [AttackType.Football]: "Football",
    [AttackType.Cards]: "Cards",
    [AttackType.Dumbbell]: "Dumbbell",
    [AttackType.Garlic]: "Garlic",
    [AttackType.Shuriken]: "Shuriken",
    [AttackType.FireSword]: "Fire Sword",
    [AttackType.HolyHammer]: "Holy Hammer",
    [AttackType.MagicDagger]: "Magic Dagger",
    [AttackType.ThrowingShield]: "Throwing Shield",
    [AttackType.EnergyOrb]: "Energy Orb"
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
        this.combinationContainer.removeAll(true);
        
        const { width, height } = this.scene.scale;
        
        this.combinationContainer.x = width / 2;
        this.combinationContainer.y = height / 2 - 100;
        
        const background = this.scene.add.rectangle(0, 0, 550, 200, 0x000000, 0.8);
        background.setStrokeStyle(4, 0xFFD700);
        
        const titleText = this.scene.add.text(0, -70, "WEAPON COMBINATION!", { 
            fontFamily: 'Arial', fontSize: '28px', color: '#FFD700', stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5);
        
        const firstWeaponName = this.getWeaponDisplayName(firstWeapon);
        const secondWeaponName = this.getWeaponDisplayName(secondWeapon);
        const combinedWeaponName = this.getWeaponDisplayName(combinedWeapon);
        
        const descText = this.scene.add.text(0, -20, `Your ${firstWeaponName} and ${secondWeaponName}\nhave combined to form:`, {
            fontFamily: 'Arial', fontSize: '20px', color: '#FFFFFF', align: 'center'
        }).setOrigin(0.5);
        
        const combinedWeaponText = this.scene.add.text(0, 40, combinedWeaponName, {
            fontFamily: 'Arial', fontSize: '32px', color: '#00FFFF', stroke: '#000000', strokeThickness: 5, fontStyle: 'bold'
        }).setOrigin(0.5);
        
        const firstWeaponKey = this.getWeaponAssetKey(firstWeapon);
        const secondWeaponKey = this.getWeaponAssetKey(secondWeapon);
        const combinedWeaponKey = this.getWeaponAssetKey(combinedWeapon);
        
        const firstWeaponIcon = this.scene.add.image(-150, 40, firstWeaponKey).setScale(0.7);
        const secondWeaponIcon = this.scene.add.image(-70, 40, secondWeaponKey).setScale(0.7);
        
        const plusSign = this.scene.add.text(-110, 40, '+', { fontFamily: 'Arial', fontSize: '32px', color: '#FFFFFF' }).setOrigin(0.5);
        const equalsSign = this.scene.add.text(-20, 40, '=', { fontFamily: 'Arial', fontSize: '32px', color: '#FFFFFF' }).setOrigin(0.5);
        const combinedWeaponIcon = this.scene.add.image(50, 40, combinedWeaponKey).setScale(1.2);
        
        this.combinationContainer.add([
            background, titleText, descText, combinedWeaponText,
            firstWeaponIcon, plusSign, secondWeaponIcon, equalsSign, combinedWeaponIcon
        ]);
        
        this.combinationContainer.setVisible(true);
        this.combinationContainer.setAlpha(0);
        
        this.scene.tweens.add({
            targets: this.combinationContainer, 
            alpha: 1, 
            y: height / 2 - 50, 
            duration: 500, 
            ease: 'Back.easeOut',
            onComplete: () => {
                this.createCombinationParticles(combinedWeaponIcon.x, combinedWeaponIcon.y);
                this.scene.time.delayedCall(4000, () => {
                    this.scene.tweens.add({
                        targets: this.combinationContainer, 
                        alpha: 0, 
                        y: height / 2 - 150, 
                        duration: 500, 
                        ease: 'Back.easeIn',
                        onComplete: () => { 
                            this.combinationContainer.setVisible(false); 
                        }
                    });
                });
            }
        });
    }
    
    private createCombinationParticles(x: number, y: number): void {
        const worldX = this.combinationContainer.x + x;
        const worldY = this.combinationContainer.y + y;
        const particles = this.scene.add.particles(worldX, worldY, 'white_pixel', {
            speed: { min: 30, max: 100 }, 
            scale: { start: 0.5, end: 0 }, 
            blendMode: 'ADD',
            tint: [0x00FFFF, 0xFFD700, 0xFFFFFF], 
            lifespan: 1000, 
            quantity: 2, 
            frequency: 50, 
            emitting: true
        });
        particles.setDepth(UI_DEPTH + 1);
        this.scene.time.delayedCall(3000, () => { particles.destroy(); });
    }
    
    private getWeaponDisplayName(attackType: AttackType): string {
        return WEAPON_NAME_MAP[attackType as unknown as number] || `Weapon ${attackType as unknown as number}`;
    }
    
    private getWeaponAssetKey(attackType: AttackType): string {
        return WEAPON_ASSET_MAP[attackType as unknown as number] || 'card_blank';
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