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
            target_entity_id = closestPlayerId
        });
        
        if (monsterOpt is null)
        {
            throw new Exception("SpawnMonster: Failed to create monster!");
        }

        Log.Info($"Spawned {spawner.monster_type} monster (entity: {entityOpt.Value.entity_id}) targeting player: {targetPlayerName} with HP: {bestiaryEntry.Value.max_hp}/{bestiaryEntry.Value.max_hp}");
    }
    
    // Method to schedule monster spawning - called from Init in Lib.cs
    public static void ScheduleMonsterSpawning(ReducerContext ctx)
    {
        Log.Info("Scheduling monster spawning...");
        
        // Schedule monster spawning every 5 seconds
        ctx.Db.monster_spawn_timer.Insert(new MonsterSpawnTimer
        {
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromSeconds(5))
        });
        
        Log.Info("Monster spawning scheduled successfully");
    }

    // Helper method to process monster movements
    private static void ProcessMonsterMovements(ReducerContext ctx)
    {
        // Constants for monster behavior
        const float MIN_DISTANCE_TO_MOVE = 20.0f;  // Minimum distance before monster starts moving
        const float MIN_DISTANCE_TO_REACH = 5.0f;  // Distance considered "reached" the target
        
        // First, get all monster entities for collision detection
        var monsterEntities = new Dictionary<uint, Entity>();
        var monsterTypes = new Dictionary<uint, MonsterType>();
        
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            var entityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            if (entityOpt != null)
            {
                monsterEntities[monster.entity_id] = entityOpt.Value;
                monsterTypes[monster.entity_id] = monster.bestiary_id;
            }
        }
        
        // Now process each monster's movement with collision avoidance
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            // Get the monster's entity
            if (!monsterEntities.TryGetValue(monster.entity_id, out Entity monsterEntity))
            {
                continue;
            }
            
            // Get the target entity
            var targetEntityOpt = ctx.Db.entity.entity_id.Find(monster.target_entity_id);
            if (targetEntityOpt == null)
            {
                // Target entity no longer exists - find a new target
                ReassignMonsterTarget(ctx, monster);
                continue;
            }
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
                continue;
            }
            
            // If we're far enough from the target, start moving
            if (distanceToTarget > MIN_DISTANCE_TO_MOVE)
            {
                // Normalize the direction vector to get base movement direction
                var normalizedDirection = directionVector.Normalize();
                
                // Get monster speed from bestiary
                float monsterSpeed = 20.0f; // Lower default fallback speed
                
                // Get the monster type
                MonsterType monsterType = monster.bestiary_id;
                
                // Get bestiary entry using correct ID
                var bestiaryEntryOpt = ctx.Db.bestiary.bestiary_id.Find((uint)monsterType);
                
                if (bestiaryEntryOpt != null)
                {
                    monsterSpeed = bestiaryEntryOpt.Value.speed;
                }
                
                // Check for collisions with other monsters and calculate avoidance vectors
                var avoidanceVector = new DbVector2(0, 0);
                
                foreach (var otherEntityPair in monsterEntities)
                {
                    uint otherEntityId = otherEntityPair.Key;
                    Entity otherEntity = otherEntityPair.Value;
                    
                    // Skip self
                    if (otherEntityId == monster.entity_id)
                        continue;
                    
                    // Check if we're colliding with this entity
                    float overlap = GetEntitiesOverlap(monsterEntity, otherEntity);
                    
                    if (overlap > 0)
                    {
                        // We have a collision! Calculate repulsion vector
                        DbVector2 repulsion = GetRepulsionVector(monsterEntity, otherEntity, overlap);
                        
                        // Add to avoidance vector
                        avoidanceVector.x += repulsion.x;
                        avoidanceVector.y += repulsion.y;
                    }
                }
                
                // Combine the target direction with the avoidance vector
                // We give more weight to avoidance to ensure monsters don't stack
                var combinedDirection = new DbVector2(
                    normalizedDirection.x + avoidanceVector.x * 1.5f,
                    normalizedDirection.y + avoidanceVector.y * 1.5f
                );
                
                // Re-normalize the combined direction
                var finalDirection = combinedDirection.Magnitude() > 0.0001f 
                    ? combinedDirection.Normalize() 
                    : normalizedDirection;
                
                // Calculate new position based on direction, speed and time delta
                float moveDistance = monsterSpeed * DELTA_TIME;
                var moveOffset = finalDirection * moveDistance;
                
                // Update entity with new direction and position
                var updatedEntity = monsterEntity;
                updatedEntity.direction = finalDirection;
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
                
                // Update our local cache for subsequent collision checks
                monsterEntities[monster.entity_id] = updatedEntity;
            }
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
}