import Phaser from 'phaser';
import { Monsters, Entity, EventContext } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { MONSTER_ASSET_KEYS, MONSTER_SHADOW_OFFSETS, MONSTER_MAX_HP } from '../constants/MonsterConfig';
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
const HEALTH_BAR_DEPTH_OFFSET = 1.1; // In front of background

export default class MonsterManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    // Client for database access
    private spacetimeDBClient: SpacetimeDBClient;
    // Map to store monster sprites (keyed by monsterId)
    private monsters: Map<number, Phaser.GameObjects.Container> = new Map();
    // Map to hold monster data waiting for corresponding entity data (keyed by entityId)
    private pendingMonsters: Map<number, Monsters> = new Map();
    // Add a property for the game events
    private gameEvents: Phaser.Events.EventEmitter;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        this.gameEvents = (window as any).gameEvents;
        console.log("MonsterManager constructed");
    }

    // Initialize monster handlers
    initializeMonsters(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize monsters: database connection not available");
            return;
        }

        console.log("MonsterManager initalizing monsters");
        
        // Register monster listeners
        this.registerMonsterListeners();
        
        // Register entity event listeners
        this.registerEntityListeners();
        
        // Force immediate update for all monsters with known entities
        for (const monster of ctx.db?.monsters.iter()) {
            // Look up the entity directly using the entity_id index
            const entityData = ctx.db?.entity.entityId.find(monster.entityId);
            
            if (entityData) {
                // Entity exists, create directly with correct position
                this.createMonsterSprite(monster, entityData.position);
            } else {
                // Entity doesn't exist yet, create at origin and track for updates
                this.createOrUpdateMonster(monster);
            }
        }
    }

    // Register monster-related event listeners
    registerMonsterListeners() {
        console.log("Registering monster listeners for MonsterManager");

        this.gameEvents.on(GameEvents.MONSTER_CREATED, (ctx: EventContext, monster: Monsters) => {
            this.createOrUpdateMonster(monster);
        });

        this.gameEvents.on(GameEvents.MONSTER_UPDATED, (ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) => {
            this.createOrUpdateMonster(newMonster);
        });

        this.gameEvents.on(GameEvents.MONSTER_DELETED, (ctx: EventContext, monster: Monsters) => {
            this.removeMonster(monster.monsterId);
        });
    }

    // Add method to register for entity events
    registerEntityListeners() {
        console.log("Registering entity event listeners for MonsterManager");
        
        // Listen for entity events
        this.gameEvents.on(GameEvents.ENTITY_CREATED, this.handleEntityEvent, this);
    }

    // Add method to handle entity events
    handleEntityEvent(ctx: EventContext, entity: Entity) {
        // Call the existing handleEntityUpdate method
        this.handleEntityUpdate(ctx, entity);
    }

    // Handle entity updates for monsters
    handleEntityUpdate(ctx: EventContext, entityData: Entity) {
        // Check if we have a pending monster waiting for this entity
        const pendingMonster = this.pendingMonsters.get(entityData.entityId);
        if (pendingMonster) {
            // Check if the monster sprite exists already
            const monsterContainer = this.monsters.get(pendingMonster.monsterId);
            if (monsterContainer) {
                // For pending monsters, set position immediately to avoid teleporting from (0,0)
                monsterContainer.x = entityData.position.x;
                monsterContainer.y = entityData.position.y;
                
                // Update depth based on Y position
                monsterContainer.setDepth(BASE_DEPTH + entityData.position.y);
                
                // Set target position data for later lerping
                monsterContainer.setData('targetX', entityData.position.x);
                monsterContainer.setData('targetY', entityData.position.y);
                monsterContainer.setData('lastUpdateTime', Date.now());
                
                // Remove from pending after updating
                this.pendingMonsters.delete(entityData.entityId);
                return true;
            } else {
                // Create the monster with the entity position
                // Remove from pending monsters first to avoid infinite recursion
                this.pendingMonsters.delete(entityData.entityId);
                // Create the monster with the entity data
                this.createMonsterSprite(pendingMonster, entityData.position);
                return true;
            }
        }
        
        // Check if this entity belongs to an existing monster using the proper index
        // Look up monsters by entityId using the entity_id index if available
        const monster = ctx.db?.monsters.entityId?.find(entityData.entityId);
        
        if (monster) {
            // Entity belongs to a monster, update its position
            const monsterContainer = this.monsters.get(monster.monsterId);
            if (monsterContainer) {
                // Cancel any existing tween to prevent overlapping animations
                this.scene.tweens.killTweensOf(monsterContainer);
                
                const monsterType = monster.bestiaryId.tag;
                
                // Store target position for lerping in update
                monsterContainer.setData('targetX', entityData.position.x);
                monsterContainer.setData('targetY', entityData.position.y);
                monsterContainer.setData('lastUpdateTime', Date.now());
                
                // Use tween for smooth movement instead of direct position setting
                const isMoving = entityData.isMoving;
                
                // If monster is far away from its current server position, teleport it instead of tweening
                const distSquared = Math.pow(monsterContainer.x - entityData.position.x, 2) + 
                                   Math.pow(monsterContainer.y - entityData.position.y, 2);
                
                if (distSquared > 10000) { // More than 100 units away, teleport
                    monsterContainer.x = entityData.position.x;
                    monsterContainer.y = entityData.position.y;
                } else if (isMoving) {
                    // Server tick rate is 50ms
                    // Use a tween that finishes just before the next server update for smoothest motion
                    // (49ms tween for a 50ms server tick)
                    this.scene.tweens.add({
                        targets: monsterContainer,
                        x: entityData.position.x,
                        y: entityData.position.y,
                        duration: 49, // Just under the server tick rate of 50ms
                        ease: 'Linear',
                        onUpdate: () => {
                            // Update depth on each tween update
                            monsterContainer.setDepth(BASE_DEPTH + monsterContainer.y);
                        }
                    });
                    
                    // Debug log the monster type and movement details for diagnosis
                    const moveDistance = Math.sqrt(
                        Math.pow(entityData.position.x - monsterContainer.x, 2) + 
                        Math.pow(entityData.position.y - monsterContainer.y, 2)
                    );
                    
                } else {
                    // For non-moving monsters, use a shorter tween duration
                    this.scene.tweens.add({
                        targets: monsterContainer,
                        x: entityData.position.x,
                        y: entityData.position.y,
                        duration: 40, // Even faster tween for stopped monsters
                        ease: 'Power1',
                        onUpdate: () => {
                            monsterContainer.setDepth(BASE_DEPTH + monsterContainer.y);
                        }
                    });
                }
                
                // Store the movement state and monster type
                monsterContainer.setData('isMoving', isMoving);
                monsterContainer.setData('monsterType', monsterType);
                monsterContainer.setData('direction', {
                    x: entityData.direction.x,
                    y: entityData.direction.y
                });
                
                return true;
            } else {
                // If container doesn't exist yet, try to create it
                this.createMonsterSprite(monster, entityData.position);
                return true;
            }
        }
        
        // If we didn't find the monster with the index above, try a fallback approach
        // This is a slower method but will work if the index isn't defined
        if (!monster) {
            // Iterate through monsters to find one with this entityId
            for (const iterMonster of ctx.db?.monsters.iter() || []) {
                if (iterMonster.entityId === entityData.entityId) {
                    // Update the monster
                    const monsterContainer = this.monsters.get(iterMonster.monsterId);
                    if (monsterContainer) {
                        // Update position
                        monsterContainer.setData('targetX', entityData.position.x);
                        monsterContainer.setData('targetY', entityData.position.y);
                        monsterContainer.setData('lastUpdateTime', Date.now());
                        
                        // Use tween for smooth movement
                        this.scene.tweens.add({
                            targets: monsterContainer,
                            x: entityData.position.x,
                            y: entityData.position.y,
                            duration: 49,
                            ease: 'Linear',
                            onUpdate: () => {
                                monsterContainer.setDepth(BASE_DEPTH + monsterContainer.y);
                            }
                        });
                        
                        return true;
                    } else {
                        // Create the monster container
                        this.createMonsterSprite(iterMonster, entityData.position);
                        return true;
                    }
                }
            }
        }
        
        // Not a monster entity
        return false;
    }

    // Helper function to determine health bar color based on percentage
    private getHealthBarColor(healthPercent: number): number {
        if (healthPercent > 0.6) {
            return 0x00FF00; // Green
        } else if (healthPercent > 0.3) {
            return 0xFFFF00; // Yellow
        } else {
            return 0xFF0000; // Red
        }
    }

    // Helper function to create or update monster sprites
    createOrUpdateMonster(monsterData: Monsters) {
        // Ensure database connection exists
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot create monster sprite: database connection not available");
            return;
        }
        
        // First check if we already have this monster with a valid position
        const existingMonster = this.monsters.get(monsterData.monsterId);
        if (existingMonster && (existingMonster.x !== 0 || existingMonster.y !== 0)) {
            
            // Get current HP to compare
            const currentHp = existingMonster.getData('currentHP') || monsterData.maxHp;
            
            // Show damage effect if HP decreased
            if (monsterData.hp < currentHp) {
                const sprite = existingMonster.getByName('sprite') as Phaser.GameObjects.Sprite;
                if (sprite) {
                    createMonsterDamageEffect(sprite);
                }
            }
            
            // Just update health and other properties, but keep the position
            const children = existingMonster.getAll();
            for (const child of children) {
                if (child.name === 'healthBar') {
                    const healthBar = child as Phaser.GameObjects.Rectangle;
                    // Use the server-provided max_hp instead of local constants
                    const maxHP = monsterData.maxHp;
                    
                    // Update health bar width based on current HP percentage
                    const healthPercent = monsterData.hp / maxHP;
                    healthBar.width = MONSTER_HEALTH_BAR_WIDTH * healthPercent;
                    
                    // Update health bar color based on percentage
                    healthBar.fillColor = this.getHealthBarColor(healthPercent);
                    
                    // Update HP data in container
                    existingMonster.setData('currentHP', monsterData.hp);
                    existingMonster.setData('maxHP', maxHP);
                    break;
                }
            }
            
            return;
        }
        
        // Get entity data for position
        // Check if we have an entity for this monster
        const entityData = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(monsterData.entityId);
        
        if (entityData) {
            // We have entity data, so create the sprite at the correct position
            this.createMonsterSprite(monsterData, entityData.position);
        } else {
            // No entity data yet, store monster as pending
            
            // Check if we already have a sprite - if so, we need to delay until we get entity data
            let existingContainer = this.monsters.get(monsterData.monsterId);
            if (!existingContainer) {
                // No sprite yet, create a temporary one at origin for now
                this.createMonsterSprite(monsterData, { x: 0, y: 0 });
            }
            
            // Store monster data for later when we get entity data
            this.pendingMonsters.set(monsterData.entityId, monsterData);
        }
    }
    
    // Helper function to create monster sprite at a given position
    createMonsterSprite(monsterData: Monsters, position: { x: number, y: number }) {
        // Get monster type from bestiaryId
        const monsterType = monsterData.bestiaryId.tag;
        const spriteKey = MONSTER_ASSET_KEYS[monsterType];
        
        
        if (!spriteKey || !this.scene.textures.exists(spriteKey)) {
            console.error(`Missing texture for monster type: ${monsterType}`);
            return;
        }
        
        // Check if we already have this monster
        if (this.monsters.has(monsterData.monsterId)) {
            // Update existing monster
            const monsterContainer = this.monsters.get(monsterData.monsterId);
            if (monsterContainer) {
                // Update position
                
                // Force direct position update - no tweening
                monsterContainer.setPosition(position.x, position.y);
                
                // Update depth based on Y position
                monsterContainer.setDepth(BASE_DEPTH + position.y);
                
                // Update health bar if it exists
                const children = monsterContainer.getAll();
                for (const child of children) {
                    if (child.name === 'healthBar') {
                        const healthBar = child as Phaser.GameObjects.Rectangle;
                        // Use monster server data instead of local constants
                        const maxHP = monsterData.maxHp;
                        
                        // Update health bar width based on current HP percentage
                        const healthPercent = monsterData.hp / maxHP;
                        healthBar.width = MONSTER_HEALTH_BAR_WIDTH * healthPercent;
                        
                        // Update health bar color based on percentage
                        healthBar.fillColor = this.getHealthBarColor(healthPercent);
                        
                        // Update HP data in container
                        monsterContainer.setData('currentHP', monsterData.hp);
                        monsterContainer.setData('maxHP', monsterData.maxHp);
                        break;
                    }
                }
                
                // Find and update radius visualization if debug mode is on
                this.updateCollisionCircle(monsterContainer, monsterData.entityId);
            }
        } else {
            // Create new monster sprite
            
            // Calculate depth based on Y position
            const initialDepth = BASE_DEPTH + position.y;
            
            // Create container for monster and its components
            const container = this.scene.add.container(position.x, position.y);
            
            // Get monster-specific shadow offset from lookup table
            const shadowOffset = MONSTER_SHADOW_OFFSETS[monsterType] || 8; // Use default if not found
            
            // Add shadow with monster-specific offset
            const shadow = this.scene.add.image(0, shadowOffset, SHADOW_ASSET_KEY)
                .setAlpha(SHADOW_ALPHA)
                .setDepth(SHADOW_DEPTH_OFFSET); // Relative depth within container
            shadow.setScale(0.7); // Make monster shadows slightly smaller
            
            // Add sprite
            const sprite = this.scene.add.sprite(0, 0, spriteKey);
            sprite.setDepth(0); // Base sprite at 0 relative to container
            sprite.name = 'sprite'; // Name the sprite for easier identification later
            
            // Use the server-provided max_hp instead of hardcoded values
            const maxHP = monsterData.maxHp;
            
            // Store health data in container
            container.setData('maxHP', maxHP);
            container.setData('currentHP', monsterData.hp);
            container.setData('entityId', monsterData.entityId);
            container.setData('monsterId', monsterData.monsterId);
            container.setData('monsterType', monsterType);
            
            // Health bar background
            const healthBarBg = this.scene.add.rectangle(
                0,
                -sprite.height/2 - MONSTER_HEALTH_BAR_OFFSET_Y,
                MONSTER_HEALTH_BAR_WIDTH,
                MONSTER_HEALTH_BAR_HEIGHT,
                0x000000,
                0.7
            );
            healthBarBg.setDepth(HEALTH_BG_DEPTH_OFFSET); // Relative depth
            
            // Health bar
            const healthPercent = monsterData.hp / maxHP;
            const healthBar = this.scene.add.rectangle(
                -MONSTER_HEALTH_BAR_WIDTH/2,
                -sprite.height/2 - MONSTER_HEALTH_BAR_OFFSET_Y,
                MONSTER_HEALTH_BAR_WIDTH * healthPercent,
                MONSTER_HEALTH_BAR_HEIGHT,
                this.getHealthBarColor(healthPercent), // Use color based on health percentage
                1
            );
            healthBar.setOrigin(0, 0.5);
            healthBar.setDepth(HEALTH_BAR_DEPTH_OFFSET); // Relative depth
            healthBar.name = 'healthBar';
            
            // Add all components to container
            container.add([shadow, sprite, healthBarBg, healthBar]);
            
            // Set container properties
            container.setDepth(initialDepth);
            container.setSize(sprite.width, sprite.height);
            
            // Create collision circle visualization (will only be visible in debug mode)
            this.createCollisionCircle(container, monsterData.entityId);
            
            // Store in monsters map
            this.monsters.set(monsterData.monsterId, container);
        }
    }
    
    // Create a visual representation of collision circle (for debugging)
    private createCollisionCircle(container: Phaser.GameObjects.Container, entityId: number) {
        // For now, we'll only create this in debug mode
        const DEBUG_COLLISIONS = false; // Set to true to enable collision circle visualization
        
        if (!DEBUG_COLLISIONS) return;
        
        const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entityId.find(entityId);
        if (!entityData) return;
        
        // Get radius from entity data or fallback to defaults based on monster type
        // Note: We're accessing radius as a property that might not be in the type yet
        const radius = (entityData as any).radius || this.getDefaultRadiusForMonster(container);
        
        // Create the collision circle
        const circle = this.scene.add.circle(0, 0, radius, 0xff0000, 0.2);
        circle.setStrokeStyle(1, 0xff0000, 0.8);
        circle.setDepth(-2); // Below sprite
        circle.name = 'collisionCircle';
        
        // Add to container
        container.add(circle);
    }
    
    // Update the collision circle when entity data changes
    private updateCollisionCircle(container: Phaser.GameObjects.Container, entityId: number) {
        // For now, we'll only update this in debug mode
        const DEBUG_COLLISIONS = false; // Set to true to enable collision circle visualization
        
        if (!DEBUG_COLLISIONS) return;
        
        const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entityId.find(entityId);
        if (!entityData) return;
        
        // Get radius from entity data or fallback to defaults based on monster type
        // Note: We're accessing radius as a property that might not be in the type yet
        const radius = (entityData as any).radius || this.getDefaultRadiusForMonster(container);
        
        // Find existing collision circle
        const children = container.getAll();
        for (const child of children) {
            if (child.name === 'collisionCircle') {
                const circle = child as Phaser.GameObjects.Arc;
                circle.setRadius(radius);
                return;
            }
        }
        
        // If no collision circle exists yet, create it
        this.createCollisionCircle(container, entityId);
    }
    
    // Helper function to get a default radius based on monster type
    private getDefaultRadiusForMonster(container: Phaser.GameObjects.Container): number {
        const monsterType = container.getData('monsterType');
        
        // Default radii based on monster type
        switch(monsterType) {
            case 'Rat':
                return 24;
            case 'Slime':
                return 30;
            case 'Orc':
                return 40;
            default:
                return 30; // Default radius
        }
    }
    
    // Helper function to remove monster sprites
    removeMonster(monsterId: number) {
        const monsterContainer = this.monsters.get(monsterId);
        if (monsterContainer) {
            monsterContainer.destroy();
            this.monsters.delete(monsterId);
        }
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

    // Get count of pending monsters
    getPendingMonsterCount(): number {
        return this.pendingMonsters.size;
    }

    // Update method to be called from scene's update method
    update(time: number, delta: number) {
        // Process active monsters for smooth interpolation between server updates
        const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(t, 1.0);
        const now = Date.now();
        
        this.monsters.forEach((container, monsterId) => {
            const targetX = container.getData('targetX');
            const targetY = container.getData('targetY');
            const lastUpdate = container.getData('lastUpdateTime');
            const isMoving = container.getData('isMoving');
            
            // If we have target position data and the monster is moving
            if (targetX !== undefined && targetY !== undefined && lastUpdate !== undefined && isMoving) {
                // We already have tweens, this is just additional smoothing if needed
                // This can be enabled if you want extra smoothing between tween updates
                /* 
                const lerpFactor = 0.1;
                container.x = lerp(container.x, targetX, lerpFactor);
                container.y = lerp(container.y, targetY, lerpFactor);
                container.setDepth(BASE_DEPTH + container.y);
                */
            }
        });
    }

    // Add method to clean up event listeners
    unregisterListeners() {
        console.log("Unregistering event listeners for MonsterManager");
        
        // Remove entity event listeners
        this.gameEvents.off(GameEvents.ENTITY_CREATED, this.handleEntityEvent, this);

        // Remove monster event listeners
        this.gameEvents.off(GameEvents.MONSTER_CREATED);
        this.gameEvents.off(GameEvents.MONSTER_UPDATED);
        this.gameEvents.off(GameEvents.MONSTER_DELETED);
    }

    shutdown() {
        this.unregisterListeners();
    }
} 