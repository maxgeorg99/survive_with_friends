// Player character-specific configuration values

// Asset keys for different player classes
export const PLAYER_CLASS_ASSET_KEYS: Record<string, string> = {
    "Fighter": 'player_fighter',
    "Rogue": 'player_rogue',
    "Mage": 'player_mage',
    "Paladin": 'player_paladin',
    "Valkyrie": 'player_valkyrie'
};

// Shadow offset configurations for each player class (horizontal offset in pixels)
export const PLAYER_SHADOW_OFFSETS_X: Record<string, number> = {
    "Fighter": 0,   // Default - no horizontal offset
    "Rogue": -3,     // Default - no horizontal offset
    "Mage": -2,      // Default - no horizontal offset
    "Paladin": 0,   // Default - no horizontal offset
    "Valkyrie": -7   // Default - no horizontal offset
};

// Shadow offset configurations for each player class (vertical offset in pixels)
export const PLAYER_SHADOW_OFFSETS_Y: Record<string, number> = {
    "Fighter": 14,   // Default current value
    "Rogue": 13,     // Default current value
    "Mage": 7,      // Default current value
    "Paladin": 14,   // Default current value
    "Valkyrie": 13   // Default current value
};

// Shadow scale configurations for each player class
export const PLAYER_SHADOW_SCALE: Record<string, number> = {
    "Fighter": 1.0,   // Default scale
    "Rogue": 1.0,     // Default scale
    "Mage": 1.0,      // Default scale
    "Paladin": 1.0,   // Default scale
    "Valkyrie": 1.0   // Default scale
};

// Shadow alpha (transparency) configurations for each player class
export const PLAYER_SHADOW_ALPHA: Record<string, number> = {
    "Fighter": 0.4,   // Default current value
    "Rogue": 0.4,     // Default current value
    "Mage": 0.4,      // Default current value
    "Paladin": 0.4,   // Default current value
    "Valkyrie": 0.4   // Default current value
};

// Helper function to get player class name from various formats
export function getPlayerClassName(playerClass: any): string {
    // Handle case when playerClass is a simple object with a tag property
    if (playerClass && typeof playerClass === 'object' && 'tag' in playerClass) {
        return playerClass.tag;
    }
    
    // Handle case when playerClass is just a string
    if (typeof playerClass === 'string') {
        return playerClass;
    }
    
    // Handle case when playerClass is a number (enum value)
    if (typeof playerClass === 'number') {
        // Map numeric enum values to class names
        const classNames = ["Fighter", "Rogue", "Mage", "Paladin", "Valkyrie"];
        return classNames[playerClass] || "Fighter";
    }
    
    // Default fallback
    return "Fighter";
}

// Helper function to get shadow configuration for a player class
export function getPlayerShadowConfig(playerClass: any) {
    const className = getPlayerClassName(playerClass);
    
    return {
        offsetX: PLAYER_SHADOW_OFFSETS_X[className] || 0,
        offsetY: PLAYER_SHADOW_OFFSETS_Y[className] || 14,
        scale: PLAYER_SHADOW_SCALE[className] || 1.0,
        alpha: PLAYER_SHADOW_ALPHA[className] || 0.4,
        assetKey: PLAYER_CLASS_ASSET_KEYS[className] || 'player_fighter'
    };
}

// Debug helper to print player character configurations
export function logPlayerCharacterConfigs() {
    console.log("=== Player Character Configurations ===");
    console.log("Asset keys:", PLAYER_CLASS_ASSET_KEYS);
    console.log("Shadow offsets X:", PLAYER_SHADOW_OFFSETS_X);
    console.log("Shadow offsets Y:", PLAYER_SHADOW_OFFSETS_Y);
    console.log("Shadow scales:", PLAYER_SHADOW_SCALE);
    console.log("Shadow alphas:", PLAYER_SHADOW_ALPHA);
} 