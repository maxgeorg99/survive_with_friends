import Phaser from 'phaser';
import { AttackType, EventContext } from '../autobindings';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { isMobileDevice, getResponsiveFontSize } from '../utils/responsive';
import { localization } from '../utils/localization';

// Weapon asset map - doesn't need localization as it's just asset key mappings
const WEAPON_ASSET_MAP: Record<string, string> = {
    "Sword": 'attack_sword',
    "Wand": 'attack_wand',
    "Knives": 'attack_knife',
    "Shield": 'attack_shield',
    "Shuriken": 'attack_shuriken',
    "FireSword": 'attack_fire_sword',
    "HolyHammer": 'attack_holy_hammer',
    "MagicDagger": 'attack_magic_dagger',
    "ThrowingShield": 'attack_throwing_shield',
    "EnergyOrb": 'attack_energy_orb',
    "Football": 'attack_football',
    "Cards": 'attack_cards',
    "Dumbbell": 'attack_dumbbell',
    "Garlic": 'attack_garlic'
};

// Weapon combination definitions (static, matches server)
const WEAPON_COMBINATIONS = [
    { w1: AttackType.Sword, w2: AttackType.Knives, result: AttackType.Shuriken },
    { w1: AttackType.Sword, w2: AttackType.Wand, result: AttackType.FireSword },
    { w1: AttackType.Sword, w2: AttackType.Shield, result: AttackType.HolyHammer },
    { w1: AttackType.Knives, w2: AttackType.Wand, result: AttackType.MagicDagger },
    { w1: AttackType.Knives, w2: AttackType.Shield, result: AttackType.ThrowingShield },
    { w1: AttackType.Wand, w2: AttackType.Shield, result: AttackType.EnergyOrb },
];

interface WeaponCombination {
    w1: AttackType;
    w2: AttackType;
    result: AttackType;
    requiredLevel: number;
}

