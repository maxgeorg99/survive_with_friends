use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, MonsterAttackType, config, player, bestiary, monsters, monsters_boid, MonsterSpawners, 
           DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT};
use crate::monster_attacks_def::active_monster_attacks;
use crate::monster_ai_defs::monster_state_changes;
use std::time::Duration;

// Configuration constants for EnderClaw spawning
const ENDER_CLAW_INITIAL_INTERVAL_MS: u64 = 6000;   // Start spawning every 6 seconds
const ENDER_CLAW_MIN_INTERVAL_MS: u64 = 2000;       // Minimum spawn interval (2 seconds)
const ENDER_CLAW_INTERVAL_REDUCTION_RATIO: f32 = 0.85; // Reduce interval by 15% each wave (multiply by 0.85)
const ENDER_CLAW_PRE_SPAWN_DELAY_MS: u64 = 1000;   // Reduced pre-spawn delay (1 second)

// Configuration constants for EnderScythe attacks
const ENDER_SCYTHE_RINGS: u32 = 7;                    // Number of rings around the boss
const ENDER_SCYTHE_BASE_RADIUS: f32 = 256.0;          // Starting radius for first ring
const ENDER_SCYTHE_RING_SPACING: f32 = 256.0;         // Distance between rings
const ENDER_SCYTHE_BASE_COUNT: u32 = 4;              // Number of scythes in the inner ring
const ENDER_SCYTHE_COUNT_INCREMENT: u32 = 4;         // Additional scythes per ring (6, 8, 10, 12)
const ENDER_SCYTHE_SPAWN_DURATION_MS: u64 = 1500;     // Duration for EnderScytheSpawn (warning phase)
const ENDER_SCYTHE_DAMAGE: u32 = 30;                 // Damage for EnderScythe attacks
const ENDER_SCYTHE_SPEED: f32 = 24.0;                // Rotation speed (degrees per second)
const ENDER_SCYTHE_RADIUS: f32 = 62.0;               // Collision radius for scythes

// Configuration constants for EnderBolt attacks
const ENDER_BOLT_DAMAGE: u32 = 25;                   // Damage for EnderBolt attacks (more powerful than ImpBolt)
const ENDER_BOLT_SPEED: f32 = 800.0;                 // Movement speed for EnderBolt attacks
const ENDER_BOLT_RADIUS: f32 = 27.0;                 // Collision radius for EnderBolt attacks
const ENDER_BOLT_DURATION_MS: u64 = 4000;            // Duration before EnderBolt expires
const ENDER_BOLT_BASE_INTERVAL_MS: u64 = 1000;       // Base time between EnderBolt attacks (single player)
const ENDER_BOLT_MIN_INTERVAL_MS: u64 = 50;         // Minimum time between EnderBolt attacks (many players)
const ENDER_BOLT_INITIAL_DELAY_MS: u64 = 3500;

// Configuration constants for ChaosBall attacks
const CHAOS_BALL_DAMAGE: u32 = 50;                   // High damage piercing projectile
const CHAOS_BALL_SPEED: f32 = 600.0;                 // Fast movement speed
const CHAOS_BALL_RADIUS: f32 = 32.0;                 // Medium collision radius
const CHAOS_BALL_DURATION_MS: u64 = 8000;            // Long lasting (8 seconds to cross map)
const CHAOS_BALL_BASE_INTERVAL_MS: u64 = 2000;       // Base time between ChaosBall attacks (single player)
const CHAOS_BALL_MIN_INTERVAL_MS: u64 = 400;         // Minimum time between ChaosBall attacks (many players)
const CHAOS_BALL_INITIAL_DELAY_MS: u64 = 2000;       // Initial delay before first ChaosBall

// Configuration constants for VoidZone attacks
const VOID_ZONE_DAMAGE: u32 = 80;                    // Very high damage stationary attack
const VOID_ZONE_RADIUS: f32 = 199.0;                 // Large area of effect
const VOID_ZONE_DURATION_MS: u64 = 60000;             // Long lasting (6 seconds)
const VOID_ZONE_INTERVAL_MS: u64 = 4000;             // Time between VoidZone attacks (8 seconds)
const VOID_ZONE_INITIAL_DELAY_MS: u64 = 4000;        // Initial delay before first VoidZone

// Configuration constants for boss target switching
const BOSS_TARGET_SWITCH_BASE_INTERVAL_MS: u64 = 10000;   // Base interval (8 seconds)
const BOSS_TARGET_SWITCH_VARIATION_MS: u64 = 4000;       // Random variation (±4 seconds)
const BOSS_TARGET_SWITCH_INITIAL_DELAY_MS: u64 = 10000;   // Initial delay before first switch

// Configuration constants for Ender boss AI timing
const BOSS_ENDER_IDLE_DURATION_MS: u64 = 5000;        // 5 seconds idle
const BOSS_ENDER_CHASE_DURATION_MS: u64 = 15000;       // 15 seconds chase
pub const BOSS_ENDER_DANCE_DURATION_MS: u64 = 15000;       // 15 seconds dance
const BOSS_ENDER_VANISH_DURATION_MS: u64 = 1000;      // 1 second vanish
const BOSS_ENDER_LURK_DURATION_MS: u64 = 3000;        // 3 seconds lurk (safe period)
const BOSS_ENDER_TELEPORT_DURATION_MS: u64 = 1000;     // 1 second teleport
const BOSS_ENDER_TRANSFORM_DURATION_MS: u64 = 2000;   // 2 seconds transform

// Speed multiplier for chase state
const BOSS_ENDER_CHASE_SPEED_MULTIPLIER: f32 = 1.5;

// Chase distance threshold (when boss gets this close, stop chasing and attack)
const BOSS_ENDER_CHASE_STOP_DISTANCE: f32 = 128.0;

// Table to track the last chosen pattern for each Ender boss to avoid repetition
#[table(name = boss_ender_last_patterns, public)]
pub struct BossEnderLastPattern {
    #[primary_key]
    pub monster_id: u32,
    
    pub last_pattern: crate::monster_ai_defs::AIState,
}

// Scheduled table for EnderClaw spawning during Phase 2 boss fights
#[table(name = ender_claw_spawner, scheduled(spawn_ender_claw_wave), public)]
pub struct EnderClawSpawner {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 boss ID
    pub spawn_interval_ms: u64,   // Current spawn interval (decreases over time)
    pub scheduled_at: ScheduleAt, // When to spawn the next wave
}

// Scheduled table for spawning EnderScytheSpawn attacks (warning phase)
#[table(name = ender_scythe_spawn_scheduler, scheduled(spawn_ender_scythe_spawns), public)]
pub struct EnderScytheSpawnScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When to spawn the warning scythes
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster that will spawn scythes
    pub base_rotation: f32,       // Base rotation angle for the pattern
}

// Scheduled table for spawning EnderScythe attacks (actual damaging phase)
#[table(name = ender_scythe_scheduler, scheduled(spawn_ender_scythes), public)]
pub struct EnderScytheScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When to spawn the real scythes
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster that will spawn scythes
    pub base_rotation: f32,       // Base rotation angle for the pattern
}

