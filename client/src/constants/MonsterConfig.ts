// Monster-specific configuration values

// Asset keys for different monster types
export const MONSTER_ASSET_KEYS: Record<string, string> = {
    "Rat": 'monster_rat',
    "Slime": 'monster_slime',
    "Orc": 'monster_orc',
    "Imp": 'monster_imp',
    "Zombie": 'monster_zombie',
    "FinalBossPhase1": 'final_boss_phase1',
    "FinalBossPhase2": 'final_boss_phase2',
    "VoidChest": 'treasure_chest'
};

// Shadow offset configurations for each monster type (horizontal offset in pixels)
export const MONSTER_SHADOW_OFFSETS_X: Record<string, number> = {
    "Rat": -6,     // Smaller monster, smaller shadow offset
    "Slime": -9,    // Very low to the ground
    "Orc": 0,      // Larger monster, bigger shadow offset
    "Imp": -8,     // Small magical creature, slight offset
    "Zombie": 6,  // Medium sized humanoid, small offset
    "FinalBossPhase1": -26,  // Large boss, bigger shadow offset
    "FinalBossPhase2": -68,   // Even larger final form, largest shadow offset
    "VoidChest": -28    // Chest is centered
};

// Shadow offset configurations for each monster type (vertical offset in pixels)
export const MONSTER_SHADOW_OFFSETS_Y: Record<string, number> = {
    "Rat": -24,     // Smaller monster, smaller shadow offset
    "Slime": -22,    // Very low to the ground
    "Orc": 0,      // Larger monster, bigger shadow offset
    "Imp": -8,    // Small flying/floating creature, higher offset
    "Zombie": 6, // Medium sized shambling creature, moderate offset
    "FinalBossPhase1": -4,  // Large boss, bigger shadow offset
    "FinalBossPhase2": -78,   // Even larger final form, largest shadow offset
    "VoidChest": -66    // Chest sits on the ground with small offset
};

export const MONSTER_SHADOW_SCALE: Record<string, number> = {
    "Rat": 1.0,
    "Slime": 1.0,
    "Orc": 1.0,
    "Imp": 1.0,       // Normal scale for small magical creature
    "Zombie": 1.2,    // Slightly larger shadow for zombie
    "FinalBossPhase1": 2.0,
    "FinalBossPhase2": 6.5,
    "VoidChest": 2.75
};
// Debug helper to print monster configurations
export function logMonsterConfigs() {
    console.log("=== Monster Configurations ===");
    console.log("Asset keys:", MONSTER_ASSET_KEYS);
    console.log("Shadow offsets X:", MONSTER_SHADOW_OFFSETS_X);
    console.log("Shadow offsets Y:", MONSTER_SHADOW_OFFSETS_Y);
} 