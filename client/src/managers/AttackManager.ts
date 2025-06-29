import * as Phaser from 'phaser';
import { ActiveAttack, AttackType, EventContext } from '../autobindings';
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
    }

    public registerAttackListeners() {
        // Subscribe to game events for attacks instead of directly to DB
        this.gameEvents.on(GameEvents.ATTACK_CREATED, this.handleAttackInsert, this);
        this.gameEvents.on(GameEvents.ATTACK_UPDATED, this.handleAttackUpdate, this);
        this.gameEvents.on(GameEvents.ATTACK_DELETED, this.handleAttackDelete, this);
    }

    public unregisterAttackListeners() {
        // Remove event listeners
        this.gameEvents.off(GameEvents.ATTACK_CREATED, this.handleAttackInsert, this);
        this.gameEvents.off(GameEvents.ATTACK_UPDATED, this.handleAttackUpdate, this);
        this.gameEvents.off(GameEvents.ATTACK_DELETED, this.handleAttackDelete, this);
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
        // Play attack fire sound for local player attacks
        // Note: 'attack_fire' is frame-throttled in SoundManager to limit to 1 play per frame
        if (attack.playerId === this.localPlayerId) {
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                // Play special thunder sound for Thunder Horn attacks
                if (attack.attackType.tag === 'ThunderHorn') {
                    soundManager.playSound('thunder', 0.6);
                } else {
                    soundManager.playSound('attack_fire', 0.2); // Quiet sound as requested
                }
            }
        }
        
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

        // Calculate alpha based on ownership and PvP status
        const isLocalPlayerAttack = attack.playerId === this.localPlayerId;
        
        // Check if attacking player has PvP enabled
        const attackingPlayer = ctx.db?.player.playerId.find(attack.playerId);
        const attackerPvpEnabled = attackingPlayer?.pvp || false;
        
        // Make attacks more transparent if attacker doesn't have PvP enabled
        let alpha: number;
        if (isLocalPlayerAttack) {
            alpha = 1.0;
        } else {
            alpha = attackerPvpEnabled ? 1.0 : 0.4; // Other players: normal vs very transparent
        }
        
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
            
            // For Angel Staff, use player position instead of entity position
            let initialX = entity.position.x;
            let initialY = entity.position.y;
            if (attackType === 'AngelStaff') {
                const playerPosition = this.getPlayerPosition(attack.playerId);
                if (playerPosition) {
                    initialX = playerPosition.x;
                    initialY = playerPosition.y;
                }
            }
            
            // Create sprite based on attack type
            const sprite = this.createAttackSprite(attackType, initialX, initialY, attack.radius);
            
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
                predictedPosition: new Phaser.Math.Vector2(initialX, initialY),
                serverPosition: new Phaser.Math.Vector2(initialX, initialY),
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
            
            // For Angel Staff, the attack should follow the player position
            if (attackType === 'AngelStaff' && attackGraphicData.playerId) {
                const playerPosition = this.getPlayerPosition(attackGraphicData.playerId);
                if (playerPosition) {
                    attackGraphicData.serverPosition.set(playerPosition.x, playerPosition.y);
                    attackGraphicData.predictedPosition.set(playerPosition.x, playerPosition.y);
                }
            }
            
            // Check if predicted position is too far from server position (but skip for Angel Staff which should follow player)
            if (attackType !== 'AngelStaff') {
                const dx = attackGraphicData.predictedPosition.x - entity.position.x;
                const dy = attackGraphicData.predictedPosition.y - entity.position.y;
                const distSquared = dx * dx + dy * dy;

                var threshold = (DELTA_TIME * attackGraphicData.speed) * (DELTA_TIME * attackGraphicData.speed);
                
                if (distSquared > threshold) {
                    // Correction needed - reset prediction to match server
                    attackGraphicData.predictedPosition.set(entity.position.x, entity.position.y);
                }
            }
        }

        // Update the graphic right away
        this.updateAttackGraphic(attackGraphicData);
    }

    private createAttackSprite(attackType: string, x: number, y: number, radius: number = 50): Phaser.GameObjects.Sprite | null {
        // Create a sprite based on attack type
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
            case 'ThunderHorn':
                spriteKey = 'attack_horn';
                break;
            case 'AngelStaff':
                spriteKey = 'attack_staff';
                break;
            default:
                console.error(`Unknown attack type: ${attackType}`);
                return null;
        }
        
        // Create the sprite with a higher depth to show in front of the circle
        const sprite = this.scene.add.sprite(x, y, spriteKey);
        sprite.setDepth(1.5); // Set depth higher than circle but below UI
        
        // For Thunder Horn, set alpha to 0 for debugging but create special VFX
        if (attackType === 'ThunderHorn') {
            sprite.setAlpha(0); // Hidden for debugging as requested
            this.createThunderHornVFX(x, y, radius);
        }
        
        // For Angel Staff, set alpha to 0 and create holy pulse VFX
        if (attackType === 'AngelStaff') {
            sprite.setAlpha(0); // Hidden for debugging as requested
            this.createAngelStaffVFX(x, y, radius);
        }
        
        // The scale will be set in updateAttackGraphic based on radius comparison
        
        return sprite;
    }

    private createThunderHornVFX(x: number, y: number, radius: number): void {
        // Create lightning sprite VFX
        const lightningSprite = this.scene.add.sprite(x, y, 'attack_lightning');
        lightningSprite.setDepth(2.0); // Higher than normal attacks
        lightningSprite.setScale(1.5); // Make it bigger for impact
        
        // Create electrical blue circle
        const vfxGraphics = this.scene.add.graphics();
        vfxGraphics.setDepth(1.9); // Just below lightning sprite
        
        // Draw electrical blue circle using the actual attack radius
        const electricBlue = 0x00BFFF; // Deep sky blue color
        vfxGraphics.fillStyle(electricBlue, 0.7);
        vfxGraphics.fillCircle(x, y, radius); // Use actual attack radius
        
        // Add a brighter border
        vfxGraphics.lineStyle(3, 0x87CEEB, 0.9); // Sky blue border
        vfxGraphics.strokeCircle(x, y, radius); // Use actual attack radius
        
        // Fade out lightning sprite very quickly (null-safe)
        if (this.scene.tweens) {
            this.scene.tweens.add({
                targets: lightningSprite,
                alpha: 0,
                scale: 2.0, // Grow while fading
                duration: 150, // Very fast fade
                ease: 'Power2.easeOut',
                onComplete: () => {
                    if (lightningSprite && lightningSprite.scene) {
                        lightningSprite.destroy();
                    }
                }
            });
            
            // Fade out circle very quickly
            this.scene.tweens.add({
                targets: vfxGraphics,
                alpha: 0,
                duration: 200, // Slightly longer than lightning
                ease: 'Power2.easeOut',
                onComplete: () => {
                    if (vfxGraphics && vfxGraphics.scene) {
                        vfxGraphics.destroy();
                    }
                }
            });
        } else {
            // Fallback: destroy after timeout if tweens not available
            if (this.scene.time) {
                this.scene.time.delayedCall(150, () => {
                    if (lightningSprite && lightningSprite.scene) {
                        lightningSprite.destroy();
                    }
                });
                this.scene.time.delayedCall(200, () => {
                    if (vfxGraphics && vfxGraphics.scene) {
                        vfxGraphics.destroy();
                    }
                });
            }
        }
        
        console.log(`Thunder Horn VFX created at (${x}, ${y}) with radius ${radius}`);
    }

    private createAngelStaffVFX(x: number, y: number, radius: number): void {
        // Create holy pulse circle VFX with golden/white colors
        const vfxGraphics = this.scene.add.graphics();
        vfxGraphics.setPosition(x, y); // Position the graphics object at the target location
        vfxGraphics.setDepth(1.9); // Just below sprites
        
        // Create a holy golden-white circle
        const holyGold = 0xFFD700; // Gold color
        const holyWhite = 0xFFFFFF; // Pure white
        
        // Draw the main pulse circle with golden color (relative to graphics position)
        vfxGraphics.fillStyle(holyGold, 0.6);
        vfxGraphics.fillCircle(0, 0, radius * 0.8);
        
        // Add a bright white inner glow (smaller for better contrast)
        vfxGraphics.fillStyle(holyWhite, 0.4);
        vfxGraphics.fillCircle(0, 0, radius * 0.7);
        
        // Add a bright golden border
        vfxGraphics.lineStyle(4, holyGold, 0.9);
        vfxGraphics.strokeCircle(0, 0, radius* 0.8);
        
        // Add inner white border for extra glow (smaller for better contrast)
        vfxGraphics.lineStyle(2, holyWhite, 1.0);
        vfxGraphics.strokeCircle(0, 0, radius * 0.7);
        
        // Create pulsing animation - expand and fade (null-safe)
        if (this.scene.tweens) {
            this.scene.tweens.add({
                targets: vfxGraphics,
                scaleX: 1.25,
                scaleY: 1.25,
                alpha: 0,
                duration: 300, // Slightly longer than Thunder Horn for holy effect
                ease: 'Power2.easeOut',
                onComplete: () => {
                    if (vfxGraphics && vfxGraphics.scene) {
                        vfxGraphics.destroy();
                    }
                }
            });
        } else {
            // Fallback: destroy immediately if tweens not available
            this.scene.time.delayedCall(300, () => {
                if (vfxGraphics && vfxGraphics.scene) {
                    vfxGraphics.destroy();
                }
            });
        }
        
        // Add some sparkle particles for extra holy effect (null-safe)
        if (this.scene.add && this.scene.add.particles) {
            const particles = this.scene.add.particles(x, y, 'white_pixel', {
                speed: { min: 30, max: 80 },
                scale: { start: 0.8, end: 0 },
                blendMode: 'ADD',
                lifespan: 400,
                gravityY: -30, // Float upward like holy energy
                tint: [holyGold, holyWhite], // Mix of gold and white particles
                emitting: false
            });
            
            // Emit particles in a burst
            if (particles && particles.explode) {
                particles.explode(15, 0, 0); // Relative to particle system position
            }
            
            // Clean up particles (null-safe)
            if (this.scene.time) {
                this.scene.time.delayedCall(500, () => {
                    if (particles && particles.scene) {
                        particles.destroy();
                    }
                });
            }
        }
        
        console.log(`Angel Staff holy pulse VFX created at player position (${x}, ${y}) with radius ${radius}`);
    }

    private updateAttackGraphic(attackGraphicData: AttackGraphicData) {
        // Clear previous drawing
        attackGraphicData.graphic.clear();

        // Only draw the circle if debug mode is enabled
        if (this.debugCirclesEnabled) {
            // Draw the attack as a light gray transparent circle
            attackGraphicData.graphic.fillStyle(ATTACK_CIRCLE_COLOR, ATTACK_CIRCLE_ALPHA);
            attackGraphicData.graphic.fillCircle(
                attackGraphicData.predictedPosition.x, 
                attackGraphicData.predictedPosition.y, 
                attackGraphicData.radius
            );
            
            // Add a thin border for better visibility
            attackGraphicData.graphic.lineStyle(ATTACK_CIRCLE_BORDER_WIDTH, ATTACK_CIRCLE_COLOR, ATTACK_CIRCLE_BORDER_ALPHA);
            attackGraphicData.graphic.strokeCircle(
                attackGraphicData.predictedPosition.x, 
                attackGraphicData.predictedPosition.y, 
                attackGraphicData.radius
            );
        }

        // Update the sprite position and rotation - always visible regardless of debug mode
        if (attackGraphicData.sprite) {
            const sprite = attackGraphicData.sprite;
            
            // Position sprite at predicted position
            sprite.x = attackGraphicData.predictedPosition.x;
            sprite.y = attackGraphicData.predictedPosition.y;
            
            // Apply alpha transparency based on PvP status (except Thunder Horn and Angel Staff which stay at 0)
            if (attackGraphicData.attackType !== 'ThunderHorn' && attackGraphicData.attackType !== 'AngelStaff') {
                sprite.setAlpha(attackGraphicData.alpha);
            }
            
            // Calculate scale based on radius compared to base radius
            // Only apply if baseRadius is not zero to avoid division by zero
            if (attackGraphicData.baseRadius > 0) {
                const scale = attackGraphicData.radius / attackGraphicData.baseRadius;
                sprite.setScale(scale);
            }
            
            // Handle different attack types
            switch (attackGraphicData.attackType) {
                case 'Sword':
                    // Mirror horizontally if moving left
                    if (attackGraphicData.direction.x < 0) {
                        sprite.setFlipX(true);
                    } else {
                        sprite.setFlipX(false);
                    }
                    sprite.setRotation(0); // Reset rotation
                    break;
                    
                case 'Wand':
                case 'Knives':
                    // Rotate to point in the direction of motion
                    if (attackGraphicData.direction.length() > 0) {
                        sprite.setRotation(Math.atan2(attackGraphicData.direction.y, attackGraphicData.direction.x));
                    }
                    sprite.setFlipX(false); // Reset flip
                    break;
                    
                case 'Shield':
                    // Shield just draws normally
                    sprite.setRotation(0); // Reset rotation
                    sprite.setFlipX(false); // Reset flip
                    break;
                    
                case 'ThunderHorn':
                    // Thunder Horn stays at position, no rotation needed
                    sprite.setRotation(0);
                    sprite.setFlipX(false);
                    break;
                    
                case 'AngelStaff':
                    // Angel Staff stays at position, no rotation needed
                    sprite.setRotation(0);
                    sprite.setFlipX(false);
                    break;
                    
                default:
                    // Default handling
                    sprite.setRotation(0);
                    sprite.setFlipX(false);
            }
        }
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
        
        return new Phaser.Math.Vector2(player.position.x, player.position.y);
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
            } else if (attackGraphicData.attackType === 'ThunderHorn') {
                // Thunder Horn stays stationary - no movement needed
                // Just update the graphic in case other properties changed
                this.updateAttackGraphic(attackGraphicData);
            } else if (attackGraphicData.attackType === 'AngelStaff') {
                // Angel Staff follows the player position exactly
                const playerPos = this.getPlayerPosition(attackGraphicData.playerId || 0);
                if (playerPos) {
                    // Update predicted position to match player position
                    attackGraphicData.predictedPosition.set(playerPos.x, playerPos.y);
                    
                    // Draw at player position
                    this.updateAttackGraphic(attackGraphicData);
                }
            } else {
                // Normal projectile with directional movement
                if (attackGraphicData.direction.length() > 0) {
                    const moveDistance = attackGraphicData.speed * deltaTime;
                    attackGraphicData.predictedPosition.x += attackGraphicData.direction.x * moveDistance;
                    attackGraphicData.predictedPosition.y += attackGraphicData.direction.y * moveDistance;
                    
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
} 