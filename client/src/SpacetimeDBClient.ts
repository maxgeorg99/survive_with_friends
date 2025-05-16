import { Identity, ErrorContextInterface } from '@clockworklabs/spacetimedb-sdk';
// Import generated classes, including the generated DbConnection
import { RemoteReducers, SetReducerFlags, RemoteTables, DbConnection, ErrorContext, SubscriptionEventContext } from "./autobindings"; // Removed Reducer, EventContext import as they seem unused here
import { GameEvents } from './constants/GameEvents';

// Define your SpacetimeDB connection details
const SPACETIMEDB_DB_NAME = "vibesurvivors-with-friends";
const SPACETIMEDB_URI = "ws://localhost:3000"; // Local development server
const REMOTE_SPACETIMEDB_URI = "wss://maincloud.spacetimedb.com"; // Production server

// Check if we're running in production mode based on the URL
// If the URL includes 'localhost' or is a dev-specific domain, use local URI
function isDevEnvironment() {
    // In browser environment
    if (typeof window !== 'undefined') {
        return window.location.hostname === 'localhost' || 
               window.location.port === '8080';
    }
    return false;
}

// Use the appropriate URI based on environment
const URI_TO_USE = isDevEnvironment() ? SPACETIMEDB_URI : REMOTE_SPACETIMEDB_URI;

// Log the current environment and chosen URI
console.log(`Environment: ${isDevEnvironment() ? 'Development' : 'Production'}`);
console.log(`Using SpacetimeDB URI: ${URI_TO_USE}`);

class SpacetimeDBClient {
    // Initialize sdkClient to null, it will be set in handleConnect
    public sdkConnection: DbConnection | null = null;
    public identity: Identity | null = null;
    public onSubscriptionApplied: ((ctx: SubscriptionEventContext) => void) | null = null;
    public onConnect: ((ctx: DbConnection, identity: Identity, token: string) => void) | null = null;
    public onDisconnect: ((ctx: ErrorContext, error?: Error) => void) | null = null;
    private gameEvents: any;

    constructor(
        onSubscriptionApplied?: (ctx: SubscriptionEventContext) => void,
        onConnect?: (ctx: DbConnection, identity: Identity, token: string) => void,
        onDisconnect?: (ctx: ErrorContext, error?: Error) => void
    ) {
        console.log("Initializing SpacetimeDBClient and preparing connection...");
        
        // Access the game events
        this.gameEvents = (window as any).gameEvents;
        
        // Store callback handlers
        this.onSubscriptionApplied = onSubscriptionApplied || null;
        this.onConnect = onConnect || null; 
        this.onDisconnect = onDisconnect || null;

        // Configure and initiate connection attempt.
        // The actual DbConnection instance is received in onConnect.
        DbConnection.builder()
            .withUri(URI_TO_USE)
            .withModuleName(SPACETIMEDB_DB_NAME)
            .withToken(localStorage.getItem('auth_token') || '')
            .onConnect(this.handleConnect.bind(this))
            .onDisconnect(this.handleDisconnect.bind(this))
            .onConnectError(this.handleConnectError.bind(this))
            .build();
        console.log("Connection attempt initiated.");
    }

    // No separate connect() method needed

    disconnect() {
        console.log("Disconnecting from SpacetimeDB...");
        // Check if sdkClient is initialized before calling disconnect
        if (this.sdkConnection) {
            this.sdkConnection.disconnect();
        } else {
            console.warn("Attempted to disconnect before connection was established.");
        }
        // Nullify regardless of initial state
        this.sdkConnection = null;
        this.identity = null;
    }

    // Connection successful callback
    private handleConnect(connection: DbConnection, identity: Identity, token: string) {
        console.log("Successfully connected to SpacetimeDB.");
        // Assign the fully initialized connection object
        this.sdkConnection = connection;
        this.identity = identity;
        console.log("Local Identity:", this.identity?.toHexString());

        localStorage.setItem('auth_token', token);

        // Subscribe using the subscriptionBuilder on the valid sdkClient
        console.log("Subscribing to relevant tables...");
        this.sdkConnection.subscriptionBuilder()
            .onApplied(this.handleSubscriptionApplied.bind(this))
            .onError(this.handleSubscriptionError.bind(this))
            .subscribe([
                "SELECT * FROM account",
                "SELECT * FROM world",
                "SELECT * FROM player",
                "SELECT * FROM dead_players",
                "SELECT * FROM entity",
                "SELECT * FROM monsters",
                "SELECT * FROM active_attacks",
                "SELECT * FROM active_boss_attacks",
                "SELECT * FROM attack_data",
                "SELECT * FROM gems",
                "SELECT * FROM upgrade_options",
                "SELECT * FROM chosen_upgrades",
                "SELECT * FROM monster_spawners",
                "SELECT * FROM game_state",
                "SELECT * FROM boss_spawn_timer",
                "SELECT * FROM boss_attack_timer",
                "SELECT * FROM player_poison_effect"
            ]);

        // Register table event callbacks
        this.registerTableCallbacks(connection);

        // Call external onConnect listener
        if (this.onConnect) {
            this.onConnect(connection, identity, token);
        }
    }

