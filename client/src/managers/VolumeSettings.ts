// Global volume settings that persist across all manager instances
declare global {
    interface Window {
        vibesurvivors_musicVolume: number;
        vibesurvivors_soundVolume: number;
    }
}

// Default volume settings
const DEFAULT_MUSIC_VOLUME = 0.7;
const DEFAULT_SOUND_VOLUME = 0.8;

// Initialize global volume settings
export function initializeGlobalVolumes(): void {
    if (typeof window.vibesurvivors_musicVolume === 'undefined') {
        window.vibesurvivors_musicVolume = DEFAULT_MUSIC_VOLUME;
    }
    if (typeof window.vibesurvivors_soundVolume === 'undefined') {
        window.vibesurvivors_soundVolume = DEFAULT_SOUND_VOLUME;
    }
}

// Get current music volume
export function getMusicVolume(): number {
    return typeof window.vibesurvivors_musicVolume !== 'undefined' 
        ? window.vibesurvivors_musicVolume 
        : DEFAULT_MUSIC_VOLUME;
}

// Set music volume
export function setMusicVolume(volume: number): void {
    window.vibesurvivors_musicVolume = Math.max(0, Math.min(1, volume));
}

// Get current sound volume
export function getSoundVolume(): number {
    return typeof window.vibesurvivors_soundVolume !== 'undefined' 
        ? window.vibesurvivors_soundVolume 
        : DEFAULT_SOUND_VOLUME;
}

// Set sound volume
export function setSoundVolume(volume: number): void {
    window.vibesurvivors_soundVolume = Math.max(0, Math.min(1, volume));
} 