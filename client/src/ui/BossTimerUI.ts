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
        
        // Set initial position at top center of camera view
        const camera = this.scene.cameras.main;
        if (camera) {
            this.container.x = camera.scrollX + camera.width / 2;
            this.container.y = camera.scrollY + 40; // Position at the top
        }
        
        // Create background for timer - wider to fit longer text
        this.timerBackground = this.scene.add.rectangle(0, 0, 300, 40, 0x000000, 0.7);
        this.timerBackground.setStrokeStyle(2, 0x444444);
        this.timerBackground.setOrigin(0.5, 0.5);
        
        // Create timer text with new message
        this.timerText = this.scene.add.text(0, 0, "End of the world in: --:--", {
            fontSize: '18px',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
            align: 'center'
        });
        this.timerText.setOrigin(0.5, 0.5);
        
        // Add elements to container (removed icon)
        this.container.add([this.timerBackground, this.timerText]);
        
        // Hide initially until we know a boss is coming
        this.container.setVisible(false);
        
        // Register event listeners
        this.registerEventListeners();
        
        // Check for existing boss spawn timer in the database
        this.checkForExistingBossTimer();
        
        console.log('BossTimerUI initialized');
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
        
        // Extract the timestamp using our helper
        const timestamp = this.extractTimestampFromTimer(timer);
        if (timestamp) {
            this.bossSpawnTime = timestamp;
            this.startTimer();
            console.log("Started boss timer from timer creation event");
        } else {
            // Hide timer if no valid timestamp was found
            this.stopTimer();
            this.container.setVisible(false);
            console.log("Could not extract valid timestamp from created timer, hiding boss timer UI");
        }
    }

    private handleMonsterCreated(ctx: any, monster: any): void {
        // If a boss monster is created, hide the timer
        if (monster.bestiaryId && monster.bestiaryId.tag) {
            const monsterType = monster.bestiaryId.tag;
            if (monsterType === 'FinalBossPhase1' || monsterType === 'FinalBossPhase2') {
                this.stopTimer();
                this.container.setVisible(false);
            } else {
                // For regular monsters, recheck the boss timer to keep it in sync
                this.checkForExistingBossTimer();
            }
        }
    }

    public startTimer(): void {
        if (!this.bossSpawnTime) {
            console.log("Cannot start timer - no valid boss spawn time");
            this.container.setVisible(false);
            return;
        }
        
        this.isTimerActive = true;
        this.container.setVisible(true);
        
        // Ensure UI is properly visible
        if (!this.container.visible) {
            console.warn("Boss timer container not visible after setVisible(true), forcing visibility");
            this.container.visible = true;
            this.container.alpha = 1;
        }
        
        // Check if the spawn time is in the past
        if (this.bossSpawnTime <= Date.now()) {
            console.log("Boss spawn time is in the past, showing IMMINENT message");
            this.timerText.setText("End of the world: IMMINENT!");
            this.startWarningFlash(true);
        }
        
        console.log(`Boss timer started. Boss will spawn at: ${new Date(this.bossSpawnTime).toLocaleTimeString()}`);
        console.log(`Timer container properties: visible=${this.container.visible}, alpha=${this.container.alpha}, x=${this.container.x}, y=${this.container.y}`);
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
                this.timerText.setText("End of the world: IMMINENT!");
                
                // Start flashing if not already
                if (!this.flashAnimation) {
                    this.startWarningFlash(true);
                }
            } else {
                // Format remaining time as MM:SS
                const minutes = Math.floor(timeRemaining / 60000);
                const seconds = Math.floor((timeRemaining % 60000) / 1000);
                const timeString = `End of the world in: ${minutes}:${seconds.toString().padStart(2, '0')}`;
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

    private checkForExistingBossTimer(): void {
        // Only if we have a connection
        if (this.spacetimeClient?.sdkConnection?.db) {
            console.log("Checking for existing boss spawn timer...");
            
            try {
                // Try to find a boss timer in the database
                const bossTimers = Array.from(this.spacetimeClient.sdkConnection.db.bossSpawnTimer.iter());
                
                console.log("Boss timers found:", bossTimers.length);
                console.log("Raw timer data:", 
                    JSON.stringify(bossTimers, (key, value) => 
                        typeof value === 'bigint' ? value.toString() + 'n' : value
                    )
                );
                
                if (bossTimers.length > 0) {
                    // Timer exists, get the first one
                    const timer = bossTimers[0];
                    console.log("Found existing boss timer:", timer);
                    
                    // Extract spawn time - we need to safely extract it from the timer object
                    if (timer) {
                        // Extract the timestamp using a more general approach
                        const timestamp = this.extractTimestampFromTimer(timer);
                        if (timestamp) {
                            this.bossSpawnTime = timestamp;
                            this.startTimer();
                            console.log("Started boss timer from existing database entry");
                        } else {
                            // Hide timer if timestamp can't be extracted
                            this.stopTimer();
                            this.container.setVisible(false);
                            console.log("Could not extract valid timestamp from timer, hiding boss timer UI");
                        }
                    }
                } else {
                    console.log("No existing boss spawn timer found, hiding timer UI");
                    // Ensure timer is hidden when no timer exists
                    this.stopTimer();
                    this.container.setVisible(false);
                }
            } catch (error) {
                console.error("Error checking for existing boss timer:", error);
                // Hide timer on error
                this.stopTimer();
                this.container.setVisible(false);
            }
        }
    }
    
    // Helper method to extract timestamp from timer object
    private extractTimestampFromTimer(timer: any): number | null {
        try {
            console.log("Extracting timestamp from timer:", JSON.stringify(timer, (key, value) => 
                typeof value === 'bigint' ? value.toString() : value
            ));
            
            // First check if we have a scheduledAt property
            if (!timer || !timer.scheduledAt) {
                console.log("Timer or scheduledAt property is missing");
                return null;
            }
            
            // Handle scheduledAt property based on its type
            const scheduledAt = timer.scheduledAt;
            
            // If scheduled_at has a microsSinceUnixEpoch property (common timestamp format)
            if (scheduledAt.microsSinceUnixEpoch !== undefined) {
                // Convert microseconds to milliseconds for JS Date
                // Handle both number and bigint cases
                const microsValue = scheduledAt.microsSinceUnixEpoch;
                if (typeof microsValue === 'bigint') {
                    // Convert bigint to number safely
                    return Number(microsValue) / 1000;
                } else if (typeof microsValue === 'number') {
                    return microsValue / 1000;
                }
            }
            
            // If it has a time_ms field
            if (scheduledAt.timeMs !== undefined) {
                return typeof scheduledAt.timeMs === 'bigint' 
                    ? Number(scheduledAt.timeMs) 
                    : scheduledAt.timeMs;
            }
            
            // If it's a structured object with tag and value
            if (typeof scheduledAt === 'object' && scheduledAt.tag && scheduledAt.value) {
                if (scheduledAt.tag === 'Time' && scheduledAt.value) {
                    const timeValue = scheduledAt.value;
                    
                    // Check for microsSinceUnixEpoch in the value
                    if (timeValue.microsSinceUnixEpoch !== undefined) {
                        const microsValue = timeValue.microsSinceUnixEpoch;
                        if (typeof microsValue === 'bigint') {
                            return Number(microsValue) / 1000;
                        } else if (typeof microsValue === 'number') {
                            return microsValue / 1000;
                        }
                    }
                    
                    // Check for timeMs in the value
                    if (timeValue.timeMs !== undefined) {
                        return typeof timeValue.timeMs === 'bigint' 
                            ? Number(timeValue.timeMs) 
                            : timeValue.timeMs;
                    }
                }
            }
            
            // Log the structure for debugging
            console.log("Could not extract timestamp - unknown timer structure");
            
            return null;
        } catch (error) {
            console.error("Error extracting timestamp:", error);
            return null;
        }
    }
} 