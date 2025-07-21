use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType};
use crate::{DbVector2, AttackType, Entity, DELTA_TIME, get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, entity, monster_damage, monsters_boid};
use crate::player_def::player;
use crate::monsters_def::monsters;
use std::f64::consts::PI;
use std::time::Duration;

// Attack data table - stores the base data for various attacks
#[table(name = attack_data, public)]
pub struct AttackData {
    #[primary_key]
    pub attack_id: u32,
    
    #[unique]
    pub attack_type: AttackType,
    pub name: String,
    pub cooldown: u32,         // Time between server-scheduled attacks
    pub duration: u32,         // Duration in milliseconds that attack lasts
    pub projectiles: u32,      // Number of projectiles in a single burst
    pub fire_delay: u32,       // Delay in milliseconds between shots in a burst
    pub speed: f32,            // Movement speed of projectiles
    pub piercing: bool,        // Whether projectiles pierce through enemies
    pub radius: f32,           // Radius of attack/projectile
    pub damage: u32,           // Base damage of the attack
    pub armor_piercing: u32,   // Amount of enemy armor ignored
}

// Attack burst cooldowns - scheduled table for delays between shots in a burst
#[table(name = attack_burst_cooldowns, scheduled(handle_attack_burst_cooldown), public)]
pub struct AttackBurstCooldown {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub player_id: u32,        // The player who owns this attack
    pub attack_type: AttackType, // The type of attack
    pub remaining_shots: u32,   // How many shots remain in the burst
    pub parameter_u: u32,      // Additional parameter for the attack
    pub parameter_i: i32,      // Additional parameter for the attack
    pub scheduled_at: ScheduleAt, // When the next shot should fire
}

// Active attacks - tracks currently active attacks in the game
// entity_id here refers to the projectile entity, not the player entity
#[table(name = active_attacks, public)]
pub struct ActiveAttack {
    #[primary_key]
    #[auto_inc]
    pub active_attack_id: u32,
    
    pub entity_id: u32,        // The projectile entity ID
    #[index(btree)]
    pub player_id: u32,        // The player who created this attack
    pub attack_type: AttackType, // The type of attack
    pub id_within_burst: u32,   // Position within a burst (0-based index)
    pub parameter_u: u32,       // Parameter used for special attacks
    pub ticks_elapsed: u32,    // Number of ticks since the attack was created
    pub damage: u32,           // Damage of this specific attack instance
    pub radius: f32,           // Radius of this attack (for area effects)
    pub piercing: bool,        // Whether this attack pierces through enemies
}

// Scheduled cleanup of active attacks
#[table(name = active_attack_cleanup, scheduled(cleanup_active_attack), public)]
pub struct ActiveAttackCleanup {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,

    pub scheduled_at: ScheduleAt, // When to cleanup the active attack

    #[index(btree)]
    pub active_attack_id: u32, // The active attack to cleanup
}

#[table(name = player_scheduled_attacks, scheduled(server_trigger_attack), public)]
pub struct PlayerScheduledAttack {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub player_id: u32,        // The player who will perform this attack
    
    pub attack_type: AttackType, // The type of attack
    
    pub skill_level: u32,      // The skill level for this attack
    pub parameter_u: u32,      // Additional parameter for the attack
    pub parameter_i: i32,      // Additional parameter for the attack
    pub attack_count: u32,     // Number of times this attack has triggered (for consistent rotation)
    
    // Combat stats copied from AttackData but can be modified by upgrades
    pub cooldown: u32,         // Time between attacks in milliseconds (can be modified by upgrades)
    pub duration: u32,         // Duration in milliseconds that attack lasts
    pub projectiles: u32,      // Number of projectiles in a single burst
    pub fire_delay: u32,       // Delay in milliseconds between shots in a burst
    pub speed: f32,            // Movement speed of projectiles
    pub piercing: bool,        // Whether projectiles pierce through enemies
    pub radius: f32,           // Radius of attack/projectile
    pub damage: u32,           // Base damage of the attack
    pub armor_piercing: u32,   // Amount of enemy armor ignored
    
    pub scheduled_at: ScheduleAt, // When to trigger the attack
}

