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
    "AgnaCandle": 'agna_candle',
    "VoidChest": 'treasure_chest',
    "EnderClaw": 'monster_void_claw',
    "Crate": 'structure_crate',
    "Tree": 'structure_tree',
    "Statue": 'structure_statue'
};

// Sprite offset configurations for visual perspective (X component)
export const MONSTER_SPRITE_OFFSETS_X: Record<string, number> = {
    // Standard monsters - most start at 0
    "Rat": 0,
    "Slime": 0,
    "Orc": 0,
    "Imp": 0,
    "Zombie": 0,
    "Bat": 0,
    
    // Boss monsters
    "BossEnderPhase1": 0,
    "BossEnderPhase2": 0,
    "BossAgnaPhase1": 0,
    "BossAgnaPhase2": 0,
    "AgnaCandle": 0,
    
    // Special monsters
    "VoidChest": 0,
    "EnderClaw": 0,
    
    // Structures
    "Crate": 0,
    "Tree": 0,
    "Statue": 0
};

// Sprite offset configurations for visual perspective (Y component)
export const MONSTER_SPRITE_OFFSETS_Y: Record<string, number> = {
    // Standard monsters - most start at 0
    "Rat": 0,
    "Slime": 0,
    "Orc": 0,
    "Imp": 0,
    "Zombie": 0,
    "Bat": 0,
    
    // Boss monsters
    "BossEnderPhase1": 0,
    "BossEnderPhase2": 0,
    "BossAgnaPhase1": 0,
    "BossAgnaPhase2": 0,
    "AgnaCandle": 0,
    
    // Special monsters
    "VoidChest": 0,
    "EnderClaw": 0,
    
    // Structures
    "Crate": 0,
    "Tree": -72,
    "Statue": -32
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
    "AgnaCandle": -16,    // Medium candle monster, moderate offset
    "VoidChest": -28,    // Chest is centered
    "EnderClaw": -4,    // Medium aggressive creature, slight offset
    "Crate": -16,       // Wooden crate, centered similar to VoidChest
    "Tree": -19,        // Large tree structure, bigger offset  
    "Statue": -19       // Large statue structure, biggest offset
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
    "AgnaCandle": -30,   // Candle sits on ground, similar to chest
    "VoidChest": -65,    // Chest sits on the ground with small offset
    "EnderClaw": -8,    // Medium sized creature, moderate offset
    "Crate": -50,       // Crate sits on ground, similar to VoidChest
    "Tree": 30,        // Tree sits on ground with deep roots
    "Statue": -12       // Statue sits on ground with heavy base
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
    "AgnaCandle": 1.0,    // Normal scale for medium candle
    "VoidChest": 2.75,
    "EnderClaw": 1.1,  // Slightly larger shadow for aggressive creature
    "Crate": 1.77,      // Medium shadow for crate structure
    "Tree": 2.0,       // Large shadow for tree structure
    "Statue": 2.1      // Largest shadow for statue structure
};

// Monster depth offset configuration - adjustable per type for fine-tuned depth priorities
export const MONSTER_DEPTH_OFFSETS: Record<string, number> = {
    // Standard monsters use 0 offset (normal depth sorting)
    "Rat": 0,
    "Slime": 0,
    "Orc": 0,
    "Imp": 0,
    "Zombie": 0,
    "Bat": 0,
    "EnderClaw": 0,
    
    // Bosses get higher priority to appear prominent
    "BossEnderPhase1": 0,
    "BossEnderPhase2": 0,
    "BossAgnaPhase1": 0,
    "BossAgnaPhase2": 0,
    "AgnaCandle": 0,
    
    // Special monsters
    "VoidChest": 12, // Chests appear in front of most monsters but behind large structures
    
    // Structures - different priorities based on prominence
    "Crate": 0,     // Small structure, minimal priority boost
    "Tree": 64,     // Large natural structure, high priority
    "Statue": 10    // Largest structure, highest priority
};

// Debug helper to print monster configurations
export function logMonsterConfigs() {
    console.log("=== Monster Configurations ===");
    console.log("Asset keys:", MONSTER_ASSET_KEYS);
    console.log("Shadow offsets X:", MONSTER_SHADOW_OFFSETS_X);
    console.log("Shadow offsets Y:", MONSTER_SHADOW_OFFSETS_Y);
} 