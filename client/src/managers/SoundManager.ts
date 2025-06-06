export default class SoundManager {
    private scene: Phaser.Scene | null = null;
    private soundsEnabled: boolean = true;
    private defaultVolume: number = 0.8;

    constructor(scene?: Phaser.Scene) {
        if (scene) {
            this.scene = scene;
        }
        console.log("SoundManager initialized");
    }

    // Update the scene reference when scenes change
    setScene(scene: Phaser.Scene): void {
        this.scene = scene;
        console.log(`SoundManager: Scene updated to ${scene.scene.key}`);
    }

    // Play a sound effect
    playSound(soundKey: string, volume: number = this.defaultVolume): void {
        if (!this.soundsEnabled || !this.scene) {
            if (!this.scene) {
                console.warn("SoundManager: No scene reference available");
            }
            return;
        }

        // Check if sound exists in cache
        if (!this.scene.cache.audio.exists(soundKey)) {
            console.warn(`SoundManager: Sound '${soundKey}' not found in cache - skipping sound playback`);
            return;
        }

        try {
            // Create and play the sound effect
            const sound = this.scene.sound.add(soundKey, {
                volume: volume,
                loop: false
            });

            sound.play();
            
            // Destroy the sound after it finishes to free memory
            sound.once('complete', () => {
                sound.destroy();
            });

            console.log(`SoundManager: Playing sound '${soundKey}' (volume: ${volume})`);
        } catch (error) {
            console.warn(`SoundManager: Error playing sound '${soundKey}':`, error);
        }
    }

    // Play multiple sounds in sequence with delays
    playSoundsSequence(soundSequence: Array<{ key: string, delay?: number, volume?: number }>): void {
        if (!this.soundsEnabled || !this.scene) {
            if (!this.scene) {
                console.warn("SoundManager: No scene reference available for sound sequence");
            }
            return;
        }

        soundSequence.forEach((soundInfo, index) => {
            const delay = soundInfo.delay || 0;
            const volume = soundInfo.volume || this.defaultVolume;

            if (delay > 0) {
                this.scene!.time.delayedCall(delay, () => {
                    this.playSound(soundInfo.key, volume);
                });
            } else {
                this.playSound(soundInfo.key, volume);
            }
        });
    }

    // Boss AI state change sound effects
    playBossChaseSound(): void {
        this.playSound('boss_chase_cue', 0.9);
        console.log("SoundManager: Boss entered chase state");
    }

    playBossDanceSound(): void {
        this.playSound('boss_bullet_cue', 0.8);
        console.log("SoundManager: Boss entered dance state");
    }

    playBossVanishSound(): void {
        // Play both sounds for vanish state
        this.playSound('boss_teleport_cue', 0.8);
        this.playSound('boss_vanish', 0.9);
        console.log("SoundManager: Boss entered vanish state");
    }

    playBossTeleportSound(): void {
        // Play both sounds for teleport state
        this.playSound('boss_appear', 0.9);
        this.playSound('boss_teleport_attack', 0.8);
        console.log("SoundManager: Boss entered teleport state");
    }

    playBossSpawnSound(): void {
        this.playSound('voice_boss', 1.0);
        console.log("SoundManager: Boss first form spawned");
    }

    playBossTransformSound(): void {
        // Play transformation sound immediately, then voice after delay
        this.playSoundsSequence([
            { key: 'boss_transform', volume: 0.9 },
            { key: 'voice_boss_2', delay: 1500, volume: 1.0 } // 1.5 second delay
        ]);
        console.log("SoundManager: Boss transformation initiated");
    }

    // Enable/disable sound effects
    setSoundsEnabled(enabled: boolean): void {
        this.soundsEnabled = enabled;
        console.log(`SoundManager: Sounds ${enabled ? 'enabled' : 'disabled'}`);
    }

    // Set default volume for sound effects
    setDefaultVolume(volume: number): void {
        this.defaultVolume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
        console.log(`SoundManager: Default volume set to ${this.defaultVolume}`);
    }

    // Check if sounds are enabled
    areSoundsEnabled(): boolean {
        return this.soundsEnabled;
    }

    // Cleanup - call when scene shuts down
    cleanup(): void {
        console.log("SoundManager: Cleanup completed");
        // Note: Don't clear the scene reference in cleanup since this is global
    }
} 