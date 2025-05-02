import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';

// Constants
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements

export default class PlayerHUD {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private container: Phaser.GameObjects.Container;
    private rerollCountText: Phaser.GameObjects.Text;
    private localPlayerId: number = 0;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient, localPlayerId: number) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.localPlayerId = localPlayerId;
        
        // Create container for HUD elements
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(UI_DEPTH);
        
        // Create reroll counter in top-right
        this.rerollCountText = this.scene.add.text(0, 0, "Rerolls: 0", {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.rerollCountText.setOrigin(1, 0); // Top-right alignment
        this.container.add(this.rerollCountText);
        
        // Update reroll text immediately
        this.updateRerollCount();
        
        console.log('PlayerHUD initialized');
    }

    public update(time: number, delta: number): void {
        // Position the HUD elements relative to the camera
        const camera = this.scene.cameras.main;
        if (camera) {
            // Position reroll text in top-right corner with some padding
            this.rerollCountText.x = camera.scrollX + camera.width - 20;
            this.rerollCountText.y = camera.scrollY + 20;
        }
        
        // Update reroll count every 1 second
        if (time % 1000 < 20) { // Check roughly every second
            this.updateRerollCount();
        }
    }
    
    private updateRerollCount(): void {
        if (this.spacetimeClient.sdkConnection?.db) {
            const player = this.spacetimeClient.sdkConnection.db.player.playerId.find(this.localPlayerId);
            if (player && player.rerolls !== undefined) {
                this.rerollCountText.setText(`Rerolls: ${player.rerolls}`);
            }
        }
    }

    public destroy(): void {
        this.container.destroy();
    }
} 