// Scheduled table for EnderBolt attacks during boss dance
#[table(name = ender_bolt_scheduler, scheduled(trigger_ender_bolt_attack), public)]
pub struct EnderBoltScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the next EnderBolt should fire
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster that will fire EnderBolt
}

// Scheduled table for ChaosBall attacks during Phase 2 boss
#[table(name = chaos_ball_scheduler, scheduled(trigger_chaos_ball_attack), public)]
pub struct ChaosBallScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the next ChaosBall should fire
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 boss that will fire ChaosBall
}

// Scheduled table for VoidZone attacks during Phase 2 boss
#[table(name = void_zone_scheduler, scheduled(trigger_void_zone_attack), public)]
pub struct VoidZoneScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the next VoidZone should spawn
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 boss that will spawn VoidZone
}

// Scheduled table for Phase 2 boss target switching
#[table(name = boss_target_switch_scheduler, scheduled(trigger_boss_target_switch), public)]
pub struct BossTargetSwitchScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the boss should switch targets
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 boss that will switch targets
}

// Reducer to spawn a wave of EnderClaws (one per player)
#[reducer]
pub fn spawn_ender_claw_wave(ctx: &ReducerContext, spawner: EnderClawSpawner) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_ender_claw_wave may not be invoked by clients, only via scheduling.");
    }

    // Check if the Phase 2 boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&spawner.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Phase 2 boss {} no longer exists, stopping EnderClaw spawning", spawner.boss_monster_id);
            return;
        }
    };

    // Verify this is actually a Phase 2 boss
    if boss.bestiary_id != MonsterType::BossEnderPhase2 {
        log::info!("Boss {} is not Phase 2, stopping EnderClaw spawning", spawner.boss_monster_id);
        return;
    }

    // Get all active players
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        log::info!("No players online, skipping EnderClaw spawn wave");
        schedule_next_ender_claw_wave(ctx, spawner.boss_monster_id, spawner.spawn_interval_ms);
        return;
    }

    log::info!("Spawning EnderClaw wave: {} EnderClaws for {} players (interval: {}ms)", 
              player_count, player_count, spawner.spawn_interval_ms);

    // Spawn one EnderClaw per player
    for player in players {
        spawn_single_ender_claw(ctx, &player);
    }

    // Schedule the next wave with reduced interval
    schedule_next_ender_claw_wave(ctx, spawner.boss_monster_id, spawner.spawn_interval_ms);
}

// Helper function to spawn a single EnderClaw near a player
fn spawn_single_ender_claw(ctx: &ReducerContext, target_player: &crate::Player) {
    // Get EnderClaw stats from bestiary
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::EnderClaw as u32))
        .expect("spawn_single_ender_claw: Could not find bestiary entry for EnderClaw");

    // Calculate spawn position near the target player (150-250 pixels away) - closer for more threat
    let mut rng = ctx.rng();
    let spawn_distance = 150.0 + (rng.gen::<f32>() * 100.0); // 150-250 pixels from player (reduced from 300-600)
    let spawn_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0; // Random angle

    let mut spawn_position = DbVector2::new(
        target_player.position.x + spawn_distance * spawn_angle.cos(),
        target_player.position.y + spawn_distance * spawn_angle.sin()
    );

    // Get world boundaries from config
    let config = ctx.db.config().id().find(&0)
        .expect("spawn_single_ender_claw: Could not find game configuration!");
    
    // Clamp to world boundaries using monster radius
    let monster_radius = bestiary_entry.radius;
    spawn_position.x = spawn_position.x.clamp(monster_radius, config.world_size as f32 - monster_radius);
    spawn_position.y = spawn_position.y.clamp(monster_radius, config.world_size as f32 - monster_radius);

    // Create a pre-spawner with reduced delay
    crate::monsters_def::create_monster_spawner(
        ctx,
        spawn_position,
        MonsterType::EnderClaw,
        ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_CLAW_PRE_SPAWN_DELAY_MS))
    );

    log::info!("Pre-spawned EnderClaw for player {} at position ({:.1}, {:.1})", 
              target_player.name, spawn_position.x, spawn_position.y);
}

// Helper function to schedule the next EnderClaw wave with interval reduction
fn schedule_next_ender_claw_wave(ctx: &ReducerContext, boss_monster_id: u32, current_interval_ms: u64) {
    // Calculate next interval (reduce by 15% each wave, but don't go below minimum)
    let next_interval_ms = ((current_interval_ms as f32 * ENDER_CLAW_INTERVAL_REDUCTION_RATIO) as u64)
        .max(ENDER_CLAW_MIN_INTERVAL_MS);

    // Schedule the next wave
    ctx.db.ender_claw_spawner().insert(EnderClawSpawner {
        scheduled_id: 0,
        boss_monster_id,
        spawn_interval_ms: next_interval_ms,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(next_interval_ms)),
    });

    log::info!("Scheduled next EnderClaw wave for boss {} in {}ms (reduced from {}ms)", 
              boss_monster_id, next_interval_ms, current_interval_ms);
}

// Function to start EnderClaw spawning when Phase 2 boss is spawned
pub fn start_ender_claw_spawning(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Starting EnderClaw spawning for Phase 2 boss {}", boss_monster_id);

    // Schedule the first EnderClaw wave after a brief delay
    ctx.db.ender_claw_spawner().insert(EnderClawSpawner {
        scheduled_id: 0,
        boss_monster_id,
        spawn_interval_ms: ENDER_CLAW_INITIAL_INTERVAL_MS,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_CLAW_INITIAL_INTERVAL_MS)),
    });

    log::info!("EnderClaw spawning scheduled for boss {} (first wave in {}ms)", 
              boss_monster_id, ENDER_CLAW_INITIAL_INTERVAL_MS);
}

// Function to cleanup EnderClaw spawning schedules when Phase 2 boss is defeated
pub fn cleanup_ender_claw_spawning(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled EnderClaw spawners for this boss
    let spawners_to_delete: Vec<u64> = ctx.db.ender_claw_spawner()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|spawner| spawner.scheduled_id)
        .collect();
    
    let spawner_count = spawners_to_delete.len();
    
    for scheduled_id in spawners_to_delete {
        ctx.db.ender_claw_spawner().scheduled_id().delete(&scheduled_id);
    }

    if spawner_count > 0 {
        log::info!("Cleaned up {} EnderClaw spawners for boss {}", spawner_count, boss_monster_id);
    }
}

