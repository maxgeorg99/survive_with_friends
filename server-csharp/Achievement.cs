using SpacetimeDB;
using System;

public static partial class Module {
[SpacetimeDB.Type]
public enum AchievementType
{
    SlimeSlayer, //kill 100 slimes
    RatSlayer, //kill 100 rats
    WormSlayer, //kill 100 worms
    ScorpionSlayer, //kill 100 scorpions
    OrcHunter, //kill 100 orcs
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
    [PrimaryKey]
    public uint AchievementsId;

    [SpacetimeDB.Index.BTree]
    public uint player_id;
    public AchievementType AchievementTypeType;
    public string TitleKey;         // Localization key for title
    public string DescriptionKey;   // Localization key for description
    public string SpritePath;
    public uint Progress;       // e.g. 87 slimes killed
    public uint Target;         // e.g. 100 slimes needed

    public bool IsCompleted;    // true if progress >= target
    public AchievementDefinition() { }
}

    public static void InitAchievementData(ReducerContext ctx)
    {
        // Only run if achievement data table is empty
        if (ctx.Db.achievements.Iter().Any())
        {
            return;
        }

        Log.Info("Initializing achievement data...");

        // SlimeSlayer achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 1,
            player_id = 0, // 0 means it's a template, not assigned to a player
            AchievementTypeType = AchievementType.SlimeSlayer,
            TitleKey = "achievement.SlimeSlayer.title",
            DescriptionKey = "achievement.SlimeSlayer.description",
            SpritePath = "assets/monster_slime.png",
            Progress = 0,
            Target = 100,
            IsCompleted = false,
        });

        // RatSlayer achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 2,
            player_id = 0,
            AchievementTypeType = AchievementType.RatSlayer,
            TitleKey = "achievement.RatSlayer.title",
            DescriptionKey = "achievement.RatSlayer.description",
            SpritePath = "assets/monster_rat.png",
            Progress = 0,
            Target = 100,
            IsCompleted = false,
        });

        // WormSlayer achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 3,
            player_id = 0,
            AchievementTypeType = AchievementType.WormSlayer,
            TitleKey = "achievement.WormSlayer.title",
            DescriptionKey = "achievement.WormSlayer.description",
            SpritePath = "assets/monster_worm.png",
            Progress = 0,
            Target = 100,
            IsCompleted = false,
        });

        // ScorpionSlayer achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 4,
            player_id = 0,
            AchievementTypeType = AchievementType.ScorpionSlayer,
            TitleKey = "achievement.ScorpionSlayer.title",
            DescriptionKey = "achievement.ScorpionSlayer.description",
            SpritePath = "assets/monster_scorpion.png",
            Progress = 0,
            Target = 100,
            IsCompleted = false,
        });

        // OrcHunter achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 5,
            player_id = 0,
            AchievementTypeType = AchievementType.OrcHunter,
            TitleKey = "achievement.OrcHunter.title",
            DescriptionKey = "achievement.OrcHunter.description",
            SpritePath = "assets/monster_orc.png",
            Progress = 0,
            Target = 100,
            IsCompleted = false,
        });

        // DefeatJorge achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 6,
            player_id = 0,
            AchievementTypeType = AchievementType.DefeatJorge,
            TitleKey = "achievement.DefeatJorge.title",
            DescriptionKey = "achievement.DefeatJorge.description",
            SpritePath = "assets/final_boss_jorge_phase_1.png",
            Progress = 0,
            Target = 1,
            IsCompleted = false,
        });

        // DefeatBjörn achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 7,
            player_id = 0,
            AchievementTypeType = AchievementType.DefeatBjörn,
            TitleKey = "achievement.DefeatBjörn.title",
            DescriptionKey = "achievement.DefeatBjörn.description",
            SpritePath = "assets/final_boss_phase_björn_1.png",
            Progress = 0,
            Target = 1,
            IsCompleted = false,
        });

        // DefeatSimon achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 8,
            player_id = 0,
            AchievementTypeType = AchievementType.DefeatSimon,
            TitleKey = "achievement.DefeatSimon.title",
            DescriptionKey = "achievement.DefeatSimon.description",
            SpritePath = "assets/final_boss_simon_phase_1.png",
            Progress = 0,
            Target = 1,
            IsCompleted = false,
        });

        // WeaponArsenal achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 9,
            player_id = 0,
            AchievementTypeType = AchievementType.WeaponArsenal,
            TitleKey = "achievement.WeaponArsenal.title",
            DescriptionKey = "achievement.WeaponArsenal.description",
            SpritePath = "assets/attack_sword.png", // Using a representative weapon image
            Progress = 0,
            Target = 5,
            IsCompleted = false,
        });

        // Expert achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 10,
            player_id = 0,
            AchievementTypeType = AchievementType.Expert,
            TitleKey = "achievement.Expert.title",
            DescriptionKey = "achievement.Expert.description",
            SpritePath = "assets/gem_4.png", // Using a gem as level representation
            Progress = 0,
            Target = 10,
            IsCompleted = false,
        });

        // Survivor achievement
        ctx.Db.achievements.Insert(new AchievementDefinition
        {
            AchievementsId = 11,
            player_id = 0,
            AchievementTypeType = AchievementType.Survivor,
            TitleKey = "achievement.Survivor.title",
            DescriptionKey = "achievement.Survivor.description",
            SpritePath = "assets/achievement_crown.png", // Using the most valuable gem to represent winning
            Progress = 0,
            Target = 1,
            IsCompleted = false,
        });

        Log.Info("Achievement data initialized successfully.");
    }
}