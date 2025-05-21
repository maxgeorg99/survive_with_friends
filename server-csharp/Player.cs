using SpacetimeDB;
using System;

public static partial class Module
{    
    [SpacetimeDB.Table(Name = "player", Public = true)]
    public partial struct Player
    {
        [PrimaryKey, AutoInc]
        public uint player_id;
        public string name;

        public uint spawn_grace_period_remaining;

        public PlayerClass player_class;
        public uint level;
        public uint exp;
        public uint exp_for_next_level;
        public float max_hp;
        public float hp;
        public uint hp_regen;
        public float speed;
        public uint armor; 
        public uint unspent_upgrades;
        public uint rerolls;
        public uint shield_count;

        // For tap-to-move
        public DbVector2 waypoint;    // Target position for movement
        public bool has_waypoint;     // Whether entity has an active waypoint

        // entity attributes
        public DbVector2 position;  
        public float radius;   

        // Bot flag
        public bool is_bot;           // Whether this player is a bot
    }

    // Table to store dead players for run history purposes
    [SpacetimeDB.Table(Name = "dead_players", Public = true)]
    public partial struct DeadPlayer
    {
        [PrimaryKey]
        public uint player_id;

        public string name;
        
        public bool is_true_survivor; // Flag to indicate the player defeated the final boss
    }

    [Reducer]
    public static void SetPlayerWaypoint(ReducerContext ctx, float waypointX, float waypointY)
    {
        // Get the identity of the caller
        var identity = ctx.Sender;
        
        //Find the account for the caller   
        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt is null)
        {
            throw new Exception($"SetPlayerWaypoint: Account {identity} does not exist.");
        }

        var account = accountOpt.Value;
        var player_id = account.current_player_id;

        var playerOpt = ctx.Db.player.player_id.Find(player_id);
        if (playerOpt is null)
        {
            throw new Exception($"SetPlayerWaypoint: Player {player_id} does not exist.");
        }
        var player = playerOpt.Value;
        
