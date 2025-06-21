import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import { Account } from '../autobindings';
import MusicManager from '../managers/MusicManager';
import OptionsUI from '../ui/OptionsUI';

// Constants for responsive design
const RESPONSIVE_CONFIG = {
    TITLE_SIZE_RATIO: 0.08,
    TITLE_HEIGHT_RATIO: 0.12,
    MAX_TITLE_SIZE: 64,
    SUBTITLE_SIZE_RATIO: 0.025,
    SUBTITLE_HEIGHT_RATIO: 0.04,
    MAX_SUBTITLE_SIZE: 24,
    STATUS_SIZE_RATIO: 0.02,
    STATUS_HEIGHT_RATIO: 0.035,
    MAX_STATUS_SIZE: 20,
    TITLE_Y_OFFSET: 0.15,
    SUBTITLE_Y_OFFSET: 0.1,
    MIN_STROKE_WIDTH: 4
};

export default class TitleScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    private optionsUI!: OptionsUI;
    
    // UI Elements
    private titleContainer!: Phaser.GameObjects.Container;
    private statusText!: Phaser.GameObjects.Text;
    private startButton!: HTMLButtonElement;

    constructor() {
        super('TitleScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("TitleScene constructor called");
    }

    preload() {
        // Load assets needed for the title screen
        this.load.image('title_bg', '/assets/title_bg.png');
        
        // Preload game-over and victory assets to eliminate loading delays during transitions
        this.load.image('victory_screen', '/assets/victory_screen.png');
        this.load.image('loss_screen', '/assets/loss_screen.png');
        
        // Preload common effect assets used across scenes
        this.load.image('white_pixel', '/assets/white_pixel.png');
        
        // Preload core game assets for faster initial gameplay
        this.load.image('grass_background', '/assets/grass.png');
        this.load.image('shadow', '/assets/shadow.png');
        
        // Preload player class sprites for faster character selection and gameplay
        this.load.image('player_fighter', '/assets/class_fighter_1.png');
        this.load.image('player_rogue', '/assets/class_rogue_1.png');
        this.load.image('player_mage', '/assets/class_mage_1.png');
        this.load.image('player_paladin', '/assets/class_paladin_1.png');
        
        // Preload class selection icons
        this.load.image('fighter_icon', '/assets/attack_sword.png');
        this.load.image('rogue_icon', '/assets/attack_knife.png');
        this.load.image('mage_icon', '/assets/attack_wand.png');
        this.load.image('paladin_icon', '/assets/attack_shield.png');
        
        // Preload upgrade UI assets to eliminate delays when leveling up
        this.load.image('card_blank', '/assets/card_blank.png');
        this.load.image('upgrade_maxHP', '/assets/upgrade_maxHP.png');
        this.load.image('upgrade_regenHP', '/assets/upgrade_regenHP.png');
        this.load.image('upgrade_speed', '/assets/upgrade_speed.png');
        this.load.image('upgrade_armor', '/assets/upgrade_armor.png');

        // Preload options UI assets
        this.load.image('icon_music', '/assets/icon_music.png');
        this.load.image('icon_sound', '/assets/icon_sound.png');
        this.load.image('button_pvp_off', '/assets/button_pvp_off.png');
        this.load.image('button_pvp_on', '/assets/button_pvp_on.png');
        
        // Preload gem assets for smooth gameplay experience
        this.load.image('gem_1', '/assets/gem_1.png');
        this.load.image('gem_2', '/assets/gem_2.png');
        this.load.image('gem_3', '/assets/gem_3.png');
        this.load.image('gem_4', '/assets/gem_4.png');
        this.load.image('soul', '/assets/soul.png');
        this.load.image('fries', '/assets/fries.png');
        this.load.image('dice', '/assets/dice.png');
        this.load.image('booster_pack', '/assets/booster_pack.png');
        
        // Preload monster assets for seamless gameplay
        this.load.image('monster_rat', '/assets/monster_rat.png');
        this.load.image('monster_slime', '/assets/monster_slime.png');
        this.load.image('monster_orc', '/assets/monster_orc.png');
        this.load.image('monster_imp', '/assets/monster_imp.png');
        this.load.image('monster_zombie', '/assets/monster_zombie.png');
        this.load.image('monster_bat', '/assets/monster_bat.png');
        this.load.image('monster_spawn_indicator', '/assets/monster_spawn_indicator.png');
        
        // Preload boss assets for end-game experience
        this.load.image('final_boss_phase1', '/assets/final_boss_phase_1.png');
        this.load.image('final_boss_phase2', '/assets/final_boss_phase_2.png');
        this.load.image('boss_agna_1', '/assets/boss_agna_1.png');
        this.load.image('boss_agna_2', '/assets/boss_agna_2.png');
        this.load.image('agna_flamethrower', '/assets/agna_flamethrower.png');
        this.load.image('agna_magic_circle', '/assets/agna_magic_circle.png');
        this.load.image('agna_ground_circle', '/assets/agna_flame_ground.png');
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
        
        // Load monster attack assets for seamless gameplay
        this.load.image('monster_attack_firebolt', '/assets/monster_attack_firebolt.png');
        this.load.image('void_scythe', '/assets/void_scythe.png');
        this.load.image('void_bolt', '/assets/void_bolt.png');
        
        console.log("TitleScene: Preloading ALL game assets for completely seamless gameplay experience");
    }

    create() {
        const { width, height } = this.scale;
        
        // Set the global SoundManager's scene reference
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.setScene(this);
        }
        
        // Initialize music manager
        this.musicManager = new MusicManager(this);
        
        // Initialize options UI
        this.optionsUI = new OptionsUI(this);
        
        // Preload music asynchronously after scene is active (can be disabled if music files are missing)
        const ENABLE_MUSIC = true; // Set to false to disable music loading
        if (ENABLE_MUSIC) {
            try {
                // Load music asynchronously so it doesn't block scene activation
                this.load.audio('title', '/assets/music/title.mp3');
                this.load.audio('main', '/assets/music/main.mp3');
                this.load.audio('boss', '/assets/music/boss.mp3');
                this.load.audio('game_over_sting', '/assets/music/game_over_sting.mp3');
                this.load.audio('win_sting', '/assets/music/win_sting.mp3');
                
                // Load sound effects for boss AI state changes and other game events
                this.load.audio('boss_chase_cue', '/assets/sounds/boss_chase_cue.mp3');
                this.load.audio('boss_bullet_cue', '/assets/sounds/boss_bullet_cue.mp3');
                this.load.audio('boss_teleport_cue', '/assets/sounds/boss_teleport_cue.mp3');
                this.load.audio('boss_vanish', '/assets/sounds/boss_vanish.mp3');
                this.load.audio('boss_appear', '/assets/sounds/boss_appear.mp3');
                this.load.audio('boss_teleport_attack', '/assets/sounds/boss_teleport_attack.mp3');
                this.load.audio('voice_boss', '/assets/sounds/voice_boss.mp3');
                this.load.audio('boss_transform', '/assets/sounds/boss_transform.mp3');
                this.load.audio('voice_boss_2', '/assets/sounds/voice_boss_2.mp3');
                this.load.audio('voice_transform', '/assets/sounds/voice_transform.mp3');
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
                
                // Load UI and menu sound effects
                this.load.audio('voice_name', '/assets/sounds/voice_name.mp3');
                this.load.audio('voice_class', '/assets/sounds/voice_class.mp3');
                this.load.audio('voice_chest', '/assets/sounds/voice_chest.mp3');
                this.load.audio('voice_lose', '/assets/sounds/voice_lose.mp3');
                this.load.audio('voice_win', '/assets/sounds/voice_win.mp3');
                this.load.audio('voice_level', '/assets/sounds/voice_level.mp3');
                this.load.audio('voice_welcome', '/assets/sounds/voice_welcome.mp3');
                this.load.audio('choose', '/assets/sounds/choose.mp3');
                this.load.audio('ui_click', '/assets/sounds/ui_click.mp3');
                
                // Load gameplay sound effects
                this.load.audio('level_up', '/assets/sounds/level_up.mp3');
                this.load.audio('dice', '/assets/sounds/dice.mp3');
                this.load.audio('exp_gem', '/assets/sounds/exp_gem.mp3');
                this.load.audio('movement_command', '/assets/sounds/move_command.mp3');
                this.load.audio('food', '/assets/sounds/food.mp3');
                this.load.audio('booster_pack', '/assets/sounds/booster_pack.mp3');
                this.load.audio('monster_death', '/assets/sounds/monster_death.mp3');
                this.load.audio('attack_soft', '/assets/sounds/attack_soft.mp3');
                this.load.audio('attack_fire', '/assets/sounds/attack_fire.mp3');
                this.load.audio('alert_event', '/assets/sounds/alert_event.mp3');
                
                // Add error handling for missing files
                this.load.on('loaderror', (fileObj: any) => {
                    if (fileObj.type === 'audio') {
                        console.warn(`TitleScene: Failed to load audio file: ${fileObj.key} from ${fileObj.url}`);
                    }
                });
                
                // Start loading music files
                this.load.start();
                
                // Play title music once it's loaded
                this.load.once('complete', () => {
                    console.log("TitleScene: All audio files loaded successfully");
                    console.log("TitleScene: 'choose' exists:", this.cache.audio.exists('choose'));
                    console.log("TitleScene: 'alert_event' exists:", this.cache.audio.exists('alert_event'));
                    console.log("TitleScene: 'movement_command' exists:", this.cache.audio.exists('movement_command'));
                    console.log("TitleScene: 'attack_soft' exists:", this.cache.audio.exists('attack_soft'));
                    console.log("TitleScene: 'attack_fire' exists:", this.cache.audio.exists('attack_fire'));
                    console.log("TitleScene: 'monster_death' exists:", this.cache.audio.exists('monster_death'));
                    
                    // Check if audio context is suspended (browser audio policy)
                    const audioContext = (this.sound as any).context;
                    if (audioContext && audioContext.state === 'suspended') {
                        console.warn("TitleScene: Audio context is suspended - will need user interaction to resume");
                    }
                    
                    this.musicManager.playTrack('title');
                });
            } catch (error) {
                console.warn("TitleScene: Failed to setup music loading:", error);
            }
        } else {
            console.log("TitleScene: Music loading disabled");
        }
        
        // Preload icons into browser cache for instant HTML img loading
        this.preloadIconsForHTMLElements();
        
        // Set background
        this.cameras.main.setBackgroundColor('#042E64');
        
        try {
            if (this.textures.exists('title_bg')) {
                this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0)
                    .setName('title_bg');
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all title UI elements
        this.titleContainer = this.add.container(width/2, height/2);
        
        // Calculate responsive font sizes based on screen dimensions
        const baseTitleSize = Math.min(width * RESPONSIVE_CONFIG.TITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.TITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_TITLE_SIZE);
        const baseSubtitleSize = Math.min(width * RESPONSIVE_CONFIG.SUBTITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.SUBTITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_SUBTITLE_SIZE);
        const baseStatusSize = Math.min(width * RESPONSIVE_CONFIG.STATUS_SIZE_RATIO, height * RESPONSIVE_CONFIG.STATUS_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_STATUS_SIZE);
        console.log(`TitleScene: Responsive text sizing - Title: ${baseTitleSize}px, Subtitle: ${baseSubtitleSize}px, Status: ${baseStatusSize}px for screen ${width}x${height}`);
        
        // Add game title
        const titleText = this.add.text(0, -height * RESPONSIVE_CONFIG.TITLE_Y_OFFSET, 'VIBE SURVIVORS', {
            fontFamily: 'Arial Black',
            fontSize: `${baseTitleSize}px`,
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseTitleSize / 8)
        }).setOrigin(0.5).setName('titleText');
        this.titleContainer.add(titleText);
        
        // Add subtitle
        const subtitleText = this.add.text(0, -height * RESPONSIVE_CONFIG.SUBTITLE_Y_OFFSET, 'Battle for survival against the void!', {
            fontFamily: 'Arial',
            fontSize: `${baseSubtitleSize}px`,
            color: '#cccccc',
            align: 'center'
        }).setOrigin(0.5).setName('subtitleText');
        this.titleContainer.add(subtitleText);
        
        // Add status text for connection
        this.statusText = this.add.text(0, 0, 'Connecting to server...', {
            fontFamily: 'Arial',
            fontSize: `${baseStatusSize}px`,
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5).setName('statusText');
        this.titleContainer.add(this.statusText);
        
        // Create start button (initially hidden)
        this.createStartButton();
        
        // Register event listeners
        this.registerEventListeners();
        
        // Add keyboard handler for options menu
        if (this.input.keyboard) {
            this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.O).on('down', () => {
                this.optionsUI.toggle();
            });
        }
        
        // Check initial connection state
        this.updateConnectionStatus();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
    }
    
    private createStartButton() {
        // Remove any existing start button
        const existingButton = document.getElementById('title-start-button');
        if (existingButton) existingButton.remove();
        
        // Create start button
        this.startButton = document.createElement('button');
        this.startButton.id = 'title-start-button';
        this.startButton.textContent = 'START GAME';
        this.startButton.style.position = 'absolute';
        this.startButton.style.fontFamily = 'Arial Black';
        this.startButton.style.fontSize = '24px';
        this.startButton.style.padding = '15px 30px';
        this.startButton.style.backgroundColor = '#27ae60';
        this.startButton.style.color = 'white';
        this.startButton.style.border = '3px solid #2c3e50';
        this.startButton.style.borderRadius = '8px';
        this.startButton.style.cursor = 'pointer';
        this.startButton.style.fontWeight = 'bold';
        this.startButton.style.transition = 'background-color 0.2s, border-color 0.2s, transform 0.1s';
        this.startButton.style.display = 'none'; // Hidden initially
        this.startButton.style.left = '50%';
        this.startButton.style.transform = 'translateX(-50%)';
        
        // Add hover effects
        this.startButton.addEventListener('mouseenter', () => {
            this.startButton.style.backgroundColor = '#2ecc71';
            this.startButton.style.borderColor = '#34495e';
            this.startButton.style.transform = 'translateX(-50%) scale(1.05)';
        });
        
        this.startButton.addEventListener('mouseleave', () => {
            this.startButton.style.backgroundColor = '#27ae60';
            this.startButton.style.borderColor = '#2c3e50';
            this.startButton.style.transform = 'translateX(-50%) scale(1)';
        });
        
        // Add click handler
        this.startButton.addEventListener('click', () => {
            this.handleStartGame();
        });
        
        document.body.appendChild(this.startButton);
        
        // Position the button
        this.positionStartButton();
    }
    
    private positionStartButton() {
        if (this.startButton) {
            const { height } = this.scale;
            this.startButton.style.top = `${height / 2 + 100}px`;
        }
    }
    
    private handleStartGame() {
        console.log("Start Game button clicked");
        
        // Try to resume audio context if it's suspended (browser audio policy)
        const audioContext = (this.sound as any).context;
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                this.playStartGameSound();
            }).catch(() => {
                this.playStartGameSound(); // Try anyway
            });
        } else {
            this.playStartGameSound();
        }
    }
    
    private playStartGameSound() {
        // Play choose sound effect
        const soundManager = (window as any).soundManager;
        if (soundManager) {
            soundManager.playSound('choose', 0.8);
        }
        
        // Hide the button during transition
        this.startButton.style.display = 'none';
        this.statusText.setText('Loading...');
        
        // Add a small delay to let the sound start before scene transition
        this.time.delayedCall(200, () => {
            // Check account state and navigate accordingly
            if (this.spacetimeDBClient.sdkConnection?.db && this.spacetimeDBClient.identity) {
                const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity) as Account;
                
                if (account) {
                    console.log("Found account with state:", account.state.tag);
                    
                    // Navigate based on account state
                    switch ((account.state as any).tag) {
                        case 'ChoosingName':
                            this.scene.start('NameSelectScene');
                            break;
                        case 'ChoosingClass':
                            this.scene.start('ClassSelectScene');
                            break;
                        case 'Playing':
                            this.scene.start('GameScene');
                            break;
                        case 'Dead':
                            this.scene.start('DeadScene');
                            break;
                        case 'Winner':
                            this.scene.start('VictoryScene');
                            break;
                        default:
                            console.log("Unknown account state:", account.state.tag);
                            this.scene.start('LoadingScene', { 
                                message: 'Evaluating account state...', 
                                waitingFor: 'account_evaluation'
                            });
                            break;
                    }
                } else {
                    console.log("No account found, going to login");
                    this.scene.start('LoginScene');
                }
            } else {
                console.log("No connection or identity, going to login");
                this.scene.start('LoginScene');
            }
        });
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        console.log(`TitleScene: Handling resize to ${width}x${height}`);
        
        // Update background image
        const backgroundImage = this.children.getByName('title_bg') as Phaser.GameObjects.Image;
        if (backgroundImage) {
            backgroundImage.setPosition(width/2, height/2);
            backgroundImage.setDisplaySize(width, height);
            console.log(`TitleScene: Updated background image to ${width}x${height}`);
        }
        
        // Update container position to new center
        if (this.titleContainer) {
            this.titleContainer.setPosition(width/2, height/2);
            
            // Update text elements within the container
            const titleText = this.titleContainer.getByName('titleText') as Phaser.GameObjects.Text;
            const subtitleText = this.titleContainer.getByName('subtitleText') as Phaser.GameObjects.Text;
            const statusText = this.titleContainer.getByName('statusText') as Phaser.GameObjects.Text;
            
            if (titleText) {
                // Recalculate responsive font sizes
                const baseTitleSize = Math.min(width * RESPONSIVE_CONFIG.TITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.TITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_TITLE_SIZE);
                titleText.setPosition(0, -height * RESPONSIVE_CONFIG.TITLE_Y_OFFSET);
                titleText.setFontSize(baseTitleSize);
                titleText.setStroke('#000000', Math.max(RESPONSIVE_CONFIG.MIN_STROKE_WIDTH, baseTitleSize / 8));
                console.log(`TitleScene: Updated title text - size: ${baseTitleSize}px, position: (0, ${-height * RESPONSIVE_CONFIG.TITLE_Y_OFFSET})`);
            }
            
            if (subtitleText) {
                const baseSubtitleSize = Math.min(width * RESPONSIVE_CONFIG.SUBTITLE_SIZE_RATIO, height * RESPONSIVE_CONFIG.SUBTITLE_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_SUBTITLE_SIZE);
                subtitleText.setPosition(0, -height * RESPONSIVE_CONFIG.SUBTITLE_Y_OFFSET);
                subtitleText.setFontSize(baseSubtitleSize);
                console.log(`TitleScene: Updated subtitle text - size: ${baseSubtitleSize}px, position: (0, ${-height * RESPONSIVE_CONFIG.SUBTITLE_Y_OFFSET})`);
            }
            
            if (statusText) {
                const baseStatusSize = Math.min(width * RESPONSIVE_CONFIG.STATUS_SIZE_RATIO, height * RESPONSIVE_CONFIG.STATUS_HEIGHT_RATIO, RESPONSIVE_CONFIG.MAX_STATUS_SIZE);
                statusText.setFontSize(baseStatusSize);
                console.log(`TitleScene: Updated status text - size: ${baseStatusSize}px`);
            }
        }
        
        // Update button positions
        this.positionStartButton();
    }
    
    private registerEventListeners() {
        // Connection events
        this.gameEvents.on(GameEvents.CONNECTION_ESTABLISHED, this.handleConnectionEstablished, this);
        this.gameEvents.on(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
    }
    
    private handleConnectionEstablished() {
        console.log("Connection established event received in TitleScene");
        this.updateConnectionStatus();
    }
    
    private handleConnectionLost() {
        console.log("Connection lost event received in TitleScene");
        this.updateConnectionStatus();
    }
    
    private updateConnectionStatus() {
        if (this.spacetimeDBClient.isConnected) {
            this.statusText.setText('Connected! Ready to play.');
            // Show the start button when connected
            if (this.startButton) {
                this.startButton.style.display = 'block';
            }
        } else {
            this.statusText.setText('Connecting to server...');
            // Hide the start button when not connected
            if (this.startButton) {
                this.startButton.style.display = 'none';
            }
        }
    }
    
    private preloadIconsForHTMLElements() {
        console.log("TitleScene: Preloading icons into browser cache for HTML elements");
        
        const iconAssets = [
            '/assets/attack_sword.png',
            '/assets/attack_knife.png', 
            '/assets/attack_wand.png',
            '/assets/attack_shield.png'
        ];
        
        // Create hidden img elements to preload assets into browser cache
        iconAssets.forEach(src => {
            const img = new Image();
            img.src = src;
            img.style.display = 'none';
            img.style.position = 'absolute';
            img.style.left = '-9999px';
            
            img.onload = () => {
                console.log(`TitleScene: Successfully cached ${src} for HTML elements`);
                // Remove the hidden element after loading
                if (img.parentNode) {
                    img.parentNode.removeChild(img);
                }
            };
            
            img.onerror = () => {
                console.warn(`TitleScene: Failed to cache ${src}`);
                // Remove the element even if loading failed
                if (img.parentNode) {
                    img.parentNode.removeChild(img);
                }
            };
            
            // Add to DOM to trigger loading
            document.body.appendChild(img);
        });
    }
    
    shutdown() {
        // Cleanup music manager
        if (this.musicManager) {
            this.musicManager.cleanup();
        }
        
        // Cleanup options UI
        if (this.optionsUI) {
            this.optionsUI.destroy();
        }
        
        // Remove start button
        if (this.startButton && this.startButton.parentNode) {
            this.startButton.remove();
        }
        
        // Clean up any lingering start button
        const startButton = document.getElementById('title-start-button');
        if (startButton) startButton.remove();
        
        // Remove keyboard listeners
        if (this.input.keyboard) {
            this.input.keyboard.removeKey(Phaser.Input.Keyboard.KeyCodes.O);
        }
        
        // Remove event listeners
        this.events.off("shutdown", this.shutdown, this);
        this.gameEvents.off(GameEvents.CONNECTION_ESTABLISHED, this.handleConnectionEstablished, this);
        this.gameEvents.off(GameEvents.CONNECTION_LOST, this.handleConnectionLost, this);
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
        
        console.log("TitleScene shutdown completed");
    }
} 