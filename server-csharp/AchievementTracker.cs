using SpacetimeDB;
using System;
using System.Collections.Generic;
using System.Linq;

public static partial class Module
{
    // Helper method to initialize player achievements when they first spawn
    public static void InitializePlayerAchievements(ReducerContext ctx, SpacetimeDB.Identity identity)
    {
        Log.Info($"Initializing achievements for player {identity}");

        // Iterate through all defined achievement types
        foreach (AchievementType type in Enum.GetValues(typeof(AchievementType)))
        {
            var blueprint = AchievementBlueprints.GetBlueprint(type);
            uint nextId = GetNextAchievementId(ctx);

            ctx.Db.achievements.Insert(new AchievementDefinition
            {
                AchievementsId = nextId,
                accountIdentity = identity,
                AchievementTypeType = type,
                TitleKey = blueprint.TitleKey,
                DescriptionKey = blueprint.DescriptionKey,
                SpritePath = blueprint.SpritePath,
                Progress = 0,
                Target = blueprint.Target,
                IsCompleted = false
            });
        }
        Log.Info($"Created {Enum.GetValues(typeof(AchievementType)).Length} achievements for player {identity}");
    }

    // Helper to get the next available achievement ID
    private static uint GetNextAchievementId(ReducerContext ctx)
    {
        uint maxId = 0;
        foreach (var achievement in ctx.Db.achievements.Iter())
        {
            if (achievement.AchievementsId > maxId)
            {
                maxId = achievement.AchievementsId;
            }
        }
        return maxId + 1;
    }

    // Track when a player kills a specific monster type
    public static void TrackMonsterKill(ReducerContext ctx, SpacetimeDB.Identity identity, MonsterType monsterType)
    {
        // Get extra debug info
        var monsterTypeValue = (int)monsterType;
        Log.Info($"TrackMonsterKill: Player {identity} killed monster of type {monsterType} (value: {monsterTypeValue})");

        // Find achievement type based on monster type
        AchievementType? achievementType = null;

        // Map monster type to achievement type
        switch (monsterType)
        {
            case MonsterType.Slime:
                achievementType = AchievementType.SlimeSlayer;
                Log.Info($"Slime kill detected for player {identity}");
                break;
            case MonsterType.Rat:
                achievementType = AchievementType.RatSlayer;
                Log.Info($"Rat kill detected for player {identity}");
                break;
            case MonsterType.Worm:
                achievementType = AchievementType.WormSlayer;
                Log.Info($"Worm kill detected for player {identity}");
                break;
            case MonsterType.Scorpion:
                achievementType = AchievementType.ScorpionSlayer;
                Log.Info($"Scorpion kill detected for player {identity}");
                break;
            case MonsterType.Orc:
                achievementType = AchievementType.OrcHunter;
                Log.Info($"Orc kill detected for player {identity}");
                break;
            case MonsterType.Wolf:
                achievementType = AchievementType.WolfHunter;
                Log.Info($"Wolf kill detected for player {identity}");
                break;
            case MonsterType.FinalBossJorgePhase2:
                Log.Info($"Jorge boss killed by player {identity}, tracking achievement");
                achievementType = AchievementType.DefeatJorge;
                break;
            case MonsterType.FinalBossBjornPhase2:
                Log.Info($"Björn boss killed by player {identity}, tracking achievement");
                achievementType = AchievementType.DefeatBjörn;
                break;
            case MonsterType.FinalBossSimonPhase2:
                Log.Info($"Simon boss killed by player {identity}, tracking achievement");
                achievementType = AchievementType.DefeatSimon;
                break;
            default:
                Log.Info($"No achievement mapping for monster type: {monsterType}");
                return;
        }

        if (achievementType.HasValue)
        {
            Log.Info($"Found achievement type {achievementType.Value} for monster type {monsterType}, incrementing progress");
            IncrementAchievementProgress(ctx, identity, achievementType.Value); // Changed from ForceIncrementAchievement
        }
    }

