/**
 * Configuration for gem rendering and behavior
 */

// Asset keys for different gem levels based on GemLevel enum tag
export const GEM_ASSET_KEYS: { [key: string]: string } = {
    'Small': 'gem_1',           // Small gem
    'Medium': 'gem_2',          // Medium gem
    'Large': 'gem_3',           // Large gem
    'Huge': 'gem_4',            // Huge gem
    'Soul': 'soul',             // Soul gem (created from player deaths)
    'Fries': 'fries',           // Special gem that heals HP
    'Dice': 'dice',             // Special gem that grants rerolls
    'BoosterPack': 'booster_pack', // Special gem that grants upgrade points
    'LoreScroll': 'lore_scroll' // Special gem that levels player up exactly once
};

// Animation configuration for gems
export const GEM_ANIMATION = {
    HOVER_AMPLITUDE: 8,      // How high gems hover in pixels (increased from 5)
    HOVER_SPEED: 1.2,        // Speed of hover animation (slightly slower for smoother effect)
    ROTATION_SPEED: 0.5,     // Speed of rotation (in degrees per frame)
    COLLECTION_PARTICLES: 8  // Number of particles when collected
};

// Colors for particles based on gem level
export const GEM_PARTICLE_COLORS: { [key: string]: number } = {
    'Small': 0xd1e8ff,          // Light blue for small gems
    'Medium': 0x59ff96,         // Light green for medium gems
    'Large': 0xffd659,          // Yellow for large gems
    'Huge': 0xff59a5,           // Pink for huge gems
    'Soul': 0x9966ff,           // Purple for soul gems
    'Fries': 0xffaa00,          // Orange for fries (healing)
    'Dice': 0x00ffff,           // Cyan for dice (reroll)
    'BoosterPack': 0xff6600,    // Orange-red for booster packs (upgrades)
    'LoreScroll': 0xffd700      // Gold for lore scrolls (ancient knowledge)
};

// Sound configuration for gems
export const GEM_SOUNDS = {
    COLLECT: 'gem_collect',
    SPAWN: 'gem_spawn'
}; 