    // Register callbacks for table events
    private registerTableCallbacks(connection: DbConnection) {
        // Player Events
        if (connection.db.player) {
            connection.db.player.onInsert((ctx, player) => {
                this.gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player);
            });
            connection.db.player.onUpdate((ctx, oldPlayer, newPlayer) => {
                this.gameEvents.emit(GameEvents.PLAYER_UPDATED, ctx, oldPlayer, newPlayer);
            });
            connection.db.player.onDelete((ctx, player) => {
                this.gameEvents.emit(GameEvents.PLAYER_DELETED, ctx, player);
            });
        }

        // Entity Events
        if (connection.db.entity) {
            connection.db.entity.onInsert((ctx, entity) => {
                this.gameEvents.emit(GameEvents.ENTITY_CREATED, ctx, entity);
            });
            connection.db.entity.onUpdate((ctx, oldEntity, newEntity) => {
                this.gameEvents.emit(GameEvents.ENTITY_UPDATED, ctx, oldEntity, newEntity);
            });
            connection.db.entity.onDelete((ctx, entity) => {
                this.gameEvents.emit(GameEvents.ENTITY_DELETED, ctx, entity);
            });
        }

        // Monster Events
        if (connection.db.monsters) {
            connection.db.monsters.onInsert((ctx, monster) => {
                this.gameEvents.emit(GameEvents.MONSTER_CREATED, ctx, monster);
            });
            connection.db.monsters.onUpdate((ctx, oldMonster, newMonster) => {
                this.gameEvents.emit(GameEvents.MONSTER_UPDATED, ctx, oldMonster, newMonster);
            });
            connection.db.monsters.onDelete((ctx, monster) => {
                this.gameEvents.emit(GameEvents.MONSTER_DELETED, ctx, monster);
            });
        }

        // Game State Events
        if (connection.db.gameState) {
            connection.db.gameState.onUpdate((ctx, oldState, newState) => {
                this.gameEvents.emit(GameEvents.GAME_STATE_UPDATED, ctx, oldState, newState);
            });
        }

        // Boss Spawn Timer Events
        if (connection.db.bossSpawnTimer) {
            connection.db.bossSpawnTimer.onInsert((ctx, timer) => {
                this.gameEvents.emit(GameEvents.BOSS_SPAWN_TIMER_CREATED, ctx, timer);
            });
            connection.db.bossSpawnTimer.onDelete((ctx, timer) => {
                this.gameEvents.emit(GameEvents.BOSS_SPAWN_TIMER_DELETED, ctx, timer);
            });
        }

        // Attack Events
        if (connection.db.activeAttacks) {
            connection.db.activeAttacks.onInsert((ctx, attack) => {
                this.gameEvents.emit(GameEvents.ATTACK_CREATED, ctx, attack);
            });
            connection.db.activeAttacks.onUpdate((ctx, oldAttack, newAttack) => {
                this.gameEvents.emit(GameEvents.ATTACK_UPDATED, ctx, oldAttack, newAttack);
            });
            connection.db.activeAttacks.onDelete((ctx, attack) => {
                this.gameEvents.emit(GameEvents.ATTACK_DELETED, ctx, attack);
            });
        }

        // Boss Attack Events
        if (connection.db.activeBossAttacks) {
            connection.db.activeBossAttacks.onInsert((ctx, attack) => {
                this.gameEvents.emit(GameEvents.BOSS_ATTACK_CREATED, ctx, attack);
            });
            connection.db.activeBossAttacks.onUpdate((ctx, oldAttack, newAttack) => {
                this.gameEvents.emit(GameEvents.BOSS_ATTACK_UPDATED, ctx, oldAttack, newAttack);
            });
            connection.db.activeBossAttacks.onDelete((ctx, attack) => {
                this.gameEvents.emit(GameEvents.BOSS_ATTACK_DELETED, ctx, attack);
            });
        }

