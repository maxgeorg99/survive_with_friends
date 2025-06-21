import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Player, Entity, PlayerClass, Account, EventContext, ErrorContext, UpgradeOptionData } from "../autobindings";
import MonsterManager from '../managers/MonsterManager';
import MonsterSpawnerManager from '../managers/MonsterSpawnerManager';
import { GameEvents } from '../constants/GameEvents';
import { AttackManager } from '../managers/AttackManager';
import { MonsterAttackManager } from '../managers/MonsterAttackManager';
import GemManager from '../managers/GemManager';
import LootCapsuleManager from '../managers/LootCapsuleManager';
import BossAgnaManager from '../managers/BossAgnaManager';
import { createPlayerDamageEffect, createMonsterDamageEffect } from '../utils/DamageEffects';
import UpgradeUI from '../ui/UpgradeUI';
import PlayerHUD from '../ui/PlayerHUD';
import BossTimerUI from '../ui/BossTimerUI';
import MonsterCounterUI from '../ui/MonsterCounterUI';
import VoidChestUI from '../ui/VoidChestUI';
import SoulUI from '../ui/SoulUI';
import Minimap, { MinimapElements } from '../ui/Minimap';
import MusicManager from '../managers/MusicManager';
import { DebugManager } from '../managers/DebugManager'; // Added import for DebugManager
import GameplayOptionsUI from '../ui/GameplayOptionsUI';
import { getSoundVolume } from '../managers/VolumeSettings';

// Constants
const PLAYER_SPEED = 200;
const PLAYER_ASSET_KEY = 'player_fighter_1';
const GRASS_ASSET_KEY = 'grass_background';
const SHADOW_ASSET_KEY = 'shadow';
const SHADOW_OFFSET_Y = 14; // Vertical offset for the shadow (Increased)
const SHADOW_ALPHA = 0.4; // Transparency for the shadow
const INTERPOLATION_SPEED = 0.2; // Speed of interpolation (0-1, higher is faster)
const DIRECTION_UPDATE_RATE = 100; // Send direction updates every 100ms
const PLAYER_NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
    fontSize: '16px',
    fontFamily: 'Arial',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
};
// Health bar configuration
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_OFFSET_Y = 18; // Position health bar above the exp bar
// EXP bar configuration
const EXP_BAR_WIDTH = 50;
const EXP_BAR_HEIGHT = 4;
const EXP_BAR_OFFSET_Y = 8; // Place the exp bar below the health bar
const NAME_OFFSET_Y = HEALTH_BAR_OFFSET_Y + 16; // Increased vertical offset for player name

// Monster rendering constants
const MONSTER_SHADOW_OFFSET_Y = 8; // Vertical offset for monster shadows
const MONSTER_HEALTH_BAR_WIDTH = 40;
const MONSTER_HEALTH_BAR_HEIGHT = 4;
const MONSTER_HEALTH_BAR_OFFSET_Y = 12;

// Depth sorting constants
const BASE_DEPTH = 1000; // Base depth to ensure all sprites are above background
const SHADOW_DEPTH_OFFSET = -1; // Always behind the sprite
const NAME_DEPTH_OFFSET = 2; // Always in front of the sprite
const HEALTH_BG_DEPTH_OFFSET = 1; // Just behind health bar but in front of sprite
const HEALTH_BAR_DEPTH_OFFSET = 1.1; // In front of background but behind name
const EXP_BG_DEPTH_OFFSET = 1; // Same as health background
const EXP_BAR_DEPTH_OFFSET = 1.1; // Same as health bar
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements

// Movement and position constants
const POSITION_CORRECTION_THRESHOLD = 49; // Distance squared threshold for position correction (7 pixels)

// Asset keys for different player classes
const CLASS_ASSET_KEYS: Record<string, string> = {
    "Fighter": 'player_fighter',
    "Rogue": 'player_rogue',
    "Mage": 'player_mage',
    "Paladin": 'player_paladin'
};

