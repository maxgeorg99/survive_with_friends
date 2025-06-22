use spacetimedb::{reducer, Table, ReducerContext, rand::Rng};
use crate::{PlayerClass, player, class_data, account};

#[reducer]
pub fn spawn_bot(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "SpawnBot");
    
    log::info!("SpawnBot called - selecting random class");

    // Check if spawning a new bot would exceed MAX_PLAYERS limit
    let current_player_count = ctx.db.player().count();
    if current_player_count >= crate::MAX_PLAYERS as u64 {
        panic!("SpawnBot: Server has reached maximum player capacity ({}/{}). Cannot spawn new bot.", 
               current_player_count, crate::MAX_PLAYERS);
    }

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

#[reducer]
pub fn debug_enable_bot_pvp(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "DebugEnableBotPvp");
    
    let mut bot_count = 0;
    let mut updated_count = 0;

    // Find all bot players and enable their PvP
    for player in ctx.db.player().iter() {
        if player.is_bot {
            bot_count += 1;
            
            // Only update if PvP is currently disabled
            if !player.pvp {
                let mut updated_player = player;
                updated_player.pvp = true;
                
                log::info!("Debug: Enabled PvP for bot {} (ID: {})", updated_player.name, updated_player.player_id);
                ctx.db.player().player_id().update(updated_player);
                updated_count += 1;
            }
        }
    }

    log::info!("Debug: PvP enabled for {}/{} bots (rest already had PvP enabled)", updated_count, bot_count);
}
