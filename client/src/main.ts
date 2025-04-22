import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import ClassSelectScene from './scenes/ClassSelectScene';
import LoadingScene from './scenes/LoadingScene';
import SpacetimeDBClient from './SpacetimeDBClient';
import { Player } from './autobindings';
import { GameEvents } from './constants/GameEvents';

console.log("Main script loading...");

// Create a global event emitter for game-wide events
const gameEvents = new Phaser.Events.EventEmitter();
// Make it accessible globally
(window as any).gameEvents = gameEvents;

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

// Callback for when the SpacetimeDB subscription is initially applied
const onSubscriptionApplied = () => {
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
    localDb.account.onInsert((_ctx, account) => {
        console.log("Account inserted event received");
        console.log("- Account data:", JSON.stringify(account));

        // Check if account is local
        if (account.identity.isEqual(localIdentity)) 
        {
            console.log("Local account inserted!");
            
            // Emit account created event with the account data
            gameEvents.emit(GameEvents.ACCOUNT_CREATED, account);
            
            // Automatically go to login scene if account has no name
            if (!account.name) 
            {
                game.scene.start('LoginScene');
            } 
            else 
            {
                // If account has a name but no player, go to ClassSelectScene
                if (account.currentPlayerId === 0) 
                {
                    game.scene.start('ClassSelectScene');
                } 
                else 
                {
                    // Check if the player exists and is alive
                    const localPlayer = localDb.player.player_id.find(account.currentPlayerId);
                    if (localPlayer) 
                    {
                        game.scene.start('GameScene');
                    } 
                    else 
                    {
                        game.scene.start('ClassSelectScene');
                    }
                }
            }
        }
    });

    localDb.account.onUpdate((_ctx, oldAccount, newAccount) => {
        console.log("Account updated event received");
        console.log("- Account data:", JSON.stringify(newAccount));

        // Check if account is local
        if (newAccount.identity.isEqual(localIdentity)) 
        {
            console.log("Local account updated.");
            
            // Emit account updated event with old and new account data
            gameEvents.emit(GameEvents.ACCOUNT_UPDATED, oldAccount, newAccount);
            
            // Check if name was just set (from null/empty to a value)
            if ((!oldAccount.name || oldAccount.name === "") && newAccount.name) 
            {
                console.log("Name was set.");
                
                // Emit name set event
                gameEvents.emit(GameEvents.NAME_SET, newAccount);
                
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
                    const player = localDb.player.player_id.find(newAccount.currentPlayerId);
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
    });

    // Listen for player inserts
    localDb.player.onInsert((_ctx, player) => {
        console.log("Player inserted event received");
        console.log("- Player data:", JSON.stringify(player));

        const myAccount = localDb.account.identity.find(localIdentity);
        if (!myAccount) 
        {
            console.log("No account found for local identity. Waiting for account.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) 
        {
            console.log("Local player inserted!");
            
            // Emit player created event
            gameEvents.emit(GameEvents.PLAYER_CREATED, player);
            
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
            gameEvents.emit(GameEvents.PLAYER_CREATED, player, false);
        }
    });

    // Listen for player updates
    localDb.player.onUpdate((_ctx, oldPlayer, newPlayer) => {
        console.log("Player updated event received");
        console.log("- Player data:", JSON.stringify(newPlayer));
        
        const myAccount = localDb.account.identity.find(localIdentity);
        const isLocalPlayer = myAccount && myAccount.currentPlayerId === newPlayer.playerId;
        
        // Emit player updated event
        gameEvents.emit(GameEvents.PLAYER_UPDATED, oldPlayer, newPlayer, isLocalPlayer);
    });

    // Listen for player deletions (death)
    localDb.player.onDelete((_ctx, player) => {
        console.log("Player deleted event received");
        console.log("- Player data:", JSON.stringify(player));

        const myAccount = localDb.account.identity.find(localIdentity);
        if (!myAccount) 
        {
            console.log("No account found for local identity.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) 
        {
            console.log("Local player was deleted/died!");
            
            // Emit player died event
            gameEvents.emit(GameEvents.PLAYER_DIED, player);
            
            // If we're in the GameScene, death handling will be done by the scene
            // The scene will listen for PLAYER_DIED event
        }
        else {
            // Emit player deleted event for other players
            gameEvents.emit(GameEvents.PLAYER_DELETED, player, false);
        }
    });

    // Entity event listeners
    localDb.entity.onInsert((_ctx, entity) => {
        console.log("Entity inserted event received");
        console.log("- Entity data:", JSON.stringify(entity));
        
        // Emit entity created event
        gameEvents.emit(GameEvents.ENTITY_CREATED, entity);
    });

    localDb.entity.onUpdate((_ctx, oldEntity, newEntity) => {
        console.log("Entity updated event received");
        console.log("- Entity data:", JSON.stringify(newEntity));
        
        // Emit entity updated event
        gameEvents.emit(GameEvents.ENTITY_UPDATED, oldEntity, newEntity);
    });

    localDb.entity.onDelete((_ctx, entity) => {
        console.log("Entity deleted event received");
        console.log("- Entity data:", JSON.stringify(entity));
        
        // Emit entity deleted event
        gameEvents.emit(GameEvents.ENTITY_DELETED, entity);
    });

    // Check initial state and load appropriate scene
    console.log("Checking current account and player state...");
    const myAccount = localDb.account.identity.find(localIdentity);
    
    if (!myAccount) {
        console.log("No account found for local identity. Waiting for account to be created.");
        // Start with LoginScene (default)
        return;
    }

    if (!myAccount.name) 
    {
        console.log("Account has no name. Going to LoginScene.");
        game.scene.start('LoginScene');
        return;
    }

    if (myAccount.currentPlayerId === 0) 
    {
        console.log("Account has name but no player. Going to ClassSelectScene.");
        game.scene.start('ClassSelectScene');
        return;
    }

    // Check if player exists and is alive
    const localPlayer = localDb.player.player_id.find(myAccount.currentPlayerId);
    if (localPlayer) 
    {
        console.log("Account has name and living player. Going to GameScene.");
        game.scene.start('GameScene');
    }
    else 
    {
        // Check if player is in dead_players table
        const deadPlayer = localDb.deadPlayers.player_id.find(myAccount.currentPlayerId);
        if (deadPlayer) 
        {
            console.log("Player is dead. Going to ClassSelectScene.");
        } 
        else 
        {
            console.log("Player not found. Going to ClassSelectScene.");
        }
        game.scene.start('ClassSelectScene');
    }
};

const onConnect = () => {
    console.log("SpacetimeDB connection established.");
    // Emit connection established event
    gameEvents.emit(GameEvents.CONNECTION_ESTABLISHED);
};

const onDisconnect = () => {
    console.log("SpacetimeDB connection lost.");
    // Emit connection lost event
    gameEvents.emit(GameEvents.CONNECTION_LOST);
};

const spacetimeDBClient = new SpacetimeDBClient(onSubscriptionApplied, onConnect, onDisconnect);

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 