export default class GameScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    private debugManager!: DebugManager; // Added DebugManager property
    private playerInitialized = false;
    private localPlayerSprite: Phaser.Physics.Arcade.Sprite | null = null;
    private localPlayerNameText: Phaser.GameObjects.Text | null = null;
    private localPlayerShadow: Phaser.GameObjects.Image | null = null; // Added for local player shadow
    private otherPlayers: Map<number, Phaser.GameObjects.Container> = new Map();
    // Map to hold player data waiting for corresponding entity data (keyed by entityId)
    private pendingPlayers: Map<number, Player> = new Map();
    
    // Replace monster-related properties with MonsterManager
    private monsterManager: MonsterManager | null = null;
    
    // Add monster spawner manager for spawn indicators
    private monsterSpawnerManager: MonsterSpawnerManager | null = null;
    
    // Add attack manager for player attack visualization
    private attackManager: AttackManager | null = null;
    
    // Add monster attack manager for monster attack visualization
    private monsterAttackManager: MonsterAttackManager | null = null;
    
    // Add gem manager for gem visualization
    private gemManager: GemManager | null = null;
    
    // Add loot capsule manager for loot capsule visualization
    private lootCapsuleManager: LootCapsuleManager | null = null;
    
    // Add boss Agna manager for magic circle visualization
    private bossAgnaManager: BossAgnaManager | null = null;
    
    // Add upgrade UI manager
    private upgradeUI: UpgradeUI | null = null;
    
    // Add player HUD
    private playerHUD: PlayerHUD | null = null;
    
    // Add boss timer UI
    private bossTimerUI: BossTimerUI | null = null;
    
    // Add minimap
    private minimap: Minimap | null = null;
    private minimapElements: MinimapElements | null = null;
    
    private localPlayerId: number = 0;
    
    private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;

    private backgroundTile: Phaser.GameObjects.TileSprite | null = null;
    private isPlayerDataReady = false;
    
    // Server-authoritative motion variables
    private lastDirectionUpdateTime: number = 0;
    private serverPosition: Phaser.Math.Vector2 | null = null;
    private currentDirection: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0);
    private isMoving: boolean = false;

    // Add a property to track tap target
    private tapTarget: Phaser.Math.Vector2 | null = null;
    // Add property for tap marker visual
    private tapMarker: Phaser.GameObjects.Container | null = null;

    // Add property to track boundary state
    private isNearBoundary: {top: boolean, right: boolean, bottom: boolean, left: boolean} = {
        top: false,
        right: false,
        bottom: false,
        left: false
    };

    private gameOver: boolean = false;

    // Add predicted position for client-side prediction
    private predictedPosition: Phaser.Math.Vector2 | null = null;

    // Add monster counter UI
    private monsterCounterUI: MonsterCounterUI | null = null;

    // Dark haze overlay for boss fights
    private bossHazeOverlay: Phaser.GameObjects.Rectangle | null = null;

    // Add VoidChest UI for alerts and directional arrow
    private voidChestUI: VoidChestUI | null = null;

    // Add Soul UI for guiding players to their soul
    private soulUI: SoulUI | null = null;

    // Add Options UI for settings
    private optionsUI: GameplayOptionsUI | null = null;

    // Track if player damage sound is currently playing
    private isPlayerDamageSoundPlaying: boolean = false;

    constructor() {
        super('GameScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("GameScene constructor called.");
    }

    // Helper functions for boss type checking
    private isBoss(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase1' || monsterType === 'BossEnderPhase2' ||
               monsterType === 'BossAgnaPhase1' || monsterType === 'BossAgnaPhase2';
    }

    private isBossPhase1(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase1' || monsterType === 'BossAgnaPhase1';
    }

    private isBossPhase2(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase2' || monsterType === 'BossAgnaPhase2';
    }

    preload() {
        console.log("GameScene preload started.");
        // Load assets from the /assets path (copied from public)
        this.load.image('player_fighter', '/assets/class_fighter_1.png');
        this.load.image('player_rogue', '/assets/class_rogue_1.png');
        this.load.image('player_mage', '/assets/class_mage_1.png');
        this.load.image('player_paladin', '/assets/class_paladin_1.png');
        this.load.image(GRASS_ASSET_KEY, '/assets/grass.png');
        this.load.image(SHADOW_ASSET_KEY, '/assets/shadow.png');
        
        // Load monster assets
        this.load.image('monster_rat', '/assets/monster_rat.png');
        this.load.image('monster_slime', '/assets/monster_slime.png');
        this.load.image('monster_orc', '/assets/monster_orc.png');
        this.load.image('monster_imp', '/assets/monster_imp.png');
        this.load.image('monster_zombie', '/assets/monster_zombie.png');
        this.load.image('monster_bat', '/assets/monster_bat.png');
        this.load.image('monster_void_claw', '/assets/monster_void_claw.png');
        this.load.image('monster_spawn_indicator', '/assets/monster_spawn_indicator.png');
        
        // Load boss monster assets
        this.load.image('final_boss_phase1', '/assets/final_boss_phase_1.png');
        this.load.image('final_boss_phase2', '/assets/final_boss_phase_2.png');
        this.load.image('boss_agna_1', '/assets/boss_agna_1.png');
        this.load.image('boss_agna_2', '/assets/boss_agna_2.png');
        this.load.image('agna_flamethrower', '/assets/agna_flamethrower.png');
        this.load.image('agna_magic_circle', '/assets/agna_magic_circle.png');
        this.load.image('agna_circle_orb', '/assets/agna_circle_orb.png');
        this.load.image('agna_candle', '/assets/agna_candle.png');
        this.load.image('agna_candle_off', '/assets/agna_candle_off.png');
        this.load.image('agna_flame_ground', '/assets/agna_flame_ground.png');
        
        // Load special monster assets
        this.load.image('treasure_chest', '/assets/treasure_chest.png');
        
        // Load structure assets
        this.load.image('structure_crate', '/assets/structure_crate.png');
        this.load.image('structure_tree', '/assets/structure_tree.png');
        this.load.image('structure_statue', '/assets/structure_statue.png');
        
        // Load attack assets
        this.load.image('attack_sword', '/assets/attack_sword.png');
        this.load.image('attack_wand', '/assets/attack_wand.png');
        this.load.image('attack_knife', '/assets/attack_knife.png');
        this.load.image('attack_shield', '/assets/attack_shield.png');
        
        // Load monster attack assets
        this.load.image('monster_attack_firebolt', '/assets/monster_attack_firebolt.png');
        this.load.image('void_scythe', '/assets/void_scythe.png');
        this.load.image('void_bolt', '/assets/void_bolt.png');
        this.load.image('void_zone', '/assets/void_zone.png');
        this.load.image('void_ball', '/assets/void_ball.png');
        this.load.image('claw_spawn', '/assets/claw_spawn.png');
        
        // Also load class icons with ClassSelectScene keys to keep them cached
        this.load.image('fighter_icon', '/assets/attack_sword.png');
        this.load.image('rogue_icon', '/assets/attack_knife.png');
        this.load.image('mage_icon', '/assets/attack_wand.png');
        this.load.image('paladin_icon', '/assets/attack_shield.png');
        
        // Load upgrade assets
        this.load.image('card_blank', '/assets/card_blank.png');
        this.load.image('upgrade_maxHP', '/assets/upgrade_maxHP.png');
        this.load.image('upgrade_regenHP', '/assets/upgrade_regenHP.png');
        this.load.image('upgrade_speed', '/assets/upgrade_speed.png');
        this.load.image('upgrade_armor', '/assets/upgrade_armor.png');
        
        // Load gem assets
        this.load.image('gem_1', '/assets/gem_1.png');
        this.load.image('gem_2', '/assets/gem_2.png');
        this.load.image('gem_3', '/assets/gem_3.png');
        this.load.image('gem_4', '/assets/gem_4.png');
        this.load.image('soul', '/assets/soul.png');
        this.load.image('fries', '/assets/fries.png');
        this.load.image('dice', '/assets/dice.png');
        this.load.image('booster_pack', '/assets/booster_pack.png');
        
        // Load loot capsule assets
        this.load.image('void_capsule', '/assets/void_capsule.png');
        
        // Load VoidChest UI assets
        this.load.image('void_arrow', '/assets/void_arrow.png');
        
        // Load Soul UI assets
        this.load.image('soul_arrow', '/assets/soul_arrow.png');
        
        // Load a white pixel for particle effects
        this.load.image('white_pixel', '/assets/white_pixel.png');
        
        // Load assets for options menu
        this.load.image('icon_music', '/assets/icon_music.png');
        this.load.image('icon_sound', '/assets/icon_sound.png');
        this.load.image('button_pvp_on', '/assets/button_pvp_on.png');
        this.load.image('button_pvp_off', '/assets/button_pvp_off.png');
        
        // Load audio files for gameplay sounds
        this.load.audio('attack_fire', '/assets/sounds/attack_fire.mp3');
        this.load.audio('attack_soft', '/assets/sounds/attack_soft.mp3');
        this.load.audio('monster_death', '/assets/sounds/monster_death.mp3');
        this.load.audio('level_up', '/assets/sounds/level_up.mp3');
        this.load.audio('voice_level', '/assets/sounds/voice_level.mp3');
        this.load.audio('voice_chest', '/assets/sounds/voice_chest.mp3');
        this.load.audio('alert_event', '/assets/sounds/alert_event.mp3');
        this.load.audio('player_damage', '/assets/sounds/player_damage.mp3');
        this.load.audio('void_capsule_spawned', '/assets/sounds/void_capsule_spawned.mp3');
        this.load.audio('void_capsule_lands', '/assets/sounds/void_capsule_lands.mp3');
        this.load.audio('void_chest_destroyed', '/assets/sounds/void_chest_destroyed.mp3');
        this.load.audio('structure_broken', '/assets/sounds/structure_broken.mp3');
        this.load.audio('upgrade_bar_fill', '/assets/sounds/upgrade_bar_fill.mp3');
        
        // Load boss audio files
        this.load.audio('boss_chase_cue', '/assets/sounds/boss_chase_cue.mp3');
        this.load.audio('boss_bullet_cue', '/assets/sounds/boss_bullet_cue.mp3');
        this.load.audio('boss_teleport_cue', '/assets/sounds/boss_teleport_cue.mp3');
        this.load.audio('boss_vanish', '/assets/sounds/boss_vanish.mp3');
        this.load.audio('boss_appear', '/assets/sounds/boss_appear.mp3');
        this.load.audio('boss_roar', '/assets/sounds/boss_roar.mp3');
        this.load.audio('chaos_bolt_fire', '/assets/sounds/chaos_bolt_fire.mp3');
        this.load.audio('boss_teleport_attack', '/assets/sounds/boss_teleport_attack.mp3');
        this.load.audio('boss_transform', '/assets/sounds/boss_transform.mp3');
        this.load.audio('voice_boss', '/assets/sounds/voice_boss.mp3');
        this.load.audio('voice_boss_2', '/assets/sounds/voice_boss_2.mp3');
        this.load.audio('voice_transform', '/assets/sounds/voice_transform.mp3');
        this.load.audio('ui_click', '/assets/sounds/ui_click.mp3');
        this.load.audio('voice_agna_1', '/assets/sounds/narrator_agna_1.mp3');
        this.load.audio('voice_agna_2', '/assets/sounds/narrator_agna_2.mp3');
        this.load.audio('agna_phase_2', '/assets/sounds/agna_phase_2.mp3');
        this.load.audio('agna_burned', '/assets/sounds/agna_burned.mp3');
        this.load.audio('agna_closing_in', '/assets/sounds/agna_closing_in.mp3');
        this.load.audio('agna_fire_orb', '/assets/sounds/agna_fire_orb.mp3');
        this.load.audio('agna_flamethrower', '/assets/sounds/agna_flamethrower.mp3');
        this.load.audio('agna_match', '/assets/sounds/agna_match.mp3');
        this.load.audio('agna_wick', '/assets/sounds/agna_wick.mp3');
        this.load.audio('agna_extinguished', '/assets/sounds/agna_extinguished.mp3');
        this.load.audio('agna_ritual_fail', '/assets/sounds/agna_ritual_fail.mp3');
        this.load.audio('agna_laugh', '/assets/sounds/agna_laugh.mp3');
        
        // Add error handling for file loading errors
        this.load.on('loaderror', (fileObj: any) => {
            console.error(`Error loading asset: ${fileObj.key} (${fileObj.url})`, fileObj);
            alert(`Failed to load game asset: ${fileObj.key}. Check browser console for details.`);
        });
        
        // Check if assets are loaded successfully
        this.load.on('complete', () => {
            console.log("All assets loaded. Checking existence:");
            console.log("player_fighter:", this.textures.exists('player_fighter'));
            console.log("player_rogue:", this.textures.exists('player_rogue'));
            console.log("player_mage:", this.textures.exists('player_mage'));
            console.log("player_paladin:", this.textures.exists('player_paladin'));
            console.log("monster_rat:", this.textures.exists('monster_rat'));
            console.log("monster_slime:", this.textures.exists('monster_slime'));
            console.log("monster_orc:", this.textures.exists('monster_orc'));
            console.log("monster_imp:", this.textures.exists('monster_imp'));
            console.log("monster_zombie:", this.textures.exists('monster_zombie'));
            console.log("monster_bat:", this.textures.exists('monster_bat'));
            console.log("monster_void_claw:", this.textures.exists('monster_void_claw'));
            console.log("structure_crate:", this.textures.exists('structure_crate'));
            console.log("structure_tree:", this.textures.exists('structure_tree'));
            console.log("structure_statue:", this.textures.exists('structure_statue'));
            console.log("void_ball:", this.textures.exists('void_ball'));
            console.log("attack_sword:", this.textures.exists('attack_sword'));
            console.log("attack_wand:", this.textures.exists('attack_wand'));
            console.log("attack_knife:", this.textures.exists('attack_knife'));
            console.log("attack_shield:", this.textures.exists('attack_shield'));
            console.log("void_arrow:", this.textures.exists('void_arrow'));
            console.log("soul_arrow:", this.textures.exists('soul_arrow'));
            console.log(GRASS_ASSET_KEY + ":", this.textures.exists(GRASS_ASSET_KEY));
            console.log(SHADOW_ASSET_KEY + ":", this.textures.exists(SHADOW_ASSET_KEY));
            
            // Check audio assets
            console.log("Audio assets loaded:");
            console.log("attack_fire:", this.cache.audio.exists('attack_fire'));
            console.log("attack_soft:", this.cache.audio.exists('attack_soft'));
            console.log("monster_death:", this.cache.audio.exists('monster_death'));
            console.log("level_up:", this.cache.audio.exists('level_up'));
            console.log("voice_level:", this.cache.audio.exists('voice_level'));
            console.log("voice_chest:", this.cache.audio.exists('voice_chest'));
            console.log("player_damage:", this.cache.audio.exists('player_damage'));
            console.log("void_capsule_spawned:", this.cache.audio.exists('void_capsule_spawned'));
            console.log("void_capsule_lands:", this.cache.audio.exists('void_capsule_lands'));
            console.log("void_chest_destroyed:", this.cache.audio.exists('void_chest_destroyed'));
            console.log("structure_broken:", this.cache.audio.exists('structure_broken'));
            console.log("upgrade_bar_fill:", this.cache.audio.exists('upgrade_bar_fill'));
            console.log("boss_chase_cue:", this.cache.audio.exists('boss_chase_cue'));
            console.log("voice_boss:", this.cache.audio.exists('voice_boss'));
        });
        
        console.log("GameScene preload finished. Started asset loading...");
    }

    create() {
        console.log("GameScene create started.");

        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
        }

        // Initialize music manager and start main music
        this.musicManager = new MusicManager(this);
        this.musicManager.playTrack('main');

        // Play welcome voice when entering the game
        if (soundManager) {
            soundManager.playSound('voice_welcome', 1.0);
        }

        // Clean up any lingering UI elements from other scenes
        this.cleanupLingeringUIElements();

        // Set a fallback background color
        this.cameras.main.setBackgroundColor('#336699'); // A nice blue

        // Register event listeners
        this.registerEventListeners();
        console.log("Game event listeners registered.");

        this.playerInitialized = false;

        this.gameOver = false;

        // Setup keyboard input
        this.cursors = this.input.keyboard?.createCursorKeys() ?? null;
        
        if (this.input.keyboard) 
        {
            this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', this.rerollUpgrades, this);
        }
        console.log("Keyboard input (excluding debug keys) set up.");

        // Initialize the boss timer UI
        this.bossTimerUI = new BossTimerUI(this, this.spacetimeDBClient);
        console.log("Boss timer UI initialized.");
        
        // Setup touch input
        this.setupTouchInput();
        console.log("Touch input set up.");

        // Create tap marker container
        const tapMarkerContainer = this.add.container(0, 0);
        
        // Create outer circle
        const outerCircle = this.add.circle(0, 0, 32, 0xffffff, 0.3);
        
        // Create inner circle
        const innerCircle = this.add.circle(0, 0, 16, 0x00ffff, 0.5);
        
        // Create an X using line graphics
        const crossGraphics = this.add.graphics();
        crossGraphics.lineStyle(4, 0xffffff, 0.7);
        crossGraphics.beginPath();
        crossGraphics.moveTo(-8, -8);
        crossGraphics.lineTo(8, 8);
        crossGraphics.moveTo(8, -8);
        crossGraphics.lineTo(-8, 8);
        crossGraphics.closePath();
        crossGraphics.strokePath();
        
        // Add all elements to the container
        tapMarkerContainer.add([outerCircle, innerCircle, crossGraphics]);
        
        // Set initial state
        tapMarkerContainer.setVisible(false);
        tapMarkerContainer.setDepth(100); // Just above grass (0) but below everything else
        
        // Store the container
        this.tapMarker = tapMarkerContainer;
        console.log("Tap marker created", { marker: this.tapMarker });

        // Background - Make it large enough to feel like a world
        const worldSize = 6400; // World size - 10x larger
        this.backgroundTile = this.add.tileSprite(0, 0, worldSize, worldSize, GRASS_ASSET_KEY)
            .setOrigin(0, 0)
            .setScrollFactor(1); // Scroll with the camera
        this.physics.world.setBounds(0, 0, worldSize, worldSize);
        console.log("Background and world bounds set up. World size:", worldSize);

        // Initialize game world once event listeners are set up
        console.log("Waiting for account login updated event to initialize game world...");

        // Initialize MonsterManager
        this.monsterManager = new MonsterManager(this, this.spacetimeDBClient);
        
        // Initialize AttackManager
        this.attackManager = new AttackManager(this, this.spacetimeDBClient);
        
        // Initialize DebugManager AFTER AttackManager is created
        this.debugManager = new DebugManager(this, this.spacetimeDBClient, this.attackManager);
        this.debugManager.initializeDebugKeys();
        console.log("DebugManager initialized in GameScene.");
        
        // Initialize MonsterSpawnerManager
        this.monsterSpawnerManager = new MonsterSpawnerManager(this, this.spacetimeDBClient);

        // Create minimap
        this.createMinimap();

        this.spacetimeDBClient.sdkConnection?.reducers.updateLastLogin();

        // Initialize monster counter UI
        this.monsterCounterUI = new MonsterCounterUI(this);

        // Initialize VoidChest UI for alerts and directional arrow
        this.voidChestUI = new VoidChestUI(this, this.spacetimeDBClient);

        // Initialize Soul UI for guiding players to their soul
        this.soulUI = new SoulUI(this, this.spacetimeDBClient);

        // Set the SoulUI reference on the minimap if it exists
        if (this.minimap) {
            this.minimap.setSoulUI(this.soulUI);
        }

        // Initialize Options UI for settings
        this.optionsUI = new GameplayOptionsUI(this);

        // Add key listener for toggling monster counter UI
        this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D).on('down', () => {
            if (this.monsterCounterUI) {
                this.monsterCounterUI.toggleVisible();
            }
        });

        // Add key listener for toggling options menu
        this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.O).on('down', () => {
            if (this.optionsUI) {
                this.optionsUI.toggle();
            }
        });

        // Handle window resize to update UI positions
        this.scale.on('resize', this.handleResize, this);

        console.log("Game world initialization complete.");
    }

    private registerEventListeners() {

        // Initialize game world once event listeners are set up
        this.gameEvents.on(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);

        // Player events
        this.gameEvents.on(GameEvents.PLAYER_CREATED, this.handlePlayerCreated, this);
        this.gameEvents.on(GameEvents.PLAYER_UPDATED, this.handlePlayerUpdated, this);
        this.gameEvents.on(GameEvents.PLAYER_DELETED, this.handlePlayerDeleted, this);
        this.gameEvents.on(GameEvents.PLAYER_DIED, this.handlePlayerDied, this);
        
        // Connection events
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);

        // Monster events for boss music detection
        this.gameEvents.on(GameEvents.MONSTER_CREATED, this.handleMonsterCreatedForMusic, this);

        // Listen for game state changes to hide haze when boss is defeated
        this.gameEvents.on(GameEvents.GAME_STATE_UPDATED, this.handleGameStateUpdated, this);

        // Add table event handlers for upgrade options
        if (this.spacetimeDBClient.sdkConnection) {
            // Listen for upgrade options
            this.spacetimeDBClient.sdkConnection.db.upgradeOptions.onInsert(
                (ctx: EventContext, upgrade: UpgradeOptionData) => this.handleUpgradeOptionCreated(ctx, upgrade)
            );
            this.spacetimeDBClient.sdkConnection.db.upgradeOptions.onDelete(
                (ctx: EventContext, upgrade: UpgradeOptionData) => this.handleUpgradeOptionDeleted(ctx, upgrade)
            );
        }

        this.events.on("shutdown", this.shutdown, this);
    }

    private handleAccountUpdated(ctx: EventContext, oldAccount: Account, newAccount: Account) {
        //determine if its the local account
        console.log("Account updated event received in GameScene");

        if (this.spacetimeDBClient.identity && newAccount.identity.isEqual(this.spacetimeDBClient.identity)) 
        {
            console.log("GameScene: Local account updated");
            
            // Check if account state changed (this is critical for death transitions)
            if (oldAccount.state.tag !== newAccount.state.tag) {
                console.log("GameScene: Account state changed from", oldAccount.state.tag, "to", newAccount.state.tag);
                
                // IMMEDIATELY stop attack manager and disable controls when transitioning away from Playing
                if (newAccount.state.tag !== 'Playing') {
                    console.log("GameScene: Account leaving Playing state - stopping attacks and disabling controls");
                    
                    // Stop AttackManager immediately to prevent new attacks
                    if (this.attackManager) {
                        this.attackManager.shutdown();
                        this.attackManager = null;
                    }
                    
                    // Stop LootCapsuleManager immediately to prevent lingering sound effects
                    if (this.lootCapsuleManager) {
                        this.lootCapsuleManager.shutdown();
                        this.lootCapsuleManager = null;
                    }
                    
                    // Disable player controls immediately
                    this.disablePlayerControls();
                    
                    // Set game over flag to prevent movement
                    this.gameOver = true;
                }
                
                // If state changed to Dead, transition to DeadScene
                if (newAccount.state.tag === 'Dead') {
                    console.log("GameScene: Account state is now Dead - transitioning to DeadScene");
                    this.scene.start('DeadScene');
                    return; // Exit early since we're transitioning scenes
                }
                
                // If state changed to Winner, transition to VictoryScene
                if (newAccount.state.tag === 'Winner') {
                    console.log("GameScene: Account state is now Winner - transitioning to VictoryScene");
                    this.scene.start('VictoryScene');
                    return; // Exit early since we're transitioning scenes
                }
                
                // If state changed away from Playing to something else, handle appropriately
                if (newAccount.state.tag !== 'Playing') {
                    console.log("GameScene: Account state is no longer Playing - transitioning to LoadingScene");
                    this.scene.start('LoadingScene', { 
                        message: 'Evaluating account state...', 
                        waitingFor: 'account_evaluation'
                    });
                    return; // Exit early since we're transitioning scenes
                }
            }
            
            //Check if the login time was updated
            if (oldAccount.lastLogin.microsSinceUnixEpoch !== newAccount.lastLogin.microsSinceUnixEpoch) {
                //If we're getting this, then that means we sent the updateLastLogin reducer
                //in the create, and are now getting the response.
                //So we should initialize the game world at this point since
                //hopefully all the data is ready.
                console.log("New login detected, initializing game world: " + oldAccount.lastLogin.microsSinceUnixEpoch + " -> " + newAccount.lastLogin.microsSinceUnixEpoch);
                this.initializeGameWorld(ctx);  
            }
            else
            {
                console.log("GameScene: Local account updated, but no new login detected");
            }
        }
        else
        {
            console.log("GameScene: Another user has logged on: " + newAccount.identity.toString());
        }
    }

    private handlePlayerCreated(ctx: EventContext, player: Player, isLocalPlayer: boolean = true) {
        console.log("Player created event received in GameScene");
        
        if (isLocalPlayer) {
            console.log("Local player created:", player);
            // Initialize or update local player
            this.initializeLocalPlayer(ctx, player);
        } else {
            // Another player joined
            console.log("Other player created:", player);
            this.addOrUpdateOtherPlayer(player, ctx);
        }
    }

    private handlePlayerUpdated(ctx: EventContext, oldPlayer: Player, newPlayer: Player, isLocalPlayer: boolean) {
        if (!oldPlayer || !newPlayer) {
            console.warn("Received player update with missing data, skipping");
            return;
        }

        // If local player and level increased, show level up effect
        if (isLocalPlayer && newPlayer.level > oldPlayer.level) {
            console.log("Player level up: from level", oldPlayer.level, "to level", newPlayer.level);
            
            // Play level up sound effects
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('level_up', 0.8);
                soundManager.playSound('voice_level', 1.0);
            }
            
            // Play level up effect
            if (this.localPlayerSprite) {
                this.createLevelUpEffect(this.localPlayerSprite);
            }
        }
        
        // If local player and unspent upgrades increased, check for upgrade options
        if (isLocalPlayer && newPlayer.unspentUpgrades > oldPlayer.unspentUpgrades) {
            console.log("Player gained upgrade points:", newPlayer.unspentUpgrades);

            // Initialize upgrade UI if not already done
            if (!this.upgradeUI && this.localPlayerId > 0) {
                this.upgradeUI = new UpgradeUI(this, this.spacetimeDBClient, this.localPlayerId);
            }
            
            // Check for upgrade options
            if (this.upgradeUI) {
                const playerUpgrades = Array.from(ctx.db.upgradeOptions.iter())
                    .filter(option => option.playerId === this.localPlayerId);
                
                if (playerUpgrades.length > 0) {
                    console.log("Setting upgrade options:", playerUpgrades);
                    this.upgradeUI.setUpgradeOptions(playerUpgrades);
                }
            }
        }

        // Rest of existing player update handling
        if (isLocalPlayer) {
            this.updateLocalPlayerAttributes(ctx, newPlayer);
        } else {
            this.addOrUpdateOtherPlayer(newPlayer, ctx);
        }
    }

    private handlePlayerDeleted(ctx: EventContext, player: Player, isLocalPlayer: boolean = false) {
        if (!player) {
            console.warn("Received player delete with missing data, skipping");
            return;
        }

        if (isLocalPlayer) {
            // Handle local player deletion (death)
            this.handlePlayerDied(ctx, player);
        } else {
            // Handle other player deletion
            this.removeOtherPlayer(player.playerId);
        }
    }

    private handlePlayerDied(ctx: EventContext, player: Player) {
        if (!player) {
            console.warn("Received player death with missing data, skipping");
            return;
        }

        console.log("Player died event received in GameScene");
        // This is our local player that died
        console.log("Local player died:", player);
        
        // IMMEDIATELY stop attack manager to prevent new attacks
        if (this.attackManager) {
            console.log("GameScene: Player died - immediately stopping AttackManager");
            this.attackManager.shutdown();
            this.attackManager = null;
        }
        
        // IMMEDIATELY stop loot capsule manager to prevent lingering sound effects
        if (this.lootCapsuleManager) {
            console.log("GameScene: Player died - immediately stopping LootCapsuleManager");
            this.lootCapsuleManager.shutdown();
            this.lootCapsuleManager = null;
        }
        
        // Clear any upgrade UI that may be open
        if (this.upgradeUI) {
            console.log("Clearing upgrade UI for dying player");
            this.upgradeUI.hide();
        }
        
        //play death animation
        var center = this.localPlayerSprite?.getCenter();
        if (center) {
            this.createDeathEffects(center.x, center.y);
        }
        
        // Disable controls immediately 
        this.disablePlayerControls();
        
        // Set game over flag
        this.gameOver = true;
        
        // Note: Scene transitions are now handled by the state-based system
        // When the server sets the account state to Dead or Winner, 
        // handleAccountUpdated will automatically transition to the appropriate scene
        console.log("Player death effects complete. Waiting for server to update account state...");
    }

    private handleConnectionLost(_ctx:ErrorContext) {
        console.log("Connection lost event received in GameScene");
        this.disablePlayerControls();
    }
    
    private handleMonsterCreatedForMusic(ctx: any, monster: any): void {
        // Check if this is a boss monster
        if (monster.bestiaryId && monster.bestiaryId.tag) {
            const monsterType = monster.bestiaryId.tag;
            //console.log("Monster created:", monsterType);
            
            // If a boss monster spawns, switch to boss music and show dark haze
            if (this.isBoss(monsterType)) {
                console.log("Boss detected! Switching to boss music and showing dark haze");
                if (this.musicManager) {
                    this.musicManager.playTrack('boss');
                }
                this.showBossHaze();
            }
            
            // If a VoidChest spawns, show the alert
            if (monsterType === 'VoidChest') {
                console.log("VoidChest detected! Showing alert and playing voice");
                if (this.voidChestUI) {
                    this.voidChestUI.showVoidChestAlert();
                }
                // Play voice chest sound effect and alert event sound
                const soundManager = (window as any).soundManager;
                if (soundManager) {
                    soundManager.playSound('voice_chest', 1.0);
                    soundManager.playSound('alert_event', 0.8);
                }
            }
        }
    }

    initializeGameWorld(ctx: EventContext) {
        console.log("Initializing game world elements...");
        // Ensure client and tables are ready
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("SpacetimeDB client, identity, or tables not available in initializeGameWorld.");
            return;
        }
        const localIdentity = this.spacetimeDBClient.identity;

        // --- Player Initialization ---
        // First look up the account by identity
        const account = ctx.db?.account.identity.find(localIdentity) as Account;
        if (!account) {
            console.error("Local account not found!");
            return;
        }

        console.log("Local account found:", account);        
        // Then look up the player by player_id from the account
        if (!account.currentPlayerId) {
            console.error("Local account has no currentPlayerId!");
            return; // Cannot proceed without player ID
        }

        var playerId = account.currentPlayerId;
        
        var localPlayerData = ctx.db?.player.playerId.find(playerId);
        if (!localPlayerData) {
            // Check if player is in the dead_players table
            var deadPlayerData = ctx.db?.deadPlayers.playerId.find(playerId);
            if (deadPlayerData) {
                console.error("Local player is dead! The game scene should not have been loaded.");
                return; // Cannot proceed with dead player
            }

            //Print all players
            const allPlayers = Array.from(ctx.db?.player.iter() || []);
            console.log("All players:", allPlayers);
            
            console.error("Local player data not found for playerID:", account.currentPlayerId);
            return;
        }
        
        console.log("Local player data found during initialization:", localPlayerData);
        
        // Initialize local player
        this.initializeLocalPlayer(ctx, localPlayerData);
        
        // Force an explicit player sync after entering the game world
        // This will handle both local player and other players
        console.log("Performing initial player synchronization...");
        this.syncPlayers(ctx);

        this.monsterManager?.initializeMonsters(ctx);
        
        // Check for existing attacks
        if (this.attackManager) {
            this.attackManager.setLocalPlayerId(playerId);
            this.attackManager.initializeAttacks(ctx);
            console.log("Existing attacks checked");
        }

        // Create and initialize the monster attack manager
        this.monsterAttackManager = new MonsterAttackManager(this, this.spacetimeDBClient);
        this.monsterAttackManager.initializeMonsterAttacks(ctx);

        // Create and initialize the gem manager
        this.gemManager = new GemManager(this, this.spacetimeDBClient);
        this.gemManager.initializeGems(ctx);

        // Create and initialize the loot capsule manager
        this.lootCapsuleManager = new LootCapsuleManager(this, this.spacetimeDBClient);
        this.lootCapsuleManager.initializeLootCapsules(ctx);

        // Create and initialize the boss Agna manager
        this.bossAgnaManager = new BossAgnaManager(this, this.spacetimeDBClient);
        console.log("BossAgnaManager created successfully");
        this.bossAgnaManager.initializeMagicCircles(ctx);
        console.log("BossAgnaManager initialized with existing magic circles");

        // Ensure appropriate music is playing based on current game state
        if (this.musicManager) {
            console.log("Setting appropriate music after game world initialization");
            this.musicManager.stopCurrentTrack(); // Clear any existing state
            
            // Check if there's an active boss fight - if so, play boss music instead of main
            const hasBoss = this.checkForActiveBoss(ctx);
            if (hasBoss) {
                console.log("Active boss detected during initialization - playing boss music");
                this.musicManager.playTrack('boss');
                this.showBossHaze(); // Also show boss haze
            } else {
                console.log("No active boss - playing main music");
                this.musicManager.playTrack('main');
            }
        }

        console.log("Game world initialization complete.");
    }
    
    // Helper method to check if there's an active boss fight during initialization
    private checkForActiveBoss(ctx: EventContext): boolean {
        if (!ctx.db) {
            return false;
        }
        
        // Check if there are any boss monsters present
        for (const monster of ctx.db.monsters.iter()) {
            if (monster.bestiaryId && monster.bestiaryId.tag) {
                const monsterType = monster.bestiaryId.tag;
                if (this.isBoss(monsterType)) {
                    console.log(`Found active boss during initialization: ${monsterType} (ID: ${monster.monsterId})`);
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Initialize local player with data from server
     */
    private initializeLocalPlayer(ctx: EventContext, player: Player) {
        console.log("Initializing local player...");

        if (this.playerInitialized) {
            console.log("Local player already initialized, skipping...");
            return;
        }

        // Store the local player ID for upgrade handling
        this.localPlayerId = player.playerId;
        
        // Initialize PlayerHUD for reroll count display
        this.playerHUD = new PlayerHUD(this, this.spacetimeDBClient, this.localPlayerId);

        this.attackManager?.setLocalPlayerRadius(player.radius);

        // Set up the player sprite based on their class
        const spriteKey = this.getClassSpriteKey(player.playerClass);
        
        // Create the player sprite
        if (!this.localPlayerSprite) {
            console.log("Creating new player sprite at position:", player.position);
            this.localPlayerSprite = this.physics.add.sprite(player.position.x, player.position.y, spriteKey);
            this.localPlayerSprite.setDepth(BASE_DEPTH + player.position.y);
            
            // Store the entity ID for later reference
            this.localPlayerSprite.setData('playerId', player.playerId);
            
            // Add shadow
            this.localPlayerShadow = this.add.image(player.position.x, player.position.y, SHADOW_ASSET_KEY);
            this.localPlayerShadow.setAlpha(SHADOW_ALPHA);
            this.localPlayerShadow.setDepth(BASE_DEPTH + player.position.y + SHADOW_DEPTH_OFFSET);
            
            // Add player name text - Using consistent position calculation with NAME_OFFSET_Y
            this.localPlayerNameText = this.add.text(
                player.position.x, 
                player.position.y - Math.floor(this.localPlayerSprite.height / 2) - NAME_OFFSET_Y, 
                `${player.name} (${player.level})`, 
                {
                    fontSize: '16px',
                    color: '#FFFFFF',
                    stroke: '#000000',
                    strokeThickness: 3,
                    fontStyle: 'bold'
                }
            ).setOrigin(0.5);
            this.localPlayerNameText.setDepth(BASE_DEPTH + player.position.y + NAME_DEPTH_OFFSET);
            
            // Create health bar
            const startX = player.position.x;
            const startY = player.position.y;
            
            // Health bar background (black)
            const healthBarBackground = this.add.rectangle(
                startX,
                startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                HEALTH_BAR_WIDTH,
                HEALTH_BAR_HEIGHT,
                0x000000,
                0.7
            ).setOrigin(0.5, 0.5);
            
            // Health bar foreground (green)
            const healthBar = this.add.rectangle(
                startX - (HEALTH_BAR_WIDTH / 2),
                startY - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y,
                HEALTH_BAR_WIDTH * (player.hp / player.maxHp),
                HEALTH_BAR_HEIGHT,
                0x00FF00,
                1
            ).setOrigin(0, 0.5);
            
            // Create exp bar
            const expBarBackground = this.add.rectangle(
                startX,
                startY - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y,
                EXP_BAR_WIDTH,
                EXP_BAR_HEIGHT,
                0x000000,
                0.7
            ).setOrigin(0.5, 0.5);
            
            // Calculate exp progress percentage
            const expProgress = player.expForNextLevel > 0 
                ? Math.min(1, player.exp / player.expForNextLevel) 
                : 0;
            
            // Exp bar foreground (blue)
            const expBar = this.add.rectangle(
                startX - (EXP_BAR_WIDTH / 2),
                startY - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y,
                EXP_BAR_WIDTH * expProgress,
                EXP_BAR_HEIGHT,
                0x3498db, // Blue color
                1
            ).setOrigin(0, 0.5);
            
            // Set appropriate depths
            healthBarBackground.setDepth(BASE_DEPTH + player.position.y + HEALTH_BG_DEPTH_OFFSET);
            healthBar.setDepth(BASE_DEPTH + player.position.y + HEALTH_BAR_DEPTH_OFFSET);
            expBarBackground.setDepth(BASE_DEPTH + player.position.y + EXP_BG_DEPTH_OFFSET);
            expBar.setDepth(BASE_DEPTH + player.position.y + EXP_BAR_DEPTH_OFFSET);
            
            // Store references to health bar elements and current health values
            this.localPlayerSprite.setData('healthBarBackground', healthBarBackground);
            this.localPlayerSprite.setData('healthBar', healthBar);
            this.localPlayerSprite.setData('hp', player.hp);
            this.localPlayerSprite.setData('maxHp', player.maxHp);
            
            // Store references to exp bar elements and current exp values
            this.localPlayerSprite.setData('expBarBackground', expBarBackground);
            this.localPlayerSprite.setData('expBar', expBar);
            this.localPlayerSprite.setData('exp', player.exp);
            this.localPlayerSprite.setData('expForNextLevel', player.expForNextLevel);
            
            console.log(`Created health bar for player: ${player.hp}/${player.maxHp}`);
            console.log(`Created exp bar for player: ${player.exp}/${player.expForNextLevel}`);
            
            // Set collision bounds
            this.localPlayerSprite.setCollideWorldBounds(true);
            
            // Set up camera follow
            console.log("Setting camera to follow player");
            this.cameras.main.startFollow(this.localPlayerSprite, true, 0.5, 0.5);
            this.cameras.main.setZoom(1.0); // Ensure zoom is at normal level
        } else {
            // Update the existing player sprite
            this.localPlayerSprite.setTexture(spriteKey);
            this.localPlayerSprite.setPosition(player.position.x, player.position.y);
            
            // Update health bar if it exists
            const healthBar = this.localPlayerSprite.getData('healthBar');
            const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
            
            if (healthBar && healthBarBackground) {
                // Update health bar position
                healthBarBackground.x = player.position.x;
                healthBarBackground.y = player.position.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                
                healthBar.x = player.position.x - (HEALTH_BAR_WIDTH / 2);
                healthBar.y = player.position.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
                
                // Update health bar width
                const healthPercent = Math.max(0, Math.min(1, player.hp / player.maxHp));
                healthBar.width = HEALTH_BAR_WIDTH * healthPercent;
                
                // Update stored health values
                this.localPlayerSprite.setData('hp', player.hp);
                this.localPlayerSprite.setData('maxHp', player.maxHp);
                
                console.log(`Updated health bar: ${player.hp}/${player.maxHp}`);
            } else {
                console.warn("Health bar elements not found on existing sprite");
            }
            
            // Update exp bar if it exists
            const expBar = this.localPlayerSprite.getData('expBar');
            const expBarBackground = this.localPlayerSprite.getData('expBarBackground');
            
            if (expBar && expBarBackground) {
                // Update exp bar position
                expBarBackground.x = player.position.x;
                expBarBackground.y = player.position.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                
                expBar.x = player.position.x - (EXP_BAR_WIDTH / 2);
                expBar.y = player.position.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
                
                // Calculate exp progress percentage
                const expProgress = player.expForNextLevel > 0 
                    ? Math.min(1, player.exp / player.expForNextLevel) 
                    : 0;
                    
                // Update exp bar width
                expBar.width = EXP_BAR_WIDTH * expProgress;
                
                // Update stored exp values
                this.localPlayerSprite.setData('exp', player.exp);
                this.localPlayerSprite.setData('expForNextLevel', player.expForNextLevel);
                
                console.log(`Updated exp bar: ${player.exp}/${player.expForNextLevel}`);
            } else {
                console.warn("Exp bar elements not found on existing sprite");
            }
        }
        
        // Add player sprite to registry for other components to access
        this.registry.set('localPlayerSprite', this.localPlayerSprite);
        
        // Store server position for interpolation
        this.serverPosition = new Phaser.Math.Vector2(player.position.x, player.position.y);
        
        // Mark as initialized
        this.playerInitialized = true;
        this.isPlayerDataReady = true;

        // Check if player has pending upgrades and initialize the upgrade UI if needed
        if (player.unspentUpgrades > 0) {
            const playerUpgrades = Array.from(ctx.db.upgradeOptions.iter())
                .filter(option => option.playerId === this.localPlayerId);
                
            if (playerUpgrades.length > 0) {
                console.log("Player has pending upgrades, initializing upgrade UI");
                this.upgradeUI = new UpgradeUI(this, this.spacetimeDBClient, this.localPlayerId);
                this.upgradeUI.setUpgradeOptions(playerUpgrades);
            }
            else
            {
                console.log("No pending upgrades found for player");
            }
        }
        else
        {
            console.log("No pending upgrades found for player");
        }
        console.log("Local player initialized successfully");
    }

    /**
     * Update local player attributes when server data changes
     */
    private updateLocalPlayerAttributes(ctx: EventContext, player: Player) {
        // Check for reroll increase first (before updating anything else)
        if (this.localPlayerSprite) {
            const currentRerolls = this.localPlayerSprite.getData('rerolls');
            if (currentRerolls !== undefined && player.rerolls > currentRerolls) {
                // Play dice sound when rerolls increase with pitch variation
                const soundManager = (window as any).soundManager;
                if (soundManager) {
                    soundManager.playSoundWithPitch('dice', 0.8, 0.9, 1.1);
                }
                console.log(`Player gained reroll(s): ${currentRerolls} -> ${player.rerolls}`);
            }
            // Store current rerolls for next comparison
            this.localPlayerSprite.setData('rerolls', player.rerolls);
        }
        
        // Update player name if it changed
        const previousLevel = this.localPlayerNameText ? 
            parseInt(this.localPlayerNameText.text.split('(')[1].split(')')[0]) : player.level;
            
        if (this.localPlayerNameText && this.localPlayerNameText.text !== `${player.name} (${player.level})`) {
            this.localPlayerNameText.setText(`${player.name} (${player.level})`);
            
            // If level increased, play level up effect
            if (player.level > previousLevel && this.localPlayerSprite) {
                this.createLevelUpEffect(this.localPlayerSprite);
            }
        }
        
        // Update health bar if health changed
        if (this.localPlayerSprite) {
            const currentHp = this.localPlayerSprite.getData('hp');
            const currentMaxHp = this.localPlayerSprite.getData('maxHp');
            
            // Check if health values changed
            if (currentHp !== player.hp || currentMaxHp !== player.maxHp) {
                // If HP decreased, show damage effect and play damage sound
                if (currentHp !== undefined && player.hp < currentHp) {
                    createPlayerDamageEffect(this.localPlayerSprite);
                    
                    // Play player damage sound (only if not already playing)
                    if (!this.isPlayerDamageSoundPlaying) {
                        this.isPlayerDamageSoundPlaying = true;
                        
                        // Use SoundManager for consistent volume control
                        const soundManager = (window as any).soundManager;
                        if (soundManager) {
                            soundManager.playSound('player_damage', 1.0);
                            
                            // Reset flag after a short delay (since we can't listen for completion with SoundManager)
                            this.time.delayedCall(500, () => {
                                this.isPlayerDamageSoundPlaying = false;
                            });
                        } else {
                            // Fallback to direct Phaser sound - apply global volume multiplier
                            try {
                                const adjustedVolume = 1.0 * getSoundVolume();
                                const safeVolume = adjustedVolume > 0 ? adjustedVolume : 0.001;
                                
                                const sound = this.sound.add('player_damage', { volume: safeVolume });
                                sound.once('complete', () => {
                                    this.isPlayerDamageSoundPlaying = false;
                                });
                                sound.play();
                            } catch (error) {
                                console.log("Failed to play player damage sound");
                                this.isPlayerDamageSoundPlaying = false;
                            }
                        }
                    }
                }
                
                // Update stored values
                this.localPlayerSprite.setData('hp', player.hp);
                this.localPlayerSprite.setData('maxHp', player.maxHp);
                
                // Update health bar visuals
                const healthBar = this.localPlayerSprite.getData('healthBar');
                if (healthBar) {
                    // Update the width of the health bar based on current health percentage
                    const healthPercent = Math.max(0, Math.min(1, player.hp / player.maxHp));
                    healthBar.width = HEALTH_BAR_WIDTH * healthPercent;
                    
                    // Change color based on health percentage
                    if (healthPercent > 0.6) {
                        healthBar.fillColor = 0x00FF00; // Green
                    } else if (healthPercent > 0.3) {
                        healthBar.fillColor = 0xFFFF00; // Yellow
                    } else {
                        healthBar.fillColor = 0xFF0000; // Red
                    }
                }
            }
            
            // Update exp bar if exp changed
            const currentExp = this.localPlayerSprite.getData('exp');
            const currentExpForNextLevel = this.localPlayerSprite.getData('expForNextLevel');
            
            // Check if exp values changed
            if (currentExp !== player.exp || currentExpForNextLevel !== player.expForNextLevel) {
                // Update stored values
                this.localPlayerSprite.setData('exp', player.exp);
                this.localPlayerSprite.setData('expForNextLevel', player.expForNextLevel);
                
                // Update exp bar visuals
                const expBar = this.localPlayerSprite.getData('expBar');
                if (expBar) {
                    // Calculate progress percentage
                    const expProgress = player.expForNextLevel > 0 
                        ? Math.min(1, player.exp / player.expForNextLevel) 
                        : 0;
                    
                    // Update the width of the exp bar based on current exp percentage
                    expBar.width = EXP_BAR_WIDTH * expProgress;
                    
                    // Briefly flash the exp bar when gaining exp
                    if (currentExp !== undefined && player.exp > currentExp) {
                        // Play exp gain sound effect for local player only with pitch variation
                        const soundManager = (window as any).soundManager;
                        if (soundManager) {
                            soundManager.playSoundWithPitch('exp_gem', 0.7, 0.9, 1.1);
                        }
                        
                        this.tweens.add({
                            targets: expBar,
                            fillColor: 0x00ffff, // Bright cyan
                            duration: 200,
                            yoyo: true,
                            onComplete: () => {
                                expBar.fillColor = 0x3498db; // Return to blue
                            }
                        });
                    }
                }
            }
            
            // Add or remove glow effect based on grace period
            if (player.spawnGracePeriodRemaining > 0) {
                // Add a pulsing glow effect using a noticeable color tint
                // Store the grace period state on the sprite if not already stored
                if (!this.localPlayerSprite.getData('graceActive')) {
                    this.localPlayerSprite.setData('graceActive', true);
                    
                    // Create pulsing tint effect between white and blue
                    if (!this.localPlayerSprite.getData('graceTween')) {
                        const graceTween = this.tweens.add({
                            targets: this.localPlayerSprite,
                            alpha: 0.7,
                            yoyo: true,
                            repeat: -1,
                            duration: 500,
                            onUpdate: () => {
                                // Create cycling colors for more visible effect
                                const t = Math.sin(this.time.now / 200) * 0.5 + 0.5;
                                const color1 = new Phaser.Display.Color(255, 255, 255);
                                const color2 = new Phaser.Display.Color(200, 200, 200);
                                const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                                    color1,
                                    color2,
                                    100,
                                    Math.floor(t * 100)
                                );
                                this.localPlayerSprite?.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                            }
                        });
                        this.localPlayerSprite.setData('graceTween', graceTween);
                    }
                    
                    console.log("Grace period active: " + player.spawnGracePeriodRemaining);
                }
            } else {
                // Remove glow when grace period is over
                if (this.localPlayerSprite.getData('graceActive')) {
                    this.localPlayerSprite.setData('graceActive', false);
                    
                    // Stop the glow tween if it exists
                    const graceTween = this.localPlayerSprite.getData('graceTween');
                    if (graceTween) {
                        graceTween.stop();
                        this.localPlayerSprite.setData('graceTween', null);
                    }
                    
                    // Reset alpha and clear tint
                    this.localPlayerSprite.clearTint();
                    this.localPlayerSprite.alpha = 1.0;
                }
            }
        }
        
        // Get the latest entity data
        if (this.serverPosition) {
            this.serverPosition.set(player.position.x, player.position.y);
            
            // Update local player PvP indicator position
            const pvpIndicator = this.localPlayerSprite?.getData('pvpIndicator') as Phaser.GameObjects.Arc;
            if (pvpIndicator) {
                pvpIndicator.setPosition(this.serverPosition.x, this.serverPosition.y);
                pvpIndicator.setDepth(BASE_DEPTH + this.serverPosition.y - 0.5);
            }
        }
        this.attackManager?.setLocalPlayerRadius(player.radius);
        
        // Update local player PvP indicator based on PvP status
        this.updateLocalPlayerPvpIndicator(player.pvp);
    }
    
    /**
     * Creates visual effects for level up
     */
    private createLevelUpEffect(playerSprite: Phaser.Physics.Arcade.Sprite) {
        if (!playerSprite) return;
        
        console.log("Playing level up effect!");
        
        // Create "LEVEL UP!" text
        const levelUpText = this.add.text(
            playerSprite.x,
            playerSprite.y - 100, // Start above the player
            "LEVEL UP!",
            {
                fontFamily: 'Arial',
                fontSize: '32px',
                color: '#ffff00', // Bright yellow
                stroke: '#000000',
                strokeThickness: 6,
                fontStyle: 'bold'
            }
        );
        levelUpText.setOrigin(0.5);
        levelUpText.setDepth(BASE_DEPTH + playerSprite.y + 100); // Ensure it appears above the player
        
        // Animate the text
        this.tweens.add({
            targets: levelUpText,
            y: levelUpText.y - 80, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.5, to: 2 }, // Grow
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                levelUpText.destroy(); // Remove when animation is done
            }
        });
        
        // Create glow effect around player
        const glowCircle = this.add.circle(
            playerSprite.x,
            playerSprite.y,
            playerSprite.width / 1.5, // Slightly larger than the player
            0xffff00, // Yellow glow
            0.5 // Semi-transparent
        );
        glowCircle.setDepth(BASE_DEPTH + playerSprite.y - 1); // Just below the player
        
        // Expand and fade the glow
        this.tweens.add({
            targets: glowCircle,
            scale: 3,
            alpha: 0,
            duration: 500, // Reduced from 1000 to 500
            ease: 'Sine.easeOut',
            onComplete: () => {
                glowCircle.destroy();
            }
        });
        
        // Create particle effect
        const particles = this.add.particles(playerSprite.x, playerSprite.y, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 1000,
            gravityY: -50, // Float upward
            tint: 0xffff00, // Yellow particles
            emitting: false
        });
        
        // Emit particles in a burst
        particles.explode(30, playerSprite.x, playerSprite.y);
        
        // Clean up particles after animation
        this.time.delayedCall(700, () => {
            particles.destroy();
        });
        
        // Add a flash to the player sprite
        const initialTint = playerSprite.tintTopLeft;
        playerSprite.setTint(0xffffff); // White flash
        
        this.time.delayedCall(200, () => {
            playerSprite.setTint(initialTint); // Reset tint
        });
    }

    // Get class-specific sprite key
    getClassSpriteKey(playerClass: any): string {
        
        // Handle case when playerClass is a simple object with a tag property
        if (playerClass && typeof playerClass === 'object' && 'tag' in playerClass) {
            const className = playerClass.tag;
            const spriteKey = CLASS_ASSET_KEYS[className] || 'player_fighter';
            return spriteKey;
        } 
        
        // Handle case when playerClass is just a string
        if (typeof playerClass === 'string') {
            const spriteKey = CLASS_ASSET_KEYS[playerClass] || 'player_fighter';
            return spriteKey;
        }
        
        // Handle case when playerClass is a number (enum value)
        if (typeof playerClass === 'number') {
            // Map numeric enum values to class names
            const classNames = ["Fighter", "Rogue", "Mage", "Paladin"];
            const className = classNames[playerClass] || "Fighter";
            const spriteKey = CLASS_ASSET_KEYS[className] || 'player_fighter';
            return spriteKey;
        }
        
        // Default fallback
        console.log("Using default fighter class");
        return 'player_fighter';
    }
    
    // Update the function to properly use the player's playerId
    createOtherPlayerSprite(playerData: Player) {
        // Check if we already have this player
        if (this.otherPlayers.has(playerData.playerId)) {
            this.updateOtherPlayerPosition(playerData.playerId, playerData.position.x, playerData.position.y);
            return;
        }
        
        // Round position on creation
        const startX = Math.floor(playerData.position.x);
        const startY = Math.floor(playerData.position.y);
        
        // Calculate depth based on Y position
        const initialDepth = BASE_DEPTH + startY;
        
        // Create new player container with shadow, sprite and name
        const shadow = this.add.image(0, SHADOW_OFFSET_Y, SHADOW_ASSET_KEY)
            .setAlpha(SHADOW_ALPHA)
            .setDepth(SHADOW_DEPTH_OFFSET); // Relative depth within container
        
        // Get class-specific sprite
        const classKey = this.getClassSpriteKey(playerData.playerClass);
        const sprite = this.add.sprite(0, 0, classKey);
        
        // Display name with level
        const displayName = `${playerData.name} (${playerData.level})`;
        const text = this.add.text(
            0, 
            -Math.floor(sprite.height / 2) - NAME_OFFSET_Y, 
            displayName, 
            PLAYER_NAME_STYLE
        ).setOrigin(0.5, 0.5);
        
        // Health bar background
        const healthBarBackground = this.add.rectangle(
            0,
            -Math.floor(sprite.height / 2) - HEALTH_BAR_OFFSET_Y,
            HEALTH_BAR_WIDTH,
            HEALTH_BAR_HEIGHT,
            0x000000,
            0.7
        ).setOrigin(0.5, 0.5);
        
        // Health bar fill
        const healthBar = this.add.rectangle(
            -HEALTH_BAR_WIDTH / 2, // Offset to align with background
            -Math.floor(sprite.height / 2) - HEALTH_BAR_OFFSET_Y,
            HEALTH_BAR_WIDTH * (playerData.hp / playerData.maxHp),
            HEALTH_BAR_HEIGHT,
            0x00FF00,
            1
        ).setOrigin(0, 0.5);
        
        // EXP bar background
        const expBarBackground = this.add.rectangle(
            0,
            -Math.floor(sprite.height / 2) - EXP_BAR_OFFSET_Y,
            EXP_BAR_WIDTH,
            EXP_BAR_HEIGHT,
            0x000000,
            0.7
        ).setOrigin(0.5, 0.5);
        
        // Calculate exp progress percentage
        const expProgress = playerData.expForNextLevel > 0 
            ? Math.min(1, playerData.exp / playerData.expForNextLevel) 
            : 0;
        
        // EXP bar fill
        const expBar = this.add.rectangle(
            -EXP_BAR_WIDTH / 2, // Offset to align with background
            -Math.floor(sprite.height / 2) - EXP_BAR_OFFSET_Y,
            EXP_BAR_WIDTH * expProgress,
            EXP_BAR_HEIGHT,
            0x3498db, // Blue color
            1
        ).setOrigin(0, 0.5);
        
        // Create container and add all elements
        const container = this.add.container(startX, startY, [shadow, sprite, text, healthBarBackground, healthBar, expBarBackground, expBar]);
        container.setData('playerId', playerData.playerId);
        container.setData('hp', playerData.hp);
        container.setData('maxHp', playerData.maxHp);
        container.setData('exp', playerData.exp);
        container.setData('expForNextLevel', playerData.expForNextLevel);
        container.setData('sprite', sprite);
        container.setData('pvp', playerData.pvp);
        
        // Add PvP indicator if player has PvP enabled
        this.createPvpIndicator(container, playerData.pvp);
        
        // Name the elements so we can access them by name
        sprite.setName('sprite');
        text.setName('nameText');
        healthBar.setName('healthBar');
        healthBarBackground.setName('healthBarBackground');
        expBar.setName('expBar');
        expBarBackground.setName('expBarBackground');
        
        // Set the container depth based on Y position
        container.setDepth(initialDepth);
        
        // Store the container using player ID instead of identity
        this.otherPlayers.set(playerData.playerId, container);
        
        // Apply grace period effect if needed
        if (playerData.spawnGracePeriodRemaining > 0) {
            // Mark grace period as active
            container.setData('graceActive', true);
            
            // Create pulsing tint effect
            const graceTween = this.tweens.add({
                targets: sprite,
                alpha: 0.7,
                yoyo: true,
                repeat: -1,
                duration: 500,
                onUpdate: () => {
                    // Create cycling colors for visible effect
                    const t = Math.sin(this.time.now / 200) * 0.5 + 0.5;
                    const color1 = new Phaser.Display.Color(255, 255, 255);
                    const color2 = new Phaser.Display.Color(200, 200, 200);
                    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                        color1,
                        color2,
                        100,
                        Math.floor(t * 100)
                    );
                    sprite.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                }
            });
            container.setData('graceTween', graceTween);
            console.log(`Player ${playerData.name} has grace period: ${playerData.spawnGracePeriodRemaining}`);
        }
    }

    addOrUpdateOtherPlayer(playerData: Player, ctx: EventContext) {
        // Skip if this is our local player
        if (this.spacetimeDBClient?.identity) {
            // Get local account
            const myAccount = ctx.db?.account.identity.find(this.spacetimeDBClient.identity);
            
            // Skip if this is our local player
            if (myAccount && myAccount.currentPlayerId === playerData.playerId) {
                return;
            }
            
            // If we don't have a container for this player yet, we need to find its entity
            if (!this.otherPlayers.has(playerData.playerId)) {
                this.createOtherPlayerSprite(playerData);
            } else {
                this.updateOtherPlayerPosition(playerData.playerId, playerData.position.x, playerData.position.y);

                // Just update the container with any player changes if needed
                const container = this.otherPlayers.get(playerData.playerId);
                if (container) {
                    // Update player name on the text object if changed
                    const nameText = container.getByName('nameText') as Phaser.GameObjects.Text;
                    if (nameText && nameText.text !== `${playerData.name} (${playerData.level})`) {
                        // Extract previous level from the name text
                        const previousLevel = parseInt(nameText.text.split('(')[1].split(')')[0]);
                        
                        // Update the text
                        nameText.setText(`${playerData.name} (${playerData.level})`);
                        
                        // If level increased, play level up effect
                        if (playerData.level > previousLevel) {
                            this.createOtherPlayerLevelUpEffect(container);
                        }
                    }
                    
                    // Update health bar if needed
                    if (playerData.hp !== undefined && playerData.maxHp !== undefined) {
                        // Get current HP to compare
                        const currentHp = container.getData('hp') || playerData.maxHp;
                        
                        // Show damage effect if HP decreased
                        if (playerData.hp < currentHp) {
                            const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite;
                            if (sprite) {
                                createPlayerDamageEffect(sprite);
                            }
                        }
                        
                        // Store new HP value
                        container.setData('hp', playerData.hp);
                        container.setData('maxHp', playerData.maxHp);
                        
                        const healthBar = container.getByName('healthBar') as Phaser.GameObjects.Rectangle;
                        if (healthBar) {
                            // Adjust health bar width based on current HP
                            const healthPercentage = Math.max(0, Math.min(1, playerData.hp / playerData.maxHp));
                            healthBar.width = HEALTH_BAR_WIDTH * healthPercentage;
                            
                            // Position the health bar (it's left-aligned)
                            healthBar.x = -HEALTH_BAR_WIDTH / 2;
                        }
                    }
                    
                    // Update exp bar if exp changed
                    if (playerData.exp !== undefined && playerData.expForNextLevel !== undefined) {
                        // Get current exp to compare
                        const currentExp = container.getData('exp') || 0;
                        const currentExpForNextLevel = container.getData('expForNextLevel') || 100;
                        
                        // Store new exp values
                        container.setData('exp', playerData.exp);
                        container.setData('expForNextLevel', playerData.expForNextLevel);
                        
                        const expBar = container.getByName('expBar') as Phaser.GameObjects.Rectangle;
                        if (expBar) {
                            // Calculate progress percentage
                            const expProgress = playerData.expForNextLevel > 0 
                                ? Math.min(1, playerData.exp / playerData.expForNextLevel) 
                                : 0;
                            
                            // Adjust exp bar width based on current exp
                            expBar.width = EXP_BAR_WIDTH * expProgress;
                            
                            // Position the exp bar (it's left-aligned)
                            expBar.x = -EXP_BAR_WIDTH / 2;
                            
                            // Briefly flash the exp bar when gaining exp
                            if (playerData.exp > currentExp) {
                                // Don't play exp gain sound for other players - only for local player
                                
                                this.tweens.add({
                                    targets: expBar,
                                    fillColor: 0x00ffff, // Bright cyan
                                    duration: 200,
                                    yoyo: true,
                                    onComplete: () => {
                                        expBar.fillColor = 0x3498db; // Return to blue
                                    }
                                });
                            }
                        }
                    }
                    
                    // Update PvP indicator if PvP status changed
                    const currentPvpStatus = container.getData('pvp') || false;
                    if (playerData.pvp !== currentPvpStatus) {
                        container.setData('pvp', playerData.pvp);
                        this.updatePvpIndicator(container, playerData.pvp);
                    }
                    
                    // Add or remove grace period effect
                    const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite;
                    if (sprite) {
                        // Handle grace period effect
                        if (playerData.spawnGracePeriodRemaining > 0) {
                            // Add grace period effect if not already present
                            if (!container.getData('graceActive')) {
                                container.setData('graceActive', true);
                                
                                // Create pulsing tint effect
                                if (!container.getData('graceTween')) {
                                    const graceTween = this.tweens.add({
                                        targets: sprite,
                                        alpha: 0.7,
                                        yoyo: true,
                                        repeat: -1,
                                        duration: 500,
                                        onUpdate: () => {
                                            // Create cycling colors for visible effect
                                            const t = Math.sin(this.time.now / 200) * 0.5 + 0.5;
                                            const color1 = new Phaser.Display.Color(255, 255, 255);
                                            const color2 = new Phaser.Display.Color(200, 200, 200);
                                            const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                                                color1,
                                                color2,
                                                100,
                                                Math.floor(t * 100)
                                            );
                                            sprite.setTint(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
                                        }
                                    });
                                    container.setData('graceTween', graceTween);
                                }
                            }
                        } else {
                            // Remove effect when grace period is over
                            if (container.getData('graceActive')) {
                                container.setData('graceActive', false);
                                
                                // Stop the glow tween
                                const graceTween = container.getData('graceTween');
                                if (graceTween) {
                                    graceTween.stop();
                                    container.setData('graceTween', null);
                                }
                                
                                // Reset sprite to normal
                                sprite.clearTint();
                                sprite.alpha = 1.0;
                            }
                        }
                    }
                }
            }
        }
    }

    updateTapMarker() {
        if (!this.tapMarker || !this.tapTarget) {
            console.log("Cannot update tap marker - marker or target missing", {
                hasMarker: !!this.tapMarker,
                hasTarget: !!this.tapTarget
            });
            return;
        }
        
        console.log("Updating tap marker position", {
            x: this.tapTarget.x,
            y: this.tapTarget.y,
            markerVisible: this.tapMarker.visible
        });
        
        // Position marker at tap target
        // Add larger vertical offset to align with character feet (SHADOW_OFFSET_Y + 20)
        this.tapMarker.setPosition(this.tapTarget.x, this.tapTarget.y + SHADOW_OFFSET_Y + 20);
        
        // Visibility is now handled in the update() method based on playerData.hasWaypoint
        // console.log("After setting visible:", {
        // markerVisible: this.tapMarker.visible
        // });
        
        // Add a small animation to make it more noticeable
        this.tweens.add({
            targets: this.tapMarker,
            scale: { from: 0.8, to: 1 },
            duration: 300,
            ease: 'Bounce.Out'
        });
    }

    updateOtherPlayerPosition(playerId: number, x: number, y: number) {
        const container = this.otherPlayers.get(playerId);
        if (container) {
            // Smooth movement to the new position from the Entity table, rounding the target
            this.tweens.add({
                targets: container,
                x: Math.floor(x),
                y: Math.floor(y),
                duration: 100, // Short duration for smooth sync
                ease: 'Linear',
                onUpdate: () => {
                    // Update depth during the tween
                    container.setDepth(BASE_DEPTH + container.y);
                }
            });
        }
    }

    removeOtherPlayer(playerId: number) {
        const container = this.otherPlayers.get(playerId);
        if (container) {
            // Stop any active tweens
            const graceTween = container.getData('graceTween');
            if (graceTween) {
                graceTween.stop();
            }
            
            container.destroy();
            this.otherPlayers.delete(playerId);
        }
    }

    // Add the update method to handle player movement
    update(time: number, delta: number) {
        // Update SoundManager frame counter for frame-based throttling
        const soundManager = (window as any).soundManager;
        if (soundManager && soundManager.updateFrame) {
            soundManager.updateFrame();
        }
        
        // Skip if local player sprite isn't initialized yet
        if (!this.localPlayerSprite || !this.isPlayerDataReady) return;

        // Get entity radius using helper function
        const entityRadius = this.getPlayerEntityRadius();
        
        // Calculate delta time in seconds
        const deltaTime = delta / 1000;
        
        // Get current entity data from server
        const playerData = this.spacetimeDBClient?.sdkConnection?.db?.player.playerId.find(
            this.localPlayerSprite.getData('playerId')
        );
        
        if (!playerData) return;

        // Always update server position if available
        if (this.serverPosition) {
            const distX = this.serverPosition.x - this.localPlayerSprite.x;
            const distY = this.serverPosition.y - this.localPlayerSprite.y;
            const distSquared = distX * distX + distY * distY;

            // If we're too far from server position, snap immediately
            if (distSquared > POSITION_CORRECTION_THRESHOLD * 4) {
                console.log(`Large position correction: ${Math.sqrt(distSquared).toFixed(2)} units`);
                this.localPlayerSprite.x = this.serverPosition.x;
                this.localPlayerSprite.y = this.serverPosition.y;
                if (this.predictedPosition) {
                    this.predictedPosition.set(this.serverPosition.x, this.serverPosition.y);
                }
            }
            // Otherwise interpolate towards server position
            else if (distSquared > POSITION_CORRECTION_THRESHOLD) {
                // Use faster interpolation when correction needed
                const correctionSpeed = INTERPOLATION_SPEED * 2;
                this.localPlayerSprite.x += distX * correctionSpeed;
                this.localPlayerSprite.y += distY * correctionSpeed;
                if (this.predictedPosition) {
                    this.predictedPosition.set(this.localPlayerSprite.x, this.localPlayerSprite.y);
                }
            }
        }
        
        // Update tap marker visibility based on hasWaypoint
        if (this.tapMarker) {
            this.tapMarker.setVisible(playerData.hasWaypoint);
        }

        // If we have a waypoint and are moving, update predicted position
        if (playerData.hasWaypoint) {
            // Initialize predicted position if needed
            if (!this.predictedPosition) {
                this.predictedPosition = new Phaser.Math.Vector2(
                    this.localPlayerSprite.x,
                    this.localPlayerSprite.y
                );
            }
            
            // Calculate direction to waypoint
            const directionVector = new Phaser.Math.Vector2(
                playerData.waypoint.x - this.predictedPosition.x,
                playerData.waypoint.y - this.predictedPosition.y
            );
            
            // Calculate distance to waypoint
            const distanceToWaypoint = directionVector.length();
            
            // If we're close enough to the waypoint, stop moving
            const WAYPOINT_REACHED_DISTANCE = 5.0;
            if (distanceToWaypoint < WAYPOINT_REACHED_DISTANCE) {
                // Reached waypoint, stop moving
                this.isMoving = false;
                this.currentDirection.set(0, 0);
                this.predictedPosition.set(playerData.waypoint.x, playerData.waypoint.y);
                
                // Clear tap target 
                this.tapTarget = null;
                // tapMarker visibility is handled above by playerData.hasWaypoint
            } else {
                // Continue moving towards waypoint
                this.isMoving = true;
                
                // Use exact player speed from server
                const playerSpeed = playerData.speed;
                
                // Calculate movement (slightly slower than server to avoid overshooting)
                const moveDistance = playerSpeed * deltaTime * 0.9; // 90% of actual speed to stay behind server
                const normalizedDirection = directionVector.normalize();
                
                // Update predicted position
                this.predictedPosition.x += normalizedDirection.x * moveDistance;
                this.predictedPosition.y += normalizedDirection.y * moveDistance;
                
                // Clamp predicted position to world bounds
                const clampedPosition = this.clampToWorldBounds(this.predictedPosition, entityRadius);
                this.predictedPosition.set(clampedPosition.x, clampedPosition.y);
                
                // Update sprite position with prediction
                this.localPlayerSprite.x = this.predictedPosition.x;
                this.localPlayerSprite.y = this.predictedPosition.y;
            }
        } else {
            // Not moving or no waypoint
            this.isMoving = false;
            this.currentDirection.set(0, 0);
            this.predictedPosition = null; // Clear prediction when not moving

            this.tapTarget = null;
            // tapMarker visibility is handled above by playerData.hasWaypoint
        }

        // Always update depth and UI after any position change
        this.localPlayerSprite.setDepth(BASE_DEPTH + this.localPlayerSprite.y);
        this.updatePlayerUI();

        // Update upgrade UI if it exists
        if (this.upgradeUI) {
            this.upgradeUI.update(time, delta);
        }

        // Update gem manager for hover animations
        if (this.gemManager) {
            this.gemManager.update(time, delta);
        }

        // Update monster attack manager for projectile movement
        if (this.monsterAttackManager) {
            this.monsterAttackManager.update(time, delta);
        }

        // Update monster manager for after images and other effects
        if (this.monsterManager) {
            this.monsterManager.update(time, delta);
        }

        // Update VoidChest UI for directional arrow
        if (this.voidChestUI) {
            this.voidChestUI.update();
        }

        // Update Soul UI for soul guidance
        if (this.soulUI) {
            this.soulUI.update();
        }

        // Boss Agna Manager now handles updates automatically via event subscriptions

        // Update minimap
        this.updateMinimap();
    }
    
    // Update the minimap with player's position
    private updateMinimap() {
        if (!this.minimap || !this.localPlayerSprite) return;
        
        // Get world bounds
        const worldBounds = this.physics.world.bounds;
        
        // Use the new Minimap class update method
        this.minimap.update(this.localPlayerSprite, worldBounds);
    }

    // Force a synchronization of player entities
    syncPlayers(ctx: EventContext) {
        console.log("Forcing player sync...");
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.identity || !this.spacetimeDBClient.sdkConnection?.db) {
            console.error("Cannot sync players: SpacetimeDB client, identity, or tables not available");
            return;
        }

        const localIdentity = this.spacetimeDBClient.identity;
        
        // Get the local account to find the current player ID
        const localAccount = ctx.db.account.identity.find(localIdentity) as Account;
        if (!localAccount) {
            console.error("Local account not found during sync!");
            return;
        }
        
        if (!this.localPlayerSprite && localAccount.currentPlayerId > 0) {
            throw new Error("Local player data not found in player table during sync");
        }
        
        // Then handle all other players
        for (const player of ctx.db.player.iter()) {
            // Skip local player
            if (player.playerId === localAccount.currentPlayerId) {
                continue;
            }
            
            const existingContainer = this.otherPlayers.get(player.playerId);
            if (!existingContainer) {
                // Create the sprite directly - this bypasses the normal flow but ensures
                // the sprite is created immediately
                this.createOtherPlayerSprite(player);
            } else {
                // Just update position if sprite already exists
                this.updateOtherPlayerPosition(player.playerId, player.position.x, player.position.y);
            }
        }
        
        // Debug output of all tracked players
        console.log(`Total tracked other players after sync: ${this.otherPlayers.size}`);
    }
    
    // Create blood splatter particles
    private createDeathEffects(x: number, y: number) {
        console.log(`Creating death effects at (${x}, ${y})`);
        
        // Create a particle emitter for blood splatter
        const particles = this.add.particles(x, y, 'shadow', {  // Reusing shadow texture as particle
            speed: { min: 50, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.4, end: 0.1 },
            lifespan: 800,
            quantity: 20,
            tint: 0xff0000,  // Red tint for blood
            gravityY: 300,
            blendMode: 'ADD',
            emitting: false
        });
        
        // Set depth to ensure it's visible above all game elements
        particles.setDepth(50000);
        
        // Emit once
        particles.explode(30, x, y);
        
        // Auto-destroy after animation completes
        this.time.delayedCall(1000, () => {
            particles.destroy();
        });
    }
    
    // Disable player controls after death
    private disablePlayerControls() {
        // Clear tap target and hide marker
        this.tapTarget = null;
        if (this.tapMarker) {
            this.tapMarker.setVisible(false);
        }
        
        // Set flag to prevent movement in update()
        this.isMoving = false;
        
        // Clear direction
        this.currentDirection.set(0, 0);
        
        // If using actual input components that need disabling:
        // (This is more for documentation, as the update method won't process input anyway)
        if (this.input) {
            // Remove pointer listeners
            this.input.off('pointerdown');
            this.input.off('pointerup');
        }
    }

    shutdown() {
        console.log("GameScene shutdown initiated.");

        // Cleanup music manager
        if (this.musicManager) {
            this.musicManager.cleanup();
        }
        
        // Important: Mark the scene as shutting down to prevent further updates
        this.gameOver = true;
        
        // Reset player damage sound flag
        this.isPlayerDamageSoundPlaying = false;

        this.monsterManager?.shutdown();
        
        // Clean up MonsterSpawnerManager
        console.log("GameScene shutting down...");
        
        // Clean up MonsterSpawnerManager
        this.monsterSpawnerManager?.destroy();
        this.monsterSpawnerManager = null;
        
        // Clean up AttackManager properly
        this.attackManager?.shutdown();

        // Clean up MonsterAttackManager
        this.monsterAttackManager?.shutdown();
        this.monsterAttackManager = null;

        // Clean up GemManager
        this.gemManager?.shutdown();
        this.gemManager = null;
        
        // Clean up LootCapsuleManager
        this.lootCapsuleManager?.shutdown();
        this.lootCapsuleManager = null;
        
        // Clean up BossAgnaManager
        this.bossAgnaManager?.shutdown();
        this.bossAgnaManager = null;
        
        // Clean up UpgradeUI
        if (this.upgradeUI) {
            this.upgradeUI.destroy();
            this.upgradeUI = null;
        }
        
        // Clean up PlayerHUD
        if (this.playerHUD) {
            this.playerHUD.destroy();
            this.playerHUD = null;
        }
        
        // Clean up BossTimerUI
        if (this.bossTimerUI) {
            this.bossTimerUI.destroy();
            this.bossTimerUI = null;
        }
        
        // Clean up monster counter UI
        if (this.monsterCounterUI) {
            this.monsterCounterUI.destroy();
            this.monsterCounterUI = null;
        }
        
        // Clean up VoidChest UI
        if (this.voidChestUI) {
            this.voidChestUI.destroy();
            this.voidChestUI = null;
        }

        // Clean up Soul UI
        if (this.soulUI) {
            this.soulUI.destroy();
            this.soulUI = null;
        }

        // Clean up Options UI
        if (this.optionsUI) {
            this.optionsUI.destroy();
            this.optionsUI = null;
        }
        
        // DEFENSIVE CLEANUP: Remove any lingering game objects that might persist between scenes
        console.log("GameScene: Performing defensive cleanup of lingering game objects");
        
        // Clean up any remaining sprites/images with attack-related textures
        const attackTextures = ['attack_sword', 'attack_wand', 'attack_knife', 'attack_shield'];
        this.children.list.forEach(child => {
            if (child instanceof Phaser.GameObjects.Sprite || child instanceof Phaser.GameObjects.Image) {
                if (attackTextures.includes(child.texture.key)) {
                    console.log("GameScene: Removing lingering attack sprite with texture:", child.texture.key);
                    child.destroy();
                }
            }
        });
        
        // Clean up any remaining containers that might contain attack sprites
        this.children.list.forEach(child => {
            if (child instanceof Phaser.GameObjects.Container) {
                // Check if container has attack-related children
                const hasAttackSprites = child.list.some(subChild => {
                    if (subChild instanceof Phaser.GameObjects.Sprite || subChild instanceof Phaser.GameObjects.Image) {
                        return attackTextures.includes(subChild.texture.key);
                    }
                    return false;
                });
                
                if (hasAttackSprites) {
                    console.log("GameScene: Removing container with attack sprites");
                    child.destroy();
                }
            }
        });
        
        // Clean up any particles or effects that might be running
        this.children.list.forEach(child => {
            if (child instanceof Phaser.GameObjects.Particles.ParticleEmitter) {
                console.log("GameScene: Stopping and removing lingering particle emitter");
                child.stop();
                child.destroy();
            }
        });
        
        // Clean up any tweens that might be running
        this.tweens.killAll();
        console.log("GameScene: Killed all running tweens");
        
        // Note: SpacetimeDB event handlers are managed by the SDK
        // The connection to the database will be cleaned up when the game is closed
        // or when we move to a different scene

        // Remove scene event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.ACCOUNT_UPDATED, this.handleAccountUpdated, this);
        this.gameEvents.off(GameEvents.PLAYER_CREATED, this.handlePlayerCreated, this);
        this.gameEvents.off(GameEvents.PLAYER_UPDATED, this.handlePlayerUpdated, this);
        this.gameEvents.off(GameEvents.PLAYER_DELETED, this.handlePlayerDeleted, this);
        this.gameEvents.off(GameEvents.PLAYER_DIED, this.handlePlayerDied, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.handleMonsterCreatedForMusic, this);
        this.gameEvents.off(GameEvents.GAME_STATE_UPDATED, this.handleGameStateUpdated, this);

        // Clean up MonsterManager event listeners
        if (this.monsterManager) {
            this.monsterManager.unregisterListeners();
        }
        
        // Clean up local player objects
        if (this.localPlayerSprite) {
            this.localPlayerSprite.destroy();
            this.localPlayerSprite = null;
        }
        
        if (this.localPlayerShadow) {
            this.localPlayerShadow.destroy();
            this.localPlayerShadow = null;
        }
        
        if (this.localPlayerNameText) {
            this.localPlayerNameText.destroy();
            this.localPlayerNameText = null;
        }
        
        // Clean up other player sprites
        for (const [_, container] of this.otherPlayers) {
            container.destroy();
        }
        this.otherPlayers.clear();
        
        // Clear tap target and marker
        this.tapTarget = null;
        if (this.tapMarker) {
            this.tapMarker.destroy();
            this.tapMarker = null;
        }
        
        // Remove debug key binding
        if (this.input.keyboard) 
        {
            this.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.R);
            this.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.D);
            this.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.O);
        }
        this.debugManager?.clearDebugKeys();
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        // Clean up minimap
        if (this.minimap) {
            this.minimap.destroy();
            this.minimap = null;
        }
        this.minimapElements = null;
        
        // Clean up boss haze overlay
        if (this.bossHazeOverlay) {
            this.bossHazeOverlay.destroy();
            this.bossHazeOverlay = null;
        }
        
        console.log("GameScene shutdown complete.");
    }

    private cleanupLingeringUIElements() {
        console.log("GameScene: Cleaning up lingering UI elements from other scenes only");
        
        try {
            // Only clean up elements we know belong to other scenes
            // Login scene elements
            const loginInput = document.getElementById('login-name-input');
            if (loginInput && loginInput.parentNode) {
                console.log("GameScene: Removing lingering login input");
                loginInput.remove();
            }
            
            // Class select scene elements - only if we find the container ID
            const classContainer = document.getElementById('class-select-container');
            if (classContainer && classContainer.parentNode) {
                console.log("GameScene: Removing lingering class container");
                classContainer.remove();
            }
        } catch (e) {
            console.error("Error in GameScene cleanupLingeringUIElements:", e);
        }
    }

    /**
     * Get the player entity radius from server data
     * @returns The entity radius, or 48 as fallback
     */
    private getPlayerEntityRadius(): number {
        // Default fallback radius
        let entityRadius = 48;
        
        if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
            const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(
                this.spacetimeDBClient.identity
            );
            
            if (account && account.currentPlayerId > 0) {
                const player = this.spacetimeDBClient.sdkConnection.db.player.playerId.find(
                    account.currentPlayerId
                );

                entityRadius = player?.radius ?? 48;
            }
        }
        
        return entityRadius;
    }

    /**
     * Clamp a position to world boundaries
     * @param position The position to clamp
     * @param entityRadius The entity radius to use for boundary calculation
     * @returns The clamped position
     */
    private clampToWorldBounds(position: {x: number, y: number}, entityRadius: number): {x: number, y: number} {
        const worldBounds = this.physics.world.bounds;
        
        // Add extra vertical buffer to make top/bottom boundaries consistent with left/right
        // This aligns the sprite's visual position with its collision boundary
        const verticalBuffer = 8; // Extra buffer for top/bottom boundaries
        
        return {
            x: Phaser.Math.Clamp(
                position.x,
                worldBounds.x + entityRadius,
                worldBounds.right - entityRadius
            ),
            y: Phaser.Math.Clamp(
                position.y,
                worldBounds.y + entityRadius + verticalBuffer, // Add buffer to top boundary
                worldBounds.bottom - entityRadius - verticalBuffer // Add buffer to bottom boundary
            )
        };
    }

    public getLocalPlayerPosition(): { x: number, y: number } | null {
        if (this.localPlayerSprite) {
            return { x: this.localPlayerSprite.x, y: this.localPlayerSprite.y };
        }
        return null;
    }

    /**
     * Creates visual effects for level up for other players
     */
    private createOtherPlayerLevelUpEffect(container: Phaser.GameObjects.Container) {
        if (!container) return;
        
        console.log("Playing level up effect for other player!");
        
        // Get the sprite component from the container
        const sprite = container.getByName('sprite') as Phaser.GameObjects.Sprite;
        if (!sprite) return;
        
        // Create "LEVEL UP!" text
        const levelUpText = this.add.text(
            container.x,
            container.y - 100, // Start above the player
            "LEVEL UP!",
            {
                fontFamily: 'Arial',
                fontSize: '28px',
                color: '#ffff00', // Bright yellow
                stroke: '#000000',
                strokeThickness: 5,
                fontStyle: 'bold'
            }
        );
        levelUpText.setOrigin(0.5);
        levelUpText.setDepth(BASE_DEPTH + container.y + 100); // Ensure it appears above the player
        
        // Animate the text
        this.tweens.add({
            targets: levelUpText,
            y: levelUpText.y - 80, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.5, to: 2 }, // Grow
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                levelUpText.destroy(); // Remove when animation is done
            }
        });
        
        // Create glow effect around player
        const glowCircle = this.add.circle(
            container.x,
            container.y,
            sprite.width / 1.5, // Slightly larger than the player
            0xffff00, // Yellow glow
            0.5 // Semi-transparent
        );
        glowCircle.setDepth(BASE_DEPTH + container.y - 1); // Just below the player
        
        // Expand and fade the glow
        this.tweens.add({
            targets: glowCircle,
            scale: 3,
            alpha: 0,
            duration: 500, // Reduced from 1000 to 500
            ease: 'Sine.easeOut',
            onComplete: () => {
                glowCircle.destroy();
            }
        });
        
        // Create particle effect
        const particles = this.add.particles(container.x, container.y, 'white_pixel', {
            speed: { min: 50, max: 150 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 1000,
            gravityY: -50, // Float upward
            tint: 0xffff00, // Yellow particles
            emitting: false
        });
        
        // Emit particles in a burst
        particles.explode(30, container.x, container.y);
        
        // Clean up particles after animation
        this.time.delayedCall(700, () => {
            particles.destroy();
        });
        
        // Add a flash to the player sprite
        const initialTint = sprite.tintTopLeft;
        sprite.setTint(0xffffff); // White flash
        
        this.time.delayedCall(200, () => {
            sprite.setTint(initialTint); // Reset tint
        });
    }

    private handleUpgradeOptionCreated(ctx: EventContext, upgrade: UpgradeOptionData): void {
        // Only handle options for the local player
        if (upgrade.playerId === this.localPlayerId) {
            console.log("Received upgrade option:", upgrade);
            
            // Initialize upgrade UI if not already done
            if (!this.upgradeUI && this.localPlayerId > 0) {
                this.upgradeUI = new UpgradeUI(this, this.spacetimeDBClient, this.localPlayerId);
            }
            
            // Collect all upgrades for this player by filtering the rows manually
            if (this.upgradeUI) {
                const playerUpgrades = Array.from(ctx.db?.upgradeOptions.iter())
                    .filter(option => option.playerId === this.localPlayerId);
                
                this.upgradeUI.setUpgradeOptions(playerUpgrades);
            }
        }
        else
        {
            console.log("Received upgrade option for other player:" + upgrade.playerId + ", local player id:" + this.localPlayerId);
        }
    }

    private handleUpgradeOptionDeleted(ctx: EventContext, upgrade: UpgradeOptionData): void {
        // When upgrades are deleted (usually after selection), hide the UI
        if (upgrade.playerId === this.localPlayerId && this.upgradeUI) {
            const remainingUpgrades = Array.from(ctx.db.upgradeOptions.iter())
                .filter(option => option.playerId === this.localPlayerId);
            
            if (remainingUpgrades.length === 0) {
                this.upgradeUI.hide();
            } else {
                this.upgradeUI.setUpgradeOptions(remainingUpgrades);
            }
        }
    }
    
    /**
     * Handle rerolling upgrades when the 'R' key is pressed
     */
    public rerollUpgrades(): void {
        if (!this.spacetimeDBClient.sdkConnection?.db || this.localPlayerId <= 0) {
            console.log("Cannot reroll: Connection not available or player not initialized");
            return;
        }
        
        // Get player data
        const player = this.spacetimeDBClient.sdkConnection.db.player.playerId.find(this.localPlayerId);
        if (!player) {
            console.log("Cannot reroll: Player data not found");
            return;
        }
        
        // Check if player has unspent upgrades and rerolls
        if (player.unspentUpgrades <= 0) {
            console.log("Cannot reroll: No unspent upgrades available");
            return;
        }
        
        if (player.rerolls <= 0) {
            console.log("Cannot reroll: No rerolls available");
            return;
        }
        
        console.log("Rerolling upgrades...");
        
        // Hide the upgrade UI
        if (this.upgradeUI) {
            this.upgradeUI.hide();
        }
        
        // Create reroll effect
        if (this.localPlayerSprite) {
            this.createRerollEffect(this.localPlayerSprite);
        }
        
        // Call the reroll reducer
        this.spacetimeDBClient.sdkConnection.reducers.rerollUpgrades(this.localPlayerId);
    }
    
    /**
     * Creates visual effects for rerolling upgrades
     */
    private createRerollEffect(playerSprite: Phaser.Physics.Arcade.Sprite): void {
        if (!playerSprite) return;
        
        console.log("Playing reroll effect!");
        
        // Create "REROLL!" text
        const rerollText = this.add.text(
            playerSprite.x,
            playerSprite.y - 80, // Above the player
            "REROLL!",
            {
                fontFamily: 'Arial',
                fontSize: '28px',
                color: '#00ffff', // Cyan
                stroke: '#000000',
                strokeThickness: 5,
                fontStyle: 'bold'
            }
        );
        rerollText.setOrigin(0.5);
        rerollText.setDepth(BASE_DEPTH + playerSprite.y + 100); // Ensure it appears above the player
        
        // Animate the text
        this.tweens.add({
            targets: rerollText,
            y: rerollText.y - 50, // Float upward
            alpha: { from: 1, to: 0 }, // Fade out
            scale: { from: 0.8, to: 1.5 }, // Grow
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                rerollText.destroy(); // Remove when animation is done
            }
        });
        
        // Create swirl effect around player
        const particles = this.add.particles(playerSprite.x, playerSprite.y, 'white_pixel', {
            speed: { min: 80, max: 180 },
            scale: { start: 0.5, end: 0 },
            blendMode: 'ADD',
            lifespan: 800,
            gravityY: 0,
            tint: 0x00ffff, // Cyan particles
            emitting: false,
            emitCallback: (particle: Phaser.GameObjects.Particles.Particle) => {
                // Make particles move in a circular pattern
                const angle = Math.random() * Math.PI * 2;
                const speed = Phaser.Math.Between(80, 180);
                const radius = Phaser.Math.Between(30, 80);
                
                particle.velocityX = Math.cos(angle) * speed;
                particle.velocityY = Math.sin(angle) * speed;
                
                // Add some rotation to each particle
                particle.rotation = angle;
            }
        });
        
        // Emit particles in a burst
        particles.explode(40, playerSprite.x, playerSprite.y);
        
        // Add a flash to the player sprite
        const initialTint = playerSprite.tintTopLeft;
        playerSprite.setTint(0x00ffff); // Cyan flash
        
        this.time.delayedCall(300, () => {
            playerSprite.setTint(initialTint); // Reset tint
        });
        
        // Clean up particles after animation
        this.time.delayedCall(800, () => {
            particles.destroy();
        });
    }

    // Create a semi-transparent minimap in the bottom-left corner
    private createMinimap() {
        // Create the minimap using the new Minimap class
        // SoulUI will be set later after it's initialized
        this.minimap = new Minimap(this, this.spacetimeDBClient);
        this.minimapElements = this.minimap.create();
        
        console.log("Minimap created using Minimap class");
    }

    // Setup touch input
    private setupTouchInput() {        
                this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            // Check if this pointer is being handled by the upgrade UI
            if (this.upgradeUI && this.upgradeUI.isPointerHandledByUI && this.upgradeUI.isPointerHandledByUI(pointer.id)) {
                console.log("Pointer is handled by upgrade UI - skipping movement command");
                return;
            }
            
            // Check if pointer is over options UI and skip movement if so
            const isOverOptionsUI = this.optionsUI && this.isPointerOverOptionsUI(pointer);
            
            if (isOverOptionsUI) {
                console.log("Pointer is over options UI - skipping movement command");
                return; // Return here to prevent movement processing
            }
            
            if (this.optionsUI) {
                console.log("Pointer not over options UI, proceeding with movement. Pointer pos:", pointer.x, pointer.y);
            }
            
            if (this.localPlayerSprite) {
                console.log("Pointer down - setting tap target");
                const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                this.tapTarget = new Phaser.Math.Vector2(worldPoint.x, worldPoint.y);
                this.updateTapMarker();
                
                // Send waypoint to server immediately
                if(!this.gameOver && this.spacetimeDBClient?.sdkConnection?.db) {
                    // Play movement command sound
                    const soundManager = (window as any).soundManager;
                    if (soundManager) {
                        soundManager.playSound('movement_command', 0.9);
                    }
                    
                    this.spacetimeDBClient.sdkConnection.reducers.setPlayerWaypoint(
                        this.tapTarget.x,
                        this.tapTarget.y
                    );
                }
            }
        });
    }

    // Add updatePlayerUI method
    private updatePlayerUI() {
        if (!this.localPlayerSprite) return;

        // Update name text
        if (this.localPlayerNameText) {
            this.localPlayerNameText.x = this.localPlayerSprite.x;
            this.localPlayerNameText.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - NAME_OFFSET_Y;
            this.localPlayerNameText.setDepth(BASE_DEPTH + this.localPlayerSprite.y + NAME_DEPTH_OFFSET);
        }

        // Update shadow
        if (this.localPlayerShadow) {
            this.localPlayerShadow.x = this.localPlayerSprite.x;
            this.localPlayerShadow.y = this.localPlayerSprite.y + SHADOW_OFFSET_Y;
            this.localPlayerShadow.setDepth(BASE_DEPTH + this.localPlayerSprite.y + SHADOW_DEPTH_OFFSET);
        }

        // Update health bar
        const healthBarBackground = this.localPlayerSprite.getData('healthBarBackground');
        const healthBar = this.localPlayerSprite.getData('healthBar');
        if (healthBarBackground && healthBar) {
            healthBarBackground.x = this.localPlayerSprite.x;
            healthBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
            healthBarBackground.setDepth(BASE_DEPTH + this.localPlayerSprite.y + HEALTH_BAR_DEPTH_OFFSET);
            
            healthBar.x = this.localPlayerSprite.x - (HEALTH_BAR_WIDTH / 2);
            healthBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - HEALTH_BAR_OFFSET_Y;
            healthBar.setDepth(BASE_DEPTH + this.localPlayerSprite.y + HEALTH_BAR_DEPTH_OFFSET);
        }

        // Update exp bar
        const expBarBackground = this.localPlayerSprite.getData('expBarBackground');
        const expBar = this.localPlayerSprite.getData('expBar');
        if (expBarBackground && expBar) {
            expBarBackground.x = this.localPlayerSprite.x;
            expBarBackground.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
            expBarBackground.setDepth(BASE_DEPTH + this.localPlayerSprite.y + EXP_BG_DEPTH_OFFSET);
            
            expBar.x = this.localPlayerSprite.x - (EXP_BAR_WIDTH / 2);
            expBar.y = this.localPlayerSprite.y - Math.floor(this.localPlayerSprite.height / 2) - EXP_BAR_OFFSET_Y;
            expBar.setDepth(BASE_DEPTH + this.localPlayerSprite.y + EXP_BAR_DEPTH_OFFSET);
        }
    }

    // Show dark haze overlay during boss fights
    private showBossHaze(): void {
        const hazeAlpha = 0.4; // Increased for testing
        const hazeDepth = UI_DEPTH - 1; // Increased for testing

        if (this.bossHazeOverlay) {
            console.log("Boss haze overlay already exists. Setting visible and alpha.");
            this.bossHazeOverlay.setVisible(true);
            this.bossHazeOverlay.setAlpha(hazeAlpha); // Use test alpha
            this.bossHazeOverlay.setDepth(hazeDepth); // Ensure depth is also set here
            return;
        }

        const { width, height } = this.scale;
        console.log(`Creating boss haze overlay with dimensions: ${width}x${height}`);
        
        // Create dark semi-transparent overlay
        this.bossHazeOverlay = this.add.rectangle(0, 0, width, height, 0x1A1E40, hazeAlpha) // Initial alpha is testAlpha (though it's set to 0 next)
            .setOrigin(0, 0)
            .setScrollFactor(0) // Fix to camera
            .setDepth(hazeDepth); // Use test depth
        
        // Fade in the haze
        this.bossHazeOverlay.setAlpha(0); // Starts at alpha 0 for fade-in
        this.tweens.add({
            targets: this.bossHazeOverlay,
            alpha: hazeAlpha, // Fades to test alpha
            duration: 2000,
            ease: 'Power2.easeIn',
            onComplete: () => {
                console.log("Boss haze fade-in tween complete. Alpha:", this.bossHazeOverlay?.alpha);
            }
        });
        
        console.log("Boss haze overlay creation initiated.");
    }

    // Hide dark haze overlay when boss is defeated
    private hideBossHaze(): void {
        if (!this.bossHazeOverlay) return;
        
        // Fade out the haze
        this.tweens.add({
            targets: this.bossHazeOverlay,
            alpha: 0,
            duration: 1500,
            ease: 'Power2.easeOut',
            onComplete: () => {
                if (this.bossHazeOverlay) {
                    this.bossHazeOverlay.destroy();
                    this.bossHazeOverlay = null;
                }
            }
        });
        
        console.log("Boss haze overlay hidden");
    }

    // Handle game state changes to hide haze when boss is defeated
    private handleGameStateUpdated(ctx: EventContext, oldState: any, newState: any): void {
        // Check if boss becomes inactive (defeated)
        if (oldState.bossActive && !newState.bossActive) {
            console.log("Boss defeated! Hiding haze overlay");
            this.hideBossHaze();
        }
    }

    private handleResize(): void {
        // Update MonsterCounterUI position when screen resizes
        if (this.monsterCounterUI) {
            this.monsterCounterUI.updatePosition();
        }
    }

    private isPointerOverOptionsUI(pointer: Phaser.Input.Pointer): boolean {
        if (!this.optionsUI) return false;
        
        // Check if options UI is visible
        const container = (this.optionsUI as any).container;
        if (!container || !container.visible) return false;
        
        // Options UI container has scrollFactor 0, so it's positioned in screen coordinates
        // Container is at screen position (20, 20) with size 250x200
        const uiScreenX = 20;
        const uiScreenY = 20;
        const uiWidth = 250;
        const uiHeight = 200;
        
        // Use pointer screen coordinates (since UI doesn't move with camera)
        const screenX = pointer.x;
        const screenY = pointer.y;
        
        // Check if pointer is within the UI bounds in screen space
        const isOverUI = screenX >= uiScreenX && 
               screenX <= uiScreenX + uiWidth && 
               screenY >= uiScreenY && 
               screenY <= uiScreenY + uiHeight;
               
        if (isOverUI) {
            console.log("Pointer IS over options UI bounds:", screenX, screenY, "vs bounds:", uiScreenX, uiScreenY, uiWidth, uiHeight);
        }
        
        return isOverUI;
    }

    // Add PvP circle indicator around PvP-enabled players and manage attack transparency
    private createPvpIndicator(container: Phaser.GameObjects.Container, isPvpEnabled: boolean): Phaser.GameObjects.Arc | null {
        if (!isPvpEnabled) return null;
        
        // Create a transparent red circle around the player
        const pvpCircle = this.add.circle(0, 0, 60, 0xff0000, 0.3);
        pvpCircle.setStrokeStyle(2, 0xff0000, 0.6);
        pvpCircle.setName('pvpIndicator');
        
        // Add pulsing animation
        this.tweens.add({
            targets: pvpCircle,
            alpha: { from: 0.3, to: 0.1 },
            yoyo: true,
            repeat: -1,
            duration: 1500,
            ease: 'Sine.easeInOut'
        });
        
        // Add to container
        container.add(pvpCircle);
        
        return pvpCircle;
    }

    private updatePvpIndicator(container: Phaser.GameObjects.Container, isPvpEnabled: boolean): void {
        const existingIndicator = container.getByName('pvpIndicator') as Phaser.GameObjects.Arc;
        
        if (isPvpEnabled && !existingIndicator) {
            // Add PvP indicator
            this.createPvpIndicator(container, true);
        } else if (!isPvpEnabled && existingIndicator) {
            // Remove PvP indicator
            existingIndicator.destroy();
        }
    }

    private updateLocalPlayerPvpIndicator(isPvpEnabled: boolean): void {
        if (!this.localPlayerSprite) return;
        
        // Check if we already have a PvP indicator
        const existingIndicator = this.localPlayerSprite.getData('pvpIndicator') as Phaser.GameObjects.Arc;
        
        if (isPvpEnabled && !existingIndicator) {
            // Create PvP indicator for local player
            const pvpCircle = this.add.circle(
                this.localPlayerSprite.x, 
                this.localPlayerSprite.y, 
                60, 
                0xff0000, 
                0.3
            );
            pvpCircle.setStrokeStyle(2, 0xff0000, 0.6);
            pvpCircle.setDepth(this.localPlayerSprite.depth - 0.5); // Just behind the player
            
            // Add pulsing animation
            this.tweens.add({
                targets: pvpCircle,
                alpha: { from: 0.3, to: 0.1 },
                yoyo: true,
                repeat: -1,
                duration: 1500,
                ease: 'Sine.easeInOut'
            });
            
            // Store reference on the player sprite
            this.localPlayerSprite.setData('pvpIndicator', pvpCircle);
        } else if (!isPvpEnabled && existingIndicator) {
            // Remove PvP indicator
            existingIndicator.destroy();
            this.localPlayerSprite.setData('pvpIndicator', null);
        }
    }
    
    // Development functions removed for production
}