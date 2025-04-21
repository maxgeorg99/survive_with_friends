import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
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
    scene: [LoginScene, GameScene],
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

    var localDb = spacetimeDBClient.sdkConnection?.db;
    var localIdentity = spacetimeDBClient.identity;
    
    // Listen for account updates
    
    // Listen for account inserts
    localDb.account.onInsert((_ctx, account) => {
        console.log("Account inserted event received");
        console.log("- Account data:", JSON.stringify(account));

        //Check if account is local
        if (account.identity.isEqual(localIdentity)) {
            console.log("Local account inserted! Waiting for name.");
        }
    });

    localDb.account.onUpdate((_ctx, oldAccount, newAccount) => {
        console.log("Account updated event received");
        console.log("- Account data:", JSON.stringify(newAccount));

        if(!newAccount.name)
        {
            console.log("No name found for updated account. Waiting for name.");
            return;
        }

        //Check if account is local
        if (newAccount.identity.isEqual(localIdentity)) {
            console.log("Local account updated. Checking for player...");
            var localPlayer = localDb.player.player_id.find(newAccount.currentPlayerId);
            if(localPlayer) {
                console.log("Player found for account. Starting game.");
                //TODO: Move to game scene.
            }
            else
            {
                console.log("No player found for account. Try spawning a new player.");
                //TODO: move to class selection scene.
            }
        }
    });

    // Set up player table listeners AFTER subscription is applied
    console.log("Setting up player table listeners...");
    
    // Listen for player inserts
    localDb.player.onInsert((_ctx, player) => {
        console.log("Player inserted event received");
        console.log("- Player data:", JSON.stringify(player));

        var myAccount = localDb.account.identity.find(localIdentity);
        if(!myAccount) {
            console.log("No account found for local identity. Waiting for account.");
            return;
        }

        if(myAccount.currentPlayerId != player.playerId) {
            console.log("Another player has logged on: " + player.name);
            return;
        }
        
        console.log("Local player inserted! Move to game scene.");
        //TODO: Move to game scene.
    });

    console.log("Checking for existing account...");
    var myAccount = localDb.account.identity.find(localIdentity);
    if(!myAccount) {
        console.log("No account found for local identity. We need to wait for the account to be inserted.");
        return;
    }

    if(myAccount.name)
    {
        console.log("Account found for local identity: " + myAccount.name + ". Checking for existing player...");
        var localPlayer = localDb.player.player_id.find(myAccount.currentPlayerId);
        if(localPlayer) {
            console.log("Player found for account. Starting game.");
            //TODO: Move to game scene.
        }
        else
        {
            console.log("No player found for account. Try spawning a new player.");
            //TODO: move to class selection scene.
        }
    }
    else
    {
        console.log("No name found for account. Prompting for name.");
        //TODO: move to login scene.
        return;
    }
};

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 