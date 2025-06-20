import Phaser from 'phaser';
import { Monsters, EventContext, MonsterType, MonsterBoid, AiState, MonsterVariant} from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient';
import { MONSTER_ASSET_KEYS, MONSTER_SHADOW_OFFSETS_X, MONSTER_SHADOW_OFFSETS_Y, MONSTER_SHADOW_SCALE} from '../constants/MonsterConfig';
import { GameEvents } from '../constants/GameEvents';
import { createMonsterDamageEffect } from '../utils/DamageEffects';

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
const HEALTH_BAR_DEPTH_OFFSET = 1.1;

// Constants for shiny monster effects
const SHINY_PARTICLE_COUNT = 8;
const SHINY_PARTICLE_LIFESPAN = 1000;
const SHINY_PARTICLE_SPEED = { min: 20, max: 60 };
const SHINY_PARTICLE_SCALE = { start: 0.4, end: 0 };
const SHINY_PARTICLE_COLORS = [0xffffff, 0xcccccc, 0x999999]; // White to light gray gradient
const SHINY_COLOR_SHIFT = 0xffffff; // White tint for shiny monsters

// Base monster sizes from bestiary for shiny scaling
const MONSTER_BASE_SIZES: { [key: string]: number } = {
    "Rat": 24.0,
    "Slime": 30.0,
    "Orc": 40.0,
    "BossEnderPhase1": 92.0,
    "BossEnderPhase2": 128.0,
    "BossAgnaPhase1": 88.0,
    "BossAgnaPhase2": 120.0,
    "VoidChest": 82.0,
    "Imp": 34.0,
    "Zombie": 42.0,
    "EnderClaw": 44.0,
    "Bat": 28.0
};

export default class MonsterManager {
    // Reference to the scene
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    
    // Map of monster ID to container
    private monsters: Map<number, Phaser.GameObjects.Container>;
    
    // Map to track hovering tweens for flying monsters (like Bats)
    private hoveringTweens: Map<number, Phaser.Tweens.Tween>;
    
    // Add creation queue for smooth monster spawning
    private creationQueue: Monsters[] = [];
    private isProcessingQueue: boolean = false;
    private maxMonstersPerFrame: number = 2; // Limit monster creation per frame
    
    // Add a property for the game events
    private gameEvents: Phaser.Events.EventEmitter;
    
    // Add a property to track boss state
    private bossPhase1Killed: boolean = false;
    private timeOfBossPhase1Death: number = 0;
    private bossMonsterId: number = 0;
    private bossPosition: { x: number, y: number } | null = null;
    private bossPreTransformActive: boolean = false; // Prevent duplicate pre-transform effects
    
    // Add SoundManager for boss audio cues (using global instance)
    private soundManager: any;
    
    // Track boss AI states to detect changes
    private bossAiStates: Map<number, string> = new Map();
    
    // Track boss target players to detect target changes
    private bossTargets: Map<number, number> = new Map();
    
    // After image VFX tracking for boss chase mode
    private bossAfterImages: Phaser.GameObjects.Sprite[] = [];
    private afterImageFrameCounter: number = 0;
    private afterImageSpawnRate: number = 8; // Spawn after image every 8 frames during chase
    private bossesInChaseMode: Set<number> = new Set(); // Track which bosses are chasing
    
    constructor(scene: Phaser.Scene, spacetimeDBClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeDBClient = spacetimeDBClient;
        this.monsters = new Map();
        this.hoveringTweens = new Map();
        this.gameEvents = (window as any).gameEvents;
        this.soundManager = (window as any).soundManager;
        console.log("MonsterManager constructed");
        
        this.registerMonsterListeners();
    }

    // Helper functions for boss type checking
    private isBoss(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase1' || monsterType === 'BossEnderPhase2' ||
               monsterType === 'BossAgnaPhase1' || monsterType === 'BossAgnaPhase2';
    }

    private isBossPhase1(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase1' || monsterType === 'BossAgnaPhase1';
    }

    private isBossPhase2(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase2' || monsterType === 'BossAgnaPhase2';
    }

    private isEnderBoss(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase1' || monsterType === 'BossEnderPhase2';
    }

        private isAgnaBoss(monsterType: string): boolean {
        return monsterType === 'BossAgnaPhase1' || monsterType === 'BossAgnaPhase2';
    }

    // Helper method to check if the game is over (prevents boss effects during cleanup)
    private isGameOver(): boolean {
        return (this.scene as any).gameOver === true;
    }

    // Initialize monster handlers
    initializeMonsters(ctx: EventContext) {
        if (!this.spacetimeDBClient?.sdkConnection?.db) {
            console.error("Cannot initialize monsters: database connection not available");
            return;
        }

        console.log("MonsterManager initializing monsters");
        
        // Register monster listeners
        this.registerMonsterListeners();
        
        // Force immediate update for all monsters
        for (const monster of ctx.db?.monsters.iter()) {
            this.createOrUpdateMonster(monster);
        }
    }
    