// Helper function to handle orbital movement for EnderScythe attacks
fn handle_ender_scythe_orbital_movement(ctx: &ReducerContext, attack: &mut crate::ActiveMonsterAttack) {
    // Get the boss monster ID from parameter_u
    let boss_monster_id = attack.parameter_u;
    
    // Get boss position
    let boss_boid_opt = ctx.db.monsters_boid().monster_id().find(&boss_monster_id);
    let boss_position = match boss_boid_opt {
        Some(boid) => boid.position,
        None => {
            // Boss is gone, stay still
            return;
        }
    };
    
    // Calculate current angle relative to boss (stored in parameter_f)
    let current_angle = attack.parameter_f;
    
    // Update angle based on rotation speed
    let rotation_speed_radians = ENDER_SCYTHE_SPEED * std::f32::consts::PI / 180.0; // Convert degrees to radians
    let new_angle = current_angle + (rotation_speed_radians * DELTA_TIME);
    attack.parameter_f = new_angle;
    
    // Calculate orbital radius based on the original distance from boss
    // We can derive this from the direction vector magnitude when the attack was created
    let dx = attack.position.x - boss_position.x;
    let dy = attack.position.y - boss_position.y;
    let orbital_radius = (dx * dx + dy * dy).sqrt();
    
    // Calculate new position based on the updated angle
    let new_x = boss_position.x + orbital_radius * new_angle.cos();
    let new_y = boss_position.y + orbital_radius * new_angle.sin();
    
    attack.position = DbVector2::new(new_x, new_y);
    
    // Update direction to point tangent to the orbit (for visual rotation)
    attack.direction = DbVector2::new(-new_angle.sin(), new_angle.cos());
}

// Function to update boss attacks movement (to be called from monster_attacks_def)
pub fn handle_boss_attack_movement(ctx: &ReducerContext, attack: &mut crate::ActiveMonsterAttack) {
    match attack.monster_attack_type {
        MonsterAttackType::EnderScythe => {
            // Only EnderScythe has orbital movement around the boss
            handle_ender_scythe_orbital_movement(ctx, attack);
        },
        MonsterAttackType::EnderScytheSpawn => {
            // EnderScytheSpawn attacks stay completely still - no movement or rotation
            // They are just warning indicators
        },
                 _ => {
             // Let other attacks use default movement
         }
     }
}

// Reducer called when EnderScytheSpawn attacks should be spawned
#[reducer]
pub fn spawn_ender_scythe_spawns(ctx: &ReducerContext, scheduler: EnderScytheSpawnScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_ender_scythe_spawns may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists, cancelling EnderScytheSpawn spawning", scheduler.boss_monster_id);
            return;
        }
    };

    // Get the boss's current position from boid
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&scheduler.boss_monster_id);
    let boss_position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            log::info!("Boss {} has no boid, cancelling EnderScytheSpawn spawning", scheduler.boss_monster_id);
            return;
        }
    };

    log::info!("Spawning EnderScytheSpawn pattern for boss {} at position ({}, {})", 
              scheduler.boss_monster_id, boss_position.x, boss_position.y);

    // Spawn multiple rings of EnderScytheSpawn attacks
    for ring in 0..ENDER_SCYTHE_RINGS {
        let ring_radius = ENDER_SCYTHE_BASE_RADIUS + (ring as f32 * ENDER_SCYTHE_RING_SPACING);
        let scythe_count = ENDER_SCYTHE_BASE_COUNT + (ring * ENDER_SCYTHE_COUNT_INCREMENT);
        
        // Calculate angle step for this ring
        let angle_step = 2.0 * std::f32::consts::PI / scythe_count as f32;
        
        // Spawn each scythe in the ring
        for scythe_index in 0..scythe_count {
            let angle = scheduler.base_rotation + (scythe_index as f32 * angle_step);
            
            // Calculate spawn position
            let spawn_x = boss_position.x + ring_radius * angle.cos();
            let spawn_y = boss_position.y + ring_radius * angle.sin();
            let spawn_position = DbVector2::new(spawn_x, spawn_y);
            
            // Calculate direction (tangent to the circle for rotation)
            let direction = DbVector2::new(-angle.sin(), angle.cos());
            
            // Create active monster attack for EnderScytheSpawn (warning phase)
            let active_monster_attack = ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
                active_monster_attack_id: 0,
                scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_SCYTHE_SPAWN_DURATION_MS)),
                position: spawn_position,
                direction,
                monster_attack_type: MonsterAttackType::EnderScytheSpawn,
                piercing: true, // EnderScytheSpawn is piercing (warning phase)
                damage: 0, // No damage for warning phase
                radius: ENDER_SCYTHE_RADIUS,
                speed: 0.0, // No linear movement, only orbital
                parameter_u: scheduler.boss_monster_id, // Store boss ID for orbital movement
                parameter_f: angle, // Store current angle for orbital movement
                ticks_elapsed: 0,
                from_shiny_monster: false, // Boss attacks are not from shiny monsters
            });

            log::info!("Spawned EnderScytheSpawn {} at ({:.1}, {:.1}) angle {:.2} for boss {}", 
                      active_monster_attack.active_monster_attack_id, spawn_x, spawn_y, angle, scheduler.boss_monster_id);
        }
    }
}

// Reducer called when EnderScythe attacks should be spawned
#[reducer]
pub fn spawn_ender_scythes(ctx: &ReducerContext, scheduler: EnderScytheScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_ender_scythes may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists, cancelling EnderScythe spawning", scheduler.boss_monster_id);
            return;
        }
    };

    // Get the boss's current position from boid
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&scheduler.boss_monster_id);
    let boss_position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            log::info!("Boss {} has no boid, cancelling EnderScythe spawning", scheduler.boss_monster_id);
            return;
        }
    };

    log::info!("Spawning EnderScythe pattern for boss {} at position ({}, {})", 
              scheduler.boss_monster_id, boss_position.x, boss_position.y);

    // Calculate duration to match the dance behavior duration (minus the delays for spawning)
    let scythe_duration_ms = BOSS_ENDER_DANCE_DURATION_MS - 3000; // Dance duration minus spawn delays

    // Spawn multiple rings of EnderScythe attacks
    for ring in 0..ENDER_SCYTHE_RINGS {
        let ring_radius = ENDER_SCYTHE_BASE_RADIUS + (ring as f32 * ENDER_SCYTHE_RING_SPACING);
        let scythe_count = ENDER_SCYTHE_BASE_COUNT + (ring * ENDER_SCYTHE_COUNT_INCREMENT);
        
        // Calculate angle step for this ring
        let angle_step = 2.0 * std::f32::consts::PI / scythe_count as f32;
        
        // Spawn each scythe in the ring
        for scythe_index in 0..scythe_count {
            let angle = scheduler.base_rotation + (scythe_index as f32 * angle_step);
            
            // Calculate spawn position
            let spawn_x = boss_position.x + ring_radius * angle.cos();
            let spawn_y = boss_position.y + ring_radius * angle.sin();
            let spawn_position = DbVector2::new(spawn_x, spawn_y);
            
            // Calculate direction (tangent to the circle for rotation)
            let direction = DbVector2::new(-angle.sin(), angle.cos());
            
            // Create active monster attack for EnderScythe (actual damaging attack)
            let active_monster_attack = ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
                active_monster_attack_id: 0,
                scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(scythe_duration_ms)),
                position: spawn_position,
                direction,
                monster_attack_type: MonsterAttackType::EnderScythe,
                piercing: true, // EnderScythe is piercing
                damage: ENDER_SCYTHE_DAMAGE,
                radius: ENDER_SCYTHE_RADIUS,
                speed: ENDER_SCYTHE_SPEED, // This will be used for rotation speed
                parameter_u: scheduler.boss_monster_id, // Store boss ID for orbital movement
                parameter_f: angle, // Store current angle for orbital movement
                ticks_elapsed: 0,
                from_shiny_monster: false, // Boss attacks are not from shiny monsters
            });

            log::info!("Spawned EnderScythe {} at ({:.1}, {:.1}) angle {:.2} for boss {}", 
                      active_monster_attack.active_monster_attack_id, spawn_x, spawn_y, angle, scheduler.boss_monster_id);
        }
    }
}

