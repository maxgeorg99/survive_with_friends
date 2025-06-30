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
            return;
        }
        
        // Find the soul gem with the matching gem_id
        const soulGem = this.spacetimeDBClient.sdkConnection.db.gems.gemId.find(account.soulId);
        if (!soulGem) {
            // Soul gem doesn't exist (was probably collected)
            this.hideArrow();
            return;
        }
        
        // Get the entity data for the soul gem to get its position
        const soulEntity = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(soulGem.entityId);
        if (!soulEntity) {
            // Entity doesn't exist
            this.hideArrow();
            return;
        }
        
        // Show arrow pointing to the soul
        this.showArrow(soulEntity.position.x, soulEntity.position.y);
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
     * Hide the soul arrow
     */
    private hideArrow(): void {
        if (this.soulArrow) {
            this.soulArrow.setVisible(false);
        }
    }
    
    /**
     * Helper function to create a soul indicator on the minimap if the player has a soul
     * Called by GameScene.updateMinimap() with the necessary parameters
     * Returns the created indicator or null if no soul exists
     */
    public createMinimapSoulIndicator(
        sdkConnection: any,
        identity: any,
        worldBounds: Phaser.Geom.Rectangle, 
        minimapSize: number
    ): Phaser.GameObjects.Arc | null {
        if (!sdkConnection?.db || !identity) return null;
        
        // Get the local account
        const account = sdkConnection.db.account.identity.find(identity);
        if (!account || account.soulId === 0) {
            // No soul exists for this player
            return null;
        }
        
        // Find the soul gem with the matching gem_id
        const soulGem = sdkConnection.db.gems.gemId.find(account.soulId);
        if (!soulGem) {
            // Soul gem doesn't exist (was probably collected)
            return null;
        }
        
        // Get the entity data for the soul gem to get its position
        const soulEntity = sdkConnection.db.entity.entityId.find(soulGem.entityId);
        if (!soulEntity) {
            // Entity doesn't exist
            return null;
        }
        
        // Calculate position ratio (soul position relative to world size)
        const ratioX = soulEntity.position.x / worldBounds.width;
        const ratioY = soulEntity.position.y / worldBounds.height;
        
        // Create pink circle for soul on minimap
        const soulDot = this.scene.add.circle(
            ratioX * minimapSize,
            ratioY * minimapSize,
            8, // Size of the circle
            0xff69b4, // Pink color for soul
            1
        );
        
        // Add pulsing effect for soul indicator
        this.scene.tweens.add({
            targets: soulDot,
            alpha: { from: 1, to: 0.5 },
            duration: 1000,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1
        });
        
        return soulDot;
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
        

        
        console.log("SoulUI destroyed");
    }
} 