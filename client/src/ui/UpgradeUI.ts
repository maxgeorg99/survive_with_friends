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

// Card hold state interface
interface CardHoldState {
    isHolding: boolean;
    holdStartTime: number;
    holdTimer: Phaser.Time.TimerEvent | null;
    progressBar: Phaser.GameObjects.Rectangle | null;
    progressBarBackground: Phaser.GameObjects.Rectangle | null;
}

// Constants
const CARD_WIDTH = 200;
const CARD_HEIGHT = 260;
const CARD_SPACING = 20;
const CARD_SCALE = 0.8;
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements

// Hold mechanic constants
const HOLD_DURATION_MS = 400; // Time required to hold for selection (800ms)
const PROGRESS_BAR_WIDTH = CARD_WIDTH * CARD_SCALE * 0.8;
const PROGRESS_BAR_HEIGHT = 8;
const PROGRESS_BAR_Y_OFFSET = (CARD_HEIGHT * CARD_SCALE) / 2 - 35; // Moved down slightly more
const NUMBER_TEXT_Y_OFFSET = (CARD_HEIGHT * CARD_SCALE) / 2 + 5; // Moved up closer to cards (was +15, now +5)

// Define upgrade icon mapping
const UPGRADE_ICON_MAP: { [key: string]: string } = {
    'MaxHp': 'upgrade_maxHP',
    'HpRegen': 'upgrade_regenHP',
    'Speed': 'upgrade_speed',
    'Armor': 'upgrade_armor',
    'AttackSword': 'attack_sword',
    'AttackWand': 'attack_wand',
    'AttackKnives': 'attack_knife',
    'AttackShield': 'attack_shield'
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
    private chooseUpgradeText: Phaser.GameObjects.Text | null = null;
    
    // Hold state tracking for each card
    private cardHoldStates: CardHoldState[] = [];
    
    // Track which pointers are being handled by UI to prevent movement
    private handledPointers: Set<number> = new Set();

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient, localPlayerId: number) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.localPlayerId = localPlayerId;
        
        // Create container for all upgrade UI elements
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(UI_DEPTH);
        
        // Create keyboard input for number keys 1-3
        this.keyListeners = [
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
            this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.THREE)
        ].filter((key): key is Phaser.Input.Keyboard.Key => key !== undefined);

        // Create "Choose an upgrade" text - moved back down for proper distance from character
        this.chooseUpgradeText = this.scene.add.text(0, -CARD_HEIGHT / 2 - 30, "Choose an upgrade", {
            fontSize: '24px',
            fontFamily: 'Arial',
            color: '#ffff00', // Yellow color to make it stand out
            stroke: '#000000',
            strokeThickness: 4,
        });
        this.chooseUpgradeText.setOrigin(0.5);
        this.container.add(this.chooseUpgradeText);

        // Create reroll text with instruction - also moved down to maintain spacing
        this.rerollText = this.scene.add.text(0, -CARD_HEIGHT / 2, "Press R to reroll (Available: 0)", {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.rerollText.setOrigin(0.5);
        this.container.add(this.rerollText);

        console.log('UpgradeUI initialized with hold mechanics');
    }

    public update(time: number, delta: number): void {
        if (!this.isVisible) return;

        // Position the container at the bottom of the camera - moved up to be closer to text
        const camera = this.scene.cameras.main;
        if (camera) {
            this.container.setPosition(
                camera.scrollX + camera.width / 2,
                camera.scrollY + camera.height - CARD_HEIGHT / 2 - 60 // Moved up from -20 to -60
            );
        }

        // Update reroll text if player data is available
        if (this.rerollText && this.spacetimeClient.sdkConnection?.db) {
            const player = this.spacetimeClient.sdkConnection.db.player.playerId.find(this.localPlayerId);
            if (player && player.rerolls !== undefined) {
                this.rerollText.setText(`Press R to reroll (Available: ${player.rerolls})`);
                this.rerollText.setVisible(this.isVisible);
            }
        }

        // Update progress bars for cards being held
        this.cardHoldStates.forEach((holdState, index) => {
            if (holdState.isHolding && holdState.progressBar && holdState.holdStartTime > 0) {
                const elapsed = time - holdState.holdStartTime;
                const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
                
                // Update progress bar width
                holdState.progressBar.width = PROGRESS_BAR_WIDTH * progress;
                
                // Change color as it progresses
                if (progress < 0.3) {
                    holdState.progressBar.fillColor = 0xff4444; // Red
                } else if (progress < 0.7) {
                    holdState.progressBar.fillColor = 0xffaa00; // Orange
                } else {
                    holdState.progressBar.fillColor = 0x44ff44; // Green
                }
                
                // Complete selection if progress is full
                if (progress >= 1) {
                    this.completeHoldSelection(index);
                }
            }
        });

        // Check for number key presses (immediate selection)
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
            this.show();
            console.log("UpgradeUI shown with options");
        } else {
            this.hide();
            console.log("UpgradeUI hidden - no options");
        }
    }

    private createUpgradeCards(): void {
        // Clear any existing cards and hold states
        this.cards.forEach(card => card.destroy());
        this.cards = [];
        this.cardHoldStates = [];

        // Calculate total width of all cards with spacing
        const totalWidth = (this.upgradeOptions.length * CARD_WIDTH) + ((this.upgradeOptions.length - 1) * CARD_SPACING);
        const startX = -totalWidth / 2 + CARD_WIDTH / 2;

        // Create a card for each option - moved up closer to text
        this.upgradeOptions.forEach((option, index) => {
            const x = startX + (index * (CARD_WIDTH + CARD_SPACING));
            const card = this.createCard(x, -20, option, index); // Moved up from y=0 to y=-30
            this.cards.push(card);
            this.container.add(card);
            
            // Initialize hold state for this card
            this.cardHoldStates.push({
                isHolding: false,
                holdStartTime: 0,
                holdTimer: null,
                progressBar: null,
                progressBarBackground: null
            });
        });
    }

    private createCard(x: number, y: number, option: UpgradeOptionData, index: number): Phaser.GameObjects.Container {
        const card = this.scene.add.container(x, y);
        
        // Card background
        const background = this.scene.add.image(0, 0, 'card_blank');
        background.setScale(CARD_SCALE);
        card.add(background);
        
        // Create progress bar background (initially hidden)
        const progressBarBackground = this.scene.add.rectangle(
            0, 
            PROGRESS_BAR_Y_OFFSET, 
            PROGRESS_BAR_WIDTH, 
            PROGRESS_BAR_HEIGHT, 
            0x333333, 
            0.8
        );
        progressBarBackground.setVisible(false);
        card.add(progressBarBackground);
        
        // Create progress bar (initially hidden)
        const progressBar = this.scene.add.rectangle(
            -PROGRESS_BAR_WIDTH / 2, 
            PROGRESS_BAR_Y_OFFSET, 
            0, 
            PROGRESS_BAR_HEIGHT, 
            0xff4444, 
            1
        );
        progressBar.setOrigin(0, 0.5);
        progressBar.setVisible(false);
        card.add(progressBar);
        
        // Store progress bar references
        this.cardHoldStates[index] = {
            isHolding: false,
            holdStartTime: 0,
            holdTimer: null,
            progressBar: progressBar,
            progressBarBackground: progressBarBackground
        };
        
        // Make card interactive with proper input consumption
        background.setInteractive({ useHandCursor: true });
        
        // Hover effects
        background.on('pointerover', () => {
            background.setTint(0xdddddd);
            console.log(`Hovering over upgrade card ${index + 1}`);
        });
        
        background.on('pointerout', () => {
            background.clearTint();
            // Cancel hold if pointer leaves the card
            this.cancelHold(index);
        });
        
        // CRITICAL: Use input manager to consume pointer events properly
        background.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            console.log(`Pointer down on upgrade card ${index + 1}, pointerId: ${pointer.id}`);
            
            // Mark this pointer as handled by UI
            this.handledPointers.add(pointer.id);
            
            // Stop this pointer from being processed by other input handlers
            this.scene.input.stopPropagation();
            
            this.startHold(index);
            console.log(`Started holding upgrade card ${index + 1}`);
        });
        
        background.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            console.log(`Pointer up on upgrade card ${index + 1}, pointerId: ${pointer.id}`);
            
            // Remove this pointer from handled set
            this.handledPointers.delete(pointer.id);
            
            this.cancelHold(index);
            console.log(`Released upgrade card ${index + 1}`);
        });
        
        // Also handle pointer leave to clean up handled pointers
        background.on('pointerout', (pointer: Phaser.Input.Pointer) => {
            this.handledPointers.delete(pointer.id);
        });
        
        // Add number text (1, 2, or 3) - made smaller
        const numberText = this.scene.add.text(0, NUMBER_TEXT_Y_OFFSET, `${index + 1}`, {
            fontSize: '36px', // Reduced from 48px to 36px
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3 // Reduced stroke thickness too
        });
        numberText.setOrigin(0.5);
        card.add(numberText);
        
        // Get the appropriate icon based on upgrade type
        const upgradeType = option.upgradeType.tag;
        const iconKey = UPGRADE_ICON_MAP[upgradeType] || 'white_pixel';
        
        // Add upgrade icon
        const icon = this.scene.add.image(0, -20, iconKey);
        icon.setScale(0.8);
        card.add(icon);
        
        // Create upgrade text
        let upgradeText = this.getUpgradeDescription(option);
        const descText = this.scene.add.text(0, background.height * CARD_SCALE * 0.28, upgradeText, {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center',
            wordWrap: { width: background.width * CARD_SCALE * 0.8 }
        });
        descText.setOrigin(0.5);
        card.add(descText);
        
        return card;
    }
    
    private startHold(index: number): void {
        if (index >= this.cardHoldStates.length) return;
        
        const holdState = this.cardHoldStates[index];
        holdState.isHolding = true;
        holdState.holdStartTime = this.scene.time.now;
        
        // Show progress bars
        if (holdState.progressBar && holdState.progressBarBackground) {
            holdState.progressBarBackground.setVisible(true);
            holdState.progressBar.setVisible(true);
            holdState.progressBar.width = 0; // Reset width
        }
        
        // Add visual feedback to the card
        const card = this.cards[index];
        if (card) {
            // Add a subtle glow effect while holding
            this.scene.tweens.add({
                targets: card,
                scaleX: 1.05,
                scaleY: 1.05,
                duration: 100,
                ease: 'Power2'
            });
        }
    }
    
    private cancelHold(index: number): void {
        if (index >= this.cardHoldStates.length) return;
        
        const holdState = this.cardHoldStates[index];
        holdState.isHolding = false;
        holdState.holdStartTime = 0;
        
        // Clear any existing timer
        if (holdState.holdTimer) {
            holdState.holdTimer.destroy();
            holdState.holdTimer = null;
        }
        
        // Hide progress bars
        if (holdState.progressBar && holdState.progressBarBackground) {
            holdState.progressBarBackground.setVisible(false);
            holdState.progressBar.setVisible(false);
        }
        
        // Reset card scale
        const card = this.cards[index];
        if (card) {
            this.scene.tweens.add({
                targets: card,
                scaleX: 1,
                scaleY: 1,
                duration: 100,
                ease: 'Power2'
            });
        }
    }
    
    private completeHoldSelection(index: number): void {
        // Cancel the hold state first
        this.cancelHold(index);
        
        // Flash the card to indicate selection
        const card = this.cards[index];
        if (card) {
            this.scene.tweens.add({
                targets: card,
                alpha: 0.5,
                duration: 100,
                yoyo: true,
                repeat: 1,
                onComplete: () => {
                    // Select the upgrade after the flash
                    this.chooseUpgrade(index);
                }
            });
        } else {
            // Fallback if card doesn't exist
            this.chooseUpgrade(index);
        }
        
        console.log(`Completed hold selection for upgrade card ${index + 1}`);
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
        console.log("Showing UpgradeUI");
        this.isVisible = true;
        this.container.setVisible(true);
    }

    public hide(): void {
        console.log("Hiding UpgradeUI");
        this.isVisible = false;
        this.container.setVisible(false);
        
        // Cancel any active holds when hiding
        this.cardHoldStates.forEach((_, index) => {
            this.cancelHold(index);
        });
        
        // Clear all handled pointers when hiding
        this.handledPointers.clear();
    }

    public destroy(): void {
        // Cancel all holds and clean up timers
        this.cardHoldStates.forEach((_, index) => {
            this.cancelHold(index);
        });
        
        // Clear handled pointers
        this.handledPointers.clear();
        
        this.keyListeners.forEach(key => key.destroy());
        this.cards.forEach(card => card.destroy());
        this.container.destroy();
    }

    // Add method to check if a pointer is handled by UI
    public isPointerHandledByUI(pointerId: number): boolean {
        return this.handledPointers.has(pointerId);
    }
}