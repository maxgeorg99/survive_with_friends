use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};
use crate::MonsterType;

#[table(name = bestiary, public)]
pub struct Bestiary {
    #[primary_key]
    pub bestiary_id: u32,
    
    pub monster_type: MonsterType,
    pub tier: u32,
    
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
        tier: 0,
        max_hp: 10,
        speed: 80.0,
        atk: 1.0,
        radius: 24.0,
    });

    // Insert Slime stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Slime as u32,
        monster_type: MonsterType::Slime,
        tier: 1,
        max_hp: 25,
        speed: 50.0,
        atk: 1.5,
        radius: 30.0,
    });

    // Insert Orc stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Orc as u32,
        monster_type: MonsterType::Orc,
        tier: 3,
        max_hp: 50,
        speed: 70.0,
        atk: 2.0,
        radius: 40.0,
    });
    
    // Insert Final Boss Phase 1 stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::BossEnderPhase1 as u32,
        monster_type: MonsterType::BossEnderPhase1,
        tier: 5,
        max_hp: 500,
        speed: 100.0,
        atk: 9.0,
        radius: 92.0,
    });
    
    // Insert Final Boss Phase 2 stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::BossEnderPhase2 as u32,
        monster_type: MonsterType::BossEnderPhase2,
        tier: 5,
        max_hp: 500,
        speed: 120.0,
        atk: 12.0,
        radius: 128.0,
    });

    // Insert VoidChest stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::VoidChest as u32,
        monster_type: MonsterType::VoidChest,
        tier: 0,
        max_hp: 200,
        speed: 0.0,
        atk: 0.0,
        radius: 82.0,
    });

    // Insert Imp stats - fast, magical creature with low-medium HP
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Imp as u32,
        monster_type: MonsterType::Imp,
        tier: 4,
        max_hp: 18,        // Low-medium HP (between Rat and Slime)
        speed: 50.0,       // Fast (faster than Rat)
        atk: 1.0,          // Medium attack
        radius: 34.0,      // Small radius (slightly larger than Rat)
    });

    // Insert Zombie stats - slow, tanky creature with high HP
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Zombie as u32,
        monster_type: MonsterType::Zombie,
        tier: 5,
        max_hp: 80,        // High HP (between Slime and Orc)
        speed: 54.0,       // Very slow (slower than Slime)
        atk: 4.0,          // High attack (slightly higher than Orc)
        radius: 42.0,      // Medium-large radius (between Slime and Orc)
    });

    // Insert EnderClaw stats - tough, quick, high damage boss minion
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::EnderClaw as u32,
        monster_type: MonsterType::EnderClaw,
        tier: 1,
        max_hp: 75,        // High HP (slightly less than Zombie but still tough)
        speed: 140.0,      // Very fast (faster than Phase 2 boss)
        atk: 5.0,          // Very high attack (higher than Zombie)
        radius: 44.0,      // Medium radius (similar to Orc)
    });

    // Insert Bat stats - fast, small, bit damaging but not tough
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Bat as u32,
        monster_type: MonsterType::Bat,
        tier: 2,
        max_hp: 15,         // Low HP (even lower than Rat)
        speed: 120.0,       // Fast (faster than Rat but not as fast as bosses)  
        atk: 1.8,          // Moderate attack (between Rat and Slime)
        radius: 28.0,      // Small radius (smaller than Rat)
    });

    // Insert Agna Boss Phase 1 stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::BossAgnaPhase1 as u32,
        monster_type: MonsterType::BossAgnaPhase1,
        tier: 5,
        max_hp: 500,       // Slightly less HP than Ender Phase 1
        speed: 90.0,       // Slightly slower than Ender Phase 1
        atk: 8.5,          // Slightly less attack than Ender Phase 1
        radius: 88.0,      // Slightly smaller than Ender Phase 1
    });
    
    // Insert Agna Boss Phase 2 stats
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::BossAgnaPhase2 as u32,
        monster_type: MonsterType::BossAgnaPhase2,
        tier: 5,
        max_hp: 500,       
        speed: 110.0,      
        atk: 15.0,         
        radius: 128.0,     
    });

    // Insert Agna Candle stats - stationary ritual candles
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::AgnaCandle as u32,
        monster_type: MonsterType::AgnaCandle,
        tier: 3,
        max_hp: 40,        // Medium HP (destructible but not too easy)
        speed: 0.0,        // Stationary (no movement)
        atk: 0.0,          // No melee attack (only ranged bolts)
        radius: 32.0,      // Medium radius for collision
    });

    // Insert Crate stats - common breakable structure
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Crate as u32,
        monster_type: MonsterType::Crate,
        tier: 0,
        max_hp: 30,        // Moderate HP - easier to break than other structures
        speed: 0.0,        // Stationary (no movement)
        atk: 0.0,          // No attack
        radius: 48.0,      // Medium radius for collision
    });

    // Insert Tree stats - sturdy natural structure
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Tree as u32,
        monster_type: MonsterType::Tree,
        tier: 0,
        max_hp: 150,       // High HP - requires effort to destroy
        speed: 0.0,        // Stationary (no movement)
        atk: 0.0,          // No attack
        radius: 50.0,     // Large radius for collision (trees are big)
    });

    // Insert Statue stats - durable ancient structure
    ctx.db.bestiary().insert(Bestiary {
        bestiary_id: MonsterType::Statue as u32,
        monster_type: MonsterType::Statue,
        tier: 0,
        max_hp: 500,       // Very high HP - hardest structure to destroy
        speed: 0.0,        // Stationary (no movement)
        atk: 0.0,          // No attack
        radius: 58.0,      // Largest radius for collision
    });

    log::info!("Bestiary initialization complete");
} 