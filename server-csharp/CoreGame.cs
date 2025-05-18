using SpacetimeDB;
using System;
using System.Collections.Generic;
using System.Linq;

public static partial class Module
{
    static bool errorFlag = false;

    // Table to track which monsters have been hit by which attacks
    [SpacetimeDB.Table(Name = "monster_damage", Public = true)]
    public partial struct MonsterDamage
    {
        [PrimaryKey, AutoInc]
        public uint damage_id;
        
        [SpacetimeDB.Index.BTree]
        public uint monster_id;       // The monster that was hit

        [SpacetimeDB.Index.BTree]
        public uint attack_entity_id; // The attack entity that hit the monster
    }

    // Scheduled table for monster hit cleanup
    [SpacetimeDB.Table(Name = "monster_hit_cleanup", 
                       Scheduled = nameof(CleanupMonsterHitRecord), 
                       ScheduledAt = nameof(scheduled_at))]
    public partial struct MonsterHitCleanup
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        public uint damage_id;        // The damage record to clean up
        public ScheduleAt scheduled_at; // When to clean up the record
    }

    // Table to track which players are poisoned by scorpions
    [SpacetimeDB.Table(Name = "player_poison_effect", Public = true, 
                      Scheduled = nameof(RemovePoisonEffect), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct PlayerPoisonEffect
    {
        [PrimaryKey, AutoInc]
        public ulong poison_id;
        
        [SpacetimeDB.Index.BTree]
        public uint player_id;       // The player that is poisoned
        
        public float original_speed;  // The player's original speed before poison
        public float poisoned_speed;  // The player's reduced speed while poisoned
        public ScheduleAt scheduled_at; // When the poison effect will expire
    }

    // Helper function to check if a monster has already been hit by an attack
    private static bool HasMonsterBeenHitByAttack(ReducerContext ctx, uint monsterId, uint attackEntityId)
    {
        // First filter: Use the BTree index to efficiently find all damage records for this attack
        var attackDamageRecords = ctx.Db.monster_damage.attack_entity_id.Filter(attackEntityId);
        
        // Second filter: Check if any of those records match our monster
        foreach (var damage in attackDamageRecords)
        {
            if (damage.monster_id == monsterId)
            {
                return true; // Found a record - this monster was hit by this attack
            }
        }
        
        return false; // No matching record found
    }

    // Helper function to record a monster being hit by an attack
    private static void RecordMonsterHitByAttack(ReducerContext ctx, uint monsterId, uint attackEntityId)
    {
        // Insert the damage record
        MonsterDamage? damageRecord = ctx.Db.monster_damage.Insert(new MonsterDamage
        {
            monster_id = monsterId,
            attack_entity_id = attackEntityId
        });
        
        if (damageRecord == null)
        {
            Log.Error($"Failed to insert monster damage record for monster {monsterId}, attack {attackEntityId}");
            return;
        }
        
        // Get cleanup delay from config
        uint cleanupDelay = 500; // Default to 500ms if config not found
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            cleanupDelay = configOpt.Value.monster_hit_cleanup_delay;
        }
        
        // Schedule cleanup after the configured delay
        ctx.Db.monster_hit_cleanup.Insert(new MonsterHitCleanup
        {
            damage_id = damageRecord.Value.damage_id,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(cleanupDelay))
        });
    }

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
            // Get the monster's position before deleting it
            var entityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            DbVector2 position = entityOpt != null
                ? entityOpt.Value.position
                : new DbVector2(0, 0); // Fallback if entity not found
            
            // Clean up any monster damage records for this monster
            CleanupMonsterDamageRecords(ctx, monsterId);
            
            // Check if this is a boss monster
            bool isBoss = false;
            var gameStateOpt = ctx.Db.game_state.id.Find(0);
                        
            // Use last_damager_identity for achievement tracking
            if (!monster.last_damager_identity.Equals(default(SpacetimeDB.Identity)))
            {
                TrackMonsterKill(ctx, monster.last_damager_identity, monster.bestiary_id);
            }
            else
            {
                Log.Warn($"No killer found for monster {monsterId} (type: {monster.bestiary_id}). Achievement not tracked for this kill.");
            }
            
            if (gameStateOpt != null && gameStateOpt.Value.boss_active && gameStateOpt.Value.boss_monster_id == monsterId)
            {
                isBoss = true;
                Log.Info($"BOSS MONSTER CONFIRMED: ID={monsterId}, Phase={gameStateOpt.Value.boss_phase}, Monster Type: {monster.bestiary_id}");
                
                // Handle based on boss phase
                if (gameStateOpt.Value.boss_phase == 1)
                {
                    // Phase 1 boss defeated, transition to phase 2
                    Log.Info("BOSS PHASE 1 DEFEATED! TRANSITIONING TO PHASE 2...");
                    Log.Info($"Phase 1 details - Entity ID: {monster.entity_id}, Position: ({position.x}, {position.y})");
                    
                    // Store the entity ID and position before deletion
                    uint entityId = monster.entity_id;
                    DbVector2 bossPosition = position;
                    
                    // Spawn phase 2 first, before deleting phase 1 monster
                    Log.Info("Calling SpawnBossPhaseTwo now...");
                    try 
                    {
                        SpawnBossPhaseTwo(ctx, entityId, bossPosition);
                        Log.Info("SpawnBossPhaseTwo completed successfully");
                        
                        // Only after successful spawn of phase 2, delete phase 1
                        ctx.Db.monsters.monster_id.Delete(monsterId);
                        ctx.Db.entity.entity_id.Delete(entityId);
                        Log.Info("Phase 1 boss monster and entity deleted after phase 2 spawned");
                    }
                    catch (Exception ex)
                    {
                        Log.Info($"ERROR spawning boss phase 2: {ex.Message}");
                        // Don't rethrow - we still want to delete the phase 1 boss
                        ctx.Db.monsters.monster_id.Delete(monsterId);
                        ctx.Db.entity.entity_id.Delete(entityId);
                        Log.Info("Phase 1 boss monster and entity deleted after spawn failure");
                    }
                    
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
                                Log.Info($"Phase 2 boss verified: Monster ID={phase2BossOpt.Value.monster_id}, HP={phase2BossOpt.Value.hp}, Entity ID={phase2BossOpt.Value.entity_id}");
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
                    
                    // Track the boss defeat for the player who killed it
                    if (!monster.last_damager_identity.Equals(default(SpacetimeDB.Identity)))
                    {
                        // Mark the player as a survivor (won the game)
                        TrackGameWin(ctx, monster.last_damager_identity);
                    }
                    
                    // Delete the monster and entity
                    ctx.Db.monsters.monster_id.Delete(monsterId);
                    ctx.Db.entity.entity_id.Delete(monster.entity_id);
                    
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
                
                // Delete the entity
                ctx.Db.entity.entity_id.Delete(monster.entity_id);
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
    
    // Helper method to find the player who dealt the killing blow to a monster
    private static Identity FindMonsterKiller(ReducerContext ctx, uint monsterId)
    {
        // Check for the most recent damage dealt to this monster
        var latestDamage = ctx.Db.monster_damage.monster_id.Filter(monsterId)
            .OrderByDescending(damage => damage.damage_id) // Assuming higher IDs are more recent
            .FirstOrDefault();
            
        if (latestDamage.Equals(default(Module.MonsterDamage)))
        {
            return default; // No damage records found
        }
        
        // Find the attack that caused this damage
        var attack = ctx.Db.active_attacks.Iter()
            .FirstOrDefault(a => a.entity_id == latestDamage.attack_entity_id);
            
        if (attack.Equals(default(Module.ActiveAttack)))
        {
            return default; // Attack not found (might have been already cleaned up)
        }
        
        return ctx.Db.account.Iter().FirstOrDefault(a => a.current_player_id == attack.player_id).identity;
    }

    [Reducer]
    public static void UpdatePlayerDirection(ReducerContext ctx, float dirX, float dirY)
    {
        var identity = ctx.Sender;
        // Find the player record for the caller

        //Find the account for the caller   
        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt is null)
        {
            throw new Exception($"UpdatePlayerDirection: Account {identity} does not exist.");
        }

        var account = accountOpt.Value;
        var player_id = account.current_player_id;

        var playerOpt = ctx.Db.player.player_id.Find(player_id);
        if (playerOpt is null)
        {
            throw new Exception($"UpdatePlayerDirection: Player {player_id} does not exist.");
        }
        var player = playerOpt.Value;
        
        // Get direction vector and determine if player is attempting to move
        var direction = new DbVector2(dirX, dirY);
        bool isMoving = dirX != 0 || dirY != 0;
        
        // Find the entity associated with this player
        var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
        if (entityOpt is null)
        {
            throw new Exception($"UpdatePlayerDirection: Player {player_id} (entity_id: {player.entity_id}) has no matching entity! Cannot update direction.");
        }
        
        // Update entity with new direction and movement state
        var entity = entityOpt.Value;
        entity.direction = isMoving ? direction.Normalize() : direction;
        entity.is_moving = isMoving;
        
        // Update the entity in the database
        ctx.Db.entity.entity_id.Update(entity);
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

            //Delete the player from the player tableb
            ctx.Db.player.player_id.Delete(player_id);

            //Delete the entity from the entity table
            var entity_id = player.entity_id;
            ctx.Db.entity.entity_id.Delete(entity_id);
            
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
    
    // Helper method to clean up all attack-related data for a player
    private static void CleanupPlayerAttacks(ReducerContext ctx, uint playerId)
    {        
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
            if(world.tick_count % 100 == 0)
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

        ProcessPlayerMovement(ctx, tick_rate, worldSize);
        ProcessMonsterMovements(ctx);
        ProcessMonsterBehavior(ctx); // New - process special monster behaviors like Worm's projectile attack
        ProcessAttackMovements(ctx, worldSize);
        ProcessBossAttackMovements(ctx, worldSize);

        ProcessPlayerMonsterCollisions(ctx);
        ProcessMonsterAttackCollisions(ctx);
        ProcessPlayerBossAttackCollisions(ctx);
        ProcessGemCollisions(ctx);
    }

    private static void ProcessPlayerMovement(ReducerContext ctx, uint tick_rate, uint worldSize)
    {
        // Process all movable players
        foreach (var player in ctx.Db.player.Iter())
        {
            // Update player status
            if(player.spawn_grace_period_remaining > 0)
            {
                var playerOpt = ctx.Db.player.player_id.Find(player.player_id);
                if(playerOpt != null)
                {
                    var modifiedPlayer = playerOpt.Value;
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
            }

            // Process player movement
            float moveSpeed = player.speed;

            var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);

            if(entityOpt is null)
            {
                continue;
            }

            var entity = entityOpt.Value;

            if (!entity.is_moving)
            {
                continue;
            }
            
            // Calculate new position based on direction, speed and time delta
            float moveDistance = moveSpeed * DELTA_TIME;
            var moveOffset = entity.direction * moveDistance;
            
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
    
    // Helper method to process collisions between attacks and monsters
    private static void ProcessMonsterAttackCollisions(ReducerContext ctx)
    {        
        // Check each active attack for collisions with monsters
        foreach (var activeAttack in ctx.Db.active_attacks.Iter())
        {
            // Get the attack entity
            var attackEntityOpt = ctx.Db.entity.entity_id.Find(activeAttack.entity_id);
            if (attackEntityOpt is null)
            {
                continue; // Skip if entity not found
            }
            
            var attackEntity = attackEntityOpt.Value;
            
            bool attackHitMonster = false;
            
            // Check for collisions with monsters
            foreach (var monsterEntry in ctx.Db.monsters.Iter())
            {
                var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monsterEntry.entity_id);
                if(monsterEntityOpt == null)
                {
                    continue;
                }
                Entity monsterEntity = monsterEntityOpt.Value;
                
                // Check if the attack is colliding with this monster
                if (AreEntitiesColliding(attackEntity, monsterEntity))
                {
                    // Check if this monster has already been hit by this attack
                    if (HasMonsterBeenHitByAttack(ctx, monsterEntry.monster_id, attackEntity.entity_id))
                    {
                        continue; // Skip if monster already hit by this attack
                    }
                    
                    // Record the hit
                    RecordMonsterHitByAttack(ctx, monsterEntry.monster_id, attackEntity.entity_id);
                    
                    // --- Set last_damager_identity to the attacker's identity ---
                    var monster = monsterEntry;
                    var playerOpt = ctx.Db.player.player_id.Find(activeAttack.player_id);
                    if (playerOpt != null)
                    {
                        var player = playerOpt.Value;
                        var accountOpt = ctx.Db.account.Iter().FirstOrDefault(a => a.current_player_id == player.player_id);
                        if (!accountOpt.Equals(default(Module.Account)))
                        {
                            monster.last_damager_identity = accountOpt.identity;
                            ctx.Db.monsters.monster_id.Update(monster);
                        }
                    }
                    // ----------------------------------------------------------
                    
                    // Apply damage to monster using the active attack's damage value
                    uint damage = activeAttack.damage;
                    
                    // Apply armor piercing if needed
                    // (Not implemented in this version)
                    
                    bool monsterKilled = DamageMonster(ctx, monsterEntry.monster_id, damage);
                    attackHitMonster = true;
                    
                    // For non-piercing attacks, stop checking other monsters and destroy the attack
                    if (!activeAttack.piercing)
                    {
                        break;
                    }
                }
            }
            
            // If the attack hit a monster and it's not piercing, remove the attack
            if (attackHitMonster && !activeAttack.piercing)
            {
                // Delete the attack entity
                ctx.Db.entity.entity_id.Delete(attackEntity.entity_id);
                
                // Delete the active attack record
                ctx.Db.active_attacks.active_attack_id.Delete(activeAttack.active_attack_id);
                
                // Clean up any damage records for this attack
                CleanupAttackDamageRecords(ctx, attackEntity.entity_id);
            }
        }
    }
    
    // Helper method to process collisions between boss attacks and players
    private static void ProcessPlayerBossAttackCollisions(ReducerContext ctx)
    {
        // Check each active boss attack for collisions with players
        foreach (var activeBossAttack in ctx.Db.active_boss_attacks.Iter())
        {
            // Get the boss attack entity
            var attackEntityOpt = ctx.Db.entity.entity_id.Find(activeBossAttack.entity_id);
            if (attackEntityOpt is null)
            {
                continue; // Skip if entity not found
            }
            var attackEntity = attackEntityOpt.Value;
            
            bool attackHitPlayer = false;
            
            // Check for collisions with players
            foreach (var player in ctx.Db.player.Iter())
            {
                var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
                if (playerEntityOpt == null)
                {
                    continue; // Skip if player has no entity
                }
                Entity playerEntity = playerEntityOpt.Value;
                
                // Check if the attack is colliding with this player
                if (AreEntitiesColliding(attackEntity, playerEntity))
                {
                    // Apply damage to player using the active boss attack's damage value
                    bool playerKilled = DamagePlayer(ctx, player.player_id, activeBossAttack.damage);
                    attackHitPlayer = true;
                    
                    // Check if this is a scorpion sting attack that causes poison
                    if (activeBossAttack.attack_type == AttackType.ScorpionSting && activeBossAttack.parameter_u == 1)
                    {
                        // Apply poison effect to the player
                        ApplyPoisonToPlayer(ctx, player.player_id);
                    }

                    // For non-piercing attacks, stop checking other players and destroy the attack
                    if (!activeBossAttack.piercing)
                    {
                        break; 
                    }
                }
            }
            
            // If the attack hit a player and it's not piercing, remove the attack
            if (attackHitPlayer && !activeBossAttack.piercing)
            {
                // Delete the attack entity
                ctx.Db.entity.entity_id.Delete(attackEntity.entity_id);
                
                // Delete the active boss attack record
                // Also need to find the corresponding cleanup job and delete it.
                ActiveBossAttackCleanup? cleanupToDelete = null;
                foreach (var cleanupEntry in ctx.Db.active_boss_attack_cleanup.active_boss_attack_id.Filter(activeBossAttack.active_boss_attack_id))
                {
                    cleanupToDelete = cleanupEntry;
                    break; // Assuming one cleanup per attack ID
                }

                if (cleanupToDelete != null) {
                    ctx.Db.active_boss_attack_cleanup.scheduled_id.Delete(cleanupToDelete.Value.scheduled_id);
                }
                ctx.Db.active_boss_attacks.active_boss_attack_id.Delete(activeBossAttack.active_boss_attack_id);
                
                // Clean up any damage records for this attack (if we were tracking boss attack damage - currently not)
                // CleanupAttackDamageRecords(ctx, attackEntity.entity_id); // This function is for player attacks on monsters
            }
        }
    }

    // Helper method to process collisions between players and monsters and apply damage
    private static void ProcessPlayerMonsterCollisions(ReducerContext ctx)
    {        
        // Check each player for collisions with monsters
        foreach (var player in ctx.Db.player.Iter())
        {
            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (playerEntityOpt == null)
            {
                continue; // Skip if player has no entity
            }
            
            Entity playerEntity = playerEntityOpt.Value;

            bool playerIsDead = false;
            
            // Check against each monster
            foreach (var monsterEntry in ctx.Db.monsters.Iter())
            {
                uint monsterId = monsterEntry.monster_id;

                Entity? monsterEntityOpt = ctx.Db.entity.entity_id.Find(monsterEntry.entity_id);
                if(monsterEntityOpt == null)
                {
                    continue;
                }

                Entity monsterEntity = monsterEntityOpt.Value;
                
                // Check if player is colliding with this monster
                if (AreEntitiesColliding(playerEntity, monsterEntity))
                {                    
                    // Apply damage to player
                    playerIsDead = DamagePlayer(ctx, player.player_id, monsterEntry.atk);

                    if(playerIsDead)
                    {
                        break;
                    }
                }
            }

            if(playerIsDead)
            {
                continue;
            }
        }
    }
    
    // Helper function to check if two entities are colliding using circle-based detection
    private static bool AreEntitiesColliding(Entity entityA, Entity entityB)
    {
        // Get the distance between the two entities
        float dx = entityA.position.x - entityB.position.x;
        float dy = entityA.position.y - entityB.position.y;
        float distanceSquared = dx * dx + dy * dy;
        
        // Calculate the minimum distance to avoid collision (sum of both radii)
        float minDistance = entityA.radius + entityB.radius;
        float minDistanceSquared = minDistance * minDistance;
        
        // If distance squared is less than minimum distance squared, they are colliding
        return distanceSquared < minDistanceSquared;
    }
    
    // Helper function to calculate the overlap between two entities
    private static float GetEntitiesOverlap(Entity entityA, Entity entityB)
    {
        // Get the distance between the two entities
        float dx = entityA.position.x - entityB.position.x;
        float dy = entityA.position.y - entityB.position.y;
        float distance = MathF.Sqrt(dx * dx + dy * dy);
        
        // Calculate the minimum distance to avoid collision (sum of both radii)
        float minDistance = entityA.radius + entityB.radius;
        
        // Calculate overlap (positive value means they are overlapping)
        return minDistance - distance;
    }
    
    // Helper function to get a repulsion vector based on overlap
    private static DbVector2 GetRepulsionVector(Entity entityA, Entity entityB, float overlap)
    {
        // Direction from B to A (the direction to push A away from B)
        float dx = entityA.position.x - entityB.position.x;
        float dy = entityA.position.y - entityB.position.y;
        
        // Normalize the direction vector
        float distance = MathF.Sqrt(dx * dx + dy * dy);
        
        // Avoid division by zero
        if (distance < 0.0001f)
        {
            // If entities are exactly at the same position, push in a random direction
            return new DbVector2(0.707f, 0.707f); // 45-degree angle
        }
        
        float nx = dx / distance;
        float ny = dy / distance;
        
        // Scale the repulsion by the overlap amount
        // The larger the overlap, the stronger the repulsion
        float repulsionStrength = overlap * 0.5f; // Adjust this factor as needed
        
        return new DbVector2(nx * repulsionStrength, ny * repulsionStrength);
    }

    // Helper method to apply the scorpion poison effect to a player
    private static void ApplyPoisonToPlayer(ReducerContext ctx, uint playerId)
    {
        // First check if player is already poisoned
        bool alreadyPoisoned = false;
        foreach (var poisonEffect in ctx.Db.player_poison_effect.player_id.Filter(playerId))
        {
            alreadyPoisoned = true;
            break;
        }
        
        // If already poisoned, just refresh the duration but don't stack the effect
        if (alreadyPoisoned)
        {
            // Find the poison effect and update its scheduled time
            foreach (var poisonEffect in ctx.Db.player_poison_effect.player_id.Filter(playerId))
            {
                var updatedEffect = poisonEffect;
                // Refresh the timer for 1 second
                updatedEffect.scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(1000));
                ctx.Db.player_poison_effect.poison_id.Update(updatedEffect);
                return;
            }
        }
        
        // Get the player to apply the poison effect
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt == null)
        {
            Log.Error($"Cannot apply poison effect: Player {playerId} not found");
            return;
        }
        
        var player = playerOpt.Value;
        
        // Calculate the reduced speed (60% of original)
        float originalSpeed = player.speed;
        float poisonedSpeed = originalSpeed * 0.6f;
        
        // Apply the slower speed
        player.speed = poisonedSpeed;
        ctx.Db.player.player_id.Update(player);
        
        // Create a poison effect record that will restore the speed when it expires
        ctx.Db.player_poison_effect.Insert(new PlayerPoisonEffect
        {
            player_id = playerId,
            original_speed = originalSpeed,
            poisoned_speed = poisonedSpeed,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(1000)) // 1 second duration
        });
            }

    // Reducer method to remove poison effect when it expires
    [Reducer]
    public static void RemovePoisonEffect(ReducerContext ctx, PlayerPoisonEffect poisonEffect)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("RemovePoisonEffect may not be invoked by clients, only via scheduling.");
        }
        
        // Get the player
        var playerOpt = ctx.Db.player.player_id.Find(poisonEffect.player_id);
        if (playerOpt == null)
        {
            // Player may have died or otherwise been removed
            ctx.Db.player_poison_effect.poison_id.Delete(poisonEffect.poison_id);
            return;
        }
        
        var player = playerOpt.Value;
        
        // Make sure the player still has the reduced speed (might have been changed by other effects)
        if (Math.Abs(player.speed - poisonEffect.poisoned_speed) < 0.001f)
        {
            // Restore original speed
            player.speed = poisonEffect.original_speed;
            ctx.Db.player.player_id.Update(player);
         }
        
        // Delete the poison effect record
        ctx.Db.player_poison_effect.poison_id.Delete(poisonEffect.poison_id);
    }

    // Reducer to clean up a monster hit record
    [Reducer]
    public static void CleanupMonsterHitRecord(ReducerContext ctx, MonsterHitCleanup cleanup)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("CleanupMonsterHitRecord may not be invoked by clients, only via scheduling.");
        }
        
        // Delete the damage record
        ctx.Db.monster_damage.damage_id.Delete(cleanup.damage_id);
    }
}