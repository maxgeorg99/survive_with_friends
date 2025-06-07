use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterAttackType, DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, player, monsters, monsters_boid};
use std::time::Duration;

// Configuration constants for EnderScythe attacks
const ENDER_SCYTHE_RINGS: u32 = 8;                    // Number of rings around the boss
const ENDER_SCYTHE_BASE_RADIUS: f32 = 256.0;          // Starting radius for first ring
const ENDER_SCYTHE_RING_SPACING: f32 = 256.0;         // Distance between rings
const ENDER_SCYTHE_BASE_COUNT: u32 = 4;              // Number of scythes in the inner ring
const ENDER_SCYTHE_COUNT_INCREMENT: u32 = 4;         // Additional scythes per ring (6, 8, 10, 12)
const ENDER_SCYTHE_SPAWN_DURATION_MS: u64 = 1500;     // Duration for EnderScytheSpawn (warning phase)
const ENDER_SCYTHE_DAMAGE: u32 = 15;                 // Damage for EnderScythe attacks
const ENDER_SCYTHE_SPEED: f32 = 24.0;                // Rotation speed (degrees per second)
const ENDER_SCYTHE_RADIUS: f32 = 62.0;               // Collision radius for scythes

// Configuration constants for EnderBolt attacks
const ENDER_BOLT_DAMAGE: u32 = 25;                   // Damage for EnderBolt attacks (more powerful than ImpBolt)
const ENDER_BOLT_SPEED: f32 = 800.0;                 // Movement speed for EnderBolt attacks
const ENDER_BOLT_RADIUS: f32 = 27.0;                 // Collision radius for EnderBolt attacks
const ENDER_BOLT_DURATION_MS: u64 = 4000;            // Duration before EnderBolt expires
const ENDER_BOLT_BASE_INTERVAL_MS: u64 = 1000;       // Base time between EnderBolt attacks (single player)
const ENDER_BOLT_MIN_INTERVAL_MS: u64 = 50;         // Minimum time between EnderBolt attacks (many players)
const ENDER_BOLT_INITIAL_DELAY_MS: u64 = 3500;       // Initial delay before first EnderBolt (after real scythes spawn)

// Scheduled table for Imp attacks - Imps periodically fire ImpBolts at players
#[table(name = imp_attack_scheduler, scheduled(trigger_imp_attack), public)]
pub struct ImpAttackScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When the next attack should fire
    
    #[index(btree)]
    pub imp_monster_id: u32,      // The Imp monster that will attack
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

// Active monster attacks - tracks currently active monster attacks in the game
// This is a scheduled table that automatically expires attacks
#[table(name = active_monster_attacks, scheduled(expire_monster_attack), public)]
pub struct ActiveMonsterAttack {
    #[primary_key]
    #[auto_inc]
    pub active_monster_attack_id: u64,
    
    pub scheduled_at: ScheduleAt, // When this attack expires
    
    // Position and movement data (no longer using Entity table)
    pub position: DbVector2,       // Current position of the attack
    pub direction: DbVector2,      // Direction vector (normalized)
    
    pub monster_attack_type: MonsterAttackType, // The type of monster attack
    pub piercing: bool,        // Whether this attack pierces through players
    pub damage: u32,           // Damage of this specific attack instance
    pub radius: f32,           // Radius of this attack (for area effects)
    pub speed: f32,            // Movement speed of projectiles
    pub parameter_u: u32,      // Additional parameter for the attack
    pub parameter_f: f32,      // Additional parameter for the attack 
    pub ticks_elapsed: u32,    // Number of ticks since the attack was created
}

