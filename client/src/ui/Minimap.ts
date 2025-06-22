import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import SoulUI from './SoulUI';

// Constants for minimap sizing and positioning
const MINIMAP_SIZE = 150; // Size of the minimap (square)
const MINIMAP_MARGIN = 20; // Margin from screen edges
const MINIMAP_ALPHA = 0.7; // Semi-transparency
const PLAYER_DOT_SIZE = 5; // Size of player dot on minimap
const BORDER_SIZE = 2; // Width of minimap border
const UI_DEPTH = 100000; // High depth to ensure UI stays on top

export interface MinimapElements {
    container: Phaser.GameObjects.Container;
    background: Phaser.GameObjects.Rectangle;
    playerDot: Phaser.GameObjects.Arc;
    border: Phaser.GameObjects.Rectangle;
    botDotsContainer: Phaser.GameObjects.Container;
}

export default class Minimap {
    private scene: Phaser.Scene;
    private spacetimeDBClient: SpacetimeDBClient;
    private soulUI: SoulUI | null;
    private minimapElements: MinimapElements | null = null;

    constructor(scene: Phaser.Scene, spacetimeDBClient: SpacetimeDBClient, soulUI: SoulUI | null = null) {
        this.scene = scene;
        this.spacetimeDBClient = spacetimeDBClient;
        this.soulUI = soulUI;
        
        console.log("Minimap initialized");
    }

    /**
     * Set the SoulUI reference after it's been created
     */
    public setSoulUI(soulUI: SoulUI): void {
        this.soulUI = soulUI;
    }

    /**
     * Create the minimap UI elements
     */
    public create(): MinimapElements {
        const { width, height } = this.scene.scale;
        
        // Create minimap container at the bottom-left corner
        const container = this.scene.add.container(
            MINIMAP_MARGIN,
            height - MINIMAP_MARGIN - MINIMAP_SIZE
        );
        
        // Create semi-transparent dark background
        const background = this.scene.add.rectangle(
            0, 
            0, 
            MINIMAP_SIZE, 
            MINIMAP_SIZE, 
            0x000000, 
            0.5
        ).setOrigin(0);
        
        // Create border
        const border = this.scene.add.rectangle(
            0,
            0,
            MINIMAP_SIZE,
            MINIMAP_SIZE,
            0xFFFFFF,
            0.3
        ).setOrigin(0);
        border.setStrokeStyle(BORDER_SIZE, 0xFFFFFF, 0.5);
        
        // Create player dot (will be positioned in update)
        const playerDot = this.scene.add.circle(
            0,
            0,
            PLAYER_DOT_SIZE,
            0xFFFFFF,
            1
        );

        // Create container for bot dots and other indicators
        const botDotsContainer = this.scene.add.container(0, 0);
        
        // Add all elements to container
        container.add([background, border, playerDot, botDotsContainer]);
        
        // Fix to camera so it doesn't move with world
        container.setScrollFactor(0);
        
        // Set high depth to ensure minimap stays on top of monsters and other game elements
        container.setDepth(UI_DEPTH);
        
        // Set initial alpha
        container.setAlpha(MINIMAP_ALPHA);
        
        // Store reference to minimap elements
        this.minimapElements = {
            container,
            background,
            playerDot,
            border,
            botDotsContainer
        };
        
        console.log("Minimap created with depth:", UI_DEPTH);
        return this.minimapElements;
    }

    /**
     * Update the minimap with current game state
     */
    public update(
        localPlayerSprite: Phaser.Physics.Arcade.Sprite | null,
        worldBounds: Phaser.Geom.Rectangle
    ): void {
        if (!this.minimapElements || !localPlayerSprite || !this.spacetimeDBClient.sdkConnection?.db) return;
        
        const minimapSize = this.minimapElements.background.width;
        
        // Calculate position ratio (player position relative to world size)
        const ratioX = localPlayerSprite.x / worldBounds.width;
        const ratioY = localPlayerSprite.y / worldBounds.height;
        
        // Position player dot on minimap based on world position
        this.minimapElements.playerDot.x = ratioX * minimapSize;
        this.minimapElements.playerDot.y = ratioY * minimapSize;

        // Clear existing indicators
        this.minimapElements.botDotsContainer.removeAll(true);

        // Add player indicators
        this.addPlayerIndicators(localPlayerSprite, worldBounds, minimapSize);
        
        // Add monster indicators
        this.addMonsterIndicators(worldBounds, minimapSize);
        
        // Add soul indicator
        this.addSoulIndicator(worldBounds, minimapSize);
    }

    /**
     * Add player dots to the minimap
     */
    private addPlayerIndicators(
        localPlayerSprite: Phaser.Physics.Arcade.Sprite,
        worldBounds: Phaser.Geom.Rectangle,
        minimapSize: number
    ): void {
        if (!this.minimapElements || !this.spacetimeDBClient.sdkConnection?.db) return;

        // Get local player info for distance calculations
        const localAccount = this.spacetimeDBClient.identity ? 
            this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity) : null;
        const localPlayerId = localAccount?.currentPlayerId || 0;
        const localPlayerPosition = { x: localPlayerSprite.x, y: localPlayerSprite.y };

