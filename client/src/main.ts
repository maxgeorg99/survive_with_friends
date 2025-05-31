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

console.log("Main script loading...");

// Create a global event emitter for game-wide events
const gameEvents = new Phaser.Events.EventEmitter();
// Make it accessible globally
(window as any).gameEvents = gameEvents;

// Add a global cleanup function accessible from anywhere
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
    scene: [TitleScene, NameSelectScene, ClassSelectScene, GameScene, DeadScene, VictoryScene, LoadingScene],
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
        if (account.identity.isEqual(localIdentity)) {
            console.log("Local account inserted with state:", account.state.tag);
            
            // Emit account created event with the account data
            gameEvents.emit(GameEvents.ACCOUNT_CREATED, ctx, account);
            
            // Only auto-navigate if we're currently in TitleScene (fresh start)
            // LoadingScene and other scenes should handle their own navigation
            const currentScene = game.scene.getScenes(true)[0];
            if (currentScene && currentScene.scene.key === 'TitleScene') {
                console.log("Auto-navigating from account insert (from TitleScene)");
                navigateBasedOnAccountState(account.state);
            } else {
                console.log("Account inserted but scene", currentScene?.scene.key || 'none', "is active, letting it handle navigation");
            }
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
            // Only auto-navigate if we're in TitleScene (meaning we weren't in a game flow)
            if (oldAccount.state.tag !== newAccount.state.tag) {
                const currentScene = game.scene.getScenes(true)[0];
                if (currentScene && currentScene.scene.key === 'TitleScene') {
                    console.log("Auto-navigating from account update - state changed (from TitleScene)");
                    navigateBasedOnAccountState(newAccount.state);
                } else {
                    console.log("Account state changed but scene", currentScene?.scene.key || 'none', "is active, letting it handle the change via events");
                }
            }
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
            
            // Emit player created event
            gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player);
        } else {
            console.log("Another player has logged on: " + player.name);
            
            // Emit player created event for other players too
            gameEvents.emit(GameEvents.PLAYER_CREATED, ctx, player, false);
        }
    });

    // Listen for player updates
    localDb.player.onUpdate((ctx, oldPlayer, newPlayer) => {
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
        if (!myAccount) {
            console.log("No account found for local identity.");
            return;
        }

        if (myAccount.currentPlayerId === player.playerId) {
            console.log("Local player was deleted/died!");
            
            // Emit player died event
            gameEvents.emit(GameEvents.PLAYER_DIED, ctx, player);
            
            // The server will handle transitioning the account to Dead state
            // No need to manually navigate here
        } else {
            // Emit player deleted event for other players
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
    console.log("onSubscriptionApplied: Account exists, letting current scene or LoadingScene handle navigation");
    
    // Don't auto-navigate here - let LoadingScene or other scenes handle navigation
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