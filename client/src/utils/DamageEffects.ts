/**
 * Utility functions for rendering damage visual effects
 */

import Phaser from 'phaser';

// Constants for player damage effects
export const PLAYER_DAMAGE_FLASH_DURATION = 300; // milliseconds
export const PLAYER_DAMAGE_FLASH_COLOR = 0xFF0000; // bright red
export const PLAYER_DAMAGE_ALPHA = 0.7; // alpha value during flash (slightly transparent)

// Constants for monster damage effects
export const MONSTER_DAMAGE_FLASH_DURATION = 200; // milliseconds (reduced from 300ms)
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
        return;
    }
    
    // Store the current time as the last flash time
    lastFlashTimes.set(sprite, currentTime);
    
    // Store original alpha and ensure it's a valid value
    const originalAlpha = 1.0;
    
    // Store original alpha as data on the sprite for safekeeping
    sprite.setData('originalAlpha', originalAlpha);
    
    // Apply red tint and transparency
    sprite.setTint(PLAYER_DAMAGE_FLASH_COLOR);
    sprite.setAlpha(PLAYER_DAMAGE_ALPHA);
    
    // Cancel any previous pending reset to avoid conflicts
    if (sprite.getData('damageResetTimerKey')) {
        sprite.scene.time.removeEvent(sprite.getData('damageResetTimerKey'));
    }
    
    // Clear tint and restore alpha after duration with a new timer
    const timerEvent = sprite.scene.time.delayedCall(PLAYER_DAMAGE_FLASH_DURATION, () => {
        try {
            if (sprite && sprite.active) {
                // Get the stored original alpha as fallback
                const storedAlpha = sprite.getData('originalAlpha') || 1.0;
                
                // Clear tint first
                sprite.clearTint();
                
                // Force alpha restore with highest priority
                sprite.alpha = storedAlpha;
                
                sprite.setData('damageResetTimerKey', null);
            }
        } catch (error) {
            console.error("Error resetting player damage effect:", error);
        }
    });
    
    // Store the timer event for potential cancellation
    sprite.setData('damageResetTimerKey', timerEvent);
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
        return;
    }
    
    // Store the current time as the last flash time
    lastFlashTimes.set(sprite, currentTime);
    
    // Store original alpha and ensure it's a valid value
    const originalAlpha = 1.0;
    
    // Store original alpha as data on the sprite for safekeeping
    sprite.setData('originalAlpha', originalAlpha);
    
    // Apply transparency effect
    sprite.setAlpha(MONSTER_DAMAGE_ALPHA);
    
    // Cancel any previous pending reset to avoid conflicts
    if (sprite.getData('monsterDamageResetTimerKey')) {
        sprite.scene.time.removeEvent(sprite.getData('monsterDamageResetTimerKey'));
    }
    
    // Restore original alpha after duration with a new timer
    const timerEvent = sprite.scene.time.delayedCall(MONSTER_DAMAGE_FLASH_DURATION, () => {
        try {
            if (sprite && sprite.active) {
                // Get the stored original alpha as fallback
                const storedAlpha = sprite.getData('originalAlpha') || 1.0;
                
                // Force alpha restore with highest priority
                sprite.alpha = storedAlpha;
                
                sprite.setData('monsterDamageResetTimerKey', null);
            }
        } catch (error) {
            console.error("Error resetting monster damage effect:", error);
        }
    });
    
    // Store the timer event for potential cancellation
    sprite.setData('monsterDamageResetTimerKey', timerEvent);
} 