// Helper method to process monster attack movements
pub fn process_monster_attack_movements(ctx: &ReducerContext) {
    let cache = crate::monsters_def::get_collision_cache();
    cache.monster_attack.cached_count_monster_attacks = 0;
    
    // Process each active monster attack
    for active_monster_attack in ctx.db.active_monster_attacks().iter() {
        let mut updated_active_monster_attack = active_monster_attack;
        updated_active_monster_attack.ticks_elapsed += 1; 

        // Handle different movement patterns based on attack type
        match updated_active_monster_attack.monster_attack_type {
            MonsterAttackType::EnderScythe => {
                // Only EnderScythe has orbital movement around the boss
                handle_ender_scythe_orbital_movement(ctx, &mut updated_active_monster_attack);
            },
            MonsterAttackType::EnderScytheSpawn => {
                // EnderScytheSpawn attacks stay completely still - no movement or rotation
                // They are just warning indicators
            },
            _ => {
                // Regular projectile movement based on direction and speed
                let move_speed = updated_active_monster_attack.speed;
                
                // Calculate movement based on direction, speed and time delta
                let move_distance = move_speed * DELTA_TIME;
                let move_offset = updated_active_monster_attack.direction * move_distance;
                
                // Update position directly
                updated_active_monster_attack.position = updated_active_monster_attack.position + move_offset;
            }
        }

        // Update collision cache
        let cache_idx = cache.monster_attack.cached_count_monster_attacks as usize;
        cache.monster_attack.keys_monster_attack[cache_idx] = updated_active_monster_attack.active_monster_attack_id as u32;
        cache.monster_attack.pos_x_monster_attack[cache_idx] = updated_active_monster_attack.position.x;
        cache.monster_attack.pos_y_monster_attack[cache_idx] = updated_active_monster_attack.position.y;
        cache.monster_attack.radius_monster_attack[cache_idx] = updated_active_monster_attack.radius;

        let grid_cell_key = get_world_cell_from_position(updated_active_monster_attack.position.x, updated_active_monster_attack.position.y);
        cache.monster_attack.nexts_monster_attack[cache_idx] = cache.monster_attack.heads_monster_attack[grid_cell_key as usize]; 
        cache.monster_attack.heads_monster_attack[grid_cell_key as usize] = cache_idx as i32;

        cache.monster_attack.cached_count_monster_attacks += 1;

        // Update the active monster attack record
        ctx.db.active_monster_attacks().active_monster_attack_id().update(updated_active_monster_attack);
    }
}