// Function to schedule EnderScythe attacks when boss enters dance mode
pub fn schedule_ender_scythe_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    // Generate a random base rotation for the pattern to add variety
    let mut rng = ctx.rng();
    let base_rotation = rng.gen::<f32>() * 2.0 * std::f32::consts::PI; // Random angle 0-2π

    log::info!("Scheduling EnderScythe attack pattern for boss {} with base rotation {:.2}", 
              boss_monster_id, base_rotation);

    // Schedule EnderScytheSpawn (warning phase) after 1 second
    ctx.db.ender_scythe_spawn_scheduler().insert(EnderScytheSpawnScheduler {
        scheduled_id: 0,
        boss_monster_id,
        base_rotation,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(1000)),
    });

    // Schedule EnderScythe (damaging phase) after 3 seconds
    ctx.db.ender_scythe_scheduler().insert(EnderScytheScheduler {
        scheduled_id: 0,
        boss_monster_id,
        base_rotation,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(1000 + ENDER_SCYTHE_SPAWN_DURATION_MS)),
    });

    log::info!("Scheduled EnderScythe pattern for boss {} (warning at 1s, attack at 3s)", boss_monster_id);
}

// Helper function to find a random player for targeting
fn find_random_player(ctx: &ReducerContext) -> Option<crate::Player> {
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        return None;
    }
    
    let mut rng = ctx.rng();
    let random_index = (rng.gen::<f32>() * player_count as f32) as usize;
    
    // Use enumerate to find the player at the random index
    for (index, player) in ctx.db.player().iter().enumerate() {
        if index == random_index {
            return Some(player);
        }
    }
    
    None
}

// Function to spawn an EnderBolt at a particular position, targeting a specific player
pub fn spawn_ender_bolt(ctx: &ReducerContext, spawn_position: DbVector2, target_player_id: u32) {
    // Get the target player
    let target_player_opt = ctx.db.player().player_id().find(&target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::error!("Cannot spawn EnderBolt: target player {} not found", target_player_id);
            return;
        }
    };

    // Calculate direction from spawn position toward the target player
    let direction_vector = DbVector2::new(
        target_player.position.x - spawn_position.x,
        target_player.position.y - spawn_position.y
    ).normalize();
    
    // Store the direction angle in parameter_f (in radians)
    let direction_angle = direction_vector.y.atan2(direction_vector.x);

    // Create active monster attack (scheduled to expire after duration)
    let active_monster_attack = ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_BOLT_DURATION_MS)),
        position: spawn_position,
        direction: direction_vector,
        monster_attack_type: MonsterAttackType::EnderBolt,
        piercing: false, // EnderBolt is not piercing
        damage: ENDER_BOLT_DAMAGE,
        radius: ENDER_BOLT_RADIUS,
        speed: ENDER_BOLT_SPEED,
        parameter_u: target_player_id, // Store target player ID
        parameter_f: direction_angle, // Store direction angle
        ticks_elapsed: 0,
        from_shiny_monster: false, // Boss attacks are not from shiny monsters
    });

    log::info!("Spawned EnderBolt {} at ({}, {}) targeting player {} (expires in {}ms)", 
              active_monster_attack.active_monster_attack_id, 
              spawn_position.x, spawn_position.y, 
              target_player_id, ENDER_BOLT_DURATION_MS);
}

// Reducer called when a boss should fire an EnderBolt
#[reducer]
pub fn trigger_ender_bolt_attack(ctx: &ReducerContext, scheduler: EnderBoltScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("TriggerEnderBoltAttack may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists and is still in dance mode
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            // Boss is dead - don't reschedule
            log::info!("Boss {} no longer exists, removing EnderBolt scheduler", scheduler.boss_monster_id);
            return;
        }
    };

    // Check if boss is still in dance mode - if not, don't fire or reschedule
    if boss.ai_state != crate::monster_ai_defs::AIState::BossEnderDance {
        log::info!("Boss {} no longer in dance mode, stopping EnderBolt attacks", scheduler.boss_monster_id);
        return;
    }

    // Get the boss's current position from boid
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&scheduler.boss_monster_id);
    let boss_position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            // No boid found - boss is probably dead, don't reschedule
            log::info!("Boss {} has no boid, removing EnderBolt scheduler", scheduler.boss_monster_id);
            return;
        }
    };

    // Find a random player to target
    let target_player = find_random_player(ctx);
    let target_player = match target_player {
        Some(player) => player,
        None => {
            // No players found - don't attack but reschedule for later
            log::info!("No players found for boss {}, skipping EnderBolt attack", scheduler.boss_monster_id);
            schedule_next_ender_bolt_attack(ctx, scheduler.boss_monster_id);
            return;
        }
    };

    // Spawn the EnderBolt attack
    spawn_ender_bolt(ctx, boss_position, target_player.player_id);
    
    log::info!("Boss {} fired EnderBolt at player {} from position ({}, {})", 
              scheduler.boss_monster_id, target_player.player_id, boss_position.x, boss_position.y);

    // Schedule the next attack
    schedule_next_ender_bolt_attack(ctx, scheduler.boss_monster_id);
}

// Helper function to schedule the next EnderBolt attack with player scaling
fn schedule_next_ender_bolt_attack(ctx: &ReducerContext, boss_monster_id: u32) {
    // Count the number of active players
    let player_count = ctx.db.player().iter().count() as u64;
    
    // Calculate scaled interval based on player count
    // 1 player = base interval, 4+ players = minimum interval
    let fire_interval_ms = if player_count <= 1 {
        ENDER_BOLT_BASE_INTERVAL_MS
    } else if player_count >= 4 {
        ENDER_BOLT_MIN_INTERVAL_MS
    } else {
        // Linear interpolation between base and minimum for 2-3 players
        let scale_factor = (player_count - 1) as f64 / 3.0; // 0.0 at 1 player, 1.0 at 4 players
        let interval_range = ENDER_BOLT_BASE_INTERVAL_MS - ENDER_BOLT_MIN_INTERVAL_MS;
        ENDER_BOLT_BASE_INTERVAL_MS - (interval_range as f64 * scale_factor) as u64
    };
    
    ctx.db.ender_bolt_scheduler().insert(EnderBoltScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(fire_interval_ms)),
    });
    
    log::info!("Scheduled next EnderBolt for boss {} in {}ms ({} players active)", 
              boss_monster_id, fire_interval_ms, player_count);
}

