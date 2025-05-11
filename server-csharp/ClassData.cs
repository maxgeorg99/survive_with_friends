using SpacetimeDB;
using System;

public static partial class Module
{
    [Table(Name = "class_data", Public = true)]
    public partial class ClassData
    {
        [PrimaryKey]
        public uint ClassId;
        
        public PlayerClass PlayerClass;
        
        // Base stats for this class
        public int MaxHp;
        public int Armor;
        public float Speed;
        
        // Starting attack for this class
        public AttackType StartingAttackType;
        
        // Constructor with required fields
        public ClassData(PlayerClass playerClass, int maxHp, int armor, float speed, AttackType startingAttackType)
        {
            ClassId = (uint)playerClass;
            PlayerClass = playerClass;
            MaxHp = maxHp;
            Armor = armor;
            Speed = speed;
            StartingAttackType = startingAttackType;
        }
        
        // Default constructor required by SpacetimeDB
        public ClassData() { }
    }
    
    // Initialize class data with default values for each class
    private static void InitializeClassData(ReducerContext ctx)
    {
        Log.Info("Initializing class data...");
        
        // Clear any existing class data
        foreach (var classData in ctx.Db.class_data.Iter())
        {
            ctx.Db.class_data.ClassId.Delete(classData.ClassId);
        }
        
        // Til (Fighter class) - Football Player
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Fighter,
            PlayerClass = PlayerClass.Fighter,
            MaxHp = 120,
            Armor = 2,
            Speed = 200.0f,
            StartingAttackType = AttackType.Football
        });
        
        // Marc (Rogue class) - Yu-Gi-Oh Player
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Rogue,
            PlayerClass = PlayerClass.Rogue,
            MaxHp = 90,
            Armor = 0,
            Speed = 220.0f,
            StartingAttackType = AttackType.Cards
        });
        
        // Max (Mage class) - Bodybuilder
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Mage,
            PlayerClass = PlayerClass.Mage,
            MaxHp = 150,
            Armor = 3,
            Speed = 180.0f,
            StartingAttackType = AttackType.Dumbbell
        });
        
        // Chris (Paladin class) - Chef
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Paladin,
            PlayerClass = PlayerClass.Paladin,
            MaxHp = 100,
            Armor = 1,
            Speed = 200.0f,
            StartingAttackType = AttackType.Shield
        });

        // Til (Football class)
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Football,
            PlayerClass = PlayerClass.Football,
            MaxHp = 130,
            Armor = 3,
            Speed = 210.0f,
            StartingAttackType = AttackType.Football
        });

        // Yu-gi-oh Marc (Gambler class)
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Gambler,
            PlayerClass = PlayerClass.Gambler,
            MaxHp = 90,
            Armor = 0,
            Speed = 220.0f,
            StartingAttackType = AttackType.Cards
        });

        // Gym Max (Athlete class)
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Athlete,
            PlayerClass = PlayerClass.Athlete,
            MaxHp = 110,
            Armor = 1,
            Speed = 230.0f,
            StartingAttackType = AttackType.Dumbbell
        });

        // Chef Chris (Gourmand class)
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Gourmand,
            PlayerClass = PlayerClass.Gourmand,
            MaxHp = 120,
            Armor = 2,
            Speed = 200.0f,
            StartingAttackType = AttackType.Garlic
        });
        
        Log.Info("Class data initialization complete.");
    }
    
    // Helper method to schedule an attack for a player
    private static void ScheduleAttack(ReducerContext ctx, uint playerId, AttackType attackType)
    {
        Log.Info($"Scheduling attack of type {attackType} for player {playerId}");
        
        // Call the existing ScheduleNewPlayerAttack method from Attacks.cs
        ScheduleNewPlayerAttack(ctx, playerId, attackType);
    }
}