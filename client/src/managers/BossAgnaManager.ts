import Phaser from 'phaser';
import { EventContext, AgnaMagicCircle, AgnaCandleSpawn, ActiveMonsterAttack, MonsterAttackType, Monsters, AiState, Player } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';

const MAGIC_CIRCLE_ASSET_KEY = 'agna_magic_circle';
const CANDLE_SPAWN_ASSET_KEY = 'agna_candle_off';
const FADE_IN_DURATION = 500;
const FADE_OUT_DURATION = 300;
const BASE_DEPTH = 1000;
const MONSTER_DEPTH_BASE = 2000; // Similar depth to monsters
const ORBIT_RADIUS = 96;
const ORBIT_SPEED = 90; // degrees per second

export default class BossAgnaManager {
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    private magicCircles: Map<bigint, Phaser.GameObjects.Image> = new Map();
    private candleSpawns: Map<bigint, Phaser.GameObjects.Image> = new Map();
    
    // Store bound event handlers for proper cleanup
    private boundHandleCircleInsert: (ctx: EventContext, circle: AgnaMagicCircle) => void;
    private boundHandleCircleUpdate: (ctx: EventContext, oldCircle: AgnaMagicCircle, newCircle: AgnaMagicCircle) => void;
    private boundHandleCircleDelete: (ctx: EventContext, circle: AgnaMagicCircle) => void;
    private boundHandleCandleSpawnInsert: (ctx: EventContext, candleSpawn: AgnaCandleSpawn) => void;
    private boundHandleCandleSpawnUpdate: (ctx: EventContext, oldCandleSpawn: AgnaCandleSpawn, newCandleSpawn: AgnaCandleSpawn) => void;
    private boundHandleCandleSpawnDelete: (ctx: EventContext, candleSpawn: AgnaCandleSpawn) => void;
    private boundHandleAttackInsert: (ctx: EventContext, attack: ActiveMonsterAttack) => void;
    private boundHandleMonsterUpdate: (ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) => void;
    private boundHandleMonsterDelete: (ctx: EventContext, monster: Monsters) => void;
    private boundHandlePlayerUpdate: (ctx: EventContext, oldPlayer: Player, newPlayer: Player) => void;
    private boundHandlePlayerDelete: (ctx: EventContext, player: Player) => void;
    
    // Flag to track if the manager has been shut down
    private isDestroyed: boolean = false;
    
    // Flamethrower sound management
    private flamethrowerSound: Phaser.Sound.BaseSound | null = null;
    private agnaBossesInFlamethrowerMode: Set<number> = new Set();
    
    // Ritual completion visualization
    private ritualCompleteHaze: Phaser.GameObjects.Rectangle | null = null;
    private playerRitualCircles: Map<number, Phaser.GameObjects.Image> = new Map();
    private isRitualCompleteActive: boolean = false;

