import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Entity } from "../autobindings";
import { UpdatePlayerDirection } from "../autobindings";
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

export default class GameScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private localPlayerSprite: Phaser.Physics.Arcade.Sprite | null = null;
    private localPlayerNameText: Phaser.GameObjects.Text | null = null;
    private localPlayerShadow: Phaser.GameObjects.Image | null = null; // Added for local player shadow
    private otherPlayers: Map<Identity, Phaser.GameObjects.Container> = new Map();
    // Map to hold player data waiting for corresponding entity data (keyed by entityId)
    private pendingPlayers: Map<number, Player> = new Map();
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
    private backgroundTile: Phaser.GameObjects.TileSprite | null = null;
    private isPlayerDataReady = false;
    
    // Server-authoritative motion variables
    private lastDirectionUpdateTime: number = 0;
    private serverPosition: Phaser.Math.Vector2 | null = null;
    private currentDirection: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
    private isMoving: boolean = false;

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
        this.load.image(SHADOW_ASSET_KEY, '/assets/shadow.png');
        console.log("GameScene preload finished. Assets loaded:", 
            this.textures.exists(PLAYER_ASSET_KEY),
            this.textures.exists(GRASS_ASSET_KEY), 
            this.textures.exists(SHADOW_ASSET_KEY));
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
            this.localPlayerSprite = this.physics.add.sprite(startX, startY, PLAYER_ASSET_KEY);
            this.localPlayerSprite.setDepth(1); // Set sprite depth explicitly
            this.localPlayerNameText = this.add.text(startX, startY - Math.floor(this.localPlayerSprite.height / 2) - 10, localPlayerData.name || 'Player', PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
            this.localPlayerNameText.setDepth(2); // Ensure name is above sprite
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
        console.log(`Entity update received: ID ${entityData.entityId} at pos (${entityData.position.x}, ${entityData.position.y})`);
        
        // Get local player EntityId (inline implementation to avoid TypeScript issues)
        let localPlayerEntityId: number | undefined = undefined;
        try {
            if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.identity.find(
                    // Force type assertion here to work around the TypeScript error
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
                try {
                    if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                        const localPlayer = this.spacetimeDBClient.sdkConnection.db.player.identity.find(
                            this.spacetimeDBClient.identity as any as Identity
                        );
                        if (localPlayer?.name) {
                            playerName = localPlayer.name;
                        }
                    }
                } catch (error) {
                    console.error("Error getting player name:", error);
                }
                
                this.localPlayerSprite = this.physics.add.sprite(startX, startY, PLAYER_ASSET_KEY);
                this.localPlayerSprite.setDepth(1);
                this.localPlayerNameText = this.add.text(startX, startY - Math.floor(this.localPlayerSprite.height / 2) - 10, 
                    playerName, PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
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
            // We have player data waiting for this entity - create/update
            console.log(`Found pending player for entity ${entityData.entityId}`);
            this.addOrUpdateOtherPlayer(pendingPlayer);
            return;
        }

        // Try finding the owning player by entity ID in all known players
        for (const player of this.spacetimeDBClient.sdkConnection?.db.player.iter() || []) {
            if (player.entityId === entityData.entityId) {
                console.log(`Found player ${player.name} for entity ${entityData.entityId}`);
                this.updateOtherPlayerPosition(player.identity, entityData.position.x, entityData.position.y);
                return;
            }
        }
        
        console.warn(`Entity update received for unknown entity: ${entityData.entityId}`);
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
             // Indices shift: 0=shadow, 1=sprite, 2=text
             const text = container.getAt(2) as Phaser.GameObjects.Text;
            if (text.text !== playerData.name) {
                 console.log(`Updating name for player ${playerData.identity.toHexString()} to ${playerData.name}`);
                 text.setText(playerData.name || 'Player');
             }
         } else {
             // Create new player sprite and text container
             console.log(`Adding new player sprite for ${playerData.name} at (${entityData.position.x}, ${entityData.position.y})`);
             const shadow = this.add.image(0, SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
                 .setAlpha(SHADOW_ALPHA)
                 .setDepth(-1); // Depth relative to container
             const sprite = this.add.sprite(0, 0, PLAYER_ASSET_KEY);
             const text = this.add.text(0, -Math.floor(sprite.height / 2) - 10, playerData.name || 'Player', PLAYER_NAME_STYLE).setOrigin(0.5, 0.5);
             // Round position on creation
             const startX = Math.floor(entityData.position.x);
             const startY = Math.floor(entityData.position.y);
             container = this.add.container(startX, startY, [shadow, sprite, text]);
             container.setData('entityId', entityData.entityId); // Store entityId on creation
             this.otherPlayers.set(playerData.identity, container);
             console.log(`Created container for NEW player ${playerData.name}. Shadow Visible: ${shadow.visible}`);
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

    update(time: number, delta: number) {
        if (!this.isPlayerDataReady || !this.localPlayerSprite || !this.localPlayerNameText || !this.cursors || !this.spacetimeDBClient?.sdkConnection?.reducers) {
            return; // Don't run update logic until player and reducers are ready
        }

        // Calculate input direction
        const inputDirection = new Phaser.Math.Vector2(0, 0);
        let isMoving = false;

        // Keyboard movement
        if (this.cursors.left?.isDown || this.input.keyboard?.addKey('A').isDown) {
            inputDirection.x = -1;
            isMoving = true;
        }
        if (this.cursors.right?.isDown || this.input.keyboard?.addKey('D').isDown) {
            inputDirection.x = 1;
            isMoving = true;
        }
        if (this.cursors.up?.isDown || this.input.keyboard?.addKey('W').isDown) {
            inputDirection.y = -1;
            isMoving = true;
        }
        if (this.cursors.down?.isDown || this.input.keyboard?.addKey('S').isDown) {
            inputDirection.y = 1;
            isMoving = true;
        }

        // Normalize direction if moving
        if (isMoving) {
            inputDirection.normalize();
        }

        // Check if direction changed or if it's time to send an update
        const directionChanged = this.currentDirection.x !== inputDirection.x || 
                                this.currentDirection.y !== inputDirection.y ||
                                this.isMoving !== isMoving;
        
        const timeToUpdate = time - this.lastDirectionUpdateTime >= DIRECTION_UPDATE_RATE;
        
        // Send direction update to server if needed
        if ((directionChanged || (isMoving && timeToUpdate)) && this.spacetimeDBClient.sdkConnection?.reducers) {
            this.currentDirection.copy(inputDirection);
            this.isMoving = isMoving;
            this.lastDirectionUpdateTime = time;
            
            // Send the direction to the server - using the dedicated direction reducer
            this.spacetimeDBClient.sdkConnection.reducers.updatePlayerDirection(
                inputDirection.x,
                inputDirection.y
            );
            
            console.debug(`Sent direction update: (${inputDirection.x.toFixed(2)}, ${inputDirection.y.toFixed(2)})`);
        }
        
        // Interpolate towards server position if available
        if (this.serverPosition && this.localPlayerSprite) {
            const currentPos = new Phaser.Math.Vector2(this.localPlayerSprite.x, this.localPlayerSprite.y);
            
            // Calculate distance to server position
            const distanceToServer = Phaser.Math.Distance.Between(
                currentPos.x, currentPos.y,
                this.serverPosition.x, this.serverPosition.y
            );
            
            // If we're far from server position, use interpolation
            if (distanceToServer > 2) {
                // Interpolate position (lerp)
                currentPos.lerp(this.serverPosition, INTERPOLATION_SPEED);
                this.localPlayerSprite.setPosition(currentPos.x, currentPos.y);
            }
        }
        
        // Apply client-side prediction if moving
        if (isMoving && this.localPlayerSprite) {
            // Calculate the velocity based on input direction and speed
            const velocity = inputDirection.clone().scale(PLAYER_SPEED);
            
            // Calculate the predicted movement for this frame
            const frameVelocity = velocity.clone().scale(delta / 1000);
            
            // Apply prediction by moving the sprite
            this.localPlayerSprite.x += frameVelocity.x;
            this.localPlayerSprite.y += frameVelocity.y;
        }

        // Round the sprite's position for pixel-perfect rendering
        if (this.localPlayerSprite) {
            this.localPlayerSprite.x = Math.floor(this.localPlayerSprite.x);
            this.localPlayerSprite.y = Math.floor(this.localPlayerSprite.y);
        }

        // Update local player shadow and name text position
        if (this.localPlayerSprite && this.localPlayerShadow) {
            this.localPlayerShadow.setPosition(this.localPlayerSprite.x, this.localPlayerSprite.y + SHADOW_OFFSET_Y);
        }
        
        if (this.localPlayerSprite && this.localPlayerNameText) {
            // Update name text position, using the rounded sprite coordinates
            this.localPlayerNameText.setPosition(
                this.localPlayerSprite.x,
                this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - 10
            );
        }

        // Keep other player names above their sprites
        this.otherPlayers.forEach(container => {
            // Indices shift: 0=shadow, 1=sprite, 2=text
            const shadow = container.getAt(0) as Phaser.GameObjects.Image;
            const sprite = container.getAt(1) as Phaser.GameObjects.Sprite;
            
            // Position relative to container, rounding the offset calculation
            const text = container.getAt(2) as Phaser.GameObjects.Text;
            text.setPosition(0, Math.floor(-sprite.height / 2) - 10);
        });
    }
} 