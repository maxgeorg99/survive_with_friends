using SpacetimeDB;
using System;
using System.Collections.Generic;
using System.Linq;

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
    AttackShield,
    AttackFootball,
    AttackCards,
    AttackDumbbell,
    AttackGarlic
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

// Define weapon combination structure (can be expanded)
public struct WeaponCombinationDef
{
    public AttackType Weapon1;
    public AttackType Weapon2;
    public AttackType CombinedWeapon;
    public uint RequiredLevel;
}

public static partial class Module
{
    // List of defined weapon combinations
    private static readonly List<WeaponCombinationDef> WeaponCombinations = new List<WeaponCombinationDef>
    {
        new WeaponCombinationDef { Weapon1 = AttackType.Sword, Weapon2 = AttackType.Knives, CombinedWeapon = AttackType.Shuriken, RequiredLevel = 1 },
        new WeaponCombinationDef { Weapon1 = AttackType.Sword, Weapon2 = AttackType.Wand, CombinedWeapon = AttackType.FireSword, RequiredLevel = 1 },
        new WeaponCombinationDef { Weapon1 = AttackType.Sword, Weapon2 = AttackType.Shield, CombinedWeapon = AttackType.HolyHammer, RequiredLevel = 1 },
        new WeaponCombinationDef { Weapon1 = AttackType.Knives, Weapon2 = AttackType.Wand, CombinedWeapon = AttackType.MagicDagger, RequiredLevel = 1 },
        new WeaponCombinationDef { Weapon1 = AttackType.Knives, Weapon2 = AttackType.Shield, CombinedWeapon = AttackType.ThrowingShield, RequiredLevel = 1 },
        new WeaponCombinationDef { Weapon1 = AttackType.Wand, Weapon2 = AttackType.Shield, CombinedWeapon = AttackType.EnergyOrb, RequiredLevel = 1 },
    };

    [SpacetimeDB.Table(Name = "upgrade_options", Public = true)]
    public partial struct UpgradeOptionData
    {
        [PrimaryKey, AutoInc]
        public uint upgrade_id;

        [SpacetimeDB.Index.BTree]
        public uint player_id;
        public uint upgrade_index;
        
        public UpgradeType upgrade_type;
        public bool is_attack_upgrade;
        public uint value; // For stat upgrades: new value. For attack upgrades: new skill level.
        public uint attack_type; // Cast to AttackType enum if is_attack_upgrade is true
        public uint damage;
        public uint cooldown_ratio;
        public uint projectiles;
        public uint speed;
        public uint radius;

        public bool is_new_attack;
        public bool is_combination_trigger;
        public AttackType first_weapon_to_combine;
        public AttackType second_weapon_to_combine;
        public AttackType combined_weapon_result;
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

        // New fields to mirror from UpgradeOptionData if needed, or handle logic before this stage
        public bool is_combination_trigger;
        public AttackType first_weapon_to_combine;
        public AttackType second_weapon_to_combine;
        public AttackType combined_weapon_result;
    }
    public static void DrawUpgradeOptions(ReducerContext ctx, uint playerId)
    {
        // 1. Delete existing upgrade options for player
        var existingUpgradeOptions = ctx.Db.upgrade_options.player_id.Filter(playerId).ToList();
        foreach (var opt in existingUpgradeOptions)
        {
            ctx.Db.upgrade_options.Delete(opt);
        }

        // 2. Get player's class
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt == null)
        {
            throw new Exception($"Cannot draw upgrades - player {playerId} not found");
        }
        var player = playerOpt.Value;

