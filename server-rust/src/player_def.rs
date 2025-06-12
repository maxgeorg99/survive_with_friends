use spacetimedb::{table, reducer, Table, ReducerContext, ScheduleAt, rand::Rng};
use crate::{account, collision, config, get_world_cell_from_position, DbVector2, PlayerClass, DELTA_TIME, WORLD_SIZE, 
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, spatial_hash_collision_checker,
           monsters};
use std::{f32, u16};
use std::time::Duration;

// Constants for safe spawn position finding
const MAX_SPAWN_ATTEMPTS: i32 = 50;   // Maximum number of attempts to find a safe spawn position
const MIN_SPAWN_DISTANCE: f32 = 200.0; // Minimum distance from monsters in pixels

// Function to check if a position is safe (far enough from monsters)
pub fn is_position_safe(_ctx: &ReducerContext, position: &DbVector2, radius: f32, collision_cache: &crate::CollisionCache) -> bool {
    // Get the cell key for this position
    let cell_key = get_world_cell_from_position(position.x, position.y);
    
    // Check surrounding cells (3x3 grid)
    let cx = (cell_key & WORLD_CELL_MASK) as i32;
    let cy = (cell_key >> WORLD_CELL_BIT_SHIFT) as i32;

    for dy in -1..=1 {
        let ny = cy + dy;
        if (ny as u32) >= WORLD_GRID_HEIGHT as u32 {
            continue;
        }

        let row_base = ny << WORLD_CELL_BIT_SHIFT;
        for dx in -1..=1 {
            let nx = cx + dx;
            if (nx as u32) >= WORLD_GRID_WIDTH as u32 {
                continue;
            }

            let test_cell_key = row_base | nx;
            let mut mid = collision_cache.monster.heads_monster[test_cell_key as usize];
            while mid != -1 {
                let mx = collision_cache.monster.pos_x_monster[mid as usize];
                let my = collision_cache.monster.pos_y_monster[mid as usize];
                let mr = collision_cache.monster.radius_monster[mid as usize];

                // Calculate distance between centers
                let dx2 = position.x - mx;
                let dy2 = position.y - my;
                let distance_squared = dx2 * dx2 + dy2 * dy2;
                let min_distance = radius + mr + MIN_SPAWN_DISTANCE;
                
                // If too close to a monster, position is not safe
                if distance_squared < min_distance * min_distance {
                    return false;
                }
                
                mid = collision_cache.monster.nexts_monster[mid as usize];
            }
        }
    }
    
    true
}

// Function to find a safe spawn position (used by both players and bots)
pub fn find_safe_spawn_position(ctx: &ReducerContext, radius: f32, collision_cache: &crate::CollisionCache) -> Option<DbVector2> {
    // Get game configuration for world size
    let config = ctx.db.config().id().find(&0)
        .expect("FindSafeSpawnPosition: Could not find game configuration!");

    // Calculate center of the world
    let center_x = config.world_size as f32 / 2.0;
    let center_y = config.world_size as f32 / 2.0;
    
    // Define spawn area as a portion of the world size around the center
    // Using 30% of world size as spawn radius makes it more central while still giving variety
    let spawn_radius = (config.world_size as f32 * 0.3) / 2.0; // 30% of world size, divided by 2 for radius
    
    // Ensure spawn area doesn't go outside world bounds
    let min_x = (center_x - spawn_radius).max(radius);
    let max_x = (center_x + spawn_radius).min(config.world_size as f32 - radius);
    let min_y = (center_y - spawn_radius).max(radius);
    let max_y = (center_y + spawn_radius).min(config.world_size as f32 - radius);

    // Try to find a safe position
    let mut rng = ctx.rng();
    for _attempt in 0..MAX_SPAWN_ATTEMPTS {
        // Generate random position within central spawn area
        let x = rng.gen_range(min_x..max_x);
        let y = rng.gen_range(min_y..max_y);
        let position = DbVector2::new(x, y);

        // Check if position is safe
        if is_position_safe(ctx, &position, radius, collision_cache) {
            return Some(position);
        }
    }

    // If we couldn't find a safe position, fall back to center with smaller offset
    log::info!("Could not find safe spawn position, falling back to center with offset");
    let offset_x = rng.gen_range(-200.0..201.0);
    let offset_y = rng.gen_range(-200.0..201.0);
    Some(DbVector2::new(center_x + offset_x, center_y + offset_y))
}

