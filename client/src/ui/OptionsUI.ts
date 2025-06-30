import Phaser from 'phaser';
import { getMusicVolume, setMusicVolume, getSoundVolume, setSoundVolume, initializeGlobalVolumes } from '../managers/VolumeSettings';

// Settings interface for localStorage
interface GameSettings {
    musicVolume: number;
    soundVolume: number;
    pvpEnabled?: boolean;
    optionsVisible?: boolean;
}

// Default settings
const DEFAULT_SETTINGS: GameSettings = {
    musicVolume: 0.7,
    soundVolume: 0.8,
    pvpEnabled: false,
    optionsVisible: false // Default to hidden
};

export default class OptionsUI {
    protected scene: Phaser.Scene;
    protected container!: Phaser.GameObjects.Container;
    protected optionsButton!: Phaser.GameObjects.Text;
    protected isVisible: boolean = false; // Will be set from settings
    protected musicSlider!: SliderControl;
    protected soundSlider!: SliderControl;
    
    // Settings
    protected settings: GameSettings;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        
        // Initialize global volumes first
        initializeGlobalVolumes();
        
        this.settings = this.loadSettings();
        this.createUI();
        this.applySettings();
        
        // Apply visibility setting from localStorage
        this.applyVisibilitySettings();
    }

    protected createUI(): void {
        // Create container in top-left corner
        this.container = this.scene.add.container(20, 20);
        this.container.setScrollFactor(0);
        this.container.setDepth(100000);
        this.container.setVisible(false); // Initial state, will be set by applyVisibilitySettings

        // Create background (taller for Hide button)
        const bg = this.scene.add.rectangle(0, 0, 250, 180, 0x000000, 0.8);
        bg.setStrokeStyle(2, 0xffffff, 0.8);
        bg.setOrigin(0, 0);
        bg.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        
        // Don't make background interactive as it might block slider events
        // bg.setInteractive();

        // Create title
        const title = this.scene.add.text(10, 10, '(O)ptions', {
            fontSize: '20px',
            color: '#ffffff',
            fontStyle: 'bold'
        });
        title.setScrollFactor(0);

        // Create music volume control
        const musicY = 55;
        const musicIcon = this.scene.add.image(25, musicY, 'icon_music').setScale(0.4);
        musicIcon.setScrollFactor(0);
        this.musicSlider = new SliderControl(this.scene, 55, musicY, 150, this.settings.musicVolume, 
            (value: number) => this.onMusicVolumeChanged(value));

        // Create sound volume control
        const soundY = 95;
        const soundIcon = this.scene.add.image(25, soundY, 'icon_sound').setScale(0.4);
        soundIcon.setScrollFactor(0);
        this.soundSlider = new SliderControl(this.scene, 55, soundY, 150, this.settings.soundVolume,
            (value: number) => this.onSoundVolumeChanged(value));

        // Create Hide button
        const hideButton = this.createHideButton();

        // Create Options button (separate from main container)
        this.createOptionsButton();

        // Add elements to container
        this.container.add([bg, title, musicIcon, soundIcon, hideButton]);
        this.container.add(this.musicSlider.getElements());
        this.container.add(this.soundSlider.getElements());
    }

    protected onMusicVolumeChanged(value: number): void {
        this.settings.musicVolume = value;
        this.saveSettings();
        
        // Update global volume
        setMusicVolume(value);
        
        // Apply to music manager
        const musicManager = (this.scene as any).musicManager;
        if (musicManager && musicManager.setVolume) {
            musicManager.setVolume(value);
        }
    }

    protected onSoundVolumeChanged(value: number): void {
        this.settings.soundVolume = value;
        this.saveSettings();
        
        // Update global volume
        setSoundVolume(value);
        
        // Apply to sound manager using the new multiplier method
        const soundManager = (window as any).soundManager;
        if (soundManager && soundManager.setSoundVolumeMultiplier) {
            soundManager.setSoundVolumeMultiplier(value);
        }
    }

    public toggle(): void {
        this.isVisible = !this.isVisible;
        this.container.setVisible(this.isVisible);
        this.optionsButton.setVisible(!this.isVisible);
        this.saveVisibilityState();
    }

    public show(): void {
        this.isVisible = true;
        this.container.setVisible(true);
        this.optionsButton.setVisible(false);
        this.saveVisibilityState();
    }

    public hide(): void {
        this.isVisible = false;
        this.container.setVisible(false);
        this.optionsButton.setVisible(true);
        this.saveVisibilityState();
    }

    public destroy(): void {
        this.musicSlider.destroy();
        this.soundSlider.destroy();
        this.container.destroy();
        if (this.optionsButton) {
            this.optionsButton.destroy();
        }
    }

    // Settings persistence
    protected loadSettings(): GameSettings {
        try {
            const stored = localStorage.getItem('vibesurvivors_settings');
            if (stored) {
                const parsed = JSON.parse(stored);
                const settings = { ...DEFAULT_SETTINGS, ...parsed };
                
                // Sync loaded settings with global volumes
                setMusicVolume(settings.musicVolume);
                setSoundVolume(settings.soundVolume);
                
                return settings;
            }
        } catch (error) {
            console.warn('Failed to load settings from localStorage:', error);
        }
        
        // Use default settings and sync with global volumes
        const defaultSettings = { ...DEFAULT_SETTINGS };
        setMusicVolume(defaultSettings.musicVolume);
        setSoundVolume(defaultSettings.soundVolume);
        
        return defaultSettings;
    }

    protected saveSettings(): void {
        try {
            localStorage.setItem('vibesurvivors_settings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Failed to save settings to localStorage:', error);
        }
    }

    protected applySettings(): void {
        // Sync settings with global volumes
        setMusicVolume(this.settings.musicVolume);
        setSoundVolume(this.settings.soundVolume);
        
        // Apply music volume
        const musicManager = (this.scene as any).musicManager;
        if (musicManager && musicManager.setVolume) {
            musicManager.setVolume(this.settings.musicVolume);
        }

        // Apply sound volume using the new multiplier method
        const soundManager = (window as any).soundManager;
        if (soundManager && soundManager.setSoundVolumeMultiplier) {
            soundManager.setSoundVolumeMultiplier(this.settings.soundVolume);
        }
    }

    protected applyVisibilitySettings(): void {
        this.isVisible = this.settings.optionsVisible ?? false;
        this.container.setVisible(this.isVisible);
        this.optionsButton.setVisible(!this.isVisible); // Options button visible when menu is hidden
    }

    protected saveVisibilityState(): void {
        this.settings.optionsVisible = this.isVisible;
        this.saveSettings();
    }

    public updatePosition(): void {
        // Update position when screen resizes (override in subclasses if needed)
    }

    protected createHideButton(): Phaser.GameObjects.Text {
        const hideY = 135;
        
        // Create Hide button text
        const hideButton = this.scene.add.text(125, hideY, 'Hide', {
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold',
            backgroundColor: '#666666',
            padding: { x: 12, y: 6 }
        });
        hideButton.setOrigin(0.5);
        hideButton.setScrollFactor(0);
        hideButton.setInteractive({ useHandCursor: true });
        
        // Add hover effects
        hideButton.on('pointerover', () => {
            hideButton.setBackgroundColor('#888888');
        });
        
        hideButton.on('pointerout', () => {
            hideButton.setBackgroundColor('#666666');
        });
        
        // Hide menu when clicked
        hideButton.on('pointerdown', () => {
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
            
            this.hide();
        });
        
        return hideButton;
    }

    protected createOptionsButton(): void {
        // Create Options button at top-left of screen
        this.optionsButton = this.scene.add.text(20, 20, '(O)ptions', {
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold',
            backgroundColor: '#444444',
            padding: { x: 12, y: 6 }
        });
        this.optionsButton.setScrollFactor(0);
        this.optionsButton.setDepth(99999); // Just below options menu depth
        this.optionsButton.setInteractive({ useHandCursor: true });
        
        // Add hover effects
        this.optionsButton.on('pointerover', () => {
            this.optionsButton.setBackgroundColor('#666666');
        });
        
        this.optionsButton.on('pointerout', () => {
            this.optionsButton.setBackgroundColor('#444444');
        });
        
        // Show options menu when clicked
        this.optionsButton.on('pointerdown', () => {
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
            
            this.show();
        });
    }
}

