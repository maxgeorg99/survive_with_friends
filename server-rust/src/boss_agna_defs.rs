use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, MonsterAttackType, MonsterVariant, config, player, bestiary, monsters, monsters_boid, MonsterSpawners,
           DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, WORLD_SIZE, game_state};
use crate::monster_attacks_def::active_monster_attacks;
use crate::monster_ai_defs::monster_state_changes;
use std::time::Duration;

// General constants
const AGNA_IDLE_DURATION_MS: u64 = 3000;               // 3 seconds idle time between patterns

// Configuration constants for Agna Flamethrower pattern
const AGNA_FLAMETHROWER_DURATION_MS: u64 = 10000;     // 10 seconds flamethrower phase
const AGNA_FLAMETHROWER_SPEED_MULTIPLIER: f32 = 1.3;  // Speed boost while chasing
const AGNA_FLAMETHROWER_JET_INTERVAL_MS: u64 = 100;   // Fire rapidly every 100ms
const AGNA_FLAMETHROWER_CIRCLE_RADIUS: f32 = 128.0;   // Radius of circle around target for random positions

// Configuration constants for AgnaFlamethrowerJet projectiles
const AGNA_FLAMETHROWER_JET_DAMAGE: u32 = 25;         // Damage per projectile
const AGNA_FLAMETHROWER_JET_SPEED: f32 = 500.0;       // Movement speed
const AGNA_FLAMETHROWER_JET_INITIAL_RADIUS: f32 = 16.0; // Starting radius
const AGNA_FLAMETHROWER_JET_FINAL_RADIUS: f32 = 64.0;   // Final radius
const AGNA_FLAMETHROWER_JET_DURATION_MS: u64 = 3000;    // 3 seconds lifespan

// Configuration constants for Agna Magic Circle pattern
const AGNA_MAGIC_CIRCLE_DURATION_MS: u64 = 15000;      // 15 seconds magic circle phase
const AGNA_MAGIC_CIRCLE_ORBIT_RADIUS: f32 = 256.0;      // Distance circles orbit around player
const AGNA_MAGIC_CIRCLE_ORBIT_SPEED: f32 = 80.0;       // Degrees per second orbit speed
const AGNA_MAGIC_CIRCLES_PER_PLAYER: u32 = 4;          // 4 circles per player



// Configuration constants for AgnaFireOrb projectiles  
const AGNA_FIRE_ORB_DAMAGE: u32 = 20;                  // Damage per fire orb
const AGNA_FIRE_ORB_SPEED: f32 = 300.0;                // Movement speed (slower than flamethrower)
const AGNA_FIRE_ORB_RADIUS: f32 = 24.0;                // Collision radius
const AGNA_FIRE_ORB_DURATION_MS: u64 = 2500;           // 4 seconds lifespan
const AGNA_FIRE_ORB_SPAWN_INTERVAL_MS: u64 = 1000;     // Spawn orb every 1 second per player

// Configuration constants for AgnaOrbSpawn telegraph
const AGNA_ORB_SPAWN_TELEGRAPH_MS: u64 = 150;          // Telegraph appears
const AGNA_ORB_SPAWN_DURATION_MS: u64 = 50;           // Telegraph lasts

// Configuration constants for Agna Ritual pattern
const AGNA_RITUAL_MATCH_DURATION_MS: u64 = 4000;       // 4 seconds to create candles
const AGNA_RITUAL_WICK_DURATION_MS: u64 = 13000;       // 13 seconds for candle phase
const AGNA_RITUAL_FAILED_DURATION_MS: u64 = 3000;      // 3 seconds vulnerable if failed
const AGNA_RITUAL_COMPLETE_DAMAGE: u32 = 13;           // Damage per tick to all players
const AGNA_RITUAL_CANDLE_COUNT: u32 = 13;              // Number of candles to spawn
const AGNA_RITUAL_CIRCLE_RADIUS: f32 = 200.0;          // Radius of candle circle
const AGNA_CANDLE_BOLT_DAMAGE: u32 = 20;               // Damage per candle bolt
const AGNA_CANDLE_BOLT_SPEED: f32 = 400.0;             // Movement speed of candle bolts
const AGNA_CANDLE_BOLT_RADIUS: f32 = 24.0;             // Collision radius of candle bolts
const AGNA_CANDLE_BOLT_INTERVAL_MS: u64 = 1500;        // Candles fire every 1.5 seconds
const AGNA_RITUAL_COMPLETE_DURATION_MS: u64 = 4000;    // 4 second duration for ritual complete

// Configuration constants for Agna Phase 2
const AGNA_PHASE2_SUMMONING_RITUAL_SPAWN_RADIUS_MIN: f32 = 400.0; // Radius of summoning ritual
const AGNA_PHASE2_SUMMONING_RITUAL_SPAWN_RADIUS_RANGE: f32 = 400.0; // Radius of summoning ritual
const AGNA_PHASE2_SUMMONING_INITIAL_INTERVAL_MS: u64 = 5000;   // Start spawning every 8 seconds
const AGNA_PHASE2_SUMMONING_MIN_INTERVAL_MS: u64 = 1500;       // Minimum spawn interval (3 seconds)
const AGNA_PHASE2_SUMMONING_INTERVAL_REDUCTION_RATIO: f32 = 0.95; // Reduce interval by 10% each wave
const AGNA_PHASE2_TARGET_SWITCH_BASE_INTERVAL_MS: u64 = 12000;  // Base interval for target switching
const AGNA_PHASE2_TARGET_SWITCH_VARIATION_MS: u64 = 4000;      // Random variation (±4 seconds)
const AGNA_PHASE2_TARGET_SWITCH_INITIAL_DELAY_MS: u64 = 8000;   // Initial delay before first switch

// Configuration constants for AgnaPhase2FlameJet attacks
const AGNA_PHASE2_FLAME_JET_DAMAGE: u32 = 28;          // Higher damage than phase 1 jets
const AGNA_PHASE2_FLAME_JET_SPEED: f32 = 550.0;        // Faster than phase 1 jets
const AGNA_PHASE2_FLAME_JET_INITIAL_RADIUS: f32 = 16.0; // Starting radius (same as phase 1)
const AGNA_PHASE2_FLAME_JET_FINAL_RADIUS: f32 = 64.0;   // Final radius (same as phase 1)
const AGNA_PHASE2_FLAME_JET_DURATION_MS: u64 = 3000;   // 3 seconds lifespan
const AGNA_PHASE2_FLAME_JET_INTERVAL_MS: u64 = 150;    // Fire every 800ms for continuous effect

// Configuration constants for AgnaGroundFlame attacks
const AGNA_GROUND_FLAME_DAMAGE: u32 = 35;              // High damage ground effect
const AGNA_GROUND_FLAME_RADIUS: f32 = 80.0;            // Large area effect
const AGNA_GROUND_FLAME_DURATION_MS: u64 = 120000;     // 2 minutes duration (very long)

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
    
    pub boss_monster_id: u32,     // The boss monster that will fire the jet
    pub target_player_id: u32,    // The target player being chased
}

// Table for tracking magic circles that orbit around players
#[table(name = agna_magic_circles, public)]
pub struct AgnaMagicCircle {
    #[primary_key]
    #[auto_inc]
    pub circle_id: u64,
    
    pub boss_monster_id: u32,     // The Agna boss that spawned this circle
    pub target_player_id: u32,    // The player this circle orbits around
    pub circle_index: u32,        // Which of the 4 circles this is (0-3)
    pub initial_rotation: f32,    // Starting rotation angle in radians
    pub ticks_elapsed: u32,       // How many ticks since spawn
    pub position: DbVector2,      // Current position of the magic circle
}

// Scheduled table for AgnaFireOrb attacks during magic circle pattern
#[table(name = agna_fire_orb_scheduler, scheduled(trigger_agna_fire_orb_attack), public)]
pub struct AgnaFireOrbScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt,
    
    pub boss_monster_id: u32,     // The Agna boss that owns this pattern
    pub target_player_id: u32,    // The player being targeted
}

// Scheduled table for delayed real fire orb spawning (after telegraph)
#[table(name = agna_delayed_orb_scheduler, scheduled(spawn_delayed_agna_fire_orb), public)]
pub struct AgnaDelayedOrbScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt,
    
    pub boss_monster_id: u32,     // The Agna boss that owns this pattern
    pub target_player_id: u32,    // The player being targeted
    pub circle_position: DbVector2, // Position where the orb should spawn
    pub circle_index: u32,        // Which circle fired this orb (0-3)
}

