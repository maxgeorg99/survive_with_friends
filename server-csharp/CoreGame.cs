using SpacetimeDB;
using System;
using System.Collections.Generic;
using System.Linq;

public static partial class Module
{
    static bool errorFlag = false;

    // Helper function to remove all damage records for a given attack entity
    private static void CleanupAttackDamageRecords(ReducerContext ctx, uint attackEntityId)
    {
        var damageRecords = new List<uint>();

        var attackDamageRecords = ctx.Db.monster_damage.attack_entity_id.Filter(attackEntityId);
        
        foreach (var damage in attackDamageRecords)
        {
            damageRecords.Add(damage.damage_id);
        }
        
        // Delete all found damage records
        foreach (var damageId in damageRecords)
        {
            ctx.Db.monster_damage.damage_id.Delete(damageId);
        }
    }

    // Helper function to remove all damage records for a given monster
    private static void CleanupMonsterDamageRecords(ReducerContext ctx, uint monsterId)
    {
        var damageRecords = new List<uint>();

        var monsterDamageRecords = ctx.Db.monster_damage.monster_id.Filter(monsterId);
        
        foreach (var damage in monsterDamageRecords)
        {
            damageRecords.Add(damage.damage_id);
        }
        
        // Delete all found damage records
        foreach (var damageId in damageRecords)
        {
            ctx.Db.monster_damage.damage_id.Delete(damageId);
        }
    }

    // Helper function to damage a monster
    // Returns true if the monster died, false otherwise
    public static bool DamageMonster(ReducerContext ctx, uint monsterId, uint damageAmount)
    {
        // Find the monster
        var monsterOpt = ctx.Db.monsters.monster_id.Find(monsterId);
        if (monsterOpt is null)
        {
            return false;
        }
        
        var monster = monsterOpt.Value;
        
        // Make sure we don't underflow
        if (monster.hp <= damageAmount)
        {
            // Monster is dead - log and delete
            Log.Info($"Monster {monster.monster_id} (type: {monster.bestiary_id}) was killed!");
            
            // Get the monster's position before deleting it
            DbVector2 position = monster.position;
            
            // Clean up any monster damage records for this monster
            CleanupMonsterDamageRecords(ctx, monsterId);
            
            // Check if this is a boss monster
            bool isBoss = false;
            var gameStateOpt = ctx.Db.game_state.id.Find(0);

            
            if (gameStateOpt != null && gameStateOpt.Value.boss_active && gameStateOpt.Value.boss_monster_id == monsterId)
            {
                isBoss = true;
                Log.Info($"BOSS MONSTER CONFIRMED: ID={monsterId}, Phase={gameStateOpt.Value.boss_phase}, Monster Type: {monster.bestiary_id}");
                
                // Handle based on boss phase
                if (gameStateOpt.Value.boss_phase == 1)
                {
                    // Phase 1 boss defeated, transition to phase 2
                    Log.Info("BOSS PHASE 1 DEFEATED! TRANSITIONING TO PHASE 2...");
                    Log.Info($"Phase 1 details - Monster ID: {monster.monster_id}, Position: ({position.x}, {position.y})");
                    
                    // Store the entity ID and position before deletion
                    DbVector2 bossPosition = position;
                    
                    // Spawn phase 2 first, before deleting phase 1 monster
                    Log.Info("Calling SpawnBossPhaseTwo now...");
                    SpawnBossPhaseTwo(ctx, bossPosition);
                    Log.Info("SpawnBossPhaseTwo completed successfully");
                    
                    // Only after successful spawn of phase 2, delete phase 1
                    ctx.Db.monsters.monster_id.Delete(monsterId);
                    Log.Info("Phase 1 boss monster and entity deleted after phase 2 spawned");
                    
                    // Add a verification check to confirm phase 2 exists
                    Log.Info("Verifying phase 2 boss was created:");
                    var gameStateAfter = ctx.Db.game_state.id.Find(0);
                    if (gameStateAfter != null)
                    {
                        Log.Info($"Game state after transition - Phase: {gameStateAfter.Value.boss_phase}, BossActive: {gameStateAfter.Value.boss_active}, BossMonsterID: {gameStateAfter.Value.boss_monster_id}");
                        
                        if (gameStateAfter.Value.boss_phase == 2)
                        {
                            var phase2BossOpt = ctx.Db.monsters.monster_id.Find(gameStateAfter.Value.boss_monster_id);
                            if (phase2BossOpt != null)
                            {
                                Log.Info($"Phase 2 boss verified: Monster ID={phase2BossOpt.Value.monster_id}");
                            }
                            else
                            {
                                Log.Info($"ERROR: Phase 2 boss with ID {gameStateAfter.Value.boss_monster_id} not found in monsters table!");
                            }
                        }
                        else
                        {
                            Log.Info("ERROR: Game state still shows phase 1 after transition!");
                        }
                    }
                    
                    return true;
                }
                else if (gameStateOpt.Value.boss_phase == 2)
                {
                    // Phase 2 boss defeated - VICTORY!
                    Log.Info("BOSS PHASE 2 DEFEATED! GAME COMPLETE!");
                    
                    // Delete the monster and entity
                    ctx.Db.monsters.monster_id.Delete(monsterId);
                    
                    // Handle boss defeated (true victory!)
                    HandleBossDefeated(ctx);
                    
                    return true;
                }
                else
                {
                    Log.Info($"WARNING: Boss killed but phase is unexpected: {gameStateOpt.Value.boss_phase}");
                }
            }
            
            // For non-boss monsters or if game state not found, spawn a gem
            if (!isBoss)
            {
                // Spawn a gem at the monster's position
                SpawnGemOnMonsterDeath(ctx, monsterId, position);
                
                // Delete the monster
                ctx.Db.monsters.monster_id.Delete(monsterId);
            }
            
            return true;
        }
        else
        {
            // Monster is still alive, update with reduced HP
            monster.hp -= damageAmount;
            ctx.Db.monsters.monster_id.Update(monster);
            
            return false;
        }
    }
    
