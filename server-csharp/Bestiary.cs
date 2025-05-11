using SpacetimeDB;

public static partial class Module
{
    [SpacetimeDB.Type]
    public enum MonsterType
    {
        Rat,
        Slime,
        Orc,
        FinalBossPhase1,
        FinalBossPhase2
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
            speed = 80.0f,
            exp = 1,
            atk = 1.0f,
            radius = 24.0f
        });

        // Insert Slime stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.Slime,
            monster_type = MonsterType.Slime,
            max_hp = 25,
            speed = 50.0f,
            exp = 2,
            atk = 1.5f,
            radius = 30.0f
        });

        // Insert Orc stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.Orc,
            monster_type = MonsterType.Orc,
            max_hp = 50,
            speed = 70.0f, 
            exp = 5,
            atk = 2.0f,
            radius = 40.0f
        });
        
        // Insert Final Boss Phase 1 stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.FinalBossPhase1,
            monster_type = MonsterType.FinalBossPhase1,
            max_hp = 500,
            speed = 100.0f,
            exp = 100,
            atk = 10.0f,
            radius = 92.0f
        });
        
        // Insert Final Boss Phase 2 stats
        ctx.Db.bestiary.Insert(new Bestiary
        {
            bestiary_id = (uint)MonsterType.FinalBossPhase2,
            monster_type = MonsterType.FinalBossPhase2,
            max_hp = 500,
            speed = 130.0f,
            exp = 500,
            atk = 12.0f,
            radius = 128.0f
        });

        Log.Info("Bestiary initialization complete");
    }
    
}