// Table for tracking candle spawn positions during ritual
#[table(name = agna_candle_spawns, public)]
#[derive(Clone)]
pub struct AgnaCandleSpawn {
    #[primary_key]
    #[auto_inc]
    pub spawn_id: u64,
    
    pub boss_monster_id: u32,     // The Agna boss that created this spawn
    pub position: DbVector2,      // Position where the candle should spawn
    pub candle_index: u32,        // Which candle this is (0-12)
    pub candle_monster_id: u32,   // The monster ID of the spawned candle (0 if not yet spawned)
}

// Scheduled table for spawning candles during ritual wick phase
#[table(name = agna_candle_scheduler, scheduled(spawn_agna_candle), public)]
pub struct AgnaCandleScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt,
    
    pub boss_monster_id: u32,     // The Agna boss that owns this ritual
    pub spawn_id: u64,            // The AgnaCandleSpawn this scheduler will spawn
}

// Scheduled table for candle bolt attacks
#[table(name = agna_candle_bolt_scheduler, scheduled(trigger_agna_candle_bolt), public)]
pub struct AgnaCandleBoltScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt,
    
    pub candle_monster_id: u32,   // The candle monster that will fire
    pub target_player_id: u32,    // The target player
}

// Scheduled table for checking ritual completion
#[table(name = agna_ritual_completion_check, scheduled(check_agna_ritual_completion), public)]
pub struct AgnaRitualCompletionCheck {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt,
    
    pub boss_monster_id: u32,     // The Agna boss to check
}

// Scheduled table for Agna Phase 2 summoning circles
#[table(name = agna_summoning_circle_spawner, scheduled(spawn_agna_summoning_circle), public)]
pub struct AgnaSummoningCircleSpawner {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 Agna boss ID
    pub spawn_interval_ms: u64,   // Current spawn interval (decreases over time)
    pub scheduled_at: ScheduleAt, // When to spawn the next summoning circle
}

// Scheduled table for Agna Phase 2 target switching
#[table(name = agna_target_switch_scheduler, scheduled(trigger_agna_target_switch), public)]
pub struct AgnaTargetSwitchScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the boss should switch targets
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 Agna boss that will switch targets
}

// Scheduled table for Agna Phase 2 continuous flamethrower attacks
#[table(name = agna_phase2_flamethrower_scheduler, scheduled(trigger_agna_phase2_flamethrower_attack), public)]
pub struct AgnaPhase2FlamethrowerScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the next flamethrower jet should fire
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 Agna boss that will fire the jet
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
        MonsterAttackType::AgnaPhase2FlameJet => {
            // Phase 2 flame jets have the same radius growth as Phase 1
            let move_speed = attack.speed;
            let move_distance = move_speed * DELTA_TIME;
            let move_offset = attack.direction * move_distance;
            attack.position = attack.position + move_offset;
            
            // Handle radius growth based on ticks elapsed using asymptotic easing
            let time_elapsed_seconds = attack.ticks_elapsed as f32 * DELTA_TIME;
            let duration_seconds = AGNA_PHASE2_FLAME_JET_DURATION_MS as f32 / 1000.0;
            let linear_progress = (time_elapsed_seconds / duration_seconds).min(1.0);
            
            // Use same asymptotic easing as client: 1 - (1-t)^2
            let eased_progress = 1.0 - (1.0 - linear_progress).powf(2.0);
            
            // Apply eased progress to radius growth from initial to final
            let radius_range = AGNA_PHASE2_FLAME_JET_FINAL_RADIUS - AGNA_PHASE2_FLAME_JET_INITIAL_RADIUS;
            attack.radius = AGNA_PHASE2_FLAME_JET_INITIAL_RADIUS + (radius_range * eased_progress);
        },
        MonsterAttackType::AgnaGroundFlame => {
            // Ground flames are stationary - no movement
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

    // Ensure the scheduled target matches the boss's current target
    let current_target = boss.target_player_id;
    let scheduled_target = scheduler.target_player_id;
    
    let final_target_player_id = if current_target != scheduled_target {
        log::info!("Agna boss {} target changed from {} to {}, updating flamethrower target", 
                  scheduler.boss_monster_id, scheduled_target, current_target);
        current_target
    } else {
        scheduled_target
    };

    // Get the target player (using the corrected target)
    let target_player_opt = ctx.db.player().player_id().find(&final_target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::info!("Target player {} no longer exists, continuing flamethrower with random target", final_target_player_id);
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

    // Schedule the next flamethrower attack using the corrected target
    schedule_next_agna_flamethrower_attack(ctx, scheduler.boss_monster_id, target_player.player_id);
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
    
    // Always pick a new random target when entering flamethrower mode for variety
    let target_player_id = match find_random_player(ctx) {
        Some(player_id) => player_id,
        None => {
            log::info!("No players available for flamethrower targeting, returning to idle");
            schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, 1000);
            return;
        }
    };
    
    // Update the boss's chase target to match the flamethrower target
    let mut updated_monster = monster.clone();
    updated_monster.target_player_id = target_player_id;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Agna boss {} selected new random target player {} for flamethrower attack and chase", monster.monster_id, target_player_id);
    start_agna_flamethrower_attacks(ctx, monster.monster_id, target_player_id);
    
    // Schedule return to idle after flamethrower duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, AGNA_FLAMETHROWER_DURATION_MS);
}

// Execute behavior when entering BossAgnaIdle state
pub fn execute_boss_agna_idle_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Agna boss {} entering idle state", monster.monster_id);

    // Reset speed to base value when entering idle (ensures clean state between patterns)
    reset_monster_speed_to_bestiary(ctx, monster);

    // When entering idle, ensure all previous attack schedules are cleaned up
    cleanup_agna_flamethrower_schedules(ctx, monster.monster_id);
    cleanup_agna_magic_circle_schedules(ctx, monster.monster_id);
    
    // Safety cleanup: Remove any lingering candle spawn indicators in case boss 
    // exited ritual states without going through normal completion flow
    cleanup_agna_candle_spawn_indicators(ctx, monster.monster_id);

    // Schedule the next random pattern
    schedule_random_boss_agna_pattern(ctx, monster.monster_id, AGNA_IDLE_DURATION_MS);
}

// Schedule a random Agna boss pattern
pub fn schedule_random_boss_agna_pattern(ctx: &ReducerContext, monster_id: u32, delay_ms: u64) {
    log::info!("Scheduling random Agna pattern for monster {} in {}ms", monster_id, delay_ms);
    
    // Choose between available patterns
    let available_patterns = vec![
        crate::monster_ai_defs::AIState::BossAgnaFlamethrower,
        crate::monster_ai_defs::AIState::BossAgnaMagicCircle,
        crate::monster_ai_defs::AIState::BossAgnaRitualMatch,
    ];
    
    // Get last pattern to avoid repetition
    let last_pattern_opt = ctx.db.boss_agna_last_patterns().monster_id().find(&monster_id);
    let last_pattern = last_pattern_opt.as_ref().map(|p| p.last_pattern);
    
    // Filter out the last pattern if possible
    let filtered_patterns: Vec<_> = if available_patterns.len() > 1 {
        available_patterns.into_iter()
            .filter(|pattern| Some(*pattern) != last_pattern)
            .collect()
    } else {
        available_patterns
    };
    
    // Choose random pattern
    let mut rng = ctx.rng();
    let pattern_index = rng.gen::<usize>() % filtered_patterns.len();
    let chosen_pattern = filtered_patterns[pattern_index];
    
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
    
    // Phase 2 Agna has different behavior than Phase 1
    // Start summoning circles that spawn Imps and ground flames
    start_agna_phase2_summoning_circles(ctx, monster_id);
    
    // Start target switching for variety
    start_agna_phase2_target_switching(ctx, monster_id);
    
    // Start continuous flamethrower attacks
    start_agna_phase2_flamethrower_attacks(ctx, monster_id);
    
    log::info!("Phase 2 Agna boss {} initialized with summoning circles, target switching, and continuous flamethrower", monster_id);
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
    
    // Cleanup Phase 1 schedules
    cleanup_agna_flamethrower_schedules(ctx, monster_id);
    cleanup_agna_magic_circle_schedules(ctx, monster_id);
    cleanup_agna_candle_spawns(ctx, monster_id);
    cleanup_agna_candle_schedules(ctx, monster_id);
    cleanup_agna_ritual_completion_checks(ctx, monster_id);
    
    // Cleanup Phase 2 schedules
    cleanup_agna_phase2_schedules(ctx, monster_id);
    
    // Remove last pattern tracking
    if ctx.db.boss_agna_last_patterns().monster_id().find(&monster_id).is_some() {
        ctx.db.boss_agna_last_patterns().monster_id().delete(&monster_id);
        log::info!("Removed last pattern tracking for Agna boss {}", monster_id);
    }
}

