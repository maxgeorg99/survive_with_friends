using SpacetimeDB;

public static partial class Module
{
    // Attack type enum
    [SpacetimeDB.Type]
    public enum AttackType
    {
        Sword,
        Wand,
        Knives,
        Shield
    }

    // Attack data table - stores the base data for various attacks
    [SpacetimeDB.Table(Name = "attack_data", Public = true)]
    public partial struct AttackData
    {
        [PrimaryKey]
        public uint attack_id;
        
        public AttackType attack_type;
        public string name;
        public uint cooldown;         // Cooldown in milliseconds between attack uses
        public uint duration;         // Duration in milliseconds that attack lasts
        public uint projectiles;      // Number of projectiles in a single burst
        public uint fire_delay;       // Delay in milliseconds between shots in a burst
        public float speed;           // Movement speed of projectiles
        public bool piercing;         // Whether projectiles pierce through enemies
        public float radius;          // Radius of attack/projectile
        public uint damage;           // Base damage of the attack
        public uint armor_piercing;   // Amount of enemy armor ignored
    }

    // Attack cooldowns - scheduled table for main attack cooldowns
    [SpacetimeDB.Table(Name = "attack_cooldowns", 
                      Scheduled = nameof(HandleAttackCooldown), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct AttackCooldown
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        public uint entity_id;        // The entity that owns this attack
        public AttackType attack_type; // The type of attack
        public ScheduleAt scheduled_at; // When the cooldown expires
    }

    // Attack burst cooldowns - scheduled table for delays between shots in a burst
    [SpacetimeDB.Table(Name = "attack_burst_cooldowns", 
                      Scheduled = nameof(HandleAttackBurstCooldown), 
                      ScheduledAt = nameof(scheduled_at))]
    public partial struct AttackBurstCooldown
    {
        [PrimaryKey, AutoInc]
        public ulong scheduled_id;
        
        public uint entity_id;        // The entity that owns this attack
        public AttackType attack_type; // The type of attack
        public uint remaining_shots;   // How many shots remain in the burst
        public ScheduleAt scheduled_at; // When the next shot should fire
    }

    // Active attacks - tracks currently active attacks in the game
    [SpacetimeDB.Table(Name = "active_attacks", Public = true)]
    public partial struct ActiveAttack
    {
        [PrimaryKey, AutoInc]
        public uint active_attack_id;
        
        public uint entity_id;        // The entity that owns this attack
        public AttackType attack_type; // The type of attack
        public uint id_within_burst;   // Position within a burst (0-based index)
        public Timestamp created_at;   // When the attack was created
        public Timestamp expires_at;   // When the attack will expire
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
            cooldown = 1000,          // 1 second cooldown
            duration = 500,           // 0.5 second duration
            projectiles = 1,          // Single slash
            fire_delay = 0,           // No delay
            speed = 150,              // Short range attack moves quickly
            piercing = true,          // Hits all enemies in range
            radius = 60,              // Short range
            damage = 25,              // Base damage
            armor_piercing = 5        // Slight armor piercing
        });

