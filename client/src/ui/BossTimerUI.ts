import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';

// Constants
const UI_DEPTH = 100000; // Extremely high depth to ensure UI stays on top of all game elements
const BOSS_SPAWN_DELAY_MS = 5 * 60 * 1000; // 5 minutes in milliseconds, same as server
const WARNING_THRESHOLD = 60 * 1000; // Start warning animation at 1 minute remaining
const OMINOUS_SILENCE_THRESHOLD = 1; // Stop music at 10 seconds remaining for ominous effect

export default class BossTimerUI {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private container: Phaser.GameObjects.Container;
    private timerText: Phaser.GameObjects.Text;
    private timerBackground: Phaser.GameObjects.Rectangle;
    private gameEvents: Phaser.Events.EventEmitter;
    
    // Boss nameplate elements
    private bossNameContainer!: Phaser.GameObjects.Container;
    private bossNameText!: Phaser.GameObjects.Text;
    private bossNameBackground!: Phaser.GameObjects.Rectangle;
    private bossNameAnimation: Phaser.Tweens.Tween | null = null;
    
    // Timer tracking
    private bossSpawnTime: number | null = null;
    private isTimerActive: boolean = false;
    private flashAnimation: Phaser.Tweens.Tween | null = null;
    private hasSilencedMusic: boolean = false; // Track if we've already stopped music for ominous effect
    
    // Boss state tracking
    private bossActive: boolean = false;
    private currentBossType: string | null = null;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.gameEvents = (window as any).gameEvents;
        
        // Create container for UI elements
        this.container = this.scene.add.container(0, 0);
        this.container.setDepth(UI_DEPTH);
        
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
        
        // Add elements to container
        this.container.add([this.timerBackground, this.timerText]);
        
        // Create boss nameplate container (initially hidden)
        this.createBossNameplate();
        
        // Set initial position at top center of camera view
        const camera = this.scene.cameras.main;
        if (camera) {
            this.container.setPosition(
                camera.scrollX + camera.width / 2,
                camera.scrollY + 40
            );
        }
        
        // Add update callback to scene
        this.scene.events.on('update', this.update, this);
        
        // Register event listeners
        this.registerEventListeners();
        
        // Check for existing boss timer in the database
        this.checkForExistingBossTimer();
        
        // Check for existing boss monsters (for reconnection cases)
        // Add a small delay to ensure database connection is fully established
        this.scene.time.delayedCall(100, () => {
            this.checkForExistingBoss();
        });
        
