import Phaser from 'phaser';
import OptionsUI, { SliderControl } from './OptionsUI';
import { SetPlayerPvpMode } from '../autobindings/set_player_pvp_mode_reducer';

export default class GameplayOptionsUI extends OptionsUI {
    private pvpToggle!: Phaser.GameObjects.Container;
    private spacetimeDBClient: any;
    private currentPlayerPvpStatus: boolean = false;

    constructor(scene: Phaser.Scene) {
        super(scene);
        
        // Get reference to SpacetimeDB client (same pattern as other scenes)
        this.spacetimeDBClient = (window as any).spacetimeDBClient;
        
        // Listen for player updates to keep PvP status in sync
        this.setupPvpStatusListener();
        
        // Initialize PvP status from current player data
        this.updatePvpStatusFromDatabase();
    }

    private setupPvpStatusListener(): void {
        if (!this.spacetimeDBClient?.sdkConnection) return;
        
        // Listen for player updates
        this.spacetimeDBClient.sdkConnection.db.player.onUpdate((ctx: any, oldPlayer: any, newPlayer: any) => {
            // Check if this is the local player
            if (this.isLocalPlayer(newPlayer)) {
                // Update UI if PvP status changed
                if (newPlayer.pvp !== this.currentPlayerPvpStatus) {
                    console.log(`GameplayOptionsUI: PvP status changed from ${this.currentPlayerPvpStatus} to ${newPlayer.pvp}`);
                    this.currentPlayerPvpStatus = newPlayer.pvp;
                    this.updatePvpUI();
                }
            }
        });
    }

    private isLocalPlayer(player: any): boolean {
        if (!this.spacetimeDBClient?.sdkConnection || !this.spacetimeDBClient?.identity) {
            console.log("GameplayOptionsUI: No connection or identity available");
            return false;
        }
        
        try {
            // Find the account for our identity
            const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
            if (!account) {
                console.log("GameplayOptionsUI: No account found for identity");
                return false;
            }
            
            const isLocal = account.currentPlayerId === player.playerId;
            console.log(`GameplayOptionsUI: Checking if player ${player.playerId} is local (current player ID: ${account.currentPlayerId}) = ${isLocal}`);
            return isLocal;
        } catch (error) {
            console.error("GameplayOptionsUI: Error in isLocalPlayer:", error);
            return false;
        }
    }

    private updatePvpStatusFromDatabase(): void {
        console.log("GameplayOptionsUI: updatePvpStatusFromDatabase called");
        
        if (!this.spacetimeDBClient?.sdkConnection || !this.spacetimeDBClient?.identity) {
            console.warn("GameplayOptionsUI: No connection or identity available for database update");
            return;
        }
        
        try {
            // Find our account
            const account = this.spacetimeDBClient.sdkConnection.db.account.identity.find(this.spacetimeDBClient.identity);
            if (!account || account.currentPlayerId === 0) {
                console.warn("GameplayOptionsUI: No account found or no current player");
                return;
            }
            
            console.log(`GameplayOptionsUI: Found account with current player ID: ${account.currentPlayerId}`);
            
            // Find our player
            const player = this.spacetimeDBClient.sdkConnection.db.player.playerId.find(account.currentPlayerId);
            if (player) {
                console.log(`GameplayOptionsUI: Found player with PvP status: ${player.pvp}`);
                this.currentPlayerPvpStatus = player.pvp;
                this.updatePvpUI();
            } else {
                console.warn(`GameplayOptionsUI: Player with ID ${account.currentPlayerId} not found`);
            }
        } catch (error) {
            console.error('GameplayOptionsUI: Failed to get PvP status from database:', error);
        }
    }

