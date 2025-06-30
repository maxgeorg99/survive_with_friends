import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';

const ALERT_DURATION = 2000; // How long the alert stays visible (5 seconds - increased from 3)
const ALERT_FADE_IN_DURATION = 600; // How long the alert fades in (1 second)
const ALERT_FADE_OUT_DURATION = 1200; // How long the alert fades out (1.5 seconds)
const ARROW_OFFSET_X_FROM_PLAYER = 8; // Offset from player to show arrow
const ARROW_OFFSET_Y_FROM_PLAYER = 84; // Distance below player to show arrow
const ARROW_SIZE = 0.6; // Scale of the arrow
const UI_DEPTH = 100000; // High depth to ensure UI stays on top

export default class VoidChestUI {
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    
    // UI elements
    private alertContainer: Phaser.GameObjects.Container | null = null;
    private voidArrow: Phaser.GameObjects.Image | null = null;
    
    // Tracking
    private alertTween: Phaser.Tweens.Tween | null = null;
    private lastKnownPlayerPosition: { x: number, y: number } = { x: 0, y: 0 };

    constructor(scene: Phaser.Scene, spacetimeDBClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = spacetimeDBClient;
        
        console.log("VoidChestUI initialized");
    }

    /**
     * Show the "Void Chest Conjured!" alert
     */
    public showVoidChestAlert(): void {
        console.log("Showing Void Chest alert");
        
        // Clear any existing alert
        this.clearAlert();
        
        const { width, height } = this.scene.scale;
        
        // Create alert container
        this.alertContainer = this.scene.add.container(width / 2, height / 3);
        this.alertContainer.setDepth(UI_DEPTH);
        this.alertContainer.setScrollFactor(0); // Fix to camera
        
        // Create dark background for the alert
        const alertBg = this.scene.add.rectangle(0, 0, 400, 80, 0x000000, 0.8);
        alertBg.setStrokeStyle(3, 0x800080, 1); // Purple border
        
        // Create the main alert text
        const alertText = this.scene.add.text(0, -10, "VOID CHEST CONJURED!", {
            fontFamily: 'Arial',
            fontSize: '28px',
            color: '#9966ff', // Purple color
            stroke: '#000000',
            strokeThickness: 4,
            fontStyle: 'bold',
            align: 'center'
        }).setOrigin(0.5);
        
        // Create subtitle text
        const subtitleText = this.scene.add.text(0, 20, "A treasure awaits...", {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: '#cccccc', // Light gray
            stroke: '#000000',
            strokeThickness: 2,
            fontStyle: 'italic',
            align: 'center'
        }).setOrigin(0.5);
        
        // Add elements to container
        this.alertContainer.add([alertBg, alertText, subtitleText]);
        
        // Start invisible
        this.alertContainer.setAlpha(0);
        
        // Animate the alert in
        this.alertTween = this.scene.tweens.add({
            targets: this.alertContainer,
            alpha: 1,
            scale: { from: 0.8, to: 1 },
            duration: ALERT_FADE_IN_DURATION,
            ease: 'Back.easeOut',
            onComplete: () => {
                // After showing, wait longer then fade out more gradually
                this.scene.time.delayedCall(ALERT_DURATION, () => {
                    this.hideAlert();
                });
            }
        });
        
        // Add pulsing effect to the main text
        this.scene.tweens.add({
            targets: alertText,
            scale: { from: 1, to: 1.05 },
            duration: 800,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1
        });
    }
    
    /**
     * Hide the alert with fade out animation
     */
    private hideAlert(): void {
        if (this.alertContainer) {
            // Stop any existing alert tween
            if (this.alertTween) {
                this.alertTween.stop();
                this.alertTween = null;
            }
            
            // Fade out
            this.scene.tweens.add({
                targets: this.alertContainer,
                alpha: { from: 1, to: 0 },
                scale: { from: 1, to: 0.8 },
                duration: ALERT_FADE_OUT_DURATION, // Increased from 500 for smoother fade
                ease: 'Power2.easeIn',
                onComplete: () => {
                    this.clearAlert();
                }
            });
        }
    }

