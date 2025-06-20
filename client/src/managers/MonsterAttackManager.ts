import * as Phaser from 'phaser';
import { ActiveMonsterAttack, MonsterAttackType, EventContext } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Define a type for our monster attack graphic data with prediction capabilities
interface MonsterAttackGraphicData {
    sprite: Phaser.GameObjects.Sprite;
    radius: number;
    alpha: number;
    // Add prediction-related properties
    lastUpdateTime: number;
    predictedPosition: Phaser.Math.Vector2;
    serverPosition: Phaser.Math.Vector2;
    direction: Phaser.Math.Vector2;
    speed: number;
    attackType: string;
    parameterF: number; // Direction angle for rotation
    ticksElapsed: number;
    // Add spin angle for fast visual rotation (separate from orbital movement)
    spinAngle: number; // For EnderScythe fast spinning effect
}

// Constants for prediction behavior
const PREDICTION_CORRECTION_THRESHOLD = 64; // Distance squared before we snap to server position
const DELTA_TIME = 1/60; // Assume 60fps for client prediction (should match server tick rate closely)

// Constants for monster attack graphics
const MONSTER_ATTACK_ALPHA = 0.8; // Visibility for monster attacks
const ENDER_SCYTHE_SPAWN_ALPHA = 0.7; // High alpha for warning phase
const ENDER_SCYTHE_ALPHA = 1.0; // Full visibility for damaging phase

// Constants for EnderScythe visual effects
const ENDER_SCYTHE_SPIN_SPEED = 360.0; // Degrees per second for sprite spinning (much faster than orbital movement)

export class MonsterAttackManager {
    private scene: Phaser.Scene;
    private attackGraphics: Map<bigint, MonsterAttackGraphicData> = new Map();
    private spacetimeClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private gameTime: number = 0;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.gameEvents = (window as any).gameEvents;
        
