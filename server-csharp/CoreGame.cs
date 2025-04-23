using SpacetimeDB;

public static partial class Module
{
    static bool errorFlag = false;

    [Reducer]
    public static void UpdatePlayerDirection(ReducerContext ctx, float dirX, float dirY)
    {
        var identity = ctx.Sender;
        // Find the player record for the caller

        //Find the account for the caller   
        var accountOpt = ctx.Db.Account.Identity.Find(identity);
        if (accountOpt is null)
        {
            throw new Exception($"UpdatePlayerDirection: Account {identity} does not exist.");
        }

        var account = accountOpt.Value;
        var player_id = account.CurrentPlayerId;

        var playerOpt = ctx.Db.Player.PlayerId.Find(player_id);
        if (playerOpt is null)
        {
            throw new Exception($"UpdatePlayerDirection: Player {player_id} does not exist.");
        }
        var player = playerOpt.Value;
        
        // Get direction vector and determine if player is attempting to move
        var direction = new DbVector2(dirX, dirY);
        bool isMoving = dirX != 0 || dirY != 0;
        
        // Find the entity associated with this player
        var entityOpt = ctx.Db.Entity.EntityId.Find(player.EntityId);
        if (entityOpt is null)
        {
            throw new Exception($"UpdatePlayerDirection: Player {player_id} (EntityId: {player.EntityId}) has no matching entity! Cannot update direction.");
        }
        
        // Update entity with new direction and movement state
        var entity = entityOpt.Value;
        entity.Direction = isMoving ? direction.Normalize() : direction;
        entity.IsMoving = isMoving;
        
        // Update the entity in the database
        ctx.Db.Entity.EntityId.Update(entity);
    }
    
