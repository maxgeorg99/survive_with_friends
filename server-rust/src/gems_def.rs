use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, SpacetimeType, rand::Rng};
use crate::{DbVector2, MAX_GEM_COUNT, WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_HEIGHT, WORLD_GRID_WIDTH,
           get_world_cell_from_position, spatial_hash_collision_checker, CollisionCache, entity, player};

// Define the gem levels (1-4)
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum GemLevel {
    Small,  // = 1
    Medium, // = 2
    Large,  // = 3
    Huge    // = 4
}

// Table for storing gem objects in the game
#[table(name = gems, public)]
pub struct Gem {
    #[primary_key]
    #[auto_inc]
    pub gem_id: u32,

    #[unique]
    pub entity_id: u32, // Associated entity for this gem

    pub level: GemLevel, // Level of the gem (1-4)
}

// Table for storing experience configuration
#[table(name = exp_config, public)]
pub struct ExpConfig {
    #[primary_key]
    pub config_id: u32, // Should always be 0 for the one global config

    // Base experience granted per gem level
    pub exp_small_gem: u32,
    pub exp_medium_gem: u32,
    pub exp_large_gem: u32,
    pub exp_huge_gem: u32,

    // Base experience required for each level
    pub base_exp_per_level: u32,
    
    // Factor for calculating experience needed for level up
    // Formula: base_exp_per_level * (level ^ level_exp_factor)
    pub level_exp_factor: f32,

    // Radius of the gem
    pub gem_radius: f32,
}

// Initialize exp configuration during module init
// This should be called from the main Init function
pub fn init_exp_system(ctx: &ReducerContext) {
    // Check if exp config already exists
    if ctx.db.exp_config().config_id().find(&0).is_some() {
        // Config already exists
        return;
    }

    // Create default exp configuration
    ctx.db.exp_config().insert(ExpConfig {
        config_id: 0,
        exp_small_gem: 10,
        exp_medium_gem: 25,
        exp_large_gem: 50,
        exp_huge_gem: 100,
        base_exp_per_level: 40,
        level_exp_factor: 1.2,
        gem_radius: 20.0,
    });

    log::info!("Experience system initialized with default configuration");
}

// Creates a gem of the specified level at the given position
pub fn create_gem(ctx: &ReducerContext, position: DbVector2, level: GemLevel) -> u32 {
    let config = ctx.db.exp_config().config_id().find(&0);
    if config.is_none() {
        log::error!("Experience system not initialized");
        return 0;
    }

    let config = config.unwrap();
    let gem_radius = config.gem_radius;

    // Create an entity for the gem
    let gem_entity_opt = ctx.db.entity().insert(crate::Entity {
        entity_id: 0,
        position,
        direction: DbVector2::new(0.0, 0.0), // Gems don't move
        is_moving: false,
        radius: gem_radius, // Fixed radius for gems
        waypoint: DbVector2::new(0.0, 0.0),
        has_waypoint: false,
    });

    let gem_entity = gem_entity_opt;

    // Create the gem and link it to the entity
    let gem_opt = ctx.db.gems().insert(Gem {
        gem_id: 0,
        entity_id: gem_entity.entity_id,
        level,
    });

    let gem = gem_opt;
    //Log::info(&format!("Created {:?} gem (ID: {}) at position {}, {}", gem.level, gem.gem_id, position.x, position.y));
    gem.gem_id
}

// Helper method to spawn a gem with a random level at the given position
pub fn spawn_random_gem(ctx: &ReducerContext, position: DbVector2) -> u32 {
    // Randomly select a gem level with weighted probabilities
    let mut rng = ctx.rng();
    let random_value = rng.gen_range(1..=100); // 1-100
    let level = if random_value <= 79 {
        GemLevel::Small
    } else if random_value <= 94 {
        GemLevel::Medium
    } else if random_value <= 99 {
        GemLevel::Large
    } else {
        GemLevel::Huge
    };

    create_gem(ctx, position, level)
}

