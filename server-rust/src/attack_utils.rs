use spacetimedb::{ReducerContext, Table, rand::{Rng, RngCore}};
use crate::{DbVector2, AttackType, PlayerScheduledAttack, monsters_def::{monsters, monsters_boid}};
use std::f64::consts::PI;

// Thunder Horn attack configuration constants
pub const THUNDER_HORN_TARGET_RADIUS: f32 = 700.0;  // Maximum range for Thunder Horn targeting

// Get parameter_u for an attack
pub fn get_parameter_u(ctx: &ReducerContext, attack: &PlayerScheduledAttack) -> u32 {
    let attack_type = &attack.attack_type;

    match attack_type {
        AttackType::Sword => {
            if attack.parameter_u == 0 {
                1
            } else {
                0
            }
        }
        AttackType::Knives => {
            // Calculate consistent rotation based on attack count
            // Each attack should rotate by the angle between knives
            let angle_between_knives = 360.0 / attack.projectiles as f64;
            let rotation_offset = (attack.attack_count as f64 * angle_between_knives / 12.0) % 360.0;
            rotation_offset as u32
        }
        AttackType::Shield => {
            let mut rng = ctx.rng();
            let angle = rng.gen_range(0.0..360.0);
            angle as u32
        }
        AttackType::ThunderHorn => {
            // Store the target position in parameter_u and parameter_i
            // We'll pack the position coordinates into these parameters
            0 // Position will be determined in determine_attack_direction
        }
        AttackType::AngelStaff => {
            // Angel Staff doesn't need special parameters since it's a simple area effect
            0
        }
        AttackType::Football | AttackType::Cards | AttackType::Dumbbell => {
            // For now, use a simple alternating parameter like Sword
            if attack.parameter_u == 0 {
                1
            } else {
                0
            }
        }
        AttackType::Volleyball => {
            // For Volleyball, parameter_u stores the bounce count
            if attack.parameter_u == 0 {
                1
            } else {
                0
            }
        }
        AttackType::Garlic => {
            // Garlic has no direction, so no parameter needed
            0
        }
        _ => 0,
    }
}

// Determine the direction of the attack based on attack type and other factors
pub fn determine_attack_direction(
    ctx: &ReducerContext,
    player_id: u32,
    attack_type: &AttackType,
    id_within_burst: u32,
    parameter_u: u32,
    _parameter_i: i32,
    num_projectiles: u32,
) -> DbVector2 {
    // Get player entity from collision cache
    let cache = crate::monsters_def::get_collision_cache();
    let player_cache_idx = match cache.player.player_id_to_cache_index.get(&player_id) {
        Some(&idx) => idx as usize,
        None => {
            log::error!("Player {} not found in collision cache for attack direction", player_id);
            return DbVector2::new(1.0, 0.0); // Fallback direction
        }
    };
    let player_pos = DbVector2::new(cache.player.pos_x_player[player_cache_idx], cache.player.pos_y_player[player_cache_idx]);
    
    // Since dir_x and dir_y don't exist in the cache, we'll use a fallback direction
    // or calculate direction based on player's last movement or target
    let player_dir = DbVector2::new(1.0, 0.0); // Default direction (right)

    match attack_type {
        AttackType::Sword | AttackType::Joint => {
            // Sword and Joint attacks target the nearest enemy for better kiting
            if let Some(nearest_enemy_pos) = find_nearest_enemy(ctx, player_pos, player_id) {
                let dir = (nearest_enemy_pos - player_pos).normalize();
                if dir.length_sq() > 0.0 {
                    return dir;
                }
            }
            
            // If no enemies, fall back to alternating left/right pattern
            let count_param = parameter_u + id_within_burst;
            if count_param % 2 == 0 {
                DbVector2::new(1.0, 0.0)
            } else {
                DbVector2::new(-1.0, 0.0)
            }
        }
        AttackType::Wand | AttackType::Football => {
            // Wands and Footballs shoot at the nearest enemy
            if let Some(nearest_enemy_pos) = find_nearest_enemy(ctx, player_pos, player_id) {
                let dir = (nearest_enemy_pos - player_pos).normalize();
                if dir.length_sq() > 0.0 {
                    return dir;
                }
            }
            
            // If no enemies or calculation issue, use player's direction
            get_normalized_direction(player_dir)
        }
        AttackType::Knives => {
            // Knives attack in a circle around the player starting at the angle specified in parameter_u
            let start_angle = parameter_u as f64 * PI / 180.0;
            let angle_step = 360.0 / num_projectiles as f64;
            let attack_angle = start_angle + (angle_step * id_within_burst as f64);
            DbVector2::new(attack_angle.cos() as f32, attack_angle.sin() as f32)
        }
        AttackType::Cards => {
            // Find the nearest enemy for card targeting
            if let Some(nearest_enemy_pos) = find_nearest_enemy(ctx, player_pos, player_id) {
                let base_dir = (nearest_enemy_pos - player_pos).normalize();
                if base_dir.length_sq() > 0.0 {
                    // For multiple cards, spread them in a fan pattern toward the enemy
                    let fan_angle_range = 45.0; // degrees total spread
                    
                    let fan_angle = if num_projectiles > 1 {
                        -fan_angle_range / 2.0 + (fan_angle_range * id_within_burst as f64 / (num_projectiles - 1) as f64)
                    } else {
                        0.0
                    };
                    
                    let fan_angle_rad = fan_angle * PI / 180.0;
                    
                    // Rotate the base vector by the fan angle
                    let rotated_x = base_dir.x as f64 * fan_angle_rad.cos() - base_dir.y as f64 * fan_angle_rad.sin();
                    let rotated_y = base_dir.x as f64 * fan_angle_rad.sin() + base_dir.y as f64 * fan_angle_rad.cos();
                    
                    return DbVector2::new(rotated_x as f32, rotated_y as f32);
                }
            }
            
            // If no enemies found, fall back to the circular pattern like knives
            let start_angle = parameter_u as f64 * PI / 180.0;
            let angle_step = 360.0 / num_projectiles as f64;
            let attack_angle = start_angle + (angle_step * id_within_burst as f64);
            DbVector2::new(attack_angle.cos() as f32, attack_angle.sin() as f32)
        }
        AttackType::Dumbbell => {
            // Dumbbells start with a strong upward motion
            let mut rng = ctx.rng();
            let y_offset = -4.0;
            let x_offset = (rng.gen::<f64>() - 0.5) * 1.0; // gen::<f64>() returns num in [0.0, 1.0)
            DbVector2::new(x_offset as f32, y_offset as f32).normalize()
        }
        AttackType::Shield | AttackType::Garlic => {
            // These attacks have special movement, not a fixed direction
            DbVector2::new(0.0, 0.0)
        }
        AttackType::ThunderHorn => {
            // Direction is not used for placement, but can be used for graphics
            if let Some(nearest_enemy_pos) = find_nearest_enemy(ctx, player_pos, player_id) {
                let dir = (nearest_enemy_pos - player_pos).normalize();
                if dir.length_sq() > 0.0 {
                    return dir;
                }
            }
            get_normalized_direction(player_dir)
        }
        AttackType::AngelStaff => {
            // No direction needed for area effect
            DbVector2::new(0.0, 0.0)
        }
        AttackType::Volleyball => {
            // Volleyballs shoot at the nearest enemy
            if let Some(nearest_enemy_pos) = find_nearest_enemy(ctx, player_pos, player_id) {
                let dir = (nearest_enemy_pos - player_pos).normalize();
                if dir.length_sq() > 0.0 {
                    return dir;
                }
            }
            // If no enemies or calculation issue, use player's direction
            get_normalized_direction(player_dir)
        }
    }
}

