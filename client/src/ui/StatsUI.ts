import Phaser from 'phaser';

// Interface for upgrade data
interface UpgradeData {
    id: string;
    name: string;
    level: number;
    maxLevel?: number;
    icon?: string;
    description?: string;
}

// Interface for player stats
interface PlayerStats {
    health: number;
    maxHealth: number;
    damage: number;
    speed: number;
    attackSpeed: number;
    defense: number;
    critChance?: number;
    critDamage?: number;
}

// Configuration for panel positioning
export enum PanelPosition {
    BELOW_OPTIONS = 'below_options',
    TOP_RIGHT = 'top_right',
    BOTTOM_RIGHT = 'bottom_right'
}

export default class StatsUpgradesUI {
    protected scene: Phaser.Scene;
    protected container!: Phaser.GameObjects.Container;
    protected isVisible: boolean = true;
    protected position: PanelPosition;
    protected upgrades: UpgradeData[] = [];
    protected stats: PlayerStats | null = null;
    protected spacetimeDBClient: any;
    
    // UI Elements
    protected upgradesContainer!: Phaser.GameObjects.Container;
    protected statsContainer!: Phaser.GameObjects.Container;
    protected toggleButton!: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, position: PanelPosition = PanelPosition.TOP_RIGHT) {
        this.scene = scene;
        this.position = position;
        
        // Get reference to SpacetimeDB client (same pattern as other scenes)
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        
        this.createUI();
        
        // Listen for player updates to keep stats/upgrades in sync
        this.setupDatabaseListeners();
        
        // Initialize data from current player data
        this.updateDataFromDatabase();
    }

    protected createUI(): void {
        // Calculate position based on configuration
        const pos = this.calculatePosition();
        
        // Create main container
        this.container = this.scene.add.container(pos.x, pos.y);
        this.container.setScrollFactor(0);
        this.container.setDepth(99998); // Just below options menu
        
        // Create background
        const bg = this.scene.add.rectangle(0, 0, 280, 320, 0x000000, 0.8);
        bg.setStrokeStyle(2, 0x4a90e2, 0.8);
        bg.setOrigin(0, 0);
        bg.setScrollFactor(0);
        
        // Create title
        const title = this.scene.add.text(10, 10, 'Player Stats', {
            fontSize: '18px',
            color: '#4a90e2',
            fontStyle: 'bold'
        });
        title.setScrollFactor(0);
        
        // Create toggle button
        this.createToggleButton();
        
        // Create stats section
        this.createStatsSection();
        
        // Create upgrades section
        this.createUpgradesSection();
        
        // Add to container
        this.container.add([bg, title]);
    }

    protected calculatePosition(): { x: number, y: number } {
        const gameWidth = this.scene.scale.width;
        const gameHeight = this.scene.scale.height;
        
        switch (this.position) {
            case PanelPosition.BELOW_OPTIONS:
                return { x: 20, y: 220 }; // Below options panel
            case PanelPosition.TOP_RIGHT:
                return { x: gameWidth - 300, y: 20 };
            case PanelPosition.BOTTOM_RIGHT:
                return { x: gameWidth - 300, y: gameHeight - 340 };
            default:
                return { x: gameWidth - 300, y: 20 };
        }
    }

    protected createToggleButton(): void {
        this.toggleButton = this.scene.add.text(250, 10, '−', {
            fontSize: '20px',
            color: '#ffffff',
            fontStyle: 'bold',
            backgroundColor: '#666666',
            padding: { x: 8, y: 4 }
        });
        this.toggleButton.setOrigin(0.5);
        this.toggleButton.setScrollFactor(0);
        this.toggleButton.setInteractive({ useHandCursor: true });
        
        this.toggleButton.on('pointerover', () => {
            this.toggleButton.setBackgroundColor('#888888');
        });
        
        this.toggleButton.on('pointerout', () => {
            this.toggleButton.setBackgroundColor('#666666');
        });
        
        this.toggleButton.on('pointerdown', () => {
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
            this.toggle();
        });
        
        this.container.add(this.toggleButton);
    }

    protected createStatsSection(): void {
        // Stats title
        const statsTitle = this.scene.add.text(10, 45, 'Stats:', {
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold'
        });
        statsTitle.setScrollFactor(0);
        
        // Stats container for dynamic content
        this.statsContainer = this.scene.add.container(10, 70);
        this.statsContainer.setScrollFactor(0);
        
        this.container.add([statsTitle, this.statsContainer]);
        this.updateStatsDisplay();
    }

    protected createUpgradesSection(): void {
        // Upgrades title
        const upgradesTitle = this.scene.add.text(10, 170, 'Upgrades:', {
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold'
        });
        upgradesTitle.setScrollFactor(0);
        
        // Upgrades container for dynamic content
        this.upgradesContainer = this.scene.add.container(10, 195);
        this.upgradesContainer.setScrollFactor(0);
        
        this.container.add([upgradesTitle, this.upgradesContainer]);
        this.updateUpgradesDisplay();
    }

    protected updateStatsDisplay(): void {
        // Clear existing stats display
        this.statsContainer.removeAll(true);
        
        if (!this.stats) {
            const noStats = this.scene.add.text(0, 0, 'No stats available', {
                fontSize: '14px',
                color: '#888888'
            });
            noStats.setScrollFactor(0);
            this.statsContainer.add(noStats);
            return;
        }
        
        const statLines = [
            `Health: ${this.stats.health}/${this.stats.maxHealth}`,
            `Damage: ${this.stats.damage}`,
            `Speed: ${this.stats.speed.toFixed(1)}`,
            `Attack Speed: ${this.stats.attackSpeed.toFixed(1)}`,
            `Defense: ${this.stats.defense}`
        ];
        
        // Add optional stats if they exist
        if (this.stats.critChance !== undefined) {
            statLines.push(`Crit Chance: ${(this.stats.critChance * 100).toFixed(1)}%`);
        }
        if (this.stats.critDamage !== undefined) {
            statLines.push(`Crit Damage: ${(this.stats.critDamage * 100).toFixed(1)}%`);
        }
        
        statLines.forEach((line, index) => {
            const statText = this.scene.add.text(0, index * 16, line, {
                fontSize: '13px',
                color: '#ffffff'
            });
            statText.setScrollFactor(0);
            this.statsContainer.add(statText);
        });
    }

    protected updateUpgradesDisplay(): void {
        // Clear existing upgrades display
        this.upgradesContainer.removeAll(true);
        
        if (this.upgrades.length === 0) {
            const noUpgrades = this.scene.add.text(0, 0, 'No upgrades chosen', {
                fontSize: '14px',
                color: '#888888'
            });
            noUpgrades.setScrollFactor(0);
            this.upgradesContainer.add(noUpgrades);
            return;
        }
        
        this.upgrades.forEach((upgrade, index) => {
            const y = index * 20;
            
            // Create upgrade icon (if available)
            if (upgrade.icon) {
                const icon = this.scene.add.image(0, y + 8, upgrade.icon);
                icon.setScale(0.3);
                icon.setScrollFactor(0);
                this.upgradesContainer.add(icon);
            }
            
            // Create upgrade text
            const levelText = upgrade.maxLevel ? `${upgrade.level}/${upgrade.maxLevel}` : `${upgrade.level}`;
            const upgradeText = this.scene.add.text(upgrade.icon ? 25 : 0, y, 
                `${upgrade.name} (${levelText})`, {
                fontSize: '13px',
                color: '#ffffff'
            });
            upgradeText.setScrollFactor(0);
            
            // Add hover tooltip for description
            if (upgrade.description) {
                upgradeText.setInteractive();
                upgradeText.on('pointerover', () => {
                    this.showTooltip(upgrade.description!, upgradeText.x, upgradeText.y);
                });
                upgradeText.on('pointerout', () => {
                    this.hideTooltip();
                });
            }
            
            this.upgradesContainer.add(upgradeText);
        });
    }

    protected showTooltip(text: string, x: number, y: number): void {
        // Simple tooltip implementation
        const tooltip = this.scene.add.text(x + 200, y, text, {
            fontSize: '12px',
            color: '#ffffff',
            backgroundColor: '#333333',
            padding: { x: 8, y: 4 },
            wordWrap: { width: 150 }
        });
        tooltip.setScrollFactor(0);
        tooltip.setDepth(100000);
        tooltip.setName('tooltip');
        this.container.add(tooltip);
    }

    protected hideTooltip(): void {
        const tooltip = this.container.getByName('tooltip');
        if (tooltip) {
            tooltip.destroy();
        }
    }

    protected setupDatabaseListeners(): void {
        // Listen for player stats updates
        if (this.spacetimeDBClient) {
            // Example listeners - adjust based on your actual SpacetimeDB structure
            this.spacetimeDBClient.on('player_stats_updated', (data: any) => {
                this.updateStats(data);
            });
            
            this.spacetimeDBClient.on('player_upgrades_updated', (data: any) => {
                this.updateUpgrades(data);
            });
            
            // Listen for any player data changes
            this.spacetimeDBClient.on('player_data_changed', () => {
                this.updateDataFromDatabase();
            });
        }
    }

    protected updateDataFromDatabase(): void {
        if (!this.spacetimeDBClient) return;
        
        try {
            // Get current player ID (adjust based on your authentication system)
            const playerId = this.spacetimeDBClient.getCurrentPlayerId?.() || 
                           (window as any).currentPlayerId;
            
            if (!playerId) return;
            
            // Load stats from database
            const playerStats = this.spacetimeDBClient.db?.playerStats?.find(playerId);
            if (playerStats) {
                this.stats = {
                    health: playerStats.health || 100,
                    maxHealth: playerStats.maxHealth || 100,
                    damage: playerStats.damage || 10,
                    speed: playerStats.speed || 1.0,
                    attackSpeed: playerStats.attackSpeed || 1.0,
                    defense: playerStats.defense || 0,
                    critChance: playerStats.critChance,
                    critDamage: playerStats.critDamage
                };
                this.updateStatsDisplay();
            }
            
            // Load upgrades from database
            const chosenUpgrades = this.spacetimeDBClient.db?.chosenUpgrades?.find(playerId);
            if (chosenUpgrades) {
                this.upgrades = chosenUpgrades.map((upgrade: any) => ({
                    id: upgrade.id,
                    name: upgrade.name,
                    level: upgrade.level,
                    maxLevel: upgrade.maxLevel,
                    icon: upgrade.icon,
                    description: upgrade.description
                }));
                this.updateUpgradesDisplay();
            }
            
        } catch (error) {
            console.warn('Failed to load data from database:', error);
            // Fallback to mock data for development
            this.loadMockData();
        }
    }

    protected loadMockData(): void {
        // Mock data for development/testing
        this.stats = {
            health: 85,
            maxHealth: 100,
            damage: 25,
            speed: 1.2,
            attackSpeed: 1.5,
            defense: 10,
            critChance: 0.15,
            critDamage: 1.5
        };
        
        this.upgrades = [
            { id: 'weapon_damage', name: 'Weapon Damage', level: 3, maxLevel: 5, icon: 'icon_sword' },
            { id: 'health_boost', name: 'Health Boost', level: 2, maxLevel: 3, icon: 'icon_heart' },
            { id: 'speed_boost', name: 'Speed Boost', level: 1, maxLevel: 3, icon: 'icon_speed' }
        ];
        
        this.updateStatsDisplay();
        this.updateUpgradesDisplay();
    }

    // Public methods for updating data
    public updateStats(newStats: PlayerStats): void {
        this.stats = newStats;
        this.updateStatsDisplay();
    }

    public updateUpgrades(newUpgrades: UpgradeData[]): void {
        this.upgrades = newUpgrades;
        this.updateUpgradesDisplay();
    }

    public addUpgrade(upgrade: UpgradeData): void {
        const existingIndex = this.upgrades.findIndex(u => u.id === upgrade.id);
        if (existingIndex >= 0) {
            this.upgrades[existingIndex] = upgrade;
        } else {
            this.upgrades.push(upgrade);
        }
        this.updateUpgradesDisplay();
    }

    public removeUpgrade(upgradeId: string): void {
        this.upgrades = this.upgrades.filter(u => u.id !== upgradeId);
        this.updateUpgradesDisplay();
    }

    // Integration method for your database context
    public loadFromDatabase(playerId: string): void {
        if (!this.spacetimeDBClient) return;
        
        try {
            const chosenUpgrades = this.spacetimeDBClient.db?.chosenUpgrades?.find(playerId);
            if (chosenUpgrades) {
                this.upgrades = chosenUpgrades.map((upgrade: any) => ({
                    id: upgrade.id,
                    name: upgrade.name,
                    level: upgrade.level,
                    maxLevel: upgrade.maxLevel,
                    icon: upgrade.icon,
                    description: upgrade.description
                }));
                this.updateUpgradesDisplay();
            }
            
            const playerStats = this.spacetimeDBClient.db?.playerStats?.find(playerId);
            if (playerStats) {
                this.stats = {
                    health: playerStats.health || 100,
                    maxHealth: playerStats.maxHealth || 100,
                    damage: playerStats.damage || 10,
                    speed: playerStats.speed || 1.0,
                    attackSpeed: playerStats.attackSpeed || 1.0,
                    defense: playerStats.defense || 0,
                    critChance: playerStats.critChance,
                    critDamage: playerStats.critDamage
                };
                this.updateStatsDisplay();
            }
        } catch (error) {
            console.warn('Failed to load data from database:', error);
        }
    }

    public toggle(): void {
        this.isVisible = !this.isVisible;
        
        if (this.isVisible) {
            // Show all content
            this.statsContainer.setVisible(true);
            this.upgradesContainer.setVisible(true);
            this.toggleButton.setText('−');
            
            // Restore full background size
            const bg = this.container.list[0] as Phaser.GameObjects.Rectangle;
            if (bg) {
                bg.setSize(280, 320);
            }
        } else {
            // Hide content, keep only title and toggle button
            this.statsContainer.setVisible(false);
            this.upgradesContainer.setVisible(false);
            this.toggleButton.setText('+');
            
            // Shrink background
            const bg = this.container.list[0] as Phaser.GameObjects.Rectangle;
            if (bg) {
                bg.setSize(280, 35);
            }
        }
    }

    public show(): void {
        this.container.setVisible(true);
    }

    public hide(): void {
        this.container.setVisible(false);
    }

    public updatePosition(): void {
        // Update position when screen resizes
        const pos = this.calculatePosition();
        this.container.setPosition(pos.x, pos.y);
    }

    public destroy(): void {
        this.container.destroy();
    }
}