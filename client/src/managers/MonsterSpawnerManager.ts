import Phaser from 'phaser';
import { MonsterSpawners, EventContext } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';

// Constants for visual appearance and animation
const INDICATOR_ASSET_KEY = 'monster_spawn_indicator';
const INDICATOR_OFFSET_X = 34; // X offset for sprite origin
const INDICATOR_OFFSET_Y = 54; // Y offset for sprite origin
const ANIMATION_DURATION = 1000; // Duration of grow animation in ms
const ALPHA_VALUE = 0.7; // Transparency of the indicator
const BASE_DEPTH = 900; // Just below monsters but above background

export default class MonsterSpawnerManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    // Client for database access
    private spacetimeDBClient: SpacetimeDBClient;
    // Map to store indicator sprites (keyed by spawner ID stringified)
    private spawnerIndicators: Map<string, Phaser.GameObjects.Sprite> = new Map();

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        console.log("MonsterSpawnerManager constructed");

        // Set up event handlers for monster spawner table events
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.monsterSpawners?.onInsert(this.handleSpawnerInsert.bind(this));
            db.monsterSpawners?.onDelete(this.handleSpawnerDelete.bind(this));
        } else {
            console.error("Could not set up MonsterSpawnerManager database listeners (database not connected)");
        }
    }

    // Handle when a new monster spawner is inserted
    private handleSpawnerInsert(ctx: EventContext, spawner: MonsterSpawners) {
        //console.log(`New monster spawner at position (${spawner.position.x}, ${spawner.position.y}) for monster type: ${spawner.monsterType}`);
        this.createSpawnerIndicator(spawner);
    }

    // Handle when a monster spawner is deleted (monster was spawned)
    private handleSpawnerDelete(ctx: EventContext, spawner: MonsterSpawners) {
        console.log(`Monster spawner deleted: ${spawner.scheduledId}`);
        this.removeSpawnerIndicator(String(spawner.scheduledId));
    }

    // Create a spawner indicator sprite with animation
    private createSpawnerIndicator(spawner: MonsterSpawners) {
        // Convert bigint ID to string for use as a map key
        const spawnerIdKey = String(spawner.scheduledId);
        
        // Check if we already have an indicator for this spawner
        if (this.spawnerIndicators.has(spawnerIdKey)) {
            console.log(`Indicator for spawner ${spawnerIdKey} already exists`);
            return;
        }

        // Determine asset and properties based on monster type
        let assetKey = INDICATOR_ASSET_KEY;
        let originX = INDICATOR_OFFSET_X;
        let originY = INDICATOR_OFFSET_Y;
        let finalScale = 1;
        
        // Check if this is an EnderClaw spawner
        const monsterTypeName = this.getMonsterTypeName(spawner.monsterType);
        if (monsterTypeName === 'EnderClaw') {
            assetKey = 'claw_spawn';
            originX = 0.5; // Center the claw spawn
            originY = 0.5;
            finalScale = 1.0; // No scaling needed - asset is already the right size
        }

        // Create the indicator sprite at the spawner position
        const indicator = this.scene.add.sprite(
            spawner.position.x, 
            spawner.position.y, 
            assetKey
        );
        
        // Set sprite origin based on monster type
        if (monsterTypeName === 'EnderClaw') {
            indicator.setOrigin(originX, originY); // Center origin for void zone
        } else {
            indicator.setOrigin(originX / indicator.width, originY / indicator.height); // Original logic
        }
        
        // Set initial scale, alpha and depth
        indicator.setScale(0.1);
        indicator.setAlpha(ALPHA_VALUE);
        indicator.setDepth(BASE_DEPTH + spawner.position.y);
        
        // Store the indicator
        this.spawnerIndicators.set(spawnerIdKey, indicator);
        
        // Create grow animation
        this.scene.tweens.add({
            targets: indicator,
            scale: finalScale, // Use the calculated final scale
            duration: ANIMATION_DURATION,
            ease: 'Elastic.Out',
            onComplete: () => {
                // Add a slight pulsing effect after the initial grow
                this.scene.tweens.add({
                    targets: indicator,
                    scale: { from: finalScale * 0.95, to: finalScale * 1.05 },
                    duration: 700,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.InOut'
                });
            }
        });
    }

    // Remove a spawner indicator
    private removeSpawnerIndicator(spawnerId: string) {
        const indicator = this.spawnerIndicators.get(spawnerId);
        if (indicator) {
            // Fade out and destroy the indicator
            this.scene.tweens.add({
                targets: indicator,
                alpha: 0,
                scale: 0.1,
                duration: 500,
                ease: 'Power2',
                onComplete: () => {
                    indicator.destroy();
                    this.spawnerIndicators.delete(spawnerId);
                }
            });
        }
    }

    // Clean up all indicators (call this when scene is shut down)
    public destroy() {
        this.spawnerIndicators.forEach(indicator => indicator.destroy());
        this.spawnerIndicators.clear();
    }

    // Helper to get monster type name from bestiary ID (same as MonsterManager)
    private getMonsterTypeName(bestiaryId: any): string {
        // Check if bestiaryId is an object with a tag property (from autobindings)
        if (bestiaryId && typeof bestiaryId === 'object' && 'tag' in bestiaryId) {
            return bestiaryId.tag;
        }
        
        // Fall back to numeric mapping for backward compatibility
        switch(bestiaryId) {
            case 0: return "Rat";
            case 1: return "Slime";
            case 2: return "Bat";
            case 3: return "Orc";
            case 4: return "Imp";
            case 5: return "Zombie";
            case 6: return "VoidChest";
            case 7: return "EnderClaw";
            case 8: return "BossEnderPhase1";
            case 9: return "BossEnderPhase2";
            case 10: return "BossAgnaPhase1";
            case 11: return "BossAgnaPhase2";
            case 12: return "AgnaCandle";
            case 13: return "Crate";
            case 14: return "Tree";
            case 15: return "Statue";
            default: 
                console.warn(`Unknown monster type: ${bestiaryId}`);
                return "Unknown";
        }
    }
} 