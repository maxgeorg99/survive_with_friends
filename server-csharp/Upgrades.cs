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
        foreach (var upgradeType in upgradeOptions)
        {
            var upgradeOptionData = CreateUpgradeOptionData(ctx, upgradeType);
            upgradeOptionData.player_id = playerId;
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
} 