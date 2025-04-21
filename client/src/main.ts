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

// --- SpacetimeDB Connection and Logic ---

const namePrompt = document.getElementById('namePrompt') as HTMLDivElement;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const submitNameButton = document.getElementById('submitNameButton') as HTMLButtonElement;

let isGameWorldStarted = false; // Flag to prevent multiple starts

// Add focus/blur events to prevent game from capturing keystrokes while entering name
nameInput.addEventListener('focus', () => {
    // Disable game keyboard inputs when input field is focused
    if (game.input && game.input.keyboard) {
        game.input.keyboard.enabled = false;
        console.log("Game keyboard input disabled while name input is focused");
    }
});

nameInput.addEventListener('blur', () => {
    // Re-enable keyboard inputs when input field loses focus
    if (game.input && game.input.keyboard) {
        game.input.keyboard.enabled = true;
        console.log("Game keyboard input re-enabled");
    }
});

// Also handle Enter key press on the input
nameInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        submitNameButton.click();
    }
});

function showNamePrompt() {
    console.log("Showing name prompt.");
    namePrompt.style.display = 'block';
    // Hide the game canvas while prompting for name
    if (game.canvas.parentElement) {
        game.canvas.parentElement.style.visibility = 'hidden';
    }
    
    // Focus the input field automatically
    nameInput.focus();
    
    // Disable game keyboard inputs when prompt is shown
    if (game.input && game.input.keyboard) {
        game.input.keyboard.enabled = false;
        console.log("Game keyboard input disabled while name prompt is shown");
    }
}

function hideNamePrompt() {
    console.log("Hiding name prompt.");
    namePrompt.style.display = 'none';
    // Show the game canvas
    if (game.canvas.parentElement) {
        game.canvas.parentElement.style.visibility = 'visible';
    }
    
    // Re-enable keyboard inputs when prompt is hidden
    if (game.input && game.input.keyboard) {
        game.input.keyboard.enabled = true;
        console.log("Game keyboard input re-enabled");
    }
}

function startGameWorld() {
    if (isGameWorldStarted) return; // Only start once
    isGameWorldStarted = true;
    console.log("Starting game world and emitting playerDataReady.");
    
    // Reset button state in case it was left in loading state
    submitNameButton.disabled = false;
    submitNameButton.textContent = "Start";
    
    hideNamePrompt();
    // Let the GameScene know the SpacetimeDB connection and initial subscription is ready
    game.scene.getScene('GameScene').events.emit('playerDataReady');
}

submitNameButton.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (name && name.length > 0 && name.length <= 16) {
        console.log(`Submitting name: ${name}`);
        // Use the reducer object from the client instance
        if (spacetimeDBClient.sdkConnection?.reducers) {
            console.log(`Attempting to call enterGame reducer with name: ${name}`);
            
            // Show loading indicator
            submitNameButton.disabled = true;
            submitNameButton.textContent = "Loading...";
            
            spacetimeDBClient.sdkConnection?.reducers.setName(name);
            console.log("Name submitted. Waiting for server confirmation...");
        } else {
            console.error("Cannot enter game: SpacetimeDB reducers not available.");
            alert("Error setting name. Please try again.");
        }
    } else {
        alert('Please enter a valid name (1-16 characters).');
    }
});

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
                spacetimeDBClient.sdkConnection?.reducers.spawnPlayer();
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
            spacetimeDBClient.sdkConnection?.reducers.spawnPlayer();
        }
    }
    else
    {
        console.log("No name found for account. Prompting for name.");
        showNamePrompt();
        return;
    }
};

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 