// Reducer called when ChaosBall attacks should be triggered
#[reducer]
pub fn trigger_chaos_ball_attack(ctx: &ReducerContext, scheduler: ChaosBallScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_chaos_ball_attack may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists and is a Phase 2 boss
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists, removing ChaosBall scheduler", scheduler.boss_monster_id);
            return;
        }
    };

    // Verify this is a Phase 2 boss
    if boss.bestiary_id != crate::MonsterType::BossEnderPhase2 {
        log::info!("Boss {} is not Phase 2, stopping ChaosBall attacks", scheduler.boss_monster_id);
        return;
    }

    // Get the boss's current position from boid
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&scheduler.boss_monster_id);
    let boss_position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            log::info!("Boss {} has no boid, removing ChaosBall scheduler", scheduler.boss_monster_id);
            return;
        }
    };

    // Find a random player to target
    let target_player = find_random_player(ctx);
    let target_player = match target_player {
        Some(player) => player,
        None => {
            log::info!("No players found for boss {}, skipping ChaosBall attack", scheduler.boss_monster_id);
            schedule_next_chaos_ball_attack(ctx, scheduler.boss_monster_id);
            return;
        }
    };

    // Calculate direction vector to the target player
    let dx = target_player.position.x - boss_position.x;
    let dy = target_player.position.y - boss_position.y;
    let direction = DbVector2::new(dx, dy).normalize();

    // Create the ChaosBall attack
    let active_monster_attack = ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CHAOS_BALL_DURATION_MS)),
        position: boss_position,
        direction,
        monster_attack_type: MonsterAttackType::ChaosBall,
        piercing: true, // ChaosBall is piercing
        damage: CHAOS_BALL_DAMAGE,
        radius: CHAOS_BALL_RADIUS,
        speed: CHAOS_BALL_SPEED,
        parameter_u: target_player.player_id, // Store target player ID
        parameter_f: 0.0, // No special parameter needed
        ticks_elapsed: 0,
        from_shiny_monster: false, // Boss attacks are not from shiny monsters
    });

    log::info!("Spawned ChaosBall {} targeting player {} ({}) from boss {}", 
              active_monster_attack.active_monster_attack_id, target_player.name, target_player.player_id, scheduler.boss_monster_id);

    // Schedule the next ChaosBall attack
    schedule_next_chaos_ball_attack(ctx, scheduler.boss_monster_id);
}

// Reducer called when VoidZone attacks should be triggered  
#[reducer]
pub fn trigger_void_zone_attack(ctx: &ReducerContext, scheduler: VoidZoneScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_void_zone_attack may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists and is a Phase 2 boss
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists, removing VoidZone scheduler", scheduler.boss_monster_id);
            return;
        }
    };

    // Verify this is a Phase 2 boss
    if boss.bestiary_id != crate::MonsterType::BossEnderPhase2 {
        log::info!("Boss {} is not Phase 2, stopping VoidZone attacks", scheduler.boss_monster_id);
        return;
    }

    // Get the boss's current position from boid
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&scheduler.boss_monster_id);
    let boss_position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            log::info!("Boss {} has no boid, removing VoidZone scheduler", scheduler.boss_monster_id);
            return;
        }
    };

    // Create the VoidZone attack centered on the boss (stationary)
    let active_monster_attack = ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(VOID_ZONE_DURATION_MS)),
        position: boss_position,
        direction: DbVector2::new(0.0, 0.0), // No movement for stationary attack
        monster_attack_type: MonsterAttackType::VoidZone,
        piercing: true, // VoidZone is piercing
        damage: VOID_ZONE_DAMAGE,
        radius: VOID_ZONE_RADIUS,
        speed: 0.0, // Stationary
        parameter_u: scheduler.boss_monster_id, // Store boss ID
        parameter_f: 0.0, // No special parameter needed
        ticks_elapsed: 0,
        from_shiny_monster: false, // Boss attacks are not from shiny monsters
    });

    log::info!("Spawned VoidZone {} at position ({:.1}, {:.1}) from boss {}", 
              active_monster_attack.active_monster_attack_id, boss_position.x, boss_position.y, scheduler.boss_monster_id);

    // Schedule the next VoidZone attack
    schedule_next_void_zone_attack(ctx, scheduler.boss_monster_id);
}

// Helper function to schedule the next ChaosBall attack with player scaling
fn schedule_next_chaos_ball_attack(ctx: &ReducerContext, boss_monster_id: u32) {
    // Count the number of active players
    let player_count = ctx.db.player().iter().count() as u64;
    
    // Calculate scaled interval based on player count - faster with more players
    // 1 player = base interval, 5+ players = minimum interval
    let fire_interval_ms = if player_count <= 1 {
        CHAOS_BALL_BASE_INTERVAL_MS
    } else if player_count >= 5 {
        CHAOS_BALL_MIN_INTERVAL_MS
    } else {
        // Linear interpolation between base and minimum for 2-4 players
        let scale_factor = (player_count - 1) as f64 / 4.0; // 0.0 at 1 player, 1.0 at 5 players
        let interval_range = CHAOS_BALL_BASE_INTERVAL_MS - CHAOS_BALL_MIN_INTERVAL_MS;
        CHAOS_BALL_BASE_INTERVAL_MS - (interval_range as f64 * scale_factor) as u64
    };
    
    ctx.db.chaos_ball_scheduler().insert(ChaosBallScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(fire_interval_ms)),
    });
    
    log::info!("Scheduled next ChaosBall for boss {} in {}ms ({} players active)", 
              boss_monster_id, fire_interval_ms, player_count);
}

// Helper function to schedule the next VoidZone attack (fixed interval)
fn schedule_next_void_zone_attack(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.void_zone_scheduler().insert(VoidZoneScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(VOID_ZONE_INTERVAL_MS)),
    });
    
    log::info!("Scheduled next VoidZone for boss {} in {}ms", 
              boss_monster_id, VOID_ZONE_INTERVAL_MS);
}

// Reducer called when boss should switch targets
#[reducer]
pub fn trigger_boss_target_switch(ctx: &ReducerContext, scheduler: BossTargetSwitchScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_boss_target_switch may not be invoked by clients, only via scheduling.");
    }

    // Check if the boss monster still exists and is a Phase 2 boss
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Boss {} no longer exists, stopping target switching", scheduler.boss_monster_id);
            return;
        }
    };

    // Verify this is a Phase 2 boss
    if boss.bestiary_id != crate::MonsterType::BossEnderPhase2 {
        log::info!("Boss {} is not Phase 2, stopping target switching", scheduler.boss_monster_id);
        return;
    }

    // Get all active players
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        log::info!("No players online for boss {} target switch, stopping", scheduler.boss_monster_id);
        return;
    }
    
    if player_count == 1 {
        // Only one player, no need to switch, just schedule next check
        schedule_next_boss_target_switch(ctx, scheduler.boss_monster_id);
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
    
    log::info!("Boss {} switched target from player {} to player {} ({})", 
              scheduler.boss_monster_id, current_target_id, new_target.player_id, new_target.name);

    // Schedule the next target switch
    schedule_next_boss_target_switch(ctx, scheduler.boss_monster_id);
}