        console.log('BossTimerUI initialized');
    }

    private createBossNameplate(): void {
        // Create boss nameplate container
        this.bossNameContainer = this.scene.add.container(0, 0);
        this.bossNameContainer.setDepth(UI_DEPTH + 1); // Higher than timer
        this.bossNameContainer.setVisible(false);
        
        // Create dark background for dramatic effect - smaller size
        this.bossNameBackground = this.scene.add.rectangle(0, 0, 650, 100, 0x000000, 0.8);
        this.bossNameBackground.setStrokeStyle(3, 0xaa6c39, 0.9); // Dark gold border
        this.bossNameBackground.setOrigin(0.5, 0.5);
        
        // Create boss name text with Dark Souls style
        this.bossNameText = this.scene.add.text(0, 0, "", {
            fontSize: '48px',
            fontFamily: 'serif',
            color: '#f4e4bc', // Parchment/gold color
            stroke: '#2c1810', // Dark brown stroke
            strokeThickness: 6,
            align: 'center',
            fontStyle: 'bold'
        });
        this.bossNameText.setOrigin(0.5, 0.5);
        
        // Add elements to nameplate container
        this.bossNameContainer.add([this.bossNameBackground, this.bossNameText]);
    }

    private showBossNameplate(bossName: string): void {
        // Set the boss name text
        this.bossNameText.setText(bossName);
        
        // Track boss state
        this.bossActive = true;
        this.currentBossType = bossName.includes("Scion") ? "phase1" : "phase2";
        
        // Position closer to top of screen
        const camera = this.scene.cameras.main;
        if (camera) {
            this.bossNameContainer.setPosition(
                camera.scrollX + camera.width / 2,
                camera.scrollY + 60 // Much closer to top
            );
        }
        
        // Stop any existing animation
        if (this.bossNameAnimation) {
            this.bossNameAnimation.stop();
        }
        
        // Set initial state for animation
        this.bossNameContainer.setVisible(true);
        this.bossNameContainer.setAlpha(0);
        this.bossNameContainer.setScale(0.5);
        this.bossNameContainer.y -= 30; // Start slightly higher
        
        // Create dramatic entrance animation - full opacity
        this.bossNameAnimation = this.scene.tweens.add({
            targets: this.bossNameContainer,
            alpha: { from: 0, to: 1 }, // Full opacity during entrance
            scaleX: { from: 0.5, to: 1 },
            scaleY: { from: 0.5, to: 1 },
            y: this.bossNameContainer.y + 30, // Move to final position
            duration: 2000,
            ease: 'Power3.easeOut'
            // Nameplate stays at full opacity (no fade to semi-transparent)
        });
        
        // Add subtle pulsing glow effect
        this.scene.tweens.add({
            targets: this.bossNameBackground,
            alpha: { from: 0.8, to: 0.6 },
            duration: 1500,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: 2
        });
        
        console.log(`Boss nameplate shown: ${bossName}`);
    }

    private hideBossNameplate(): void {
        if (this.bossNameAnimation) {
            this.bossNameAnimation.stop();
        }
        
        // Reset boss state
        this.bossActive = false;
        this.currentBossType = null;
        
        // Fade out animation
        this.bossNameAnimation = this.scene.tweens.add({
            targets: this.bossNameContainer,
            alpha: { from: this.bossNameContainer.alpha, to: 0 },
            duration: 1500,
            ease: 'Power2.easeIn',
            onComplete: () => {
                this.bossNameContainer.setVisible(false);
            }
        });
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
        // If boss becomes active, hide the timer and stop music immediately
        if (!oldState.bossActive && newState.bossActive) {
            this.stopTimer();
            this.container.setVisible(false);
            
            // Stop music immediately when boss becomes active for ominous silence
            console.log("Boss active state detected! Stopping background music for ominous silence before boss spawn");
            const gameScene = this.scene.scene.get('GameScene') as any;
            if (gameScene && gameScene.musicManager) {
                gameScene.musicManager.stopCurrentTrack();
            }
        }
        
        // If boss becomes inactive and was previously active, hide nameplate and prepare for new timer
        if (oldState.bossActive && !newState.bossActive) {
            // Boss fight ended, hide nameplate
            if (this.bossActive) {
                this.hideBossNameplate();
            }
            this.bossSpawnTime = null;
        }
    }

    private handleBossTimerCreated(ctx: any, timer: any): void {
        // Extract the timestamp using our helper
        const timestamp = this.extractTimestampFromTimer(timer);
        if (timestamp) {
            this.bossSpawnTime = timestamp;
            this.startTimer();
            console.log("Boss timer started");
        } else {
            // Fallback: Try direct access to value if it exists
            if (timer?.scheduledAt?.value) {
                const directValue = timer.scheduledAt.value;
                if (typeof directValue === 'bigint' || !isNaN(Number(directValue))) {
                    const directTimestamp = Number(directValue) / 1000;
                    this.bossSpawnTime = directTimestamp;
                    this.startTimer();
                    return;
                }
            }
            
            // Hide timer if no valid timestamp was found
            this.stopTimer();
            this.container.setVisible(false);
            console.warn("Could not extract valid timestamp from created timer");
        }
    }

    private handleMonsterCreated(ctx: any, monster: any): void {
        // If a boss monster is created, hide the timer and show nameplate
        if (monster.bestiaryId && monster.bestiaryId.tag) {
            const monsterType = monster.bestiaryId.tag;
            if (monsterType === 'FinalBossPhase1') {
                this.stopTimer();
                this.container.setVisible(false);
                this.showBossNameplate("Ender, Scion of Ruin");
            } else if (monsterType === 'FinalBossPhase2') {
                // Hide any existing nameplate first
                this.hideBossNameplate();
                // Small delay before showing new nameplate for dramatic effect
                this.scene.time.delayedCall(1000, () => {
                    this.showBossNameplate("Ender, Host of Oblivion");
                });
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
        this.hasSilencedMusic = false; // Reset silence flag for new timer
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
        // Update position to follow camera
        const camera = this.scene.cameras.main;
        if (camera) {
            this.container.setPosition(
                camera.scrollX + camera.width / 2,
                camera.scrollY + 40 // Fixed distance from top of screen
            );
            
            // Update boss nameplate position as well - closer to top
            if (this.bossNameContainer.visible) {
                this.bossNameContainer.setPosition(
                    camera.scrollX + camera.width / 2,
                    camera.scrollY + 60 // Much closer to top
                );
            }
        }
        
        // Update timer text if game state exists
        if (this.spacetimeClient.sdkConnection?.db) {
            const gameState = this.spacetimeClient.sdkConnection.db.gameState.id.find(0);
            if (gameState) {
                // Show timer if we have a boss spawn timer
                const bossTimers = Array.from(this.spacetimeClient.sdkConnection.db.bossSpawnTimer.iter());
                if (bossTimers.length > 0 && !gameState.bossActive) {
                    // Force visibility and check container properties
                    this.container.setVisible(true);
                    this.container.setAlpha(1);
                    
                    // Get current time and calculate remaining time
                    const now = Date.now();
                    const timestamp = this.extractTimestampFromTimer(bossTimers[0]);
                    if (timestamp) {
                        const timeRemaining = Math.max(0, (timestamp - now) / 1000); // Convert to seconds
                        const minutes = Math.floor(timeRemaining / 60);
                        const seconds = Math.floor(timeRemaining % 60);
                        
                        if (timeRemaining > 0) {
                            this.timerText.setText(`End of the world in: ${minutes}:${seconds.toString().padStart(2, '0')}`);
                            
                            // Stop background music at 10 seconds for ominous silence before boss spawn
                            if (timeRemaining <= OMINOUS_SILENCE_THRESHOLD && !this.hasSilencedMusic) {
                                console.log("Boss timer: Stopping background music for ominous silence before boss spawn");
                                const gameScene = this.scene.scene.get('GameScene') as any;
                                if (gameScene && gameScene.musicManager) {
                                    gameScene.musicManager.stopCurrentTrack();
                                }
                                this.hasSilencedMusic = true;
                            }
                            
                            // Start warning flash if time is running low
                            if (timeRemaining <= 60 && !this.flashAnimation) {
                                this.startWarningFlash(timeRemaining <= 10);
                            }
                        } else {
                            this.timerText.setText("End of the world: IMMINENT!");
                            
                            // Ensure music is stopped when timer reaches 0
                            if (!this.hasSilencedMusic) {
                                console.log("Boss timer: Timer reached 0, ensuring music is stopped");
                                const gameScene = this.scene.scene.get('GameScene') as any;
                                if (gameScene && gameScene.musicManager) {
                                    gameScene.musicManager.stopCurrentTrack();
                                }
                                this.hasSilencedMusic = true;
                            }
                            
                            if (!this.flashAnimation) {
                                this.startWarningFlash(true);
                            }
                        }
                    }
                } else {
                    this.container.setVisible(false);
                    if (this.flashAnimation) {
                        this.flashAnimation.stop();
                        this.flashAnimation = null;
                    }
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
        // Remove update callback
        this.scene.events.off('update', this.update, this);
        
        // Clean up event listeners
        this.gameEvents.off(GameEvents.GAME_STATE_UPDATED, this.handleGameStateUpdated, this);
        this.gameEvents.off(GameEvents.BOSS_SPAWN_TIMER_CREATED, this.handleBossTimerCreated, this);
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.handleMonsterCreated, this);
        
        // Stop animations
        if (this.flashAnimation) {
            this.flashAnimation.stop();
        }
        if (this.bossNameAnimation) {
            this.bossNameAnimation.stop();
        }
        
        // Destroy containers and all children
        this.container.destroy();
        this.bossNameContainer.destroy();
    }

    private checkForExistingBossTimer(): void {
        // Only if we have a connection
        if (this.spacetimeClient?.sdkConnection?.db) {
            try {
                // Try to find a boss timer in the database
                const bossTimers = Array.from(this.spacetimeClient.sdkConnection.db.bossSpawnTimer.iter());
                
                if (bossTimers.length > 0) {
                    // Timer exists, get the first one
                    const timer = bossTimers[0];
                    
                    // Extract spawn time
                    if (timer) {
                        const timestamp = this.extractTimestampFromTimer(timer);
                        if (timestamp) {
                            this.bossSpawnTime = timestamp;
                            this.startTimer();
                        } else {
                            // Fallback: Try direct access to value if it exists
                            if (timer?.scheduledAt?.value) {
                                const directValue = timer.scheduledAt.value;
                                if (typeof directValue === 'bigint' || !isNaN(Number(directValue))) {
                                    const directTimestamp = Number(directValue) / 1000;
                                    this.bossSpawnTime = directTimestamp;
                                    this.startTimer();
                                    return;
                                }
                            }
                            
                            // Hide timer if timestamp can't be extracted
                            this.stopTimer();
                            this.container.setVisible(false);
                        }
                    }
                } else {
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
            // First check if we have a scheduledAt property
            if (!timer || !timer.scheduledAt) {
                return null;
            }
            
            // Handle scheduledAt property based on its type
            const scheduledAt = timer.scheduledAt;
            
            // If scheduled_at has a microsSinceUnixEpoch property (common timestamp format)
            if (scheduledAt.microsSinceUnixEpoch !== undefined) {
                // Convert microseconds to milliseconds for JS Date
                const microsValue = scheduledAt.microsSinceUnixEpoch;
                if (typeof microsValue === 'bigint') {
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
                if (scheduledAt.tag === 'Time') {
                    const timeValue = scheduledAt.value;
                    
                    // Direct BigInt handling
                    if (typeof timeValue === 'bigint') {
                        return Number(timeValue) / 1000;
                    }
                    
                    // Handle case where value is a string (could be with or without 'n')
                    if (typeof timeValue === 'string') {
                        // Check if it's a BigInt string (ends with 'n')
                        if (timeValue.endsWith('n')) {
                            // Remove the 'n' suffix and convert to number
                            const valueWithoutN = timeValue.slice(0, -1);
                            // This is microseconds since epoch, convert to ms
                            return Number(valueWithoutN) / 1000;
                        } else {
                            // It's a regular string number, convert directly
                            return Number(timeValue) / 1000;
                        }
                    }
                    
                    // Check for microsSinceUnixEpoch in the value
                    if (timeValue && typeof timeValue === 'object' && timeValue.microsSinceUnixEpoch !== undefined) {
                        const microsValue = timeValue.microsSinceUnixEpoch;
                        if (typeof microsValue === 'bigint') {
                            return Number(microsValue) / 1000;
                        } else if (typeof microsValue === 'number') {
                            return microsValue / 1000;
                        }
                    }
                    
                    // Check for timeMs in the value
                    if (timeValue && typeof timeValue === 'object' && timeValue.timeMs !== undefined) {
                        return typeof timeValue.timeMs === 'bigint' 
                            ? Number(timeValue.timeMs) 
                            : timeValue.timeMs;
                    }

                    // Try direct conversion as a fallback
                    if (timeValue) {
                        const timestamp = Number(timeValue);
                        if (!isNaN(timestamp) && timestamp > 0) {
                            return timestamp / 1000; // Convert microseconds to milliseconds
                        }
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error("Error extracting timestamp:", error);
            return null;
        }
    }

    private checkForExistingBoss(): void {
        // Check if there are any existing boss monsters when connecting
        if (!this.spacetimeClient?.sdkConnection?.db) {
            console.log("Database not ready yet, retrying boss check in 500ms...");
            // Retry after a longer delay if database isn't ready
            this.scene.time.delayedCall(500, () => {
                this.checkForExistingBoss();
            });
            return;
        }
        
        console.log("Checking for existing boss monsters on reconnect...");
        
        // Look for any existing boss monsters
        for (const monster of this.spacetimeClient.sdkConnection.db.monsters.iter()) {
            if (monster.bestiaryId && monster.bestiaryId.tag) {
                const monsterType = monster.bestiaryId.tag;
                if (monsterType === 'FinalBossPhase1') {
                    console.log("Found existing boss phase 1 on reconnect - showing nameplate, starting boss music and haze");
                    this.stopTimer();
                    this.container.setVisible(false);
                    this.showBossNameplate("Ender, Scion of Ruin");
                    
                    // Trigger boss music and haze for reconnection
                    this.triggerBossEffectsOnReconnect();
                    return; // Only show one boss nameplate
                } else if (monsterType === 'FinalBossPhase2') {
                    console.log("Found existing boss phase 2 on reconnect - showing nameplate, starting boss music and haze");
                    this.stopTimer();
                    this.container.setVisible(false);
                    this.showBossNameplate("Ender, Host of Oblivion");
                    
                    // Trigger boss music and haze for reconnection
                    this.triggerBossEffectsOnReconnect();
                    return; // Only show one boss nameplate
                }
            }
        }
        
        console.log("No existing boss monsters found on reconnect");
    }
    
    // Helper method to trigger boss music and haze effects when reconnecting
    private triggerBossEffectsOnReconnect(): void {
        console.log("Triggering boss music and haze effects on reconnect");
        
        // Get reference to GameScene to trigger boss effects
        const gameScene = this.scene as any;
        
        // Start boss music only if not already playing boss music
        if (gameScene.musicManager) {
            const currentTrack = gameScene.musicManager.getCurrentTrack();
            if (currentTrack.key !== 'boss') {
                console.log("Starting boss music on reconnect (current track: " + currentTrack.key + ")");
                gameScene.musicManager.playTrack('boss');
            } else {
                console.log("Boss music already playing, skipping music change");
            }
        }
        
        // Show boss haze (this is safe to call multiple times)
        if (gameScene.showBossHaze) {
            console.log("Showing boss haze on reconnect");
            gameScene.showBossHaze();
        }
    }
} 