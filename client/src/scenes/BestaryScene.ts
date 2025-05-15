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
    
    // Track current selected monster
    private selectedMonster: MonsterType | null = null;

    // Monster image mapping
    private monsterImageMapping: Record<string, string> = {
        "Rat": 'monster_rat.png',
        "Slime": 'monster_slime.png',
        "Orc": 'monster_orc.png',
        "Wolf": 'monster_wolf.png',
        "Worm": 'monster_worm.png',
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

    preload() {
        // Load monster images if not already loaded
        this.load.image('monster_rat', 'assets/monster_rat.png');
        this.load.image('monster_slime', 'assets/monster_slime.png');
        this.load.image('monster_orc', 'assets/monster_orc.png');
        this.load.image('monster_wolf', 'assets/monster_wolf.png');
        this.load.image('monster_worm', 'assets/monster_worm.png');
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
        
        // Create the monsters list panel
        this.createMonstersList();
        
        // Create the monster details panel
        this.createMonsterDetailsPanel();
        
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
        this.monstersList.style.width = '220px';
        this.monstersList.style.maxHeight = '500px';
        this.monstersList.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.monstersList.style.border = '2px solid #34495e';
        this.monstersList.style.borderRadius = '8px';
        this.monstersList.style.padding = '10px';
        
        // Define the monster categories and their members
        const monsterCategories = [
            {
                name: localization.getText('bestiary.category.common'),
                types: [MonsterType.Rat, MonsterType.Slime, MonsterType.Orc, MonsterType.Wolf, MonsterType.Worm]
            },
            {
                name: localization.getText('bestiary.category.bosses'),
                types: [
                    MonsterType.FinalBossJorgePhase1, 
                    MonsterType.FinalBossBjornPhase1, 
                    MonsterType.FinalBossSimonPhase1
                ]
            }
        ];
        
        // Populate the monsters list
        monsterCategories.forEach(category => {
            // Add category header
            const categoryHeader = document.createElement('h3');
            categoryHeader.textContent = category.name;
            categoryHeader.style.color = '#3498db';
            categoryHeader.style.borderBottom = '1px solid #3498db';
            categoryHeader.style.paddingBottom = '5px';
            categoryHeader.style.marginBottom = '10px';
            categoryHeader.style.marginTop = '15px';
            this.monstersList.appendChild(categoryHeader);
            
            // Add monsters in this category
            category.types.forEach(monsterType => {
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
        
        // Position monsters list in the center-left
        this.monstersList.style.left = `${leftOffset}px`;
        this.monstersList.style.top = `${height * 0.20}px`;
        this.monstersList.style.maxHeight = `${height * 0.65}px`;
        
        // Position monster details panel in the center-right
        this.monsterDetailsPanel.style.left = `${leftOffset + 220 + panelSpacing}px`;
        this.monsterDetailsPanel.style.top = `${height * 0.20}px`;
        this.monsterDetailsPanel.style.maxHeight = `${height * 0.65}px`;
        
        // Position back button at the bottom center
        this.backButton.style.left = `${width * 0.5 - 50}px`;
        this.backButton.style.top = `${height - 80}px`;
    }
    
    private handleResize() {
        this.positionHTMLElements();
    }
    
    private selectMonster(monsterType: MonsterType) {
        this.selectedMonster = monsterType;
        
        // Show the details panel
        this.monsterDetailsPanel.style.display = 'block';
        
        // Get monster stats
        const monsterName = localization.getText(`bestiary.monster.${monsterType.tag}.name`);
        const monsterDescription = localization.getText(`bestiary.monster.${monsterType.tag}.description`);
        const monsterTips = localization.getText(`bestiary.monster.${monsterType.tag}.tips`);
        const monsterImageFile = this.monsterImageMapping[monsterType.tag];
        
        // Get general stats based on monster type (these would ideally come from the server)
        const statsByType: Record<string, {hp: number, speed: number, damage: number}> = {
            "Rat": { hp: 10, speed: 160, damage: 1 },
            "Slime": { hp: 25, speed: 100, damage: 1.5 },
            "Orc": { hp: 50, speed: 140, damage: 2.0 },
            "Wolf": { hp: 35, speed: 175, damage: 1.8 },
            "Worm": { hp: 20, speed: 80, damage: 0.8 },
            "FinalBossPhase1": { hp: 500, speed: 120, damage: 25 },
            "FinalBossPhase2": { hp: 500, speed: 150, damage: 40 },
            "FinalBossJorgePhase1": { hp: 500, speed: 120, damage: 25 },
            "FinalBossJorgePhase2": { hp: 500, speed: 150, damage: 40 },
            "FinalBossBjornPhase1": { hp: 500, speed: 120, damage: 25 },
            "FinalBossBjornPhase2": { hp: 500, speed: 150, damage: 40 },
            "FinalBossSimonPhase1": { hp: 500, speed: 120, damage: 25 },
            "FinalBossSimonPhase2": { hp: 500, speed: 50, damage: 10 }
        };
        
        const stats = statsByType[monsterType.tag] || { hp: '?', speed: '?', damage: '?' };
        
        // Update the details panel content
        this.monsterDetailsPanel.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <h2 style="margin: 0; font-size: 24px; color: #3498db;">${monsterName}</h2>
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
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
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
                </div>
                
                <div>
                    <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #2ecc71;">Tips</h3>
                    <div style="white-space: pre-line; line-height: 1.5;">${monsterTips}</div>
                </div>
            </div>
        `;
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
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
}