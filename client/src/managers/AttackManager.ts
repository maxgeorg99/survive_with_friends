import * as Phaser from 'phaser';
import { ActiveAttack, AttackType, EventContext } from '../autobindings';
import { AttackData } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Define a type for our attack graphic data
interface AttackGraphicData {
    graphic: Phaser.GameObjects.Graphics;
    radius: number;
    alpha: number;
}

export class AttackManager {
    private scene: Phaser.Scene;
    private attackGraphics: Map<number, AttackGraphicData> = new Map();
    private localPlayerId: number | null = null;
    private spacetimeClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;

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
        console.log(`Attack inserted: ${attack.activeAttackId}, type: ${attack.attackType}`);
        this.createOrUpdateAttackGraphic(ctx, attack);
    }

    private handleAttackUpdate(ctx: EventContext, _oldAttack: ActiveAttack, newAttack: ActiveAttack) {
        console.log(`Attack updated: ${newAttack.activeAttackId}`);
        this.createOrUpdateAttackGraphic(ctx, newAttack);
    }

    private handleAttackDelete(_ctx: EventContext, attack: ActiveAttack) {
        console.log(`Attack deleted: ${attack.activeAttackId}`);
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
            console.error(`Attack data not found for type ${attack.attackType}`);
            return;
        }

        // Calculate alpha based on ownership
        const isLocalPlayerAttack = attack.playerId === this.localPlayerId;
        const alpha = isLocalPlayerAttack ? 0.7 : 0.4;

        // Get or create attack graphic data
        let attackGraphicData = this.attackGraphics.get(attack.activeAttackId);
        if (!attackGraphicData) {
            // Create a new graphics object
            const graphic = this.scene.add.graphics();
            
            // Store the attack graphic data with pre-calculated values
            attackGraphicData = {
                graphic,
                radius: attackData.radius,
                alpha
            };
            
            this.attackGraphics.set(attack.activeAttackId, attackGraphicData);
        }

        // Clear previous drawing
        attackGraphicData.graphic.clear();

        // Draw the attack as a blue circle using stored values
        attackGraphicData.graphic.fillStyle(0x0088ff, attackGraphicData.alpha);
        attackGraphicData.graphic.fillCircle(
            entity.position.x, 
            entity.position.y, 
            attackGraphicData.radius
        );
        
        // Add a border for better visibility
        attackGraphicData.graphic.lineStyle(2, 0x0066cc, attackGraphicData.alpha + 0.2);
        attackGraphicData.graphic.strokeCircle(
            entity.position.x, 
            entity.position.y, 
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
    
    public update() {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Update position of all attack graphics based on their entity position
        for (const [attackId, attackGraphicData] of this.attackGraphics.entries()) {
            const attack = this.spacetimeClient.sdkConnection.db.activeAttacks.activeAttackId.find(attackId);
            if (!attack) continue;
            
            const entity = this.spacetimeClient.sdkConnection.db.entity.entityId.find(attack.entityId);
            if (!entity) continue;
            
            // Clear and redraw at new position using stored values
            attackGraphicData.graphic.clear();
            
            // Draw the attack using stored values
            attackGraphicData.graphic.fillStyle(0x0088ff, attackGraphicData.alpha);
            attackGraphicData.graphic.fillCircle(
                entity.position.x, 
                entity.position.y, 
                attackGraphicData.radius
            );
            
            // Add a border for better visibility
            attackGraphicData.graphic.lineStyle(2, 0x0066cc, attackGraphicData.alpha + 0.2);
            attackGraphicData.graphic.strokeCircle(
                entity.position.x, 
                entity.position.y, 
                attackGraphicData.radius
            );
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