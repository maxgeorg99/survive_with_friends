import * as Phaser from 'phaser';
import { ActiveAttack, AttackType, EventContext } from '../autobindings';
import { AttackData } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

export class AttackManager {
    private scene: Phaser.Scene;
    private attackGraphics: Map<number, Phaser.GameObjects.Graphics> = new Map();
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
            this.createOrUpdateAttackGraphic(attack);
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

    public checkExistingAttacks() {
        if (!this.spacetimeClient.sdkConnection) return;
        
        console.log("Checking for existing attacks...");
        const attacks = this.spacetimeClient.sdkConnection.db.activeAttacks.iter();
        for (const attack of attacks) {
            this.createOrUpdateAttackGraphic(attack);
        }
    }

    private handleAttackInsert(_ctx: EventContext, attack: ActiveAttack) {
        console.log(`Attack inserted: ${attack.activeAttackId}, type: ${attack.attackType}`);
        this.createOrUpdateAttackGraphic(attack);
    }

    private handleAttackUpdate(_ctx: EventContext, _oldAttack: ActiveAttack, newAttack: ActiveAttack) {
        console.log(`Attack updated: ${newAttack.activeAttackId}`);
        this.createOrUpdateAttackGraphic(newAttack);
    }

    private handleAttackDelete(_ctx: EventContext, attack: ActiveAttack) {
        console.log(`Attack deleted: ${attack.activeAttackId}`);
        const graphic = this.attackGraphics.get(attack.activeAttackId);
        if (graphic) {
            graphic.destroy();
            this.attackGraphics.delete(attack.activeAttackId);
        }
    }

    private createOrUpdateAttackGraphic(attack: ActiveAttack) {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Find the entity for this attack
        const entity = this.spacetimeClient.sdkConnection.db.entity.entityId.find(attack.entityId);
        if (!entity) {
            console.error(`Entity ${attack.entityId} not found for attack ${attack.activeAttackId}`);
            return;
        }

        // Find attack data for this attack type
        const attackData = this.findAttackDataByType(attack.attackType);
        if (!attackData) {
            console.error(`Attack data not found for type ${attack.attackType}`);
            return;
        }

        // Get or create graphics object
        let graphic = this.attackGraphics.get(attack.activeAttackId);
        if (!graphic) {
            graphic = this.scene.add.graphics();
            this.attackGraphics.set(attack.activeAttackId, graphic);
        }

        // Clear previous drawing
        graphic.clear();

        // Set alpha based on ownership
        const isLocalPlayerAttack = attack.playerId === this.localPlayerId;
        const alpha = isLocalPlayerAttack ? 0.7 : 0.4;

        // Draw the attack as a blue circle
        graphic.fillStyle(0x0088ff, alpha);
        graphic.fillCircle(entity.position.x, entity.position.y, attackData.radius);
        
        // Add a border for better visibility
        graphic.lineStyle(2, 0x0066cc, alpha + 0.2);
        graphic.strokeCircle(entity.position.x, entity.position.y, attackData.radius);
    }

    private findAttackDataByType(attackType: AttackType): AttackData | undefined {
        if (!this.spacetimeClient.sdkConnection) return undefined;
        
        const attackDataItems = this.spacetimeClient.sdkConnection.db.attackData.iter();
        for (const data of attackDataItems) {
            if (data.attackType === attackType) {
                return data;
            }
        }
        return undefined;
    }
    
    public update() {
        if (!this.spacetimeClient.sdkConnection) return;
        
        // Update position of all attack graphics based on their entity position
        for (const [attackId, graphic] of this.attackGraphics.entries()) {
            const attack = this.spacetimeClient.sdkConnection.db.activeAttacks.activeAttackId.find(attackId);
            if (!attack) continue;
            
            const entity = this.spacetimeClient.sdkConnection.db.entity.entityId.find(attack.entityId);
            if (!entity) continue;
            
            const attackData = this.findAttackDataByType(attack.attackType);
            if (!attackData) continue;
            
            // Clear and redraw at new position
            graphic.clear();
            
            // Set alpha based on ownership
            const isLocalPlayerAttack = attack.playerId === this.localPlayerId;
            const alpha = isLocalPlayerAttack ? 0.7 : 0.4;
            
            // Draw the attack
            graphic.fillStyle(0x0088ff, alpha);
            graphic.fillCircle(entity.position.x, entity.position.y, attackData.radius);
            
            // Add a border for better visibility
            graphic.lineStyle(2, 0x0066cc, alpha + 0.2);
            graphic.strokeCircle(entity.position.x, entity.position.y, attackData.radius);
        }
    }

    public shutdown() 
    {
        // Clean up all graphics
        for (const graphic of this.attackGraphics.values()) {
            graphic.destroy();
        }
        this.attackGraphics.clear();
        
        // Remove event listeners
        this.unregisterAttackListeners();
    }
} 