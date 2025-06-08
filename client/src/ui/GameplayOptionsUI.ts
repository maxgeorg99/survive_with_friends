import Phaser from 'phaser';
import OptionsUI, { SliderControl } from './OptionsUI';

export default class GameplayOptionsUI extends OptionsUI {
    private pvpToggle!: Phaser.GameObjects.Container;
    private pvpButton!: Phaser.GameObjects.Image;
    private pvpText!: Phaser.GameObjects.Text;

    protected createUI(): void {
        // Create container in top-left corner
        this.container = this.scene.add.container(20, 20);
        this.container.setScrollFactor(0);
        this.container.setDepth(100000); // Match base OptionsUI depth
        this.container.setVisible(true); // Start visible

        // Create background (taller for PvP option and Hide button)
        const bg = this.scene.add.rectangle(0, 0, 250, 220, 0x000000, 0.8);
        bg.setStrokeStyle(2, 0xffffff, 0.8);
        bg.setOrigin(0, 0);
        bg.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues

        // Create title
        const title = this.scene.add.text(10, 10, '(O)ptions', {
            fontSize: '20px',
            color: '#ffffff',
            fontStyle: 'bold'
        });
        title.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues

        // Create music volume control
        const musicY = 55;
        const musicIcon = this.scene.add.image(25, musicY, 'icon_music').setScale(0.4);
        musicIcon.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        this.musicSlider = new SliderControl(this.scene, 55, musicY, 150, this.settings.musicVolume, 
            (value: number) => this.onMusicVolumeChanged(value));

        // Create sound volume control
        const soundY = 95;
        const soundIcon = this.scene.add.image(25, soundY, 'icon_sound').setScale(0.4);
        soundIcon.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        this.soundSlider = new SliderControl(this.scene, 55, soundY, 150, this.settings.soundVolume,
            (value: number) => this.onSoundVolumeChanged(value));

        // Create PvP toggle
        this.createPvPToggle();

        // Create Hide button (positioned below PvP toggle)
        const hideButton = this.createHideButton();
        hideButton.setPosition(125, 175); // Override position for gameplay version

        // Add elements to container
        this.container.add([bg, title, musicIcon, soundIcon, hideButton]);
        this.container.add(this.musicSlider.getElements());
        this.container.add(this.soundSlider.getElements());
        this.container.add(this.pvpToggle);
    }

    private createPvPToggle(): void {
        const pvpY = 135;
        
        // Create PvP button
        const buttonTexture = this.settings.pvpEnabled ? 'button_pvp_on' : 'button_pvp_off';
        this.pvpButton = this.scene.add.image(25, pvpY, buttonTexture);
        this.pvpButton.setScale(0.4);
        this.pvpButton.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        this.pvpButton.setInteractive();
        
        // Store direct references to UI elements before setting up handlers
        const buttonElement = this.pvpButton;
        const textElement = this.pvpText;
        const settingsRef = this.settings;
        
        this.pvpButton.on('pointerdown', () => {
            // Toggle setting using direct reference
            settingsRef.pvpEnabled = !settingsRef.pvpEnabled;
            this.saveSettings();
            
            // Update button texture using direct reference
            if (buttonElement) {
                const buttonTexture = settingsRef.pvpEnabled ? 'button_pvp_on' : 'button_pvp_off';
                buttonElement.setTexture(buttonTexture);
            }
            
            // Find text element - try multiple approaches since references get corrupted
            let workingTextElement = textElement;
            
            // Search PvP container for text if direct reference failed
            if (!workingTextElement && this.pvpToggle && this.pvpToggle.list.length > 0) {
                workingTextElement = this.pvpToggle.list.find((child: any) => child.type === 'Text') as Phaser.GameObjects.Text;
            }
            
            // Search main container for nested text elements
            if (!workingTextElement && this.container && this.container.list.length > 0) {
                const allContainers = this.container.list.filter((child: any) => child.type === 'Container');
                for (const container of allContainers) {
                    const containerTexts = (container as any).list.filter((child: any) => child.type === 'Text');
                    const pvpText = containerTexts.find((text: any) => text.text && text.text.includes('PvP'));
                    if (pvpText) {
                        workingTextElement = pvpText;
                        break;
                    }
                }
            }
            
            // Update text if found
            if (workingTextElement) {
                const statusText = settingsRef.pvpEnabled ? 'PvP: On' : 'PvP: Off';
                const textColor = settingsRef.pvpEnabled ? '#ff6666' : '#888888';
                workingTextElement.setText(statusText);
                workingTextElement.setColor(textColor);
            }
            
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
        });
        
        // Add hover effects
        this.pvpButton.on('pointerover', () => {
            if (this.pvpButton) {
                if (typeof this.pvpButton.setTint === 'function') {
                    this.pvpButton.setTint(0xcccccc);
                } else {
                    this.pvpButton.setAlpha(0.7);
                }
            }
        });
        this.pvpButton.on('pointerout', () => {
            if (this.pvpButton) {
                if (typeof this.pvpButton.clearTint === 'function') {
                    this.pvpButton.clearTint();
                } else {
                    this.pvpButton.setAlpha(1.0);
                }
            }
        });

        // Create PvP status text
        const statusText = this.settings.pvpEnabled ? 'PvP: On' : 'PvP: Off';
        const initialColor = this.settings.pvpEnabled ? '#ff6666' : '#888888';
        
        this.pvpText = this.scene.add.text(55, pvpY - 8, statusText, {
            fontSize: '16px',
            color: initialColor,
            fontStyle: 'bold'
        });
        this.pvpText.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        
        // Create container for PvP elements
        this.pvpToggle = this.scene.add.container(0, 0);
        this.pvpToggle.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        this.pvpToggle.add([this.pvpButton, this.pvpText]);
    }

    public destroy(): void {
        if (this.pvpToggle) {
            this.pvpToggle.destroy();
        }
        super.destroy();
    }
}

 