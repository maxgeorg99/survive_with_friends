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
        
        // Added direction and movement state directly to Entity
        public DbVector2 direction;   // Direction vector (normalized)
        public bool is_moving;        // Whether entity is actively moving
        public float radius;          // Collision radius for this entity
    }

    [SpacetimeDB.Table(Name = "account", Public = true)]
    public partial struct Account
    {
        [PrimaryKey]
        public SpacetimeDB.Identity identity;

        [Unique]
        public string name;
        
        public uint current_player_id;

        public Timestamp last_login;
    }

    [SpacetimeDB.Table(Name = "player", Public = true)]
    public partial struct Player
    {
        [PrimaryKey, AutoInc]
        public uint player_id;

        [Unique]
        public uint entity_id;

        public string name;

        public uint spawn_grace_period_remaining;

        // New player attributes
        public PlayerClass player_class;
        public uint level;
        public uint exp;
        public uint max_hp;
        public uint hp;
        public float speed;
        public uint armor; 
    }

    // Table to store dead players (same structure as Player)
    [SpacetimeDB.Table(Name = "dead_players", Public = true)]
    public partial struct DeadPlayer
    {
        [PrimaryKey]
        public uint player_id;

        public string name;
    }

    // --- Lifecyle Hooks ---
    [Reducer(ReducerKind.Init)]
    public static void Init(ReducerContext ctx)
    {
        Log.Info("Initializing game and scheduling game tick...");
        
        // Initialize game configuration first
        InitGameConfig(ctx);
        
        // Initialize class data
        InitializeClassData(ctx);

        var configOpt = ctx.Db.config.id.Find(0);
        uint game_tick_rate = 50;
        if(configOpt != null)
        {
            game_tick_rate = configOpt.Value.game_tick_rate;
        }
        
        // Schedule game tick to run at regular intervals (50ms = 20 ticks/second)
        ctx.Db.game_tick_timer.Insert(new GameTickTimer
        {
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(game_tick_rate))
        });
        
        Log.Info("Game tick scheduled successfully");
        
        // Initialize bestiary with monster data
        InitBestiary(ctx);
        
        // Initialize attack system
        InitializeAttackSystem(ctx);
        
        // Schedule monster spawning
        ScheduleMonsterSpawning(ctx);
    }
    
    [Reducer(ReducerKind.ClientConnected)]
    public static void ClientConnected(ReducerContext ctx)
    {
        var identity = ctx.Sender;
        Log.Info($"Client connected: {identity}");

        // Check if account already exists - if so, reconnect them
        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt != null)
        {
            Log.Info($"Client has existing account: {identity} reconnected.");
            var account = accountOpt.Value;
            Log.Info($"Account details: Name={account.name}, PlayerID={account.current_player_id}");

            // Check if player exists
            var playerOpt = ctx.Db.player.player_id.Find(account.current_player_id);
            if (playerOpt == null)
            {
                Log.Info($"No living player found for account {identity}. Checking for dead players...");

                DeadPlayer? deadPlayerOpt = ctx.Db.dead_players.player_id.Find(account.current_player_id);
                if (deadPlayerOpt == null)
                {
                    Log.Info($"No dead player found for account {identity} either.");
                }
                else
                {
                    Log.Info($"Found dead player {deadPlayerOpt.Value.player_id} for account {identity}.");
                }
            }
            else
            {
                Log.Info($"Found living player {playerOpt.Value.player_id} for account {identity}.");
            }
        }
        else
        {
            // Create a new account
            Log.Info($"New connection from {identity}. Creating a new account.");
            
            Account? newAccountOpt = ctx.Db.account.Insert(new Account
            {
                identity = identity,
                name = "",
                current_player_id = 0
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
        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt == null)
        {
            throw new Exception($"SpawnPlayer: Account {identity} does not exist.");
        }

        var account = accountOpt.Value;
        var player_id = account.current_player_id;

        // Check if player already exists
        var playerOpt = ctx.Db.player.player_id.Find(player_id);
        if (playerOpt != null)
        {
            throw new Exception($"SpawnPlayer: Player for {identity} already exists.");
        }

        // Create a new player with a random class
        var name = account.name;

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
        account.current_player_id = newPlayer.player_id;
        ctx.Db.account.identity.Update(account);

        Log.Info($"Created new player record for {identity} with class {playerClass} linked to entity {newPlayer.entity_id}.");
    }
    
    // Helper function to create a new player with an associated entity
    private static Player? CreateNewPlayer(ReducerContext ctx, string name, PlayerClass playerClass)
    {
        // Get game configuration to determine world center
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt == null)
        {
            Log.Error("CreateNewPlayer: Could not find game configuration!");
            // Fall back to a reasonable default if config not found
            return CreateNewPlayerWithPosition(ctx, name, playerClass, new DbVector2(1000, 1000));
        }

        // Calculate center position based on world size
        var config = configOpt.Value;
        float centerX = config.world_size / 2;
        float centerY = config.world_size / 2;
        
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
        // Look up class data to use for stats
        var classDataOpt = ctx.Db.class_data.ClassId.Find((uint)playerClass);
        if (classDataOpt == null)
        {
            Log.Error($"CreateNewPlayerWithPosition: No class data found for {playerClass}");
            // Fall back to default values if class data not found
        }
        
        // Define default stats in case class data isn't found
        int maxHp = 100;
        int armor = 0;
        float speed = PLAYER_SPEED;
        AttackType startingAttackType = AttackType.Sword;
        
        // Use class data if available
        if (classDataOpt != null)
        {
            ClassData classData = classDataOpt;
            maxHp = classData.MaxHp;
            armor = classData.Armor;
            speed = classData.Speed;
            startingAttackType = classData.StartingAttackType;
        }
        
        // 1. Create the Entity for the player with default direction and not moving
        Entity? newEntityOpt = ctx.Db.entity.Insert(new Entity
        {
            position = position,
            direction = new DbVector2(0, 0), // Default direction
            is_moving = false, // Not moving by default
            radius = 48.0f // Player collision radius
        });

        // Check if entity insertion failed
        if(newEntityOpt is null)
        {
            throw new Exception("Failed to insert new entity for {identity}! Insert returned null.");
        }

        // Insertion succeeded, get the non-nullable value
        Entity newEntity = newEntityOpt.Value;
        Log.Info($"Created new entity with ID: {newEntity.entity_id} for Player {name}.");

        var configOpt = ctx.Db.config.id.Find(0);
        uint player_spawn_grace_period = 5000;
        if(configOpt != null)
        {
            player_spawn_grace_period = configOpt.Value.player_spawn_grace_period;
        }

        // 2. Create the Player record, linking to the new entity
        // Use class data for stats
        Player? newPlayerOpt = ctx.Db.player.Insert(new Player
        {
            player_id = 0,
            name = name,
            entity_id = newEntity.entity_id,
            spawn_grace_period_remaining = player_spawn_grace_period,
            player_class = playerClass,
            level = 1,
            exp = 0,
            max_hp = (uint)maxHp,
            hp = (uint)maxHp,
            speed = speed,
            armor = (uint)armor
        });

        // Check if player insertion failed
        if(newPlayerOpt is null)
        {
            throw new Exception("Failed to insert new player for {identity}! Insert returned null.");
        }
        
        // Schedule the starting attack for this class
        ScheduleAttack(ctx, newPlayerOpt.Value.player_id, startingAttackType);
        Log.Info($"Scheduled starting attack type {startingAttackType} for player {newPlayerOpt.Value.player_id}");

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
        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt is null)
        {
            throw new Exception($"SetName: Attempted to set name for non-existent account {identity}.");
        }

        var account = accountOpt.Value;

        account.name = name.Trim();

        ctx.Db.account.identity.Update(account);
        Log.Info($"Account {identity} name set to {account.name}.");
    }

    //last_login
    [Reducer]
    public static void UpdateLastLogin(ReducerContext ctx)
    {
        var identity = ctx.Sender;
        Log.Info($"UpdateLastLogin called by identity: {identity}");

        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt == null)
        {
            throw new Exception($"UpdateLastLogin: Attempted to update last login for non-existent account {identity}.");
        }
        
        var account = accountOpt.Value;

        var now = ctx.Timestamp;
        account.last_login = now;

        ctx.Db.account.identity.Update(account);
        Log.Info($"Updated last login for account {identity} to {now}.");
    }

}