// Reducer to spawn a fire orb from one of the magic circles
#[reducer]
pub fn trigger_agna_fire_orb_attack(ctx: &ReducerContext, scheduler: AgnaFireOrbScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_agna_fire_orb_attack may not be invoked by clients, only via scheduling.");
    }

    // Check if the Agna boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Agna boss {} no longer exists, stopping fire orb attacks", scheduler.boss_monster_id);
            return;
        }
    };

    // Check if boss is still in magic circle state
    if boss.ai_state != crate::monster_ai_defs::AIState::BossAgnaMagicCircle {
        log::info!("Agna boss {} no longer in magic circle state, stopping fire orb attacks", scheduler.boss_monster_id);
        return;
    }

    // Get the target player
    let target_player_opt = ctx.db.player().player_id().find(&scheduler.target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::info!("Target player {} no longer exists for fire orb attack", scheduler.target_player_id);
            return;
        }
    };

    // Find all magic circles for this player
    let player_circles: Vec<_> = ctx.db.agna_magic_circles().iter()
        .filter(|circle|  circle.target_player_id == scheduler.target_player_id)
        .collect();

    if player_circles.is_empty() {
        log::info!("No magic circles found for player {}, cannot spawn fire orb", scheduler.target_player_id);
        return;
    }

    // Choose a random circle to spawn the fire orb from
    let mut rng = ctx.rng();
    let chosen_circle = &player_circles[rng.gen::<usize>() % player_circles.len()];

    // Calculate the circle's current position
    let circle_position = calculate_magic_circle_position(&target_player.position, chosen_circle);

    // First, spawn the telegraph (warning indicator)
    let orb_spawn_telegraph = crate::ActiveMonsterAttack {
        active_monster_attack_id: 0, // Will be auto-assigned
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_ORB_SPAWN_DURATION_MS)),
        position: circle_position,
        direction: DbVector2::new(0.0, 0.0), // Telegraph doesn't move
        monster_attack_type: MonsterAttackType::AgnaOrbSpawn,
        piercing: true, // Telegraph is piercing (no damage)
        damage: 0, // Telegraph does no damage
        radius: AGNA_FIRE_ORB_RADIUS, // Same visual size as the real orb
        speed: 0.0, // Telegraph doesn't move
        parameter_u: scheduler.target_player_id, // Store target player ID
        parameter_f: chosen_circle.circle_index as f32, // Store which circle will fire this orb (0-3)
        ticks_elapsed: 0,
        from_shiny_monster: false, // Bosses are not shiny
    };

    ctx.db.active_monster_attacks().insert(orb_spawn_telegraph);

    // Schedule the real fire orb to spawn after the telegraph delay
    // We'll use a separate scheduler table for this delayed spawn
    ctx.db.agna_delayed_orb_scheduler().insert(AgnaDelayedOrbScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_ORB_SPAWN_TELEGRAPH_MS)),
        boss_monster_id: scheduler.boss_monster_id,
        target_player_id: scheduler.target_player_id,
        circle_position,
        circle_index: chosen_circle.circle_index,
    });

    log::info!("Agna boss {} spawned orb spawn telegraph from circle {} targeting player {}", 
              scheduler.boss_monster_id, chosen_circle.circle_index, scheduler.target_player_id);

    // Schedule the next fire orb attack for this player
    schedule_next_agna_fire_orb_attack(ctx, scheduler.boss_monster_id, scheduler.target_player_id);
}

// Reducer to spawn the actual fire orb after the telegraph delay
#[reducer]
pub fn spawn_delayed_agna_fire_orb(ctx: &ReducerContext, scheduler: AgnaDelayedOrbScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_delayed_agna_fire_orb may not be invoked by clients, only via scheduling.");
    }

    // Check if the Agna boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Agna boss {} no longer exists, cancelling delayed fire orb", scheduler.boss_monster_id);
            return;
        }
    };

    if boss.ai_state != crate::monster_ai_defs::AIState::BossAgnaMagicCircle {
        log::info!("Agna boss {} no longer in magic circle state, cancelling delayed fire orb", scheduler.boss_monster_id);
        return;
    }

    // Get the target player's current position (at time of actual orb spawn)
    let target_player_opt = ctx.db.player().player_id().find(&scheduler.target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::info!("Target player {} no longer exists, cancelling delayed fire orb", scheduler.target_player_id);
            return;
        }
    };

    // Calculate direction from circle to player center (at time of actual orb spawn)
    let direction_vector = DbVector2::new(
        target_player.position.x - scheduler.circle_position.x,
        target_player.position.y - scheduler.circle_position.y
    ).normalize();

    // Spawn the actual fire orb
    let fire_orb_attack = crate::ActiveMonsterAttack {
        active_monster_attack_id: 0, // Will be auto-assigned
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_FIRE_ORB_DURATION_MS)),
        position: scheduler.circle_position,
        direction: direction_vector,
        monster_attack_type: MonsterAttackType::AgnaFireOrb,
        piercing: false, // Fire orbs don't pierce
        damage: AGNA_FIRE_ORB_DAMAGE,
        radius: AGNA_FIRE_ORB_RADIUS,
        speed: AGNA_FIRE_ORB_SPEED,
        parameter_u: scheduler.target_player_id, // Store target player ID
        parameter_f: scheduler.circle_index as f32, // Store which circle fired this orb (0-3)
        ticks_elapsed: 0,
        from_shiny_monster: false, // Bosses are not shiny
    };

    ctx.db.active_monster_attacks().insert(fire_orb_attack);

    log::info!("Agna boss {} spawned delayed fire orb from circle {} targeting player {}", 
              scheduler.boss_monster_id, scheduler.circle_index, scheduler.target_player_id);
}

// Calculate the current position of a magic circle
fn calculate_magic_circle_position(player_position: &DbVector2, circle: &AgnaMagicCircle) -> DbVector2 {
    // Calculate how far the circle has rotated
    let time_elapsed_seconds = circle.ticks_elapsed as f32 * DELTA_TIME;
    let rotation_radians = (AGNA_MAGIC_CIRCLE_ORBIT_SPEED * time_elapsed_seconds).to_radians();
    let current_angle = circle.initial_rotation + rotation_radians;
    
    // Calculate position around the player
    DbVector2::new(
        player_position.x + AGNA_MAGIC_CIRCLE_ORBIT_RADIUS * current_angle.cos(),
        player_position.y + AGNA_MAGIC_CIRCLE_ORBIT_RADIUS * current_angle.sin()
    )
}

// Schedule the next fire orb attack for a player
fn schedule_next_agna_fire_orb_attack(ctx: &ReducerContext, boss_monster_id: u32, target_player_id: u32) {
    ctx.db.agna_fire_orb_scheduler().insert(AgnaFireOrbScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_FIRE_ORB_SPAWN_INTERVAL_MS)),
        boss_monster_id,
        target_player_id,
    });
}

// Spawn magic circles around all players for an Agna boss
pub fn spawn_agna_magic_circles(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Spawning magic circles for Agna boss {}", boss_monster_id);
    
    // Count players first
    let players: Vec<_> = ctx.db.player().iter().collect();
    log::info!("Found {} players to spawn magic circles around", players.len());
    
    // Spawn circles around each player
    for player in players {
        log::info!("Spawning magic circles for player {}", player.player_id);
        spawn_magic_circles_for_player(ctx, boss_monster_id, player.player_id);
        
        // Start fire orb attacks for this player
        start_agna_fire_orb_attacks(ctx, boss_monster_id, player.player_id);
    }
    
    // Verify circles were created
    let total_circles = ctx.db.agna_magic_circles().iter().count();
    log::info!("Total magic circles in database after spawning: {}", total_circles);
}