// Initialization of attack data
#[reducer]
pub fn init_attack_data(ctx: &ReducerContext) {
    // Only run if attack data table is empty
    if ctx.db.attack_data().count() > 0 {
        return;
    }

    log::info!("Initializing attack data...");

    // Sword - melee attack
    ctx.db.attack_data().insert(AttackData {
        attack_id: 1,
        attack_type: AttackType::Sword,
        name: "Sword Slash".to_string(),
        cooldown: 600,          
        duration: 340,          
        projectiles: 1,          
        fire_delay: 50,          
        speed: 800.0,              
        piercing: true,         
        radius: 32.0,             
        damage: 3,
        armor_piercing: 0,       
    });

    // Wand - magic projectile
    ctx.db.attack_data().insert(AttackData {
        attack_id: 2,
        attack_type: AttackType::Wand,
        name: "Magic Bolt".to_string(),
        cooldown: 400,           
        duration: 390,         
        projectiles: 1,          
        fire_delay: 20,          
        speed: 800.0,                
        piercing: false,         
        radius: 20.0,              
        damage: 2,              
        armor_piercing: 10,       
    });

    // Knives - multiple projectiles in burst
    ctx.db.attack_data().insert(AttackData {
        attack_id: 3,
        attack_type: AttackType::Knives,
        name: "Throwing Knives".to_string(),
        cooldown: 500,          
        duration: 490,
        projectiles: 5,          
        fire_delay: 0,           
        speed: 1000.0,               
        piercing: true,       
        radius: 15.0,              
        damage: 1,              
        armor_piercing: 0,       
    });

    // Shield - defensive area attack
    ctx.db.attack_data().insert(AttackData {
        attack_id: 4,
        attack_type: AttackType::Shield,
        name: "Shield Bash".to_string(),
        cooldown: 5000,          
        duration: 4250,         
        projectiles: 2,          
        fire_delay: 0,           
        speed: 200.0,              
        piercing: true,         
        radius: 32.0,             
        damage: 4,             
        armor_piercing: 10,       
    });

    // Thunder Horn - long range instant strike
    ctx.db.attack_data().insert(AttackData {
        attack_id: 5,
        attack_type: AttackType::ThunderHorn,
        name: "Thunder Horn".to_string(),
        cooldown: 3000,          // Long cooldown (3 seconds)
        duration: 200,           // Very short duration (0.2 seconds)
        projectiles: 1,          // Single target initially
        fire_delay: 0,           // Instant burst
        speed: 0.0,              // 0 speed - instant strike at target location
        piercing: true,         // Does not pierce
        radius: 48.0,            // Moderate radius
        damage: 15,               // Big damage
        armor_piercing: 15,      // Good armor penetration
    });

    // Angel Staff - instant area damage
    ctx.db.attack_data().insert(AttackData {
        attack_id: 6,
        attack_type: AttackType::AngelStaff,
        name: "Angel Staff".to_string(),
        cooldown: 300,           // Fast cooldown (0.8 seconds)
        duration: 100,           // Very short duration (0.1 seconds) - just for VFX
        projectiles: 1,          // Single cast
        fire_delay: 0,           // Instant
        speed: 0.0,              // 0 speed - instant area effect
        piercing: true,          // Hits all enemies in radius
        radius: 196.0,           // Large radius
        damage: 1,               // Low damage
        armor_piercing: 5,       // Some armor penetration
    });

    // Football - projectile with knockback
    ctx.db.attack_data().insert(AttackData {
        attack_id: 7,
        attack_type: AttackType::Football,
        name: "Football Shot".to_string(),
        cooldown: 800,
        duration: 2500,
        projectiles: 1,
        fire_delay: 200,
        speed: 600.0,
        piercing: false,
        radius: 24.0,
        damage: 2,
        armor_piercing: 2,
    });

    // Cards - spread attack
    ctx.db.attack_data().insert(AttackData {
        attack_id: 8,
        attack_type: AttackType::Cards,
        name: "Card Throw".to_string(),
        cooldown: 600,
        duration: 800,
        projectiles: 3,
        fire_delay: 50,
        speed: 700.0,
        piercing: false,
        radius: 16.0,
        damage: 1,
        armor_piercing: 2,
    });

    // Dumbbell - falling aerial attack
    ctx.db.attack_data().insert(AttackData {
        attack_id: 9,
        attack_type: AttackType::Dumbbell,
        name: "Dumbbell Drop".to_string(),
        cooldown: 1200,
        duration: 1000,
        projectiles: 1,
        fire_delay: 200,
        speed: 800.0,
        piercing: true,
        radius: 40.0,
        damage: 8,
        armor_piercing: 4,
    });

    // Garlic - aura attack
    ctx.db.attack_data().insert(AttackData {
        attack_id: 10,
        attack_type: AttackType::Garlic,
        name: "Garlic".to_string(),
        cooldown: 400,
        duration: 100,
        projectiles: 1,
        fire_delay: 0,
        speed: 0.0,
        piercing: true,
        radius: 100.0,
        damage: 1,
        armor_piercing: 1,
    });

    // Volleyball - bouncing projectile
    ctx.db.attack_data().insert(AttackData {
        attack_id: 11,
        attack_type: AttackType::Volleyball,
        name: "Volleyball Smash".to_string(),
        cooldown: 1200,
        duration: 800,
        projectiles: 1,
        fire_delay: 0,
        speed: 700.0,
        piercing: true,
        radius: 35.0,
        damage: 2,
        armor_piercing: 2,
    });

    // Joint - simple melee attack
    ctx.db.attack_data().insert(AttackData {
        attack_id: 12,
        attack_type: AttackType::Joint,
        name: "Joint".to_string(),
        cooldown: 800,
        duration: 600,
        projectiles: 1,
        fire_delay: 100,
        speed: 600.0,
        piercing: false,
        radius: 16.0,
        damage: 3,
        armor_piercing: 1,
    });

    log::info!("Attack data initialized successfully.");
}

