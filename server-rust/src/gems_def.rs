use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, SpacetimeType, rand::Rng};
use crate::{DbVector2, MAX_GEM_COUNT, WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_HEIGHT, WORLD_GRID_WIDTH,
           get_world_cell_from_position, spatial_hash_collision_checker, CollisionCache, entity, player, account, monsters, bestiary};

// Define the gem levels (1-4 + Soul + Special types)
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq, Hash)]
pub enum GemLevel {
    Small,      // = 1
    Medium,     // = 2
    Large,      // = 3
    Huge,       // = 4
    Soul,       // Special gem created from player deaths
    Fries,      // Special gem that heals 100 HP
    Dice,       // Special gem that grants extra reroll
    BoosterPack, // Special gem that grants immediate upgrade
}

// Table for storing gem objects in the game
#[table(name = gems, public)]
pub struct Gem {
    #[primary_key]
    #[auto_inc]
    pub gem_id: u32,

    #[unique]
    pub entity_id: u32, // Associated entity for this gem

    pub level: GemLevel, // Level of the gem (1-4 + Soul)
    pub value: u32,      // Experience value of the gem
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

    // Calculate the gem value based on level
    let gem_value = match level {
        GemLevel::Small => config.exp_small_gem,
        GemLevel::Medium => config.exp_medium_gem,
        GemLevel::Large => config.exp_large_gem,
        GemLevel::Huge => config.exp_huge_gem,
        GemLevel::Soul => 0, // Soul gems have their value set separately
        GemLevel::Fries => 0, // Special gems don't use exp values
        GemLevel::Dice => 0, // Special gems don't use exp values
        GemLevel::BoosterPack => 0, // Special gems don't use exp values
    };

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
        value: gem_value,
    });

    let gem = gem_opt;
    gem.gem_id
}

// Creates a Soul gem with a specific value at the given position
pub fn create_soul_gem(ctx: &ReducerContext, position: DbVector2, exp_value: u32) -> u32 {
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

    // Create the soul gem with the specified value
    let gem_opt = ctx.db.gems().insert(Gem {
        gem_id: 0,
        entity_id: gem_entity.entity_id,
        level: GemLevel::Soul,
        value: exp_value,
    });

    let gem = gem_opt;
    log::info!("Created Soul gem (ID: {}) worth {} exp at position {}, {}", gem.gem_id, gem.value, position.x, position.y);
    gem.gem_id
}

