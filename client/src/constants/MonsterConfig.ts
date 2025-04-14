// Monster-specific configuration values

// Asset keys for different monster types
export const MONSTER_ASSET_KEYS: Record<string, string> = {
    "Rat": 'monster_rat',
    "Slime": 'monster_slime',
    "Orc": 'monster_orc'
};

// Shadow offset configurations for each monster type (vertical offset in pixels)
export const MONSTER_SHADOW_OFFSETS: Record<string, number> = {
    "Rat": -10,     // Smaller monster, smaller shadow offset
    "Slime": -12,    // Very low to the ground
    "Orc": 12      // Larger monster, bigger shadow offset
};

// Monster health configuration
export const MONSTER_MAX_HP: Record<string, number> = {
    "Rat": 10,
    "Slime": 25,
    "Orc": 50,
    "default": 100  // Default value for unknown monsters
};

// Debug helper to print monster configurations
export function logMonsterConfigs() {
    console.log("=== Monster Configurations ===");
    console.log("Asset keys:", MONSTER_ASSET_KEYS);
    console.log("Shadow offsets:", MONSTER_SHADOW_OFFSETS);
    console.log("Max HP values:", MONSTER_MAX_HP);
} 