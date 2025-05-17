import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { AchievementDefinition } from '../autobindings';
import { GameEvents } from '../constants/GameEvents';
import { localization } from '../utils/localization';
import { isMobileDevice, getResponsiveFontSize, applyResponsiveStyles, getResponsiveDimensions } from '../utils/responsive';

export default class AchievementScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private achievementContainer!: HTMLDivElement;
    private backButton!: HTMLButtonElement;
    
    constructor() {
        super('AchievementScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
    }

    preload() {
        // Load any achievement-related assets
        this.load.image('achievement_crown', 'assets/achievement_crown.png');
        this.load.image('title_bg', 'assets/title_bg.png');
        
        // Monster images for achievements
        this.load.image('monster_rat', 'assets/monster_rat.png');
        this.load.image('monster_slime', 'assets/monster_slime.png');
        this.load.image('monster_orc', 'assets/monster_orc.png');
        this.load.image('monster_worm', 'assets/monster_worm.png');
        this.load.image('monster_scorpion', 'assets/monster_scorpion.png');
        
        // Boss images for achievements
        this.load.image('boss_jorge', 'assets/final_boss_jorge_phase_1.png');
        this.load.image('boss_bjorn', 'assets/final_boss_phase_björn_1.png');
        this.load.image('boss_simon', 'assets/final_boss_simon_phase_1.png');
        
        // Item images for achievements
        this.load.image('gem_3', 'assets/gem_3.png');
        this.load.image('gem_4', 'assets/gem_4.png');
        this.load.image('attack_cards', 'assets/attack_cards.png');
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
        this.add.text(width/2, height/6, 'ACHIEVEMENTS', {
            fontFamily: 'Arial Black',
            fontSize: `${titleSize}px`,
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: isMobile ? 4 : 6
        }).setOrigin(0.5);

        // Create achievement container
        this.createAchievementList();
        this.createBackButton();

        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Setup cleanup on scene shutdown
        this.events.on('shutdown', this.shutdown, this);
    }

    private createAchievementList() {
        const isMobile = isMobileDevice();
        // Remove any existing achievement container
        const existingContainer = document.getElementById('achievement-container');
        if (existingContainer) existingContainer.remove();

        // Create achievement list container
        this.achievementContainer = document.createElement('div');
        this.achievementContainer.id = 'achievement-container';
        this.achievementContainer.style.position = 'absolute';
        this.achievementContainer.style.left = '50%';
        this.achievementContainer.style.top = '50%';
        this.achievementContainer.style.transform = 'translate(-50%, -50%)';
        
        if (isMobile) {
            // Mobile-friendly styles - reduced width and height
            this.achievementContainer.style.width = '85%'; // Reduced from 90%
            this.achievementContainer.style.maxWidth = '400px'; // Reduced from 450px
            this.achievementContainer.style.maxHeight = '50vh'; // Reduced from 60vh
            this.achievementContainer.style.fontSize = getResponsiveFontSize(14);
        } else {
            // Desktop styles - reduced width and height
            this.achievementContainer.style.width = '600px'; // Reduced from 700px
            this.achievementContainer.style.maxHeight = '450px'; // Reduced from 500px
            this.achievementContainer.style.fontSize = '16px';
        }
        
        this.achievementContainer.style.overflowY = 'auto';
        this.achievementContainer.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.achievementContainer.style.borderRadius = '8px';
        this.achievementContainer.style.border = '2px solid #34495e';
        this.achievementContainer.style.padding = '20px';

        // Fetch achievements from the database
        this.fetchAchievements();

        document.body.appendChild(this.achievementContainer);
    }

    private fetchAchievements() {
        if (!this.spacetimeDBClient || !this.spacetimeDBClient.isConnected) {
            this.showErrorMessage("Not connected to the database");
            return;
        }

        try {
            // Create a local reference to the database connection for cleaner code
            const ctx = this.spacetimeDBClient.sdkConnection;
            if (!ctx || !ctx.db) {
                this.showErrorMessage("Database connection not available");
                return;
            }

            // Get all achievement templates (with player_id = 0) using proper filters
            const achievements = [];
            for (const achievement of ctx.db.achievements.iter()) {
                if (achievement.playerId === 0) {
                    achievements.push(achievement);
                }
            }
            console.log("Fetched achievements:", achievements);
            
            // Sort achievements by ID
            achievements.sort((a, b) => a.achievementsId - b.achievementsId);

            if (achievements.length === 0) {
                this.showEmptyMessage();
                return;
            }

            // Get current player ID and their achievements
            let playerId: number | undefined;
            let playerAchievements: AchievementDefinition[] = [];

            try {
                const clientIdentity = this.spacetimeDBClient.identity;
                if (clientIdentity) {
                    // Find the player with the matching identity by iterating through all players
                    for (const player of ctx.db.player.iter()) {                           
                            // Find all achievements for this player by filtering all achievements
                            for (const achievement of ctx.db.achievements.iter()) {
                                if (achievement.playerId === playerId) {
                                    playerAchievements.push(achievement);
                                }
                            }
                            break;
                    }
                }
            } catch (err) {
                console.error("Error getting player achievements:", err);
            }

            // Display achievements
            this.displayAchievements(achievements, playerAchievements, playerId);
        } catch (error) {
            console.error("Error fetching achievements:", error);
            this.showErrorMessage("Error loading achievements");
        }
    }

    private displayAchievements(
        templates: AchievementDefinition[], 
        playerAchievements: AchievementDefinition[],
        playerId?: number
    ) {
        const isMobile = isMobileDevice();
        
        // Create achievement elements
        templates.forEach(achievement => {
            // Find player's version of this achievement if it exists
            const playerAchievement = playerAchievements.find(
                a => a.achievementTypeType === achievement.achievementTypeType
            );

            // Determine if the achievement is completed
            const isCompleted = playerAchievement?.isCompleted || false;
            
            // Determine progress
            const progress = playerAchievement ? playerAchievement.progress : 0;
            const target = achievement.target;
            const progressPercent = Math.min(100, Math.floor((progress / target) * 100));

            const achievementElement = document.createElement('div');
            achievementElement.style.backgroundColor = isCompleted ? 'rgba(46, 204, 113, 0.2)' : 'rgba(52, 73, 94, 0.7)';
            achievementElement.style.margin = '10px 0';
            achievementElement.style.padding = isMobile ? '12px' : '15px';
            achievementElement.style.borderRadius = '5px';
            achievementElement.style.border = isCompleted ? '1px solid #2ecc71' : '1px solid #2980b9';
            achievementElement.style.color = 'white';
            achievementElement.style.fontFamily = 'Arial';
            achievementElement.style.display = 'flex';
            achievementElement.style.gap = '15px';
            achievementElement.style.position = 'relative';

            // Responsive font sizes for achievement elements
            const titleSize = isMobile ? getResponsiveFontSize(18) : '20px';
            const textSize = isMobile ? getResponsiveFontSize(14) : '16px';

            // Get sprite path without the assets/ prefix
            const spriteName = achievement.spritePath.replace('assets/', '');

            // Create HTML for achievement content
            achievementElement.innerHTML = `
                <div style="flex-shrink: 0; width: ${isMobile ? '40px' : '50px'}; height: ${isMobile ? '40px' : '50px'}; 
                     background-color: rgba(0,0,0,0.3); border-radius: 5px; display: flex; 
                     align-items: center; justify-content: center; position: relative;">
                    <img src="assets/${spriteName}" style="max-width: 80%; max-height: 80%; object-fit: contain;" 
                         alt="${localization.getText(achievement.titleKey)}">
                    ${isCompleted ? `
                        <div style="position: absolute; top: -5px; right: -5px; background-color: #f39c12; 
                             width: 20px; height: 20px; border-radius: 50%; display: flex; 
                             align-items: center; justify-content: center;">
                            <span style="color: white; font-size: 12px;">✓</span>
                        </div>` : ''}
                </div>
                <div style="flex-grow: 1;">
                    <h3 style="margin: 0 0 5px 0; font-size: ${titleSize}; color: ${isCompleted ? '#2ecc71' : '#3498db'};">
                        ${localization.getText(achievement.titleKey)}
                    </h3>
                    <p style="margin: 0 0 10px 0; color: #ecf0f1; font-size: ${textSize};">
                        ${localization.getText(achievement.descriptionKey)}
                    </p>
                    <div style="height: 10px; background-color: rgba(0,0,0,0.3); border-radius: 5px; overflow: hidden;">
                        <div style="height: 100%; width: ${progressPercent}%; background-color: ${isCompleted ? '#2ecc71' : '#3498db'}; 
                             transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <p style="margin: 5px 0 0 0; color: #bdc3c7; font-size: ${isMobile ? getResponsiveFontSize(12) : '14px'}; text-align: right;">
                        ${progress} / ${target} (${progressPercent}%)
                    </p>
                </div>
            `;

            this.achievementContainer.appendChild(achievementElement);
        });
    }

    private showErrorMessage(message: string) {
        this.achievementContainer.innerHTML = `
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
        this.achievementContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #95a5a6;">
                <p style="font-size: 18px; margin-bottom: 10px;">No achievements found</p>
                <p>Achievements will be added as you play the game.</p>
            </div>
        `;
    }

    private createBackButton() {
        const isMobile = isMobileDevice();
        
        this.backButton = document.createElement('button');
        this.backButton.textContent = '← Back';
        this.backButton.style.position = 'absolute';
        
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
        this.createAchievementList();
        this.createBackButton();
    }

    private cleanupHTMLElements() {
        if (this.achievementContainer && this.achievementContainer.parentNode) {
            this.achievementContainer.remove();
        }
        if (this.backButton && this.backButton.parentNode) {
            this.backButton.remove();
        }

        // Remove by ID to be thorough
        const container = document.getElementById('achievement-container');
        if (container && container.parentNode) {
            container.remove();
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