import * as Phaser from 'phaser';
import { ActiveAttack, ActiveBossAttack, AttackType, EventContext } from '../autobindings';
import { AttackData } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Define a type for our attack graphic data with prediction capabilities
interface AttackGraphicData {
    graphic: Phaser.GameObjects.Graphics;
    sprite: Phaser.GameObjects.Sprite | null;
    radius: number;
    baseRadius: number; // Store the base radius from attack data for scaling calculation
    alpha: number;
    // Add prediction-related properties
    lastUpdateTime: number;
    predictedPosition: Phaser.Math.Vector2;
    serverPosition: Phaser.Math.Vector2;
    direction: Phaser.Math.Vector2;
    speed: number;
    isShield: boolean;
    playerId: number | null;
    parameterU: number;
    ticksElapsed: number;
    attackType: string;
}

// Constants for prediction behavior
const PREDICTION_CORRECTION_THRESHOLD = 64; // Distance squared before we snap to server position
const DELTA_TIME = 1/60; // Assume 60fps for client prediction (should match server tick rate closely)

// Constants for attack graphics
const ATTACK_CIRCLE_COLOR = 0xcccccc; // Light gray
const ATTACK_CIRCLE_ALPHA = 0.3; // More transparent
const ATTACK_CIRCLE_BORDER_ALPHA = 0.4; // Slightly more visible border
const ATTACK_CIRCLE_BORDER_WIDTH = 1;
const DEBUG_CIRCLES_ENABLED = false; // Debug flag, set to false by default

export class AttackManager {
    private scene: Phaser.Scene;
    private attackGraphics: Map<number, AttackGraphicData> = new Map();
    private localPlayerId: number | null = null;
    private localPlayerRadius: number = 0;
    private spacetimeClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private gameTime: number = 0;
    private debugCirclesEnabled: boolean = DEBUG_CIRCLES_ENABLED;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.gameEvents = (window as any).gameEvents;
        