// Slider control component
export class SliderControl {
    private scene: Phaser.Scene;
    private x: number;
    private y: number;
    private width: number;
    private value: number;
    private onChange: (value: number) => void;
    
    private track!: Phaser.GameObjects.Rectangle;
    private handle!: Phaser.GameObjects.Rectangle;
    private valueText!: Phaser.GameObjects.Text;
    private isDragging: boolean = false;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, initialValue: number, onChange: (value: number) => void) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.width = width;
        this.value = Math.max(0, Math.min(1, initialValue));
        this.onChange = onChange;
        
        this.createSlider();
        this.setupInteraction();
    }

    private createSlider(): void {
        // Create track (positioned relative to container)
        this.track = this.scene.add.rectangle(this.x + this.width / 2, this.y, this.width, 6, 0x444444);
        
        // Create handle (positioned relative to container)
        const handleX = this.x + (this.value * this.width);
        this.handle = this.scene.add.rectangle(handleX, this.y, 12, 16, 0xffffff);
        this.handle.setInteractive();
        
        // Create value text (positioned relative to container)
        this.valueText = this.scene.add.text(this.x + this.width + 10, this.y - 8, 
            `${Math.round(this.value * 100)}%`, {
            fontSize: '14px',
            color: '#ffffff'
        });
        
        // Set high depth for all slider elements
        this.track.setDepth(100001);
        this.handle.setDepth(100002);
        this.valueText.setDepth(100001);
        
        // CRITICAL: Set scrollFactor for individual elements to fix camera coordinate issues
        this.track.setScrollFactor(0);
        this.handle.setScrollFactor(0);
        this.valueText.setScrollFactor(0);
    }

    private setupInteraction(): void {
        // Handle dragging
        this.handle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.isDragging = true;
        });

        this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (this.isDragging) {
                // Since container has scrollFactor 0, use direct screen coordinates
                // Container is at (20, 20), slider starts at container position + this.x
                const screenX = pointer.x;
                const containerScreenX = 20;
                const sliderScreenStartX = containerScreenX + this.x;
                
                // Calculate new handle position relative to slider start
                const relativeX = screenX - sliderScreenStartX;
                const clampedRelativeX = Phaser.Math.Clamp(relativeX, 0, this.width);
                
                // Set handle position relative to container
                this.handle.x = this.x + clampedRelativeX;
                this.value = clampedRelativeX / this.width;
                this.updateValueText();
                this.onChange(this.value);
            }
        });

        this.scene.input.on('pointerup', () => {
            this.isDragging = false;
        });

        // Allow clicking on track to set value
        this.track.setInteractive();
        this.track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            // Since container has scrollFactor 0, use direct screen coordinates
            // Container is at (20, 20), slider starts at container position + this.x
            const screenX = pointer.x;
            const containerScreenX = 20;
            const sliderScreenStartX = containerScreenX + this.x;
            
            // Calculate click position relative to slider start
            const relativeX = screenX - sliderScreenStartX;
            const clampedRelativeX = Phaser.Math.Clamp(relativeX, 0, this.width);
            
            // Set handle position relative to container
            this.handle.x = this.x + clampedRelativeX;
            this.value = clampedRelativeX / this.width;
            this.updateValueText();
            this.onChange(this.value);
        });
    }

    private updateValueText(): void {
        this.valueText.setText(`${Math.round(this.value * 100)}%`);
    }

    public getElements(): Phaser.GameObjects.GameObject[] {
        return [this.track, this.handle, this.valueText];
    }

    public destroy(): void {
        this.track.destroy();
        this.handle.destroy();
        this.valueText.destroy();
    }
} 