    //Helper function to damage a player
    //Returns true if the player is dead, false otherwise
    public static bool DamagePlayer(ReducerContext ctx, uint player_id, float damage_amount)
    {
        // Find the player
        var playerOpt = ctx.Db.player.player_id.Find(player_id);
        if (playerOpt is null)
        {
            errorFlag = true;
            throw new Exception($"DamagePlayer: Player {player_id} does not exist.");
        }
        
        // Get the player and reduce HP
        var player = playerOpt.Value;

        if(player.spawn_grace_period_remaining > 0)
        {
            // Player is still in spawn grace period - don't take damage
            return false;
        }
        
        // Apply armor damage reduction
        // Formula: DR = armor/(armor+3)
        // At 3 armor, they take 50% damage
        // At 6 armor, they take 33% damage
        float reducedDamage = damage_amount;
        if (player.armor > 0)
        {
            float damageReduction = (float)player.armor / (player.armor + 3f);
            float remainingDamagePercent = 1f - damageReduction;
            reducedDamage = damage_amount * remainingDamagePercent;
        }
        
        // Make sure we don't underflow
        if (player.hp <= reducedDamage)
        {
            // Player is dead - set HP to 0
            player.hp = 0;
            
            // Update player record with 0 HP before we delete
            ctx.Db.player.player_id.Update(player);
            
            // Log the death
            Log.Info($"Player {player.name} (ID: {player.player_id}) has died!");
            
            // Store the player in the dead_players table before removing them
            DeadPlayer? deadPlayerOpt = ctx.Db.dead_players.Insert(new DeadPlayer
            {
                player_id = player.player_id,
                name = player.name
            });

            if (deadPlayerOpt is null)
            {
                errorFlag = true;
                throw new Exception($"DamagePlayer: Player {player.name} (ID: {player.player_id}) could not be moved to dead_players table.");
            }

            Log.Info($"Player {player.name} (ID: {player.player_id}) moved to dead_players table.");
            
            // Clean up all attack-related data for this player
            CleanupPlayerAttacks(ctx, player_id);
            
            // Clean up all pending upgrade options for this player
            CleanupPlayerUpgradeOptions(ctx, player_id);
            
            // Delete the player and their entity
            // Note: The client will detect this deletion through the onDelete handler

            //Delete the player from the player table
            ctx.Db.player.player_id.Delete(player_id);
            
            //Repair the player ordinal index for players and monsters
            RepairPlayerOrdinalIndexAfterDeletion(ctx, player_id);
            
            // Check if all players are now dead
            if (ctx.Db.player.Count == 0)
            {
                Log.Info("Last player has died! Resetting the game world...");
                ResetWorld(ctx);
            }

            return true;
        }
        else
        {
            // Player is still alive, update with reduced HP
            player.hp -= reducedDamage;
            ctx.Db.player.player_id.Update(player);

            return false;
        }
    }