// Spawns a gem at the position of a killed monster
pub fn spawn_gem_on_monster_death(ctx: &ReducerContext, monster_id: u32, position: DbVector2, collision_cache: &CollisionCache) {
    if collision_cache.gem.cached_count_gems >= MAX_GEM_COUNT as i32 {
        //TODO grow gems
        return;
    }

    // Get monster data to determine gem drop chance and level
    // TODO: This will use the real monsters table when monsters system is ported
    // For now, we'll use a default drop chance
    let drop_chance = 1.0; // Default 100% drop chance for now

    // Roll for gem drop
    let mut rng = ctx.rng();
    let roll = rng.gen_range(0.0..1.0);
    if roll <= drop_chance {
        spawn_random_gem(ctx, position);
        //Log::info(&format!("Monster {} dropped a gem at position {}, {}", monster_id, position.x, position.y));
    }
}

// Calculate how much exp is needed for a given level
pub fn calculate_exp_for_level(ctx: &ReducerContext, level: u32) -> u32 {
    let config = ctx.db.exp_config().config_id().find(&0);
    if config.is_none() {
        // Fallback if config not found
        return level * 100;
    }

    let config = config.unwrap();
    (config.base_exp_per_level as f32 * (level as f32).powf(config.level_exp_factor)) as u32
}

// Get exp value for a gem level
pub fn get_exp_value_for_gem(ctx: &ReducerContext, level: &GemLevel) -> u32 {
    let config = ctx.db.exp_config().config_id().find(&0);
    if config.is_none() {
        // Fallback values if config not found
        return match level {
            GemLevel::Small => 10,
            GemLevel::Medium => 25,
            GemLevel::Large => 50,
            GemLevel::Huge => 100,
        };
    }

    let config = config.unwrap();
    match level {
        GemLevel::Small => config.exp_small_gem,
        GemLevel::Medium => config.exp_medium_gem,
        GemLevel::Large => config.exp_large_gem,
        GemLevel::Huge => config.exp_huge_gem,
    }
}

// Apply experience to a player and handle level ups
pub fn give_player_exp(ctx: &ReducerContext, player_id: u32, exp_amount: u32) {
    let player_opt = ctx.db.player().player_id().find(&player_id);
    if player_opt.is_none() {
        return; // Player not found
    }

    let mut player = player_opt.unwrap();
    let new_exp = player.exp + exp_amount;
    let mut current_level = player.level;
    let mut leveled_up = false;
    let mut remaining_exp = new_exp;
    
    // Get exp needed for current level from player data
    let mut exp_needed = player.exp_for_next_level;
    
    // Loop to handle multiple level ups
    while remaining_exp >= exp_needed {
        // Level up
        current_level += 1;
        remaining_exp -= exp_needed;
        leveled_up = true;
        
        // Calculate exp needed for next level
        exp_needed = calculate_exp_for_level(ctx, current_level);
    }
    
    // Apply updates to player
    player.exp = remaining_exp;
    
    if leveled_up {
        let levels_gained = current_level - player.level;
        player.level = current_level;
        // Store the new exp needed for next level
        player.exp_for_next_level = exp_needed;
        
        // Grant an unspent upgrade point for each level gained
        player.unspent_upgrades += levels_gained;

        if player.unspent_upgrades == 1 {
            // Draw upgrade options for the player
            crate::upgrades_def::draw_upgrade_options(ctx, player_id);
        }
        
        log::info!("Player {} leveled up to level {}! Exp: {}/{}", player_id, current_level, remaining_exp, exp_needed);
    } else {
        //Log::info(&format!("Player {} gained {} exp. Now: {}/{}", player_id, exp_amount, remaining_exp, exp_needed));
    }
    
    // Update player record
    ctx.db.player().player_id().update(player);
}

