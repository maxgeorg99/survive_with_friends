use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};
use crate::MonsterType;

#[table(name = bestiary, public)]
pub struct Bestiary {
    #[primary_key]
    pub bestiary_id: u32,
    
    pub monster_type: MonsterType,
    
    // monster attributes
    pub max_hp: u32,
    pub speed: f32,
    pub atk: f32,  // monster attack power (damage per tick)
    pub radius: f32, // monster size/hitbox radius
}

// Initialize the bestiary with default stats for each monster type
pub fn init_bestiary(ctx: &ReducerContext) {
    log::info!("Initializing bestiary...");
    
    // Only initialize if the bestiary is empty
    if ctx.db.bestiary().count() > 0 {
        log::info!("Bestiary already initialized, skipping");
        return;
    }

    // Insert Rat stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Rat as u32,
        monster_type: MonsterType::Rat,
        max_hp: 10,
        speed: 80.0,
        atk: 1.0,
        radius: 24.0,
    });

    // Insert Slime stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Slime as u32,
        monster_type: MonsterType::Slime,
        max_hp: 25,
        speed: 50.0,
        atk: 1.5,
        radius: 30.0,
    });

    // Insert Orc stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Orc as u32,
        monster_type: MonsterType::Orc,
        max_hp: 50,
        speed: 70.0,
        atk: 2.0,
        radius: 40.0,
    });
    
    // Insert Final Boss Phase 1 stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::FinalBossPhase1 as u32,
        monster_type: MonsterType::FinalBossPhase1,
        max_hp: 500,
        speed: 100.0,
        atk: 10.0,
        radius: 92.0,
    });
    
    // Insert Final Boss Phase 2 stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::FinalBossPhase2 as u32,
        monster_type: MonsterType::FinalBossPhase2,
        max_hp: 500,
        speed: 130.0,
        atk: 12.0,
        radius: 128.0,
    });

    // Insert VoidChest stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::VoidChest as u32,
        monster_type: MonsterType::VoidChest,
        max_hp: 200,
        speed: 0.0,
        atk: 0.0,
        radius: 82.0,
    });

    log::info!("Bestiary initialization complete");
} 