// Helper function to schedule the next boss target switch with random variation
fn schedule_next_boss_target_switch(ctx: &ReducerContext, boss_monster_id: u32) {
    // Add random variation to the base interval (±BOSS_TARGET_SWITCH_VARIATION_MS)
    let mut rng = ctx.rng();
    let variation = (rng.gen::<f32>() * 2.0 - 1.0) * BOSS_TARGET_SWITCH_VARIATION_MS as f32; // -4000 to +4000ms
    let next_interval_ms = (BOSS_TARGET_SWITCH_BASE_INTERVAL_MS as f32 + variation) as u64;
    
    // Ensure minimum interval of 4 seconds
    let next_interval_ms = next_interval_ms.max(4000);
    
    ctx.db.boss_target_switch_scheduler().insert(BossTargetSwitchScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(next_interval_ms)),
    });
    
    log::info!("Scheduled next boss target switch for boss {} in {}ms", 
              boss_monster_id, next_interval_ms);
}

// Function to start EnderBolt attack scheduling when boss enters dance mode
pub fn start_ender_bolt_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    // Schedule the first EnderBolt attack after the real scythes spawn
    ctx.db.ender_bolt_scheduler().insert(EnderBoltScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_BOLT_INITIAL_DELAY_MS)),
    });

    log::info!("Started EnderBolt attack schedule for boss {} (first attack in {}ms)", 
              boss_monster_id, ENDER_BOLT_INITIAL_DELAY_MS);
}

// Function to start ChaosBall attack scheduling for Phase 2 boss
pub fn start_chaos_ball_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.chaos_ball_scheduler().insert(ChaosBallScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CHAOS_BALL_INITIAL_DELAY_MS)),
    });

    log::info!("Started ChaosBall attack schedule for boss {} (first attack in {}ms)", 
              boss_monster_id, CHAOS_BALL_INITIAL_DELAY_MS);
}

// Function to start VoidZone attack scheduling for Phase 2 boss
pub fn start_void_zone_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.void_zone_scheduler().insert(VoidZoneScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(VOID_ZONE_INITIAL_DELAY_MS)),
    });

    log::info!("Started VoidZone attack schedule for boss {} (first attack in {}ms)", 
              boss_monster_id, VOID_ZONE_INITIAL_DELAY_MS);
}

// Function to start boss target switching for Phase 2 boss
pub fn start_boss_target_switching(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.boss_target_switch_scheduler().insert(BossTargetSwitchScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(BOSS_TARGET_SWITCH_INITIAL_DELAY_MS)),
    });

    log::info!("Started boss target switching for boss {} (first switch in {}ms)", 
              boss_monster_id, BOSS_TARGET_SWITCH_INITIAL_DELAY_MS);
}

// Function to cleanup EnderBolt attack schedules when a boss dies or changes state
pub fn cleanup_ender_bolt_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled EnderBolt attacks for this boss
    let bolt_schedulers_to_delete: Vec<u64> = ctx.db.ender_bolt_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let bolt_count = bolt_schedulers_to_delete.len();
    
    for scheduled_id in bolt_schedulers_to_delete {
        ctx.db.ender_bolt_scheduler().scheduled_id().delete(&scheduled_id);
    }

    // Also cleanup all ACTIVE EnderBolt attacks that are flying around
    // These attacks have parameter_u set to the target player ID, but we can identify them by type and check if the boss still exists
    let active_bolt_attacks_to_delete: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|attack| attack.monster_attack_type == MonsterAttackType::EnderBolt)
        .map(|attack| attack.active_monster_attack_id)
        .collect();
    
    let active_bolt_count = active_bolt_attacks_to_delete.len();
    
    for attack_id in active_bolt_attacks_to_delete {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&attack_id);
    }

    if bolt_count > 0 || active_bolt_count > 0 {
        log::info!("Cleaned up {} EnderBolt schedulers and {} active EnderBolt attacks for boss {}", 
                  bolt_count, active_bolt_count, boss_monster_id);
    }
}

// Function to cleanup EnderScythe attack schedules when a boss dies or changes state
pub fn cleanup_ender_scythe_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled EnderScytheSpawn attacks for this boss
    let spawn_schedulers_to_delete: Vec<u64> = ctx.db.ender_scythe_spawn_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let spawn_count = spawn_schedulers_to_delete.len();
    
    for scheduled_id in spawn_schedulers_to_delete {
        ctx.db.ender_scythe_spawn_scheduler().scheduled_id().delete(&scheduled_id);
    }
    
    // Find and delete all scheduled EnderScythe attacks for this boss
    let scythe_schedulers_to_delete: Vec<u64> = ctx.db.ender_scythe_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let scythe_count = scythe_schedulers_to_delete.len();
    
    for scheduled_id in scythe_schedulers_to_delete {
        ctx.db.ender_scythe_scheduler().scheduled_id().delete(&scheduled_id);
    }

    // IMPORTANT: Also cleanup all ACTIVE EnderScythe attacks that are already flying around
    // These attacks have parameter_u set to the boss_monster_id
    let active_scythe_attacks_to_delete: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|attack| {
            (attack.monster_attack_type == MonsterAttackType::EnderScythe || 
             attack.monster_attack_type == MonsterAttackType::EnderScytheSpawn) &&
            attack.parameter_u == boss_monster_id
        })
        .map(|attack| attack.active_monster_attack_id)
        .collect();
    
    let active_count = active_scythe_attacks_to_delete.len();
    
    for attack_id in active_scythe_attacks_to_delete {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&attack_id);
    }

    // Also cleanup EnderBolt schedules since they're part of the dance pattern
    cleanup_ender_bolt_schedules(ctx, boss_monster_id);

    if spawn_count > 0 || scythe_count > 0 || active_count > 0 {
        log::info!("Cleaned up {} EnderScytheSpawn schedulers, {} EnderScythe schedulers, and {} active scythe attacks for boss {}", 
                  spawn_count, scythe_count, active_count, boss_monster_id);
    }
}

// Function to cleanup ChaosBall attack schedules when a boss dies or changes state
pub fn cleanup_chaos_ball_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled ChaosBall attacks for this boss
    let schedulers_to_delete: Vec<u64> = ctx.db.chaos_ball_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let count = schedulers_to_delete.len();
    
    for scheduled_id in schedulers_to_delete {
        ctx.db.chaos_ball_scheduler().scheduled_id().delete(&scheduled_id);
    }

    // Also cleanup all ACTIVE ChaosBall attacks that are flying around
    let active_attacks_to_delete: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|attack| attack.monster_attack_type == MonsterAttackType::ChaosBall)
        .map(|attack| attack.active_monster_attack_id)
        .collect();
    
    let active_count = active_attacks_to_delete.len();
    
    for attack_id in active_attacks_to_delete {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&attack_id);
    }

    if count > 0 || active_count > 0 {
        log::info!("Cleaned up {} ChaosBall schedulers and {} active ChaosBall attacks for boss {}", 
                  count, active_count, boss_monster_id);
    }
}

