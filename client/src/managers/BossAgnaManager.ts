import Phaser from 'phaser';
import { EventContext, AgnaMagicCircle, ActiveMonsterAttack, MonsterAttackType, Monsters, AiState, Player } from '../autobindings';
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
    private boundHandleAttackInsert: (ctx: EventContext, attack: ActiveMonsterAttack) => void;
    private boundHandleMonsterUpdate: (ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) => void;
    private boundHandleMonsterDelete: (ctx: EventContext, monster: Monsters) => void;
    private boundHandlePlayerDelete: (ctx: EventContext, player: Player) => void;
    
    // Flag to track if the manager has been shut down
    private isDestroyed: boolean = false;
    
    // Flamethrower sound management
    private flamethrowerSound: Phaser.Sound.BaseSound | null = null;
    private agnaBossesInFlamethrowerMode: Set<number> = new Set();

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        console.log("BossAgnaManager initialized");
        
        // Bind event handlers once for proper cleanup
        this.boundHandleCircleInsert = this.handleCircleInsert.bind(this);
        this.boundHandleCircleUpdate = this.handleCircleUpdate.bind(this);
        this.boundHandleCircleDelete = this.handleCircleDelete.bind(this);
        this.boundHandleAttackInsert = this.handleAttackInsert.bind(this);
        this.boundHandleMonsterUpdate = this.handleMonsterUpdate.bind(this);
        this.boundHandleMonsterDelete = this.handleMonsterDelete.bind(this);
        this.boundHandlePlayerDelete = this.handlePlayerDelete.bind(this);
        
        // Set up event handlers for magic circle table events, active attacks, monster updates, and player deletes
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.agnaMagicCircles?.onInsert(this.boundHandleCircleInsert);
            db.agnaMagicCircles?.onUpdate(this.boundHandleCircleUpdate);
            db.agnaMagicCircles?.onDelete(this.boundHandleCircleDelete);
            db.activeMonsterAttacks?.onInsert(this.boundHandleAttackInsert);
            db.monsters?.onUpdate(this.boundHandleMonsterUpdate);
            db.monsters?.onDelete(this.boundHandleMonsterDelete);
            db.player?.onDelete(this.boundHandlePlayerDelete);
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
        
        // Also check for any existing Agna bosses in flamethrower mode
        for (const monster of ctx.db?.monsters?.iter() || []) {
            if (this.isAgnaBoss(monster) && this.isFlamethrowerState(monster.aiState)) {
                console.log(`Found existing Agna boss ${monster.monsterId} in flamethrower mode during initialization`);
                this.startFlamethrowerSound(monster.monsterId);
            }
        }
    }

    // Handle when a new magic circle is inserted
    private handleCircleInsert(ctx: EventContext, circle: AgnaMagicCircle) {
        if (this.isDestroyed) {
            return;
        }
        
        //console.log("Magic circle inserted:", circle);
        this.createMagicCircle(circle);
    }

    // Handle when a magic circle is updated
    private handleCircleUpdate(ctx: EventContext, oldCircle: AgnaMagicCircle, newCircle: AgnaMagicCircle) {
        if (this.isDestroyed) {
            return;
        }
        
        //console.log("Magic circle updated:", oldCircle, "->", newCircle);
        this.updateMagicCirclePosition(newCircle);
    }

    // Handle when a magic circle is deleted
    private handleCircleDelete(ctx: EventContext, circle: AgnaMagicCircle) {
        if (this.isDestroyed) {
            return;
        }
        
        //console.log("Magic circle deleted:", circle);
        this.removeMagicCircle(circle.circleId);
    }

    // Handle when a new active monster attack is inserted (for telegraph VFX)
    private handleAttackInsert(ctx: EventContext, attack: ActiveMonsterAttack) {
        if (this.isDestroyed) {
            return;
        }
        
        // Check if this is an AgnaOrbSpawn (telegraph) attack
        if (attack.monsterAttackType.tag === "AgnaOrbSpawn") {
            //console.log("AgnaOrbSpawn telegraph detected:", attack);
            this.playTelegraphVFX(attack);
        }
    }

    // Handle when a monster is updated (for flamethrower state detection)
    private handleMonsterUpdate(ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) {
        if (this.isDestroyed) {
            return;
        }
        
        // Only process Agna bosses
        if (!this.isAgnaBoss(newMonster)) {
            return;
        }
        
        const wasInFlamethrower = this.isFlamethrowerState(oldMonster.aiState);
        const isInFlamethrower = this.isFlamethrowerState(newMonster.aiState);
        
        // Check for flamethrower state transitions
        if (!wasInFlamethrower && isInFlamethrower) {
            console.log(`Agna boss ${newMonster.monsterId} entered flamethrower mode`);
            this.startFlamethrowerSound(newMonster.monsterId);
        } else if (wasInFlamethrower && !isInFlamethrower) {
            console.log(`Agna boss ${newMonster.monsterId} left flamethrower mode`);
            this.stopFlamethrowerSound(newMonster.monsterId);
        }
    }

    // Handle when a monster is deleted (for cleanup when Agna bosses are destroyed)
    private handleMonsterDelete(ctx: EventContext, monster: Monsters) {
        if (this.isDestroyed) {
            return;
        }
        
        // Only process Agna bosses
        if (!this.isAgnaBoss(monster)) {
            return;
        }
        
        console.log(`Agna boss ${monster.monsterId} was destroyed`);
        this.stopFlamethrowerSound(monster.monsterId);
    }

    // Handle when a player is deleted (hide magic circles targeting that player)
    private handlePlayerDelete(ctx: EventContext, player: Player) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log(`Player ${player.playerId} was deleted, cleaning up magic circles`);
        
        // Find and remove all magic circles targeting this player
        const circlesToRemove: bigint[] = [];
        
        for (const [circleId, circleSprite] of this.magicCircles) {
            const targetPlayerId = (circleSprite as any).targetPlayerId;
            
            if (targetPlayerId === player.playerId) {
                console.log(`Removing magic circle ${circleId} that was targeting deleted player ${player.playerId}`);
                circlesToRemove.push(circleId);
            }
        }
        
        // Remove the circles
        for (const circleId of circlesToRemove) {
            this.removeMagicCircle(circleId);
        }
        
        if (circlesToRemove.length > 0) {
            console.log(`Cleaned up ${circlesToRemove.length} magic circles for deleted player ${player.playerId}`);
        }
    }

    // Helper methods for monster type and state checking
    private isAgnaBoss(monster: Monsters): boolean {
        const monsterType = monster.bestiaryId;
        return monsterType?.tag === 'BossAgnaPhase1' || monsterType?.tag === 'BossAgnaPhase2';
    }

    private isFlamethrowerState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaFlamethrower';
    }

    // Flamethrower sound management
    private startFlamethrowerSound(monsterId: number) {
        if (this.agnaBossesInFlamethrowerMode.has(monsterId)) {
            return; // Already tracking this boss
        }
        
        this.agnaBossesInFlamethrowerMode.add(monsterId);
        
        // Start flamethrower sound if not already playing
        if (!this.flamethrowerSound || !this.flamethrowerSound.isPlaying) {
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                console.log("Starting Agna flamethrower sound");
                
                // Stop any existing flamethrower sound first
                this.stopFlamethrowerSoundImmediate();
                
                // Create and play the flamethrower sound (looped)
                if (this.scene.cache.audio.exists('agna_flamethrower')) {
                    this.flamethrowerSound = this.scene.sound.add('agna_flamethrower', {
                        volume: 0.7,
                        loop: true
                    });
                    this.flamethrowerSound.play();
                } else {
                    console.warn("Agna flamethrower sound not found in cache");
                }
            }
        }
    }

    private stopFlamethrowerSound(monsterId: number) {
        // Since there's only ever one Agna boss, just clear the set and stop the sound
        this.agnaBossesInFlamethrowerMode.clear();
        this.stopFlamethrowerSoundImmediate();
    }

    private stopFlamethrowerSoundImmediate() {
        if (this.flamethrowerSound) {
            console.log("Stopping Agna flamethrower sound");
            this.flamethrowerSound.stop();
            this.flamethrowerSound.destroy();
            this.flamethrowerSound = null;
        }
    }

    private createMagicCircle(circleData: AgnaMagicCircle): void {
        // Check if we already have a sprite for this circle
        if (this.magicCircles.has(circleData.circleId)) {
            console.log(`Magic circle ${circleData.circleId} already exists`);
            return;
        }
        
        // Use the server-provided position directly
        const position = { x: circleData.position.x, y: circleData.position.y };
        
        console.log(`Creating magic circle ${circleData.circleId} at server position (${position.x}, ${position.y}) for player ${circleData.targetPlayerId}, circle index ${circleData.circleIndex}`);
        
        // Create the magic circle sprite
        const circleSprite = this.scene.add.image(position.x, position.y, MAGIC_CIRCLE_ASSET_KEY);
        circleSprite.setScale(0.8); // Adjust size as needed
        circleSprite.setAlpha(0); // Start invisible for fade in
        
        // Store associated data on the sprite for easy access
        (circleSprite as any).targetPlayerId = circleData.targetPlayerId;
        (circleSprite as any).circleIndex = circleData.circleIndex;
        (circleSprite as any).circleId = circleData.circleId;
        
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
        
        console.log(`Magic circle ${circleData.circleId} created successfully with depth ${circleSprite.depth}, player ${circleData.targetPlayerId}, index ${circleData.circleIndex}`);
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

    private playTelegraphVFX(attack: ActiveMonsterAttack): void {
        const targetPlayerId = attack.parameterU; // Target player ID stored in parameterU
        const circleIndex = Math.round(attack.parameterF); // Circle index (0-3) stored in parameterF, cast from float
        
        console.log(`Playing telegraph VFX for player ${targetPlayerId}, circle index ${circleIndex}`);
        
        // Find the matching magic circle sprite by target player AND circle index
        let matchingCircle: Phaser.GameObjects.Image | null = null;
        for (const [circleId, circleSprite] of this.magicCircles) {
            const spriteTargetPlayerId = (circleSprite as any).targetPlayerId;
            const spriteCircleIndex = (circleSprite as any).circleIndex;
            
            if (spriteTargetPlayerId === targetPlayerId && spriteCircleIndex === circleIndex) {
                matchingCircle = circleSprite;
                console.log(`Found matching circle: ID ${(circleSprite as any).circleId}, player ${spriteTargetPlayerId}, index ${spriteCircleIndex}`);
                break;
            }
        }
        
        if (!matchingCircle) {
            console.warn(`Could not find matching magic circle for player ${targetPlayerId}, circle index ${circleIndex}`);
            return;
        }
        
        // Play fire orb telegraph sound
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.playSound('agna_fire_orb', 0.8);
        }
        
        // Create red flash effect on the circle
        this.createRangeFlash(matchingCircle);
        
        // Create red particle effect at the circle's current position
        this.createRedParticles(matchingCircle.x, matchingCircle.y);
    }

    private createRangeFlash(circleSprite: Phaser.GameObjects.Image): void {
        // Create a more prominent flash effect on the magic circle
        const originalTint = circleSprite.tint;
        const originalAlpha = circleSprite.alpha;
        
        // Bright red flash with increased alpha
        circleSprite.setTint(0xff0000); // Bright red
        circleSprite.setAlpha(1.0); // Full opacity
        
        // Tween back to original color and alpha
        this.scene.tweens.add({
            targets: circleSprite,
            duration: 200,
            ease: 'Power2',
            onComplete: () => {
                circleSprite.setTint(originalTint);
                circleSprite.setAlpha(originalAlpha);
            }
        });
        
        // Create a more dramatic scale pulse
        const originalScale = circleSprite.scaleX;
        this.scene.tweens.add({
            targets: circleSprite,
            scaleX: originalScale * 1.25,
            scaleY: originalScale * 1.25,
            duration: 200,
            ease: 'Back.easeOut',
            yoyo: true
        });
        
        // Add a brief glow effect by creating a temporary duplicate
        const glowSprite = this.scene.add.image(circleSprite.x, circleSprite.y, MAGIC_CIRCLE_ASSET_KEY);
        glowSprite.setScale(circleSprite.scaleX * 1.3);
        glowSprite.setTint(0xff4444);
        glowSprite.setAlpha(0.6);
        glowSprite.setDepth(circleSprite.depth - 1);
        glowSprite.setBlendMode(Phaser.BlendModes.ADD);
        
        // Fade out and destroy the glow
        this.scene.tweens.add({
            targets: glowSprite,
            alpha: 0,
            scale: circleSprite.scaleX * 1.8,
            duration: 400,
            ease: 'Power2',
            onComplete: () => {
                glowSprite.destroy();
            }
        });
    }

    private createRedParticles(x: number, y: number): void {
        // Create red particle effect at the telegraph position
        const particles = this.scene.add.particles(x, y, 'white_pixel', {
            scale: { start: 0.3, end: 0.1 },
            speed: { min: 50, max: 100 },
            lifespan: 300,
            quantity: 8,
            tint: 0xff4444, // Red color
            alpha: { start: 0.8, end: 0 },
            blendMode: 'ADD'
        });
        
        // Set proper depth
        particles.setDepth(BASE_DEPTH + y + 20);
        
        // Auto-destroy the particle emitter after a short time
        this.scene.time.delayedCall(500, () => {
            particles.destroy();
        });
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
        
        // Stop flamethrower sound immediately
        this.stopFlamethrowerSoundImmediate();
        this.agnaBossesInFlamethrowerMode.clear();
        
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
            db.activeMonsterAttacks?.removeOnInsert(this.boundHandleAttackInsert);
            db.monsters?.removeOnUpdate(this.boundHandleMonsterUpdate);
            db.monsters?.removeOnDelete(this.boundHandleMonsterDelete);
            db.player?.removeOnDelete(this.boundHandlePlayerDelete);
            console.log("BossAgnaManager database listeners removed");
        }
    }
} 