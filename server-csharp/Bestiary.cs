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

    [SpacetimeDB.Table(Name = "bestiary")]
    public partial struct Bestiary
    {
        [PrimaryKey]
        public uint bestiary_id;
        
        public MonsterType monster_type;
        
        // monster attributes
        public uint max_hp;
        public float speed;
        public uint exp;
        public float atk;  // monster attack power (damage per tick)
        public float radius; // monster size/hitbox radius
    }

    // Initialize the bestiary with default stats for each monster type
    public static void InitBestiary(ReducerContext ctx)
    {
        Log.Info("Initializing bestiary...");
        
        // Only initialize if the bestiary is empty
        if (ctx.Db.bestiary.Count > 0)
        {
            Log.Info("Bestiary already initialized, skipping");
            return;
        }

        // Insert Rat stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.Rat,
            monster_type = MonsterType.Rat,
            max_hp = 10,
            speed = 1.5f,
            exp = 1,
            atk = 0.1f,
            radius = 24.0f
        });

        // Insert Slime stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.Slime,
            monster_type = MonsterType.Slime,
            max_hp = 25,
            speed = 0.8f,
            exp = 2,
            atk = 0.5f,
            radius = 30.0f
        });

        // Insert Orc stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.Orc,
            monster_type = MonsterType.Orc,
            max_hp = 50,
            speed = 1.0f,
            exp = 5,
            atk = 1.0f,
            radius = 40.0f
        });

        Log.Info("Bestiary initialization complete");
    }
    
}