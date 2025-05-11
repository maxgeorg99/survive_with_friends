// Monster-specific configuration values

// Asset keys for different monster types
export const MONSTER_ASSET_KEYS: Record<string, string> = {
    "Rat": 'monster_rat',
    "Slime": 'monster_slime',
    "Orc": 'monster_orc',
    "FinalBossPhase1": 'final_boss_phase1',
    "FinalBossPhase2": 'final_boss_phase2'
};

// Shadow offset configurations for each monster type (vertical offset in pixels)
export const MONSTER_SHADOW_OFFSETS_X: Record<string, number> = {
    "Rat": -6,     // Smaller monster, smaller shadow offset
    "Slime": -9,    // Very low to the ground
    "Orc": 0,      // Larger monster, bigger shadow offset
    "FinalBossPhase1": 0,  // Large boss, bigger shadow offset
    "FinalBossPhase2": 0   // Even larger final form, largest shadow offset
};

// Shadow offset configurations for each monster type (vertical offset in pixels)
export const MONSTER_SHADOW_OFFSETS_Y: Record<string, number> = {
    "Rat": -24,     // Smaller monster, smaller shadow offset
    "Slime": -22,    // Very low to the ground
    "Orc": 0,      // Larger monster, bigger shadow offset
    "FinalBossPhase1": 16,  // Large boss, bigger shadow offset
    "FinalBossPhase2": 20   // Even larger final form, largest shadow offset
};

// Debug helper to print monster configurations
export function logMonsterConfigs() {
    console.log("=== Monster Configurations ===");
    console.log("Asset keys:", MONSTER_ASSET_KEYS);
    console.log("Shadow offsets X:", MONSTER_SHADOW_OFFSETS_X);
    console.log("Shadow offsets Y:", MONSTER_SHADOW_OFFSETS_Y);
} 