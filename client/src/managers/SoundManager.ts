import { getSoundVolume, setSoundVolume, initializeGlobalVolumes } from './VolumeSettings';

export default class SoundManager {
    private scene: Phaser.Scene | null = null;
    private soundsEnabled: boolean = true;
    private defaultVolume: number = 0.8;
    private soundPool: Map<string, Phaser.Sound.BaseSound[]> = new Map();
    private lastDistanceSoundTime: Map<string, number> = new Map(); // Track per sound type
    private distanceSoundThrottle: number = 50; // Reduced from 100ms to 50ms for better responsiveness
    
    // Frame-based throttling for sounds that should only play once per frame
    private frameThrottledSounds: Set<string> = new Set();
    private currentFrame: number = 0;
    private frameThrottledPlayed: Set<string> = new Set();

    constructor(scene?: Phaser.Scene) {
        if (scene) {
            this.scene = scene;
        }
        
        // Initialize global volume settings
        initializeGlobalVolumes();
        
        // Register sounds that should be limited to once per frame
        this.frameThrottledSounds.add('attack_fire');
    }

    // Update the scene reference when scenes change
    setScene(scene: Phaser.Scene): void {
        this.scene = scene;
        // Don't immediately clear sound pool - let playing sounds finish
        // The pool will be cleaned up naturally as sounds complete
    }

    // Get or create a sound from the pool
    private getSoundFromPool(soundKey: string, volume: number): Phaser.Sound.BaseSound | null {
        if (!this.scene) {
            console.error(`SoundManager: No scene available for '${soundKey}'`);
            return null;
        }

        // Check if sound exists in cache
        if (!this.scene.cache.audio.exists(soundKey)) {
            console.error(`SoundManager: Sound '${soundKey}' not found in cache`);
            return null;
        }

        // Get pool for this sound
        let pool = this.soundPool.get(soundKey);
        if (!pool) {
            pool = [];
            this.soundPool.set(soundKey, pool);
        }

        // Try to find an available sound in the pool
        const availableSound = pool.find(sound => !sound.isPlaying);
        if (availableSound) {
            // Set volume using the config property since setVolume may not exist on BaseSound
            (availableSound as any).setVolume?.(volume) || ((availableSound as any).volume = volume);
            return availableSound;
        }

        // If no available sound and pool is not too large, create a new one
        if (pool.length < 5) { // Limit pool size to prevent memory issues
            try {
                const newSound = this.scene.sound.add(soundKey, {
                    volume: volume,
                    loop: false
                });
                pool.push(newSound);
                return newSound;
            } catch (error) {
                console.error(`SoundManager: Error creating sound '${soundKey}':`, error);
                return null;
            }
        }

        // Pool full and no available sounds, skip this sound
        //console.warn(`SoundManager: Pool full for '${soundKey}' and no available sounds`);
        return null;
    }

    // Clear the sound pool
    private clearSoundPool(): void {
        for (const [key, pool] of this.soundPool.entries()) {
            pool.forEach(sound => {
                if (sound && !(sound as any).destroyed) {
                    sound.destroy();
                }
            });
        }
        this.soundPool.clear();
    }

    // Play a sound effect
    playSound(soundKey: string, volume: number = this.defaultVolume): void {
        if (!this.soundsEnabled) {
            return;
        }
        
        if (!this.scene) {
            console.warn("SoundManager: No scene reference available");
            return;
        }

        // Apply global sound volume multiplier to all volumes
        const adjustedVolume = volume * getSoundVolume();

        // If volume is effectively 0, use a tiny volume instead to prevent default volume fallback
        const safeVolume = adjustedVolume > 0 ? adjustedVolume : 0.001;

        // Check for frame-based throttling
        if (this.frameThrottledSounds.has(soundKey)) {
            if (this.frameThrottledPlayed.has(soundKey)) {
                // This sound was already played this frame, skip it silently
                return;
            }
            // Mark this sound as played for this frame
            this.frameThrottledPlayed.add(soundKey);
        }

        const sound = this.getSoundFromPool(soundKey, safeVolume);
        if (sound) {
            try {
                sound.play();
            } catch (error) {
                console.error(`SoundManager: Error playing sound '${soundKey}':`, error);
            }
        } else {
            //console.error(`SoundManager: Failed to get sound '${soundKey}' from pool`);
        }
    }

