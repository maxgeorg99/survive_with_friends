import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import { localization } from '../utils/localization';
import { isMobileDevice, getResponsiveFontSize, applyResponsiveStyles, getResponsiveDimensions } from '../utils/responsive';
import { QuestDefinition, QuestType } from '../autobindings';

export default class QuestScene extends Phaser.Scene {
    private spacetimeDBClient: SpacetimeDBClient;
    private gameEvents: Phaser.Events.EventEmitter;
    private questContainer!: HTMLDivElement;
    private backButton!: HTMLButtonElement;
    
    constructor() {
        super('QuestScene');
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        this.gameEvents = (window as any).gameEvents;
    }

    preload() {
        this.load.image('title_bg', 'assets/title_bg.png');
    }

    create() {
        const { width, height } = this.scale;
        
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
        
        // Add title
        this.add.text(width/2, height/6, 'QUESTS', {
            fontFamily: 'Arial Black',
            fontSize: '48px',
            color: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        // Create quest container
        this.createQuestList();
        this.createBackButton();

        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
        
        // Setup cleanup on scene shutdown
        this.events.on('shutdown', this.shutdown, this);
    }

    private createQuestList() {
        const isMobile = isMobileDevice();
        // Remove any existing quest container
        const existingContainer = document.getElementById('quest-container');
        if (existingContainer) existingContainer.remove();

        // Create quest list container
        this.questContainer = document.createElement('div');
        this.questContainer.id = 'quest-container';
        this.questContainer.style.position = 'absolute';
        this.questContainer.style.left = '50%';
        this.questContainer.style.top = '50%';
        this.questContainer.style.transform = 'translate(-50%, -50%)';
        
        if (isMobile) {
            // Mobile-friendly styles
            this.questContainer.style.width = '90%';
            this.questContainer.style.maxWidth = '450px';
            this.questContainer.style.maxHeight = '60vh';
            this.questContainer.style.fontSize = getResponsiveFontSize(14);
        } else {
            // Desktop styles
            this.questContainer.style.width = '600px';
            this.questContainer.style.maxHeight = '500px';
            this.questContainer.style.fontSize = '16px';
        }
        
        this.questContainer.style.overflowY = 'auto';
        this.questContainer.style.backgroundColor = 'rgba(44, 62, 80, 0.95)';
        this.questContainer.style.borderRadius = '8px';
        this.questContainer.style.border = '2px solid #34495e';
        this.questContainer.style.padding = '20px';

        // Fetch quests from the database
        this.fetchQuests();

        document.body.appendChild(this.questContainer);
    }

    private fetchQuests() {
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

            // Get current player ID and their quests
            const localIdentity = this.spacetimeDBClient.identity;
            if (!localIdentity) {
                this.showErrorMessage("Player identity not available.");
                return;
            }

            try {
                // Collect player quests by iterating through all quests (same pattern as achievements)
                const playerQuests: QuestDefinition[] = [];
                for (const quest of ctx.db.gameQuests.iter()) {
                    if (quest.accountIdentity && quest.accountIdentity.isEqual(localIdentity)) {
                        playerQuests.push(quest);
                    }
                }
                
                this.displayQuests(playerQuests);
            } catch (err) {
                console.error("Error getting player quests:", err);
                this.showErrorMessage("Error loading your quests.");
                return;
            }
            
        } catch (error) {
            console.error("Error fetching quests:", error);
            this.showErrorMessage("Error loading quests");
        }
    }

    // Helper function to get URL placeholders from current player context
    private getQuestFormPlaceholders(questType: QuestType): { placeholder1: string, placeholder2: string } {
        let questTypeName = questType.tag;
        let accountName = 'Unknown';
        
        // Get player name from current context for placeholder2
        try {
            if (this.spacetimeDBClient?.identity && this.spacetimeDBClient?.sdkConnection?.db) {
                // Get account by identity
                const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(
                    this.spacetimeDBClient.identity
                );
                
                if (account) {
                    accountName = account.name || 'Unknown';
                }
            }
        } catch (error) {
            console.warn('Error getting quest form placeholders:', error);
        }
        
        return {
            placeholder1: questTypeName,
            placeholder2: accountName
        };
    }

    // Helper function to generate quest form URL
    private generateQuestFormUrl(questType: QuestType): string {
        const { placeholder1, placeholder2 } = this.getQuestFormPlaceholders(questType);
        const baseUrl = 'https://docs.google.com/forms/d/e/1FAIpQLScWldQCHc1bOYu38-TjlpdEYUG5W2JroykkMNMHcXIZR-kJ-g/viewform?usp=pp_url';
        
        return `${baseUrl}&entry.760909957=${encodeURIComponent(placeholder1)}&entry.303033981=${encodeURIComponent(placeholder2)}`;
    }

    private displayQuests(playerQuests: any[]) {
        // Clear existing quests in the container
        this.questContainer.innerHTML = '';

        // Define quest data with localization keys
        const questDefinitions = [
            { 
                type: QuestType.Til,
                titleKey: "quest.til.title", 
                descriptionKey: "quest.til.description", 
                rewardKey: "quest.til.reward" 
            },
            { 
                type: QuestType.Marc,
                titleKey: "quest.marc.title", 
                descriptionKey: "quest.marc.description", 
                rewardKey: "quest.marc.reward" 
            },
            { 
                type: QuestType.Max,
                titleKey: "quest.max.title", 
                descriptionKey: "quest.max.description", 
                rewardKey: "quest.max.reward" 
            },
            { 
                type: QuestType.Chris,
                titleKey: "quest.chris.title", 
                descriptionKey: "quest.chris.description", 
                rewardKey: "quest.chris.reward" 
            },
            { 
                type: QuestType.Reroll,
                titleKey: "quest.reroll.title", 
                descriptionKey: "quest.reroll.description", 
                rewardKey: "quest.reroll.reward" 
            },
        ];

        questDefinitions.forEach((questDef) => {
            // Find the corresponding quest from the database
            const dbQuest = playerQuests.find(q => 
                q.questTypeType && q.questTypeType.tag === questDef.type.tag
            );
            
            const isCompleted = dbQuest ? dbQuest.isCompleted : false;
            const progress = dbQuest ? dbQuest.progress : 0;
            const maxProgress = dbQuest ? dbQuest.maxProgress : 1;
            const isRerollQuest = questDef.type.tag === 'Reroll';
            
            const questElement = document.createElement('div');
            questElement.style.backgroundColor = isCompleted ? 'rgba(46, 204, 113, 0.2)' : 'rgba(52, 73, 94, 0.7)';
            questElement.style.margin = '10px 0';
            questElement.style.padding = isMobileDevice() ? '12px' : '15px';
            questElement.style.borderRadius = '5px';
            questElement.style.border = isCompleted ? '1px solid #2ecc71' : '1px solid #2980b9';
            questElement.style.color = 'white';
            questElement.style.fontFamily = 'Arial';
            questElement.style.position = 'relative';

            // Responsive font sizes for quest elements
            const titleSize = isMobileDevice() ? getResponsiveFontSize(18) : '20px';
            const textSize = isMobileDevice() ? getResponsiveFontSize(14) : '16px';

            // Progress bar for reroll quest
            let progressBarHtml = '';
            if (isRerollQuest && maxProgress > 1) {
                const progressPercent = Math.min(100, Math.floor((progress / maxProgress) * 100));
                progressBarHtml = `
                    <div style="height: 8px; background-color: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden; margin: 10px 0;">
                        <div style="height: 100%; width: ${progressPercent}%; background-color: ${isCompleted ? '#2ecc71' : '#3498db'}; 
                             transition: width 0.5s ease-in-out;"></div>
                    </div>
                    <p style="margin: 5px 0 0 0; color: #bdc3c7; font-size: ${isMobileDevice() ? getResponsiveFontSize(12) : '14px'}; text-align: right;">
                        ${progress} / ${maxProgress} monsters killed
                    </p>
                `;
            }

            // Create right-side content (checkmark for completed quests, link button for non-completed non-reroll quests)
            let rightSideContent = '';
            if (isCompleted) {
                // Green checkmark on the right for completed quests
                rightSideContent = `
                    <div style="flex-shrink: 0; background-color: #2ecc71; 
                         width: 30px; height: 30px; border-radius: 50%; display: flex; 
                         align-items: center; justify-content: center; margin-top: 5px;">
                        <span style="color: white; font-size: 16px; font-weight: bold;">✓</span>
                    </div>
                `;
            } else if (!isRerollQuest) {
                // Link out button for non-completed, non-reroll quests
                const questFormUrl = this.generateQuestFormUrl(questDef.type);
                rightSideContent = `
                    <div style="flex-shrink: 0; margin-top: 5px;">
                        <button onclick="window.open('${questFormUrl}', '_blank')" 
                                style="background-color: #3498db; color: white; border: none; 
                                       border-radius: 4px; padding: 8px 12px; cursor: pointer;
                                       font-size: 12px; font-weight: bold; transition: background-color 0.2s;
                                       display: flex; align-items: center; gap: 4px;"
                                onmouseover="this.style.backgroundColor='#2980b9'"
                                onmouseout="this.style.backgroundColor='#3498db'">
                            <span style="font-size: 10px;">Upload ↗</span>
                        </button>
                    </div>
                `;
            }

            questElement.innerHTML = `
                <div style="display: flex; align-items: flex-start; gap: 15px;">
                    <div style="flex-grow: 1;">
                        <h3 style="margin: 0 0 10px 0; font-size: ${titleSize}; color: ${isCompleted ? '#2ecc71' : '#3498db'};">
                            ${localization.getText(questDef.titleKey)}
                        </h3>
                        <p style="margin: 0 0 10px 0; color: #ecf0f1; font-size: ${textSize};">
                            ${localization.getText(questDef.descriptionKey)}
                        </p>
                        ${progressBarHtml}
                        <p style="margin: 0; color: ${isCompleted ? '#2ecc71' : '#f39c12'}; font-size: ${textSize}; font-weight: bold;">
                            ${isCompleted ? 'COMPLETED!' : localization.getText(questDef.rewardKey)}
                        </p>
                    </div>
                    ${rightSideContent}
                </div>
            `;

            this.questContainer.appendChild(questElement);
        });
        
        if (playerQuests.length === 0) {
            this.questContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #95a5a6;">
                    <p style="font-size: 18px; margin-bottom: 10px;">No quests found</p>
                    <p>Quests should be created when you first spawn. Try restarting the game.</p>
                </div>
            `;
        }
    }

    private showErrorMessage(message: string) {
        this.questContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #e74c3c;">
                <p style="font-size: 18px; margin-bottom: 10px;">⚠️ Error</p>
                <p>${message}</p>
                <p style="font-size: 14px; margin-top: 20px; color: #bdc3c7;">
                    Try refreshing the page or reconnecting to the game.
                </p>
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
        this.createQuestList();
        this.createBackButton();
        
        // Adjust title text size based on screen
        const { width, height } = this.scale;
        const isMobile = isMobileDevice();
        
        // Find the title text and update its font size
        this.children.list.forEach(child => {
            if (child instanceof Phaser.GameObjects.Text && child.text === 'QUESTS') {
                child.setFontSize(isMobile ? parseInt(getResponsiveFontSize(36)) : 48);
            }
        });
    }

    private cleanupHTMLElements() {
        if (this.questContainer && this.questContainer.parentNode) {
            this.questContainer.remove();
        }
        if (this.backButton && this.backButton.parentNode) {
            this.backButton.remove();
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