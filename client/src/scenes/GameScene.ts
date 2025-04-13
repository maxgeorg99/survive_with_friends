import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Entity, PlayerClass, UpdatePlayerDirection } from "../autobindings";
import { Identity } from '@clockworklabs/spacetimedb-sdk';

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
const HEALTH_BAR_OFFSET_Y = 5;

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
                console.log(`Pointer move target set to: (${this.tapTarget.x}, ${this.tapTarget.y})`);
                this.updateTapMarker();
            }
        });
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.localPlayerSprite) {
                this.tapTarget = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
                console.log(`Pointer down target set to: (${this.tapTarget.x}, ${this.tapTarget.y})`);
                this.updateTapMarker();
            }
        });
        this.input.on('pointerup', () => {
            // Don't clear tap target, we want to continue moving toward the target
        });

        // Create tap marker using shape graphics instead of texture
        // This is more reliable than the texture generation approach
        console.log("Creating tap marker...");
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
            console.log("Tap marker created:", this.tapMarker.visible, this.tapMarker.depth);
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
        const localPlayerData = this.spacetimeDBClient.sdkConnection?.db.player.identity.find(localIdentity) as Player;
        if (!localPlayerData) {
            console.error("Local player data not found!");
            return; // Cannot proceed without local player
        }
        
        console.log("Local player data found:", localPlayerData);
        console.log("Looking for entity with ID:", localPlayerData.entityId);

        // Debug: Check all entity tables
        console.log("Entities in DB:", 
            Array.from(this.spacetimeDBClient.sdkConnection?.db.entity.iter() || [])
                .map(e => `Entity ID: ${e.entityId} at (${e.position.x},${e.position.y})`));
                
        // Get the entity associated with the local player - use the correct property name
        const localEntityData = this.spacetimeDBClient.sdkConnection?.db.entity.entity_id.find(localPlayerData.entityId);
        
        if (!localEntityData) {
            // Log that we are waiting, but don't create the sprite yet.
            // The Entity.onInsert/onUpdate listener will handle creation/positioning when data arrives.
            console.warn(`Entity data not found for local player ${localPlayerData.identity.toHexString()} (entityId: ${localPlayerData.entityId}). Waiting for entity data...`);
             // Optionally: You could set a flag here to indicate we are waiting for the entity
             // return; // Or simply return if you don't want to proceed further without the entity
        } else {
            console.log(`Creating local player sprite for ${localPlayerData.name} at (${localEntityData.position.x}, ${localEntityData.position.y})`);
            const startX = Math.floor(localEntityData.position.x);
            const startY = Math.floor(localEntityData.position.y);
            
            // Get local player data for the name
            let playerName = 'Player';
            let playerClass = PlayerClass.Fighter; // Default class
            let playerLevel = 1; // Default level
            try {
                if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                    const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.identity.find(
                        this.spacetimeDBClient.identity as any as Identity
                    );
                    if (localPlayer?.name) {
                        playerName = localPlayer.name;
                    }
                    if (localPlayer?.playerClass) {
                        playerClass = localPlayer.playerClass;
                    }
                    if (localPlayer?.level) {
                        playerLevel = localPlayer.level;
                    }
                }
            } catch (error) {
                console.error("Error getting player name:", error);
            }
            
            // Get class-specific sprite key
            const classKey = this.getClassSpriteKey(playerClass);
            console.log(`Creating local player with sprite key: ${classKey}`);
            this.localPlayerSprite = this.physics.add.sprite(startX, startY, classKey);
            // Debug sprite creation and properties
            console.log("Sprite created:", 
                this.localPlayerSprite ? "YES" : "NO",
                "Visible:", this.localPlayerSprite?.visible,
                "Position:", this.localPlayerSprite?.x, this.localPlayerSprite?.y,
                "Frame:", this.localPlayerSprite?.frame?.name);
            this.localPlayerSprite.setDepth(1);
            this.localPlayerNameText = this.add.text(
                startX, 
                startY - Math.floor(this.localPlayerSprite.height / 2) - 10, 
                `${playerName} (${playerLevel})`, 
                PLAYER_NAME_STYLE
            ).setOrigin(0.5, 0.5);
            this.localPlayerNameText.setDepth(2); // Ensure name is above sprite
            
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
                startX,
                startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                HEALTH_BAR_WIDTH * (localPlayerData.hp / localPlayerData.maxHp),
                HEALTH_BAR_HEIGHT,
                0x00FF00,
                1
            ).setOrigin(0, 0.5);
            healthBar.x -= HEALTH_BAR_WIDTH / 2; // Adjust position to align with background
            
            // Set health bar properties
            healthBarBackground.setDepth(1.5);
            healthBar.setDepth(1.6);
            
            // Store health bar references
            this.localPlayerSprite.setData('healthBarBackground', healthBarBackground);
            this.localPlayerSprite.setData('healthBar', healthBar);
            this.localPlayerSprite.setData('hp', localPlayerData.hp);
            this.localPlayerSprite.setData('maxHp', localPlayerData.maxHp);
            
            // Shadow
            this.localPlayerShadow = this.add.image(startX, startY + SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
                .setAlpha(SHADOW_ALPHA)
                .setDepth(0); // Set shadow depth explicitly below sprite
            
            this.localPlayerSprite.setCollideWorldBounds(true);

            // --- Camera Setup (Only if sprite exists) ---
            // Make camera follow instantly (lerp = 1)
            this.cameras.main.startFollow(this.localPlayerSprite, true, 1, 1);
            this.cameras.main.setBounds(0, 0, worldSize, worldSize);
            this.cameras.main.setZoom(1);
            this.cameras.main.setRoundPixels(true); // Enable pixel rounding
        }

        // Move SpacetimeDB listener registration *before* player iteration
        // to ensure listeners are active when processing existing players.
        this.registerSpacetimeDBListeners();

        // Initialize existing players already in the DB
        console.log("Initializing existing players from SpacetimeDB...");
        // This loop might need adjustment if addOrUpdateOtherPlayer relies on localPlayerSprite being set
        for (const player of this.spacetimeDBClient.sdkConnection?.db.player.iter()) {
             if (!player.identity.isEqual(localIdentity)) {
                console.log(`Found existing player: ${player.name}`);
                this.addOrUpdateOtherPlayer(player as Player);
            }
        }

        // --- SpacetimeDB Listeners ---
        // this.registerSpacetimeDBListeners(); // Moved earlier

        console.log("Game world initialization checks complete."); // Message changed slightly
    }

    registerSpacetimeDBListeners() {
        console.log("Registering SpacetimeDB listeners...");
        // Ensure client and tables are ready
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("Attempted to register listeners without valid client/identity/tables.");
            return;
        }
        const localIdentity = this.spacetimeDBClient.identity;

        // Log all existing players and entities at startup
        console.log("=== EXISTING PLAYERS AT STARTUP ===");
        const existingPlayers = Array.from(this.spacetimeDBClient.sdkConnection.db.player.iter());
        console.log(`Total player count: ${existingPlayers.length}`);
        existingPlayers.forEach(p => {
            console.log(`Player: ${p.name} (ID: ${p.identity.toHexString()}, EntityID: ${p.entityId})`);
        });
        
        console.log("=== EXISTING ENTITIES AT STARTUP ===");
        const existingEntities = Array.from(this.spacetimeDBClient.sdkConnection.db.entity.iter());
        console.log(`Total entity count: ${existingEntities.length}`);
        existingEntities.forEach(e => {
            console.log(`Entity ID: ${e.entityId} at (${e.position.x}, ${e.position.y})`);
        });

        // Use the table handle to register listeners with correct signatures
        this.spacetimeDBClient.sdkConnection?.db.player.onInsert((_ctx, player: Player) => {
            if (!this.isPlayerDataReady) return;
            console.log(`Player.onInsert: ${player.name} (ID: ${player.identity.toHexString()}, EntityID: ${player.entityId})`);
            if (!player.identity.isEqual(localIdentity)) {
                this.addOrUpdateOtherPlayer(player);
            }
        });

        this.spacetimeDBClient.sdkConnection?.db.player.onUpdate((_ctx, oldPlayer: Player, newPlayer: Player) => {
            if (!this.isPlayerDataReady) return;
            if (!newPlayer.identity.isEqual(localIdentity)) {
                this.addOrUpdateOtherPlayer(newPlayer);
            } else {
                // Update local player name if it changes
                if (this.localPlayerNameText && newPlayer.name && this.localPlayerNameText.text !== newPlayer.name) {
                    console.log(`Updating local player name to: ${newPlayer.name}`);
                    this.localPlayerNameText.setText(newPlayer.name);
                }
                 // Local entity updates are handled by handleEntityUpdate
            }
        });

        this.spacetimeDBClient.sdkConnection?.db.player.onDelete((_ctx, player: Player) => {
            if (!this.isPlayerDataReady) return;
            console.log(`Player.onDelete: ${player.name} (ID: ${player.identity.toHexString()})`);
            if (!player.identity.isEqual(localIdentity)) {
                this.removeOtherPlayer(player.identity);
            }
        });

         // Also listen for Entity updates to move sprites
         this.spacetimeDBClient.sdkConnection?.db.entity.onInsert((_ctx, entity: Entity) => {
            this.handleEntityUpdate(entity);
        });
        this.spacetimeDBClient.sdkConnection?.db.entity.onUpdate((_ctx, _oldEntity: Entity, newEntity: Entity) => {
            this.handleEntityUpdate(newEntity);
        });
         // Entity.onDelete might need handling if entities can exist without players
         // tables.entity.onDelete((_ctx, entity: Entity) => { ... });

        console.log("SpacetimeDB listeners registered.");
    }

    // Helper function to handle entity updates and move corresponding sprites
    handleEntityUpdate(entityData: Entity) {
        console.log(`Entity update received: ID ${entityData.entityId} at pos (${entityData.position.x}, ${entityData.position.y})`);
        
        // Debug: Log all entities in cache to verify state
        const allEntities = Array.from(this.spacetimeDBClient.sdkConnection?.db.entity.iter() || []);
        console.log(`Current entity cache has ${allEntities.length} entities:`);
        allEntities.forEach(e => console.log(`  Entity ID: ${e.entityId} at (${e.position.x}, ${e.position.y})`));
        
        // Get local player EntityId
        let localPlayerEntityId: number | undefined = undefined;
        try {
            if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.identity.find(
                    this.spacetimeDBClient.identity as any as Identity
                );
                if (localPlayer) {
                    localPlayerEntityId = localPlayer.entityId;
                }
            }
        } catch (error) {
            console.error("Error getting local player entity ID:", error);
        }
        
        // Check if this entity update is for the local player
        if (localPlayerEntityId === entityData.entityId) {
            console.log(`Local player entity updated: ${entityData.entityId}`);
            
            // If local player sprite doesn't exist yet, create it now
            if (!this.localPlayerSprite) {
                console.log(`Creating local player sprite from entity update at (${entityData.position.x}, ${entityData.position.y})`);
                const startX = Math.floor(entityData.position.x);
                const startY = Math.floor(entityData.position.y);
                
                // Get local player data for the name
                let playerName = 'Player';
                let playerClass = PlayerClass.Fighter; // Default class
                let playerLevel = 1; // Default level
                try {
                    if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                        const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.identity.find(
                            this.spacetimeDBClient.identity as any as Identity
                        );
                        if (localPlayer?.name) {
                            playerName = localPlayer.name;
                        }
                        if (localPlayer?.playerClass) {
                            playerClass = localPlayer.playerClass;
                        }
                        if (localPlayer?.level) {
                            playerLevel = localPlayer.level;
                        }
                    }
                } catch (error) {
                    console.error("Error getting player name:", error);
                }
                
                // Get class-specific sprite key
                const classKey = this.getClassSpriteKey(playerClass);
                console.log(`Creating local player with sprite key: ${classKey}`);
                this.localPlayerSprite = this.physics.add.sprite(startX, startY, classKey);
                this.localPlayerSprite.setDepth(1);
                this.localPlayerNameText = this.add.text(startX, startY - Math.floor(this.localPlayerSprite.height / 2) - 10, 
                    `${playerName} (${playerLevel})`, PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
                this.localPlayerNameText.setDepth(2);
                this.localPlayerShadow = this.add.image(startX, startY + SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
                    .setAlpha(SHADOW_ALPHA)
                    .setDepth(0);
                this.localPlayerSprite.setCollideWorldBounds(true);

                // Camera follow
                this.cameras.main.startFollow(this.localPlayerSprite, true, 1, 1);
                this.cameras.main.setRoundPixels(true);
            }
            
            // Store server position for interpolation
            this.serverPosition = new Phaser.Math.Vector2(entityData.position.x, entityData.position.y);
            return;
        }
        
        // Logic for other player entities
        // Find the player who owns this entity in pending players
        const pendingPlayer = this.pendingPlayers.get(entityData.entityId);
        if (pendingPlayer) {
            console.log(`Found pending player for entity ${entityData.entityId}. Creating sprite directly.`);
            
            // IMPROVED: Create player sprite directly with entity data instead of trying to look it up again
            this.createOtherPlayerSprite(pendingPlayer, entityData);
            
            // Remove from pending
            this.pendingPlayers.delete(entityData.entityId);
            return;
        }

        // Check if this entity belongs to a player we know about
        for (const player of this.spacetimeDBClient.sdkConnection?.db.player.iter() || []) {
            if (player.entityId === entityData.entityId) {
                // Cast player to Player
                const extendedPlayer = player as Player;
                console.log(`Found player ${player.name} for entity ${entityData.entityId}`);
                this.updateOtherPlayerPosition(player.identity, entityData.position.x, entityData.position.y);
                return;
            }
        }
        
        console.warn(`Entity update received for unknown entity: ${entityData.entityId}`);
    }

    // Get class-specific sprite key
    getClassSpriteKey(playerClass: any): string {
        console.log("PlayerClass value:", playerClass);
        console.log("PlayerClass type:", typeof playerClass);
        
        // Handle case when playerClass is a simple object with a tag property
        if (playerClass && typeof playerClass === 'object' && 'tag' in playerClass) {
            const className = playerClass.tag;
            console.log("Found tag property:", className);
            const spriteKey = CLASS_ASSET_KEYS[className] || 'player_fighter';
            console.log(`Using sprite key '${spriteKey}' for class '${className}'`);
            return spriteKey;
        } 
        
        // Handle case when playerClass is just a string
        if (typeof playerClass === 'string') {
            console.log("PlayerClass is a string:", playerClass);
            const spriteKey = CLASS_ASSET_KEYS[playerClass] || 'player_fighter';
            console.log(`Using sprite key '${spriteKey}' for string class '${playerClass}'`);
            return spriteKey;
        }
        
        // Handle case when playerClass is a number (enum value)
        if (typeof playerClass === 'number') {
            console.log("PlayerClass is a number:", playerClass);
            // Map numeric enum values to class names
            const classNames = ["Fighter", "Rogue", "Mage", "Paladin"];
            const className = classNames[playerClass] || "Fighter";
            console.log("Mapped to class name:", className);
            const spriteKey = CLASS_ASSET_KEYS[className] || 'player_fighter';
            console.log(`Using sprite key '${spriteKey}' for numeric class ${playerClass} (${className})`);
            return spriteKey;
        }
        
        // Default fallback
        console.log("Using default fighter class");
        return 'player_fighter';
    }
    
    // Update the function to properly use the player's class
    createOtherPlayerSprite(playerData: Player, entityData: Entity) {
        console.log(`Creating player sprite for ${playerData.name} at (${entityData.position.x}, ${entityData.position.y})`);
        
        // Check if we already have this player
        if (this.otherPlayers.has(playerData.identity)) {
            console.log(`Player ${playerData.name} already has a sprite, updating position`);
            this.updateOtherPlayerPosition(playerData.identity, entityData.position.x, entityData.position.y);
            return;
        }
        
        // Create new player container with shadow, sprite and name
        const shadow = this.add.image(0, SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
            .setAlpha(SHADOW_ALPHA)
            .setDepth(-1);
        
        // Get class-specific sprite
        const classKey = this.getClassSpriteKey(playerData.playerClass);
        const sprite = this.add.sprite(0, 0, classKey);
        
        // Display name with level
        const displayName = `${playerData.name} (${playerData.level})`;
        const text = this.add.text(
            0, 
            -Math.floor(sprite.height / 2) - 10, 
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
        
        // Round position on creation
        const startX = Math.floor(entityData.position.x);
        const startY = Math.floor(entityData.position.y);
        
        // Create container and add all elements
        const container = this.add.container(startX, startY, [shadow, sprite, text, healthBarBackground, healthBar]);
        container.setData('entityId', entityData.entityId);
        container.setData('hp', playerData.hp);
        container.setData('maxHp', playerData.maxHp);
        
        // Store in our players map
        this.otherPlayers.set(playerData.identity, container);
        
        console.log(`Created container for player ${playerData.name} with ${container.length} children.`);
    }

    addOrUpdateOtherPlayer(playerData: Player) {
        // Check if we are already tracking this player
        let container = this.otherPlayers.get(playerData.identity);
        console.log(`Adding/updating player ${playerData.name} (ID: ${playerData.identity.toHexString()}, EntityID: ${playerData.entityId})`);
        console.log(`Already tracked in otherPlayers: ${container ? 'YES' : 'NO'}`);

        // If container exists, just update the name if needed
        if (container) {
            console.log(`Container exists for player ${playerData.name}, updating data`);
            container.setData('entityId', playerData.entityId);
            
            // Update player name with level
            const text = container.getAt(2) as Phaser.GameObjects.Text;
            const displayName = `${playerData.name} (${playerData.level})`;
            if (text.text !== displayName) {
                console.log(`Updating name for player ${playerData.identity.toHexString()} to ${displayName}`);
                text.setText(displayName);
            }
            
            // Update player health
            container.setData('hp', playerData.hp);
            container.setData('maxHp', playerData.maxHp);
            
            // Update health bar
            const healthBar = container.getAt(4) as Phaser.GameObjects.Rectangle;
            const healthPercentage = playerData.hp / playerData.maxHp;
            healthBar.width = HEALTH_BAR_WIDTH * healthPercentage;
            
            return;
        }

        // Attempt to find the entity data in the client cache
        const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entity_id.find(playerData.entityId);
        console.log(`Entity found for player ${playerData.name}: ${entityData ? 'YES' : 'NO'}`);

        // If entity data exists, create the sprite immediately
        if (entityData) {
            this.createOtherPlayerSprite(playerData, entityData);
            return;
        }
        
        // Otherwise store player as pending
        console.warn(`Entity not found for player ${playerData.name} (entityId: ${playerData.entityId}). Storing as pending.`);
        this.pendingPlayers.set(playerData.entityId, playerData);
        console.log(`Total pending players: ${this.pendingPlayers.size}`);
    }

    updateTapMarker() {
        if (!this.tapMarker) {
            console.warn("Cannot update tap marker - it doesn't exist!");
            return;
        }
        
        if (this.tapTarget) {
            console.log(`Updating tap marker to position: (${this.tapTarget.x}, ${this.tapTarget.y})`);
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
            console.log("Tap marker visibility:", this.tapMarker.visible);
        } else {
            console.log("Hiding tap marker - no target");
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
                ease: 'Linear'
            });
        }
    }

    removeOtherPlayer(identity: Identity) {
        const container = this.otherPlayers.get(identity);
        if (container) {
            console.log(`Removing player sprite for identity ${identity.toHexString()}`);
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
        
        // Handle keyboard input
        if (this.cursors) {
            if (this.cursors.left?.isDown) dirX -= 1;
            if (this.cursors.right?.isDown) dirX += 1;
            if (this.cursors.up?.isDown) dirY -= 1;
            if (this.cursors.down?.isDown) dirY += 1;
        }
        
        // Handle WASD keyboard input
        if (this.wasdKeys) {
            if (this.wasdKeys.A.isDown) dirX -= 1;
            if (this.wasdKeys.D.isDown) dirX += 1;
            if (this.wasdKeys.W.isDown) dirY -= 1;
            if (this.wasdKeys.S.isDown) dirY += 1;
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
            // Debug log for direction updates
            console.log(`Sending direction update: (${dirX}, ${dirY})`);
            
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
            
            // Update UI elements position
            if (this.localPlayerNameText) {
                this.localPlayerNameText.x = this.localPlayerSprite.x;
                this.localPlayerNameText.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - 10;
            }
            
            // Update shadow position
            if (this.localPlayerShadow) {
                this.localPlayerShadow.x = this.localPlayerSprite.x;
                this.localPlayerShadow.y = this.localPlayerSprite.y + SHADOW_OFFSET_Y;
            }
            
            // Update health bar position
            const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
            const healthBar = this.localPlayerSprite.getData('healthBar');
            if (healthBarBackground && healthBar) {
                healthBarBackground.x = this.localPlayerSprite.x;
                healthBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                healthBar.x = this.localPlayerSprite.x - (HEALTH_BAR_WIDTH / 2);
                healthBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
            }
        }
        
        // If server has sent an updated position that's far from our prediction, correct it
        if (this.serverPosition && this.localPlayerSprite) {
            const distX = this.serverPosition.x - this.localPlayerSprite.x;
            const distY = this.serverPosition.y - this.localPlayerSprite.y;
            const distSquared = distX * distX + distY * distY;
            
            // If difference is significant (more than 10 pixels), interpolate toward server position
            if (distSquared > 100) {
                console.log(`Correcting position. Client: (${this.localPlayerSprite.x}, ${this.localPlayerSprite.y}), Server: (${this.serverPosition.x}, ${this.serverPosition.y})`);
                
                // Interpolate position
                this.localPlayerSprite.x += distX * INTERPOLATION_SPEED;
                this.localPlayerSprite.y += distY * INTERPOLATION_SPEED;
                
                // Update UI elements with interpolated position
                if (this.localPlayerNameText) {
                    this.localPlayerNameText.x = this.localPlayerSprite.x;
                    this.localPlayerNameText.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - 10;
                }
                
                if (this.localPlayerShadow) {
                    this.localPlayerShadow.x = this.localPlayerSprite.x;
                    this.localPlayerShadow.y = this.localPlayerSprite.y + SHADOW_OFFSET_Y;
                }
                
                // Update health bar with interpolated position
                const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
                const healthBar = this.localPlayerSprite.getData('healthBar');
                if (healthBarBackground && healthBar) {
                    healthBarBackground.x = this.localPlayerSprite.x;
                    healthBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                    healthBar.x = this.localPlayerSprite.x - (HEALTH_BAR_WIDTH / 2);
                    healthBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                }
            }
        }
    }
}