// Helper method to spawn a gem with a random level at the given position
// Note: Soul gems cannot be spawned randomly - they are only created from player deaths
pub fn spawn_random_gem(ctx: &ReducerContext, position: DbVector2) -> u32 {
    // Randomly select a gem level with weighted probabilities (excluding Soul gems)
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

// Spawns a gem at the position of a killed monster using tier-based drops
pub fn spawn_gem_on_monster_death(ctx: &ReducerContext, monster_id: u32, position: DbVector2, collision_cache: &CollisionCache) {
    if collision_cache.gem.cached_count_gems >= MAX_GEM_COUNT as i32 {
        //TODO grow gems
        return;
    }

    // Get monster data to determine gem drop tier
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if monster_opt.is_none() {
        log::warn!("Monster {} not found for gem drop, using default tier", monster_id);
        spawn_random_gem(ctx, position);
        return;
    }
    
    let monster = monster_opt.unwrap();
    
    // Get bestiary entry to find monster tier
    let bestiary_entry_opt = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32));
    if bestiary_entry_opt.is_none() {
        log::warn!("Bestiary entry not found for monster type {:?}, using default tier", monster.bestiary_id);
        spawn_random_gem(ctx, position);
        return;
    }
    
    let bestiary_entry = bestiary_entry_opt.unwrap();
    let monster_tier = bestiary_entry.tier;

    let drop_chance = 1.0; // Default 100% drop chance for now

    // Roll for gem drop
    let mut rng = ctx.rng();
    let roll = rng.gen_range(0.0..1.0);
    if roll <= drop_chance {
        // Small chance for special gems (2% total, preserving original special gem rates)
        let special_gem_roll = rng.gen_range(1..=100);
        
        if special_gem_roll == 1 {
            let sub_special_gem_roll = rng.gen_range(1..=100);

            // 1% chance for Fries
            if sub_special_gem_roll <= 50 {
                create_gem(ctx, position, GemLevel::Fries);
                log::info!("Monster {} (Tier {}) dropped special Fries gem at position {}, {}", monster_id, monster_tier, position.x, position.y);
            }
            // 1% chance for Dice
            else if sub_special_gem_roll <= 90 {
                create_gem(ctx, position, GemLevel::Dice);
                log::info!("Monster {} (Tier {}) dropped special Dice gem at position {}, {}", monster_id, monster_tier, position.x, position.y);
            }
            // 1% chance for BoosterPack
            else{
                create_gem(ctx, position, GemLevel::BoosterPack);
                log::info!("Monster {} (Tier {}) dropped special BoosterPack gem at position {}, {}", monster_id, monster_tier, position.x, position.y);
            }
        }
        else {
            // 97% chance for tier-based regular gem
            let gem_level = crate::gem_drop_defs::select_weighted_gem_level(ctx, monster_tier);
            create_gem(ctx, position, gem_level.clone());
            log::info!("Monster {} (Tier {}) dropped {:?} gem at position {}, {}", monster_id, monster_tier, gem_level, position.x, position.y);
        }
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

// Calculate the total accumulated experience for a player (all XP earned to reach current level + remaining XP)
pub fn calculate_total_player_exp(ctx: &ReducerContext, player_level: u32, remaining_exp: u32) -> u32 {
    if player_level <= 1 {
        // Level 1 players only have their remaining exp
        return remaining_exp;
    }
    
    let config = ctx.db.exp_config().config_id().find(&0);
    if config.is_none() {
        // Fallback calculation if config not found
        let mut total_exp = 0;
        for level in 1..player_level {
            total_exp += level * 100; // Simple fallback formula
        }
        return total_exp + remaining_exp;
    }

    let config = config.unwrap();
    let mut total_exp = 0;
    
    // Sum up all XP needed from level 1 to current level
    for level in 1..player_level {
        let exp_for_level = (config.base_exp_per_level as f32 * (level as f32).powf(config.level_exp_factor)) as u32;
        total_exp += exp_for_level;
    }
    
    // Add the remaining XP for the current level
    total_exp + remaining_exp
}

// Get exp value for a gem level (now deprecated - use gem.value instead)
pub fn get_exp_value_for_gem(ctx: &ReducerContext, level: &GemLevel) -> u32 {
    let config = ctx.db.exp_config().config_id().find(&0);
    if config.is_none() {
        // Fallback values if config not found
        return match level {
            GemLevel::Small => 10,
            GemLevel::Medium => 25,
            GemLevel::Large => 50,
            GemLevel::Huge => 100,
            GemLevel::Soul => 0, // Soul gems should have their value stored in the gem record
            GemLevel::Fries => 0, // Special gems don't use exp values
            GemLevel::Dice => 0, // Special gems don't use exp values
            GemLevel::BoosterPack => 0, // Special gems don't use exp values
        };
    }

    let config = config.unwrap();
    match level {
        GemLevel::Small => config.exp_small_gem,
        GemLevel::Medium => config.exp_medium_gem,
        GemLevel::Large => config.exp_large_gem,
        GemLevel::Huge => config.exp_huge_gem,
        GemLevel::Soul => 0, // Soul gems should have their value stored in the gem record
        GemLevel::Fries => 0, // Special gems don't use exp values
        GemLevel::Dice => 0, // Special gems don't use exp values
        GemLevel::BoosterPack => 0, // Special gems don't use exp values
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
        
        // Heal player to max HP when leveling up
        let old_hp = player.hp;
        player.hp = player.max_hp;

        if player.unspent_upgrades == 1 {
            // Draw upgrade options for the player
            crate::upgrades_def::draw_upgrade_options(ctx, player_id);
        }
        
        log::info!("Player {} leveled up to level {}! Exp: {}/{}, Healed from {:.1} to {:.1} HP", 
                  player_id, current_level, remaining_exp, exp_needed, old_hp, player.max_hp);
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

    // Handle special gem types with unique behaviors
    match gem.level {
        GemLevel::Fries => {
            // Fries heal the player by 100 HP (don't exceed max HP)
            let player_opt = ctx.db.player().player_id().find(&player_id);
            if let Some(mut player) = player_opt {
                let heal_amount = 100.0;
                let new_hp = (player.hp + heal_amount).min(player.max_hp);
                let actual_heal = new_hp - player.hp;
                let max_hp = player.max_hp; // Store max_hp before updating
                
                player.hp = new_hp;
                ctx.db.player().player_id().update(player);
                
                log::info!("Player {} collected Fries gem, healed {:.1} HP (now {:.1}/{:.1})", 
                          player_id, actual_heal, new_hp, max_hp);
            }
        },
        GemLevel::Dice => {
            // Dice grant an extra reroll
            let player_opt = ctx.db.player().player_id().find(&player_id);
            if let Some(mut player) = player_opt {
                player.rerolls += 1;
                let new_rerolls = player.rerolls; // Store new value before updating
                ctx.db.player().player_id().update(player);
                
                log::info!("Player {} collected Dice gem, gained 1 reroll (now has {})", 
                          player_id, new_rerolls);
            }
        },
        GemLevel::BoosterPack => {
            // BoosterPack grants an immediate upgrade point (without leveling up)
            let player_opt = ctx.db.player().player_id().find(&player_id);
            if let Some(mut player) = player_opt {
                player.unspent_upgrades += 1;
                let new_upgrades = player.unspent_upgrades; // Store new value before updating
                ctx.db.player().player_id().update(player);
                
                log::info!("Player {} collected BoosterPack gem, gained 1 upgrade point (now has {})", 
                          player_id, new_upgrades);
                
                // If this is their first unspent upgrade, draw upgrade options
                if new_upgrades == 1 {
                    crate::upgrades_def::draw_upgrade_options(ctx, player_id);
                }
            }
        },
        _ => {
            // Regular gems (including Soul gems) give experience
            let exp_value = gem.value;
            give_player_exp(ctx, player_id, exp_value);
            log::info!("Player {} collected a {:?} gem worth {} exp", player_id, gem.level, exp_value);
        }
    }

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

// Debug reducer to spawn a random special gem near the calling player
#[reducer]
pub fn spawn_debug_special_gem(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "SpawnDebugSpecialGem");
    
    // Get the caller's identity
    let caller_identity = ctx.sender;
    
    // Find the caller's account
    let account_opt = ctx.db.account().identity().find(&caller_identity);
    if account_opt.is_none() {
        log::error!("spawn_debug_special_gem: Account not found for caller");
        return;
    }
    
    let account = account_opt.unwrap();
    if account.current_player_id == 0 {
        log::error!("spawn_debug_special_gem: Caller has no active player");
        return;
    }
    
    // Find the player
    let player_opt = ctx.db.player().player_id().find(&account.current_player_id);
    if player_opt.is_none() {
        log::error!("spawn_debug_special_gem: Player {} not found", account.current_player_id);
        return;
    }
    
    let player = player_opt.unwrap();
    
    // Generate a random position near the player (within 100 units)
    let mut rng = ctx.rng();
    let offset_x = rng.gen_range(-100.0..100.0);
    let offset_y = rng.gen_range(-100.0..100.0);
    let spawn_position = DbVector2::new(
        player.position.x + offset_x,
        player.position.y + offset_y,
    );
    
    // Randomly select a special gem type
    let gem_type_roll = rng.gen_range(1..=3);
    let gem_level = match gem_type_roll {
        1 => GemLevel::Fries,
        2 => GemLevel::Dice,
        _ => GemLevel::BoosterPack,
    };
    
    // Create the special gem
    let gem_id = create_gem(ctx, spawn_position, gem_level.clone());
    
    log::info!(
        "Debug: Spawned {} gem (ID: {}) at position ({:.1}, {:.1}) for player {} ({})",
        match gem_level {
            GemLevel::Fries => "Fries",
            GemLevel::Dice => "Dice", 
            GemLevel::BoosterPack => "BoosterPack",
            _ => "Unknown"
        },
        gem_id,
        spawn_position.x,
        spawn_position.y,
        player.name,
        player.player_id
    );
} 