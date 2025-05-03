using SpacetimeDB;

public static partial class Module
{
    // Game state table to track boss-related information
    [SpacetimeDB.Table(Name = "game_state", Public = true)]
    public partial struct GameState
    {
        [PrimaryKey]
        public uint id; // We'll use id=0 for the main game state
        
        public bool boss_active; // Whether a boss is currently active
        public uint boss_phase; // 0 = no boss, 1 = phase 1, 2 = phase 2
        public uint boss_monster_id; // ID of the current boss monster
        public bool normal_spawning_paused; // Whether normal monster spawning is paused
    }
    
    // Timer for boss spawn (scheduled every 5 minutes)
    [SpacetimeDB.Table(Name = "boss_spawn_timer", 
                        Scheduled = nameof(SpawnBossPhaseOne), 
                        ScheduledAt = nameof(scheduled_at),
                        Public = true)]
    public partial struct BossSpawnTimer
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        public ScheduleAt scheduled_at;
    }
    
    // Initialize the game state
    public static void InitGameState(ReducerContext ctx)
    {
        Log.Info("Initializing game state...");
        
        // Only initialize if the state is empty
        if (ctx.Db.game_state.Count > 0)
        {
            Log.Info("Game state already exists, skipping");
            return;
        }

        // Insert default game state
        ctx.Db.game_state.Insert(new GameState
        {
            id = 0,
            boss_active = false,
            boss_phase = 0,
            boss_monster_id = 0,
            normal_spawning_paused = false
        });

        Log.Info("Game state initialized successfully");
        
        // Schedule first boss spawn after 5 minutes
        ScheduleBossSpawn(ctx);
    }
    
    // Schedule the boss to spawn after 5 minutes
    public static void ScheduleBossSpawn(ReducerContext ctx)
    {
        Log.Info("Scheduling boss spawn after 5 minutes...");
        
        // Create timer that will trigger after 5 minutes
        const int BOSS_SPAWN_DELAY_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
        
        ctx.Db.boss_spawn_timer.Insert(new BossSpawnTimer
        {
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(BOSS_SPAWN_DELAY_MS))
        });
        
        Log.Info($"Boss spawn scheduled in {BOSS_SPAWN_DELAY_MS}ms");
    }
    
    // Called when the boss spawn timer fires
    [Reducer]
    public static void SpawnBossPhaseOne(ReducerContext ctx, BossSpawnTimer timer)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer SpawnBossPhaseOne may not be invoked by clients, only via scheduling.");
        }

        Log.Info("Boss phase 1 spawn timer triggered!");
        
        // Check if there are any players online
        var playerCount = ctx.Db.player.Count;
        if (playerCount == 0)
        {
            Log.Info("No players online, not spawning boss. Rescheduling for later.");
            ScheduleBossSpawn(ctx);
            return;
        }
        
        // Get game configuration for world size
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt == null)
        {
            throw new Exception("SpawnBossPhaseOne: Could not find game configuration!");
        }
        var config = configOpt.Value;
        
        // Get game state to update boss status
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt == null)
        {
            throw new Exception("SpawnBossPhaseOne: Could not find game state!");
        }
        
        // Update game state to indicate boss is active
        var gameState = gameStateOpt.Value;
        gameState.boss_active = true;
        gameState.boss_phase = 1;
        gameState.normal_spawning_paused = true;
        ctx.Db.game_state.id.Update(gameState);
        
        // Calculate position at center of map
        float centerX = config.world_size / 2;
        float centerY = config.world_size / 2;
        DbVector2 centerPosition = new DbVector2(centerX, centerY);
        
        // Create a pre-spawner for the boss at the center of map
        Log.Info($"Creating boss phase 1 pre-spawner at center of map ({centerX}, {centerY})");
        
        // Find the closest player to target
        uint closestPlayerId = 0;
        float closestDistance = float.MaxValue;
        string targetPlayerName = "unknown";
        
        foreach (var player in ctx.Db.player.Iter())
        {
            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (playerEntityOpt != null)
            {
                // Calculate distance to center
                var playerEntity = playerEntityOpt.Value;
                float dx = playerEntity.position.x - centerPosition.x;
                float dy = playerEntity.position.y - centerPosition.y;
                float distanceSquared = dx * dx + dy * dy;
                
                // Update closest player if this one is closer
                if (distanceSquared < closestDistance)
                {
                    closestDistance = distanceSquared;
                    closestPlayerId = player.entity_id;
                    targetPlayerName = player.name;
                }
            }
        }
        
        // Schedule the boss to spawn using the existing monster spawning system
        ScheduleBossSpawning(ctx, centerPosition, closestPlayerId, targetPlayerName);
    }
    
    // Schedule boss spawning using the existing monster spawning system
    private static void ScheduleBossSpawning(ReducerContext ctx, DbVector2 position, uint targetEntityId, string targetPlayerName)
    {
        Log.Info($"Scheduling boss phase 1 spawn at position ({position.x}, {position.y}) targeting player: {targetPlayerName}");
        
        // Use the existing monster spawner system, but for the boss
        const int BOSS_SPAWN_VISUALIZATION_DELAY_MS = 3000; // 3 seconds for pre-spawn animation
        
        // Insert a monster spawner with FinalBossPhase1 type
        ctx.Db.monster_spawners.Insert(new MonsterSpawners
        {
            position = position,
            monster_type = MonsterType.FinalBossPhase1,
            target_entity_id = targetEntityId,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(BOSS_SPAWN_VISUALIZATION_DELAY_MS))
        });
        
        Log.Info($"Boss phase 1 scheduled to spawn in {BOSS_SPAWN_VISUALIZATION_DELAY_MS}ms at center of map");
    }
    
    // Called when phase 1 boss is defeated
    public static void SpawnBossPhaseTwo(ReducerContext ctx, uint oldBossEntityId, DbVector2 position)
    {
        Log.Info("Boss phase 1 defeated! Spawning phase 2...");
        
        // Get game state
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt == null)
        {
            throw new Exception("SpawnBossPhaseTwo: Could not find game state!");
        }
        
        // Update game state to indicate phase 2
        var gameState = gameStateOpt.Value;
        gameState.boss_phase = 2;
        ctx.Db.game_state.id.Update(gameState);
        
        // Get boss stats from bestiary
        var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)MonsterType.FinalBossPhase2);
        if (bestiaryEntry == null)
        {
            throw new Exception($"SpawnBossPhaseTwo: Could not find bestiary entry for boss phase 2!");
        }
        
        // Find the closest player to target
        uint closestPlayerId = 0;
        float closestDistance = float.MaxValue;
        string targetPlayerName = "unknown";
        
        foreach (var player in ctx.Db.player.Iter())
        {
            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (playerEntityOpt != null)
            {
                // Calculate distance to boss position
                var playerEntity = playerEntityOpt.Value;
                float dx = playerEntity.position.x - position.x;
                float dy = playerEntity.position.y - position.y;
                float distanceSquared = dx * dx + dy * dy;
                
                // Update closest player if this one is closer
                if (distanceSquared < closestDistance)
                {
                    closestDistance = distanceSquared;
                    closestPlayerId = player.entity_id;
                    targetPlayerName = player.name;
                }
            }
        }
        
        // Create boss entity at the same position as phase 1
        Entity? entityOpt = ctx.Db.entity.Insert(new Entity
        {
            position = position,
            direction = new DbVector2(0, 0), // Initial direction
            is_moving = false,  // Not moving initially
            radius = bestiaryEntry.Value.radius // Set radius from bestiary entry
        });
        
        if (entityOpt == null)
        {
            throw new Exception("SpawnBossPhaseTwo: Failed to create entity for boss!");
        }
        
        // Create the boss monster
        Monsters? monsterOpt = ctx.Db.monsters.Insert(new Monsters
        {
            entity_id = entityOpt.Value.entity_id,
            bestiary_id = MonsterType.FinalBossPhase2,
            hp = bestiaryEntry.Value.max_hp,
            max_hp = bestiaryEntry.Value.max_hp,
            target_entity_id = closestPlayerId
        });
        
        if (monsterOpt == null)
        {
            throw new Exception("SpawnBossPhaseTwo: Failed to create boss monster!");
        }
        
        // Update game state with new boss monster ID
        gameState.boss_monster_id = monsterOpt.Value.monster_id;
        ctx.Db.game_state.id.Update(gameState);
        
        // Announce boss phase 2 spawn to players
        Log.Info($"FINAL BOSS PHASE 2 SPAWNED! (entity: {entityOpt.Value.entity_id}, monster: {monsterOpt.Value.monster_id}) targeting player: {targetPlayerName}");
    }
    
    // Called when phase 2 boss is defeated - all players defeat the game!
    public static void HandleBossDefeated(ReducerContext ctx)
    {
        Log.Info("FINAL BOSS DEFEATED! VICTORY!");
        
        // Get game state
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt == null)
        {
            throw new Exception("HandleBossDefeated: Could not find game state!");
        }
        
        // Reset game state
        var gameState = gameStateOpt.Value;
        gameState.boss_active = false;
        gameState.boss_phase = 0;
        gameState.boss_monster_id = 0;
        gameState.normal_spawning_paused = false;
        ctx.Db.game_state.id.Update(gameState);
        
        // Mark all players as "true survivors" and defeat them
        int truesurvivorsCount = 0;
        
        foreach (var player in ctx.Db.player.Iter())
        {
            // Store the player in the dead_players table with special flag
            DeadPlayer? deadPlayerOpt = ctx.Db.dead_players.Insert(new DeadPlayer
            {
                player_id = player.player_id,
                name = player.name,
                is_true_survivor = true  // Mark as true survivor
            });
            
            if (deadPlayerOpt != null)
            {
                truesurvivorsCount++;
                
                // Delete the player (entity will be cleaned up separately)
                ctx.Db.player.player_id.Delete(player.player_id);
                ctx.Db.entity.entity_id.Delete(player.entity_id);
            }
        }
        
        Log.Info($"{truesurvivorsCount} players marked as True Survivors!");
        
        // Schedule the next boss spawn
        ScheduleBossSpawn(ctx);
        
        // Resume normal monster spawning
        ResumeMonsterSpawning(ctx);
    }
    
    // Resume normal monster spawning
    private static void ResumeMonsterSpawning(ReducerContext ctx)
    {
        Log.Info("Resuming normal monster spawning...");
        
        // Check if monster spawning is already scheduled
        if (ctx.Db.monster_spawn_timer.Count == 0)
        {
            // Schedule monster spawning
            ScheduleMonsterSpawning(ctx);
        }
    }
    
    // Test/debug utility to manually spawn the boss for testing
    [Reducer]
    public static void SpawnBossForTesting(ReducerContext ctx)
    {
        Log.Info("DEVELOPER TEST: Manually triggering boss spawn...");
        
        // Call the boss spawn method directly
        // This bypasses the scheduling system for testing purposes
        SpawnBossPhaseOne(ctx, new BossSpawnTimer { scheduled_id = 0 });
        
        Log.Info("DEVELOPER TEST: Boss spawn triggered manually");
    }
} 