    // Track when a player reaches a new level
    public static void TrackPlayerLevel(ReducerContext ctx, SpacetimeDB.Identity identity, uint level)
    {
        Log.Info($"Tracking player level for player {identity}, level: {level}");

        // The Expert achievement tracks reaching level 10
        if (level <= 10) // Only update if we're at or below level 10
        {
            // For the Expert achievement, set progress directly to the level
            SetAchievementProgress(ctx, identity, AchievementType.Expert, level);
        }
    }

    // Track when a player acquires a new weapon
    public static void TrackWeaponAcquisition(ReducerContext ctx, SpacetimeDB.Identity identity, AttackType attackType)
    {
        Log.Info($"Tracking weapon acquisition for player {identity}");

        var playerAccount = ctx.Db.account.identity.Find(identity);
        if (playerAccount == null)
        {
            Log.Error($"TrackWeaponAcquisition: Account not found for identity {identity}");
            return;
        }
        // Only count unique weapon types (attack_type) for this player
        var uniqueWeapons = new HashSet<uint>();
        foreach (var upgrade in ctx.Db.chosen_upgrades.Iter())
        {
            if (upgrade.player_id == playerAccount.Value.current_player_id && upgrade.attack_type > 0)
            {
                uniqueWeapons.Add(upgrade.attack_type);
            }
        }
        uint weaponCount = (uint)uniqueWeapons.Count + 1; // +1 for the base weapon
        Log.Info($"TrackWeaponAcquisition: Player {identity} has {weaponCount} unique weapons");

        // Update the WeaponArsenal achievement with the current count
        SetAchievementProgress(ctx, identity, AchievementType.WeaponArsenal, weaponCount);
    }

    // Track when a player defeats the final boss (wins the game)
    public static void TrackGameWin(ReducerContext ctx, SpacetimeDB.Identity identity)
    {
        Log.Info($"Tracking game win for player {identity}");

        // Update the survivor achievement
        IncrementAchievementProgress(ctx, identity, AchievementType.Survivor);
    }

    // Force increment achievement progress by one - ensures the achievement exists first
    private static void ForceIncrementAchievement(ReducerContext ctx, SpacetimeDB.Identity identity, AchievementType achievementType)
    {
        Log.Info($"ForceIncrementAchievement: Checking achievement {achievementType} for player {identity}");

        AchievementDefinition? playerAchievementOpt = null;
        foreach (var ach in ctx.Db.achievements.accountIdentity.Filter(identity))
        {
            if (ach.AchievementTypeType == achievementType)
            {
                playerAchievementOpt = ach;
                Log.Info($"Found existing achievement {achievementType} for player {identity}: Progress={playerAchievementOpt.Value.Progress}/{playerAchievementOpt.Value.Target}");
                break;
            }
        }

        if (!playerAchievementOpt.HasValue)
        {
            Log.Info($"Achievement {achievementType} not found for player {identity}, creating it now with progress 1.");
            CreatePlayerAchievementFromBlueprint(ctx, identity, achievementType, 1);
            return; // Achievement created with progress 1, no further action needed here.
        }

        var playerAchievement = playerAchievementOpt.Value;

        // Skip if already completed
        if (playerAchievement.IsCompleted)
        {
            Log.Info($"Achievement {achievementType} already completed for player {identity}, skipping increment");
            return;
        }

        // Increment progress
        playerAchievement.Progress += 1;
        Log.Info($"Incrementing achievement {achievementType} progress for player {identity}: {playerAchievement.Progress}/{playerAchievement.Target}");

        // Check if completed
        if (playerAchievement.Progress >= playerAchievement.Target)
        {
            playerAchievement.IsCompleted = true;
            Log.Info($"Player {identity} has completed achievement: {achievementType}!");
        }

        // Update the achievement in database
        ctx.Db.achievements.AchievementsId.Update(playerAchievement);
        Log.Info($"Updated achievement {achievementType} for player {identity} in database: Progress={playerAchievement.Progress}/{playerAchievement.Target}");
    }

