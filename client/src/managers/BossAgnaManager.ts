import Phaser from 'phaser';
import { EventContext, AgnaMagicCircle, AgnaCandleSpawn, ActiveMonsterAttack, MonsterAttackType, Monsters, AiState, Player, AgnaSummoningCircleSpawner } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';

const MAGIC_CIRCLE_ASSET_KEY = 'agna_magic_circle';
const BIG_MAGIC_CIRCLE_DEPTH = 1;
const AGNA_WICK_CIRCLE_SCALE = 0.80;
const AGNA_WICK_CIRCLE_Y_OFFSET = 28; // Offset circle slightly up from Claudia's center
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
    private summoningCircles: Map<bigint, Phaser.GameObjects.Image> = new Map();
    
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
    private boundHandleSummoningCircleInsert: (ctx: EventContext, spawner: AgnaSummoningCircleSpawner) => void;
    private boundHandleSummoningCircleDelete: (ctx: EventContext, spawner: AgnaSummoningCircleSpawner) => void;
    
    // Flag to track if the manager has been shut down
    private isDestroyed: boolean = false;
    
    // Flamethrower sound management
    private flamethrowerSound: Phaser.Sound.BaseSound | null = null;
    private agnaBossesInFlamethrowerMode: Set<number> = new Set();
    
    // Ritual completion visualization
    private ritualCompleteHaze: Phaser.GameObjects.Rectangle | null = null;
    private playerRitualCircles: Map<number, Phaser.GameObjects.Image> = new Map();
    private isRitualCompleteActive: boolean = false;
    
    // Magic circle phase visualization
    private playerGroundCircles: Map<number, Phaser.GameObjects.Image> = new Map();
    private isMagicCirclePhaseActive: boolean = false;
    
    // Wick phase visualization
    private wickPhaseGroundCircle: Phaser.GameObjects.Image | null = null;
    private wickPhasePlayerCircles: Map<number, Phaser.GameObjects.Image> = new Map();
    private isWickPhaseActive: boolean = false;
    private wickPhaseStartTime: number = 0;
    private wickPhaseDuration: number = 13000; // 13 seconds as per server constants

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
        this.boundHandleSummoningCircleInsert = this.handleSummoningCircleInsert.bind(this);
        this.boundHandleSummoningCircleDelete = this.handleSummoningCircleDelete.bind(this);
        
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
            db.agnaSummoningCircleSpawner?.onInsert(this.boundHandleSummoningCircleInsert);
            db.agnaSummoningCircleSpawner?.onDelete(this.boundHandleSummoningCircleDelete);
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
        
        // Also check for any existing Claudia bosses in flamethrower mode or ritual states
        for (const monster of ctx.db?.monsters?.iter() || []) {
            if (this.isAgnaBoss(monster)) {
                if (this.isFlamethrowerState(monster.aiState)) {
                    console.log(`Found existing Claudia boss ${monster.monsterId} in flamethrower mode during initialization`);
                    this.startFlamethrowerSound(monster.monsterId);
                }
                if (this.isRitualCompleteState(monster.aiState)) {
                    console.log(`Found existing Claudia boss ${monster.monsterId} in ritual complete state during initialization`);
                    this.startRitualCompleteVisualization();
                }
                if (this.isMagicCircleState(monster.aiState)) {
                    console.log(`Found existing Claudia boss ${monster.monsterId} in magic circle state during initialization`);
                    this.startMagicCirclePhaseVisualization();
                }
                if (this.isRitualWickState(monster.aiState)) {
                    console.log(`Found existing Claudia boss ${monster.monsterId} in wick state during initialization`);
                    this.startWickPhaseVisualization(monster);
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
        
        // Check if this is an AgnaGroundFlame attack (play sound when ground fire spawns)
        if (attack.monsterAttackType.tag === "AgnaGroundFlame") {
            console.log("AgnaGroundFlame attack detected, playing fire orb sound");
            this.playRitualSound('agna_fire_orb', 0.6);
        }
    }

    // Handle when a monster is updated (for flamethrower state detection)
    private handleMonsterUpdate(ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) {
        if (this.isDestroyed) {
            return;
        }
        
        // Only process Claudia bosses
        if (!this.isAgnaBoss(newMonster)) {
            return;
        }
        
        const wasInFlamethrower = this.isFlamethrowerState(oldMonster.aiState);
        const isInFlamethrower = this.isFlamethrowerState(newMonster.aiState);
        
        // Check for flamethrower state transitions (Phase 1)
        if (!wasInFlamethrower && isInFlamethrower) {
            console.log(`Claudia boss ${newMonster.monsterId} entered flamethrower mode`);
            this.startFlamethrowerSound(newMonster.monsterId);
        } else if (wasInFlamethrower && !isInFlamethrower) {
            console.log(`Claudia boss ${newMonster.monsterId} left flamethrower mode`);
            this.stopFlamethrowerSound(newMonster.monsterId);
        }

        // Check for Phase 2 transitions (continuous flamethrower throughout phase)
        const wasPhase2 = oldMonster.bestiaryId?.tag === 'BossAgnaPhase2';
        const isPhase2 = newMonster.bestiaryId?.tag === 'BossAgnaPhase2';
        
        if (!wasPhase2 && isPhase2) {
            console.log(`Claudia boss ${newMonster.monsterId} entered Phase 2 - starting continuous flamethrower sound`);
            this.startFlamethrowerSound(newMonster.monsterId);
        } else if (wasPhase2 && !isPhase2) {
            console.log(`Claudia boss ${newMonster.monsterId} left Phase 2 - stopping continuous flamethrower sound`);
            this.stopFlamethrowerSound(newMonster.monsterId);
        }

        // Check for magic circle state transitions
        const wasInMagicCircle = this.isMagicCircleState(oldMonster.aiState);
        const isInMagicCircle = this.isMagicCircleState(newMonster.aiState);

        // Check for ritual state transitions
        const wasInRitualMatch = this.isRitualMatchState(oldMonster.aiState);
        const isInRitualMatch = this.isRitualMatchState(newMonster.aiState);
        const wasInRitualWick = this.isRitualWickState(oldMonster.aiState);
        const isInRitualWick = this.isRitualWickState(newMonster.aiState);
        const wasInRitualComplete = this.isRitualCompleteState(oldMonster.aiState);
        const isInRitualComplete = this.isRitualCompleteState(newMonster.aiState);
        const wasInRitualFailed = this.isRitualFailedState(oldMonster.aiState);
        const isInRitualFailed = this.isRitualFailedState(newMonster.aiState);

        // Handle magic circle phase visualization
        if (!wasInMagicCircle && isInMagicCircle) {
            console.log(`Claudia boss ${newMonster.monsterId} entered magic circle phase`);
            this.startMagicCirclePhaseVisualization();
        } else if (wasInMagicCircle && !isInMagicCircle) {
            console.log(`Claudia boss ${newMonster.monsterId} left magic circle phase`);
            this.stopMagicCirclePhaseVisualization();
        }

        // Handle wick phase visualization
        if (!wasInRitualWick && isInRitualWick) {
            console.log(`Claudia boss ${newMonster.monsterId} entered wick phase`);
            this.startWickPhaseVisualization(newMonster);
        } else if (wasInRitualWick && !isInRitualWick) {
            console.log(`Claudia boss ${newMonster.monsterId} left wick phase`);
            this.stopWickPhaseVisualization();
        }

        // Play ritual sounds when entering states
        if (!wasInRitualMatch && isInRitualMatch) {
            console.log(`Claudia boss ${newMonster.monsterId} entered ritual match phase`);
            this.playRitualSound('agna_match', 0.8);
        } else if (!wasInRitualWick && isInRitualWick) {
            console.log(`Claudia boss ${newMonster.monsterId} entered ritual wick phase`);
            this.playRitualSound('agna_wick', 1.0);
        } else if (!wasInRitualComplete && isInRitualComplete) {
            console.log(`Claudia boss ${newMonster.monsterId} entered ritual complete phase`);
            this.playRitualSound('agna_extinguished', 0.9);
            this.startRitualCompleteVisualization();
        } else if (!wasInRitualFailed && isInRitualFailed) {
            console.log(`Claudia boss ${newMonster.monsterId} entered ritual failed phase`);
            this.playRitualSound('agna_ritual_fail', 0.8);
            // Stop wick phase visualization immediately when ritual fails
            this.stopWickPhaseVisualizationFast();
        }
        
        // Check if we need to stop ritual complete visualization
        if (wasInRitualComplete && !isInRitualComplete) {
            console.log(`Claudia boss ${newMonster.monsterId} left ritual complete phase`);
            this.stopRitualCompleteVisualization();
        }
        
        // Handle ritual complete enhancement of wick phase ground circle
        if (!wasInRitualComplete && isInRitualComplete) {
            console.log("Enhancing wick phase ground circle for ritual complete");
            this.enhanceWickPhaseGroundCircleForRitualComplete();
        } else if (wasInRitualComplete && !isInRitualComplete) {
            console.log("Restoring wick phase ground circle from ritual complete enhancement");
            this.restoreWickPhaseGroundCircleFromRitualComplete();
        }

        // Check for target changes in Phase 2 Claudia (play laugh sound)
        if (newMonster.bestiaryId?.tag === 'BossAgnaPhase2' && 
            oldMonster.targetPlayerId !== newMonster.targetPlayerId) {
            console.log(`Claudia Phase 2 boss ${newMonster.monsterId} changed target from ${oldMonster.targetPlayerId} to ${newMonster.targetPlayerId}`);
            this.playRitualSound('agna_laugh', 0.7);
        }
    }

    // Handle when a monster is deleted (for cleanup when Claudia bosses are destroyed)
    private handleMonsterDelete(ctx: EventContext, monster: Monsters) {
        if (this.isDestroyed) {
            return;
        }
        
        // Only process Claudia bosses
        if (!this.isAgnaBoss(monster)) {
            return;
        }
        
        console.log(`Claudia boss ${monster.monsterId} was destroyed`);
        this.stopFlamethrowerSound(monster.monsterId);
    }

    // Handle when a player is updated (for ritual circle and ground circle position updates)
    private handlePlayerUpdate(ctx: EventContext, oldPlayer: Player, newPlayer: Player) {
        if (this.isDestroyed) {
            return;
        }
        
        // Check if position changed
        if (oldPlayer.position.x !== newPlayer.position.x || oldPlayer.position.y !== newPlayer.position.y) {
            // Update ritual circle position if ritual is active
            if (this.isRitualCompleteActive) {
                const ritualCircle = this.playerRitualCircles.get(newPlayer.playerId);
                if (ritualCircle) {
                    ritualCircle.setPosition(newPlayer.position.x, newPlayer.position.y);
                    ritualCircle.setDepth(MONSTER_DEPTH_BASE + newPlayer.position.y - 1);
                } else {
                    // Create circle for this player if ritual is active and circle doesn't exist
                    this.createPlayerRitualCircle(newPlayer.playerId, newPlayer.position.x, newPlayer.position.y);
                }
            }
            
            // Update ground circle position if magic circle phase is active
            if (this.isMagicCirclePhaseActive) {
                const groundCircle = this.playerGroundCircles.get(newPlayer.playerId);
                if (groundCircle) {
                    groundCircle.setPosition(newPlayer.position.x, newPlayer.position.y);
                    groundCircle.setDepth(BIG_MAGIC_CIRCLE_DEPTH);
                } else {
                    // Create ground circle for this player if magic circle phase is active and circle doesn't exist
                    this.createPlayerGroundCircle(newPlayer.playerId, newPlayer.position.x, newPlayer.position.y);
                }
            }
            
            // Update wick phase player circle position if wick phase is active
            if (this.isWickPhaseActive) {
                const wickCircle = this.wickPhasePlayerCircles.get(newPlayer.playerId);
                if (wickCircle) {
                    wickCircle.setPosition(newPlayer.position.x, newPlayer.position.y);
                    wickCircle.setDepth(MONSTER_DEPTH_BASE + newPlayer.position.y + 10);
                } else {
                    // Create wick circle for this player if wick phase is active and circle doesn't exist
                    this.createWickPhasePlayerCircle(newPlayer.playerId, newPlayer.position.x, newPlayer.position.y);
                }
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
        
        // Remove ground circle for this player if it exists
        this.removePlayerGroundCircle(player.playerId);
        
        // Remove wick phase circle for this player if it exists
        this.removeWickPhasePlayerCircle(player.playerId);
    }

    // Handle when a summoning circle spawner is inserted
    private handleSummoningCircleInsert(ctx: EventContext, spawner: AgnaSummoningCircleSpawner) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Summoning circle spawner inserted:", spawner);
        this.createSummoningCircle(spawner);
    }

    // Handle when a summoning circle spawner is deleted
    private handleSummoningCircleDelete(ctx: EventContext, spawner: AgnaSummoningCircleSpawner) {
        if (this.isDestroyed) {
            return;
        }
        
        console.log("Summoning circle spawner deleted:", spawner);
        this.removeSummoningCircle(spawner.scheduledId);
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

    private isMagicCircleState(aiState: AiState): boolean {
        return aiState.tag === 'BossAgnaMagicCircle';
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
                console.log("Starting Claudia flamethrower sound");
                
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
                    console.warn("Claudia flamethrower sound not found in cache");
                }
            }
        }
    }

    private stopFlamethrowerSound(monsterId: number) {
        // Since there's only ever one Claudia boss, just clear the set and stop the sound
        this.agnaBossesInFlamethrowerMode.clear();
        this.stopFlamethrowerSoundImmediate();
    }

    private stopFlamethrowerSoundImmediate() {
        if (this.flamethrowerSound) {
            console.log("Stopping Claudia flamethrower sound");
            this.flamethrowerSound.stop();
            this.flamethrowerSound.destroy();
            this.flamethrowerSound = null;
        }
    }

    // Ritual sound management
    private playRitualSound(soundKey: string, volume: number = 0.8) {
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            console.log(`Playing Claudia ritual sound: ${soundKey}`);
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

    // Magic circle phase visualization management
    private startMagicCirclePhaseVisualization() {
        if (this.isMagicCirclePhaseActive) {
            return; // Already active
        }
        
        console.log("Starting magic circle phase visualization - ground circles under players");
        this.isMagicCirclePhaseActive = true;
        
        // Create ground circles under all active players
        this.createPlayerGroundCircles();
    }

    private stopMagicCirclePhaseVisualization() {
        if (!this.isMagicCirclePhaseActive) {
            return; // Not active
        }
        
        console.log("Stopping magic circle phase visualization");
        this.isMagicCirclePhaseActive = false;
        
        // Remove all player ground circles
        this.removeAllPlayerGroundCircles();
    }

    private createPlayerGroundCircles() {
        // Get all active players from the database
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.warn("Cannot create player ground circles - database not available");
            return;
        }
        
        for (const player of db.player.iter()) {
            this.createPlayerGroundCircle(player.playerId, player.position.x, player.position.y);
        }
    }

    private createPlayerGroundCircle(playerId: number, x: number, y: number) {
        // Don't create if already exists
        if (this.playerGroundCircles.has(playerId)) {
            return;
        }
        
        // Create ground circle sprite under the player
        const circle = this.scene.add.image(x, y, 'agna_big_circle');
        circle.setScale(1.0); // Normal size
        circle.setAlpha(0.15); // Mid alpha as requested
        
        // Set depth to be well below the player (ground level)
        circle.setDepth(BIG_MAGIC_CIRCLE_DEPTH);
        
        // Ensure it follows the camera
        circle.setScrollFactor(1, 1);
        
        // Store the circle
        this.playerGroundCircles.set(playerId, circle);
        
        console.log(`Created ground circle for player ${playerId} at (${x}, ${y})`);
    }

    private removePlayerGroundCircle(playerId: number) {
        const circle = this.playerGroundCircles.get(playerId);
        if (circle) {
            circle.destroy();
            this.playerGroundCircles.delete(playerId);
            console.log(`Removed ground circle for player ${playerId}`);
        }
    }

    private removeAllPlayerGroundCircles() {
        for (const [playerId, circle] of this.playerGroundCircles) {
            circle.destroy();
        }
        this.playerGroundCircles.clear();
        console.log("Removed all player ground circles");
    }

    // Wick phase visualization management
    private startWickPhaseVisualization(agnaBoss: Monsters) {
        if (this.isWickPhaseActive) {
            return; // Already active
        }
        
        console.log("Starting wick phase visualization - ground circle on Claudia and magic circles on players");
        this.isWickPhaseActive = true;
        this.wickPhaseStartTime = this.scene.time.now;
        
        // Create ground circle on Claudia's position
        this.createWickPhaseGroundCircle(agnaBoss);
        
        // Create magic circles over all active players
        this.createWickPhasePlayerCircles();
    }

    private stopWickPhaseVisualization() {
        if (!this.isWickPhaseActive) {
            return; // Not active
        }
        
        console.log("Stopping wick phase visualization");
        this.isWickPhaseActive = false;
        
        // Remove ground circle on Claudia
        this.removeWickPhaseGroundCircle();
        
        // Remove all player magic circles
        this.removeAllWickPhasePlayerCircles();
    }

    private stopWickPhaseVisualizationFast() {
        if (!this.isWickPhaseActive) {
            return; // Not active
        }
        
        console.log("Stopping wick phase visualization quickly (ritual failed)");
        this.isWickPhaseActive = false;
        
        // Remove ground circle on Claudia with fast fade
        this.removeWickPhaseGroundCircleFast();
        
        // Remove all player magic circles with fast fade
        this.removeAllWickPhasePlayerCirclesFast();
    }

    private createWickPhaseGroundCircle(agnaBoss: Monsters) {
        if (this.wickPhaseGroundCircle) {
            return; // Already exists
        }
        
        // Get Claudia's current position from the boid data
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.warn("Cannot create wick phase ground circle - database not available");
            return;
        }
        
        const agnaBoid = db.monstersBoid.monsterId.find(agnaBoss.monsterId);
        if (!agnaBoid) {
            console.warn(`Cannot find boid for Claudia boss ${agnaBoss.monsterId}`);
            return;
        }
        
        const agnaPosition = agnaBoid.position;
        
        // Create big circle sprite on Claudia with Y offset
        const circle = this.scene.add.image(agnaPosition.x, agnaPosition.y + AGNA_WICK_CIRCLE_Y_OFFSET, 'agna_big_circle');
        circle.setScale(AGNA_WICK_CIRCLE_SCALE);
        circle.setAlpha(0); // Start invisible
        
        // Set depth to be at ground level but visible
        circle.setDepth(BIG_MAGIC_CIRCLE_DEPTH);
        
        // Store the circle
        this.wickPhaseGroundCircle = circle;
        
        // Animate alpha from 0 to 1 over the wick phase duration using x-squared easing
        this.scene.tweens.add({
            targets: circle,
            alpha: 1.0,
            duration: this.wickPhaseDuration,
            ease: 'Linear', // x-squared easing
            onComplete: () => {
                console.log("Wick phase ground circle reached full alpha");
            }
        });
        
        console.log(`Created wick phase ground circle on Claudia at (${agnaPosition.x}, ${agnaPosition.y})`);
    }

    private removeWickPhaseGroundCircle() {
        if (this.wickPhaseGroundCircle) {
            // Stop any active tweens
            this.scene.tweens.killTweensOf(this.wickPhaseGroundCircle);
            this.wickPhaseGroundCircle.destroy();
            this.wickPhaseGroundCircle = null;
            console.log("Removed wick phase ground circle");
        }
    }

    private removeWickPhaseGroundCircleFast() {
        if (this.wickPhaseGroundCircle) {
            // Stop any active tweens
            this.scene.tweens.killTweensOf(this.wickPhaseGroundCircle);
            
            // Quick fade to 0 alpha then destroy
            this.scene.tweens.add({
                targets: this.wickPhaseGroundCircle,
                alpha: 0,
                duration: 200, // Fast fade (200ms)
                ease: 'Power2',
                onComplete: () => {
                    if (this.wickPhaseGroundCircle) {
                        this.wickPhaseGroundCircle.destroy();
                        this.wickPhaseGroundCircle = null;
                        console.log("Fast removed wick phase ground circle (ritual failed)");
                    }
                }
            });
        }
    }

    private createWickPhasePlayerCircles() {
        // Get all active players from the database
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.warn("Cannot create wick phase player circles - database not available");
            return;
        }
        
        for (const player of db.player.iter()) {
            this.createWickPhasePlayerCircle(player.playerId, player.position.x, player.position.y);
        }
    }

    private createWickPhasePlayerCircle(playerId: number, x: number, y: number) {
        // Don't create if already exists
        if (this.wickPhasePlayerCircles.has(playerId)) {
            return;
        }
        
        // Create magic circle sprite over the player
        const circle = this.scene.add.image(x, y, MAGIC_CIRCLE_ASSET_KEY);
        circle.setScale(0); // Start at 0 scale
        circle.setAlpha(0); // Start invisible
        
        // Set depth to be above the player
        circle.setDepth(MONSTER_DEPTH_BASE + y + 10);
        
        // Store the circle
        this.wickPhasePlayerCircles.set(playerId, circle);
        
        // Animate both alpha and scale from 0 to 1 over the wick phase duration using x-squared easing
        this.scene.tweens.add({
            targets: circle,
            alpha: 0.8,
            scaleX: 1.0,
            scaleY: 1.0,
            duration: this.wickPhaseDuration,
            ease: 'Quad.easeIn', // x-squared easing
            onComplete: () => {
                console.log(`Wick phase player circle for player ${playerId} reached full scale and alpha`);
            }
        });
        
        console.log(`Created wick phase magic circle for player ${playerId} at (${x}, ${y})`);
    }

    private removeWickPhasePlayerCircle(playerId: number) {
        const circle = this.wickPhasePlayerCircles.get(playerId);
        if (circle) {
            // Stop any active tweens
            this.scene.tweens.killTweensOf(circle);
            circle.destroy();
            this.wickPhasePlayerCircles.delete(playerId);
            console.log(`Removed wick phase magic circle for player ${playerId}`);
        }
    }

    private removeAllWickPhasePlayerCircles() {
        for (const [playerId, circle] of this.wickPhasePlayerCircles) {
            // Stop any active tweens
            this.scene.tweens.killTweensOf(circle);
            circle.destroy();
        }
        this.wickPhasePlayerCircles.clear();
        console.log("Removed all wick phase player magic circles");
    }

    private removeAllWickPhasePlayerCirclesFast() {
        const circlesToRemove = new Map(this.wickPhasePlayerCircles);
        this.wickPhasePlayerCircles.clear(); // Clear immediately to prevent new updates
        
        for (const [playerId, circle] of circlesToRemove) {
            // Stop any active tweens
            this.scene.tweens.killTweensOf(circle);
            
            // Quick fade to 0 alpha then destroy
            this.scene.tweens.add({
                targets: circle,
                alpha: 0,
                duration: 200, // Fast fade (200ms)
                ease: 'Power2',
                onComplete: () => {
                    circle.destroy();
                }
            });
        }
        
        console.log(`Fast removed ${circlesToRemove.size} wick phase player magic circles (ritual failed)`);
    }

    // Methods to enhance wick phase ground circle during ritual complete
    private enhanceWickPhaseGroundCircleForRitualComplete() {
        // If no wick phase ground circle exists, create one for ritual complete
        if (!this.wickPhaseGroundCircle) {
            this.createRitualCompleteGroundCircle();
            return;
        }
        
        // Stop any existing tweens on the ground circle
        this.scene.tweens.killTweensOf(this.wickPhaseGroundCircle);
        
        // Set to full opacity with red highlight
        this.wickPhaseGroundCircle.setAlpha(1.0);
        this.wickPhaseGroundCircle.setTint(0xff4444); // Red highlight
        
        console.log("Enhanced wick phase ground circle for ritual complete (full opacity + red tint)");
    }

    private createRitualCompleteGroundCircle() {
        // Get Claudia's current position from the database
        const db = this.spacetimeDBClient.sdkConnection?.db;
        if (!db) {
            console.warn("Cannot create ritual complete ground circle - database not available");
            return;
        }

        // Find the Claudia boss
        let agnaBoss: any = null;
        for (const monster of db.monsters.iter()) {
            if (monster.bestiaryId?.tag === 'BossAgnaPhase1' || monster.bestiaryId?.tag === 'BossAgnaPhase2') {
                agnaBoss = monster;
                break;
            }
        }

        if (!agnaBoss) {
            console.warn("Cannot find Claudia boss for ritual complete ground circle");
            return;
        }

        const agnaBoid = db.monstersBoid.monsterId.find(agnaBoss.monsterId);
        if (!agnaBoid) {
            console.warn(`Cannot find boid for Claudia boss ${agnaBoss.monsterId}`);
            return;
        }

        const agnaPosition = agnaBoid.position;
        
        // Create big circle sprite on Claudia for ritual complete with Y offset
        const circle = this.scene.add.image(agnaPosition.x, agnaPosition.y + AGNA_WICK_CIRCLE_Y_OFFSET, 'agna_big_circle');
        circle.setScale(AGNA_WICK_CIRCLE_SCALE);
        circle.setAlpha(1.0); // Full opacity immediately
        circle.setTint(0xff4444); // Red highlight immediately
        
        // Set depth to be at ground level but visible
        circle.setDepth(BIG_MAGIC_CIRCLE_DEPTH);
        
        // Store the circle
        this.wickPhaseGroundCircle = circle;
        
        console.log(`Created ritual complete ground circle on Claudia at (${agnaPosition.x}, ${agnaPosition.y})`);
    }

    private restoreWickPhaseGroundCircleFromRitualComplete() {
        if (!this.wickPhaseGroundCircle) {
            return; // No ground circle to restore
        }
        
        // If wick phase is still active, restore to wick phase appearance
        if (this.isWickPhaseActive) {
            // Remove red tint
            this.wickPhaseGroundCircle.clearTint();
            
            // Calculate how much time is left in the wick phase to determine proper alpha
            const timeElapsed = this.scene.time.now - this.wickPhaseStartTime;
            const timeRemaining = Math.max(0, this.wickPhaseDuration - timeElapsed);
            
            if (timeRemaining > 0) {
                // Continue the original alpha tween for the remaining time
                const currentProgress = timeElapsed / this.wickPhaseDuration;
                const targetAlpha = Math.min(1.0, currentProgress); // Clamp to 1.0
                
                this.scene.tweens.add({
                    targets: this.wickPhaseGroundCircle,
                    alpha: targetAlpha,
                    duration: 100, // Quick transition back
                    ease: 'Power2',
                    onComplete: () => {
                        // Resume the original tween if there's still time left
                        if (timeRemaining > 100) {
                            this.scene.tweens.add({
                                targets: this.wickPhaseGroundCircle,
                                alpha: 1.0,
                                duration: timeRemaining - 100,
                                ease: 'Linear'
                            });
                        }
                    }
                });
            } else {
                // Wick phase should be complete, keep at full alpha
                this.wickPhaseGroundCircle.setAlpha(1.0);
            }
            
            console.log("Restored wick phase ground circle from ritual complete enhancement");
        } else {
            // No wick phase active, remove the ground circle entirely
            this.scene.tweens.killTweensOf(this.wickPhaseGroundCircle);
            this.wickPhaseGroundCircle.destroy();
            this.wickPhaseGroundCircle = null;
            console.log("Removed ritual complete ground circle (no wick phase active)");
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
        
        // Fade in animation (more transparent for subtlety)
        this.scene.tweens.add({
            targets: candleSprite,
            alpha: 0.6,
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

    // Create a summoning circle visual at the spawner position
    private createSummoningCircle(spawner: AgnaSummoningCircleSpawner): void {
        console.log("Creating summoning circle visual for spawner", spawner.scheduledId);
        
        // Note: We don't have position data in the spawner table since it's determined when the reducer runs
        // For now, we'll just track the spawner but not create a visual until the actual summoning happens
        // In the future, if we need to show a visual preview, we'd need position data in the spawner table
        
        // Create a transparent magic circle at a placeholder position (we'll move it when we get position data)
        const summoningCircleSprite = this.scene.add.image(0, 0, MAGIC_CIRCLE_ASSET_KEY);
        summoningCircleSprite.setVisible(false); // Hide initially until we get position
        summoningCircleSprite.setAlpha(0.4); // Semi-transparent for summoning circles
        summoningCircleSprite.setDepth(BASE_DEPTH);
        summoningCircleSprite.setTint(0xff6600); // Orange tint to distinguish from regular magic circles
        
        // Store the sprite
        this.summoningCircles.set(spawner.scheduledId, summoningCircleSprite);
        
        // Add to scene (but keep invisible for now)
        console.log(`Created summoning circle visual for spawner ${spawner.scheduledId}`);
    }

    // Remove a summoning circle visual
    private removeSummoningCircle(spawnerId: bigint): void {
        const summoningCircleSprite = this.summoningCircles.get(spawnerId);
        if (!summoningCircleSprite) {
            return;
        }
        
        console.log(`Removing summoning circle visual for spawner ${spawnerId}`);
        
        // Fade out and remove
        this.scene.tweens.add({
            targets: summoningCircleSprite,
            alpha: 0,
            duration: FADE_OUT_DURATION,
            onComplete: () => {
                summoningCircleSprite.destroy();
            }
        });
        
        this.summoningCircles.delete(spawnerId);
        console.log(`Removed summoning circle visual for spawner ${spawnerId}`);
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
        
        // Stop magic circle phase visualization if active
        this.stopMagicCirclePhaseVisualization();
        
        // Stop wick phase visualization if active
        this.stopWickPhaseVisualization();
        
        // Stop all active tweens for magic circles, candle spawns, summoning circles, and wick phase elements
        this.magicCircles.forEach(circleSprite => {
            this.scene.tweens.killTweensOf(circleSprite);
        });
        this.candleSpawns.forEach(candleSprite => {
            this.scene.tweens.killTweensOf(candleSprite);
        });
        this.summoningCircles.forEach(summoningSprite => {
            this.scene.tweens.killTweensOf(summoningSprite);
        });
        if (this.wickPhaseGroundCircle) {
            this.scene.tweens.killTweensOf(this.wickPhaseGroundCircle);
        }
        this.wickPhasePlayerCircles.forEach(wickCircle => {
            this.scene.tweens.killTweensOf(wickCircle);
        });
        
        // Destroy all magic circle sprites, candle spawn sprites, and summoning circle sprites
        this.magicCircles.forEach(circleSprite => circleSprite.destroy());
        this.magicCircles.clear();
        this.candleSpawns.forEach(candleSprite => candleSprite.destroy());
        this.candleSpawns.clear();
        this.summoningCircles.forEach(summoningSprite => summoningSprite.destroy());
        this.summoningCircles.clear();
        
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
            db.agnaSummoningCircleSpawner?.removeOnInsert(this.boundHandleSummoningCircleInsert);
            db.agnaSummoningCircleSpawner?.removeOnDelete(this.boundHandleSummoningCircleDelete);
            console.log("BossAgnaManager database listeners removed");
        }
    }
} 