// Helper method to find attack data by attack type
pub fn find_attack_data_by_type(ctx: &ReducerContext, attack_type: &AttackType) -> Option<AttackData> {
    for attack_data in ctx.db.attack_data().iter() {
        if attack_data.attack_type == *attack_type {
            return Some(attack_data);
        }
    }
    None
}

// Helper method to trigger a single projectile of an attack
fn trigger_attack_projectile(ctx: &ReducerContext, player_id: u32, attack_type: AttackType, id_within_burst: u32, parameter_u: u32, parameter_i: i32) {
    // Get player's scheduled attack to use actual stats (which may have been upgraded)
    let mut scheduled_attack: Option<PlayerScheduledAttack> = None;
    for attack in ctx.db.player_scheduled_attacks().player_id().filter(&player_id) {
        if attack.attack_type == attack_type {
            scheduled_attack = Some(attack);
            break;
        }
    }
    
    let scheduled_attack = match scheduled_attack {
        Some(attack) => attack,
        None => {
            log::error!("Scheduled attack not found for player {}, attack type {:?}", player_id, attack_type);
            return;
        }
    };

    // Get player data directly from database (reused for entity lookup and PvP status)
    let player_data = match ctx.db.player().player_id().find(&player_id) {
        Some(player) => player,
        None => {
            log::error!("Player {} not found in database", player_id);
            return;
        }
    };
    
    let player_x = player_data.position.x;
    let player_y = player_data.position.y;
    
    // Special handling for Angel Staff - instant area damage without projectiles
    if attack_type == AttackType::AngelStaff {
        // Apply instant damage to all monsters within radius
        let player_position = player_data.position;
        let damage_radius_squared = scheduled_attack.radius * scheduled_attack.radius;
        
        // Create a temporary visual effect entity for the client to display
        let visual_entity = ctx.db.entity().insert(Entity {
            entity_id: 0,
            position: player_position,
            direction: DbVector2::new(0.0, 0.0), // No direction needed for area effect
            radius: scheduled_attack.radius,
            waypoint: DbVector2::new(0.0, 0.0),
            has_waypoint: false,
        });

        // Create a temporary active attack for visual effects only
        let active_attack = ctx.db.active_attacks().insert(ActiveAttack {
            active_attack_id: 0,
            entity_id: visual_entity.entity_id,
            player_id,
            attack_type: attack_type.clone(),
            id_within_burst,
            parameter_u,
            ticks_elapsed: 0,
            damage: 0,
            radius: scheduled_attack.radius,
            piercing: scheduled_attack.piercing,
        });

        // Schedule cleanup of the visual effect
        ctx.db.active_attack_cleanup().insert(ActiveAttackCleanup {
            scheduled_id: 0,
            active_attack_id: active_attack.active_attack_id,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(scheduled_attack.duration as u64)),
        });

        // Apply damage to other players if PvP is enabled
        let attacker_pvp_enabled = player_data.pvp;
        if attacker_pvp_enabled {
            for target_player in ctx.db.player().iter() {
                // Skip self
                if target_player.player_id == player_id {
                    continue;
                }
                
                let target_position = target_player.position;
                
                // Calculate distance squared
                let dx = player_position.x - target_position.x;
                let dy = player_position.y - target_position.y;
                let distance_squared = dx * dx + dy * dy;
                
                // If target is within damage radius, apply damage
                if distance_squared <= damage_radius_squared {
                    crate::core_game::damage_player(ctx, target_player.player_id, scheduled_attack.damage as f32);
                }
            }
        }

        //Evaluate last in case the boss is dying!
        for monster in ctx.db.monsters().iter() {
            // Get monster position from boid data, fallback to spawn position
            let monster_position = if let Some(boid) = ctx.db.monsters_boid().monster_id().find(&monster.monster_id) {
                boid.position
            } else {
                monster.spawn_position
            };
            
            // Calculate distance squared
            let dx = player_position.x - monster_position.x;
            let dy = player_position.y - monster_position.y;
            let distance_squared = dx * dx + dy * dy;
            
            // If monster is within damage radius, apply damage
            if distance_squared <= damage_radius_squared {
                let boss_defeated = crate::core_game::damage_monster(ctx, monster.monster_id, scheduled_attack.damage);
                if boss_defeated {
                    log::info!("Boss defeated by angel staff");
                    return;
                }
            }
        }
        
        return; // Early return - don't create normal projectile
    }
    
    // Get attack direction using AttackUtils, passing the upgraded projectiles count
    let direction = crate::attack_utils::determine_attack_direction(ctx, player_id, &attack_type, id_within_burst, parameter_u, parameter_i, scheduled_attack.projectiles);
    
    // Special handling for Thunder Horn - place projectile directly at target location
    let (projectile_position, final_direction) = if attack_type == AttackType::ThunderHorn {
        // For Thunder Horn, find target and place attack there instantly
        if let Some(target_position) = crate::attack_utils::find_random_target_in_radius(ctx, DbVector2::new(player_x, player_y), player_id, crate::attack_utils::THUNDER_HORN_TARGET_RADIUS) {
            (target_position, direction)
        } else {
            // If no target, place at player position
            (DbVector2::new(player_x, player_y), direction)
        }
    } else {
        // For all other attacks, start at player position
        (DbVector2::new(player_x, player_y), direction)
    };
    
    // Create a new entity for the projectile and get its ID
    let projectile_entity = ctx.db.entity().insert(Entity {
        entity_id: 0,
        position: projectile_position,
        direction: final_direction,
        radius: scheduled_attack.radius,
        waypoint: DbVector2::new(0.0, 0.0),
        has_waypoint: false,
    });

    // Create active attack (represents visible/active projectile or area attack)
    let active_attack = ctx.db.active_attacks().insert(ActiveAttack {
        active_attack_id: 0,
        entity_id: projectile_entity.entity_id,
        player_id,           // The player who created the attack
        attack_type: attack_type.clone(),
        id_within_burst,
        parameter_u,
        ticks_elapsed: 0,
        damage: scheduled_attack.damage,
        radius: scheduled_attack.radius,
        piercing: scheduled_attack.piercing,
    });

    // Schedule cleanup of the active attack
    let duration = scheduled_attack.duration;
    ctx.db.active_attack_cleanup().insert(ActiveAttackCleanup {
        scheduled_id: 0,
        active_attack_id: active_attack.active_attack_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(duration as u64)),
    });
}