export default class WeaponCombinationsScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private combinationsContainer!: HTMLDivElement;
    private backButton!: HTMLButtonElement;
    private detailsModal!: HTMLDivElement;
    private modalOverlay!: HTMLDivElement;
    
    constructor() {
        super('WeaponCombinationsScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
    }

    preload() {
        // Preload weapon icons (if not already loaded by main game)
        Object.values(WEAPON_ASSET_MAP).forEach(key => {
            if (key && !this.textures.exists(key)) {
                this.load.image(key, `assets/${key}.png`);
            }
        });
        this.load.image('card_blank', 'assets/card_blank.png');
        this.load.image('title_bg', 'assets/title_bg.png');
    }

    create() {
        const { width, height } = this.scale;
        const isMobile = isMobileDevice();
        
        // Set dark blue background
        this.cameras.main.setBackgroundColor('#042E64');
        
        // Add background image if available
        try {
            if (this.textures.exists('title_bg')) {
                this.add.image(width/2, height/2, 'title_bg')
                    .setDisplaySize(width, height)
                    .setDepth(0);
            }
        } catch (error) {
            console.error("Error loading background:", error);
        }

        // Add title - with responsive font size for mobile
        const titleSize = isMobile ? parseInt(getResponsiveFontSize(36)) : 48;
        this.add.text(width/2, height/6, 'WEAPON COMBINATIONS', {
            fontFamily: 'Arial Black',
            fontSize: `${titleSize}px`,
            color: '#ffffff',
            align: 'center', 
            stroke: '#000000',
            strokeThickness: isMobile ? 4 : 6
        }).setOrigin(0.5);

        // Create weapon combinations container
        this.createCombinationsContainer();
        this.createBackButton();
        this.createDetailsModal();

        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Setup cleanup on scene shutdown
        this.events.on('shutdown', this.shutdown, this);
    }

    private createCombinationsContainer() {
        const isMobile = isMobileDevice();
        // Remove any existing container
        const existingContainer = document.getElementById('combinations-container');
        if (existingContainer) existingContainer.remove();

        // Create combinations list container
        this.combinationsContainer = document.createElement('div');
        this.combinationsContainer.id = 'combinations-container';
        this.combinationsContainer.style.position = 'fixed'; // Changed from absolute to fixed
        this.combinationsContainer.style.left = '50%';
        this.combinationsContainer.style.top = '50%';
        this.combinationsContainer.style.transform = 'translate(-50%, -50%)';
        this.combinationsContainer.style.zIndex = '2000'; // High z-index to appear above game elements
        
        if (isMobile) {
            // Mobile-friendly styles
            this.combinationsContainer.style.width = '85%';
            this.combinationsContainer.style.maxWidth = '400px';
            this.combinationsContainer.style.maxHeight = '50vh';
            this.combinationsContainer.style.fontSize = getResponsiveFontSize(14);
        } else {
            // Desktop styles
            this.combinationsContainer.style.width = '600px';
            this.combinationsContainer.style.maxHeight = '450px';
            this.combinationsContainer.style.fontSize = '16px';
        }
        
        this.combinationsContainer.style.overflowY = 'auto';
        this.combinationsContainer.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.combinationsContainer.style.borderRadius = '8px';
        this.combinationsContainer.style.border = '2px solid #34495e';
        this.combinationsContainer.style.padding = '20px';

        // Fetch weapon combinations
        this.fetchWeaponCombinations();

        document.body.appendChild(this.combinationsContainer);
    }

    private createDetailsModal() {
        // Create modal overlay
        const existingOverlay = document.getElementById('weapon-modal-overlay');
        if (existingOverlay) existingOverlay.remove();
        
        this.modalOverlay = document.createElement('div');
        this.modalOverlay.id = 'weapon-modal-overlay';
        this.modalOverlay.style.position = 'fixed';
        this.modalOverlay.style.top = '0';
        this.modalOverlay.style.left = '0';
        this.modalOverlay.style.width = '100%';
        this.modalOverlay.style.height = '100%';
        this.modalOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        this.modalOverlay.style.zIndex = '1000';
        this.modalOverlay.style.display = 'none';
        
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) {
                this.hideDetailsModal();
            }
        });
        
        // Create details modal
        const existingModal = document.getElementById('weapon-details-modal');
        if (existingModal) existingModal.remove();
        
        this.detailsModal = document.createElement('div');
        this.detailsModal.id = 'weapon-details-modal';
        this.detailsModal.style.position = 'fixed';
        this.detailsModal.style.top = '50%';
        this.detailsModal.style.left = '50%';
        this.detailsModal.style.transform = 'translate(-50%, -50%)';
        this.detailsModal.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.detailsModal.style.borderRadius = '8px';
        this.detailsModal.style.border = '2px solid #3498db';
        this.detailsModal.style.padding = '25px';
        this.detailsModal.style.color = 'white';
        this.detailsModal.style.zIndex = '1001';
        this.detailsModal.style.width = isMobileDevice() ? '85%' : '500px';
        this.detailsModal.style.maxWidth = '600px';
        this.detailsModal.style.maxHeight = '85vh';
        this.detailsModal.style.overflowY = 'auto';
        this.detailsModal.style.display = 'none';
        this.detailsModal.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.5)';
        
        // Add close button
        const closeButton = document.createElement('button');
        closeButton.textContent = '✕';
        closeButton.style.position = 'absolute';
        closeButton.style.top = '10px';
        closeButton.style.right = '10px';
        closeButton.style.background = 'transparent';
        closeButton.style.border = 'none';
        closeButton.style.color = 'white';
        closeButton.style.fontSize = '24px';
        closeButton.style.cursor = 'pointer';
        closeButton.style.padding = '5px';
        closeButton.addEventListener('click', () => {
            this.hideDetailsModal();
        });
        
        this.detailsModal.appendChild(closeButton);
        
        document.body.appendChild(this.modalOverlay);
        document.body.appendChild(this.detailsModal);
    }

    private showDetailsModal(weapon: AttackType) {
        // Use our helper functions to get weapon data consistently
        const weaponName = getWeaponName(weapon);
        const weaponAsset = getWeaponAsset(weapon);
        const weaponDescription = getWeaponDescription(weapon);
        const weaponStats = getWeaponStats(weapon);
        
        const isMobile = isMobileDevice();
        const iconSize = isMobile ? 80 : 100;
        const fontSize = isMobile ? getResponsiveFontSize(16) : '18px';
        
        // Find combinations that use this weapon as a component
        const componentCombos = WEAPON_COMBINATIONS.filter(combo => 
            combo.w1.tag === weapon.tag || combo.w2.tag === weapon.tag
        );
        
        // Find combination where this weapon is the result
        const resultCombo = WEAPON_COMBINATIONS.find(combo => combo.result.tag === weapon.tag);
        
        // Create component combinations HTML
        let componentsHTML = '';
        if (componentCombos.length > 0) {
            componentsHTML = `
                <h3 style="font-size: ${isMobile ? '18px' : '20px'}; color: #3498db; margin-top: 20px; margin-bottom: 10px;">
                    Used in Combinations:
                </h3>
                <div style="display: flex; flex-direction: column; gap: 10px;">
            `;
            
            componentCombos.forEach(combo => {
                const combo1Name = getWeaponName(combo.w1);
                const combo2Name = getWeaponName(combo.w2);
                const resultName = getWeaponName(combo.result);
                
                componentsHTML += `
                    <div style="background-color: rgba(52, 73, 94, 0.7); padding: 10px; border-radius: 5px; 
                         display: flex; align-items: center; justify-content: space-between;">
                        <span>${combo1Name} + ${combo2Name}</span>
                        <span style="color: #f39c12;">→ ${resultName}</span>
                    </div>
                `;
            });
            
            componentsHTML += '</div>';
        }
        
        // Create recipe HTML if this is a combined weapon
        let recipeHTML = '';
        if (resultCombo) {
            const component1Name = getWeaponName(resultCombo.w1);
            const component2Name = getWeaponName(resultCombo.w2);
            
            recipeHTML = `
                <h3 style="font-size: ${isMobile ? '18px' : '20px'}; color: #3498db; margin-top: 20px; margin-bottom: 10px;">
                    Recipe:
                </h3>
                <div style="background-color: rgba(52, 73, 94, 0.7); padding: 10px; border-radius: 5px; 
                     display: flex; align-items: center; justify-content: space-between;">
                    <span>${component1Name} + ${component2Name}</span>
                    <span style="color: #f39c12;">→ ${weaponName}</span>
                </div>
            `;
        }
        
        // Update modal content
        this.detailsModal.innerHTML = `
            <button style="position: absolute; top: 10px; right: 10px; background: transparent; border: none; color: white; font-size: 24px; cursor: pointer; padding: 5px;">✕</button>
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
                <div style="width: ${iconSize}px; height: ${iconSize}px; 
                     background-color: rgba(0,0,0,0.3); border-radius: 8px; 
                     display: flex; align-items: center; justify-content: center;
                     border: 1px solid #f39c12; margin-right: 15px;">
                    <img src="assets/${weaponAsset}.png" style="max-width: 85%; max-height: 85%; object-fit: contain;" 
                        alt="${weaponName}">
                </div>
                <h2 style="font-size: ${isMobile ? '24px' : '28px'}; color: #3498db; margin: 0;">
                    ${weaponName}
                </h2>
            </div>
            
            <h3 style="font-size: ${isMobile ? '18px' : '20px'}; color: #3498db; margin-top: 0; margin-bottom: 10px;">
                Description:
            </h3>
            <p style="font-size: ${fontSize}; line-height: 1.5; margin-top: 0; margin-bottom: 20px;">
                ${weaponDescription}
            </p>
            
            <h3 style="font-size: ${isMobile ? '18px' : '20px'}; color: #3498db; margin-top: 0; margin-bottom: 10px;">
                Stats:
            </h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                <div style="background-color: rgba(52, 73, 94, 0.7); padding: 10px; border-radius: 5px;">
                    <div style="font-weight: bold; color: #e74c3c;">Damage:</div>
                    <div>${weaponStats.damage}</div>
                </div>
                <div style="background-color: rgba(52, 73, 94, 0.7); padding: 10px; border-radius: 5px;">
                    <div style="font-weight: bold; color: #3498db;">Cooldown:</div>
                    <div>${weaponStats.cooldown}s</div>
                </div>
                <div style="background-color: rgba(52, 73, 94, 0.7); padding: 10px; border-radius: 5px;">
                    <div style="font-weight: bold; color: #2ecc71;">Range:</div>
                    <div>${weaponStats.range} units</div>
                </div>
                <div style="background-color: rgba(52, 73, 94, 0.7); padding: 10px; border-radius: 5px;">
                    <div style="font-weight: bold; color: #f39c12;">Special:</div>
                    <div>${weaponStats.special}</div>
                </div>
            </div>
            
            ${recipeHTML}
            
            ${componentsHTML}
        `;
        
        // Add click event to close button
        const closeButton = this.detailsModal.querySelector('button');
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                this.hideDetailsModal();
            });
        }
        
        // Show modal and overlay
        this.modalOverlay.style.display = 'block';
        this.detailsModal.style.display = 'block';
    }

    private hideDetailsModal() {
        this.modalOverlay.style.display = 'none';
        this.detailsModal.style.display = 'none';
    }

    private fetchWeaponCombinations() {
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.isConnected) {
            this.showErrorMessage("Not connected to the database");
            return;
        }

        try {
            // For now, use static combinations defined above but structure the code
            // to easily switch to database fetching when available
            const combinations: WeaponCombination[] = WEAPON_COMBINATIONS.map(combo => ({
                w1: combo.w1,
                w2: combo.w2,
                result: combo.result,
                requiredLevel: 1 // Default to level 1 for now
            }));

            if (combinations.length === 0) {
                this.showEmptyMessage();
                return;
            }

            this.displayWeaponCombinations(combinations);
        } catch (error) {
            console.error("Error fetching weapon combinations:", error);
            this.showErrorMessage("Error loading weapon combinations");
        }
    }

    private displayWeaponCombinations(combinations: WeaponCombination[]) {
        // Clear existing content
        this.combinationsContainer.innerHTML = '';

        // Check if we have any combinations to display
        if (!combinations || combinations.length === 0) {
            this.showEmptyMessage();
            return;
        }

        const isMobile = isMobileDevice();
        const iconSize = isMobile ? 40 : 50;
        const nameWidth = isMobile ? 60 : 70; // Fixed width for name containers
        
        // Create and append each combination entry
        combinations.forEach(combo => {
            const combinationElement = document.createElement('div');
            combinationElement.style.backgroundColor = 'rgba(52, 73, 94, 0.7)';
            combinationElement.style.margin = '10px 0';
            combinationElement.style.padding = isMobile ? '12px' : '15px';
            combinationElement.style.borderRadius = '5px';
            combinationElement.style.border = '1px solid #2980b9';
            combinationElement.style.color = 'white';
            combinationElement.style.fontFamily = 'Arial';
            combinationElement.style.display = 'flex';
            combinationElement.style.alignItems = 'center';
            combinationElement.style.justifyContent = 'space-between';
            combinationElement.style.position = 'relative';
            combinationElement.style.cursor = 'pointer';
            combinationElement.style.transition = 'background-color 0.2s';

            // Use helper functions to get weapon names and assets
            const weapon1Asset = getWeaponAsset(combo.w1);
            const weapon2Asset = getWeaponAsset(combo.w2);
            const resultAsset = getWeaponAsset(combo.result);
            
            const weapon1Name = getWeaponName(combo.w1);
            const weapon2Name = getWeaponName(combo.w2);
            const resultName = getWeaponName(combo.result);
            
            // Create HTML for combination content with fixed widths
            combinationElement.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; flex: 2;">
                    <div style="text-align: center; width: ${nameWidth}px;">
                        <div class="weapon-icon" data-weapon-type="${combo.w1.tag}" style="width: ${iconSize}px; height: ${iconSize}px; 
                             background-color: rgba(0,0,0,0.3); border-radius: 5px; 
                             display: flex; align-items: center; justify-content: center;
                             cursor: pointer; margin: 0 auto;">
                            <img src="assets/${weapon1Asset}.png" style="max-width: 80%; max-height: 80%; object-fit: contain;" 
                                alt="${weapon1Name}">
                        </div>
                        <div style="font-size: ${isMobile ? '10px' : '12px'}; height: 16px; overflow: hidden; text-overflow: ellipsis;">
                            ${weapon1Name}
                        </div>
                    </div>
                    
                    <span style="font-size: ${isMobile ? '16px' : '20px'}; margin: 0 5px;">+</span>
                    
                    <div style="text-align: center; width: ${nameWidth}px;">
                        <div class="weapon-icon" data-weapon-type="${combo.w2.tag}" style="width: ${iconSize}px; height: ${iconSize}px; 
                             background-color: rgba(0,0,0,0.3); border-radius: 5px; 
                             display: flex; align-items: center; justify-content: center;
                             cursor: pointer; margin: 0 auto;">
                            <img src="assets/${weapon2Asset}.png" style="max-width: 80%; max-height: 80%; object-fit: contain;" 
                                alt="${weapon2Name}">
                        </div>
                        <div style="font-size: ${isMobile ? '10px' : '12px'}; height: 16px; overflow: hidden; text-overflow: ellipsis;">
                            ${weapon2Name}
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; align-items: center; justify-content: flex-end; flex: 1; gap: 10px;">
                    <span style="font-size: ${isMobile ? '16px' : '24px'}; color: #f39c12;">→</span>
                    
                    <div style="text-align: center; width: ${nameWidth}px;">
                        <div class="weapon-icon" data-weapon-type="${combo.result.tag}" style="width: ${iconSize}px; height: ${iconSize}px; 
                             background-color: rgba(0,0,0,0.3); border-radius: 5px; 
                             display: flex; align-items: center; justify-content: center;
                             border: 1px solid #f39c12;
                             cursor: pointer; margin: 0 auto;">
                            <img src="assets/${resultAsset}.png" style="max-width: 80%; max-height: 80%; object-fit: contain;" 
                                alt="${resultName}">
                        </div>
                        <div style="font-size: ${isMobile ? '10px' : '12px'}; height: 32px; overflow: hidden; text-overflow: ellipsis; color: #f39c12;">
                            ${resultName}
                        </div>
                    </div>
                    
                    <div style="min-width: 40px; width: 40px; text-align: right;">
                        <span style="font-size: ${isMobile ? '12px' : '14px'}; color: #3498db;">Lv.${combo.requiredLevel}</span>
                    </div>
                </div>
            `;

            // Add hover effect
            combinationElement.addEventListener('mouseover', () => {
                combinationElement.style.backgroundColor = 'rgba(52, 152, 219, 0.4)';
            });
            combinationElement.addEventListener('mouseout', () => {
                combinationElement.style.backgroundColor = 'rgba(52, 73, 94, 0.7)';
            });

            // Add click event for the entire combination to show result weapon details
            combinationElement.addEventListener('click', () => {
                this.showDetailsModal(combo.result);
            });
            
            this.combinationsContainer.appendChild(combinationElement);
        });

        // Add click event for individual weapon icons
        const weaponIcons = this.combinationsContainer.querySelectorAll('.weapon-icon');
        weaponIcons.forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering the parent click
                const weaponTypeTag = (icon as HTMLElement).dataset.weaponType || '';
                
                // Find the AttackType object that matches this tag
                let selectedWeapon = null;
                for (const key in AttackType) {
                    if (typeof AttackType[key] === 'object' && AttackType[key] !== null) {
                        const attackType = AttackType[key] as any;
                        if (attackType.tag === weaponTypeTag) {
                            selectedWeapon = attackType;
                            break;
                        }
                    }
                }
                
                // If we found a matching AttackType, show its details
                if (selectedWeapon) {
                    this.showDetailsModal(selectedWeapon);
                }
            });
        });
    }

    private showErrorMessage(message: string) {
        this.combinationsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #e74c3c;">
                <p style="font-size: 18px; margin-bottom: 10px;">⚠️ Error</p>
                <p>${message}</p>
                <p style="font-size: 14px; margin-top: 20px; color: #bdc3c7;">
                    Try refreshing the page or reconnecting to the game.
                </p>
            </div>
        `;
    }

    private showEmptyMessage() {
        this.combinationsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #95a5a6;">
                <p style="font-size: 18px; margin-bottom: 10px;">No weapon combinations found</p>
                <p>Weapon combinations will be added as you progress in the game.</p>
            </div>
        `;
    }

    private createBackButton() {
        const isMobile = isMobileDevice();
        
        this.backButton = document.createElement('button');
        this.backButton.textContent = '← Back';
        this.backButton.style.position = 'fixed'; // Changed from absolute to fixed
        this.backButton.style.zIndex = '1999'; // High z-index, but below modal
        
        if (isMobile) {
            // Mobile-friendly styles - position at bottom center
            this.backButton.style.bottom = '20px';
            this.backButton.style.left = '50%';
            this.backButton.style.transform = 'translateX(-50%)';
            this.backButton.style.top = 'auto'; // Use bottom instead of top
            this.backButton.style.padding = '12px 15px';
            this.backButton.style.fontSize = getResponsiveFontSize(16);
            // Increase touch target size for mobile
            this.backButton.style.minWidth = '80px';
            this.backButton.style.minHeight = '44px';
        } else {
            // Desktop styles - position at bottom left
            this.backButton.style.bottom = '40px';
            this.backButton.style.left = '40px';
            this.backButton.style.top = 'auto'; // Use bottom instead of top
            this.backButton.style.padding = '10px 20px';
            this.backButton.style.fontSize = '18px';
        }
        
        this.backButton.style.backgroundColor = '#2c3e50';
        this.backButton.style.color = 'white';
        this.backButton.style.border = '2px solid #34495e';
        this.backButton.style.borderRadius = '5px';
        this.backButton.style.cursor = 'pointer';
        this.backButton.style.fontFamily = 'Arial';
        this.backButton.style.transition = 'background-color 0.2s, border-color 0.2s';

        this.backButton.addEventListener('mouseover', () => {
            this.backButton.style.backgroundColor = '#3498db';
            this.backButton.style.borderColor = '#2980b9';
        });

        this.backButton.addEventListener('mouseout', () => {
            this.backButton.style.backgroundColor = '#2c3e50';
            this.backButton.style.borderColor = '#34495e';
        });

        this.backButton.addEventListener('click', () => {
            this.scene.start('ClassSelectScene');
        });

        document.body.appendChild(this.backButton);
    }

    private handleResize() {
        // Recreate elements with appropriate sizing for the current screen
        this.createCombinationsContainer();
        this.createBackButton();
        this.createDetailsModal();
    }

    private cleanupHTMLElements() {
        if (this.combinationsContainer && this.combinationsContainer.parentNode) {
            this.combinationsContainer.remove();
        }
        if (this.backButton && this.backButton.parentNode) {
            this.backButton.remove();
        }
        if (this.detailsModal && this.detailsModal.parentNode) {
            this.detailsModal.remove();
        }
        if (this.modalOverlay && this.modalOverlay.parentNode) {
            this.modalOverlay.remove();
        }

        // Remove by ID to be thorough
        const container = document.getElementById('combinations-container');
        if (container && container.parentNode) {
            container.remove();
        }
        const modal = document.getElementById('weapon-details-modal');
        if (modal && modal.parentNode) {
            modal.remove();
        }
        const overlay = document.getElementById('weapon-modal-overlay');
        if (overlay && overlay.parentNode) {
            overlay.remove();
        }
    }

    shutdown() {
        // Remove event listeners
        this.events.off('shutdown', this.shutdown, this);
        this.scale.off('resize', this.handleResize);
        
        // Clean up HTML elements
        this.cleanupHTMLElements();
    }
}

// Utility function to get weapon data from the maps using either an AttackType object or tag string
function getWeaponData<T>(map: Record<string, T>, weapon: AttackType | string, defaultValue: T): T {
    if (typeof weapon === 'string') {
        // If it's a string (tag), use it directly as the key
        return map[weapon] || defaultValue;
    } else {
        // If it's an AttackType object, use its tag property as the key
        return map[weapon.tag] || defaultValue;
    }
}

// Helper functions for each type of weapon data
function getWeaponAsset(weapon: AttackType | string): string {
    return getWeaponData(WEAPON_ASSET_MAP, weapon, 'card_blank');
}

function getWeaponName(weapon: AttackType | string): string {
    return getWeaponData(localization.weaponNames, weapon, 'Unknown Weapon');
}

function getWeaponDescription(weapon: AttackType | string): string {
    return getWeaponData(localization.weaponDescriptions, weapon, 'No information available about this weapon.');
}

function getWeaponStats(weapon: AttackType | string): { damage: number, cooldown: number, range: number, special: string } {
    return getWeaponData(localization.weaponStats, weapon, { damage: 0, cooldown: 0, range: 0, special: 'None' });
}