    //Helper function to damage a player
    //Returns true if the player is dead, false otherwise
    public static bool DamagePlayer(ReducerContext ctx, uint player_id, uint damage_amount)
    {
        // Find the player
        var playerOpt = ctx.Db.Player.PlayerId.Find(player_id);
        if (playerOpt is null)
        {
            errorFlag = true;
            throw new Exception($"DamagePlayer: Player {player_id} does not exist.");
        }
        
        // Get the player and reduce HP
        var player = playerOpt.Value;
        
        // Make sure we don't underflow
        if (player.Hp <= damage_amount)
        {
            // Player is dead - set HP to 0
            player.Hp = 0;
            
            // Update player record with 0 HP before we delete
            ctx.Db.Player.PlayerId.Update(player);
            
            // Log the death
            Log.Info($"Player {player.Name} (ID: {player.PlayerId}) has died!");
            
            // Store the player in the dead_players table before removing them
            DeadPlayer? deadPlayerOpt = ctx.Db.DeadPlayers.Insert(new DeadPlayer
            {
                PlayerId = player.PlayerId,
                Name = player.Name
            });

            if (deadPlayerOpt is null)
            {
                errorFlag = true;
                throw new Exception($"DamagePlayer: Player {player.Name} (ID: {player.PlayerId}) could not be moved to DeadPlayers table.");
            }

            Log.Info($"Player {player.Name} (ID: {player.PlayerId}) moved to DeadPlayers table.");
            
            // Delete the player and their entity
            // Note: The client will detect this deletion through the onDelete handler

            //Delete the player from the player tableb
            ctx.Db.Player.PlayerId.Delete(player_id);

            //Delete the entity from the entity table
            var entity_id = player.EntityId;
            ctx.Db.Entity.EntityId.Delete(entity_id);

            return true;
        }
        else
        {
            // Player is still alive, update with reduced HP
            player.Hp -= damage_amount;
            ctx.Db.Player.PlayerId.Update(player);
            
            // Log the damage
            Log.Info($"Player {player.Name} (ID: {player.PlayerId}) took {damage_amount} damage. HP: {player.Hp}/{player.MaxHp}");

            return false;
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

        // Process all movable players
        foreach (var player in ctx.Db.Player.Iter())
        {
            float moveSpeed = player.Speed;

            var entityOpt = ctx.Db.Entity.EntityId.Find(player.EntityId);

            if(entityOpt is null)
            {
                continue;
            }

            var entity = entityOpt.Value;

            if (!entity.IsMoving)
            {
                continue;
            }
            
            // Calculate new position based on direction, speed and time delta
            float moveDistance = moveSpeed * DELTA_TIME;
            var moveOffset = entity.Direction * moveDistance;
            
            // Update entity with new position
            var updatedEntity = entity;
            updatedEntity.Position = entity.Position + moveOffset;
            
            // Update entity in database
            ctx.Db.Entity.EntityId.Update(updatedEntity);
        }
        
        // Process monster movements
        ProcessMonsterMovements(ctx);

        // Check for collisions between players and monsters
        ProcessPlayerMonsterCollisions(ctx);
    }
    
    // Helper method to process collisions between players and monsters and apply damage
    private static void ProcessPlayerMonsterCollisions(ReducerContext ctx)
    {        
        // Keep track of monster positions and types
        var monsterEntities = new Dictionary<uint, Entity>();
        var monsterAtks = new Dictionary<uint, float>();
        
        // Load all monsters with entities
        foreach (var monster in ctx.Db.Monsters.Iter())
        {
            var entityOpt = ctx.Db.Entity.EntityId.Find(monster.EntityId);
            if (entityOpt != null)
            {
                monsterEntities[monster.EntityId] = entityOpt.Value;
                
                // Get monster attack value from bestiary
                var bestiaryEntryOpt = ctx.Db.Bestiary.BestiaryId.Find((uint)monster.BestiaryId);
                if (bestiaryEntryOpt != null)
                {
                    monsterAtks[monster.EntityId] = bestiaryEntryOpt.Value.Atk;
                }
                else
                {
                    // Default attack if bestiary entry not found
                    monsterAtks[monster.EntityId] = 1.0f;
                }
            }
        }
        
        // Check each player for collisions with monsters
        foreach (var player in ctx.Db.Player.Iter())
        {
            var playerEntityOpt = ctx.Db.Entity.EntityId.Find(player.EntityId);
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
                    uint finalDamage = (uint)Math.Max(1, Math.Ceiling(monsterAtk - (player.Armor * 0.1f)));
                    
                    // Apply damage to player
                    playerIsDead = DamagePlayer(ctx, player.PlayerId, finalDamage);

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
        float dx = entityA.Position.x - entityB.Position.x;
        float dy = entityA.Position.y - entityB.Position.y;
        float distanceSquared = dx * dx + dy * dy;
        
        // Calculate the minimum distance to avoid collision (sum of both radii)
        float minDistance = entityA.Radius + entityB.Radius;
        float minDistanceSquared = minDistance * minDistance;
        
        // If distance squared is less than minimum distance squared, they are colliding
        return distanceSquared < minDistanceSquared;
    }
    
    // Helper function to calculate the overlap between two entities
    private static float GetEntitiesOverlap(Entity entityA, Entity entityB)
    {
        // Get the distance between the two entities
        float dx = entityA.Position.x - entityB.Position.x;
        float dy = entityA.Position.y - entityB.Position.y;
        float distance = MathF.Sqrt(dx * dx + dy * dy);
        
        // Calculate the minimum distance to avoid collision (sum of both radii)
        float minDistance = entityA.Radius + entityB.Radius;
        
        // Calculate overlap (positive value means they are overlapping)
        return minDistance - distance;
    }
    
    // Helper function to get a repulsion vector based on overlap
    private static DbVector2 GetRepulsionVector(Entity entityA, Entity entityB, float overlap)
    {
        // Direction from B to A (the direction to push A away from B)
        float dx = entityA.Position.x - entityB.Position.x;
        float dy = entityA.Position.y - entityB.Position.y;
        
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