import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Entity, PlayerClass, UpdatePlayerDirection, Monsters, MonsterType, Bestiary, Account, DeadPlayer, EventContext, ErrorContext, UpgradeOptionData } from "../autobindings";
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { MONSTER_ASSET_KEYS, MONSTER_SHADOW_OFFSETS, MONSTER_MAX_HP } from '../constants/MonsterConfig';
import MonsterManager from '../managers/MonsterManager';
import MonsterSpawnerManager from '../managers/MonsterSpawnerManager';
import { GameEvents } from '../constants/GameEvents';
import { AttackManager } from '../managers/AttackManager';
import GemManager from '../managers/GemManager';
import { createPlayerDamageEffect, createMonsterDamageEffect } from '../utils/DamageEffects';
import UpgradeUI from '../ui/UpgradeUI';
import PlayerHUD from '../ui/PlayerHUD';

// Constants
const PLAYER_SPEED = 200;
const PLAYER_ASSET_KEY = 'player_fighter_1';
const GRASS_ASSET_KEY = 'grass_background';
const SHADOW_ASSET_KEY = 'shadow';
const SHADOW_OFFSET_Y = 14; // Vertical offset for the shadow (Increased)
const SHADOW_ALPHA = 0.4; // Transparency for the shadow
const INTERPOLATION_SPEED = 0.2; // Speed of interpolation (0-1, higher is faster)
const DIRECTION_UPDATE_RATE = 100; // Send direction updates every 100ms
const PLAYER_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
    fontSize: '16px',
    fontFamily: 'Arial',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
};
// Health bar configuration
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_OFFSET_Y = 18; // Position health bar above the exp bar
// EXP bar configuration
const EXP_BAR_WIDTH = 50;
const EXP_BAR_HEIGHT = 4;
const EXP_BAR_OFFSET_Y = 8; // Place the exp bar below the health bar
const NAME_OFFSET_Y = HEALTH_BAR_OFFSET_Y + 16; // Increased vertical offset for player name

// Monster rendering constants
const MONSTER_SHADOW_OFFSET_Y = 8; // Vertical offset for monster shadows
const MONSTER_HEALTH_BAR_WIDTH = 40;
const MONSTER_HEALTH_BAR_HEIGHT = 4;
const MONSTER_HEALTH_BAR_OFFSET_Y = 12;

// Depth sorting constants
const BASE_DEPTH = 1000; // Base depth to ensure all sprites are above background
const SHADOW_DEPTH_OFFSET = -1; // Always behind the sprite
const NAME_DEPTH_OFFSET = 2; // Always in front of the sprite
const HEALTH_BG_DEPTH_OFFSET = 1; // Just behind health bar but in front of sprite
const HEALTH_BAR_DEPTH_OFFSET = 1.1; // In front of background but behind name
const EXP_BG_DEPTH_OFFSET = 1; // Same as health background
const EXP_BAR_DEPTH_OFFSET = 1.1; // Same as health bar

// Movement and position constants
const POSITION_CORRECTION_THRESHOLD = 49; // Distance squared threshold for position correction (7 pixels)

// Asset keys for different player classes
const CLASS_ASSET_KEYS: Record<string, string> = {
    "Fighter": 'player_fighter',
    "Rogue": 'player_rogue',
    "Mage": 'player_mage',
    "Paladin": 'player_paladin'
};