// Handler for attack burst cooldown expiration
#[reducer]
pub fn handle_attack_burst_cooldown(ctx: &ReducerContext, burst_cooldown: AttackBurstCooldown) {
    if ctx.sender != ctx.identity() {
        panic!("HandleAttackBurstCooldown may not be invoked by clients, only via scheduling.");
    }

    // Find the player's scheduled attack for this attack type
    let mut scheduled_attack: Option<PlayerScheduledAttack> = None;
    for attack in ctx.db.player_scheduled_attacks().player_id().filter(&burst_cooldown.player_id) {
        if attack.attack_type == burst_cooldown.attack_type {
            scheduled_attack = Some(attack);
            break;
        }
    }
    
    let scheduled_attack = match scheduled_attack {
        Some(attack) => attack,
        None => {
            log::error!("Scheduled attack not found for player {}, attack type {:?}", burst_cooldown.player_id, burst_cooldown.attack_type.clone());
            return;
        }
    };

    // Calculate the id_within_burst based on attack data and remaining shots
    let attack_data = find_attack_data_by_type(ctx, &burst_cooldown.attack_type);
    if attack_data.is_none() {
        log::error!("Attack data not found for type {:?}", burst_cooldown.attack_type.clone());
        return;
    }

    if burst_cooldown.remaining_shots == 0 {
        log::error!("Remaining shots is 0 for player {}, attack type {:?}", burst_cooldown.player_id, burst_cooldown.attack_type.clone());
        return;
    }
    
    let total_projectiles = scheduled_attack.projectiles;
    let current_projectile_index = total_projectiles - burst_cooldown.remaining_shots;

    // Create the next projectile in the burst with the correct id_within_burst
    trigger_attack_projectile(ctx, burst_cooldown.player_id, burst_cooldown.attack_type.clone(), current_projectile_index, burst_cooldown.parameter_u, burst_cooldown.parameter_i);

    // If there are more shots remaining in the burst, schedule the next one
    let remaining_shots = burst_cooldown.remaining_shots - 1;
    if remaining_shots > 0 {
        // update the scheduled_at to the next shot
        // If there are more projectiles and fire_delay > 0, schedule the next
        ctx.db.attack_burst_cooldowns().insert(AttackBurstCooldown {
            scheduled_id: 0,
            player_id: burst_cooldown.player_id,
            attack_type: burst_cooldown.attack_type,
            remaining_shots,
            parameter_u: burst_cooldown.parameter_u,
            parameter_i: burst_cooldown.parameter_i,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(scheduled_attack.fire_delay as u64)),
        });
    }
}

