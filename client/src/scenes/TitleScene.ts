import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import MusicManager from '../managers/MusicManager';

export default class TitleScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private musicManager!: MusicManager;
    
    // UI Elements
    private titleContainer!: Phaser.GameObjects.Container;
    private statusText!: Phaser.GameObjects.Text;

    constructor() {
        super('TitleScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
        console.log("TitleScene constructor called");
    }

    preload() {
        // Load assets needed for the title screen
        this.load.image('title_bg', '/assets/title_bg.png');
    }

    create() {
        const { width, height } = this.scale;
        
        // Initialize music manager
        this.musicManager = new MusicManager(this);
        
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
                    this.musicManager.playTrack('title');
                });
            } catch (error) {
                console.warn("TitleScene: Failed to setup music loading:", error);
            }
        } else {
            console.log("TitleScene: Music loading disabled");
        }
        
        // Set background
        this.cameras.main.setBackgroundColor('#042E64');
        
        try {
            if (this.textures.exists('title_bg')) {
                this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }
        
        // Create a container for all title UI elements
        this.titleContainer = this.add.container(width/2, height/2);
        
        // Add game title
        const titleText = this.add.text(0, -150, 'VIBE SURVIVORS', {
            fontFamily: 'Arial Black',
            fontSize: '64px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.titleContainer.add(titleText);
        
        // Add subtitle
        const subtitleText = this.add.text(0, -100, 'Battle for survival in an endless void!', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#cccccc',
            align: 'center'
        }).setOrigin(0.5);
        this.titleContainer.add(subtitleText);
        
        // Add status text for connection
        this.statusText = this.add.text(0, 0, 'Connecting to server...', {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        this.titleContainer.add(this.statusText);
        
        // Register event listeners
        this.registerEventListeners();
        
        // Check initial connection state
        this.updateConnectionStatus();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        this.events.on("shutdown", this.shutdown, this);
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        
        // Update container position to new center
        if (this.titleContainer) {
            this.titleContainer.setPosition(width/2, height/2);
        }
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
            this.statusText.setText('Connected! Checking account status...');
        } else {
            this.statusText.setText('Connecting to server...');
        }
    }
    
    shutdown() {
        // Cleanup music manager
        if (this.musicManager) {
            this.musicManager.cleanup();
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