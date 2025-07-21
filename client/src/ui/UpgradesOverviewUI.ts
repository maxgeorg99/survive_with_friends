import Phaser from 'phaser';

// Upgrade interfaces
interface WeaponUpgradeData {
    level: number;
    baseCost: number;
    maxLevel: number;
}

interface WeaponData {
    id: string;
    name: string;
    icon: string;
    owned: boolean;
    upgrades: Record<string, WeaponUpgradeData>;
}

interface CharacterUpgradeData {
    level: number;
    baseCost: number;
    description: string;
}

interface UpgradeSettings {
    playerGold: number;
    panelVisible: boolean;
}

// Default settings
const DEFAULT_SETTINGS: UpgradeSettings = {
    playerGold: 500,
    panelVisible: false
};

export default class UpgradesUI {
    protected scene: Phaser.Scene;
    protected container!: Phaser.GameObjects.Container;
    protected upgradesButton!: Phaser.GameObjects.Text;
    protected isVisible: boolean = false;
    
    // UI Elements
    protected goldText!: Phaser.GameObjects.Text;
    protected weaponTable!: Phaser.GameObjects.Container;
    protected characterUpgrades!: Phaser.GameObjects.Container;
    
    // Data
    protected settings: UpgradeSettings;
    protected availableWeapons: WeaponData[] = [];
    protected upgradeTypes: string[] = ['damage', 'cooldown', 'count', 'speed', 'size'];
    protected characterUpgradeData: Record<string, CharacterUpgradeData> = {
        maxhp: { level: 5, baseCost: 80, description: '+20 HP per level' },
        hpregen: { level: 2, baseCost: 120, description: '+2 HP/sec per level' },
        movespeed: { level: 3, baseCost: 70, description: '+15% speed per level' },
        armor: { level: 1, baseCost: 150, description: '-10% damage per level' }
    };

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.settings = this.loadSettings();
        this.initializeWeaponData();
        this.createUI();
        this.applyVisibilitySettings();
    }

    protected initializeWeaponData(): void {
        const weaponConfigs = [
            { id: 'sword', name: 'Sword', icon: '⚔️', owned: true },
            { id: 'bow', name: 'Bow', icon: '🏹', owned: true },
            { id: 'fireball', name: 'Fireball', icon: '🔥', owned: false },
            { id: 'lightning', name: 'Lightning', icon: '⚡', owned: true },
            { id: 'ice_shard', name: 'Ice Shard', icon: '❄️', owned: false },
            { id: 'poison_dart', name: 'Poison Dart', icon: '☠️', owned: false },
            { id: 'hammer', name: 'Hammer', icon: '🔨', owned: true }
        ];

        this.availableWeapons = weaponConfigs.map(config => {
            const upgrades: Record<string, WeaponUpgradeData> = {};
            this.upgradeTypes.forEach(type => {
                upgrades[type] = {
                    level: Math.floor(Math.random() * 5) + 1,
                    baseCost: 50 + Math.floor(Math.random() * 50),
                    maxLevel: type === 'count' ? 5 : 10
                };
            });
            
            return {
                ...config,
                upgrades
            };
        });
    }

    protected createUI(): void {
        // Create main container
        this.container = this.scene.add.container(this.scene.cameras.main.centerX, this.scene.cameras.main.centerY);
        this.container.setScrollFactor(0);
        this.container.setDepth(100000);
        this.container.setVisible(false);

        // Create panel background
        const panelBg = this.scene.add.rectangle(0, 0, 650, 500, 0x000000, 0.9);
        panelBg.setStrokeStyle(2, 0x666666);
        panelBg.setScrollFactor(0);
        panelBg.setInteractive();

        // Create header
        const header = this.createHeader();
        
        // Create weapon upgrades section
        const weaponSection = this.createWeaponSection();
        
        // Create character upgrades section
        const characterSection = this.createCharacterSection();

        // Create upgrades button (separate from main container)
        this.createUpgradesButton();

        // Add all elements to container
        this.container.add([panelBg, header, weaponSection, characterSection]);
    }

    protected createHeader(): Phaser.GameObjects.Container {
        const headerContainer = this.scene.add.container(0, -220);
        
        // Title
        const title = this.scene.add.text(0, 0, '(U)pgrades', {
            fontSize: '20px',
            color: '#ffd700',
            fontStyle: 'bold'
        });
        title.setOrigin(0.5);
        title.setScrollFactor(0);

        // Gold display
        this.goldText = this.scene.add.text(250, -10, `Gold: ${this.settings.playerGold} 🪙`, {
            fontSize: '14px',
            color: '#ffd700',
            fontStyle: 'bold',
            backgroundColor: '#000000',
            padding: { x: 8, y: 4 }
        });
        this.goldText.setOrigin(1, 0.5);
        this.goldText.setScrollFactor(0);

        // Close button
        const closeBtn = this.scene.add.text(280, -20, '×', {
            fontSize: '24px',
            color: '#ffffff',
            backgroundColor: '#666666',
            padding: { x: 8, y: 4 }
        });
        closeBtn.setOrigin(0.5);
        closeBtn.setScrollFactor(0);
        closeBtn.setInteractive({ useHandCursor: true });
        closeBtn.on('pointerdown', () => this.hide());

        // Key hint
        const keyHint = this.scene.add.text(-280, -20, 'Press U to toggle', {
            fontSize: '12px',
            color: '#ffd700',
            backgroundColor: '#000000',
            padding: { x: 8, y: 4 }
        });
        keyHint.setOrigin(0, 0.5);
        keyHint.setScrollFactor(0);

        headerContainer.add([title, this.goldText, closeBtn, keyHint]);
        return headerContainer;
    }

    protected createWeaponSection(): Phaser.GameObjects.Container {
        const sectionContainer = this.scene.add.container(0, -120);
        
        // Section title
        const sectionTitle = this.scene.add.text(0, 0, '⚔️ Weapon Upgrades', {
            fontSize: '16px',
            color: '#ffd700',
            fontStyle: 'bold'
        });
        sectionTitle.setOrigin(0.5);
        sectionTitle.setScrollFactor(0);

        // Create weapon table
        this.weaponTable = this.createWeaponTable();
        this.weaponTable.setPosition(0, 40);

        sectionContainer.add([sectionTitle, this.weaponTable]);
        return sectionContainer;
    }

    protected createWeaponTable(): Phaser.GameObjects.Container {
        const tableContainer = this.scene.add.container(0, 0);
        
        // Table headers
        const headers = ['Weapon', 'Damage', 'Cooldown', 'Count', 'Speed', 'Size'];
        const columnWidth = 90;
        const startX = -(headers.length * columnWidth) / 2 + columnWidth / 2;

        headers.forEach((header, index) => {
            const headerText = this.scene.add.text(startX + index * columnWidth, 0, header, {
                fontSize: '12px',
                color: '#ffd700',
                fontStyle: 'bold'
            });
            headerText.setOrigin(0.5);
            headerText.setScrollFactor(0);
            tableContainer.add(headerText);
        });

        // Create weapon rows
        this.availableWeapons.forEach((weapon, weaponIndex) => {
            const rowY = 30 + weaponIndex * 40;
            
            // Weapon icon
            const weaponIcon = this.scene.add.image(startX, rowY, weapon.icon) 
            .setScale(0.5) // adjust scale as needed
            .setOrigin(0.5);
            
            if (!weapon.owned) {
                weaponIcon.setAlpha(0.5);
            }
            
            tableContainer.add(weaponIcon);

            // Upgrade cells
            this.upgradeTypes.forEach((type, typeIndex) => {
                const cellX = startX + (typeIndex + 1) * columnWidth;
                const upgradeData = weapon.upgrades[type];
                
                const cellBg = this.scene.add.rectangle(cellX, rowY, 80, 30, 
                    weapon.owned ? (upgradeData.level >= upgradeData.maxLevel ? 0x404020 : 0x1e1e1e) : 0x0a0a0a);
                cellBg.setStrokeStyle(1, 0x444444);
                cellBg.setScrollFactor(0);

                if (weapon.owned && upgradeData.level < upgradeData.maxLevel) {
                    cellBg.setInteractive({ useHandCursor: true });
                    cellBg.on('pointerover', () => cellBg.setFillStyle(0x323232));
                    cellBg.on('pointerout', () => cellBg.setFillStyle(0x1e1e1e));
                    cellBg.on('pointerdown', () => this.upgradeWeapon(weapon.id, type));
                }

                let cellText: string;
                let textColor: string;

                if (!weapon.owned) {
                    cellText = 'N/A';
                    textColor = '#666666';
                } else if (upgradeData.level >= upgradeData.maxLevel) {
                    cellText = `Lv. ${upgradeData.level}\nMAX`;
                    textColor = '#888888';
                } else {
                    const cost = this.getUpgradeCost(upgradeData.baseCost, upgradeData.level);
                    cellText = `Lv. ${upgradeData.level}\n${cost}🪙`;
                    textColor = '#4ade80';
                }

                const levelText = this.scene.add.text(cellX, rowY, cellText, {
                    fontSize: '10px',
                    color: textColor,
                    align: 'center'
                });
                levelText.setOrigin(0.5);
                levelText.setScrollFactor(0);

                tableContainer.add([cellBg, levelText]);
            });
        });

        return tableContainer;
    }

    protected createCharacterSection(): Phaser.GameObjects.Container {
        const sectionContainer = this.scene.add.container(0, 120);
        
        // Section title
        const sectionTitle = this.scene.add.text(0, 0, '👤 Character Upgrades', {
            fontSize: '16px',
            color: '#ffd700',
            fontStyle: 'bold'
        });
        sectionTitle.setOrigin(0.5);
        sectionTitle.setScrollFactor(0);

        // Character upgrades grid
        this.characterUpgrades = this.createCharacterUpgrades();
        this.characterUpgrades.setPosition(0, 40);

        sectionContainer.add([sectionTitle, this.characterUpgrades]);
        return sectionContainer;
    }

    protected createCharacterUpgrades(): Phaser.GameObjects.Container {
        const upgradesContainer = this.scene.add.container(0, 0);
        
        const upgradeConfigs = [
            { key: 'maxhp', icon: '❤️', name: 'Max HP' },
            { key: 'hpregen', icon: '💚', name: 'HP Regen' },
            { key: 'movespeed', icon: '💨', name: 'Speed' },
            { key: 'armor', icon: '🛡️', name: 'Armor' }
        ];

        const itemWidth = 140;
        const itemHeight = 60;
        const itemsPerRow = 2;
        const startX = -(itemsPerRow * itemWidth) / 2 + itemWidth / 2;

        upgradeConfigs.forEach((config, index) => {
            const row = Math.floor(index / itemsPerRow);
            const col = index % itemsPerRow;
            const x = startX + col * itemWidth;
            const y = row * (itemHeight + 10);

            const upgradeData = this.characterUpgradeData[config.key];
            const cost = this.getUpgradeCost(upgradeData.baseCost, upgradeData.level);

            // Item background
            const itemBg = this.scene.add.rectangle(x, y, itemWidth - 10, itemHeight, 0x141414);
            itemBg.setStrokeStyle(1, 0x444444);
            itemBg.setScrollFactor(0);
            itemBg.setInteractive({ useHandCursor: true });
            itemBg.on('pointerover', () => itemBg.setStrokeStyle(1, 0x666666));
            itemBg.on('pointerout', () => itemBg.setStrokeStyle(1, 0x444444));
            itemBg.on('pointerdown', () => this.upgradeCharacter(config.key));

            // Icon and name
            const iconText = this.scene.add.text(x - 45, y - 15, config.icon, {
                fontSize: '16px'
            });
            iconText.setOrigin(0.5);
            iconText.setScrollFactor(0);

            const nameText = this.scene.add.text(x - 25, y - 15, config.name, {
                fontSize: '12px',
                color: '#ffffff',
                fontStyle: 'bold'
            });
            nameText.setOrigin(0, 0.5);
            nameText.setScrollFactor(0);

            // Level
            const levelText = this.scene.add.text(x + 45, y - 15, `Lv. ${upgradeData.level}`, {
                fontSize: '12px',
                color: '#4ade80',
                fontStyle: 'bold'
            });
            levelText.setOrigin(1, 0.5);
            levelText.setScrollFactor(0);

            // Description and cost
            const descText = this.scene.add.text(x, y + 5, upgradeData.description, {
                fontSize: '10px',
                color: '#aaaaaa'
            });
            descText.setOrigin(0.5);
            descText.setScrollFactor(0);

            const costText = this.scene.add.text(x, y + 18, `${cost}🪙`, {
                fontSize: '10px',
                color: '#ffd700'
            });
            costText.setOrigin(0.5);
            costText.setScrollFactor(0);

            upgradesContainer.add([itemBg, iconText, nameText, levelText, descText, costText]);
        });

        return upgradesContainer;
    }

    protected createUpgradesButton(): void {
        // Create Upgrades button at bottom-right of screen
        this.upgradesButton = this.scene.add.text(
            this.scene.cameras.main.width - 20, 
            this.scene.cameras.main.height - 60, 
            '(U)pgrades', {
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold',
            backgroundColor: '#444444',
            padding: { x: 12, y: 6 }
        });
        this.upgradesButton.setOrigin(1);
        this.upgradesButton.setScrollFactor(0);
        this.upgradesButton.setDepth(99999);
        this.upgradesButton.setInteractive({ useHandCursor: true });
        
        // Add hover effects
        this.upgradesButton.on('pointerover', () => {
            this.upgradesButton.setBackgroundColor('#666666');
        });
        
        this.upgradesButton.on('pointerout', () => {
            this.upgradesButton.setBackgroundColor('#444444');
        });
        
        // Show upgrades menu when clicked
        this.upgradesButton.on('pointerdown', () => {
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
            
            this.show();
        });
    }

    protected getUpgradeCost(baseCost: number, level: number): number {
        return Math.floor(baseCost * Math.pow(1.4, level));
    }

    protected upgradeWeapon(weaponId: string, type: string): void {
        const weapon = this.availableWeapons.find(w => w.id === weaponId);
        if (!weapon || !weapon.owned) return;

        const upgradeData = weapon.upgrades[type];
        const cost = this.getUpgradeCost(upgradeData.baseCost, upgradeData.level);

        if (upgradeData.level >= upgradeData.maxLevel) {
            this.showMessage("This upgrade is already at maximum level!");
            return;
        }

        if (this.settings.playerGold < cost) {
            this.showMessage("Not enough gold!");
            return;
        }

        // Apply upgrade
        this.settings.playerGold -= cost;
        upgradeData.level++;
        
        this.updateDisplay();
        this.saveSettings();
        this.showMessage(`${weapon.name} ${type} upgraded to level ${upgradeData.level}!`);
        
        // Notify game of upgrade
        this.onWeaponUpgraded(weaponId, type, upgradeData.level);
    }

    protected upgradeCharacter(type: string): void {
        const upgradeData = this.characterUpgradeData[type];
        const cost = this.getUpgradeCost(upgradeData.baseCost, upgradeData.level);

        if (this.settings.playerGold < cost) {
            this.showMessage("Not enough gold!");
            return;
        }

        // Apply upgrade
        this.settings.playerGold -= cost;
        upgradeData.level++;
        
        this.updateDisplay();
        this.saveSettings();
        this.showMessage(`${type} upgraded to level ${upgradeData.level}!`);
        
        // Notify game of upgrade
        this.onCharacterUpgraded(type, upgradeData.level);
    }

    protected updateDisplay(): void {
        // Update gold display
        this.goldText.setText(`Gold: ${this.settings.playerGold} 🪙`);
        
        // Recreate weapon table and character upgrades
        this.weaponTable.destroy();
        this.characterUpgrades.destroy();
        
        this.weaponTable = this.createWeaponTable();
        this.weaponTable.setPosition(0, 40);
        this.container.add(this.weaponTable);
        
        this.characterUpgrades = this.createCharacterUpgrades();
        this.characterUpgrades.setPosition(0, 40);
        this.container.add(this.characterUpgrades);
    }

    protected showMessage(text: string): void {
        console.log(text); // Replace with your game's notification system
        
        // You could create a temporary text display here
        const messageText = this.scene.add.text(this.scene.cameras.main.centerX, 50, text, {
            fontSize: '16px',
            color: '#ffd700',
            backgroundColor: '#000000',
            padding: { x: 12, y: 6 }
        });
        messageText.setOrigin(0.5);
        messageText.setScrollFactor(0);
        messageText.setDepth(200000);
        
        // Fade out after 2 seconds
        this.scene.tweens.add({
            targets: messageText,
            alpha: 0,
            duration: 2000,
            onComplete: () => messageText.destroy()
        });
    }

    // Public API
    public toggle(): void {
        this.isVisible = !this.isVisible;
        this.container.setVisible(this.isVisible);
        this.upgradesButton.setVisible(!this.isVisible);
        this.saveVisibilityState();
    }

    public show(): void {
        this.isVisible = true;
        this.container.setVisible(true);
        this.upgradesButton.setVisible(false);
        this.saveVisibilityState();
    }

    public hide(): void {
        this.isVisible = false;
        this.container.setVisible(false);
        this.upgradesButton.setVisible(true);
        this.saveVisibilityState();
    }

    public addGold(amount: number): void {
        this.settings.playerGold += amount;
        this.goldText.setText(`Gold: ${this.settings.playerGold} 🪙`);
        this.saveSettings();
    }

    public addWeapon(weaponId: string): void {
        const weapon = this.availableWeapons.find(w => w.id === weaponId);
        if (weapon) {
            weapon.owned = true;
            this.updateDisplay();
        }
    }

    public removeWeapon(weaponId: string): void {
        const weapon = this.availableWeapons.find(w => w.id === weaponId);
        if (weapon) {
            weapon.owned = false;
            this.updateDisplay();
        }
    }

    public destroy(): void {
        this.container.destroy();
        if (this.upgradesButton) {
            this.upgradesButton.destroy();
        }
    }

    // Override these methods in your game to handle upgrades
    protected onWeaponUpgraded(weaponId: string, type: string, level: number): void {
        // Call your game's weapon upgrade system here
        // Example: (this.scene as any).weaponManager.upgradeWeapon(weaponId, type, level);
    }

    protected onCharacterUpgraded(type: string, level: number): void {
        // Call your game's character upgrade system here
        // Example: (this.scene as any).playerManager.upgradeCharacter(type, level);
    }

    // Settings persistence
    protected loadSettings(): UpgradeSettings {
        try {
            const stored = localStorage.getItem('vibesurvivors_upgrades');
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...DEFAULT_SETTINGS, ...parsed };
            }
        } catch (error) {
            console.warn('Failed to load upgrade settings from localStorage:', error);
        }
        
        return { ...DEFAULT_SETTINGS };
    }

    protected saveSettings(): void {
        try {
            localStorage.setItem('vibesurvivors_upgrades', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Failed to save upgrade settings to localStorage:', error);
        }
    }

    protected applyVisibilitySettings(): void {
        this.isVisible = this.settings.panelVisible ?? false;
        this.container.setVisible(this.isVisible);
        this.upgradesButton.setVisible(!this.isVisible);
    }

    protected saveVisibilityState(): void {
        this.settings.panelVisible = this.isVisible;
        this.saveSettings();
    }
}