// Server authoritative attack trigger, called by scheduler
#[reducer]
pub fn server_trigger_attack(ctx: &ReducerContext, mut attack: PlayerScheduledAttack) {
    if ctx.sender != ctx.identity() {
        panic!("ServerTriggerAttack may not be invoked by clients, only via scheduling.");
    }
    
    // Get player ID directly from the attack
    let player_id = attack.player_id;
    
    // Check if this attack type exists
    let attack_data = find_attack_data_by_type(ctx, &attack.attack_type);
    if attack_data.is_none() {
        log::error!("Attack type {:?} not found when triggering attack", attack.attack_type.clone());
        return;
    }

    // Increment attack count for consistent rotation patterns
    attack.attack_count += 1;

    // Update the parameters for the attack
    let parameter_u = crate::attack_utils::get_parameter_u(ctx, &attack);
    attack.parameter_u = parameter_u;
    
    // Handle case where we have multiple projectiles
    if attack.projectiles > 1 {
        if attack.fire_delay == 0 {
            // If fire_delay is 0, spawn all projectiles at once
            for i in 0..attack.projectiles {
                trigger_attack_projectile(ctx, player_id, attack.attack_type.clone(), i, attack.parameter_u, attack.parameter_i);
            }
        } else {
            // Fire first projectile with id_within_burst = 0
            trigger_attack_projectile(ctx, player_id, attack.attack_type.clone(), 0, attack.parameter_u, attack.parameter_i);

            // If there are more projectiles and fire_delay > 0, schedule the rest
            ctx.db.attack_burst_cooldowns().insert(AttackBurstCooldown {
                scheduled_id: 0,
                player_id,
                attack_type: attack.attack_type.clone(),
                remaining_shots: attack.projectiles - 1,
                parameter_u: attack.parameter_u,
                parameter_i: attack.parameter_i,
                scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(attack.fire_delay as u64)),
            });
        }
    } else {
        // Single projectile case - just trigger it with id_within_burst = 0
        trigger_attack_projectile(ctx, player_id, attack.attack_type.clone(), 0, attack.parameter_u, attack.parameter_i);
    }

    // Update the scheduled attack in the database (if it still exists)
    if ctx.db.player_scheduled_attacks().scheduled_id().find(&attack.scheduled_id).is_some() {
        ctx.db.player_scheduled_attacks().scheduled_id().update(attack);
    }
}

// Helper method to schedule attacks for a player
// Call this when player spawns or acquires a new attack type
pub fn schedule_new_player_attack(ctx: &ReducerContext, player_id: u32, attack_type: AttackType, skill_level: u32) {
    let attack_data = find_attack_data_by_type(ctx, &attack_type);
    let attack_data = match attack_data {
        Some(data) => data,
        None => {
            log::error!("Attack type {:?} not found when scheduling initial attacks", attack_type.clone());
            return;
        }
    };

    // Schedule the first attack with all properties copied from base attack data
    ctx.db.player_scheduled_attacks().insert(PlayerScheduledAttack {
        scheduled_id: 0,
        player_id,
        attack_type: attack_type.clone(),
        skill_level,
        parameter_u: 0,
        parameter_i: 0,
        attack_count: 0,
        cooldown: attack_data.cooldown,
        duration: attack_data.duration,
        projectiles: attack_data.projectiles,
        fire_delay: attack_data.fire_delay,
        speed: attack_data.speed,
        piercing: attack_data.piercing,
        radius: attack_data.radius,
        damage: attack_data.damage,
        armor_piercing: attack_data.armor_piercing,
        scheduled_at: ScheduleAt::Interval(Duration::from_millis(attack_data.cooldown as u64).into()),
    });
    
    log::info!("Scheduled initial attack of type {:?} for player {} with damage {}", attack_type.clone(), player_id, attack_data.damage);
}

// Cleanup active attacks
#[reducer]
pub fn cleanup_active_attack(ctx: &ReducerContext, cleanup: ActiveAttackCleanup) {
    if ctx.sender != ctx.identity() {
        panic!("CleanupActiveAttack may not be invoked by clients, only via scheduling.");
    }

    // Get the active attack to cleanup
    let active_attack_opt = ctx.db.active_attacks().active_attack_id().find(&cleanup.active_attack_id);
    let active_attack = match active_attack_opt {
        Some(attack) => attack,
        None => {
            // This isn't an error, it just means the attack has already been cleaned up
            return;
        }
    };

    // Get the entity to cleanup
    let entity_opt = ctx.db.entity().entity_id().find(&active_attack.entity_id);
    let entity = match entity_opt {
        Some(entity) => entity,
        None => {
            // This isn't an error, it just means the entity has already been cleaned up
            return;
        }
    };

    // Clean up any damage records associated with this attack
    cleanup_attack_damage_records(ctx, entity.entity_id);
    
    // Delete the entity
    ctx.db.entity().entity_id().delete(&entity.entity_id);

    // Delete the active attack
    ctx.db.active_attacks().active_attack_id().delete(&cleanup.active_attack_id);
}

// Call this from the existing Init method
pub fn initialize_attack_system(ctx: &ReducerContext) {
    init_attack_data(ctx);
}

