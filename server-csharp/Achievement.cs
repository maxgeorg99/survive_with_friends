using SpacetimeDB;
using System;
using System.Collections.Generic; // Required for Dictionary
using System.Linq; // Required for Any() if used elsewhere, though not in this snippet directly

public static partial class Module {
[SpacetimeDB.Type]
public enum AchievementType
{
    SlimeSlayer, //kill 100 slimes
    RatSlayer, //kill 100 rats
    WormSlayer, //kill 100 worms
    ScorpionSlayer, //kill 100 scorpions
    OrcHunter, //kill 100 orcs
    WolfHunter, //kill 100 wolfs
    DefeatJorge, //kill jorge
    DefeatBjörn, //kill björn
    DefeatSimon, //kill simon
    WeaponArsenal, //Have 5 different weapons
    Expert, //reach level 10
    Survivor //win the game
}

[Table(Name = "achievements", Public = true)]
public partial struct AchievementDefinition
{
    [PrimaryKey, AutoInc]
    public uint AchievementsId;

    [SpacetimeDB.Index.BTree]
    public Identity accountIdentity; // This will now always be a player's identity
    public AchievementType AchievementTypeType;
    public string TitleKey;         // Localization key for title
    public string DescriptionKey;   // Localization key for description
    public string SpritePath;
    public uint Progress;       // e.g. 87 slimes killed
    public uint Target;         // e.g. 100 slimes needed

    public bool IsCompleted;    // true if progress >= target
    public AchievementDefinition() { 
        // Initialize non-nullable string fields to empty strings 
        // as SpacetimeDB structs might require a parameterless constructor.
        // These will be properly set when an achievement is actually created.
        TitleKey = "";
        DescriptionKey = "";
        SpritePath = "";
        // Other fields have default values (0, false, null for Identity)
    }
}

public static class AchievementBlueprints
{
    private static readonly Dictionary<AchievementType, (string TitleKey, string DescriptionKey, string SpritePath, uint Target)> Blueprints = new()
    {
        { AchievementType.SlimeSlayer, ("achievement.SlimeSlayer.title", "achievement.SlimeSlayer.description", "assets/monster_slime.png", 100) },
        { AchievementType.RatSlayer, ("achievement.RatSlayer.title", "achievement.RatSlayer.description", "assets/monster_rat.png", 100) },
        { AchievementType.WormSlayer, ("achievement.WormSlayer.title", "achievement.WormSlayer.description", "assets/monster_worm.png", 100) },
        { AchievementType.ScorpionSlayer, ("achievement.ScorpionSlayer.title", "achievement.ScorpionSlayer.description", "assets/monster_scorpion.png", 100) },
        { AchievementType.OrcHunter, ("achievement.OrcHunter.title", "achievement.OrcHunter.description", "assets/monster_orc.png", 100) },
        { AchievementType.WolfHunter, ("achievement.WolfHunter.title", "achievement.WolfHunter.description", "assets/monster_wolf.png", 100) },
        { AchievementType.DefeatJorge, ("achievement.DefeatJorge.title", "achievement.DefeatJorge.description", "assets/final_boss_jorge_phase_1.png", 1) },
        { AchievementType.DefeatBjörn, ("achievement.DefeatBjörn.title", "achievement.DefeatBjörn.description", "assets/final_boss_phase_björn_1.png", 1) },
        { AchievementType.DefeatSimon, ("achievement.DefeatSimon.title", "achievement.DefeatSimon.description", "assets/final_boss_simon_phase_1.png", 1) },
        { AchievementType.WeaponArsenal, ("achievement.WeaponArsenal.title", "achievement.WeaponArsenal.description", "assets/attack_sword.png", 5) },
        { AchievementType.Expert, ("achievement.Expert.title", "achievement.Expert.description", "assets/gem_4.png", 10) },
        { AchievementType.Survivor, ("achievement.Survivor.title", "achievement.Survivor.description", "assets/achievement_crown.png", 1) }
    };

    public static (string TitleKey, string DescriptionKey, string SpritePath, uint Target) GetBlueprint(AchievementType type)
    {
        if (Blueprints.TryGetValue(type, out var blueprint))
        {
            return blueprint;
        }
        // Should not happen if all AchievementTypes are in the dictionary
        throw new ArgumentException($"No blueprint defined for achievement type: {type}");
    }
}

// Removed InitAchievementData method as it's no longer needed.
// The AchievementBlueprints class now serves as the source for achievement definitions.
}