// Spawn 4 magic circles around a specific player
fn spawn_magic_circles_for_player(ctx: &ReducerContext, boss_monster_id: u32, player_id: u32) {
    // Get the target player's position
    let player_opt = ctx.db.player().player_id().find(&player_id);
    let player_position = match player_opt {
        Some(player) => player.position,
        None => {
            log::warn!("Player {} not found when spawning magic circles", player_id);
            return;
        }
    };
    
    let base_angle_offset = std::f32::consts::PI / 4.0; // 45 degree offset between circles
    
    for i in 0..AGNA_MAGIC_CIRCLES_PER_PLAYER {
        let initial_rotation = (i as f32) * (2.0 * std::f32::consts::PI / AGNA_MAGIC_CIRCLES_PER_PLAYER as f32) + base_angle_offset;
        
        // Calculate initial position for the magic circle
        let initial_position = DbVector2::new(
            player_position.x + AGNA_MAGIC_CIRCLE_ORBIT_RADIUS * initial_rotation.cos(),
            player_position.y + AGNA_MAGIC_CIRCLE_ORBIT_RADIUS * initial_rotation.sin()
        );
        
        ctx.db.agna_magic_circles().insert(AgnaMagicCircle {
            circle_id: 0, // Will be auto-assigned
            boss_monster_id,
            target_player_id: player_id,
            circle_index: i,
            initial_rotation,
            ticks_elapsed: 0,
            position: initial_position,
        });
    }
    
    log::info!("Spawned {} magic circles around player {} at position ({}, {})", 
              AGNA_MAGIC_CIRCLES_PER_PLAYER, player_id, player_position.x, player_position.y);
}

// Start fire orb attacks for a specific player
pub fn start_agna_fire_orb_attacks(ctx: &ReducerContext, boss_monster_id: u32, target_player_id: u32) {
    log::info!("Starting fire orb attacks for Agna boss {} targeting player {}", boss_monster_id, target_player_id);
    
    // Schedule the first fire orb attack with initial delay
    ctx.db.agna_fire_orb_scheduler().insert(AgnaFireOrbScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_FIRE_ORB_SPAWN_INTERVAL_MS)),
        boss_monster_id,
        target_player_id,
    });
}

// Update magic circle positions (called from game tick)
pub fn update_agna_magic_circles(ctx: &ReducerContext, cache: &crate::collision::CollisionCache) {
    // Update all magic circles' tick counts and positions
    for circle in ctx.db.agna_magic_circles().iter() {
        let mut updated_circle = circle;
        updated_circle.ticks_elapsed += 1;
        
        // Get the target player's current position from cache
        let player_position = if let Some(&player_cache_idx) = cache.player.player_id_to_cache_index.get(&updated_circle.target_player_id) {
            DbVector2::new(
                cache.player.pos_x_player[player_cache_idx as usize],
                cache.player.pos_y_player[player_cache_idx as usize]
            )
        } else {
            // Player no longer exists in cache, magic circle will be cleaned up elsewhere
            continue;
        };
        
        // Calculate the current position of the magic circle
        updated_circle.position = calculate_magic_circle_position(&player_position, &updated_circle);
        
        ctx.db.agna_magic_circles().circle_id().update(updated_circle);
    }
}



// Cleanup magic circles and fire orb schedules for a boss
pub fn cleanup_agna_magic_circle_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Cleaning up magic circle schedules for Agna boss {}", boss_monster_id);
    
    // Delete all magic circles for this boss
    let circles_to_delete: Vec<_> = ctx.db.agna_magic_circles().iter()
        .filter(|circle| circle.boss_monster_id == boss_monster_id)
        .collect();
    
    let circles_count = circles_to_delete.len();
    for circle in circles_to_delete {
        ctx.db.agna_magic_circles().circle_id().delete(&circle.circle_id);
    }
    
    // Delete all fire orb schedulers for this boss
    let schedulers_to_delete: Vec<_> = ctx.db.agna_fire_orb_scheduler().iter()
        .filter(|scheduler| scheduler.boss_monster_id == boss_monster_id)
        .collect();
    
    let schedulers_count = schedulers_to_delete.len();
    for scheduler in schedulers_to_delete {
        ctx.db.agna_fire_orb_scheduler().scheduled_id().delete(&scheduler.scheduled_id);
    }
    
    // Delete all delayed orb schedulers for this boss
    let delayed_schedulers_to_delete: Vec<_> = ctx.db.agna_delayed_orb_scheduler().iter()
        .filter(|scheduler| scheduler.boss_monster_id == boss_monster_id)
        .collect();
    
    let delayed_schedulers_count = delayed_schedulers_to_delete.len();
    for scheduler in delayed_schedulers_to_delete {
        ctx.db.agna_delayed_orb_scheduler().scheduled_id().delete(&scheduler.scheduled_id);
    }
    
    log::info!("Cleaned up {} magic circles, {} fire orb schedulers, and {} delayed orb schedulers for Agna boss {}", 
              circles_count, schedulers_count, delayed_schedulers_count, boss_monster_id);
}

// Execute behavior when entering BossAgnaMagicCircle state
pub fn execute_boss_agna_magic_circle_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Agna boss {} entering magic circle state", monster.monster_id);

    // Reset speed to normal (no speed boost for magic circle)
    reset_monster_speed_to_bestiary(ctx, monster);
    

    
    // Spawn magic circles around all players and start fire orb attacks
    log::info!("About to spawn magic circles for Agna boss {}", monster.monster_id);
    spawn_agna_magic_circles(ctx, monster.monster_id);
    log::info!("Finished spawning magic circles for Agna boss {}", monster.monster_id);
    
    // Schedule return to idle after magic circle duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, AGNA_MAGIC_CIRCLE_DURATION_MS);
}

// Execute behavior when entering BossAgnaRitualMatch state
pub fn execute_boss_agna_ritual_match_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Starting Agna ritual match phase for boss {}", monster.monster_id);
    
    // Make Agna stationary and invulnerable
    reset_monster_speed_to_bestiary(ctx, monster);
    
    // Clear any existing candle spawns for this boss
    cleanup_agna_candle_spawns(ctx, monster.monster_id);
    
    // Get Agna's position from monsters_boid table
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&monster.monster_id);
    let boid = match boid_opt {
        Some(boid) => boid,
        None => {
            log::info!("Boid {} not found for ritual candle spawn creation", monster.monster_id);
            return;
        }
    };
    
    // Create candle spawn positions in a circle around Agna
    create_ritual_candle_spawns(ctx, monster.monster_id, &boid.position);
    
    // Schedule transition to wick phase after match duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaRitualWick, AGNA_RITUAL_MATCH_DURATION_MS);
}

// Execute behavior when entering BossAgnaRitualWick state
pub fn execute_boss_agna_ritual_wick_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Starting Agna ritual wick phase for boss {}", monster.monster_id);
    
    // Spawn all the candle monsters immediately
    spawn_all_ritual_candles(ctx, monster.monster_id);
    
    // Clean up the spawn indicators now that real candles have appeared
    cleanup_agna_candle_spawn_indicators(ctx, monster.monster_id);
    
    // Schedule check for ritual completion after wick duration
    ctx.db.agna_ritual_completion_check().insert(AgnaRitualCompletionCheck {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_RITUAL_WICK_DURATION_MS)),
        boss_monster_id: monster.monster_id,
    });
}

// Execute behavior when entering BossAgnaRitualFailed state (vulnerable)
pub fn execute_boss_agna_ritual_failed_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Agna ritual failed for boss {} - now vulnerable", monster.monster_id);
    
    // Clean up any remaining candles and schedules
    cleanup_agna_candle_spawns(ctx, monster.monster_id);
    cleanup_agna_candle_schedules(ctx, monster.monster_id);
    
    // Schedule return to idle state after failed duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, AGNA_RITUAL_FAILED_DURATION_MS);
}

// Execute behavior when entering BossAgnaRitualComplete state (damage all players)
pub fn execute_boss_agna_ritual_complete_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Agna ritual completed for boss {} - dealing damage to all players", monster.monster_id);
    
    // Damage all living players every tick while in this state
    // This will be handled in the core game tick by checking the AI state
    
    // Keep candles alive AND keep them attacking - they remain as persistent threats!
    // Players must decide whether to focus on destroying candles or dealing with other threats
    log::info!("Candles from ritual remain active and continue attacking as ongoing threats for boss {}", monster.monster_id);
    
    // Return to idle after a brief completion period
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossAgnaIdle, AGNA_RITUAL_COMPLETE_DURATION_MS); // 2 seconds
}

