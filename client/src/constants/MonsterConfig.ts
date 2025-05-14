// Monster-specific configuration values

// Asset keys for different monster types
export const MONSTER_ASSET_KEYS: Record<string, string> = {
    "Rat": 'monster_rat',
    "Slime": 'monster_slime',
    "Orc": 'monster_orc',
    "Wolf": 'monster_wolf',
    "FinalBossJorgePhase1": 'final_boss_jorge_phase_1',
    "FinalBossJorgePhase2": 'final_boss_jorge_phase_2',
    "FinalBossBjornPhase1": 'final_boss_bjorn_phase_1',
    "FinalBossBjornPhase2": 'final_boss_bjorn_phase_2',
    "FinalBossSimonPhase1": 'final_boss_simon_phase_1',
    "FinalBossSimonPhase2": 'final_boss_simon_phase_2'
};

// Shadow offset configurations for each monster type (vertical offset in pixels)
export const MONSTER_SHADOW_OFFSETS: Record<string, number> = {
    "Rat": -10,     // Smaller monster, smaller shadow offset
    "Slime": -12,    // Very low to the ground
    "Orc": 12,      // Larger monster, bigger shadow offset
    "Wolf": -5,      // Medium-sized monster
    "FinalBossJorgePhase1": 16,
    "FinalBossJorgePhase2": 20,
    "FinalBossBjornPhase1": 16,
    "FinalBossBjornPhase2": 20,
    "FinalBossSimonPhase1": 16,
    "FinalBossSimonPhase2": 20
};

// Monster health configuration
export const MONSTER_MAX_HP: Record<string, number> = {
    "Rat": 10,
    "Slime": 25,
    "Orc": 50,
    "Wolf": 35,
    "FinalBossJorgePhase1": 5000,
    "FinalBossJorgePhase2": 10000,
    "FinalBossBjornPhase1": 5000,
    "FinalBossBjornPhase2": 10000,
    "FinalBossSimonPhase1": 5000,
    "FinalBossSimonPhase2": 10000,
    "default": 100  // Default value for unknown monsters
};

// Debug helper to print monster configurations
export function logMonsterConfigs() {
    console.log("=== Monster Configurations ===");
    console.log("Asset keys:", MONSTER_ASSET_KEYS);
    console.log("Shadow offsets:", MONSTER_SHADOW_OFFSETS);
    console.log("Max HP values:", MONSTER_MAX_HP);
}