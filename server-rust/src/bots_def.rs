use spacetimedb::{reducer, Table, ReducerContext, Identity, Timestamp, rand::Rng};
use crate::{PlayerClass, DbVector2, WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_HEIGHT, WORLD_GRID_WIDTH, 
           get_world_cell_from_position, player, config, class_data};

const MAX_SPAWN_ATTEMPTS: i32 = 50;   // Maximum number of attempts to find a safe spawn position
const MIN_SPAWN_DISTANCE: f32 = 200.0; // Minimum distance from monsters in pixels

fn is_position_safe(ctx: &ReducerContext, position: &DbVector2, radius: f32, collision_cache: &crate::CollisionCache) -> bool {
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

fn find_safe_spawn_position(ctx: &ReducerContext, radius: f32, collision_cache: &crate::CollisionCache) -> Option<DbVector2> {
    // Get game configuration for world size
    let config = ctx.db.config().id().find(&0)
        .expect("FindSafeSpawnPosition: Could not find game configuration!");

    // Try to find a safe position
    let mut rng = ctx.rng();
    for _attempt in 0..MAX_SPAWN_ATTEMPTS {
        // Generate random position within world bounds
        let x = rng.gen_range(radius..(config.world_size as f32 - radius));
        let y = rng.gen_range(radius..(config.world_size as f32 - radius));
        let position = DbVector2::new(x, y);

        // Check if position is safe
        if is_position_safe(ctx, &position, radius, collision_cache) {
            return Some(position);
        }
    }

    // If we couldn't find a safe position, fall back to center with offset
    log::info!("Could not find safe spawn position, falling back to center with offset");
    let center_x = config.world_size as f32 / 2.0;
    let center_y = config.world_size as f32 / 2.0;

    let offset_x = rng.gen_range(-100.0..101.0);
    let offset_y = rng.gen_range(-100.0..101.0);
    Some(DbVector2::new(center_x + offset_x, center_y + offset_y))
}

#[reducer]
pub fn spawn_bot(ctx: &ReducerContext) {
    log::info!("SpawnBot called - selecting random class");

    // Get all available classes from class_data
    let available_classes: Vec<_> = ctx.db.class_data().iter().collect();
    if available_classes.is_empty() {
        panic!("SpawnBot: No class data available!");
    }

    // Randomly select a class
    /*
    use spacetimedb::Rng;
    let random_index = ctx.rng.gen_range(0..available_classes.len());
    let selected_class = &available_classes[random_index];
    let player_class = selected_class.player_class.clone();
    */
    let player_class = PlayerClass::Rogue;

    log::info!("Selected random class: {:?}", player_class);
    
    let collision_cache = crate::monsters_def::get_collision_cache();
    
    // Find a safe spawn position
    let spawn_position = find_safe_spawn_position(ctx, 48.0, &collision_cache); // Using standard player radius
    let spawn_position = spawn_position.expect("Failed to find safe spawn position for bot!");
    
    // Create the bot player
    let bot_name = format!("Bot_{}", ctx.db.player().count() + 1);
    log::info!("Creating bot player '{}' at position: {}, {}", bot_name, spawn_position.x, spawn_position.y);
    
    // Create the player with bot flag set
    let new_player_opt = crate::create_new_player_with_position(ctx, &bot_name, player_class.clone(), spawn_position);
    let mut new_player = new_player_opt.expect("Failed to create new bot player!");
    
    new_player.is_bot = true;
    ctx.db.player().player_id().update(new_player);

    log::info!("Created new bot player record with class {:?}", player_class.clone());
} 