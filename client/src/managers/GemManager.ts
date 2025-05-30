import Phaser from 'phaser';
import { EventContext } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import { GEM_ASSET_KEYS, GEM_ANIMATION, GEM_PARTICLE_COLORS } from '../constants/GemConfig';
import GemLevel from '../autobindings/gem_level_type';

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

    static nextGemManagerId: number = 0;
    private gemManagerId: number;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        this.gameEvents = (window as any).gameEvents;

        GemManager.nextGemManagerId +=1 ;
        this.gemManagerId = GemManager.nextGemManagerId;

        console.log("GemManager constructed", this.gemManagerId);

        // Initialize a single persistent particle emitter (initially inactive)
        this.particleEmitter = this.scene.add.particles(0, 0, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: 0.6,
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 800,
            tint: 0xffffff, // Default white, will be changed on use
            quantity: GEM_ANIMATION.COLLECTION_PARTICLES
        });
        
        // Make sure the emitter is initially stopped to prevent particles in top-left corner
        this.particleEmitter.stop();
    }

    // Initialize gem handlers
    initializeGems(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize gems: database connection not available");
            return;
        }

        console.log("GemManager initializing gems", this.gemManagerId);
        
        // Register gem listeners
        this.registerGemListeners();
        
        // Register entity event listeners
        this.registerEntityListeners();
        
        for (const gem of ctx.db?.gems.iter()) {
            // Look up the entity directly using the entity_id index
            const entityData = ctx.db.entity.entityId.find(gem.entityId);
            
            if (entityData) {
                // Entity exists, create directly with correct position
                this.createGemSprite(gem, entityData.position);
            } else {
                // Entity doesn't exist yet, track for updates
                this.createOrUpdateGem(ctx, gem);
            }
        }
    }

    // Register gem-related event listeners
    registerGemListeners() {
        console.log("Registering gem listeners for GemManager", this.gemManagerId);

        this.gameEvents.on(GameEvents.GEM_CREATED, (ctx: EventContext, gem: any) => {
            this.createOrUpdateGem(ctx, gem);
        });

        this.gameEvents.on(GameEvents.GEM_UPDATED, (ctx: EventContext, oldGem: any, newGem: any) => {
            this.createOrUpdateGem(ctx, newGem);
        });

        this.gameEvents.on(GameEvents.GEM_DELETED, (ctx: EventContext, gem: any) => {
            this.removeGem(gem.gemId);
        });
    }

    // Register entity event listeners
    registerEntityListeners() {
        console.log("Registering entity event listeners for GemManager", this.gemManagerId);
        
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
        
        const gem = ctx.db?.gems.entityId.find(entityData.entityId);
                
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
        
        return false;
    }

    // Create or update a gem in the pending list
    createOrUpdateGem(ctx: EventContext, gemData: any) {

        // If we already have this gem, update it
        if (this.gems.has(gemData.gemId)) {
            // Update gem data if needed
            // (Currently nothing to update for gems except position via entity)
            return;
        }

        // Check if the entity exists
        let entityPosition = null;
        const entityData = ctx.db?.entity.entityId.find(gemData.entityId);
        if (entityData) {
            entityPosition = entityData.position;
        }

        if (entityPosition) {
            // Entity exists, create directly with position
            this.createGemSprite(gemData, entityPosition);
        } else {
            // Entity doesn't exist yet, add to pending
            this.pendingGems.set(gemData.entityId, gemData);
        }
    }

    // Create a gem sprite with animations
    createGemSprite(gemData: any, position: { x: number, y: number }) {
        // Store the original position for reference
        const originalX = position.x;
        const originalY = position.y;

        // Create a container for the gem and its shadow
        const container = this.scene.add.container(originalX, originalY);
        
        // Get the asset key based on gem level tag
        const gemLevel = gemData.level; // This contains the enum with a 'tag' property
        let gemLevelTag = 'Small'; // Default fallback

        // Extract the tag if available
        if (gemLevel && typeof gemLevel === 'object' && gemLevel.tag) {
            gemLevelTag = gemLevel.tag;
        } else if (typeof gemLevel === 'number') {
            // Legacy fallback for numeric levels (0=Small, 1=Medium, etc.)
            const tags = ['Small', 'Medium', 'Large', 'Huge'];
            gemLevelTag = tags[gemLevel] || 'Small';
        }
        
        const assetKey = GEM_ASSET_KEYS[gemLevelTag] || GEM_ASSET_KEYS['Small']; // Default to small gem if not found
        
        // Create shadow DIRECTLY on the scene (not in the container) so it stays fixed
        var shadowX = originalX - 4;
        const shadow = this.scene.add.image(shadowX, originalY, SHADOW_ASSET_KEY);
        shadow.setAlpha(SHADOW_ALPHA);
        shadow.setScale(0.5); // Smaller shadow for gems
        shadow.setDepth(BASE_DEPTH + originalY + SHADOW_DEPTH_OFFSET);
        
        // Create gem sprite in the container
        const gemSprite = this.scene.add.image(0, 0, assetKey);
        
        // Add only the gem sprite to the container (not the shadow)
        container.add(gemSprite);
        
        // Set container depth based on Y position
        container.setDepth(BASE_DEPTH + originalY);
        
        // Store gem data
        container.setData('gemId', gemData.gemId);
        container.setData('gemLevel', gemLevelTag); // Store the tag string instead of numeric level
        container.setData('entityId', gemData.entityId);
        container.setData('baseY', originalY); // Store original Y for hover animation
        container.setData('shadow', shadow); // Store reference to shadow for cleanup
        
        // Store hover animation time offset with a random start time for variety
        container.setData('hoverOffset', Math.random() * Math.PI * 2);
        
        // Create hover animation
        this.scene.tweens.add({
            targets: container,
            scaleX: 1.0,
            scaleY: 1.0,
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
        const gemLevelTag = gemContainer.getData('gemLevel'); // This is now the tag string
        const color = GEM_PARTICLE_COLORS[gemLevelTag] || GEM_PARTICLE_COLORS['Small'];
        
        // Position the emitter at the gem's location
        this.particleEmitter.setPosition(gemContainer.x, gemContainer.y);
        
        // Update particle color based on gem type (using a rebuild approach)
        this.particleEmitter.stop();
        this.particleEmitter.setConfig({
            speed: { min: 50, max: 150 },
            scale: 0.6,
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 800,
            tint: color,
            quantity: GEM_ANIMATION.COLLECTION_PARTICLES
        });
        
        // Emit a burst of particles (without creating a new emitter)
        this.particleEmitter.explode(GEM_ANIMATION.COLLECTION_PARTICLES);
    }

    // Remove a gem and play collection animation
    removeGem(gemId: number) {
        const gemContainer = this.gems.get(gemId);
        if (gemContainer) {
            // Play collection effect
            this.createCollectionEffect(gemContainer);
            
            // Get the shadow associated with this gem
            const shadow = gemContainer.getData('shadow') as Phaser.GameObjects.Image;
            
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
                    
                    // Destroy the shadow separately since it's not in the container
                    if (shadow) {
                        shadow.destroy();
                    }
                    
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
            
            // Update ONLY gem position for hover (shadow stays fixed)
            container.y = hoverY;
        }
    }

    // Unregister event listeners
    unregisterListeners() {
        console.log("Unregistering event listeners for GemManager", this.gemManagerId);
        this.gameEvents.off(GameEvents.GEM_CREATED);
        this.gameEvents.off(GameEvents.GEM_UPDATED);
        this.gameEvents.off(GameEvents.GEM_DELETED);
        this.gameEvents.off(GameEvents.ENTITY_CREATED, this.handleEntityEvent, this);
        this.gameEvents.off(GameEvents.ENTITY_UPDATED, this.handleEntityEvent, this);
    }

    // Clean up on shutdown
    shutdown() {
        console.log("Shutting down GemManager", this.gemManagerId);
        
        // Unregister event listeners
        this.unregisterListeners();
        
        // Destroy all gem sprites and their shadows
        for (const [gemId, container] of this.gems.entries()) {
            // Get the shadow reference and destroy it
            const shadow = container.getData('shadow') as Phaser.GameObjects.Image;
            if (shadow) {
                shadow.destroy();
            }
            
            // Destroy the container
            container.destroy(true);
        }
        
        // Clear collections
        this.gems.clear();
        this.pendingGems.clear();
        
        // Ensure the particle emitter is stopped and destroyed
        if (this.particleEmitter) {
            this.particleEmitter.stop();
            this.particleEmitter.destroy();
        }
    }
} 