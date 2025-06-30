use spacetimedb::{ReducerContext, rand::Rng};
use crate::{GemLevel, MonsterType, account, bestiary};
use std::collections::HashMap;

// Gem drop weight tables for each monster tier (0-5)
// Each tuple represents (GemLevel, Weight) pairs for better gem drops from higher tier monsters
// Higher weights = more likely to drop, VoidChests and bosses use different logic
pub const TIER_GEM_DROP_WEIGHTS: [&[(GemLevel, u32)]; 6] = [
    // Tier 0 (Rat, VoidChest): Basic drops, mostly small gems
    &[
        (GemLevel::Small, 85),
        (GemLevel::Medium, 15),
        (GemLevel::Large, 0),
        (GemLevel::Huge, 0),
    ],
    
    // Tier 1 (Slime, EnderClaw): Slightly better drops
    &[
        (GemLevel::Small, 70),
        (GemLevel::Medium, 25),
        (GemLevel::Large, 5),
        (GemLevel::Huge, 0),
    ],
    
    // Tier 2 (Bat): Improved drops, small chance for large gems
    &[
        (GemLevel::Small, 60),
        (GemLevel::Medium, 30),
        (GemLevel::Large, 10),
        (GemLevel::Huge, 0),
    ],
    
    // Tier 3 (Orc): Good drops, decent chance for large gems
    &[
        (GemLevel::Small, 45),
        (GemLevel::Medium, 35),
        (GemLevel::Large, 18),
        (GemLevel::Huge, 2),
    ],
    
    // Tier 4 (Imp): Great drops, good chance for large gems
    &[
        (GemLevel::Small, 30),
        (GemLevel::Medium, 40),
        (GemLevel::Large, 25),
        (GemLevel::Huge, 5),
    ],
    
    // Tier 5 (Zombie, Boss): Excellent drops, high chance for large/huge gems
    &[
        (GemLevel::Small, 20),
        (GemLevel::Medium, 35),
        (GemLevel::Large, 35),
        (GemLevel::Huge, 10),
    ],
];

/// Select a gem level based on monster tier weights
pub fn select_weighted_gem_level(ctx: &ReducerContext, monster_tier: u32) -> GemLevel {
    let tier_index = (monster_tier as usize).min(TIER_GEM_DROP_WEIGHTS.len() - 1);
    let weights = TIER_GEM_DROP_WEIGHTS[tier_index];
    
    // Calculate total weight
    let total_weight: u32 = weights.iter().map(|(_, weight)| weight).sum();
    
    if total_weight == 0 {
        // Fallback to Small gem if all weights are 0
        log::warn!("All gem drop weights are 0 for tier {}, defaulting to Small gem", monster_tier);
        return GemLevel::Small;
    }
    
    // Generate random number between 1 and total_weight (inclusive)
    let mut rng = ctx.rng();
    let mut random_value = rng.gen_range(1..=total_weight);
    
    // Find which gem level this random value corresponds to
    for &(ref gem_level, weight) in weights.iter() {
        if random_value <= weight {
            return gem_level.clone();
        }
        random_value -= weight;
    }
    
    // Fallback (should never reach here) - return Small gem
    log::warn!("Weighted gem selection failed for tier {}, defaulting to Small gem", monster_tier);
    GemLevel::Small
}

/// Get a debug string showing the current gem drop weights for a tier
pub fn get_tier_gem_weights_debug_string(tier: u32) -> String {
    let tier_index = (tier as usize).min(TIER_GEM_DROP_WEIGHTS.len() - 1);
    let weights = TIER_GEM_DROP_WEIGHTS[tier_index];
    
    // Create a HashMap for easy lookup
    let weight_map: HashMap<GemLevel, u32> = weights.iter().cloned().collect();
    
    format!(
        "Tier {} gem weights: Small={}, Medium={}, Large={}, Huge={}",
        tier, 
        weight_map.get(&GemLevel::Small).unwrap_or(&0),
        weight_map.get(&GemLevel::Medium).unwrap_or(&0),
        weight_map.get(&GemLevel::Large).unwrap_or(&0),
        weight_map.get(&GemLevel::Huge).unwrap_or(&0)
    )
}

/// Calculate gem drop percentages for each level at a given tier
pub fn get_gem_drop_percentages(tier: u32) -> Vec<(GemLevel, f32)> {
    let tier_index = (tier as usize).min(TIER_GEM_DROP_WEIGHTS.len() - 1);
    let weights = TIER_GEM_DROP_WEIGHTS[tier_index];
    let total_weight: u32 = weights.iter().map(|(_, weight)| weight).sum();
    
    if total_weight == 0 {
        return vec![];
    }
    
    weights.iter()
        .map(|&(ref gem_level, weight)| {
            let percentage = (weight as f32 / total_weight as f32) * 100.0;
            (gem_level.clone(), percentage)
        })
        .collect()
}

/// Debug reducer to check gem drop weights for a monster type
#[spacetimedb::reducer]
pub fn debug_check_gem_drops(ctx: &spacetimedb::ReducerContext) {
    // Get the caller's identity
    let caller_identity = ctx.sender;
    
    // Find the caller's account
    let account_opt = ctx.db.account().identity().find(&caller_identity);
    if account_opt.is_none() {
        log::error!("debug_check_gem_drops: Account not found for caller");
        return;
    }
    
    let account = account_opt.unwrap();
    if account.current_player_id == 0 {
        log::error!("debug_check_gem_drops: Caller has no active player");
        return;
    }
    
    log::info!("=== GEM DROP DEBUG INFO ===");
    
    // Show gem drop info for each monster type
    let monster_types = [
        MonsterType::Rat,
        MonsterType::Slime,
        MonsterType::Bat,
        MonsterType::Orc,
        MonsterType::Imp,
        MonsterType::Zombie,
        MonsterType::BossEnderPhase1,
        MonsterType::BossEnderPhase2,
        MonsterType::BossAgnaPhase1,
        MonsterType::BossAgnaPhase2,
    ];
    
    for monster_type in monster_types {
        // Get bestiary entry for this monster
        if let Some(bestiary_entry) = ctx.db.bestiary().bestiary_id().find(&(monster_type.clone() as u32)) {
            let tier = bestiary_entry.tier;
            log::info!("{:?} (Tier {}): {}", monster_type, tier, get_tier_gem_weights_debug_string(tier));
            
            let percentages = get_gem_drop_percentages(tier);
            for (gem_level, percentage) in percentages {
                log::info!("  {:?}: {:.1}%", gem_level, percentage);
            }
        }
    }
    
    log::info!("Note: Special items (Fries, Dice, BoosterPack) have separate fixed drop rates");
    log::info!("=================================");
} 