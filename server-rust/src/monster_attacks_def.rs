use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterAttackType, DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, player, monsters, monsters_boid};
use std::time::Duration;

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
    pub parameter_f: f32,      // Additional parameter for the attack (direction angle in radians)
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

        // Regular projectile movement based on direction and speed
        let move_speed = updated_active_monster_attack.speed;
        
        // Calculate movement based on direction, speed and time delta
        let move_distance = move_speed * DELTA_TIME;
        let move_offset = updated_active_monster_attack.direction * move_distance;
        
        // Update position directly
        updated_active_monster_attack.position = updated_active_monster_attack.position + move_offset;

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
                        
                        // If the attack is not piercing, remove it after hitting this player
                        if !active_monster_attack.piercing {
                            // Reduce damage because it will hit each tick
                            damage /= 8.0;

                            // Delete the active monster attack record (it's scheduled, so it removes itself)
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
