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
    BossBjornBolt,
    WormSpit,
    ScorpionSting,
    Shuriken,       // Sword + Knives
    FireSword,      // Sword + Wand
    HolyHammer,     // Sword + Shield
    MagicDagger,    // Knives + Wand
    ThrowingShield, // Knives + Shield
    EnergyOrb       // Wand + Shield
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
        public int parameter_i;        // Integer parameter used for special attacks
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

        // Base weapons use attack IDs 1-10
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
        
        // Football - bouncing projectile with knockback
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 5,
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
            attack_id = 6,
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
            attack_id = 7,
            attack_type = AttackType.Dumbbell,
            name = "Dumbbell Drop",
            cooldown = 1200,         // Slow attack speed
            duration = 2000,          // Qlonng fall time
            projectiles = 1,         // Multiple dumbbells
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
            attack_id = 8,
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

        // Boss attack IDs use 21-30
        // Boss Standard Bolt - for Simon's spread attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 21,
            attack_type = AttackType.BossBolt, 
            name = "Boss Standard Bolt",
            cooldown = 10000,      // Example cooldown for Simon's attack sequence
            duration = 1000,      // How long each bolt lasts
            projectiles = 1,      // This AttackData defines a single bolt
            fire_delay = 0,       
            speed = 850,          // Speed of the bolt
            piercing = false,
            radius = 10,          // Radius of the bolt
            damage = 0,           // Damage per bolt
            armor_piercing = 3
        });

        // Boss Jorge Bolt - unique projectile for Jorge
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 22,
            attack_type = AttackType.BossJorgeBolt,
            name = "Jorge Bolt",
            cooldown = 1000,           // Faster fire rate
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
            attack_id = 23,
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

        // Monster attacks use IDs 31-40
        // Worm Spit - weak projectile attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 31,
            attack_type = AttackType.WormSpit,
            name = "Worm Spit",
            cooldown = 8000,           // Slow attack speed (8 seconds)
            duration = 1500,           // How long the projectile stays active
            projectiles = 1,           // One projectile at a time
            fire_delay = 0,
            speed = 500,               // Medium speed
            piercing = false,          // Doesn't pierce through targets
            radius = 12,               // Small size
            damage = 2,                // Very low damage
            armor_piercing = 0         // No armor piercing
        });

        // Scorpion Sting - short range projectile with poison effect
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 32,
            attack_type = AttackType.ScorpionSting,
            name = "Scorpion Sting",
            cooldown = 4000,           // Slower
            duration = 800,            // Shorter duration than worm spit
            projectiles = 1,           // One projectile at a time
            fire_delay = 0,
            speed = 400,               // Slower
            piercing = false,          // Doesn't pierce through targets
            radius = 10,               // Smaller size
            damage = 1,                // Lower damage (poison effect is the main threat)
            armor_piercing = 0         // No armor piercing
        });

        // Combined weapons use IDs 11-20
        // Shuriken - combines Sword and Knives properties
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 11,
            attack_type = AttackType.Shuriken,
            name = "Shuriken Toss",
            cooldown = 700,          // Medium cooldown
            duration = 600,          // Shorter duration
            projectiles = 1,         
            fire_delay = 100,        // Delay between shurikens
            speed = 900,             // Fast speed
            piercing = true,         // Pierces through enemies
            radius = 18,             // Medium radius
            damage = 5,              // Moderate damage
            armor_piercing = 3       
        });

        // Fire Sword - combines Sword and Wand properties
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 12,
            attack_type = AttackType.FireSword,
            name = "Fire Sword Slash",
            cooldown = 800,          // Medium cooldown
            duration = 700,          // Medium duration
            projectiles = 1,         // Single fiery slash
            fire_delay = 0,          // No delay, instant hit
            speed = 1000,            // Very fast
            piercing = true,         // Pierces through enemies
            radius = 30,             // Medium radius
            damage = 6,              // Moderate damage
            armor_piercing = 4       
        });

        // Holy Hammer - combines Sword and Shield properties
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 13,
            attack_type = AttackType.HolyHammer,
            name = "Holy Hammer Throw",
            cooldown = 1200,         // Slower cooldown
            duration = 800,          // Medium duration
            projectiles = 1,         // Single hammer smash
            fire_delay = 0,          // No delay, instant hit
            speed = 700,             // Medium speed
            piercing = false,        // Does not pierce, blunt force
            radius = 35,             // Large radius
            damage = 10,             // High damage
            armor_piercing = 5       
        });

        // Magic Dagger - combines Knives and Wand properties
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 14,
            attack_type = AttackType.MagicDagger,
            name = "Magic Dagger Throw",
            cooldown = 500,          // Fast cooldown
            duration = 2000,          // Short duration
            projectiles = 1,         // Burst of 2 daggers
            fire_delay = 50,         // Quick delay between daggers
            speed = 400,             // Fast speed
            piercing = true,
            radius = 12,
            damage = 20,
            armor_piercing = 2       
        });

        // Throwing Shield - combines Knives and Shield properties
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 15,
            attack_type = AttackType.ThrowingShield,
            name = "Throwing Shield Bash",
            cooldown = 1000,
            duration = 700,
            projectiles = 1,
            fire_delay = 0,
            speed = 800,
            piercing = true,
            radius = 25,
            damage = 7,
            armor_piercing = 3       
        });

        // Energy Orb - combines Wand and Shield properties
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 16,
            attack_type = AttackType.EnergyOrb,
            name = "Energy Orb Blast",
            cooldown = 900,
            duration = 800,
            projectiles = 4,
            fire_delay = 0,
            speed = 850,
            piercing = false,
            radius = 40,
            damage = 8,
            armor_piercing = 4       
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

    // Helper method to find the nearest player position
    private static DbVector2? FindNearestPlayerPosition(ReducerContext ctx, DbVector2 fromPosition)
    {
        float nearestDistSq = float.MaxValue;
        DbVector2? nearestPlayerPos = null;

        foreach (var player in ctx.Db.player.Iter())
        {
            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (playerEntityOpt != null)
            {
                var playerEntity = playerEntityOpt.Value;
                float dx = playerEntity.position.x - fromPosition.x;
                float dy = playerEntity.position.y - fromPosition.y;
                float distSq = dx * dx + dy * dy;
                
                if (distSq < nearestDistSq)
                {
                    nearestDistSq = distSq;
                    nearestPlayerPos = playerEntity.position;
                }
            }
        }

        return nearestPlayerPos;
    }

    // Helper method to calculate direction vector toward a target
    private static DbVector2 CalculateDirectionTowardTarget(DbVector2 fromPosition, DbVector2? targetPosition)
    {
        if (!targetPosition.HasValue)
        {
            return new DbVector2(1, 0); // Default direction if no target
        }

        float dx = targetPosition.Value.x - fromPosition.x;
        float dy = targetPosition.Value.y - fromPosition.y;
        float length = (float)Math.Sqrt(dx * dx + dy * dy);
        
        if (length > 0)
        {
            return new DbVector2(dx / length, dy / length);
        }
        return new DbVector2(1, 0); // Default direction if same position
    }

    // Boss attack trigger method - similar to TriggerAttackProjectile but for bosses
    private static void TriggerBossAttackProjectile(ReducerContext ctx, uint bossId, AttackType attackType, uint idWithinBurst = 0, uint parameterU = 0, int parameterI = 0)
    {
        // Get attack data
        var attackDataOpt = FindAttackDataByType(ctx, attackType);
        if (attackDataOpt == null)
        {
            Log.Error($"Attack data not found for type {attackType}");
            return;
        }

        var attackData = attackDataOpt.Value;
        
        // Get boss monster data
        var bossOpt = ctx.Db.monsters.monster_id.Find(bossId);
        if (bossOpt == null)
        {
            Log.Error($"Boss {bossId} not found");
            return;
        }
        
        var boss = bossOpt.Value;
        
        // Get boss's entity data to determine position
        var entityOpt = ctx.Db.entity.entity_id.Find(boss.entity_id);
        if (entityOpt == null)
        {
            Log.Error($"Entity {boss.entity_id} not found for boss {bossId}");
            return;
        }
        
        var entity = entityOpt.Value; // Boss's entity
        
        DbVector2 direction;
        // Calculate base direction towards the nearest player for all attack types first
        var nearestPlayerPos = FindNearestPlayerPosition(ctx, entity.position);
        var baseDirectionToTarget = CalculateDirectionTowardTarget(entity.position, nearestPlayerPos);

        if (attackType == AttackType.BossBolt) // Simon's spread attack
        {
            // idWithinBurst: 0, 1, 2 for Simon's 3 projectiles (from BossSystem.cs loop)
            const float spreadAngleDegrees = 15.0f; // Angle for the outer projectiles
            float angleOffsetDegrees = 0;

            if (idWithinBurst == 0) // Left projectile relative to boss facing player
            {
                angleOffsetDegrees = -spreadAngleDegrees;
            }
            else if (idWithinBurst == 2) // Right projectile
            {
                angleOffsetDegrees = spreadAngleDegrees;
            }
            // else if (idWithinBurst == 1), angleOffsetDegrees = 0; // Center projectile, no offset

            if (angleOffsetDegrees != 0.0f && !(baseDirectionToTarget.x == 0 && baseDirectionToTarget.y == 0))
            {
                float angleOffsetRadians = angleOffsetDegrees * (float)Math.PI / 180.0f;
                direction = new DbVector2(
                    baseDirectionToTarget.x * (float)Math.Cos(angleOffsetRadians) - baseDirectionToTarget.y * (float)Math.Sin(angleOffsetRadians),
                    baseDirectionToTarget.x * (float)Math.Sin(angleOffsetRadians) + baseDirectionToTarget.y * (float)Math.Cos(angleOffsetRadians)
                );
                
                // Normalize the direction vector
                float len = (float)Math.Sqrt(direction.x * direction.x + direction.y * direction.y);
                if (len > 0)
                {
                    direction.x /= len;
                    direction.y /= len;
                }
                else
                {
                    // Fallback if length is zero (should not happen if baseDirectionToTarget was not zero)
                    direction = baseDirectionToTarget; 
                }
            }
            else
            {
                direction = baseDirectionToTarget; // Center projectile or if baseDirectionToTarget is zero (boss on player)
            }
        }
        else // Standard boss projectile (e.g., Jorge, or Bjorn's initial homing vector)
        {
            direction = baseDirectionToTarget;
        }
        
        // Create a new entity for the projectile and get its ID
        var projectileEntity = ctx.Db.entity.Insert(new Entity
        {
            position = entity.position,
            direction = direction, // Use the calculated direction
            radius = attackData.radius
        });

        // Create active boss attack
        var activeBossAttack = ctx.Db.active_boss_attacks.Insert(new ActiveBossAttack
        {
            entity_id = projectileEntity.entity_id,
            boss_monster_id = bossId,
            attack_type = attackType,
            id_within_burst = idWithinBurst,
            parameter_u = parameterU, // Used for Bjorn's homing flag, etc.
            damage = attackData.damage,
            radius = attackData.radius,
            piercing = attackData.piercing
        });

        // Schedule cleanup
        ctx.Db.active_boss_attack_cleanup.Insert(new ActiveBossAttackCleanup
        {
            active_boss_attack_id = activeBossAttack.active_boss_attack_id,
            scheduled_at = new ScheduleAt.Time(ctx.Timestamp + TimeSpan.FromMilliseconds(attackData.duration))
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
            else if (activeAttack.attack_type == AttackType.EnergyOrb)
            {
                // Energy Orb orbits around the player similar to Shield but with different attributes
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
                
                // Get all energy orbs for this player to determine total count and positioning
                int totalOrbs = 0;
                foreach (var attack in ctx.Db.active_attacks.player_id.Filter(activeAttack.player_id))
                {
                    if (attack.attack_type == AttackType.EnergyOrb)
                    {
                        totalOrbs++;
                    }
                }
                
                if (totalOrbs == 0)
                {
                    continue; // Something's wrong, skip this iteration
                }
                
                // Calculate orbit angle - energy orbs rotate faster than normal shields
                double rotationSpeed = attackData.speed * 1.2 * Math.PI / 180.0 * DELTA_TIME;
                double parameterAngle = activeAttack.parameter_u * Math.PI / 180.0;
                double baseAngle = parameterAngle + (2 * Math.PI * activeAttack.id_within_burst / totalOrbs);
                double orbAngle = baseAngle + rotationSpeed * activeAttack.ticks_elapsed;
                
                // Energy orbs orbit further away from player
                float offsetDistance = (playerEntity.radius + entity.radius) * 3;
                
                // Calculate new position using angle
                float offsetX = (float)Math.Cos(orbAngle) * offsetDistance;
                float offsetY = (float)Math.Sin(orbAngle) * offsetDistance;
                
                // Update orb entity with new position
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
            else if (activeAttack.attack_type == AttackType.MagicDagger)
            {
                // Magic Dagger has two phases: outgoing and returning
                float moveSpeed = attackData.speed;
                var moveDistance = moveSpeed * DELTA_TIME;
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
                
                // Check if it's an outgoing dagger
                if (activeAttack.parameter_u == 0)
                {
                    // After traveling a certain distance or time, switch to returning mode
                    // Use elapsed ticks as a timer
                    if (activeAttack.ticks_elapsed >= 10) // Approx half a second with 60 ticks per second
                    {
                        var playerOpt = ctx.Db.player.player_id.Find(activeAttack.player_id);
                        if (playerOpt != null)
                        {
                            var player = playerOpt.Value;
                            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
                            if (playerEntityOpt != null)
                            {
                                var playerEntity = playerEntityOpt.Value;
                                
                                // Update to returning state
                                activeAttack.parameter_u = 1;
                                // Store player's position for return targeting
                                activeAttack.parameter_i = (int)player.entity_id;
                                ctx.Db.active_attacks.active_attack_id.Update(activeAttack);
                                
                                // Calculate return direction to player
                                var dx = playerEntity.position.x - updatedEntity.position.x;
                                var dy = playerEntity.position.y - updatedEntity.position.y;
                                float length = (float)Math.Sqrt(dx * dx + dy * dy);
                                if (length > 0)
                                {
                                    updatedEntity.direction = new DbVector2(dx / length, dy / length);
                                }
                                else
                                {
                                    updatedEntity.direction = new DbVector2(1, 0); // Fallback direction
                                }
                                
                                ctx.Db.entity.entity_id.Update(updatedEntity);
                            }
                        }
                    }
                    else
                    {
                        // Regular outgoing movement
                        ctx.Db.entity.entity_id.Update(updatedEntity);
                    }
                }
                else // Returning dagger
                {
                    var playerOpt = ctx.Db.player.player_id.Find(activeAttack.player_id);
                    if (playerOpt != null)
                    {
                        var player = playerOpt.Value;
                        var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
                        if (playerEntityOpt != null)
                        {
                            var playerEntity = playerEntityOpt.Value;
                            
                            // Update direction to home in on player's current position
                            var dx = playerEntity.position.x - updatedEntity.position.x;
                            var dy = playerEntity.position.y - updatedEntity.position.y;
                            float distSq = dx * dx + dy * dy;
                            
                            // Check if the dagger is close enough to the player
                            if (distSq <= (playerEntity.radius + entity.radius) * (playerEntity.radius + entity.radius))
                            {
                                // Dagger returned to player - delete it
                                ctx.Db.entity.entity_id.Delete(entity.entity_id);
                                ctx.Db.active_attacks.active_attack_id.Delete(activeAttack.active_attack_id);
                                
                                CleanupAttackDamageRecords(ctx, entity.entity_id);
                            }
                            else
                            {
                                // Update direction to follow player
                                float length = (float)Math.Sqrt(distSq);
                                if (length > 0)
                                {
                                    updatedEntity.direction = new DbVector2(dx / length, dy / length);
                                }
                                
                                ctx.Db.entity.entity_id.Update(updatedEntity);
                            }
                        }
                        else
                        {
                            ctx.Db.entity.entity_id.Update(updatedEntity);
                        }
                    }
                    else
                    {
                        ctx.Db.entity.entity_id.Update(updatedEntity);
                    }
                }
            }
            else if (activeAttack.attack_type == AttackType.ThrowingShield)
            {
                // Throwing Shield bounces between enemies
                float moveSpeed = attackData.speed;
                var moveDistance = moveSpeed * DELTA_TIME;
                var moveOffset = entity.direction * moveDistance;
                
                // Max number of bounces the shield can perform
                const uint MAX_BOUNCES = 2;
                
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
                
                // Check if the throwing shield has reached its maximum number of bounces
                if (activeAttack.parameter_u >= MAX_BOUNCES)
                {
                    // If reached max bounces, continue movement but don't bounce anymore
                    ctx.Db.entity.entity_id.Update(updatedEntity);
                    
                    // Check if hitting world boundary
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
                        
                        CleanupAttackDamageRecords(ctx, entity.entity_id);
                    }
                    
                    continue;
                }
                
                // Find a new target enemy to bounce to, excluding the last hit enemy
                Entity? bestTarget = null;
                float bestTargetDistance = float.MaxValue;
                
                foreach (var monster in ctx.Db.monsters.Iter())
                {
                    var monsterEntityOpt = ctx.Db.entity.entity_id.Find(monster.entity_id);
                    if (monsterEntityOpt is null) continue;
                    
                    var monsterEntity = monsterEntityOpt.Value;
                    
                    // Skip if this monster is too close (we've just hit it)
                    var dx = monsterEntity.position.x - updatedEntity.position.x;
                    var dy = monsterEntity.position.y - updatedEntity.position.y;
                    var distanceSquared = dx * dx + dy * dy;
                    
                    // Skip monsters that are too close (we've just hit them)
                    if (distanceSquared < (entity.radius + monsterEntity.radius) * (entity.radius + monsterEntity.radius) * 2)
                    {
                        continue;
                    }
                    
                    // Find the closest valid target
                    if (distanceSquared < bestTargetDistance)
                    {
                        bestTargetDistance = distanceSquared;
                        bestTarget = monsterEntity;
                    }
                }
                
                // If found a valid target, bounce to it
                if (bestTarget.HasValue)
                {
                    // Calculate direction to the new target
                    var dx = bestTarget.Value.position.x - updatedEntity.position.x;
                    var dy = bestTarget.Value.position.y - updatedEntity.position.y;
                    var length = (float)Math.Sqrt(dx * dx + dy * dy);
                    
                    if (length > 0)
                    {
                        // Update direction to point at the new target
                        updatedEntity.direction = new DbVector2(dx / length, dy / length);
                        ctx.Db.entity.entity_id.Update(updatedEntity);
                        
                        // Increment bounce counter
                        activeAttack.parameter_u += 1;
                        ctx.Db.active_attacks.active_attack_id.Update(activeAttack);
                    }
                    else
                    {
                        ctx.Db.entity.entity_id.Update(updatedEntity);
                    }
                }
                else
                {
                    ctx.Db.entity.entity_id.Update(updatedEntity);
                }
            }
            else if (activeAttack.attack_type == AttackType.HolyHammer)
            {
                // Holy Hammer - high damage projectile with knockback effect
                float moveSpeed = attackData.speed;
                
                // Calculate movement based on direction and speed
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
                
                // Apply knockback to all monsters hit by the hammer
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
                    
                    // If monster is hit by the hammer
                    if (distanceSquared <= radiusSum * radiusSum)
                    {
                        // Apply significant knockback in the hammer's direction
                        var knockbackStrength = 15f; // Strong knockback
                        var knockbackPos = monsterEntity.position + (entity.direction * knockbackStrength);
                        
                        // Update monster position with knockback
                        var updatedMonster = monsterEntity;
                        updatedMonster.position = knockbackPos;
                        ctx.Db.entity.entity_id.Update(updatedMonster);
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
            else if (activeAttack.attack_type == AttackType.FireSword)
            {
                // Fire Sword - fast, high-damage melee with fire trail
                float moveSpeed = attackData.speed;
                
                // Calculate movement based on direction and speed
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
                
                // Fire sword has a shorter lifetime but higher damage
                // We can enforce this with a faster timer-based cleanup
                if (activeAttack.ticks_elapsed >= attackData.duration / DELTA_TIME / 1000)
                {
                    // Delete attack entity and active attack record when time is up
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
            else if (activeAttack.attack_type == AttackType.Shuriken)
            {
                // Shuriken - fast spinning projectile that flies straight
                float moveSpeed = attackData.speed;
                
                // Calculate movement based on direction and speed
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
            else
            {
                // Regular projectile movement based on direction and speed
                float moveSpeed = attackData.speed;
                
                // Special handling for Dumbbell - apply gravity
                if (activeAttack.attack_type == AttackType.Dumbbell)
                {
                    float gravity = 4f; // Even lighter gravity for slower fall
                    // Apply gravity to the vertical component of direction
                    entity.direction = new DbVector2(
                        entity.direction.x,
                        entity.direction.y + (gravity * DELTA_TIME)
                    );
                }

                // Calculate movement based on direction and speed
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
                            // Apply slight knockback in the football's direction
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