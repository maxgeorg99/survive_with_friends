using SpacetimeDB;

public static partial class Module
{
    [SpacetimeDB.Type]
    public enum MonsterType
    {
        Rat,
        Slime,
        Orc
    }

    [SpacetimeDB.Table(Name = "Bestiary")]
    public partial struct Bestiary
    {
        [PrimaryKey]
        public uint BestiaryId;
        
        public MonsterType MonsterType;
        
        // monster attributes
        public uint MaxHp;
        public float Speed;
        public uint Exp;
        public float Atk;  // monster attack power (damage per tick)
        public float Radius; // monster size/hitbox radius
    }

    // Initialize the bestiary with default stats for each monster type
    public static void InitBestiary(ReducerContext ctx)
    {
        Log.Info("Initializing bestiary...");
        
        // Only initialize if the bestiary is empty
        if (ctx.Db.Bestiary.Count > 0)
        {
            Log.Info("Bestiary already initialized, skipping");
            return;
        }

        // Insert Rat stats
        ctx.Db.Bestiary.Insert(new Bestiary
        {
            BestiaryId = (uint)MonsterType.Rat,
            MonsterType = MonsterType.Rat,
            MaxHp = 10,
            Speed = 160.0f,
            Exp = 1,
            Atk = 0.1f,
            Radius = 24.0f
        });

        // Insert Slime stats
        ctx.Db.Bestiary.Insert(new Bestiary
        {
            BestiaryId = (uint)MonsterType.Slime,
            MonsterType = MonsterType.Slime,
            MaxHp = 25,
            Speed = 100.0f,
            Exp = 2,
            Atk = 0.5f,
            Radius = 30.0f
        });

        // Insert Orc stats
        ctx.Db.Bestiary.Insert(new Bestiary
        {
            BestiaryId = (uint)MonsterType.Orc,
            MonsterType = MonsterType.Orc,
            MaxHp = 50,
            Speed = 140.0f, 
            Exp = 5,
            Atk = 1.0f,
            Radius = 40.0f
        });

        Log.Info("Bestiary initialization complete");
    }
    
}