    private static void RepairPlayerOrdinalIndexAfterDeletion(ReducerContext ctx, uint removedIndex)
    {
        var players = ctx.Db.player.Iter();
        int ordinal_index = 0;
        foreach (var player in players) 
        {
            //Skip until we find a hole in the ordinal indices
            if(ordinal_index < removedIndex)
            {
                ordinal_index++;
                continue;
            }
            else if(ordinal_index == removedIndex)
            {
                //Set monster target ordinal index to -1
                var monsters = ctx.Db.monsters.Iter();
                foreach (var monster in monsters)
                {
                    if (monster.target_player_ordinal_index == removedIndex)
                    {
                        var modifiedMonster = monster;
                        modifiedMonster.target_player_ordinal_index = -1;
                        ctx.Db.monsters.monster_id.Update(modifiedMonster);
                    }
                }
                ordinal_index++;
                continue;
            }
            else
            {
                var modifiedPlayer = player;
                var newOrdinalIndex = ordinal_index;

                //Fix monster target ordinal index  
                var monsters = ctx.Db.monsters.Iter();
                foreach (var monster in monsters)
                {
                    if (monster.target_player_ordinal_index == player.ordinal_index)
                    {
                        var modifiedMonster = monster;
                        modifiedMonster.target_player_ordinal_index = newOrdinalIndex;
                        ctx.Db.monsters.monster_id.Update(modifiedMonster);
                    }
                }   

                modifiedPlayer.ordinal_index = newOrdinalIndex;
                ctx.Db.player.player_id.Update(modifiedPlayer);
                ordinal_index++;
            }
        }
    }   
    