    // Increment achievement progress by one
    private static void IncrementAchievementProgress(ReducerContext ctx, SpacetimeDB.Identity identity, AchievementType achievementType)
    {
        // Find the achievement for this player
        AchievementDefinition? achievement = null;

        foreach (var ach in ctx.Db.achievements.accountIdentity.Filter(identity))
        {
            if (ach.AchievementTypeType == achievementType)
            {
                achievement = ach;
                break;
            }
        }

        if (achievement == null)
        {
            Log.Warn($"Achievement {achievementType} not found for player {identity}. Progress not updated. This should not happen if achievements are initialized correctly.");
            return;
        }

        // Skip if already completed
        if (achievement.Value.IsCompleted)
        {
            return;
        }

        // Update the progress
        var updatedAchievement = achievement.Value;
        updatedAchievement.Progress += 1;

        // Check if completed
        if (updatedAchievement.Progress >= updatedAchievement.Target)
        {
            updatedAchievement.IsCompleted = true;
            Log.Info($"Player {identity} has completed achievement: {achievementType}!");
        }

        // Update the achievement in the database
        ctx.Db.achievements.AchievementsId.Update(updatedAchievement);
        Log.Info($"Updated achievement {achievementType} for player {identity}: Progress={updatedAchievement.Progress}/{updatedAchievement.Target}");
    }

    // Set achievement progress to a specific value
    private static void SetAchievementProgress(ReducerContext ctx, SpacetimeDB.Identity identity, AchievementType achievementType, uint progress)
    {
        // Find the achievement for this player
        AchievementDefinition? achievement = null;

        foreach (var ach in ctx.Db.achievements.accountIdentity.Filter(identity))
        {
            if (ach.AchievementTypeType == achievementType)
            {
                achievement = ach;
                break;
            }
        }

        if (achievement == null)
        {
            Log.Warn($"Achievement {achievementType} not found for player {identity}. Progress not updated. This should not happen if achievements are initialized correctly.");
            return;
        }

        // Skip if already completed
        if (achievement.Value.IsCompleted)
        {
            return;
        }

        // Only update if the new progress is greater than the current progress (or if you want to allow overwriting)
        if (progress <= achievement.Value.Progress && achievementType != AchievementType.Expert && achievementType != AchievementType.WeaponArsenal)        {
            return;
        }

        // Update the progress
        var updatedAchievement = achievement.Value;
        updatedAchievement.Progress = progress;

        // Check if completed
        if (updatedAchievement.Progress >= updatedAchievement.Target)
        {
            updatedAchievement.IsCompleted = true;
            Log.Info($"Player {identity} has completed achievement: {achievementType}!");
        }

        // Update the achievement in the database
        ctx.Db.achievements.AchievementsId.Update(updatedAchievement);
        Log.Info($"Set achievement {achievementType} for player {identity}: Progress={updatedAchievement.Progress}/{updatedAchievement.Target}");
    }

    // Helper method to create a player achievement from the blueprint
    private static void CreatePlayerAchievementFromBlueprint(ReducerContext ctx, SpacetimeDB.Identity identity, AchievementType achievementType, uint initialProgress = 0)
    {
        var blueprint = AchievementBlueprints.GetBlueprint(achievementType);
        if (blueprint.Equals(default)) // Should not happen if GetBlueprint throws on not found
        {
            Log.Error($"Achievement blueprint for {achievementType} not found!");
            return;
        }

        // Generate a new unique ID for this achievement
        uint newId = GetNextAchievementId(ctx);

        // Create a copy for the player
        var playerAchievement = new AchievementDefinition
        {
            AchievementsId = newId,
            accountIdentity = identity,
            AchievementTypeType = achievementType,
            TitleKey = blueprint.TitleKey,
            DescriptionKey = blueprint.DescriptionKey,
            SpritePath = blueprint.SpritePath,
            Progress = initialProgress,
            Target = blueprint.Target,
            IsCompleted = initialProgress >= blueprint.Target
        };

        // Insert the player achievement
        ctx.Db.achievements.Insert(playerAchievement);

        Log.Info($"Created achievement {achievementType} for player {identity}: Progress={initialProgress}/{playerAchievement.Target}");

        if (playerAchievement.IsCompleted)
        {
            Log.Info($"Player {identity} completed the {achievementType} achievement upon creation!");
        }
    }
    // Removed CreatePlayerAchievementFromTemplate as it's replaced by CreatePlayerAchievementFromBlueprint
}