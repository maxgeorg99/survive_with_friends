import * as Phaser from 'phaser';
import { ActiveAttack, AttackType, EventContext } from '../autobindings';
import { AttackData } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Define a type for our attack graphic data with prediction capabilities
interface AttackGraphicData {
    graphic: Phaser.GameObjects.Graphics;
    radius: number;
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
}

// Constants for prediction behavior
const PREDICTION_CORRECTION_THRESHOLD = 64; // Distance squared before we snap to server position
const DELTA_TIME = 1/60; // Assume 60fps for client prediction (should match server tick rate closely)
const SHIELD_ORBIT_DISTANCE = 42; // Distance from player center for shield orbits

export class AttackManager {
    private scene: Phaser.Scene;
    private attackGraphics: Map<number, AttackGraphicData> = new Map();
    private localPlayerId: number | null = null;
    private spacetimeClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private gameTime: number = 0;

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

        // Calculate alpha based on ownership
        const isLocalPlayerAttack = attack.playerId === this.localPlayerId;
        const alpha = isLocalPlayerAttack ? 0.7 : 0.4;
        
        // Determine if this is a shield attack
        const isShield = attack.attackType.tag === "Shield";

        // Get or create attack graphic data
        let attackGraphicData = this.attackGraphics.get(attack.activeAttackId);
        if (!attackGraphicData) {
            // Create a new graphics object
            const graphic = this.scene.add.graphics();
            
            // Setup direction vector based on entity direction
            const direction = new Phaser.Math.Vector2(entity.direction.x, entity.direction.y);
            
            // Store the attack graphic data with prediction values
            attackGraphicData = {
                graphic,
                radius: attackData.radius,
                alpha,
                lastUpdateTime: this.gameTime,
                predictedPosition: new Phaser.Math.Vector2(entity.position.x, entity.position.y),
                serverPosition: new Phaser.Math.Vector2(entity.position.x, entity.position.y),
                direction: direction,
                speed: attackData.speed,
                isShield,
                playerId: attack.playerId,
                parameterU: attack.parameterU,
                ticksElapsed: attack.ticksElapsed
            };
            
            this.attackGraphics.set(attack.activeAttackId, attackGraphicData);
        } else {
            // Update the server position and time for existing attack graphic
            attackGraphicData.serverPosition.set(entity.position.x, entity.position.y);
            attackGraphicData.lastUpdateTime = this.gameTime;
            attackGraphicData.ticksElapsed = attack.ticksElapsed;
            
            // Check if predicted position is too far from server position
            const dx = attackGraphicData.predictedPosition.x - entity.position.x;
            const dy = attackGraphicData.predictedPosition.y - entity.position.y;
            const distSquared = dx * dx + dy * dy;

            var threshold = (DELTA_TIME * attackGraphicData.speed) * (DELTA_TIME * attackGraphicData.speed);
            
            if (distSquared > threshold) {
                // Correction needed - reset prediction to match server
                //console.log(`Attack ${attack.activeAttackId} correction needed - resetting prediction to server position. dx: ${dx}, dy: ${dy}, distSquared: ${distSquared}, threshold: ${threshold}`);
                attackGraphicData.predictedPosition.set(entity.position.x, entity.position.y);
            }
        }

        // Update the graphic right away
        this.updateAttackGraphic(attackGraphicData);
    }

    private updateAttackGraphic(attackGraphicData: AttackGraphicData) {
        // Clear previous drawing
        attackGraphicData.graphic.clear();

        // Draw the attack as a blue circle using stored values
        attackGraphicData.graphic.fillStyle(0x0088ff, attackGraphicData.alpha);
        attackGraphicData.graphic.fillCircle(
            attackGraphicData.predictedPosition.x, 
            attackGraphicData.predictedPosition.y, 
            attackGraphicData.radius
        );
        
        // Add a border for better visibility
        attackGraphicData.graphic.lineStyle(2, 0x0066cc, attackGraphicData.alpha + 0.2);
        attackGraphicData.graphic.strokeCircle(
            attackGraphicData.predictedPosition.x, 
            attackGraphicData.predictedPosition.y, 
            attackGraphicData.radius
        );
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
                    // Get all shields for this player to determine total count
                    let totalShields = 0;
                    let indexWithinShields = 0;
                    let shieldIndex = 0;
                    
                    for (const shieldAttack of this.spacetimeClient.sdkConnection.db.activeAttacks.iter()) {
                        if (shieldAttack.playerId === attackGraphicData.playerId && 
                            shieldAttack.attackType.tag === "Shield") {
                            totalShields++;
                            
                            // Keep track of this shield's position in the sequence
                            if (shieldAttack.activeAttackId === attackId) {
                                indexWithinShields = shieldIndex;
                            }
                            shieldIndex++;
                        }
                    }
                    
                    if (totalShields > 0) {
                        // Calculate orbit angle for shield - replicate server logic
                        // Parameter angle in radians 
                        const parameterAngle = attackGraphicData.parameterU * Math.PI / 180.0;
                        
                        // Get total elapsed ticks for smooth animation
                        const clientTicks = attackGraphicData.ticksElapsed + 
                                           (this.gameTime - attackGraphicData.lastUpdateTime) / 16.67; // Assuming ~60 FPS
                        
                        // Calculate rotation speed (matches server)
                        const rotationSpeed = 0.05;
                        const baseAngle = parameterAngle + (2 * Math.PI * attack.idWithinBurst / totalShields);
                        const shieldAngle = baseAngle + rotationSpeed * clientTicks;
                        
                        // Calculate new position 
                        const offsetX = Math.cos(shieldAngle) * SHIELD_ORBIT_DISTANCE;
                        const offsetY = Math.sin(shieldAngle) * SHIELD_ORBIT_DISTANCE;
                        
                        // Update predicted position
                        attackGraphicData.predictedPosition.set(
                            playerPos.x + offsetX,
                            playerPos.y + offsetY
                        );
                        
                        // Draw at predicted position
                        this.updateAttackGraphic(attackGraphicData);
                    }
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
        }
        this.attackGraphics.clear();
        
        // Remove event listeners
        this.unregisterAttackListeners();
    }
} 