    // Helper method to clean up all attack-related data for a player
    private static void CleanupPlayerAttacks(ReducerContext ctx, uint playerId)
    {
        Log.Info($"Cleaning up all attack data for player {playerId}");
        
        // Step 1: Clean up active attacks using filter on player_id
        var activeAttacksToDelete = new List<uint>();
        var attackEntitiesToDelete = new List<uint>();
        
        // Use player_id filter on active_attacks if BTtree index exists
        foreach (var activeAttack in ctx.Db.active_attacks.player_id.Filter(playerId))
        {
            activeAttacksToDelete.Add(activeAttack.active_attack_id);
            attackEntitiesToDelete.Add(activeAttack.entity_id);
            
            // Clean up any damage records associated with this attack
            CleanupAttackDamageRecords(ctx, activeAttack.entity_id);
        }
        
        // Delete the active attacks
        foreach (var attackId in activeAttacksToDelete)
        {
            ctx.Db.active_attacks.active_attack_id.Delete(attackId);
        }
        
        // Delete the attack entities
        foreach (var entityId in attackEntitiesToDelete)
        {
            ctx.Db.entity.entity_id.Delete(entityId);
        }
        
        Log.Info($"Deleted {activeAttacksToDelete.Count} active attacks and their associated entities for player {playerId}");
        
        // Step 2: Clean up attack burst cooldowns using filter on player_id
        var burstCooldownsToDelete = new List<ulong>();
        
        foreach (var burstCooldown in ctx.Db.attack_burst_cooldowns.player_id.Filter(playerId))
        {
            burstCooldownsToDelete.Add(burstCooldown.scheduled_id);
        }
        
        // Delete the burst cooldowns
        foreach (var scheduledId in burstCooldownsToDelete)
        {
            ctx.Db.attack_burst_cooldowns.scheduled_id.Delete(scheduledId);
        }
        
        Log.Info($"Deleted {burstCooldownsToDelete.Count} attack burst cooldowns for player {playerId}");
        
        // Step 3: Clean up scheduled attacks using filter on player_id
        var scheduledAttacksToDelete = new List<ulong>();
        
        foreach (var scheduledAttack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
        {
            scheduledAttacksToDelete.Add(scheduledAttack.scheduled_id);
        }
        
        // Delete the scheduled attacks
        foreach (var scheduledId in scheduledAttacksToDelete)
        {
            ctx.Db.player_scheduled_attacks.scheduled_id.Delete(scheduledId);
        }
        
        Log.Info($"Deleted {scheduledAttacksToDelete.Count} scheduled attacks for player {playerId}");
        
        // Step 4: Clean up active attack cleanup schedules
        // We need to do this more efficiently using the attackIDs we already collected
        if (activeAttacksToDelete.Any())
        {
            var attackCleanupsToDelete = new List<ulong>();
            
            // Process cleanup entries in batches for better performance
            foreach (var attackId in activeAttacksToDelete)
            {
                // Filter by active_attack_id if available as an index
                foreach (var cleanup in ctx.Db.active_attack_cleanup.active_attack_id.Filter(attackId))
                {
                    attackCleanupsToDelete.Add(cleanup.scheduled_id);
                }
            }
            
            // Delete the attack cleanups
            foreach (var scheduledId in attackCleanupsToDelete)
            {
                ctx.Db.active_attack_cleanup.scheduled_id.Delete(scheduledId);
            }
            
            Log.Info($"Deleted {attackCleanupsToDelete.Count} attack cleanup schedules for player {playerId}");
        }
    }

    // Helper method to clean up all pending upgrade options for a player
    private static void CleanupPlayerUpgradeOptions(ReducerContext ctx, uint playerId)
    {
        Log.Info($"Cleaning up all upgrade options for player {playerId}");
        
        // Get all upgrade options for this player
        var upgradeOptionsToDelete = new List<uint>();
        
        // Use player_id filter on upgrade_options to find all options for this player
        foreach (var option in ctx.Db.upgrade_options.player_id.Filter(playerId))
        {
            upgradeOptionsToDelete.Add(option.upgrade_id);
        }
        
        // Delete all found upgrade options
        foreach (var optionId in upgradeOptionsToDelete)
        {
            ctx.Db.upgrade_options.upgrade_id.Delete(optionId);
        }
        
        Log.Info($"Deleted {upgradeOptionsToDelete.Count} upgrade options for player {playerId}");
    }

    [Reducer]
    public static void GameTick(ReducerContext ctx, GameTickTimer timer)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer GameTick may not be invoked by clients, only via scheduling.");
        }

        if(errorFlag)
        {
            //If there was an error, don't process the game tick
            return;
        }

        var worldOpt = ctx.Db.world.world_id.Find(0);
        if (worldOpt != null)
        {
            var world = worldOpt.Value;
            world.tick_count += 1;
            if(world.tick_count % 20 == 0)
            {
                Log.Info($"Game tick: {world.tick_count}");
            }
            ctx.Db.world.world_id.Update(world);
        }

        // Get world size from config
        uint worldSize = 20000; // Default fallback (10x larger)
        uint tick_rate = 50;
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            worldSize = configOpt.Value.world_size;
            tick_rate = configOpt.Value.game_tick_rate;
        }

        // Schedule the next game tick as a one-off event
        ctx.Db.game_tick_timer.Insert(new GameTickTimer
        {
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(tick_rate))
        });

        ClearCollisionCacheForFrame();

        ProcessPlayerMovement(ctx, tick_rate, worldSize);
        ProcessMonsterMovements(ctx);
        ProcessAttackMovements(ctx);
        MaintainGems(ctx);

        ProcessPlayerMonsterCollisionsSpatialHash(ctx);
        ProcessMonsterAttackCollisionsSpatialHash(ctx);
        ProcessGemCollisionsSpatialHash(ctx);
    }
}