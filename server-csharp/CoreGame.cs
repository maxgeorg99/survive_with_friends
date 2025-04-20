using SpacetimeDB;

public static partial class Module
{
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
    public static void DamagePlayer(ReducerContext ctx, uint player_id, uint damage_amount)
    {
        // Find the player
        var playerOpt = ctx.Db.player.player_id.Find(player_id);
        if (playerOpt is null)
        {
            throw new Exception($"DamagePlayer: Player {player_id} does not exist.");
        }
        
        // Get the player and reduce HP
        var player = playerOpt.Value;
        
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
                throw new Exception($"DamagePlayer: Player {player.name} (ID: {player.player_id}) could not be moved to dead_players table.");
            }

            Log.Info($"Player {player.name} (ID: {player.player_id}) moved to dead_players table.");
            
            // Delete the player and their entity
            // Note: The client will detect this deletion through the onDelete handler
            ctx.Db.player.player_id.Delete(player.player_id);
            ctx.Db.entity.entity_id.Delete(player.entity_id);
        }
        else
        {
            // Player is still alive, update with reduced HP
            player.hp -= damage_amount;
            ctx.Db.player.player_id.Update(player);
            
            // Log the damage
            Log.Info($"Player {player.name} (ID: {player.player_id}) took {damage_amount} damage. HP: {player.hp}/{player.max_hp}");
        }
    }
    
    [Reducer]
    public static void GameTick(ReducerContext ctx, GameTickTimer timer)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("Reducer GameTick may not be invoked by clients, only via scheduling.");
        }

        // Process all movable players
        foreach (var player in ctx.Db.player.Iter())
        {
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
            
            // Update entity in database
            ctx.Db.entity.entity_id.Update(updatedEntity);
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
                    DamagePlayer(ctx, player.player_id, finalDamage);
                    
                    Log.Info($"Monster {monsterId} damaged player {player.name} for {finalDamage} damage (ATK: {monsterAtk}, Armor: {player.armor})");
                }
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