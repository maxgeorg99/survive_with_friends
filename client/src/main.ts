import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import TitleScene from './scenes/TitleScene';
import NameSelectScene from './scenes/NameSelectScene';
import ClassSelectScene from './scenes/ClassSelectScene';
import DeadScene from './scenes/DeadScene';
import VictoryScene from './scenes/VictoryScene';
import LoadingScene from './scenes/LoadingScene';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import SpacetimeDBClient from './SpacetimeDBClient';
import { DbConnection, ErrorContext, SubscriptionEventContext } from './autobindings';
import { GameEvents } from './constants/GameEvents';
import SoundManager from './managers/SoundManager';
import SplashScene from './scenes/SplashScene';
import QuestScene from './scenes/QuestScene';
import BestaryScene from './scenes/BestaryScene';
import AchievementScene from './scenes/AchievementScene';

console.log("Main script loading...");

// Create loading overlay before Phaser initializes
const createLoadingOverlay = () => {
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.style.position = 'fixed';
    loadingOverlay.style.top = '0';
    loadingOverlay.style.left = '0';
    loadingOverlay.style.width = '100vw';
    loadingOverlay.style.height = '100vh';
    loadingOverlay.style.backgroundColor = '#333'; // Match index.html background
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.justifyContent = 'center';
    loadingOverlay.style.alignItems = 'center';
    loadingOverlay.style.zIndex = '-9999'; // As far back as possible
    loadingOverlay.style.fontFamily = 'Arial, sans-serif';
    
    const loadingText = document.createElement('div');
    loadingText.textContent = 'Loading';
    loadingText.style.color = 'white'; // White text on dark background
    loadingText.style.fontSize = '48px';
    loadingText.style.fontWeight = 'bold';
    loadingText.style.textAlign = 'center';
    loadingText.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)'; // Better shadow for white text
    
    // Create animated dots
    const dotsSpan = document.createElement('span');
    dotsSpan.id = 'loading-dots';
    dotsSpan.style.color = 'white';
    
    loadingText.appendChild(dotsSpan);
    loadingOverlay.appendChild(loadingText);
    document.body.appendChild(loadingOverlay);
    
    // Animate the dots
    let dotCount = 0;
    const animateDots = () => {
        dotCount = (dotCount + 1) % 4; // 0, 1, 2, 3, then repeat
        dotsSpan.textContent = '.'.repeat(dotCount);
    };
    
    // Start animation
    const dotInterval = setInterval(animateDots, 500); // Change every 500ms
    
    // Store interval ID for cleanup if needed
    (loadingOverlay as any).dotInterval = dotInterval;
    
    console.log("Loading overlay created with animated dots");
    return loadingOverlay;
};

// Create the overlay immediately
const loadingOverlay = createLoadingOverlay();

// Create a global event emitter for game-wide events
const gameEvents = new Phaser.Events.EventEmitter();
// Make it accessible globally
(window as any).gameEvents = gameEvents;

// Create a global SoundManager for game-wide audio effects
const soundManager = new SoundManager();
// Make it accessible globally
(window as any).soundManager = soundManager;

// Add a global cleanup function accessible from anywhere
(window as any).cleanupDOMElements = () => {
    console.log("Global window.cleanupDOMElements called - only for manual use");
    cleanupDOMElements();
};

// Development cheats removed for production

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
    scene: [SplashScene,TitleScene, NameSelectScene, ClassSelectScene, GameScene, LoadingScene, QuestScene, BestaryScene, AchievementScene],
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    transparent: true
};

const game = new Phaser.Game(config);
console.log("Phaser game initialized.");

// Expose game instance to window for development/testing
(window as any).game = game;