// Helper function to handle orbital movement for EnderScythe attacks
fn handle_ender_scythe_orbital_movement(ctx: &ReducerContext, attack: &mut ActiveMonsterAttack) {
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

// Helper method to process collisions between monster attacks and players using spatial hash
pub fn process_monster_attack_collisions_spatial_hash(ctx: &ReducerContext) {
    let cache = crate::monsters_def::get_collision_cache();
    
    // Iterate through all players first (likely fewer than monster attacks)
    for pid in 0..cache.player.cached_count_players {
        let pid = pid as usize;
        let px = cache.player.pos_x_player[pid];
        let py = cache.player.pos_y_player[pid];
        let pr = cache.player.radius_player[pid];
        let player_id = cache.player.keys_player[pid];

        // Check against all monster attacks in the same spatial hash cell
        let cell_key = get_world_cell_from_position(px, py);

        let cx = (cell_key & WORLD_CELL_MASK) as i32;
        let cy = (cell_key >> WORLD_CELL_BIT_SHIFT) as i32;

        for dy in -1..=1 {
            let ny = cy + dy;
            if ny < 0 || ny >= WORLD_GRID_HEIGHT as i32 {
                continue;
            }

            let row_base = ny << WORLD_CELL_BIT_SHIFT;
            for dx in -1..=1 {
                let nx = cx + dx;
                if nx < 0 || nx >= WORLD_GRID_WIDTH as i32 {
                    continue;
                }

                let test_cell_key = (row_base | nx) as usize;
                let mut aid = cache.monster_attack.heads_monster_attack[test_cell_key];
                while aid != -1 {
                    let aid_usize = aid as usize;
                    let ax = cache.monster_attack.pos_x_monster_attack[aid_usize];
                    let ay = cache.monster_attack.pos_y_monster_attack[aid_usize];
                    let ar = cache.monster_attack.radius_monster_attack[aid_usize];

                    if spatial_hash_collision_checker(px, py, pr, ax, ay, ar) {
                        // Get the active monster attack data using active_monster_attack_id (stored as u32 in cache)
                        let attack_id = cache.monster_attack.keys_monster_attack[aid_usize] as u64;
                        let active_monster_attack_opt = ctx.db.active_monster_attacks().active_monster_attack_id().find(&attack_id);
                        let active_monster_attack = match active_monster_attack_opt {
                            Some(attack) => attack,
                            None => {
                                aid = cache.monster_attack.nexts_monster_attack[aid_usize];
                                continue;
                            }
                        };
                        
                        // Apply damage to player using the active monster attack's damage value
                        let mut damage = active_monster_attack.damage as f32;
                        if active_monster_attack.piercing {
                            damage /= 8.0;
                        }
                        else {
                            ctx.db.active_monster_attacks().active_monster_attack_id().delete(&active_monster_attack.active_monster_attack_id);
                        }

                        cache.player.damage_to_player[pid] += damage;
                        
                        log::info!("Monster attack {} hit player {} for {} damage", 
                                  active_monster_attack.active_monster_attack_id, player_id, damage);
                    }

                    aid = cache.monster_attack.nexts_monster_attack[aid_usize];
                }
            }
        }
    }
}

// Reducer called when monster attacks expire naturally
#[reducer]
pub fn expire_monster_attack(ctx: &ReducerContext, attack: ActiveMonsterAttack) {
    if ctx.sender != ctx.identity() {
        panic!("ExpireMonsterAttack may not be invoked by clients, only via scheduling.");
    }

    log::info!("Monster attack {} ({:?}) expired at position ({}, {})", 
              attack.active_monster_attack_id,
              attack.monster_attack_type,
              attack.position.x, 
              attack.position.y);
    
    // The attack is automatically removed from the table when this reducer completes
}

// Helper function to find the nearest player to a position
pub fn find_nearest_player(ctx: &ReducerContext, position: DbVector2) -> Option<crate::Player> {
    let mut nearest_player: Option<crate::Player> = None;
    let mut nearest_distance_squared = f32::MAX;

    // Iterate through all players in the game
    for player in ctx.db.player().iter() {
        // Calculate squared distance (more efficient than using square root)
        let dx = player.position.x - position.x;
        let dy = player.position.y - position.y;
        let distance_squared = dx * dx + dy * dy;

        // If this player is closer than the current nearest, update nearest
        if distance_squared < nearest_distance_squared {
            nearest_distance_squared = distance_squared;
            nearest_player = Some(player);
        }
    }

    nearest_player
}

// Function to spawn an ImpBolt at a particular position, targeting a specific player
pub fn spawn_imp_bolt(ctx: &ReducerContext, spawn_position: DbVector2, target_player_id: u32) {
    // Get the target player
    let target_player_opt = ctx.db.player().player_id().find(&target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            log::error!("Cannot spawn ImpBolt: target player {} not found", target_player_id);
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

    // Create active monster attack (scheduled to expire after 3 seconds)
    let duration_ms = 3000u64;
    let active_monster_attack = ctx.db.active_monster_attacks().insert(ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(duration_ms)),
        position: spawn_position,
        direction: direction_vector,
        monster_attack_type: MonsterAttackType::ImpBolt,
        piercing: false, // ImpBolt is not piercing
        damage: 12, // ImpBolt damage
        radius: 16.0, // ImpBolt radius
        speed: 600.0, // ImpBolt speed
        parameter_u: target_player_id, // Store target player ID
        parameter_f: direction_angle, // Store direction angle
        ticks_elapsed: 0,
    });

    log::info!("Spawned ImpBolt {} at ({}, {}) targeting player {} (expires in {}ms)", 
              active_monster_attack.active_monster_attack_id, 
              spawn_position.x, spawn_position.y, 
              target_player_id, duration_ms);
}