    // Register monster-related event listeners
    registerMonsterListeners() {
        console.log("Registering monster listeners for MonsterManager");

        this.gameEvents.on(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);

        this.gameEvents.on(GameEvents.MONSTER_UPDATED, (ctx: EventContext, oldMonster: Monsters, newMonster: Monsters) => {
            // Check for damage
            if (newMonster.hp < oldMonster.hp) {
                const container = this.monsters.get(newMonster.monsterId);
                if (container) {
                    const sprite = container.list.find(child => child instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;
                    if (sprite) {
                        createMonsterDamageEffect(sprite);
                        
                        // Play distance-based attack soft sound when monster takes damage
                        this.playMonsterDamageSound(container);
                    }
                }
            }
            
            // Check for boss AI state changes
            this.checkBossAiStateChange(oldMonster, newMonster);
            
            // Check for boss target changes
            this.checkBossTargetChange(oldMonster, newMonster);
            
            this.createOrUpdateMonster(newMonster);
        });

        this.gameEvents.on(GameEvents.MONSTER_DELETED, (ctx: EventContext, monster: Monsters) => {
            this.removeMonster(monster.monsterId);
        });

        this.gameEvents.on(GameEvents.MONSTER_BOID_UPDATED, (ctx: EventContext, oldBoid: MonsterBoid, newBoid: MonsterBoid) => {
            this.onMonsterBoidUpdated(ctx, oldBoid, newBoid);
        });
    }

    onMonsterBoidUpdated(ctx: EventContext, oldBoid: MonsterBoid, newBoid: MonsterBoid) {
        let container = this.monsters.get(newBoid.monsterId);
        if (container) {
            // Calculate horizontal movement for EnderClaw flipping
            const monsterType = container.getData('monsterType');
            if (monsterType === 'EnderClaw') {
                const sprite = container.list.find(child => child instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;
                if (sprite) {
                    const deltaX = newBoid.position.x - oldBoid.position.x;
                    // Flip horizontally when moving left
                    if (deltaX < -0.1) { // Small threshold to avoid jitter
                        sprite.setFlipX(true);
                    } else if (deltaX > 0.1) {
                        sprite.setFlipX(false); // Reset to normal direction when moving right
                    }
                    // No change if deltaX is very small (not moving horizontally)
                }
            }
            
            container.setPosition(newBoid.position.x, newBoid.position.y);
            container.setDepth(BASE_DEPTH + newBoid.position.y);
        }
    }
    
    // Create or update a monster sprite
    createOrUpdateMonster(monsterData: Monsters) {
        const monsterTypeName = this.getMonsterTypeName(monsterData.bestiaryId);
        const assetKey = MONSTER_ASSET_KEYS[monsterTypeName];
        
        // Check if we already have a container for this monster
        let container = this.monsters.get(monsterData.monsterId);
        
        if (!container) {
            // Determine initial position - prefer boid position over spawn position for reconnects
            let initialPosition = monsterData.spawnPosition;
            
            // For existing monsters (like on reconnect), try to get current position from boid data
            if (this.spacetimeDBClient?.sdkConnection?.db) {
                const boid = this.spacetimeDBClient.sdkConnection.db.monstersBoid.monsterId.find(monsterData.monsterId);
                if (boid) {
                    initialPosition = boid.position;
                    console.log(`Monster ${monsterData.monsterId} (${monsterTypeName}): Using boid position (${boid.position.x}, ${boid.position.y}) instead of spawn position (${monsterData.spawnPosition.x}, ${monsterData.spawnPosition.y})`);
                }
            }
            
            // Create new container if it doesn't exist
            container = this.scene.add.container(initialPosition.x, initialPosition.y);
            container.setDepth(BASE_DEPTH + initialPosition.y);
            this.monsters.set(monsterData.monsterId, container);
            
            // Create shadow first (so it appears behind the sprite)
            const shadowX = MONSTER_SHADOW_OFFSETS_X[monsterTypeName] || 0;
            const shadowY = MONSTER_SHADOW_OFFSETS_Y[monsterTypeName] || 0;
            const shadow = this.scene.add.image(shadowX, shadowY, SHADOW_ASSET_KEY);
            shadow.setAlpha(SHADOW_ALPHA);
            shadow.setScale(MONSTER_SHADOW_SCALE[monsterTypeName] || 1.0);
            shadow.setDepth(SHADOW_DEPTH_OFFSET);
            container.add(shadow);

            // Create the sprite
            const sprite = this.scene.add.sprite(0, 0, assetKey);
            sprite.setDepth(0);
            container.add(sprite);
            
            // If this is a shiny monster, add visual effects
            if (monsterData.variant.tag === 'Shiny') {
                console.log(`Creating shiny monster effects for ${monsterTypeName} (ID: ${monsterData.monsterId})`);
                
                // Add brightness and glow effect
                sprite.setTint(SHINY_COLOR_SHIFT); // Pure white base
                sprite.setAlpha(1.2); // Slightly brighter than normal
                
                // Create particle emitter for shiny effect
                const particles = this.scene.add.particles(0, 0, 'white_pixel', {
                    speed: SHINY_PARTICLE_SPEED,
                    scale: SHINY_PARTICLE_SCALE,
                    blendMode: Phaser.BlendModes.ADD,
                    lifespan: SHINY_PARTICLE_LIFESPAN,
                    tint: [0xFFFFFF, 0xFFFFAA, 0xFFFFFF], // White to light yellow and back
                    quantity: 1,
                    frequency: 100,
                    emitting: true
                });
                particles.setDepth(0.1); // Just above the sprite
                container.add(particles);
                
                // Store the particle emitter for cleanup
                container.setData('shinyParticles', particles);
                
                // Add a glow effect using a second sprite
                const glowSprite = this.scene.add.sprite(0, 0, sprite.texture.key);
                glowSprite.setTint(SHINY_COLOR_SHIFT);
                glowSprite.setAlpha(0.1);
                glowSprite.setScale(sprite.scaleX * 1.2, sprite.scaleY * 1.2); // Slightly larger for glow
                glowSprite.setBlendMode(Phaser.BlendModes.ADD);
                glowSprite.setDepth(sprite.depth - 1);
                container.add(glowSprite);
                
                // Store the glow sprite for cleanup
                container.setData('shinyGlow', glowSprite);
                
                // Create a pulsing glow effect
                const glowTween = this.scene.tweens.add({
                    targets: glowSprite,
                    alpha: 0.3,
                    duration: 1000,
                    ease: 'Sine.easeInOut',
                    yoyo: true,
                    repeat: -1
                });
                
                // Store the tween for cleanup
                container.setData('shinyGlowTween', glowTween);
                
                // Get base radius from hardcoded values
                const baseRadius = MONSTER_BASE_SIZES[monsterTypeName];
                if (baseRadius) {
                    // Calculate scale based on ratio of current radius to base radius
                    const scaleRatio = monsterData.radius / baseRadius;
                    console.log(`Shiny monster ${monsterData.monsterId} (${monsterTypeName}):`);
                    console.log(`- Current radius: ${monsterData.radius}`);
                    console.log(`- Base radius: ${baseRadius}`);
                    console.log(`- Scale ratio: ${scaleRatio}`);
                    
                    // Apply scale to both sprite and shadow
                    sprite.setScale(scaleRatio);
                    shadow.setScale((MONSTER_SHADOW_SCALE[monsterTypeName] || 1.0) * scaleRatio);
                    
                    // Adjust shadow position to account for scaling
                    const scaledShadowX = (MONSTER_SHADOW_OFFSETS_X[monsterTypeName] || 0) * scaleRatio;
                    const scaledShadowY = (MONSTER_SHADOW_OFFSETS_Y[monsterTypeName] || 0) * scaleRatio;
                    shadow.setPosition(scaledShadowX, scaledShadowY);
                    
                    // Update glow sprite scale to match
                    glowSprite.setScale(scaleRatio * 1.2);
                    
                    // Log the final scale values
                    console.log(`- Sprite scale: ${sprite.scaleX}`);
                    console.log(`- Shadow scale: ${shadow.scaleX}`);
                    console.log(`- Glow scale: ${glowSprite.scaleX}`);
                } else {
                    console.warn(`No base radius found for monster type: ${monsterTypeName}`);
                }
            }
            
            // Pre-calculate health bar position to avoid repeated calculations
            const healthBarY = -sprite.height/2 - MONSTER_HEALTH_BAR_OFFSET_Y;
            
            // Create health bar background (dark background)
            const healthBarBg = this.scene.add.rectangle(
                0,
                healthBarY,
                MONSTER_HEALTH_BAR_WIDTH,
                MONSTER_HEALTH_BAR_HEIGHT,
                0x000000, // Black background
                0.8
            );
            healthBarBg.setDepth(HEALTH_BG_DEPTH_OFFSET);
            healthBarBg.setName('healthBarBg');
            container.add(healthBarBg);

            // Create health bar foreground (colored based on health)
            // Start at full width and let updateHealthBar handle the positioning
            const healthBar = this.scene.add.rectangle(
                0,
                healthBarY,
                MONSTER_HEALTH_BAR_WIDTH,
                MONSTER_HEALTH_BAR_HEIGHT,
                0x00ff00, // Will be updated by updateHealthBar
                1.0 // Full opacity for visibility
            );
            healthBar.setDepth(HEALTH_BAR_DEPTH_OFFSET);
            healthBar.setName('healthBar');
            container.add(healthBar);
            
            // For bosses, make them larger and ensure visibility
            if (this.isBoss(monsterTypeName)) {
                console.log(`Setting up boss sprite: ${monsterTypeName} (ID: ${monsterData.monsterId})`);
                console.log(`Boss data: HP=${monsterData.hp}/${monsterData.maxHp}`);
                console.log(`Boss initial AI state: ${monsterData.aiState.tag}`);
                sprite.setScale(1.0);
                sprite.setAlpha(1);
                sprite.setVisible(true);
                
                // Check if boss starts in chase mode
                if (monsterData.aiState.tag === 'BossEnderChase') {
                    this.bossesInChaseMode.add(monsterData.monsterId);
                    console.log(`Boss ${monsterData.monsterId} created in chase mode - after images activated`);
                }
            }
            
            // Only log regular monster creation in debug builds or for bosses
            if (monsterTypeName.includes("Boss") || monsterTypeName === "VoidChest") {
                console.log(`Created new ${monsterTypeName} sprite (ID: ${monsterData.monsterId})`);
            }
            
            // Add hovering animation for flying monsters like Bats
            if (monsterTypeName === "Bat") {
                this.createHoveringAnimation(monsterData.monsterId, sprite);
            }
        }
        
        // Update health bar (only the foreground bar needs updating)
        const healthBarToUpdate = container.getByName('healthBar') as Phaser.GameObjects.Rectangle;
        this.updateHealthBar(healthBarToUpdate, monsterData.hp, monsterData.maxHp);
        
        // Update monster data
        container.setData('monsterData', monsterData);
        container.setData('monsterType', monsterTypeName);
    }
    
    // Helper function to get health bar color based on health percentage
    private getHealthBarColor(healthPercent: number): number {
        if (healthPercent > 0.6) return 0x00ff00; // Green
        if (healthPercent > 0.3) return 0xffff00; // Yellow
        return 0xff0000; // Red
    }
    
    // Helper function to remove monster sprites
    removeMonster(monsterId: number) {
        // Clean up any hovering tweens for this monster
        const hoveringTween = this.hoveringTweens.get(monsterId);
        if (hoveringTween) {
            hoveringTween.stop();
            hoveringTween.destroy();
            this.hoveringTweens.delete(monsterId);
        }
        
        // Get the monster container
        const monsterContainer = this.monsters.get(monsterId);
        if (!monsterContainer) {
            // This is normal - server may delete monsters that client never created (distance culling, etc.)
            this.monsters.delete(monsterId); // Clean up the map entry anyway
            return;
        }
        
        const monsterType = monsterContainer.getData('monsterType');
        
        // Debug logging for monster type detection
        if (!monsterType) {
            console.warn(`Monster ${monsterId} has no monsterType data, removing anyway`);
        }
        
        // Only log removal for bosses or when debugging
        if (monsterType && (this.isBoss(monsterType) || monsterType === "VoidChest")) {
            console.log(`Removing ${monsterType}: ${monsterId}`);
        }
        
        // Clean up chase mode tracking for this monster
        if (this.bossesInChaseMode.has(monsterId)) {
            this.bossesInChaseMode.delete(monsterId);
            console.log(`Removed boss ${monsterId} from chase mode tracking`);
        }
        
        // Clean up target tracking for this monster
        if (this.bossTargets.has(monsterId)) {
            this.bossTargets.delete(monsterId);
        }
        
        // Play distance-based monster death sound
        this.playMonsterDeathSound(monsterContainer);
        
        // Play void chest destroyed sound if this is a VoidChest (distance-based)
        if (monsterType === 'VoidChest') {
            this.playVoidChestDestroyedSound(monsterContainer);
        }
        
        // Special handling for boss phase 1 (pre-transform effect)
        if (monsterType && this.isBossPhase1(monsterType)) {
            // Don't play boss effects if the game is over (player died, world cleanup, etc.)
            if (this.isGameOver()) {
                console.log(`*** BOSS PHASE 1 REMOVED (ID: ${monsterId}) - Game over, skipping transform effects ***`);
                // Just clean up normally without effects
            } else {
                console.log(`*** BOSS PHASE 1 DEFEATED (ID: ${monsterId})! Starting pre-transform sequence... ***`);
                
                // Check if pre-transform is already active to prevent duplicates
                if (this.bossPreTransformActive) {
                    console.log("Pre-transform already active, ignoring duplicate boss death event");
                    return;
                }
                
                // Set tracking variables to monitor phase transition
                this.bossPhase1Killed = true;
                this.timeOfBossPhase1Death = Date.now();
                this.bossMonsterId = monsterId;
                this.bossPosition = { x: monsterContainer.x, y: monsterContainer.y };
                this.bossPreTransformActive = true;
                console.log(`Boss position stored: (${this.bossPosition.x}, ${this.bossPosition.y})`);
                
                // Create pre-transform VFX with the boss sprite and delay phase 2 spawning
                this.createBossPreTransformEffect(monsterContainer);
                
                // Don't remove the monster container yet - the pre-transform effect will handle cleanup
                return; // Early return to prevent normal monster removal
            }
        }
        
        // Log final boss defeat
        if (monsterType && this.isBossPhase2(monsterType)) {
            console.log(`*** FINAL BOSS DEFEATED (ID: ${monsterId})! GAME COMPLETE! ***`);
        }
        
        // Clean up shiny effects if present
        const particles = monsterContainer.getData('shinyParticles');
        if (particles) {
            particles.destroy();
        }
        
        const glowSprite = monsterContainer.getData('shinyGlow');
        if (glowSprite) {
            glowSprite.destroy();
        }
        
        const glowTween = monsterContainer.getData('shinyGlowTween');
        if (glowTween) {
            glowTween.stop();
            glowTween.destroy();
        }

        // Destroy the container and remove from map
        monsterContainer.destroy();
        this.monsters.delete(monsterId);
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
    
    // Update method to be called from scene's update method
    update(time: number, delta: number) {
        // Handle boss after image effects during chase mode
        this.updateBossAfterImages();
    }
    
    // Add method to clean up event listeners
    unregisterListeners() {
        console.log("Unregistering event listeners for MonsterManager");
        
        // Remove monster event listeners
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);
        this.gameEvents.off(GameEvents.MONSTER_UPDATED);
        this.gameEvents.off(GameEvents.MONSTER_DELETED);
    }
    
    shutdown() {
        this.unregisterListeners();
        this.clearCreationQueue(); // Clear any pending monster creations
        
        // Clean up all hovering tweens
        this.hoveringTweens.forEach((tween, monsterId) => {
            tween.stop();
            tween.destroy();
        });
        this.hoveringTweens.clear();
        
        // Clean up all existing monsters
        this.monsters.forEach(container => container.destroy());
        this.monsters.clear();
        
        // Clean up boss after images and chase mode tracking
        this.bossAfterImages.forEach(afterImage => {
            if (afterImage.active) {
                afterImage.destroy();
            }
        });
        this.bossAfterImages.length = 0; // Clear array
        this.bossesInChaseMode.clear();
        this.bossTargets.clear(); // Clear boss target tracking
        
        // Reset boss transition state
        this.bossPhase1Killed = false;
        this.bossPreTransformActive = false;
        
        console.log("MonsterManager shutdown complete");
    }
    
    // Add a method to check for boss AI state changes
    private checkBossAiStateChange(oldMonster: Monsters, newMonster: Monsters) {
        // Only check boss monsters
        const monsterTypeName = this.getMonsterTypeName(newMonster.bestiaryId);
        if (!this.isBoss(monsterTypeName)) {
            return;
        }

        // Get the AI state tags
        const oldStateTag = oldMonster.aiState.tag;
        const newStateTag = newMonster.aiState.tag;
        
        // Only log AI states when they actually change
        if (oldStateTag !== newStateTag) {
            console.log(`*** Boss ${newMonster.monsterId} (${monsterTypeName}) AI state changed: ${oldStateTag} -> ${newStateTag} ***`);
        }
        
        // Always check current state (not just changes) for chase mode tracking
        if (newStateTag === 'BossEnderChase') {
            if (!this.bossesInChaseMode.has(newMonster.monsterId)) {
                this.bossesInChaseMode.add(newMonster.monsterId);
                console.log(`Boss ${newMonster.monsterId} entered chase mode - after images activated`);
            }
        } else {
            if (this.bossesInChaseMode.has(newMonster.monsterId)) {
                this.bossesInChaseMode.delete(newMonster.monsterId);
                console.log(`Boss ${newMonster.monsterId} left chase mode - after images deactivated`);
            }
        }
        
        // Only play sounds/effects on actual state changes
        if (oldStateTag === newStateTag) {
            return;
        }

        // Get the boss container for visual effects
        const bossContainer = this.monsters.get(newMonster.monsterId);
        const bossSprite = bossContainer?.list.find(child => child instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;

        // Play appropriate sound and visual effects based on the new state
        switch (newStateTag) {
            case 'BossEnderChase':
                this.soundManager.playBossChaseSound();
                break;
            case 'BossEnderDance':
                this.soundManager.playBossDanceSound();
                break;
            case 'BossEnderVanish':
                this.soundManager.playBossVanishSound();
                // Play fadeout animation for vanish
                if (bossContainer && bossSprite) {
                    this.createBossVanishEffect(bossContainer, bossSprite);
                }
                break;
            case 'BossEnderTeleport':
                this.soundManager.playBossTeleportSound();
                // Play teleport entry VFX
                if (bossContainer && bossSprite) {
                    this.createBossTeleportEffect(bossContainer, bossSprite);
                }
                break;
            case 'BossEnderTransform':
                // Detect boss type from the monster data
                const transformBossType = this.getMonsterTypeName(newMonster.bestiaryId);
                this.soundManager.playBossTransformSound(transformBossType);
                break;
            case 'BossAgnaFlamethrower':
                // Play Agna flamethrower sound
                console.log(`*** Agna boss ${newMonster.monsterId} entered flamethrower mode! ***`);
                this.soundManager.playSound('agna_burned', 0.8);
                break;
            case 'BossAgnaMagicCircle':
                // Play Agna magic circle sound
                console.log(`*** Agna boss ${newMonster.monsterId} entered magic circle mode! ***`);
                this.soundManager.playSound('agna_closing_in', 0.8);
                break;
            default:
                // No sound for other states (BossIdle, Default, Stationary)
                break;
        }
    }

    // Add a method to check for boss target changes
    private checkBossTargetChange(oldMonster: Monsters, newMonster: Monsters) {
        // Only check Phase 2 boss monsters
        const monsterTypeName = this.getMonsterTypeName(newMonster.bestiaryId);
        if (!this.isBossPhase2(monsterTypeName)) {
            return;
        }

        // Get the current and previous target player IDs
        const oldTargetId = oldMonster.targetPlayerId;
        const newTargetId = newMonster.targetPlayerId;
        
        // Only process if the target actually changed
        if (oldTargetId !== newTargetId) {
            console.log(`*** Boss ${newMonster.monsterId} switched target from player ${oldTargetId} to player ${newTargetId} ***`);
            
            // Play boss roar sound quietly when target changes
            if (this.soundManager) {
                this.soundManager.playSound('boss_roar', 0.6); // Medium volume for target change
            }
            
            // Update our tracking
            this.bossTargets.set(newMonster.monsterId, newTargetId);
        }
    }

    // Handles when a monster is created
    handleMonsterCreated(ctx: EventContext, monster: Monsters) {
        const monsterTypeName = this.getMonsterTypeName(monster.bestiaryId);
        
        // Only log creation for bosses, special monsters, or when debugging
        if (this.isBoss(monsterTypeName) || monsterTypeName === "VoidChest") {
            //console.log(`Monster created: ${monster.monsterId}, type: ${monsterTypeName}`);
        }
        
        // Special handling for boss monsters - create immediately (no queue)
        if (this.isBoss(monsterTypeName)) {
            console.log(`BOSS SPAWNED: ${monsterTypeName}`);
            console.log(`- Monster ID: ${monster.monsterId}`);
            console.log(`- HP: ${monster.hp}/${monster.maxHp}`);
            console.log(`- Asset key: ${MONSTER_ASSET_KEYS[monsterTypeName]}`);
            console.log(`- Texture exists: ${this.scene.textures.exists(MONSTER_ASSET_KEYS[monsterTypeName])}`);
            console.log(`- Position: (${monster.spawnPosition.x}, ${monster.spawnPosition.y})`);
            
            // Play boss spawn sound for first form (both Ender and Agna Phase 1)
            if (this.isBossPhase1(monsterTypeName)) {
                const bossName = this.isEnderBoss(monsterTypeName) ? "ENDER" : "AGNA";
                console.log(`*** ${bossName} PHASE 1 SPAWNED! Playing voice cue... ***`);
                this.soundManager.playBossSpawnSound(monsterTypeName);
            }
            
            // If this is phase 2, it means phase 1 was defeated
            if (this.isBossPhase2(monsterTypeName)) {
                const bossName = this.isEnderBoss(monsterTypeName) ? "ENDER" : "AGNA";
                console.log(`*** ${bossName} PHASE 2 HAS BEGUN! ***`);
                
                // Play transformation sound sequence
                this.soundManager.playBossTransformSound(monsterTypeName);
                
                // Reset phase 1 tracking variables since phase 2 has spawned
                if (this.bossPhase1Killed) {
                    const transitionTime = Date.now() - this.timeOfBossPhase1Death;
                    console.log(`Phase transition took ${transitionTime}ms from phase 1 death to phase 2 spawn`);
                    this.bossPhase1Killed = false;
                    this.bossPreTransformActive = false; // Reset pre-transform flag for Phase 2
                }
                
                // Play the dark transformation effect
                this.createBossTransformationEffect(monster.spawnPosition.x, monster.spawnPosition.y);
            }
            
            // Create boss monsters immediately (bypassing queue)
            this.createOrUpdateMonster(monster);
            
            // Additional check after creation
            const bossContainer = this.monsters.get(monster.monsterId);
            if (bossContainer) {
                console.log(`Boss container after creation: visible=${bossContainer.visible}, alpha=${bossContainer.alpha}`);
            } else {
                console.error(`Failed to find boss container after creation!`);
            }
        } else if (monsterTypeName === "EnderClaw") {
            // Special handling for EnderClaw - play spawn sound and create immediately
            console.log(`EnderClaw spawned: ${monster.monsterId}`);
            
            // Play boss_appear sound at reduced volume
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('boss_appear', 0.4); // Quieter volume as requested
            }
            
            // Create EnderClaw immediately (bypassing queue)
            this.createOrUpdateMonster(monster);
        } else {
            // For regular monsters, add to creation queue for smooth spawning
            this.addToCreationQueue(monster);
        }
    }
    
    // Add monster to creation queue
    private addToCreationQueue(monster: Monsters) {
        this.creationQueue.push(monster);
        // Only log queue size if it's getting large (potential performance issue)
        if (this.creationQueue.length > 5) {
            console.log(`Monster creation queue getting large: ${this.creationQueue.length} monsters queued`);
        }
        
        // Start processing queue if not already processing
        if (!this.isProcessingQueue) {
            this.startQueueProcessing();
        }
    }
    
    // Start processing the creation queue
    private startQueueProcessing() {
        if (this.isProcessingQueue) return;
        
        this.isProcessingQueue = true;
        // Reduce logging frequency for performance
        if (this.creationQueue.length > 3) {
            console.log(`Started monster creation queue processing (${this.creationQueue.length} monsters)`);
        }
        this.processCreationQueue();
    }
    
    // Process monsters from creation queue (spread across frames)
    private processCreationQueue() {
        if (this.creationQueue.length === 0) {
            this.isProcessingQueue = false;
            // Only log completion if we processed a significant number
            return;
        }
        
        // Create up to maxMonstersPerFrame monsters this frame
        const monstersToCreate = Math.min(this.maxMonstersPerFrame, this.creationQueue.length);
        
        for (let i = 0; i < monstersToCreate; i++) {
            const monster = this.creationQueue.shift();
            if (monster) {
                this.createOrUpdateMonster(monster);
            }
        }
        
        // Continue processing on next frame if there are more monsters
        if (this.creationQueue.length > 0) {
            this.scene.time.delayedCall(16, () => { // ~60fps delay
                this.processCreationQueue();
            });
        } else {
            this.isProcessingQueue = false;
            //console.log("Monster creation queue processing complete");
        }
    }
    
    // Clear the creation queue (called during cleanup)
    private clearCreationQueue() {
        this.creationQueue.length = 0;
        this.isProcessingQueue = false;
        //console.log("Monster creation queue cleared");
    }
    
    // Helper to get monster type name from bestiary ID
    private getMonsterTypeName(bestiaryId: any): string {
        // Check if bestiaryId is an object with a tag property (from autobindings)
        if (bestiaryId && typeof bestiaryId === 'object' && 'tag' in bestiaryId) {
            // Only log unknown types or bosses for debugging
            if (bestiaryId.tag.includes("Boss") || bestiaryId.tag === "Unknown") {
                console.log(`Getting monster type from tag: ${bestiaryId.tag}`);
            }
            return bestiaryId.tag;
        }
        
        // Fall back to numeric mapping for backward compatibility
        switch(bestiaryId) {
            case 0: return "Rat";
            case 1: return "Slime";
            case 2: return "Orc";
            case 3: return "BossEnderPhase1";
            case 4: return "BossEnderPhase2";
            case 5: return "VoidChest";
            case 6: return "Imp";
            case 7: return "Zombie";
            case 8: return "EnderClaw";
            case 9: return "Bat";
            default: 
                console.warn(`Unknown monster type: ${bestiaryId}`);
                return "Unknown";
        }
    }
    
    // Helper method to create a visual effect when boss transforms from phase 1 to phase 2
    private createBossTransformationEffect(x: number, y: number) {
        // Create an explosion effect at the boss's position
        console.log(`Creating boss transformation effect at (${x}, ${y})`);
        
        // Create a light flash
        const flash = this.scene.add.circle(x, y, 150, 0xff0000, 0.7);
        flash.setDepth(10); // Above everything
        
        // Animate the flash - expand and fade out
        this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            radius: 300,
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                flash.destroy();
            }
        });
        
