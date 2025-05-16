using System.Data;
using System.Formats.Tar;
using SpacetimeDB;
using System.Numerics;

public static partial class Module
{
    // Define which monster types can spawn during normal gameplay (excludes bosses)
    private static readonly MonsterType[] SpawnableMonsterTypes = new MonsterType[]
    {
        MonsterType.Rat,
        MonsterType.Slime,
        MonsterType.Orc
        // Add new normal monster types here as they are created
        // Bosses are excluded from this list to prevent them from spawning randomly
    };
    
    [SpacetimeDB.Table(Name = "monsters", Public = true)]
    public partial struct Monsters
    {
        [PrimaryKey, AutoInc]
        public uint monster_id;

        // monster attributes
        public MonsterType bestiary_id;
        public uint hp;
        public uint max_hp; // Maximum HP copied from bestiary
        public float atk;
        public float speed;
        public uint target_player_id;
        public int target_player_ordinal_index;
        // entity attributes
        public DbVector2 position;  
        public float radius;     
    }

    private static readonly Monsters[] MonsterUpdatePool = new Monsters[MAX_ATTACK_COUNT];

    // Timer table for spawning monsters
    [Table(Name = "monster_spawn_timer", Scheduled = nameof(PreSpawnMonster), ScheduledAt = nameof(scheduled_at))]
    public partial struct MonsterSpawnTimer
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        public ScheduleAt scheduled_at;
    }
    
    // New table for monster spawners (scheduled)
    [Table(Name = "monster_spawners", Public = true, Scheduled = nameof(SpawnMonster), ScheduledAt = nameof(scheduled_at))]
    public partial struct MonsterSpawners
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        public DbVector2 position;          // Where the monster will spawn
        public MonsterType monster_type;    // The type of monster to spawn
        public ScheduleAt scheduled_at;     // When the monster will be spawned
    }

            // Table to track which monsters have been hit by which attacks
    [SpacetimeDB.Table(Name = "monster_damage", Public = true)]
    public partial struct MonsterDamage
    {
        [PrimaryKey, AutoInc]
        public uint damage_id;
        
        [SpacetimeDB.Index.BTree]
        public uint monster_id;       // The monster that was hit

        [SpacetimeDB.Index.BTree]
        public uint attack_entity_id; // The attack entity that hit the monster
    }

    // Scheduled table for monster hit cleanup
    [SpacetimeDB.Table(Name = "monster_hit_cleanup", 
                       Scheduled = nameof(CleanupMonsterHitRecord), 
                       ScheduledAt = nameof(scheduled_at))]
    public partial struct MonsterHitCleanup
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        public uint damage_id;        // The damage record to clean up
        public ScheduleAt scheduled_at; // When to clean up the record
    }
    
    [Reducer]
    public static void PreSpawnMonster(ReducerContext ctx, MonsterSpawnTimer timer)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer PreSpawnMonster may not be invoked by clients, only via scheduling.");
        }

        // Check if there are any players online
        var playerCount = ctx.Db.player.Count;
        if (playerCount == 0)
        {
            //Log.Info("PreSpawnMonster: No players online, skipping monster spawn.");
            return;
        }
        
        // Get game configuration
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt == null)
        {
            throw new Exception("PreSpawnMonster: Could not find game configuration!");
        }
        var config = configOpt.Value;
        
        // Check if boss fight is active - skip normal spawning during boss fights
        var gameStateOpt = ctx.Db.game_state.id.Find(0);
        if (gameStateOpt != null && (gameStateOpt.Value.boss_active || gameStateOpt.Value.normal_spawning_paused))
        {
            //Log.Info("PreSpawnMonster: Boss fight active, skipping normal monster spawn.");
            return;
        }
        
        // Check if we're at monster capacity
        var monsterCount = ctx.Db.monsters.Count;
        if (monsterCount >= config.max_monsters)
        {
            //Log.Info($"PreSpawnMonster: At maximum monster capacity ({monsterCount}/{config.max_monsters}), skipping spawn.");
            return;
        }
        
        // Get a random monster type FROM THE SPAWNABLE LIST (not from all monster types)
        var rng = ctx.Rng;
        var randomTypeIndex = rng.Next(0, SpawnableMonsterTypes.Length);
        var monsterType = SpawnableMonsterTypes[randomTypeIndex];
        
        Log.Info($"Selected monster type {monsterType} from spawnable list (index {randomTypeIndex} of {SpawnableMonsterTypes.Length} types)");
        
        // Get monster stats from bestiary using the monster type as numerical ID
        var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)monsterType);
        if (bestiaryEntry == null)
        {
            throw new Exception($"PreSpawnMonster: Could not find bestiary entry for monster type: {monsterType}");
        }
        
        // Choose a random player to spawn near
        var randomSkip = rng.Next(0, (int)playerCount);
        var targetPlayer = ctx.Db.player.Iter().Skip(randomSkip).First();
        
        // Calculate spawn position near the player (random direction, within 300-800 pixel radius)
        float spawnRadius = rng.Next(300, 801); // Distance from player
        float spawnAngle = (float)(rng.NextDouble() * Math.PI * 2); // Random angle in radians
        
        // Calculate spawn position
        DbVector2 position = new DbVector2(
            targetPlayer.position.x + spawnRadius * (float)Math.Cos(spawnAngle),
            targetPlayer.position.y + spawnRadius * (float)Math.Sin(spawnAngle)
        );
        
        // Clamp to world boundaries using monster radius
        float monsterRadius = bestiaryEntry.Value.radius;
        position.x = Math.Clamp(position.x, monsterRadius, config.world_size - monsterRadius);
        position.y = Math.Clamp(position.y, monsterRadius, config.world_size - monsterRadius);
        
        // Instead of immediately spawning the monster, schedule it for actual spawning
        // with a delay to give the player time to respond
        const int PRE_SPAWN_DELAY_MS = 2000; // 2 seconds warning before monster spawns
        
        ctx.Db.monster_spawners.Insert(new MonsterSpawners
        {
            position = position,
            monster_type = monsterType,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(PRE_SPAWN_DELAY_MS))
        });
        
        Log.Info($"PreSpawned {monsterType} monster for position ({position.x}, {position.y}) for player: {targetPlayer.name}. Will spawn in {PRE_SPAWN_DELAY_MS}ms");
    }
    
    [Reducer]
    public static void SpawnMonster(ReducerContext ctx, MonsterSpawners spawner)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer SpawnMonster may not be invoked by clients, only via scheduling.");
        }

        // Double-check if there are still players online
        var playerCount = ctx.Db.player.Count;
        if (playerCount == 0)
        {
            Log.Info("SpawnMonster: No players online, skipping monster spawn.");
            return;
        }
        
        // Get game configuration
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt == null)
        {
            throw new Exception("SpawnMonster: Could not find game configuration!");
        }
        var config = configOpt.Value;
        
        // Check if we're at monster capacity (player could have spawned during delay)
        var monsterCount = ctx.Db.monsters.Count;
        if (monsterCount >= config.max_monsters)
        {
            //TODO: If we're at monster capacity, we need to make sure we can still spawn the boss.
            Log.Info($"SpawnMonster: At maximum monster capacity ({monsterCount}/{config.max_monsters}), skipping spawn.");
            return;
        }
        
        // Get monster stats from bestiary using the monster type as numerical ID
        var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)spawner.monster_type);
        if (bestiaryEntry == null)
        {
            throw new Exception($"SpawnMonster: Could not find bestiary entry for monster type: {spawner.monster_type}");
        }
        
        // Find the closest player to target
        (uint closestPlayerId, int closestPlayerOrdinalIndex) = GetClosestPlayer(ctx, spawner.position);
        
        // Create the monster
        Monsters? monsterOpt = ctx.Db.monsters.Insert(new Monsters
        {
            bestiary_id = spawner.monster_type,
            hp = bestiaryEntry.Value.max_hp,
            max_hp = bestiaryEntry.Value.max_hp,
            atk = bestiaryEntry.Value.atk,
            speed = bestiaryEntry.Value.speed,
            target_player_id = closestPlayerId,
            target_player_ordinal_index = closestPlayerOrdinalIndex,
            position = spawner.position,
            radius = bestiaryEntry.Value.radius
        });
        
        if (monsterOpt is null)
        {
            throw new Exception("SpawnMonster: Failed to create monster!");
        }

        Log.Info($"Spawned {spawner.monster_type} monster. Total monsters: {ctx.Db.monsters.Count}");
        
        // If this is a boss monster, update the game state with its ID
        if (spawner.monster_type == MonsterType.FinalBossPhase1 || spawner.monster_type == MonsterType.FinalBossPhase2)
        {
            Log.Info($"Boss monster of type {spawner.monster_type} created with ID {monsterOpt.Value.monster_id}");
            UpdateBossMonsterID(ctx, monsterOpt.Value.monster_id);
        }
    }

    private static (uint, int) GetClosestPlayer(ReducerContext ctx, DbVector2 position)
    {
        uint closestPlayerId = 0;
        int closestPlayerOrdinalIndex = -1;
        float closestDistance = float.MaxValue;
        
        foreach (var player in ctx.Db.player.Iter())
        {
            // Calculate distance to this player
            float dx = player.position.x - position.x;
            float dy = player.position.y - position.y;
            float distanceSquared = dx * dx + dy * dy;
            
            // Update closest player if this one is closer
            if (distanceSquared < closestDistance)
            {
                closestDistance = distanceSquared;
                closestPlayerId = player.player_id;
                closestPlayerOrdinalIndex = player.ordinal_index;
            }
        }

        //Pair of closest player and its ordinal index
        return (closestPlayerId, closestPlayerOrdinalIndex);
    }
    
    // Method to schedule monster spawning - called from Init in Lib.cs
    public static void ScheduleMonsterSpawning(ReducerContext ctx)
    {
        Log.Info("Scheduling monster spawning...");
        
        // Schedule monster spawning every 5 seconds
        ctx.Db.monster_spawn_timer.Insert(new MonsterSpawnTimer
        {
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromSeconds(0.2))
        });
        
        Log.Info("Monster spawning scheduled successfully");
    }

    private static void ProcessMonsterMovements(ReducerContext ctx)
    {
        PopulateMonsterCache(ctx);
        //MoveMonsters(ctx);
        //MoveMonstersWithLookupTable(ctx);
        MoveMonstersVectorized(ctx);
        //MoveMonstersSimple(ctx);
        CalculateMonsterSpatialHashGrid(ctx);
        SolveMonsterRepulsionSpatialHash(ctx);
        CalculateMonsterSpatialHashGrid(ctx);
        CommitMonsterMotion(ctx);
    }

    // Helper method to process monster movements
    private static void MoveMonsters(ReducerContext ctx)
    {
        // Constants for monster behavior
        const float MIN_DISTANCE_TO_MOVE = 20.0f;  // Minimum distance before monster starts moving
        const float MIN_DISTANCE_TO_REACH = 5.0f;  // Distance considered "reached" the target

        const float MIN_DISTANCE_TO_MOVE_SQUARED = MIN_DISTANCE_TO_MOVE * MIN_DISTANCE_TO_MOVE;
        const float MIN_DISTANCE_TO_REACH_SQUARED = MIN_DISTANCE_TO_REACH * MIN_DISTANCE_TO_REACH;


        // Get world size from config
        uint worldSize = 20000; // Default fallback (10x larger)
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            worldSize = configOpt.Value.world_size;
        }

        // Now process each monster's movement with collision avoidance
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            // Populate the monster cache
            KeysMonster[CachedCountMonsters] = monster.monster_id;
            PosXMonster[CachedCountMonsters] = monster.position.x;
            PosYMonster[CachedCountMonsters] = monster.position.y;
            RadiusMonster[CachedCountMonsters] = monster.radius;

            int targetPlayerOrdinalIndex = monster.target_player_ordinal_index;

            // Move the monster to the target player
            if (targetPlayerOrdinalIndex != -1)
            {
                float dx = PosXPlayer[targetPlayerOrdinalIndex] - monster.position.x;
                float dy = PosYPlayer[targetPlayerOrdinalIndex] - monster.position.y;
                
                // Calculate distance to target
                float distanceToTargetSquared = dx * dx + dy * dy;
                
                // If we're too close to the target, stop moving
                if (distanceToTargetSquared > MIN_DISTANCE_TO_REACH_SQUARED && distanceToTargetSquared > MIN_DISTANCE_TO_MOVE_SQUARED)
                {
                    float approxLength = FastInvSqrt(distanceToTargetSquared);

                    float normX = dx * approxLength;
                    float normY = dy * approxLength;
                    
                    // Get monster speed from bestiary
                    float monsterSpeed = monster.speed;
                    
                    // Calculate new position based on direction, speed and time delta
                    float moveDistance = monsterSpeed * DELTA_TIME;
                    var moveX = normX * moveDistance;
                    var moveY = normY * moveDistance;

                    PosXMonster[CachedCountMonsters] += moveX;
                    PosYMonster[CachedCountMonsters] += moveY;

                    // Apply world boundary clamping using entity radius
                    PosXMonster[CachedCountMonsters] = Math.Clamp(
                        PosXMonster[CachedCountMonsters], 
                        monster.radius, 
                        worldSize - monster.radius
                    );
                    PosYMonster[CachedCountMonsters] = Math.Clamp(
                        PosYMonster[CachedCountMonsters], 
                        monster.radius, 
                        worldSize - monster.radius
                    );
                }
            }
            else
            {
                // Target entity no longer exists - find a new target
                ReassignMonsterTarget(ctx, monster);
            }
    
            CachedCountMonsters++;
        }
    }

    private static void MoveMonstersWithLookupTable(ReducerContext ctx)
    {
        // Constants for monster behavior
        const float MIN_DISTANCE_TO_MOVE = 20.0f;  // Minimum distance before monster starts moving
        const float MIN_DISTANCE_TO_REACH = 5.0f;  // Distance considered "reached" the target

        const float MIN_DISTANCE_TO_MOVE_SQUARED = MIN_DISTANCE_TO_MOVE * MIN_DISTANCE_TO_MOVE;
        const float MIN_DISTANCE_TO_REACH_SQUARED = MIN_DISTANCE_TO_REACH * MIN_DISTANCE_TO_REACH;


        // Get world size from config
        uint worldSize = 20000; // Default fallback (10x larger)
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            worldSize = configOpt.Value.world_size;
        }

        // Now process each monster's movement with collision avoidance
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            // Populate the monster cache
            KeysMonster[CachedCountMonsters] = monster.monster_id;
            PosXMonster[CachedCountMonsters] = monster.position.x;
            PosYMonster[CachedCountMonsters] = monster.position.y;
            RadiusMonster[CachedCountMonsters] = monster.radius;

            int targetPlayerOrdinalIndex = monster.target_player_ordinal_index;

            int myCell = GetWorldCellFromPosition(monster.position.x, monster.position.y);

            // Move the monster to the target player
            if (targetPlayerOrdinalIndex != -1)
            {
                int targetCell = GetWorldCellFromPosition(PosXPlayer[targetPlayerOrdinalIndex], PosYPlayer[targetPlayerOrdinalIndex]);

                //If not in same cell, use the vector field to move the monster
                if (myCell != targetCell)
                {
                    //lookup the direction to the target cell
                    
                    int _x_cell = myCell & WORLD_CELL_MASK;
                    int _y_cell = myCell >> WORLD_CELL_BIT_SHIFT;

                    int _x_target_cell = targetCell & WORLD_CELL_MASK;
                    int _y_target_cell = targetCell >> WORLD_CELL_BIT_SHIFT;

                    int _dx = _x_target_cell - _x_cell + LookupTableRange;
                    int _dy = _y_target_cell - _y_cell + LookupTableRange;

                    //Log.Info($"lookup direction for {_dx },{_dy}");
                    var dir_x = LookupTableX[_dy, _dx];
                    var dir_y = LookupTableY[_dy, _dx];

                    //move the monster in the direction of the target cell
                    PosXMonster[CachedCountMonsters] += dir_x * monster.speed * DELTA_TIME;
                    PosYMonster[CachedCountMonsters] += dir_y * monster.speed * DELTA_TIME;
                }
                else
                {
                    //If in same cell, move more precisely towards the target
                    float dx = PosXPlayer[targetPlayerOrdinalIndex] - monster.position.x;
                    float dy = PosYPlayer[targetPlayerOrdinalIndex] - monster.position.y;

                    float distanceToTargetSquared = dx * dx + dy * dy;
                    
                    // If we're too close to the target, stop moving
                    if (distanceToTargetSquared > MIN_DISTANCE_TO_REACH_SQUARED && distanceToTargetSquared > MIN_DISTANCE_TO_MOVE_SQUARED)
                    {
                        float approxLength = FastInvSqrt(distanceToTargetSquared);

                        float normX = dx * approxLength;
                        float normY = dy * approxLength;
                        
                        // Get monster speed from bestiary
                        float monsterSpeed = monster.speed;
                        
                        // Calculate new position based on direction, speed and time delta
                        float moveDistance = monsterSpeed * DELTA_TIME;
                        var moveX = normX * moveDistance;
                        var moveY = normY * moveDistance;

                        PosXMonster[CachedCountMonsters] += moveX;
                        PosYMonster[CachedCountMonsters] += moveY;

                        // Apply world boundary clamping using entity radius
                        PosXMonster[CachedCountMonsters] = Math.Clamp(
                            PosXMonster[CachedCountMonsters], 
                            monster.radius, 
                            worldSize - monster.radius
                        );
                        PosYMonster[CachedCountMonsters] = Math.Clamp(
                            PosYMonster[CachedCountMonsters], 
                            monster.radius, 
                            worldSize - monster.radius
                        );
                    }
                }
            }
            else
            {
                // Target entity no longer exists - find a new target
                ReassignMonsterTarget(ctx, monster);
            }
    
            CachedCountMonsters++;
        }
    }

    private static void MoveMonstersVectorized(ReducerContext ctx)
    {
        for(int i = 0; i < CachedCountMonsters; i += 1)
        {
            int myCell = CellMonster[i];
            int tpoi = CachedTargetPlayerOrdinalIndex[i];
            int targetCell = (tpoi != -1) ? CellPlayer[tpoi] : 0;

            int _x_cell = myCell & WORLD_CELL_MASK;
            int _y_cell = myCell >> WORLD_CELL_BIT_SHIFT;

            int _x_target_cell = targetCell & WORLD_CELL_MASK;
            int _y_target_cell = targetCell >> WORLD_CELL_BIT_SHIFT;

            int _dx = _x_target_cell - _x_cell + LookupTableRange;
            int _dy = _y_target_cell - _y_cell + LookupTableRange;

            //Log.Info($"lookup direction for {_dx },{_dy}");
            var dir_x = LookupTableX[_dy, _dx];
            var dir_y = LookupTableY[_dy, _dx];

            //move the monster in the direction of the target cell
            PosXMonster[i] += dir_x * SpeedMonster[i] * DELTA_TIME;
            PosYMonster[i] += dir_y * SpeedMonster[i] * DELTA_TIME;
        }

        for(int i = 0; i < CachedCountMonsters; i += 1)
        {
            if(CachedTargetPlayerOrdinalIndex[i] == -1)
            {
                var monster = ctx.Db.monsters.monster_id.Find(KeysMonster[i]);
                if(monster is not null)
                {
                    ReassignMonsterTarget(ctx, monster.Value);
                }
            }
        }
    }

    private static void CalculateMonsterSpatialHashGrid(ReducerContext ctx)
    {
        // Reset the spatial hash grid
        Array.Fill(HeadsMonster, -1);
        Array.Fill(NextsMonster, -1);

        // Calculate the spatial hash grid
        for(var mid = 0; mid < CachedCountMonsters; mid++)
        {
            ushort gridCellKey = GetWorldCellFromPosition(PosXMonster[mid], PosYMonster[mid]);
            NextsMonster[mid] = HeadsMonster[gridCellKey];
            HeadsMonster[gridCellKey] = mid;
        }
    }   

    private static void MoveMonstersSimple(ReducerContext ctx)
    {
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            KeysMonster[CachedCountMonsters] = monster.monster_id;
            PosXMonster[CachedCountMonsters] = monster.position.x + 1.0f;
            PosYMonster[CachedCountMonsters] = monster.position.y + 1.0f;
            RadiusMonster[CachedCountMonsters] = monster.radius;
    
            CachedCountMonsters++;
        }
    }

    private static void PopulateMonsterCache(ReducerContext ctx)
    {
        CachedCountMonsters = 0;

        foreach (var monster in ctx.Db.monsters.Iter())
        {
            CachedTargetPlayerOrdinalIndex[CachedCountMonsters] = monster.target_player_ordinal_index;

            KeysMonster[CachedCountMonsters] = monster.monster_id;
            PosXMonster[CachedCountMonsters] = monster.position.x;
            PosYMonster[CachedCountMonsters] = monster.position.y;
            RadiusMonster[CachedCountMonsters] = monster.radius;
            SpeedMonster[CachedCountMonsters] = monster.speed;

            ushort gridCellKey = GetWorldCellFromPosition(monster.position.x, monster.position.y);
            CellMonster[CachedCountMonsters] = gridCellKey;
            NextsMonster[CachedCountMonsters] = HeadsMonster[gridCellKey];
            HeadsMonster[gridCellKey] = CachedCountMonsters;
    
            CachedCountMonsters++;
        }
    }   

    private static void CommitMonsterMotion(ReducerContext ctx)
    {
        uint monsterCacheIdx = 0;
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            var monsterUpdated = MonsterUpdatePool[monsterCacheIdx];

            monsterUpdated.monster_id = monster.monster_id;
            monsterUpdated.bestiary_id = monster.bestiary_id;
            monsterUpdated.hp = monster.hp;
            monsterUpdated.max_hp = monster.max_hp;
            monsterUpdated.atk = monster.atk;
            monsterUpdated.speed = monster.speed;
            monsterUpdated.target_player_id = monster.target_player_id;
            monsterUpdated.target_player_ordinal_index = monster.target_player_ordinal_index;
            monsterUpdated.position.x = PosXMonster[monsterCacheIdx];
            monsterUpdated.position.y = PosYMonster[monsterCacheIdx];
            monsterUpdated.radius = monster.radius;

            ctx.Db.monsters.monster_id.Update(monsterUpdated);
            monsterCacheIdx++;
        }
    }
    
    // Helper method to reassign a monster's target when original target is gone
    private static void ReassignMonsterTarget(ReducerContext ctx, Monsters monster)
    {
        // Find a new target among existing players
        var playerCount = ctx.Db.player.Count;
        if (playerCount == 0)
        {
            return;
        }
        
        // Choose a random player as the new target
        var rng = ctx.Rng;
        // Can we pull from cached players instead?
        var randomIndex = rng.Next(0, (int)playerCount);
        var newTarget = ctx.Db.player.Iter().ElementAt(randomIndex);
        
        // Update the monster with the new target
        var updatedMonster = monster;
        updatedMonster.target_player_id = newTarget.player_id;
        updatedMonster.target_player_ordinal_index = newTarget.ordinal_index;
        ctx.Db.monsters.monster_id.Update(updatedMonster);
    }

    // Helper method to process collisions between attacks and monsters using spatial hash
    private static void ProcessMonsterAttackCollisionsSpatialHash(ReducerContext ctx)
    {
        for(var aid = 0; aid < CachedCountAttacks; aid++)
        {
            var ax = PosXAttack[aid];
            var ay = PosYAttack[aid];
            var ar = RadiusAttack[aid];

            bool attackHitMonster = false;

            // Check against all monsters in the same spatial hash cell
            var cellKey = GetWorldCellFromPosition(ax, ay);

            int cx =  cellKey & WORLD_CELL_MASK;
            int cy = cellKey >> WORLD_CELL_BIT_SHIFT;

            ActiveAttack? currentAttackData = null;
            bool activeAttackIsPiercing = false;

            for (int dy = -1; dy <= +1; ++dy)
            {
                int ny = cy + dy;
                if ((uint)ny >= WORLD_GRID_HEIGHT) continue;   // unsigned trick == clamp

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

                        if(SpatialHashCollisionChecker(ax, ay, ar, mx, my, mr))
                        {
                            // Get the active attack data
                            if(currentAttackData is null)
                            {
                                var activeAttackOpt = ctx.Db.active_attacks.active_attack_id.Find(KeysAttack[aid]);
                                if(activeAttackOpt is null)
                                {
                                    continue;
                                }
                                currentAttackData = activeAttackOpt.Value;
                            }

                            var activeAttack = currentAttackData.Value;
                            activeAttackIsPiercing = activeAttack.piercing;

                            // Check if this monster has already been hit by this attack
                            if (HasMonsterBeenHitByAttack(ctx, KeysMonster[mid], activeAttack.entity_id))
                            {
                                continue; // Skip if monster already hit by this attack
                            }
                            
                            // Record the hit
                            RecordMonsterHitByAttack(ctx, KeysMonster[mid], activeAttack.entity_id);
                            
                            // Apply damage to monster using the active attack's damage value
                            uint damage = activeAttack.damage;
                            bool monsterKilled = DamageMonster(ctx, KeysMonster[mid], damage);
                            attackHitMonster = true;
                            
                            // For non-piercing attacks, stop checking other monsters and destroy the attack
                            if (activeAttackIsPiercing)
                            {
                                break;
                            }
                        }
                    }

                    // If attack hit a monster and it's not piercing, break out of the cell checks
                    if (attackHitMonster && !activeAttackIsPiercing)
                    {
                        break;
                    }
                }

                // If attack hit a monster and it's not piercing, break out of the cell checks
                if (attackHitMonster && !activeAttackIsPiercing)
                {
                    break;
                }
            }
            
            // If the attack hit a monster and it's not piercing, remove the attack
            if (attackHitMonster && !activeAttackIsPiercing && currentAttackData is not null)
            {
                var activeAttack = currentAttackData.Value;

                // Delete the attack entity
                ctx.Db.entity.entity_id.Delete(activeAttack.entity_id);
                
                // Delete the active attack record
                ctx.Db.active_attacks.active_attack_id.Delete(activeAttack.active_attack_id);
                
                // Clean up any damage records for this attack
                CleanupAttackDamageRecords(ctx, activeAttack.entity_id);
            }
        }
    }

    private static void SolveMonsterRepulsionSpatialHash(ReducerContext ctx)
    {
        for (int iA = 0; iA < CachedCountMonsters; ++iA)
        {
            float ax = PosXMonster[iA];
            float ay = PosYMonster[iA];
            float rA = RadiusMonster[iA];

            int keyA = GetWorldCellFromPosition(ax, ay);
            int cx   =  keyA & WORLD_CELL_MASK;
            int cy   = keyA >> WORLD_CELL_BIT_SHIFT;

            // ------------------------------------------------------------------
            for (int dy = -1; dy <= +1; ++dy)
            {
                int ny = cy + dy;
                if ((uint)ny >= WORLD_GRID_HEIGHT) continue;

                int rowBase = ny << WORLD_CELL_BIT_SHIFT;
                for (int dx = -1; dx <= +1; ++dx)
                {
                    int nx = cx + dx;
                    if ((uint)nx >= WORLD_GRID_WIDTH) continue;

                    int key = rowBase | nx;

                    for (int iB = HeadsMonster[key];
                        iB != -1;
                        iB  = NextsMonster[iB])
                    {
                        if (iB <= iA) continue;          // unordered pair once

                        float dxAB = ax - PosXMonster[iB];
                        float dyAB = ay - PosYMonster[iB];
                        float d2   = dxAB * dxAB + dyAB * dyAB;

                        float rSum  = rA + RadiusMonster[iB];
                        float rSum2 = rSum * rSum;
                        if (d2 >= rSum2) continue;       // no overlap

                        // ---- penetration & normal (inv-sqrt) -----------------
                        float invLen      = FastInvSqrt(d2);
                        float penetration = rSum - (1.0f * invLen);   // rSum − √d2
                        float nxAB        = dxAB * invLen;
                        float nyAB        = dyAB * invLen;

                        // ---- split the push: heavier = larger radius ----------
                        //   wA = rB / (rA + rB)   ,   wB = rA / (rA + rB)
                        float wA = RadiusMonster[iB] / rSum;
                        float wB = rA / rSum;

                        float pushFactor = 0.75f;

                        PosXMonster[iA] += nxAB * penetration * wA * pushFactor;
                        PosYMonster[iA] += nyAB * penetration * wA * pushFactor;
                        PosXMonster[iB] -= nxAB * penetration * wB * pushFactor;
                        PosYMonster[iB] -= nyAB * penetration * wB * pushFactor;
                    }
                }
            }
        }
    }

    // Helper function to check if a monster has already been hit by an attack
    private static bool HasMonsterBeenHitByAttack(ReducerContext ctx, uint monsterId, uint attackEntityId)
    {
        // First filter: Use the BTree index to efficiently find all damage records for this attack
        var attackDamageRecords = ctx.Db.monster_damage.attack_entity_id.Filter(attackEntityId);
        
        // Second filter: Check if any of those records match our monster
        foreach (var damage in attackDamageRecords)
        {
            if (damage.monster_id == monsterId)
            {
                return true; // Found a record - this monster was hit by this attack
            }
        }
        
        return false; // No matching record found
    }

    // Helper function to record a monster being hit by an attack
    private static void RecordMonsterHitByAttack(ReducerContext ctx, uint monsterId, uint attackEntityId)
    {
        // Insert the damage record
        MonsterDamage? damageRecord = ctx.Db.monster_damage.Insert(new MonsterDamage
        {
            monster_id = monsterId,
            attack_entity_id = attackEntityId
        });
        
        if (damageRecord == null)
        {
            Log.Error($"Failed to insert monster damage record for monster {monsterId}, attack {attackEntityId}");
            return;
        }
        
        // Get cleanup delay from config
        uint cleanupDelay = 500; // Default to 500ms if config not found
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            cleanupDelay = configOpt.Value.monster_hit_cleanup_delay;
        }
        
        // Schedule cleanup after the configured delay
        ctx.Db.monster_hit_cleanup.Insert(new MonsterHitCleanup
        {
            damage_id = damageRecord.Value.damage_id,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(cleanupDelay))
        });
        
        Log.Info($"Recorded monster {monsterId} hit by attack {attackEntityId}, cleanup scheduled in {cleanupDelay}ms");
    }

        // Reducer to clean up a monster hit record
    [Reducer]
    public static void CleanupMonsterHitRecord(ReducerContext ctx, MonsterHitCleanup cleanup)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("CleanupMonsterHitRecord may not be invoked by clients, only via scheduling.");
        }
        
        // Delete the damage record
        ctx.Db.monster_damage.damage_id.Delete(cleanup.damage_id);
    }
}