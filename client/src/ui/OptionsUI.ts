import Phaser from 'phaser';

// Settings interface for localStorage
interface GameSettings {
    musicVolume: number;
    soundVolume: number;
    pvpEnabled?: boolean;
}

// Default settings
const DEFAULT_SETTINGS: GameSettings = {
    musicVolume: 0.7,
    soundVolume: 0.8,
    pvpEnabled: false
};

export default class OptionsUI {
    protected scene: Phaser.Scene;
    protected container!: Phaser.GameObjects.Container;
    protected isVisible: boolean = true;
    protected musicSlider!: SliderControl;
    protected soundSlider!: SliderControl;
    
    // Settings
    protected settings: GameSettings;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.settings = this.loadSettings();
        this.createUI();
        this.applySettings();
    }

    protected createUI(): void {
        console.log('Creating Options UI container');
        
        // Create container in top-left corner
        this.container = this.scene.add.container(20, 20);
        this.container.setScrollFactor(0);
        this.container.setDepth(100000); // Much higher depth to ensure it's on top
        this.container.setVisible(true); // Start visible
        
        console.log('Container created at depth:', this.container.depth, 'position:', this.container.x, this.container.y);
        
        // Removed global input test to avoid interference

        // Create background
        const bg = this.scene.add.rectangle(0, 0, 250, 160, 0x000000, 0.8);
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

        // Add elements to container
        this.container.add([bg, title, musicIcon, soundIcon]);
        this.container.add(this.musicSlider.getElements());
        this.container.add(this.soundSlider.getElements());
        
        console.log('All elements added to container. Container children count:', this.container.list.length);
        console.log('Music slider elements:', this.musicSlider.getElements().length);
        console.log('Sound slider elements:', this.soundSlider.getElements().length);
        
        // IMPORTANT: Don't make container interactive as it might block child events
        // this.container.setInteractive();
        
        // Instead, test if individual elements can receive events
        console.log('Container setup complete, testing individual element interactivity...');
    }

    protected onMusicVolumeChanged(value: number): void {
        this.settings.musicVolume = value;
        this.saveSettings();
        
        // Apply to music manager
        const musicManager = (this.scene as any).musicManager;
        if (musicManager && musicManager.setVolume) {
            musicManager.setVolume(value);
        }
    }

    protected onSoundVolumeChanged(value: number): void {
        this.settings.soundVolume = value;
        this.saveSettings();
        
        // Apply to sound manager
        const soundManager = (window as any).soundManager;
        if (soundManager && soundManager.setDefaultVolume) {
            soundManager.setDefaultVolume(value);
        }
    }

    public toggle(): void {
        this.isVisible = !this.isVisible;
        this.container.setVisible(this.isVisible);
    }

    public show(): void {
        this.isVisible = true;
        this.container.setVisible(true);
    }

    public hide(): void {
        this.isVisible = false;
        this.container.setVisible(false);
    }

    public destroy(): void {
        this.musicSlider.destroy();
        this.soundSlider.destroy();
        this.container.destroy();
    }

    // Settings persistence
    protected loadSettings(): GameSettings {
        try {
            const stored = localStorage.getItem('vibesurvivors_settings');
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...DEFAULT_SETTINGS, ...parsed };
            }
        } catch (error) {
            console.warn('Failed to load settings from localStorage:', error);
        }
        return { ...DEFAULT_SETTINGS };
    }

    protected saveSettings(): void {
        try {
            localStorage.setItem('vibesurvivors_settings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Failed to save settings to localStorage:', error);
        }
    }

    protected applySettings(): void {
        // Apply music volume
        const musicManager = (this.scene as any).musicManager;
        if (musicManager && musicManager.setVolume) {
            musicManager.setVolume(this.settings.musicVolume);
        }

        // Apply sound volume
        const soundManager = (window as any).soundManager;
        if (soundManager && soundManager.setDefaultVolume) {
            soundManager.setDefaultVolume(this.settings.soundVolume);
        }
    }

    public updatePosition(): void {
        // Update position when screen resizes (override in subclasses if needed)
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
        console.log('Creating slider at position:', this.x, this.y, 'with width:', this.width);
        
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
        
        console.log('Slider elements created - Track:', this.track.x, this.track.y, 'Handle:', this.handle.x, this.handle.y);
        console.log('Element depths - Track:', this.track.depth, 'Handle:', this.handle.depth);
        console.log('Track bounds:', this.track.getBounds());
        console.log('Handle bounds:', this.handle.getBounds());
    }

    private setupInteraction(): void {
        // Handle dragging
        this.handle.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            console.log('=== SLIDER HANDLE CLICKED ===');
            console.log('Handle click position (screen):', pointer.x, pointer.y);
            console.log('Handle world position:', this.handle.x, this.handle.y);
            console.log('Handle size:', this.handle.width, this.handle.height);
            console.log('=== END HANDLE CLICK ===');
            this.isDragging = true;
        });
        
        // Test hover events to check if basic interaction works
        this.handle.on('pointerover', () => {
            console.log('Handle hover start - basic interaction working');
        });
        
        this.handle.on('pointerout', () => {
            console.log('Handle hover end');
        });
        
        // Also test track hover
        this.track.on('pointerover', () => {
            console.log('Track hover start - track interaction working');
        });
        
        this.track.on('pointerout', () => {
            console.log('Track hover end');
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
            console.log('=== SLIDER TRACK CLICKED ===');
            console.log('Click position (screen):', pointer.x, pointer.y);
            console.log('Track world position:', this.track.x, this.track.y);
            console.log('Track size:', this.track.width, this.track.height);
            console.log('This.x, this.y:', this.x, this.y);
            console.log('Container should be at:', 20, 20);
            
            // Since container has scrollFactor 0, use direct screen coordinates
            // Container is at (20, 20), slider starts at container position + this.x
            const screenX = pointer.x;
            const containerScreenX = 20;
            const sliderScreenStartX = containerScreenX + this.x;
            
            console.log('Calculated slider screen start X:', sliderScreenStartX, '(Container:', containerScreenX, '+ this.x:', this.x, ')');
            
            // Calculate click position relative to slider start
            const relativeX = screenX - sliderScreenStartX;
            const clampedRelativeX = Phaser.Math.Clamp(relativeX, 0, this.width);
            
            console.log('Relative X:', relativeX, 'Clamped:', clampedRelativeX, 'Width:', this.width);
            
            // Set handle position relative to container
            this.handle.x = this.x + clampedRelativeX;
            this.value = clampedRelativeX / this.width;
            this.updateValueText();
            this.onChange(this.value);
            
            console.log('Final slider value:', this.value, 'Handle pos:', this.handle.x);
            console.log('=== END SLIDER TRACK CLICK ===');
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