import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { EventContext } from "../autobindings";
import { GameEvents } from '../constants/GameEvents';

// Constants for text VFX (matching style from GameScene level up effects)
const BASE_DEPTH = 1000;

export default class LoreScrollManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    // Client for database access
    private spacetimeDBClient: SpacetimeDBClient;
    // Game events for communication
    private gameEvents: Phaser.Events.EventEmitter;
    // Track local player ID
    private localPlayerId: number = 0;
    
    static nextLoreScrollManagerId: number = 0;
    private loreScrollManagerId: number;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        this.gameEvents = (window as any).gameEvents;

        LoreScrollManager.nextLoreScrollManagerId += 1;
        this.loreScrollManagerId = LoreScrollManager.nextLoreScrollManagerId;

        console.log("LoreScrollManager constructed", this.loreScrollManagerId);
    }

    // Initialize the lore scroll manager and set up table subscriptions
    initializeLoreScrolls(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize lore scrolls: database connection not available");
            return;
        }

        console.log("LoreScrollManager initializing", this.loreScrollManagerId);
        
        // Get local player ID
        this.updateLocalPlayerId();
        
        // Register lore scroll listeners
        this.registerLoreScrollListeners();
    }

    // Update local player ID from the current account
    private updateLocalPlayerId() {
        if (!this.spacetimeDBClient?.identity || !this.spacetimeDBClient?.sdkConnection?.db) {
            return;
        }

        const localIdentity = this.spacetimeDBClient.identity;
        const localAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(localIdentity);
        
        if (localAccount) {
            this.localPlayerId = localAccount.currentPlayerId;
            console.log("LoreScrollManager: Local player ID updated to", this.localPlayerId);
        }
    }

    // Register lore scroll table event listeners
    private registerLoreScrollListeners() {
        console.log("Registering lore scroll listeners for LoreScrollManager", this.loreScrollManagerId);

        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            try {
                // @ts-ignore - foundLoreScrolls table might not be fully typed yet
                if (db.foundLoreScrolls) {
                    // @ts-ignore
                    db.foundLoreScrolls.onInsert((ctx: EventContext, loreScrollEntry: any) => {
                        this.handleLoreScrollDiscovered(ctx, loreScrollEntry);
                    });
                    console.log("Registered lore scroll discovery handlers successfully");
                }
            } catch (e) {
                console.warn("Could not register lore scroll event handlers - the found_lore_scrolls table might not be in current bindings yet:", e);
            }
        } else {
            console.error("Could not set up LoreScrollManager database listeners (database not connected)");
        }
    }

    // Handle when a new lore scroll entry is added to the table
    private handleLoreScrollDiscovered(ctx: EventContext, loreScrollEntry: any) {
        console.log("Lore scroll discovered:", loreScrollEntry);

        // Update local player ID in case it changed
        this.updateLocalPlayerId();

        // Check if this discovery is for the local player
        if (loreScrollEntry.playerId === this.localPlayerId) {
            console.log("Local player discovered lore scroll:", loreScrollEntry.scrollId);
            
            // Convert 0-indexed to 1-indexed for display/sound
            const soundIndex = loreScrollEntry.scrollId + 1; // 0-12 becomes 1-13
            
            // Add delay to allow level up effects to clear first
            this.scene.time.delayedCall(1500, () => {
                // Play voice sound
                this.playViberiansSound(soundIndex);
                
                // Show "Viberians X" text VFX
                this.createLoreScrollDiscoveryEffect(soundIndex);
            });
        }
    }

    // Play the appropriate viberians voice sound
    private playViberiansSound(soundIndex: number) {
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            const soundKey = `viberians_${soundIndex}`;
            console.log("Playing lore scroll sound:", soundKey);
            soundManager.playSound(soundKey, 0.9); // Play at 90% volume
        }
    }

    // Create visual text effect for lore scroll discovery
    private createLoreScrollDiscoveryEffect(viberiansNumber: number) {
        // Get local player position for text placement
        const localPlayerPosition = this.getLocalPlayerPosition();
        if (!localPlayerPosition) {
            console.warn("Could not get local player position for lore scroll VFX");
            return;
        }

        const { x, y } = localPlayerPosition;

        // Create "Viberians X" text
        const loreText = this.scene.add.text(
            x,
            y - 120, // Start above the player
            `Viberians ${viberiansNumber}`,
            {
                fontFamily: 'Arial',
                fontSize: '36px', // Increased from 28px to 36px
                color: '#f4e4bc', // Parchment color instead of gold
                stroke: '#8b4513', // Dark brown stroke for parchment effect
                strokeThickness: 6, // Slightly thicker stroke
                fontStyle: 'bold'
            }
        );
        loreText.setOrigin(0.5);
        loreText.setDepth(BASE_DEPTH + y + 100); // Ensure it appears above the player

        // Animate the text: float up and fade out
        this.scene.tweens.add({
            targets: loreText,
            y: loreText.y - 80, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.8, to: 2.0 }, // Grow even more significantly
            duration: 2500, // Longer duration for dramatic effect
            ease: 'Power2',
            onComplete: () => {
                loreText.destroy(); // Clean up when animation is done
            }
        });

        // Create particle effect with gold particles
        const particles = this.scene.add.particles(x, y - 80, 'white_pixel', {
            speed: { min: 80, max: 200 },
            scale: { start: 0.8, end: 0 },
            blendMode: 'ADD',
            lifespan: 1500,
            gravityY: -30, // Float upward
            tint: 0xffd700, // Gold particles
            emitting: false
        });

        // Emit particles in a burst
        particles.explode(40, x, y - 80);

        // Clean up particles after animation
        this.scene.time.delayedCall(2000, () => {
            particles.destroy();
        });

        console.log(`Lore scroll discovery VFX created for Viberians ${viberiansNumber} at (${x}, ${y})`);
    }

    // Get local player position from the scene
    private getLocalPlayerPosition(): { x: number, y: number } | null {
        // Try to get position from GameScene if available
        const gameScene = this.scene as any;
        if (gameScene.getLocalPlayerPosition) {
            return gameScene.getLocalPlayerPosition();
        }

        // Fallback: try to find local player sprite
        if (gameScene.localPlayerSprite) {
            return {
                x: gameScene.localPlayerSprite.x,
                y: gameScene.localPlayerSprite.y
            };
        }

        return null;
    }

    // Clean up on shutdown
    shutdown() {
        console.log("Shutting down LoreScrollManager", this.loreScrollManagerId);
        
        // No specific cleanup needed for table listeners since they're handled by the connection
        // The SpacetimeDBClient will handle disconnection cleanup
    }
} 