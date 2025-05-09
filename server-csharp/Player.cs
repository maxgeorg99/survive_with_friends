using SpacetimeDB;
using System;

public static partial class Module
{    
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

            if (!entity.is_moving || !entity.has_waypoint)
            {
                continue;
            }
            
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
} 