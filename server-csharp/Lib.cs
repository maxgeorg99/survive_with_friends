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
    }

    // --- Tables ---
    [SpacetimeDB.Table(Name = "entity", Public = true)]
    public partial struct Entity
    {
        [PrimaryKey, AutoInc]
        public uint entity_id;

        public DbVector2 position;
        public uint mass;
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

            // 1. Create the Entity for the player
            Entity? newEntityOpt = ctx.Db.entity.Insert(new Entity
            {
                position = new DbVector2(100, 100), // Example starting position
                mass = 10 // Example starting mass
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
    public static void UpdatePlayerPosition(ReducerContext ctx, float x, float y)
    {
        var identity = ctx.Sender;
        // Find the player record for the caller
        var playerOpt = ctx.Db.player.identity.Find(identity);
        if (playerOpt is null)
        {
            Log.Warn($"UpdatePlayerPosition called by non-existent player {identity}.");
            return;
        }
        var player = playerOpt.Value;

        // Find the entity associated with this player
        var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
        if (entityOpt is null)
        {
            Log.Error($"Player {identity} (entity_id: {player.entity_id}) has no matching entity! Cannot update position.");
            // This indicates a data consistency issue - player exists but their entity doesn't
            return;
        }
        var entity = entityOpt.Value;

        // Update the entity's position
        entity.position.x = x;
        entity.position.y = y;

        // Update the entity in the database using its primary key index
        ctx.Db.entity.entity_id.Update(entity);

        // Avoid logging every update for performance
        // Log.Debug($"Updated position for player {player.name} (entity: {entity.entity_id}) to ({x}, {y})");
    }
}
