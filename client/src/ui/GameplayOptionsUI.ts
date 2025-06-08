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

        // Create background (taller for PvP option)
        const bg = this.scene.add.rectangle(0, 0, 250, 200, 0x000000, 0.8);
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

        // Add elements to container
        this.container.add([bg, title, musicIcon, soundIcon]);
        this.container.add(this.musicSlider.getElements());
        this.container.add(this.soundSlider.getElements());
        console.log('About to add PvP container to main container. PvP container exists:', !!this.pvpToggle);
        console.log('PvP container children count:', this.pvpToggle ? this.pvpToggle.list.length : 'N/A');
        
        if (this.pvpToggle) {
            console.log('PvP container details before adding to main:');
            this.pvpToggle.list.forEach((child: any, index: number) => {
                console.log(`  PvP Child ${index}: type=${child.type}, text="${child.text || 'N/A'}"`);
            });
        }
        
        this.container.add(this.pvpToggle);
        console.log('Main container children count after adding PvP:', this.container.list.length);
        
        // Check if PvP container is actually in main container
        const pvpContainerInMain = this.container.list.find((child: any) => child === this.pvpToggle);
        console.log('PvP container found in main container:', !!pvpContainerInMain);
    }

    private createPvPToggle(): void {
        const pvpY = 135;
        
        console.log('Creating PvP toggle...');
        
        // Create PvP button
        const buttonTexture = this.settings.pvpEnabled ? 'button_pvp_on' : 'button_pvp_off';
        console.log('Creating PvP button with texture:', buttonTexture);
        
        this.pvpButton = this.scene.add.image(25, pvpY, buttonTexture);
        console.log('PvP button created:', !!this.pvpButton);
        
        this.pvpButton.setScale(0.4);
        this.pvpButton.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        this.pvpButton.setInteractive();
        // Store direct references to UI elements before setting up handlers
        const buttonElement = this.pvpButton;
        const textElement = this.pvpText;
        const settingsRef = this.settings;
        
        this.pvpButton.on('pointerdown', () => {
            console.log('PvP button clicked');
            console.log('Direct refs - button:', !!buttonElement, 'text:', !!textElement);
            console.log('This refs - button:', !!this.pvpButton, 'text:', !!this.pvpText, 'container:', !!this.pvpToggle);
            
            // Toggle setting using direct reference
            settingsRef.pvpEnabled = !settingsRef.pvpEnabled;
            this.saveSettings();
            
            // Update UI using direct references
            if (buttonElement) {
                const buttonTexture = settingsRef.pvpEnabled ? 'button_pvp_on' : 'button_pvp_off';
                buttonElement.setTexture(buttonTexture);
                console.log('PvP button texture updated to:', buttonTexture, 'using direct reference');
            }
            
            // Find text element - try multiple approaches
            let workingTextElement = textElement;
            
            if (!workingTextElement && this.pvpToggle && this.pvpToggle.list.length > 0) {
                console.log('textElement undefined, searching PvP container for text...');
                console.log('PvP container has', this.pvpToggle.list.length, 'children:');
                this.pvpToggle.list.forEach((child: any, index: number) => {
                    console.log(`  PvP Child ${index}: type=${child.type}, text="${child.text || 'N/A'}"`);
                });
                workingTextElement = this.pvpToggle.list.find((child: any) => child.type === 'Text') as Phaser.GameObjects.Text;
                console.log('Found text from PvP container:', !!workingTextElement);
            }
            
            if (!workingTextElement && this.container && this.container.list.length > 0) {
                console.log('Still no text, searching main container...');
                
                // First, search for Container objects within the main container
                const allContainers = this.container.list.filter((child: any) => child.type === 'Container');
                console.log('Found', allContainers.length, 'container objects in main container');
                
                // Search inside each container for Text objects
                for (const container of allContainers) {
                    const containerTexts = (container as any).list.filter((child: any) => child.type === 'Text');
                    console.log('Container has', containerTexts.length, 'text objects:');
                    containerTexts.forEach((text: any, index: number) => {
                        console.log(`  Container Text ${index}: "${text.text}" at position (${text.x}, ${text.y})`);
                        if (text.text && text.text.includes('PvP')) {
                            workingTextElement = text;
                            console.log('Found PvP text in nested container!');
                        }
                    });
                }
                
                // Also search direct children for Text objects
                const allTexts = this.container.list.filter((child: any) => child.type === 'Text') as Phaser.GameObjects.Text[];
                console.log('Found', allTexts.length, 'direct text objects in main container');
                console.log('Direct text objects contents:');
                allTexts.forEach((text, index) => {
                    console.log(`  Text ${index}: "${text.text}" at position (${text.x}, ${text.y})`);
                });
                
                console.log('Final result - Found PvP text:', !!workingTextElement);
            }
            
            // Last resort: try to access through class property which might still exist
            if (!workingTextElement && this.pvpText) {
                console.log('Found text through this.pvpText property!');
                workingTextElement = this.pvpText;
            }
            
            if (workingTextElement) {
                const statusText = settingsRef.pvpEnabled ? 'PvP: On' : 'PvP: Off';
                const textColor = settingsRef.pvpEnabled ? '#ff6666' : '#888888'; // Red when on, grey when off
                console.log('About to update text - current text:', workingTextElement.text, 'new text:', statusText);
                console.log('About to update color - current color:', workingTextElement.style.color, 'new color:', textColor);
                workingTextElement.setText(statusText);
                workingTextElement.setColor(textColor);
                console.log('After update - text:', workingTextElement.text, 'color:', workingTextElement.style.color);
                console.log('PvP text updated to:', statusText, 'using', textElement ? 'direct reference' : 'container search');
            } else {
                console.error('Could not find text element - checked direct reference and container');
                if (this.pvpToggle) {
                    console.log('PvP Container exists with', this.pvpToggle.list.length, 'children:');
                    this.pvpToggle.list.forEach((child: any, index: number) => {
                        console.log(`  Child ${index}: type=${child.type}, name=${child.name || 'unnamed'}`);
                    });
                }
            }
            
            console.log('PvP mode toggled to:', settingsRef.pvpEnabled ? 'ON' : 'OFF');
            
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
        });
        
        console.log('PvP button methods available - setTint:', typeof this.pvpButton.setTint, 'clearTint:', typeof this.pvpButton.clearTint);
        
        // Add hover effects with null checks and method verification
        this.pvpButton.on('pointerover', () => {
            if (this.pvpButton) {
                if (typeof this.pvpButton.setTint === 'function') {
                    this.pvpButton.setTint(0xcccccc);
                } else {
                    // Alternative: use alpha for hover effect
                    this.pvpButton.setAlpha(0.7);
                    console.log('PvP button hover - using alpha instead of tint');
                }
            }
        });
        this.pvpButton.on('pointerout', () => {
            if (this.pvpButton) {
                if (typeof this.pvpButton.clearTint === 'function') {
                    this.pvpButton.clearTint();
                } else {
                    // Alternative: reset alpha
                    this.pvpButton.setAlpha(1.0);
                    console.log('PvP button hover end - using alpha instead of tint');
                }
            }
        });

        // Create PvP status text
        const statusText = this.settings.pvpEnabled ? 'PvP: On' : 'PvP: Off';
        const initialColor = this.settings.pvpEnabled ? '#ff6666' : '#888888';
        console.log('Creating PvP text with initial text:', statusText, 'color:', initialColor);
        
        this.pvpText = this.scene.add.text(55, pvpY - 8, statusText, {
            fontSize: '16px',
            color: initialColor, // Red when on, grey when off
            fontStyle: 'bold'
        });
        this.pvpText.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        
        console.log('PvP text created - text:', this.pvpText.text, 'color:', this.pvpText.style.color, 'position:', this.pvpText.x, this.pvpText.y);

        // Store references before adding to container (in case container changes them)
        const preContainerButtonRef = this.pvpButton;
        const preContainerTextRef = this.pvpText;
        
        // Create container for PvP elements
        this.pvpToggle = this.scene.add.container(0, 0);
        this.pvpToggle.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        
        console.log('About to add elements to PvP container. Button exists:', !!this.pvpButton, 'Text exists:', !!this.pvpText);
        if (this.pvpText) {
            console.log('PvP text details - text:', this.pvpText.text, 'position:', this.pvpText.x, this.pvpText.y);
        }
        
        this.pvpToggle.add([this.pvpButton, this.pvpText]);
        
        console.log('PvP container created with elements:', this.pvpToggle.list.length);
        console.log('PvP container children after adding:');
        this.pvpToggle.list.forEach((child: any, index: number) => {
            console.log(`  Container Child ${index}: type=${child.type}, text="${child.text || 'N/A'}"`);
        });
        
        console.log('Before container - pvpButton exists:', !!preContainerButtonRef, 'pvpText exists:', !!preContainerTextRef);
        console.log('After container - pvpButton exists:', !!this.pvpButton, 'pvpText exists:', !!this.pvpText);
        console.log('References equal:', preContainerButtonRef === this.pvpButton, preContainerTextRef === this.pvpText);
    }

    public destroy(): void {
        if (this.pvpToggle) {
            this.pvpToggle.destroy();
        }
        super.destroy();
    }
}

 