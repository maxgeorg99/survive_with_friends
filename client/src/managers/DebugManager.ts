import Phaser from 'phaser';
import { Player, Entity, PlayerClass, Account, EventContext, ErrorContext, UpgradeOptionData } from "../autobindings";
import SpacetimeDBClient from '../SpacetimeDBClient'; // Path relative to client/src/managers/
import GameScene from '../scenes/GameScene'; // Corrected import for default export
import { AttackManager } from './AttackManager'; // Import AttackManager

export class DebugManager {
    private scene: GameScene; // Store as GameScene for easier access to its members if needed
    private spacetimedb: SpacetimeDBClient;
    private attackManager: AttackManager; // Store AttackManager instance
    private areAttackCirclesVisible: boolean = false; // Internal state for toggling

    constructor(scene: GameScene, spacetimedb: SpacetimeDBClient, attackManager: AttackManager) {
        this.scene = scene;
        this.spacetimedb = spacetimedb;
        this.attackManager = attackManager; // Receive and store AttackManager
        console.log("DebugManager initialized with AttackManager reference.");
    }

    public initializeDebugKeys() {
        console.log("DebugManager: Initializing debug keys...");
        if (this.scene.input.keyboard) {
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK).on('down', this.toggleAttackDebugCircles, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B).on('down', this.spawnBot, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T).on('down', this.triggerBossSpawnerTest, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G).on('down', this.spawnDebugSpecialGem, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V).on('down', this.spawnDebugVoidChest, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L).on('down', this.spawnDebugLootCapsule, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P).on('down', this.enableBotPvp, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR).on('down', this.setBossTypeEnder, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE).on('down', this.setBossTypeAgna, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H).on('down', this.setSuperHealth, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S).on('down', this.saveBuild, this);
            this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.O).on('down', this.loadBuild, this);
            console.log("DebugManager: Debug keys initialized.");
        } else {
            console.warn("DebugManager: Keyboard input not available on scene. Debug keys not initialized.");
        }
    }

    public clearDebugKeys() {
        if (this.scene.input.keyboard) {
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.B);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.T);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.G);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.V);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.L);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.P);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.FOUR);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.FIVE);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.H);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.S);
            this.scene.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.O);
        }
    }

    private toggleAttackDebugCircles() {
        this.areAttackCirclesVisible = !this.areAttackCirclesVisible;
        this.attackManager.setDebugCirclesEnabled(this.areAttackCirclesVisible);
        console.log(`DebugManager: Attack debug circles toggled to: ${this.areAttackCirclesVisible}`);
    }

    private spawnBot(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Spawning bot...");
            this.spacetimedb.sdkConnection.reducers.spawnBot();
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for spawning bot.");
        }
    }

    private triggerBossSpawnerTest(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Triggering boss spawner test...");
            this.spacetimedb.sdkConnection.reducers.spawnBossForTesting();
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for triggering boss spawner test.");
        }
    }

    private spawnDebugSpecialGem(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Spawning debug special gem near player...");
            this.spacetimedb.sdkConnection.reducers.spawnDebugSpecialGem();
        } else {
            console.warn("DebugManager: SpacetimeDB connection or player position not available for spawning debug special gem.");
        }
    }

    private spawnDebugVoidChest(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Spawning debug VoidChest near player...");
            this.spacetimedb.sdkConnection.reducers.spawnDebugVoidChest();
        } else {
            console.warn("DebugManager: SpacetimeDB connection or player position not available for spawning debug VoidChest.");
        }
    }

    private spawnDebugLootCapsule(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Spawning debug LootCapsule near player...");
            this.spacetimedb.sdkConnection.reducers.spawnDebugLootCapsule();
        } else {
            console.warn("DebugManager: SpacetimeDB connection or player position not available for spawning debug loot capsule.");
        }
    }

    private enableBotPvp(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Enabling PvP for all bots...");
            this.spacetimedb.sdkConnection.reducers.debugEnableBotPvp();
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for enabling PvP for all bots.");
        }
    }

    private setBossTypeEnder(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Setting boss type to Ender (client key 4)...");
            this.spacetimedb.sdkConnection.reducers.debugSetBossType(4);
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for setting boss type to Ender.");
        }
    }

    private setBossTypeAgna(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Setting boss type to Agna (client key 5)...");
            this.spacetimedb.sdkConnection.reducers.debugSetBossType(5);
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for setting boss type to Agna.");
        }
    }

    private setSuperHealth(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Setting super health (10000 HP)...");
            this.spacetimedb.sdkConnection.reducers.debugSetSuperHealth();
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for setting super health.");
        }
    }

    private saveBuild(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Saving current player build...");
            this.spacetimedb.sdkConnection.reducers.saveBuild();
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for saving build.");
        }
    }

    private loadBuild(): void {
        if (this.spacetimedb && this.spacetimedb.sdkConnection) {
            console.log("DebugManager: Loading saved player build...");
            this.spacetimedb.sdkConnection.reducers.loadBuild();
        } else {
            console.warn("DebugManager: SpacetimeDB connection not available for loading build.");
        }
    }
} 