// Process a gem collection by a player
pub fn collect_gem(ctx: &ReducerContext, gem_id: u32, player_id: u32) {
    // Find the gem
    let gem_opt = ctx.db.gems().gem_id().find(&gem_id);
    if gem_opt.is_none() {
        return; // Gem not found
    }

    let gem = gem_opt.unwrap();

    // Get the entity ID for the gem
    let gem_entity_id = gem.entity_id;

    // Calculate exp based on gem level
    let exp_value = get_exp_value_for_gem(ctx, &gem.level);

    // Give player exp
    give_player_exp(ctx, player_id, exp_value);

    // Log the collection
    //Log::info(&format!("Player {} collected a {:?} gem worth {} exp", player_id, gem.level, exp_value));

    // Delete the gem and its entity
    ctx.db.gems().gem_id().delete(&gem_id);
    ctx.db.entity().entity_id().delete(&gem_entity_id);
}

pub fn maintain_gems(ctx: &ReducerContext, collision_cache: &mut CollisionCache) {
    if ctx.db.gems().count() == 0 {
        return;
    }

    // Populate collision cache
    for gem in ctx.db.gems().iter() {
        let gem_entity_opt = ctx.db.entity().entity_id().find(&gem.entity_id);
        if gem_entity_opt.is_none() {
            continue;
        }

        if collision_cache.gem.cached_count_gems >= MAX_GEM_COUNT as i32 {
            //TODO grow gems
            continue;
        }

        let gem_entity = gem_entity_opt.unwrap();

        let cache_index = collision_cache.gem.cached_count_gems as usize;
        collision_cache.gem.keys_gem[cache_index] = gem.gem_id;
        collision_cache.gem.pos_x_gem[cache_index] = gem_entity.position.x;
        collision_cache.gem.pos_y_gem[cache_index] = gem_entity.position.y;
        collision_cache.gem.radius_gem[cache_index] = gem_entity.radius;
        
        let grid_cell_key = get_world_cell_from_position(gem_entity.position.x, gem_entity.position.y) as usize;
        collision_cache.gem.nexts_gem[cache_index] = collision_cache.gem.heads_gem[grid_cell_key];
        collision_cache.gem.heads_gem[grid_cell_key] = collision_cache.gem.cached_count_gems;

        collision_cache.gem.cached_count_gems += 1;
    }
}

pub fn process_gem_collisions_spatial_hash(ctx: &ReducerContext, collision_cache: &CollisionCache) {
    if ctx.db.gems().count() == 0 {
        return;
    }

    // Iterate through all players using spatial hash
    for pid in 0..collision_cache.player.cached_count_players {
        let pid = pid as usize;
        let px = collision_cache.player.pos_x_player[pid];
        let py = collision_cache.player.pos_y_player[pid];
        let pr = collision_cache.player.radius_player[pid];

        // Check against all gems in the same spatial hash cell
        let cell_key = get_world_cell_from_position(px, py);

        let real_player_id = collision_cache.player.keys_player[pid];

        let cx = (cell_key & WORLD_CELL_MASK) as i32;
        let cy = (cell_key >> WORLD_CELL_BIT_SHIFT) as i32;

        for dy in -1..=1 {
            let ny = cy + dy;
            if (ny as u32) >= WORLD_GRID_HEIGHT as u32 {
                continue; // unsigned trick == clamp
            }

            let row_base = ny << WORLD_CELL_BIT_SHIFT;
            for dx in -1..=1 {
                let nx = cx + dx;
                if (nx as u32) >= WORLD_GRID_WIDTH as u32 {
                    continue;
                }

                let test_cell_key = (row_base | nx) as usize;
                let mut gid = collision_cache.gem.heads_gem[test_cell_key];
                while gid != -1 {
                    let gid_usize = gid as usize;
                    let gx = collision_cache.gem.pos_x_gem[gid_usize];
                    let gy = collision_cache.gem.pos_y_gem[gid_usize];
                    let gr = collision_cache.gem.radius_gem[gid_usize];

                    if spatial_hash_collision_checker(px, py, pr, gx, gy, gr) {
                        collect_gem(ctx, collision_cache.gem.keys_gem[gid_usize], real_player_id);
                    }
                    
                    gid = collision_cache.gem.nexts_gem[gid_usize];
                }
            }
        }
    }
} 