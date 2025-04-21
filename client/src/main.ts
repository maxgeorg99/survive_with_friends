import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import ClassSelectScene from './scenes/ClassSelectScene';
import SpacetimeDBClient from './SpacetimeDBClient';
import { Player } from './autobindings';

console.log("Main script loading...");

const spacetimeDBClient = new SpacetimeDBClient();

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
    scene: [LoginScene, ClassSelectScene, GameScene],
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

const game = new Phaser.Game(config);
console.log("Phaser game initialized.");

// Callback for when the SpacetimeDB subscription is initially applied
spacetimeDBClient.onSubscriptionApplied = () => {
    console.log("SpacetimeDB subscription applied callback triggered in main.ts.");

    // Ensure client and tables are ready before proceeding
    if (!spacetimeDBClient.sdkConnection?.db || !spacetimeDBClient.identity) {
        console.warn("Subscription applied, but client tables or identity not ready yet.");
        return; // Wait for connection to be fully established in handleConnect
    }

    const localDb = spacetimeDBClient.sdkConnection?.db;
    const localIdentity = spacetimeDBClient.identity;
    
    // Listen for account updates
    
    // Listen for account inserts
    localDb.account.onInsert((_ctx, account) => {
        console.log("Account inserted event received");
        console.log("- Account data:", JSON.stringify(account));

        // Check if account is local
        if (account.identity.isEqual(localIdentity)) 
        {
            console.log("Local account inserted!");
            
            // Check if the account has a name
            if (!account.name) 
            {
                console.log("New account has no name. Going to LoginScene.");
                game.scene.start('LoginScene');
            } 
            else 
            {
                // If account has a name but no player, go to ClassSelectScene
                if (account.currentPlayerId === 0) 
                {
                    console.log("Account has name but no player. Going to ClassSelectScene.");
                    game.scene.start('ClassSelectScene');
                } 
                else 
                {
                    // Check if the player exists and is alive
                    const localPlayer = localDb.player.player_id.find(account.currentPlayerId);
                    if (localPlayer) 
                    {
                        console.log("Account has name and living player. Going to GameScene.");
                        game.scene.start('GameScene');
                    } 
                    else 
                    {
                        console.log("Account has name but player is not found. Going to ClassSelectScene.");
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
            
            // Check if name was just set (from null/empty to a value)
            if ((!oldAccount.name || oldAccount.name === "") && newAccount.name) 
            {
                console.log("Name was set. Going to ClassSelectScene.");
                game.scene.start('ClassSelectScene');
                return;
            }

            // Check if playerId changed
            if (oldAccount.currentPlayerId !== newAccount.currentPlayerId) 
            {
                console.log("New player assigned. Checking if player exists for id: " + newAccount.currentPlayerId);
                const player = localDb.player.player_id.find(newAccount.currentPlayerId);
                if (player) 
                {
                    if (game.scene.isActive('GameScene'))   
                    {
                        console.log("already in game scene");
                    }
                    else
                    {
                        console.log("Player found. Going to GameScene.");
                        game.scene.start('GameScene');
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
            if (game.scene.isActive('GameScene')) 
            {
                console.log("already in game scene");
            }
            else
            {
                console.log("Local player inserted! Going to GameScene.");
                game.scene.start('GameScene');
            }
        } 
        else 
        {
            console.log("Another player has logged on: " + player.name);
        }
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
            console.log("Local player was deleted/died! Going to ClassSelectScene.");
            // If we're in the GameScene, this will transition after showing death message
            // Otherwise, force transition here
            if (game.scene.isActive('GameScene')) 
            {
                console.log("GameScene is active, death handling will occur there.");
            } 
            else 
            {
                game.scene.start('ClassSelectScene');
            }
        }
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

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 