export default class GameScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private playerInitialized = false;
    private localPlayerSprite: Phaser.Physics.Arcade.Sprite | null = null;
    private localPlayerNameText: Phaser.GameObjects.Text | null = null;
    private localPlayerShadow: Phaser.GameObjects.Image | null = null; // Added for local player shadow
    private otherPlayers: Map<number, Phaser.GameObjects.Container> = new Map();
    // Map to hold player data waiting for corresponding entity data (keyed by entityId)
    private pendingPlayers: Map<number, Player> = new Map();
    
    // Replace monster-related properties with MonsterManager
    private monsterManager: MonsterManager | null = null;
    
    // Add monster spawner manager for spawn indicators
    private monsterSpawnerManager: MonsterSpawnerManager | null = null;
    
    // Add attack manager for player attack visualization
    private attackManager: AttackManager | null = null;
    
    // Add gem manager for gem visualization
    private gemManager: GemManager | null = null;
    
    // Add upgrade UI manager
    private upgradeUI: UpgradeUI | null = null;
    
    // Add player HUD
    private playerHUD: PlayerHUD | null = null;
    
    // Add minimap
    private minimap: {
        container: Phaser.GameObjects.Container;
        background: Phaser.GameObjects.Rectangle;
        playerDot: Phaser.GameObjects.Arc;
        border: Phaser.GameObjects.Rectangle;
    } | null = null;
    
    private localPlayerId: number = 0;
    
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
    private wasdKeys: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
    } | null = null;
    private backgroundTile: Phaser.GameObjects.TileSprite | null = null;
    private isPlayerDataReady = false;
    
    // Server-authoritative motion variables
    private lastDirectionUpdateTime: number = 0;
    private serverPosition: Phaser.Math.Vector2 | null = null;
    private currentDirection: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
    private isMoving: boolean = false;

    // Add a property to track tap target
    private tapTarget: Phaser.Math.Vector2 | null = null;
    // Add property for tap marker visual
    private tapMarker: Phaser.GameObjects.Container | null = null;

    // Add property to track boundary state
    private isNearBoundary: {top: boolean, right: boolean, bottom: boolean, left: boolean} = {
        top: false,
        right: false,
        bottom: false,
        left: false
    };

    constructor() {
        super('GameScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("GameScene constructor called.");
    }

    preload() {
        console.log("GameScene preload started.");
        // Load assets from the /assets path (copied from public)
        this.load.image('player_fighter', '/assets/class_fighter_1.png');
        this.load.image('player_rogue', '/assets/class_rogue_1.png');
        this.load.image('player_mage', '/assets/class_mage_1.png');
        this.load.image('player_paladin', '/assets/class_paladin_1.png');
        this.load.image(GRASS_ASSET_KEY, '/assets/grass.png');
        this.load.image(SHADOW_ASSET_KEY, '/assets/shadow.png');
        
        // Load monster assets
        this.load.image('monster_rat', '/assets/monster_rat.png');
        this.load.image('monster_slime', '/assets/monster_slime.png');
        this.load.image('monster_orc', '/assets/monster_orc.png');
        this.load.image('monster_spawn_indicator', '/assets/monster_spawn_indicator.png');
        
        // Load boss monster assets
        this.load.image('final_boss_phase1', '/assets/final_boss_phase1.png');
        this.load.image('final_boss_phase2', '/assets/final_boss_phase2.png');
        
        // Load attack assets
        this.load.image('attack_sword', '/assets/attack_sword.png');
        this.load.image('attack_wand', '/assets/attack_wand.png');
        this.load.image('attack_knife', '/assets/attack_knife.png');
        this.load.image('attack_shield', '/assets/attack_shield.png');
        
        // Load upgrade assets
        this.load.image('card_blank', '/assets/card_blank.png');
        this.load.image('upgrade_maxHP', '/assets/upgrade_maxHP.png');
        this.load.image('upgrade_regenHP', '/assets/upgrade_regenHP.png');
        this.load.image('upgrade_speed', '/assets/upgrade_speed.png');
        this.load.image('upgrade_armor', '/assets/upgrade_armor.png');
        
        // Load gem assets
        this.load.image('gem_1', '/assets/gem_1.png');
        this.load.image('gem_2', '/assets/gem_2.png');
        this.load.image('gem_3', '/assets/gem_3.png');
        this.load.image('gem_4', '/assets/gem_4.png');
        
        // Load a white pixel for particle effects
        this.load.image('white_pixel', '/assets/white_pixel.png');
        
        // Add error handling for file loading errors
        this.load.on('loaderror', (fileObj: any) => {
            console.error(`Error loading asset: ${fileObj.key} (${fileObj.url})`, fileObj);
            alert(`Failed to load game asset: ${fileObj.key}. Check browser console for details.`);
        });
        
        // Check if assets are loaded successfully
        this.load.on('complete', () => {
            console.log("All assets loaded. Checking existence:");
            console.log("player_fighter:", this.textures.exists('player_fighter'));
            console.log("player_rogue:", this.textures.exists('player_rogue'));
            console.log("player_mage:", this.textures.exists('player_mage'));
            console.log("player_paladin:", this.textures.exists('player_paladin'));
            console.log("monster_rat:", this.textures.exists('monster_rat'));
            console.log("monster_slime:", this.textures.exists('monster_slime'));
            console.log("monster_orc:", this.textures.exists('monster_orc'));
            console.log("attack_sword:", this.textures.exists('attack_sword'));
            console.log("attack_wand:", this.textures.exists('attack_wand'));
            console.log("attack_knife:", this.textures.exists('attack_knife'));
            console.log("attack_shield:", this.textures.exists('attack_shield'));
            console.log(GRASS_ASSET_KEY + ":", this.textures.exists(GRASS_ASSET_KEY));
            console.log(SHADOW_ASSET_KEY + ":", this.textures.exists(SHADOW_ASSET_KEY));
        });
        
        console.log("GameScene preload finished. Started asset loading...");
    }

    create() {
        console.log("GameScene create started.");

        // Clean up any lingering UI elements from other scenes
        this.cleanupLingeringUIElements();

        // Set a fallback background color
        this.cameras.main.setBackgroundColor('#336699'); // A nice blue

        // Register event listeners
        this.registerEventListeners();
        console.log("Game event listeners registered.");

        this.playerInitialized = false;

        // Setup keyboard input
        this.cursors = this.input.keyboard?.createCursorKeys() ?? null;
        
        // Setup WASD keys
        if (this.input.keyboard) {
            this.wasdKeys = {
                W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
                A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
                S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
                D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
            };
            
            // Add debug key to toggle attack circles (use backtick key)
            this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK).on('down', this.toggleAttackDebugCircles, this);
            
            // Add R key for rerolling upgrades
            this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', this.rerollUpgrades, this);
        }
        console.log("Keyboard input set up.");

        // Setup touch input
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown && this.localPlayerSprite) {
                this.tapTarget = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
                this.updateTapMarker();
            }
        });
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.localPlayerSprite) {
                this.tapTarget = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
                this.updateTapMarker();
            }
        });
        this.input.on('pointerup', () => {
            // Don't clear tap target, we want to continue moving toward the target
        });
        console.log("Touch input set up.");

        // Create tap marker using shape graphics instead of texture
        // This is more reliable than the texture generation approach
        // Make the outer circle more transparent (0.3 instead of 0.6)
        const outerCircle = this.add.circle(0, 0, 32, 0xffffff, 0.3);
        // Make the inner circle more transparent (0.5 instead of 0.8)
        const innerCircle = this.add.circle(0, 0, 16, 0x00ffff, 0.5);
        
        // Create an X using line graphics with reduced alpha
        const crossGraphics = this.add.graphics();
        crossGraphics.lineStyle(4, 0xffffff, 0.7); // Reduced alpha from 1.0 to 0.7
        crossGraphics.beginPath();
        crossGraphics.moveTo(-8, -8);
        crossGraphics.lineTo(8, 8);
        crossGraphics.moveTo(8, -8);
        crossGraphics.lineTo(-8, 8);
        crossGraphics.closePath();
        crossGraphics.strokePath();
        
        // Group them all together
        const container = this.add.container(0, 0, [outerCircle, innerCircle, crossGraphics]);
        this.tapMarker = container;
        
        if (this.tapMarker) {
            this.tapMarker.setVisible(false);
            // Set depth to 0.5 - above floor (0) but below players (1)
            this.tapMarker.setDepth(0.5);
            // Add a slight overall alpha to the entire container
            this.tapMarker.setAlpha(0.8);
        }
        console.log("Tap marker set up.");

        // Background - Make it large enough to feel like a world
        const worldSize = 20000; // World size - 10x larger
        this.backgroundTile = this.add.tileSprite(0, 0, worldSize, worldSize, GRASS_ASSET_KEY)
            .setOrigin(0, 0)
            .setScrollFactor(1); // Scroll with the camera
        this.physics.world.setBounds(0, 0, worldSize, worldSize);
        console.log("Background and world bounds set up. World size:", worldSize);

        // Initialize game world once event listeners are set up
        console.log("Waiting for account login updated event to initialize game world...");

        // Initialize MonsterManager
        this.monsterManager = new MonsterManager(this, this.spacetimeDBClient);
        
        // Initialize AttackManager
        this.attackManager = new AttackManager(this, this.spacetimeDBClient);
        
        // Initialize MonsterSpawnerManager
        this.monsterSpawnerManager = new MonsterSpawnerManager(this, this.spacetimeDBClient);

        // Create minimap
        this.createMinimap();

        this.spacetimeDBClient.sdkConnection?.reducers.updateLastLogin();
    }

    private registerEventListeners() {

        // Initialize game world once event listeners are set up
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);

        // Player events
        this.gameEvents.on(GameEvents.PLAYER_CREATED, this.handlePlayerCreated, this);
        this.gameEvents.on(GameEvents.PLAYER_UPDATED, this.handlePlayerUpdated, this);
        this.gameEvents.on(GameEvents.PLAYER_DELETED, this.handlePlayerDeleted, this);
        this.gameEvents.on(GameEvents.PLAYER_DIED, this.handlePlayerDied, this);
        
        // Entity events
        this.gameEvents.on(GameEvents.ENTITY_CREATED, this.handleEntityCreated, this);
        this.gameEvents.on(GameEvents.ENTITY_UPDATED, this.handleEntityUpdated, this);
        this.gameEvents.on(GameEvents.ENTITY_DELETED, this.handleEntityDeleted, this);
        
        // Connection events
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);

        // Add table event handlers for upgrade options
        if (this.spacetimeDBClient.sdkConnection) {
            // Listen for upgrade options
            this.spacetimeDBClient.sdkConnection.db.upgradeOptions.onInsert(
                (ctx: EventContext, upgrade: UpgradeOptionData) => this.handleUpgradeOptionCreated(ctx, upgrade)
            );
            this.spacetimeDBClient.sdkConnection.db.upgradeOptions.onDelete(
                (ctx: EventContext, upgrade: UpgradeOptionData) => this.handleUpgradeOptionDeleted(ctx, upgrade)
            );
        }

        this.events.on("shutdown", this.shutdown, this);
    }

    private handleAccountUpdated(ctx: EventContext, oldAccount: Account, newAccount: Account) {
        //determine if its the local account
        console.log("Account updated event received in GameScene");

        if (this.spacetimeDBClient.identity && newAccount.identity.isEqual(this.spacetimeDBClient.identity)) 
        {
            console.log("GameScene: Local account updated");
            //Check if the login time was updated
            if (oldAccount.lastLogin.microsSinceUnixEpoch !== newAccount.lastLogin.microsSinceUnixEpoch) {
                //If we're getting this, then that means we sent the updateLastLogin reducer
                //in the create, and are now getting the response.
                //So we should initialize the game world at this point since
                //hopefully all the data is ready.
                console.log("New login detected, initializing game world: " + oldAccount.lastLogin.microsSinceUnixEpoch + " -> " + newAccount.lastLogin.microsSinceUnixEpoch);
                this.initializeGameWorld(ctx);  
            }
            else
            {
                console.log("GameScene: Local account updated, but no new login detected");
            }
        }
        else
        {
            console.log("GameScene: Another user has logged on: " + newAccount.identity.toString());
        }
    }

    private handlePlayerCreated(ctx: EventContext, player: Player, isLocalPlayer: boolean = true) {
        console.log("Player created event received in GameScene");
        
        if (isLocalPlayer) {
            console.log("Local player created:", player);
            // Initialize or update local player
            this.initializeLocalPlayer(ctx, player);
        } else {
            // Another player joined
            console.log("Other player created:", player);
            this.addOrUpdateOtherPlayer(player, ctx);
        }
    }

    private handlePlayerUpdated(ctx: EventContext, oldPlayer: Player, newPlayer: Player, isLocalPlayer: boolean) {
        //console.log("Player updated:", newPlayer.playerId, "Local:", isLocalPlayer);
        
        // If local player and unspent upgrades increased, check for upgrade options
        if (isLocalPlayer && newPlayer.unspentUpgrades > oldPlayer.unspentUpgrades) {
            console.log("Player level up: upgrade points available:", newPlayer.unspentUpgrades);
            
            // Play level up effect
            if (this.localPlayerSprite) {
                this.createLevelUpEffect(this.localPlayerSprite);
            }
        }

        // Rest of existing player update handling
        if (isLocalPlayer) {
            this.updateLocalPlayerAttributes(ctx, newPlayer);
        } else {
            this.addOrUpdateOtherPlayer(newPlayer, ctx);
        }
    }

    private handlePlayerDeleted(ctx: EventContext, player: Player, isLocalPlayer: boolean = false) 
    {
        if (isLocalPlayer) {
            // (Local player deletion is handled by handlePlayerDied)
            console.log("Local player deleted event received");
        } else {
            // Find and remove the other player
            console.log("Other player deleted:", player);
            
            this.removeOtherPlayer(player.playerId);
        }
    }

    private handlePlayerDied(ctx: EventContext, player: Player) {
        console.log("Player died event received in GameScene");
        // This is our local player that died
        console.log("Local player died:", player);
        
        // Clear any upgrade UI that may be open
        if (this.upgradeUI) {
            console.log("Clearing upgrade UI for dying player");
            this.upgradeUI.hide();
        }
        
        // Get the dead player record to check if this is a true survivor victory
        const deadPlayerOpt = ctx.db?.deadPlayers.playerId.find(player.playerId);
        const isTrueSurvivor = deadPlayerOpt && 'is_true_survivor' in deadPlayerOpt ? deadPlayerOpt.is_true_survivor : false;
        
        //play death animation
        var center = this.localPlayerSprite?.getCenter();
        if (center) {
            this.createDeathEffects(center.x, center.y);
        }
        
        // Show appropriate death screen
        if (isTrueSurvivor) {
            this.showVictoryScreen();
        } else {
            this.showDeathScreen();
        }
    }

    private handleConnectionLost(_ctx:ErrorContext) {
        console.log("Connection lost event received in GameScene");
        // Show a connection lost message
        const { width, height } = this.scale;
        const connectionLostText = this.add.text(width/2, height/2, 'CONNECTION LOST\nPlease refresh the page', {
            fontFamily: 'Arial',
            fontSize: '32px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        
        // Disable controls
        this.disablePlayerControls();
    }

    initializeGameWorld(ctx: EventContext) {
        console.log("Initializing game world elements...");
        // Ensure client and tables are ready
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("SpacetimeDB client, identity, or tables not available in initializeGameWorld.");
            return;
        }
        const localIdentity = this.spacetimeDBClient.identity;

        // --- Player Initialization ---
        // First look up the account by identity
        const account = ctx.db?.account.identity.find(localIdentity) as Account;
        if (!account) {
            console.error("Local account not found!");
            return;
        }

        console.log("Local account found:", account);        
        // Then look up the player by player_id from the account
        if (!account.currentPlayerId) {
            console.error("Local account has no currentPlayerId!");
            return; // Cannot proceed without player ID
        }

        var playerId = account.currentPlayerId;
        
        var localPlayerData = ctx.db?.player.playerId.find(playerId);
        if (!localPlayerData) {
            // Check if player is in the dead_players table
            var deadPlayerData = ctx.db?.deadPlayers.playerId.find(playerId);
            if (deadPlayerData) {
                console.error("Local player is dead! The game scene should not have been loaded.");
                return; // Cannot proceed with dead player
            }

            //Print all players
            const allPlayers = Array.from(ctx.db?.player.iter() || []);
            console.log("All players:", allPlayers);
            
            console.error("Local player data not found for playerID:", account.currentPlayerId);
            return;
        }
        
        console.log("Local player data found during initialization:", localPlayerData);
        
        // Initialize local player
        this.initializeLocalPlayer(ctx, localPlayerData);
        
        // Force an explicit player sync after entering the game world
        // This will handle both local player and other players
        console.log("Performing initial player synchronization...");
        this.syncPlayers(ctx);

        this.monsterManager?.initializeMonsters(ctx);
        
        // Check for existing attacks
        if (this.attackManager) {
            this.attackManager.setLocalPlayerId(playerId);
            this.attackManager.initializeAttacks(ctx);
            console.log("Existing attacks checked");
        }

        // Create and initialize the gem manager
        this.gemManager = new GemManager(this, this.spacetimeDBClient);
        this.gemManager.initializeGems(ctx);

        console.log("Game world initialization complete.");
    }

    /**
     * Initialize local player with data from server
     */
    private initializeLocalPlayer(ctx: EventContext, player: Player) {
        console.log("Initializing local player...");

        if (this.playerInitialized) {
            console.log("Local player already initialized, skipping...");
            return;
        }

        // Store the local player ID for upgrade handling
        this.localPlayerId = player.playerId;
        
        // Initialize PlayerHUD for reroll count display
        this.playerHUD = new PlayerHUD(this, this.spacetimeDBClient, this.localPlayerId);
        
        // Get the entity data for this player
        const entityData = ctx.db?.entity.entityId.find(player.entityId);
        if (!entityData) {
            console.log("Entity data not found for local player, adding to pending players");
            this.pendingPlayers.set(player.entityId, player);
            return;
        }

        this.attackManager?.setLocalPlayerRadius(entityData.radius);

        console.log("Found entity data for player:", entityData);

        // Set up the player sprite based on their class
        const spriteKey = this.getClassSpriteKey(player.playerClass);
        
        // Create the player sprite
        if (!this.localPlayerSprite) {
            console.log("Creating new player sprite at position:", entityData.position);
            this.localPlayerSprite = this.physics.add.sprite(entityData.position.x, entityData.position.y, spriteKey);
            this.localPlayerSprite.setDepth(BASE_DEPTH + entityData.position.y);
            
            // Add shadow
            this.localPlayerShadow = this.add.image(entityData.position.x, entityData.position.y, SHADOW_ASSET_KEY);
            this.localPlayerShadow.setAlpha(SHADOW_ALPHA);
            this.localPlayerShadow.setDepth(BASE_DEPTH + entityData.position.y + SHADOW_DEPTH_OFFSET);
            
            // Add player name text - Using consistent position calculation with NAME_OFFSET_Y
            this.localPlayerNameText = this.add.text(
                entityData.position.x, 
                entityData.position.y - Math.floor(this.localPlayerSprite.height / 2) - NAME_OFFSET_Y, 
                `${player.name} (${player.level})`, 
                {
                    fontSize: '16px',
                    color: '#FFFFFF',
                    stroke: '#000000',
                    strokeThickness: 3,
                    fontStyle: 'bold'
                }
            ).setOrigin(0.5);
            this.localPlayerNameText.setDepth(BASE_DEPTH + entityData.position.y + NAME_DEPTH_OFFSET);
            
            // Create health bar
            const startX = entityData.position.x;
            const startY = entityData.position.y;
            
            // Health bar background (black)
            const healthBarBackground = this.add.rectangle(
                startX,
                startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                HEALTH_BAR_WIDTH,
                HEALTH_BAR_HEIGHT,
                0x000000,
                0.7
            ).setOrigin(0.5, 0.5);
            
            // Health bar foreground (green)
            const healthBar = this.add.rectangle(
                startX - (HEALTH_BAR_WIDTH / 2),
                startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                HEALTH_BAR_WIDTH * (player.hp / player.maxHp),
                HEALTH_BAR_HEIGHT,
                0x00FF00,
                1
            ).setOrigin(0, 0.5);
            
            // Create exp bar
            const expBarBackground = this.add.rectangle(
                startX,
                startY - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y,
                EXP_BAR_WIDTH,
                EXP_BAR_HEIGHT,
                0x000000,
                0.7
            ).setOrigin(0.5, 0.5);
            
            // Calculate exp progress percentage
            const expProgress = player.expForNextLevel > 0 
                ? Math.min(1, player.exp / player.expForNextLevel) 
                : 0;
            
            // Exp bar foreground (blue)
            const expBar = this.add.rectangle(
                startX - (EXP_BAR_WIDTH / 2),
                startY - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y,
                EXP_BAR_WIDTH * expProgress,
                EXP_BAR_HEIGHT,
                0x3498db, // Blue color
                1
            ).setOrigin(0, 0.5);
            
            // Set appropriate depths
            healthBarBackground.setDepth(BASE_DEPTH + entityData.position.y + HEALTH_BG_DEPTH_OFFSET);
            healthBar.setDepth(BASE_DEPTH + entityData.position.y + HEALTH_BAR_DEPTH_OFFSET);
            expBarBackground.setDepth(BASE_DEPTH + entityData.position.y + EXP_BG_DEPTH_OFFSET);
            expBar.setDepth(BASE_DEPTH + entityData.position.y + EXP_BAR_DEPTH_OFFSET);
            
            // Store references to health bar elements and current health values
            this.localPlayerSprite.setData('healthBarBackground', healthBarBackground);
            this.localPlayerSprite.setData('healthBar', healthBar);
            this.localPlayerSprite.setData('hp', player.hp);
            this.localPlayerSprite.setData('maxHp', player.maxHp);
            
            // Store references to exp bar elements and current exp values
            this.localPlayerSprite.setData('expBarBackground', expBarBackground);
            this.localPlayerSprite.setData('expBar', expBar);
            this.localPlayerSprite.setData('exp', player.exp);
            this.localPlayerSprite.setData('expForNextLevel', player.expForNextLevel);
            
            console.log(`Created health bar for player: ${player.hp}/${player.maxHp}`);
            console.log(`Created exp bar for player: ${player.exp}/${player.expForNextLevel}`);
            
            // Set collision bounds
            this.localPlayerSprite.setCollideWorldBounds(true);
            
            // Set up camera follow
            console.log("Setting camera to follow player");
            this.cameras.main.startFollow(this.localPlayerSprite, true, 0.5, 0.5);
            this.cameras.main.setZoom(1.0); // Ensure zoom is at normal level
        } else {
            // Update the existing player sprite
            this.localPlayerSprite.setTexture(spriteKey);
            this.localPlayerSprite.setPosition(entityData.position.x, entityData.position.y);
            
            // Update health bar if it exists
            const healthBar = this.localPlayerSprite.getData('healthBar');
            const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
            
            if (healthBar && healthBarBackground) {
                // Update health bar position
                healthBarBackground.x = entityData.position.x;
                healthBarBackground.y = entityData.position.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                
                healthBar.x = entityData.position.x - (HEALTH_BAR_WIDTH / 2);
                healthBar.y = entityData.position.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                
                // Update health bar width
                const healthPercent = Math.max(0, Math.min(1, player.hp / player.maxHp));
                healthBar.width = HEALTH_BAR_WIDTH * healthPercent;
                
                // Update stored health values
                this.localPlayerSprite.setData('hp', player.hp);
                this.localPlayerSprite.setData('maxHp', player.maxHp);
                
                console.log(`Updated health bar: ${player.hp}/${player.maxHp}`);
            } else {
                console.warn("Health bar elements not found on existing sprite");
            }
            
            // Update exp bar if it exists
            const expBar = this.localPlayerSprite.getData('expBar');
            const expBarBackground = this.localPlayerSprite.getData('expBarBackground');
            
            if (expBar && expBarBackground) {
                // Update exp bar position
                expBarBackground.x = entityData.position.x;
                expBarBackground.y = entityData.position.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                
                expBar.x = entityData.position.x - (EXP_BAR_WIDTH / 2);
                expBar.y = entityData.position.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                
                // Calculate exp progress percentage
                const expProgress = player.expForNextLevel > 0 
                    ? Math.min(1, player.exp / player.expForNextLevel) 
                    : 0;
                    
                // Update exp bar width
                expBar.width = EXP_BAR_WIDTH * expProgress;
                
                // Update stored exp values
                this.localPlayerSprite.setData('exp', player.exp);
                this.localPlayerSprite.setData('expForNextLevel', player.expForNextLevel);
                
                console.log(`Updated exp bar: ${player.exp}/${player.expForNextLevel}`);
            } else {
                console.warn("Exp bar elements not found on existing sprite");
            }
        }
        
        // Add player sprite to registry for other components to access
        this.registry.set('localPlayerSprite', this.localPlayerSprite);
        
        // Store server position for interpolation
        this.serverPosition = new Phaser.Math.Vector2(entityData.position.x, entityData.position.y);
        
        // Store initial direction
        this.currentDirection.x = entityData.direction.x;
        this.currentDirection.y = entityData.direction.y;
        this.isMoving = entityData.isMoving;
        
        // Mark as initialized
        this.playerInitialized = true;
        this.isPlayerDataReady = true;

        // Check if player has pending upgrades and initialize the upgrade UI if needed
        if (player.unspentUpgrades > 0) {
            const playerUpgrades = Array.from(ctx.db.upgradeOptions.iter())
                .filter(option => option.playerId === this.localPlayerId);
                
            if (playerUpgrades.length > 0) {
                console.log("Player has pending upgrades, initializing upgrade UI");
                this.upgradeUI = new UpgradeUI(this, this.spacetimeDBClient, this.localPlayerId);
                this.upgradeUI.setUpgradeOptions(playerUpgrades);
            }
            else
            {
                console.log("No pending upgrades found for player");
            }
        }
        else
        {
            console.log("No pending upgrades found for player");
        }
        console.log("Local player initialized successfully");
    }

    /**
     * Update local player attributes when server data changes
     */
    private updateLocalPlayerAttributes(ctx: EventContext, player: Player) {
        // Update player name if it changed
        const previousLevel = this.localPlayerNameText ? 
            parseInt(this.localPlayerNameText.text.split('(')[1].split(')')[0]) : player.level;
            
        if (this.localPlayerNameText && this.localPlayerNameText.text !== `${player.name} (${player.level})`) {
            this.localPlayerNameText.setText(`${player.name} (${player.level})`);
            
            // If level increased, play level up effect
            if (player.level > previousLevel && this.localPlayerSprite) {
                this.createLevelUpEffect(this.localPlayerSprite);
            }
        }
        
        // Update health bar if health changed
        if (this.localPlayerSprite) {
            const currentHp = this.localPlayerSprite.getData('hp');
            const currentMaxHp = this.localPlayerSprite.getData('maxHp');
            
            // Check if health values changed
            if (currentHp !== player.hp || currentMaxHp !== player.maxHp) {
                // If HP decreased, show damage effect
                if (currentHp !== undefined && player.hp < currentHp) {
                    createPlayerDamageEffect(this.localPlayerSprite);
                }
                
                // Update stored values
                this.localPlayerSprite.setData('hp', player.hp);
                this.localPlayerSprite.setData('maxHp', player.maxHp);
                
                // Update health bar visuals
                const healthBar = this.localPlayerSprite.getData('healthBar');
                if (healthBar) {
                    // Update the width of the health bar based on current health percentage
                    const healthPercent = Math.max(0, Math.min(1, player.hp / player.maxHp));
                    healthBar.width = HEALTH_BAR_WIDTH * healthPercent;
                    
                    // Change color based on health percentage
                    if (healthPercent > 0.6) {
                        healthBar.fillColor = 0x00FF00; // Green
                    } else if (healthPercent > 0.3) {
                        healthBar.fillColor = 0xFFFF00; // Yellow
                    } else {
                        healthBar.fillColor = 0xFF0000; // Red
                    }
                }
            }
            
            // Update exp bar if exp changed
            const currentExp = this.localPlayerSprite.getData('exp');
            const currentExpForNextLevel = this.localPlayerSprite.getData('expForNextLevel');
            
            // Check if exp values changed
            if (currentExp !== player.exp || currentExpForNextLevel !== player.expForNextLevel) {
                // Update stored values
                this.localPlayerSprite.setData('exp', player.exp);
                this.localPlayerSprite.setData('expForNextLevel', player.expForNextLevel);
                
                // Update exp bar visuals
                const expBar = this.localPlayerSprite.getData('expBar');
                if (expBar) {
                    // Calculate progress percentage
                    const expProgress = player.expForNextLevel > 0 
                        ? Math.min(1, player.exp / player.expForNextLevel) 
                        : 0;
                    
                    // Update the width of the exp bar based on current exp percentage
                    expBar.width = EXP_BAR_WIDTH * expProgress;
                    
                    // Briefly flash the exp bar when gaining exp
                    if (currentExp !== undefined && player.exp > currentExp) {
                        this.tweens.add({
                            targets: expBar,
                            fillColor: 0x00ffff, // Bright cyan
                            duration: 200,
                            yoyo: true,
                            onComplete: () => {
                                expBar.fillColor = 0x3498db; // Return to blue
                            }
                        });
                    }
                }
            }
            
            // Add or remove glow effect based on grace period
            if (player.spawnGracePeriodRemaining > 0) {
                // Add a pulsing glow effect using a noticeable color tint
                // Store the grace period state on the sprite if not already stored
                if (!this.localPlayerSprite.getData('graceActive')) {
                    this.localPlayerSprite.setData('graceActive', true);
                    
                    // Create pulsing tint effect between white and blue
                    if (!this.localPlayerSprite.getData('graceTween')) {
                        const graceTween = this.tweens.add({
                            targets: this.localPlayerSprite,
                            alpha: 0.7,
                            yoyo: true,
                            repeat: -1,
                            duration: 500,
                            onUpdate: () => {
                                // Create cycling colors for more visible effect
                                const t = Math.sin(this.time.now / 200) * 0.5 + 0.5;
                                const color1 = new Phaser.Display.Color(255, 255, 255);
                                const color2 = new Phaser.Display.Color(200, 200, 200);
                                const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                                    color1,
                                    color2,
                                    100,
                                    Math.floor(t * 100)
                                );
                                this.localPlayerSprite?.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                            }
                        });
                        this.localPlayerSprite.setData('graceTween', graceTween);
                    }
                    
                    console.log("Grace period active: " + player.spawnGracePeriodRemaining);
                }
            } else {
                // Remove glow when grace period is over
                if (this.localPlayerSprite.getData('graceActive')) {
                    this.localPlayerSprite.setData('graceActive', false);
                    
                    // Stop the glow tween if it exists
                    const graceTween = this.localPlayerSprite.getData('graceTween');
                    if (graceTween) {
                        graceTween.stop();
                        this.localPlayerSprite.setData('graceTween', null);
                    }
                    
                    // Reset alpha and clear tint
                    this.localPlayerSprite.clearTint();
                    this.localPlayerSprite.alpha = 1.0;
                }
            }
        }
        
        // Get the latest entity data
        const entityData = ctx.db?.entity.entityId.find(player.entityId);
        if (entityData && this.serverPosition) {
            this.serverPosition.set(entityData.position.x, entityData.position.y);
        }
        if(entityData)
        {
            this.attackManager?.setLocalPlayerRadius(entityData.radius);
        }
    }
    
    /**
     * Creates visual effects for level up
     */
    private createLevelUpEffect(playerSprite: Phaser.Physics.Arcade.Sprite) {
        if (!playerSprite) return;
        
        console.log("Playing level up effect!");
        
        // Create "LEVEL UP!" text
        const levelUpText = this.add.text(
            playerSprite.x,
            playerSprite.y - 100, // Start above the player
            "LEVEL UP!",
            {
                fontFamily: 'Arial',
                fontSize: '32px',
                color: '#ffff00', // Bright yellow
                stroke: '#000000',
                strokeThickness: 6,
                fontStyle: 'bold'
            }
        );
        levelUpText.setOrigin(0.5);
        levelUpText.setDepth(BASE_DEPTH + playerSprite.y + 100); // Ensure it appears above the player
        
        // Animate the text
        this.tweens.add({
            targets: levelUpText,
            y: levelUpText.y - 80, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.5, to: 2 }, // Grow
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                levelUpText.destroy(); // Remove when animation is done
            }
        });
        
        // Create glow effect around player
        const glowCircle = this.add.circle(
            playerSprite.x,
            playerSprite.y,
            playerSprite.width / 1.5, // Slightly larger than the player
            0xffff00, // Yellow glow
            0.5 // Semi-transparent
        );
        glowCircle.setDepth(BASE_DEPTH + playerSprite.y - 1); // Just below the player
        
        // Expand and fade the glow
        this.tweens.add({
            targets: glowCircle,
            scale: 3,
            alpha: 0,
            duration: 500, // Reduced from 1000 to 500
            ease: 'Sine.easeOut',
            onComplete: () => {
                glowCircle.destroy();
            }
        });
        
        // Create particle effect
        const particles = this.add.particles(playerSprite.x, playerSprite.y, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 1000,
            gravityY: -50, // Float upward
            tint: 0xffff00, // Yellow particles
            emitting: false
        });
        
        // Emit particles in a burst
        particles.explode(30, playerSprite.x, playerSprite.y);
        
        // Clean up particles after animation
        this.time.delayedCall(700, () => {
            particles.destroy();
        });
        
        // Add a flash to the player sprite
        const initialTint = playerSprite.tintTopLeft;
        playerSprite.setTint(0xffffff); // White flash
        
        this.time.delayedCall(200, () => {
            playerSprite.setTint(initialTint); // Reset tint
        });
    }

    // Helper function to handle entity updates and move corresponding sprites
    handleEntityUpdate(ctx: EventContext, entityData: Entity) {
        // First check if this is a monster entity through the monster manager
        const wasMonsterEntity = this.monsterManager?.handleEntityUpdate(ctx, entityData);
        if (wasMonsterEntity) {
            // If it was a monster entity, we're done
            return;
        }
        
        // Get local player EntityId by first getting account, then player
        let localPlayerEntityId: number | undefined = undefined;
        try {
            if (this.spacetimeDBClient?.identity) 
            {
                // Get account by identity
                const localAccount = ctx.db?.account.identity.find(
                    this.spacetimeDBClient.identity
                );
                
                if (localAccount && localAccount.currentPlayerId > 0) {
                    // Get player by player_id from account
                    const localPlayer = ctx.db?.player.playerId.find(
                        localAccount.currentPlayerId
                    );
                    
                    if (localPlayer) {
                        localPlayerEntityId = localPlayer.entityId;
                    }
                }
            }
        } catch (error) {
            console.error("Error getting local player entity ID:", error);
        }
        
        // Check if this entity update is for the local player
        if (localPlayerEntityId === entityData.entityId) {
            // If local player sprite doesn't exist yet, create it now
            if (!this.localPlayerSprite) {
                const startX = Math.floor(entityData.position.x);
                const startY = Math.floor(entityData.position.y);
                
                // Get local player data for the name
                let playerName = 'Player';
                let playerClass = PlayerClass.Fighter; // Default class
                let playerLevel = 1; // Default level
                let playerMaxHp = 100; // Default max HP
                let playerHp = 100; // Default HP
                let playerExp = 0; // Default EXP
                let playerExpForNextLevel = 100; // Default EXP for next level
                
                try {
                    if (this.spacetimeDBClient?.identity) {
                        // Get account by identity
                        const localAccount = ctx.db?.account.identity.find(
                            this.spacetimeDBClient.identity
                        );
                        
                        if (localAccount && localAccount.currentPlayerId > 0) {
                            // Get player by player_id from account
                            const localPlayer = ctx.db?.player.playerId.find(
                                localAccount.currentPlayerId
                            );
                            
                            if (localPlayer) {
                                if (localPlayer.name) {
                                    playerName = localPlayer.name;
                                }
                                if (localPlayer.playerClass) {
                                    playerClass = localPlayer.playerClass;
                                }
                                if (localPlayer.level) {
                                    playerLevel = localPlayer.level;
                                }
                                if (localPlayer.maxHp) {
                                    playerMaxHp = localPlayer.maxHp;
                                }
                                if (localPlayer.hp) {
                                    playerHp = localPlayer.hp;
                                }
                                if (localPlayer.exp !== undefined) {
                                    playerExp = localPlayer.exp;
                                }
                                if (localPlayer.expForNextLevel) {
                                    playerExpForNextLevel = localPlayer.expForNextLevel;
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error getting player data:", error);
                }
                
                // Get class-specific sprite key
                const classKey = this.getClassSpriteKey(playerClass);
                this.localPlayerSprite = this.physics.add.sprite(startX, startY, classKey);
                
                // Use Y position for depth instead of fixed value
                const initialDepth = BASE_DEPTH + startY;
                this.localPlayerNameText = this.add.text(startX, startY - Math.floor(this.localPlayerSprite.height / 2) - NAME_OFFSET_Y, 
                    `${playerName} (${playerLevel})`, PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
                this.localPlayerNameText.setDepth(initialDepth + NAME_DEPTH_OFFSET);

                // Create health bar
                const healthBarBackground = this.add.rectangle(
                    startX,
                    startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                    HEALTH_BAR_WIDTH,
                    HEALTH_BAR_HEIGHT,
                    0x000000,
                    0.7
                ).setOrigin(0.5, 0.5);
                
                const healthBar = this.add.rectangle(
                    startX - (HEALTH_BAR_WIDTH / 2),
                    startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                    HEALTH_BAR_WIDTH * (playerHp / playerMaxHp),
                    HEALTH_BAR_HEIGHT,
                    0x00FF00,
                    1
                ).setOrigin(0, 0.5);
                
                // Create exp bar
                const expBarBackground = this.add.rectangle(
                    startX,
                    startY - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y,
                    EXP_BAR_WIDTH,
                    EXP_BAR_HEIGHT,
                    0x000000,
                    0.7
                ).setOrigin(0.5, 0.5);
                
                // Calculate exp progress percentage
                const expProgress = playerExpForNextLevel > 0 
                    ? Math.min(1, playerExp / playerExpForNextLevel) 
                    : 0;
                
                // Exp bar foreground (blue)
                const expBar = this.add.rectangle(
                    startX - (EXP_BAR_WIDTH / 2),
                    startY - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y,
                    EXP_BAR_WIDTH * expProgress,
                    EXP_BAR_HEIGHT,
                    0x3498db, // Blue color
                    1
                ).setOrigin(0, 0.5);
                
                // Set health bar properties with Y-based depth
                healthBarBackground.setDepth(initialDepth + HEALTH_BG_DEPTH_OFFSET);
                healthBar.setDepth(initialDepth + HEALTH_BAR_DEPTH_OFFSET);
                expBarBackground.setDepth(initialDepth + EXP_BG_DEPTH_OFFSET);
                expBar.setDepth(initialDepth + EXP_BAR_DEPTH_OFFSET);
                
                // Store health bar references
                this.localPlayerSprite.setData('healthBarBackground', healthBarBackground);
                this.localPlayerSprite.setData('healthBar', healthBar);
                this.localPlayerSprite.setData('hp', playerHp);
                this.localPlayerSprite.setData('maxHp', playerMaxHp);
                
                // Store exp bar references
                this.localPlayerSprite.setData('expBarBackground', expBarBackground);
                this.localPlayerSprite.setData('expBar', expBar);
                this.localPlayerSprite.setData('exp', playerExp);
                this.localPlayerSprite.setData('expForNextLevel', playerExpForNextLevel);
                
                this.localPlayerShadow = this.add.image(startX, startY + SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
                    .setAlpha(SHADOW_ALPHA)
                    .setDepth(initialDepth + SHADOW_DEPTH_OFFSET);

                // Set collision bounds
                this.localPlayerSprite.setCollideWorldBounds(true);

                // Camera follow
                this.cameras.main.startFollow(this.localPlayerSprite, true, 1, 1);
                this.cameras.main.setRoundPixels(true);
            }
            
            // Update server position for interpolation in update loop
            if (this.serverPosition === null) {
                this.serverPosition = new Phaser.Math.Vector2(entityData.position.x, entityData.position.y);
            } else {
                this.serverPosition.set(entityData.position.x, entityData.position.y);
            }
        } else {
            // This is an entity update for another player
            // Find which player owns this entity
            let playerOwningEntity: Player | null = null;
            try {
                // Find player by entity ID
                playerOwningEntity = ctx.db?.player.entityId.find(entityData.entityId) || null;
            } catch (error) {
                console.error("Error finding player for entity:", error);
            }
            
            if (playerOwningEntity) {
                // Update the other player's position
                try {
                    const otherPlayerContainer = this.otherPlayers.get(playerOwningEntity.playerId);
                    if (otherPlayerContainer) {
                        this.updateOtherPlayerPosition(playerOwningEntity.playerId, entityData.position.x, entityData.position.y);
                    } else {
                        // If we have the entity data but no sprite, we may need to create it
                        // This can happen if the entity update comes before the player insert
                        this.pendingPlayers.set(entityData.entityId, playerOwningEntity);
                    }
                } catch (error) {
                    console.error("Error updating other player position:", error);
                }
            }
        }
    }

    // Get class-specific sprite key
    getClassSpriteKey(playerClass: any): string {
        
        // Handle case when playerClass is a simple object with a tag property
        if (playerClass && typeof playerClass === 'object' && 'tag' in playerClass) {
            const className = playerClass.tag;
            const spriteKey = CLASS_ASSET_KEYS[className] || 'player_fighter';
            return spriteKey;
        } 
        
        // Handle case when playerClass is just a string
        if (typeof playerClass === 'string') {
            const spriteKey = CLASS_ASSET_KEYS[playerClass] || 'player_fighter';
            return spriteKey;
        }
        
        // Handle case when playerClass is a number (enum value)
        if (typeof playerClass === 'number') {
            // Map numeric enum values to class names
            const classNames = ["Fighter", "Rogue", "Mage", "Paladin"];
            const className = classNames[playerClass] || "Fighter";
            const spriteKey = CLASS_ASSET_KEYS[className] || 'player_fighter';
            return spriteKey;
        }
        
        // Default fallback
        console.log("Using default fighter class");
        return 'player_fighter';
    }
    
    // Update the function to properly use the player's playerId
    createOtherPlayerSprite(playerData: Player, entityData: Entity) {
        // Check if we already have this player
        if (this.otherPlayers.has(playerData.playerId)) {
            this.updateOtherPlayerPosition(playerData.playerId, entityData.position.x, entityData.position.y);
            return;
        }
        
        // Round position on creation
        const startX = Math.floor(entityData.position.x);
        const startY = Math.floor(entityData.position.y);
        
        // Calculate depth based on Y position
        const initialDepth = BASE_DEPTH + startY;
        
        // Create new player container with shadow, sprite and name
        const shadow = this.add.image(0, SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
            .setAlpha(SHADOW_ALPHA)
            .setDepth(SHADOW_DEPTH_OFFSET); // Relative depth within container
        
        // Get class-specific sprite
        const classKey = this.getClassSpriteKey(playerData.playerClass);
        const sprite = this.add.sprite(0, 0, classKey);
        
        // Display name with level
        const displayName = `${playerData.name} (${playerData.level})`;
        const text = this.add.text(
            0, 
            -Math.floor(sprite.height / 2) - NAME_OFFSET_Y, 
            displayName, 
            PLAYER_NAME_STYLE
        ).setOrigin(0.5, 0.5);
        
        // Health bar background
        const healthBarBackground = this.add.rectangle(
            0,
            -Math.floor(sprite.height / 2) - HEALTH_BAR_OFFSET_Y,
            HEALTH_BAR_WIDTH,
            HEALTH_BAR_HEIGHT,
            0x000000,
            0.7
        ).setOrigin(0.5, 0.5);
        
        // Health bar fill
        const healthBar = this.add.rectangle(
            -HEALTH_BAR_WIDTH / 2, // Offset to align with background
            -Math.floor(sprite.height / 2) - HEALTH_BAR_OFFSET_Y,
            HEALTH_BAR_WIDTH * (playerData.hp / playerData.maxHp),
            HEALTH_BAR_HEIGHT,
            0x00FF00,
            1
        ).setOrigin(0, 0.5);
        
        // EXP bar background
        const expBarBackground = this.add.rectangle(
            0,
            -Math.floor(sprite.height / 2) - EXP_BAR_OFFSET_Y,
            EXP_BAR_WIDTH,
            EXP_BAR_HEIGHT,
            0x000000,
            0.7
        ).setOrigin(0.5, 0.5);
        
        // Calculate exp progress percentage
        const expProgress = playerData.expForNextLevel > 0 
            ? Math.min(1, playerData.exp / playerData.expForNextLevel) 
            : 0;
        
        // EXP bar fill
        const expBar = this.add.rectangle(
            -EXP_BAR_WIDTH / 2, // Offset to align with background
            -Math.floor(sprite.height / 2) - EXP_BAR_OFFSET_Y,
            EXP_BAR_WIDTH * expProgress,
            EXP_BAR_HEIGHT,
            0x3498db, // Blue color
            1
        ).setOrigin(0, 0.5);
        
        // Create container and add all elements
        const container = this.add.container(startX, startY, [shadow, sprite, text, healthBarBackground, healthBar, expBarBackground, expBar]);
        container.setData('entityId', entityData.entityId);
        container.setData('hp', playerData.hp);
        container.setData('maxHp', playerData.maxHp);
        container.setData('exp', playerData.exp);
        container.setData('expForNextLevel', playerData.expForNextLevel);
        container.setData('sprite', sprite);
        
        // Name the elements so we can access them by name
        sprite.setName('sprite');
        text.setName('nameText');
        healthBar.setName('healthBar');
        healthBarBackground.setName('healthBarBackground');
        expBar.setName('expBar');
        expBarBackground.setName('expBarBackground');
        
        // Set the container depth based on Y position
        container.setDepth(initialDepth);
        
        // Store the container using player ID instead of identity
        this.otherPlayers.set(playerData.playerId, container);
        
        // Apply grace period effect if needed
        if (playerData.spawnGracePeriodRemaining > 0) {
            // Mark grace period as active
            container.setData('graceActive', true);
            
            // Create pulsing tint effect
            const graceTween = this.tweens.add({
                targets: sprite,
                alpha: 0.7,
                yoyo: true,
                repeat: -1,
                duration: 500,
                onUpdate: () => {
                    // Create cycling colors for visible effect
                    const t = Math.sin(this.time.now / 200) * 0.5 + 0.5;
                    const color1 = new Phaser.Display.Color(255, 255, 255);
                    const color2 = new Phaser.Display.Color(200, 200, 200);
                    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                        color1,
                        color2,
                        100,
                        Math.floor(t * 100)
                    );
                    sprite.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                }
            });
            container.setData('graceTween', graceTween);
            console.log(`Player ${playerData.name} has grace period: ${playerData.spawnGracePeriodRemaining}`);
        }
    }

    addOrUpdateOtherPlayer(playerData: Player, ctx: EventContext) {
        // Skip if this is our local player
        if (this.spacetimeDBClient?.identity) {
            // Get local account
            const myAccount = ctx.db?.account.identity.find(this.spacetimeDBClient.identity);
            
            // Skip if this is our local player
            if (myAccount && myAccount.currentPlayerId === playerData.playerId) {
                return;
            }
            
            // If we don't have a container for this player yet, we need to find its entity
            if (!this.otherPlayers.has(playerData.playerId)) {
                if (playerData.entityId) {
                    const entityData = ctx.db?.entity.entityId.find(playerData.entityId);
                    if (entityData) {
                        // Create the sprite with the entity data
                        this.createOtherPlayerSprite(playerData, entityData);
                    } else {
                        // If no entity found, we need to wait for the entity update
                        // Store player data for later
                        this.pendingPlayers.set(playerData.entityId, playerData);
                    }
                }
            } else {
                // Just update the container with any player changes if needed
                const container = this.otherPlayers.get(playerData.playerId);
                if (container) {
                    // Update player name on the text object if changed
                    const nameText = container.getByName('nameText') as Phaser.GameObjects.Text;
                    if (nameText && nameText.text !== `${playerData.name} (${playerData.level})`) {
                        // Extract previous level from the name text
                        const previousLevel = parseInt(nameText.text.split('(')[1].split(')')[0]);
                        
                        // Update the text
                        nameText.setText(`${playerData.name} (${playerData.level})`);
                        
                        // If level increased, play level up effect
                        if (playerData.level > previousLevel) {
                            this.createOtherPlayerLevelUpEffect(container);
                        }
                    }
                    
                    // Update health bar if needed
                    if (playerData.hp !== undefined && playerData.maxHp !== undefined) {
                        // Get current HP to compare
                        const currentHp = container.getData('hp') || playerData.maxHp;
                        
                        // Show damage effect if HP decreased
                        if (playerData.hp < currentHp) {
                            const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite;
                            if (sprite) {
                                createPlayerDamageEffect(sprite);
                            }
                        }
                        
                        // Store new HP value
                        container.setData('hp', playerData.hp);
                        container.setData('maxHp', playerData.maxHp);
                        
                        const healthBar = container.getByName('healthBar') as Phaser.GameObjects.Rectangle;
                        if (healthBar) {
                            // Adjust health bar width based on current HP
                            const healthPercentage = Math.max(0, Math.min(1, playerData.hp / playerData.maxHp));
                            healthBar.width = HEALTH_BAR_WIDTH * healthPercentage;
                            
                            // Position the health bar (it's left-aligned)
                            healthBar.x = -HEALTH_BAR_WIDTH / 2;
                        }
                    }
                    
                    // Update exp bar if exp changed
                    if (playerData.exp !== undefined && playerData.expForNextLevel !== undefined) {
                        // Get current exp to compare
                        const currentExp = container.getData('exp') || 0;
                        const currentExpForNextLevel = container.getData('expForNextLevel') || 100;
                        
                        // Store new exp values
                        container.setData('exp', playerData.exp);
                        container.setData('expForNextLevel', playerData.expForNextLevel);
                        
                        const expBar = container.getByName('expBar') as Phaser.GameObjects.Rectangle;
                        if (expBar) {
                            // Calculate progress percentage
                            const expProgress = playerData.expForNextLevel > 0 
                                ? Math.min(1, playerData.exp / playerData.expForNextLevel) 
                                : 0;
                            
                            // Adjust exp bar width based on current exp
                            expBar.width = EXP_BAR_WIDTH * expProgress;
                            
                            // Position the exp bar (it's left-aligned)
                            expBar.x = -EXP_BAR_WIDTH / 2;
                            
                            // Briefly flash the exp bar when gaining exp
                            if (playerData.exp > currentExp) {
                                this.tweens.add({
                                    targets: expBar,
                                    fillColor: 0x00ffff, // Bright cyan
                                    duration: 200,
                                    yoyo: true,
                                    onComplete: () => {
                                        expBar.fillColor = 0x3498db; // Return to blue
                                    }
                                });
                            }
                        }
                    }
                    
                    // Add or remove grace period effect
                    const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite;
                    if (sprite) {
                        // Handle grace period effect
                        if (playerData.spawnGracePeriodRemaining > 0) {
                            // Add grace period effect if not already present
                            if (!container.getData('graceActive')) {
                                container.setData('graceActive', true);
                                
                                // Create pulsing tint effect
                                if (!container.getData('graceTween')) {
                                    const graceTween = this.tweens.add({
                                        targets: sprite,
                                        alpha: 0.7,
                                        yoyo: true,
                                        repeat: -1,
                                        duration: 500,
                                        onUpdate: () => {
                                            // Create cycling colors for visible effect
                                            const t = Math.sin(this.time.now / 200) * 0.5 + 0.5;
                                            const color1 = new Phaser.Display.Color(255, 255, 255);
                                            const color2 = new Phaser.Display.Color(200, 200, 200);
                                            const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                                                color1,
                                                color2,
                                                100,
                                                Math.floor(t * 100)
                                            );
                                            sprite.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                                        }
                                    });
                                    container.setData('graceTween', graceTween);
                                }
                            }
                        } else {
                            // Remove effect when grace period is over
                            if (container.getData('graceActive')) {
                                container.setData('graceActive', false);
                                
                                // Stop the glow tween
                                const graceTween = container.getData('graceTween');
                                if (graceTween) {
                                    graceTween.stop();
                                    container.setData('graceTween', null);
                                }
                                
                                // Reset sprite to normal
                                sprite.clearTint();
                                sprite.alpha = 1.0;
                            }
                        }
                    }
                }
            }
        }
    }

    updateTapMarker() {
        if (!this.tapMarker) {
            console.warn("Cannot update tap marker - it doesn't exist!");
            return;
        }
        
        if (this.tapTarget) {
            // Position marker at tap target and make visible
            // Add larger vertical offset to align with character feet (SHADOW_OFFSET_Y + 10)
            this.tapMarker.setPosition(this.tapTarget.x, this.tapTarget.y + SHADOW_OFFSET_Y + 20);
            this.tapMarker.setVisible(true);
            
            // Add a small animation to make it more noticeable
            this.tweens.add({
                targets: this.tapMarker,
                scale: { from: 0.8, to: 1 },
                duration: 300,
                ease: 'Bounce.Out'
            });
        } else {
            // Hide marker when no target
            this.tapMarker.setVisible(false);
        }
    }

    updateOtherPlayerPosition(playerId: number, x: number, y: number) {
        const container = this.otherPlayers.get(playerId);
        if (container) {
            // Smooth movement to the new position from the Entity table, rounding the target
            this.tweens.add({
                targets: container,
                x: Math.floor(x),
                y: Math.floor(y),
                duration: 100, // Short duration for smooth sync
                ease: 'Linear',
                onUpdate: () => {
                    // Update depth during the tween
                    container.setDepth(BASE_DEPTH + container.y);
                }
            });
        }
    }

    removeOtherPlayer(playerId: number) {
        const container = this.otherPlayers.get(playerId);
        if (container) {
            // Stop any active tweens
            const graceTween = container.getData('graceTween');
            if (graceTween) {
                graceTween.stop();
            }
            
            container.destroy();
            this.otherPlayers.delete(playerId);
        }
    }

    // Add the update method to handle player movement
    update(time: number, delta: number) {
        // Skip if local player sprite isn't initialized yet
        if (!this.localPlayerSprite || !this.spacetimeDBClient?.sdkConnection?.db) {
            return;
        }
        
        // Determine movement direction from input
        let dirX = 0;
        let dirY = 0;
        
        // Track if any keyboard movement key was pressed
        let keyboardInputDetected = false;
        
        // Handle keyboard input
        if (this.cursors) {
            if (this.cursors.left?.isDown) { dirX -= 1; keyboardInputDetected = true; }
            if (this.cursors.right?.isDown) { dirX += 1; keyboardInputDetected = true; }
            if (this.cursors.up?.isDown) { dirY -= 1; keyboardInputDetected = true; }
            if (this.cursors.down?.isDown) { dirY += 1; keyboardInputDetected = true; }
        }
        
        // Handle WASD keyboard input
        if (this.wasdKeys) {
            if (this.wasdKeys.A.isDown) { dirX -= 1; keyboardInputDetected = true; }
            if (this.wasdKeys.D.isDown) { dirX += 1; keyboardInputDetected = true; }
            if (this.wasdKeys.W.isDown) { dirY -= 1; keyboardInputDetected = true; }
            if (this.wasdKeys.S.isDown) { dirY += 1; keyboardInputDetected = true; }
        }
        
        // Clear tap target if keyboard input is detected
        if (keyboardInputDetected && this.tapTarget) {
            this.tapTarget = null;
            this.tapMarker?.setVisible(false);
        }
        
        // Handle tap target if no keyboard input
        if (dirX === 0 && dirY === 0 && this.tapTarget) {
            // Get entity radius
            const entityRadius = this.getPlayerEntityRadius();
            
            // Clamp the tap target to valid world bounds
            const clampedTarget = this.clampToWorldBounds(this.tapTarget, entityRadius);
            
            // Update tap target if it was clamped
            if (clampedTarget.x !== this.tapTarget.x || clampedTarget.y !== this.tapTarget.y) {
                this.tapTarget.set(clampedTarget.x, clampedTarget.y);
                this.updateTapMarker();
            }
            
            // Calculate direction toward tap target
            const dx = this.tapTarget.x - this.localPlayerSprite.x;
            const dy = this.tapTarget.y - this.localPlayerSprite.y;
            
            // Check if we're close enough to the target to stop moving
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > 100) { // Arbitrary threshold of 10 pixels squared
                // Normalize direction vector
                const length = Math.sqrt(distanceSquared);
                dirX = dx / length;
                dirY = dy / length;
            } else {
                // Clear tap target if we've reached it
                this.tapTarget = null;
                this.tapMarker?.setVisible(false);
            }
        }
        
        // Only send updates to server if direction has changed or periodically
        const hasDirection = (dirX !== 0 || dirY !== 0);
        const directionChanged = (this.currentDirection.x !== dirX || this.currentDirection.y !== dirY);
        const timeForUpdate = (time - this.lastDirectionUpdateTime) > DIRECTION_UPDATE_RATE;
        
        if (directionChanged || (hasDirection && timeForUpdate)) {
            // Update current direction
            this.currentDirection.set(dirX, dirY);
            this.isMoving = hasDirection;
            
            // Send movement direction to server
            try {
                this.spacetimeDBClient.sdkConnection?.reducers.updatePlayerDirection(dirX, dirY);
                this.lastDirectionUpdateTime = time;
            } catch (error) {
                console.error("Error sending direction to server:", error);
            }
        }
        
        // Client-side prediction - move sprite immediately, server will correct if needed
        if (this.isMoving) {
            // Calculate position delta based on direction, speed and time
            const speed = PLAYER_SPEED * (delta / 1000); // pixels per millisecond
            const dx = this.currentDirection.x * speed;
            const dy = this.currentDirection.y * speed;
            
            // Get the entity radius for boundary checking
            const entityRadius = this.getPlayerEntityRadius();
            
            // Calculate new position
            const predictedPosition = {
                x: this.localPlayerSprite.x + dx,
                y: this.localPlayerSprite.y + dy
            };
            
            // Clamp the predicted position to valid world bounds
            const clampedPosition = this.clampToWorldBounds(predictedPosition, entityRadius);
            
            // Log when we hit boundaries for debugging
            if (clampedPosition.x !== predictedPosition.x || clampedPosition.y !== predictedPosition.y) {
                console.debug(`Movement clamped to boundary: (${predictedPosition.x.toFixed(1)}, ${predictedPosition.y.toFixed(1)}) → (${clampedPosition.x.toFixed(1)}, ${clampedPosition.y.toFixed(1)})`);
            }
            
            // Move the player sprite to the clamped position
            this.localPlayerSprite.x = clampedPosition.x;
            this.localPlayerSprite.y = clampedPosition.y;
            
            // Update the depth based on new Y position
            this.localPlayerSprite.setDepth(BASE_DEPTH + this.localPlayerSprite.y);
            
            // Update UI elements position
            if (this.localPlayerNameText) {
                this.localPlayerNameText.x = this.localPlayerSprite.x;
                this.localPlayerNameText.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - NAME_OFFSET_Y;
                this.localPlayerNameText.setDepth(BASE_DEPTH + this.localPlayerSprite.y + NAME_DEPTH_OFFSET);
            }
            
            // Update shadow position
            if (this.localPlayerShadow) {
                this.localPlayerShadow.x = this.localPlayerSprite.x;
                this.localPlayerShadow.y = this.localPlayerSprite.y + SHADOW_OFFSET_Y;
                this.localPlayerShadow.setDepth(BASE_DEPTH + this.localPlayerSprite.y + SHADOW_DEPTH_OFFSET);
            }
            
            // Update health bar position and depth
            const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
            const healthBar = this.localPlayerSprite.getData('healthBar');
            if (healthBarBackground && healthBar) {
                healthBarBackground.x = this.localPlayerSprite.x;
                healthBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                healthBarBackground.setDepth(BASE_DEPTH + this.localPlayerSprite.y + HEALTH_BG_DEPTH_OFFSET);
                
                healthBar.x = this.localPlayerSprite.x - (HEALTH_BAR_WIDTH / 2);
                healthBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                healthBar.setDepth(BASE_DEPTH + this.localPlayerSprite.y + HEALTH_BAR_DEPTH_OFFSET);
            }
            
            // Update exp bar position and depth
            const expBarBackground = this.localPlayerSprite.getData('expBarBackground');
            const expBar = this.localPlayerSprite.getData('expBar');
            if (expBarBackground && expBar) {
                expBarBackground.x = this.localPlayerSprite.x;
                expBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                expBarBackground.setDepth(BASE_DEPTH + this.localPlayerSprite.y + EXP_BG_DEPTH_OFFSET);
                
                expBar.x = this.localPlayerSprite.x - (EXP_BAR_WIDTH / 2);
                expBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                expBar.setDepth(BASE_DEPTH + this.localPlayerSprite.y + EXP_BAR_DEPTH_OFFSET);
            }
        }
        
        // If server has sent an updated position that's far from our prediction, correct it
        if (this.serverPosition && this.localPlayerSprite) {
            // Get entity radius using helper function
            const entityRadius = this.getPlayerEntityRadius();
            
            // Clamp server position to world bounds
            const clampedServerPosition = this.clampToWorldBounds(this.serverPosition, entityRadius);
            
            // Calculate distance to clamped server position
            const distX = clampedServerPosition.x - this.localPlayerSprite.x;
            const distY = clampedServerPosition.y - this.localPlayerSprite.y;
            const distSquared = distX * distX + distY * distY;
            
            // If difference is significant, update to match server position
            if (distSquared > POSITION_CORRECTION_THRESHOLD) {
                // Interpolate position
                this.localPlayerSprite.x += distX * INTERPOLATION_SPEED;
                this.localPlayerSprite.y += distY * INTERPOLATION_SPEED;
                
                // Update the depth based on new Y position
                this.localPlayerSprite.setDepth(BASE_DEPTH + this.localPlayerSprite.y);
                
                // Update UI elements with interpolated position and depth
                if (this.localPlayerNameText) {
                    this.localPlayerNameText.x = this.localPlayerSprite.x;
                    this.localPlayerNameText.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - NAME_OFFSET_Y;
                    this.localPlayerNameText.setDepth(BASE_DEPTH + this.localPlayerSprite.y + NAME_DEPTH_OFFSET);
                }
                
                if (this.localPlayerShadow) {
                    this.localPlayerShadow.x = this.localPlayerSprite.x;
                    this.localPlayerShadow.y = this.localPlayerSprite.y + SHADOW_OFFSET_Y;
                    this.localPlayerShadow.setDepth(BASE_DEPTH + this.localPlayerSprite.y + SHADOW_DEPTH_OFFSET);
                }
                
                // Update health bar with interpolated position and depth
                const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
                const healthBar = this.localPlayerSprite.getData('healthBar');
                if (healthBarBackground && healthBar) {
                    healthBarBackground.x = this.localPlayerSprite.x;
                    healthBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                    healthBarBackground.setDepth(BASE_DEPTH + this.localPlayerSprite.y + HEALTH_BG_DEPTH_OFFSET);
                    
                    healthBar.x = this.localPlayerSprite.x - (HEALTH_BAR_WIDTH / 2);
                    healthBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                    healthBar.setDepth(BASE_DEPTH + this.localPlayerSprite.y + HEALTH_BAR_DEPTH_OFFSET);
                }
                
                // Update exp bar with interpolated position and depth
                const expBarBackground = this.localPlayerSprite.getData('expBarBackground');
                const expBar = this.localPlayerSprite.getData('expBar');
                if (expBarBackground && expBar) {
                    expBarBackground.x = this.localPlayerSprite.x;
                    expBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                    expBarBackground.setDepth(BASE_DEPTH + this.localPlayerSprite.y + EXP_BG_DEPTH_OFFSET);
                    
                    expBar.x = this.localPlayerSprite.x - (EXP_BAR_WIDTH / 2);
                    expBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                    expBar.setDepth(BASE_DEPTH + this.localPlayerSprite.y + EXP_BAR_DEPTH_OFFSET);
                }
            }
        }
        
        // Update depths for other players as well
        this.otherPlayers.forEach((container) => {
            container.setDepth(BASE_DEPTH + container.y);
        });
        
        // Update monster positions with interpolation
        this.monsterManager?.update(time, delta);
        
        // Update attack visuals with time for prediction
        this.attackManager?.update(time, delta);
        
        // Let gem manager update animations
        if (this.gemManager) {
            this.gemManager.update(time, delta);
        }
        
        // Update upgrade UI if visible
        if (this.upgradeUI) {
            this.upgradeUI.update(time, delta);
        }
        
        // Update the player HUD if it exists
        if (this.playerHUD) {
            this.playerHUD.update(time, delta);
        }
        
        // Update minimap
        this.updateMinimap();
    }
    
    // Update the minimap with player's position
    private updateMinimap() {
        if (!this.minimap || !this.localPlayerSprite) return;
        
        // Get world bounds and minimap size
        const worldBounds = this.physics.world.bounds;
        const minimapSize = this.minimap.background.width;
        
        // Calculate position ratio (player position relative to world size)
        const ratioX = this.localPlayerSprite.x / worldBounds.width;
        const ratioY = this.localPlayerSprite.y / worldBounds.height;
        
        // Position player dot on minimap based on world position
        this.minimap.playerDot.x = ratioX * minimapSize;
        this.minimap.playerDot.y = ratioY * minimapSize;
    }

    // Force a synchronization of player entities
    syncPlayers(ctx: EventContext) {
        console.log("Forcing player sync...");
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("Cannot sync players: SpacetimeDB client, identity, or tables not available");
            return;
        }

        const localIdentity = this.spacetimeDBClient.identity;
        
        // Get the local account to find the current player ID
        const localAccount = ctx.db.account.identity.find(localIdentity) as Account;
        if (!localAccount) {
            console.error("Local account not found during sync!");
            return;
        }
        
        // First, handle local player if not already created
        if (!this.localPlayerSprite && localAccount.currentPlayerId > 0) {
            //const localPlayer = allPlayers.find(p => p.playerId === localAccount.currentPlayerId);
            const localPlayer = ctx.db.player.playerId.find(localAccount.currentPlayerId) as Player;
            if (localPlayer) {
                const entityData = ctx.db.entity.entityId.find(localPlayer.entityId) as Entity;
                if (entityData) {
                    console.log(`Creating local player during sync: ${localPlayer.name} at (${entityData.position.x}, ${entityData.position.y})`);
                    this.handleEntityUpdate(ctx, entityData);
                } else {
                    console.warn(`Entity data not found for local player (entityId: ${localPlayer.entityId})`);
                }
            } else {
                console.warn(`Local player data not found in player table during sync`);
            }
        }
        
        // Then handle all other players
        for (const player of ctx.db.player.iter()) {
            // Skip local player
            if (player.playerId === localAccount.currentPlayerId) {
                continue;
            }
            
            const entityData = ctx.db.entity.entityId.find(player.entityId) as Entity;
            if (entityData) {
                // Check if this player already has a sprite
                const existingContainer = this.otherPlayers.get(player.playerId);
                if (!existingContainer) {
                    // Create the sprite directly - this bypasses the normal flow but ensures
                    // the sprite is created immediately
                    this.createOtherPlayerSprite(player, entityData);
                } else {
                    // Just update position if sprite already exists
                    this.updateOtherPlayerPosition(player.playerId, entityData.position.x, entityData.position.y);
                }
            } else {
                console.warn(`Entity data not found for player ${player.name} (entityId: ${player.entityId})`);
            }
        }
        
        // Debug output of all tracked players
        console.log(`Total tracked other players after sync: ${this.otherPlayers.size}`);
    }
    
    // Create blood splatter particles
    private createDeathEffects(x: number, y: number) {
        console.log(`Creating death effects at (${x}, ${y})`);
        
        // Create a particle emitter for blood splatter
        const particles = this.add.particles(x, y, 'shadow', {  // Reusing shadow texture as particle
            speed: { min: 50, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.4, end: 0.1 },
            lifespan: 800,
            quantity: 20,
            tint: 0xff0000,  // Red tint for blood
            gravityY: 300,
            blendMode: 'ADD',
            emitting: false
        });
        
        // Set depth to ensure it's visible
        particles.setDepth(5000);
        
        // Emit once
        particles.explode(30, x, y);
        
        // Auto-destroy after animation completes
        this.time.delayedCall(1000, () => {
            particles.destroy();
        });
    }
    
    // Show death screen for local player
    private showDeathScreen() {
        console.log("Showing death screen for local player");
        
        // Create dark overlay covering the entire screen
        const { width, height } = this.scale;
        const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.7)
            .setOrigin(0, 0)
            .setScrollFactor(0)  // Fix to camera
            .setDepth(10000);    // Ensure it's on top
            
        // Add "You are no Survivor" text
        const titleText = this.add.text(
            width / 2, 
            height / 2 - 50, 
            "You are no Survivor", 
            {
                fontFamily: 'Arial',
                fontSize: '48px',
                color: '#FF0000',
                stroke: '#000000',
                strokeThickness: 6,
                align: 'center'
            }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(10001);
        
        // Add "Choose a new character" text (updated from "refresh to play again")
        const subtitleText = this.add.text(
            width / 2, 
            height / 2 + 50, 
            "Choose a new character", 
            {
                fontFamily: 'Arial',
                fontSize: '24px',
                color: '#FFFFFF',
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center'
            }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(10001);
        
        // Fade in effect
        overlay.alpha = 0;
        titleText.alpha = 0;
        subtitleText.alpha = 0;
        
        this.tweens.add({
            targets: [overlay, titleText, subtitleText],
            alpha: 1,
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                // Wait 3 seconds before transitioning to ClassSelectScene
                this.time.delayedCall(3000, () => {
                    console.log("Death screen timer complete, transitioning to ClassSelectScene");
                    this.scene.start('ClassSelectScene');
                });
            }
        });
        
        // Disable input and controls for local player
        this.disablePlayerControls();
    }
    
    // Disable player controls after death
    private disablePlayerControls() {
        // Clear tap target and hide marker
        this.tapTarget = null;
        if (this.tapMarker) {
            this.tapMarker.setVisible(false);
        }
        
        // Set flag to prevent movement in update()
        this.isMoving = false;
        
        // Clear direction
        this.currentDirection.set(0, 0);
        
        // If using actual input components that need disabling:
        // (This is more for documentation, as the update method won't process input anyway)
        if (this.input) {
            // Remove pointer listeners
            this.input.off('pointermove');
            this.input.off('pointerdown');
            this.input.off('pointerup');
        }
    }

    shutdown() {
        console.log("GameScene shutting down...");

        this.monsterManager?.shutdown();
        
        // Clean up MonsterSpawnerManager
        this.monsterSpawnerManager?.destroy();
        this.monsterSpawnerManager = null;
        
        // Clean up AttackManager properly
        this.attackManager?.shutdown();

        // Clean up GemManager
        this.gemManager?.shutdown();
        this.gemManager = null;
        
        // Clean up UpgradeUI
        if (this.upgradeUI) {
            this.upgradeUI.destroy();
            this.upgradeUI = null;
        }
        
        // Note: SpacetimeDB event handlers are managed by the SDK
        // The connection to the database will be cleaned up when the game is closed
        // or when we move to a different scene

        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);

        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);

        this.gameEvents.off(GameEvents.PLAYER_CREATED, this.handlePlayerCreated, this);
        this.gameEvents.off(GameEvents.PLAYER_UPDATED, this.handlePlayerUpdated, this);
        this.gameEvents.off(GameEvents.PLAYER_DELETED, this.handlePlayerDeleted, this);
        this.gameEvents.off(GameEvents.PLAYER_DIED, this.handlePlayerDied, this);
        
        // Remove entity event listeners
        this.gameEvents.off(GameEvents.ENTITY_CREATED, this.handleEntityCreated, this);
        this.gameEvents.off(GameEvents.ENTITY_UPDATED, this.handleEntityUpdated, this);
        this.gameEvents.off(GameEvents.ENTITY_DELETED, this.handleEntityDeleted, this);
        
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Clean up MonsterManager event listeners
        if (this.monsterManager) {
            this.monsterManager.unregisterListeners();
        }
        
        // Clean up local player objects
        if (this.localPlayerSprite) {
            this.localPlayerSprite.destroy();
            this.localPlayerSprite = null;
        }
        
        if (this.localPlayerShadow) {
            this.localPlayerShadow.destroy();
            this.localPlayerShadow = null;
        }
        
        if (this.localPlayerNameText) {
            this.localPlayerNameText.destroy();
            this.localPlayerNameText = null;
        }
        
        // Clean up other player sprites
        for (const [_, container] of this.otherPlayers) {
            container.destroy();
        }
        this.otherPlayers.clear();
        
        // Clear tap target and marker
        this.tapTarget = null;
        if (this.tapMarker) {
            this.tapMarker.destroy();
            this.tapMarker = null;
        }
        
        // Remove debug key binding
        if (this.input?.keyboard) {
            try {
                // Try different approach to remove the listener
                this.input.keyboard.removeCapture(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
                // Just create a new key without listeners to replace the old one
                this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKTICK);
            } catch (e) {
                console.warn("Could not clean up debug key binding:", e);
            }
        }
        
        // Clean up PlayerHUD
        if (this.playerHUD) {
            this.playerHUD.destroy();
            this.playerHUD = null;
        }
        
        // Clean up minimap
        if (this.minimap) {
            this.minimap.container.destroy();
            this.minimap = null;
        }
        
        console.log("GameScene shutdown complete.");
    }

    // New entity event handlers
    private handleEntityCreated(ctx: EventContext, entity: Entity) {
        this.handleEntityUpdate(ctx, entity);
    }

    private handleEntityUpdated(ctx: EventContext, oldEntity: Entity, newEntity: Entity) {
        this.handleEntityUpdate(ctx, newEntity);
    }

    private handleEntityDeleted(_ctx: EventContext, entity: Entity) {
        // Handle entity deletion (if needed)
        // Currently no specific handling is needed as player/monster deletions are handled by respective events
    }

    private cleanupLingeringUIElements() {
        console.log("GameScene: Cleaning up lingering UI elements from other scenes only");
        
        try {
            // Only clean up elements we know belong to other scenes
            // Login scene elements
            const loginInput = document.getElementById('login-name-input');
            if (loginInput && loginInput.parentNode) {
                console.log("GameScene: Removing lingering login input");
                loginInput.remove();
            }
            
            // Class select scene elements - only if we find the container ID
            const classContainer = document.getElementById('class-select-container');
            if (classContainer && classContainer.parentNode) {
                console.log("GameScene: Removing lingering class container");
                classContainer.remove();
            }
        } catch (e) {
            console.error("Error in GameScene cleanupLingeringUIElements:", e);
        }
    }

    /**
     * Get the player entity radius from server data
     * @returns The entity radius, or 48 as fallback
     */
    private getPlayerEntityRadius(): number {
        // Default fallback radius
        let entityRadius = 48;
        
        try {
            if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(
                    this.spacetimeDBClient.identity
                );
                
                if (account && account.currentPlayerId > 0) {
                    const player = this.spacetimeDBClient.sdkConnection.db.player.playerId.find(
                        account.currentPlayerId
                    );
                    
                    if (player && player.entityId) {
                        const entity = this.spacetimeDBClient.sdkConnection.db.entity.entityId.find(player.entityId);
                        if (entity && entity.radius) {
                            entityRadius = entity.radius;
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error getting entity radius:", error);
        }
        
        return entityRadius;
    }

    /**
     * Clamp a position to world boundaries
     * @param position The position to clamp
     * @param entityRadius The entity radius to use for boundary calculation
     * @returns The clamped position
     */
    private clampToWorldBounds(position: {x: number, y: number}, entityRadius: number): {x: number, y: number} {
        const worldBounds = this.physics.world.bounds;
        
        // Add extra vertical buffer to make top/bottom boundaries consistent with left/right
        // This aligns the sprite's visual position with its collision boundary
        const verticalBuffer = 8; // Extra buffer for top/bottom boundaries
        
        return {
            x: Phaser.Math.Clamp(
                position.x,
                worldBounds.x + entityRadius,
                worldBounds.right - entityRadius
            ),
            y: Phaser.Math.Clamp(
                position.y,
                worldBounds.y + entityRadius + verticalBuffer, // Add buffer to top boundary
                worldBounds.bottom - entityRadius - verticalBuffer // Add buffer to bottom boundary
            )
        };
    }

    // Add a debug key binding to toggle attack circles visibility
    private toggleAttackDebugCircles() {
        if (this.attackManager) {
            // Create a private variable in the class to track the current state
            if (this.attackManager['debugCirclesEnabled'] === undefined) {
                this.attackManager['debugCirclesEnabled'] = false;
            }
            
            // Toggle the state
            const newState = !this.attackManager['debugCirclesEnabled'];
            this.attackManager['debugCirclesEnabled'] = newState;
            
            // Call the method to update the attack manager
            this.attackManager.setDebugCirclesEnabled(newState);
            
            console.log(`Attack debug circles ${newState ? 'enabled' : 'disabled'}`);
        } else {
            console.log("Attack manager not initialized, can't toggle debug circles");
        }
    }

    /**
     * Creates visual effects for level up for other players
     */
    private createOtherPlayerLevelUpEffect(container: Phaser.GameObjects.Container) {
        if (!container) return;
        
        console.log("Playing level up effect for other player!");
        
        // Get the sprite component from the container
        const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite;
        if (!sprite) return;
        
        // Create "LEVEL UP!" text
        const levelUpText = this.add.text(
            container.x,
            container.y - 100, // Start above the player
            "LEVEL UP!",
            {
                fontFamily: 'Arial',
                fontSize: '28px',
                color: '#ffff00', // Bright yellow
                stroke: '#000000',
                strokeThickness: 5,
                fontStyle: 'bold'
            }
        );
        levelUpText.setOrigin(0.5);
        levelUpText.setDepth(BASE_DEPTH + container.y + 100); // Ensure it appears above the player
        
        // Animate the text
        this.tweens.add({
            targets: levelUpText,
            y: levelUpText.y - 80, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.5, to: 2 }, // Grow
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                levelUpText.destroy(); // Remove when animation is done
            }
        });
        
        // Create glow effect around player
        const glowCircle = this.add.circle(
            container.x,
            container.y,
            sprite.width / 1.5, // Slightly larger than the player
            0xffff00, // Yellow glow
            0.5 // Semi-transparent
        );
        glowCircle.setDepth(BASE_DEPTH + container.y - 1); // Just below the player
        
        // Expand and fade the glow
        this.tweens.add({
            targets: glowCircle,
            scale: 3,
            alpha: 0,
            duration: 500, // Reduced from 1000 to 500
            ease: 'Sine.easeOut',
            onComplete: () => {
                glowCircle.destroy();
            }
        });
        
        // Create particle effect
        const particles = this.add.particles(container.x, container.y, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 1000,
            gravityY: -50, // Float upward
            tint: 0xffff00, // Yellow particles
            emitting: false
        });
        
        // Emit particles in a burst
        particles.explode(30, container.x, container.y);
        
        // Clean up particles after animation
        this.time.delayedCall(700, () => {
            particles.destroy();
        });
        
        // Add a flash to the player sprite
        const initialTint = sprite.tintTopLeft;
        sprite.setTint(0xffffff); // White flash
        
        this.time.delayedCall(200, () => {
            sprite.setTint(initialTint); // Reset tint
        });
    }

    private handleUpgradeOptionCreated(ctx: EventContext, upgrade: UpgradeOptionData): void {
        // Only handle options for the local player
        if (upgrade.playerId === this.localPlayerId) {
            console.log("Received upgrade option:", upgrade);
            
            // Initialize upgrade UI if not already done
            if (!this.upgradeUI && this.localPlayerId > 0) {
                this.upgradeUI = new UpgradeUI(this, this.spacetimeDBClient, this.localPlayerId);
            }
            
            // Collect all upgrades for this player by filtering the rows manually
            if (this.upgradeUI) {
                const playerUpgrades = Array.from(ctx.db?.upgradeOptions.iter())
                    .filter(option => option.playerId === this.localPlayerId);
                
                this.upgradeUI.setUpgradeOptions(playerUpgrades);
            }
        }
        else
        {
            console.log("Received upgrade option for other player:" + upgrade.playerId + ", local player id:" + this.localPlayerId);
        }
    }

    private handleUpgradeOptionDeleted(ctx: EventContext, upgrade: UpgradeOptionData): void {
        // When upgrades are deleted (usually after selection), hide the UI
        if (upgrade.playerId === this.localPlayerId && this.upgradeUI) {
            const remainingUpgrades = Array.from(ctx.db.upgradeOptions.iter())
                .filter(option => option.playerId === this.localPlayerId);
            
            if (remainingUpgrades.length === 0) {
                this.upgradeUI.hide();
            } else {
                this.upgradeUI.setUpgradeOptions(remainingUpgrades);
            }
        }
    }
    
    /**
     * Handle rerolling upgrades when the 'R' key is pressed
     */
    private rerollUpgrades(): void {
        if (!this.spacetimeDBClient.sdkConnection?.db || this.localPlayerId <= 0) {
            console.log("Cannot reroll: Connection not available or player not initialized");
            return;
        }
        
        // Get player data
        const player = this.spacetimeDBClient.sdkConnection.db.player.playerId.find(this.localPlayerId);
        if (!player) {
            console.log("Cannot reroll: Player data not found");
            return;
        }
        
        // Check if player has unspent upgrades and rerolls
        if (player.unspentUpgrades <= 0) {
            console.log("Cannot reroll: No unspent upgrades available");
            return;
        }
        
        if (player.rerolls <= 0) {
            console.log("Cannot reroll: No rerolls available");
            return;
        }
        
        console.log("Rerolling upgrades...");
        
        // Hide the upgrade UI
        if (this.upgradeUI) {
            this.upgradeUI.hide();
        }
        
        // Create reroll effect
        if (this.localPlayerSprite) {
            this.createRerollEffect(this.localPlayerSprite);
        }
        
        // Call the reroll reducer
        this.spacetimeDBClient.sdkConnection.reducers.rerollUpgrades(this.localPlayerId);
    }
    
    /**
     * Creates visual effects for rerolling upgrades
     */
    private createRerollEffect(playerSprite: Phaser.Physics.Arcade.Sprite): void {
        if (!playerSprite) return;
        
        console.log("Playing reroll effect!");
        
        // Create "REROLL!" text
        const rerollText = this.add.text(
            playerSprite.x,
            playerSprite.y - 80, // Above the player
            "REROLL!",
            {
                fontFamily: 'Arial',
                fontSize: '28px',
                color: '#00ffff', // Cyan
                stroke: '#000000',
                strokeThickness: 5,
                fontStyle: 'bold'
            }
        );
        rerollText.setOrigin(0.5);
        rerollText.setDepth(BASE_DEPTH + playerSprite.y + 100); // Ensure it appears above the player
        
        // Animate the text
        this.tweens.add({
            targets: rerollText,
            y: rerollText.y - 50, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.8, to: 1.5 }, // Grow
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                rerollText.destroy(); // Remove when animation is done
            }
        });
        
        // Create swirl effect around player
        const particles = this.add.particles(playerSprite.x, playerSprite.y, 'white_pixel', {
            speed: { min: 80, max: 180 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 800,
            gravityY: 0,
            tint: 0x00ffff, // Cyan particles
            emitting: false,
            emitCallback: (particle: Phaser.GameObjects.Particles.Particle) => {
                // Make particles move in a circular pattern
                const angle = Math.random() * Math.PI * 2;
                const speed = Phaser.Math.Between(80, 180);
                const radius = Phaser.Math.Between(30, 80);
                
                particle.velocityX = Math.cos(angle) * speed;
                particle.velocityY = Math.sin(angle) * speed;
                
                // Add some rotation to each particle
                particle.rotation = angle;
            }
        });
        
        // Emit particles in a burst
        particles.explode(40, playerSprite.x, playerSprite.y);
        
        // Add a flash to the player sprite
        const initialTint = playerSprite.tintTopLeft;
        playerSprite.setTint(0x00ffff); // Cyan flash
        
        this.time.delayedCall(300, () => {
            playerSprite.setTint(initialTint); // Reset tint
        });
        
        // Clean up particles after animation
        this.time.delayedCall(800, () => {
            particles.destroy();
        });
    }

    // Create a semi-transparent minimap in the bottom-left corner
    private createMinimap() {
        const { width, height } = this.scale;
        
        // Constants for minimap sizing and positioning
        const MINIMAP_SIZE = 150; // Size of the minimap (square)
        const MINIMAP_MARGIN = 20; // Margin from screen edges
        const MINIMAP_ALPHA = 0.7; // Semi-transparency
        const PLAYER_DOT_SIZE = 5; // Size of player dot on minimap
        const BORDER_SIZE = 2; // Width of minimap border
        
        // Create minimap container at the bottom-left corner
        const container = this.add.container(
            MINIMAP_MARGIN,
            height - MINIMAP_MARGIN - MINIMAP_SIZE
        );
        
        // Create semi-transparent dark background
        const background = this.add.rectangle(
            0, 
            0, 
            MINIMAP_SIZE, 
            MINIMAP_SIZE, 
            0x000000, 
            0.5
        ).setOrigin(0);
        
        // Create border
        const border = this.add.rectangle(
            0,
            0,
            MINIMAP_SIZE,
            MINIMAP_SIZE,
            0xFFFFFF,
            0.3
        ).setOrigin(0);
        border.setStrokeStyle(BORDER_SIZE, 0xFFFFFF, 0.5);
        
        // Create player dot (will be positioned in update)
        const playerDot = this.add.circle(
            0,
            0,
            PLAYER_DOT_SIZE,
            0xFFFFFF,
            1
        );
        
        // Add all elements to container
        container.add([background, border, playerDot]);
        
        // Fix to camera so it doesn't move with world
        container.setScrollFactor(0);
        
        // Set initial alpha
        container.setAlpha(MINIMAP_ALPHA);
        
        // Store reference to minimap elements
        this.minimap = {
            container,
            background,
            playerDot,
            border
        };
        
        console.log("Minimap created");
    }

    // Show victory screen for True Survivors
    private showVictoryScreen() {
        console.log("Showing True Survivor victory screen");
        
        // Create bright overlay covering the entire screen
        const { width, height } = this.scale;
        const overlay = this.add.rectangle(0, 0, width, height, 0xFFFFFF, 0.7)
            .setOrigin(0, 0)
            .setScrollFactor(0)  // Fix to camera
            .setDepth(10000);    // Ensure it's on top
            
        // Add "You are a True Survivor" text
        const titleText = this.add.text(
            width / 2, 
            height / 2 - 50, 
            "YOU ARE A TRUE SURVIVOR", 
            {
                fontFamily: 'Arial',
                fontSize: '48px',
                color: '#FFD700', // Gold
                stroke: '#000000',
                strokeThickness: 6,
                align: 'center'
            }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(10001);
        
        // Add victory subtitle text
        const subtitleText = this.add.text(
            width / 2, 
            height / 2 + 50, 
            "The Final Boss has been defeated!", 
            {
                fontFamily: 'Arial',
                fontSize: '24px',
                color: '#FFFFFF',
                stroke: '#000000',
                strokeThickness: 4,
                align: 'center'
            }
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(10001);
        
        // Fade in effect
        overlay.alpha = 0;
        titleText.alpha = 0;
        subtitleText.alpha = 0;
        
        this.tweens.add({
            targets: [overlay, titleText, subtitleText],
            alpha: 1,
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                // Wait 5 seconds before transitioning to ClassSelectScene
                this.time.delayedCall(5000, () => {
                    console.log("Victory screen timer complete, transitioning to ClassSelectScene");
                    this.scene.start('ClassSelectScene');
                });
            }
        });
        
        // Create victory particles effect
        this.createVictoryParticles();
        
        // Disable input and controls for local player
        this.disablePlayerControls();
    }
    
    // Create special particle effects for the victory screen
    private createVictoryParticles() {
        const { width, height } = this.scale;
        
        // Golden confetti particles
        const confetti = this.add.particles(0, 0, 'white_pixel', {
            x: { min: 0, max: width },
            y: -50,
            quantity: 2,
            lifespan: 6000,
            speedY: { min: 100, max: 300 },
            speedX: { min: -100, max: 100 },
            scale: { start: 0.5, end: 1 },
            rotate: { start: 0, end: 360 },
            tint: [0xFFD700, 0xFFA500, 0xFFFFFF, 0xDAA520], // Gold colors
            frequency: 50,
            emitting: true
        }).setDepth(10002);
        
        // Star burst in the center
        const stars = this.add.particles(width/2, height/2, 'white_pixel', {
            speed: { min: 100, max: 500 },
            angle: { min: 0, max: 360 },
            scale: { start: 1, end: 0 },
            lifespan: 2000,
            blendMode: 'ADD',
            tint: 0xFFD700, // Gold
            quantity: 2,
            frequency: 200,
            emitting: true
        }).setDepth(10002);
        
        // Stop particles after 5 seconds
        this.time.delayedCall(5000, () => {
            confetti.destroy();
            stars.destroy();
        });
    }
}