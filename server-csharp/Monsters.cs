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
            Log.Error("SpawnMonster: Could not find game configuration!");
            return;
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
            Log.Error($"SpawnMonster: Could not find bestiary entry for monster type: {monsterType}");
            return;
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
            is_moving = false  // Not moving initially
        });
        
        if (entityOpt == null)
        {
            Log.Error("SpawnMonster: Failed to create entity for monster!");
            return;
        }
        
        // Choose a random player to target without loading all players into memory
        var randomSkip = rng.Next(0, (int)playerCount); // Convert playerCount to int
        var targetPlayer = ctx.Db.player.Iter().Skip(randomSkip).First();
        
        // Create the monster
        ctx.Db.monsters.Insert(new Monsters
        {
            entity_id = entityOpt.Value.entity_id,
            bestiary_id = monsterType,
            hp = bestiaryEntry.Value.max_hp,
            target_entity_id = targetPlayer.entity_id
        });
        
        Log.Info($"Spawned {monsterType} monster (entity: {entityOpt.Value.entity_id}) targeting player: {targetPlayer.name}");
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
}