import Phaser from 'phaser';
import { Monsters, EventContext, MonsterType, MonsterBoid} from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { MONSTER_ASSET_KEYS, MONSTER_SHADOW_OFFSETS_X, MONSTER_SHADOW_OFFSETS_Y} from '../constants/MonsterConfig';
import { GameEvents } from '../constants/GameEvents';
import { createMonsterDamageEffect } from '../utils/DamageEffects';

// Constants from GameScene
const SHADOW_ASSET_KEY = 'shadow';
const SHADOW_ALPHA = 0.4;
const MONSTER_HEALTH_BAR_WIDTH = 40;
const MONSTER_HEALTH_BAR_HEIGHT = 4;
const MONSTER_HEALTH_BAR_OFFSET_Y = 12;

// Depth sorting constants (matching those in GameScene)
const BASE_DEPTH = 1000; // Base depth to ensure all sprites are above background
const SHADOW_DEPTH_OFFSET = -1; // Always behind the sprite
const HEALTH_BG_DEPTH_OFFSET = 1; // Just behind health bar
const HEALTH_BAR_DEPTH_OFFSET = 1.1;

export default class MonsterManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    
    // Map of monster ID to container
    private monsters: Map<number, Phaser.GameObjects.Container>;
    
    // Add a property for the game events
    private gameEvents: Phaser.Events.EventEmitter;
    
    // Add a property to track boss state
    private bossPhase1Killed: boolean = false;
    private timeOfBossPhase1Death: number = 0;
    private bossMonsterId: number = 0;
    private bossPosition: { x: number, y: number } | null = null;
    
    constructor(scene: Phaser.Scene, spacetimeDBClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = spacetimeDBClient;
        this.monsters = new Map();
        this.gameEvents = (window as any).gameEvents;
        console.log("MonsterManager constructed");
    }
    
    // Initialize monster handlers
    initializeMonsters(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize monsters: database connection not available");
            return;
        }

        console.log("MonsterManager initializing monsters");
        
        // Register monster listeners
        this.registerMonsterListeners();
        
        // Force immediate update for all monsters
        for (const monster of ctx.db?.monsters.iter()) {
            this.createOrUpdateMonster(monster);
        }
    }
    
    // Register monster-related event listeners
    registerMonsterListeners() {
        console.log("Registering monster listeners for MonsterManager");

        this.gameEvents.on(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);

        this.gameEvents.on(GameEvents.MONSTER_UPDATED, (ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) => {
            // Check for damage
            if (newMonster.hp < oldMonster.hp) {
                const container = this.monsters.get(newMonster.monsterId);
                if (container) {
                    const sprite = container.list.find(child => child instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;
                    if (sprite) {
                        createMonsterDamageEffect(sprite);
                    }
                }
            }
            this.createOrUpdateMonster(newMonster);
        });

        this.gameEvents.on(GameEvents.MONSTER_DELETED, (ctx: EventContext, monster: Monsters) => {
            this.removeMonster(monster.monsterId);
        });

        this.gameEvents.on(GameEvents.MONSTER_BOID_UPDATED, (ctx: EventContext, oldBoid: MonsterBoid, newBoid: MonsterBoid) => {
            this.onMonsterBoidUpdated(ctx, oldBoid, newBoid);
        });
    }

    onMonsterBoidUpdated(ctx: EventContext, oldBoid: MonsterBoid, newBoid: MonsterBoid) {
        let container = this.monsters.get(newBoid.monsterId);
        if (container) {
            container.setPosition(newBoid.position.x, newBoid.position.y);
            container.setDepth(BASE_DEPTH + newBoid.position.y);
        }
    }
    
    // Create or update a monster sprite
    createOrUpdateMonster(monsterData: Monsters) {
        const monsterTypeName = this.getMonsterTypeName(monsterData.bestiaryId);
        const assetKey = MONSTER_ASSET_KEYS[monsterTypeName];
        
        // Check if we already have a container for this monster
        let container = this.monsters.get(monsterData.monsterId);
        
        if (!container) {
            // Create new container if it doesn't exist
            container = this.scene.add.container(monsterData.spawnPosition.x, monsterData.spawnPosition.y);
            container.setDepth(BASE_DEPTH + monsterData.spawnPosition.y);
            this.monsters.set(monsterData.monsterId, container);
            
            // Create shadow first (so it appears behind the sprite)
            const shadowX = MONSTER_SHADOW_OFFSETS_X[monsterTypeName] || 0;
            const shadowY = MONSTER_SHADOW_OFFSETS_Y[monsterTypeName] || 0;
            const shadow = this.scene.add.image(shadowX, shadowY, SHADOW_ASSET_KEY);
            shadow.setAlpha(SHADOW_ALPHA);
            shadow.setDepth(SHADOW_DEPTH_OFFSET);
            container.add(shadow);

            // Create the sprite
            const sprite = this.scene.add.sprite(0, 0, assetKey);
            sprite.setDepth(0);
            container.add(sprite);
            
            // Create health bar background
            const healthBarBg = this.scene.add.rectangle(
                0,
                -sprite.height/2 - MONSTER_HEALTH_BAR_OFFSET_Y,
                MONSTER_HEALTH_BAR_WIDTH,
                MONSTER_HEALTH_BAR_HEIGHT,
                0x000000,
                0.7
            );
            healthBarBg.setDepth(HEALTH_BG_DEPTH_OFFSET);
            healthBarBg.setName('healthBarBg');
            container.add(healthBarBg);

            // Update health bar if it exists
            const healthBar = this.scene.add.rectangle(
                0,
                -sprite.height/2 - MONSTER_HEALTH_BAR_OFFSET_Y,
                MONSTER_HEALTH_BAR_WIDTH,
                MONSTER_HEALTH_BAR_HEIGHT,
                0x000000,
                0.7
            );
            healthBar.setDepth(HEALTH_BAR_DEPTH_OFFSET);
            healthBar.setName('healthBar');
            container.add(healthBar);
            
            // For bosses, make them larger and ensure visibility
            if (monsterTypeName === "FinalBossPhase1" || monsterTypeName === "FinalBossPhase2") {
                console.log(`Setting up boss sprite: ${monsterTypeName} (ID: ${monsterData.monsterId})`);
                console.log(`Boss data: HP=${monsterData.hp}/${monsterData.maxHp}`);
                sprite.setScale(1.0);
                sprite.setAlpha(1);
                sprite.setVisible(true);
            }
            
            console.log(`Created new monster sprite for ${monsterTypeName} (ID: ${monsterData.monsterId})`);
        }
        
        // Update health bar
        var healthBarToUpdate = container.getByName('healthBar') as Phaser.GameObjects.Rectangle;
        this.updateHealthBar(healthBarToUpdate, monsterData.hp, monsterData.maxHp);
        
        // Update monster data
        container.setData('monsterData', monsterData);
        
        // Special handling for boss monsters
        if (monsterTypeName === "FinalBossPhase1" || monsterTypeName === "FinalBossPhase2") {
            console.log(`Updating boss monster ${monsterTypeName} (ID: ${monsterData.monsterId}):`);
            console.log(`- Position: (${monsterData.spawnPosition.x}, ${monsterData.spawnPosition.y})`);
            console.log(`- HP: ${monsterData.hp}/${monsterData.maxHp}`);
            console.log(`- Container visible: ${container.visible}`);
            console.log(`- Container alpha: ${container.alpha}`);
            console.log(`- Container depth: ${container.depth}`);
        }
    }
    
    // Helper function to get health bar color based on health percentage
    private getHealthBarColor(healthPercent: number): number {
        if (healthPercent > 0.6) return 0x00ff00; // Green
        if (healthPercent > 0.3) return 0xffff00; // Yellow
        return 0xff0000; // Red
    }
    
    // Helper function to remove monster sprites
    removeMonster(monsterId: number) {
        console.log(`Removing monster: ${monsterId}`);
        
        // Check if this was a boss monster before removing it
        const monsterContainer = this.monsters.get(monsterId);
        if (monsterContainer) {
            const monsterType = monsterContainer.getData('monsterType');
            if (monsterType === 'FinalBossPhase1') {
                console.log(`*** BOSS PHASE 1 DEFEATED (ID: ${monsterId})! Waiting for phase 2 to spawn... ***`);
                
                // Set tracking variables to monitor phase transition
                this.bossPhase1Killed = true;
                this.timeOfBossPhase1Death = Date.now();
                this.bossMonsterId = monsterId;
                this.bossPosition = { x: monsterContainer.x, y: monsterContainer.y };
                console.log(`Boss position stored: (${this.bossPosition.x}, ${this.bossPosition.y})`);
                
                // Add a visual indicator for phase transition
                this.createBossTransformationEffect(monsterContainer.x, monsterContainer.y);
            } else if (monsterType === 'FinalBossPhase2') {
                console.log(`*** FINAL BOSS DEFEATED (ID: ${monsterId})! GAME COMPLETE! ***`);
            }
        }
        
        // Get and destroy the container
        const container = this.monsters.get(monsterId);
        if (container) {
            container.destroy();
        }
        this.monsters.delete(monsterId);
    }
    
    // Get monster by ID
    getMonster(monsterId: number): Phaser.GameObjects.Container | undefined {
        return this.monsters.get(monsterId);
    }
    
    // Get all monsters
    getAllMonsters(): Map<number, Phaser.GameObjects.Container> {
        return this.monsters;
    }
    
    // Get count of monsters
    getMonsterCount(): number {
        return this.monsters.size;
    }
    
    // Update method to be called from scene's update method
    update(time: number, delta: number) {
        // Perform the boss transition check
        this.checkForBossPhaseTransition();
    }
    
    // Add method to clean up event listeners
    unregisterListeners() {
        console.log("Unregistering event listeners for MonsterManager");
        
        // Remove monster event listeners
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);
        this.gameEvents.off(GameEvents.MONSTER_UPDATED);
        this.gameEvents.off(GameEvents.MONSTER_DELETED);
    }
    
    shutdown() {
        this.unregisterListeners();
    }
    
    // Handles when a monster is created
    handleMonsterCreated(ctx: EventContext, monster: Monsters) {
        const monsterTypeName = this.getMonsterTypeName(monster.bestiaryId);
        
        console.log(`Monster created: ${monster.monsterId}, type: ${monsterTypeName}`);
        
        // Special handling for boss monsters
        if (monsterTypeName === "FinalBossPhase1" || monsterTypeName === "FinalBossPhase2") {
            console.log(`BOSS SPAWNED: ${monsterTypeName}`);
            console.log(`- Monster ID: ${monster.monsterId}`);
            console.log(`- HP: ${monster.hp}/${monster.maxHp}`);
            console.log(`- Asset key: ${MONSTER_ASSET_KEYS[monsterTypeName]}`);
            console.log(`- Texture exists: ${this.scene.textures.exists(MONSTER_ASSET_KEYS[monsterTypeName])}`);
            console.log(`- Position: (${monster.spawnPosition.x}, ${monster.spawnPosition.y})`);
            
            // If this is phase 2, it means phase 1 was defeated
            if (monsterTypeName === "FinalBossPhase2") {
                console.log("*** PHASE 2 OF THE BOSS HAS BEGUN! ***");
                
                // Reset phase 1 tracking variables since phase 2 has spawned
                if (this.bossPhase1Killed) {
                    const transitionTime = Date.now() - this.timeOfBossPhase1Death;
                    console.log(`Phase transition took ${transitionTime}ms from phase 1 death to phase 2 spawn`);
                    this.bossPhase1Killed = false;
                }
                
                // Play the dark transformation effect
                this.createBossTransformationEffect(monster.spawnPosition.x, monster.spawnPosition.y);
            }
            
            // Log all sprites to debug visibility issues
            this.debugLogAllSprites();
        }
        
        // Use createOrUpdateMonster instead of directly creating the sprite
        this.createOrUpdateMonster(monster);
        
        // For boss monsters, do an additional check after creation
        if (monsterTypeName === "FinalBossPhase1" || monsterTypeName === "FinalBossPhase2") {
            const bossContainer = this.monsters.get(monster.monsterId);
            if (bossContainer) {
                console.log(`Boss container after creation: visible=${bossContainer.visible}, alpha=${bossContainer.alpha}`);
            } else {
                console.error(`Failed to find boss container after creation!`);
            }
            
            // Log all sprites again after creation
            this.debugLogAllSprites();
        }
    }
    
    // Helper to get monster type name from bestiary ID
    private getMonsterTypeName(bestiaryId: any): string {
        // Check if bestiaryId is an object with a tag property (from autobindings)
        if (bestiaryId && typeof bestiaryId === 'object' && 'tag' in bestiaryId) {
            console.log(`Getting monster type from tag: ${bestiaryId.tag}`);
            return bestiaryId.tag;
        }
        
        // Fall back to numeric mapping for backward compatibility
        switch(bestiaryId) {
            case 0: return "Rat";
            case 1: return "Slime";
            case 2: return "Orc";
            case 3: return "FinalBossPhase1";
            case 4: return "FinalBossPhase2";
            default: 
                console.warn(`Unknown monster type: ${bestiaryId}`);
                return "Unknown";
        }
    }
    
    // Helper method to create a visual effect when boss transforms from phase 1 to phase 2
    private createBossTransformationEffect(x: number, y: number) {
        // Create an explosion effect at the boss's position
        console.log(`Creating boss transformation effect at (${x}, ${y})`);
        
        // Create a light flash
        const flash = this.scene.add.circle(x, y, 150, 0xff0000, 0.7);
        flash.setDepth(10); // Above everything
        
        // Animate the flash - expand and fade out
        this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            radius: 300,
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                flash.destroy();
            }
        });
        
        // Add particle explosion
        const particles = this.scene.add.particles(x, y, 'white_pixel', {
            speed: { min: 100, max: 300 },
            angle: { min: 0, max: 360 },
            scale: { start: 2, end: 0 },
            blendMode: 'ADD',
            lifespan: 1000,
            quantity: 1,
            frequency: 20,
            emitting: false,
            tint: 0xff0000 // Set the red tint directly in the configuration
        });
        
        particles.setDepth(9); // Just below the flash
        
        // Emit a burst of particles
        particles.explode(100, x, y);
        
        // Destroy the emitter after animation completes
        this.scene.time.delayedCall(1200, () => {
            particles.destroy();
        });
        
        // Add text announcing phase 2
        const text = this.scene.add.text(x, y - 100, 'BOSS PHASE 2 INCOMING!', {
            fontSize: '32px',
            color: '#ff0000',
            stroke: '#000000',
            strokeThickness: 4,
            fontStyle: 'bold'
        }).setOrigin(0.5);
        text.setDepth(10);
        
        // Animate the text
        this.scene.tweens.add({
            targets: text,
            y: y - 200,
            alpha: 0,
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                text.destroy();
            }
        });
    }
    
    // Add debug method to log all sprites on the scene
    debugLogAllSprites() {
        console.log("=== ALL SPRITES IN SCENE ===");
        const allSprites = this.scene.children.list.filter(obj => 
            obj instanceof Phaser.GameObjects.Sprite || 
            obj instanceof Phaser.GameObjects.Container
        );
        
        console.log(`Found ${allSprites.length} sprites/containers`);
        allSprites.forEach((sprite, index) => {
            if (sprite instanceof Phaser.GameObjects.Container) {
                const container = sprite as Phaser.GameObjects.Container;
                console.log(`Container #${index}: x=${container.x}, y=${container.y}, visible=${container.visible}, alpha=${container.alpha}, depth=${container.depth}`);
                console.log(`  - Children: ${container.length}`);
                console.log(`  - Data: ${JSON.stringify(container.data?.getAll())}`);
            } else {
                const gameObj = sprite as Phaser.GameObjects.Sprite;
                console.log(`Sprite #${index}: name=${gameObj.name}, texture=${gameObj.texture.key}, x=${gameObj.x}, y=${gameObj.y}, visible=${gameObj.visible}, alpha=${gameObj.alpha}`);
            }
        });
    }
    
    // Implement a method to check for boss state transitions
    private checkForBossPhaseTransition() {
        const now = Date.now();
        
        // If we've killed the phase 1 boss but haven't seen phase 2 after 5 seconds, log an error
        if (this.bossPhase1Killed && (now - this.timeOfBossPhase1Death > 5000)) {
            console.error(`ERROR: Boss phase 1 was killed ${(now - this.timeOfBossPhase1Death) / 1000} seconds ago, but phase 2 has not spawned!`);
            console.log(`Boss phase 1 details - ID: ${this.bossMonsterId}, Position: (${this.bossPosition?.x}, ${this.bossPosition?.y})`);
            
            // Reset the flag to prevent continuous logging
            this.bossPhase1Killed = false;
            
            // Dump all current monsters for debugging
            console.log("Current active monsters:");
            this.monsters.forEach((container, id) => {
                const monsterType = container.getData('monsterType');
                console.log(`- Monster ID: ${id}, Type: ${monsterType}, Position: (${container.x}, ${container.y})`);
            });
            
            // Display an alert in-game that the boss is missing - development only!
            console.log("BOSS PHASE 2 SPAWN FAILED - Please report this bug!");
        }
    }
    
    private updateHealthBar(healthBar: Phaser.GameObjects.Rectangle, currentHp: number, maxHp: number) {
        const width = MONSTER_HEALTH_BAR_WIDTH;
        const height = MONSTER_HEALTH_BAR_HEIGHT;
        const x = healthBar.x;
        const y = healthBar.y;
        
        const healthPercent = currentHp / maxHp;
        healthBar.fillColor = this.getHealthBarColor(healthPercent);
        healthBar.width = MONSTER_HEALTH_BAR_WIDTH * healthPercent;
    }
} 