    private updatePvpUI(): void {
        console.log(`GameplayOptionsUI: updatePvpUI called - currentPlayerPvpStatus: ${this.currentPlayerPvpStatus}`);
        
        // Check if main container exists
        if (!this.container) {
            console.error("GameplayOptionsUI: Main container is missing!");
            return;
        }
        
        // Find the pvpToggle container by searching through the main container
        console.log("GameplayOptionsUI: Searching for pvpToggle in main container with", this.container.list.length, "children");
        
        // Look for a container that contains our PvP elements
        let pvpToggleContainer: Phaser.GameObjects.Container | null = null;
        
        for (const child of this.container.list) {
            if (child instanceof Phaser.GameObjects.Container) {
                // Check if this container has Image and Text children (likely our PvP toggle)
                const hasImage = child.list.some(grandchild => grandchild.type === 'Image');
                const hasText = child.list.some(grandchild => grandchild.type === 'Text');
                
                if (hasImage && hasText && child.list.length === 2) {
                    console.log("GameplayOptionsUI: Found pvpToggle container with", child.list.length, "children");
                    pvpToggleContainer = child;
                    break;
                }
            }
        }
        
        if (!pvpToggleContainer) {
            console.error("GameplayOptionsUI: Could not find pvpToggle container in main container");
            console.error("Main container children:", this.container.list.map(child => child.constructor.name));
            return;
        }
        
        // Find the button and text by name within the found container
        const pvpButton = pvpToggleContainer.getByName('pvpButton') as Phaser.GameObjects.Image;
        const pvpText = pvpToggleContainer.getByName('pvpText') as Phaser.GameObjects.Text;
        
        console.log("GameplayOptionsUI: Found pvpButton:", !!pvpButton, "Found pvpText:", !!pvpText);
        
        if (!pvpButton || !pvpText) {
            console.error("GameplayOptionsUI: Could not find pvpButton or pvpText by name");
            console.error("Available children names:", pvpToggleContainer.list.map(child => (child as any).name));
            return;
        }
        
        // Update button texture
        const buttonTexture = this.currentPlayerPvpStatus ? 'button_pvp_on' : 'button_pvp_off';
        console.log(`GameplayOptionsUI: Setting button texture to: ${buttonTexture}`);
        pvpButton.setTexture(buttonTexture);
        
        // Update text
        const statusText = this.currentPlayerPvpStatus ? 'PvP: On' : 'PvP: Off';
        const textColor = this.currentPlayerPvpStatus ? '#ff6666' : '#888888';
        console.log(`GameplayOptionsUI: Setting text to: "${statusText}" with color: ${textColor}`);
        pvpText.setText(statusText);
        pvpText.setColor(textColor);
    }

    protected createUI(): void {
        // Create container in top-left corner
        this.container = this.scene.add.container(20, 20);
        this.container.setScrollFactor(0);
        this.container.setDepth(100000); // Match base OptionsUI depth
        this.container.setVisible(false); // Initial state, will be set by applyVisibilitySettings

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

        // Create Options button (separate from main container)
        this.createOptionsButton();

        // Add elements to container
        this.container.add([bg, title, musicIcon, soundIcon, hideButton]);
        this.container.add(this.musicSlider.getElements());
        this.container.add(this.soundSlider.getElements());
        this.container.add(this.pvpToggle);
        
        // Update PvP UI now that elements are created
        this.updatePvpUI();
    }

    private createPvPToggle(): void {
        const pvpY = 135;
        
        // Create PvP button (initialize with current status)
        const buttonTexture = this.currentPlayerPvpStatus ? 'button_pvp_on' : 'button_pvp_off';
        const pvpButton = this.scene.add.image(25, pvpY, buttonTexture);
        pvpButton.setScale(0.4);
        pvpButton.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        pvpButton.setInteractive();
        pvpButton.setName('pvpButton'); // Give it a name for easier lookup
        
        pvpButton.on('pointerdown', () => {
            this.toggleServerPvpMode();
        });
        
        // Add hover effects
        pvpButton.on('pointerover', () => {
            if (typeof pvpButton.setTint === 'function') {
                pvpButton.setTint(0xcccccc);
            } else {
                pvpButton.setAlpha(0.7);
            }
        });
        pvpButton.on('pointerout', () => {
            if (typeof pvpButton.clearTint === 'function') {
                pvpButton.clearTint();
            } else {
                pvpButton.setAlpha(1.0);
            }
        });

        // Create PvP status text (initialize with current status)
        const statusText = this.currentPlayerPvpStatus ? 'PvP: On' : 'PvP: Off';
        const initialColor = this.currentPlayerPvpStatus ? '#ff6666' : '#888888';
        
        const pvpText = this.scene.add.text(55, pvpY - 8, statusText, {
            fontSize: '16px',
            color: initialColor,
            fontStyle: 'bold'
        });
        pvpText.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        pvpText.setName('pvpText'); // Give it a name for easier lookup
        
        // Create container for PvP elements
        this.pvpToggle = this.scene.add.container(0, 0);
        this.pvpToggle.setScrollFactor(0); // CRITICAL: Fix camera coordinate issues
        this.pvpToggle.add([pvpButton, pvpText]);
    }

    private toggleServerPvpMode(): void {
        if (!this.spacetimeDBClient?.sdkConnection) {
            console.warn('Cannot toggle PvP: not connected to server');
            return;
        }

        // Toggle the PvP mode on the server
        const newPvpStatus = !this.currentPlayerPvpStatus;
        
        try {
            // Call the server reducer to toggle PvP mode
            this.spacetimeDBClient.sdkConnection.reducers.setPlayerPvpMode(newPvpStatus);
            
            // Play sound effect
            const soundManager = (window as any).soundManager;
            if (soundManager) {
                soundManager.playSound('ui_click', 0.7);
            }
            
            console.log(`PvP mode ${newPvpStatus ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error('Failed to toggle PvP mode:', error);
        }
    }

    public show(): void {
        super.show();
        
        // Update PvP UI when menu becomes visible (in case of timing issues)
        this.updatePvpStatusFromDatabase();
    }

    public destroy(): void {
        if (this.pvpToggle) {
            this.pvpToggle.destroy();
        }
        if (this.optionsButton) {
            this.optionsButton.destroy();
        }
        super.destroy();
    }
}

 