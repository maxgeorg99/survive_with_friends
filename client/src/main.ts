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

function showNamePrompt() {
    console.log("Showing name prompt.");
    namePrompt.style.display = 'block';
    // Hide the game canvas while prompting for name
    if (game.canvas.parentElement) {
        game.canvas.parentElement.style.visibility = 'hidden';
    }
}

function hideNamePrompt() {
    console.log("Hiding name prompt.");
    namePrompt.style.display = 'none';
    // Show the game canvas
    if (game.canvas.parentElement) {
        game.canvas.parentElement.style.visibility = 'visible';
    }
}

function startGameWorld() {
    if (isGameWorldStarted) return; // Only start once
    isGameWorldStarted = true;
    console.log("Starting game world and emitting playerDataReady.");
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
            console.log(`Attempting to call setName reducer with name: ${name}`);
            spacetimeDBClient.sdkConnection?.reducers.setName(name);
            // Don't call startGameWorld here directly.
            // Wait for the player update to be reflected in the cache,
            // which will be picked up by GameScene's listeners.
            // We might hide the prompt optimistically or show a loading indicator.
            console.log("Name submitted. Waiting for server confirmation...");
            // Optionally hide prompt here, but GameScene needs player data.
            // hideNamePrompt();
        } else {
            console.error("Cannot set name: SpacetimeDB reducers not available.");
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

// Connection is initiated in SpacetimeDBClient constructor
// No need for spacetimeDBClient.connect(); here

// Ensure the client instance is accessible globally or passed to scenes as needed
(window as any).spacetimeDBClient = spacetimeDBClient;

console.log("Main script finished loading."); 