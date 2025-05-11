using SpacetimeDB;
using System;

public static partial class Module
{    
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
        
        // Find the entity associated with this player
        var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
        if (entityOpt is null)
        {
            throw new Exception($"SetPlayerWaypoint: Player {player_id} (entity_id: {player.entity_id}) has no matching entity!");
        }
        
        // Get world size from config for boundary checking
        uint worldSize = 20000; // Default fallback
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            worldSize = configOpt.Value.world_size;
        }
        
        // Clamp waypoint to world boundaries using entity radius
        var entity = entityOpt.Value;
        var waypoint = new DbVector2(
            Math.Clamp(waypointX, entity.radius, worldSize - entity.radius),
            Math.Clamp(waypointY, entity.radius, worldSize - entity.radius)
        );
        
        // Update entity with new waypoint
        entity.waypoint = waypoint;
        entity.has_waypoint = true;
        entity.is_moving = true;
        
        // Calculate direction to waypoint
        var directionVector = new DbVector2(
            waypoint.x - entity.position.x,
            waypoint.y - entity.position.y
        );
        
        // Only set direction if we're not at the waypoint
        if (directionVector.Magnitude() > 0.1f)
        {
            entity.direction = directionVector.Normalize();
        }
        else
        {
            entity.direction = new DbVector2(0, 0);
            entity.is_moving = false;
            entity.has_waypoint = false;
        }
        
        // Update the entity in the database
        ctx.Db.entity.entity_id.Update(entity);
        
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

    private static void ProcessPlayerMovement(ReducerContext ctx, uint tick_rate, uint worldSize)
    {
        // Process all movable players
        foreach (var player in ctx.Db.player.Iter())
        {
            // Update player status
            if(player.spawn_grace_period_remaining > 0)
            {
                var modifiedPlayer = player;
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

            // Process player movement
            float moveSpeed = player.speed;

            var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);

            if(entityOpt is null)
            {
                continue;
            }

            var entity = entityOpt.Value;

            if (entity.is_moving && entity.has_waypoint)
            {
                // Calculate direction to waypoint
                var directionVector = new DbVector2(
                    entity.waypoint.x - entity.position.x,
                    entity.waypoint.y - entity.position.y
                );
                
                // Calculate distance to waypoint
                float distanceToWaypoint = directionVector.Magnitude();
                
                // If we're close enough to the waypoint, stop moving
                const float WAYPOINT_REACHED_DISTANCE = 5.0f;
                if (distanceToWaypoint < WAYPOINT_REACHED_DISTANCE)
                {
                    // Reached waypoint, stop moving
                    entity.is_moving = false;
                    entity.has_waypoint = false;
                    entity.direction = new DbVector2(0, 0);
                    ctx.Db.entity.entity_id.Update(entity);
                }
                else
                {
                    // Calculate new position based on direction, speed and time delta
                    float moveDistance = moveSpeed * DELTA_TIME;
                    var moveOffset = directionVector.Normalize() * moveDistance;
                    
                    // Update entity with new position
                    var updatedEntity = entity;
                    updatedEntity.position = entity.position + moveOffset;
                    
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

            //Update collision cache
            KeysPlayer[CachedCountPlayers] = player.player_id;
            PosXPlayer[CachedCountPlayers] = entity.position.x;
            PosYPlayer[CachedCountPlayers] = entity.position.y;
            RadiusPlayer[CachedCountPlayers] = entity.radius;

            ushort gridCellKey = GetWorldCellFromPosition(entity.position.x, entity.position.y);
            NextsPlayer[CachedCountPlayers] = HeadsPlayer[gridCellKey];
            HeadsPlayer[gridCellKey] = CachedCountPlayers;

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
            bool playerIsDead = false;

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
                if ((uint)ny >= (uint)WORLD_GRID_HEIGHT) continue;   // unsigned trick == clamp

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
                            var monsterEntry = ctx.Db.monsters.monster_id.Find(KeysMonster[mid]);
                            if(monsterEntry is null)
                            {
                                continue;
                            }

                            playerIsDead = DamagePlayer(ctx, KeysPlayer[pid], monsterEntry.Value.atk);
                        }

                        if(playerIsDead)
                        {
                            break;
                        }
                    }

                    if(playerIsDead)
                    {
                        break;
                    }
                }

                if(playerIsDead)
                {
                    break;
                }
            }
        }
    }
} 