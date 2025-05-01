using SpacetimeDB;
using System;
using System.Collections.Generic;

// Attack type enum
[SpacetimeDB.Type]
public enum UpgradeType
{
    MaxHp,
    HpRegen,
    Speed,
    Armor,
    AttackSword,
    AttackWand,
    AttackKnives,
    AttackShield
}

[SpacetimeDB.Type]
public enum AttackStat
{
    Damage,
    CooldownReduction,
    Projectiles,
    Speed,
    Radius
}

public static partial class Module
{
    [SpacetimeDB.Table(Name = "upgrade_options", Public = true)    ]
    public partial struct UpgradeOptionData
    {
        [PrimaryKey, AutoInc]
        public uint upgrade_id;

        [SpacetimeDB.Index.BTree]
        public uint player_id;
        public uint upgrade_index;
        
        public UpgradeType upgrade_type;
        public bool is_attack_upgrade;
        public uint value;

        // Attack upgrade data
        public uint attack_type;
        public uint damage;
        public uint cooldown_ratio;
        public uint projectiles;
        public uint speed;
        public uint radius;

        public bool is_new_attack;
    }

    [SpacetimeDB.Table(Name = "chosen_upgrades", Public = true)]
    public partial struct ChosenUpgradeData
    {
        [PrimaryKey, AutoInc]
        public uint chosen_upgrade_id;

        [SpacetimeDB.Index.BTree]
        public uint player_id;
        
        public UpgradeType upgrade_type;
        public bool is_attack_upgrade;
        public uint value;

        // Attack upgrade data
        public uint attack_type;
        public uint damage;
        public uint cooldown_ratio; 
        public uint projectiles;
        public uint speed;
        public uint radius; 
        public bool is_new_attack;
    }
    public static void DrawUpgradeOptions(ReducerContext ctx, uint playerId)
    {
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("DrawUpgradeOptions may not be invoked by clients.");
        }

        //See if player has any upgrade options
        var existingUpgradeOptions = ctx.Db.upgrade_options.player_id.Filter(playerId);
        if (existingUpgradeOptions.Count() != 0)
        {
            //Skip drawing upgrade options      
            return;
        }

        //Draw 3 random upgrade options
        var random = new Random();
        var upgradeTypes = Enum.GetValues(typeof(UpgradeType));
        var upgradeOptions = new List<UpgradeType>();
        for (int i = 0; i < 3; i++)
        {   
            var randomIndex = random.Next(upgradeTypes.Length);
            upgradeOptions.Add((UpgradeType)upgradeTypes.GetValue(randomIndex));
        }

