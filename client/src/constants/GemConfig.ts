/**
 * Configuration for gem rendering and behavior
 */

// Asset keys for different gem levels based on GemLevel enum tag
export const GEM_ASSET_KEYS: { [key: string]: string } = {
    'Small': 'gem_1',  // Small gem
    'Medium': 'gem_2', // Medium gem
    'Large': 'gem_3',  // Large gem
    'Huge': 'gem_4'    // Huge gem
};

// Animation configuration for gems
export const GEM_ANIMATION = {
    HOVER_AMPLITUDE: 5,      // How high gems hover in pixels
    HOVER_SPEED: 1.5,        // Speed of hover animation
    ROTATION_SPEED: 0.5,     // Speed of rotation (in degrees per frame)
    COLLECTION_PARTICLES: 8  // Number of particles when collected
};

// Colors for particles based on gem level
export const GEM_PARTICLE_COLORS: { [key: string]: number } = {
    'Small': 0xd1e8ff,  // Light blue for small gems
    'Medium': 0x59ff96, // Light green for medium gems
    'Large': 0xffd659,  // Yellow for large gems
    'Huge': 0xff59a5    // Pink for huge gems
};

// Sound configuration for gems
export const GEM_SOUNDS = {
    COLLECT: 'gem_collect',
    SPAWN: 'gem_spawn'
}; 