        // Add dots for all players (bots and other human players)
        for (const player of this.spacetimeDBClient.sdkConnection.db.player.iter()) {
            // Skip the local player
            if (player.playerId === localPlayerId) {
                continue;
            }

            const playerRatioX = player.position.x / worldBounds.width;
            const playerRatioY = player.position.y / worldBounds.height;
            
            let playerDot: Phaser.GameObjects.Arc | null = null;
            
            if (player.isBot) {
                // Bot players show as purple dots (existing behavior)
                playerDot = this.scene.add.circle(
                    playerRatioX * minimapSize,
                    playerRatioY * minimapSize,
                    PLAYER_DOT_SIZE,
                    0x800080, // Purple color for bots
                    1
                );
            } else {
                // Human players - different logic based on PvP status
                if (!player.pvp) {
                    // Non-PvP players show as green dots (always visible)
                    playerDot = this.scene.add.circle(
                        playerRatioX * minimapSize,
                        playerRatioY * minimapSize,
                        PLAYER_DOT_SIZE,
                        0x00ff00, // Green color for non-PvP players
                        1
                    );
                } else {
                    // PvP players show as red dots only if within 900 units
                    const distance = Phaser.Math.Distance.Between(
                        localPlayerPosition.x, localPlayerPosition.y,
                        player.position.x, player.position.y
                    );
                    
                    if (distance <= 900) {
                        playerDot = this.scene.add.circle(
                            playerRatioX * minimapSize,
                            playerRatioY * minimapSize,
                            PLAYER_DOT_SIZE,
                            0xff0000, // Red color for PvP players
                            1
                        );
                        
                        // Add subtle pulsing effect for PvP players to make them more noticeable
                        this.scene.tweens.add({
                            targets: playerDot,
                            alpha: { from: 1, to: 0.6 },
                            duration: 800,
                            ease: 'Sine.easeInOut',
                            yoyo: true,
                            repeat: -1
                        });
                    }
                }
            }
            
            if (playerDot) {
                this.minimapElements.botDotsContainer.add(playerDot);
            }
        }
    }

    /**
     * Add monster indicators to the minimap
     */
    private addMonsterIndicators(worldBounds: Phaser.Geom.Rectangle, minimapSize: number): void {
        if (!this.minimapElements || !this.spacetimeDBClient.sdkConnection?.db) return;

        // Add boss monsters as red dots and VoidChests as purple boxes
        for (const monster of this.spacetimeDBClient.sdkConnection.db.monsters.iter()) {
            const monsterType = monster.bestiaryId?.tag || monster.bestiaryId;
            
            if (this.isBoss(monsterType)) {
                // Get monster position from boid data
                const boid = this.spacetimeDBClient.sdkConnection.db.monstersBoid.monsterId.find(monster.monsterId);
                if (boid) {
                    const bossRatioX = boid.position.x / worldBounds.width;
                    const bossRatioY = boid.position.y / worldBounds.height;
                    
                    const bossDot = this.scene.add.circle(
                        bossRatioX * minimapSize,
                        bossRatioY * minimapSize,
                        8, // Larger than other dots
                        0xff0000, // Red color for boss
                        1
                    );
                    
                    // Add pulsing effect for boss
                    this.scene.tweens.add({
                        targets: bossDot,
                        alpha: { from: 1, to: 0.5 },
                        duration: 1000,
                        ease: 'Sine.easeInOut',
                        yoyo: true,
                        repeat: -1
                    });
                    
                    this.minimapElements.botDotsContainer.add(bossDot);
                }
            } else if (monsterType === 'VoidChest') {
                // Add VoidChests as purple boxes
                const boid = this.spacetimeDBClient.sdkConnection.db.monstersBoid.monsterId.find(monster.monsterId);
                if (boid) {
                    const chestRatioX = boid.position.x / worldBounds.width;
                    const chestRatioY = boid.position.y / worldBounds.height;
                    
                    const chestBox = this.scene.add.rectangle(
                        chestRatioX * minimapSize,
                        chestRatioY * minimapSize,
                        10, // Width of the box
                        10, // Height of the box
                        0x800080, // Purple color for VoidChest
                        1
                    );
                    
                    // Add subtle pulsing effect for VoidChest
                    this.scene.tweens.add({
                        targets: chestBox,
                        alpha: { from: 1, to: 0.7 },
                        duration: 1500,
                        ease: 'Sine.easeInOut',
                        yoyo: true,
                        repeat: -1
                    });
                    
                    this.minimapElements.botDotsContainer.add(chestBox);
                }
            }
        }
    }

    /**
     * Add soul indicator to the minimap
     */
    private addSoulIndicator(worldBounds: Phaser.Geom.Rectangle, minimapSize: number): void {
        if (!this.minimapElements) return;

        const soulDot = this.soulUI?.createMinimapSoulIndicator(
            this.spacetimeDBClient.sdkConnection,
            this.spacetimeDBClient.identity,
            worldBounds,
            minimapSize
        );
        
        if (soulDot) {
            this.minimapElements.botDotsContainer.add(soulDot);
        }
    }

    /**
     * Get the minimap elements (for GameScene compatibility)
     */
    public getElements(): MinimapElements | null {
        return this.minimapElements;
    }

    /**
     * Clean up when scene shuts down
     */
    public destroy(): void {
        console.log("Minimap destroying");
        
        if (this.minimapElements) {
            this.minimapElements.container.destroy();
            this.minimapElements = null;
        }
        
        console.log("Minimap destroyed");
    }

    // Helper functions for boss type checking
    private isBoss(monsterType: string): boolean {
        return monsterType === 'BossEnderPhase1' || monsterType === 'BossEnderPhase2' ||
               monsterType === 'BossAgnaPhase1' || monsterType === 'BossAgnaPhase2';
    }
} 