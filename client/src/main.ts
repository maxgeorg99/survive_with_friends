import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import ClassSelectScene from './scenes/ClassSelectScene';
import LoadingScene from './scenes/LoadingScene';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import SpacetimeDBClient from './SpacetimeDBClient';
import { DbConnection, ErrorContext, Player, SubscriptionEventContext } from './autobindings';
import { GameEvents } from './constants/GameEvents';

console.log("Main script loading...");

// Create a global event emitter for game-wide events
const gameEvents = new Phaser.Events.EventEmitter();
// Make it accessible globally
(window as any).gameEvents = gameEvents;

// Add a global cleanup function accessible from anywhere, but make it less aggressive
(window as any).cleanupDOMElements = () => {
    console.log("Global window.cleanupDOMElements called - only for manual use");
    cleanupDOMElements();
};

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'gameContainer', // Ensure this matches the div ID in index.html
    physics: {
        default: 'arcade',
        arcade: {
            // No gravity needed for top-down
            // debug: true // Set to true for physics debugging
        }
    },
    scene: [LoginScene, ClassSelectScene, GameScene, LoadingScene],
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

const game = new Phaser.Game(config);
console.log("Phaser game initialized.");

// Global DOM cleanup function
const cleanupDOMElements = () => {
    console.log("Global DOM cleanup triggered");
    
    try {
        // Clean up login scene elements
        const loginInput = document.getElementById('login-name-input');
        if (loginInput && loginInput.parentNode) {
            console.log("Global cleanup: Removing login input");
            loginInput.remove();
        }
        
        document.querySelectorAll('.login-button').forEach(el => {
            if (el && el.parentNode) {
                console.log("Global cleanup: Removing login button");
                el.remove();
            }
        });
        
        // Clean up class select scene elements
        const classContainer = document.getElementById('class-select-container');
        if (classContainer && classContainer.parentNode) {
            console.log("Global cleanup: Removing class container");
            classContainer.remove();
        }
        
        document.querySelectorAll('.class-select-button').forEach(el => {
            if (el && el.parentNode) {
                console.log("Global cleanup: Removing class button");
                el.remove();
            }
        });
        
        // Generic cleanup for text inputs that could be from login
        document.querySelectorAll('input[type="text"]').forEach(el => {
            console.log("Global cleanup: Removing text input", el.id);
            if (el.parentNode) el.remove();
        });
        
        // Generic cleanup for buttons that could be from either scene
        document.querySelectorAll('button').forEach(el => {
            const content = (el as HTMLElement).textContent;
            if (content && (
                content.includes('Set Name') ||
                content.includes('Fighter') ||
                content.includes('Rogue') ||
                content.includes('Mage') ||
                content.includes('Paladin') ||
                content.includes('Confirm')
            )) {
                console.log("Global cleanup: Removing button:", content);
                if (el.parentNode) el.remove();
            }
        });
    } catch (e) {
        console.error("Error in global DOM cleanup:", e);
    }
};

