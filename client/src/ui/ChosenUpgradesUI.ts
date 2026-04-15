import * as Phaser from 'phaser';
import { ChosenUpgradeData, AttackType } from '../autobindings/types';
import SpacetimeDBClient from '../SpacetimeDBClient';

const UPGRADE_ICON_MAP: { [key: string]: string } = {
    'AttackSword': 'attack_sword',
    'AttackWand': 'attack_wand',
    'AttackKnives': 'attack_knife',
    'AttackShield': 'attack_shield',
    'AttackThunderHorn': 'attack_horn',
    'AttackAngelStaff': 'attack_staff',
    'AttackFootball': 'attack_football',
    'AttackCards': 'attack_cards',
    'AttackDumbbell': 'attack_dumbbell',
    'AttackGarlic': 'attack_garlic',
    'AttackVolleyball': 'attack_volleyball',
    'AttackJoint': 'attack_joint',
    'MaxHp': 'upgrade_maxHP',
    'HpRegen': 'upgrade_regenHP',
    'Speed': 'upgrade_speed',
    'Armor': 'upgrade_armor',
};

interface WeaponDisplayData {
    tag: string;
    icon: string;
    damageUpgrades: number;
    cooldownUpgrades: number;
    projectileUpgrades: number;
    speedUpgrades: number;
    radiusUpgrades: number;
}

export default class ChosenUpgradesUI {
    private scene: Phaser.Scene;
    private spacetimeClient: SpacetimeDBClient;
    private localPlayerId: number;
    private panelContainer: Phaser.GameObjects.Container; // The main panel
    private toggleButton: Phaser.GameObjects.Text; // The small button to open/close
    private isVisible: boolean = false;
    private upgrades: ChosenUpgradeData[] = [];
    private startingAttackType: AttackType | null;

    constructor(scene: Phaser.Scene, spacetimeClient: SpacetimeDBClient, localPlayerId: number, startingAttackType: AttackType | null) {
        this.scene = scene;
        this.spacetimeClient = spacetimeClient;
        this.localPlayerId = localPlayerId;
        this.startingAttackType = startingAttackType;

        const { width } = this.scene.cameras.main;

        // The small, persistent button in the top-right corner
        this.toggleButton = this.scene.add.text(width - 20, 20, '(U)pgrades', {
            fontSize: '16px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#444444',
            padding: { x: 8, y: 6 }
        });
        this.toggleButton.setOrigin(1, 0);
        this.toggleButton.setScrollFactor(0);
        this.toggleButton.setDepth(100000); // Above the panel
        this.toggleButton.setInteractive({ useHandCursor: true });
        this.toggleButton.on('pointerdown', () => this.toggle());
        this.toggleButton.on('pointerover', () => this.toggleButton.setBackgroundColor('#666666'));
        this.toggleButton.on('pointerout', () => this.toggleButton.setBackgroundColor('#444444'));

        // The main panel container, positioned in the top-right, but starts invisible.
        this.panelContainer = this.scene.add.container(width - 20, 20);
        this.panelContainer.setScrollFactor(0);
        this.panelContainer.setDepth(99999); // Just below the toggle button
        this.panelContainer.setVisible(false);

        this.fetchUpgrades();
    }

    private fetchUpgrades() {
        if (this.spacetimeClient.sdkConnection?.db.chosen_upgrades?.iter) {
            this.upgrades = Array.from(
                this.spacetimeClient.sdkConnection.db.chosen_upgrades.iter()
            ).filter(u => u.playerId === this.localPlayerId);
        } else {
            this.upgrades = [];
        }
    }

    public refresh() {
        this.fetchUpgrades();
        if (this.isVisible) {
            this.render();
        }
    }

    public toggle() {
        this.isVisible = !this.isVisible;
        this.panelContainer.setVisible(this.isVisible);
        this.toggleButton.setVisible(!this.isVisible); // Hide toggle button when panel is open
        if (this.isVisible) {
            this.refresh();
        }
    }

