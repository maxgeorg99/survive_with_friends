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
        console.log("MusicManager initialized");
    }

    // Play a track, stopping any currently playing track
    playTrack(trackKey: string, volume: number = 0.7): void {
        // Don't restart the same track
        if (this.currentTrackKey === trackKey && this.currentTrack?.isPlaying) {
            console.log(`MusicManager: Track '${trackKey}' is already playing`);
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
                volume: volume,
                loop: config.loops
            });

            this.currentTrack.play();
            this.currentTrackKey = trackKey;
            
            console.log(`MusicManager: Playing '${trackKey}' (loop: ${config.loops}, volume: ${volume})`);

            // Add completion listener for non-looping tracks
            if (!config.loops) {
                this.currentTrack.once('complete', () => {
                    console.log(`MusicManager: Non-looping track '${trackKey}' completed`);
                    this.currentTrack = null;
                    this.currentTrackKey = null;
                });
            }
        } catch (error) {
            console.warn(`MusicManager: Error playing track '${trackKey}':`, error, "- continuing without music");
        }
    }

    // Stop the currently playing track
    stopCurrentTrack(): void {
        if (this.currentTrack) {
            console.log(`MusicManager: Stopping current track '${this.currentTrackKey}'`);
            this.currentTrack.stop();
            this.currentTrack.destroy();
            this.currentTrack = null;
            this.currentTrackKey = null;
        }
    }

    // Stop all music
    stopAllMusic(): void {
        this.stopCurrentTrack();
        console.log("MusicManager: All music stopped");
    }

    // Get current track info
    getCurrentTrack(): string | null {
        return this.currentTrackKey;
    }

    // Check if music is playing
    isPlaying(): boolean {
        return this.currentTrack?.isPlaying || false;
    }

    // Set volume for current track
    setVolume(volume: number): void {
        if (this.currentTrack) {
            (this.currentTrack as any).volume = volume;
            console.log(`MusicManager: Volume set to ${volume} for '${this.currentTrackKey}'`);
        }
    }

    // Cleanup - call when scene shuts down
    cleanup(): void {
        this.stopCurrentTrack();
        console.log("MusicManager: Cleanup completed");
    }
} 