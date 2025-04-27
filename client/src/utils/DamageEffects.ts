/**
 * Utility functions for rendering damage visual effects
 */

import Phaser from 'phaser';

// Constants for player damage effects
export const PLAYER_DAMAGE_FLASH_DURATION = 300; // milliseconds
export const PLAYER_DAMAGE_FLASH_COLOR = 0xFF0000; // bright red

// Constants for monster damage effects
export const MONSTER_DAMAGE_FLASH_DURATION = 300; // milliseconds
export const MONSTER_DAMAGE_ALPHA = 0.5; // alpha value during flash

// Cooldown to prevent visual spam with rapid damage
export const COOLDOWN_BETWEEN_FLASHES = 100; // milliseconds

// Map to track the last flash time for each sprite
const lastFlashTimes = new Map<Phaser.GameObjects.Sprite, number>();

/**
 * Apply a damage effect to a player sprite (red flash)
 * @param sprite The sprite to apply the effect to
 */
export function createPlayerDamageEffect(sprite: Phaser.GameObjects.Sprite): void {
    const currentTime = Date.now();
    const lastFlashTime = lastFlashTimes.get(sprite) || 0;
    
    // Check if we're in cooldown period to prevent visual spam
    if (currentTime - lastFlashTime < COOLDOWN_BETWEEN_FLASHES) {
        console.log("Damage effect cooldown active, skipping flash");
        return;
    }
    
    // Store the current time as the last flash time
    lastFlashTimes.set(sprite, currentTime);
    
    // Apply red tint
    sprite.setTint(PLAYER_DAMAGE_FLASH_COLOR);
    console.log("Applied damage flash effect to player");
    
    // Clear tint after duration
    sprite.scene.time.delayedCall(PLAYER_DAMAGE_FLASH_DURATION, () => {
        sprite.clearTint();
    });
}

/**
 * Apply a damage effect to a monster sprite (transparency flash)
 * @param sprite The sprite to apply the effect to
 */
export function createMonsterDamageEffect(sprite: Phaser.GameObjects.Sprite): void {
    const currentTime = Date.now();
    const lastFlashTime = lastFlashTimes.get(sprite) || 0;
    
    // Check if we're in cooldown period to prevent visual spam
    if (currentTime - lastFlashTime < COOLDOWN_BETWEEN_FLASHES) {
        console.log("Damage effect cooldown active, skipping flash");
        return;
    }
    
    // Store the current time as the last flash time
    lastFlashTimes.set(sprite, currentTime);
    
    // Store original alpha
    const originalAlpha = sprite.alpha;
    
    // Apply transparency effect
    sprite.setAlpha(MONSTER_DAMAGE_ALPHA);
    console.log("Applied damage flash effect to monster");
    
    // Restore original alpha after duration
    sprite.scene.time.delayedCall(MONSTER_DAMAGE_FLASH_DURATION, () => {
        sprite.setAlpha(originalAlpha);
    });
} 