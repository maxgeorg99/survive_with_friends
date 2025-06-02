import Phaser from 'phaser';
import { EventContext, LootCapsules } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Constants for visual appearance and animation
const VOID_CAPSULE_ASSET_KEY = 'void_capsule';
const ANIMATION_DURATION = 3000; // Duration of arc movement in ms (matches server 3 second delay)
const ALPHA_VALUE = 0.8; // Transparency of the capsule
const BASE_DEPTH = 900; // Just below monsters but above background
const SPARKLE_PARTICLE_COUNT = 3; // Number of sparkle particles trailing the capsule
const AWARD_PARTICLE_COUNT = 12; // Number of particles when awarding

export default class LootCapsuleManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    // Client for database access
    private spacetimeDBClient: SpacetimeDBClient;
    // Map to store capsule sprites (keyed by capsule ID stringified)
    private capsuleSprites: Map<string, Phaser.GameObjects.Container> = new Map();
    // Game events emitter
    private gameEvents: Phaser.Events.EventEmitter;
    // Particle emitter for sparkles
    private sparkleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
    // Particle emitter for award effects
    private awardEmitter: Phaser.GameObjects.Particles.ParticleEmitter;

    static nextLootCapsuleManagerId: number = 0;
    private lootCapsuleManagerId: number;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        this.gameEvents = (window as any).gameEvents;

        LootCapsuleManager.nextLootCapsuleManagerId += 1;
        this.lootCapsuleManagerId = LootCapsuleManager.nextLootCapsuleManagerId;

        console.log("LootCapsuleManager constructed", this.lootCapsuleManagerId);

        // Initialize persistent particle emitters
        this.sparkleEmitter = this.scene.add.particles(0, 0, 'white_pixel', {
            speed: { min: 20, max: 40 },
            scale: { start: 0.3, end: 0 },
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 400,
            tint: 0x88ffff, // Light cyan sparkles
            quantity: 1,
            frequency: 150 // Emit sparkles continuously while active
        });
        this.sparkleEmitter.stop();

        this.awardEmitter = this.scene.add.particles(0, 0, 'white_pixel', {
            speed: { min: 80, max: 160 },
            scale: { start: 0.6, end: 0 },
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 1000,
            tint: 0xffff00, // Golden award particles
            quantity: AWARD_PARTICLE_COUNT
        });
        this.awardEmitter.stop();

        // Set up event handlers for loot capsule table events
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            // @ts-ignore - LootCapsules table might not be fully typed yet
            db.lootCapsules?.onInsert(this.handleCapsuleInsert.bind(this));
            // @ts-ignore
            db.lootCapsules?.onDelete(this.handleCapsuleDelete.bind(this));
        } else {
            console.error("Could not set up LootCapsuleManager database listeners (database not connected)");
        }
    }

    // Initialize loot capsules
    initializeLootCapsules(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize loot capsules: database connection not available");
            return;
        }

        console.log("LootCapsuleManager initializing loot capsules", this.lootCapsuleManagerId);
        
        // @ts-ignore - LootCapsules table might not be fully typed yet
        for (const capsule of ctx.db?.lootCapsules?.iter() || []) {
            this.createCapsuleSprite(capsule);
        }
    }

    // Handle when a new loot capsule is inserted
    private handleCapsuleInsert(ctx: EventContext, capsule: LootCapsules) {
        console.log(`New loot capsule from (${capsule.startPosition.x}, ${capsule.startPosition.y}) to (${capsule.endPosition.x}, ${capsule.endPosition.y}) with gem type: ${capsule.lootdropId.tag}`);
        this.createCapsuleSprite(capsule);
    }

    // Handle when a loot capsule is deleted (gem was spawned)
    private handleCapsuleDelete(ctx: EventContext, capsule: LootCapsules) {
        console.log(`Loot capsule deleted: ${capsule.capsuleId}`);
        this.removeCapsuleSprite(String(capsule.capsuleId), true); // true = play award effect
    }

    // Create a capsule sprite with arc animation
    private createCapsuleSprite(capsule: LootCapsules) {
        // Convert bigint ID to string for use as a map key
        const capsuleIdKey = String(capsule.capsuleId);
        
        // Check if we already have a sprite for this capsule
        if (this.capsuleSprites.has(capsuleIdKey)) {
            console.log(`Sprite for capsule ${capsuleIdKey} already exists`);
            return;
        }

        // Create a container for the capsule and effects
        const container = this.scene.add.container(
            capsule.startPosition.x,
            capsule.startPosition.y
        );

        // Create the capsule sprite
        const capsuleSprite = this.scene.add.image(0, 0, VOID_CAPSULE_ASSET_KEY);
        capsuleSprite.setAlpha(ALPHA_VALUE);
        capsuleSprite.setScale(0.8); // Slightly smaller than normal size
        
        // Add the sprite to the container
        container.add(capsuleSprite);
        
        // Set depth based on start position
        container.setDepth(BASE_DEPTH + capsule.startPosition.y);
        
        // Store the container
        this.capsuleSprites.set(capsuleIdKey, container);
        
        // Calculate arc animation parameters
        const startX = capsule.startPosition.x;
        const startY = capsule.startPosition.y;
        const endX = capsule.endPosition.x;
        const endY = capsule.endPosition.y;
        
        // Calculate arc height (20% of distance for a nice arc effect)
        const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        const arcHeight = Math.min(distance * 0.2, 150); // Cap arc height at 150 pixels
        
        // Calculate midpoint for the arc
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2 - arcHeight;
        
        // Start sparkle effect during flight
        this.startSparkleEffect(container);
        
        // Create smooth arc animation using a bezier curve approximation
        this.scene.tweens.add({
            targets: container,
            duration: ANIMATION_DURATION,
            ease: 'Sine.InOut',
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                const progress = tween.progress;
                
                // Quadratic bezier curve: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
                const t = progress;
                const invT = 1 - t;
                
                const x = invT * invT * startX + 2 * invT * t * midX + t * t * endX;
                const y = invT * invT * startY + 2 * invT * t * midY + t * t * endY;
                
                container.setPosition(x, y);
                
                // Update depth based on current Y position
                container.setDepth(BASE_DEPTH + y);
                
                // Slight rotation during flight for more dynamic feel
                capsuleSprite.setRotation(Math.sin(progress * Math.PI * 4) * 0.1);
            },
            onComplete: () => {
                // Stop sparkles when animation completes
                this.stopSparkleEffect();
                
                // The capsule should be deleted by the server at this point
                // If not deleted within a reasonable time, clean it up
                this.scene.time.delayedCall(500, () => {
                    if (this.capsuleSprites.has(capsuleIdKey)) {
                        console.warn(`Capsule ${capsuleIdKey} not deleted by server, cleaning up manually`);
                        this.removeCapsuleSprite(capsuleIdKey, false);
                    }
                });
            }
        });
        
        // Add a pulsing effect to make it more noticeable
        this.scene.tweens.add({
            targets: capsuleSprite,
            alpha: { from: ALPHA_VALUE, to: ALPHA_VALUE * 1.3 },
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
        });
    }

    // Start sparkle effect following the capsule
    private startSparkleEffect(container: Phaser.GameObjects.Container) {
        this.sparkleEmitter.setPosition(container.x, container.y);
        this.sparkleEmitter.start();
        
        // Update sparkle position to follow the container during animation
        const updateSparkles = () => {
            if (this.sparkleEmitter.active && this.capsuleSprites.has(String(container.getData('capsuleId')))) {
                this.sparkleEmitter.setPosition(container.x, container.y);
                // Continue updating
                this.scene.time.delayedCall(50, updateSparkles);
            }
        };
        updateSparkles();
    }

    // Stop sparkle effect
    private stopSparkleEffect() {
        this.sparkleEmitter.stop();
    }

    // Remove a capsule sprite
    private removeCapsuleSprite(capsuleId: string, playAwardEffect: boolean = false) {
        const container = this.capsuleSprites.get(capsuleId);
        if (container) {
            if (playAwardEffect) {
                // Play award effect at the capsule's final position
                this.createAwardEffect(container.x, container.y);
            }
            
            // Fade out and destroy the container
            this.scene.tweens.add({
                targets: container,
                alpha: 0,
                scale: 0.1,
                duration: 300,
                ease: 'Power2',
                onComplete: () => {
                    container.destroy(true);
                    this.capsuleSprites.delete(capsuleId);
                }
            });
        }
    }

    // Create award particle effect when capsule delivers its payload
    private createAwardEffect(x: number, y: number) {
        // Position the award emitter at the final position
        this.awardEmitter.setPosition(x, y);
        
        // Emit a burst of golden particles
        this.awardEmitter.explode(AWARD_PARTICLE_COUNT);
        
        // Create expanding ring effect
        const ring = this.scene.add.circle(x, y, 10, 0xffff00, 0.6);
        ring.setDepth(BASE_DEPTH + y + 100); // High depth to appear above everything
        
        this.scene.tweens.add({
            targets: ring,
            scale: 5,
            alpha: 0,
            duration: 600,
            ease: 'Sine.easeOut',
            onComplete: () => {
                ring.destroy();
            }
        });
    }

    // Clean up all capsules (call this when scene is shut down)
    public shutdown() {
        console.log("Shutting down LootCapsuleManager", this.lootCapsuleManagerId);
        
        // Destroy all capsule sprites
        this.capsuleSprites.forEach(container => container.destroy(true));
        this.capsuleSprites.clear();
        
        // Stop and destroy particle emitters
        if (this.sparkleEmitter) {
            this.sparkleEmitter.stop();
            this.sparkleEmitter.destroy();
        }
        
        if (this.awardEmitter) {
            this.awardEmitter.stop();
            this.awardEmitter.destroy();
        }
    }
} 