        // Gem Events - Check if the gems table exists in the bindings
        try {
            // @ts-ignore - Ignore TS error since table might not exist in current bindings
            if (connection.db.gems) {
                // @ts-ignore
                connection.db.gems.onInsert((ctx, gem) => {
                    this.gameEvents.emit(GameEvents.GEM_CREATED, ctx, gem);
                });
                // @ts-ignore
                connection.db.gems.onUpdate((ctx, oldGem, newGem) => {
                    this.gameEvents.emit(GameEvents.GEM_UPDATED, ctx, oldGem, newGem);
                });
                // @ts-ignore
                connection.db.gems.onDelete((ctx, gem) => {
                    this.gameEvents.emit(GameEvents.GEM_DELETED, ctx, gem);
                });
                console.log("Registered gem event handlers successfully");
            }
        } catch (e) {
            console.warn("Could not register gem event handlers - the gems table might not be in current bindings yet:", e);
        }

        if(connection.db.world) {
            connection.db.world.onUpdate((ctx, oldWorld, newWorld) => {
                if(newWorld.tickCount % 50 == 0) {
                    console.log("Game tick:", newWorld.tickCount);
                }
            });
        }

        // Attack Data Events
        if (connection.db.attackData) {
            connection.db.attackData.onInsert((ctx, data) => {
                this.gameEvents.emit(GameEvents.ATTACK_DATA_CREATED, ctx, data);
            });
            connection.db.attackData.onUpdate((ctx, oldData, newData) => {
                this.gameEvents.emit(GameEvents.ATTACK_DATA_UPDATED, ctx, oldData, newData);
            });
        }

        // Active Attack Cleanup Events
        if (connection.db.activeAttackCleanup) {
            connection.db.activeAttackCleanup.onInsert((ctx, cleanup) => {
                this.gameEvents.emit(GameEvents.ACTIVE_ATTACK_CLEANUP_CREATED, ctx, cleanup);
            });
            connection.db.activeAttackCleanup.onDelete((ctx, cleanup) => {
                this.gameEvents.emit(GameEvents.ACTIVE_ATTACK_CLEANUP_DELETED, ctx, cleanup);
            });
        }

        // Active Boss Attack Cleanup Events
        if (connection.db.activeBossAttackCleanup) {
            connection.db.activeBossAttackCleanup.onInsert((ctx, cleanup) => {
                this.gameEvents.emit(GameEvents.ACTIVE_BOSS_ATTACK_CLEANUP_CREATED, ctx, cleanup);
            });
            connection.db.activeBossAttackCleanup.onDelete((ctx, cleanup) => {
                this.gameEvents.emit(GameEvents.ACTIVE_BOSS_ATTACK_CLEANUP_DELETED, ctx, cleanup);
            });
        }
    }

    // Subscription applied callback
    private handleSubscriptionApplied(ctx: SubscriptionEventContext) {
        console.log("SpacetimeDB subscription applied callback triggered.");
        
        if (this.onSubscriptionApplied) {
            this.onSubscriptionApplied(ctx);
        }
    }

    // Subscription error callback - Correct signature using ErrorContextInterface
    private handleSubscriptionError(ctx: ErrorContextInterface<RemoteTables, RemoteReducers, SetReducerFlags>) {
        console.error("SpacetimeDB Subscription Error Context:", ctx);
        // Attempt to access a potential error property (common pattern)
        const error = (ctx as any).error; // Use 'as any' as exact structure isn't known
        if (error) {
             console.error("SpacetimeDB Subscription Error:", error);
        } else {
            console.error("SpacetimeDB Subscription Error: (Could not extract specific error from context)");
        }
        // Optionally, call the main disconnect handler or a specific error handler
        // if (this.onDisconnect) { this.onDisconnect(); }
    }

    // Disconnect callback - Correct signature with Error | undefined
    private handleDisconnect(_ctx: ErrorContext, error?: Error) {
        console.warn(`Disconnected from SpacetimeDB.`);
        if (error) {
            console.error("Disconnect Error:", error);
        }
        // Ensure state is reset
        this.sdkConnection = null;
        this.identity = null;
        if (this.onDisconnect) {
            this.onDisconnect(_ctx, error);
        }
    }

    // Connection error callback - Correct signature
    private handleConnectError(_ctx: ErrorContext, error: Error) {
        console.error(`SpacetimeDB Connection Error:`, error);
        // Reset state as connection failed
        this.sdkConnection = null;
        this.identity = null;
        // Call external disconnect handler
        if (this.onDisconnect) {
            this.onDisconnect(_ctx, error);
        }
    }

    get isConnected(): boolean {
        // Check sdkClient and identity which are set together in handleConnect
        return this.sdkConnection !== null && this.identity !== null;
    }
}

export default SpacetimeDBClient;