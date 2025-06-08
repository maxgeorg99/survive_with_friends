import { getMusicVolume, setMusicVolume, initializeGlobalVolumes } from './VolumeSettings';

// Global music state to persist across scene transitions
let globalCurrentTrack: Phaser.Sound.BaseSound | null = null;
let globalCurrentTrackKey: string | null = null;

export default class MusicManager {
    private scene: Phaser.Scene;
    private currentTrack: Phaser.Sound.BaseSound | null = null;
    private currentTrackKey: string | null = null;
    
    // Define track properties
    private trackConfig = {
        title: { loops: true },
        main: { loops: true },
        boss: { loops: true },
        game_over_sting: { loops: false },
        win_sting: { loops: false }
    };

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        
        // Initialize global volume settings
        initializeGlobalVolumes();
        
        // Sync with global state on construction
        this.currentTrack = globalCurrentTrack;
        this.currentTrackKey = globalCurrentTrackKey;
        
        console.log("MusicManager initialized", { currentTrack: this.currentTrackKey });
    }

    // Play a track, stopping any currently playing track
    playTrack(trackKey: string, volume?: number): void {
        const effectiveVolume = volume !== undefined ? volume : getMusicVolume();
        // Don't restart the same track (check global state)
        if (globalCurrentTrackKey === trackKey && globalCurrentTrack?.isPlaying) {
            console.log(`MusicManager: Track '${trackKey}' is already playing globally - skipping restart`);
            // Sync local state with global state
            this.currentTrack = globalCurrentTrack;
            this.currentTrackKey = globalCurrentTrackKey;
            return;
        }

        // Stop current track if playing
        this.stopCurrentTrack();

        // Check if track exists
        if (!this.scene.cache.audio.exists(trackKey)) {
            console.warn(`MusicManager: Track '${trackKey}' not found in cache - skipping music playback`);
            return;
        }

        // Get track configuration
        const config = this.trackConfig[trackKey as keyof typeof this.trackConfig];
        if (!config) {
            console.warn(`MusicManager: No configuration found for track '${trackKey}' - skipping music playback`);
            return;
        }

        try {
            // Create and play the new track
            this.currentTrack = this.scene.sound.add(trackKey, {
                volume: effectiveVolume,
                loop: config.loops
            });

            this.currentTrack.play();
            this.currentTrackKey = trackKey;
            
            // Update global state
            globalCurrentTrack = this.currentTrack;
            globalCurrentTrackKey = trackKey;
            
            console.log(`MusicManager: Playing '${trackKey}' (loop: ${config.loops}, volume: ${effectiveVolume})`);

            // Add completion listener for non-looping tracks
            if (!config.loops) {
                this.currentTrack.once('complete', () => {
                    console.log(`MusicManager: Non-looping track '${trackKey}' completed`);
                    this.currentTrack = null;
                    this.currentTrackKey = null;
                    globalCurrentTrack = null;
                    globalCurrentTrackKey = null;
                });
            }
        } catch (error) {
            console.warn(`MusicManager: Error playing track '${trackKey}':`, error, "- continuing without music");
        }
    }

    // Stop the currently playing track
    stopCurrentTrack(): void {
        // Stop global track if it exists and is different from local
        if (globalCurrentTrack && globalCurrentTrack !== this.currentTrack) {
            console.log(`MusicManager: Stopping global track '${globalCurrentTrackKey}'`);
            globalCurrentTrack.stop();
            globalCurrentTrack.destroy();
        }
        
        if (this.currentTrack) {
            console.log(`MusicManager: Stopping current track '${this.currentTrackKey}'`);
            this.currentTrack.stop();
            this.currentTrack.destroy();
        }
        
        // Clear both local and global state
        this.currentTrack = null;
        this.currentTrackKey = null;
        globalCurrentTrack = null;
        globalCurrentTrackKey = null;
    }

    // Stop all music
    stopAllMusic(): void {
        this.stopCurrentTrack();
        console.log("MusicManager: All music stopped");
    }

    // Get information about currently playing track
    getCurrentTrack(): { key: string | null, isPlaying: boolean } {
        return {
            key: globalCurrentTrackKey,
            isPlaying: globalCurrentTrack?.isPlaying || false
        };
    }

    // Check if a specific track is currently playing
    isTrackPlaying(trackKey: string): boolean {
        return globalCurrentTrackKey === trackKey && (globalCurrentTrack?.isPlaying || false);
    }

    // Set the volume for music
    setVolume(volume: number): void {
        setMusicVolume(volume);
        
        // Apply to currently playing track
        if (globalCurrentTrack && globalCurrentTrack.isPlaying) {
            if ('setVolume' in globalCurrentTrack) {
                (globalCurrentTrack as any).setVolume(getMusicVolume());
            } else if ('volume' in globalCurrentTrack) {
                (globalCurrentTrack as any).volume = getMusicVolume();
            }
        }
        
        console.log(`MusicManager: Volume set to ${getMusicVolume()}`);
    }

    // Cleanup - call when scene shuts down
    cleanup(): void {
        // For title music, preserve it across menu scene transitions
        // Only stop if it's a different track or if we're transitioning to a non-menu scene
        if (this.currentTrack === globalCurrentTrack && globalCurrentTrackKey === 'title') {
            // Don't stop title music during menu transitions - just clear local references
            this.currentTrack = null;
            this.currentTrackKey = null;
            console.log("MusicManager: Cleanup completed - preserving title music across scene transition");
        } else if (this.currentTrack === globalCurrentTrack) {
            // Stop non-title music normally
            this.stopCurrentTrack();
            console.log("MusicManager: Cleanup completed - stopped non-title music");
        } else {
            // Just clear local references without stopping global music
            this.currentTrack = null;
            this.currentTrackKey = null;
            console.log("MusicManager: Cleanup completed - cleared local references only");
        }
    }
} 