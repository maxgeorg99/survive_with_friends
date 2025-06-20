use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, MonsterAttackType, config, player, bestiary, monsters, monsters_boid, MonsterSpawners, 
           DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT};
use crate::monster_attacks_def::active_monster_attacks;
use crate::monster_ai_defs::monster_state_changes;
use std::time::Duration;

// Configuration constants for Agna Flamethrower pattern
const AGNA_FLAMETHROWER_DURATION_MS: u64 = 10000;     // 10 seconds flamethrower phase
const AGNA_FLAMETHROWER_SPEED_MULTIPLIER: f32 = 1.6;  // Speed boost while chasing
const AGNA_FLAMETHROWER_JET_INTERVAL_MS: u64 = 100;   // Fire rapidly every 100ms
const AGNA_FLAMETHROWER_CIRCLE_RADIUS: f32 = 128.0;   // Radius of circle around target for random positions

// Configuration constants for AgnaFlamethrowerJet projectiles
const AGNA_FLAMETHROWER_JET_DAMAGE: u32 = 25;         // Damage per projectile
const AGNA_FLAMETHROWER_JET_SPEED: f32 = 600.0;       // Movement speed
const AGNA_FLAMETHROWER_JET_INITIAL_RADIUS: f32 = 16.0; // Starting radius
const AGNA_FLAMETHROWER_JET_FINAL_RADIUS: f32 = 64.0;   // Final radius
const AGNA_FLAMETHROWER_JET_DURATION_MS: u64 = 3000;    // 3 seconds lifespan

// Table to track the last chosen pattern for each Agna boss to avoid repetition
#[table(name = boss_agna_last_patterns, public)]
pub struct BossAgnaLastPattern {
    #[primary_key]
    pub monster_id: u32,
    
    pub last_pattern: crate::monster_ai_defs::AIState,
}

// Scheduled table for AgnaFlamethrowerJet attacks during flamethrower pattern
#[table(name = agna_flamethrower_scheduler, scheduled(trigger_agna_flamethrower_attack), public)]
pub struct AgnaFlamethrowerScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the next flamethrower jet should fire
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster that will fire the jet
    pub target_player_id: u32,    // The target player being chased
}

// Handle movement for Agna's special attacks
pub fn handle_agna_attack_movement(ctx: &ReducerContext, attack: &mut crate::ActiveMonsterAttack) {
    match attack.monster_attack_type {
        MonsterAttackType::AgnaFlamethrowerJet => {
            // Regular projectile movement for flamethrower jets
            let move_speed = attack.speed;
            let move_distance = move_speed * DELTA_TIME;
            let move_offset = attack.direction * move_distance;
            attack.position = attack.position + move_offset;
            
            // Handle radius growth based on ticks elapsed using asymptotic easing
            let time_elapsed_seconds = attack.ticks_elapsed as f32 * DELTA_TIME;
            let duration_seconds = AGNA_FLAMETHROWER_JET_DURATION_MS as f32 / 1000.0;
            let linear_progress = (time_elapsed_seconds / duration_seconds).min(1.0);
            
            // Use same asymptotic easing as client: 1 - (1-t)^2
            let eased_progress = 1.0 - (1.0 - linear_progress).powf(2.0);
            
            // Apply eased progress to radius growth from initial to final
            let radius_range = AGNA_FLAMETHROWER_JET_FINAL_RADIUS - AGNA_FLAMETHROWER_JET_INITIAL_RADIUS;
            attack.radius = AGNA_FLAMETHROWER_JET_INITIAL_RADIUS + (radius_range * eased_progress);
            
            /*
            log::info!("AgnaFlamethrowerJet {} grew to radius {} after {} ticks", 
                      attack.active_monster_attack_id, attack.radius, attack.ticks_elapsed);
            */
        },
        _ => {
            // Other attacks use default behavior
        }
    }
}

