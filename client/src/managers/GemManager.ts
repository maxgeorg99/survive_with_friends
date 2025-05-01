import Phaser from 'phaser';
import { EventContext } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import { GEM_ASSET_KEYS, GEM_ANIMATION, GEM_PARTICLE_COLORS } from '../constants/GemConfig';

// Constants from GameScene
const SHADOW_ASSET_KEY = 'shadow';
const SHADOW_ALPHA = 0.4;

// Depth sorting constants (matching those in GameScene)
const BASE_DEPTH = 1000; // Base depth to ensure all sprites are above background
const SHADOW_DEPTH_OFFSET = -1; // Always behind the sprite

export default class GemManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    // Client for database access
    private spacetimeDBClient: SpacetimeDBClient;
    // Map to store gem sprites (keyed by gemId)
    private gems: Map<number, Phaser.GameObjects.Container> = new Map();
    // Map to hold gem data waiting for corresponding entity data (keyed by entityId)
    private pendingGems: Map<number, any> = new Map();
    // Add a property for the game events
    private gameEvents: Phaser.Events.EventEmitter;
    // Particle emitter for gems
    private particleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        this.gameEvents = (window as any).gameEvents;
        console.log("GemManager constructed");

        // Initialize particles - in Phaser 3.60+ add.particles() returns a ParticleEmitter directly
        this.particleEmitter = this.scene.add.particles(0, 0, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: 0.6,
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 800,
            tint: 0xffffff // Default white tint
        });
    }

    // Initialize gem handlers
    initializeGems(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize gems: database connection not available");
            return;
        }

        console.log("GemManager initializing gems");
        
        // Register gem listeners
        this.registerGemListeners();
        
        // Register entity event listeners
        this.registerEntityListeners();
        
        // Force immediate update for all gems with known entities
        // Check if gems table exists in the database
        if (this.spacetimeDBClient.sdkConnection.db.entity) {
            try {
                // Try to access the gems table - if bindings aren't updated yet this might fail
                // @ts-ignore - Ignore TS error since table might not exist in bindings
                const gemsTable = this.spacetimeDBClient.sdkConnection.db.gems;
                
                if (gemsTable && typeof gemsTable.iter === 'function') {
                    for (const gem of gemsTable.iter()) {
                        // Look up the entity directly using the entity_id index
                        const entityData = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(gem.entityId);
                        
                        if (entityData) {
                            // Entity exists, create directly with correct position
                            this.createGemSprite(gem, entityData.position);
                        } else {
                            // Entity doesn't exist yet, track for updates
                            this.createOrUpdateGem(gem);
                        }
                    }
                } else {
                    console.log("Gems table not found or not accessible, waiting for gem events");
                }
            } catch (e) {
                console.warn("Error accessing gems table, it might not be available in the current bindings:", e);
            }
        }
    }

    // Register gem-related event listeners
    registerGemListeners() {
        console.log("Registering gem listeners for GemManager");

        this.gameEvents.on(GameEvents.GEM_CREATED, (ctx: EventContext, gem: any) => {
            this.createOrUpdateGem(gem);
        });

        this.gameEvents.on(GameEvents.GEM_UPDATED, (ctx: EventContext, oldGem: any, newGem: any) => {
            this.createOrUpdateGem(newGem);
        });

        this.gameEvents.on(GameEvents.GEM_DELETED, (ctx: EventContext, gem: any) => {
            this.removeGem(gem.gemId);
        });
    }

    // Register entity event listeners
    registerEntityListeners() {
        console.log("Registering entity event listeners for GemManager");
        
        // Listen for entity events
        this.gameEvents.on(GameEvents.ENTITY_CREATED, this.handleEntityEvent, this);
        this.gameEvents.on(GameEvents.ENTITY_UPDATED, this.handleEntityEvent, this);
    }

    // Handle entity events
    handleEntityEvent(ctx: EventContext, entity: any) {
        // Call the handleEntityUpdate method to update gem positions
        this.handleEntityUpdate(ctx, entity);
    }

    // Handle entity updates for gems
    handleEntityUpdate(ctx: EventContext, entityData: any) {
        // Check if we have a pending gem waiting for this entity
        const pendingGem = this.pendingGems.get(entityData.entityId);
        if (pendingGem) {
            // Check if the gem sprite exists already
            const gemContainer = this.gems.get(pendingGem.gemId);
            if (gemContainer) {
                // For pending gems, set position immediately to avoid teleporting from (0,0)
                gemContainer.x = entityData.position.x;
                gemContainer.y = entityData.position.y;
                
                // Update depth based on Y position
                gemContainer.setDepth(BASE_DEPTH + entityData.position.y);
                
                // Remove from pending after updating
                this.pendingGems.delete(entityData.entityId);
                return true;
            } else {
                // Create the gem with the entity position
                // Remove from pending gems first to avoid infinite recursion
                this.pendingGems.delete(entityData.entityId);
                // Create the gem with the entity data
                this.createGemSprite(pendingGem, entityData.position);
                return true;
            }
        }
        
        // Check if this entity belongs to an existing gem
        try {
            // Try to look up gems by entityId - might fail if bindings aren't updated
            // @ts-ignore - Ignore TS error since table might not exist in bindings
            const gemsTable = ctx.db?.gems;
            // @ts-ignore - We're handling potential errors with try-catch
            if (gemsTable && typeof gemsTable.entityId?.find === 'function') {
                // @ts-ignore - We're handling potential errors with try-catch
                const gem = gemsTable.entityId.find(entityData.entityId);
                
                if (gem) {
                    // Entity belongs to a gem, update its position
                    const gemContainer = this.gems.get(gem.gemId);
                    if (gemContainer) {
                        // Update the position immediately since gems don't move
                        gemContainer.x = entityData.position.x;
                        gemContainer.y = entityData.position.y;
                        
                        // Update depth based on Y position
                        gemContainer.setDepth(BASE_DEPTH + entityData.position.y);
                        
                        return true;
                    }
                }
            }
        } catch (e) {
            // Ignore error, it means the gems table is not available in bindings
        }
        
        return false;
    }

    // Create or update a gem in the pending list
    createOrUpdateGem(gemData: any) {
        console.log(`Creating/updating gem ${gemData.gemId} of level ${gemData.level}`);
        
        // If we already have this gem, update it
        if (this.gems.has(gemData.gemId)) {
            // Update gem data if needed
            // (Currently nothing to update for gems except position via entity)
            return;
        }

        // Check if the entity exists
        let entityPosition = null;
        if (this.spacetimeDBClient?.sdkConnection?.db?.entity) {
            const entityData = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(gemData.entityId);
            if (entityData) {
                entityPosition = entityData.position;
            }
        }

        if (entityPosition) {
            // Entity exists, create directly with position
            this.createGemSprite(gemData, entityPosition);
        } else {
            // Entity doesn't exist yet, add to pending
            console.log(`Gem ${gemData.gemId} waiting for entity ${gemData.entityId}`);
            this.pendingGems.set(gemData.entityId, gemData);
        }
    }

    // Create a gem sprite with animations
    createGemSprite(gemData: any, position: { x: number, y: number }) {
        console.log(`Creating gem sprite for gem ${gemData.gemId}, level ${gemData.level}`);

        // Create a container for the gem and its shadow
        const container = this.scene.add.container(position.x, position.y);
        
        // Get the asset key based on gem level
        const gemLevel = gemData.level; // This is an enum (0, 1, 2, 3 for Small, Medium, etc.)
        const assetKey = GEM_ASSET_KEYS[gemLevel] || GEM_ASSET_KEYS[0]; // Default to small gem if not found
        
        // Create shadow
        const shadow = this.scene.add.image(0, 0, SHADOW_ASSET_KEY);
        shadow.setAlpha(SHADOW_ALPHA);
        shadow.setScale(0.5); // Smaller shadow for gems
        shadow.setDepth(SHADOW_DEPTH_OFFSET);
        
        // Create gem sprite
        const gemSprite = this.scene.add.image(0, 0, assetKey);
        
        // Add to container
        container.add(shadow);
        container.add(gemSprite);
        
        // Set container depth based on Y position
        container.setDepth(BASE_DEPTH + position.y);
        
        // Store gem data
        container.setData('gemId', gemData.gemId);
        container.setData('gemLevel', gemLevel);
        container.setData('entityId', gemData.entityId);
        container.setData('baseY', position.y); // Store original Y for hover animation
        
        // Store hover animation time offset with a random start time for variety
        container.setData('hoverOffset', Math.random() * Math.PI * 2);
        
        // Create hover animation
        this.scene.tweens.add({
            targets: container,
            scaleX: 1.1,
            scaleY: 1.1,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        
        // Add the container to the gems map
        this.gems.set(gemData.gemId, container);
        
        return container;
    }
    
    // Create particles effect when a gem is collected
    createCollectionEffect(gemContainer: Phaser.GameObjects.Container) {
        const gemLevel = gemContainer.getData('gemLevel');
        const color = GEM_PARTICLE_COLORS[gemLevel] || GEM_PARTICLE_COLORS[0];
        
        // In Phaser 3.60+, we need to recreate the particle emitter to change its color
        // Create a new particle emitter with the correct color for this burst
        const burstEmitter = this.scene.add.particles(0, 0, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: 0.6,
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 800,
            tint: color
        });
        
        // Set position and emit particles
        burstEmitter.explode(
            GEM_ANIMATION.COLLECTION_PARTICLES,
            gemContainer.x, 
            gemContainer.y
        );
        
        // Destroy the emitter after particles have expired (after lifespan)
        this.scene.time.delayedCall(800, () => {
            burstEmitter.destroy();
        });
    }

    // Remove a gem and play collection animation
    removeGem(gemId: number) {
        const gemContainer = this.gems.get(gemId);
        if (gemContainer) {
            console.log(`Removing gem ${gemId}`);
            
            // Play collection effect
            this.createCollectionEffect(gemContainer);
            
            // Play scale-down animation before destroying
            this.scene.tweens.add({
                targets: gemContainer,
                scaleX: 0,
                scaleY: 0,
                duration: 200,
                ease: 'Back.easeIn',
                onComplete: () => {
                    // Destroy container and all children
                    gemContainer.destroy(true);
                    
                    // Remove from gems map
                    this.gems.delete(gemId);
                }
            });
        }
    }

    // Get gem by ID
    getGem(gemId: number): Phaser.GameObjects.Container | undefined {
        return this.gems.get(gemId);
    }
    
    // Get all gems
    getAllGems(): Map<number, Phaser.GameObjects.Container> {
        return this.gems;
    }
    
    // Get gem count
    getGemCount(): number {
        return this.gems.size;
    }
    
    // Get pending gem count
    getPendingGemCount(): number {
        return this.pendingGems.size;
    }
    
    // Update method called from game loop
    update(time: number, delta: number) {
        // Update hover animation for all gems
        for (const [gemId, container] of this.gems.entries()) {
            // Apply hover effect
            const baseY = container.getData('baseY') || container.y;
            const hoverOffset = container.getData('hoverOffset') || 0;
            const hoverY = baseY + Math.sin((time / 1000 * GEM_ANIMATION.HOVER_SPEED) + hoverOffset) * GEM_ANIMATION.HOVER_AMPLITUDE;
            
            // Update gem position for hover
            container.y = hoverY;
            
            // Apply slight rotation to gem sprite (not the whole container to keep shadow underneath)
            const gemSprite = container.getAt(1) as Phaser.GameObjects.Image;
            if (gemSprite) {
                gemSprite.rotation += GEM_ANIMATION.ROTATION_SPEED * (delta / 1000);
            }
        }
    }

    // Unregister event listeners
    unregisterListeners() {
        this.gameEvents.off(GameEvents.GEM_CREATED, undefined, this);
        this.gameEvents.off(GameEvents.GEM_UPDATED, undefined, this);
        this.gameEvents.off(GameEvents.GEM_DELETED, undefined, this);
        this.gameEvents.off(GameEvents.ENTITY_CREATED, this.handleEntityEvent, this);
        this.gameEvents.off(GameEvents.ENTITY_UPDATED, this.handleEntityEvent, this);
    }

    // Clean up on shutdown
    shutdown() {
        console.log("Shutting down GemManager");
        
        // Unregister event listeners
        this.unregisterListeners();
        
        // Destroy all gem sprites
        for (const [gemId, container] of this.gems.entries()) {
            container.destroy(true);
        }
        
        // Clear collections
        this.gems.clear();
        this.pendingGems.clear();
        
        // Destroy particle emitter
        if (this.particleEmitter) {
            this.particleEmitter.destroy();
        }
    }
} 