// Helper method to process attack movements - moved from CoreGame.cs
pub fn process_attack_movements(ctx: &ReducerContext) {
    let cache = crate::monsters_def::get_collision_cache();
    cache.attack.cached_count_attacks = 0;
    
    // Process each active attack
    for active_attack in ctx.db.active_attacks().iter() {
        let mut updated_active_attack = active_attack;
        updated_active_attack.ticks_elapsed += 1; 

        // Get the attack entity
        let entity_opt = ctx.db.entity().entity_id().find(&updated_active_attack.entity_id);
        let entity = match entity_opt {
            Some(entity) => entity,
            None => continue, // Skip if entity not found
        };
        
        // Get attack data
        let attack_data_opt = find_attack_data_by_type(ctx, &updated_active_attack.attack_type);
        let attack_data = match attack_data_opt {
            Some(data) => data,
            None => continue, // Skip if attack data not found
        };

        let mut updated_entity = entity;
        
        // Handle special case for Shield attack type
        if updated_active_attack.attack_type == AttackType::Shield {
            let player_cache_idx = match cache.player.player_id_to_cache_index.get(&updated_active_attack.player_id) {
                Some(&idx) => idx as usize,
                None => continue,
            };

            // Shield orbits around the player - update its position based on time
            let shield_count = cache.player.shield_count_player[player_cache_idx];
            if shield_count == 0 {
                continue;
            }
            
            // Calculate orbit angle based on shield's offset value and current position in burst
            let rotation_speed = attack_data.speed as f64 * PI / 180.0 * DELTA_TIME as f64;
            // convert parameter_u from degrees to radians
            let parameter_angle = updated_active_attack.parameter_u as f64 * PI / 180.0;
            let base_angle = parameter_angle + (2.0 * PI * updated_active_attack.id_within_burst as f64 / shield_count as f64);
            let shield_angle = base_angle + rotation_speed * updated_active_attack.ticks_elapsed as f64;
            
            // Calculate offset distance from player center
            let player_radius = cache.player.radius_player[player_cache_idx];
            let player_x = cache.player.pos_x_player[player_cache_idx];
            let player_y = cache.player.pos_y_player[player_cache_idx];
            let offset_distance = (player_radius + updated_entity.radius) * 2.0; // Added some spacing
            
            // Calculate new position using angle
            let offset_x = shield_angle.cos() as f32 * offset_distance;
            let offset_y = shield_angle.sin() as f32 * offset_distance;
            
            // Update shield entity with new position
            updated_entity.position = DbVector2::new(
                player_x + offset_x,
                player_y + offset_y,
            );
        } else if updated_active_attack.attack_type == AttackType::ThunderHorn {
            // Thunder Horn stays at its initial position (0 speed instant strike)
            // No position updates needed - it just stays where it was placed
        } else if updated_active_attack.attack_type == AttackType::Garlic {
            // Garlic aura stays with player
            let player_cache_idx = match cache.player.player_id_to_cache_index.get(&updated_active_attack.player_id) {
                Some(&idx) => idx as usize,
                None => continue,
            };
            
            let player_x = cache.player.pos_x_player[player_cache_idx];
            let player_y = cache.player.pos_y_player[player_cache_idx];
            
            // Update garlic aura position to player position
            updated_entity.position = DbVector2::new(player_x, player_y);
            
            // Apply knockback to nearby monsters
            let garlic_radius_sq = updated_entity.radius * updated_entity.radius;
            for mid in 0..cache.monster.cached_count_monsters as usize {
                let monster_x = cache.monster.pos_x_monster[mid];
                let monster_y = cache.monster.pos_y_monster[mid];
                let monster_radius = cache.monster.radius_monster[mid];
                
                // Calculate distance to monster
                let dx = monster_x - player_x;
                let dy = monster_y - player_y;
                let distance_squared = dx * dx + dy * dy;
                let radius_sum = updated_entity.radius + monster_radius;
                
                // If monster is within garlic radius
                if distance_squared <= radius_sum * radius_sum {
                    // Calculate normalized direction for knockback
                    let distance = distance_squared.sqrt();
                    if distance > 0.0 {
                        let knockback_direction = DbVector2::new(dx / distance, dy / distance);
                        
                        // Apply knockback
                        let knockback_strength = 3.0;
                        let monster_id = cache.monster.keys_monster[mid];
                        
                        // Update monster position in boids table
                        if let Some(mut boid) = ctx.db.monsters_boid().monster_id().find(&monster_id) {
                            let knockback_pos = boid.position + (knockback_direction * knockback_strength);
                            boid.position = knockback_pos;
                            ctx.db.monsters_boid().monster_id().update(boid);
                        }
                    }
                }
            }
        } else if updated_active_attack.attack_type == AttackType::Volleyball {
            // Volleyball bouncing behavior
            let move_speed = attack_data.speed;
            let move_distance = move_speed * DELTA_TIME;
            let move_offset = updated_entity.direction * move_distance;
            
            // Max number of bounces the volleyball can perform
            const MAX_BOUNCES: u32 = 2;
            
            // Update entity with new position
            updated_entity.position = updated_entity.position + move_offset;
            
            // Apply world boundary clamping
            let world_size = crate::WORLD_SIZE as f32;
            updated_entity.position.x = updated_entity.position.x.clamp(
                updated_entity.radius, 
                world_size - updated_entity.radius
            );
            updated_entity.position.y = updated_entity.position.y.clamp(
                updated_entity.radius, 
                world_size - updated_entity.radius
            );
            
            // Check if the volleyball has reached its maximum number of bounces
            if updated_active_attack.parameter_u >= MAX_BOUNCES {
                // If reached max bounces, continue movement but don't bounce anymore
                
                // Check if hitting world boundary
                let hit_boundary = 
                    updated_entity.position.x <= updated_entity.radius ||
                    updated_entity.position.x >= world_size - updated_entity.radius ||
                    updated_entity.position.y <= updated_entity.radius ||
                    updated_entity.position.y >= world_size - updated_entity.radius;
                
                if hit_boundary {
                    // Delete attack entity and active attack record
                    ctx.db.entity().entity_id().delete(&updated_entity.entity_id);
                    ctx.db.active_attacks().active_attack_id().delete(&updated_active_attack.active_attack_id);
                    cleanup_attack_damage_records(ctx, updated_entity.entity_id);
                    continue;
                }
            } else {
                // Find a new target enemy to bounce to
                let mut best_target_pos: Option<DbVector2> = None;
                let mut best_target_distance = f32::MAX;
                
                for mid in 0..cache.monster.cached_count_monsters as usize {
                    let monster_x = cache.monster.pos_x_monster[mid];
                    let monster_y = cache.monster.pos_y_monster[mid];
                    let monster_radius = cache.monster.radius_monster[mid];
                    
                    // Skip if this monster is too close (we've just hit it)
                    let dx = monster_x - updated_entity.position.x;
                    let dy = monster_y - updated_entity.position.y;
                    let distance_squared = dx * dx + dy * dy;
                    
                    // Skip monsters that are too close (we've just hit them)
                    let min_distance = (updated_entity.radius + monster_radius) * 2.0;
                    if distance_squared < min_distance * min_distance {
                        continue;
                    }
                    
                    // Find the closest valid target
                    if distance_squared < best_target_distance {
                        best_target_distance = distance_squared;
                        best_target_pos = Some(DbVector2::new(monster_x, monster_y));
                    }
                }
                
                // If found a valid target, bounce to it
                if let Some(target_pos) = best_target_pos {
                    // Calculate direction to the new target
                    let dx = target_pos.x - updated_entity.position.x;
                    let dy = target_pos.y - updated_entity.position.y;
                    let length = (dx * dx + dy * dy).sqrt();
                    
                    if length > 0.0 {
                        // Update direction to point at the new target
                        updated_entity.direction = DbVector2::new(dx / length, dy / length);
                        
                        // Increment bounce counter
                        updated_active_attack.parameter_u += 1;
                    }
                }
            }
        } else {
            if updated_active_attack.attack_type == AttackType::Dumbbell {
                let gravity = 4.0f32; // Even lighter gravity for slower fall
                // Apply gravity to the vertical component of direction
                updated_entity.direction = DbVector2::new(
                    updated_entity.direction.x,
                    updated_entity.direction.y + (gravity * DELTA_TIME)
                );
            }
            // Regular projectile movement based on direction and speed
            let move_speed = attack_data.speed;
            
            // Calculate movement based on direction, speed and time delta
            let move_distance = move_speed * DELTA_TIME;
            let move_offset = updated_entity.direction * move_distance;
            
            // Update entity with new position
            updated_entity.position = updated_entity.position + move_offset;
            
            // Handle Football knockback on collision
            if updated_active_attack.attack_type == AttackType::Football {
                let football_radius_sq = updated_entity.radius * updated_entity.radius;
                for mid in 0..cache.monster.cached_count_monsters as usize {
                    let monster_x = cache.monster.pos_x_monster[mid];
                    let monster_y = cache.monster.pos_y_monster[mid];
                    let monster_radius = cache.monster.radius_monster[mid];
                    
                    // Calculate distance to monster
                    let dx = monster_x - updated_entity.position.x;
                    let dy = monster_y - updated_entity.position.y;
                    let distance_squared = dx * dx + dy * dy;
                    let radius_sum = updated_entity.radius + monster_radius;
                    
                    // If monster is hit by football
                    if distance_squared <= radius_sum * radius_sum {
                        // Apply knockback in the football's direction
                        let knockback_strength = 2.0;
                        let monster_id = cache.monster.keys_monster[mid];
                        
                        // Update monster position in boids table
                        if let Some(mut boid) = ctx.db.monsters_boid().monster_id().find(&monster_id) {
                            let knockback_pos = boid.position + (updated_entity.direction * knockback_strength);
                            boid.position = knockback_pos;
                            ctx.db.monsters_boid().monster_id().update(boid);
                        }
                    }
                }
            }
        }

        // Get the attacking player's PvP status from the cache
        let attacker_pvp_enabled = if let Some(&cache_idx) = cache.player.player_id_to_cache_index.get(&updated_active_attack.player_id) {
            cache.player.pvp_player[cache_idx as usize]
        } else {
            false // Default to false if player not found in cache
        };

        // Update collision cache
        let cache_idx = cache.attack.cached_count_attacks as usize;
        cache.attack.keys_attack[cache_idx] = updated_active_attack.active_attack_id;
        cache.attack.pos_x_attack[cache_idx] = updated_entity.position.x;
        cache.attack.pos_y_attack[cache_idx] = updated_entity.position.y;
        cache.attack.radius_attack[cache_idx] = updated_entity.radius;
        cache.attack.pvp_enabled_attack[cache_idx] = attacker_pvp_enabled;

        let grid_cell_key = get_world_cell_from_position(updated_entity.position.x, updated_entity.position.y);
        cache.attack.nexts_attack[cache_idx] = cache.attack.heads_attack[grid_cell_key as usize]; 
        cache.attack.heads_attack[grid_cell_key as usize] = cache_idx as i32;

        cache.attack.cached_count_attacks += 1;

        ctx.db.entity().entity_id().update(updated_entity);
        ctx.db.active_attacks().active_attack_id().update(updated_active_attack);
    }
}