// Reducer to fire a flamethrower jet
#[reducer]
pub fn trigger_agna_flamethrower_attack(ctx: &ReducerContext, scheduler: AgnaFlamethrowerScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_agna_flamethrower_attack may not be invoked by clients, only via scheduling.");
    }

    // Check if the Agna boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Agna boss {} no longer exists, stopping flamethrower attacks", scheduler.boss_monster_id);
            return;
        }
    };

    // Verify this is actually an Agna boss
    if boss.bestiary_id != MonsterType::BossAgnaPhase1 && boss.bestiary_id != MonsterType::BossAgnaPhase2 {
        log::info!("Boss {} is not Agna, stopping flamethrower attacks", scheduler.boss_monster_id);
        return;
    }

    // Check if boss is still in flamethrower state
    if boss.ai_state != crate::monster_ai_defs::AIState::BossAgnaFlamethrower {
        log::info!("Agna boss {} no longer in flamethrower state, stopping attacks", scheduler.boss_monster_id);
        return;
    }

    // Get the target player
    let target_player_opt = ctx.db.player().player_id().find(&scheduler.target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::info!("Target player {} no longer exists, continuing flamethrower with random target", scheduler.target_player_id);
            // Try to find a random player instead
            match find_random_player(ctx) {
                Some(player_id) => {
                    match ctx.db.player().player_id().find(&player_id) {
                        Some(player) => player,
                        None => {
                            log::info!("Random player {} not found", player_id);
                            return;
                        }
                    }
                },
                None => {
                    log::info!("No players available for flamethrower attack");
                    return;
                }
            }
        }
    };

    // Generate a random position in a circle around the target player
    let mut rng = ctx.rng();
    let angle = rng.gen::<f32>() * 2.0 * std::f32::consts::PI;
    let distance = rng.gen::<f32>() * AGNA_FLAMETHROWER_CIRCLE_RADIUS;
    
    let target_position = DbVector2::new(
        target_player.position.x + angle.cos() * distance,
        target_player.position.y + angle.sin() * distance
    );

    // Get boss position from boid table
    let boss_boid_opt = ctx.db.monsters_boid().monster_id().find(&boss.monster_id);
    let boss_position = match boss_boid_opt {
        Some(boid) => boid.position,
        None => {
            log::info!("Boss {} boid not found, stopping flamethrower attacks", boss.monster_id);
            return;
        }
    };

    // Calculate direction from boss to target position
    let direction_vector = DbVector2::new(
        target_position.x - boss_position.x,
        target_position.y - boss_position.y
    ).normalize();

    // Spawn the flamethrower jet
    let jet_attack = crate::ActiveMonsterAttack {
        active_monster_attack_id: 0, // Will be auto-assigned
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_FLAMETHROWER_JET_DURATION_MS)),
        position: boss_position,
        direction: direction_vector,
        monster_attack_type: MonsterAttackType::AgnaFlamethrowerJet,
        piercing: true,
        damage: AGNA_FLAMETHROWER_JET_DAMAGE,
        radius: AGNA_FLAMETHROWER_JET_INITIAL_RADIUS,
        speed: AGNA_FLAMETHROWER_JET_SPEED,
        parameter_u: 0,
        parameter_f: 0.0,
        ticks_elapsed: 0,
        from_shiny_monster: false, // Bosses are not shiny
    };

    ctx.db.active_monster_attacks().insert(jet_attack);

    log::info!("Agna boss {} fired flamethrower jet towards ({}, {})", 
              scheduler.boss_monster_id, target_position.x, target_position.y);

    // Schedule the next flamethrower attack
    schedule_next_agna_flamethrower_attack(ctx, scheduler.boss_monster_id, scheduler.target_player_id);
}

// Schedule the next flamethrower attack
fn schedule_next_agna_flamethrower_attack(ctx: &ReducerContext, boss_monster_id: u32, target_player_id: u32) {
    ctx.db.agna_flamethrower_scheduler().insert(AgnaFlamethrowerScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_FLAMETHROWER_JET_INTERVAL_MS)),
        boss_monster_id,
        target_player_id,
    });
}

// Start flamethrower attacks for an Agna boss
pub fn start_agna_flamethrower_attacks(ctx: &ReducerContext, boss_monster_id: u32, target_player_id: u32) {
    log::info!("Starting flamethrower attacks for Agna boss {} targeting player {}", boss_monster_id, target_player_id);
    
    // Schedule the first flamethrower attack immediately
    ctx.db.agna_flamethrower_scheduler().insert(AgnaFlamethrowerScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(100)), // Start immediately
        boss_monster_id,
        target_player_id,
    });
}

// Cleanup flamethrower schedules for a boss
pub fn cleanup_agna_flamethrower_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Cleaning up flamethrower schedules for Agna boss {}", boss_monster_id);
    
    // Find and delete all flamethrower schedulers for this boss
    let schedulers_to_delete: Vec<_> = ctx.db.agna_flamethrower_scheduler().iter()
        .filter(|scheduler| scheduler.boss_monster_id == boss_monster_id)
        .collect();
    
    for scheduler in schedulers_to_delete {
        ctx.db.agna_flamethrower_scheduler().scheduled_id().delete(&scheduler.scheduled_id);
        log::info!("Deleted flamethrower scheduler {} for boss {}", scheduler.scheduled_id, boss_monster_id);
    }
}

// Find a random player for targeting
fn find_random_player(ctx: &ReducerContext) -> Option<u32> {
    let players: Vec<_> = ctx.db.player().iter().collect();
    
    if players.is_empty() {
        return None;
    }
    
    let mut rng = ctx.rng();
    let random_index = rng.gen_range(0..players.len());
    Some(players[random_index].player_id)
}

// Apply speed boost when entering BossAgnaFlamethrower state (called once on state entry)
pub fn apply_agna_flamethrower_speed_boost(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Applying flamethrower speed boost to Agna boss {}", monster.monster_id);
    increase_monster_speed(ctx, monster, AGNA_FLAMETHROWER_SPEED_MULTIPLIER);
}

