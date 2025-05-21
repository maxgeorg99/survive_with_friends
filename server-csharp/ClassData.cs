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
        
        // Insert Fighter class data
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Fighter,
            PlayerClass = PlayerClass.Fighter,
            MaxHp = 100000,
            Armor = 12,
            Speed = 200.0f,
            StartingAttackType = AttackType.Sword
        });
        
        // Insert Rogue class data
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Rogue,
            PlayerClass = PlayerClass.Rogue,
            MaxHp = 100000,
            Armor = 12,
            Speed = 200.0f,
            StartingAttackType = AttackType.Knives
        });
        
        // Insert Mage class data
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Mage,
            PlayerClass = PlayerClass.Mage,
            MaxHp = 100000,
            Armor = 12,
            Speed = 200.0f,
            StartingAttackType = AttackType.Wand
        });
        
        // Insert Paladin class data
        ctx.Db.class_data.Insert(new ClassData 
        {
            ClassId = (uint)PlayerClass.Paladin,
            PlayerClass = PlayerClass.Paladin,
            MaxHp = 100,
            Armor = 1,
            Speed = 200.0f,
            StartingAttackType = AttackType.Shield
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