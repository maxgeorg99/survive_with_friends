using SpacetimeDB;

public static partial class Module
{
    [SpacetimeDB.Table(Name = "Config", Public = true)]
    public partial struct Config
    {
        [PrimaryKey]
        public uint Id; // We'll use id=0 for the main config
        
        public uint WorldSize; // Game world dimensions (in pixels)
        
        // Add other config properties as needed
        public uint MaxMonsters; // Maximum number of monsters allowed at once
    }
    
    // Initialize the game configuration
    public static void InitGameConfig(ReducerContext ctx)
    {
        Log.Info("Initializing game configuration...");
        
        // Only initialize if the config is empty
        if (ctx.Db.Config.Count > 0)
        {
            Log.Info("Game configuration already exists, skipping");
            return;
        }

        // Insert default configuration
        ctx.Db.Config.Insert(new Config
        {
            Id = 0,
            WorldSize = 2000, // Default world size in pixels
            MaxMonsters = 20  // Default maximum monsters
        });

        Log.Info("Game configuration initialized successfully");
    }
} 