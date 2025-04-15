import Phaser from 'phaser';
import { Monsters, Entity } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { MONSTER_ASSET_KEYS, MONSTER_SHADOW_OFFSETS, MONSTER_MAX_HP } from '../constants/MonsterConfig';

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

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        console.log("MonsterManager initialized");
    }

    // Initialize monster handlers
    initializeMonsters() {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize monsters: database connection not available");
            return;
        }

        console.log("Initializing existing monsters from SpacetimeDB...");
        const allMonsters = Array.from(this.spacetimeDBClient.sdkConnection.db.monsters.iter());
        const allEntities = Array.from(this.spacetimeDBClient.sdkConnection.db.entity.iter());
        
        const entityIds = allEntities.map(e => e.entityId);
        
        // Force immediate update for all monsters with known entities
        for (const monster of allMonsters) {
            const matchingEntity = allEntities.find(e => e.entityId === monster.entityId);
            const entityExists = !!matchingEntity;
            
            if (entityExists && matchingEntity) {
                // Entity exists, create directly with correct position
                this.createMonsterSprite(monster, matchingEntity.position);
            } else {
                // Entity doesn't exist yet, create at origin and track for updates
                this.createOrUpdateMonster(monster);
            }
        }

        // Register monster listeners
        this.registerMonsterListeners();
    }

    // Register monster-related event listeners
    registerMonsterListeners() {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot register monster listeners: database connection not available");
            return;
        }

        this.spacetimeDBClient.sdkConnection.db.monsters.onInsert((_ctx, monster: Monsters) => {
            this.createOrUpdateMonster(monster);
        });

        this.spacetimeDBClient.sdkConnection.db.monsters.onUpdate((_ctx, _oldMonster: Monsters, newMonster: Monsters) => {
            this.createOrUpdateMonster(newMonster);
        });

        this.spacetimeDBClient.sdkConnection.db.monsters.onDelete((_ctx, monster: Monsters) => {
            this.removeMonster(monster.monsterId);
        });
    }

    // Handle entity updates for monsters
    handleEntityUpdate(entityData: Entity) {
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
        
        // Check if this entity belongs to an existing monster
        for (const monster of this.spacetimeDBClient.sdkConnection?.db?.monsters.iter() || []) {
            if (monster.entityId === entityData.entityId) {
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
        }
        
        // Not a monster entity
        return false;
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
                    
                    // Update HP data in container
                    existingMonster.setData('currentHP', monsterData.hp);
                    existingMonster.setData('maxHP', monsterData.maxHp);
                    break;
                }
            }
            
            // Add to pending monsters if we still don't have entity data
            const entityData = this.spacetimeDBClient.sdkConnection.db.entity.entity_id.find(monsterData.entityId);
            if (!entityData) {
                this.pendingMonsters.set(monsterData.entityId, monsterData);
            }
            
            return;
        }
        
        // Get entity data for the monster
        const entityData = this.spacetimeDBClient.sdkConnection.db.entity.entity_id.find(monsterData.entityId);
        if (!entityData) {
            console.warn(`Monster ${monsterData.monsterId} (Type: ${monsterData.bestiaryId.tag}) has no entity data yet. Creating at default position.`);
            
            // Instead of waiting for entity data, create the monster at a default position (0,0)
            // The entity update will move it to the correct position when it arrives
            const defaultPosition = { x: 0, y: 0 };
            
            // Create the monster with default position
            this.createMonsterSprite(monsterData, defaultPosition);
            
            // Still store in pending monsters so we can update position when entity arrives
            this.pendingMonsters.set(monsterData.entityId, monsterData);
            return;
        }

        // Create or update with actual entity data
        this.createMonsterSprite(monsterData, entityData.position);
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
                0xFF0000, // Red health bar for monsters
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
        
        const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entity_id.find(entityId);
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
        
        const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entity_id.find(entityId);
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
} 