// Callback for when the SpacetimeDB subscription is initially applied
const onSubscriptionApplied = (ctx: SubscriptionEventContext) => {
    console.log("SpacetimeDB subscription applied callback triggered in main.ts.");

    // Ensure client and tables are ready before proceeding
    if (!spacetimeDBClient.sdkConnection?.db || !spacetimeDBClient.identity) {
        console.warn("Subscription applied, but client tables or identity not ready yet.");
        return; // Wait for connection to be fully established in handleConnect
    }

    const localDb = spacetimeDBClient.sdkConnection?.db;
    const localIdentity = spacetimeDBClient.identity;
    
    // Emit subscription applied event
    gameEvents.emit(GameEvents.SUBSCRIPTION_APPLIED);
    
    // Listen for account inserts
    localDb.account.onInsert((ctx, account) => {
        console.log("Account inserted event received");

        // Check if account is local
        if (account.identity.isEqual(localIdentity)) 
        {
            console.log("Local account inserted!");
            
            // Emit account created event with the account data
            gameEvents.emit(GameEvents.ACCOUNT_CREATED, ctx, account);
            
            // Automatically go to login scene if account has no name
            if (!account.name) 
            {
                cleanupDOMElements(); // Clean up before transition
                game.scene.start('LoginScene');
                return;
            } 
            else 
            {
                // If account has a name but no player, go to ClassSelectScene
                if (account.currentPlayerId === 0) 
                {
                    cleanupDOMElements(); // Clean up before transition
                    game.scene.start('ClassSelectScene');
                    return;
                } 
                else 
                {
                    // Check if the player exists and is alive
                    const localPlayer = ctx.db?.player.playerId.find(account.currentPlayerId);
                    if (localPlayer) 
                    {
                        cleanupDOMElements(); // Clean up before transition
                        game.scene.start('GameScene');
                    } 
                    else 
                    {
                        cleanupDOMElements(); // Clean up before transition
                        game.scene.start('ClassSelectScene');
                    }
                }
            }
        }
        else
        {
            console.log("Another user has logged on: " + account.identity.toString());
        }
    });

    localDb.account.onUpdate((ctx, oldAccount, newAccount) => {
        console.log("Account updated event received");
        console.log("- Account data: ", newAccount.name + " - " + newAccount.currentPlayerId + " - " + newAccount.lastLogin);

        // Check if account is local
        if (newAccount.identity.isEqual(localIdentity)) 
        {
            console.log("Local account updated.");
            
            // Emit account updated event with old and new account data
            gameEvents.emit(GameEvents.ACCOUNT_UPDATED, ctx, oldAccount, newAccount);
            
            // Check if name was just set (from null/empty to a value)
            if ((!oldAccount.name || oldAccount.name === "") && newAccount.name) 
            {
                console.log("Name was set.");
                
                // Emit name set event
                gameEvents.emit(GameEvents.NAME_SET, ctx, newAccount);
                
                // Complete loading if in LoadingScene
                if (game.scene.isActive('LoadingScene')) 
                {
                    const loadingScene = game.scene.getScene('LoadingScene') as any;
                    if (loadingScene.completeLoading) 
                    {
                        loadingScene.completeLoading();
                    }
                }
                
                return;
            }

            // Check if playerId changed
            if (oldAccount.currentPlayerId !== newAccount.currentPlayerId) 
            {
                console.log("Player ID changed from", oldAccount.currentPlayerId, "to", newAccount.currentPlayerId);
                
                // Check if the new player exists
                if (newAccount.currentPlayerId > 0) {
                    const player = ctx.db?.player.playerId.find(newAccount.currentPlayerId);
                    if (player) 
                    {
                        // Emit player created event if in LoadingScene
                        if (game.scene.isActive('LoadingScene')) 
                        {
                            const loadingScene = game.scene.getScene('LoadingScene') as any;
                            if (loadingScene.completeLoading) 
                            {
                                loadingScene.completeLoading();
                            }
                        }
                    }
                }
            }
        }
        else
        {
            console.log("Another user has logged on: " + newAccount.identity.toString());
        }
    });

    // Listen for player inserts
    localDb.player.onInsert((ctx, player) => {
        console.log("Player inserted event received");
        console.log("- Player data: " + player.name + " - " + player.playerId);

        const myAccount = ctx.db?.account.identity.find(localIdentity);
        if (!myAccount) 
        {
            console.log("No account found for local identity. Waiting for account.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) 
        {
            console.log("Local player inserted!");
            
            // Emit player created event
            gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player);
            
            // If we're in LoadingScene waiting for player creation, complete it
            if (game.scene.isActive('LoadingScene')) 
            {
                const loadingScene = game.scene.getScene('LoadingScene') as any;
                if (loadingScene.completeLoading) 
                {
                    loadingScene.completeLoading();
                }
            }
        } 
        else 
        {
            console.log("Another player has logged on: " + player.name);
            
            // Emit player created event for other players too
            gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player, false);
        }
    });

    // Listen for player updates
    localDb.player.onUpdate((ctx, oldPlayer, newPlayer) => {
        console.log("Player updated event received");
        console.log("- Player data: ", newPlayer.name + " - " + newPlayer.playerId);
        
        const myAccount = ctx.db?.account.identity.find(localIdentity);
        const isLocalPlayer = myAccount && myAccount.currentPlayerId === newPlayer.playerId;
        
        // Emit player updated event
        gameEvents.emit(GameEvents.PLAYER_UPDATED, ctx, oldPlayer, newPlayer, isLocalPlayer);
    });

    // Listen for player deletions (death)
    localDb.player.onDelete((ctx, player) => {
        console.log("Player deleted event received");
        console.log("- Player data: ", player.name + " - " + player.playerId);

        const myAccount = ctx.db?.account.identity.find(localIdentity);
        if (!myAccount) 
        {
            console.log("No account found for local identity.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) 
        {
            console.log("Local player was deleted/died!");
            
            // Emit player died event
            gameEvents.emit(GameEvents.PLAYER_DIED, ctx, player);
            
            // If we're in the GameScene, death handling will be done by the scene
            // The scene will listen for PLAYER_DIED event
        }
        else {
            // Emit player deleted event for other players
            gameEvents.emit(GameEvents.PLAYER_DELETED, ctx, player, false);
        }
    });

    // Entity event listeners
    localDb.entity.onInsert((ctx, entity) => {        // Emit entity created event
        gameEvents.emit(GameEvents.ENTITY_CREATED, ctx, entity);
    });

    localDb.entity.onUpdate((ctx, oldEntity, newEntity) => {
        gameEvents.emit(GameEvents.ENTITY_UPDATED, ctx, oldEntity, newEntity);
    });

    localDb.entity.onDelete((ctx, entity) => {
        gameEvents.emit(GameEvents.ENTITY_DELETED, ctx, entity);
    });

    // Check initial state and load appropriate scene
    console.log("Checking current account and player state...");
    const myAccount = ctx.db?.account.identity.find(localIdentity);
    
    if (!myAccount) {
        console.log("No account found for local identity. Waiting for account to be created.");
        // Start with LoginScene (default)
        return;
    }

    if (!myAccount.name) 
    {
        console.log("Account has no name. Going to LoginScene.");
        cleanupDOMElements(); // Clean up before transition
        game.scene.start('LoginScene');
        return;
    }

    if (myAccount.currentPlayerId === 0) 
    {
        console.log("Account has name but no player. Going to ClassSelectScene.");
        cleanupDOMElements(); // Clean up before transition
        game.scene.start('ClassSelectScene');
        return;
    }

    // Check if player exists and is alive
    const localPlayer = ctx.db?.player.playerId.find(myAccount.currentPlayerId);
    if (localPlayer) 
    {
        console.log("Account has name and living player. Going to GameScene.");
        cleanupDOMElements(); // Clean up before transition
        game.scene.start('GameScene');
    }
    else 
    {
        // Check if player is in dead_players table
        const deadPlayer = ctx.db?.deadPlayers.playerId.find(myAccount.currentPlayerId);
        if (deadPlayer) 
        {
            console.log("Player is dead. Going to ClassSelectScene.");
        } 
        else 
        {
            console.log("Player not found. Going to ClassSelectScene.");
        }
        cleanupDOMElements(); // Clean up before transition
        game.scene.start('ClassSelectScene');
    }
};

const onConnect = (ctx: DbConnection, identity: Identity, token: string) => {
    console.log("SpacetimeDB connection established.");
    // Emit connection established event
    gameEvents.emit(GameEvents.CONNECTION_ESTABLISHED, ctx, identity, token);
};

const onDisconnect = (ctx: ErrorContext, error?: Error) => {
    console.log("SpacetimeDB connection lost.");
    // Emit connection lost event
    gameEvents.emit(GameEvents.CONNECTION_LOST, ctx, error);
};

const spacetimeDBClient = new SpacetimeDBClient(onSubscriptionApplied, onConnect, onDisconnect);

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 