        //Insert upgrade options into database
        for (uint i = 0; i < 3; i++)
        {
            var upgradeType = upgradeOptions[(int)i];
            var upgradeOptionData = CreateUpgradeOptionData(ctx, upgradeType, playerId);
            upgradeOptionData.player_id = playerId;
            upgradeOptionData.upgrade_index = i;
            ctx.Db.upgrade_options.Insert(upgradeOptionData);
        }
    }

    //Helper function for creating upgrade option data based on upgrade type
    private static UpgradeOptionData CreateUpgradeOptionData(ReducerContext ctx, UpgradeType upgradeType, uint playerId)
    {
        var random = new Random();
        
        // Check if this is an attack upgrade
        bool isAttackUpgrade = upgradeType == UpgradeType.AttackSword || 
                            upgradeType == UpgradeType.AttackWand || 
                            upgradeType == UpgradeType.AttackKnives || 
                            upgradeType == UpgradeType.AttackShield;

        // If it's an attack upgrade, check if player already has it
        if (isAttackUpgrade)
        {
            AttackType attackType = GetAttackTypeFromUpgrade(upgradeType);
            bool playerHasAttack = false;
            
            // Check player's scheduled attacks to see if they already have this attack type
            foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
            {
                if (attack.attack_type == attackType)
                {
                    playerHasAttack = true;
                    break;
                }
            }
            
            // If player doesn't have this attack yet, return a "new attack" upgrade option
            if (!playerHasAttack)
            {
                Console.WriteLine($"Player {playerId} doesn't have {attackType} yet, offering as new attack");
                
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    is_attack_upgrade = true,
                    is_new_attack = true,  // Flag to indicate this is a new attack
                    attack_type = (uint)attackType,
                    value = 0,   // No stat upgrades for new attacks
                    damage = 0,
                    cooldown_ratio = 0,
                    projectiles = 0,
                    speed = 0,
                    radius = 0
                };
            }
        }
        
        // For non-attack upgrades or attacks the player already has, proceed with normal upgrade options
        switch (upgradeType)
        {
            case UpgradeType.MaxHp:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType, 
                    value = 40,
                    is_attack_upgrade = false,
                    is_new_attack = false
                };
            }   
            case UpgradeType.HpRegen:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    value = 1,
                    is_attack_upgrade = false,
                    is_new_attack = false
                };
            }
            case UpgradeType.Speed:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    value = 25,
                    is_attack_upgrade = false,
                    is_new_attack = false
                };
            }
            case UpgradeType.Armor:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    value = 1,
                    is_attack_upgrade = false,
                    is_new_attack = false
                };
            }
            case UpgradeType.AttackSword:
            {
                // Generate sword-specific stat upgrade
                return GenerateAttackUpgrade(1, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 2 },
                    { AttackStat.CooldownReduction, 25 },
                    { AttackStat.Radius, 4 },
                    { AttackStat.Projectiles, 1 },
                    { AttackStat.Speed, 100 }
                }, upgradeType);
            }
            case UpgradeType.AttackWand:
            {
                // Generate wand-specific stat upgrade
                return GenerateAttackUpgrade(2, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 1 },
                    { AttackStat.CooldownReduction, 15 },
                    { AttackStat.Projectiles, 1 },
                    { AttackStat.Speed, 100 }
                }, upgradeType);
            }
            case UpgradeType.AttackKnives:
            {
                // Generate knives-specific stat upgrade
                return GenerateAttackUpgrade(3, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 1 },
                    { AttackStat.CooldownReduction, 20 },
                    { AttackStat.Projectiles, 2 },
                    { AttackStat.Speed, 200 },
                    { AttackStat.Radius, 3 }
                }, upgradeType);
            }
            case UpgradeType.AttackShield:
            {
                // Generate shield-specific stat upgrade
                return GenerateAttackUpgrade(4, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 2 },
                    { AttackStat.Radius, 4 },
                    { AttackStat.CooldownReduction, 25 },
                    { AttackStat.Projectiles, 1 },
                    { AttackStat.Speed, 45 }
                }, upgradeType);
            }   
            default:
            {
                throw new Exception("Invalid upgrade type");
            }
        }       
    }

    // Helper method to generate attack upgrades with specific stat improvements
    private static UpgradeOptionData GenerateAttackUpgrade(uint attackType, Random random, Dictionary<AttackStat, uint> possibleStats, UpgradeType upgradeType)
    {
        // Choose a random stat to upgrade from the possible stats for this attack type
        var statKeys = possibleStats.Keys.ToList();
        var chosenStatIndex = random.Next(statKeys.Count);
        var chosenStat = statKeys[chosenStatIndex];
        var upgradeValue = possibleStats[chosenStat];
        
        Console.WriteLine($"Generated attack upgrade: {upgradeType}, Stat: {chosenStat}, Value: {upgradeValue}");
        
        // Create base upgrade data with attack type and is_attack_upgrade flag
        var upgradeData = new UpgradeOptionData
        {
            upgrade_type = upgradeType,
            is_attack_upgrade = true,
            is_new_attack = false,
            attack_type = attackType,
            value = upgradeValue
        };
        
        // Set the specific stat value based on the chosen stat
        switch (chosenStat)
        {
            case AttackStat.Damage:
                upgradeData.damage = upgradeValue;
                break;
            case AttackStat.CooldownReduction:
                upgradeData.cooldown_ratio = upgradeValue;
                break;
            case AttackStat.Projectiles:
                upgradeData.projectiles = upgradeValue;
                break;
            case AttackStat.Speed:
                upgradeData.speed = upgradeValue;
                break;
            case AttackStat.Radius:
                upgradeData.radius = upgradeValue;
                break;
        }
        
        return upgradeData;
    }

    [Reducer]
    public static void ChooseUpgrade(ReducerContext ctx, uint playerId, uint upgradeIndex)
    {
        // Ensure the caller is authorized
        if (ctx.Sender != ctx.Identity)
        {
            throw new Exception("ChooseUpgrade may not be invoked by clients.");
        }

        // Get the upgrade option data for the player
        var upgradeOptionsData = ctx.Db.upgrade_options.player_id.Filter(playerId);

        // Ensure the player has upgrades to choose from
        if (upgradeOptionsData.Count() == 0)
        {
            throw new Exception("Player has no available upgrades to choose from");
        }

        // Find the specific upgrade option selected
        UpgradeOptionData? selectedUpgrade = null;
        foreach (var option in upgradeOptionsData)
        {
            if (option.upgrade_index == upgradeIndex)
            {
                selectedUpgrade = option;
                break;
            }
        }

        if (selectedUpgrade == null)
        {
            throw new Exception($"Upgrade with index {upgradeIndex} not found");
        }

        // Get count of player's current chosen upgrades to determine the order
        uint upgradeOrder = (uint)ctx.Db.chosen_upgrades.player_id.Filter(playerId).Count();

        // Create a chosen upgrade entry based on the selected upgrade
        var chosenUpgrade = new ChosenUpgradeData
        {
            player_id = playerId,
            upgrade_type = selectedUpgrade.Value.upgrade_type,
            is_attack_upgrade = selectedUpgrade.Value.is_attack_upgrade,
            value = selectedUpgrade.Value.value,
            attack_type = selectedUpgrade.Value.attack_type,
            damage = selectedUpgrade.Value.damage,
            cooldown_ratio = selectedUpgrade.Value.cooldown_ratio,
            projectiles = selectedUpgrade.Value.projectiles,
            speed = selectedUpgrade.Value.speed,
            radius = selectedUpgrade.Value.radius,
            is_new_attack = selectedUpgrade.Value.is_new_attack
        };

        // Insert the chosen upgrade
        ctx.Db.chosen_upgrades.Insert(chosenUpgrade);
        
        // Apply the upgrade to the player
        ApplyPlayerUpgrade(ctx, chosenUpgrade);
        
        Console.WriteLine($"Player {playerId} chose upgrade: {selectedUpgrade.Value.upgrade_type}, Order: {upgradeOrder}");

        // Delete all upgrade options for the player
        var deleteCount = 0;
        foreach (var option in upgradeOptionsData)
        {
            if (ctx.Db.upgrade_options.upgrade_id.Delete(option.upgrade_id))
            {
                deleteCount++;
            }
        }
        
        Console.WriteLine($"Deleted {deleteCount} upgrade options for player {playerId}");

        // Try to get player data to update their unspent upgrades
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt != null)
        {
            var player = playerOpt.Value;
            
            // Check if player has unspent upgrades
            if (player.unspent_upgrades > 0)
            {
                // Decrement unspent upgrades
                player.unspent_upgrades--;
                ctx.Db.player.player_id.Update(player);
                
                // If player still has unspent upgrades, draw new options
                if (player.unspent_upgrades > 0)
                {
                    DrawUpgradeOptions(ctx, playerId);
                }
            }
        }
    }

    // Helper method to apply an upgrade to a player
    private static void ApplyPlayerUpgrade(ReducerContext ctx, ChosenUpgradeData upgrade)
    {
        uint playerId = upgrade.player_id;
        
        // Get player data
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt == null)
        {
            Console.WriteLine($"Cannot apply upgrade - player {playerId} not found");
            return;
        }
        
        var player = playerOpt.Value;
        
        Console.WriteLine($"Applying upgrade {upgrade.upgrade_type} to player {playerId}");
        
        // Handle different upgrade types
        if (!upgrade.is_attack_upgrade)
        {
            // Handle non-attack upgrades (directly modify player stats)
            switch (upgrade.upgrade_type)
            {
                case UpgradeType.MaxHp:
                    player.max_hp += upgrade.value;
                    player.hp += upgrade.value; // Heal player when max HP increases
                    Console.WriteLine($"Increased player {playerId} max HP by {upgrade.value} to {player.max_hp}");
                    break;
                    
                case UpgradeType.HpRegen:
                    player.hp_regen += upgrade.value;
                    Console.WriteLine($"Increased player {playerId} HP regen by {upgrade.value} to {player.hp_regen}");
                    break;
                    
                case UpgradeType.Speed:
                    player.speed += (float)upgrade.value / 100.0f; // Convert percent to speed factor
                    Console.WriteLine($"Increased player {playerId} speed by {upgrade.value}% to {player.speed}");
                    break;
                    
                case UpgradeType.Armor:
                    player.armor += upgrade.value;
                    Console.WriteLine($"Increased player {playerId} armor by {upgrade.value} to {player.armor}");
                    break;
                    
                default:
                    Console.WriteLine($"Unknown non-attack upgrade type: {upgrade.upgrade_type}");
                    break;
            }
            
            // Update player record with modified stats
            ctx.Db.player.player_id.Update(player);
        }
        else
        {
            // Handle attack upgrades
            // First, determine which attack type we're upgrading
            AttackType attackType = GetAttackTypeFromUpgrade(upgrade.upgrade_type);
            
            // Check if this is a new attack
            if (upgrade.is_new_attack)
            {
                // Simply schedule the new attack with base stats
                Console.WriteLine($"Adding new attack {attackType} for player {playerId}");
                ScheduleNewPlayerAttack(ctx, playerId, attackType);
                return; // No other modifications needed for new attacks
            }
            
            // This is an upgrade to an existing attack
            // Check if this player already has a scheduled attack of this type
            bool hasExistingAttack = false;
            ulong scheduledAttackId = 0;
            PlayerScheduledAttack existingAttack = new PlayerScheduledAttack();
            
            foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
            {
                if (attack.attack_type == attackType)
                {
                    hasExistingAttack = true;
                    scheduledAttackId = attack.scheduled_id;
                    existingAttack = attack;
                    break;
                }
            }
            
            // Get base attack data
            var baseAttackDataOpt = FindAttackDataByType(ctx, attackType);
            if (baseAttackDataOpt == null)
            {
                Console.WriteLine($"Base attack data not found for attack type {attackType}");
                return;
            }
            
            var baseAttackData = baseAttackDataOpt.Value;
            
            if (!hasExistingAttack)
            {
                // Player doesn't have this attack yet (shouldn't happen with is_new_attack flag, but handle anyway)
                Console.WriteLine($"Player {playerId} doesn't have attack {attackType} yet, scheduling new attack");
                ScheduleNewPlayerAttack(ctx, playerId, attackType);
                
                // Fetch the newly created attack to apply upgrades
                foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
                {
                    if (attack.attack_type == attackType)
                    {
                        hasExistingAttack = true;
                        scheduledAttackId = attack.scheduled_id;
                        existingAttack = attack;
                        break;
                    }
                }
                
                if (!hasExistingAttack)
                {
                    Console.WriteLine($"Failed to schedule new attack for player {playerId}, attack type {attackType}");
                    return;
                }
            }
            
            // Now apply the upgrade to the attack's stats
            bool updateScheduleInterval = false;
            bool updateScheduledAttack = false;
            
            // Create a modifier for the attack
            var modifiedAttack = existingAttack;
            uint cooldownReduction = 0;
            
            // Apply the specific stat upgrade
            if (upgrade.damage > 0)
            {
                // Damage upgrade
                modifiedAttack.parameter_u += upgrade.damage;
                updateScheduledAttack = true;
                Console.WriteLine($"Increased attack {attackType} damage by {upgrade.damage}");
            }
            
            if (upgrade.cooldown_ratio > 0)
            {
                // Cooldown reduction (increased fire rate)
                cooldownReduction = upgrade.cooldown_ratio;
                updateScheduleInterval = true;
                Console.WriteLine($"Increased attack {attackType} fire rate by {upgrade.cooldown_ratio}%");
            }
            
            if (upgrade.projectiles > 0)
            {
                // More projectiles
                modifiedAttack.parameter_i += (int)upgrade.projectiles;
                updateScheduledAttack = true;
                Console.WriteLine($"Increased attack {attackType} projectiles by {upgrade.projectiles}");
            }
            
            // Speed and radius changes are applied at attack creation time
            // We don't need to update these in the scheduled attack
            
            // Update the scheduled attack if needed
            if (updateScheduledAttack)
            {
                ctx.Db.player_scheduled_attacks.scheduled_id.Update(modifiedAttack);
                Console.WriteLine($"Updated scheduled attack for player {playerId}, attack type {attackType}");
            }
            
            // Handle cooldown reduction by updating the schedule interval
            if (updateScheduleInterval && cooldownReduction > 0)
            {
                // Recalculate cooldown based on upgrade percentage
                // Higher percentage = faster attacks = less cooldown time
                var upgradedAttack = ctx.Db.player_scheduled_attacks.scheduled_id.Find(scheduledAttackId);
                if (upgradedAttack != null)
                {
                    // Calculate the new cooldown reduction factor
                    // For example, 25% cooldown_ratio means fire rate is 1.25x faster
                    float fireRateMultiplier = 1.0f + (cooldownReduction / 100.0f);
                    
                    // Adjust attack cooldown by the fire rate multiplier (shorter cooldown = faster firing)
                    uint newCooldown = (uint)(baseAttackData.cooldown / fireRateMultiplier);
                    
                    // Create a new schedule with the updated cooldown
                    var updatedAttack = upgradedAttack.Value;
                    updatedAttack.scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(newCooldown));
                    
                    // Update the scheduled attack with the new interval
                    ctx.Db.player_scheduled_attacks.scheduled_id.Update(updatedAttack);
                    Console.WriteLine($"Updated attack {attackType} cooldown for player {playerId}: {baseAttackData.cooldown}ms -> {newCooldown}ms");
                }
            }
        }
    }

    // Helper method to convert from UpgradeType to AttackType
    private static AttackType GetAttackTypeFromUpgrade(UpgradeType upgradeType)
    {
        switch (upgradeType)
        {
            case UpgradeType.AttackSword:
                return AttackType.Sword;
            case UpgradeType.AttackWand:
                return AttackType.Wand;
            case UpgradeType.AttackKnives:
                return AttackType.Knives;
            case UpgradeType.AttackShield:
                return AttackType.Shield;
            default:
                throw new Exception($"Cannot convert upgrade type {upgradeType} to attack type");
        }
    }
} 