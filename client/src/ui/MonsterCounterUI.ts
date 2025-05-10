import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { Monsters } from '../autobindings';
import { GameEvents } from '../constants/GameEvents';

const TICK_AVG_WINDOW = 20; // Number of intervals to average
const WINDOW_WIDTH = 180; // Increased width for tick data

export default class MonsterCounterUI {
    private container: Phaser.GameObjects.Container;
    private text: Phaser.GameObjects.Text;
    private tickText: Phaser.GameObjects.Text;
    private scene: Phaser.Scene;
    private gameEvents: Phaser.Events.EventEmitter;

    // For tick interval tracking
    private lastTickCount: number | null = null;
    private lastTickTimestamp: number | null = null;
    private tickIntervals: number[] = [];

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.gameEvents = (window as any).gameEvents;
        
        // Create container in top-left corner
        this.container = scene.add.container(20, 20);
        this.container.setScrollFactor(0); // Make UI fixed to camera
        this.container.setDepth(10000); // Ensure it's above most game elements
        
        // Add background
        const bg = scene.add.rectangle(0, 0, WINDOW_WIDTH, 60, 0x000000, 0.7); // Increased width
        bg.setStrokeStyle(2, 0xffffff);
        bg.setScrollFactor(0);
        
        // Add monster icon
        const monsterIcon = scene.add.text(-60, -10, '👾', { fontSize: '24px' });
        monsterIcon.setOrigin(0.5);
        monsterIcon.setScrollFactor(0);
        
        // Add monster count text
        this.text = scene.add.text(-10, -10, '0', { 
            fontSize: '24px',
            color: '#ffffff'
        });
        this.text.setOrigin(0, 0.5);
        this.text.setScrollFactor(0);
        
        // Add tick interval text below
        this.tickText = scene.add.text(-30, 18, 'Avg Tick: -- ms', {
            fontSize: '16px',
            color: '#cccccc'
        });
        this.tickText.setOrigin(0, 0.5);
        this.tickText.setScrollFactor(0);
        
        // Add elements to container
        this.container.add([bg, monsterIcon, this.text, this.tickText]);
        
        // Subscribe to monster events
        this.gameEvents.on(GameEvents.MONSTER_CREATED, this.updateCounter, this);
        this.gameEvents.on(GameEvents.MONSTER_UPDATED, this.updateCounter, this);
        this.gameEvents.on(GameEvents.MONSTER_DELETED, this.updateCounter, this);
        
        // Subscribe to world updates for tick tracking
        this.subscribeToWorldTick();
        
        // Initial update
        this.updateCounter();
    }
    
    private updateCounter() {
        const spacetimeDBClient = (window as any).spacetimeDBClient as SpacetimeDBClient;
        if (!spacetimeDBClient?.sdkConnection?.db) return;
        
        const monsterCount = spacetimeDBClient.sdkConnection.db.monsters.count();
        this.text.setText(monsterCount.toString());
    }

    private subscribeToWorldTick() {
        const spacetimeDBClient = (window as any).spacetimeDBClient as SpacetimeDBClient;
        if (!spacetimeDBClient?.sdkConnection?.db?.world) return;
        // Listen for world updates
        spacetimeDBClient.sdkConnection.db.world.onUpdate((ctx: any, oldWorld: any, newWorld: any) => {
            if (!oldWorld || !newWorld) return;
            if (this.lastTickCount !== null && newWorld.tickCount !== this.lastTickCount) {
                const now = performance.now();
                if (this.lastTickTimestamp !== null) {
                    const interval = now - this.lastTickTimestamp;
                    this.tickIntervals.push(interval);
                    if (this.tickIntervals.length > TICK_AVG_WINDOW) {
                        this.tickIntervals.shift();
                    }
                    const avg = this.tickIntervals.reduce((a, b) => a + b, 0) / this.tickIntervals.length;
                    this.tickText.setText(`Avg Tick: ${avg.toFixed(1)} ms`);
                }
                this.lastTickTimestamp = now;
            }
            this.lastTickCount = newWorld.tickCount;
        });
    }

    public toggleVisible() {
        this.container.setVisible(!this.container.visible);
    }
    
    public destroy() {
        // Remove event listeners
        this.gameEvents.off(GameEvents.MONSTER_CREATED, this.updateCounter, this);
        this.gameEvents.off(GameEvents.MONSTER_UPDATED, this.updateCounter, this);
        this.gameEvents.off(GameEvents.MONSTER_DELETED, this.updateCounter, this);
        // Note: world.onUpdate does not have an off method, so this is a leak if the scene is recreated often
        this.container.destroy();
    }
} 