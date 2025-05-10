using System.Formats.Tar;
using SpacetimeDB;

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

        [Unique]
        public uint entity_id;

        public MonsterType bestiary_id;
        
        // monster attributes
        public uint hp;
        public uint max_hp; // Maximum HP copied from bestiary
        public float atk;
        public float speed;
        
        // target entity id the monster is following
        public uint target_entity_id;
    }

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
        public uint target_entity_id;       // The player entity ID to target
        public ScheduleAt scheduled_at;     // When the monster will be spawned
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
        
        // Get the player's entity for position
        var playerEntityOpt = ctx.Db.entity.entity_id.Find(targetPlayer.entity_id);
        if (playerEntityOpt == null)
        {
            Log.Info($"PreSpawnMonster: Could not find entity for player {targetPlayer.name}");
            return;
        }
        var playerEntity = playerEntityOpt.Value;
        
        // Calculate spawn position near the player (random direction, within 300-800 pixel radius)
        float spawnRadius = rng.Next(300, 801); // Distance from player
        float spawnAngle = (float)(rng.NextDouble() * Math.PI * 2); // Random angle in radians
        
        // Calculate spawn position
        DbVector2 position = new DbVector2(
            playerEntity.position.x + spawnRadius * (float)Math.Cos(spawnAngle),
            playerEntity.position.y + spawnRadius * (float)Math.Sin(spawnAngle)
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
            target_entity_id = targetPlayer.entity_id,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(PRE_SPAWN_DELAY_MS))
        });
        
        Log.Info($"PreSpawned {monsterType} monster for position ({position.x}, {position.y}) targeting player: {targetPlayer.name}. Will spawn in {PRE_SPAWN_DELAY_MS}ms");
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
            Log.Info($"SpawnMonster: At maximum monster capacity ({monsterCount}/{config.max_monsters}), skipping spawn.");
            return;
        }
        
        // Get monster stats from bestiary using the monster type as numerical ID
        var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)spawner.monster_type);
        if (bestiaryEntry == null)
        {
            throw new Exception($"SpawnMonster: Could not find bestiary entry for monster type: {spawner.monster_type}");
        }
        
        // Create an entity for the monster using the pre-determined position
        Entity? entityOpt = ctx.Db.entity.Insert(new Entity
        {
            position = spawner.position,
            direction = new DbVector2(0, 0), // Initial direction
            is_moving = false,  // Not moving initially
            radius = bestiaryEntry.Value.radius // Set radius from bestiary entry
        });
        
        if (entityOpt == null)
        {
            throw new Exception("SpawnMonster: Failed to create entity for monster!");
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
                // Calculate distance to this player
                var playerEntity = playerEntityOpt.Value;
                float dx = playerEntity.position.x - spawner.position.x;
                float dy = playerEntity.position.y - spawner.position.y;
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
        
        // Create the monster
        Monsters? monsterOpt = ctx.Db.monsters.Insert(new Monsters
        {
            entity_id = entityOpt.Value.entity_id,
            bestiary_id = spawner.monster_type,
            hp = bestiaryEntry.Value.max_hp,
            max_hp = bestiaryEntry.Value.max_hp, // Store max_hp from bestiary
            atk = bestiaryEntry.Value.atk,
            speed = bestiaryEntry.Value.speed,
            target_entity_id = closestPlayerId
        });
        
        if (monsterOpt is null)
        {
            throw new Exception("SpawnMonster: Failed to create monster!");
        }

        Log.Info($"Spawned {spawner.monster_type} monster (entity: {entityOpt.Value.entity_id}) targeting player: {targetPlayerName} with HP: {bestiaryEntry.Value.max_hp}/{bestiaryEntry.Value.max_hp}");
        Log.Info($"Total monsters: {ctx.Db.monsters.Count}");
        
        // If this is a boss monster, update the game state with its ID
        if (spawner.monster_type == MonsterType.FinalBossPhase1 || spawner.monster_type == MonsterType.FinalBossPhase2)
        {
            Log.Info($"Boss monster of type {spawner.monster_type} created with ID {monsterOpt.Value.monster_id}");
            UpdateBossMonsterID(ctx, monsterOpt.Value.monster_id);
        }
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

    // Helper method to process monster movements
    private static void ProcessMonsterMovements(ReducerContext ctx)
    {
        // Constants for monster behavior
        const float MIN_DISTANCE_TO_MOVE = 20.0f;  // Minimum distance before monster starts moving
        const float MIN_DISTANCE_TO_REACH = 5.0f;  // Distance considered "reached" the target
        
        // Now process each monster's movement with collision avoidance
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            if(monsterEntityOpt == null)
            {
                continue;
            }
            var monsterEntity = monsterEntityOpt.Value;

            // Get the target entity
            var targetEntityOpt = ctx.Db.entity.entity_id.Find(monster.target_entity_id);
            if (targetEntityOpt == null)
            {
                // Target entity no longer exists - find a new target
                ReassignMonsterTarget(ctx, monster);
            }
            else
            {
                var targetEntity = targetEntityOpt.Value;
                
                // Calculate direction vector from monster to target
                var directionVector = new DbVector2(
                    targetEntity.position.x - monsterEntity.position.x,
                    targetEntity.position.y - monsterEntity.position.y
                );
                
                // Calculate distance to target
                float distanceToTarget = directionVector.Magnitude();
                
                // If we're too close to the target, stop moving
                if (distanceToTarget < MIN_DISTANCE_TO_REACH)
                {
                    // Monster reached the target, stop moving
                    if (monsterEntity.is_moving)
                    {
                        var stoppedEntity = monsterEntity;
                        stoppedEntity.is_moving = false;
                        stoppedEntity.direction = new DbVector2(0, 0);
                        ctx.Db.entity.entity_id.Update(stoppedEntity);
                    }
                }
                else
                {
                    // If we're far enough from the target, start moving
                    if (distanceToTarget > MIN_DISTANCE_TO_MOVE)
                    {
                        // Normalize the direction vector to get base movement direction
                        var normalizedDirection = directionVector.Normalize();
                        
                        // Get monster speed from bestiary
                        float monsterSpeed = monster.speed * 0.0f;
                        
                        // Calculate new position based on direction, speed and time delta
                        float moveDistance = monsterSpeed * DELTA_TIME;
                        var moveOffset = normalizedDirection * moveDistance;
                        
                        // Update entity with new direction and position
                        var updatedEntity = monsterEntity;
                        updatedEntity.direction = normalizedDirection;
                        updatedEntity.is_moving = true;
                        updatedEntity.position = monsterEntity.position + moveOffset;
                        
                        // Get world size from config
                        uint worldSize = 20000; // Default fallback (10x larger)
                        var configOpt = ctx.Db.config.id.Find(0);
                        if (configOpt != null)
                        {
                            worldSize = configOpt.Value.world_size;
                        }
                        
                        // Apply world boundary clamping using entity radius
                        updatedEntity.position.x = Math.Clamp(
                            updatedEntity.position.x, 
                            updatedEntity.radius, 
                            worldSize - updatedEntity.radius
                        );
                        updatedEntity.position.y = Math.Clamp(
                            updatedEntity.position.y, 
                            updatedEntity.radius, 
                            worldSize - updatedEntity.radius
                        );
                        
                        // Update entity in database
                        ctx.Db.entity.entity_id.Update(updatedEntity);
                    }
                }
            }

            //Update collision cache
            KeysMonster[CachedCountMonsters] = monster.monster_id;
            PosXMonster[CachedCountMonsters] = monsterEntity.position.x;
            PosYMonster[CachedCountMonsters] = monsterEntity.position.y;
            RadiusMonster[CachedCountMonsters] = monsterEntity.radius;

            ushort gridCellKey = GetWorldCellFromPosition(monsterEntity.position.x, monsterEntity.position.y);
            NextsMonster[CachedCountMonsters] = HeadsMonster[gridCellKey];
            HeadsMonster[gridCellKey] = CachedCountMonsters;
    
            CachedCountMonsters++;
        }
    }

    private static void ProcessMonsterMotionSimple(ReducerContext ctx)
    {
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            if(monsterEntityOpt == null)
            {
                continue;
            }
            var monsterEntity = monsterEntityOpt.Value;

            //monsterEntity.position.x += 1.0f;
            //monsterEntity.position.y += 1.0f;

            KeysMonster[CachedCountMonsters] = monster.monster_id;
            PosXMonster[CachedCountMonsters] = monsterEntity.position.x;
            PosYMonster[CachedCountMonsters] = monsterEntity.position.y;
            RadiusMonster[CachedCountMonsters] = monsterEntity.radius;

            ushort gridCellKey = GetWorldCellFromPosition(monsterEntity.position.x, monsterEntity.position.y);
            NextsMonster[CachedCountMonsters] = HeadsMonster[gridCellKey];
            HeadsMonster[gridCellKey] = CachedCountMonsters;
    
            CachedCountMonsters++;

            //ctx.Db.entity.entity_id.Update(monsterEntity);
        }
    }
    
    // Helper method to reassign a monster's target when original target is gone
    private static void ReassignMonsterTarget(ReducerContext ctx, Monsters monster)
    {
        // Find a new target among existing players
        var players = ctx.Db.player.Iter().ToArray();
        if (players.Length == 0)
        {
            // Make the monster stop moving
            var entityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            if (entityOpt != null)
            {
                var entity = entityOpt.Value;
                entity.is_moving = false;
                entity.direction = new DbVector2(0, 0);
                ctx.Db.entity.entity_id.Update(entity);
            }
            return;
        }
        
        // Choose a random player as the new target
        var rng = ctx.Rng;
        var randomIndex = rng.Next(0, players.Length);
        var newTarget = players[randomIndex];
        
        // Update the monster with the new target
        var updatedMonster = monster;
        updatedMonster.target_entity_id = newTarget.entity_id;
        ctx.Db.monsters.monster_id.Update(updatedMonster);
    }

    // Helper method to process collisions between attacks and monsters
    private static void ProcessMonsterAttackCollisions(ReducerContext ctx)
    {        
        // Check each active attack for collisions with monsters
        foreach (var activeAttack in ctx.Db.active_attacks.Iter())
        {
            // Get the attack entity
            var attackEntityOpt = ctx.Db.entity.entity_id.Find(activeAttack.entity_id);
            if (attackEntityOpt is null)
            {
                continue; // Skip if entity not found
            }
            
            var attackEntity = attackEntityOpt.Value;
            
            bool attackHitMonster = false;
            
            // Check for collisions with monsters
            foreach (var monsterEntry in ctx.Db.monsters.Iter())
            {
                var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monsterEntry.entity_id);
                if(monsterEntityOpt == null)
                {
                    continue;
                }
                Entity monsterEntity = monsterEntityOpt.Value;
                
                // Check if the attack is colliding with this monster
                if (AreEntitiesColliding(attackEntity, monsterEntity))
                {
                    // Check if this monster has already been hit by this attack
                    if (HasMonsterBeenHitByAttack(ctx, monsterEntry.monster_id, attackEntity.entity_id))
                    {
                        continue; // Skip if monster already hit by this attack
                    }
                    
                    // Record the hit
                    RecordMonsterHitByAttack(ctx, monsterEntry.monster_id, attackEntity.entity_id);
                    
                    // Apply damage to monster using the active attack's damage value
                    uint damage = activeAttack.damage;
                    
                    // Apply armor piercing if needed
                    // (Not implemented in this version)
                    
                    bool monsterKilled = DamageMonster(ctx, monsterEntry.monster_id, damage);
                    attackHitMonster = true;
                    
                    // For non-piercing attacks, stop checking other monsters and destroy the attack
                    if (!activeAttack.piercing)
                    {
                        break;
                    }
                }
            }
            
            // If the attack hit a monster and it's not piercing, remove the attack
            if (attackHitMonster && !activeAttack.piercing)
            {
                // Delete the attack entity
                ctx.Db.entity.entity_id.Delete(attackEntity.entity_id);
                
                // Delete the active attack record
                ctx.Db.active_attacks.active_attack_id.Delete(activeAttack.active_attack_id);
                
                // Clean up any damage records for this attack
                CleanupAttackDamageRecords(ctx, attackEntity.entity_id);
            }
        }
    }

    // Helper method to process collisions between attacks and monsters using spatial hash
    private static void ProcessMonsterAttackCollisionsSpatialHash(ReducerContext ctx)
    {        
        if(ctx.Db.active_attacks.Count == 0 || ctx.Db.monsters.Count == 0)
        {
            return;
        }

        // Iterate through all attacks using spatial hash
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

                        float pushFactor = 1.0f;

                        PosXMonster[iA] += nxAB * penetration * wA * pushFactor;
                        PosYMonster[iA] += nyAB * penetration * wA * pushFactor;
                        PosXMonster[iB] -= nxAB * penetration * wB * pushFactor;
                        PosYMonster[iB] -= nyAB * penetration * wB * pushFactor;

                        BumpedMonster[iA] = true;
                        BumpedMonster[iB] = true;
                    }
                }
            }
        }

        // Update the positions of all monsters that have been bumped
        for (int monsterIdx = 0; monsterIdx < CachedCountMonsters; ++monsterIdx)
        {
            if (BumpedMonster[monsterIdx])
            {
                var monsterId = KeysMonster[monsterIdx];
                var monsterData = ctx.Db.monsters.monster_id.Find(monsterId);
                if (monsterData is null)
                {
                    continue;
                }

                var entity = ctx.Db.entity.entity_id.Find(monsterData.Value.entity_id);
                if (entity is not null)
                {
                    var updatedEntity = entity.Value;
                    updatedEntity.position = new DbVector2(PosXMonster[monsterIdx], PosYMonster[monsterIdx]);
                    ctx.Db.entity.entity_id.Update(updatedEntity);
                }
            }
        }
    }
}