// Helper method to process collisions between attacks and players using spatial hash (simplified version)
pub fn process_player_attack_collisions_spatial_hash(ctx: &ReducerContext) {
    let cache = crate::monsters_def::get_collision_cache();
    
    // Iterate through all players first (likely fewer than attacks)
    for pid in 0..cache.player.cached_count_players {
        let pid = pid as usize;
        let px = cache.player.pos_x_player[pid];
        let py = cache.player.pos_y_player[pid];
        let pr = cache.player.radius_player[pid];
        let player_id = cache.player.keys_player[pid];

        // Check against all attacks in the same spatial hash cell
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
                let mut aid = cache.attack.heads_attack[test_cell_key];
                while aid != -1 {
                    let aid_usize = aid as usize;
                    let ax = cache.attack.pos_x_attack[aid_usize];
                    let ay = cache.attack.pos_y_attack[aid_usize];
                    let ar = cache.attack.radius_attack[aid_usize];

                    if spatial_hash_collision_checker(px, py, pr, ax, ay, ar) {
                        // Get the active attack data
                        let active_attack_opt = ctx.db.active_attacks().active_attack_id().find(&cache.attack.keys_attack[aid_usize]);
                        let active_attack = match active_attack_opt {
                            Some(attack) => attack,
                            None => {
                                aid = cache.attack.nexts_attack[aid_usize];
                                continue;
                            }
                        };

                        // Skip if the player is the owner of the attack (can't hurt yourself)
                        if player_id == active_attack.player_id {
                            aid = cache.attack.nexts_attack[aid_usize];
                            continue;   
                        }
                        
                        // Check PvP settings - only allow player-vs-player damage if attacker has PvP enabled
                        let attacker_pvp_enabled = cache.attack.pvp_enabled_attack[aid_usize];
                        
                        // Skip damage if attacking player doesn't have PvP enabled
                        if !attacker_pvp_enabled {
                            aid = cache.attack.nexts_attack[aid_usize];
                            continue;
                        }
                        
                        // Apply damage to player using the active attack's damage value
                        let mut damage = active_attack.damage as f32;
                        
                        // If the attack is not piercing, remove it after hitting this player
                        if !active_attack.piercing {
                            // Reduce damage because it will hit each tick
                            damage /= 8.0;

                            // Delete the attack entity
                            ctx.db.entity().entity_id().delete(&active_attack.entity_id);
                            
                            // Delete the active attack record
                            ctx.db.active_attacks().active_attack_id().delete(&active_attack.active_attack_id);
                            
                            // Clean up any damage records for this attack
                            cleanup_attack_damage_records(ctx, active_attack.entity_id);
                        }

                        cache.player.damage_to_player[pid] += damage;
                    }

                    aid = cache.attack.nexts_attack[aid_usize];
                }
            }
        }
    }
}

// Helper function to clean up damage records associated with an attack
pub fn cleanup_attack_damage_records(ctx: &ReducerContext, entity_id: u32) {
    // Clean up any monster damage records for this attack
    let damage_records: Vec<_> = ctx.db.monster_damage().attack_entity_id().filter(&entity_id).collect();
    for damage_record in damage_records {
        ctx.db.monster_damage().damage_id().delete(&damage_record.damage_id);
    }
}