        // 3. Get player's current attacks
        var playerAttacks = new Dictionary<AttackType, uint>();
        foreach (var pa in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
        {
            playerAttacks[pa.attack_type] = pa.skill_level;
        }

        // 4. FIRST PRIORITY: Check for possible weapon combinations
        List<UpgradeOptionData> combinationOptions = new List<UpgradeOptionData>();
        
        foreach (var combo in WeaponCombinations)
        {
            // Only offer combinations if the player doesn't already have the combined weapon
            if (!playerAttacks.ContainsKey(combo.CombinedWeapon))
            {
                bool hasBothWeapons = playerAttacks.ContainsKey(combo.Weapon1) && playerAttacks.ContainsKey(combo.Weapon2);
                bool hasRequiredLevel = playerAttacks.TryGetValue(combo.Weapon1, out uint weapon1Level) && 
                                       playerAttacks.TryGetValue(combo.Weapon2, out uint weapon2Level) &&
                                       weapon1Level >= combo.RequiredLevel && 
                                       weapon2Level >= combo.RequiredLevel;
                
                if (hasBothWeapons && hasRequiredLevel)
                {
                    // Create a combination option
                    var combinationOption = new UpgradeOptionData
                    {
                        upgrade_type = GetUpgradeTypeFromAttack(combo.Weapon1), // We'll use the first weapon's upgrade type
                        player_id = playerId,
                        is_attack_upgrade = true,
                        is_new_attack = false,
                        is_combination_trigger = true,
                        first_weapon_to_combine = combo.Weapon1,
                        second_weapon_to_combine = combo.Weapon2,
                        combined_weapon_result = combo.CombinedWeapon,
                        
                        // Default values for required fields
                        attack_type = (uint)combo.Weapon1, 
                        value = 0,
                        damage = 0,
                        cooldown_ratio = 0,
                        projectiles = 0,
                        speed = 0,
                        radius = 0
                    };
                    
                    combinationOptions.Add(combinationOption);
                    Log.Info($"Offering combination: {combo.Weapon1} + {combo.Weapon2} => {combo.CombinedWeapon} to player {playerId}");
                }
            }
        }
        
        // If we found possible combinations, prioritize them in the options
        if (combinationOptions.Count > 0)
        {
            // Shuffle the combination options to add some randomness
            var random = new Random();
            ShuffleList(combinationOptions, random);
            
            // Take up to 3 combination options
            var selectedCombos = combinationOptions.Take(3).ToList();
            
            // Assign upgrade indices
            for (int i = 0; i < selectedCombos.Count; i++)
            {
                var option = selectedCombos[i];
                option.upgrade_index = (uint)i;
                selectedCombos[i] = option; // Update since it's a struct
            }
            
            // Insert the combination options
            foreach (var combo in selectedCombos)
            {
                ctx.Db.upgrade_options.Insert(combo);
            }
            
            // If we have 3 combinations, we're done
            if (selectedCombos.Count == 3)
            {
                return;
            }
            
            // If we have 1-2 combinations, continue with normal upgrade process for remaining slots
            int remainingSlots = 3 - selectedCombos.Count;

            // 5. Determine random upgrade types based on class for remaining slots
            var allUpgradeTypes = GetAvailableUpgradeTypes(ctx, player.player_class, playerAttacks);
            
            ShuffleList(allUpgradeTypes, random);
            var selectedTypes = allUpgradeTypes.Take(remainingSlots).ToList();
            
            // 6. Create remaining upgrade options
            for (int i = 0; i < selectedTypes.Count; i++)
            {
                var upgradeType = selectedTypes[i];
                var upgradeOptionData = CreateUpgradeOptionData(ctx, upgradeType, playerId);
                upgradeOptionData.player_id = playerId;
                upgradeOptionData.upgrade_index = (uint)(i + selectedCombos.Count); // Continue indexing from where combinations left off
                ctx.Db.upgrade_options.Insert(upgradeOptionData);
            }
        }
        else
        {
            // No combinations available, proceed with normal upgrade options
            
            // 5. Determine 3 random upgrade types based on class
            var allUpgradeTypes = GetAvailableUpgradeTypes(ctx, player.player_class, playerAttacks);
            
            var random = new Random();
            ShuffleList(allUpgradeTypes, random);
            var selectedTypes = allUpgradeTypes.Take(3).ToList();
            Log.Info($"Selected upgrade types for player {playerId} (class {player.player_class}): {string.Join(", ", selectedTypes)}");
            
            // 6. Create initial UpgradeOptionData objects
            List<UpgradeOptionData> generatedOptions = new List<UpgradeOptionData>();
            for (int i = 0; i < selectedTypes.Count; i++)
            {
                var upgradeType = selectedTypes[i];
                var upgradeOptionData = CreateUpgradeOptionData(ctx, upgradeType, playerId);
                upgradeOptionData.player_id = playerId;
                upgradeOptionData.upgrade_index = (uint)i; // Assign unique index 0, 1, 2
                generatedOptions.Add(upgradeOptionData);
            }

            // 7. Insert the options into the database
            foreach (var finalOptionToInsert in generatedOptions)
            {
                ctx.Db.upgrade_options.Insert(finalOptionToInsert);
            }
        }
    }
    