// Execute behavior when entering BossAgnaFlamethrower state
pub fn execute_boss_agna_flamethrower_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Agna boss {} entering flamethrower state", monster.monster_id);

    // Apply speed boost first (called once on state entry)
    apply_agna_flamethrower_speed_boost(ctx, monster);
    
    // Find a random target player
    let target_player_id = match find_random_player(ctx) {
        Some(player_id) => player_id,
        None => {
            log::info!("No players available for flamethrower targeting, returning to idle");
            schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, 1000);
            return;
        }
    };
    
    log::info!("Agna boss {} targeting player {} for flamethrower attack", monster.monster_id, target_player_id);
    
    // Start firing flamethrower jets
    start_agna_flamethrower_attacks(ctx, monster.monster_id, target_player_id);
    
    // Schedule return to idle after flamethrower duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, AGNA_FLAMETHROWER_DURATION_MS);
}

// Execute behavior when entering BossAgnaIdle state
pub fn execute_boss_agna_idle_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Agna boss {} entering idle state", monster.monster_id);
    
    // Cleanup any active flamethrower schedules
    cleanup_agna_flamethrower_schedules(ctx, monster.monster_id);
    
    // Reset speed to bestiary value
    reset_monster_speed_to_bestiary(ctx, monster);
    
    // Schedule next pattern after idle duration
    let idle_duration_ms = 3000; // 3 seconds idle
    schedule_random_boss_agna_pattern(ctx, monster.monster_id, idle_duration_ms);
}

// Schedule a random Agna boss pattern
pub fn schedule_random_boss_agna_pattern(ctx: &ReducerContext, monster_id: u32, delay_ms: u64) {
    log::info!("Scheduling random Agna pattern for monster {} in {}ms", monster_id, delay_ms);
    
    // For now, just use flamethrower pattern - we can add more patterns later
    let chosen_pattern = crate::monster_ai_defs::AIState::BossAgnaFlamethrower;
    
    // Update last pattern tracking
    let last_pattern_opt = ctx.db.boss_agna_last_patterns().monster_id().find(&monster_id);
    if let Some(mut last_pattern) = last_pattern_opt {
        last_pattern.last_pattern = chosen_pattern;
        ctx.db.boss_agna_last_patterns().monster_id().update(last_pattern);
    } else {
        ctx.db.boss_agna_last_patterns().insert(BossAgnaLastPattern {
            monster_id,
            last_pattern: chosen_pattern,
        });
    }
    
    // Schedule the pattern
    schedule_state_change(ctx, monster_id, chosen_pattern, delay_ms);
}

// Initialize Agna boss AI
pub fn initialize_boss_agna_ai(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Initializing Agna boss AI for monster {}", monster_id);
    
    // Start with idle behavior
    let idle_delay_ms = 3000; // 3 seconds before first pattern
    schedule_random_boss_agna_pattern(ctx, monster_id, idle_delay_ms);
}

// Initialize Phase 2 Agna boss AI
pub fn initialize_phase2_boss_agna_ai(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Initializing Phase 2 Agna boss AI for monster {}", monster_id);
    
    // Phase 2 Agna uses the same patterns as Phase 1 for now
    initialize_boss_agna_ai(ctx, monster_id);
}

// Helper function to reset monster speed to bestiary entry
fn reset_monster_speed_to_bestiary(ctx: &ReducerContext, monster: &crate::Monsters) {
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32))
        .expect("reset_monster_speed_to_bestiary: Could not find bestiary entry");
    
    let mut updated_monster = monster.clone();
    updated_monster.speed = bestiary_entry.speed;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Agna monster {} speed reset to {}", monster.monster_id, bestiary_entry.speed);
}

// Helper function to increase monster speed (called only once during state entry)
fn increase_monster_speed(ctx: &ReducerContext, monster: &crate::Monsters, multiplier: f32) {
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32))
        .expect("increase_monster_speed: Could not find bestiary entry");
    
    let base_speed = bestiary_entry.speed;
    let target_speed = base_speed * multiplier;
    
    let mut updated_monster = monster.clone();
    updated_monster.speed = target_speed;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Agna monster {} speed increased from {} to {} (base: {}, multiplier: {})", 
              monster.monster_id, monster.speed, target_speed, base_speed, multiplier);
}

// Helper function to schedule a state change
fn schedule_state_change(ctx: &ReducerContext, monster_id: u32, target_state: crate::monster_ai_defs::AIState, delay_ms: u64) {
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster_id,
        target_state,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(delay_ms)),
    });
    
    log::info!("Scheduled state change for Agna monster {} to {:?} in {}ms", monster_id, target_state, delay_ms);
}

// Cleanup all AI schedules for an Agna boss (used during boss transitions)
pub fn cleanup_agna_ai_schedules(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Cleaning up all Agna AI schedules for monster {}", monster_id);
    
    // Cleanup flamethrower schedules
    cleanup_agna_flamethrower_schedules(ctx, monster_id);
    
    // Remove last pattern tracking
    if ctx.db.boss_agna_last_patterns().monster_id().find(&monster_id).is_some() {
        ctx.db.boss_agna_last_patterns().monster_id().delete(&monster_id);
        log::info!("Removed last pattern tracking for Agna boss {}", monster_id);
    }
} 