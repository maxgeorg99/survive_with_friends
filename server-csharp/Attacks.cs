using SpacetimeDB;
using System;

// Attack type enum
[SpacetimeDB.Type]
public enum AttackType
{
    Sword,
    Wand,
    Knives,
    Shield,
    Football,
    Cards,
    Dumbbell,
    Garlic,
    BossBolt,
    BossJorgeBolt,
    BossBjornBolt
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
        public uint damage;           // Damage of this specific attack instance
        public float radius;          // Radius of this attack (for area effects)
        public bool piercing;         // Whether this attack pierces through enemies
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
        
        // Combat stats copied from AttackData but can be modified by upgrades
        public uint duration;         // Duration in milliseconds that attack lasts
        public uint projectiles;      // Number of projectiles in a single burst
        public uint fire_delay;       // Delay in milliseconds between shots in a burst
        public float speed;           // Movement speed of projectiles
        public bool piercing;         // Whether projectiles pierce through enemies
        public float radius;          // Radius of attack/projectile
        public uint damage;           // Base damage of the attack
        public uint armor_piercing;   // Amount of enemy armor ignored
        
        public ScheduleAt scheduled_at; // When to trigger the attack
    }

    // Active boss attacks - tracks currently active boss attacks in the game
    [SpacetimeDB.Table(Name = "active_boss_attacks", Public = true)]
    public partial struct ActiveBossAttack
    {
        [PrimaryKey, AutoInc]
        public uint active_boss_attack_id;
        
        public uint entity_id;        // The projectile entity ID
        [SpacetimeDB.Index.BTree]
        public uint boss_monster_id;  // The boss monster that created this attack
        public AttackType attack_type; // The type of attack
        public uint id_within_burst;   // Position within a burst (0-based index)
        public uint parameter_u;       // Parameter used for special attacks
        public uint ticks_elapsed;    // Number of ticks since the attack was created
        public uint damage;           // Damage of this specific attack instance
        public float radius;          // Radius of this attack (for area effects)
        public bool piercing;         // Whether this attack pierces through enemies
    }

    //Scheduled cleanup of active boss attacks
    [SpacetimeDB.Table(Name = "active_boss_attack_cleanup", 
                      Scheduled = nameof(CleanupActiveBossAttack), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct ActiveBossAttackCleanup
    {
        [PrimaryKey, AutoInc]   
        public ulong scheduled_id;

        public ScheduleAt scheduled_at; // When to cleanup the active boss attack

        [SpacetimeDB.Index.BTree]
        public uint active_boss_attack_id; // The active boss attack to cleanup
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

        // Football - bouncing projectile with knockback
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 11,
            attack_type = AttackType.Football,
            name = "Football Shot",
            cooldown = 800,          // Slower attack speed
            duration = 2500,         // Stays longer
            projectiles = 1,         // Burst of 3 footballs
            fire_delay = 200,        // Small delay between shots
            speed = 600,             // Medium speed
            piercing = true,         // Goes through enemies
            radius = 24,             // Medium size
            damage = 4,              // Moderate damage
            armor_piercing = 2       
        });

        // Cards - spread attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 12,
            attack_type = AttackType.Cards,
            name = "Card Throw",
            cooldown = 600,          
            duration = 800,          
            projectiles = 3,         // Multiple cards
            fire_delay = 50,         
            speed = 700,             
            piercing = false,        
            radius = 16,             
            damage = 3,              
            armor_piercing = 2       
        });

        // Dumbbell - falling aerial attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 13,
            attack_type = AttackType.Dumbbell,
            name = "Dumbbell Drop",
            cooldown = 1200,         // Slow attack speed
            duration = 800,          // Quick impact
            projectiles = 1,         
            fire_delay = 200,        // Delay between drops
            speed = 800,             // Fast falling speed
            piercing = true,         // Goes through enemies
            radius = 40,             // Large impact radius
            damage = 8,              // High damage
            armor_piercing = 4       
        });

        // Garlic - aura attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 14,
            attack_type = AttackType.Garlic,
            name = "Garlic Aura",
            cooldown = 800,          // Frequent ticks
            duration = 800,          // Duration of each pulse
            projectiles = 1,         // Single aura
            fire_delay = 0,          // Continuous
            speed = 0,               // Stationary
            piercing = true,         // Hits all enemies in range
            radius = 100,            // Large aura radius
            damage = 2,              // Low damage but constant
            armor_piercing = 1       
        });

        // Sword - melee attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 1,
            attack_type = AttackType.Sword,
            name = "Sword Slash",
            cooldown = 600,          
            duration = 340,          
            projectiles = 1,          
            fire_delay = 50,          
            speed = 800,              
            piercing = true,         
            radius = 32,             
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
            fire_delay = 20,          
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
        // Boss Jorge Bolt - unique projectile for Jorge
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 6,
            attack_type = AttackType.BossJorgeBolt,
            name = "Jorge Bolt",
            cooldown = 1200,           // Faster fire rate
            duration = 2000,           // Flies longer
            projectiles = 1,
            fire_delay = 0,
            speed = 950,               // Slightly faster
            piercing = false,
            radius = 10,               // Smaller
            damage = 7,                // Slightly more damage
            armor_piercing = 5
        });

        // Boss Björn Bolt - unique homing projectile for Björn
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 7,
            attack_type = AttackType.BossBjornBolt,
            name = "Björn Homing Bolt",
            cooldown = 1800,           // Medium fire rate
            duration = 2500,           // Flies longer
            projectiles = 1,
            fire_delay = 0,
            speed = 800,               // Homing, so a bit slower
            piercing = false,
            radius = 12,               // Medium size
            damage = 8,                // More damage
            armor_piercing = 5
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
        
        // Get player's scheduled attack to use actual stats (which may have been upgraded)
        PlayerScheduledAttack? scheduledAttack = null;
        foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
        {
            if (attack.attack_type == attackType)
            {
                scheduledAttack = attack;
                break;
            }
        }
        
        if (scheduledAttack == null)
        {
            Log.Error($"Scheduled attack not found for player {playerId}, attack type {attackType}");
            return;
        }
        
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
            radius = scheduledAttack.Value.radius
        });

        // Create active attack (represents visible/active projectile or area attack)
        var activeAttack = ctx.Db.active_attacks.Insert(new ActiveAttack
        {
            entity_id = projectileEntity.entity_id,
            player_id = playerId,           // The player who created the attack
            attack_type = attackType,
            id_within_burst = idWithinBurst,
            parameter_u = parameterU,
            damage = scheduledAttack.Value.damage,
            radius = scheduledAttack.Value.radius,
            piercing = scheduledAttack.Value.piercing
        });

        // Schedule cleanup of the active attack
        var duration = scheduledAttack.Value.duration;
        ctx.Db.active_attack_cleanup.Insert(new ActiveAttackCleanup
        {
            active_attack_id = activeAttack.active_attack_id,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(duration))
        });
    }

    // Handler for attack burst cooldown expiration
    [Reducer]
    public static void HandleAttackBurstCooldown(ReducerContext ctx, AttackBurstCooldown burstCooldown)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("HandleAttackBurstCooldown may not be invoked by clients, only via scheduling.");
        }

        // Find the player's scheduled attack for this attack type
        PlayerScheduledAttack? scheduledAttack = null;
        foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(burstCooldown.player_id))
        {
            if (attack.attack_type == burstCooldown.attack_type)
            {
                scheduledAttack = attack;
                break;
            }
        }
        
        if (scheduledAttack == null)
        {
            Log.Error($"Scheduled attack not found for player {burstCooldown.player_id}, attack type {burstCooldown.attack_type}");
            ctx.Db.attack_burst_cooldowns.Delete(burstCooldown);
            return;
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
        
        uint totalProjectiles = scheduledAttack.Value.projectiles;
        uint currentProjectileIndex = totalProjectiles - burstCooldown.remaining_shots;

        // Create the next projectile in the burst with the correct id_within_burst
        TriggerAttackProjectile(ctx, burstCooldown.player_id, burstCooldown.attack_type, currentProjectileIndex, burstCooldown.parameter_u, burstCooldown.parameter_i);

        // If there are more shots remaining in the burst, schedule the next one
        burstCooldown.remaining_shots -= 1;
        if (burstCooldown.remaining_shots > 0)
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
                scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(scheduledAttack.Value.fire_delay))
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

        // Update the parameters for the attack
        var parameterU = AttackUtils.GetParameterU(ctx, attack);
        attack.parameter_u = parameterU;

        // Update the scheduled attack in the database
        ctx.Db.player_scheduled_attacks.scheduled_id.Update(attack);
        
        // Handle case where we have multiple projectiles
        if (attack.projectiles > 1)
        {
            if (attack.fire_delay == 0)
            {
                // If fire_delay is 0, spawn all projectiles at once
                for (uint i = 0; i < attack.projectiles; i++)
                {
                    TriggerAttackProjectile(ctx, playerId, attack.attack_type, i, attack.parameter_u, attack.parameter_i);
                }
            }
            else
            {
                // Fire first projectile with id_within_burst = 0
                TriggerAttackProjectile(ctx, playerId, attack.attack_type, 0, attack.parameter_u, attack.parameter_i);

                // If there are more projectiles and fire_delay > 0, schedule the rest
                ctx.Db.attack_burst_cooldowns.Insert(new AttackBurstCooldown
                {
                    player_id = playerId,
                    attack_type = attack.attack_type,
                    remaining_shots = attack.projectiles - 1,
                    parameter_u = attack.parameter_u,
                    parameter_i = attack.parameter_i,
                    scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(attack.fire_delay))
                });
            }
        }
        else
        {
            // Single projectile case - just trigger it with id_within_burst = 0
            TriggerAttackProjectile(ctx, playerId, attack.attack_type, 0, attack.parameter_u, attack.parameter_i);
        }
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

        // Schedule the first attack with all properties copied from base attack data
        ctx.Db.player_scheduled_attacks.Insert(new PlayerScheduledAttack
        {
            player_id = playerId,
            attack_type = attackType,
            skill_level = skillLevel,
            parameter_u = 0,
            parameter_i = 0,
            duration = attackData.Value.duration,
            projectiles = attackData.Value.projectiles,
            fire_delay = attackData.Value.fire_delay,
            speed = attackData.Value.speed,
            piercing = attackData.Value.piercing,
            radius = attackData.Value.radius,
            damage = attackData.Value.damage,
            armor_piercing = attackData.Value.armor_piercing,
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(attackData.Value.cooldown))
        });
        
        Log.Info($"Scheduled initial attack of type {attackType} for player {playerId} with damage {attackData.Value.damage}");
    }

    // Cleanup active attacks
    [Reducer]
    public static void CleanupActiveAttack(ReducerContext ctx, ActiveAttackCleanup cleanup)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("CleanupActiveAttack may not be invoked by clients, only via scheduling.");
        }

        try
        {
            // Get the active attack to cleanup
            var activeAttackOpt = ctx.Db.active_attacks.active_attack_id.Find(cleanup.active_attack_id);
            if (activeAttackOpt == null)
            {
                // Attack already cleaned up, just delete the cleanup record
                ctx.Db.active_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
                return;
            }

            var activeAttack = activeAttackOpt.Value;

            // Get the entity to cleanup
            var entityOpt = ctx.Db.entity.entity_id.Find(activeAttack.entity_id);
            if (entityOpt == null)
            {
                // Entity already cleaned up, just clean up the attack record
                ctx.Db.active_attacks.active_attack_id.Delete(cleanup.active_attack_id);
                ctx.Db.active_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
                return;
            }

            // Clean up any damage records associated with this attack
            CleanupAttackDamageRecords(ctx, entityOpt.Value.entity_id);
            
            // Delete the entity
            ctx.Db.entity.entity_id.Delete(entityOpt.Value.entity_id);

            // Delete the active attack
            ctx.Db.active_attacks.active_attack_id.Delete(cleanup.active_attack_id);
            
            // Finally delete the cleanup record
            ctx.Db.active_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
        }
        catch (Exception ex)
        {
            Log.Error($"Error in CleanupActiveAttack: {ex.Message}");
            // Try to clean up the cleanup record even if other cleanup fails
            try
            {
                ctx.Db.active_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
            }
            catch
            {
                // If this fails too, just log it
                Log.Error("Failed to delete cleanup record after error");
            }
        }
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
                float offsetDistance = (playerEntity.radius + entity.radius) * 2; // Added some spacing
                
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
            else if (activeAttack.attack_type == AttackType.Garlic)
            {
                // Garlic aura stays with player
                var playerOpt = ctx.Db.player.player_id.Find(activeAttack.player_id);
                if (playerOpt is null)
                {
                    continue;
                }
                
                var player = playerOpt.Value;
                var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
                if (playerEntityOpt is null)
                {
                    continue;
                }
                
                var playerEntity = playerEntityOpt.Value;
                
                // Update garlic aura position to player position
                var updatedEntity = entity;
                updatedEntity.position = playerEntity.position;
                ctx.Db.entity.entity_id.Update(updatedEntity);

                // Apply knockback to nearby monsters
                foreach (var monster in ctx.Db.monsters.Iter())
                {
                    var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
                    if (monsterEntityOpt is null) continue;
                    
                    var monsterEntity = monsterEntityOpt.Value;
                    
                    // Calculate distance to monster
                    var dx = monsterEntity.position.x - playerEntity.position.x;
                    var dy = monsterEntity.position.y - playerEntity.position.y;
                    var distanceSquared = dx * dx + dy * dy;
                    var radiusSum = entity.radius + monsterEntity.radius;
                    
                    // If monster is within garlic radius
                    if (distanceSquared <= radiusSum * radiusSum)
                    {
                        // Calculate normalized direction for knockback
                        var distance = Math.Sqrt(distanceSquared);
                        if (distance > 0)
                        {
                            var knockbackDirection = new DbVector2(
                                (float)(dx / distance),
                                (float)(dy / distance)
                            );
                            
                            // Apply knockback
                            var knockbackStrength = 5f;
                            var knockbackPos = monsterEntity.position + (knockbackDirection * knockbackStrength);
                            
                            // Update monster position with knockback
                            var updatedMonster = monsterEntity;
                            updatedMonster.position = knockbackPos;
                            ctx.Db.entity.entity_id.Update(updatedMonster);
                        }
                    }
                }
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
                
                // For Football attacks, apply knockback to hit monsters
                if (activeAttack.attack_type == AttackType.Football)
                {
                    foreach (var monster in ctx.Db.monsters.Iter())
                    {
                        var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
                        if (monsterEntityOpt is null) continue;
                        
                        var monsterEntity = monsterEntityOpt.Value;
                        
                        // Calculate distance to monster
                        var dx = monsterEntity.position.x - updatedEntity.position.x;
                        var dy = monsterEntity.position.y - updatedEntity.position.y;
                        var distanceSquared = dx * dx + dy * dy;
                        var radiusSum = updatedEntity.radius + monsterEntity.radius;
                        
                        // If monster is hit by football
                        if (distanceSquared <= radiusSum * radiusSum)
                        {
                            // Apply strong knockback in the football's direction
                            var knockbackStrength = 10f;
                            var knockbackPos = monsterEntity.position + (entity.direction * knockbackStrength);
                            
                            // Update monster position with knockback
                            var updatedMonster = monsterEntity;
                            updatedMonster.position = knockbackPos;
                            ctx.Db.entity.entity_id.Update(updatedMonster);
                        }
                    }
                }
                
                // Check if entity hit the world boundary
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

    // Cleanup active boss attacks
    [Reducer]
    public static void CleanupActiveBossAttack(ReducerContext ctx, ActiveBossAttackCleanup cleanup)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("CleanupActiveBossAttack may not be invoked by clients, only via scheduling.");
        }

        try
        {
            // Get the active boss attack to cleanup
            var activeBossAttackOpt = ctx.Db.active_boss_attacks.active_boss_attack_id.Find(cleanup.active_boss_attack_id);
            if (activeBossAttackOpt == null)
            {
                // Attack already cleaned up, just delete the cleanup record
                ctx.Db.active_boss_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
                return;
            }

            var activeBossAttack = activeBossAttackOpt.Value;

            // Get the entity to cleanup
            var entityOpt = ctx.Db.entity.entity_id.Find(activeBossAttack.entity_id);
            if (entityOpt == null)
            {
                // Entity already cleaned up, just clean up the attack record
                ctx.Db.active_boss_attacks.active_boss_attack_id.Delete(cleanup.active_boss_attack_id);
                ctx.Db.active_boss_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
                return;
            }

            // Clean up any damage records associated with this attack
            CleanupAttackDamageRecords(ctx, entityOpt.Value.entity_id);
            
            // Delete the entity
            ctx.Db.entity.entity_id.Delete(entityOpt.Value.entity_id);

            // Delete the active boss attack
            ctx.Db.active_boss_attacks.active_boss_attack_id.Delete(cleanup.active_boss_attack_id);
            
            // Finally delete the cleanup record
            ctx.Db.active_boss_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
        }
        catch (Exception ex)
        {
            Log.Error($"Error in CleanupActiveBossAttack: {ex.Message}");
            // Try to clean up the cleanup record even if other cleanup fails
            try
            {
                ctx.Db.active_boss_attack_cleanup.scheduled_id.Delete(cleanup.scheduled_id);
            }
            catch
            {
                // If this fails too, just log it
                Log.Error("Failed to delete cleanup record after error");
            }
        }
    }

    // Helper method to process boss attack movements
    public static void ProcessBossAttackMovements(ReducerContext ctx, uint worldSize)
    {
        // Process each active boss attack
        foreach (var rawActiveBossAttack in ctx.Db.active_boss_attacks.Iter())
        {
            var activeBossAttackOpt = ctx.Db.active_boss_attacks.active_boss_attack_id.Find(rawActiveBossAttack.active_boss_attack_id);
            if (activeBossAttackOpt == null)
            {
                continue; // Skip if active boss attack not found
            }

            var activeBossAttack = activeBossAttackOpt.Value;
            var entityOpt = ctx.Db.entity.entity_id.Find(activeBossAttack.entity_id);
            if (entityOpt is null)
            {
                continue; // Skip if entity not found
            }
            
            var entity = entityOpt.Value;
            
            // Get attack data
            var attackDataOpt = FindAttackDataByType(ctx, activeBossAttack.attack_type);
            if (attackDataOpt is null)
            {
                continue; // Skip if attack data not found
            }
            
            var attackData = attackDataOpt.Value;

            // Regular projectile movement based on direction and speed
            float moveSpeed = attackData.speed;

            // For homing projectiles (Björn's attacks with parameter_u == 1), find nearest player and update direction
            if (activeBossAttack.attack_type == AttackType.BossBjornBolt && activeBossAttack.parameter_u == 1)
            {
                // Find nearest player
                float nearestDistSq = float.MaxValue;
                DbVector2? nearestPlayerPos = null;

                foreach (var player in ctx.Db.player.Iter())
                {
                    var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
                    if (playerEntityOpt != null)
                    {
                        var playerEntity = playerEntityOpt.Value;
                        float dx = playerEntity.position.x - entity.position.x;
                        float dy = playerEntity.position.y - entity.position.y;
                        float distSq = dx * dx + dy * dy;
                        
                        if (distSq < nearestDistSq)
                        {
                            nearestDistSq = distSq;
                            nearestPlayerPos = playerEntity.position;
                        }
                    }
                }

                // Update direction if we found a player
                if (nearestPlayerPos.HasValue)
                {
                    float dx = nearestPlayerPos.Value.x - entity.position.x;
                    float dy = nearestPlayerPos.Value.y - entity.position.y;
                    float dist = (float)Math.Sqrt(dx * dx + dy * dy);
                    
                    if (dist > 0)
                    {
                        // Smoothly interpolate towards player
                        var targetDir = new DbVector2(dx / dist, dy / dist);
                        entity.direction = new DbVector2(
                            entity.direction.x * 0.9f + targetDir.x * 0.1f,
                            entity.direction.y * 0.9f + targetDir.y * 0.1f
                        );
                        
                        // Normalize direction after interpolation
                        float newLen = (float)Math.Sqrt(entity.direction.x * entity.direction.x + entity.direction.y * entity.direction.y);
                        if (newLen > 0)
                        {
                            entity.direction = new DbVector2(entity.direction.x / newLen, entity.direction.y / newLen);
                        }
                    }
                }
            }
            
            // Calculate movement based on direction and speed
            float moveDistance = moveSpeed * DELTA_TIME;
            var moveOffset = entity.direction * moveDistance;

            Log.Info($"Boss attack {activeBossAttack.active_boss_attack_id} movement:");
            Log.Info($"  Current pos: ({entity.position.x}, {entity.position.y})");
            Log.Info($"  Direction: ({entity.direction.x}, {entity.direction.y})");
            Log.Info($"  Move offset: ({moveOffset.x}, {moveOffset.y})");
            
            // Update entity with new position
            var updatedEntity = entity;
            updatedEntity.position = entity.position + moveOffset;
            
            Log.Info($"  New pos: ({updatedEntity.position.x}, {updatedEntity.position.y})");

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
            
            // Check if projectile hit world boundary
            bool hitBoundary = 
                updatedEntity.position.x <= updatedEntity.radius ||
                updatedEntity.position.x >= worldSize - updatedEntity.radius ||
                updatedEntity.position.y <= updatedEntity.radius ||
                updatedEntity.position.y >= worldSize - updatedEntity.radius;

            if (hitBoundary)
            {
                // Delete the attack entity and active attack record
                ctx.Db.entity.entity_id.Delete(entity.entity_id);
                ctx.Db.active_boss_attacks.active_boss_attack_id.Delete(activeBossAttack.active_boss_attack_id);
                
                // Clean up any damage records
                CleanupAttackDamageRecords(ctx, entity.entity_id);
            }
            else 
            {
                // Update entity position
                ctx.Db.entity.entity_id.Update(updatedEntity);

                activeBossAttack.ticks_elapsed += 1; 
                ctx.Db.active_boss_attacks.active_boss_attack_id.Update(activeBossAttack);
            }
        }
    }
}