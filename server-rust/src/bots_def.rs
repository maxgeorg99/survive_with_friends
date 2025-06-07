use spacetimedb::{reducer, Table, ReducerContext, rand::Rng};
use crate::{PlayerClass, player, class_data};

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
    
    // Find a safe spawn position using the function from player_def
    let spawn_position = crate::player_def::find_safe_spawn_position(ctx, 48.0, &collision_cache); // Using standard player radius
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