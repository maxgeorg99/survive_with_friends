import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Constants
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements
const BOSS_SPAWN_DELAY_MS = 5 * 60 * 1000; // 5 minutes in milliseconds, same as server
const WARNING_THRESHOLD = 60 * 1000; // Start warning animation at 1 minute remaining

export default class BossTimerUI {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private container: Phaser.GameObjects.Container;
    private timerText: Phaser.GameObjects.Text;
    private timerBackground: Phaser.GameObjects.Rectangle;
    private timerIcon: Phaser.GameObjects.Image;
    private gameEvents: Phaser.Events.EventEmitter;
    
    // Timer tracking
    private bossSpawnTime: number | null = null;
    private isTimerActive: boolean = false;
    private flashAnimation: Phaser.Tweens.Tween | null = null;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.gameEvents = (window as any).gameEvents;
        
        // Create container for UI elements
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(UI_DEPTH);
        
        // Create background for timer
        this.timerBackground = this.scene.add.rectangle(0, 0, 180, 40, 0x000000, 0.7);
        this.timerBackground.setStrokeStyle(2, 0x444444);
        this.timerBackground.setOrigin(0.5, 0.5);
        
        // Create timer text
        this.timerText = this.scene.add.text(0, 0, "BOSS: --:--", {
            fontSize: '20px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
            align: 'center'
        });
        this.timerText.setOrigin(0.5, 0.5);
        
        // Add skull icon for boss timer
        this.timerIcon = this.scene.add.image(-70, 0, 'final_boss_phase1');
        this.timerIcon.setScale(0.4);
        this.timerIcon.setOrigin(0.5, 0.5);
        
        // Add elements to container
        this.container.add([this.timerBackground, this.timerText, this.timerIcon]);
        
        // Hide initially until we know a boss is coming
        this.container.setVisible(false);
        
        // Register event listeners
        this.registerEventListeners();
        
        console.log('BossTimerUI initialized');
        
        // For testing - start timer on init
        // this.startTimer();
    }

    private registerEventListeners(): void {
        // Listen for game state updates to detect boss timer changes
        this.gameEvents.on(GameEvents.GAME_STATE_UPDATED, this.handleGameStateUpdated, this);
        
        // Listen for boss spawn timer creation
        this.gameEvents.on(GameEvents.BOSS_SPAWN_TIMER_CREATED, this.handleBossTimerCreated, this);
        
        // Listen for boss spawn
        this.gameEvents.on(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);
    }

    private handleGameStateUpdated(ctx: any, oldState: any, newState: any): void {
        // If boss becomes active, hide the timer
        if (!oldState.bossActive && newState.bossActive) {
            this.stopTimer();
            this.container.setVisible(false);
        }
        
        // If boss becomes inactive and was previously active, prepare for new timer
        if (oldState.bossActive && !newState.bossActive) {
            // Boss fight ended, we'll wait for new timer to be created
            this.bossSpawnTime = null;
        }
    }

    private handleBossTimerCreated(ctx: any, timer: any): void {
        console.log("Boss timer created:", timer);
        
        // Calculate when the boss will spawn
        if (timer && timer.scheduledAt && timer.scheduledAt.timeMs) {
            this.bossSpawnTime = timer.scheduledAt.timeMs;
            this.startTimer();
        }
    }

    private handleMonsterCreated(ctx: any, monster: any): void {
        // If a boss monster is created, hide the timer
        if (monster.bestiaryId && monster.bestiaryId.tag) {
            const monsterType = monster.bestiaryId.tag;
            if (monsterType === 'FinalBossPhase1' || monsterType === 'FinalBossPhase2') {
                this.stopTimer();
                this.container.setVisible(false);
            }
        }
    }

    public startTimer(): void {
        if (!this.bossSpawnTime) {
            // If no explicit time was set, use the default 5 minute timer
            this.bossSpawnTime = Date.now() + BOSS_SPAWN_DELAY_MS;
        }
        
        this.isTimerActive = true;
        this.container.setVisible(true);
        
        console.log(`Boss timer started. Boss will spawn at: ${new Date(this.bossSpawnTime).toLocaleTimeString()}`);
    }

    public stopTimer(): void {
        this.isTimerActive = false;
        
        // Stop any ongoing animations
        if (this.flashAnimation) {
            this.flashAnimation.stop();
            this.flashAnimation = null;
        }
        
        this.timerText.setColor('#ffffff');
    }

    public update(time: number, delta: number): void {
        // Update position based on camera view
        const camera = this.scene.cameras.main;
        if (camera) {
            this.container.x = camera.scrollX + camera.width / 2;
            this.container.y = camera.scrollY + 40; // Position at the top
        }
        
        // Update timer if active
        if (this.isTimerActive && this.bossSpawnTime) {
            const now = Date.now();
            const timeRemaining = Math.max(0, this.bossSpawnTime - now);
            
            if (timeRemaining <= 0) {
                // Timer expired but boss hasn't spawned yet
                this.timerText.setText("BOSS INCOMING!");
                
                // Start flashing if not already
                if (!this.flashAnimation) {
                    this.startWarningFlash(true);
                }
            } else {
                // Format remaining time as MM:SS
                const minutes = Math.floor(timeRemaining / 60000);
                const seconds = Math.floor((timeRemaining % 60000) / 1000);
                const timeString = `BOSS: ${minutes}:${seconds.toString().padStart(2, '0')}`;
                this.timerText.setText(timeString);
                
                // Start warning animation when approaching boss time
                if (timeRemaining <= WARNING_THRESHOLD && !this.flashAnimation) {
                    this.startWarningFlash(false);
                }
            }
        }
    }

    private startWarningFlash(isCritical: boolean): void {
        // Determine colors based on warning level
        const baseColor = isCritical ? '#ff0000' : '#ffff00';
        const altColor = '#ffffff';
        
        // Create flashing animation
        this.flashAnimation = this.scene.tweens.add({
            targets: this.timerText,
            alpha: { from: 1, to: 0.7 },
            duration: isCritical ? 300 : 500,
            ease: 'Sine.InOut',
            yoyo: true,
            repeat: -1,
            onYoyo: () => {
                this.timerText.setColor(this.timerText.style.color === baseColor ? altColor : baseColor);
            },
            onRepeat: () => {
                this.timerText.setColor(this.timerText.style.color === baseColor ? altColor : baseColor);
            }
        });
    }

    public destroy(): void {
        // Clean up event listeners
        this.gameEvents.off(GameEvents.GAME_STATE_UPDATED, this.handleGameStateUpdated, this);
        this.gameEvents.off(GameEvents.BOSS_SPAWN_TIMER_CREATED, this.handleBossTimerCreated, this);
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);
        
        // Stop animations
        if (this.flashAnimation) {
            this.flashAnimation.stop();
        }
        
        // Destroy container and all children
        this.container.destroy();
    }
} 