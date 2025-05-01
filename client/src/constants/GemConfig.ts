/**
 * Configuration for gem rendering and behavior
 */

// Asset keys for different gem levels (1-4)
export const GEM_ASSET_KEYS: { [key: number]: string } = {
    0: 'gem_1', // Small gem (using index 0 for gem level Small)
    1: 'gem_2', // Medium gem
    2: 'gem_3', // Large gem
    3: 'gem_4'  // Huge gem
};

// Animation configuration for gems
export const GEM_ANIMATION = {
    HOVER_AMPLITUDE: 5,      // How high gems hover in pixels
    HOVER_SPEED: 1.5,        // Speed of hover animation
    ROTATION_SPEED: 0.5,     // Speed of rotation (in degrees per frame)
    COLLECTION_PARTICLES: 8  // Number of particles when collected
};

// Colors for particles based on gem level
export const GEM_PARTICLE_COLORS: { [key: number]: number } = {
    0: 0xd1e8ff,  // Light blue for small gems
    1: 0x59ff96,  // Light green for medium gems
    2: 0xffd659,  // Yellow for large gems
    3: 0xff59a5   // Pink for huge gems
};

// Sound configuration for gems
export const GEM_SOUNDS = {
    COLLECT: 'gem_collect',
    SPAWN: 'gem_spawn'
}; 