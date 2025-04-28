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
            var upgradeOptionData = CreateUpgradeOptionData(ctx, upgradeType);
            upgradeOptionData.player_id = playerId;
            upgradeOptionData.upgrade_index = i;
            ctx.Db.upgrade_options.Insert(upgradeOptionData);
        }
    }

    //Helper function for creating upgrade option data based on upgrade type
    private static UpgradeOptionData CreateUpgradeOptionData(ReducerContext ctx, UpgradeType upgradeType)
    {
        var random = new Random();
        
        switch (upgradeType)
        {
            case UpgradeType.MaxHp:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType, 
                    value = 40,
                    is_attack_upgrade = false
                };
            }   
            case UpgradeType.HpRegen:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    value = 1,
                    is_attack_upgrade = false
                };
            }
            case UpgradeType.Speed:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    value = 25,
                    is_attack_upgrade = false
                };
            }
            case UpgradeType.Armor:
            {
                return new UpgradeOptionData
                {
                    upgrade_type = upgradeType,
                    value = 1,
                    is_attack_upgrade = false
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
            radius = selectedUpgrade.Value.radius
        };

        // Insert the chosen upgrade
        ctx.Db.chosen_upgrades.Insert(chosenUpgrade);
        
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
} 