    // Helper method to shuffle a list using Fisher-Yates algorithm
    private static void ShuffleList<T>(List<T> list, Random random)
    {
        int n = list.Count;
        for (int i = n - 1; i > 0; i--)
        {
            int j = random.Next(0, i + 1);
            T temp = list[i];
            list[i] = list[j];
            list[j] = temp;
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
                            upgradeType == UpgradeType.AttackShield ||
                            upgradeType == UpgradeType.AttackFootball ||
                            upgradeType == UpgradeType.AttackCards ||
                            upgradeType == UpgradeType.AttackDumbbell ||
                            upgradeType == UpgradeType.AttackGarlic;

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
            case UpgradeType.AttackFootball:
            {
                // Generate football-specific stat upgrade
                return GenerateAttackUpgrade(5, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 3 },
                    { AttackStat.CooldownReduction, 20 },
                    { AttackStat.Speed, 150 },
                    { AttackStat.Radius, 5 }
                }, upgradeType);
            }
            case UpgradeType.AttackCards:
            {
                // Generate cards-specific stat upgrade
                return GenerateAttackUpgrade(6, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 2 },
                    { AttackStat.CooldownReduction, 15 },
                    { AttackStat.Projectiles, 3 },
                    { AttackStat.Speed, 120 }
                }, upgradeType);
            }
            case UpgradeType.AttackDumbbell:
            {
                // Generate dumbbell-specific stat upgrade
                return GenerateAttackUpgrade(7, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 4 },
                    { AttackStat.CooldownReduction, 25 },
                    { AttackStat.Radius, 6 },
                    { AttackStat.Speed, 80 }
                }, upgradeType);
            }
            case UpgradeType.AttackGarlic:
            {
                // Generate garlic-specific stat upgrade
                return GenerateAttackUpgrade(8, random, new Dictionary<AttackStat, uint> {
                    { AttackStat.Damage, 2 },
                    { AttackStat.CooldownReduction, 20 },
                    { AttackStat.Radius, 8 },
                    { AttackStat.Speed, 60 }
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
        //Ensure the caller's identity is the player's identity
        var identityAccount = ctx.Db.account.identity.Find(ctx.Sender);
        if (identityAccount == null)
        {
            throw new Exception("ChooseUpgrade called by null identity");
        }

        if (identityAccount.Value.current_player_id != playerId)
        {
            throw new Exception("ChooseUpgrade called by wrong player");
        }

        // Get the upgrade option data for the player
        var upgradeOptionsData = ctx.Db.upgrade_options.player_id.Filter(playerId);

        // Ensure the player has upgrades to choose from
        if (upgradeOptionsData.Count() == 0)
        {
            throw new Exception("Player has no available upgrades to choose from");
        }

        // Find the specific upgrade option selected
        UpgradeOptionData? selectedUpgradeOpt = null;
        foreach (var option in upgradeOptionsData)
        {
            if (option.upgrade_index == upgradeIndex)
            {
                selectedUpgradeOpt = option;
                break;
            }
        }

        if (selectedUpgradeOpt == null)
        {
            throw new Exception($"Upgrade with index {upgradeIndex} not found");
        }
        var selectedUpgrade = selectedUpgradeOpt.Value;

        // Get count of player's current chosen upgrades to determine the order
        uint upgradeOrder = (uint)ctx.Db.chosen_upgrades.player_id.Filter(playerId).Count();

        // Create a chosen upgrade entry based on the selected upgrade
        var chosenUpgrade = new ChosenUpgradeData
        {
            player_id = playerId,
            upgrade_type = selectedUpgrade.upgrade_type,
            is_attack_upgrade = selectedUpgrade.is_attack_upgrade,
            value = selectedUpgrade.value,
            attack_type = selectedUpgrade.attack_type,
            damage = selectedUpgrade.damage,
            cooldown_ratio = selectedUpgrade.cooldown_ratio,
            projectiles = selectedUpgrade.projectiles,
            speed = selectedUpgrade.speed,
            radius = selectedUpgrade.radius,
            is_new_attack = selectedUpgrade.is_new_attack,
            is_combination_trigger = selectedUpgrade.is_combination_trigger,
            first_weapon_to_combine = selectedUpgrade.first_weapon_to_combine,
            second_weapon_to_combine = selectedUpgrade.second_weapon_to_combine,
            combined_weapon_result = selectedUpgrade.combined_weapon_result
        };

        // Insert the chosen upgrade
        ctx.Db.chosen_upgrades.Insert(chosenUpgrade);
        
        // Call achievement tracker for weapon acquisition if this is a new weapon or weapon upgrade
        if (chosenUpgrade.is_attack_upgrade) {
            // Find the player's account identity
            var account = ctx.Db.account.Iter().FirstOrDefault(a => a.current_player_id == playerId);
            if (!account.Equals(default)) {
                // Call the achievement tracker
                Module.TrackWeaponAcquisition(ctx, account.identity, (AttackType)chosenUpgrade.attack_type);
            }
        }
        
        // Apply the upgrade to the player
        ApplyPlayerUpgrade(ctx, chosenUpgrade);
        
        // Delete all upgrade options for the player
        var deleteCount = 0;
        foreach (var option in upgradeOptionsData)
        {
            if (ctx.Db.upgrade_options.upgrade_id.Delete(option.upgrade_id))
            {
                deleteCount++;
            }
        }
        
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
        if (upgrade.is_combination_trigger)
        {
            Log.Info($"Player {playerId} chose a combination upgrade: {upgrade.first_weapon_to_combine} + {upgrade.second_weapon_to_combine} => {upgrade.combined_weapon_result}.");

            // 1. Remove the first base weapon
            DeletePlayerAttack(ctx, playerId, upgrade.first_weapon_to_combine);
            Log.Info($"Removed {upgrade.first_weapon_to_combine} from player {playerId}.");

            // 2. Remove the second base weapon
            DeletePlayerAttack(ctx, playerId, upgrade.second_weapon_to_combine);
            Log.Info($"Removed {upgrade.second_weapon_to_combine} from player {playerId}.");
            
            // 3. Add the new combined weapon (at skill level 1)
            ScheduleNewPlayerAttack(ctx, playerId, upgrade.combined_weapon_result, 1);
            Log.Info($"Added combined weapon {upgrade.combined_weapon_result} L1 to player {playerId}.");
            return; // Combination applied, no further upgrade logic needed for this choice.
        }
        else if (!upgrade.is_attack_upgrade)
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
            Log.Info($"DEBUG: Processing attack upgrade with numeric ID: {upgrade.attack_type}");
            
            // If the upgrade is from a UI selection, use the UpgradeType for more reliable mapping
            AttackType attackType;
            if (upgrade.upgrade_type.ToString().StartsWith("Attack"))
            {
                // This is from a UI selection, use the more reliable UpgradeType mapping
                attackType = GetAttackTypeFromUpgrade(upgrade.upgrade_type);
                Log.Info($"DEBUG: Mapped from UpgradeType {upgrade.upgrade_type} to AttackType {attackType}");
            }
            else
            {
                // Otherwise use the numeric ID
                attackType = GetAttackTypeFromUpgrade(upgrade.attack_type);
                Log.Info($"DEBUG: Mapped from numeric ID {upgrade.attack_type} to AttackType {attackType}");
            }
            
            // Check if this is a new attack
            if (upgrade.is_new_attack)
            {
                // Simply schedule the new attack with base stats
                Console.WriteLine($"Adding new attack {attackType} for player {playerId}");
                ScheduleNewPlayerAttack(ctx, playerId, attackType);
                return; // No other modifications needed for new attacks
            }
            
            // This is an upgrade to an existing attack
            // Find the player's scheduled attack for this type
            PlayerScheduledAttack? existingAttack = null;
            ulong scheduledAttackId = 0;
            
            foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
            {
                if (attack.attack_type == attackType)
                {
                    existingAttack = attack;
                    scheduledAttackId = attack.scheduled_id;
                    break;
                }
            }
            
            if (existingAttack == null)
            {
                // Player doesn't have this attack yet (shouldn't happen with is_new_attack flag, but handle anyway)
                Console.WriteLine($"Player {playerId} doesn't have attack {attackType} yet, scheduling new attack");
                ScheduleNewPlayerAttack(ctx, playerId, attackType);
                return;
            }
            
            // Create a copy of the attack to modify
            var modifiedAttack = existingAttack.Value;
            bool updateScheduledAttack = false;
            bool updateScheduleInterval = false;
            uint cooldownReduction = 0;

            // Track upgrade count for weapon combinations
            modifiedAttack.skill_level++;
            var upgradeLevel = modifiedAttack.skill_level;
            Console.WriteLine($"Increasing skill level of {attackType} to {upgradeLevel}");
            
            // Apply upgrades to the attack stats
            if (upgrade.damage > 0)
            {
                // Damage upgrade - increase the damage stat directly
                modifiedAttack.damage += upgrade.damage;
                updateScheduledAttack = true;
                Console.WriteLine($"Increased attack {attackType} damage by {upgrade.damage} to {modifiedAttack.damage}");
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
                // More projectiles - update the projectiles count
                modifiedAttack.projectiles += upgrade.projectiles;
                updateScheduledAttack = true;
                Console.WriteLine($"Increased attack {attackType} projectiles by {upgrade.projectiles} to {modifiedAttack.projectiles}");
            }
            
            if (upgrade.speed > 0)
            {
                // Projectile speed upgrade
                modifiedAttack.speed += (modifiedAttack.speed * (float)upgrade.speed / 100.0f);
                updateScheduledAttack = true;
                Console.WriteLine($"Increased attack {attackType} speed by {upgrade.speed}% to {modifiedAttack.speed}");
            }
            
            if (upgrade.radius > 0)
            {
                // Attack radius upgrade
                modifiedAttack.radius += upgrade.radius;
                updateScheduledAttack = true;
                Console.WriteLine($"Increased attack {attackType} radius by {upgrade.radius} to {modifiedAttack.radius}");
            }
            
            // Update the scheduled attack record if any stats were changed
            if (updateScheduledAttack)
            {
                ctx.Db.player_scheduled_attacks.scheduled_id.Update(modifiedAttack);
                Console.WriteLine($"Updated scheduled attack for player {playerId}, attack type {attackType}");
            }
            
            // Handle cooldown reduction by updating the schedule interval
            if (updateScheduleInterval && cooldownReduction > 0)
            {
                // Get base attack data to get original cooldown
                var attackDataOpt = FindAttackDataByType(ctx, attackType);
                if (attackDataOpt != null)
                {
                    var attackData = attackDataOpt.Value;
                    
                    // Calculate new cooldown (apply percentage reduction)
                    var baseCooldown = attackData.cooldown;
                    var reduction = baseCooldown * cooldownReduction / 100;
                    var newCooldown = baseCooldown - reduction;
                    
                    // Update the attack scheduling interval
                    ctx.Db.player_scheduled_attacks.scheduled_id.Delete(scheduledAttackId);
                    
                    // Create a new scheduled attack with the updated interval
                    ctx.Db.player_scheduled_attacks.Insert(new PlayerScheduledAttack
                    {
                        player_id = playerId,
                        attack_type = modifiedAttack.attack_type,
                        skill_level = modifiedAttack.skill_level,
                        parameter_u = modifiedAttack.parameter_u,
                        parameter_i = modifiedAttack.parameter_i,
                        duration = modifiedAttack.duration,
                        projectiles = modifiedAttack.projectiles,
                        fire_delay = modifiedAttack.fire_delay,
                        speed = modifiedAttack.speed,
                        piercing = modifiedAttack.piercing,
                        radius = modifiedAttack.radius,
                        damage = modifiedAttack.damage,
                        armor_piercing = modifiedAttack.armor_piercing,
                        scheduled_at = new ScheduleAt.Interval(TimeSpan.FromMilliseconds(newCooldown))
                    });
                    
                    Console.WriteLine($"Updated attack cooldown: reduced from {baseCooldown}ms to {newCooldown}ms");
                }
            }
        }
    }

    // Helper method to delete a player's attack
    private static void DeletePlayerAttack(ReducerContext ctx, uint playerId, AttackType attackType)
    {
        foreach (var attack in ctx.Db.player_scheduled_attacks.player_id.Filter(playerId))
        {
            if (attack.attack_type == attackType)
            {
                ctx.Db.player_scheduled_attacks.scheduled_id.Delete(attack.scheduled_id);
                Console.WriteLine($"Deleted attack {attackType} from player {playerId}");
                return;
            }
        }
    }
    
    // Helper method to determine if a weapon is a base weapon (not combined)
    private static bool IsBaseWeapon(AttackType attackType)
    {
        // Only these base weapons can be combined
        return attackType == AttackType.Sword ||
               attackType == AttackType.Knives ||
               attackType == AttackType.Wand ||
               attackType == AttackType.Shield;
    }
    
    // Helper method to convert from UpgradeType to AttackType
    public static AttackType GetAttackTypeFromUpgrade(UpgradeType upgradeType)
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
            case UpgradeType.AttackFootball:
                return AttackType.Football;
            case UpgradeType.AttackCards:
                return AttackType.Cards;
            case UpgradeType.AttackDumbbell:
                return AttackType.Dumbbell;
            case UpgradeType.AttackGarlic:
                return AttackType.Garlic;
            default:
                throw new Exception($"No AttackType mapping for UpgradeType: {upgradeType}");
        }
    }

    // Helper method to convert from numeric attack type to AttackType
    public static AttackType GetAttackTypeFromUpgrade(uint attackType)
    {
        switch (attackType)
        {
            // Base weapons (IDs 1-10)
            case 1:
                return AttackType.Sword;
            case 2:
                return AttackType.Wand;
            case 3:
                return AttackType.Knives;
            case 4:
                return AttackType.Shield;
            case 5:
                return AttackType.Football;
            case 6:
                return AttackType.Cards;
            case 7:
                return AttackType.Dumbbell;
            case 8:
                return AttackType.Garlic;

            // Combined weapons (IDs 11-20)
            case 11:
                return AttackType.Shuriken;
            case 12:
                return AttackType.FireSword;
            case 13:
                return AttackType.HolyHammer;
            case 14:
                return AttackType.MagicDagger;
            case 15:
                return AttackType.ThrowingShield;
            case 16:
                return AttackType.EnergyOrb;

            // Boss attack types (IDs 21-30)
            case 21:
                return AttackType.BossBolt;
            case 22:
                return AttackType.BossJorgeBolt;
            case 23:
                return AttackType.BossBjornBolt;
                
            // Monster attack types (IDs 31-40)
            case 31:
                return AttackType.WormSpit;
            case 32:
                return AttackType.ScorpionSting;
                
            default:
                throw new Exception($"No AttackType mapping for numeric attack type: {attackType}");
        }
    }

    // Helper method to convert from AttackType to UpgradeType
    private static UpgradeType GetUpgradeTypeFromAttack(AttackType attackType)
    {
        switch (attackType)
        {
            case AttackType.Sword:
                return UpgradeType.AttackSword;
            case AttackType.Wand:
                return UpgradeType.AttackWand;
            case AttackType.Knives:
                return UpgradeType.AttackKnives;
            case AttackType.Shield:
                return UpgradeType.AttackShield;
            case AttackType.Football:
                return UpgradeType.AttackFootball;
            case AttackType.Cards:
                return UpgradeType.AttackCards;
            case AttackType.Dumbbell:
                return UpgradeType.AttackDumbbell;
            case AttackType.Garlic:
                return UpgradeType.AttackGarlic;
            default:
                // Default to sword for combined/special weapons
                return UpgradeType.AttackSword;
        }
    }

    [Reducer]
    public static void RerollUpgrades(ReducerContext ctx, uint playerId)
    {
        // Ensure the caller's identity is the player's identity
        var identityAccount = ctx.Db.account.identity.Find(ctx.Sender);
        if (identityAccount == null)
        {
            throw new Exception("RerollUpgrades called by null identity");
        }

        if (identityAccount.Value.current_player_id != playerId)
        {
            throw new Exception("RerollUpgrades called by wrong player");
        }

        // Get player data
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt == null)
        {
            throw new Exception($"Cannot reroll upgrades - player {playerId} not found");
        }
        var player = playerOpt.Value;

        // Check if player has unspent upgrades
        if (player.unspent_upgrades <= 0)
        {
            throw new Exception("Cannot reroll - no unspent upgrades available");
        }

        // Check if player has rerolls
        if (player.rerolls <= 0)
        {
            throw new Exception("Cannot reroll - no rerolls available");
        }

        // Delete all current upgrade options
        var deleteCount = 0;
        foreach (var option in ctx.Db.upgrade_options.player_id.Filter(playerId))
        {
            if (ctx.Db.upgrade_options.upgrade_id.Delete(option.upgrade_id))
            {
                deleteCount++;
            }
        }
        
        Log.Info($"Reroll: Deleted {deleteCount} upgrade options for player {playerId}");

        // Decrement rerolls
        player.rerolls--;
        ctx.Db.player.player_id.Update(player);
        Log.Info($"Player {playerId} used a reroll. Remaining rerolls: {player.rerolls}");

        // Draw new upgrade options
        DrawUpgradeOptions(ctx, playerId);
    }

    // Helper method to get available upgrade types based on player class and current attacks
    private static List<UpgradeType> GetAvailableUpgradeTypes(ReducerContext ctx, PlayerClass playerClass, Dictionary<AttackType, uint> playerAttacks)
    {
        var allUpgradeTypes = new List<UpgradeType>();
        foreach (UpgradeType type in Enum.GetValues(typeof(UpgradeType)))
        {
            bool shouldAdd = true;
            switch (type)
            {
                case UpgradeType.AttackFootball:
                    shouldAdd = playerClass == PlayerClass.Football;
                    break;
                case UpgradeType.AttackCards:
                    shouldAdd = playerClass == PlayerClass.Gambler;
                    break;
                case UpgradeType.AttackDumbbell:
                    shouldAdd = playerClass == PlayerClass.Athlete;
                    break;
                case UpgradeType.AttackGarlic:
                    shouldAdd = playerClass == PlayerClass.Gourmand;
                    break;
                default:
                    shouldAdd = true;
                    break;
            }
            if (shouldAdd) allUpgradeTypes.Add(type);
        }

        // Check for combined weapons that the player already has
        HashSet<AttackType> baseWeaponsToExclude = new HashSet<AttackType>();
        
        foreach (var playerAttack in playerAttacks.Keys)
        {
            // Look for base weapons that have already been used in combinations
            foreach (var combo in WeaponCombinations)
            {
                if (playerAttack == combo.CombinedWeapon)
                {
                    // Player has this combined weapon, exclude its base components
                    baseWeaponsToExclude.Add(combo.Weapon1);
                    baseWeaponsToExclude.Add(combo.Weapon2);
                    Log.Info($"Player has combined weapon {combo.CombinedWeapon}, excluding base weapons {combo.Weapon1} and {combo.Weapon2}");
                }
            }
        }

        // Remove upgrade types for attacks the player already has
        // And also remove base weapons that have been used in combinations
        List<UpgradeType> typesToRemove = new List<UpgradeType>();
        foreach (var upgradeType in allUpgradeTypes)
        {
            // Skip non-attack upgrade types
            if (!upgradeType.ToString().StartsWith("Attack")) continue;
            
            // Check if this upgrade is for an attack the player already has
            AttackType attackType;
            try
            {
                attackType = GetAttackTypeFromUpgrade(upgradeType);
                
                if (playerAttacks.ContainsKey(attackType) || baseWeaponsToExclude.Contains(attackType))
                {
                    typesToRemove.Add(upgradeType);
                }
            }
            catch (Exception)
            {
                // Skip any upgrade types that can't be converted to attack types
            }
        }
        
        // Remove the identified types
        foreach (var typeToRemove in typesToRemove)
        {
            allUpgradeTypes.Remove(typeToRemove);
        }
        
        return allUpgradeTypes;
    }
}