#[table(name = player, public)]
pub struct Player {
    #[primary_key]
    #[auto_inc]
    pub player_id: u32,
    pub name: String,

    pub spawn_grace_period_remaining: u32,

    pub player_class: PlayerClass,
    pub level: u32,
    pub exp: u32,
    pub exp_for_next_level: u32,
    pub max_hp: f32,
    pub hp: f32,
    pub hp_regen: u32,
    pub speed: f32,
    pub armor: u32,
    pub unspent_upgrades: u32,
    pub rerolls: u32,
    pub shield_count: u32,

    // PvP mode - false by default, true when player opts into PvP
    pub pvp: bool,

    // For tap-to-move
    pub waypoint: DbVector2,    // Target position for movement
    pub has_waypoint: bool,     // Whether entity has an active waypoint

    // entity attributes
    pub position: DbVector2,
    pub radius: f32,

    // Bot flag
    pub is_bot: bool,           // Whether this player is a bot
}

// Table to store dead players for run history purposes
#[table(name = dead_players, public)]
pub struct DeadPlayer {
    #[primary_key]
    pub player_id: u32,

    pub name: String,
    
    pub is_true_survivor: bool, // Flag to indicate the player defeated the final boss
}

#[reducer]
pub fn set_player_waypoint(ctx: &ReducerContext, waypoint_x: f32, waypoint_y: f32) {
    // Get the identity of the caller
    let identity = ctx.sender;
    
    // Find the account for the caller   
    let account = ctx.db.account().identity().find(&identity)
        .expect(&format!("SetPlayerWaypoint: Account {} does not exist.", identity));

    let player_id = account.current_player_id;

    let mut player = ctx.db.player().player_id().find(&player_id)
        .expect(&format!("SetPlayerWaypoint: Player {} does not exist.", player_id));
    
    // Get world size from config for boundary checking
    let world_size = if let Some(config) = ctx.db.config().id().find(&0) {
        config.world_size as f32
    } else {
        WORLD_SIZE as f32 // Default fallback
    };
    
    // Clamp waypoint to world boundaries using entity radius
    let waypoint = DbVector2::new(
        waypoint_x.clamp(player.radius, world_size - player.radius),
        waypoint_y.clamp(player.radius, world_size - player.radius),
    );
    
    // Update entity with new waypoint
    log::info!("Set waypoint for player {} to ({}, {})", player.name, waypoint.x, waypoint.y);
    player.waypoint = waypoint;
    player.has_waypoint = true;
    
    // Update the entity in the database
    ctx.db.player().player_id().update(player);
}

// Schedule for health regeneration
#[table(name = health_regen_scheduler, scheduled(process_health_regen))] 
pub struct HealthRegenScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub scheduled_at: ScheduleAt, // When to run health regen
}

// Initialize HP regen scheduler at server startup
#[reducer]
pub fn init_health_regen_system(ctx: &ReducerContext) {
    // Check if health regen scheduler already exists
    if ctx.db.health_regen_scheduler().iter().next().is_some() {
        log::info!("Health regen scheduler already initialized");
        return;
    }
    
    // Create the health regen scheduler to run every second
    ctx.db.health_regen_scheduler().insert(HealthRegenScheduler {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(Duration::from_secs(1).into()),
    });
    
    log::info!("Health regeneration system initialized");
}

