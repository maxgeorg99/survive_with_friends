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
                    return (uint)angle;
                }
                case AttackType.Shield:
                {
                    var random = ctx.Rng;
                    var angle = random.NextDouble() * 360.0;
                    return (uint)angle;
                }
                case AttackType.ThrowingShield:
                {
                    // For throwing shield, parameter_u stores the bounce count
                    return 0; // Start with 0 bounces
                }
                case AttackType.EnergyOrb:
                {
                    var random = ctx.Rng;
                    var angle = random.NextDouble() * 360.0;
                    return (uint)angle; // Similar to Shield's implementation
                }
                case AttackType.MagicDagger:
                {
                    // For magic dagger, parameter_u determines if it's returning (0=going out, 1=returning)
                    return 0; // Start in outgoing state
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
                    // Sword attacks now target the nearest enemy like wands for better kiting
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
                    
                    // If no enemies or calculation issue, fall back to alternating left/right pattern
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
                case AttackType.Football:
                {
                    // Football attacks now target the nearest enemy like wands
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
                case AttackType.Cards:
                {
                    // Find the nearest enemy for card targeting
                    Entity? nearestEnemy = FindNearestEnemy(ctx, entity);
                    if (nearestEnemy != null)
                    {
                        var enemyActual = nearestEnemy.Value;
                        
                        // Calculate base direction vector to the enemy
                        var dx = enemyActual.position.x - entity.position.x;
                        var dy = enemyActual.position.y - entity.position.y;
                        
                        // Normalize the direction
                        var length = Math.Sqrt(dx * dx + dy * dy);
                        if (length > 0)
                        {
                            // Normalize base direction
                            var baseDirX = dx / length;
                            var baseDirY = dy / length;
                            
                            // For multiple cards, spread them in a fan pattern toward the enemy
                            // The spread angle depends on the number of projectiles
                            double fanAngleRange = 45.0; // degrees total spread
                            
                            // Calculate the angle for this specific card within the fan
                            double fanAngle;
                            if (attackData.Value.projectiles > 1)
                            {
                                // Calculate angle offset for this projectile in the fan
                                fanAngle = -fanAngleRange / 2.0 + (fanAngleRange * idWithinBurst / (attackData.Value.projectiles - 1));
                            }
                            else
                            {
                                fanAngle = 0;
                            }
                            
                            // Convert angle to radians
                            var fanAngleRad = fanAngle * Math.PI / 180.0;
                            
                            // Rotate the base vector by the fan angle
                            var rotatedX = baseDirX * Math.Cos(fanAngleRad) - baseDirY * Math.Sin(fanAngleRad);
                            var rotatedY = baseDirX * Math.Sin(fanAngleRad) + baseDirY * Math.Cos(fanAngleRad);
                            
                            return new DbVector2((float)rotatedX, (float)rotatedY);
                        }
                    }
                    
                    // If no enemies found, fall back to the original pattern
                    var startAngle = (double)parameterU * Math.PI / 180.0;                       
                    var angleStep = 360.0 / (double)attackData.Value.projectiles;
                    var attackAngle = startAngle + (angleStep * (double)idWithinBurst);
                    return new DbVector2((float)Math.Cos(attackAngle), (float)Math.Sin(attackAngle));
                }
                case AttackType.Dumbbell:
                {
                    // Dumbbells start with a strong upward motion
                    var random = ctx.Rng;
                    var yOffset = -4.0f; // Stronger upward initial velocity
                    var xOffset = (random.NextDouble() - 0.5) * 1.0f; // Reduced horizontal spread
                    return new DbVector2((float)xOffset, yOffset).Normalize(); // Normalized direction vector with strong upward motion
                }
                case AttackType.Garlic:
                {
                    // Garlic stays with player, no movement needed
                    return new DbVector2(0, 0);
                }
                case AttackType.Shuriken:
                {
                    // Shurikens throw in a spread pattern toward the nearest enemy with a spinning trajectory
                    Entity? nearestEnemy = FindNearestEnemy(ctx, entity);
                    if (nearestEnemy != null)
                    {
                        var enemyActual = nearestEnemy.Value;
                        
                        // Calculate base direction vector to the enemy
                        var dx = enemyActual.position.x - entity.position.x;
                        var dy = enemyActual.position.y - entity.position.y;
                        
                        // Normalize the direction
                        var length = Math.Sqrt(dx * dx + dy * dy);
                        if (length > 0)
                        {
                            // Normalize base direction
                            var baseDirX = dx / length;
                            var baseDirY = dy / length;
                            
                            // For multiple shurikens, spread them in a narrow fan pattern
                            double fanAngleRange = 30.0; // degrees total spread (narrower than cards)
                            
                            // Calculate the angle for this specific shuriken within the fan
                            double fanAngle;
                            if (attackData.Value.projectiles > 1)
                            {
                                // Calculate angle offset for this projectile in the fan
                                fanAngle = -fanAngleRange / 2.0 + (fanAngleRange * idWithinBurst / (attackData.Value.projectiles - 1));
                            }
                            else
                            {
                                fanAngle = 0;
                            }
                            
                            // Convert angle to radians
                            var fanAngleRad = fanAngle * Math.PI / 180.0;
                            
                            // Rotate the base vector by the fan angle
                            var rotatedX = baseDirX * Math.Cos(fanAngleRad) - baseDirY * Math.Sin(fanAngleRad);
                            var rotatedY = baseDirX * Math.Sin(fanAngleRad) + baseDirY * Math.Cos(fanAngleRad);
                            
                            return new DbVector2((float)rotatedX, (float)rotatedY);
                        }
                    }
                    
                    // If no enemies found, fall back to player direction
                    return GetNormalizedDirection(entity.direction);
                }
                case AttackType.FireSword:
                {
                    // Fire sword attacks in the direction the player is facing with a fiery trail
                    return GetNormalizedDirection(entity.direction);
                }
                case AttackType.HolyHammer:
                {
                    // Holy hammer targets the nearest enemy with a strong directional attack
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
                case AttackType.MagicDagger:
                {
                    // For outgoing daggers, aim at nearest enemy
                    if (parameterU == 0) // Outgoing state
                    {
                        Entity? nearestEnemy = FindNearestEnemy(ctx, entity);
                        if (nearestEnemy != null)
                        {
                            var enemyActual = nearestEnemy.Value;
                            
                            // Calculate base direction vector to the enemy
                            var dx = enemyActual.position.x - entity.position.x;
                            var dy = enemyActual.position.y - entity.position.y;
                            
                            // Normalize the direction
                            var length = Math.Sqrt(dx * dx + dy * dy);
                            if (length > 0)
                            {
                                // Normalize base direction
                                var baseDirX = dx / length;
                                var baseDirY = dy / length;
                                
                                // For multiple daggers, spread them slightly
                                double fanAngleRange = 20.0; // degrees total spread
                                
                                // Calculate the angle for this specific dagger within the fan
                                double fanAngle;
                                if (attackData.Value.projectiles > 1)
                                {
                                    // Calculate angle offset for this projectile in the fan
                                    fanAngle = -fanAngleRange / 2.0 + (fanAngleRange * idWithinBurst / (attackData.Value.projectiles - 1));
                                }
                                else
                                {
                                    fanAngle = 0;
                                }
                                
                                // Convert angle to radians
                                var fanAngleRad = fanAngle * Math.PI / 180.0;
                                
                                // Rotate the base vector by the fan angle
                                var rotatedX = baseDirX * Math.Cos(fanAngleRad) - baseDirY * Math.Sin(fanAngleRad);
                                var rotatedY = baseDirX * Math.Sin(fanAngleRad) + baseDirY * Math.Cos(fanAngleRad);
                                
                                return new DbVector2((float)rotatedX, (float)rotatedY);
                            }
                        }
                        
                        // If no enemies found, fall back to player direction
                        return GetNormalizedDirection(entity.direction);
                    }
                    else // Returning state (parameterU == 1)
                    {
                        // Calculate direction back to the player
                        var dx = entity.position.x - parameterI;  // parameterI stores the entity_id of the player
                        var dy = entity.position.y - parameterI;  // This will be updated in the attack handler
                        
                        // Normalize the direction
                        var length = Math.Sqrt(dx * dx + dy * dy);
                        if (length > 0)
                        {
                            return new DbVector2((float)(-dx / length), (float)(-dy / length));
                        }
                        
                        // Fallback
                        return new DbVector2(-1, 0);
                    }
                }
                case AttackType.ThrowingShield:
                {
                    // Throwing shield initially targets nearest enemy, then bounces to others
                    Entity? targetEnemy = FindNearestEnemy(ctx, entity);
                    if (targetEnemy != null)
                    {
                        var enemyActual = targetEnemy.Value;
                        
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
                case AttackType.EnergyOrb:
                {
                    // Energy orbs orbit the player like shields but with varied positions
                    // This will be handled similar to Shield attack but with specific logic in ProcessAttackMovements
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