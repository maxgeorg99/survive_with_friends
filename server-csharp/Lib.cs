using SpacetimeDB;

public static partial class Module
{
    // --- Types ---
    [SpacetimeDB.Type]
    public enum PlayerClass
    {
        Fighter,
        Rogue,
        Mage,
        Paladin
    }

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
    [Table(Name = "GameTickTimer", Scheduled = nameof(GameTick), ScheduledAt = nameof(ScheduledAt))]
    public partial struct GameTickTimer
    {
        [PrimaryKey, AutoInc]
        public ulong ScheduledId;
        public ScheduleAt ScheduledAt;
    }

    // --- Tables ---
    [SpacetimeDB.Table(Name = "Entity", Public = true)]
    public partial struct Entity
    {
        [PrimaryKey, AutoInc]
        public uint EntityId;

        public DbVector2 Position;
        
        // Added direction and movement state directly to Entity
        public DbVector2 Direction;   // Direction vector (normalized)
        public bool IsMoving;        // Whether entity is actively moving
        public float Radius;          // Collision radius for this entity
    }

    [SpacetimeDB.Table(Name = "Account", Public = true)]
    public partial struct Account
    {
        [PrimaryKey]
        public SpacetimeDB.Identity Identity;

        [Unique]
        public string Name;
        
        public uint CurrentPlayerId;

        public Timestamp LastLogin;
    }

    [SpacetimeDB.Table(Name = "Player", Public = true)]
    public partial struct Player
    {
        [PrimaryKey, AutoInc]
        public uint PlayerId;

        [Unique]
        public uint EntityId;

        public string Name;

        // New player attributes
        public PlayerClass PlayerClass;
        public uint Level;
        public uint Exp;
        public uint MaxHp;
        public uint Hp;
        public float Speed;
        public uint Armor; 
    }

    // Table to store dead players (same structure as Player)
    [SpacetimeDB.Table(Name = "DeadPlayers", Public = true)]
    public partial struct DeadPlayer
    {
        [PrimaryKey]
        public uint PlayerId;

        public string Name;
    }

    // --- Lifecyle Hooks ---
    [Reducer(ReducerKind.Init)]
    public static void Init(ReducerContext ctx)
    {
        Log.Info("Initializing game and scheduling game tick...");
        
        // Initialize game configuration first
        InitGameConfig(ctx);
        
        // Schedule game tick to run at regular intervals (50ms = 20 ticks/second)
        ctx.Db.GameTickTimer.Insert(new GameTickTimer
        {
            ScheduledAt = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(50))
        });
        
        Log.Info("Game tick scheduled successfully");
        
        // Initialize bestiary with monster data
        InitBestiary(ctx);
        
