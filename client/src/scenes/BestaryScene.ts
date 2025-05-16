import Phaser from 'phaser';
import { localization } from '../utils/localization';
import { MonsterType } from '../autobindings/monster_type_type';

export default class BestaryScene extends Phaser.Scene {
    // UI elements
    private titleText!: Phaser.GameObjects.Text;
    private descriptionText!: Phaser.GameObjects.Text;
    private monstersList!: HTMLDivElement;
    private monsterDetailsPanel!: HTMLDivElement;
    private backButton!: HTMLButtonElement;
    private commonMonstersTab!: HTMLButtonElement;
    private bossesTab!: HTMLButtonElement;
    private phaseToggleButton!: HTMLButtonElement;
    
    // Track current selected monster and view state
    private selectedMonster: MonsterType | null = null;
    private selectedMonsterPhase: number = 1; // Default to phase 1
    private currentTab: 'common' | 'bosses' = 'common'; // Track active tab

    // Monster image mapping
    private monsterImageMapping: Record<string, string> = {
        "Rat": 'monster_rat.png',
        "Slime": 'monster_slime.png',
        "Orc": 'monster_orc.png',
        "Wolf": 'monster_wolf.png',
        "Worm": 'monster_worm.png',
        "Scorpion": 'monster_scorpion.png',
        "FinalBossPhase1": 'final_boss_phase_1.png',
        "FinalBossPhase2": 'final_boss_phase_2.png',
        "FinalBossJorgePhase1": 'final_boss_jorge_phase_1.png',
        "FinalBossJorgePhase2": 'final_boss_jorge_phase_2.png',
        "FinalBossBjornPhase1": 'final_boss_phase_björn_1.png',
        "FinalBossBjornPhase2": 'final_boss_phase_björn_2.png',
        "FinalBossSimonPhase1": 'final_boss_simon_phase_1.png',
        "FinalBossSimonPhase2": 'final_boss_simon_phase_2.png'
    };

    constructor() {
        super('BestaryScene');
    }

    init() {
        // No initialization needed - using static data
    }

