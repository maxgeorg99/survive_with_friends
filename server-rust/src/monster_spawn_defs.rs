use spacetimedb::{ReducerContext, rand::Rng, Table};
use crate::{MonsterType, game_state, account, boss_spawn_timer};
use std::collections::HashMap;

// Maximum tier level (tier increases every 30 seconds up to this max)
pub const MAX_TIER: u32 = 5;

// Time in seconds between tier increases
pub const TIER_INCREASE_INTERVAL_SECONDS: u64 = 50;

// Spawn weight tables for each tier (0-9)
// Each tuple represents (MonsterType, Weight) pairs for easy readability
// Higher weights = more likely to spawn
pub const TIER_SPAWN_WEIGHTS: [&[(MonsterType, u32)]; 6] = [
    // Tier 0 (0-50s):
    &[
        (MonsterType::Rat, 80),
        (MonsterType::Slime, 20),
        (MonsterType::Bat, 0),
        (MonsterType::Orc, 0),
        (MonsterType::Imp, 0),
        (MonsterType::Zombie, 0),
    ],
    
    // Tier 1 (50-100s):
    &[
        (MonsterType::Rat, 40),
        (MonsterType::Slime, 40),
        (MonsterType::Bat, 10),
        (MonsterType::Orc, 0),
        (MonsterType::Imp, 0),
        (MonsterType::Zombie, 0),
    ],
    
    // Tier 2 (100-150s):
    &[
        (MonsterType::Rat, 30),
        (MonsterType::Slime, 40),
        (MonsterType::Bat, 30),
        (MonsterType::Orc, 5),
        (MonsterType::Imp, 0),
        (MonsterType::Zombie, 0),
    ],
    
    // Tier 3 (150-200s):
    &[
        (MonsterType::Rat, 20),
        (MonsterType::Slime, 30),
        (MonsterType::Bat, 40),
        (MonsterType::Orc, 20),
        (MonsterType::Imp, 5),
        (MonsterType::Zombie, 0),
    ],
    
    // Tier 4 (200-250s):
    &[
        (MonsterType::Rat, 10),
        (MonsterType::Slime, 20),
        (MonsterType::Bat, 30),
        (MonsterType::Orc, 40),
        (MonsterType::Imp, 10),
        (MonsterType::Zombie, 5),
    ],
    
    // Tier 5 (250-300s):
    &[
        (MonsterType::Rat, 5),
        (MonsterType::Slime, 10),
        (MonsterType::Bat, 15),
        (MonsterType::Orc, 20),
        (MonsterType::Imp, 10),
        (MonsterType::Zombie, 30),
    ],
];

/// Calculate the current world tier based on elapsed time since the current world session started
pub fn calculate_current_tier(ctx: &ReducerContext) -> u32 {
    // Try to get the session start time from the boss spawn timer
    // This is reliable because the boss timer gets scheduled when the first player joins
    // and includes the session_start_time field that records when schedule_boss_spawn was called
    let session_start_time = if let Some(boss_timer) = ctx.db.boss_spawn_timer().iter().next() {
        // Use the session_start_time field which records when the timer was created
        boss_timer.session_start_time
    } else {
        // No boss timer found, fallback to game state
        log::warn!("No boss spawn timer found, falling back to game state for session timing");
        ctx.db.game_state().id().find(&0)
            .map(|gs| gs.game_start_time)
            .unwrap_or(ctx.timestamp)
    };
    
    // Calculate elapsed time in seconds since session start
    if let Some(elapsed_duration) = ctx.timestamp.duration_since(session_start_time) {
        let elapsed_seconds = elapsed_duration.as_secs();
        
        // Check for BossAppearsSooner curse to accelerate tier progression
        let tier_interval = if crate::curses_defs::is_curse_active(ctx, crate::curses_defs::CurseType::BossAppearsSooner) {
            45 // Faster tier progression when curse is active
        } else {
            TIER_INCREASE_INTERVAL_SECONDS // Normal 50 second intervals
        };
        
        // Calculate tier (increases every tier_interval seconds)
        let calculated_tier = elapsed_seconds / tier_interval;
        
        // Cap at maximum tier
        calculated_tier.min(MAX_TIER as u64) as u32
    } else {
        // If duration calculation fails (timestamp in future), default to tier 0
        log::warn!("Failed to calculate elapsed time (session start may be in future), defaulting to tier 0");
        0
    }
}

