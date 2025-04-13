using SpacetimeDB;

public static partial class Module
{
    // --- Types ---
    [SpacetimeDB.Type]
    public partial struct DbVector2
    {
        public float x;
        public float y;

        public DbVector2(float x, float y)
        {
            this.x = x;
            this.y = y;
        }
        
        // Get normalized vector (direction only)
        public DbVector2 Normalize()
        {
            float mag = Magnitude();
            if (mag > 0)
            {
                return new DbVector2(x / mag, y / mag);
            }
            return new DbVector2(0, 0);
        }
        
        // Get magnitude (length) of vector
        public float Magnitude()
        {
            return MathF.Sqrt(x * x + y * y);
        }
        
        // Vector addition
        public static DbVector2 operator +(DbVector2 a, DbVector2 b)
        {
            return new DbVector2(a.x + b.x, a.y + b.y);
        }
        
        // Vector multiplication by scalar
        public static DbVector2 operator *(DbVector2 a, float b)
        {
            return new DbVector2(a.x * b, a.y * b);
        }
    }
    
    // --- Game Constants ---
    private const float PLAYER_SPEED = 200.0f; // Units per second
    private const float TICK_RATE = 20.0f; // Updates per second (50ms)
    private const float DELTA_TIME = 1.0f / TICK_RATE; // Time between ticks in seconds