    // Play a sound effect with pitch variation
    playSoundWithPitch(soundKey: string, volume: number = this.defaultVolume, pitchMin: number = 0.8, pitchMax: number = 1.2): void {
        if (!this.soundsEnabled) {
            return;
        }
        
        if (!this.scene) {
            console.warn("SoundManager: No scene reference available");
            return;
        }

        // Apply global sound volume multiplier to all volumes
        const adjustedVolume = volume * getSoundVolume();

        // If volume is effectively 0, use a tiny volume instead to prevent default volume fallback
        const safeVolume = adjustedVolume > 0 ? adjustedVolume : 0.001;

        // Check for frame-based throttling
        if (this.frameThrottledSounds.has(soundKey)) {
            if (this.frameThrottledPlayed.has(soundKey)) {
                // This sound was already played this frame, skip it silently
                return;
            }
            // Mark this sound as played for this frame
            this.frameThrottledPlayed.add(soundKey);
        }

        const sound = this.getSoundFromPool(soundKey, safeVolume);
        if (sound) {
            try {
                // Generate random pitch between pitchMin and pitchMax
                const randomPitch = Math.random() * (pitchMax - pitchMin) + pitchMin;
                
                // Set the pitch/rate if the sound supports it
                if ((sound as any).setRate) {
                    (sound as any).setRate(randomPitch);
                } else if ((sound as any).rate !== undefined) {
                    (sound as any).rate = randomPitch;
                }
                
                sound.play();
            } catch (error) {
                console.error(`SoundManager: Error playing sound '${soundKey}' with pitch:`, error);
            }
        } else {
            //console.error(`SoundManager: Failed to get sound '${soundKey}' from pool`);
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
    }

    playBossDanceSound(): void {
        this.playSound('boss_bullet_cue', 0.8);
    }

    playBossVanishSound(): void {
        // Play both sounds for vanish state
        this.playSound('boss_teleport_cue', 0.8);
        this.playSound('boss_vanish', 0.9);
    }

    playBossTeleportSound(): void {
        // Play both sounds for teleport state
        this.playSound('boss_appear', 0.9);
        this.playSound('boss_teleport_attack', 0.8);
    }

    playBossSpawnSound(): void {
        this.playSound('voice_boss', 1.0);
    }

    playBossTransformSound(): void {
        // Play transformation sound immediately, then voice after delay
        this.playSoundsSequence([
            { key: 'boss_transform', volume: 0.9 },
            { key: 'voice_boss_2', delay: 1500, volume: 1.0 } // 1.5 second delay
        ]);
    }

    playBossPreTransformSound(): void {
        // Play the pre-transform voice line during phase 1 to phase 2 transition
        this.playSound('voice_transform', 1.0);
    }

    // Enable/disable sound effects
    setSoundsEnabled(enabled: boolean): void {
        this.soundsEnabled = enabled;
    }

    // Set default volume for sound effects
    setDefaultVolume(volume: number): void {
        this.defaultVolume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
    }

    // Set global sound volume multiplier (affects ALL sound effects)
    setSoundVolumeMultiplier(multiplier: number): void {
        setSoundVolume(multiplier);
    }

    // Check if sounds are enabled
    areSoundsEnabled(): boolean {
        return this.soundsEnabled;
    }

    // Play a sound effect with distance-based volume
    playDistanceBasedSound(soundKey: string, playerPosition: {x: number, y: number}, eventPosition: {x: number, y: number}, maxDistance: number = 300, baseVolume: number = this.defaultVolume): void {
        if (!this.soundsEnabled || !this.scene) {
            if (!this.scene) {
                console.warn("SoundManager: No scene reference available for distance-based sound");
            }
            return;
        }

        // Throttle distance-based sounds to prevent performance issues
        const now = Date.now();
        const lastTime = this.lastDistanceSoundTime.get(soundKey) || 0;
        if (now - lastTime < this.distanceSoundThrottle) {
            return; // Skip this sound to prevent frame drops
        }
        this.lastDistanceSoundTime.set(soundKey, now);

        // Calculate distance between player and event
        const distance = this.calculateDistance(playerPosition, eventPosition);
        
        // Don't play if too far away
        if (distance > maxDistance) {
            return;
        }
        
        // Calculate volume based on distance (inverse relationship)
        const distanceRatio = 1 - (distance / maxDistance);
        const volume = baseVolume * distanceRatio;
        
        // Only play if volume is meaningful
        if (volume > 0.1) {
            this.playSound(soundKey, volume);
            //console.log(`Playing distance-based sound '${soundKey}' at volume ${volume.toFixed(2)} (distance: ${distance.toFixed(1)})`);
        }
    }

    // Play a sound effect with distance-based volume and pitch variation
    playDistanceBasedSoundWithPitch(soundKey: string, playerPosition: {x: number, y: number}, eventPosition: {x: number, y: number}, maxDistance: number = 300, baseVolume: number = this.defaultVolume, pitchMin: number = 0.8, pitchMax: number = 1.2): void {
        if (!this.soundsEnabled || !this.scene) {
            if (!this.scene) {
                console.warn("SoundManager: No scene reference available for distance-based sound with pitch");
            }
            return;
        }

        // Throttle distance-based sounds to prevent performance issues
        const now = Date.now();
        const lastTime = this.lastDistanceSoundTime.get(soundKey) || 0;
        if (now - lastTime < this.distanceSoundThrottle) {
            return; // Skip this sound to prevent frame drops
        }
        this.lastDistanceSoundTime.set(soundKey, now);

        // Calculate distance between player and event
        const distance = this.calculateDistance(playerPosition, eventPosition);
        
        // Don't play if too far away
        if (distance > maxDistance) {
            return;
        }
        
        // Calculate volume based on distance (inverse relationship)
        const distanceRatio = 1 - (distance / maxDistance);
        const volume = baseVolume * distanceRatio;
        
        // Only play if volume is meaningful
        if (volume > 0.1) {
            this.playSoundWithPitch(soundKey, volume, pitchMin, pitchMax);
            //console.log(`Playing distance-based sound '${soundKey}' with pitch at volume ${volume.toFixed(2)} (distance: ${distance.toFixed(1)})`);
        }
    }
    
    // Calculate distance between two points
    private calculateDistance(pos1: {x: number, y: number}, pos2: {x: number, y: number}): number {
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Force cleanup of sound pool (for use during shutdown)
    forceCleanup(): void {
        this.clearSoundPool();
    }

    // Cleanup - call when scene shuts down
    cleanup(): void {
        // Only clear sound pool during cleanup if it's a full shutdown
        // For normal scene transitions, let sounds finish naturally
        // Note: Don't clear the scene reference in cleanup since this is global
    }

    // Update frame counter - should be called once per frame by the game loop
    updateFrame(): void {
        this.currentFrame++;
        this.frameThrottledPlayed.clear(); // Reset frame-throttled sounds for this frame
    }

    // Register a sound to be frame-throttled (only play once per frame)
    addFrameThrottledSound(soundKey: string): void {
        this.frameThrottledSounds.add(soundKey);
        //console.log(`SoundManager: Added '${soundKey}' to frame-throttled sounds`);
    }

    // Remove a sound from frame-throttling
    removeFrameThrottledSound(soundKey: string): void {
        this.frameThrottledSounds.delete(soundKey);
        //console.log(`SoundManager: Removed '${soundKey}' from frame-throttled sounds`);
    }
} 