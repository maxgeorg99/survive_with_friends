import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';

// Constants
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements

export default class PlayerHUD {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private container: Phaser.GameObjects.Container;
    private localPlayerId: number = 0;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient, localPlayerId: number) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.localPlayerId = localPlayerId;
        
        // Create container for HUD elements
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(UI_DEPTH);
        
        console.log('PlayerHUD initialized');
    }

    public update(time: number, delta: number): void {
        // Position the HUD elements relative to the camera
        const camera = this.scene.cameras.main;
        if (camera) {
            // Currently no HUD elements to position, but keep this for future additions
        }
    }

    public destroy(): void {
        this.container.destroy();
    }
} 