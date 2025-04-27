using SpacetimeDB;
using System;

// Attack type enum
[SpacetimeDB.Type]
public enum AttackType
{
    Sword,
    Wand,
    Knives,
    Shield
}

public static partial class Module
{
    // Attack data table - stores the base data for various attacks
    [SpacetimeDB.Table(Name = "attack_data", Public = true)]
    public partial struct AttackData
    {
        [PrimaryKey]
        public uint attack_id;
        
        public AttackType attack_type;
        public string name;
        public uint cooldown;         // Time between server-scheduled attacks
        public uint duration;         // Duration in milliseconds that attack lasts
        public uint projectiles;      // Number of projectiles in a single burst
        public uint fire_delay;       // Delay in milliseconds between shots in a burst
        public float speed;           // Movement speed of projectiles
        public bool piercing;         // Whether projectiles pierce through enemies
        public float radius;          // Radius of attack/projectile
        public uint damage;           // Base damage of the attack
        public uint armor_piercing;   // Amount of enemy armor ignored
    }

    // Attack burst cooldowns - scheduled table for delays between shots in a burst
    [SpacetimeDB.Table(Name = "attack_burst_cooldowns", 
                      Scheduled = nameof(HandleAttackBurstCooldown), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct AttackBurstCooldown
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        [SpacetimeDB.Index.BTree]
        public uint player_id;        // The player who owns this attack
        public AttackType attack_type; // The type of attack
        public uint remaining_shots;   // How many shots remain in the burst
        public uint parameter_u;      // Additional parameter for the attack
        public int parameter_i;       // Additional parameter for the attack
        public ScheduleAt scheduled_at; // When the next shot should fire
    }

    // Active attacks - tracks currently active attacks in the game
    // entity_id here refers to the projectile entity, not the player entity
    [SpacetimeDB.Table(Name = "active_attacks", Public = true)]
    public partial struct ActiveAttack
    {
        [PrimaryKey, AutoInc]
        public uint active_attack_id;
        
        public uint entity_id;        // The projectile entity ID
        [SpacetimeDB.Index.BTree]
        public uint player_id;        // The player who created this attack
        public AttackType attack_type; // The type of attack
        public uint id_within_burst;   // Position within a burst (0-based index)
        public uint parameter_u;       // Parameter used for special attacks
        public uint ticks_elapsed;    // Number of ticks since the attack was created
    }

    //Scheduled cleanup of active attacks
    [SpacetimeDB.Table(Name = "active_attack_cleanup", 
                      Scheduled = nameof(CleanupActiveAttack), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct ActiveAttackCleanup
    {
        [PrimaryKey, AutoInc]   
        public ulong scheduled_id;

        public ScheduleAt scheduled_at; // When to cleanup the active attack

        [SpacetimeDB.Index.BTree]
        public uint active_attack_id; // The active attack to cleanup
    }


    [SpacetimeDB.Table(Name = "player_scheduled_attacks", 
                      Scheduled = nameof(ServerTriggerAttack), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct PlayerScheduledAttack
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        [SpacetimeDB.Index.BTree]
        public uint player_id;        // The player who will perform this attack
        
        public AttackType attack_type; // The type of attack
        
        public uint skill_level;      // The skill level for this attack
        public uint parameter_u;      // Additional parameter for the attack
        public int parameter_i;       // Additional parameter for the attack
        public ScheduleAt scheduled_at; // When to trigger the attack
    }

    // Initialization of attack data
    [Reducer]
    public static void InitAttackData(ReducerContext ctx)
    {
        // Only run if attack data table is empty
        if (ctx.Db.attack_data.Iter().Any())
        {
            return;
        }

        Log.Info("Initializing attack data...");

        // Sword - melee attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 1,
            attack_type = AttackType.Sword,
            name = "Sword Slash",
            cooldown = 600,          
            duration = 340,          
            projectiles = 1,          
            fire_delay = 0,          
            speed = 800,              
            piercing = true,         
            radius = 48,             
            damage = 4,        
            armor_piercing = 0       
        });

        // Wand - magic projectile
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 2,
            attack_type = AttackType.Wand,
            name = "Magic Bolt",
            cooldown = 400,           
            duration = 1000,          
            projectiles = 1,          
            fire_delay = 0,          
            speed = 800,                
            piercing = false,         
            radius = 20,              
            damage = 2,              
            armor_piercing = 10       
        });

        // Knives - multiple projectiles in burst
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 3,
            attack_type = AttackType.Knives,
            name = "Throwing Knives",
            cooldown = 500,          
            duration = 800,          
            projectiles = 5,          
            fire_delay = 1,           
            speed = 1000,               
            piercing = false,         
            radius = 15,              
            damage = 1,              
            armor_piercing = 0       
        });

        // Shield - defensive area attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 4,
            attack_type = AttackType.Shield,
            name = "Shield Bash",
            cooldown = 5000,          
            duration = 4250,         
            projectiles = 2,          
            fire_delay = 0,           
            speed = 200,              
            piercing = true,         
            radius = 32,             
            damage = 4,             
            armor_piercing = 10       
        });

        Log.Info("Attack data initialized successfully.");
    }

    // Helper method to find attack data by attack type
    public static AttackData? FindAttackDataByType(ReducerContext ctx, AttackType attackType)
    {
        foreach (var attackData in ctx.Db.attack_data.Iter())
        {
            if (attackData.attack_type == attackType)
            {
                return attackData;
            }
        }
        return null;
    }

    // Helper method to trigger a single projectile of an attack
    private static void TriggerAttackProjectile(ReducerContext ctx, uint playerId, AttackType attackType, uint idWithinBurst = 0, uint parameterU = 0, int parameterI = 0)
    {
        // Get attack data
        var attackDataOpt = FindAttackDataByType(ctx, attackType);
        if (attackDataOpt == null)
        {
            Log.Error($"Attack data not found for type {attackType}");
            return;
        }

        var attackData = attackDataOpt.Value;
        
        // Get player data
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt == null)
        {
            Log.Error($"Player {playerId} not found");
            return;
        }
        
        var player = playerOpt.Value;
        
        // Get player's entity data to determine position and direction
        var entityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
        if (entityOpt == null)
        {
            Log.Error($"Entity {player.entity_id} not found for player {playerId}");
            return;
        }
        
        var entity = entityOpt.Value;
        
        // Get attack direction using AttackUtils
        var direction = AttackUtils.DetermineAttackDirection(ctx, playerId, attackType, idWithinBurst, parameterU, parameterI);
        
        // Create a new entity for the projectile and get its ID
        var projectileEntity = ctx.Db.entity.Insert(new Entity
        {
            position = entity.position,
            direction = direction,
            radius = attackData.radius
        });

        // Create active attack (represents visible/active projectile or area attack)
        var activeAttack = ctx.Db.active_attacks.Insert(new ActiveAttack
        {
            entity_id = projectileEntity.entity_id,
            player_id = playerId,           // The player who created the attack
            attack_type = attackType,
            id_within_burst = idWithinBurst,
            parameter_u = parameterU
        });

        // Schedule cleanup of the active attack
        var duration = attackData.duration;
        ctx.Db.active_attack_cleanup.Insert(new ActiveAttackCleanup
        {
            active_attack_id = activeAttack.active_attack_id,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(duration))
        });
        
        // Note: This method would be expanded with actual game logic for creating
        // projectiles, applying damage, etc. For now it just creates the active attack record.
        Log.Info($"Created attack projectile for player {playerId}, type {attackType}, id within burst: {idWithinBurst}, direction: ({direction.x}, {direction.y}), speed: {attackData.speed}");
    }

    // Handler for attack burst cooldown expiration
    [Reducer]
    public static void HandleAttackBurstCooldown(ReducerContext ctx, AttackBurstCooldown burstCooldown)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("HandleAttackBurstCooldown may not be invoked by clients, only via scheduling.");
        }

        // Calculate the id_within_burst based on attack data and remaining shots
        var attackData = FindAttackDataByType(ctx, burstCooldown.attack_type);
        if (attackData == null)
        {
            Log.Error($"Attack data not found for type {burstCooldown.attack_type}");
            return;
        }

        if (burstCooldown.remaining_shots == 0)
        {
            Log.Error($"Remaining shots is 0 for player {burstCooldown.player_id}, attack type {burstCooldown.attack_type}");
            ctx.Db.attack_burst_cooldowns.Delete(burstCooldown);
            return;
        }
        
        uint totalProjectiles = attackData.Value.projectiles;
        uint currentProjectileIndex = totalProjectiles - burstCooldown.remaining_shots;

        // Create the next projectile in the burst with the correct id_within_burst
        TriggerAttackProjectile(ctx, burstCooldown.player_id, burstCooldown.attack_type, currentProjectileIndex, burstCooldown.parameter_u, burstCooldown.parameter_i);

        // If there are more shots remaining in the burst, schedule the next one
        burstCooldown.remaining_shots -= 1;
        if (burstCooldown.remaining_shots == 0)
        {
            Log.Info($"All projectiles fired for player {burstCooldown.player_id}, attack type {burstCooldown.attack_type}");
        }
        else
        {
            // update the scheduled_at to the next shot
            // If there are more projectiles and fire_delay > 0, schedule the next
            ctx.Db.attack_burst_cooldowns.Insert(new AttackBurstCooldown
            {
                player_id = burstCooldown.player_id,
                attack_type = burstCooldown.attack_type,
                remaining_shots = burstCooldown.remaining_shots,
                parameter_u = burstCooldown.parameter_u,
                parameter_i = burstCooldown.parameter_i,
                scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(attackData.Value.fire_delay))
            });
        }
    }

    // Server authoritative attack trigger, called by scheduler
    [Reducer]
    public static void ServerTriggerAttack(ReducerContext ctx, PlayerScheduledAttack attack)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("ServerTriggerAttack may not be invoked by clients, only via scheduling.");
        }
        
        // Get player ID directly from the attack
        var playerId = attack.player_id;
        
        // Check if this attack type exists
        var attackData = FindAttackDataByType(ctx, attack.attack_type);
        if (attackData == null)
        {
            Log.Error($"Attack type {attack.attack_type} not found when triggering attack");
            return;
        }

        //Update the parameters for the attack
        var parameterU = AttackUtils.GetParameterU(ctx, attack);
        attack.parameter_u = parameterU;

        ctx.Db.player_scheduled_attacks.scheduled_id.Update(attack);
        
        // Handle case where we have multiple projectiles
        if (attackData.Value.projectiles > 1)
        {
            if (attackData.Value.fire_delay == 0)
            {
                // If fire_delay is 0, spawn all projectiles at once
                for (uint i = 0; i < attackData.Value.projectiles; i++)
                {
                    TriggerAttackProjectile(ctx, playerId, attack.attack_type, i, attack.parameter_u, attack.parameter_i);
                }
            }
            else
            {
                // Fire first projectile with id_within_burst = 0
                TriggerAttackProjectile(ctx, playerId, attack.attack_type, 0, attack.parameter_u, attack.parameter_i);
                 
                Log.Info($"Scheduled {attackData.Value.projectiles - 1} projectiles for player {playerId}, attack type {attack.attack_type}, fire delay: {attackData.Value.fire_delay}");

                // If there are more projectiles and fire_delay > 0, schedule the rest
                ctx.Db.attack_burst_cooldowns.Insert(new AttackBurstCooldown
                {
                    player_id = playerId,
                    attack_type = attack.attack_type,
                    remaining_shots = attackData.Value.projectiles - 1,
                    parameter_u = attack.parameter_u,
                    parameter_i = attack.parameter_i,
                    scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(attackData.Value.fire_delay))
                });
            }
        }
        else
        {
            // Single projectile case - just trigger it with id_within_burst = 0
            TriggerAttackProjectile(ctx, playerId, attack.attack_type, 0, attack.parameter_u, attack.parameter_i);
        }
        
        Log.Info($"Server triggered attack {attack.attack_type} for player {playerId} with skill level {attack.skill_level}");
    }

    // Helper method to schedule attacks for a player
    // Call this when player spawns or acquires a new attack type
    public static void ScheduleNewPlayerAttack(ReducerContext ctx, uint playerId, AttackType attackType, uint skillLevel = 1)
    {
        var attackData = FindAttackDataByType(ctx, attackType);
        if (attackData == null)
        {
            Log.Error($"Attack type {attackType} not found when scheduling initial attacks");
            return;
        }

        // Schedule the first attack
        ctx.Db.player_scheduled_attacks.Insert(new PlayerScheduledAttack
        {
            player_id = playerId,
            attack_type = attackType,
            skill_level = skillLevel,
            parameter_u = 0,
            parameter_i = 0,
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(attackData.Value.cooldown))
        });
        
        Log.Info($"Scheduled initial attack of type {attackType} for player {playerId}");
    }

    // Cleanup active attacks
    [Reducer]
    public static void CleanupActiveAttack(ReducerContext ctx, ActiveAttackCleanup cleanup)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("CleanupActiveAttack may not be invoked by clients, only via scheduling.");
        }

        // Get the active attack to cleanup
        var activeAttackOpt = ctx.Db.active_attacks.active_attack_id.Find(cleanup.active_attack_id);
        if (activeAttackOpt == null)
        {
            //This isn't an error, it just means the attack has already been cleaned up
            return;
        }

        var activeAttack = activeAttackOpt.Value;

        // Get the entity to cleanup
        var entityOpt = ctx.Db.entity.entity_id.Find(activeAttack.entity_id);
        if (entityOpt == null)
        {
            //This isn't an error, it just means the entity has already been cleaned up
            return;
        }

        var entity = entityOpt.Value;

        // Clean up any damage records associated with this attack
        CleanupAttackDamageRecords(ctx, entity.entity_id);
        
        // Delete the entity
        ctx.Db.entity.entity_id.Delete(entity.entity_id);

        // Delete the active attack
        ctx.Db.active_attacks.active_attack_id.Delete(cleanup.active_attack_id);
    }   

    // Call this from the existing Init method
    public static void InitializeAttackSystem(ReducerContext ctx)
    {
        InitAttackData(ctx);
    }
    
    // Helper method to process attack movements - moved from CoreGame.cs
    public static void ProcessAttackMovements(ReducerContext ctx, uint worldSize)
    {
        // Process each active attack
        foreach (var rawActiveAttack in ctx.Db.active_attacks.Iter())
        {
            var activeAttackOpt = ctx.Db.active_attacks.active_attack_id.Find(rawActiveAttack.active_attack_id);
            if (activeAttackOpt == null)
            {
                continue; // Skip if active attack not found
            }

            var activeAttack = activeAttackOpt.Value;

            activeAttack.ticks_elapsed += 1; 
            ctx.Db.active_attacks.active_attack_id.Update(activeAttack);

            // Get the attack entity
            var entityOpt = ctx.Db.entity.entity_id.Find(activeAttack.entity_id);
            if (entityOpt is null)
            {
                continue; // Skip if entity not found
            }
            
            var entity = entityOpt.Value;
            
            // Get attack data
            var attackDataOpt = FindAttackDataByType(ctx, activeAttack.attack_type);
            if (attackDataOpt is null)
            {
                continue; // Skip if attack data not found
            }
            
            var attackData = attackDataOpt.Value;
            
            // Handle special case for Shield attack type
            if (activeAttack.attack_type == AttackType.Shield)
            {
                // Shield orbits around the player - update its position based on time
                var playerOpt = ctx.Db.player.player_id.Find(activeAttack.player_id);
                if (playerOpt is null)
                {
                    continue; // Skip if player not found
                }
                
                var player = playerOpt.Value;
                var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
                if (playerEntityOpt is null)
                {
                    continue; // Skip if player entity not found
                }
                
                var playerEntity = playerEntityOpt.Value;
                
                // Get all shields for this player to determine total count and positioning
                int totalShields = 0;
                foreach (var attack in ctx.Db.active_attacks.player_id.Filter(activeAttack.player_id))
                {
                    if (attack.attack_type == AttackType.Shield)
                    {
                        totalShields++;
                    }
                }
                
                if (totalShields == 0)
                {
                    continue; // Something's wrong, skip this iteration
                }
                
                // Calculate orbit angle based on shield's offset value and current position in burst
                double rotationSpeed = attackData.speed * Math.PI / 180.0 * DELTA_TIME;
                //convert parameter_u from degrees to radians
                double parameterAngle = activeAttack.parameter_u * Math.PI / 180.0;
                double baseAngle = parameterAngle + (2 * Math.PI * activeAttack.id_within_burst / totalShields);
                double shieldAngle = baseAngle + rotationSpeed * activeAttack.ticks_elapsed;
                
                // Calculate offset distance from player center
                float offsetDistance = playerEntity.radius + entity.radius * 2; // Added some spacing
                
                // Calculate new position using angle
                float offsetX = (float)Math.Cos(shieldAngle) * offsetDistance;
                float offsetY = (float)Math.Sin(shieldAngle) * offsetDistance;
                
                // Update shield entity with new position
                var updatedEntity = entity;
                updatedEntity.position = new DbVector2(
                    playerEntity.position.x + offsetX,
                    playerEntity.position.y + offsetY
                );
                
                // Apply world boundary clamping
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
                
                ctx.Db.entity.entity_id.Update(updatedEntity);
            }
            else
            {
                // Regular projectile movement based on direction and speed
                float moveSpeed = attackData.speed;
                
                // Calculate movement based on direction, speed and time delta
                float moveDistance = moveSpeed * DELTA_TIME;
                var moveOffset = entity.direction * moveDistance;
                
                // Update entity with new position
                var updatedEntity = entity;
                updatedEntity.position = entity.position + moveOffset;
                
                // Apply world boundary clamping
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
                
                // Check if entity hit the world boundary, if so mark for deletion
                bool hitBoundary = 
                    updatedEntity.position.x <= updatedEntity.radius ||
                    updatedEntity.position.x >= worldSize - updatedEntity.radius ||
                    updatedEntity.position.y <= updatedEntity.radius ||
                    updatedEntity.position.y >= worldSize - updatedEntity.radius;
                
                if (hitBoundary)
                {
                    // Delete attack entity and active attack record
                    ctx.Db.entity.entity_id.Delete(entity.entity_id);
                    ctx.Db.active_attacks.active_attack_id.Delete(activeAttack.active_attack_id);
                    
                    // Clean up any damage records associated with this attack
                    CleanupAttackDamageRecords(ctx, entity.entity_id);
                }
                else
                {
                    // Update entity position
                    ctx.Db.entity.entity_id.Update(updatedEntity);
                }
            }
        }
    }
} 