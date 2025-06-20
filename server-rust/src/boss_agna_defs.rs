use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, MonsterAttackType, config, player, bestiary, monsters, monsters_boid, MonsterSpawners,
           DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, WORLD_SIZE};
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

    // Reset speed to base value when entering idle (ensures clean state between patterns)
    reset_monster_speed_to_bestiary(ctx, monster);

    // When entering idle, ensure all previous attack schedules are cleaned up
    cleanup_agna_flamethrower_schedules(ctx, monster.monster_id);
    cleanup_agna_magic_circle_schedules(ctx, monster.monster_id);

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
    
    // Cleanup magic circle schedules
    cleanup_agna_magic_circle_schedules(ctx, monster_id);
    
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

 