        // Wand - magic projectile
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 2,
            attack_type = AttackType.Wand,
            name = "Magic Bolt",
            cooldown = 1500,          // 1.5 second cooldown
            duration = 2000,          // 2 second duration for projectile
            projectiles = 1,          // Single bolt
            fire_delay = 0,           // No burst fire
            speed = 250,              // Bolt speed
            piercing = false,         // Doesn't pierce
            radius = 20,              // Bolt radius
            damage = 30,              // High damage
            armor_piercing = 15       // Good armor piercing
        });

        // Knives - multiple projectiles in burst
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 3,
            attack_type = AttackType.Knives,
            name = "Throwing Knives",
            cooldown = 2000,          // 2 second cooldown
            duration = 1500,          // 1.5 second duration for projectiles
            projectiles = 3,          // Three knives per burst
            fire_delay = 150,         // 150ms between knives
            speed = 300,              // Fast knives
            piercing = false,         // Doesn't pierce
            radius = 15,              // Small knife hitbox
            damage = 15,              // Lower individual damage
            armor_piercing = 10       // Medium armor piercing
        });

        // Shield - defensive area attack
        ctx.Db.attack_data.Insert(new AttackData
        {
            attack_id = 4,
            attack_type = AttackType.Shield,
            name = "Shield Bash",
            cooldown = 3000,          // 3 second cooldown
            duration = 800,           // 0.8 second duration
            projectiles = 1,          // Single attack
            fire_delay = 0,           // No burst
            speed = 120,              // Short range attack with modest speed
            piercing = true,          // Hits all enemies in range
            radius = 80,              // Large radius
            damage = 20,              // Medium damage
            armor_piercing = 0        // No armor piercing
        });

        Log.Info("Attack data initialized successfully.");
    }

    // Helper method to find attack data by attack type
    private static AttackData? FindAttackDataByType(ReducerContext ctx, AttackType attackType)
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

    // Handler for attack cooldown expiration
    [Reducer]
    public static void HandleAttackCooldown(ReducerContext ctx, AttackCooldown cooldown)
    {
        // This is called when an attack cooldown expires
        // We don't need to do anything here as the absence of a cooldown entry
        // indicates the attack is ready to use
        Log.Info($"Attack cooldown expired for entity {cooldown.entity_id}, attack type {cooldown.attack_type}");
    }

    // Helper method to trigger a single projectile of an attack
    private static void TriggerAttackProjectile(ReducerContext ctx, uint entityId, AttackType attackType, uint idWithinBurst = 0)
    {
        // Get attack data
        var attackData = FindAttackDataByType(ctx, attackType);
        if (attackData == null)
        {
            Log.Error($"Attack data not found for type {attackType}");
            return;
        }
        
        // Get entity data to determine position and direction
        var entityOpt = ctx.Db.entity.entity_id.Find(entityId);
        if (entityOpt == null)
        {
            Log.Error($"Entity {entityId} not found");
            return;
        }
        
        var entity = entityOpt.Value;
        
        // Get the direction from the entity
        var direction = entity.direction;
        
        // If the entity has no direction (not moving), use a default direction
        if (direction.x == 0 && direction.y == 0)
        {
            // Default to right direction if no movement direction
            direction = new DbVector2(1, 0);
        }
        else
        {
            // Normalize the direction vector
            direction = direction.Normalize();
        }
        
        // Calculate expiration time based on duration
        var duration = attackData.Value.duration;
        var currentTime = ctx.Timestamp;
        // Hack to add milliseconds - create a TimeSpan and add it
        var durationSpan = TimeSpan.FromMilliseconds(duration);
        
        // Create active attack (represents visible/active projectile or area attack)
        ctx.Db.active_attacks.Insert(new ActiveAttack
        {
            entity_id = entityId,
            attack_type = attackType,
            id_within_burst = idWithinBurst,
            created_at = currentTime,
            expires_at = currentTime // This will be adjusted by the game tick
        });
        
        // Note: This method would be expanded with actual game logic for creating
        // projectiles, applying damage, etc. For now it just creates the active attack record.
        Log.Info($"Created attack projectile for entity {entityId}, type {attackType}, id within burst: {idWithinBurst}, direction: ({direction.x}, {direction.y}), speed: {attackData.Value.speed}");
    }

    // Handler for attack burst cooldown expiration
    [Reducer]
    public static void HandleAttackBurstCooldown(ReducerContext ctx, AttackBurstCooldown burstCooldown)
    {
        // This is called when it's time for the next shot in a burst
        Log.Info($"Attack burst cooldown expired for entity {burstCooldown.entity_id}, attack type {burstCooldown.attack_type}, remaining shots: {burstCooldown.remaining_shots}");

        // Calculate the id_within_burst based on attack data and remaining shots
        var attackData = FindAttackDataByType(ctx, burstCooldown.attack_type);
        if (attackData == null)
        {
            Log.Error($"Attack data not found for type {burstCooldown.attack_type}");
            return;
        }
        
        uint totalProjectiles = attackData.Value.projectiles;
        uint currentProjectileIndex = totalProjectiles - burstCooldown.remaining_shots;

        // Create the next projectile in the burst with the correct id_within_burst
        TriggerAttackProjectile(ctx, burstCooldown.entity_id, burstCooldown.attack_type, currentProjectileIndex);

        // If there are more shots remaining in the burst, schedule the next one
        if (burstCooldown.remaining_shots > 1)
        {
            // Schedule the next shot
            ctx.Db.attack_burst_cooldowns.Insert(new AttackBurstCooldown
            {
                entity_id = burstCooldown.entity_id,
                attack_type = burstCooldown.attack_type,
                remaining_shots = burstCooldown.remaining_shots - 1,
                scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(attackData.Value.fire_delay))
            });
        }
    }

    // Reducer to trigger an attack for a player
    [Reducer]
    public static void TriggerAttack(ReducerContext ctx, AttackType attackType)
    {
        var identity = ctx.Sender;
        
        // Find the player's account
        var accountOpt = ctx.Db.account.identity.Find(identity);
        if (accountOpt == null)
        {
            throw new Exception($"Account not found for identity {identity}");
        }
        
        var account = accountOpt.Value;
        
        // Find the player
        var playerOpt = ctx.Db.player.player_id.Find(account.current_player_id);
        if (playerOpt == null)
        {
            throw new Exception($"Player not found for account {identity}");
        }
        
        var player = playerOpt.Value;
        var entityId = player.entity_id;
        
        // Check if this attack type exists
        var attackData = FindAttackDataByType(ctx, attackType);
        if (attackData == null)
        {
            throw new Exception($"Attack type {attackType} not found");
        }
        
        // Check if the attack is on cooldown
        bool isOnCooldown = false;
        foreach (var cooldown in ctx.Db.attack_cooldowns.Iter())
        {
            if (cooldown.entity_id == entityId && cooldown.attack_type == attackType)
            {
                isOnCooldown = true;
                break;
            }
        }
        
        if (isOnCooldown)
        {
            Log.Info($"Attack {attackType} is on cooldown for entity {entityId}");
            return;
        }
        
        // Handle case where we have multiple projectiles
        if (attackData.Value.projectiles > 1)
        {
            if (attackData.Value.fire_delay == 0)
            {
                // If fire_delay is 0, spawn all projectiles at once
                for (uint i = 0; i < attackData.Value.projectiles; i++)
                {
                    TriggerAttackProjectile(ctx, entityId, attackType, i);
                }
                Log.Info($"Spawned all {attackData.Value.projectiles} projectiles at once for attack {attackType}");
            }
            else
            {
                // Fire first projectile with id_within_burst = 0
                TriggerAttackProjectile(ctx, entityId, attackType, 0);
                
                // If there are more projectiles and fire_delay > 0, schedule the rest
                ctx.Db.attack_burst_cooldowns.Insert(new AttackBurstCooldown
                {
                    entity_id = entityId,
                    attack_type = attackType,
                    remaining_shots = attackData.Value.projectiles - 1,
                    scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(attackData.Value.fire_delay))
                });
            }
        }
        else
        {
            // Single projectile case - just trigger it with id_within_burst = 0
            TriggerAttackProjectile(ctx, entityId, attackType, 0);
        }
        
        // Put the attack on cooldown
        ctx.Db.attack_cooldowns.Insert(new AttackCooldown
        {
            entity_id = entityId,
            attack_type = attackType,
            scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(attackData.Value.cooldown))
        });
        
        Log.Info($"Attack {attackType} triggered for entity {entityId}");
    }

    // Call this from the existing Init method
    public static void InitializeAttackSystem(ReducerContext ctx)
    {
        InitAttackData(ctx);
    }
} 