        // Get world size from config for boundary checking
        uint worldSize = 20000; // Default fallback
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            worldSize = configOpt.Value.world_size;
        }
        
        // Clamp waypoint to world boundaries using entity radius
        var waypoint = new DbVector2(
            Math.Clamp(waypointX, player.radius, worldSize - player.radius),
            Math.Clamp(waypointY, player.radius, worldSize - player.radius)
        );
        
        // Update entity with new waypoint
        player.waypoint = waypoint;
        player.has_waypoint = true;
        
        // Update the entity in the database
        ctx.Db.player.player_id.Update(player);
        
        Log.Info($"Set waypoint for player {player.name} to ({waypoint.x}, {waypoint.y})");
    }

    // Schedule for health regeneration
    [SpacetimeDB.Table(Name = "health_regen_scheduler", 
                      Scheduled = nameof(ProcessHealthRegen), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct HealthRegenScheduler
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        public ScheduleAt scheduled_at; // When to run health regen
    }
    
    // Initialize HP regen scheduler at server startup
    [Reducer]
    public static void InitHealthRegenSystem(ReducerContext ctx)
    {
        // Check if health regen scheduler already exists
        if (ctx.Db.health_regen_scheduler.Iter().Any())
        {
            Log.Info("Health regen scheduler already initialized");
            return;
        }
        
        // Create the health regen scheduler to run every second
        ctx.Db.health_regen_scheduler.Insert(new HealthRegenScheduler
        {
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromSeconds(1))
        });
        
        Log.Info("Health regeneration system initialized");
    }
    
    // Process health regeneration for all players
    [Reducer]
    public static void ProcessHealthRegen(ReducerContext ctx, HealthRegenScheduler scheduler)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("ProcessHealthRegen may not be invoked by clients, only via scheduling.");
        }
        
        foreach (var player in ctx.Db.player.Iter())
        {
            // Skip players with full health
            if (player.hp >= player.max_hp)
            {
                continue;
            }
            
            // Skip players with no regen
            if (player.hp_regen <= 0)
            {
                continue;
            }
            
            // Apply HP regeneration
            float newHp = Math.Min(player.max_hp, player.hp + player.hp_regen);
            float healAmount = newHp - player.hp;
            
            if (healAmount > 0)
            {
                var updatedPlayer = player;
                updatedPlayer.hp = newHp;
                ctx.Db.player.player_id.Update(updatedPlayer);
            }
        }
    }

    private static void ProcessPlayerMovement(ReducerContext ctx, uint tick_rate)
    {
        // Process all movable players
        CachedCountPlayers = 0;
        foreach (var player in ctx.Db.player.Iter())
        {
            var modifiedPlayer = player;

            // Update player status
            if(player.spawn_grace_period_remaining > 0)
            {
                if(modifiedPlayer.spawn_grace_period_remaining >= tick_rate)
                {
                    modifiedPlayer.spawn_grace_period_remaining -= tick_rate;
                }
                else
                {   
                    modifiedPlayer.spawn_grace_period_remaining = 0;
                }
                ctx.Db.player.player_id.Update(modifiedPlayer);
            }

            // Skip movement for bot players
            if (!player.is_bot)
            {
                // Process player movement
                float moveSpeed = player.speed;

                if (player.has_waypoint)
                {
                    // Calculate direction to waypoint
                    var directionVector = new DbVector2(
                        player.waypoint.x - player.position.x,
                        player.waypoint.y - player.position.y
                    );
                    
                    // Calculate distance to waypoint
                    float distance = (float)Math.Sqrt(
                        directionVector.x * directionVector.x + 
                        directionVector.y * directionVector.y
                    );
                    
                    // If we're close enough to the waypoint, clear it
                    if (distance < moveSpeed * DELTA_TIME)
                    {
                        modifiedPlayer.has_waypoint = false;

                        modifiedPlayer.position.x = modifiedPlayer.waypoint.x;
                        modifiedPlayer.position.y = modifiedPlayer.waypoint.y;
                    }
                    else
                    {
                        // Normalize direction vector
                        directionVector.x /= distance;
                        directionVector.y /= distance;
                        
                        // Move towards waypoint
                        modifiedPlayer.position.x += directionVector.x * moveSpeed * DELTA_TIME;
                        modifiedPlayer.position.y += directionVector.y * moveSpeed * DELTA_TIME;
                        
                        // Clamp position to world boundaries
                        modifiedPlayer.position.x = Math.Clamp(
                            modifiedPlayer.position.x, 
                            modifiedPlayer.radius, 
                            WORLD_SIZE - modifiedPlayer.radius
                        );
                        modifiedPlayer.position.y = Math.Clamp(
                            modifiedPlayer.position.y, 
                            modifiedPlayer.radius, 
                            WORLD_SIZE - modifiedPlayer.radius
                        );
                    }
                    
                    // Update entity in database
                    ctx.Db.player.player_id.Update(modifiedPlayer);
                }
            }

            //Update collision cache
            KeysPlayer[CachedCountPlayers] = modifiedPlayer.player_id;
            PosXPlayer[CachedCountPlayers] = modifiedPlayer.position.x;
            PosYPlayer[CachedCountPlayers] = modifiedPlayer.position.y;
            RadiusPlayer[CachedCountPlayers] = modifiedPlayer.radius;
            ShieldCountPlayer[CachedCountPlayers] = modifiedPlayer.shield_count;

            ushort gridCellKey = GetWorldCellFromPosition(modifiedPlayer.position.x, modifiedPlayer.position.y);
            CellPlayer[CachedCountPlayers] = gridCellKey;
            NextsPlayer[CachedCountPlayers] = HeadsPlayer[gridCellKey];
            HeadsPlayer[gridCellKey] = (int)CachedCountPlayers;

            PlayerIdToCacheIndex[modifiedPlayer.player_id] = CachedCountPlayers;

            CachedCountPlayers++;
        }
    }
    private static void ProcessPlayerMonsterCollisionsSpatialHash(ReducerContext ctx)
    {
        if(ctx.Db.monsters.Count == 0)
        {
            return;
        }

        //Iterate through all players using spatial hash
        for(var pid = 0; pid < CachedCountPlayers; pid++)
        {
            var px = PosXPlayer[pid];
            var py = PosYPlayer[pid];
            var pr = RadiusPlayer[pid];

            //Check against all gems in the same spatial hash cell
            var cellKey = GetWorldCellFromPosition(px, py);

            int cx =  cellKey & WORLD_CELL_MASK;
            int cy = cellKey >> WORLD_CELL_BIT_SHIFT;

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

                        if(SpatialHashCollisionChecker(px, py, pr, mx, my, mr))
                        {
                            DamageToPlayer[pid] += AtkMonster[mid];
                        }
                    }
                }
            }
        }

        for(var pid = 0; pid < CachedCountPlayers; pid++)
        {
            if(DamageToPlayer[pid] > 0)
            {
                DamagePlayer(ctx, KeysPlayer[pid], DamageToPlayer[pid]);
            }
        }
    }
} 