// Helper function to create candle spawn positions in a circle
fn create_ritual_candle_spawns(ctx: &ReducerContext, boss_monster_id: u32, boss_position: &DbVector2) {
    log::info!("Creating {} candle spawns around boss {}", AGNA_RITUAL_CANDLE_COUNT, boss_monster_id);
    
    for i in 0..AGNA_RITUAL_CANDLE_COUNT {
        let angle = (i as f32 / AGNA_RITUAL_CANDLE_COUNT as f32) * 2.0 * std::f32::consts::PI;
        let spawn_position = DbVector2::new(
            boss_position.x + AGNA_RITUAL_CIRCLE_RADIUS * angle.cos(),
            boss_position.y + AGNA_RITUAL_CIRCLE_RADIUS * angle.sin()
        );
        
        ctx.db.agna_candle_spawns().insert(AgnaCandleSpawn {
            spawn_id: 0, // Auto-incremented
            boss_monster_id,
            position: spawn_position,
            candle_index: i,
            candle_monster_id: 0, // Not yet spawned
        });
        
        log::info!("Created candle spawn {} at ({}, {})", i, spawn_position.x, spawn_position.y);
    }
}

// Helper function to spawn all candles for ritual wick phase
fn spawn_all_ritual_candles(ctx: &ReducerContext, boss_monster_id: u32) {
    let spawns: Vec<_> = ctx.db.agna_candle_spawns()
        .iter()
        .filter(|spawn| spawn.boss_monster_id == boss_monster_id && spawn.candle_monster_id == 0)
        .collect();
    
    log::info!("Spawning {} candles for boss {}", spawns.len(), boss_monster_id);
    
    for spawn in spawns {
        // Get bestiary entry for candle
        let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::AgnaCandle as u32))
            .expect("Could not find bestiary entry for AgnaCandle");
        
        // Create the candle monster
        let candle_monster = ctx.db.monsters().insert(crate::Monsters {
            monster_id: 0, // Auto-incremented
            bestiary_id: MonsterType::AgnaCandle,
            variant: MonsterVariant::Default,
            hp: bestiary_entry.max_hp,
            max_hp: bestiary_entry.max_hp,
            atk: bestiary_entry.atk,
            speed: bestiary_entry.speed,
            target_player_id: 0, // Candles don't have targets
            radius: bestiary_entry.radius,
            spawn_position: spawn.position,
            ai_state: crate::monster_ai_defs::AIState::Stationary,
        });
        
        // Create the boid for the candle
        ctx.db.monsters_boid().insert(crate::MonsterBoid {
            monster_id: candle_monster.monster_id,
            position: spawn.position,
        });
        
        let candle_monster_id = candle_monster.monster_id;

        log::info!("Spawned Agna candle {} at position ({}, {})", 
                  candle_monster_id, spawn.position.x, spawn.position.y);

        // Update the spawn record with the candle monster ID
        let mut updated_spawn = spawn.clone();
        updated_spawn.candle_monster_id = candle_monster_id;
        ctx.db.agna_candle_spawns().spawn_id().update(updated_spawn);

        // Start the candle's bolt attacks
        start_candle_bolt_attacks(ctx, candle_monster_id);
    }
}

// Helper function to start candle bolt attacks
fn start_candle_bolt_attacks(ctx: &ReducerContext, candle_monster_id: u32) {
    if let Some(target_player_id) = find_random_player(ctx) {
        // Add initial variance so candles don't all start firing at once (0-1000ms delay)
        let mut rng = ctx.rng();
        let initial_delay_ms = (rng.gen::<f32>() * 1000.0) as u64;
        let schedule_at = ScheduleAt::Time(ctx.timestamp + Duration::from_millis(initial_delay_ms));
        
        ctx.db.agna_candle_bolt_scheduler().insert(AgnaCandleBoltScheduler {
            scheduled_id: 0,
            scheduled_at: schedule_at,
            candle_monster_id,
            target_player_id,
        });
    }
}

// Helper function to schedule next candle bolt
fn schedule_next_candle_bolt(ctx: &ReducerContext, candle_monster_id: u32, target_player_id: u32) {
    // Add variance to candle bolt timing: base interval ±500ms (1000ms to 2000ms range)
    let mut rng = ctx.rng();
    let variance_ms = 500;
    let delay_ms = AGNA_CANDLE_BOLT_INTERVAL_MS - variance_ms + (rng.gen::<f32>() * (variance_ms * 2) as f32) as u64;
    let schedule_at = ScheduleAt::Time(ctx.timestamp + Duration::from_millis(delay_ms));
    
    ctx.db.agna_candle_bolt_scheduler().insert(AgnaCandleBoltScheduler {
        scheduled_id: 0,
        scheduled_at: schedule_at,
        candle_monster_id,
        target_player_id,
    });
}

// Helper function to fire a candle bolt
fn fire_candle_bolt(ctx: &ReducerContext, candle: &crate::Monsters, target_player_id: u32) {
    let target_opt = ctx.db.player().player_id().find(&target_player_id);
    let target = match target_opt {
        Some(player) => player,
        None => return,
    };
    
    // Get candle position from boid table
    let candle_boid_opt = ctx.db.monsters_boid().monster_id().find(&candle.monster_id);
    let candle_boid = match candle_boid_opt {
        Some(boid) => boid,
        None => {
            log::info!("Candle {} has no boid data, cannot fire bolt", candle.monster_id);
            return;
        }
    };
    
    // Calculate direction to target
    let direction = DbVector2::new(
        target.position.x - candle_boid.position.x,
        target.position.y - candle_boid.position.y
    ).normalize();
    
    // Store the direction angle in parameter_f (in radians) for client-side rotation
    let direction_angle = direction.y.atan2(direction.x);
    
    // Create the candle bolt attack
    let bolt_attack = crate::ActiveMonsterAttack {
        active_monster_attack_id: 0, // Auto-incremented
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(3000)), // 3 second lifespan
        position: candle_boid.position,
        direction,
        monster_attack_type: MonsterAttackType::AgnaCandleBolt,
        piercing: false,
        damage: AGNA_CANDLE_BOLT_DAMAGE,
        radius: AGNA_CANDLE_BOLT_RADIUS,
        speed: AGNA_CANDLE_BOLT_SPEED,
        parameter_u: 0,
        parameter_f: direction_angle,
        ticks_elapsed: 0,
        from_shiny_monster: false,
    };
    
    ctx.db.active_monster_attacks().insert(bolt_attack);
    
    log::info!("Candle {} fired bolt at player {}", candle.monster_id, target_player_id);
}

// Helper function to clean up candle spawns (both indicators and monsters)
fn cleanup_agna_candle_spawns(ctx: &ReducerContext, boss_monster_id: u32) {
    let spawns_to_delete: Vec<_> = ctx.db.agna_candle_spawns()
        .iter()
        .filter(|spawn| spawn.boss_monster_id == boss_monster_id)
        .collect();
    
    for spawn in spawns_to_delete {
        // If a candle monster was spawned, delete it
        if spawn.candle_monster_id != 0 {
            if let Some(_candle) = ctx.db.monsters().monster_id().find(&spawn.candle_monster_id) {
                ctx.db.monsters().monster_id().delete(&spawn.candle_monster_id);
                log::info!("Deleted candle monster {}", spawn.candle_monster_id);
            }
        }
        
        // Delete the spawn record
        ctx.db.agna_candle_spawns().spawn_id().delete(&spawn.spawn_id);
    }
    
    log::info!("Cleaned up candle spawns for boss {}", boss_monster_id);
}

// Helper function to clean up only the spawn indicators (not the candle monsters)
fn cleanup_agna_candle_spawn_indicators(ctx: &ReducerContext, boss_monster_id: u32) {
    let spawns_to_delete: Vec<_> = ctx.db.agna_candle_spawns()
        .iter()
        .filter(|spawn| spawn.boss_monster_id == boss_monster_id)
        .collect();
    
    for spawn in spawns_to_delete {
        // Delete only the spawn record (keep the candle monsters alive)
        ctx.db.agna_candle_spawns().spawn_id().delete(&spawn.spawn_id);
    }
    
    log::info!("Cleaned up candle spawn indicators for boss {} (candles remain alive)", boss_monster_id);
}

// Helper function to clean up candle schedules
fn cleanup_agna_candle_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    // Clean up candle bolt schedulers
    let bolt_schedulers: Vec<_> = ctx.db.agna_candle_bolt_scheduler()
        .iter()
        .collect();
    
    for scheduler in bolt_schedulers {
        // Check if this candle belongs to the boss
        if let Some(_candle) = ctx.db.monsters().monster_id().find(&scheduler.candle_monster_id) {
            // Check if this candle is from our boss (via spawn records)
            let spawn_exists = ctx.db.agna_candle_spawns()
                .iter()
                .any(|spawn| spawn.boss_monster_id == boss_monster_id && spawn.candle_monster_id == scheduler.candle_monster_id);
            
            if spawn_exists {
                ctx.db.agna_candle_bolt_scheduler().scheduled_id().delete(&scheduler.scheduled_id);
            }
        }
    }
    
    log::info!("Cleaned up candle schedules for boss {}", boss_monster_id);
}

