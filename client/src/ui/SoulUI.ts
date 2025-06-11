import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';

const ARROW_OFFSET_X_FROM_PLAYER = 8; // Offset from player to show arrow
const ARROW_OFFSET_Y_FROM_PLAYER = 84; // Distance below player to show arrow
const ARROW_SIZE = 0.6; // Scale of the arrow
const UI_DEPTH = 100000; // High depth to ensure UI stays on top

export default class SoulUI {
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    
    // UI elements
    private soulArrow: Phaser.GameObjects.Image | null = null;
    private minimapSoulIndicator: Phaser.GameObjects.Arc | null = null;
    
    // Tracking
    private lastKnownPlayerPosition: { x: number, y: number } = { x: 0, y: 0 };

    constructor(scene: Phaser.Scene, spacetimeDBClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = spacetimeDBClient;
        
        console.log("SoulUI initialized");
    }
    
    /**
     * Update the soul arrow to point to the player's soul gem
     * Call this from GameScene's update loop
     */
    public update(): void {
        if (!this.spacetimeDBClient?.sdkConnection?.db || !this.spacetimeDBClient?.identity) return;
        
        // Get local player position
        const localPlayerSprite = this.scene.registry.get('localPlayerSprite') as Phaser.Physics.Arcade.Sprite;
        if (!localPlayerSprite) return;
        
        this.lastKnownPlayerPosition = { x: localPlayerSprite.x, y: localPlayerSprite.y };
        
        // Get the local account
        const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
        if (!account || account.soulId === 0) {
            // No soul exists for this player
            this.hideArrow();
            this.hideMinimapIndicator();
            return;
        }
        
        // Find the soul gem with the matching gem_id
        const soulGem = this.spacetimeDBClient.sdkConnection.db.gems.gemId.find(account.soulId);
        if (!soulGem) {
            // Soul gem doesn't exist (was probably collected)
            this.hideArrow();
            this.hideMinimapIndicator();
            return;
        }
        
        // Get the entity data for the soul gem to get its position
        const soulEntity = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(soulGem.entityId);
        if (!soulEntity) {
            // Entity doesn't exist
            this.hideArrow();
            this.hideMinimapIndicator();
            return;
        }
        
        // Show arrow pointing to the soul
        this.showArrow(soulEntity.position.x, soulEntity.position.y);
        
        // Show minimap indicator for the soul
        this.showMinimapIndicator(soulEntity.position.x, soulEntity.position.y);
    }
    
    /**
     * Show and update the arrow pointing to the soul gem
     */
    private showArrow(soulX: number, soulY: number): void {
        const playerX = this.lastKnownPlayerPosition.x;
        const playerY = this.lastKnownPlayerPosition.y;
        
        // Create arrow if it doesn't exist
        if (!this.soulArrow) {
            this.soulArrow = this.scene.add.image(0, 0, 'soul_arrow');
            this.soulArrow.setScale(ARROW_SIZE);
            this.soulArrow.setDepth(UI_DEPTH - 1); // Just below other UI elements
            this.soulArrow.setTint(0xff69b4); // Pink tint for soul
            
            // Add a subtle pulsing effect
            this.scene.tweens.add({
                targets: this.soulArrow,
                alpha: { from: 0.7, to: 1.0 },
                duration: 1000,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1
            });
        }
        
        // Position arrow below player
        this.soulArrow.setPosition(playerX + ARROW_OFFSET_X_FROM_PLAYER, playerY + ARROW_OFFSET_Y_FROM_PLAYER);
        
        // Calculate angle to point toward soul
        const angle = Phaser.Math.Angle.Between(playerX, playerY, soulX, soulY);
        this.soulArrow.setRotation(angle);
        
        // Make sure arrow is visible
        this.soulArrow.setVisible(true);
    }
    
    /**
     * Show the pink circle indicator on the minimap for the soul location
     */
    private showMinimapIndicator(soulX: number, soulY: number): void {
        // Get the minimap from the scene (assuming it's stored in the scene)
        const minimap = (this.scene as any).minimap;
        if (!minimap || !minimap.botDotsContainer) return;
        
        // Create indicator if it doesn't exist
        if (!this.minimapSoulIndicator) {
            // Get world bounds and minimap size
            const worldBounds = this.scene.physics.world.bounds;
            const minimapSize = minimap.background.width;
            
            // Calculate position ratio (soul position relative to world size)
            const ratioX = soulX / worldBounds.width;
            const ratioY = soulY / worldBounds.height;
            
            // Create pink circle for soul on minimap
            this.minimapSoulIndicator = this.scene.add.circle(
                ratioX * minimapSize,
                ratioY * minimapSize,
                8, // Size of the circle
                0xff69b4, // Pink color for soul
                1
            );
            
            // Add pulsing effect for soul indicator
            this.scene.tweens.add({
                targets: this.minimapSoulIndicator,
                alpha: { from: 1, to: 0.5 },
                duration: 1000,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1
            });
            
            // Add to the minimap's bot dots container
            minimap.botDotsContainer.add(this.minimapSoulIndicator);
        } else {
            // Update position if soul has moved (shouldn't happen but just in case)
            const worldBounds = this.scene.physics.world.bounds;
            const minimapSize = minimap.background.width;
            const ratioX = soulX / worldBounds.width;
            const ratioY = soulY / worldBounds.height;
            
            this.minimapSoulIndicator.setPosition(ratioX * minimapSize, ratioY * minimapSize);
        }
    }
    
    /**
     * Hide the soul arrow
     */
    private hideArrow(): void {
        if (this.soulArrow) {
            this.soulArrow.setVisible(false);
        }
    }
    
    /**
     * Hide the minimap soul indicator
     */
    private hideMinimapIndicator(): void {
        if (this.minimapSoulIndicator) {
            this.minimapSoulIndicator.destroy();
            this.minimapSoulIndicator = null;
        }
    }
    
    /**
     * Clean up when scene shuts down
     */
    public destroy(): void {
        console.log("SoulUI destroying");
        
        // Clean up arrow
        if (this.soulArrow) {
            this.soulArrow.destroy();
            this.soulArrow = null;
        }
        
        // Clean up minimap indicator
        this.hideMinimapIndicator();
        
        console.log("SoulUI destroyed");
    }
} 