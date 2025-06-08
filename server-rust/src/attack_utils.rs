use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, rand::Rng};
use crate::{AttackType, DbVector2, PlayerScheduledAttack, MonsterBoid, attacks_def::find_attack_data_by_type, monsters_boid, player};
use std::f64::consts::PI;

// Helper function to get parameter_u for an attack
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
    parameter_i: i32,
    projectiles: u32, // Use the upgraded projectiles count instead of base attack data
) -> DbVector2 {
    // Get the player
    let player = ctx.db.player().player_id().find(&player_id)
        .expect(&format!("DetermineAttackDirection: Player {} not found", player_id));

    // Handle different attack types
    match attack_type {
        AttackType::Sword => {
            // Sword attacks swing Right then Left
            let count_param = parameter_u + id_within_burst;
            if count_param % 2 == 0 {
                DbVector2::new(1.0, 0.0)
            } else {
                DbVector2::new(-1.0, 0.0)
            }
        }
        AttackType::Wand => {
            // Wands shoot at the nearest enemy (monster or player)
            if let Some(target_position) = find_nearest_target(ctx, player.position, player_id) {
                // Calculate direction vector to the target
                let dx = target_position.x - player.position.x;
                let dy = target_position.y - player.position.y;
                DbVector2::new(dx, dy).normalize()
            } else {
                // If no target, use player's direction
                let waypoint = player.waypoint;
                let wdx = waypoint.x - player.position.x;
                let wdy = waypoint.y - player.position.y;
                DbVector2::new(wdx, wdy).normalize()
            }
        }
        AttackType::Knives => {
            // Knives attack in a circle around the player starting at the angle specified in the parameter_u
            // The angle is in degrees, so we need to convert it to radians
            // Use the upgraded projectiles count for proper spacing
            let start_angle = (parameter_u as f64) * PI / 180.0;
            let angle_step = 360.0 / (projectiles as f64) * PI / 180.0;
            let attack_angle = start_angle + (angle_step * (id_within_burst as f64));
            DbVector2::new(attack_angle.cos() as f32, attack_angle.sin() as f32)
        }
        AttackType::Shield => {
            // Shield attacks have rotation motion
            DbVector2::new(0.0, 0.0)
        }
    }
}

// Find the nearest enemy to a player entity
pub fn find_nearest_enemy(ctx: &ReducerContext, position: DbVector2) -> Option<MonsterBoid> {
    let mut nearest_enemy: Option<MonsterBoid> = None;
    let mut nearest_distance_squared = f32::MAX;

    // Iterate through all monsters in the game
    // TODO: can we use the spatial hash to speed this up?
    for boid in ctx.db.monsters_boid().iter() {
        // Calculate squared distance (more efficient than using square root)
        let dx = boid.position.x - position.x;
        let dy = boid.position.y - position.y;
        let distance_squared = dx * dx + dy * dy;

        // If this monster is closer than the current nearest, update nearest
        if distance_squared < nearest_distance_squared {
            nearest_distance_squared = distance_squared;
            nearest_enemy = Some(boid);
        }
    }

    nearest_enemy
}

// Find the nearest target (monster or player) to attack - used for Wand targeting
pub fn find_nearest_target(ctx: &ReducerContext, attacker_position: DbVector2, attacker_player_id: u32) -> Option<DbVector2> {
    let mut nearest_target_position: Option<DbVector2> = None;
    let mut nearest_distance_squared = f32::MAX;

    // Check all monsters
    for boid in ctx.db.monsters_boid().iter() {
        let dx = boid.position.x - attacker_position.x;
        let dy = boid.position.y - attacker_position.y;
        let distance_squared = dx * dx + dy * dy;

        if distance_squared < nearest_distance_squared {
            nearest_distance_squared = distance_squared;
            nearest_target_position = Some(boid.position);
        }
    }

    // Get the collision cache to access cached player data
    let cache = crate::monsters_def::get_collision_cache();
    
    // Get the attacking player's PvP status from cache
    let attacker_pvp_enabled = if let Some(&cache_idx) = cache.player.player_id_to_cache_index.get(&attacker_player_id) {
        cache.player.pvp_player[cache_idx as usize]
    } else {
        false // Default to false if player not found in cache
    };

    // Check all other cached players (excluding the attacker) - only if attacking player has PvP enabled
    if attacker_pvp_enabled {
        for pid in 0..cache.player.cached_count_players as usize {
            let player_id = cache.player.keys_player[pid];
            
            // Skip the attacking player
            if player_id == attacker_player_id {
                continue;
            }
            
            // PvP-enabled players can target any other player (regardless of target's PvP status)

            let player_x = cache.player.pos_x_player[pid];
            let player_y = cache.player.pos_y_player[pid];
            let dx = player_x - attacker_position.x;
            let dy = player_y - attacker_position.y;
            let distance_squared = dx * dx + dy * dy;

            if distance_squared < nearest_distance_squared {
                nearest_distance_squared = distance_squared;
                nearest_target_position = Some(DbVector2::new(player_x, player_y));
            }
        }
    }

    nearest_target_position
} 