// Helper function to clean up ritual completion checks
fn cleanup_agna_ritual_completion_checks(ctx: &ReducerContext, boss_monster_id: u32) {
    let checks_to_delete: Vec<_> = ctx.db.agna_ritual_completion_check()
        .iter()
        .filter(|check| check.boss_monster_id == boss_monster_id)
        .collect();
    
    for check in checks_to_delete {
        ctx.db.agna_ritual_completion_check().scheduled_id().delete(&check.scheduled_id);
    }
    
    log::info!("Cleaned up ritual completion checks for boss {}", boss_monster_id);
}

// Reducer to spawn a candle monster
#[reducer]
pub fn spawn_agna_candle(ctx: &ReducerContext, scheduler: AgnaCandleScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_agna_candle may not be invoked by clients, only via scheduling.");
    }

    // Find the candle spawn record
    let spawn_opt = ctx.db.agna_candle_spawns().spawn_id().find(&scheduler.spawn_id);
    let spawn = match spawn_opt {
        Some(spawn) => spawn,
        None => {
            log::info!("Candle spawn {} no longer exists", scheduler.spawn_id);
            return;
        }
    };

    // Check if the boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    if boss_opt.is_none() {
        log::info!("Agna boss {} no longer exists, cancelling candle spawn", scheduler.boss_monster_id);
        return;
    }

    // Get bestiary entry for candle
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::AgnaCandle as u32))
        .expect("Could not find bestiary entry for AgnaCandle");
    
    // Create the candle monster
    let candle_monster = ctx.db.monsters().insert(crate::Monsters {
        monster_id: 0, // Auto-incremented
        bestiary_id: MonsterType::AgnaCandle,
        variant: MonsterVariant::Default,
        hp: bestiary_entry.max_hp,
        max_hp: bestiary_entry.max_hp,
        atk: bestiary_entry.atk,
        speed: bestiary_entry.speed,
        target_player_id: 0, // Candles don't have targets
        radius: bestiary_entry.radius,
        spawn_position: spawn.position,
        ai_state: crate::monster_ai_defs::AIState::Stationary,
    });
    
    // Create the boid for the candle
    ctx.db.monsters_boid().insert(crate::MonsterBoid {
        monster_id: candle_monster.monster_id,
        position: spawn.position,
    });

    log::info!("Spawned Agna candle {} at position ({}, {})", 
              candle_monster.monster_id, spawn.position.x, spawn.position.y);

    // Update the spawn record with the candle monster ID
    let mut updated_spawn = spawn.clone();
    updated_spawn.candle_monster_id = candle_monster.monster_id;
    ctx.db.agna_candle_spawns().spawn_id().update(updated_spawn);

    // Start the candle's bolt attacks
    start_candle_bolt_attacks(ctx, candle_monster.monster_id);
}

// Reducer to fire a candle bolt
#[reducer] 
pub fn trigger_agna_candle_bolt(ctx: &ReducerContext, scheduler: AgnaCandleBoltScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_agna_candle_bolt may not be invoked by clients, only via scheduling.");
    }

    // Check if the candle monster still exists
    let candle_opt = ctx.db.monsters().monster_id().find(&scheduler.candle_monster_id);
    let candle = match candle_opt {
        Some(monster) => monster,
        None => {
            log::info!("Candle monster {} no longer exists", scheduler.candle_monster_id);
            return;
        }
    };

    // Check if the target player exists
    let target_opt = ctx.db.player().player_id().find(&scheduler.target_player_id);
    let target = match target_opt {
        Some(player) => player,
        None => {
            // Find a new random target
            if let Some(random_player_id) = find_random_player(ctx) {
                log::info!("Target player {} no longer exists, switching to {}", scheduler.target_player_id, random_player_id);
                fire_candle_bolt(ctx, &candle, random_player_id);
                schedule_next_candle_bolt(ctx, scheduler.candle_monster_id, random_player_id);
            }
            return;
        }
    };

    // Fire the bolt
    fire_candle_bolt(ctx, &candle, target.player_id);
    
    // Schedule the next bolt
    schedule_next_candle_bolt(ctx, scheduler.candle_monster_id, target.player_id);
}

// Reducer to check ritual completion  
#[reducer]
pub fn check_agna_ritual_completion(ctx: &ReducerContext, checker: AgnaRitualCompletionCheck) {
    if ctx.sender != ctx.identity() {
        panic!("check_agna_ritual_completion may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&checker.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists for ritual completion check", checker.boss_monster_id);
            return;
        }
    };

    // Check if boss is still in ritual wick state
    if boss.ai_state != crate::monster_ai_defs::AIState::BossAgnaRitualWick {
        log::info!("Boss {} no longer in ritual wick state, skipping completion check", checker.boss_monster_id);
        return;
    }

    // Count living candles for this boss
    let living_candles = count_living_candles(ctx, checker.boss_monster_id);
    
    log::info!("Ritual completion check for boss {}: {} candles alive", checker.boss_monster_id, living_candles);
    
    if living_candles == 0 {
        // All candles destroyed - ritual failed!
        log::info!("All candles destroyed! Ritual failed for boss {}", checker.boss_monster_id);
        
        // Transition to failed state
        let mut updated_boss = boss.clone();
        updated_boss.ai_state = crate::monster_ai_defs::AIState::BossAgnaRitualFailed;
        ctx.db.monsters().monster_id().update(updated_boss);
        
        // Execute failed behavior
        execute_boss_agna_ritual_failed_behavior(ctx, &boss);
    } else {
        // Candles still alive - ritual completed!
        log::info!("Ritual completed! {} candles survived for boss {}", living_candles, checker.boss_monster_id);
        
        // Transition to complete state
        let mut updated_boss = boss.clone();
        updated_boss.ai_state = crate::monster_ai_defs::AIState::BossAgnaRitualComplete;
        ctx.db.monsters().monster_id().update(updated_boss);
        
        // Execute complete behavior
        execute_boss_agna_ritual_complete_behavior(ctx, &boss);
    }
}

// Helper function to count living candles (simplified - just count any AgnaCandle monsters)
fn count_living_candles(ctx: &ReducerContext, boss_monster_id: u32) -> u32 {
    let living_candles: Vec<_> = ctx.db.monsters()
        .iter()
        .filter(|monster| monster.bestiary_id == MonsterType::AgnaCandle)
        .collect();
    
    let living_count = living_candles.len() as u32;
    
    log::info!("Counting candles: found {} living AgnaCandle monsters (boss_monster_id {} ignored)", living_count, boss_monster_id);
    
    // Debug: log each candle's details
    for candle in &living_candles {
        log::info!("Living candle {}: HP {}/{}", candle.monster_id, candle.hp, candle.max_hp);
    }
    
    living_count
}

// Public function to handle ritual complete damage (called from core game tick)
pub fn process_agna_ritual_complete_damage(ctx: &ReducerContext) {
    // Early bailout if we're not in a boss phase - no point checking for ritual bosses
    let game_state_opt = ctx.db.game_state().id().find(&0);
    let game_state = match game_state_opt {
        Some(state) => state,
        None => return, // No game state, skip processing
    };
    
    if !game_state.boss_active || (game_state.boss_phase != 1) {
        return; // Not in a boss phase, skip processing
    }
    
    // Find all Agna bosses in ritual complete state
    let ritual_complete_bosses: Vec<_> = ctx.db.monsters()
        .iter()
        .filter(|monster| {
            (monster.bestiary_id == MonsterType::BossAgnaPhase1 || 
             monster.bestiary_id == MonsterType::BossAgnaPhase2) &&
            monster.ai_state == crate::monster_ai_defs::AIState::BossAgnaRitualComplete
        })
        .collect();
    
    if ritual_complete_bosses.is_empty() {
        return; // No bosses in ritual complete state
    }
    
    // Damage all living players
    let damage_per_boss = AGNA_RITUAL_COMPLETE_DAMAGE as f32;
    let total_damage = damage_per_boss * ritual_complete_bosses.len() as f32;
    
    for player in ctx.db.player().iter() {
        if player.hp > 0.0 { // Only damage living players
            let player_id = player.player_id;
            let old_hp = player.hp;
            let new_hp = if player.hp > total_damage {
                player.hp - total_damage
            } else {
                0.0
            };
            
            let mut updated_player = player;
            updated_player.hp = new_hp;
            ctx.db.player().player_id().update(updated_player);
            
            log::info!("Ritual complete: Player {} took {} damage (HP: {} -> {})", 
                      player_id, total_damage, old_hp, new_hp);
            
            // Check if player died
            if new_hp <= 0.0 {
                log::info!("Player {} killed by Agna ritual completion", player_id);
                crate::transition_player_to_dead_state(ctx, player_id);
            }
        }
    }
    
    if !ritual_complete_bosses.is_empty() {
        log::info!("Agna ritual complete damage: {} damage dealt to all living players by {} boss(es)", 
                  total_damage, ritual_complete_bosses.len());
    }
}

