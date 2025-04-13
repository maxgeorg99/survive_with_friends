import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Entity } from "../autobindings";
import { UpdatePlayerPosition } from "../autobindings";
import { Identity } from '@clockworklabs/spacetimedb-sdk';

// Constants
const PLAYER_SPEED = 200;
const PLAYER_ASSET_KEY = 'player_fighter_1';
const GRASS_ASSET_KEY = 'grass_background';
const PLAYER_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
    fontSize: '16px',
    fontFamily: 'Arial',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
};

export default class GameScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private localPlayerSprite: Phaser.Physics.Arcade.Sprite | null = null;
    private localPlayerNameText: Phaser.GameObjects.Text | null = null;
    private otherPlayers: Map<Identity, Phaser.GameObjects.Container> = new Map();
    // Map to hold player data waiting for corresponding entity data (keyed by entityId)
    private pendingPlayers: Map<number, Player> = new Map();
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
    private backgroundTile: Phaser.GameObjects.TileSprite | null = null;
    private isPlayerDataReady = false;

    constructor() {
        super('GameScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        console.log("GameScene constructor called.");
    }

    preload() {
        console.log("GameScene preload started.");
        // Load assets from the /assets path (copied from public)
        this.load.image(PLAYER_ASSET_KEY, '/assets/class_fighter_1.png');
        this.load.image(GRASS_ASSET_KEY, '/assets/grass.png');
        console.log("GameScene preload finished.");
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

        // Setup touch input
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown && this.localPlayerSprite) {
                this.movePlayerTowards(pointer.worldX, pointer.worldY);
            }
        });
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
             if (this.localPlayerSprite) {
                this.movePlayerTowards(pointer.worldX, pointer.worldY);
            }
        });
        this.input.on('pointerup', () => {
             if (this.localPlayerSprite) {
                 this.localPlayerSprite.setVelocity(0, 0);
             }
        });

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
        const localPlayerData = this.spacetimeDBClient.sdkConnection?.db.player.identity.find(localIdentity);
        if (!localPlayerData) {
            console.error("Local player data not found!");
            return; // Cannot proceed without local player
        }
        // Get the entity associated with the local player
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
            this.localPlayerSprite = this.physics.add.sprite(startX, startY, PLAYER_ASSET_KEY);
            this.localPlayerNameText = this.add.text(startX, startY - Math.floor(this.localPlayerSprite.height / 2) - 10, localPlayerData.name || 'Player', PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
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
                this.addOrUpdateOtherPlayer(player);
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

        // Use the table handle to register listeners with correct signatures
        this.spacetimeDBClient.sdkConnection?.db.player.onInsert((_ctx, player: Player) => {
            if (!this.isPlayerDataReady) return;
            console.log(`Player.onInsert: ${player.name} (ID: ${player.identity.toHexString()})`);
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
         if (!this.isPlayerDataReady || !this.spacetimeDBClient?.sdkConnection?.db || !this.spacetimeDBClient?.identity) return;
         const localIdentity = this.spacetimeDBClient.identity;

         // Check if this entity update is for the local player
         const localPlayer = this.spacetimeDBClient.sdkConnection?.db.player.identity.find(localIdentity);
         if (localPlayer && localPlayer.entityId === entityData.entityId) {
             if (!this.localPlayerSprite) {
                 // Sprite doesn't exist yet, create it now that we have entity data
                 console.log(`Creating local player sprite (via entity update) for ${localPlayer.name} at (${entityData.position.x}, ${entityData.position.y})`);
                 const startX = Math.floor(entityData.position.x);
                 const startY = Math.floor(entityData.position.y);
                 this.localPlayerSprite = this.physics.add.sprite(startX, startY, PLAYER_ASSET_KEY);
                 this.localPlayerNameText = this.add.text(startX, startY - Math.floor(this.localPlayerSprite.height / 2) - 10, localPlayer.name || 'Player', PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
                 this.localPlayerSprite.setCollideWorldBounds(true);

                // --- Camera Setup ---
                const worldSize = this.physics.world.bounds.width; // Or pass it in/get from config
                // Make camera follow instantly (lerp = 1)
                this.cameras.main.startFollow(this.localPlayerSprite, true, 1, 1);
                this.cameras.main.setBounds(0, 0, worldSize, worldSize);
                this.cameras.main.setZoom(1);
                this.cameras.main.setRoundPixels(true); // Enable pixel rounding here too
                console.log("Local player sprite and camera initialized via handleEntityUpdate.")
             } else {
                 // Sprite exists, potential server reconciliation logic could go here
                 // console.debug(`Received entity update for existing local player sprite: ${entityData.entityId}`);
                // For now, we assume client-side prediction handles movement, so we don't reposition here.
                 // If server reconciliation is needed, update sprite position here:
                 // this.localPlayerSprite.setPosition(entityData.position.x, entityData.position.y);
             }
             return; // Handled local player update
         }

         // Check if this entity update corresponds to a player waiting for entity data
         if (this.pendingPlayers.has(entityData.entityId)) {
             const pendingPlayerData = this.pendingPlayers.get(entityData.entityId)!;
             console.log(`Entity data received for pending player ${pendingPlayerData.name} (Entity ID: ${entityData.entityId}). Creating sprite now.`);
             this.pendingPlayers.delete(entityData.entityId); // Remove from pending

             // Now create the actual player sprite using both player and entity data
             // Ensure we don't accidentally re-add if it somehow got created between checks
             if (!this.otherPlayers.has(pendingPlayerData.identity)) {
                 console.log(`Creating new player sprite for pending player ${pendingPlayerData.name} at (${entityData.position.x}, ${entityData.position.y})`);
                 const sprite = this.add.sprite(0, 0, PLAYER_ASSET_KEY);
                 const text = this.add.text(0, -Math.floor(sprite.height / 2) - 10, pendingPlayerData.name || 'Player', PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
                 const startX = Math.floor(entityData.position.x);
                 const startY = Math.floor(entityData.position.y);
                 const container = this.add.container(startX, startY, [sprite, text]);
                 container.setData('entityId', entityData.entityId); // Store entityId
                 this.otherPlayers.set(pendingPlayerData.identity, container);
             } else {
                console.warn(`Tried to create pending player ${pendingPlayerData.name}, but they already exist in otherPlayers map.`);
                // If it already exists, maybe just update its position?
                this.updateOtherPlayerPosition(pendingPlayerData.identity, entityData.position.x, entityData.position.y);
             }
             return; // Handled pending player creation
         }

         // If not a local player and not a pending player, it must be an update for an existing other player.
         // Find the other player's container associated with this entityId
         let foundPlayerIdentity: Identity | null = null;
         for (const [identity, container] of this.otherPlayers.entries()) {
            if (container.getData('entityId') === entityData.entityId) {
                foundPlayerIdentity = identity;
                break;
            }
        }

        if (foundPlayerIdentity) {
             // This entity belongs to another player we know about
            console.debug(`Received entity update for other player: ${entityData.entityId}, Identity: ${foundPlayerIdentity.toHexString()}`);
            this.updateOtherPlayerPosition(foundPlayerIdentity, entityData.position.x, entityData.position.y);
        } else {
            // Entity update received, but we don't have a corresponding player sprite yet.
            // This might happen if Entity.onInsert arrives before Player.onInsert.
            // We could potentially trigger a check here or wait for Player.onInsert.
            console.warn(`Received entity update for unknown player (Entity ID: ${entityData.entityId})`);
        }
    }

    addOrUpdateOtherPlayer(playerData: Player) {
         // Check if we are already tracking this player
         let container = this.otherPlayers.get(playerData.identity);

         // Attempt to find the entity data in the client cache
         const entityData = this.spacetimeDBClient.sdkConnection?.db.entity.entity_id.find(playerData.entityId);

         if (!entityData) {
             // Entity data not yet available in client cache. Store player data and wait for Entity update.
             console.warn(`Entity not found for player ${playerData.name} (entityId: ${playerData.entityId}) when trying to add/update. Storing as pending.`);
             this.pendingPlayers.set(playerData.entityId, playerData);
             return; // Don't create container yet
         }

         // Entity data found! Ensure player is removed from pending map if they were there
         if (this.pendingPlayers.has(playerData.entityId)) {
             console.log(`Entity data arrived for pending player ${playerData.name}. Removing from pending.`);
             this.pendingPlayers.delete(playerData.entityId);
         }

        if (container) {
             // Update existing container
             container.setData('entityId', playerData.entityId); // Ensure entityId is up-to-date
             // Round position when updating existing container
             container.setPosition(Math.floor(entityData.position.x), Math.floor(entityData.position.y));
             const text = container.getAt(1) as Phaser.GameObjects.Text;
            if (text.text !== playerData.name) {
                 console.log(`Updating name for player ${playerData.identity.toHexString()} to ${playerData.name}`);
                 text.setText(playerData.name || 'Player');
             }
         } else {
             // Create new player sprite and text container
             console.log(`Adding new player sprite for ${playerData.name} at (${entityData.position.x}, ${entityData.position.y})`);
             const sprite = this.add.sprite(0, 0, PLAYER_ASSET_KEY);
             const text = this.add.text(0, -Math.floor(sprite.height / 2) - 10, playerData.name || 'Player', PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
             // Round position on creation
             const startX = Math.floor(entityData.position.x);
             const startY = Math.floor(entityData.position.y);
             container = this.add.container(startX, startY, [sprite, text]);
             container.setData('entityId', entityData.entityId); // Store entityId on creation
             this.otherPlayers.set(playerData.identity, container);
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

    movePlayerTowards(targetX: number, targetY: number) {
        if (!this.localPlayerSprite) return;
        const angle = Phaser.Math.Angle.Between(this.localPlayerSprite.x, this.localPlayerSprite.y, targetX, targetY);
        this.physics.velocityFromRotation(angle, PLAYER_SPEED, this.localPlayerSprite.body?.velocity);
    }

    update(_time: number, delta: number) {
        if (!this.isPlayerDataReady || !this.localPlayerSprite || !this.localPlayerNameText || !this.cursors || !this.spacetimeDBClient?.sdkConnection?.reducers) {
            return; // Don't run update logic until player and reducers are ready
        }

        const velocity = new Phaser.Math.Vector2(0, 0);
        let isMoving = false;

        // Keyboard movement
        if (this.cursors.left?.isDown || this.input.keyboard?.addKey('A').isDown) {
            velocity.x = -1;
            isMoving = true;
        }
        if (this.cursors.right?.isDown || this.input.keyboard?.addKey('D').isDown) {
            velocity.x = 1;
            isMoving = true;
        }
        if (this.cursors.up?.isDown || this.input.keyboard?.addKey('W').isDown) {
            velocity.y = -1;
            isMoving = true;
        }
        if (this.cursors.down?.isDown || this.input.keyboard?.addKey('S').isDown) {
            velocity.y = 1;
            isMoving = true;
        }

        // Normalize velocity and apply speed
        if (isMoving) {
            velocity.normalize().scale(PLAYER_SPEED);
            this.localPlayerSprite.setVelocity(velocity.x, velocity.y);
        } else {
             // Stop movement if no keyboard input is detected and not currently moving via touch
            if (!this.input.activePointer.isDown) {
                 this.localPlayerSprite.setVelocity(0, 0);
            }
        }

        // Round the sprite's position *after* physics velocity is applied
        this.localPlayerSprite.x = Math.floor(this.localPlayerSprite.x);
        this.localPlayerSprite.y = Math.floor(this.localPlayerSprite.y);

        // Update name text position, using the now-rounded sprite coordinates
        this.localPlayerNameText.setPosition(
            this.localPlayerSprite.x, // Already rounded
            this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - 10
        );

        // --- Network Update ---
        const currentVelocity = this.localPlayerSprite?.body?.velocity;
        // Only send update if moving
        if (currentVelocity && (currentVelocity.x !== 0 || currentVelocity.y !== 0)) {
            // Send the rounded position
            const newX = this.localPlayerSprite!.x;
            const newY = this.localPlayerSprite!.y;
            // Use the reducers object from the client instance
            this.spacetimeDBClient.sdkConnection?.reducers.updatePlayerPosition(newX, newY);
            console.debug(`Sent position update: (${newX.toFixed(2)}, ${newY.toFixed(2)})`);
        } else {
             // Could potentially send a 'stopped moving' event if needed
        }

        // Keep other player names above their sprites
        this.otherPlayers.forEach(container => {
             const text = container.getAt(1) as Phaser.GameObjects.Text;
             const sprite = container.getAt(0) as Phaser.GameObjects.Sprite;
             // Position relative to container, rounding the offset calculation
             text.setPosition(0, Math.floor(-sprite.height / 2) - 10);
        });
    }
} 