// Process health regeneration for all players
#[reducer]
pub fn process_health_regen(ctx: &ReducerContext, _scheduler: HealthRegenScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("ProcessHealthRegen may not be invoked by clients, only via scheduling.");
    }
    
    for player in ctx.db.player().iter() {
        // Skip players with full health
        if player.hp >= player.max_hp {
            continue;
        }
        
        // Skip players with no regen
        if player.hp_regen <= 0 {
            continue;
        }
        
        // Apply HP regeneration
        let new_hp = player.max_hp.min(player.hp + player.hp_regen as f32);
        let heal_amount = new_hp - player.hp;
        
        if heal_amount > 0.0 {
            let mut updated_player = player;
            updated_player.hp = new_hp;
            ctx.db.player().player_id().update(updated_player);
        }
    }
}

pub fn process_player_movement(ctx: &ReducerContext, tick_rate: u32, collision_cache: &mut collision::CollisionCache) {
    collision_cache.player.cached_count_players = 0;
    
    for player in ctx.db.player().iter() {
        let mut modified_player = player;
        let mut should_update_player = false;

        // Update player status
        if modified_player.spawn_grace_period_remaining > 0 {
            if modified_player.spawn_grace_period_remaining >= tick_rate {
                modified_player.spawn_grace_period_remaining -= tick_rate;
            } else {
                modified_player.spawn_grace_period_remaining = 0;
            }
            should_update_player = true;
        }

        // Process player movement
        let move_speed = modified_player.speed;

        if modified_player.has_waypoint {
            should_update_player = true;

            // Calculate direction to waypoint
            let direction_vector = DbVector2::new(
                modified_player.waypoint.x - modified_player.position.x,
                modified_player.waypoint.y - modified_player.position.y,
            );
            
            // Calculate distance to waypoint
            let distance = (direction_vector.x * direction_vector.x + 
                          direction_vector.y * direction_vector.y).sqrt();
            
            // If we're close enough to the waypoint, clear it
            if distance < move_speed * DELTA_TIME {
                modified_player.has_waypoint = false;
                modified_player.position.x = modified_player.waypoint.x;
                modified_player.position.y = modified_player.waypoint.y;
            } else {
                // Normalize direction vector
                let normalized_direction = DbVector2::new(
                    direction_vector.x / distance,
                    direction_vector.y / distance,
                );
                
                // Move towards waypoint
                modified_player.position.x += normalized_direction.x * move_speed * DELTA_TIME;
                modified_player.position.y += normalized_direction.y * move_speed * DELTA_TIME;
                
                // Clamp position to world boundaries
                modified_player.position.x = modified_player.position.x.clamp(
                    modified_player.radius,
                    WORLD_SIZE as f32 - modified_player.radius,
                );
                modified_player.position.y = modified_player.position.y.clamp(
                    modified_player.radius,
                    WORLD_SIZE as f32 - modified_player.radius,
                );
            }
        } else if modified_player.is_bot {

            should_update_player = true;

            // Bot should set a waypoint at a random position
            let mut rng = ctx.rng();
            modified_player.waypoint.x = modified_player.radius + rng.gen_range(0.0..1.0) * (WORLD_SIZE as f32 - modified_player.radius * 2.0);
            modified_player.waypoint.y = modified_player.radius + rng.gen_range(0.0..1.0) * (WORLD_SIZE as f32 - modified_player.radius * 2.0);
            modified_player.has_waypoint = true;
        }

        let cached_count_players = collision_cache.player.cached_count_players as usize;
        collision_cache.player.keys_player[cached_count_players] = modified_player.player_id;
        collision_cache.player.pos_x_player[cached_count_players] = modified_player.position.x;
        collision_cache.player.pos_y_player[cached_count_players] = modified_player.position.y;
        collision_cache.player.radius_player[cached_count_players] = modified_player.radius;
        collision_cache.player.shield_count_player[cached_count_players] = modified_player.shield_count;
        collision_cache.player.pvp_player[cached_count_players] = modified_player.pvp;

        let grid_cell_key = get_world_cell_from_position(modified_player.position.x, modified_player.position.y) as usize;
        collision_cache.player.cell_player[cached_count_players] = grid_cell_key as i32;
        collision_cache.player.nexts_player[cached_count_players] = collision_cache.player.heads_player[grid_cell_key];
        collision_cache.player.heads_player[grid_cell_key] = cached_count_players as i32;

        collision_cache.player.player_id_to_cache_index.insert(modified_player.player_id, cached_count_players as u32);

        // Increment the cached count players
        collision_cache.player.cached_count_players += 1;

        if should_update_player {
            ctx.db.player().player_id().update(modified_player);
        }
    }
}

