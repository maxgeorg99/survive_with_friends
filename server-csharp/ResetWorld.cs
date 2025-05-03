using SpacetimeDB;
using System;
using System.Collections.Generic;

public static partial class Module
{
    // ResetWorld reducer - clears all monsters, gems, monster spawners, and resets boss state
    // This should be called when the last player dies
    [Reducer]
    public static void ResetWorld(ReducerContext ctx)
    {
        Log.Info("ResetWorld: Resetting game world after all players died");

        // Verify that no players are alive
        var playerCount = ctx.Db.player.Count;
        if (playerCount > 0)
        {
            Log.Info($"ResetWorld: Canceled reset because {playerCount} players are still alive");
            return;
        }

        // Use a big transaction to ensure atomicity
        bool errorOccurred = false;
        try
        {
            // 1. Clear all monsters
            int monsterCount = 0;
            List<uint> monsterEntityIds = new List<uint>();
            
            foreach (var monster in ctx.Db.monsters.Iter())
            {
                monsterEntityIds.Add(monster.entity_id);
                ctx.Db.monsters.monster_id.Delete(monster.monster_id);
                monsterCount++;
            }
            
            // Delete monster entities
            foreach (var entityId in monsterEntityIds)
            {
                ctx.Db.entity.entity_id.Delete(entityId);
            }
            
            Log.Info($"ResetWorld: Cleared {monsterCount} monsters");
            
            // 2. Clear all gems
            int gemCount = 0;
            List<uint> gemEntityIds = new List<uint>();
            
            foreach (var gem in ctx.Db.gems.Iter())
            {
                gemEntityIds.Add(gem.entity_id);
                ctx.Db.gems.gem_id.Delete(gem.gem_id);
                gemCount++;
            }
            
            // Delete gem entities
            foreach (var entityId in gemEntityIds)
            {
                ctx.Db.entity.entity_id.Delete(entityId);
            }
            
            Log.Info($"ResetWorld: Cleared {gemCount} gems");
            
            // 3. Clear all monster spawners
            int spawnerCount = 0;
            
            foreach (var spawner in ctx.Db.monster_spawners.Iter())
            {
                ctx.Db.monster_spawners.scheduled_id.Delete(spawner.scheduled_id);
                spawnerCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {spawnerCount} monster spawners");
            
            // 4. Clear boss spawn timer
            int bossTimerCount = 0;
            
            foreach (var timer in ctx.Db.boss_spawn_timer.Iter())
            {
                ctx.Db.boss_spawn_timer.scheduled_id.Delete(timer.scheduled_id);
                bossTimerCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {bossTimerCount} boss spawn timers");
            
            // 5. Reset game state (boss status)
            var gameStateOpt = ctx.Db.game_state.id.Find(0);
            if (gameStateOpt != null)
            {
                var gameState = gameStateOpt.Value;
                gameState.boss_active = false;
                gameState.boss_phase = 0;
                gameState.boss_monster_id = 0;
                gameState.normal_spawning_paused = false;
                ctx.Db.game_state.id.Update(gameState);
                
                Log.Info("ResetWorld: Reset game state (boss status)");
            }
            
            // 6. Clear the monster spawn timer
            int monsterTimerCount = 0;
            
            foreach (var timer in ctx.Db.monster_spawn_timer.Iter())
            {
                ctx.Db.monster_spawn_timer.scheduled_id.Delete(timer.scheduled_id);
                monsterTimerCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {monsterTimerCount} monster spawn timers");
            
            // 7. Clean up monster hit cleanup records
            int monsterHitCleanupCount = 0;
            foreach (var cleanup in ctx.Db.monster_hit_cleanup.Iter())
            {
                ctx.Db.monster_hit_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
                monsterHitCleanupCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {monsterHitCleanupCount} monster hit cleanup records");
            
            // 8. Clean up active attack cleanup records
            int activeAttackCleanupCount = 0;
            foreach (var cleanup in ctx.Db.active_attack_cleanup.Iter())
            {
                ctx.Db.active_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
                activeAttackCleanupCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {activeAttackCleanupCount} active attack cleanup records");
            
            // 9. Clean up attack burst cooldowns
            int burstCooldownCount = 0;
            foreach (var cooldown in ctx.Db.attack_burst_cooldowns.Iter())
            {
                ctx.Db.attack_burst_cooldowns.scheduled_id.Delete(cooldown.scheduled_id);
                burstCooldownCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {burstCooldownCount} attack burst cooldowns");
            
            // 10. Clean up player scheduled attacks
            int scheduledAttackCount = 0;
            foreach (var attack in ctx.Db.player_scheduled_attacks.Iter())
            {
                ctx.Db.player_scheduled_attacks.scheduled_id.Delete(attack.scheduled_id);
                scheduledAttackCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {scheduledAttackCount} player scheduled attacks");
            
            // 11. Clean up any remaining monster damage records
            int monsterDamageCount = 0;
            foreach (var damage in ctx.Db.monster_damage.Iter())
            {
                ctx.Db.monster_damage.damage_id.Delete(damage.damage_id);
                monsterDamageCount++;
            }
            
            Log.Info($"ResetWorld: Cleared {monsterDamageCount} monster damage records");
            
            // 12. Reschedule monster spawning
            ScheduleMonsterSpawning(ctx);
            Log.Info("ResetWorld: Rescheduled monster spawning");
            
            Log.Info("ResetWorld: Game world reset completed successfully");
        }
        catch (Exception ex)
        {
            errorOccurred = true;
            Log.Error($"ResetWorld: Error during world reset: {ex.Message}\n{ex.StackTrace}");
            throw; // Rethrow to trigger transaction rollback
        }
    }
} 