    private clearAlert(): void {
        if (this.alertContainer) {
            this.alertContainer.destroy();
            this.alertContainer = null;
        }
    }
    
    /**
     * Update the void arrow to point to the nearest VoidChest
     * Call this from GameScene's update loop
     */
    public update(): void {
        if (!this.spacetimeDBClient?.sdkConnection?.db) return;
        
        // Get local player position
        const localPlayerSprite = this.scene.registry.get('localPlayerSprite') as Phaser.Physics.Arcade.Sprite;
        if (!localPlayerSprite) return;
        
        this.lastKnownPlayerPosition = { x: localPlayerSprite.x, y: localPlayerSprite.y };
        
        // Find all VoidChests
        const voidChests = Array.from(this.spacetimeDBClient.sdkConnection.db.monsters.iter())
            .filter(monster => {
                const monsterType = monster.bestiaryId?.tag || monster.bestiaryId;
                return monsterType === 'VoidChest';
            });
        
        if (voidChests.length === 0) {
            // No VoidChests exist, hide arrow
            this.hideArrow();
            return;
        }
        
        // Find the nearest VoidChest
        let nearestChest = null;
        let nearestDistance = Infinity;
        
        for (const chest of voidChests) {
            // Get chest position from boid data
            const boid = this.spacetimeDBClient.sdkConnection.db.monstersBoid.monsterId.find(chest.monsterId);
            if (boid) {
                const distance = Phaser.Math.Distance.Between(
                    localPlayerSprite.x, localPlayerSprite.y,
                    boid.position.x, boid.position.y
                );
                
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestChest = boid;
                }
            }
        }
        
        if (nearestChest) {
            this.showArrow(nearestChest.position.x, nearestChest.position.y);
        } else {
            this.hideArrow();
        }
    }
    
    /**
     * Show and update the arrow pointing to the VoidChest
     */
    private showArrow(chestX: number, chestY: number): void {
        const playerX = this.lastKnownPlayerPosition.x;
        const playerY = this.lastKnownPlayerPosition.y;
        
        // Create arrow if it doesn't exist
        if (!this.voidArrow) {
            this.voidArrow = this.scene.add.image(0, 0, 'void_arrow');
            this.voidArrow.setScale(ARROW_SIZE);
            this.voidArrow.setDepth(UI_DEPTH - 1); // Just below other UI elements
            this.voidArrow.setTint(0x9966ff); // Purple tint
            
            // Add a subtle pulsing effect
            this.scene.tweens.add({
                targets: this.voidArrow,
                alpha: { from: 0.7, to: 1.0 },
                duration: 1000,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1
            });
        }
        
        // Position arrow below player
        this.voidArrow.setPosition(playerX + ARROW_OFFSET_X_FROM_PLAYER, playerY + ARROW_OFFSET_Y_FROM_PLAYER);
        
        // Calculate angle to point toward chest
        const angle = Phaser.Math.Angle.Between(playerX, playerY, chestX, chestY);
        this.voidArrow.setRotation(angle); // Removed the + Math.PI / 2 offset
        
        // Make sure arrow is visible
        this.voidArrow.setVisible(true);
    }
    
    /**
     * Hide the arrow
     */
    private hideArrow(): void {
        if (this.voidArrow) {
            this.voidArrow.setVisible(false);
        }
    }
    
    /**
     * Clean up when scene shuts down
     */
    public destroy(): void {
        console.log("VoidChestUI destroying");
        
        // Clean up alert
        this.hideAlert();
        
        // Clean up arrow
        if (this.voidArrow) {
            this.voidArrow.destroy();
            this.voidArrow = null;
        }
        
        // Stop any running tweens
        if (this.alertTween) {
            this.alertTween.stop();
            this.alertTween = null;
        }
        
        console.log("VoidChestUI destroyed");
    }
} 