        console.log("MonsterAttackManager initialized");
    }

    public initializeMonsterAttacks(ctx: EventContext) {
        if (!this.spacetimeClient?.sdkConnection?.db) {
            console.error("Cannot initialize monster attacks: database connection not available");
            return;
        }

        console.log("MonsterAttackManager initializing monster attacks");

        // Register monster attack listeners
        this.registerMonsterAttackListeners(); 

        // Force immediate update for all active monster attacks
        for (const attack of ctx.db?.activeMonsterAttacks.iter()) {
            this.createOrUpdateMonsterAttackGraphic(ctx, attack);
        }
    }

    public registerMonsterAttackListeners() {
        // Subscribe to game events for monster attacks instead of directly to DB
        this.gameEvents.on(GameEvents.MONSTER_ATTACK_CREATED, this.handleMonsterAttackInsert, this);
        this.gameEvents.on(GameEvents.MONSTER_ATTACK_UPDATED, this.handleMonsterAttackUpdate, this);
        this.gameEvents.on(GameEvents.MONSTER_ATTACK_DELETED, this.handleMonsterAttackDelete, this);
    }

    public unregisterMonsterAttackListeners() {
        // Remove event listeners
        this.gameEvents.off(GameEvents.MONSTER_ATTACK_CREATED, this.handleMonsterAttackInsert, this);
        this.gameEvents.off(GameEvents.MONSTER_ATTACK_UPDATED, this.handleMonsterAttackUpdate, this);
        this.gameEvents.off(GameEvents.MONSTER_ATTACK_DELETED, this.handleMonsterAttackDelete, this);
    }

    private handleMonsterAttackInsert(ctx: EventContext, attack: ActiveMonsterAttack) {
        this.createOrUpdateMonsterAttackGraphic(ctx, attack);
    }

    private handleMonsterAttackUpdate(ctx: EventContext, _oldAttack: ActiveMonsterAttack, newAttack: ActiveMonsterAttack) {
        this.createOrUpdateMonsterAttackGraphic(ctx, newAttack);
    }

    private handleMonsterAttackDelete(_ctx: EventContext, attack: ActiveMonsterAttack) {
        const attackData = this.attackGraphics.get(attack.activeMonsterAttackId);
        if (attackData) {
            attackData.sprite.destroy();
            this.attackGraphics.delete(attack.activeMonsterAttackId);
        }
    }

    private createOrUpdateMonsterAttackGraphic(ctx: EventContext, attack: ActiveMonsterAttack) {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Get attack type name
        const attackType = attack.monsterAttackType.tag;
        
        // Get or create monster attack graphic data
        let attackGraphicData = this.attackGraphics.get(attack.activeMonsterAttackId);
        if (!attackGraphicData) {
            // Create sprite using appropriate asset for the attack type
            const sprite = this.createMonsterAttackSprite(attackType, attack.position.x, attack.position.y);
            if (!sprite) {
                console.error(`Failed to create sprite for monster attack type: ${attackType}`);
                return;
            }
            
            // Setup direction vector
            const direction = new Phaser.Math.Vector2(attack.direction.x, attack.direction.y);
            
            // Determine alpha based on attack type
            let alpha = MONSTER_ATTACK_ALPHA;
            if (attackType === 'EnderScytheSpawn') {
                alpha = ENDER_SCYTHE_SPAWN_ALPHA;
            } else if (attackType === 'EnderScythe') {
                alpha = ENDER_SCYTHE_ALPHA;
            } else if (attackType === 'AgnaFlamethrowerJet') {
                alpha = 1.0; // Start at full alpha for flamethrower jets
            }
            
            // Store the monster attack graphic data with prediction values
            attackGraphicData = {
                sprite,
                radius: attack.radius,
                alpha: alpha,
                lastUpdateTime: this.gameTime,
                predictedPosition: new Phaser.Math.Vector2(attack.position.x, attack.position.y),
                serverPosition: new Phaser.Math.Vector2(attack.position.x, attack.position.y),
                direction: direction,
                speed: attack.speed,
                attackType,
                parameterF: attack.parameterF, // Store direction angle for rotation
                ticksElapsed: attack.ticksElapsed,
                spinAngle: 0
            };
            
            // Play sound effects for specific attack types when they spawn
            if (attackType === 'ChaosBall') {
                // Play chaos_bolt_fire sound quietly when ChaosBall spawns
                const soundManager = (window as any).soundManager;
                if (soundManager) {
                    soundManager.playSound('chaos_bolt_fire', 0.4); // Quiet volume
                }
            }
            
            this.attackGraphics.set(attack.activeMonsterAttackId, attackGraphicData);
        } else {
            // Update the server position and time for existing monster attack graphic
            attackGraphicData.serverPosition.set(attack.position.x, attack.position.y);
            attackGraphicData.lastUpdateTime = this.gameTime;
            attackGraphicData.ticksElapsed = attack.ticksElapsed;
            attackGraphicData.attackType = attackType;
            attackGraphicData.radius = attack.radius;
            attackGraphicData.parameterF = attack.parameterF;
            
            // Update direction
            attackGraphicData.direction.set(attack.direction.x, attack.direction.y);
            
            // Check if predicted position is too far from server position
            const dx = attackGraphicData.predictedPosition.x - attack.position.x;
            const dy = attackGraphicData.predictedPosition.y - attack.position.y;
            const distSquared = dx * dx + dy * dy;

            var threshold = (DELTA_TIME * attackGraphicData.speed) * (DELTA_TIME * attackGraphicData.speed);
            
            if (distSquared > threshold) {
                // Correction needed - reset prediction to match server
                attackGraphicData.predictedPosition.set(attack.position.x, attack.position.y);
            }
        }

        // Update the graphic right away
        this.updateMonsterAttackGraphic(attackGraphicData);
    }

    private createMonsterAttackSprite(attackType: string, x: number, y: number): Phaser.GameObjects.Sprite | null {
        // Determine sprite key based on attack type
        let spriteKey = 'monster_attack_firebolt'; // Default for most attacks
        if (attackType === 'EnderScytheSpawn' || attackType === 'EnderScythe') {
            spriteKey = 'void_scythe';
        } else if (attackType === 'EnderBolt') {
            spriteKey = 'void_bolt';
        } else if (attackType === 'ChaosBall') {
            spriteKey = 'void_ball';
        } else if (attackType === 'VoidZone') {
            spriteKey = 'void_zone';
        } else if (attackType === 'AgnaFlamethrowerJet') {
            spriteKey = 'agna_flamethrower';
        }
        
        // Verify the texture exists
        if (!this.scene.textures.exists(spriteKey)) {
            console.error(`Texture ${spriteKey} does not exist for monster attack type: ${attackType}`);
            return null;
        }
        
        // Create the sprite with a higher depth to show in front of most game objects
        const sprite = this.scene.add.sprite(x, y, spriteKey);
        sprite.setDepth(1.5); // Set depth higher than circles but below UI
        
        // Set alpha and scale based on attack type
        let alpha = MONSTER_ATTACK_ALPHA;
        if (attackType === 'EnderScytheSpawn') {
            alpha = ENDER_SCYTHE_SPAWN_ALPHA;
        } else if (attackType === 'EnderScythe') {
            alpha = ENDER_SCYTHE_ALPHA;
        } else if (attackType === 'AgnaFlamethrowerJet') {
            alpha = 1.0; // Start at full alpha
            sprite.setScale(0.25); // Start at quarter scale
        }
        sprite.setAlpha(alpha);
        
        return sprite;
    }

    private updateMonsterAttackGraphic(attackGraphicData: MonsterAttackGraphicData) {
        const sprite = attackGraphicData.sprite;
        
        // Position sprite at predicted position
        sprite.x = attackGraphicData.predictedPosition.x;
        sprite.y = attackGraphicData.predictedPosition.y;
        
        // Handle rotation based on attack type
        switch (attackGraphicData.attackType) {
            case 'ImpBolt':
                // ImpBolt should be rotated to face its direction using parameterF
                sprite.setRotation(attackGraphicData.parameterF);
                break;
                
            case 'EnderScytheSpawn':
                // EnderScytheSpawn is stationary - no rotation
                sprite.setRotation(0);
                break;
                
            case 'EnderBolt':
                // EnderBolt doesn't rotate - keep it facing forward
                sprite.setRotation(0);
                break;
                
            case 'EnderScythe':
                // EnderScythe uses fast spinning effect (spinAngle) instead of orbital angle (parameterF)
                sprite.setRotation(attackGraphicData.spinAngle);
                break;
                
            case 'ChaosBall':
                // ChaosBall rotates in direction of motion
                if (attackGraphicData.direction.length() > 0) {
                    sprite.setRotation(Math.atan2(attackGraphicData.direction.y, attackGraphicData.direction.x));
                }
                break;
                
            case 'VoidZone':
                // VoidZone is stationary and doesn't rotate
                sprite.setRotation(0);
                break;
                
            case 'AgnaFlamethrowerJet':
                // AgnaFlamethrowerJet rotates in direction of motion
                if (attackGraphicData.direction.length() > 0) {
                    sprite.setRotation(Math.atan2(attackGraphicData.direction.y, attackGraphicData.direction.x));
                }
                
                // Handle growing scale and fading alpha over lifetime
                // Assuming 3-second lifespan (3000ms) based on server config
                const lifespanMs = 3000;
                const elapsedMs = attackGraphicData.ticksElapsed * 50; // Assume 50ms per tick (20 TPS)
                const linearProgress = Math.min(elapsedMs / lifespanMs, 1.0); // Clamp to 1.0
                
                // Use asymptotic easing: fast growth initially, slow approach to final value
                // Using exponential ease-out: 1 - (1-t)^2 for smooth asymptotic curve
                const easedProgress = 1 - Math.pow(1 - linearProgress, 2);
                
                // Scale grows from 0.25 to 1.0 over lifetime with asymptotic easing
                const scale = 0.25 + (0.75 * easedProgress);
                sprite.setScale(scale);
                
                // Alpha fades from 1.0 to 0.5 over lifetime
                const alpha = 1.0 - (0.5 * linearProgress);
                sprite.setAlpha(alpha);
                break;
                
            default:
                // Default rotation based on direction
                if (attackGraphicData.direction.length() > 0) {
                    sprite.setRotation(Math.atan2(attackGraphicData.direction.y, attackGraphicData.direction.x));
                }
        }
    }
    
    public update(time?: number, delta?: number) {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Update game time
        if (time) {
            this.gameTime = time;
        }

        var deltaTime = DELTA_TIME;
        if (delta) {
            deltaTime = delta / 1000;
        }

        // Update position of all monster attack graphics based on prediction
        for (const [attackId, attackGraphicData] of this.attackGraphics.entries()) {
            const attack = this.spacetimeClient.sdkConnection.db.activeMonsterAttacks.activeMonsterAttackId.find(attackId);
            if (!attack) continue;
            
            // Update fast spinning effect for EnderScythe attacks
            if (attackGraphicData.attackType === 'EnderScythe') {
                // Increment spin angle for fast visual rotation (independent of orbital movement)
                const spinSpeedRadians = ENDER_SCYTHE_SPIN_SPEED * Math.PI / 180.0; // Convert to radians
                attackGraphicData.spinAngle += spinSpeedRadians * deltaTime;
                
                // Keep angle in 0-2π range to prevent overflow
                if (attackGraphicData.spinAngle > 2 * Math.PI) {
                    attackGraphicData.spinAngle -= 2 * Math.PI;
                }
            }
            
            // Handle movement prediction based on attack type
            if (attackGraphicData.attackType === 'EnderScytheSpawn') {
                // EnderScytheSpawn attacks are stationary - no movement prediction
                // Just update the graphic without moving
                this.updateMonsterAttackGraphic(attackGraphicData);
            } else if (attackGraphicData.attackType === 'EnderScythe') {
                // EnderScythe attacks have orbital movement around boss - rely on server updates
                // Don't do linear prediction, just update rotation
                this.updateMonsterAttackGraphic(attackGraphicData);
            } else if (attackGraphicData.direction.length() > 0) {
                // Normal projectile with directional movement
                const moveDistance = attackGraphicData.speed * deltaTime;
                attackGraphicData.predictedPosition.x += attackGraphicData.direction.x * moveDistance;
                attackGraphicData.predictedPosition.y += attackGraphicData.direction.y * moveDistance;
                
                // Update the graphic at predicted position
                this.updateMonsterAttackGraphic(attackGraphicData);
            }
        }
    }

    public shutdown() {
        // Clean up all graphics
        for (const attackGraphicData of this.attackGraphics.values()) {
            attackGraphicData.sprite.destroy();
        }
        this.attackGraphics.clear();
        
        // Remove event listeners
        this.unregisterMonsterAttackListeners();
    }
} 