    constructor(scene: Phaser.Scene, client: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = client;
        console.log("BossAgnaManager initialized");
        
        // Bind event handlers once for proper cleanup
        this.boundHandleCircleInsert = this.handleCircleInsert.bind(this);
        this.boundHandleCircleUpdate = this.handleCircleUpdate.bind(this);
        this.boundHandleCircleDelete = this.handleCircleDelete.bind(this);
        this.boundHandleCandleSpawnInsert = this.handleCandleSpawnInsert.bind(this);
        this.boundHandleCandleSpawnUpdate = this.handleCandleSpawnUpdate.bind(this);
        this.boundHandleCandleSpawnDelete = this.handleCandleSpawnDelete.bind(this);
        this.boundHandleAttackInsert = this.handleAttackInsert.bind(this);
        this.boundHandleMonsterUpdate = this.handleMonsterUpdate.bind(this);
        this.boundHandleMonsterDelete = this.handleMonsterDelete.bind(this);
        this.boundHandlePlayerUpdate = this.handlePlayerUpdate.bind(this);
        this.boundHandlePlayerDelete = this.handlePlayerDelete.bind(this);
        
        // Set up event handlers for magic circle table events, candle spawn events, active attacks, monster updates, and player deletes
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.agnaMagicCircles?.onInsert(this.boundHandleCircleInsert);
            db.agnaMagicCircles?.onUpdate(this.boundHandleCircleUpdate);
            db.agnaMagicCircles?.onDelete(this.boundHandleCircleDelete);
            db.agnaCandleSpawns?.onInsert(this.boundHandleCandleSpawnInsert);
            db.agnaCandleSpawns?.onUpdate(this.boundHandleCandleSpawnUpdate);
            db.agnaCandleSpawns?.onDelete(this.boundHandleCandleSpawnDelete);
            db.activeMonsterAttacks?.onInsert(this.boundHandleAttackInsert);
            db.monsters?.onUpdate(this.boundHandleMonsterUpdate);
            db.monsters?.onDelete(this.boundHandleMonsterDelete);
            db.player?.onUpdate(this.boundHandlePlayerUpdate);
            db.player?.onDelete(this.boundHandlePlayerDelete);
        } else {
            console.error("Could not set up BossAgnaManager database listeners (database not connected)");
        }
    }

    // Initialize magic circles and candle spawns from current database state
    public initializeMagicCircles(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize magic circles and candle spawns: database connection not available");
            return;
        }

        console.log("BossAgnaManager initializing magic circles and candle spawns");
        
        for (const circle of ctx.db?.agnaMagicCircles?.iter() || []) {
            this.createMagicCircle(circle);
        }
        
        for (const candleSpawn of ctx.db?.agnaCandleSpawns?.iter() || []) {
            this.createCandleSpawn(candleSpawn);
        }
        
        // Also check for any existing Agna bosses in flamethrower mode or ritual states
        for (const monster of ctx.db?.monsters?.iter() || []) {
            if (this.isAgnaBoss(monster)) {
                if (this.isFlamethrowerState(monster.aiState)) {
                    console.log(`Found existing Agna boss ${monster.monsterId} in flamethrower mode during initialization`);
                    this.startFlamethrowerSound(monster.monsterId);
                }
                if (this.isRitualCompleteState(monster.aiState)) {
                    console.log(`Found existing Agna boss ${monster.monsterId} in ritual complete state during initialization`);
                    this.startRitualCompleteVisualization();
                }
                // Note: Ritual sounds are one-shot, so we don't need to replay them during initialization
                // They are triggered by state transitions, not sustained like flamethrower
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

    // Handle when a new candle spawn is inserted
    private handleCandleSpawnInsert(ctx: EventContext, candleSpawn: AgnaCandleSpawn) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Candle spawn inserted:", candleSpawn);
        this.createCandleSpawn(candleSpawn);
    }

    // Handle when a candle spawn is updated
    private handleCandleSpawnUpdate(ctx: EventContext, oldCandleSpawn: AgnaCandleSpawn, newCandleSpawn: AgnaCandleSpawn) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Candle spawn updated:", oldCandleSpawn, "->", newCandleSpawn);
        // Candle spawns typically don't move, so we may not need to update position
        // But we can update if needed (e.g., if candle_monster_id changes)
    }

    // Handle when a candle spawn is deleted
    private handleCandleSpawnDelete(ctx: EventContext, candleSpawn: AgnaCandleSpawn) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Candle spawn deleted:", candleSpawn);
        this.removeCandleSpawn(candleSpawn.spawnId);
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

        // Check for ritual state transitions
        const wasInRitualMatch = this.isRitualMatchState(oldMonster.aiState);
        const isInRitualMatch = this.isRitualMatchState(newMonster.aiState);
        const wasInRitualWick = this.isRitualWickState(oldMonster.aiState);
        const isInRitualWick = this.isRitualWickState(newMonster.aiState);
        const wasInRitualComplete = this.isRitualCompleteState(oldMonster.aiState);
        const isInRitualComplete = this.isRitualCompleteState(newMonster.aiState);
        const wasInRitualFailed = this.isRitualFailedState(oldMonster.aiState);
        const isInRitualFailed = this.isRitualFailedState(newMonster.aiState);

        // Play ritual sounds when entering states
        if (!wasInRitualMatch && isInRitualMatch) {
            console.log(`Agna boss ${newMonster.monsterId} entered ritual match phase`);
            this.playRitualSound('agna_match', 0.8);
        } else if (!wasInRitualWick && isInRitualWick) {
            console.log(`Agna boss ${newMonster.monsterId} entered ritual wick phase`);
            this.playRitualSound('agna_wick', 0.8);
        } else if (!wasInRitualComplete && isInRitualComplete) {
            console.log(`Agna boss ${newMonster.monsterId} entered ritual complete phase`);
            this.playRitualSound('agna_extinguished', 0.9);
            this.startRitualCompleteVisualization();
        } else if (!wasInRitualFailed && isInRitualFailed) {
            console.log(`Agna boss ${newMonster.monsterId} entered ritual failed phase`);
            this.playRitualSound('agna_ritual_fail', 0.8);
        }
        
        // Check if we need to stop ritual complete visualization
        if (wasInRitualComplete && !isInRitualComplete) {
            console.log(`Agna boss ${newMonster.monsterId} left ritual complete phase`);
            this.stopRitualCompleteVisualization();
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

    // Handle when a player is updated (for ritual circle position updates)
    private handlePlayerUpdate(ctx: EventContext, oldPlayer: Player, newPlayer: Player) {
        if (this.isDestroyed || !this.isRitualCompleteActive) {
            return;
        }
        
        // Check if position changed
        if (oldPlayer.position.x !== newPlayer.position.x || oldPlayer.position.y !== newPlayer.position.y) {
            // Update ritual circle position if it exists for this player
            const circle = this.playerRitualCircles.get(newPlayer.playerId);
            if (circle) {
                circle.setPosition(newPlayer.position.x, newPlayer.position.y);
                circle.setDepth(MONSTER_DEPTH_BASE + newPlayer.position.y - 1);
            } else {
                // Create circle for this player if ritual is active and circle doesn't exist
                this.createPlayerRitualCircle(newPlayer.playerId, newPlayer.position.x, newPlayer.position.y);
            }
        }
    }

    // Handle when a player is deleted (hide magic circles targeting that player)
    private handlePlayerDelete(ctx: EventContext, player: Player) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log(`Player ${player.playerId} was deleted, cleaning up magic circles and ritual circles`);
        
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
        
        // Remove ritual circle for this player if it exists
        this.removePlayerRitualCircle(player.playerId);
    }

    // Helper methods for monster type and state checking
    private isAgnaBoss(monster: Monsters): boolean {
        const monsterType = monster.bestiaryId;
        return monsterType?.tag === 'BossAgnaPhase1' || monsterType?.tag === 'BossAgnaPhase2';
    }

    private isFlamethrowerState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaFlamethrower';
    }

    // Helper methods for ritual state detection
    private isRitualMatchState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaRitualMatch';
    }

    private isRitualWickState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaRitualWick';
    }

    private isRitualCompleteState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaRitualComplete';
    }

    private isRitualFailedState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaRitualFailed';
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

    // Ritual sound management
    private playRitualSound(soundKey: string, volume: number = 0.8) {
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            console.log(`Playing Agna ritual sound: ${soundKey}`);
            soundManager.playSound(soundKey, volume);
        } else {
            console.warn("Sound manager not available for ritual sound playback");
        }
    }

    // Ritual completion visualization management
    private startRitualCompleteVisualization() {
        if (this.isRitualCompleteActive) {
            return; // Already active
        }
        
        console.log("Starting ritual complete visualization - red haze and player circles");
        this.isRitualCompleteActive = true;
        
        // Create red haze overlay covering the entire screen
        this.createRitualCompleteHaze();
        
        // Create magic circles under all active players
        this.createPlayerRitualCircles();
    }

    private stopRitualCompleteVisualization() {
        if (!this.isRitualCompleteActive) {
            return; // Not active
        }
        
        console.log("Stopping ritual complete visualization");
        this.isRitualCompleteActive = false;
        
        // Remove red haze overlay
        this.removeRitualCompleteHaze();
        
        // Remove all player ritual circles
        this.removeAllPlayerRitualCircles();
    }

    private createRitualCompleteHaze() {
        if (this.ritualCompleteHaze) {
            return; // Already exists
        }
        
        // Get camera dimensions for full screen coverage
        const camera = this.scene.cameras.main;
        const screenWidth = camera.width;
        const screenHeight = camera.height;
        
        // Create red haze rectangle covering the entire screen
        this.ritualCompleteHaze = this.scene.add.rectangle(
            camera.centerX, 
            camera.centerY, 
            screenWidth, 
            screenHeight, 
            0xff0000, // Red color
            0.2 // 20% opacity
        );
        
        // Set high depth to appear over most elements but below UI
        this.ritualCompleteHaze.setDepth(10000);
        
        // Make it follow the camera
        this.ritualCompleteHaze.setScrollFactor(0);
        
        console.log("Created ritual complete red haze overlay");
    }

    private removeRitualCompleteHaze() {
        if (this.ritualCompleteHaze) {
            this.ritualCompleteHaze.destroy();
            this.ritualCompleteHaze = null;
            console.log("Removed ritual complete red haze overlay");
        }
    }

    private createPlayerRitualCircles() {
        // Get all active players from the database
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.warn("Cannot create player ritual circles - database not available");
            return;
        }
        
        for (const player of db.player.iter()) {
            this.createPlayerRitualCircle(player.playerId, player.position.x, player.position.y);
        }
    }

    private createPlayerRitualCircle(playerId: number, x: number, y: number) {
        // Don't create if already exists
        if (this.playerRitualCircles.has(playerId)) {
            return;
        }
        
        // Create magic circle sprite under the player
        const circle = this.scene.add.image(x, y, MAGIC_CIRCLE_ASSET_KEY);
        circle.setScale(1.2); // Larger than normal magic circles for more dramatic effect
        circle.setAlpha(0.5); // More transparent for subtle but visible effect
        
        // Set depth to be 1 below the player (assuming player depth is around 2000 + y)
        circle.setDepth(MONSTER_DEPTH_BASE + y - 1);
        
        // Ensure it follows the camera
        circle.setScrollFactor(1, 1);
        
        // Store the circle
        this.playerRitualCircles.set(playerId, circle);
        
        console.log(`Created ritual circle for player ${playerId} at (${x}, ${y})`);
    }

    private removePlayerRitualCircle(playerId: number) {
        const circle = this.playerRitualCircles.get(playerId);
        if (circle) {
            circle.destroy();
            this.playerRitualCircles.delete(playerId);
            console.log(`Removed ritual circle for player ${playerId}`);
        }
    }

    private removeAllPlayerRitualCircles() {
        for (const [playerId, circle] of this.playerRitualCircles) {
            circle.destroy();
        }
        this.playerRitualCircles.clear();
        console.log("Removed all player ritual circles");
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

    private createCandleSpawn(candleSpawnData: AgnaCandleSpawn): void {
        // Check if we already have a sprite for this candle spawn
        if (this.candleSpawns.has(candleSpawnData.spawnId)) {
            console.log(`Candle spawn ${candleSpawnData.spawnId} already exists`);
            return;
        }
        
        // Use the server-provided position directly
        const position = { x: candleSpawnData.position.x, y: candleSpawnData.position.y };
        
        console.log(`Creating candle spawn ${candleSpawnData.spawnId} at position (${position.x}, ${position.y}) for boss ${candleSpawnData.bossMonsterId}, candle index ${candleSpawnData.candleIndex}`);
        
        // Create the candle spawn sprite using "agna_candle_off" asset
        const candleSprite = this.scene.add.image(position.x, position.y, CANDLE_SPAWN_ASSET_KEY);
        candleSprite.setScale(0.8); // Adjust size as needed
        candleSprite.setAlpha(0); // Start invisible for fade in
        
        // Store associated data on the sprite for easy access
        (candleSprite as any).bossMonsterId = candleSpawnData.bossMonsterId;
        (candleSprite as any).candleIndex = candleSpawnData.candleIndex;
        (candleSprite as any).spawnId = candleSpawnData.spawnId;
        
        // Use monster-like depth (similar depth to monsters)
        candleSprite.setDepth(MONSTER_DEPTH_BASE + position.y);
        
        // Ensure it follows the camera
        candleSprite.setScrollFactor(1, 1);
        
        // Fade in animation
        this.scene.tweens.add({
            targets: candleSprite,
            alpha: 0.9,
            duration: FADE_IN_DURATION,
            ease: 'Power2'
        });

        // Store the sprite
        this.candleSpawns.set(candleSpawnData.spawnId, candleSprite);
        
        console.log(`Candle spawn ${candleSpawnData.spawnId} created successfully with depth ${candleSprite.depth}, boss ${candleSpawnData.bossMonsterId}, index ${candleSpawnData.candleIndex}`);
    }

    private removeCandleSpawn(spawnId: bigint): void {
        const candleSprite = this.candleSpawns.get(spawnId);
        if (!candleSprite) {
            console.log(`Candle spawn ${spawnId} already removed or not found`);
            return;
        }
        
        // Stop any active tweens for this sprite
        this.scene.tweens.killTweensOf(candleSprite);
        
        // Fade out animation before destroying
        this.scene.tweens.add({
            targets: candleSprite,
            alpha: 0,
            duration: 50,
            ease: 'Power2',
            onComplete: () => {
                try {
                    candleSprite.destroy();
                } catch (e) {
                    console.warn(`Error destroying candle spawn ${spawnId}:`, e);
                }
                this.candleSpawns.delete(spawnId);
                console.log(`Candle spawn ${spawnId} cleaned up successfully`);
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
        
        // Stop ritual complete visualization if active
        this.stopRitualCompleteVisualization();
        
        // Stop all active tweens for magic circles and candle spawns
        this.magicCircles.forEach(circleSprite => {
            this.scene.tweens.killTweensOf(circleSprite);
        });
        this.candleSpawns.forEach(candleSprite => {
            this.scene.tweens.killTweensOf(candleSprite);
        });
        
        // Destroy all magic circle sprites and candle spawn sprites
        this.magicCircles.forEach(circleSprite => circleSprite.destroy());
        this.magicCircles.clear();
        this.candleSpawns.forEach(candleSprite => candleSprite.destroy());
        this.candleSpawns.clear();
        
        console.log("BossAgnaManager shutdown complete");
    }

    // Helper method to clean up database event listeners
    private unregisterListeners() {
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (db) {
            db.agnaMagicCircles?.removeOnInsert(this.boundHandleCircleInsert);
            db.agnaMagicCircles?.removeOnUpdate(this.boundHandleCircleUpdate);
            db.agnaMagicCircles?.removeOnDelete(this.boundHandleCircleDelete);
            db.agnaCandleSpawns?.removeOnInsert(this.boundHandleCandleSpawnInsert);
            db.agnaCandleSpawns?.removeOnUpdate(this.boundHandleCandleSpawnUpdate);
            db.agnaCandleSpawns?.removeOnDelete(this.boundHandleCandleSpawnDelete);
            db.activeMonsterAttacks?.removeOnInsert(this.boundHandleAttackInsert);
            db.monsters?.removeOnUpdate(this.boundHandleMonsterUpdate);
            db.monsters?.removeOnDelete(this.boundHandleMonsterDelete);
            db.player?.removeOnUpdate(this.boundHandlePlayerUpdate);
            db.player?.removeOnDelete(this.boundHandlePlayerDelete);
            console.log("BossAgnaManager database listeners removed");
        }
    }
} 