/// Select a random monster type based on tier weights
pub fn select_weighted_monster_type(ctx: &ReducerContext, tier: u32) -> MonsterType {
    let tier_index = (tier as usize).min(TIER_SPAWN_WEIGHTS.len() - 1);
    let weights = TIER_SPAWN_WEIGHTS[tier_index];
    
    // Calculate total weight
    let total_weight: u32 = weights.iter().map(|(_, weight)| weight).sum();
    
    if total_weight == 0 {
        // Fallback to Rat if all weights are 0
        log::warn!("All spawn weights are 0 for tier {}, defaulting to Rat", tier);
        return MonsterType::Rat;
    }
    
    // Generate random number between 1 and total_weight (inclusive)
    let mut rng = ctx.rng();
    let mut random_value = rng.gen_range(1..=total_weight);
    
    // Find which monster type this random value corresponds to
    for &(ref monster_type, weight) in weights.iter() {
        if random_value <= weight {
            return monster_type.clone();
        }
        random_value -= weight;
    }
    
    // Fallback (should never reach here) - return the first monster type
    log::warn!("Weighted selection failed for tier {}, defaulting to Rat", tier);
    MonsterType::Rat
}

/// Get a debug string showing the current spawn weights for a tier
pub fn get_tier_weights_debug_string(tier: u32) -> String {
    let tier_index = (tier as usize).min(TIER_SPAWN_WEIGHTS.len() - 1);
    let weights = TIER_SPAWN_WEIGHTS[tier_index];
    
    // Create a HashMap for easy lookup
    let weight_map: HashMap<MonsterType, u32> = weights.iter().cloned().collect();
    
    format!(
        "Tier {} weights: Rat={}, Slime={}, Bat={}, Orc={}, Imp={}, Zombie={}",
        tier, 
        weight_map.get(&MonsterType::Rat).unwrap_or(&0),
        weight_map.get(&MonsterType::Slime).unwrap_or(&0),
        weight_map.get(&MonsterType::Bat).unwrap_or(&0),
        weight_map.get(&MonsterType::Orc).unwrap_or(&0),
        weight_map.get(&MonsterType::Imp).unwrap_or(&0),
        weight_map.get(&MonsterType::Zombie).unwrap_or(&0)
    )
}

/// Calculate spawn percentage for each monster type at a given tier
pub fn get_spawn_percentages(tier: u32) -> Vec<(MonsterType, f32)> {
    let tier_index = (tier as usize).min(TIER_SPAWN_WEIGHTS.len() - 1);
    let weights = TIER_SPAWN_WEIGHTS[tier_index];
    let total_weight: u32 = weights.iter().map(|(_, weight)| weight).sum();
    
    if total_weight == 0 {
        return vec![];
    }
    
    weights.iter()
        .map(|&(ref monster_type, weight)| {
            let percentage = (weight as f32 / total_weight as f32) * 100.0;
            (monster_type.clone(), percentage)
        })
        .collect()
}

/// Debug reducer to check current tier and spawn weights
#[spacetimedb::reducer]
pub fn debug_check_tier(ctx: &spacetimedb::ReducerContext) {
    // Get the caller's identity
    let caller_identity = ctx.sender;
    
    // Find the caller's account
    let account_opt = ctx.db.account().identity().find(&caller_identity);
    if account_opt.is_none() {
        log::error!("debug_check_tier: Account not found for caller");
        return;
    }
    
    let account = account_opt.unwrap();
    if account.current_player_id == 0 {
        log::error!("debug_check_tier: Caller has no active player");
        return;
    }
    
    // Calculate current tier
    let current_tier = calculate_current_tier(ctx);
    
    // Get spawn percentages for this tier
    let percentages = get_spawn_percentages(current_tier);
    
    // Calculate elapsed time (use same logic as calculate_current_tier)
    let session_start_time = if let Some(boss_timer) = ctx.db.boss_spawn_timer().iter().next() {
        boss_timer.session_start_time
    } else {
        ctx.db.game_state().id().find(&0)
            .map(|gs| gs.game_start_time)
            .unwrap_or(ctx.timestamp)
    };
    
    let elapsed_seconds = if let Some(elapsed_duration) = ctx.timestamp.duration_since(session_start_time) {
        elapsed_duration.as_secs()
    } else {
        0
    };
    
    log::info!("=== TIER DEBUG INFO ===");
    log::info!("Current tier: {} (elapsed: {}s)", current_tier, elapsed_seconds);
    log::info!("Tier increases every {} seconds", TIER_INCREASE_INTERVAL_SECONDS);
    log::info!("Max tier: {}", MAX_TIER);
    log::info!("Current spawn weights: {}", get_tier_weights_debug_string(current_tier));
    
    log::info!("Spawn percentages for tier {}:", current_tier);
    for (monster_type, percentage) in percentages {
        log::info!("  {:?}: {:.1}%", monster_type, percentage);
    }
    log::info!("  VoidChest: 0.5% (fixed rare spawn)");
    log::info!("======================");
} 