// ================================================================================================
// AGNA PHASE 2 BEHAVIOR FUNCTIONS
// ================================================================================================

// Reducer to spawn a summoning circle that creates an Imp and ground flame
#[reducer]
pub fn spawn_agna_summoning_circle(ctx: &ReducerContext, spawner: AgnaSummoningCircleSpawner) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_agna_summoning_circle may not be invoked by clients, only via scheduling.");
    }

    // Check if the Phase 2 Agna boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&spawner.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Phase 2 Agna boss {} no longer exists, stopping summoning circle spawning", spawner.boss_monster_id);
            return;
        }
    };

    // Verify this is actually a Phase 2 Agna boss
    if boss.bestiary_id != MonsterType::BossAgnaPhase2 {
        log::info!("Boss {} is not Agna Phase 2, stopping summoning circle spawning", spawner.boss_monster_id);
        return;
    }

    // Get all active players
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        log::info!("No players online, skipping summoning circle spawn");
        schedule_next_agna_summoning_circle(ctx, spawner.boss_monster_id, spawner.spawn_interval_ms);
        return;
    }

    // Choose a random player to spawn the summoning circle near
    let mut rng = ctx.rng();
    let target_player = &players[rng.gen::<usize>() % players.len()];

    // Calculate spawn position near the target player (200-400 pixels away)
    let spawn_distance = AGNA_PHASE2_SUMMONING_RITUAL_SPAWN_RADIUS_MIN 
        + (rng.gen::<f32>() * AGNA_PHASE2_SUMMONING_RITUAL_SPAWN_RADIUS_RANGE);
    let spawn_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0; // Random angle

    let mut spawn_position = DbVector2::new(
        target_player.position.x + spawn_distance * spawn_angle.cos(),
        target_player.position.y + spawn_distance * spawn_angle.sin()
    );

    // Get world boundaries from config
    let config = ctx.db.config().id().find(&0)
        .expect("spawn_agna_summoning_circle: Could not find game configuration!");
    
    // Clamp to world boundaries
    spawn_position.x = spawn_position.x.clamp(100.0, config.world_size as f32 - 100.0);
    spawn_position.y = spawn_position.y.clamp(100.0, config.world_size as f32 - 100.0);

    log::info!("Spawning Agna summoning circle at position ({:.1}, {:.1}) near player {}", 
              spawn_position.x, spawn_position.y, target_player.name);

    // Spawn an Imp monster at the summoning circle location
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::Imp as u32))
        .expect("spawn_agna_summoning_circle: Could not find bestiary entry for Imp");

    let imp_monster = ctx.db.monsters().insert(crate::Monsters {
        monster_id: 0, // Auto-incremented
        bestiary_id: MonsterType::Imp,
        variant: crate::MonsterVariant::Default,
        hp: bestiary_entry.max_hp,
        max_hp: bestiary_entry.max_hp,
        atk: bestiary_entry.atk,
        speed: bestiary_entry.speed,
        target_player_id: target_player.player_id,
        radius: bestiary_entry.radius,
        spawn_position,
        ai_state: crate::monster_ai_defs::AIState::Default,
    });

    // Create the boid for the Imp
    ctx.db.monsters_boid().insert(crate::MonsterBoid {
        monster_id: imp_monster.monster_id,
        position: spawn_position,
    });

    // Start the Imp's attack schedule
    crate::monster_attacks_def::start_imp_attack_schedule(ctx, imp_monster.monster_id);

    log::info!("Spawned Imp {} at summoning circle", imp_monster.monster_id);

    // Spawn an AgnaGroundFlame attack at the same location
    let ground_flame_attack = crate::ActiveMonsterAttack {
        active_monster_attack_id: 0, // Will be auto-assigned
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_GROUND_FLAME_DURATION_MS)),
        position: spawn_position,
        direction: DbVector2::new(0.0, 0.0), // Stationary
        monster_attack_type: MonsterAttackType::AgnaGroundFlame,
        piercing: false, // Ground flames are not piercing
        damage: AGNA_GROUND_FLAME_DAMAGE,
        radius: AGNA_GROUND_FLAME_RADIUS,
        speed: 0.0, // Stationary
        parameter_u: spawner.boss_monster_id, // Store boss ID
        parameter_f: 0.0, // No special parameter needed
        ticks_elapsed: 0,
        from_shiny_monster: false, // Boss attacks are not from shiny monsters
    };

    ctx.db.active_monster_attacks().insert(ground_flame_attack);

    log::info!("Spawned AgnaGroundFlame at summoning circle position ({:.1}, {:.1})", 
              spawn_position.x, spawn_position.y);

    // Schedule the next summoning circle with reduced interval
    schedule_next_agna_summoning_circle(ctx, spawner.boss_monster_id, spawner.spawn_interval_ms);
}

// Helper function to schedule the next summoning circle with interval reduction
fn schedule_next_agna_summoning_circle(ctx: &ReducerContext, boss_monster_id: u32, current_interval_ms: u64) {
    // Calculate next interval (reduce by 10% each wave, but don't go below minimum)
    let next_interval_ms = ((current_interval_ms as f32 * AGNA_PHASE2_SUMMONING_INTERVAL_REDUCTION_RATIO) as u64)
        .max(AGNA_PHASE2_SUMMONING_MIN_INTERVAL_MS);

    // Schedule the next summoning circle
    ctx.db.agna_summoning_circle_spawner().insert(AgnaSummoningCircleSpawner {
        scheduled_id: 0,
        boss_monster_id,
        spawn_interval_ms: next_interval_ms,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(next_interval_ms)),
    });

    log::info!("Scheduled next Agna summoning circle for boss {} in {}ms (reduced from {}ms)", 
              boss_monster_id, next_interval_ms, current_interval_ms);
}

// Reducer called when Agna Phase 2 boss should switch targets
#[reducer]
pub fn trigger_agna_target_switch(ctx: &ReducerContext, scheduler: AgnaTargetSwitchScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_agna_target_switch may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists and is a Phase 2 Agna boss
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists, stopping Agna target switching", scheduler.boss_monster_id);
            return;
        }
    };

    // Verify this is a Phase 2 Agna boss
    if boss.bestiary_id != crate::MonsterType::BossAgnaPhase2 {
        log::info!("Boss {} is not Agna Phase 2, stopping target switching", scheduler.boss_monster_id);
        return;
    }

    // Get all active players
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        log::info!("No players online for Agna boss {} target switch, stopping", scheduler.boss_monster_id);
        return;
    }
    
    if player_count == 1 {
        // Only one player, no need to switch, just schedule next check
        schedule_next_agna_target_switch(ctx, scheduler.boss_monster_id);
        return;
    }

    // Find a new target different from current target
    let current_target_id = boss.target_player_id;
    let mut available_players: Vec<_> = players.into_iter()
        .filter(|p| p.player_id != current_target_id)
        .collect();
    
    if available_players.is_empty() {
        // Fallback: use any player if filtering left us with none
        available_players = ctx.db.player().iter().collect();
    }
    
    // Select a random new target
    let mut rng = ctx.rng();
    let random_index = (rng.gen::<f32>() * available_players.len() as f32) as usize;
    let new_target = &available_players[random_index];
    
    // Update the boss's target
    let mut updated_boss = boss;
    updated_boss.target_player_id = new_target.player_id;
    ctx.db.monsters().monster_id().update(updated_boss);
    
    log::info!("Agna boss {} switched target from player {} to player {} ({})", 
              scheduler.boss_monster_id, current_target_id, new_target.player_id, new_target.name);

    // Schedule the next target switch
    schedule_next_agna_target_switch(ctx, scheduler.boss_monster_id);
}

