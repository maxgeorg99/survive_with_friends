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
} 