// Global DOM cleanup function
const cleanupDOMElements = () => {
    console.log("Global DOM cleanup triggered");
    
    try {
        // Clean up name select scene elements
        const nameInput = document.getElementById('name-select-input');
        if (nameInput && nameInput.parentNode) {
            console.log("Global cleanup: Removing name input");
            nameInput.remove();
        }
        
        // Clean up login scene elements (legacy)
        const loginInput = document.getElementById('login-name-input');
        if (loginInput && loginInput.parentNode) {
            console.log("Global cleanup: Removing login input");
            loginInput.remove();
        }
        
        document.querySelectorAll('.name-select-button, .login-button').forEach(el => {
            if (el && el.parentNode) {
                console.log("Global cleanup: Removing button");
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
        
        // Generic cleanup for text inputs that could be from any scene
        document.querySelectorAll('input[type="text"]').forEach(el => {
            const id = el.id;
            if (id === 'name-select-input' || id === 'login-name-input') {
                console.log("Global cleanup: Removing text input", id);
                if (el.parentNode) el.remove();
            }
        });
        
        // Generic cleanup for buttons that could be from any scene
        document.querySelectorAll('button').forEach(el => {
            const content = (el as HTMLElement).textContent;
            if (content && (
                content.includes('Set Name') ||
                content.includes('Fighter') ||
                content.includes('Rogue') ||
                content.includes('Mage') ||
                content.includes('Paladin') ||
                content.includes('Confirm') ||
                content.includes('START GAME')
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
        if (account.identity.isEqual(localIdentity)) {
            console.log("Local account inserted with state:", account.state.tag);
            
            // Emit account created event with the account data
            gameEvents.emit(GameEvents.ACCOUNT_CREATED, ctx, account);
            
            // Disable auto-navigation - let the Start Game button handle navigation instead
            console.log("Account inserted but auto-navigation disabled - user must click Start Game button");
        } else {
            console.log("Another user has logged on: " + account.identity.toString());
        }
    });

    localDb.account.onUpdate((ctx, oldAccount, newAccount) => {
        console.log("Account updated event received");
        console.log("- Account state changed from", oldAccount.state.tag, "to", newAccount.state.tag);

        // Check if account is local
        if (newAccount.identity.isEqual(localIdentity)) {
            console.log("Local account updated.");
            
            // Emit account updated event with old and new account data
            gameEvents.emit(GameEvents.ACCOUNT_UPDATED, ctx, oldAccount, newAccount);
            
            // Let individual scenes handle state changes through ACCOUNT_UPDATED events
            // Auto-navigation disabled - only Start Game button or scene-specific handlers should navigate
            console.log("Account state updated but auto-navigation disabled - scenes handle their own transitions");
        } else {
            console.log("Another user's account updated: " + newAccount.identity.toString());
        }
    });

    // Listen for player inserts
    localDb.player.onInsert((ctx, player) => {
        console.log("Player inserted event received");
        console.log("- Player data: " + player.name + " - " + player.playerId);

        const myAccount = ctx.db?.account.identity.find(localIdentity);
        if (!myAccount) {
            console.log("No account found for local identity. Waiting for account.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) {
            console.log("Local player inserted!");
            gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player, true);
        } else {
            console.log("Other player inserted!");
            gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player, false);
        }
    });

    // Add defensive checks for player updates
    localDb.player.onUpdate((ctx, oldPlayer, newPlayer) => {
        if (!oldPlayer || !newPlayer) {
            console.warn("Received player update with missing data, skipping");
            return;
        }

        const myAccount = ctx.db?.account.identity.find(localIdentity);
        if (!myAccount) {
            console.log("No account found for local identity. Waiting for account.");
            return;
        }

        if (myAccount.currentPlayerId === newPlayer.playerId) {
            gameEvents.emit(GameEvents.PLAYER_UPDATED, ctx, oldPlayer, newPlayer, true);
        } else {
            gameEvents.emit(GameEvents.PLAYER_UPDATED, ctx, oldPlayer, newPlayer, false);
        }
    });

    // Add defensive checks for player deletes
    localDb.player.onDelete((ctx, player) => {
        if (!player) {
            console.warn("Received player delete with missing data, skipping");
            return;
        }

        const myAccount = ctx.db?.account.identity.find(localIdentity);
        if (!myAccount) {
            console.log("No account found for local identity. Waiting for account.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) {
            gameEvents.emit(GameEvents.PLAYER_DELETED, ctx, player, true);
        } else {
            gameEvents.emit(GameEvents.PLAYER_DELETED, ctx, player, false);
        }
    });

    // Entity event listeners
    localDb.entity.onInsert((ctx, entity) => {
        gameEvents.emit(GameEvents.ENTITY_CREATED, ctx, entity);
    });

    localDb.entity.onUpdate((ctx, oldEntity, newEntity) => {
        gameEvents.emit(GameEvents.ENTITY_UPDATED, ctx, oldEntity, newEntity);
    });

    localDb.entity.onDelete((ctx, entity) => {
        gameEvents.emit(GameEvents.ENTITY_DELETED, ctx, entity);
    });

    // Monster event listeners
    localDb.monsters.onInsert((ctx, monster) => {
        gameEvents.emit(GameEvents.MONSTER_CREATED, ctx, monster);
    });

    localDb.monsters.onUpdate((ctx, oldMonster, newMonster) => {
        gameEvents.emit(GameEvents.MONSTER_UPDATED, ctx, oldMonster, newMonster);
    });

    localDb.monsters.onDelete((ctx, monster) => {
        gameEvents.emit(GameEvents.MONSTER_DELETED, ctx, monster);
    });

    // Attack event listeners
    localDb.activeAttacks.onInsert((ctx, attack) => {
        gameEvents.emit(GameEvents.ATTACK_CREATED, ctx, attack);
    });

    localDb.activeAttacks.onUpdate((ctx, oldAttack, newAttack) => {
        gameEvents.emit(GameEvents.ATTACK_UPDATED, ctx, oldAttack, newAttack);
    });

    localDb.activeAttacks.onDelete((ctx, attack) => {
        gameEvents.emit(GameEvents.ATTACK_DELETED, ctx, attack);
    });

    // Check initial state and load appropriate scene
    console.log("Checking current account state for initial navigation...");
    const myAccount = ctx.db?.account.identity.find(localIdentity);
    
    if (!myAccount) {
        console.log("No account found for local identity. Will wait for account creation.");
        // Don't navigate here - let the account insert handler or LoadingScene handle it
        return;
    }

    console.log("Found account with state:", myAccount.state.tag);
    console.log("onSubscriptionApplied: Account exists but auto-navigation disabled - user must click Start Game button");
    
    // Auto-navigation disabled - only the Start Game button should trigger navigation
    // This prevents conflicts between multiple navigation systems
};

// Helper function to navigate based on account state
function navigateBasedOnAccountState(accountState: any) {
    console.log("Navigating based on account state:", accountState.tag);
    
    // Double-check that we're still in TitleScene before navigating
    // This prevents race conditions where button clicks and auto-navigation conflict
    const currentScene = game.scene.getScenes(true)[0];
    if (currentScene && currentScene.scene.key !== 'TitleScene') {
        console.log("Navigation requested but no longer in TitleScene (current:", currentScene.scene.key, ") - aborting to prevent conflicts");
        return;
    }
    
    cleanupDOMElements(); // Clean up before any transition
    
    switch (accountState.tag) {
        case 'ChoosingName':
            game.scene.start('NameSelectScene');
            break;
            
        case 'ChoosingClass':
            game.scene.start('ClassSelectScene');
            break;
            
        case 'Playing':
            game.scene.start('GameScene');
            break;
            
        case 'Dead':
            game.scene.start('DeadScene');
            break;
            
        case 'Winner':
            game.scene.start('VictoryScene');
            break;
            
        default:
            console.warn("Unknown account state:", accountState.tag);
            // Default to title scene if state is unrecognized
            game.scene.start('TitleScene');
            break;
    }
}

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

// Start with TitleScene by default
game.scene.start('TitleScene'); 