// Helper function to schedule the next Agna target switch with random variation
fn schedule_next_agna_target_switch(ctx: &ReducerContext, boss_monster_id: u32) {
    // Add random variation to the base interval
    let mut rng = ctx.rng();
    let variation = (rng.gen::<f32>() * 2.0 - 1.0) * AGNA_PHASE2_TARGET_SWITCH_VARIATION_MS as f32;
    let next_interval_ms = (AGNA_PHASE2_TARGET_SWITCH_BASE_INTERVAL_MS as f32 + variation) as u64;
    
    // Ensure minimum interval of 6 seconds
    let next_interval_ms = next_interval_ms.max(6000);
    
    ctx.db.agna_target_switch_scheduler().insert(AgnaTargetSwitchScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(next_interval_ms)),
    });
    
    log::info!("Scheduled next Agna target switch for boss {} in {}ms", 
              boss_monster_id, next_interval_ms);
}

// Reducer to fire a Phase 2 flamethrower jet at a random player
#[reducer]
pub fn trigger_agna_phase2_flamethrower_attack(ctx: &ReducerContext, scheduler: AgnaPhase2FlamethrowerScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_agna_phase2_flamethrower_attack may not be invoked by clients, only via scheduling.");
    }

    // Check if the Agna Phase 2 boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Agna Phase 2 boss {} no longer exists, stopping flamethrower attacks", scheduler.boss_monster_id);
            return;
        }
    };

    // Verify this is actually an Agna Phase 2 boss
    if boss.bestiary_id != MonsterType::BossAgnaPhase2 {
        log::info!("Boss {} is not Agna Phase 2, stopping flamethrower attacks", scheduler.boss_monster_id);
        return;
    }

    // Get boss position from boid table
    let boss_boid_opt = ctx.db.monsters_boid().monster_id().find(&boss.monster_id);
    let boss_position = match boss_boid_opt {
        Some(boid) => boid.position,
        None => {
            log::info!("Boss {} boid not found, stopping flamethrower attacks", boss.monster_id);
            return;
        }
    };

    // Find a random player to target
    let target_player_opt = find_random_player(ctx);
    let target_player_id = match target_player_opt {
        Some(player_id) => player_id,
        None => {
            log::info!("No players available for Phase 2 flamethrower attack");
            schedule_next_agna_phase2_flamethrower_attack(ctx, scheduler.boss_monster_id);
            return;
        }
    };

    // Get the target player
    let target_player_opt = ctx.db.player().player_id().find(&target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::info!("Target player {} no longer exists", target_player_id);
            schedule_next_agna_phase2_flamethrower_attack(ctx, scheduler.boss_monster_id);
            return;
        }
    };

    // Calculate direction from boss to target player (direct targeting)
    let direction_vector = DbVector2::new(
        target_player.position.x - boss_position.x,
        target_player.position.y - boss_position.y
    ).normalize();

    // Spawn the Phase 2 flamethrower jet
    let jet_attack = crate::ActiveMonsterAttack {
        active_monster_attack_id: 0, // Will be auto-assigned
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_PHASE2_FLAME_JET_DURATION_MS)),
        position: boss_position,
        direction: direction_vector,
        monster_attack_type: MonsterAttackType::AgnaPhase2FlameJet,
        piercing: false, // Phase 2 jets are not piercing
        damage: AGNA_PHASE2_FLAME_JET_DAMAGE,
        radius: AGNA_PHASE2_FLAME_JET_INITIAL_RADIUS, // Start with initial radius
        speed: AGNA_PHASE2_FLAME_JET_SPEED,
        parameter_u: target_player_id, // Store target player ID
        parameter_f: 0.0, // No special parameter needed
        ticks_elapsed: 0,
        from_shiny_monster: false, // Bosses are not shiny
    };

    ctx.db.active_monster_attacks().insert(jet_attack);

    log::info!("Agna Phase 2 boss {} fired flame jet at player {} ({})", 
              scheduler.boss_monster_id, target_player_id, target_player.name);

    // Schedule the next flamethrower attack
    schedule_next_agna_phase2_flamethrower_attack(ctx, scheduler.boss_monster_id);
}

// Helper function to schedule the next Phase 2 flamethrower attack
fn schedule_next_agna_phase2_flamethrower_attack(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.agna_phase2_flamethrower_scheduler().insert(AgnaPhase2FlamethrowerScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_PHASE2_FLAME_JET_INTERVAL_MS)),
        boss_monster_id,
    });
}

// Function to start Agna Phase 2 summoning circle spawning
pub fn start_agna_phase2_summoning_circles(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Starting Agna Phase 2 summoning circles for boss {}", boss_monster_id);

    // Schedule the first summoning circle
    ctx.db.agna_summoning_circle_spawner().insert(AgnaSummoningCircleSpawner {
        scheduled_id: 0,
        boss_monster_id,
        spawn_interval_ms: AGNA_PHASE2_SUMMONING_INITIAL_INTERVAL_MS,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_PHASE2_SUMMONING_INITIAL_INTERVAL_MS)),
    });

    log::info!("Agna Phase 2 summoning circles scheduled for boss {} (first circle in {}ms)", 
              boss_monster_id, AGNA_PHASE2_SUMMONING_INITIAL_INTERVAL_MS);
}

// Function to start Agna Phase 2 target switching
pub fn start_agna_phase2_target_switching(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.agna_target_switch_scheduler().insert(AgnaTargetSwitchScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_PHASE2_TARGET_SWITCH_INITIAL_DELAY_MS)),
    });

    log::info!("Started Agna Phase 2 target switching for boss {} (first switch in {}ms)", 
              boss_monster_id, AGNA_PHASE2_TARGET_SWITCH_INITIAL_DELAY_MS);
}

// Function to start Agna Phase 2 continuous flamethrower attacks
pub fn start_agna_phase2_flamethrower_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.agna_phase2_flamethrower_scheduler().insert(AgnaPhase2FlamethrowerScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(AGNA_PHASE2_FLAME_JET_INTERVAL_MS)),
    });

    log::info!("Started Agna Phase 2 flamethrower attacks for boss {} (first attack in {}ms)", 
              boss_monster_id, AGNA_PHASE2_FLAME_JET_INTERVAL_MS);
}

// Function to cleanup all Agna Phase 2 schedules when boss dies
pub fn cleanup_agna_phase2_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Cleaning up all Agna Phase 2 schedules for boss {}", boss_monster_id);
    
    // Cleanup summoning circle spawners
    let summoning_schedulers_to_delete: Vec<u64> = ctx.db.agna_summoning_circle_spawner()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let summoning_count = summoning_schedulers_to_delete.len();
    for scheduled_id in summoning_schedulers_to_delete {
        ctx.db.agna_summoning_circle_spawner().scheduled_id().delete(&scheduled_id);
    }
    
    // Cleanup target switch schedulers
    let target_schedulers_to_delete: Vec<u64> = ctx.db.agna_target_switch_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let target_count = target_schedulers_to_delete.len();
    for scheduled_id in target_schedulers_to_delete {
        ctx.db.agna_target_switch_scheduler().scheduled_id().delete(&scheduled_id);
    }
    
    // Cleanup flamethrower schedulers
    let flamethrower_schedulers_to_delete: Vec<u64> = ctx.db.agna_phase2_flamethrower_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let flamethrower_count = flamethrower_schedulers_to_delete.len();
    for scheduled_id in flamethrower_schedulers_to_delete {
        ctx.db.agna_phase2_flamethrower_scheduler().scheduled_id().delete(&scheduled_id);
    }
    
    // Cleanup active Phase 2 attacks
    let active_attacks_to_delete: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|attack| {
            (attack.monster_attack_type == MonsterAttackType::AgnaPhase2FlameJet ||
             attack.monster_attack_type == MonsterAttackType::AgnaGroundFlame) &&
            attack.parameter_u == boss_monster_id
        })
        .map(|attack| attack.active_monster_attack_id)
        .collect();
    
    let active_count = active_attacks_to_delete.len();
    for attack_id in active_attacks_to_delete {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&attack_id);
    }

    if summoning_count > 0 || target_count > 0 || flamethrower_count > 0 || active_count > 0 {
        log::info!("Cleaned up {} summoning schedulers, {} target schedulers, {} flamethrower schedulers, and {} active attacks for Agna Phase 2 boss {}", 
                  summoning_count, target_count, flamethrower_count, active_count, boss_monster_id);
    }
}

 