// Reducer called when an Imp should fire an ImpBolt
#[reducer]
pub fn trigger_imp_attack(ctx: &ReducerContext, scheduler: ImpAttackScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("TriggerImpAttack may not be invoked by clients, only via scheduling.");
    }

    // Check if the Imp monster still exists
    let imp_opt = ctx.db.monsters().monster_id().find(&scheduler.imp_monster_id);
    let imp = match imp_opt {
        Some(monster) => monster,
        None => {
            // Imp is dead - don't reschedule, just log cleanup
            log::info!("Imp {} no longer exists, removing attack scheduler", scheduler.imp_monster_id);
            return;
        }
    };

    // Get the Imp's current position from boid
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&scheduler.imp_monster_id);
    let imp_position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            // No boid found - Imp is probably dead, don't reschedule
            log::info!("Imp {} has no boid, removing attack scheduler", scheduler.imp_monster_id);
            return;
        }
    };

    // Check if the target player still exists
    let target_player_opt = ctx.db.player().player_id().find(&imp.target_player_id);
    let target_player = match target_player_opt {
        Some(player) => player,
        None => {
            // Target player is gone - find a new target or skip this attack
            let new_target_player = find_nearest_player(ctx, imp_position);
            match new_target_player {
                Some(player) => player,
                None => {
                    // No players found - don't attack but reschedule for later
                    log::info!("No target players found for Imp {}, skipping attack", scheduler.imp_monster_id);
                    schedule_next_imp_attack(ctx, scheduler.imp_monster_id);
                    return;
                }
            }
        }
    };

    // Spawn the ImpBolt attack
    spawn_imp_bolt(ctx, imp_position, target_player.player_id);
    
    log::info!("Imp {} fired ImpBolt at player {} from position ({}, {})", 
              scheduler.imp_monster_id, target_player.player_id, imp_position.x, imp_position.y);

    // Schedule the next attack
    schedule_next_imp_attack(ctx, scheduler.imp_monster_id);
}

// Helper function to schedule the next Imp attack
fn schedule_next_imp_attack(ctx: &ReducerContext, imp_monster_id: u32) {
    // Schedule next attack in 2-4 seconds (random interval)
    let mut rng = ctx.rng();
    let attack_delay_ms = 2000 + (rng.gen::<f32>() * 2000.0) as u64; // 2-4 seconds
    
    ctx.db.imp_attack_scheduler().insert(ImpAttackScheduler {
        scheduled_id: 0,
        imp_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(attack_delay_ms)),
    });
}

// Function to start Imp attack scheduling when an Imp spawns
pub fn start_imp_attack_schedule(ctx: &ReducerContext, imp_monster_id: u32) {
    // Schedule the first attack in 3-5 seconds to give players time to see the Imp
    let mut rng = ctx.rng();
    let initial_delay_ms = 3000 + (rng.gen::<f32>() * 2000.0) as u64; // 3-5 seconds
    
    ctx.db.imp_attack_scheduler().insert(ImpAttackScheduler {
        scheduled_id: 0,
        imp_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(initial_delay_ms)),
    });

    log::info!("Started attack schedule for Imp {} (first attack in {}ms)", imp_monster_id, initial_delay_ms);
}

// Function to cleanup Imp attack schedule when an Imp dies
pub fn cleanup_imp_attack_schedule(ctx: &ReducerContext, imp_monster_id: u32) {
    // Find and delete all scheduled attacks for this Imp
    let schedulers_to_delete: Vec<u64> = ctx.db.imp_attack_scheduler()
        .imp_monster_id()
        .filter(&imp_monster_id)
        .map(|scheduler| scheduler.scheduled_id)
        .collect();
    
    let count = schedulers_to_delete.len();
    
    for scheduled_id in schedulers_to_delete {
        ctx.db.imp_attack_scheduler().scheduled_id().delete(&scheduled_id);
    }

    if count > 0 {
        log::info!("Cleaned up {} attack schedulers for dead Imp {}", count, imp_monster_id);
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
            let active_monster_attack = ctx.db.active_monster_attacks().insert(ActiveMonsterAttack {
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
    let scythe_duration_ms = crate::monster_ai_defs::BOSS_DANCE_DURATION_MS - 3000; // Dance duration minus spawn delays

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
            let active_monster_attack = ctx.db.active_monster_attacks().insert(ActiveMonsterAttack {
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
    let active_monster_attack = ctx.db.active_monster_attacks().insert(ActiveMonsterAttack {
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
    if boss.ai_state != crate::monster_ai_defs::AIState::BossDance {
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
