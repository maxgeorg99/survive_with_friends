using SpacetimeDB;

public static partial class Module
{
    [SpacetimeDB.Table(Name = "config", Public = true)]
    public partial struct Config
    {
        [PrimaryKey]
        public uint id; // We'll use id=0 for the main config
        
        public uint world_size; // Game world dimensions (in pixels)

        public uint game_tick_rate; // Game tick rate in milliseconds
        
        // Add other config properties as needed
        public uint max_monsters; // Maximum number of monsters allowed at once

        public uint player_spawn_grace_period; // Player spawn grace period in milliseconds
        
        public uint monster_hit_cleanup_delay; // Delay in milliseconds before monster hit records are cleaned up

        public uint monster_wave_size; // Number of monsters to spawn in a wave (per player)
    }
    
    // Initialize the game configuration
    public static void InitGameConfig(ReducerContext ctx)
    {
        Log.Info("Initializing game configuration...");
        
        // Only initialize if the config is empty
        if (ctx.Db.config.Count > 0)
        {
            Log.Info("Game configuration already exists, skipping");
            return;
        }

        // Insert default configuration
        ctx.Db.config.Insert(new Config
        {
            id = 0,
            world_size = (uint)WORLD_SIZE, // Default world size in pixels (10x larger)
            game_tick_rate = 50, // Default game tick rate in milliseconds
            max_monsters = 500,  // Default maximum monsters
            player_spawn_grace_period = 5000, // Default player spawn grace period in milliseconds
            monster_hit_cleanup_delay = 500, // Default monster hit cleanup delay in milliseconds
            monster_wave_size = 1 // Default monster wave size
        });

        Log.Info("Game configuration initialized successfully");
    }
} 