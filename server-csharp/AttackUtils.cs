using SpacetimeDB;
using System;

public static partial class Module
{
    // Utility class for attack-related helper functions
    public static class AttackUtils
    {
        public static uint GetParameterU(ReducerContext ctx, PlayerScheduledAttack attack)
        {
            var playerId = attack.player_id;
            var attackType = attack.attack_type;
            
            var playerOpt = ctx.Db.player.player_id.Find(playerId);
            if (playerOpt == null)
            {
                throw new Exception($"GetParameterU: Player {playerId} not found");
            }

            var player = playerOpt.Value;

            var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (entityOpt == null)
            {
                throw new Exception($"GetParameterU: Entity {player.entity_id} not found for player {playerId}");
            }

            var pEntity = entityOpt.Value;
            
            switch (attackType)
            {
                case AttackType.Sword:
                {
                    if (attack.parameter_u == 0)
                    {
                        return 1;
                    }
                    else
                    {
                        return 0;
                    }
                }
                case AttackType.Knives:
                {
                    //Random angle on a circle
                    var random = ctx.Rng;
                    var angle = random.NextDouble() * 360.0;
                    return (uint)(angle);
                }
                default:
                {
                    return 0;
                }
            }
        }   

        // Determine the direction of the attack based on attack type and other factors
        public static DbVector2 DetermineAttackDirection(ReducerContext ctx, uint playerId, AttackType attackType, uint idWithinBurst, uint parameterU, int parameterI)
        {
            // Get the player
            var playerOpt = ctx.Db.player.player_id.Find(playerId);
            if (playerOpt == null)
            {
                throw new Exception($"DetermineAttackDirection: Player {playerId} not found");
            }

            var player = playerOpt.Value;
            
            // Get the entity
            var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (entityOpt == null)
            {
                throw new Exception($"DetermineAttackDirection: Entity {player.entity_id} not found for player {playerId}");
            }

            var entity = entityOpt.Value;

            var attackData = FindAttackDataByType(ctx, attackType);
            if (attackData == null)
            {
                throw new Exception($"DetermineAttackDirection: Attack data not found for type {attackType}");
            }

            // Handle different attack types
            switch (attackType)
            {
                case AttackType.Sword:
                {
                    // Sword attacks swing Right then Left
                    var countParam = parameterU + idWithinBurst;
                    if (countParam % 2 == 0)
                    {
                        return new DbVector2(1, 0);
                    }
                    else
                    {
                        return new DbVector2(-1, 0);
                    }
                }
                case AttackType.Wand:
                {
                    // Wands shoot at the nearest enemy
                    Entity? nearestEnemy = FindNearestEnemy(ctx, entity);
                    if (nearestEnemy != null)
                    {
                        var enemyActual = nearestEnemy.Value;

                        // Calculate direction vector to the enemy
                        var dx = enemyActual.position.x - entity.position.x;
                        var dy = enemyActual.position.y - entity.position.y;
                        
                        // Normalize the direction
                        var length = Math.Sqrt(dx * dx + dy * dy);
                        if (length > 0)
                        {
                            return new DbVector2((float)(dx / length), (float)(dy / length));
                        }
                    }
                    
                    // If no enemies or calculation issue, use player's direction
                    return GetNormalizedDirection(entity.direction);
                }
                case AttackType.Knives:
                {
                    //Knives attack in a circle around the player starting at the angle specified in the parameter_u
                    //The angle is in degrees, so we need to convert it to radians
                    var startAngle = (double)parameterU * Math.PI / 180.0;                       
                    var angleStep = 360.0 / (double)attackData.Value.projectiles;
                    var attackAngle = startAngle + (angleStep * (double)idWithinBurst);
                    return new DbVector2((float)Math.Cos(attackAngle), (float)Math.Sin(attackAngle));   
                }
                case AttackType.Shield:
                {
                    // Shield attacks have rotation motion
                    return new DbVector2(0, 0);
                }
                default:
                {
                    throw new Exception($"DetermineAttackDirection: Unknown attack type {attackType}");
                }
            }
        }

        // Find the nearest enemy to a player entity
        public static Entity? FindNearestEnemy(ReducerContext ctx, Entity playerEntity)
        {
            Entity? nearestEnemy = null;
            float nearestDistanceSquared = float.MaxValue;

            // Iterate through all monsters in the game
            foreach (var monster in ctx.Db.monsters.Iter())
            {
                // Get the monster's entity
                var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
                if (monsterEntityOpt == null)
                {
                    continue; // Skip if entity not found
                }

                var monsterEntity = monsterEntityOpt.Value;

                // Calculate squared distance (more efficient than using square root)
                var dx = monsterEntity.position.x - playerEntity.position.x;
                var dy = monsterEntity.position.y - playerEntity.position.y;
                var distanceSquared = dx * dx + dy * dy;

                // If this monster is closer than the current nearest, update nearest
                if (distanceSquared < nearestDistanceSquared)
                {
                    nearestDistanceSquared = distanceSquared;
                    nearestEnemy = monsterEntity;
                }
            }

            return nearestEnemy;
        }

        // Helper to normalize a direction vector, with default fallback
        private static DbVector2 GetNormalizedDirection(DbVector2 direction)
        {
            // If the entity has no direction (not moving), use a default direction
            if (direction.x == 0 && direction.y == 0)
            {
                // Default to right direction if no movement direction
                return new DbVector2(1, 0);
            }
            else
            {
                // Normalize the direction vector
                var length = Math.Sqrt(direction.x * direction.x + direction.y * direction.y);
                if (length > 0)
                {
                    return new DbVector2((float)(direction.x / length), (float)(direction.y / length));
                }
                else
                {
                    return new DbVector2(1, 0); // Fallback
                }
            }
        }
    }
} 