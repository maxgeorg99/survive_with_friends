using SpacetimeDB;
using System;
using System.Linq;

public static partial class Module
{
    private const int MAX_SPAWN_ATTEMPTS = 50;  // Maximum number of attempts to find a safe spawn position
    private const float MIN_SPAWN_DISTANCE = 200f;  // Minimum distance from monsters in pixels

    private static bool IsPositionSafe(ReducerContext ctx, DbVector2 position, float radius)
    {
        // Get the cell key for this position
        ushort cellKey = GetWorldCellFromPosition(position.x, position.y);
        
        // Check surrounding cells (3x3 grid)
        int cx = cellKey & WORLD_CELL_MASK;
        int cy = cellKey >> WORLD_CELL_BIT_SHIFT;

        for (int dy = -1; dy <= +1; ++dy)
        {
            int ny = cy + dy;
            if ((uint)ny >= (uint)WORLD_GRID_HEIGHT) continue;

            int rowBase = ny << WORLD_CELL_BIT_SHIFT;
            for (int dx = -1; dx <= +1; ++dx)
            {
                int nx = cx + dx;
                if ((uint)nx >= WORLD_GRID_WIDTH) continue;

                int testCellKey = rowBase | nx;
                for(var mid = HeadsMonster[testCellKey]; mid != -1; mid = NextsMonster[mid])
                {
                    var mx = PosXMonster[mid];
                    var my = PosYMonster[mid];
                    var mr = RadiusMonster[mid];

                    // Calculate distance between centers
                    float dx2 = position.x - mx;
                    float dy2 = position.y - my;
                    float distanceSquared = dx2 * dx2 + dy2 * dy2;
                    float minDistance = radius + mr + MIN_SPAWN_DISTANCE;
                    
                    // If too close to a monster, position is not safe
                    if (distanceSquared < minDistance * minDistance)
                    {
                        return false;
                    }
                }
            }
        }
        
        return true;
    }

    private static DbVector2? FindSafeSpawnPosition(ReducerContext ctx, float radius)
    {
        // Get game configuration for world size
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt == null)
        {
            throw new Exception("FindSafeSpawnPosition: Could not find game configuration!");
        }
        var config = configOpt.Value;

        // Try to find a safe position
        for (int attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++)
        {
            // Generate random position within world bounds
            float x = ctx.Rng.Next((int)radius, (int)(config.world_size - radius));
            float y = ctx.Rng.Next((int)radius, (int)(config.world_size - radius));
            var position = new DbVector2(x, y);

            // Check if position is safe
            if (IsPositionSafe(ctx, position, radius))
            {
                return position;
            }
        }

        // If we couldn't find a safe position, fall back to center with offset
        Log.Info("Could not find safe spawn position, falling back to center with offset");
        float centerX = config.world_size / 2;
        float centerY = config.world_size / 2;
        float offsetX = ctx.Rng.Next(-100, 101);
        float offsetY = ctx.Rng.Next(-100, 101);
        return new DbVector2(centerX + offsetX, centerY + offsetY);
    }

    [Reducer]
    public static void SpawnBot(ReducerContext ctx)
    {
        Log.Info("SpawnBot called - selecting random class");

        // Get all available classes from class_data
        var availableClasses = ctx.Db.class_data.Iter().ToList();
        if (availableClasses.Count == 0)
        {
            throw new Exception("SpawnBot: No class data available!");
        }

        // Randomly select a class
        int randomIndex = ctx.Rng.Next(0, availableClasses.Count);
        var selectedClass = availableClasses[randomIndex];
        var playerClass = selectedClass.PlayerClass;

        Log.Info($"Selected random class: {playerClass}");
        
        // Find a safe spawn position
        var spawnPosition = FindSafeSpawnPosition(ctx, 48.0f); // Using standard player radius
        if (spawnPosition == null)
        {
            throw new Exception("Failed to find safe spawn position for bot!");
        }
        
        // Create the bot player
        var botName = $"Bot_{ctx.Db.player.Count + 1}";
        Log.Info($"Creating bot player '{botName}' at position: {spawnPosition.Value.x}, {spawnPosition.Value.y}");
        
        // Create the player with bot flag set
        var newPlayerOpt = CreateNewPlayerWithPosition(ctx, botName, playerClass, spawnPosition.Value);
        if (newPlayerOpt == null)
        {
            throw new Exception($"Failed to create new bot player!");
        }
        
        var newPlayer = newPlayerOpt.Value;
        newPlayer.is_bot = true;
        ctx.Db.player.player_id.Update(newPlayer);

        Log.Info($"Created new bot player record with class {playerClass}");
    }
} 