pub fn process_player_monster_collisions_spatial_hash(ctx: &ReducerContext, collision_cache: &mut collision::CollisionCache) {
    if ctx.db.monsters().iter().next().is_none() {
        return;
    }

    // Iterate through all players using spatial hash
    for pid in 0..collision_cache.player.cached_count_players as usize {
        let px = collision_cache.player.pos_x_player[pid];
        let py = collision_cache.player.pos_y_player[pid];
        let pr = collision_cache.player.radius_player[pid];

        // Check against all monsters in the same spatial hash cell
        let cell_key = get_world_cell_from_position(px, py);

        let cx = (cell_key & WORLD_CELL_MASK) as i32;
        let cy = (cell_key >> WORLD_CELL_BIT_SHIFT) as i32;

        for dy in -1..=1 {
            let ny = cy + dy;
            if (ny as u32) >= WORLD_GRID_HEIGHT as u32 { continue; } // unsigned trick == clamp

            let row_base = ny << WORLD_CELL_BIT_SHIFT;
            for dx in -1..=1 {
                let nx = cx + dx;
                if (nx as u32) >= WORLD_GRID_WIDTH as u32 { continue; }

                let test_cell_key = (row_base | nx) as usize;
                let mut mid = collision_cache.monster.heads_monster[test_cell_key];
                while mid != -1 {
                    let mid_usize = mid as usize;
                    let mx = collision_cache.monster.pos_x_monster[mid_usize];
                    let my = collision_cache.monster.pos_y_monster[mid_usize];
                    let mr = collision_cache.monster.radius_monster[mid_usize];

                    if spatial_hash_collision_checker(px, py, pr, mx, my, mr) {
                        // Only apply damage if monster can deal damage (fixes boss lurk issue)
                        if collision_cache.monster.can_deal_damage[mid_usize] {
                            collision_cache.player.damage_to_player[pid] += collision_cache.monster.atk_monster[mid_usize];
                        }
                    }

                    mid = collision_cache.monster.nexts_monster[mid_usize];
                }
            }
        }
    }
}

pub fn commit_player_damage(ctx: &ReducerContext, collision_cache: &collision::CollisionCache) {
    for pid in 0..collision_cache.player.cached_count_players as usize {
        if collision_cache.player.damage_to_player[pid] > 0.0 {
            crate::core_game::damage_player(ctx, collision_cache.player.keys_player[pid], collision_cache.player.damage_to_player[pid]);
        }
    }
}

#[reducer]
pub fn set_player_pvp_mode(ctx: &ReducerContext, pvp_enabled: bool) {
    // Get the identity of the caller
    let identity = ctx.sender;
    
    // Find the account for the caller   
    let account = ctx.db.account().identity().find(&identity)
        .expect(&format!("SetPlayerPvpMode: Account {} does not exist.", identity));

    let player_id = account.current_player_id;

    let mut player = ctx.db.player().player_id().find(&player_id)
        .expect(&format!("SetPlayerPvpMode: Player {} does not exist.", player_id));
    
    // Update PvP mode
    log::info!("Player {} ({}) {} PvP mode", player.name, player_id, if pvp_enabled { "enabled" } else { "disabled" });
    player.pvp = pvp_enabled;
    
    // Update the player in the database
    ctx.db.player().player_id().update(player);
}
