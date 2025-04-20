using SpacetimeDB;

public static partial class Module
{
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
    [Table(Name = "monster_spawn_timer", Scheduled = nameof(SpawnMonster), ScheduledAt = nameof(scheduled_at))]
    public partial struct MonsterSpawnTimer
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        public ScheduleAt scheduled_at;
    }
    
    [Reducer]
    public static void SpawnMonster(ReducerContext ctx, MonsterSpawnTimer timer)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer SpawnMonster may not be invoked by clients, only via scheduling.");
        }

        // Check if there are any players online
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
        
        // Check if we're at monster capacity
        var monsterCount = ctx.Db.monsters.Count;
        if (monsterCount >= config.max_monsters)
        {
            Log.Info($"SpawnMonster: At maximum monster capacity ({monsterCount}/{config.max_monsters}), skipping spawn.");
            return;
        }
        
        // Get a random monster type
        var rng = ctx.Rng;
        var monsterTypes = Enum.GetValues(typeof(MonsterType));
        var randomTypeIndex = rng.Next(0, monsterTypes.Length);
        var monsterType = (MonsterType)randomTypeIndex;
        
        // Get monster stats from bestiary using the monster type as numerical ID
        var bestiaryEntry = ctx.Db.bestiary.bestiary_id.Find((uint)monsterType);
        if (bestiaryEntry == null)
        {
            throw new Exception($"SpawnMonster: Could not find bestiary entry for monster type: {monsterType}");
        }
        
        // Calculate spawn position on the edge of the game world
        DbVector2 position;
        float edgeOffset = bestiaryEntry.Value.radius; // Keep monsters from spawning partially off-screen
        var worldSize = config.world_size;
        
        // Choose a random edge (0=top, 1=right, 2=bottom, 3=left)
        int edge = rng.Next(0, 4);
        switch (edge)
        {
            case 0: // Top edge
                position = new DbVector2(rng.Next((int)edgeOffset, (int)(worldSize - edgeOffset)), edgeOffset);
                break;
            case 1: // Right edge
                position = new DbVector2(worldSize - edgeOffset, rng.Next((int)edgeOffset, (int)(worldSize - edgeOffset)));
                break;
            case 2: // Bottom edge
                position = new DbVector2(rng.Next((int)edgeOffset, (int)(worldSize - edgeOffset)), worldSize - edgeOffset);
                break;
            case 3: // Left edge
                position = new DbVector2(edgeOffset, rng.Next((int)edgeOffset, (int)(worldSize - edgeOffset)));
                break;
            default: // Fallback (shouldn't happen)
                position = new DbVector2(edgeOffset, edgeOffset);
                break;
        }
        
        // Create an entity for the monster
        Entity? entityOpt = ctx.Db.entity.Insert(new Entity
        {
            position = position,
            direction = new DbVector2(0, 0), // Initial direction
            is_moving = false,  // Not moving initially
            radius = bestiaryEntry.Value.radius // Set radius from bestiary entry
        });
        
        if (entityOpt == null)
        {
            throw new Exception("SpawnMonster: Failed to create entity for monster!");
        }
        
        // Choose a random player to target without loading all players into memory
        var randomSkip = rng.Next(0, (int)playerCount); // Convert playerCount to int
        var targetPlayer = ctx.Db.player.Iter().Skip(randomSkip).First();
        
        // Create the monster
        Monsters? monsterOpt = ctx.Db.monsters.Insert(new Monsters
        {
            entity_id = entityOpt.Value.entity_id,
            bestiary_id = monsterType,
            hp = bestiaryEntry.Value.max_hp,
            max_hp = bestiaryEntry.Value.max_hp, // Store max_hp from bestiary
            target_entity_id = targetPlayer.entity_id
        });
        
        if (monsterOpt is null)
        {
            throw new Exception("SpawnMonster: Failed to create monster!");
        }

        Log.Info($"Spawned {monsterType} monster (entity: {entityOpt.Value.entity_id}) targeting player: {targetPlayer.name} with HP: {bestiaryEntry.Value.max_hp}/{bestiaryEntry.Value.max_hp}");
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