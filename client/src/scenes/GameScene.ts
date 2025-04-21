import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Entity, PlayerClass, UpdatePlayerDirection, Monsters, MonsterType, Bestiary, Account, DeadPlayer } from "../autobindings";
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { MONSTER_ASSET_KEYS, MONSTER_SHADOW_OFFSETS, MONSTER_MAX_HP } from '../constants/MonsterConfig';
import MonsterManager from '../managers/MonsterManager';

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
const HEALTH_BAR_OFFSET_Y = 17; // Increased vertical offset for health bar
const NAME_OFFSET_Y = HEALTH_BAR_OFFSET_Y + 15; // Increased vertical offset for player name

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

// Asset keys for different player classes
const CLASS_ASSET_KEYS: Record<string, string> = {
    "Fighter": 'player_fighter',
    "Rogue": 'player_rogue',
    "Mage": 'player_mage',
    "Paladin": 'player_paladin'
};

export default class GameScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private localPlayerSprite: Phaser.Physics.Arcade.Sprite | null = null;
    private localPlayerNameText: Phaser.GameObjects.Text | null = null;
    private localPlayerShadow: Phaser.GameObjects.Image | null = null; // Added for local player shadow
    private otherPlayers: Map<Identity, Phaser.GameObjects.Container> = new Map();
    // Map to hold player data waiting for corresponding entity data (keyed by entityId)
    private pendingPlayers: Map<number, Player> = new Map();
    
    // Replace monster-related properties with MonsterManager
    private monsterManager: MonsterManager;
    
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

    constructor() {
        super('GameScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        console.log("GameScene constructor called.");
        // Initialize MonsterManager
        this.monsterManager = new MonsterManager(this, this.spacetimeDBClient);
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
            console.log(GRASS_ASSET_KEY + ":", this.textures.exists(GRASS_ASSET_KEY));
            console.log(SHADOW_ASSET_KEY + ":", this.textures.exists(SHADOW_ASSET_KEY));
        });
        
        console.log("GameScene preload finished. Started asset loading...");
    }

    create() {
        console.log("GameScene create started.");

        // Set a fallback background color
        this.cameras.main.setBackgroundColor('#336699'); // A nice blue

        // Wait for player data from main.ts before initializing game elements
        this.events.on('playerDataReady', () => {
            console.log("GameScene received playerDataReady event.");
            this.isPlayerDataReady = true;
            this.initializeGameWorld();
        });

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
        }

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

        // If data is already ready when scene starts (e.g., scene restart)
        if (this.isPlayerDataReady) {
             this.initializeGameWorld();
        }
        console.log("GameScene create finished.");
    }

    initializeGameWorld() {
        console.log("Initializing game world elements...");
        // Ensure client and tables are ready
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("SpacetimeDB client, identity, or tables not available in initializeGameWorld.");
            return;
        }
        const localIdentity = this.spacetimeDBClient.identity;

        // Background - Make it large enough to feel like a world
        const worldSize = 2000; // Example world size
        this.backgroundTile = this.add.tileSprite(0, 0, worldSize, worldSize, GRASS_ASSET_KEY)
            .setOrigin(0, 0)
            .setScrollFactor(1); // Scroll with the camera
        this.physics.world.setBounds(0, 0, worldSize, worldSize);

        // --- Player Initialization ---
        // First look up the account by identity
        const account = this.spacetimeDBClient.sdkConnection?.db.account.identity.find(localIdentity) as Account;
        if (!account) {
            console.error("Local account not found!");
            return; // Cannot proceed without account
        }
        
        console.log("Local account found:", account);
        
        // Then look up the player by player_id from the account
        if (!account.currentPlayerId) {
            console.error("Local account has no currentPlayerId!");
            return; // Cannot proceed without player ID
        }
        
        const localPlayerData = this.spacetimeDBClient.sdkConnection?.db.player.player_id.find(account.currentPlayerId) as Player;
        if (!localPlayerData) {
            // Check if player is in the dead_players table
            const deadPlayerData = this.spacetimeDBClient.sdkConnection?.db.deadPlayers.player_id.find(account.currentPlayerId) as DeadPlayer;
            if (deadPlayerData) {
                console.error("Local player is dead! The game scene should not have been loaded.");
                return; // Cannot proceed with dead player
            }
            
            console.error("Local player data not found!");
            return; // Cannot proceed without local player
        }
        
        console.log("Local player data found:", localPlayerData);
        console.log("Looking for entity with ID:", localPlayerData.entityId);
        
        // Register event listeners
        this.registerSpacetimeDBListeners();
        
        // Force an explicit player sync after entering the game world
        // This will handle both local player and other players
        console.log("Performing initial player synchronization...");
        this.syncPlayers();

        console.log("Game world initialization complete.");
    }

    registerSpacetimeDBListeners() {
        console.log("Registering SpacetimeDB listeners...");
        // Ensure client and tables are ready
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("Attempted to register listeners without valid client/identity/tables.");
            return;
        }
        const localIdentity = this.spacetimeDBClient.identity;

        // Listen for account updates
        this.spacetimeDBClient.sdkConnection?.db.account.onUpdate((_ctx, oldAccount: Account, newAccount: Account) => {
            if (!this.isPlayerDataReady) return;
            
            // Check if this is our account
            if (newAccount.identity.isEqual(localIdentity)) {
                // If our player ID changed, we might need to refresh
                if (oldAccount.currentPlayerId !== newAccount.currentPlayerId) {
                    console.log(`Local player ID changed from ${oldAccount.currentPlayerId} to ${newAccount.currentPlayerId}`);
                    // If we had a player before and now don't, we might have died
                    if (oldAccount.currentPlayerId > 0 && newAccount.currentPlayerId === 0) {
                        console.log("Local player may have died - removing sprite");
                        if (this.localPlayerSprite) {
                            this.localPlayerSprite.destroy();
                            this.localPlayerSprite = null;
                        }
                        if (this.localPlayerNameText) {
                            this.localPlayerNameText.destroy();
                            this.localPlayerNameText = null;
                        }
                        if (this.localPlayerShadow) {
                            this.localPlayerShadow.destroy();
                            this.localPlayerShadow = null;
                        }
                    }
                }
            }
        });

        // Use the table handle to register listeners with correct signatures
        this.spacetimeDBClient.sdkConnection?.db.player.onInsert((_ctx, player: Player) => {
            if (!this.isPlayerDataReady) return;
            console.log(`Player.onInsert: ${player.name} (ID: ${player.playerId}, EntityID: ${player.entityId})`);
            
            // Find account for this player
            const allAccounts = Array.from(this.spacetimeDBClient.sdkConnection?.db.account.iter() || []);
            const ownerAccount = allAccounts.find(a => a.currentPlayerId === player.playerId);
            
            if (!ownerAccount) {
                console.warn(`Could not find account for player ${player.name} (ID: ${player.playerId})`);
                return;
            }
            
            // Check if this is a local or other player
            if (!ownerAccount.identity.isEqual(localIdentity)) {
                this.addOrUpdateOtherPlayer(player);
            }
        });

        this.spacetimeDBClient.sdkConnection?.db.player.onUpdate((_ctx, oldPlayer: Player, newPlayer: Player) => {
            if (!this.isPlayerDataReady) return;
            
            // Find account for this player
            const allAccounts = Array.from(this.spacetimeDBClient.sdkConnection?.db.account.iter() || []);
            const ownerAccount = allAccounts.find(a => a.currentPlayerId === newPlayer.playerId);
            
            if (!ownerAccount) {
                console.warn(`Could not find account for player ${newPlayer.name} (ID: ${newPlayer.playerId})`);
                return;
            }
            
            // Check if this is a local or other player
            if (!ownerAccount.identity.isEqual(localIdentity)) {
                this.addOrUpdateOtherPlayer(newPlayer);
            } else {
                // Update local player name if it changes
                if (this.localPlayerNameText && newPlayer.name && this.localPlayerNameText.text !== `${newPlayer.name} (${newPlayer.level})`) {
                    console.log(`Updating local player name to: ${newPlayer.name} (${newPlayer.level})`);
                    this.localPlayerNameText.setText(`${newPlayer.name} (${newPlayer.level})`);
                }
                
                // Update health bar if needed
                if (this.localPlayerSprite && newPlayer.hp !== undefined && newPlayer.maxHp !== undefined) {
                    // Find the health bar object
                    const healthBar = this.children.getByName('localPlayerHealthBar') as Phaser.GameObjects.Rectangle;
                    if (healthBar) {
                        // Adjust health bar width based on current HP
                        const healthPercentage = Math.max(0, Math.min(1, newPlayer.hp / newPlayer.maxHp));
                        healthBar.width = HEALTH_BAR_WIDTH * healthPercentage;
                    }
                }
            }
        });

        // Handle player deletion/death
        this.spacetimeDBClient.sdkConnection?.db.player.onDelete((_ctx, player: Player) => {
            if (!this.isPlayerDataReady) return;
            console.log(`Player.onDelete: ${player.name} (ID: ${player.playerId})`);
            
            // Find account for this player
            const allAccounts = Array.from(this.spacetimeDBClient.sdkConnection?.db.account.iter() || []);
            const ownerAccount = allAccounts.find(a => a.currentPlayerId === player.playerId);
            
            // Get entity position before it's removed (if still in cache)
            const entityId = player.entityId;
            const entityPosition = this.getEntityPosition(entityId);
            
            // Create death effects if we have the position
            if (entityPosition) {
                console.log(`Creating death effects for player ${player.name} at position (${entityPosition.x}, ${entityPosition.y})`);
                this.createDeathEffects(entityPosition.x, entityPosition.y);
            }
            
            // Handle based on whether it's local or other player
            if (ownerAccount) {
                const isLocalAccount = ownerAccount.identity.isEqual(localIdentity);
                
                if (isLocalAccount) {
                    console.log("Local player died, showing death screen");
                    this.showDeathScreen();
                } else {
                    // Remove other player sprite
                    this.removeOtherPlayer(ownerAccount.identity);
                }
            } else {
                console.warn(`Could not find account for player ${player.name} (ID: ${player.playerId})`);
            }
        });

        // Entity listeners remain unchanged
        this.spacetimeDBClient.sdkConnection?.db.entity.onInsert((_ctx, entity: Entity) => {
            this.handleEntityUpdate(entity);
        });
        
        this.spacetimeDBClient.sdkConnection?.db.entity.onUpdate((_ctx, _oldEntity: Entity, newEntity: Entity) => {
            this.handleEntityUpdate(newEntity);
        });
        
        this.spacetimeDBClient.sdkConnection?.db.entity.onDelete((_ctx, entity: Entity) => {
            // When an entity is deleted, we don't need to do anything here
            // Monster handlers will take care of monster entities
        });

        // Initialize the monster manager and register its listeners
        this.monsterManager.initializeMonsters();
    }

    // Helper function to handle entity updates and move corresponding sprites
    handleEntityUpdate(entityData: Entity) {
        // First check if this is a monster entity through the monster manager
        const wasMonsterEntity = this.monsterManager.handleEntityUpdate(entityData);
        if (wasMonsterEntity) {
            // If it was a monster entity, we're done
            return;
        }
        
        // Debug: Log all entities in cache to verify state
        const allEntities = Array.from(this.spacetimeDBClient.sdkConnection?.db.entity.iter() || []);
        
        // Get local player EntityId by first getting account, then player
        let localPlayerEntityId: number | undefined = undefined;
        try {
            if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                // Get account by identity
                const localAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(
                    this.spacetimeDBClient.identity
                );
                
                if (localAccount && localAccount.currentPlayerId > 0) {
                    // Get player by player_id from account
                    const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.player_id.find(
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
                
                try {
                    if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                        // Get account by identity
                        const localAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(
                            this.spacetimeDBClient.identity
                        );
                        
                        if (localAccount && localAccount.currentPlayerId > 0) {
                            // Get player by player_id from account
                            const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.player_id.find(
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
                this.localPlayerSprite.setDepth(initialDepth);
                
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
                
                // Set health bar properties with Y-based depth
                healthBarBackground.setDepth(initialDepth + HEALTH_BG_DEPTH_OFFSET);
                healthBar.setDepth(initialDepth + HEALTH_BAR_DEPTH_OFFSET);
                
                // Store health bar references
                this.localPlayerSprite.setData('healthBarBackground', healthBarBackground);
                this.localPlayerSprite.setData('healthBar', healthBar);
                this.localPlayerSprite.setData('hp', playerHp);
                this.localPlayerSprite.setData('maxHp', playerMaxHp);
                
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
                if (this.spacetimeDBClient?.sdkConnection?.db) {
                    const allPlayers = Array.from(this.spacetimeDBClient.sdkConnection.db.player.iter());
                    playerOwningEntity = allPlayers.find(p => p.entityId === entityData.entityId) || null;
                }
            } catch (error) {
                console.error("Error finding player for entity:", error);
            }
            
            if (playerOwningEntity) {
                // Find the account for this player
                try {
                    if (this.spacetimeDBClient?.sdkConnection?.db) {
                        const allAccounts = Array.from(this.spacetimeDBClient.sdkConnection.db.account.iter());
                        const ownerAccount = allAccounts.find(a => a.currentPlayerId === playerOwningEntity?.playerId);
                        
                        if (ownerAccount) {
                            const otherPlayerContainer = this.otherPlayers.get(ownerAccount.identity);
                            if (otherPlayerContainer) {
                                this.updateOtherPlayerPosition(ownerAccount.identity, entityData.position.x, entityData.position.y);
                            } else {
                                // If we have the entity data but no sprite, we may need to create it
                                // This can happen if the entity update comes before the player insert
                                this.pendingPlayers.set(entityData.entityId, playerOwningEntity);
                            }
                        }
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
    
    // Update the function to properly use the player's class
    createOtherPlayerSprite(playerData: Player, entityData: Entity, ownerAccount: Account) {
        // Check if we already have this player
        if (this.otherPlayers.has(ownerAccount.identity)) {
            this.updateOtherPlayerPosition(ownerAccount.identity, entityData.position.x, entityData.position.y);
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
        
        // Create container and add all elements
        const container = this.add.container(startX, startY, [shadow, sprite, text, healthBarBackground, healthBar]);
        container.setData('entityId', entityData.entityId);
        container.setData('hp', playerData.hp);
        container.setData('maxHp', playerData.maxHp);
        
        // Set the container depth based on Y position
        container.setDepth(initialDepth);
        
        // Use account identity to store the container
        this.otherPlayers.set(ownerAccount.identity, container);
    }

    addOrUpdateOtherPlayer(playerData: Player) {
        // Skip if this is our local player
        if (this.spacetimeDBClient?.identity) {
            // Find account by player ID
            const allAccounts = Array.from(this.spacetimeDBClient.sdkConnection?.db.account.iter() || []);
            const ownerAccount = allAccounts.find(a => a.currentPlayerId === playerData.playerId);
            
            if (ownerAccount && ownerAccount.identity.isEqual(this.spacetimeDBClient.identity)) {
                return;
            }
            
            if (!ownerAccount) {
                console.warn(`Could not find account for player ${playerData.name} (ID: ${playerData.playerId})`);
                return;
            }
            
            // If we don't have a container for this player yet, we need to find its entity
            if (!this.otherPlayers.has(ownerAccount.identity)) {
                if (playerData.entityId) {
                    const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entity_id.find(playerData.entityId);
                    if (entityData) {
                        // Create the sprite with the entity data - pass the ownerAccount
                        this.createOtherPlayerSprite(playerData, entityData, ownerAccount);
                    } else {
                        // If no entity found, we need to wait for the entity update
                        // Store player data for later
                        this.pendingPlayers.set(playerData.entityId, playerData);
                    }
                }
            } else {
                // Just update the container with any player changes if needed
                const container = this.otherPlayers.get(ownerAccount.identity);
                if (container) {
                    // Update player name on the text object if changed
                    const nameText = container.getByName('nameText') as Phaser.GameObjects.Text;
                    if (nameText && nameText.text !== `${playerData.name} (${playerData.level})`) {
                        nameText.setText(`${playerData.name} (${playerData.level})`);
                    }
                    
                    // Update health bar if needed
                    if (playerData.hp !== undefined && playerData.maxHp !== undefined) {
                        const healthBar = container.getByName('healthBar') as Phaser.GameObjects.Rectangle;
                        if (healthBar) {
                            // Adjust health bar width based on current HP
                            const healthPercentage = Math.max(0, Math.min(1, playerData.hp / playerData.maxHp));
                            healthBar.width = HEALTH_BAR_WIDTH * healthPercentage;
                            
                            // Position the health bar (it's left-aligned)
                            healthBar.x = -HEALTH_BAR_WIDTH / 2;
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

    updateOtherPlayerPosition(identity: Identity, x: number, y: number) {
        const container = this.otherPlayers.get(identity);
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

    removeOtherPlayer(identity: Identity) {
        const container = this.otherPlayers.get(identity);
        if (container) {
            container.destroy();
            this.otherPlayers.delete(identity);
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
        
        if ((directionChanged || (hasDirection && timeForUpdate))) {
            
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
            
            // Move the player sprite
            this.localPlayerSprite.x += dx;
            this.localPlayerSprite.y += dy;
            
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
        }
        
        // If server has sent an updated position that's far from our prediction, correct it
        if (this.serverPosition && this.localPlayerSprite) {
            const distX = this.serverPosition.x - this.localPlayerSprite.x;
            const distY = this.serverPosition.y - this.localPlayerSprite.y;
            const distSquared = distX * distX + distY * distY;
            
            // If difference is significant (more than 10 pixels), interpolate toward server position
            if (distSquared > 100) {
                
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
            }
        }
        
        // Update depths for other players as well
        this.otherPlayers.forEach((container) => {
            container.setDepth(BASE_DEPTH + container.y);
        });
        
        // Update monster positions with interpolation
        this.monsterManager.update(time, delta);
    }

    // Force a synchronization of player entities
    syncPlayers() {
        console.log("Forcing player sync...");
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("Cannot sync players: SpacetimeDB client, identity, or tables not available");
            return;
        }

        const localIdentity = this.spacetimeDBClient.identity;
        
        // Get the local account to find the current player ID
        const localAccount = this.spacetimeDBClient.sdkConnection.db.account.identity.find(localIdentity) as Account;
        if (!localAccount) {
            console.error("Local account not found during sync!");
            return;
        }
        
        const allPlayers = Array.from(this.spacetimeDBClient.sdkConnection.db.player.iter());
        const allEntities = Array.from(this.spacetimeDBClient.sdkConnection.db.entity.iter());
        const allAccounts = Array.from(this.spacetimeDBClient.sdkConnection.db.account.iter());
        
        console.log(`Syncing ${allPlayers.length} players with ${allEntities.length} entities and ${allAccounts.length} accounts`);
        
        // First, handle local player if not already created
        if (!this.localPlayerSprite && localAccount.currentPlayerId > 0) {
            const localPlayer = allPlayers.find(p => p.playerId === localAccount.currentPlayerId);
            if (localPlayer) {
                const entityData = allEntities.find(e => e.entityId === localPlayer.entityId);
                if (entityData) {
                    console.log(`Creating local player during sync: ${localPlayer.name} at (${entityData.position.x}, ${entityData.position.y})`);
                    this.handleEntityUpdate(entityData);
                } else {
                    console.warn(`Entity data not found for local player (entityId: ${localPlayer.entityId})`);
                }
            } else {
                console.warn(`Local player data not found in player table during sync`);
            }
        }
        
        // Then handle all other players
        for (const player of allPlayers) {
            // Find which account owns this player
            const ownerAccount = allAccounts.find(a => a.currentPlayerId === player.playerId);
            if (!ownerAccount) {
                console.warn(`Could not find account for player ${player.playerId}`);
                continue;
            }
            
            // Skip local player
            if (ownerAccount.identity.isEqual(localIdentity)) {
                continue;
            }
            
            const entityData = allEntities.find(e => e.entityId === player.entityId);
            if (entityData) {
                // Check if this player already has a sprite
                const existingContainer = this.otherPlayers.get(ownerAccount.identity);
                if (!existingContainer) {
                    // Create the sprite directly - this bypasses the normal flow but ensures
                    // the sprite is created immediately - pass the ownerAccount
                    this.createOtherPlayerSprite(player, entityData, ownerAccount);
                } else {
                    // Just update position if sprite already exists
                    this.updateOtherPlayerPosition(ownerAccount.identity, entityData.position.x, entityData.position.y);
                }
            } else {
                console.warn(`Entity data not found for player ${player.name} (entityId: ${player.entityId})`);
            }
        }
        
        // Debug output of all tracked players
        console.log(`Total tracked other players after sync: ${this.otherPlayers.size}`);
    }

    // Helper function to find an entity's position by ID
    private getEntityPosition(entityId: number): { x: number, y: number } | null {
        // Try to find the entity in the local cache before it gets removed
        const entities = Array.from(this.spacetimeDBClient.sdkConnection?.db.entity.iter() || []);
        for (const entity of entities) {
            if (entity.entityId === entityId) {
                return { x: entity.position.x, y: entity.position.y };
            }
        }
        
        // If we have a local player and this is its entity ID
        if (this.localPlayerSprite && this.spacetimeDBClient?.identity) {
            // Get the local account first
            const localAccount = this.spacetimeDBClient.sdkConnection?.db.account.identity.find(
                this.spacetimeDBClient.identity
            );
            
            if (localAccount && localAccount.currentPlayerId > 0) {
                // Then get the player from the account's currentPlayerId
                const localPlayer = this.spacetimeDBClient.sdkConnection?.db.player.player_id.find(
                    localAccount.currentPlayerId
                );
                
                if (localPlayer && localPlayer.entityId === entityId) {
                    return { 
                        x: this.localPlayerSprite.x, 
                        y: this.localPlayerSprite.y 
                    };
                }
            }
        }
        
        // Check other players
        for (const [identity, container] of this.otherPlayers.entries()) {
            // Find the account with this identity
            const account = this.spacetimeDBClient.sdkConnection?.db.account.identity.find(identity);
            if (account && account.currentPlayerId > 0) {
                // Find the player with this account's player ID
                const player = this.spacetimeDBClient.sdkConnection?.db.player.player_id.find(account.currentPlayerId);
                if (player && player.entityId === entityId) {
                    return { 
                        x: container.x, 
                        y: container.y 
                    };
                }
            }
        }
        
        return null;
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
}