        console.log("AttackManager initialized");
    }

    public initializeAttacks(ctx: EventContext) {
        if (!this.spacetimeClient?.sdkConnection?.db) {
            console.error("Cannot initialize attacks: database connection not available");
            return;
        }

        console.log("AttackManager initalizing attacks");

        // Register attack listeners
        this.registerAttackListeners(); 

        // Force immediate update for all attacks with known entities
        for (const attack of ctx.db?.activeAttacks.iter()) {
            this.createOrUpdateAttackGraphic(ctx, attack);
        }

        // Force immediate update for all boss attacks with known entities
        for (const bossAttack of ctx.db?.activeBossAttacks.iter()) {
            this.createOrUpdateBossAttackGraphic(ctx, bossAttack);
        }
    }

    public registerAttackListeners() {
        // Subscribe to game events for attacks instead of directly to DB
        this.gameEvents.on(GameEvents.ATTACK_CREATED, this.handleAttackInsert, this);
        this.gameEvents.on(GameEvents.ATTACK_UPDATED, this.handleAttackUpdate, this);
        this.gameEvents.on(GameEvents.ATTACK_DELETED, this.handleAttackDelete, this);
        
        // Subscribe to boss attack events
        this.gameEvents.on(GameEvents.BOSS_ATTACK_CREATED, this.handleBossAttackInsert, this);
        this.gameEvents.on(GameEvents.BOSS_ATTACK_UPDATED, this.handleBossAttackUpdate, this);
        this.gameEvents.on(GameEvents.BOSS_ATTACK_DELETED, this.handleBossAttackDelete, this);

        // Subscribe to attack cleanup events
        this.gameEvents.on(GameEvents.ACTIVE_ATTACK_CLEANUP_CREATED, this.handleAttackCleanupCreated, this);
        this.gameEvents.on(GameEvents.ACTIVE_ATTACK_CLEANUP_DELETED, this.handleAttackCleanupDeleted, this);
        this.gameEvents.on(GameEvents.ACTIVE_BOSS_ATTACK_CLEANUP_CREATED, this.handleBossAttackCleanupCreated, this);
        this.gameEvents.on(GameEvents.ACTIVE_BOSS_ATTACK_CLEANUP_DELETED, this.handleBossAttackCleanupDeleted, this);

        // Subscribe to attack data events
        this.gameEvents.on(GameEvents.ATTACK_DATA_CREATED, this.handleAttackDataCreated, this);
        this.gameEvents.on(GameEvents.ATTACK_DATA_UPDATED, this.handleAttackDataUpdated, this);
    }

    public unregisterAttackListeners() {
        // Remove event listeners
        this.gameEvents.off(GameEvents.ATTACK_CREATED, this.handleAttackInsert, this);
        this.gameEvents.off(GameEvents.ATTACK_UPDATED, this.handleAttackUpdate, this);
        this.gameEvents.off(GameEvents.ATTACK_DELETED, this.handleAttackDelete, this);
        
        // Remove boss attack event listeners
        this.gameEvents.off(GameEvents.BOSS_ATTACK_CREATED, this.handleBossAttackInsert, this);
        this.gameEvents.off(GameEvents.BOSS_ATTACK_UPDATED, this.handleBossAttackUpdate, this);
        this.gameEvents.off(GameEvents.BOSS_ATTACK_DELETED, this.handleBossAttackDelete, this);
    }

    public setLocalPlayerId(playerId: number) {
        this.localPlayerId = playerId;
        console.log(`AttackManager: Local player ID set to ${playerId}`);
    }

    public setLocalPlayerRadius(radius: number)
    {
        this.localPlayerRadius = radius;
    }

    private handleAttackInsert(ctx: EventContext, attack: ActiveAttack) {
        this.createOrUpdateAttackGraphic(ctx, attack);
    }

    private handleAttackUpdate(ctx: EventContext, _oldAttack: ActiveAttack, newAttack: ActiveAttack) {
        this.createOrUpdateAttackGraphic(ctx, newAttack);
    }

    private handleAttackDelete(_ctx: EventContext, attack: ActiveAttack) {
        const attackData = this.attackGraphics.get(attack.activeAttackId);
        if (attackData) {
            attackData.graphic.destroy();
            if (attackData.sprite) {
                attackData.sprite.destroy();
            }
            this.attackGraphics.delete(attack.activeAttackId);
        }
    }

    private handleBossAttackInsert(ctx: EventContext, attack: ActiveBossAttack) {
        console.log(`Boss attack created: ${attack.activeBossAttackId} of type ${attack.attackType.tag}`);
        this.createOrUpdateBossAttackGraphic(ctx, attack);
    }

    private handleBossAttackUpdate(ctx: EventContext, _oldAttack: ActiveBossAttack, newAttack: ActiveBossAttack) {
        console.log(`Boss attack updated: ${newAttack.activeBossAttackId}`);
        this.createOrUpdateBossAttackGraphic(ctx, newAttack);
    }

    private handleBossAttackDelete(_ctx: EventContext, attack: ActiveBossAttack) {
        console.log(`Boss attack deleted: ${attack.activeBossAttackId}`);
        const attackData = this.attackGraphics.get(attack.activeBossAttackId);
        if (attackData) {
            attackData.graphic.destroy();
            if (attackData.sprite) {
                attackData.sprite.destroy();
            }
            this.attackGraphics.delete(attack.activeBossAttackId);
        }
    }

    private createOrUpdateAttackGraphic(ctx: EventContext, attack: ActiveAttack) {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Find the entity for this attack
        const entity = ctx.db?.entity.entityId.find(attack.entityId);
        if (!entity) {
            console.error(`Entity ${attack.entityId} not found for attack ${attack.activeAttackId}`);
            return;
        }

        // Find attack data for this attack type
        const attackData = this.findAttackDataByType(ctx, attack.attackType);
        if (!attackData) {
            console.error(`Attack data not found for type ${attack.attackType.tag}`);
            return;
        }

        // Calculate alpha based on ownership
        const isLocalPlayerAttack = attack.playerId === this.localPlayerId;
        const alpha = isLocalPlayerAttack ? 0.7 : 0.4;
        
        // Determine if this is a shield attack
        const isShield = attack.attackType.tag === "Shield";
        const attackType = attack.attackType.tag;

        // Get or create attack graphic data
        let attackGraphicData = this.attackGraphics.get(attack.activeAttackId);
        if (!attackGraphicData) {
            // Create a new graphics object (for the circle)
            const graphic = this.scene.add.graphics();
            // Set depth to be behind sprites
            graphic.setDepth(1.4);
            
            // Create sprite based on attack type
            const sprite = this.createAttackSprite(attackType, entity.position.x, entity.position.y);
            
            // Setup direction vector based on entity direction
            const direction = new Phaser.Math.Vector2(entity.direction.x, entity.direction.y);
            
            // Store the attack graphic data with prediction values
            attackGraphicData = {
                graphic,
                sprite,
                radius: attack.radius, // Use the actual radius from the active attack
                baseRadius: attackData.radius, // Store base radius from attack data for scaling
                alpha,
                lastUpdateTime: this.gameTime,
                predictedPosition: new Phaser.Math.Vector2(entity.position.x, entity.position.y),
                serverPosition: new Phaser.Math.Vector2(entity.position.x, entity.position.y),
                direction: direction,
                speed: attackData.speed,
                isShield,
                playerId: attack.playerId,
                parameterU: attack.parameterU,
                ticksElapsed: attack.ticksElapsed,
                attackType
            };
            
            this.attackGraphics.set(attack.activeAttackId, attackGraphicData);
        } else {
            // Update the server position and time for existing attack graphic
            attackGraphicData.serverPosition.set(entity.position.x, entity.position.y);
            attackGraphicData.lastUpdateTime = this.gameTime;
            attackGraphicData.ticksElapsed = attack.ticksElapsed;
            attackGraphicData.attackType = attackType;
            attackGraphicData.radius = attack.radius; // Update radius value
            
            // Check if predicted position is too far from server position
            const dx = attackGraphicData.predictedPosition.x - entity.position.x;
            const dy = attackGraphicData.predictedPosition.y - entity.position.y;
            const distSquared = dx * dx + dy * dy;

            var threshold = (DELTA_TIME * attackGraphicData.speed) * (DELTA_TIME * attackGraphicData.speed);
            
            if (distSquared > threshold) {
                // Correction needed - reset prediction to match server
                attackGraphicData.predictedPosition.set(entity.position.x, entity.position.y);
            }
        }

        // Update the graphic right away
        this.updateAttackGraphic(attackGraphicData);
    }

    private createAttackSprite(attackType: string, x: number, y: number): Phaser.GameObjects.Sprite | null {
        let spriteKey = '';
        
        switch (attackType) {
            case 'Sword':
                spriteKey = 'attack_sword';
                break;
            case 'Wand':
                spriteKey = 'attack_wand';
                break;
            case 'Knives':
                spriteKey = 'attack_knife';
                break;
            case 'Shield':
                spriteKey = 'attack_shield';
                break;
            case 'Football':
                spriteKey = 'attack_football';
                break;
            case 'Cards':
                spriteKey = 'attack_cards';
                break;
            case 'Dumbbell':
                spriteKey = 'attack_dumbbell';
                break;
            case 'Garlic':
                spriteKey = 'attack_garlic';
                break;
            case 'BossJorgeBolt':
                spriteKey = 'attack_boss_jorge';
                break;
            case 'BossBjornBolt':
                spriteKey = 'attack_boss_bjorn';
                break;
            case 'BossSimonBolt':
                spriteKey = 'attack_boss_simon';
                break;
            default:
                console.warn(`Unknown attack type: ${attackType}, using default sprite`);
                return null;
        }

        // Create the sprite and set its properties
        const sprite = this.scene.add.sprite(x, y, spriteKey);
        sprite.setDepth(1.5); // Set depth higher than circle but below UI
        sprite.setOrigin(0.5, 0.5); // Center the sprite's pivot point
        sprite.setAlpha(1); // Make sure sprite is fully visible
        
        // Set initial rotation and scale based on attack type
        if (attackType === 'Dumbbell') {
            sprite.setScale(1.5);
        } else if (attackType === 'BossJorgeBolt' || attackType === 'BossBjornBolt' || attackType === 'BossSimonBolt') {
            sprite.setScale(0.4); // Smaller scale for boss bolts
        } else if (attackType === 'Football') {
            sprite.setScale(0.6); // Slightly larger for the football
        } else if (attackType === 'Garlic') {
            sprite.setScale(0.1); // Small garlic AoE
        } else {
            sprite.setScale(1.0); // Normal scale for other attacks
        }
        
        return sprite;
    }

    private updateAttackGraphic(attackGraphicData: AttackGraphicData) {
        const { graphic, sprite, radius, alpha, predictedPosition, serverPosition, direction, speed, ticksElapsed } = attackGraphicData;

        // Clear previous graphics
        graphic.clear();

        // Draw the attack circle
        if (this.debugCirclesEnabled || attackGraphicData.attackType === 'Garlic') {
            graphic.lineStyle(1, 0xffffff, alpha * 0.4);
            graphic.strokeCircle(0, 0, radius);
            
            if (attackGraphicData.attackType === 'Garlic') {
                // Add pulsing effect for garlic
                const pulseScale = 1 + Math.sin(ticksElapsed * 0.2) * 0.2;
                graphic.scale = pulseScale;
                
                // Add particle effects for garlic
                this.createGarlicParticles(predictedPosition.x, predictedPosition.y);
            }
        }

        // Special handling for Dumbbell
        if (attackGraphicData.attackType === 'Dumbbell') {
            // Add shadow effect for dumbbell
            if (sprite) {
                const shadowAlpha = Math.max(0.1, 1 - (ticksElapsed * 0.1));
                graphic.fillStyle(0x000000, shadowAlpha);
                graphic.fillCircle(0, radius, radius * 0.5);
            }
        }

        // Update position with interpolation
        graphic.setPosition(predictedPosition.x, predictedPosition.y);
        if (sprite) {
            sprite.setPosition(predictedPosition.x, predictedPosition.y);

            // Handle rotations for different attack types
            if (attackGraphicData.attackType === 'BossSimonBolt') {
                // Simon's bolts use special spiral rotation handled in update()
                return;
            } else if (attackGraphicData.attackType === 'Dumbbell') {
                // Dumbbell maintains fixed horizontal orientation
                return;
            } else if (!attackGraphicData.isShield) {
                // For regular projectiles and boss attacks, rotate based on movement direction
                if (direction.length() > 0) {
                    const angle = Math.atan2(direction.y, direction.x);
                    sprite.setRotation(angle);
                }
            } else {
                // For shields, rotate based on orbital position around player
                const playerPos = this.getPlayerPosition(attackGraphicData.playerId || 0);
                if (playerPos) {
                    const dx = predictedPosition.x - playerPos.x;
                    const dy = predictedPosition.y - playerPos.y;
                    const angle = Math.atan2(dy, dx);
                    sprite.setRotation(angle);
                }
            }
        }
    }

    private createGarlicParticles(x: number, y: number) {
        if (!this.scene) return;

        // Get attack data to scale particles
        const attackGraphicData = Array.from(this.attackGraphics.values())
            .find(data => data.attackType === 'Garlic');
        
        if (!attackGraphicData) return;
        
        // Create particles less frequently based on radius
        if (Math.random() > 0.1 * (attackGraphicData.radius / attackGraphicData.baseRadius)) return;

        // Scale particle properties based on attack radius
        const radiusScale = attackGraphicData.radius / attackGraphicData.baseRadius;
        const baseScale = 0.3 * radiusScale;
        const speedScale = Math.min(radiusScale * 30, 100);

        // Create the emission zone
        const emitCircle = new Phaser.Geom.Circle(0, 0, attackGraphicData.radius * 0.8);
        
        const particles = this.scene.add.particles(x, y, 'white_pixel', {
            speed: { min: speedScale * 0.5, max: speedScale },
            angle: { min: 0, max: 360 },
            scale: { start: baseScale, end: 0 },
            lifespan: 800,
            tint: [0xccffcc, 0x99ff99, 0x66ff66], // Multiple green tints for variety
            blendMode: 'ADD',
            gravityY: -20 * radiusScale,
            quantity: Math.ceil(radiusScale), // More particles for larger radius
            rotate: { min: -180, max: 180 }, // Random rotation
            alpha: { start: 0.6, end: 0 },
            frequency: 50, // Emit every 50ms while active
            emitZone: { 
                type: 'random',
                source: emitCircle,
                quantity: Math.ceil(radiusScale),
                stepRate: 50
            }
        });

        // Auto-destroy after animation
        this.scene.time.delayedCall(800, () => {
            particles.destroy();
        });
    }

    private findAttackDataByType(ctx: EventContext, attackType: AttackType): AttackData | undefined {
        const attackDataItems = ctx.db?.attackData.iter();
        for (const data of attackDataItems) {
            if (data.attackType.tag === attackType.tag) {
                return data;
            }
        }
        return undefined;
    }
    
    // Get the player entity's position by playerId
    private getPlayerPosition(playerId: number): Phaser.Math.Vector2 | null {
        if (!this.spacetimeClient.sdkConnection) return null;
        
        // Find the player and their entity
        const player = this.spacetimeClient.sdkConnection.db.player.playerId.find(playerId);
        if (!player) return null;
        
        const entity = this.spacetimeClient.sdkConnection.db.entity.entityId.find(player.entityId);
        if (!entity) return null;
        
        return new Phaser.Math.Vector2(entity.position.x, entity.position.y);
    }
    
    public update(time?: number, delta?: number) {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Update game time
        if (time) {
            this.gameTime = time;
        }

        var deltaTime = DELTA_TIME;
        if (delta) 
        {
            deltaTime = delta / 1000;
        }

        // Update position of all attack graphics based on prediction
        for (const [attackId, attackGraphicData] of this.attackGraphics.entries()) {
            const attack = this.spacetimeClient.sdkConnection.db.activeAttacks.activeAttackId.find(attackId);
            if (!attack) continue;
            
            if (attackGraphicData.isShield) {
                // Special handling for shields - orbit around player
                const playerPos = this.getPlayerPosition(attackGraphicData.playerId || 0);
                if (playerPos) {
                        
                    var orbitDistance = (this.localPlayerRadius + attackGraphicData.radius) * 2;

                    //Get current angle
                    var dx = attackGraphicData.predictedPosition.x - playerPos.x;
                    var dy = attackGraphicData.predictedPosition.y - playerPos.y;
                    var curAngle = Math.atan2(dy, dx);

                    //Calculate new angle
                    var rotationSpeed = attackGraphicData.speed * deltaTime * Math.PI / 180.0 / 2;
                    var newAngle = curAngle + rotationSpeed;

                    //Calculate new position
                    var newX = playerPos.x + Math.cos(newAngle) * orbitDistance;
                    var newY = playerPos.y + Math.sin(newAngle) * orbitDistance;
                    
                    // Update predicted position
                    attackGraphicData.predictedPosition.set(
                        newX,
                        newY
                    );
                    
                    // Draw at predicted position
                    this.updateAttackGraphic(attackGraphicData);
                }
            } else if (attackGraphicData.attackType === 'BossBjornBolt' && attackGraphicData.parameterU === 1) {
                // Homing logic: update direction toward nearest player
                const playerPos = this.getPlayerPosition(this.localPlayerId || 0);
                if (playerPos) {
                    const dx = playerPos.x - attackGraphicData.predictedPosition.x;
                    const dy = playerPos.y - attackGraphicData.predictedPosition.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 0) {
                        // Smoothly interpolate direction for more natural movement
                        const targetDirX = dx / len;
                        const targetDirY = dy / len;
                        attackGraphicData.direction.x = Phaser.Math.Linear(attackGraphicData.direction.x, targetDirX, 0.1);
                        attackGraphicData.direction.y = Phaser.Math.Linear(attackGraphicData.direction.y, targetDirY, 0.1);
                        // Normalize after interpolation
                        const newLen = Math.sqrt(attackGraphicData.direction.x * attackGraphicData.direction.x + 
                                               attackGraphicData.direction.y * attackGraphicData.direction.y);
                        if (newLen > 0) {
                            attackGraphicData.direction.x /= newLen;
                            attackGraphicData.direction.y /= newLen;
                        }
                    }
                }
                const moveDistance = attackGraphicData.speed * deltaTime;
                attackGraphicData.predictedPosition.x += attackGraphicData.direction.x * moveDistance;
                attackGraphicData.predictedPosition.y += attackGraphicData.direction.y * moveDistance;
                this.updateAttackGraphic(attackGraphicData);
            } else if (attackGraphicData.attackType === 'BossSimonBolt') {
                // Special handling for Simon's attacks - they move in a spiral pattern
                const time = this.gameTime / 1000; // Convert to seconds
                const spiralRadius = 20 * (1 + time * 0.1); // Gradually increasing radius
                const spiralSpeed = 5; // Base rotation speed
                
                // Calculate spiral position
                const angle = time * spiralSpeed;
                const offsetX = Math.cos(angle) * spiralRadius;
                const offsetY = Math.sin(angle) * spiralRadius;
                
                // Apply spiral offset to base movement
                const moveDistance = attackGraphicData.speed * deltaTime;
                attackGraphicData.predictedPosition.x += attackGraphicData.direction.x * moveDistance + offsetX * deltaTime;
                attackGraphicData.predictedPosition.y += attackGraphicData.direction.y * moveDistance + offsetY * deltaTime;
                
                // Update sprite rotation to match spiral movement
                if (attackGraphicData.sprite) {
                    attackGraphicData.sprite.setRotation(angle);
                }
                
                this.updateAttackGraphic(attackGraphicData);
            } else {
                // Normal projectile with directional movement
                if (attackGraphicData.direction.length() > 0) {
                    const moveDistance = attackGraphicData.speed * deltaTime;
                    
                    // For boss attacks, ensure we keep the original direction
                    if (attackGraphicData.attackType.includes('Boss')) {
                        // Normalize direction to ensure consistent speed
                        const dir = attackGraphicData.direction.normalize();
                        attackGraphicData.predictedPosition.x += dir.x * moveDistance;
                        attackGraphicData.predictedPosition.y += dir.y * moveDistance;
                    } else {
                        // Normal attack movement
                        attackGraphicData.predictedPosition.x += attackGraphicData.direction.x * moveDistance;
                        attackGraphicData.predictedPosition.y += attackGraphicData.direction.y * moveDistance;
                    }
                    
                    // Draw at predicted position
                    this.updateAttackGraphic(attackGraphicData);
                }
            }
        }
    }

    public shutdown() 
    {
        // Clean up all graphics
        for (const attackGraphicData of this.attackGraphics.values()) {
            attackGraphicData.graphic.destroy();
            if (attackGraphicData.sprite) {
                attackGraphicData.sprite.destroy();
            }
        }
        this.attackGraphics.clear();
        
        // Remove event listeners
        this.unregisterAttackListeners();
    }

    // Add method to toggle debug circles
    public setDebugCirclesEnabled(enabled: boolean) {
        this.debugCirclesEnabled = enabled;
        console.log(`Attack debug circles ${enabled ? 'enabled' : 'disabled'}`);
        
        // Update all existing graphics
        for (const attackGraphicData of this.attackGraphics.values()) {
            this.updateAttackGraphic(attackGraphicData);
        }
    }

    private createOrUpdateBossAttackGraphic(ctx: EventContext, attack: ActiveBossAttack) {
        if (!this.spacetimeClient.sdkConnection) {
            console.error("Cannot create boss attack graphic: no connection");
            return;
        }
        
        // Find the entity for this attack
        const entity = ctx.db?.entity.entityId.find(attack.entityId);
        if (!entity) {
            console.error(`Entity ${attack.entityId} not found for boss attack ${attack.activeBossAttackId}`);
            return;
        }

        console.log(`Creating/updating boss attack graphic for ${attack.activeBossAttackId} at position (${entity.position.x}, ${entity.position.y})`);

        // Find attack data for this attack type
        const attackData = this.findAttackDataByType(ctx, attack.attackType);
        if (!attackData) {
            console.error(`Attack data not found for type ${attack.attackType.tag}`);
            return;
        }

        // Boss attacks are always enemy attacks
        const alpha = 0.4;
        
        // Get or create attack graphic data
        let attackGraphicData = this.attackGraphics.get(attack.activeBossAttackId);
        if (!attackGraphicData) {
            console.log(`Creating new boss attack graphic for ${attack.activeBossAttackId}`);
            // Create a new graphics object (for the circle)
            const graphic = this.scene.add.graphics();
            // Set depth to be behind sprites
            graphic.setDepth(1.4);
            
            // Create sprite based on attack type
            const sprite = this.createAttackSprite(attack.attackType.tag, entity.position.x, entity.position.y);
            if (!sprite) {
                console.error(`Failed to create sprite for boss attack type ${attack.attackType.tag}`);
            }
            
            // !Setup direction vector need to be based on player position
            const direction = new Phaser.Math.Vector2(entity.direction.x, entity.direction.y);
            
            // Store the attack graphic data with prediction values
            attackGraphicData = {
                graphic,
                sprite,
                radius: attack.radius,
                baseRadius: attackData.radius,
                alpha,
                lastUpdateTime: this.gameTime,
                predictedPosition: new Phaser.Math.Vector2(entity.position.x, entity.position.y),
                serverPosition: new Phaser.Math.Vector2(entity.position.x, entity.position.y),
                direction: direction,  // This now contains the correct direction from boss to player
                speed: attackData.speed,
                isShield: false, // Boss attacks don't use shields
                playerId: null, // Boss attacks don't have a player ID
                parameterU: attack.parameterU,
                ticksElapsed: attack.ticksElapsed,
                attackType: attack.attackType.tag
            };

            // Also set the sprite rotation to match the projectile direction
            if (sprite) {
                sprite.setRotation(Math.atan2(direction.y, direction.x));
            }
            
            this.attackGraphics.set(attack.activeBossAttackId, attackGraphicData);
            console.log(`Created new boss attack graphic data for ${attack.activeBossAttackId}`);
        } else {
            console.log(`Updating existing boss attack graphic for ${attack.activeBossAttackId}`);
            // Update the server position and time for existing attack graphic
            attackGraphicData.serverPosition.set(entity.position.x, entity.position.y);
            attackGraphicData.lastUpdateTime = this.gameTime;
            attackGraphicData.ticksElapsed = attack.ticksElapsed;
            attackGraphicData.attackType = attack.attackType.tag;
            attackGraphicData.radius = attack.radius;
            
            // Check if predicted position is too far from server position
            const dx = attackGraphicData.predictedPosition.x - entity.position.x;
            const dy = attackGraphicData.predictedPosition.y - entity.position.y;
            const distSquared = dx * dx + dy * dy;

            var threshold = (DELTA_TIME * attackGraphicData.speed) * (DELTA_TIME * attackGraphicData.speed);
            
            if (distSquared > threshold) {
                console.log(`Correcting boss attack position for ${attack.activeBossAttackId}`);
                // Correction needed - reset prediction to match server
                attackGraphicData.predictedPosition.set(entity.position.x, entity.position.y);
            }
        }

        // Update the graphic right away
        this.updateAttackGraphic(attackGraphicData);
    }

    // Add new event handlers
    private handleAttackCleanupCreated(ctx: EventContext, cleanup: any) {
        // Handle attack cleanup creation
        console.log("Attack cleanup created:", cleanup);
    }

    private handleAttackCleanupDeleted(ctx: EventContext, cleanup: any) {
        // Handle attack cleanup deletion
        console.log("Attack cleanup deleted:", cleanup);
    }

    private handleBossAttackCleanupCreated(ctx: EventContext, cleanup: any) {
        // Handle boss attack cleanup creation
        console.log("Boss attack cleanup created:", cleanup);
    }

    private handleBossAttackCleanupDeleted(ctx: EventContext, cleanup: any) {
        // Handle boss attack cleanup deletion
        console.log("Boss attack cleanup deleted:", cleanup);
    }

    private handleAttackDataCreated(ctx: EventContext, attackData: AttackData) {
        // Handle attack data creation
        console.log("Attack data created:", attackData);
    }

    private handleAttackDataUpdated(ctx: EventContext, oldData: AttackData, newData: AttackData) {
        // Handle attack data update
        console.log("Attack data updated:", oldData, newData);
    }
}