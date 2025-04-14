import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
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
    scene: [GameScene],
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
    
    // Clear the fallback timer if it exists
    if ((window as any).fallbackTimerId) {
        clearTimeout((window as any).fallbackTimerId);
        (window as any).fallbackTimerId = null;
    }
    
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
            
            // Set a fallback timer in case the event listeners don't fire
            const fallbackTimer = setTimeout(() => {
                console.log("Fallback timer triggered - forcing game start");
                submitNameButton.disabled = false;
                submitNameButton.textContent = "Start";
                startGameWorld();
            }, 3000); // 3 second fallback
            
            // Store the timer ID so we can clear it if normal flow works
            (window as any).fallbackTimerId = fallbackTimer;
            
            spacetimeDBClient.sdkConnection?.reducers.enterGame(name);
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

    // Set up player table listeners AFTER subscription is applied
    console.log("Setting up player table listeners...");
    
    // Listen for player inserts
    spacetimeDBClient.sdkConnection.db.player.onInsert((_ctx, player) => {
        console.log("Player inserted event received");
        console.log("- Player data:", JSON.stringify({
            name: player.name,
            id: player.identity.toHexString(),
            entityId: player.entityId
        }));
        console.log("- Local identity:", spacetimeDBClient.identity?.toHexString());
        
        const isLocalPlayer = spacetimeDBClient.identity && player.identity.isEqual(spacetimeDBClient.identity);
        console.log("- Is local player:", isLocalPlayer);
        
        if (isLocalPlayer) {
            console.log("Local player inserted! Starting game world.");
            startGameWorld();
        }
    });
    
    // Listen for player updates
    spacetimeDBClient.sdkConnection.db.player.onUpdate((_ctx, oldPlayer, newPlayer) => {
        console.log("Player updated event received");
        console.log("- Old player data:", JSON.stringify({
            name: oldPlayer.name,
            id: oldPlayer.identity.toHexString(),
            entityId: oldPlayer.entityId
        }));
        console.log("- New player data:", JSON.stringify({
            name: newPlayer.name,
            id: newPlayer.identity.toHexString(),
            entityId: newPlayer.entityId
        }));
        console.log("- Local identity:", spacetimeDBClient.identity?.toHexString());
        
        const isLocalPlayer = spacetimeDBClient.identity && newPlayer.identity.isEqual(spacetimeDBClient.identity);
        console.log("- Is local player:", isLocalPlayer);
        
        if (isLocalPlayer) {
            console.log("Local player updated! Starting game world.");
            startGameWorld();
        }
    });

    console.log("Checking for existing player...");
    const localPlayer = spacetimeDBClient.sdkConnection?.db.player.identity.find(spacetimeDBClient.identity);

    if (localPlayer?.name) {
        console.log(`Existing player found: ${localPlayer.name}. Starting game.`);
        startGameWorld(); // Player exists, start the game scene's initialization
    } else {
        console.log("New player detected or player data not yet in cache. Prompting for name.");
        showNamePrompt(); // Player doesn't exist in cache yet, prompt for name
                       // GameScene won't initialize fully until player data appears
    }
};

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 