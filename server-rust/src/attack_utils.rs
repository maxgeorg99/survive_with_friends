use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, rand::Rng};
use crate::{AttackType, DbVector2};

// Utility functions for attack-related helper functions
pub struct AttackUtils;

impl AttackUtils {
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
                // Random angle on a circle
                let mut rng = ctx.rng();
                let angle = rng.gen_range(0.0..360.0);
                angle as u32
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
        attack_type: AttackType,
        id_within_burst: u32,
        parameter_u: u32,
        parameter_i: i32,
    ) -> DbVector2 {
        // Get the player
        let player = ctx.db.player().player_id().find(&player_id)
            .expect(&format!("DetermineAttackDirection: Player {} not found", player_id));

        // TODO: This will use the real FindAttackDataByType when attacks system is ported
        let attack_data = Self::find_attack_data_by_type_placeholder(ctx, &attack_type)
            .expect(&format!("DetermineAttackDirection: Attack data not found for type {:?}", attack_type));

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
                // Wands shoot at the nearest enemy
                // TODO: can we use the spatial hash to speed this up?
                if let Some(nearest_enemy) = Self::find_nearest_enemy(ctx, player.position) {
                    // Calculate direction vector to the enemy
                    let dx = nearest_enemy.position.x - player.position.x;
                    let dy = nearest_enemy.position.y - player.position.y;
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
                let start_angle = (parameter_u as f64) * std::f64::consts::PI / 180.0;
                let angle_step = 360.0 / (attack_data.projectiles as f64);
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
        // TODO: This will use the real monsters_boid table when monsters system is ported
        // For now, return None as placeholder
        None
        
        /* 
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
        */
    }

    // TODO: Placeholder for FindAttackDataByType - will be implemented when attack system is ported
    fn find_attack_data_by_type_placeholder(_ctx: &ReducerContext, attack_type: &AttackType) -> Option<AttackData> {
        // Placeholder implementation with default values
        match attack_type {
            AttackType::Knives => Some(AttackData { projectiles: 5 }),
            AttackType::Shield => Some(AttackData { projectiles: 2 }),
            _ => Some(AttackData { projectiles: 1 }),
        }
    }
} 