    preload() {
        // Load monster images if not already loaded
        this.load.image('monster_rat', 'assets/monster_rat.png');
        this.load.image('monster_slime', 'assets/monster_slime.png');
        this.load.image('monster_orc', 'assets/monster_orc.png');
        this.load.image('monster_wolf', 'assets/monster_wolf.png');
        this.load.image('monster_worm', 'assets/monster_worm.png');
        this.load.image('monster_scorpion', 'assets/monster_scorpion.png');
        this.load.image('final_boss_jorge_phase_1', 'assets/final_boss_jorge_phase_1.png');
        this.load.image('final_boss_jorge_phase_2', 'assets/final_boss_jorge_phase_2.png');
        this.load.image('final_boss_phase_bjorn_1', 'assets/final_boss_phase_björn_1.png');
        this.load.image('final_boss_phase_bjorn_2', 'assets/final_boss_phase_björn_2.png');
        this.load.image('final_boss_simon_phase_1', 'assets/final_boss_simon_phase_1.png');
        this.load.image('final_boss_simon_phase_2', 'assets/final_boss_simon_phase_2.png');
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        
        // Set background color
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
        
        // Add title
        this.titleText = this.add.text(width/2, 60, localization.getText('ui.bestiary.title'), {
            fontFamily: 'Arial Black',
            fontSize: '36px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        
        // Add description
        this.descriptionText = this.add.text(width/2, 110, localization.getText('ui.bestiary.description'), {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 2,
            wordWrap: { width: width * 0.8 }
        }).setOrigin(0.5);
        
        // Create the tab buttons for monster categories
        this.createTabButtons();
        
        // Create the monsters list panel (default to common monsters)
        this.createMonstersList();
        
        // Create the monster details panel
        this.createMonsterDetailsPanel();
        
        // Create the phase toggle button (hidden initially)
        this.createPhaseToggleButton();
        
        // Create back button
        this.createBackButton();
        
        // Position all HTML elements
        this.positionHTMLElements();
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Clean up on shutdown
        this.events.on('shutdown', this.shutdown, this);
    }
    
    private createMonstersList() {
        // Remove any existing list
        const existingList = document.getElementById('bestiary-monsters-list');
        if (existingList) existingList.remove();
        
        // Create monsters list container
        this.monstersList = document.createElement('div');
        this.monstersList.id = 'bestiary-monsters-list';
        this.monstersList.style.position = 'absolute';
        this.monstersList.style.overflow = 'auto';
        this.monstersList.style.width = '220px';
        this.monstersList.style.maxHeight = '500px';
        this.monstersList.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.monstersList.style.border = '2px solid #34495e';
        this.monstersList.style.borderRadius = '8px';
        this.monstersList.style.padding = '10px';
        
        // Define the monster types to show based on current tab
        let monstersToShow: MonsterType[] = [];
        if (this.currentTab === 'common') {
            monstersToShow = [
                MonsterType.Rat, 
                MonsterType.Slime, 
                MonsterType.Orc, 
                MonsterType.Wolf, 
                MonsterType.Worm, 
                MonsterType.Scorpion
            ];
        } else {
            // Only show Phase 1 bosses in the list
            monstersToShow = [
                MonsterType.FinalBossJorgePhase1, 
                MonsterType.FinalBossBjornPhase1, 
                MonsterType.FinalBossSimonPhase1
            ];
        }
        
        // Populate the monsters list
        monstersToShow.forEach(monsterType => {
            const monsterButton = document.createElement('button');
            monsterButton.className = 'bestiary-monster-button';
            monsterButton.setAttribute('data-monster-type', monsterType.toString());
            monsterButton.style.display = 'flex';
            monsterButton.style.alignItems = 'center';
            monsterButton.style.width = '100%';
            monsterButton.style.padding = '8px';
            monsterButton.style.marginBottom = '5px';
            monsterButton.style.backgroundColor = '#2c3e50';
            monsterButton.style.border = '1px solid #34495e';
            monsterButton.style.borderRadius = '4px';
            monsterButton.style.cursor = 'pointer';
            monsterButton.style.color = 'white';
            monsterButton.style.textAlign = 'left';
            monsterButton.style.transition = 'background-color 0.2s';
            
            // Add monster icon if available
            try {
                const iconFile = this.monsterImageMapping[monsterType.tag];
                if (iconFile) {
                    const icon = document.createElement('img');
                    icon.src = 'assets/' + iconFile;
                    icon.style.width = '40px';
                    icon.style.height = '40px';
                    icon.style.marginRight = '10px';
                    icon.style.objectFit = 'contain';
                    monsterButton.appendChild(icon);
                }
            } catch (error) {
                console.error(`Error adding icon for monster type ${monsterType.tag}:`, error);
            }
            
            // Add monster name
            const textSpan = document.createElement('span');
            textSpan.textContent = localization.getText(`bestiary.monster.${monsterType.tag}.name`);
            monsterButton.appendChild(textSpan);
            
            // Add event listener
            monsterButton.addEventListener('click', () => {
                // Using type assertion to ensure TypeScript accepts this as a valid MonsterType
                this.selectMonster(monsterType as MonsterType);
                
                // Highlight the selected button
                document.querySelectorAll('.bestiary-monster-button').forEach(btn => {
                    (btn as HTMLButtonElement).style.backgroundColor = '#2c3e50';
                });
                monsterButton.style.backgroundColor = '#3498db';
            });
            
            // Add hover effects
            monsterButton.addEventListener('mouseover', () => {
                if (this.selectedMonster !== monsterType) {
                    monsterButton.style.backgroundColor = '#34495e';
                }
            });
            
            monsterButton.addEventListener('mouseout', () => {
                if (this.selectedMonster !== monsterType) {
                    monsterButton.style.backgroundColor = '#2c3e50';
                }
            });
            
            this.monstersList.appendChild(monsterButton);
        });
        
        document.body.appendChild(this.monstersList);
    }
    
    private createMonsterDetailsPanel() {
        // Remove any existing panel
        const existingPanel = document.getElementById('bestiary-details-panel');
        if (existingPanel) existingPanel.remove();
        
        // Create monster details panel
        this.monsterDetailsPanel = document.createElement('div');
        this.monsterDetailsPanel.id = 'bestiary-details-panel';
        this.monsterDetailsPanel.style.position = 'absolute';
        this.monsterDetailsPanel.style.width = '450px';
        this.monsterDetailsPanel.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.monsterDetailsPanel.style.border = '2px solid #34495e';
        this.monsterDetailsPanel.style.borderRadius = '8px';
        this.monsterDetailsPanel.style.padding = '20px';
        this.monsterDetailsPanel.style.color = 'white';
        this.monsterDetailsPanel.style.display = 'none'; // Initially hidden
        
        // Add default content
        this.monsterDetailsPanel.innerHTML = `
            <div style="text-align: center; padding: 40px 0;">
                <p style="color: #95a5a6; font-style: italic;">
                    ${localization.getText('ui.bestiary.select_monster')}
                </p>
            </div>
        `;
        
        document.body.appendChild(this.monsterDetailsPanel);
    }
    
    private createBackButton() {
        // Remove any existing button
        const existingButton = document.getElementById('bestiary-back-button');
        if (existingButton) existingButton.remove();
        
        // Create back button
        this.backButton = document.createElement('button');
        this.backButton.id = 'bestiary-back-button';
        this.backButton.textContent = localization.getText('ui.back');
        this.backButton.style.position = 'absolute';
        this.backButton.style.padding = '10px 20px';
        this.backButton.style.backgroundColor = '#2c3e50';
        this.backButton.style.color = 'white';
        this.backButton.style.border = '2px solid #34495e';
        this.backButton.style.borderRadius = '5px';
        this.backButton.style.cursor = 'pointer';
        this.backButton.style.fontSize = '16px';
        
        // Add hover effects
        this.backButton.addEventListener('mouseover', () => {
            this.backButton.style.backgroundColor = '#3498db';
            this.backButton.style.borderColor = '#2980b9';
        });
        
        this.backButton.addEventListener('mouseout', () => {
            this.backButton.style.backgroundColor = '#2c3e50';
            this.backButton.style.borderColor = '#34495e';
        });
        
        // Add click handler
        this.backButton.addEventListener('click', () => {
            this.scene.start('ClassSelectScene');
        });
        
        document.body.appendChild(this.backButton);
    }
    
    private positionHTMLElements() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        
        // Calculate positions for a centered layout
        const panelSpacing = 30; // Space between panels
        const totalContentWidth = 220 + panelSpacing + 450; // monsters list width + spacing + details panel width
        const leftOffset = (width - totalContentWidth) / 2; // Center the entire content area
        const tabHeight = 45; // Estimated height of the tab buttons
        const verticalSpacing = 20; // Additional spacing between tabs and content
        
        // Position tab container
        const tabContainer = document.getElementById('bestiary-tabs-container');
        if (tabContainer) {
            tabContainer.style.left = `${leftOffset}px`;
            tabContainer.style.top = `${height * 0.22 - tabHeight}px`; // Position tabs closer to 22% height
            tabContainer.style.width = `${totalContentWidth}px`; // Match content width exactly
        }
        
        // Position monsters list in the center-left, below the tabs
        this.monstersList.style.left = `${leftOffset}px`;
        this.monstersList.style.top = `${height * 0.22 + verticalSpacing}px`; // Position below tabs + spacing
        this.monstersList.style.maxHeight = `${height * 0.60}px`; // Adjusted height to avoid overlap
        
        // Position monster details panel in the center-right, aligned with the monster list
        this.monsterDetailsPanel.style.left = `${leftOffset + 220 + panelSpacing}px`;
        this.monsterDetailsPanel.style.top = `${height * 0.22 + verticalSpacing}px`; // Same vertical position as monster list
        this.monsterDetailsPanel.style.maxHeight = `${height * 0.60}px`; // Adjusted height to avoid overlap
        
        // Position back button at the bottom center
        this.backButton.style.left = `${width * 0.5 - 50}px`;
        this.backButton.style.top = `${height - 70}px`; // Moved up slightly to avoid edges
        
        // Position phase toggle button on the right side of the details panel
        const detailsPanelRight = leftOffset + 220 + panelSpacing + 450; // Left position + width of the panel
        this.phaseToggleButton.style.left = `${detailsPanelRight - 120}px`; // Align to the right with some margin
        this.phaseToggleButton.style.top = `${height * 0.22 + verticalSpacing + 15}px`; // Align near the top of the details panel
    }
    
    private handleResize() {
        this.positionHTMLElements();
    }
    
    private selectMonster(monsterType: MonsterType) {
        this.selectedMonster = monsterType;
        
        // Show the details panel
        this.monsterDetailsPanel.style.display = 'block';
        
        // Update the display with the selected monster
        this.updateMonsterDisplay(monsterType);

        // Show phase toggle button for bosses
        if (this.currentTab === 'bosses') {
            this.phaseToggleButton.style.display = 'block';
            this.phaseToggleButton.textContent = this.selectedMonsterPhase === 1 ? 'Show Phase 2' : 'Show Phase 1';
        } else {
            this.phaseToggleButton.style.display = 'none';
        }
    }
    
    shutdown() {
        console.log("BestaryScene shutdown called");
        
        // Clean up HTML elements
        if (this.monstersList && this.monstersList.parentNode) {
            this.monstersList.remove();
        }
        
        if (this.monsterDetailsPanel && this.monsterDetailsPanel.parentNode) {
            this.monsterDetailsPanel.remove();
        }
        
        if (this.backButton && this.backButton.parentNode) {
            this.backButton.remove();
        }
        
        if (this.commonMonstersTab && this.commonMonstersTab.parentNode) {
            this.commonMonstersTab.remove();
        }
        
        if (this.bossesTab && this.bossesTab.parentNode) {
            this.bossesTab.remove();
        }
        
        if (this.phaseToggleButton && this.phaseToggleButton.parentNode) {
            this.phaseToggleButton.remove();
        }
        
        // Remove any other elements by ID
        const listElement = document.getElementById('bestiary-monsters-list');
        if (listElement && listElement.parentNode) {
            listElement.remove();
        }
        
        const detailsElement = document.getElementById('bestiary-details-panel');
        if (detailsElement && detailsElement.parentNode) {
            detailsElement.remove();
        }
        
        const backButtonElement = document.getElementById('bestiary-back-button');
        if (backButtonElement && backButtonElement.parentNode) {
            backButtonElement.remove();
        }
        
        const tabContainerElement = document.getElementById('bestiary-tabs-container');
        if (tabContainerElement && tabContainerElement.parentNode) {
            tabContainerElement.remove();
        }
        
        const phaseToggleElement = document.getElementById('bestiary-phase-toggle');
        if (phaseToggleElement && phaseToggleElement.parentNode) {
            phaseToggleElement.remove();
        }
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }

    private createTabButtons() {
        // Remove any existing tab buttons
        const existingCommonTab = document.getElementById('bestiary-common-tab');
        if (existingCommonTab) existingCommonTab.remove();
        
        const existingBossesTab = document.getElementById('bestiary-bosses-tab');
        if (existingBossesTab) existingBossesTab.remove();
        
        // Create tab container
        const tabContainer = document.createElement('div');
        tabContainer.id = 'bestiary-tabs-container';
        tabContainer.style.position = 'absolute';
        tabContainer.style.display = 'flex';
        tabContainer.style.gap = '5px';
        tabContainer.style.justifyContent = 'center'; // Center the tabs
        tabContainer.style.width = '700px'; // Same width as content area
        
        // Common monsters tab - increased size and padding
        this.commonMonstersTab = document.createElement('button');
        this.commonMonstersTab.id = 'bestiary-common-tab';
        this.commonMonstersTab.textContent = localization.getText('bestiary.category.common');
        this.commonMonstersTab.style.padding = '12px 25px'; // Increased padding
        this.commonMonstersTab.style.backgroundColor = '#3498db'; // Active by default
        this.commonMonstersTab.style.color = 'white';
        this.commonMonstersTab.style.border = '2px solid #34495e';
        this.commonMonstersTab.style.borderRadius = '5px 5px 0 0';
        this.commonMonstersTab.style.cursor = 'pointer';
        this.commonMonstersTab.style.fontSize = '16px'; // Larger font
        this.commonMonstersTab.style.fontWeight = 'bold';
        this.commonMonstersTab.style.width = '50%'; // Make tabs equal width
        this.commonMonstersTab.style.textAlign = 'center';
        
        // Bosses tab - increased size and padding
        this.bossesTab = document.createElement('button');
        this.bossesTab.id = 'bestiary-bosses-tab';
        this.bossesTab.textContent = localization.getText('bestiary.category.bosses');
        this.bossesTab.style.padding = '12px 25px'; // Increased padding
        this.bossesTab.style.backgroundColor = '#2c3e50'; // Inactive
        this.bossesTab.style.color = 'white';
        this.bossesTab.style.border = '2px solid #34495e';
        this.bossesTab.style.borderRadius = '5px 5px 0 0';
        this.bossesTab.style.cursor = 'pointer';
        this.bossesTab.style.fontSize = '16px'; // Larger font
        this.bossesTab.style.fontWeight = 'bold';
        this.bossesTab.style.width = '50%'; // Make tabs equal width
        this.bossesTab.style.textAlign = 'center';
        
        // Add click handlers
        this.commonMonstersTab.addEventListener('click', () => {
            if (this.currentTab !== 'common') {
                this.currentTab = 'common';
                this.updateTabAppearance();
                this.refreshMonstersList();
                this.phaseToggleButton.style.display = 'none'; // Hide phase toggle for common monsters
            }
        });
        
        this.bossesTab.addEventListener('click', () => {
            if (this.currentTab !== 'bosses') {
                this.currentTab = 'bosses';
                this.updateTabAppearance();
                this.refreshMonstersList();
                // Don't show phase toggle button yet - wait until a boss is selected
            }
        });
        
        // Add tabs to container
        tabContainer.appendChild(this.commonMonstersTab);
        tabContainer.appendChild(this.bossesTab);
        
        // Add to document
        document.body.appendChild(tabContainer);
        
        // Position the tabs
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        const panelSpacing = 30;
        const totalContentWidth = 220 + panelSpacing + 450;
        const leftOffset = (width - totalContentWidth) / 2;
        
        tabContainer.style.left = `${leftOffset}px`;
        tabContainer.style.top = `${height * 0.20 - this.commonMonstersTab.offsetHeight}px`;
    }
    
    private updateTabAppearance() {
        if (this.currentTab === 'common') {
            this.commonMonstersTab.style.backgroundColor = '#3498db'; // Active
            this.bossesTab.style.backgroundColor = '#2c3e50'; // Inactive
        } else {
            this.commonMonstersTab.style.backgroundColor = '#2c3e50'; // Inactive
            this.bossesTab.style.backgroundColor = '#3498db'; // Active
        }
    }
    
    private refreshMonstersList() {
        // Clear selection
        this.selectedMonster = null;
        this.selectedMonsterPhase = 1;
        this.monsterDetailsPanel.style.display = 'none';
        
        // Recreate the list with the appropriate monsters
        this.createMonstersList();
        this.positionHTMLElements();
    }

    private createPhaseToggleButton() {
        // Remove any existing button
        const existingButton = document.getElementById('bestiary-phase-toggle');
        if (existingButton) existingButton.remove();
        
        // Create phase toggle button
        this.phaseToggleButton = document.createElement('button');
        this.phaseToggleButton.id = 'bestiary-phase-toggle';
        this.phaseToggleButton.textContent = 'Show Phase 2';
        this.phaseToggleButton.style.position = 'absolute';
        this.phaseToggleButton.style.padding = '8px 12px';
        this.phaseToggleButton.style.backgroundColor = '#e67e22';
        this.phaseToggleButton.style.color = 'white';
        this.phaseToggleButton.style.border = '2px solid #d35400';
        this.phaseToggleButton.style.borderRadius = '4px';
        this.phaseToggleButton.style.cursor = 'pointer';
        this.phaseToggleButton.style.fontSize = '14px';
        this.phaseToggleButton.style.fontWeight = 'bold';
        this.phaseToggleButton.style.display = 'none'; // Hidden by default
        
        // Add hover effects
        this.phaseToggleButton.addEventListener('mouseover', () => {
            this.phaseToggleButton.style.backgroundColor = '#d35400';
        });
        
        this.phaseToggleButton.addEventListener('mouseout', () => {
            this.phaseToggleButton.style.backgroundColor = '#e67e22';
        });
        
        // Add click handler
        this.phaseToggleButton.addEventListener('click', () => {
            this.toggleBossPhase();
        });
        
        document.body.appendChild(this.phaseToggleButton);
    }
    
    private toggleBossPhase() {
        // Only applicable for boss monsters
        if (!this.selectedMonster || this.currentTab !== 'bosses') return;
        
        // Toggle phase and update display
        this.selectedMonsterPhase = this.selectedMonsterPhase === 1 ? 2 : 1;
        
        // Update button text
        this.phaseToggleButton.textContent = this.selectedMonsterPhase === 1 ? 'Show Phase 2' : 'Show Phase 1';
        
        // Get the corresponding monster type for the selected boss and phase
        const currentBossBase = this.selectedMonster.tag.replace('Phase1', '').replace('Phase2', '');
        const newMonsterTypeTag = `${currentBossBase}Phase${this.selectedMonsterPhase}`;
        
        // Find the MonsterType that matches this tag
        let newMonsterType: MonsterType | null = null;
        for (const key in MonsterType) {
            if (typeof MonsterType[key] === 'object' && (MonsterType[key] as any).tag === newMonsterTypeTag) {
                newMonsterType = MonsterType[key] as MonsterType;
                break;
            }
        }
        
        if (newMonsterType) {
            // Update the display with the new phase
            this.updateMonsterDisplay(newMonsterType);
        } else {
            console.error(`Could not find MonsterType for tag: ${newMonsterTypeTag}`);
        }
    }
    
    private updateMonsterDisplay(monsterType: MonsterType) {
        // Get monster details from localization
        const monsterName = localization.getText(`bestiary.monster.${monsterType.tag}.name`);
        const monsterDescription = localization.getText(`bestiary.monster.${monsterType.tag}.description`);
        const monsterTips = localization.getText(`bestiary.monster.${monsterType.tag}.tips`);
        const monsterImageFile = this.monsterImageMapping[monsterType.tag];
        
        // Get monster stats from hardcoded data
        // Note: These values should be updated manually if monster stats change in the backend
        const stats = this.getMonsterStats(monsterType.tag);
        
        // Phase indicator for boss monsters
        const phaseIndicator = this.currentTab === 'bosses' ? 
            `<div style="color: #e67e22; font-weight: bold; margin-top: 5px;">Phase ${this.selectedMonsterPhase}</div>` : '';
        
        // Update the details panel content with the stats
        this.monsterDetailsPanel.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <div>
                        <h2 style="margin: 0; font-size: 24px; color: #3498db;">${monsterName}</h2>
                        ${phaseIndicator}
                    </div>
                </div>
                
                <div style="display: flex; gap: 20px; margin-bottom: 15px;">
                    <div style="flex-shrink: 0; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.3); border-radius: 4px;">
                        <img src="assets/${monsterImageFile}" style="max-width: 100px; max-height: 100px; object-fit: contain;" alt="${monsterName}">
                    </div>
                    
                    <div style="flex-grow: 1;">
                        <p style="margin: 0 0 15px 0; line-height: 1.5;">${monsterDescription}</p>
                    </div>
                </div>
                
                <div style="background-color: rgba(0, 0, 0, 0.2); border-radius: 4px; padding: 15px; margin-bottom: 15px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #f39c12;">Stats</h3>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px;">
                        <div>
                            <div style="color: #e74c3c; font-weight: bold;">HP</div>
                            <div>${stats.hp}</div>
                        </div>
                        <div>
                            <div style="color: #3498db; font-weight: bold;">Speed</div>
                            <div>${stats.speed}</div>
                        </div>
                        <div>
                            <div style="color: #e67e22; font-weight: bold;">Damage</div>
                            <div>${stats.damage}</div>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                        <div>
                            <div style="color: #9b59b6; font-weight: bold;">Size</div>
                            <div>${stats.radius}</div>
                        </div>
                        <div>
                            <div style="color: #2ecc71; font-weight: bold;">XP Value</div>
                            <div>${stats.exp}</div>
                        </div>
                    </div>
                </div>
                
                <div>
                    <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #2ecc71;">Tips</h3>
                    <div style="white-space: pre-line; line-height: 1.5;">${monsterTips}</div>
                </div>
            </div>
        `;
    }

    // Get hardcoded monster stats - update these values manually if monster stats change in the backend
    private getMonsterStats(monsterType: string): { hp: number, speed: number, damage: number, radius: number, exp: number } {
        const monsterStats: Record<string, any> = {
            "Rat": { hp: 10, speed: 160, damage: 1.0, radius: 24, exp: 1 },
            "Slime": { hp: 25, speed: 100, damage: 1.5, radius: 30, exp: 2 },
            "Orc": { hp: 50, speed: 140, damage: 2.0, radius: 40, exp: 5 },
            "Wolf": { hp: 35, speed: 175, damage: 1.8, radius: 34, exp: 3 },
            "Worm": { hp: 20, speed: 80, damage: 0.8, radius: 28, exp: 4 },
            "Scorpion": { hp: 15, speed: 150, damage: 1.2, radius: 26, exp: 2 },
            "FinalBossPhase1": { hp: 500, speed: 120, damage: 25, radius: 92, exp: 100 },
            "FinalBossPhase2": { hp: 500, speed: 150, damage: 40, radius: 245, exp: 500 },
            "FinalBossJorgePhase1": { hp: 500, speed: 120, damage: 25, radius: 92, exp: 100 },
            "FinalBossJorgePhase2": { hp: 500, speed: 150, damage: 40, radius: 245, exp: 500 },
            "FinalBossBjornPhase1": { hp: 500, speed: 120, damage: 25, radius: 92, exp: 100 },
            "FinalBossBjornPhase2": { hp: 500, speed: 150, damage: 40, radius: 245, exp: 500 },
            "FinalBossSimonPhase1": { hp: 500, speed: 120, damage: 25, radius: 92, exp: 100 },
            "FinalBossSimonPhase2": { hp: 500, speed: 50, damage: 10, radius: 245, exp: 500 }
        };
        
        return monsterStats[monsterType] || { hp: 0, speed: 0, damage: 0, radius: 0, exp: 0 };
    }
}