        // Add particle explosion
        const particles = this.scene.add.particles(x, y, 'white_pixel', {
            speed: { min: 100, max: 300 },
            angle: { min: 0, max: 360 },
            scale: { start: 2, end: 0 },
            blendMode: 'ADD',
            lifespan: 1000,
            quantity: 1,
            frequency: 20,
            emitting: false,
            tint: 0xff0000 // Set the red tint directly in the configuration
        });
        
        particles.setDepth(9); // Just below the flash
        
        // Emit a burst of particles
        particles.explode(100, x, y);
        
        // Destroy the emitter after animation completes
        this.scene.time.delayedCall(1200, () => {
            particles.destroy();
        });
        
        // Add text announcing phase 2
        const text = this.scene.add.text(x, y - 100, 'BOSS PHASE 2 INCOMING!', {
            fontSize: '32px',
            color: '#ff0000',
            stroke: '#000000',
            strokeThickness: 4,
            fontStyle: 'bold'
        }).setOrigin(0.5);
        text.setDepth(10);
        
        // Animate the text
        this.scene.tweens.add({
            targets: text,
            y: y - 200,
            alpha: 0,
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                text.destroy();
            }
        });
    }
    
    // Create pre-transform effect for boss phase 1 to phase 2 transition
    private createBossPreTransformEffect(bossContainer: Phaser.GameObjects.Container) {
        console.log(`Creating boss pre-transform effect at (${bossContainer.x}, ${bossContainer.y})`);
        
        // Get the boss sprite from the container
        const bossSprite = bossContainer.list.find(child => child instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;
        if (!bossSprite) {
            console.error("No boss sprite found in container for pre-transform effect");
            return;
        }
        
        // Detect boss type from container data
        const bossType = bossContainer.getData('monsterType');
        console.log(`Pre-transform effect for boss type: ${bossType}`);
        
        // Play the pre-transform voice line with boss type
        this.soundManager.playBossPreTransformSound(bossType);
        
        // Create a copy of the boss sprite for the pre-transform effect
        const transformingSprite = this.scene.add.sprite(bossContainer.x, bossContainer.y, bossSprite.texture.key);
        transformingSprite.setScale(bossSprite.scaleX, bossSprite.scaleY);
        transformingSprite.setRotation(bossSprite.rotation);
        transformingSprite.setDepth(bossContainer.depth + 1); // Above the original boss
        
        // Start the pre-transform visual effect - growing purple tint and scale
        const scaleTween = this.scene.tweens.add({
            targets: transformingSprite,
            scaleX: bossSprite.scaleX * 1.2,
            scaleY: bossSprite.scaleY * 1.2,
            duration: 1500,
            ease: 'Power2.easeOut'
        });
        
        // Purple tint effect - gradually increase purple tint
        let purpleTintStrength = 0;
        const purpleTintTween = this.scene.tweens.add({
            targets: { tint: 0 },
            tint: 1,
            duration: 1500,
            ease: 'Power2.easeIn',
            onUpdate: (tween) => {
                if (transformingSprite && transformingSprite.active) {
                    const progress = tween.progress;
                    purpleTintStrength = progress;
                    // Blend from normal color to purple
                    const r = Math.floor(255 * (1 - progress * 0.7)); // Reduce red
                    const g = Math.floor(255 * (1 - progress * 0.8)); // Reduce green more
                    const b = Math.floor(255 * (1 - progress * 0.3)); // Keep more blue
                    const tintColor = (r << 16) | (g << 8) | b;
                    transformingSprite.setTint(tintColor);
                }
            }
        });
        
        // Add pulsing energy effect
        const energyPulse = this.scene.add.circle(bossContainer.x, bossContainer.y, 50, 0x8800ff, 0.3);
        energyPulse.setDepth(bossContainer.depth);
        
        const pulseTween = this.scene.tweens.add({
            targets: energyPulse,
            radius: { from: 50, to: 120 },
            alpha: { from: 0.3, to: 0.1 },
            duration: 1500,
            ease: 'Power2.easeOut',
            yoyo: true,
            repeat: 1
        });
        
        // After 1.5 seconds, clean up pre-transform effects
        this.scene.time.delayedCall(1500, () => {
            console.log("Pre-transform complete, cleaning up pre-transform effects...");
            
            // Stop all tweens first to prevent callbacks on destroyed objects
            if (scaleTween) {
                scaleTween.stop();
            }
            if (purpleTintTween) {
                purpleTintTween.stop();
            }
            if (pulseTween) {
                pulseTween.stop();
            }
            
            // Clean up the pre-transform sprites
            transformingSprite.destroy();
            energyPulse.destroy();
            
            // Now remove the original boss container (server should have already handled the monster deletion)
            const monsterId = this.bossMonsterId;
            if (this.monsters.has(monsterId)) {
                const originalContainer = this.monsters.get(monsterId);
                if (originalContainer) {
                    originalContainer.destroy();
                }
                this.monsters.delete(monsterId);
                console.log(`Cleaned up original boss container for monster ${monsterId}`);
            }
            
            // Reset the pre-transform flag
            this.bossPreTransformActive = false;
        });
    }
    
    private updateHealthBar(healthBar: Phaser.GameObjects.Rectangle, currentHp: number, maxHp: number) {
        const healthPercent = currentHp / maxHp;
        healthBar.fillColor = this.getHealthBarColor(healthPercent);
        
        // Update width and position for left-aligned health bar
        const newWidth = MONSTER_HEALTH_BAR_WIDTH * healthPercent;
        healthBar.width = newWidth;
        
        // Set origin to left-center and position at left edge of background
        healthBar.setOrigin(0, 0.5);
        healthBar.x = -MONSTER_HEALTH_BAR_WIDTH / 2;
    }
    
    // Create fadeout visual effect when boss vanishes
    private createBossVanishEffect(bossContainer: Phaser.GameObjects.Container, bossSprite: Phaser.GameObjects.Sprite) {
        console.log("Playing boss vanish fadeout effect");
        
        // Create a dark smoke/mist effect
        const particles = this.scene.add.particles(bossContainer.x, bossContainer.y, 'shadow', {
            speed: { min: 20, max: 60 },
            scale: { start: 0.3, end: 1.2 },
            alpha: { start: 0.8, end: 0 },
            blendMode: 'MULTIPLY',
            lifespan: 1500,
            gravityY: -30, // Float upward like smoke
            tint: 0x220022, // Dark purple tint
            emitting: false
        });
        
        particles.setDepth(bossContainer.depth + 1); // Above the boss
        
        // Emit smoke particles as boss fades
        particles.explode(25, bossContainer.x, bossContainer.y);
        
        // Fade out the entire boss container
        this.scene.tweens.add({
            targets: bossContainer,
            alpha: 0,
            duration: 1000,
            ease: 'Power2.easeIn',
            onComplete: () => {
                console.log("Boss vanish fadeout complete");
            }
        });
        
        // Add a subtle flash before fading
        const flash = this.scene.add.circle(bossContainer.x, bossContainer.y, bossSprite.width / 2, 0x9900ff, 0.5);
        flash.setDepth(bossContainer.depth + 2);
        
        this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2,
            duration: 800,
            ease: 'Power2.easeOut',
            onComplete: () => {
                flash.destroy();
            }
        });
        
        // Clean up particles after effect
        this.scene.time.delayedCall(2000, () => {
            particles.destroy();
        });
    }
    
    // Create teleport entry visual effect when boss appears
    private createBossTeleportEffect(bossContainer: Phaser.GameObjects.Container, bossSprite: Phaser.GameObjects.Sprite) {
        console.log("Playing boss teleport entry effect");
        
        // Start with boss invisible and fade in
        bossContainer.setAlpha(0);
        
        // Wait a small moment to let the boss position update, then create effects at the NEW position
        this.scene.time.delayedCall(50, () => {
            // Get the boss's current (new) position after teleportation
            const newX = bossContainer.x;
            const newY = bossContainer.y;
            
            console.log(`Creating teleport effect at new position: (${newX}, ${newY})`);
            
            // Create dramatic entry flash at the NEW position
            const flash = this.scene.add.circle(newX, newY, bossSprite.width, 0x9900ff, 0.5);
            flash.setDepth(bossContainer.depth + 2);
            flash.setScale(0.1);
            
            // Expand and fade the flash
            this.scene.tweens.add({
                targets: flash,
                scale: 3,
                alpha: 0,
                duration: 600,
                ease: 'Power2.easeOut',
                onComplete: () => {
                    flash.destroy();
                }
            });
            
            // Create energy particles spiraling inward at the NEW position
            const particles = this.scene.add.particles(newX, newY, 'white_pixel', {
                speed: { min: 100, max: 200 },
                scale: { start: 1, end: 0 },
                alpha: { start: 0.7, end: 0 },
                blendMode: 'ADD',
                lifespan: 800,
                tint: 0x9900ff, // Purple energy to match vanish effect
                emitting: false,
                emitCallback: (particle: Phaser.GameObjects.Particles.Particle) => {
                    // Create spiral effect by setting initial velocity in a circle
                    const angle = Math.random() * Math.PI * 2;
                    const radius = 150; // Start particles in a circle around the boss
                    const speed = Phaser.Math.Between(100, 200);
                    
                    // Position particle at radius distance from NEW position
                    particle.x = newX + Math.cos(angle) * radius;
                    particle.y = newY + Math.sin(angle) * radius;
                    
                    // Set velocity toward the center (opposite direction)
                    particle.velocityX = -Math.cos(angle) * speed;
                    particle.velocityY = -Math.sin(angle) * speed;
                }
            });
            
            particles.setDepth(bossContainer.depth + 1);
            
            // Emit energy particles in a burst at the NEW position
            particles.explode(40, newX, newY);
            
            // Clean up particles after effect
            this.scene.time.delayedCall(1200, () => {
                particles.destroy();
            });
        });
        
        // Boss appears with scaling effect
        this.scene.tweens.add({
            targets: bossContainer,
            alpha: 1,
            scaleX: { from: 0.5, to: 1 },
            scaleY: { from: 0.5, to: 1 },
            duration: 400,
            ease: 'Back.easeOut',
            delay: 200, // Slight delay to let flash start first
            onComplete: () => {
                console.log("Boss teleport entry complete");
            }
        });
        
        // Add screen shake for dramatic effect
        this.scene.cameras.main.shake(300, 0.01);
    }

    // Add a method to play distance-based monster death sound
    private playMonsterDeathSound(container: Phaser.GameObjects.Container) {
        // Get local player position from the scene
        const gameScene = this.scene as any;
        const localPlayerPosition = gameScene.getLocalPlayerPosition?.();
        
        if (!localPlayerPosition) {
            return; // No local player or position available
        }
        
        // Get sound manager
        const soundManager = (window as any).soundManager;
        if (!soundManager) {
            return;
        }
        
        // Play distance-based monster death sound
        const monsterPosition = { x: container.x, y: container.y };
        const maxDistance = 500; // Monster death sounds travel further
        soundManager.playDistanceBasedSound('monster_death', localPlayerPosition, monsterPosition, maxDistance, 1.0);
        
        //console.log(`Playing monster death sound at position (${container.x}, ${container.y})`);
    }

    // Add a method to play distance-based attack soft sound when monster takes damage
    private playMonsterDamageSound(container: Phaser.GameObjects.Container) {
        // Get local player position from the scene
        const gameScene = this.scene as any;
        const localPlayerPosition = gameScene.getLocalPlayerPosition?.();
        
        if (!localPlayerPosition) {
            return; // No local player or position available
        }
        
        // Get sound manager
        const soundManager = (window as any).soundManager;
        if (!soundManager) {
            return;
        }
        
        // Play distance-based attack soft sound
        const monsterPosition = { x: container.x, y: container.y };
        const maxDistance = 400; // Attack sounds travel further
        soundManager.playDistanceBasedSound('attack_soft', localPlayerPosition, monsterPosition, maxDistance, 0.4);
        
        //console.log(`Playing monster damage sound at position (${container.x}, ${container.y})`);
    }

    // Add a method to play distance-based void chest destroyed sound
    private playVoidChestDestroyedSound(container: Phaser.GameObjects.Container) {
        // Get local player position from the scene
        const gameScene = this.scene as any;
        const localPlayerPosition = gameScene.getLocalPlayerPosition?.();
        
        if (!localPlayerPosition) {
            return; // No local player or position available
        }
        
        // Get sound manager
        const soundManager = (window as any).soundManager;
        if (!soundManager) {
            return;
        }
        
        // Play distance-based void chest destroyed sound
        const voidChestPosition = { x: container.x, y: container.y };
        const maxDistance = 900; // Void chest destroyed sounds travel far but not infinite
        soundManager.playDistanceBasedSound('void_chest_destroyed', localPlayerPosition, voidChestPosition, maxDistance, 0.9);
        
        console.log(`Playing void chest destroyed sound at position (${container.x}, ${container.y}), distance from player: ${Math.sqrt(Math.pow(voidChestPosition.x - localPlayerPosition.x, 2) + Math.pow(voidChestPosition.y - localPlayerPosition.y, 2)).toFixed(1)}`);
    }

    // Update boss after image effects during chase mode
    private updateBossAfterImages() {
        // Increment frame counter
        this.afterImageFrameCounter++;
        
        // Check if we should spawn after images this frame
        if (this.afterImageFrameCounter >= this.afterImageSpawnRate) {
            this.afterImageFrameCounter = 0;
            
            // Create after images for all bosses in chase mode
            this.bossesInChaseMode.forEach(bossId => {
                const bossContainer = this.monsters.get(bossId);
                if (bossContainer) {
                    this.createBossAfterImage(bossContainer);
                } else {
                    console.warn(`Boss container not found for ID ${bossId}`);
                }
            });
        }
        
        // Clean up old after images (remove any that have been destroyed)
        this.bossAfterImages = this.bossAfterImages.filter(afterImage => afterImage.active);
    }

    // Create an after image effect for a boss during chase mode
    private createBossAfterImage(bossContainer: Phaser.GameObjects.Container) {
        // Get the boss sprite from the container
        const bossSprite = bossContainer.list.find(child => child instanceof Phaser.GameObjects.Sprite) as Phaser.GameObjects.Sprite;
        if (!bossSprite) {
            console.warn(`No boss sprite found in container for after image`);
            return;
        }
        
        // Create a copy of the boss sprite at the current position
        const afterImage = this.scene.add.sprite(bossContainer.x, bossContainer.y, bossSprite.texture.key);
        
        // Set the after image properties for void effect
        afterImage.setAlpha(0.5); // Semi-transparent
        afterImage.setTint(0x4400ff); // Dark purple/void coloring
        // Use a larger depth offset to ensure after images always stay behind the boss
        afterImage.setDepth(bossContainer.depth - 256); // Larger offset to stay behind boss
        afterImage.setScale(bossSprite.scaleX, bossSprite.scaleY); // Match boss scale
        afterImage.setRotation(bossSprite.rotation); // Match boss rotation
        afterImage.setVisible(true); // Ensure it's visible
        
        // Add to tracking array
        this.bossAfterImages.push(afterImage);
        
        // Animate the after image to fade out quickly
        this.scene.tweens.add({
            targets: afterImage,
            alpha: 0,
            scaleX: afterImage.scaleX * 0.8, // Slightly shrink as it fades
            scaleY: afterImage.scaleY * 0.8,
            duration: 600, // Fade out over 600ms
            ease: 'Power2.easeOut',
            onComplete: () => {
                // Remove from tracking array and destroy
                const index = this.bossAfterImages.indexOf(afterImage);
                if (index > -1) {
                    this.bossAfterImages.splice(index, 1);
                }
                afterImage.destroy();
            }
        });
        
        // Add a slight blur/glow effect by creating a second darker copy underneath
        const glowImage = this.scene.add.sprite(bossContainer.x, bossContainer.y, bossSprite.texture.key);
        glowImage.setAlpha(0.2);
        glowImage.setTint(0x220044); // Darker purple for glow
        glowImage.setDepth(afterImage.depth - 1); // Just behind the main after image
        glowImage.setScale(bossSprite.scaleX * 1.1, bossSprite.scaleY * 1.1); // Slightly larger for glow effect
        glowImage.setRotation(bossSprite.rotation);
        
        // Fade out the glow image as well
        this.scene.tweens.add({
            targets: glowImage,
            alpha: 0,
            scaleX: glowImage.scaleX * 0.9,
            scaleY: glowImage.scaleY * 0.9,
            duration: 800, // Fade out slightly slower than main after image
            ease: 'Power2.easeOut',
            onComplete: () => {
                glowImage.destroy();
            }
        });
    }

    // Add a method to create hovering animation for flying monsters like Bats
    private createHoveringAnimation(monsterId: number, sprite: Phaser.GameObjects.Sprite) {
        // Create a subtle hovering animation that moves the sprite up and down
        const hoveringTween = this.scene.tweens.add({
            targets: sprite,
            y: sprite.y - 10, // Move up by 8 pixels from original position
            duration: 600,  // 1.2 seconds for smooth floating
            ease: 'Sine.easeInOut',
            yoyo: true,     // Return to original position
            repeat: -1,     // Repeat infinitely
            delay: Math.random() * 1000, // Random delay to stagger multiple bats
        });
        
        // Store the tween so we can clean it up later
        this.hoveringTweens.set(monsterId, hoveringTween);
        
        console.log(`Created hovering animation for Bat monster ID: ${monsterId}`);
    }
} 