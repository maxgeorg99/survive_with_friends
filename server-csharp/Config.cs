using SpacetimeDB;

public static partial class Module
{
    [SpacetimeDB.Table(Name = "config", Public = true)]
    public partial struct Config
    {
        [PrimaryKey]
        public uint id; // We'll use id=0 for the main config
        
        public uint world_size; // Game world dimensions (in pixels)
        
        // Add other config properties as needed
        public uint max_monsters; // Maximum number of monsters allowed at once
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
            world_size = 2000, // Default world size in pixels
            max_monsters = 20  // Default maximum monsters
        });

        Log.Info("Game configuration initialized successfully");
    }
} 