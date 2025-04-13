import { Identity, ErrorContextInterface } from '@clockworklabs/spacetimedb-sdk';
// Import generated classes, including the generated DbConnection
import { RemoteReducers, SetReducerFlags, RemoteTables, DbConnection, ErrorContext, SubscriptionEventContext } from "./autobindings"; // Removed Reducer, EventContext import as they seem unused here

// Define your SpacetimeDB connection details
const SPACETIMEDB_DB_NAME = "vibesurvivors";
const SPACETIMEDB_URI = "ws://localhost:3000"; // Use wss for cloud, corrected order

class SpacetimeDBClient {
    // Initialize sdkClient to null, it will be set in handleConnect
    public sdkConnection: DbConnection | null = null;
    public identity: Identity | null = null;
    public onSubscriptionApplied: (() => void) | null = null;
    public onConnect: (() => void) | null = null;
    public onDisconnect: (() => void) | null = null;

    constructor() {
        console.log("Initializing SpacetimeDBClient and preparing connection...");
        // Configure and initiate connection attempt.
        // The actual DbConnection instance is received in onConnect.
        DbConnection.builder()
            .withUri(SPACETIMEDB_URI)
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
                "SELECT * FROM player",
                "SELECT * FROM entity"
            ]);

        // Call external onConnect listener
        if (this.onConnect) {
            this.onConnect();
        }
    }

    // Subscription applied callback
    private handleSubscriptionApplied(/*ctx: SubscriptionEventContext*/) {
        console.log("SpacetimeDB subscription applied callback triggered.");
        
        // Debug info about current data state
        if (this.sdkConnection?.db) {
            const playerCount = Array.from(this.sdkConnection.db.player.iter()).length;
            const entityCount = Array.from(this.sdkConnection.db.entity.iter()).length;
            console.log(`Subscription data received: ${playerCount} players, ${entityCount} entities`);
            
            // Log all players received
            console.log("=== PLAYERS RECEIVED IN SUBSCRIPTION ===");
            Array.from(this.sdkConnection.db.player.iter()).forEach(p => {
                console.log(`Player: ${p.name} (ID: ${p.identity.toHexString()}, EntityID: ${p.entityId})`);
            });
            
            // Log all entities received
            console.log("=== ENTITIES RECEIVED IN SUBSCRIPTION ===");
            Array.from(this.sdkConnection.db.entity.iter()).forEach(e => {
                console.log(`Entity ID: ${e.entityId} at (${e.position.x}, ${e.position.y})`);
            });
        }
        
        if (this.onSubscriptionApplied) {
            this.onSubscriptionApplied();
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
            this.onDisconnect();
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
            this.onDisconnect();
        }
    }

    get isConnected(): boolean {
        // Check sdkClient and identity which are set together in handleConnect
        return this.sdkConnection !== null && this.identity !== null;
    }
}

export default SpacetimeDBClient; 