    // --- Timer Table ---
    [Table(Name = "game_tick_timer", Scheduled = nameof(GameTick), ScheduledAt = nameof(scheduled_at))]
    public partial struct GameTickTimer
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        public ScheduleAt scheduled_at;
    }

    // --- Tables ---
    [SpacetimeDB.Table(Name = "entity", Public = true)]
    public partial struct Entity
    {
        [PrimaryKey, AutoInc]
        public uint entity_id;

        public DbVector2 position;
        public uint mass;
        
        // Added direction and movement state directly to Entity
        public DbVector2 direction;   // Direction vector (normalized)
        public bool is_moving;        // Whether entity is actively moving
    }

    [SpacetimeDB.Table(Name = "player", Public = true)] // Typically player table shouldn't be public, but adjusting per example
    public partial struct Player
    {
        [PrimaryKey]
        public SpacetimeDB.Identity identity;

        [Unique, AutoInc]
        public uint player_id;

        public string name;
        public uint entity_id; // Foreign key relating to an Entity row
    }

    // --- Lifecyle Hooks ---
    [Reducer(ReducerKind.Init)]
    public static void Init(ReducerContext ctx)
    {
        Log.Info("Initializing game and scheduling game tick...");
        
        // Schedule game tick to run at regular intervals (50ms = 20 ticks/second)
        ctx.Db.game_tick_timer.Insert(new GameTickTimer
        {
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(50))
        });
        
        Log.Info("Game tick scheduled successfully");
    }
    
    [Reducer(ReducerKind.ClientConnected)]
    public static void ClientConnected(ReducerContext ctx)
    {
        var identity = ctx.Sender;
        Log.Info($"Client connected: {identity}");

        // Check if player already exists
        var playerOpt = ctx.Db.player.identity.Find(identity);
        if (playerOpt is null)
        {
            Log.Info($"New player detected. Creating records for {identity}.");

            // 1. Create the Entity for the player with default direction and not moving
            Entity? newEntityOpt = ctx.Db.entity.Insert(new Entity
            {
                position = new DbVector2(100, 100), // Example starting position
                mass = 10, // Example starting mass
                direction = new DbVector2(0, 0), // Default direction
                is_moving = false // Not moving by default
            });

            // Check if entity insertion failed
            if(newEntityOpt is null)
            {
                 Log.Error($"Failed to insert new entity for {identity}! Insert returned null.");
                 return;
            }

            // Insertion succeeded, get the non-nullable value
            Entity newEntity = newEntityOpt.Value;
            Log.Info($"Created new entity with ID: {newEntity.entity_id} for {identity}.");

            // 2. Create the Player record, linking to the new entity
            Player? newPlayerOpt = ctx.Db.player.Insert(new Player
            {
                identity = identity,
                name = "", // Start with an empty name, SetName will update it
                entity_id = newEntity.entity_id // Use the non-nullable entity_id
            });

             // Check if player insertion failed
             if(newPlayerOpt is null)
            {
                 Log.Error($"Failed to insert new player for {identity} (entity: {newEntity.entity_id})! Insert returned null.");
                 // Consider deleting the orphaned entity? Or handle error differently.
                 // If you delete, remember Entity deletion needs its PK.
                 // ctx.Db.entity.entity_id.Delete(newEntity.entity_id);
                 return;
            }

             // Insertion succeeded, get the non-nullable value
            Player newPlayer = newPlayerOpt.Value;
            Log.Info($"Created new player record for {identity} linked to entity {newPlayer.entity_id}.");
        }
        else
        {
            Log.Info($"Existing player {identity} reconnected.");
            // Optional: Handle reconnection logic if needed (e.g., update status)
        }
    }

    // --- Reducers ---
    [Reducer]
    public static void SetName(ReducerContext ctx, string name)
    {
        var identity = ctx.Sender;
        Log.Info($"SetName called by identity: {identity} with name: {name}");

        // Basic validation
        if (string.IsNullOrWhiteSpace(name) || name.Length > 16) // Example: Max 16 chars
        {
            Log.Warn($"Invalid name provided by {identity}: '{name}'. Name must be 1-16 characters.");
            return; // Or just ignore the request
        }

        // Find the player using the context's Db object and the primary key index (identity)
        var playerOpt = ctx.Db.player.identity.Find(identity);
        if (playerOpt is null)
        {
            Log.Warn($"Attempted to set name for non-existent player {identity}.");
            return;
        }

        // Get the actual player struct from the nullable result
        var player = playerOpt.Value;

        // Update player name
        player.name = name.Trim(); // Trim whitespace

        // Update the player in the database using the context's Db object and the primary key index (identity)
        ctx.Db.player.identity.Update(player); // Update via the identity index
        Log.Info($"Player {identity} name set to {player.name}.");
    }

    [Reducer]
    public static void UpdatePlayerDirection(ReducerContext ctx, float dirX, float dirY)
    {
        var identity = ctx.Sender;
        // Find the player record for the caller
        var playerOpt = ctx.Db.player.identity.Find(identity);
        if (playerOpt is null)
        {
            Log.Warn($"UpdatePlayerDirection called by non-existent player {identity}.");
            return;
        }
        var player = playerOpt.Value;
        
        // Get direction vector and determine if player is attempting to move
        var direction = new DbVector2(dirX, dirY);
        bool isMoving = dirX != 0 || dirY != 0;
        
        // Find the entity associated with this player
        var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
        if (entityOpt is null)
        {
            Log.Error($"Player {identity} (entity_id: {player.entity_id}) has no matching entity! Cannot update direction.");
            return;
        }
        
        // Update entity with new direction and movement state
        var entity = entityOpt.Value;
        entity.direction = isMoving ? direction.Normalize() : direction;
        entity.is_moving = isMoving;
        
        // Update the entity in the database
        ctx.Db.entity.entity_id.Update(entity);
        
        Log.Debug($"Updated direction for player {player.name} to ({dirX}, {dirY}), isMoving: {isMoving}");
    }
    
    [Reducer]
    public static void GameTick(ReducerContext ctx, GameTickTimer timer)
    {
        // Process all movable entities
        foreach (var entity in ctx.Db.entity.Iter())
        {
            if (!entity.is_moving)
                continue;
                
            // Calculate new position based on direction, speed and time delta
            float moveDistance = PLAYER_SPEED * DELTA_TIME;
            var moveOffset = entity.direction * moveDistance;
            
            // Update entity with new position
            var updatedEntity = entity;
            updatedEntity.position = entity.position + moveOffset;
            
            // Update entity in database
            ctx.Db.entity.entity_id.Update(updatedEntity);
        }
    }

    // Legacy position update reducer - kept for compatibility but now unused
    [Reducer]
    public static void UpdatePlayerPosition(ReducerContext ctx, float x, float y)
    {
        Log.Warn("UpdatePlayerPosition called but server now uses direction-based movement. Please update client.");
        // This reducer is kept for backward compatibility but does nothing now
    }
}