    private render() {
        this.panelContainer.removeAll(true);

        // --- Corrected Logic to Aggregate Upgrade Counts ---
        const weaponsMap = new Map<string, WeaponDisplayData>();
        const charUpgradesMap = new Map<string, { tag: string, icon: string, count: number }>();

        // 1. Initialize with the starting weapon. Every weapon starts with 1 projectile.
        if (this.startingAttackType) {
            const tag = 'Attack' + this.startingAttackType.tag;
            weaponsMap.set(tag, {
                tag: tag, icon: UPGRADE_ICON_MAP[tag],
                damageUpgrades: 0, cooldownUpgrades: 0, projectileUpgrades: 1,
                speedUpgrades: 0, radiusUpgrades: 0,
            });
        }

        // 2. Process all upgrades from the server in a single loop.
        this.upgrades.forEach(upg => {
            if (upg.isAttackUpgrade) {
                // This is the acquisition of a new weapon (or a duplicate for stats).
                const tag = upg.upgradeType.tag;

                // Ensure weapon entry exists
                if (!weaponsMap.has(tag)) {
                    weaponsMap.set(tag, {
                        tag: tag,
                        icon: UPGRADE_ICON_MAP[tag] || 'white_pixel',
                        damageUpgrades: 0,
                        cooldownUpgrades: 0,
                        projectileUpgrades: 0,
                        speedUpgrades: 0,
                        radiusUpgrades: 0,
                    });
                }

                // Determine which weapon's stats to upgrade
                const weaponTag = (upg as any).weaponTagForStat ?? tag;
                const weaponToUpgrade = weaponsMap.get(weaponTag);

                if (weaponToUpgrade) {
                    if (upg.damage > 0) weaponToUpgrade.damageUpgrades++;
                    if (upg.cooldownRatio > 0) weaponToUpgrade.cooldownUpgrades++;
                    if (upg.projectiles > 0) weaponToUpgrade.projectileUpgrades++;
                    if (upg.speed > 0) weaponToUpgrade.speedUpgrades++;
                    if (upg.radius > 0) weaponToUpgrade.radiusUpgrades++;

                    // Update the map entry
                    weaponsMap.set(weaponTag, weaponToUpgrade);
                }

            } else {
                // It's a character stat upgrade (MaxHp, Armor, etc.)
                const charStatTag = upg.upgradeType.tag;
                const currentStat = charUpgradesMap.get(charStatTag);
                if (currentStat) {
                    currentStat.count++;
                } else {
                    charUpgradesMap.set(charStatTag, {
                        tag: charStatTag,
                        icon: UPGRADE_ICON_MAP[charStatTag] || 'white_pixel',
                        count: 1,
                    });
                }
            }
        });

        // --- Dynamic Layout Calculation ---
        const panelWidth = 650;
        const padding = 20;
        let currentY = 0;

        // Container for all the content to easily calculate height
        const contentContainer = this.scene.add.container(0, 0);

        // 1. Add Title
        const title = this.scene.add.text(0, currentY, '(U)pgrades', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' });
        title.setOrigin(1, 0); // Anchor to top-right of its container
        contentContainer.add(title);
        currentY += title.height + 25;

        // 2. Add Weapon Table
        const headerStyle = { fontSize: '16px', color: '#ffffff' };
        const weaponHeader = this.scene.add.text(-panelWidth + padding, currentY, 'Weapon', headerStyle);
        contentContainer.add(weaponHeader);
        contentContainer.add(this.scene.add.text(-470, currentY, 'Damage', headerStyle));
        contentContainer.add(this.scene.add.text(-350, currentY, 'Cooldown', headerStyle));
        contentContainer.add(this.scene.add.text(-230, currentY, 'Count', headerStyle));
        contentContainer.add(this.scene.add.text(-130, currentY, 'Speed', headerStyle));
        contentContainer.add(this.scene.add.text(-50, currentY, 'Size', headerStyle));
        currentY += 30;

        weaponsMap.forEach(weapon => {
            const rowStyle = { fontSize: '14px', color: '#fff' };
            contentContainer.add(this.scene.add.image(-panelWidth + padding + 30, currentY + 8, weapon.icon).setScale(0.6));
            contentContainer.add(this.scene.add.text(-470, currentY, String(weapon.damageUpgrades), rowStyle).setOrigin(0.5, 0));
            contentContainer.add(this.scene.add.text(-350, currentY, String(weapon.cooldownUpgrades), rowStyle).setOrigin(0.5, 0));
            contentContainer.add(this.scene.add.text(-230, currentY, String(weapon.projectileUpgrades + 1), rowStyle).setOrigin(0.5, 0));
            contentContainer.add(this.scene.add.text(-130, currentY, String(weapon.speedUpgrades), rowStyle).setOrigin(0.5, 0));
            contentContainer.add(this.scene.add.text(-50, currentY, String(weapon.radiusUpgrades), rowStyle).setOrigin(0.5, 0));
            currentY += 36;
        });

        // 3. Add Character Stats section
        if (charUpgradesMap.size > 0) {
            currentY += 20;
            const statsHeader = this.scene.add.text(-panelWidth / 2, currentY, 'Character Stats', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5, 0);
            contentContainer.add(statsHeader);
            currentY += 40;

            charUpgradesMap.forEach(upg => {
                contentContainer.add(this.scene.add.image(-450, currentY + 8, upg.icon).setScale(0.5));
                contentContainer.add(this.scene.add.text(-420, currentY, upg.tag, { fontSize: '14px', color: '#fff' }));
                contentContainer.add(this.scene.add.text(-250, currentY, 'Lv. ' + upg.count, { fontSize: '14px', color: '#4ade80' }));
                currentY += 32;
            });
        }

        // 4. Create the background with the calculated dynamic height
        const panelHeight = currentY + padding;
        const bg = this.scene.add.rectangle(0, 0, panelWidth, panelHeight, 0x000000, 0.8);
        bg.setOrigin(1, 0); // Anchor to top-right
        bg.setStrokeStyle(2, 0xffffff, 0.8);

        // Add background first, then content on top
        this.panelContainer.add(bg);
        this.panelContainer.add(contentContainer);
    }

    public destroy() {
        this.panelContainer.destroy();
        this.toggleButton.destroy();
    }
}