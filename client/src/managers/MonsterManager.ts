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
        
        // Debug: Print all entity IDs for easier comparison
        console.log("=== ALL ENTITIES ===");
        const entityIds = allEntities.map(e => e.entityId);
        console.log(`Found ${allEntities.length} entities with IDs:`, entityIds);
        
        // Debug: Print all monsters and check if their entities exist
        console.log("=== ALL MONSTERS ===");
        console.log(`Found ${allMonsters.length} monsters`);
        
        // Force immediate update for all monsters with known entities
        for (const monster of allMonsters) {
            const matchingEntity = allEntities.find(e => e.entityId === monster.entityId);
            const entityExists = !!matchingEntity;
            
            console.log(`Monster ID: ${monster.monsterId}, Type: ${monster.bestiaryId.tag}, EntityID: ${monster.entityId}, Entity exists: ${entityExists}`);
            
            if (entityExists && matchingEntity) {
                // Entity exists, create directly with correct position
                console.log(`Creating monster ${monster.monsterId} directly with entity position (${matchingEntity.position.x}, ${matchingEntity.position.y})`);
                this.createMonsterSprite(monster, matchingEntity.position);
            } else {
                // Entity doesn't exist yet, create at origin and track for updates
                console.log(`Creating monster ${monster.monsterId} at origin (0,0) - waiting for entity update`);
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
            console.log(`Monster.onInsert: ID ${monster.monsterId}, Type ${monster.bestiaryId.tag}`);
            this.createOrUpdateMonster(monster);
        });

        this.spacetimeDBClient.sdkConnection.db.monsters.onUpdate((_ctx, _oldMonster: Monsters, newMonster: Monsters) => {
            console.log(`Monster.onUpdate: ID ${newMonster.monsterId}, HP: ${newMonster.hp}`);
            this.createOrUpdateMonster(newMonster);
        });

        this.spacetimeDBClient.sdkConnection.db.monsters.onDelete((_ctx, monster: Monsters) => {
            console.log(`Monster.onDelete: ID ${monster.monsterId}`);
            this.removeMonster(monster.monsterId);
        });
    }

    // Handle entity updates for monsters
    handleEntityUpdate(entityData: Entity) {
        // Check if we have a pending monster waiting for this entity
        const pendingMonster = this.pendingMonsters.get(entityData.entityId);
        if (pendingMonster) {
            console.log(`Found pending monster ID ${pendingMonster.monsterId} for entity ${entityData.entityId}. Updating position.`);
            
            // Check if the monster sprite exists already
            const monsterContainer = this.monsters.get(pendingMonster.monsterId);
            if (monsterContainer) {
                // Update the monster position
                monsterContainer.x = entityData.position.x;
                monsterContainer.y = entityData.position.y;
                
                // Update depth based on Y position
                monsterContainer.setDepth(BASE_DEPTH + entityData.position.y);
                
                console.log(`Updated monster ${pendingMonster.monsterId} position to (${entityData.position.x}, ${entityData.position.y})`);
                
                // Remove from pending after updating
                this.pendingMonsters.delete(entityData.entityId);
                console.log(`Remaining pending monsters: ${this.pendingMonsters.size}`);
                return true;
            } else {
                // Create the monster with the entity position
                console.log(`Creating monster ${pendingMonster.monsterId} with entity position`);
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
                    console.log(`Updating position for monster ${monster.monsterId} from (${monsterContainer.x}, ${monsterContainer.y}) to (${entityData.position.x}, ${entityData.position.y})`);
                    
                    // IMPORTANT: Set position directly AND IMMEDIATELY instead of recording it for later
                    monsterContainer.x = entityData.position.x;
                    monsterContainer.y = entityData.position.y;
                    
                    // Update depth based on Y position
                    monsterContainer.setDepth(BASE_DEPTH + entityData.position.y);
                    
                    // Verify position was updated
                    console.log(`Monster ${monster.monsterId} position after update: (${monsterContainer.x}, ${monsterContainer.y})`);
                } else {
                    // If container doesn't exist yet, try to create it
                    console.log(`Monster container not found for monster ID ${monster.monsterId}, creating it now at (${entityData.position.x}, ${entityData.position.y})`);
                    this.createMonsterSprite(monster, entityData.position);
                }
                return true;
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
            console.log(`Monster ${monsterData.monsterId} already exists at non-zero position (${existingMonster.x}, ${existingMonster.y}). Preserving position.`);
            
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
                    console.log(`Updated monster ${monsterData.monsterId} health: ${monsterData.hp}/${monsterData.maxHp}`);
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
            console.log(`Total pending monsters: ${this.pendingMonsters.size}`);
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
        
        console.log(`Creating monster sprite: ID ${monsterData.monsterId}, Type ${monsterType}, Position (${position.x}, ${position.y}), HP: ${monsterData.hp}/${monsterData.maxHp}`);
        
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
                console.log(`Updating existing monster ${monsterData.monsterId} position from (${monsterContainer.x}, ${monsterContainer.y}) to (${position.x}, ${position.y})`);
                
                // Force direct position update - no tweening
                monsterContainer.setPosition(position.x, position.y);
                
                // Update depth based on Y position
                monsterContainer.setDepth(BASE_DEPTH + position.y);
                
                // Verify position update
                console.log(`Monster ${monsterData.monsterId} position after setPosition: (${monsterContainer.x}, ${monsterContainer.y})`);
                
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
            }
        } else {
            // Create new monster sprite
            console.log(`Creating new monster sprite container: ${monsterType} at (${position.x}, ${position.y})`);
            
            // Calculate depth based on Y position
            const initialDepth = BASE_DEPTH + position.y;
            
            // Create container for monster and its components
            const container = this.scene.add.container(position.x, position.y);
            
            // Verify container position after creation
            console.log(`New monster container created at (${container.x}, ${container.y})`);
            
            // Get monster-specific shadow offset from lookup table
            const shadowOffset = MONSTER_SHADOW_OFFSETS[monsterType] || 8; // Use default if not found
            console.log(`Using shadow offset of ${shadowOffset} for ${monsterType}`);
            
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
            
            console.log(`Set monster depth to ${initialDepth} based on Y position ${position.y}`);
            
            // Store in monsters map
            this.monsters.set(monsterData.monsterId, container);
        }
    }
    
    // Helper function to remove monster sprites
    removeMonster(monsterId: number) {
        const monsterContainer = this.monsters.get(monsterId);
        if (monsterContainer) {
            monsterContainer.destroy();
            this.monsters.delete(monsterId);
            console.log(`Removed monster sprite for monster ID: ${monsterId}`);
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
} 