// Function to cleanup VoidZone attack schedules when a boss dies or changes state
pub fn cleanup_void_zone_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled VoidZone attacks for this boss
    let schedulers_to_delete: Vec<u64> = ctx.db.void_zone_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let count = schedulers_to_delete.len();
    
    for scheduled_id in schedulers_to_delete {
        ctx.db.void_zone_scheduler().scheduled_id().delete(&scheduled_id);
    }

    // Also cleanup all ACTIVE VoidZone attacks that are active
    let active_attacks_to_delete: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|attack| {
            attack.monster_attack_type == MonsterAttackType::VoidZone &&
            attack.parameter_u == boss_monster_id
        })
        .map(|attack| attack.active_monster_attack_id)
        .collect();
    
    let active_count = active_attacks_to_delete.len();
    
    for attack_id in active_attacks_to_delete {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&attack_id);
    }

    if count > 0 || active_count > 0 {
        log::info!("Cleaned up {} VoidZone schedulers and {} active VoidZone attacks for boss {}", 
                  count, active_count, boss_monster_id);
    }
}

// Function to cleanup boss target switching schedules when a boss dies
pub fn cleanup_boss_target_switching(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled target switches for this boss
    let schedulers_to_delete: Vec<u64> = ctx.db.boss_target_switch_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let count = schedulers_to_delete.len();
    
    for scheduled_id in schedulers_to_delete {
        ctx.db.boss_target_switch_scheduler().scheduled_id().delete(&scheduled_id);
    }

    if count > 0 {
        log::info!("Cleaned up {} boss target switching schedulers for boss {}", 
                  count, boss_monster_id);
    }
}

// ================================================================================================
// ENDER BOSS AI BEHAVIOR FUNCTIONS
// ================================================================================================

// Execute behavior when entering BossEnderIdle state
pub fn execute_boss_ender_idle_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Reset speed to bestiary entry
    reset_monster_speed_to_bestiary(ctx, monster);
    
    // Schedule next random boss pattern after idle duration
    schedule_random_boss_ender_pattern(ctx, monster.monster_id);
}

// Execute behavior when entering BossEnderChase state
pub fn execute_boss_ender_chase_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Increase speed by multiplier
    increase_monster_speed(ctx, monster, BOSS_ENDER_CHASE_SPEED_MULTIPLIER);
    
    // Change target to random player
    change_monster_target_to_random_player(ctx, monster);
    
    // Schedule return to idle after chase duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossEnderIdle, BOSS_ENDER_CHASE_DURATION_MS);
}

// Execute behavior when entering BossEnderDance state
pub fn execute_boss_ender_dance_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Schedule EnderScythe attack pattern
    schedule_ender_scythe_attacks(ctx, monster.monster_id);
    
    // Schedule EnderBolt attacks to fire periodically during dance
    start_ender_bolt_attacks(ctx, monster.monster_id);
    
    // Schedule return to idle after dance duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossEnderIdle, BOSS_ENDER_DANCE_DURATION_MS);
}

// Execute behavior when entering BossEnderVanish state
pub fn execute_boss_ender_vanish_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Change target to random player
    change_monster_target_to_random_player(ctx, monster);
    
    // Schedule transition to lurk after vanish duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossEnderLurk, BOSS_ENDER_VANISH_DURATION_MS);
}

// Execute behavior when entering BossEnderLurk state
pub fn execute_boss_ender_lurk_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Boss lurks (invisible, non-collidable) before teleporting
    // Schedule transition to teleport after lurk duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossEnderTeleport, BOSS_ENDER_LURK_DURATION_MS);
}

// Execute behavior when entering BossEnderTeleport state
pub fn execute_boss_ender_teleport_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Teleport to target player position
    teleport_monster_to_target(ctx, monster);
    
    // Schedule return to idle after teleport duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossEnderIdle, BOSS_ENDER_TELEPORT_DURATION_MS);
}

// Execute behavior when entering BossEnderTransform state
pub fn execute_boss_ender_transform_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Schedule return to idle after transform duration
    schedule_state_change(ctx, monster.monster_id, crate::monster_ai_defs::AIState::BossEnderIdle, BOSS_ENDER_TRANSFORM_DURATION_MS);
}

// Schedule a random boss ender pattern (chase, dance, or vanish)
pub fn schedule_random_boss_ender_pattern(ctx: &ReducerContext, monster_id: u32) {
    let mut rng = ctx.rng();
    
    // Get the last pattern for this boss (if any)
    let last_pattern_opt = ctx.db.boss_ender_last_patterns().monster_id().find(&monster_id);
    let last_pattern = last_pattern_opt.as_ref().map(|p| p.last_pattern);
    
    // Create list of available patterns (excluding the last one used)
    let all_patterns = vec![
        crate::monster_ai_defs::AIState::BossEnderChase, 
        crate::monster_ai_defs::AIState::BossEnderDance, 
        crate::monster_ai_defs::AIState::BossEnderVanish
    ];
    let available_patterns: Vec<crate::monster_ai_defs::AIState> = all_patterns.into_iter()
        .filter(|pattern| Some(*pattern) != last_pattern)
        .collect();
    
    // Select random pattern from available options
    let target_state = if available_patterns.is_empty() {
        // Fallback (shouldn't happen, but just in case)
        crate::monster_ai_defs::AIState::BossEnderChase
    } else {
        let random_index = (rng.gen::<f32>() * available_patterns.len() as f32) as usize;
        available_patterns[random_index]
    };
    
    // Update the last pattern for this boss
    if let Some(mut last_pattern_record) = last_pattern_opt {
        last_pattern_record.last_pattern = target_state;
        ctx.db.boss_ender_last_patterns().monster_id().update(last_pattern_record);
    } else {
        // Create new record for this boss
        ctx.db.boss_ender_last_patterns().insert(BossEnderLastPattern {
            monster_id,
            last_pattern: target_state,
        });
    }
    
    schedule_state_change(ctx, monster_id, target_state, BOSS_ENDER_IDLE_DURATION_MS);
    log::info!("Scheduled random boss ender pattern {:?} for monster {} after {}ms (avoiding repetition of {:?})", 
               target_state, monster_id, BOSS_ENDER_IDLE_DURATION_MS, last_pattern);
}

// Initialize boss ender AI state when a boss is spawned
pub fn initialize_boss_ender_ai(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Initializing boss ender AI for monster {}", monster_id);
    
    // Set boss to idle state
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if let Some(mut monster) = monster_opt {
        monster.ai_state = crate::monster_ai_defs::AIState::BossEnderIdle;
        ctx.db.monsters().monster_id().update(monster);
        
        // Schedule first random boss pattern
        schedule_random_boss_ender_pattern(ctx, monster_id);
    }
}

// Initialize Phase 2 boss ender AI state (stays idle, no patterns)
pub fn initialize_phase2_boss_ender_ai(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Initializing Phase 2 boss ender AI for monster {} (BossEnderIdle only, no patterns)", monster_id);
    
    // Set boss to idle state  
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if let Some(mut monster) = monster_opt {
        monster.ai_state = crate::monster_ai_defs::AIState::BossEnderIdle;
        ctx.db.monsters().monster_id().update(monster);
        
        // Phase 2 boss stays idle - no pattern scheduling
        log::info!("Phase 2 boss {} set to BossEnderIdle state (no automatic patterns)", monster_id);
    }
}

// ================================================================================================
// HELPER FUNCTIONS (moved from monster_ai_defs)
// ================================================================================================

