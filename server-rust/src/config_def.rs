use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};

#[table(name = config, public)]
pub struct Config {
    #[primary_key]
    pub id: u32, // We'll use id=0 for the main config
    
    pub world_size: u32, // Game world dimensions (in pixels)
    pub game_tick_rate: u32, // Game tick rate in milliseconds
    
    // Add other config properties as needed
    pub max_monsters: u32, // Maximum number of monsters allowed at once
    pub player_spawn_grace_period: u32, // Player spawn grace period in milliseconds
    pub monster_hit_cleanup_delay: u32, // Delay in milliseconds before monster hit records are cleaned up
    pub monster_wave_size: u32, // Number of monsters to spawn in a wave (per player)
}

// Initialize the game configuration
pub fn init_game_config(ctx: &ReducerContext) {
    log::info!("Initializing game configuration...");
    
    // Only initialize if the config is empty
    if ctx.db.config().count() > 0 {
        log::info!("Game configuration already exists, skipping");
        return;
    }

    // Insert default configuration
    ctx.db.config().insert(Config {
        id: 0,
        world_size: super::WORLD_SIZE, // Default world size in pixels (10x larger)
        game_tick_rate: 50, // Default game tick rate in milliseconds
        max_monsters: 1000,  // Default maximum monsters
        player_spawn_grace_period: 5000, // Default player spawn grace period in milliseconds
        monster_hit_cleanup_delay: 500, // Default monster hit cleanup delay in milliseconds
        monster_wave_size: 1 // Default monster wave size
    });

    log::info!("Game configuration initialized successfully");
} 