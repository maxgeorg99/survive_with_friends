import Phaser from 'phaser';
import SpacetimeDBClient from '../SpacetimeDBClient';
import { GameEvents } from '../constants/GameEvents';
import { localization } from '../utils/localization';
import { isMobileDevice, getResponsiveFontSize, applyResponsiveStyles, getResponsiveDimensions } from '../utils/responsive';

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

        // Add some example quests
        const quests = [
            { title: "Survive 5 Minutes", description: "Stay alive for 5 minutes", reward: "Unlock new upgrade options" },
            { title: "Defeat 100 Monsters", description: "Slay 100 monsters in a single run", reward: "Increase max HP by 10%" },
            { title: "Level Up 5 Times", description: "Reach level 5 in a single run", reward: "New attack pattern" },
            { title: "Collect 50 Gems", description: "Gather 50 gems in one run", reward: "Bonus starting gold" }
        ];

        quests.forEach(quest => {
            const questElement = document.createElement('div');
            questElement.style.backgroundColor = 'rgba(52, 73, 94, 0.7)';
            questElement.style.margin = '10px 0';
            questElement.style.padding = isMobile ? '12px' : '15px';
            questElement.style.borderRadius = '5px';
            questElement.style.border = '1px solid #2980b9';
            questElement.style.color = 'white';
            questElement.style.fontFamily = 'Arial';

            // Responsive font sizes for quest elements
            const titleSize = isMobile ? getResponsiveFontSize(18) : '20px';
            const textSize = isMobile ? getResponsiveFontSize(14) : '16px';

            questElement.innerHTML = `
                <h3 style="margin: 0 0 10px 0; font-size: ${titleSize}; color: #3498db;">${quest.title}</h3>
                <p style="margin: 0 0 10px 0; color: #ecf0f1; font-size: ${textSize};">${quest.description}</p>
                <p style="margin: 0; color: #2ecc71; font-size: ${textSize};">Reward: ${quest.reward}</p>
            `;

            this.questContainer.appendChild(questElement);
        });

        document.body.appendChild(this.questContainer);
    }

    private createBackButton() {
        const isMobile = isMobileDevice();
        
        this.backButton = document.createElement('button');
        this.backButton.textContent = '← Back';
        this.backButton.style.position = 'absolute';
        
        if (isMobile) {
            // Mobile-friendly styles
            this.backButton.style.top = '10px';
            this.backButton.style.left = '10px';
            this.backButton.style.padding = '12px 15px';
            this.backButton.style.fontSize = getResponsiveFontSize(16);
            // Increase touch target size for mobile
            this.backButton.style.minWidth = '80px';
            this.backButton.style.minHeight = '44px';
        } else {
            // Desktop styles
            this.backButton.style.top = '20px';
            this.backButton.style.left = '20px';
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