import Phaser from 'phaser';
import { Monsters, Entity, EventContext, MonsterType } from "../autobindings";
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
const BUFF_EFFECT_DEPTH_OFFSET = 0.5; // Between sprite and health bar

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
    // Add a property to track boss state
    private bossPhase1Killed: boolean = false;
    private timeOfBossPhase1Death: number = 0;
    private bossMonsterId: number = 0;
    private bossPosition: { x: number, y: number } | null = null;

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

        this.gameEvents.on(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);

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
                this.applySimonBuffEffect(pendingMonster); // Apply buff effect
                return true;
            } else {
                // Create the monster with the entity position
                // Remove from pending monsters first to avoid infinite recursion
                this.pendingMonsters.delete(entityData.entityId);
                // Create the monster with the entity data
                this.createMonsterSprite(pendingMonster, entityData.position);
                this.applySimonBuffEffect(pendingMonster); // Apply buff effect
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
                
                const monsterType = this.getMonsterTypeName(monster.bestiaryId);
                
                // Store target position for lerping in update
                monsterContainer.setData('targetX', entityData.position.x);
                monsterContainer.setData('targetY', entityData.position.y);
                monsterContainer.setData('lastUpdateTime', Date.now());
                
                // Use tween for smooth movement instead of direct position setting
                const isMoving = entityData.isMoving;
                
                // If monster is far away from its current server position, teleport it instead of tweening
                const distSquared = Math.pow(monsterContainer.x - entityData.position.x, 2) + 
                                   Math.pow(monsterContainer.y - entityData.position.y, 2);
                
                if (distSquared > 10000) { // If distance squared is greater than 100^2 (100 pixels)
                    // Teleport directly
                    monsterContainer.x = entityData.position.x;
                    monsterContainer.y = entityData.position.y;
                } else if (isMoving) {
                    // Tween to new position if moving
                    this.scene.tweens.add({
                        targets: monsterContainer,
                        x: entityData.position.x,
                        y: entityData.position.y,
                        duration: 100, // Duration of the tween in ms
                        ease: 'Linear'
                    });
                } else {
                    // If not moving, set position directly (snap to position)
                    monsterContainer.x = entityData.position.x;
                    monsterContainer.y = entityData.position.y;
                }
                
                // Store the movement state and monster type
                monsterContainer.setData('isMoving', isMoving);
                monsterContainer.setData('monsterType', monsterType);
                monsterContainer.setData('direction', {
                    x: entityData.direction.x,
                    y: entityData.direction.y
                });
                this.applySimonBuffEffect(monster); // Apply buff effect
                return true;
            } else {
                // If container doesn't exist yet, try to create it
                this.createMonsterSprite(monster, entityData.position);
                this.applySimonBuffEffect(monster); // Apply buff effect
                return true;
            }
        }
        
        // If we didn't find the monster with the index above, try a fallback approach
        // This is a slower method but will work if the index isn't defined
        if (!monster) {
            // Iterate through monsters to find one with this entityId
            for (const iterMonster of ctx.db?.monsters.iter() || []) {
                if (iterMonster.entityId === entityData.entityId) {
                    // Found a match, call createOrUpdateMonster to handle it
                    this.createOrUpdateMonster(iterMonster);
                    // this.applySimonBuffEffect(iterMonster); // applySimonBuffEffect will be called by createOrUpdateMonster
                    return true; // Exit after handling
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
        const existingMonsterContainer = this.monsters.get(monsterData.monsterId);
        if (existingMonsterContainer && (existingMonsterContainer.x !== 0 || existingMonsterContainer.y !== 0)) {
            
            // Get current HP to compare
            const currentHp = existingMonsterContainer.getData('currentHP') || monsterData.maxHp;
            
            // Show damage effect if HP decreased
            if (monsterData.hp < currentHp) {
                const sprite = existingMonsterContainer.getByName('sprite') as Phaser.GameObjects.Sprite;
                if (sprite) {
                    // Flash red effect
                    sprite.setTintFill(0xff0000); // Red tint
                    this.scene.time.delayedCall(100, () => {
                        sprite.clearTint(); // Remove tint after 100ms
                    });
                }
            }
            
            // Just update health and other properties, but keep the position
            const healthBar = existingMonsterContainer.getByName('healthBar') as Phaser.GameObjects.Rectangle;
            if (healthBar) {
                const healthPercent = monsterData.hp / monsterData.maxHp;
                // Update the width of the rectangle - no need to call clear() on a Rectangle
                healthBar.width = MONSTER_HEALTH_BAR_WIDTH * healthPercent;
                // Update the fill color
                healthBar.fillColor = this.getHealthBarColor(healthPercent);
            }
            existingMonsterContainer.setData('currentHP', monsterData.hp);
            this.applySimonBuffEffect(monsterData); // Apply buff effect
            return;
        }
        
        // Get entity data for position
        // Check if we have an entity for this monster
        const entityData = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(monsterData.entityId);
        
        if (entityData) {
            // We have entity data, so create the sprite at the correct position
            this.createMonsterSprite(monsterData, entityData.position);
            this.applySimonBuffEffect(monsterData); // Apply buff effect
        } else {
            // No entity data yet, store monster as pending
            
            // Check if we already have a sprite - if so, we need to delay until we get entity data
            let existingContainer = this.monsters.get(monsterData.monsterId);
            if (!existingContainer) {
                // No sprite yet, create a temporary one at origin for now
                // This helps ensure the container exists if monsterData arrives before entityData
                this.createMonsterSprite(monsterData, { x: 0, y: 0 });
            }
            
            // Store monster data for later when we get entity data
            this.pendingMonsters.set(monsterData.entityId, monsterData);
            // Buff effect will be applied in handleEntityUpdate when entity arrives
        }
    }
    
    // Helper function to apply Simon's buff effect
    private applySimonBuffEffect(monsterData: Monsters) {
        const monsterContainer = this.monsters.get(monsterData.monsterId);
        if (!monsterContainer) {
            return;
        }

        const monsterType = this.getMonsterTypeName(monsterData.bestiaryId);
        if (isSimonType(monsterType)) {
            const baseSpeed = monsterType === "FinalBossSimonPhase1" ? 120 : 150;
            const baseAtk = monsterType === "FinalBossSimonPhase1" ? 25 : 40;
            
            // MonsterData from the server already contains buffed stats
            const isBuffed = monsterData.speed > baseSpeed || monsterData.atk > baseAtk;

            // First remove any existing buff sprite
            const existingSprite = monsterContainer.getByName('simonBuffEffect');
            if (existingSprite) {
                existingSprite.destroy();
            }

            // Also clean up any existing tweens
            this.scene.tweens.killTweensOf(monsterContainer.getData('simonBuffTween'));

            if (isBuffed) {
                // Create a single buff sprite above the boss
                const buffSprite = this.scene.add.sprite(0, -50, 'attack_boss_simon');
                buffSprite.setOrigin(0.5, 0.5);
                buffSprite.setScale(0.7);
                buffSprite.setAlpha(0.9);
                buffSprite.setName('simonBuffEffect');
                monsterContainer.add(buffSprite);
                
                // Store reference for later cleanup
                monsterContainer.setData('simonBuffTween', buffSprite);
                
                // Simple pulse animation
                this.scene.tweens.add({
                    targets: buffSprite,
                    scale: 0.9,
                    duration: 500,
                    yoyo: true,
                    repeat: 3,
                    ease: 'Sine.easeInOut',
                    onComplete: () => {
                        // Automatically remove after the animation completes
                        if (buffSprite) {
                            buffSprite.destroy();
                        }
                    }
                });
            }
        }
    }

    // Helper function to create monster sprite at a given position
    createMonsterSprite(monsterData: Monsters, position: { x: number, y: number }) {
        // Get monster type from bestiaryId
        const monsterType = monsterData.bestiaryId.tag;
        const spriteKey = MONSTER_ASSET_KEYS[monsterType];
        
        console.log(`Creating monster sprite: type=${monsterType}, spriteKey=${spriteKey}, position=(${position.x}, ${position.y})`);
        
        if (!spriteKey) {
            console.error(`No sprite key defined for monster type: ${monsterType}`);
            return;
        }
        
        if (!this.scene.textures.exists(spriteKey)) {
            console.error(`Missing texture for monster type: ${monsterType}, key: ${spriteKey}`);
            console.log('Available textures:', this.scene.textures.list);
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
            try {
                console.log(`Creating new monster container for ${monsterType} at (${position.x}, ${position.y})`);
                
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
                
                console.log(`Added shadow for ${monsterType}`);
                
                // Add sprite with error handling
                let sprite;
                try {
                    sprite = this.scene.add.sprite(0, 0, spriteKey);
                    sprite.setDepth(0); // Base sprite at 0 relative to container
                    sprite.name = 'sprite'; // Name the sprite for easier identification later
                    
                    // For bosses, make them larger and ensure visibility
                    if (isBossType(monsterType)) {
                        console.log(`Setting up boss sprite: ${monsterType} (ID: ${monsterData.monsterId})`);
                        console.log(`Boss data: HP=${monsterData.hp}/${monsterData.maxHp}, Entity ID=${monsterData.entityId}`);
                        sprite.setScale(1.0);
                        sprite.setAlpha(1); // Ensure full opacity
                        sprite.setVisible(true); // Explicitly set visibility
                        
                        // Debug check for texture
                        console.log(`Boss sprite properties: visible=${sprite.visible}, alpha=${sprite.alpha}, scale=${sprite.scaleX}, texture=${sprite.texture.key}`);
                        console.log(`Is boss sprite texture missing: ${sprite.texture.key === '__MISSING'}`);
                    }
                    
                    console.log(`Added sprite for ${monsterType}: visible=${sprite.visible}, alpha=${sprite.alpha}`);
                } catch (e) {
                    console.error(`Failed to create sprite for ${monsterType}:`, e);
                    return;
                }
                
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
                container.setAlpha(1); // Ensure fully visible
                container.setVisible(true); // Ensure visible
                
                // Create collision circle visualization (will only be visible in debug mode)
                this.createCollisionCircle(container, monsterData.entityId);
                
                // Store in monsters map
                this.monsters.set(monsterData.monsterId, container);
                
                console.log(`Successfully created monster: ${monsterType} (ID: ${monsterData.monsterId})`);
                
                // If this is a boss, do additional logging
                if (isBossType(monsterType)) {
                    console.log(`BOSS CONTAINER: visible=${container.visible}, alpha=${container.alpha}, x=${container.x}, y=${container.y}, depth=${container.depth}`);
                    console.log(`BOSS SPRITE: visible=${sprite.visible}, alpha=${sprite.alpha}`);
                }
            } catch (error) {
                console.error(`Failed to create monster sprite for ${monsterType}:`, error);
            }
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
            case 'Wolf':
                return 34;
            case 'Orc':
                return 40;
            default:
                return 30; // Default radius
        }
    }
    
    // Helper function to remove monster sprites
    removeMonster(monsterId: number) {
        console.log(`Removing monster: ${monsterId}`);
        
        // Check if this was a boss monster before removing it
        const monsterContainer = this.monsters.get(monsterId);
        if (monsterContainer) {
            const monsterType = monsterContainer.getData('monsterType');
            if (isBossType(monsterType)) {
                console.log(`*** BOSS PHASE 1 DEFEATED (ID: ${monsterId})! Waiting for phase 2 to spawn... ***`);
                
                // Set tracking variables to monitor phase transition
                this.bossPhase1Killed = true;
                this.timeOfBossPhase1Death = Date.now();
                this.bossMonsterId = monsterId;
                this.bossPosition = { x: monsterContainer.x, y: monsterContainer.y };
                console.log(`Boss position stored: (${this.bossPosition.x}, ${this.bossPosition.y})`);
                
                // Add a visual indicator for phase transition
                this.createBossTransformationEffect(monsterContainer.x, monsterContainer.y);
            } else if (isBossType(monsterType)) {
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

    // Get count of pending monsters
    getPendingMonsterCount(): number {
        return this.pendingMonsters.size;
    }

    // Update method to be called from scene's update method
    update(time: number, delta: number) {
        // Perform the boss transition check
        this.checkForBossPhaseTransition();
        
        // Existing update logic
        const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(t, 1.0);
        
        // Update monster positions via lerping
        this.monsters.forEach((container, id) => {
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
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);
        this.gameEvents.off(GameEvents.MONSTER_UPDATED);
        this.gameEvents.off(GameEvents.MONSTER_DELETED);
    }

    shutdown() {
        this.unregisterListeners();
    }

    // Handles when a monster is created
    handleMonsterCreated(ctx: EventContext, monster: Monsters) {
        // Get the entity for this monster
        const entityData = ctx.db?.entity.entityId.find(monster.entityId);
        const monsterTypeName = this.getMonsterTypeName(monster.bestiaryId);
        
        console.log(`Monster created: ${monster.monsterId}, type: ${monsterTypeName}, entity: ${monster.entityId}`);
        
        // Special handling for boss monsters
        if (isBossType(monsterTypeName)) {
            console.log(`BOSS SPAWNED: ${monsterTypeName}`);
            console.log(`- Monster ID: ${monster.monsterId}`);
            console.log(`- Entity ID: ${monster.entityId}`);
            console.log(`- HP: ${monster.hp}/${monster.maxHp}`);
            console.log(`- Asset key: ${MONSTER_ASSET_KEYS[monsterTypeName]}`);
            console.log(`- Texture exists: ${this.scene.textures.exists(MONSTER_ASSET_KEYS[monsterTypeName])}`);
            
            if (entityData) {
                console.log(`- Position: (${entityData.position.x}, ${entityData.position.y})`);
            } else {
                console.log(`- WARNING: No entity data found for boss!`);
            }
            
            // Log information about all entities to help with debugging
            console.log("All entities in database:");
            for (const entity of ctx.db?.entity.iter() || []) {
                console.log(`- Entity ID: ${entity.entityId}, Position: (${entity.position.x}, ${entity.position.y})`);
            }
            
            // If this is phase 2, it means phase 1 was defeated
            if (monsterTypeName === "FinalBossJorgePhase2" || monsterTypeName === "FinalBossBjornPhase2" || monsterTypeName === "FinalBossSimonPhase2") {
                console.log("*** PHASE 2 OF THE BOSS HAS BEGUN! ***");
                
                // Reset phase 1 tracking variables since phase 2 has spawned
                if (this.bossPhase1Killed) {
                    const transitionTime = Date.now() - this.timeOfBossPhase1Death;
                    console.log(`Phase transition took ${transitionTime}ms from phase 1 death to phase 2 spawn`);
                    this.bossPhase1Killed = false;
                }
                
                // Play a dramatic sound effect or add special visual effects here
            }
            
            // Log all sprites to debug visibility issues
            this.debugLogAllSprites();
        }
        
        if (!entityData) {
            console.warn(`Monster created but no entity found: ${monster.monsterId} (type: ${monsterTypeName})`);
            return;
        }

        // If this is final boss phase 2 and it just spawned, play the dark transformation effect
        if (isBossType(monsterTypeName)) {
            console.log("Final Boss Phase 2 spawned - playing transformation effect");
            this.createBossTransformationEffect(entityData.position.x, entityData.position.y);
        }
        
        // Create the monster sprite
        this.createMonsterSprite(monster, entityData.position);
        
        // For boss monsters, do an additional check after creation
        if (isBossType(monsterTypeName)) {
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
            case 3: return "FinalBossJorgePhase1";
            case 4: return "FinalBossJorgePhase2";
            case 5: return "FinalBossBjornPhase1";
            case 6: return "FinalBossBjornPhase2";
            case 7: return "FinalBossSimonPhase1";
            case 8: return "FinalBossSimonPhase2";
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
        
        // Play a sound effect if available
        // If you have a sound asset for boss transition:
        // const sound = this.scene.sound.add('boss_transform_sound');
        // if (sound) sound.play({ volume: 0.5 });
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
}

function isBossType(monsterType: string): boolean {
    return [
        "FinalBossJorgePhase1", "FinalBossJorgePhase2",
        "FinalBossBjornPhase1", "FinalBossBjornPhase2",
        "FinalBossSimonPhase1", "FinalBossSimonPhase2"
    ].includes(monsterType);
}

function isSimonType(monsterType: string): boolean {
    return ["FinalBossSimonPhase1", "FinalBossSimonPhase2"].includes(monsterType);
}