        // Schedule monster spawning
        ScheduleMonsterSpawning(ctx);
    }
    
    [Reducer(ReducerKind.ClientConnected)]
    public static void ClientConnected(ReducerContext ctx)
    {
        var identity = ctx.Sender;
        Log.Info($"Client connected: {identity}");

        // Check if account already exists - if so, reconnect them
        var accountOpt = ctx.Db.Account.Identity.Find(identity);
        if (accountOpt != null)
        {
            Log.Info($"Client has existing account: {identity} reconnected.");
            var account = accountOpt.Value;
            Log.Info($"Account details: Name={account.Name}, PlayerID={account.CurrentPlayerId}");

            // Check if player exists
            var playerOpt = ctx.Db.Player.PlayerId.Find(account.CurrentPlayerId);
            if (playerOpt == null)
            {
                Log.Info($"No living player found for account {identity}. Checking for dead players...");

                DeadPlayer? deadPlayerOpt = ctx.Db.DeadPlayers.PlayerId.Find(account.CurrentPlayerId);
                if (deadPlayerOpt == null)
                {
                    Log.Info($"No dead player found for account {identity} either.");
                }
                else
                {
                    Log.Info($"Found dead player {deadPlayerOpt.Value.PlayerId} for account {identity}.");
                }
            }
            else
            {
                Log.Info($"Found living player {playerOpt.Value.PlayerId} for account {identity}.");
            }
        }
        else
        {
            // Create a new account
            Log.Info($"New connection from {identity}. Creating a new account.");
            
            Account? newAccountOpt = ctx.Db.Account.Insert(new Account
            {
                Identity = identity,
                Name = "",
                CurrentPlayerId = 0
            });
            
            if (newAccountOpt != null)
            {
                Log.Info($"Created new account for {identity}");
            }
        }
    }

    // --- Reducers ---
    [Reducer]
    public static void SpawnPlayer(ReducerContext ctx, uint class_id)
    {
        var identity = ctx.Sender;

        Log.Info($"SpawnPlayer called by identity: {identity}");

        //Check if account exists
        var accountOpt = ctx.Db.Account.Identity.Find(identity);
        if (accountOpt == null)
        {
            throw new Exception($"SpawnPlayer: Account {identity} does not exist.");
        }

        var account = accountOpt.Value;
        var player_id = account.CurrentPlayerId;

        // Check if player already exists
        var playerOpt = ctx.Db.Player.PlayerId.Find(player_id);
        if (playerOpt != null)
        {
            throw new Exception($"SpawnPlayer: Player for {identity} already exists.");
        }

        // Create a new player with a random class
        var name = account.Name;

        Log.Info($"Creating new player for {identity} with name: {name}");
        
        // Cast the class_id to a PlayerClass enum
        if(class_id < 0 || class_id >= Enum.GetValues(typeof(PlayerClass)).Length)
        {
            throw new Exception($"SpawnPlayer: Invalid class ID provided by {identity}: {class_id}. Must be between 0 and {Enum.GetValues(typeof(PlayerClass)).Length - 1}.");
        }

        var playerClass = (PlayerClass)class_id;
        
        // Create the player and entity
        var newPlayerOpt = CreateNewPlayer(ctx, name, playerClass);
        if (newPlayerOpt == null)
        {
            throw new Exception($"Failed to create new player for {identity}!");
        }
        
        var newPlayer = newPlayerOpt.Value;

        // Update the account to point to the new player
        account.CurrentPlayerId = newPlayer.PlayerId;
        ctx.Db.Account.Identity.Update(account);

        Log.Info($"Created new player record for {identity} with class {playerClass} linked to entity {newPlayer.EntityId}.");
    }
    
    // Helper function to create a new player with an associated entity
    private static Player? CreateNewPlayer(ReducerContext ctx, string name, PlayerClass playerClass)
    {
        // Get game configuration to determine world center
        var configOpt = ctx.Db.Config.Id.Find(0);
        if (configOpt == null)
        {
            Log.Error("CreateNewPlayer: Could not find game configuration!");
            // Fall back to a reasonable default if config not found
            return CreateNewPlayerWithPosition(ctx, name, playerClass, new DbVector2(1000, 1000));
        }

        // Calculate center position based on world size
        var config = configOpt.Value;
        float centerX = config.WorldSize / 2;
        float centerY = config.WorldSize / 2;
        
        // Add a small random offset (±100 pixels) to avoid all new players stacking exactly at center
        float offsetX = ctx.Rng.Next(-100, 101);
        float offsetY = ctx.Rng.Next(-100, 101);
        
        DbVector2 centerPosition = new DbVector2(centerX + offsetX, centerY + offsetY);
        Log.Info($"Placing new player '{name}' at position: {centerPosition.x}, {centerPosition.y}");
        
        return CreateNewPlayerWithPosition(ctx, name, playerClass, centerPosition);
    }
    
    // Helper function that takes a position parameter
    private static Player? CreateNewPlayerWithPosition(ReducerContext ctx, string name, PlayerClass playerClass, DbVector2 position)
    {
        // 1. Create the Entity for the player with default direction and not moving
        Entity? newEntityOpt = ctx.Db.Entity.Insert(new Entity
        {
            Position = position,
            Direction = new DbVector2(0, 0), // Default direction
            IsMoving = false, // Not moving by default
            Radius = 48.0f // Player collision radius
        });

        // Check if entity insertion failed
        if(newEntityOpt is null)
        {
            throw new Exception("Failed to insert new entity for {identity}! Insert returned null.");
        }

        // Insertion succeeded, get the non-nullable value
        Entity newEntity = newEntityOpt.Value;
        Log.Info($"Created new entity with ID: {newEntity.EntityId} for Player {name}.");

        // 2. Create the Player record, linking to the new entity
        Player? newPlayerOpt = ctx.Db.Player.Insert(new Player
        {
            PlayerId = 0,
            Name = name,
            EntityId = newEntity.EntityId,
            PlayerClass = playerClass,
            Level = 1,
            Exp = 0,
            MaxHp = 100,
            Hp = 100,
            Speed = PLAYER_SPEED,
            Armor = 0
        });

        // Check if player insertion failed
        if(newPlayerOpt is null)
        {
            throw new Exception("Failed to insert new player for {identity}! Insert returned null.");
        }

        return newPlayerOpt;
    }

    [Reducer]
    public static void SetName(ReducerContext ctx, string name)
    {
        var identity = ctx.Sender;
        Log.Info($"SetName called by identity: {identity} with name: {name}");

        // Basic validation
        if (string.IsNullOrWhiteSpace(name) || name.Length > 16)
        {
            throw new Exception($"SetName: Invalid name provided by {identity}: '{name}'. Name must be 1-16 characters.");
        }

        // Find the account using the context's Db object and the primary key index (identity)
        var accountOpt = ctx.Db.Account.Identity.Find(identity);
        if (accountOpt is null)
        {
            throw new Exception($"SetName: Attempted to set name for non-existent account {identity}.");
        }

        var account = accountOpt.Value;

        account.Name = name.Trim();

        ctx.Db.Account.Identity.Update(account);
        Log.Info($"Account {identity} name set to {account.Name}.");
    }

    //last_login
    [Reducer]
    public static void UpdateLastLogin(ReducerContext ctx)
    {
        var identity = ctx.Sender;
        Log.Info($"UpdateLastLogin called by identity: {identity}");

        var accountOpt = ctx.Db.Account.Identity.Find(identity);
        if (accountOpt == null)
        {
            throw new Exception($"UpdateLastLogin: Attempted to update last login for non-existent account {identity}.");
        }
        
        var account = accountOpt.Value;

        var now = ctx.Timestamp;
        account.LastLogin = now;

        ctx.Db.Account.Identity.Update(account);
        Log.Info($"Updated last login for account {identity} to {now}.");
    }

}