// Reset monster speed to bestiary entry
fn reset_monster_speed_to_bestiary(ctx: &ReducerContext, monster: &crate::Monsters) {
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32))
        .expect("reset_monster_speed_to_bestiary: Could not find bestiary entry");
    
    let mut updated_monster = monster.clone();
    updated_monster.speed = bestiary_entry.speed;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Monster {} speed reset to {}", monster.monster_id, bestiary_entry.speed);
}

// Increase monster speed by multiplier
fn increase_monster_speed(ctx: &ReducerContext, monster: &crate::Monsters, multiplier: f32) {
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32))
        .expect("increase_monster_speed: Could not find bestiary entry");
    
    let mut updated_monster = monster.clone();
    updated_monster.speed = bestiary_entry.speed * multiplier;
    let new_speed = updated_monster.speed; // Store the speed before moving the monster
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Monster {} speed increased to {} ({}x multiplier)", monster.monster_id, new_speed, multiplier);
}

// Change monster target to a random player
fn change_monster_target_to_random_player(ctx: &ReducerContext, monster: &crate::Monsters) {
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        log::info!("No players available to target for monster {}", monster.monster_id);
        return;
    }
    
    // Choose a random player
    let mut rng = ctx.rng();
    let random_index = (rng.gen::<f32>() * player_count as f32) as usize;
    let target_player = &players[random_index];
    
    // Update the monster's target
    let mut updated_monster = monster.clone();
    updated_monster.target_player_id = target_player.player_id;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Monster {} target changed to player {} ({})", 
              monster.monster_id, target_player.player_id, target_player.name);
}

// Teleport monster to target player position
fn teleport_monster_to_target(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Find the target player
    let target_player_opt = ctx.db.player().player_id().find(&monster.target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::info!("Target player {} not found for monster {}, skipping teleport", 
                      monster.target_player_id, monster.monster_id);
            return;
        }
    };
    
    // Calculate teleport position near the target player (50-100 pixels away)
    let mut rng = ctx.rng();
    let teleport_distance = 50.0 + (rng.gen::<f32>() * 50.0); // 50-100 pixels
    let teleport_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0; // Random angle
    
    let teleport_position = DbVector2::new(
        target_player.position.x + teleport_distance * teleport_angle.cos(),
        target_player.position.y + teleport_distance * teleport_angle.sin()
    );
    
    teleport_monster_to_position(ctx, monster.monster_id, &teleport_position);
}

// Teleport monster to a specific position
fn teleport_monster_to_position(ctx: &ReducerContext, monster_id: u32, position: &DbVector2) {
    // Update the monster's boid position
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&monster_id);
    if let Some(mut boid) = boid_opt {
        boid.position = position.clone();
        ctx.db.monsters_boid().monster_id().update(boid);
        log::info!("Monster {} teleported to position ({}, {})", monster_id, position.x, position.y);
    }
}

// Schedule a state change for a monster
fn schedule_state_change(ctx: &ReducerContext, monster_id: u32, target_state: crate::monster_ai_defs::AIState, delay_ms: u64) {
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster_id,
        target_state,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(delay_ms)),
    });
    
    log::info!("Scheduled state change for monster {} to {:?} in {}ms", monster_id, target_state, delay_ms);
}

// ================================================================================================
// ENDER BOSS CHASE BEHAVIOR FUNCTIONS
// ================================================================================================

// Handle chase behavior for Ender boss monsters during movement processing
pub fn handle_ender_boss_chase_movement(
    ctx: &ReducerContext, 
    cache: &mut crate::collision::CollisionCache, 
    cache_index: usize
) -> bool {
    let monster_id = cache.monster.keys_monster[cache_index];
    let real_monster = ctx.db.monsters().monster_id().find(&monster_id);
    
    if let Some(monster) = real_monster {
        let monster_type_name = get_monster_type_name(&monster.bestiary_id);
        if monster_type_name == "BossEnderPhase1" || monster_type_name == "BossEnderPhase2" {
            // Check distance to target for boss monsters
            let monster_position = DbVector2::new(
                cache.monster.pos_x_monster[cache_index], 
                cache.monster.pos_y_monster[cache_index]
            );
            let target_position = DbVector2::new(
                cache.monster.target_x_monster[cache_index], 
                cache.monster.target_y_monster[cache_index]
            );
            
            crate::monster_ai_defs::check_boss_chase_distance(ctx, monster_id, &monster_position, &target_position);
            
            // Re-check if monster is still in chase mode (might have been changed by check_boss_chase_distance)
            let updated_monster = ctx.db.monsters().monster_id().find(&monster_id);
            if let Some(updated_monster) = updated_monster {
                let updated_behavior = crate::monster_ai_defs::get_movement_behavior_for_state(&updated_monster.ai_state);
                if updated_behavior != crate::monster_ai_defs::MovementBehavior::EnderChase {
                    return false; // Skip movement if no longer chasing
                }
            }
            
            // Apply chase acceleration if still in chase mode
            let mut speed = cache.monster.speed_monster[cache_index];
            speed *= crate::monster_ai_defs::CHASE_ACCELERATION_MULTIPLIER;
            speed = speed.min(crate::monster_ai_defs::MAX_CHASE_SPEED);
            
            cache.monster.speed_monster[cache_index] = speed; // Update cached speed for next frame

            // Update the monster's speed in the database
            let real_monster = ctx.db.monsters().monster_id().find(&monster_id);
            if let Some(monster) = real_monster {
                let mut updated_monster = monster;
                updated_monster.speed = speed;
                ctx.db.monsters().monster_id().update(updated_monster);
            }
            
            return true; // Continue with movement
        }
    }
    
    // Not an Ender boss, apply default chase behavior
    let mut speed = cache.monster.speed_monster[cache_index];
    speed *= crate::monster_ai_defs::CHASE_ACCELERATION_MULTIPLIER;
    speed = speed.min(crate::monster_ai_defs::MAX_CHASE_SPEED);
    cache.monster.speed_monster[cache_index] = speed;
    
    // Update the monster's speed in the database
    let real_monster = ctx.db.monsters().monster_id().find(&monster_id);
    if let Some(monster) = real_monster {
        let mut updated_monster = monster;
        updated_monster.speed = speed;
        ctx.db.monsters().monster_id().update(updated_monster);
    }
    
    true // Continue with movement
}

// Helper function to get monster type name (moved from monsters_def for use here)
fn get_monster_type_name(bestiary_id: &MonsterType) -> &'static str {
    match bestiary_id {
        MonsterType::Rat => "Rat",
        MonsterType::Slime => "Slime",
        MonsterType::Bat => "Bat",
        MonsterType::Orc => "Orc",
        MonsterType::Imp => "Imp",
        MonsterType::Zombie => "Zombie",
        MonsterType::VoidChest => "VoidChest",
        MonsterType::EnderClaw => "EnderClaw",
        MonsterType::BossEnderPhase1 => "BossEnderPhase1",
        MonsterType::BossEnderPhase2 => "BossEnderPhase2",
        MonsterType::BossAgnaPhase1 => "BossAgnaPhase1",
        MonsterType::BossAgnaPhase2 => "BossAgnaPhase2",
        MonsterType::AgnaCandle => "AgnaCandle",
    }
}