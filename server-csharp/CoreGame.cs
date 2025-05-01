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
        ctx.Db.monster_damage.Insert(new MonsterDamage
        {
            monster_id = monsterId,
            attack_entity_id = attackEntityId
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
            // Monster is dead - log and delete
            Log.Info($"Monster {monster.monster_id} (type: {monster.bestiary_id}) was killed!");
            
            // Get the monster's position before deleting it
            var entityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            DbVector2 position = entityOpt != null
                ? entityOpt.Value.position
                : new DbVector2(0, 0); // Fallback if entity not found
            
            // Clean up any monster damage records for this monster
            CleanupMonsterDamageRecords(ctx, monsterId);

            // Spawn a gem at the monster's position
            SpawnGemOnMonsterDeath(ctx, monsterId, position);
            
            // Delete the monster
            ctx.Db.monsters.monster_id.Delete(monsterId);
            
            // Delete the entity
            ctx.Db.entity.entity_id.Delete(monster.entity_id);
            
            return true;
        }
        else
        {
            // Monster is still alive, update with reduced HP
            monster.hp -= damageAmount;
            ctx.Db.monsters.monster_id.Update(monster);
            
            // Log the damage
            Log.Info($"Monster {monster.monster_id} (type: {monster.bestiary_id}) took {damageAmount} damage. HP: {monster.hp}/{monster.max_hp}");
            
            return false;
        }
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
    public static bool DamagePlayer(ReducerContext ctx, uint player_id, uint damage_amount)
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
        
        // Make sure we don't underflow
        if (player.hp <= damage_amount)
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
            
            // Delete the player and their entity
            // Note: The client will detect this deletion through the onDelete handler

            //Delete the player from the player tableb
            ctx.Db.player.player_id.Delete(player_id);

            //Delete the entity from the entity table
            var entity_id = player.entity_id;
            ctx.Db.entity.entity_id.Delete(entity_id);

            return true;
        }
        else
        {
            // Player is still alive, update with reduced HP
            player.hp -= damage_amount;
            ctx.Db.player.player_id.Update(player);
            
            // Log the damage
            Log.Info($"Player {player.name} (ID: {player.player_id}) took {damage_amount} damage. HP: {player.hp}/{player.max_hp}");

            return false;
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

        // Get world size from config
        uint worldSize = 2000; // Default fallback
        uint tick_rate = 50;
        var configOpt = ctx.Db.config.id.Find(0);
        if (configOpt != null)
        {
            worldSize = configOpt.Value.world_size;
            tick_rate = configOpt.Value.game_tick_rate;
        }

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
        
        // Process monster movements
        ProcessMonsterMovements(ctx);
        
        // Process attack movements (moved to Attacks.cs)
        ProcessAttackMovements(ctx, worldSize);

        // Check for collisions between players and monsters
        ProcessPlayerMonsterCollisions(ctx);
        
        // Check for collisions between attacks and monsters
        ProcessMonsterAttackCollisions(ctx);
        
        // Check for collisions between players and gems
        ProcessGemCollisions(ctx);
    }
    
    // Helper method to process collisions between attacks and monsters
    private static void ProcessMonsterAttackCollisions(ReducerContext ctx)
    {
        // Load all monsters with entities
        var monsterEntities = new Dictionary<uint, (Entity entity, Monsters monster)>();
        
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            var entityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            if (entityOpt != null)
            {
                monsterEntities[monster.entity_id] = (entityOpt.Value, monster);
            }
        }
        
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
            foreach (var monsterEntry in monsterEntities)
            {
                uint monsterEntityId = monsterEntry.Key;
                var (monsterEntity, monster) = monsterEntry.Value;
                
                // Check if the attack is colliding with this monster
                if (AreEntitiesColliding(attackEntity, monsterEntity))
                {
                    // Check if this monster has already been hit by this attack
                    if (HasMonsterBeenHitByAttack(ctx, monster.monster_id, attackEntity.entity_id))
                    {
                        continue; // Skip if monster already hit by this attack
                    }
                    
                    // Record the hit
                    RecordMonsterHitByAttack(ctx, monster.monster_id, attackEntity.entity_id);
                    
                    // Apply damage to monster using the active attack's damage value
                    uint damage = activeAttack.damage;
                    
                    // Apply armor piercing if needed
                    // (Not implemented in this version)
                    
                    Log.Info($"Player attack hit monster {monster.monster_id}: Type={activeAttack.attack_type}, Damage={damage}");
                    
                    bool monsterKilled = DamageMonster(ctx, monster.monster_id, damage);
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
    
    // Helper method to process collisions between players and monsters and apply damage
    private static void ProcessPlayerMonsterCollisions(ReducerContext ctx)
    {        
        // Keep track of monster positions and types
        var monsterEntities = new Dictionary<uint, Entity>();
        var monsterAtks = new Dictionary<uint, float>();
        
        // Load all monsters with entities
        foreach (var monster in ctx.Db.monsters.Iter())
        {
            var entityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
            if (entityOpt != null)
            {
                monsterEntities[monster.entity_id] = entityOpt.Value;
                
                // Get monster attack value from bestiary
                var bestiaryEntryOpt = ctx.Db.bestiary.bestiary_id.Find((uint)monster.bestiary_id);
                if (bestiaryEntryOpt != null)
                {
                    monsterAtks[monster.entity_id] = bestiaryEntryOpt.Value.atk;
                }
                else
                {
                    // Default attack if bestiary entry not found
                    monsterAtks[monster.entity_id] = 1.0f;
                }
            }
        }
        
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
            foreach (var monsterEntry in monsterEntities)
            {
                uint monsterId = monsterEntry.Key;
                Entity monsterEntity = monsterEntry.Value;
                
                // Check if player is colliding with this monster
                if (AreEntitiesColliding(playerEntity, monsterEntity))
                {
                    // Get monster attack value
                    float monsterAtk = monsterAtks.GetValueOrDefault(monsterId, 1.0f);
                    
                    // Calculate damage, taking player armor into account
                    // Armor reduces damage by its value (minimum damage is 1)
                    uint finalDamage = (uint)Math.Max(1, Math.Ceiling(monsterAtk - (player.armor * 0.1f)));
                    
                    // Apply damage to player
                    playerIsDead = DamagePlayer(ctx, player.player_id, finalDamage);

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
}