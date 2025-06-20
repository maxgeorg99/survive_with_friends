import Phaser from 'phaser';
import { EventContext, AgnaMagicCircle } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';

const MAGIC_CIRCLE_ASSET_KEY = 'agna_magic_circle';
const FADE_IN_DURATION = 500;
const FADE_OUT_DURATION = 300;
const BASE_DEPTH = 1000;
const ORBIT_RADIUS = 96;
const ORBIT_SPEED = 90; // degrees per second

export default class BossAgnaManager {
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    private magicCircles: Map<bigint, Phaser.GameObjects.Image> = new Map();
    
    // Store bound event handlers for proper cleanup
    private boundHandleCircleInsert: (ctx: EventContext, circle: AgnaMagicCircle) => void;
    private boundHandleCircleUpdate: (ctx: EventContext, oldCircle: AgnaMagicCircle, newCircle: AgnaMagicCircle) => void;
    private boundHandleCircleDelete: (ctx: EventContext, circle: AgnaMagicCircle) => void;
    
    // Flag to track if the manager has been shut down
    private isDestroyed: boolean = false;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        console.log("BossAgnaManager initialized");
        
        // Bind event handlers once for proper cleanup
        this.boundHandleCircleInsert = this.handleCircleInsert.bind(this);
        this.boundHandleCircleUpdate = this.handleCircleUpdate.bind(this);
        this.boundHandleCircleDelete = this.handleCircleDelete.bind(this);
        
        // Set up event handlers for magic circle table events
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.agnaMagicCircles?.onInsert(this.boundHandleCircleInsert);
            db.agnaMagicCircles?.onUpdate(this.boundHandleCircleUpdate);
            db.agnaMagicCircles?.onDelete(this.boundHandleCircleDelete);
        } else {
            console.error("Could not set up BossAgnaManager database listeners (database not connected)");
        }
    }

    // Initialize magic circles from current database state
    public initializeMagicCircles(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize magic circles: database connection not available");
            return;
        }

        console.log("BossAgnaManager initializing magic circles");
        
        for (const circle of ctx.db?.agnaMagicCircles?.iter() || []) {
            this.createMagicCircle(circle);
        }
    }

    // Handle when a new magic circle is inserted
    private handleCircleInsert(ctx: EventContext, circle: AgnaMagicCircle) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Magic circle inserted:", circle);
        this.createMagicCircle(circle);
    }

    // Handle when a magic circle is updated
    private handleCircleUpdate(ctx: EventContext, oldCircle: AgnaMagicCircle, newCircle: AgnaMagicCircle) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Magic circle updated:", oldCircle, "->", newCircle);
        this.updateMagicCirclePosition(newCircle);
    }

    // Handle when a magic circle is deleted
    private handleCircleDelete(ctx: EventContext, circle: AgnaMagicCircle) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Magic circle deleted:", circle);
        this.removeMagicCircle(circle.circleId);
    }

    private createMagicCircle(circleData: AgnaMagicCircle): void {
        // Check if we already have a sprite for this circle
        if (this.magicCircles.has(circleData.circleId)) {
            console.log(`Magic circle ${circleData.circleId} already exists`);
            return;
        }
        
        // Use the server-provided position directly
        const position = { x: circleData.position.x, y: circleData.position.y };
        
        console.log(`Creating magic circle ${circleData.circleId} at server position (${position.x}, ${position.y}) for player ${circleData.targetPlayerId}`);
        
        // Create the magic circle sprite
        const circleSprite = this.scene.add.image(position.x, position.y, MAGIC_CIRCLE_ASSET_KEY);
        circleSprite.setScale(0.8); // Adjust size as needed
        circleSprite.setAlpha(0); // Start invisible for fade in
        
        // Use proper depth - above ground and sprites but below UI
        circleSprite.setDepth(BASE_DEPTH + position.y + 10); // Above sprites at same y position
        
        // Ensure it follows the camera
        circleSprite.setScrollFactor(1, 1);
        
        // Fade in animation
        this.scene.tweens.add({
            targets: circleSprite,
            alpha: 0.8,
            duration: FADE_IN_DURATION,
            ease: 'Power2'
        });

        // Store the sprite
        this.magicCircles.set(circleData.circleId, circleSprite);
        
        console.log(`Magic circle ${circleData.circleId} created successfully with depth ${circleSprite.depth}`);
    }

    private updateMagicCirclePosition(circleData: AgnaMagicCircle): void {
        const circleSprite = this.magicCircles.get(circleData.circleId);
        if (!circleSprite) {
            console.warn(`Magic circle ${circleData.circleId} not found for position update`);
            return;
        }
        
        // Use the server-provided position directly
        const position = { x: circleData.position.x, y: circleData.position.y };
        
        // Update position smoothly
        circleSprite.setPosition(position.x, position.y);
        
        // Update depth based on new Y position
        circleSprite.setDepth(BASE_DEPTH + position.y + 10);
        
        // Add a subtle rotation to make it more magical
        circleSprite.setRotation(circleSprite.rotation + 0.02);
    }



    private removeMagicCircle(circleId: bigint): void {
        const circleSprite = this.magicCircles.get(circleId);
        if (!circleSprite) {
            console.log(`Magic circle ${circleId} already removed or not found`);
            return;
        }
        
        // Stop any active tweens for this sprite
        this.scene.tweens.killTweensOf(circleSprite);
        
        // Fade out animation before destroying
        this.scene.tweens.add({
            targets: circleSprite,
            alpha: 0,
            duration: FADE_OUT_DURATION,
            ease: 'Power2',
            onComplete: () => {
                try {
                    circleSprite.destroy();
                } catch (e) {
                    console.warn(`Error destroying magic circle ${circleId}:`, e);
                }
                this.magicCircles.delete(circleId);
                console.log(`Magic circle ${circleId} cleaned up successfully`);
            }
        });
    }

    // Clean up all magic circles (call this when scene is shut down)
    public shutdown() {
        console.log("Shutting down BossAgnaManager");
        
        // Mark as destroyed to prevent further processing
        this.isDestroyed = true;
        
        // Unregister database event listeners first
        this.unregisterListeners();
        
        // Stop all active tweens for magic circles
        this.magicCircles.forEach(circleSprite => {
            this.scene.tweens.killTweensOf(circleSprite);
        });
        
        // Destroy all magic circle sprites
        this.magicCircles.forEach(circleSprite => circleSprite.destroy());
        this.magicCircles.clear();
        
        console.log("BossAgnaManager shutdown complete");
    }

    // Helper method to clean up database event listeners
    private unregisterListeners() {
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.agnaMagicCircles?.removeOnInsert(this.boundHandleCircleInsert);
            db.agnaMagicCircles?.removeOnUpdate(this.boundHandleCircleUpdate);
            db.agnaMagicCircles?.removeOnDelete(this.boundHandleCircleDelete);
            console.log("BossAgnaManager database listeners removed");
        }
    }
} 