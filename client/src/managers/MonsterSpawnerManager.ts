import Phaser from 'phaser';
import { MonsterSpawners, EventContext, Bestiary, MonsterType } from "../autobindings";
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
    // Map to store monster data from bestiary (keyed by monster type)
    private monsterDataCache: Map<string, Bestiary> = new Map();

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        console.log("MonsterSpawnerManager constructed");

        // Set up event handlers for monster spawner table events
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.monsterSpawners?.onInsert(this.handleSpawnerInsert.bind(this));
            db.monsterSpawners?.onDelete(this.handleSpawnerDelete.bind(this));
            
            // Also set up event handlers for bestiary updates
            db.bestiary?.onInsert(this.handleBestiaryInsert.bind(this));
            db.bestiary?.onUpdate(this.handleBestiaryUpdate.bind(this));
            
            // Initialize monster data cache from bestiary
            this.initMonsterDataCache();
        } else {
            console.error("Could not set up MonsterSpawnerManager database listeners (database not connected)");
        }
    }

    // Initialize monster data cache by fetching all entries from the bestiary table
    private initMonsterDataCache() {
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.error("Database not connected, cannot initialize monster data cache");
            return;
        }

        try {
            // Fetch all monster data from the bestiary table
            const bestiaryEntries = db.bestiary.iter();
            if (!bestiaryEntries) {
                console.error("Failed to fetch bestiary entries");
                return;
            }

            // Populate the cache with monster data
            for (const entry of bestiaryEntries) {
                this.monsterDataCache.set(entry.monsterType.tag, entry);
                console.log(`Cached monster data for ${entry.monsterType.tag}: HP=${entry.maxHp}, Speed=${entry.speed}, Attack=${entry.atk}`);
            }
            
            console.log(`Initialized monster data cache with ${this.monsterDataCache.size} entries`);
        } catch (error) {
            console.error("Error initializing monster data cache:", error);
        }
    }

    // Get monster data from cache by monster type
    public getMonsterData(monsterType: MonsterType): Bestiary | undefined {
        return this.monsterDataCache.get(monsterType.tag);
    }

    // Handle when a new entry is added to the bestiary
    private handleBestiaryInsert(ctx: EventContext, bestiaryEntry: Bestiary) {
        console.log(`New bestiary entry for monster type: ${bestiaryEntry.monsterType.tag}`);
        this.monsterDataCache.set(bestiaryEntry.monsterType.tag, bestiaryEntry);
    }

    // Handle when a bestiary entry is updated
    private handleBestiaryUpdate(ctx: EventContext, oldEntry: Bestiary, newEntry: Bestiary) {
        console.log(`Updated bestiary entry for monster type: ${newEntry.monsterType.tag}`);
        this.monsterDataCache.set(newEntry.monsterType.tag, newEntry);
    }

    // Handle when a new monster spawner is inserted
    private handleSpawnerInsert(ctx: EventContext, spawner: MonsterSpawners) {
        console.log(`New monster spawner at position (${spawner.position.x}, ${spawner.position.y}) for monster type: ${spawner.monsterType.tag}`);
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

        // Create the indicator sprite at the spawner position
        const indicator = this.scene.add.sprite(
            spawner.position.x, 
            spawner.position.y, 
            INDICATOR_ASSET_KEY
        );
        
        // Set sprite origin to match requirements (34, 54 offset)
        indicator.setOrigin(INDICATOR_OFFSET_X / indicator.width, INDICATOR_OFFSET_Y / indicator.height);
        
        // Set initial scale, alpha and depth
        indicator.setScale(0.1);
        indicator.setAlpha(ALPHA_VALUE);
        indicator.setDepth(BASE_DEPTH + spawner.position.y);
        
        // Get monster data for this spawner if available
        const monsterData = this.monsterDataCache.get(spawner.monsterType.tag);
        if (monsterData) {
            // Add a tooltip or visual indicator for monster type/stats if desired
            console.log(`Spawner for ${spawner.monsterType.tag} - HP: ${monsterData.maxHp}, ATK: ${monsterData.atk}`);
            
            // Could add a text label or tint the indicator based on monster type
            // For example, tint more dangerous monsters with a reddish hue
            if (monsterData.atk > 2.0) {
                indicator.setTint(0xff5555); // Reddish tint for stronger monsters
            } else if (monsterData.maxHp > 30) {
                indicator.setTint(0xffaa55); // Orange tint for tankier monsters
            }
        }
        
        // Store the indicator
        this.spawnerIndicators.set(spawnerIdKey, indicator);
        
        // Create grow animation
        this.scene.tweens.add({
            targets: indicator,
            scale: 1,
            duration: ANIMATION_DURATION,
            ease: 'Elastic.Out',
            onComplete: () => {
                // Add a slight pulsing effect after the initial grow
                this.scene.tweens.add({
                    targets: indicator,
                    scale: { from: 0.95, to: 1.05 },
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

    // Get all monster data (useful for other components like the bestiary)
    public getAllMonsterData(): Map<string, Bestiary> {
        return new Map(this.monsterDataCache);
    }

    // Clean up all indicators (call this when scene is shut down)
    public destroy() {
        this.spawnerIndicators.forEach(indicator => indicator.destroy());
        this.spawnerIndicators.clear();
        this.monsterDataCache.clear();
    }
}