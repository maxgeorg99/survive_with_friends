import Phaser from 'phaser';
import { EventContext, LootCapsules } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Constants for visual appearance and animation
const VOID_CAPSULE_ASSET_KEY = 'void_capsule';
const ANIMATION_DURATION = 1000; // Default fallback duration (server now uses 1 second)
const ALPHA_VALUE = 0.8; // Transparency of the capsule
const BASE_DEPTH = 50000; // High depth to appear above most game elements but below UI (100000)
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
            speed: { min: 30, max: 80 },
            scale: { start: 0.6, end: 0.1 },
            blendMode: Phaser.BlendModes.ADD,
            lifespan: 1500, // Much longer for proper comet tail
            tint: [0x88ffff, 0xaaffff, 0xffffff, 0xccffff], // Various cyan/white tints for variety
            quantity: 5, // More particles per emission for denser trail
            frequency: 50, // Even more frequent emissions for continuous comet tail
            alpha: { start: 1.0, end: 0 }, // Full brightness starting alpha
            // Add some random movement for more organic feel
            accelerationX: { min: -15, max: 15 },
            accelerationY: { min: -15, max: 15 }
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

        // Calculate duration based on scheduled_at time (when the capsule should reach its destination)
        const currentTime = Date.now();
        let animationDuration = ANIMATION_DURATION; // Default fallback
        
        console.log(`Current time: ${currentTime}ms`);
        console.log(`Capsule scheduledAt:`, capsule.scheduledAt);
        
        // Handle the scheduledAt union type
        if (capsule.scheduledAt.tag === 'Time') {
            // The value field directly contains the timestamp in microseconds
            const scheduledTimeMicros = capsule.scheduledAt.value;
            console.log(`Scheduled time (micros):`, scheduledTimeMicros);
            
            // Convert BigInt microseconds to milliseconds
            const scheduledTimeMs = Number(scheduledTimeMicros) / 1000;
            console.log(`Scheduled time (ms): ${scheduledTimeMs}`);
            console.log(`Time difference: ${scheduledTimeMs - currentTime}ms`);
            
            // Instead of trying to sync client and server clocks, use a fixed duration
            // The server is configured for 1000ms delay, so we use that minus a safety buffer
            // This avoids the client/server clock synchronization problem entirely
            const lagCompensation = 200; // Conservative buffer for network and processing delays
            animationDuration = Math.max(100, ANIMATION_DURATION - lagCompensation);
            console.log(`Using fixed duration with ${lagCompensation}ms lag compensation: ${animationDuration}ms`);
        } else {
            console.log(`ScheduledAt is not Time type (${capsule.scheduledAt.tag}), using default duration`);
        }
        
        console.log(`Capsule ${capsuleIdKey} final animation duration: ${animationDuration}ms`);

        // Create a container for the capsule and effects
        const container = this.scene.add.container(
            capsule.startPosition.x,
            capsule.startPosition.y
        );

        // Create the capsule sprite
        const capsuleSprite = this.scene.add.image(0, 0, VOID_CAPSULE_ASSET_KEY);
        capsuleSprite.setAlpha(ALPHA_VALUE);
        capsuleSprite.setScale(0.8); // Slightly smaller than normal size
        
        // Create shadow sprite - positioned below the capsule to simulate ground shadow
        const shadowOffset = 15; // Distance below capsule for ground shadow (reduced from 60)
        const shadowSprite = this.scene.add.image(0, shadowOffset, VOID_CAPSULE_ASSET_KEY);
        shadowSprite.setAlpha(0.3); // Semi-transparent
        shadowSprite.setScale(0.6); // Smaller than capsule
        shadowSprite.setTint(0x000000); // Black tint for shadow
        
        // Add both sprites to the container
        container.add([shadowSprite, capsuleSprite]); // Shadow first so it's behind capsule
        
        // Set depth based on start position
        container.setDepth(BASE_DEPTH + capsule.startPosition.y);
        
        // Store the container with capsule ID for sparkle tracking
        container.setData('capsuleId', capsuleIdKey);
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
        
        console.log(`Animating capsule from (${startX}, ${startY}) to (${endX}, ${endY}) via (${midX}, ${midY}) over ${animationDuration}ms`);
        
        // Start sparkle effect during flight
        this.startSparkleEffect(container);
        
        // Create smooth arc animation using direct property animation
        const startTime = Date.now();
        
        // Create a simple object to animate that we can track
        const animationTarget = { progress: 0 };
        
        this.scene.tweens.add({
            targets: animationTarget,
            progress: 1,
            duration: animationDuration,
            ease: 'Sine.InOut',
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                const progress = animationTarget.progress;
                
                // Quadratic bezier curve: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
                const t = progress;
                const invT = 1 - t;
                
                const x = invT * invT * startX + 2 * invT * t * midX + t * t * endX;
                const y = invT * invT * startY + 2 * invT * t * midY + t * t * endY;
                
                container.setPosition(x, y);
                
                // Update shadow position - linear X movement, fixed Y offset from start
                const shadowX = startX + (endX - startX) * progress; // Linear interpolation for X
                const shadowY = startY + (endY - startY) * progress + shadowOffset; // Linear interpolation for Y + offset
                const shadowSprite = container.list[0] as Phaser.GameObjects.Image; // Shadow is first in container
                shadowSprite.setPosition(shadowX - x, shadowY - y); // Relative to container position
                
                // Update depth based on current Y position
                container.setDepth(BASE_DEPTH + y);
                
                // Slight rotation during flight for more dynamic feel
                capsuleSprite.setRotation(Math.sin(progress * Math.PI * 4) * 0.1);
                
                // Update sparkle emitter position if it's still active and not destroyed
                if (this.sparkleEmitter && this.sparkleEmitter.active) {
                    try {
                        this.sparkleEmitter.setPosition(x, y);
                    } catch (e) {
                        // Ignore errors if emitter is destroyed
                        console.warn("Sparkle emitter error:", e);
                    }
                }
            },
            onComplete: () => {
                console.log(`Capsule ${capsuleIdKey} animation completed`);
                
                // Stop sparkles when animation completes
                this.stopSparkleEffect();
                
                // Check if the capsule still exists (might have been deleted by server already)
                if (this.capsuleSprites.has(capsuleIdKey)) {
                    // Show award effect at final position before cleanup
                    const finalContainer = this.capsuleSprites.get(capsuleIdKey);
                    if (finalContainer) {
                        this.createAwardEffect(finalContainer.x, finalContainer.y);
                    }
                    
                    // The capsule should be deleted by the server at this point
                    // If not deleted within a reasonable time, clean it up
                    this.scene.time.delayedCall(300, () => {
                        if (this.capsuleSprites.has(capsuleIdKey)) {
                            console.warn(`Capsule ${capsuleIdKey} not deleted by server, cleaning up manually`);
                            this.removeCapsuleSprite(capsuleIdKey, false); // Don't double-play award effect
                        }
                    });
                } else {
                    console.log(`Capsule ${capsuleIdKey} was already deleted by server during animation`);
                }
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
        if (this.sparkleEmitter) {
            try {
                this.sparkleEmitter.setPosition(container.x, container.y);
                this.sparkleEmitter.start();
            } catch (e) {
                console.warn("Failed to start sparkle effect:", e);
            }
        }
    }

    // Stop sparkle effect
    private stopSparkleEffect() {
        if (this.sparkleEmitter) {
            try {
                this.sparkleEmitter.stop();
            } catch (e) {
                console.warn("Failed to stop sparkle effect:", e);
            }
        }
    }

    // Remove a capsule sprite
    private removeCapsuleSprite(capsuleId: string, playAwardEffect: boolean = false) {
        const container = this.capsuleSprites.get(capsuleId);
        if (!container) {
            console.log(`Capsule ${capsuleId} already removed or not found`);
            return;
        }
        
        if (playAwardEffect) {
            // Play award effect at the capsule's current position
            this.createAwardEffect(container.x, container.y);
        }
        
        // Stop any active tweens for this container
        this.scene.tweens.killTweensOf(container);
        
        // Fade out and destroy the container
        this.scene.tweens.add({
            targets: container,
            alpha: 0,
            scale: 0.1,
            duration: 300,
            ease: 'Power2',
            onComplete: () => {
                try {
                    container.destroy(true);
                } catch (e) {
                    console.warn(`Error destroying capsule ${capsuleId} container:`, e);
                }
                this.capsuleSprites.delete(capsuleId);
                console.log(`Capsule ${capsuleId} cleaned up successfully`);
            }
        });
    }

    // Create award particle effect when capsule delivers its payload
    private createAwardEffect(x: number, y: number) {
        // Position the award emitter at the final position and emit particles if available
        if (this.awardEmitter) {
            try {
                this.awardEmitter.setPosition(x, y);
                this.awardEmitter.explode(AWARD_PARTICLE_COUNT);
            } catch (e) {
                console.warn("Failed to create award particle effect:", e);
            }
        }
        
        // Create expanding ring effect (this doesn't depend on the emitter)
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
        
        // Stop all active tweens for capsules
        this.capsuleSprites.forEach(container => {
            this.scene.tweens.killTweensOf(container);
        });
        
        // Destroy all capsule sprites
        this.capsuleSprites.forEach(container => container.destroy(true));
        this.capsuleSprites.clear();
        
        // Stop and destroy particle emitters safely
        if (this.sparkleEmitter) {
            try {
                this.sparkleEmitter.stop();
                this.sparkleEmitter.destroy();
            } catch (e) {
                console.warn("Error destroying sparkle emitter:", e);
            }
            this.sparkleEmitter = null as any;
        }
        
        if (this.awardEmitter) {
            try {
                this.awardEmitter.stop();
                this.awardEmitter.destroy();
            } catch (e) {
                console.warn("Error destroying award emitter:", e);
            }
            this.awardEmitter = null as any;
        }
        
        console.log("LootCapsuleManager shutdown complete");
    }
} 