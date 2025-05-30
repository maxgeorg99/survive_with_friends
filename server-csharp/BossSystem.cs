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
    
    // Scheduled table for boss projectile attacks
    [SpacetimeDB.Table(Name = "boss_attack_timer", Scheduled = nameof(BossFireProjectile), ScheduledAt = nameof(scheduled_at), Public = true)]
    public partial struct BossAttackTimer
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
        
        // Randomly select a boss for this run
        var rng = ctx.Rng;
        int bossIndex = rng.Next(0, 3); // 0 = Jorge, 1 = Björn, 2 = Simon
        MonsterType phase1Type;
        switch (bossIndex)
        {
            case 0:
                phase1Type = MonsterType.FinalBossJorgePhase1;
                break;
            case 1:
                phase1Type = MonsterType.FinalBossBjornPhase1;
                break;
            default:
                phase1Type = MonsterType.FinalBossSimonPhase1;
                break;
        }
        
        // Update game state to indicate boss is active and store selected boss type
        var gameState = gameStateOpt.Value;
        gameState.boss_active = true;
        gameState.boss_phase = 1;
        gameState.normal_spawning_paused = true;
        // Store phase1Type as boss_monster_id for tracking (or add a new field if needed)
        ctx.Db.game_state.id.Update(gameState);
        
        // Calculate position at center of map
        float centerX = config.world_size / 2;
        float centerY = config.world_size / 2;
        DbVector2 centerPosition = new DbVector2(centerX, centerY);
        
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
        ScheduleBossSpawning(ctx, centerPosition, closestPlayerId, targetPlayerName, phase1Type);

        // Schedule the first boss attack timer (projectile)
        ctx.Db.boss_attack_timer.Insert(new BossAttackTimer
        {
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(1000))
        });
    }
    
    // Schedule boss spawning using the existing monster spawning system
    private static void ScheduleBossSpawning(ReducerContext ctx, DbVector2 position, uint targetEntityId, string targetPlayerName, MonsterType bossType)
    {
        Log.Info($"Scheduling boss phase 1 spawn at position ({position.x}, {position.y}) targeting player: {targetPlayerName}");
        
        // Use the existing monster spawner system, but for the boss
        const int BOSS_SPAWN_VISUALIZATION_DELAY_MS = 3000; // 3 seconds for pre-spawn animation
        
        // Insert a monster spawner with the selected boss type
        MonsterSpawners? spawnerOpt = ctx.Db.monster_spawners.Insert(new MonsterSpawners
        {
            position = position,
            monster_type = bossType,
            target_entity_id = targetEntityId,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(BOSS_SPAWN_VISUALIZATION_DELAY_MS))
        });
        
        Log.Info($"Boss phase 1 scheduled to spawn in {BOSS_SPAWN_VISUALIZATION_DELAY_MS}ms at center of map");
        
        // Register a callback to update the game state when the monster is spawned
        if (spawnerOpt != null)
        {
            Log.Info($"Created spawner for Phase 1 boss: ID in spawners table");
            // We'll update the game state when the monster is created in UpdateBossCreated reducer
        }
    }
    
    // Called when phase 1 boss is defeated
    public static void SpawnBossPhaseTwo(ReducerContext ctx, uint oldBossEntityId, DbVector2 position)
    {
        Log.Info($"Boss phase 1 defeated! Spawning phase 2 at position ({position.x}, {position.y})...");
        
        // Get game state
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt == null)
        {
            throw new Exception("SpawnBossPhaseTwo: Could not find game state!");
        }
        
        Log.Info($"Game state before update - Phase: {gameStateOpt.Value.boss_phase}, BossActive: {gameStateOpt.Value.boss_active}, BossMonsterID: {gameStateOpt.Value.boss_monster_id}");
        
        // Determine which boss phase 2 to spawn based on the phase 1 boss type
        var oldBossOpt = ctx.Db.monsters.entity_id.Find(oldBossEntityId);
        if (oldBossOpt == null)
        {
            throw new Exception("SpawnBossPhaseTwo: Could not find old boss monster!");
        }
        var oldBossType = oldBossOpt.Value.bestiary_id;
        MonsterType phase2Type;
        switch (oldBossType)
        {
            case MonsterType.FinalBossJorgePhase1:
                phase2Type = MonsterType.FinalBossJorgePhase2;
                break;
            case MonsterType.FinalBossBjornPhase1:
                phase2Type = MonsterType.FinalBossBjornPhase2;
                break;
            case MonsterType.FinalBossSimonPhase1:
                phase2Type = MonsterType.FinalBossSimonPhase2;
                break;
            default:
                phase2Type = MonsterType.FinalBossBjornPhase2; // fallback
                break;
        }
        
        // Update game state to indicate phase 2
        var gameState = gameStateOpt.Value;
        gameState.boss_phase = 2;
        ctx.Db.game_state.id.Update(gameState);
        
        Log.Info($"Game state updated to phase 2");
        
        // Get boss stats from bestiary
        var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)phase2Type);
        if (bestiaryEntry == null)
        {
            throw new Exception($"SpawnBossPhaseTwo: Could not find bestiary entry for boss phase 2!");
        }
        
        Log.Info($"Retrieved bestiary entry for phase 2: HP={bestiaryEntry.Value.max_hp}, Speed={bestiaryEntry.Value.speed}, Radius={bestiaryEntry.Value.radius}");
        
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
        
        Log.Info($"Selected target player: {targetPlayerName} (ID: {closestPlayerId}, Distance: {Math.Sqrt(closestDistance)})");
        
        try
        {
            // Create boss entity at the same position as phase 1
            Log.Info($"Creating entity for phase 2 boss at position ({position.x}, {position.y})");
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
            
            Log.Info($"Created phase 2 boss entity with ID: {entityOpt.Value.entity_id}");
            
            // Create the boss monster
            Log.Info($"Creating phase 2 boss monster with entityId: {entityOpt.Value.entity_id}");
            Monsters? monsterOpt = ctx.Db.monsters.Insert(new Monsters
            {
                entity_id = entityOpt.Value.entity_id,
                bestiary_id = phase2Type,
                hp = bestiaryEntry.Value.max_hp,
                max_hp = bestiaryEntry.Value.max_hp,
                atk = bestiaryEntry.Value.atk,
                speed = bestiaryEntry.Value.speed,
                target_entity_id = closestPlayerId
            });
            
            if (monsterOpt == null)
            {
                throw new Exception("SpawnBossPhaseTwo: Failed to create boss monster!");
            }
            
            Log.Info($"Created phase 2 boss monster with ID: {monsterOpt.Value.monster_id}");
            
            // Schedule the first boss attack timer (projectile) for phase 2
            ctx.Db.boss_attack_timer.Insert(new BossAttackTimer
            {
                scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(600))
            });
            
            // Update game state with new boss monster ID
            gameState.boss_monster_id = monsterOpt.Value.monster_id;
            
            // Explicitly set boss_active flag to true just to be absolutely sure
            gameState.boss_active = true;
            
            // Log all game state details before final update
            Log.Info($"FINAL Game state update - Phase: {gameState.boss_phase}, BossActive: {gameState.boss_active}, BossMonsterID: {gameState.boss_monster_id}");
            
            // Update the game state with all the correct values
            ctx.Db.game_state.id.Update(gameState);
            
            // Announce boss phase 2 spawn to players
            Log.Info($"FINAL BOSS PHASE 2 SPAWNED! (entity: {entityOpt.Value.entity_id}, monster: {monsterOpt.Value.monster_id}) targeting player: {targetPlayerName}");
        }
        catch (Exception ex)
        {
            Log.Info($"ERROR in SpawnBossPhaseTwo: {ex.Message}\n{ex.StackTrace}");
            throw; // Rethrow to ensure original error handling still works
        }
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
            // Clean up all attack-related data for this player
            CleanupPlayerAttacks(ctx, player.player_id);
            
            // Clean up all pending upgrade options for this player
            CleanupPlayerUpgradeOptions(ctx, player.player_id);
            
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
    
    public static void UpdateBossMonsterID(ReducerContext ctx, uint monster_id)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer UpdateBossMonsterID may not be invoked by clients.");
        }

        var monsterOpt = ctx.Db.monsters.monster_id.Find(monster_id);
        if (monsterOpt == null)
        {
            Log.Info($"UpdateBossMonsterID: Monster with ID {monster_id} not found!");
            return;
        }

        var monster = monsterOpt.Value;
        // Check if this is a boss monster (any phase 1)
        if (monster.bestiary_id == MonsterType.FinalBossJorgePhase1 ||
            monster.bestiary_id == MonsterType.FinalBossBjornPhase1 ||
            monster.bestiary_id == MonsterType.FinalBossSimonPhase1)
        {
            Log.Info($"BOSS PHASE 1 CREATED: Updating game state with boss_monster_id={monster_id}");
            var gameStateOpt = ctx.Db.game_state.id.Find(0);
            if (gameStateOpt != null)
            {
                var gameState = gameStateOpt.Value;
                gameState.boss_monster_id = monster_id;
                ctx.Db.game_state.id.Update(gameState);
            }
        }
    }

    // Reducer to fire a boss projectile at the nearest player
    [Reducer]
    public static void BossFireProjectile(ReducerContext ctx, BossAttackTimer timer)
    {
        Log.Info("BossFireProjectile triggered!");
        
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt == null || !gameStateOpt.Value.boss_active || gameStateOpt.Value.boss_monster_id == 0)
        {
            Log.Info("BossFireProjectile: No active boss found");
            return;
        }

        var bossMonster = ctx.Db.monsters.monster_id.Find(gameStateOpt.Value.boss_monster_id);
        if (bossMonster == null)
        {
            Log.Info("BossFireProjectile: Boss monster not found");
            return;
        }

        // Determine boss type and attack pattern
        var bossType = bossMonster.Value.bestiary_id;
        if (bossType == MonsterType.FinalBossJorgePhase1 || bossType == MonsterType.FinalBossJorgePhase2)
        {
            // Jorge: Single fast projectile
            Module.TriggerBossAttackProjectile(ctx, bossMonster.Value.monster_id, AttackType.BossJorgeBolt);
        }
        else if (bossType == MonsterType.FinalBossBjornPhase1 || bossType == MonsterType.FinalBossBjornPhase2)
        {
            // Björn: Homing projectile
            Module.TriggerBossAttackProjectile(ctx, bossMonster.Value.monster_id, AttackType.BossBjornBolt, 0, 1); // parameterU = 1 marks it as homing
        }
        else if (bossType == MonsterType.FinalBossSimonPhase1 || bossType == MonsterType.FinalBossSimonPhase2)
        {
            // Simon: Multiple spread projectiles
            ApplySimonBuff(ctx, bossMonster.Value.monster_id, bossMonster.Value.entity_id);
            
            // Fire 3 projectiles in a spread pattern
            for (uint i = 0; i < 3; i++)
            {
                Module.TriggerBossAttackProjectile(ctx, bossMonster.Value.monster_id, AttackType.BossBolt, i);
            }
        }

        // Schedule next attack
        ctx.Db.boss_attack_timer.Insert(new BossAttackTimer
        {
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(600))
        });
        
        Log.Info("BossFireProjectile: Scheduled next attack");
    }

    // Helper to apply Simon's buff
    private static void ApplySimonBuff(ReducerContext ctx, uint monsterId, uint entityId)
    {
        // Increase speed and damage for a duration (e.g., 3 seconds)
        var monsterOpt = ctx.Db.monsters.monster_id.Find(monsterId);
        if (monsterOpt == null) return;
        var monster = monsterOpt.Value;
        monster.speed *= 1.1f; // Increase speed
        monster.atk *= 1.1f;   // Increase damage
        ctx.Db.monsters.monster_id.Update(monster);
    }

    // DEBUG/DEV ONLY: Reducer to spawn a specific boss for testing
    // bossTypeIndex: 0 = Jorge, 1 = Björn, 2 = Simon
    [Reducer]
    public static void DebugSpawnBoss(ReducerContext ctx, int bossTypeIndex, bool spawnPhaseTwo = false)
    {
        // SECURITY: Only allow in dev mode or for admin users!
        // (Add your own security check here if needed)

        // Check if there are any players online
        var playerCount = ctx.Db.player.Count;
        if (playerCount == 0)
        {
            Log.Info("No players online, not spawning boss.");
            return;
        }

        // Get game configuration for world size
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt == null)
        {
            throw new Exception("DebugSpawnBoss: Could not find game configuration!");
        }
        var config = configOpt.Value;

        // Get game state to update boss status
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt == null)
        {
            throw new Exception("DebugSpawnBoss: Could not find game state!");
        }

        // Select boss type based on argument
        MonsterType phase1Type;
        MonsterType phase2Type;
        switch (bossTypeIndex)
        {
            case 0:
                phase1Type = MonsterType.FinalBossJorgePhase1;
                phase2Type = MonsterType.FinalBossJorgePhase2;
                break;
            case 1:
                phase1Type = MonsterType.FinalBossBjornPhase1;
                phase2Type = MonsterType.FinalBossBjornPhase2;
                break;
            default:
                phase1Type = MonsterType.FinalBossSimonPhase1;
                phase2Type = MonsterType.FinalBossSimonPhase2;
                break;
        }

        // Calculate position at center of map
        float centerX = config.world_size / 2;
        float centerY = config.world_size / 2;
        DbVector2 centerPosition = new DbVector2(centerX, centerY);

        // Find the closest player to target
        uint closestPlayerId = 0;
        float closestDistance = float.MaxValue;
        string targetPlayerName = "unknown";
        foreach (var player in ctx.Db.player.Iter())
        {
            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (playerEntityOpt != null)
            {
                var playerEntity = playerEntityOpt.Value;
                float dx = playerEntity.position.x - centerPosition.x;
                float dy = playerEntity.position.y - centerPosition.y;
                float distanceSquared = dx * dx + dy * dy;
                if (distanceSquared < closestDistance)
                {
                    closestDistance = distanceSquared;
                    closestPlayerId = player.entity_id;
                    targetPlayerName = player.name;
                }
            }
        }

        if (!spawnPhaseTwo)
        {
            // --- PHASE 1 ---
            // Update game state to indicate boss is active and store selected boss type
            var gameState = gameStateOpt.Value;
            gameState.boss_active = true;
            gameState.boss_phase = 1;
            gameState.normal_spawning_paused = true;
            ctx.Db.game_state.id.Update(gameState);

            // Schedule the boss to spawn using the existing monster spawning system
            ScheduleBossSpawning(ctx, centerPosition, closestPlayerId, targetPlayerName, phase1Type);

            // Schedule the first boss attack timer (projectile)
            ctx.Db.boss_attack_timer.Insert(new BossAttackTimer
            {
                scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(600))
            });
        }
        else
        {
            // --- PHASE 2 ---
            // Use the same logic as SpawnBossPhaseTwo, but directly
            var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)phase2Type);
            if (bestiaryEntry == null)
            {
                throw new Exception($"DebugSpawnBoss: Could not find bestiary entry for boss phase 2!");
            }

            // Create boss entity at the center
            Entity? entityOpt = ctx.Db.entity.Insert(new Entity
            {
                position = centerPosition,
                direction = new DbVector2(0, 0),
                is_moving = false,
                radius = bestiaryEntry.Value.radius
            });
            if (entityOpt == null)
            {
                throw new Exception("DebugSpawnBoss: Failed to create entity for phase 2 boss!");
            }

            // Create the boss monster
            Monsters? monsterOpt = ctx.Db.monsters.Insert(new Monsters
            {
                entity_id = entityOpt.Value.entity_id,
                bestiary_id = phase2Type,
                hp = bestiaryEntry.Value.max_hp,
                max_hp = bestiaryEntry.Value.max_hp,
                atk = bestiaryEntry.Value.atk,
                speed = bestiaryEntry.Value.speed,
                target_entity_id = closestPlayerId
            });
            if (monsterOpt == null)
            {
                throw new Exception("DebugSpawnBoss: Failed to create phase 2 boss monster!");
            }

            // Update game state for phase 2
            var gameState = gameStateOpt.Value;
            gameState.boss_active = true;
            gameState.boss_phase = 2;
            gameState.boss_monster_id = monsterOpt.Value.monster_id;
            gameState.normal_spawning_paused = true;
            ctx.Db.game_state.id.Update(gameState);

            // Schedule the first boss attack timer (projectile)
            ctx.Db.boss_attack_timer.Insert(new BossAttackTimer
            {
                scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(600))
            });
        }
    }
}