// Find the nearest enemy to a given position
pub fn find_nearest_enemy(ctx: &ReducerContext, position: DbVector2, player_id: u32) -> Option<DbVector2> {
    let mut nearest_enemy: Option<DbVector2> = None;
    let mut nearest_distance_squared = f32::MAX;

    // Iterate through all monsters in the game
    // TODO: can we use the spatial hash to speed this up?
    for boid in ctx.db.monsters_boid().iter() {
        // Calculate squared distance (more efficient than using square root)
        let dx = boid.position.x - position.x;
        let dy = boid.position.y - position.y;
        let distance_squared = dx * dx + dy * dy;

        // Check if this monster is closer than the current nearest
        if distance_squared < nearest_distance_squared {
            nearest_distance_squared = distance_squared;
            nearest_enemy = Some(boid.position);
        }
    }

    nearest_enemy
}

// Find the nearest enemy to a given position and return its entity ID
pub fn find_nearest_enemy_entity_id(ctx: &ReducerContext, position: DbVector2, _player_id: u32) -> Option<u32> {
    let mut nearest_enemy_id: Option<u32> = None;
    let mut min_dist_sq = f32::MAX;

    // Iterate over all monsters in the boid cache
    for boid in ctx.db.monsters_boid().iter() {
        // Skip monsters that are owned by the player (removed owner_id check since field doesn't exist)
        
        let dist_sq = (boid.position.x - position.x).powi(2) + (boid.position.y - position.y).powi(2);
        if dist_sq < min_dist_sq {
            min_dist_sq = dist_sq;
            nearest_enemy_id = Some(boid.monster_id);
        }
    }
    
    // Also check non-boid monsters
    for monster in ctx.db.monsters().iter() {
        // Skip monsters that are owned by the player (removed owner_id check since field doesn't exist)
        
        // Get monster position from boid data
        if let Some(boid) = ctx.db.monsters_boid().monster_id().find(&monster.monster_id) {
            let dist_sq = (boid.position.x - position.x).powi(2) + (boid.position.y - position.y).powi(2);
            if dist_sq < min_dist_sq {
                min_dist_sq = dist_sq;
                nearest_enemy_id = Some(monster.monster_id);
            }
        }
    }

    nearest_enemy_id
}

// Find a random enemy within a certain radius
pub fn find_random_target_in_radius(ctx: &ReducerContext, attacker_position: DbVector2, _attacker_player_id: u32, max_radius: f32) -> Option<DbVector2> {
    let mut targets_in_range: Vec<DbVector2> = Vec::new();
    let max_radius_squared = max_radius * max_radius;

    // Check all monsters within radius
    for boid in ctx.db.monsters_boid().iter() {
        let dx = boid.position.x - attacker_position.x;
        let dy = boid.position.y - attacker_position.y;
        let distance_squared = dx * dx + dy * dy;

        if distance_squared <= max_radius_squared {
            targets_in_range.push(boid.position);
        }
    }

    // Choose a random target from the list
    let mut rng = ctx.rng();
    if targets_in_range.is_empty() {
        return None;
    }
    let random_index = rng.gen_range(0..targets_in_range.len());
    Some(targets_in_range[random_index])
}

// Helper function to get a normalized direction vector, handling the zero-vector case
pub fn get_normalized_direction(direction: DbVector2) -> DbVector2 {
    if direction.x == 0.0 && direction.y == 0.0 {
        // If direction is zero, default to a standard direction (e.g., right)
        DbVector2::new(1.0, 0.0)
    } else {
        direction.normalize()
    }
}