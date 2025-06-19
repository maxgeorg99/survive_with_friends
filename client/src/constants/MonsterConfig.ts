// Monster-specific configuration values

// Asset keys for different monster types
export const MONSTER_ASSET_KEYS: Record<string, string> = {
    "Rat": 'monster_rat',
    "Slime": 'monster_slime',
    "Orc": 'monster_orc',
    "Imp": 'monster_imp',
    "Zombie": 'monster_zombie',
    "Bat": 'monster_bat',
    "BossEnderPhase1": 'final_boss_phase1',
    "BossEnderPhase2": 'final_boss_phase2',
    "BossAgnaPhase1": 'boss_agna_1',
    "BossAgnaPhase2": 'boss_agna_2',
    "VoidChest": 'treasure_chest',
    "EnderClaw": 'monster_void_claw'
};

// Shadow offset configurations for each monster type (horizontal offset in pixels)
export const MONSTER_SHADOW_OFFSETS_X: Record<string, number> = {
    "Rat": -6,     // Smaller monster, smaller shadow offset
    "Slime": -9,    // Very low to the ground
    "Orc": 0,      // Larger monster, bigger shadow offset
    "Imp": -8,     // Small magical creature, slight offset
    "Zombie": 6,  // Medium sized humanoid, small offset
    "Bat": -8,     // Small flying creature, slight offset
    "BossEnderPhase1": -26,  // Large boss, bigger shadow offset
    "BossEnderPhase2": -68,   // Even larger final form, largest shadow offset
    "BossAgnaPhase1": -24,   // Large boss, similar to Ender Phase 1
    "BossAgnaPhase2": -64,   // Large final form, similar to Ender Phase 2
    "VoidChest": -28,    // Chest is centered
    "EnderClaw": -4    // Medium aggressive creature, slight offset
};

// Shadow offset configurations for each monster type (vertical offset in pixels)
export const MONSTER_SHADOW_OFFSETS_Y: Record<string, number> = {
    "Rat": -24,     // Smaller monster, smaller shadow offset
    "Slime": -22,    // Very low to the ground
    "Orc": 0,      // Larger monster, bigger shadow offset
    "Imp": -8,    // Small flying/floating creature, higher offset
    "Zombie": 6, // Medium sized shambling creature, moderate offset
    "Bat": 20,    // Flying creature, higher offset for airborne shadow
    "BossEnderPhase1": -4,  // Large boss, bigger shadow offset
    "BossEnderPhase2": -78,   // Even larger final form, largest shadow offset
    "BossAgnaPhase1": -2,   // Large boss, similar to Ender Phase 1
    "BossAgnaPhase2": -74,  // Large final form, similar to Ender Phase 2
    "VoidChest": -66,    // Chest sits on the ground with small offset
    "EnderClaw": -8    // Medium sized creature, moderate offset
};

export const MONSTER_SHADOW_SCALE: Record<string, number> = {
    "Rat": 1.0,
    "Slime": 1.0,
    "Orc": 1.0,
    "Imp": 1.0,       // Normal scale for small magical creature
    "Zombie": 1.2,    // Slightly larger shadow for zombie
    "Bat": 0.8,       // Smaller shadow for small flying creature
    "BossEnderPhase1": 2.0,
    "BossEnderPhase2": 6.5,
    "BossAgnaPhase1": 1.9,   // Slightly smaller than Ender Phase 1
    "BossAgnaPhase2": 6.2,   // Slightly smaller than Ender Phase 2
    "VoidChest": 2.75,
    "EnderClaw": 1.1  // Slightly larger shadow for aggressive creature
};
// Debug helper to print monster configurations
export function logMonsterConfigs() {
    console.log("=== Monster Configurations ===");
    console.log("Asset keys:", MONSTER_ASSET_KEYS);
    console.log("Shadow offsets X:", MONSTER_SHADOW_OFFSETS_X);
    console.log("Shadow offsets Y:", MONSTER_SHADOW_OFFSETS_Y);
} 