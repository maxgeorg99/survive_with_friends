use spacetimedb::{table, reducer, Table, ReducerContext, SpacetimeType, rand::Rng};

// Curse type enum defining all possible curse effects
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CurseType {
    // Monster enhancements
    MonsterMoreHp,
    MonsterMoreDamage,
    MonsterMoreSpeed,
    MonsterHealthRegen,
    CursedMonstersSpawn,
    
    // Player restrictions
    NoFreeReroll,
    NoHealOnLevelUp,
    NegativeHealthRegen,
    PlayersStartLessHp,
    PlayersStartLessSpeed,
    
    // Loot restrictions
    NoDiceDrops,
    NoFoodDrops,
    NoBoosterPackDrops,
    NoStructureLoot,
    OneLessVoidChest,
    OneLessVoidChestSecond, // Second instance since there are 2 of these
    MonstersDropFewerGems,
    
    // Game progression
    BossAppearsSooner,
    DeadlierBosses,
    DeadlierBossesTwo,   // Multiple stages of deadlier bosses
    
    // Scaling curse when all others are taken
    Scaling,
}

// Curses table to track active curses
#[table(name = curses, public)]
pub struct Curse {
    #[primary_key]
    #[auto_inc]
    pub curse_id: u64,
    pub curse_type: CurseType,
}

// Helper function to add a random new curse on victory
pub fn add_random_curse(ctx: &ReducerContext) {
    log::info!("Adding random curse after victory...");
    
    // Get all existing curse types
    let existing_curses: std::collections::HashSet<CurseType> = ctx.db.curses()
        .iter()
        .map(|curse| curse.curse_type.clone())
        .collect();
    
    log::info!("Found {} existing curses", existing_curses.len());
    
    // Define all possible curse types (excluding Scaling)
    let all_curse_types = vec![
        CurseType::MonsterMoreHp,
        CurseType::MonsterMoreDamage,
        CurseType::MonsterMoreSpeed,
        CurseType::MonsterHealthRegen,
        CurseType::CursedMonstersSpawn,
        CurseType::NoFreeReroll,
        CurseType::NoHealOnLevelUp,
        CurseType::NegativeHealthRegen,
        CurseType::PlayersStartLessHp,
        CurseType::PlayersStartLessSpeed,
        CurseType::NoDiceDrops,
        CurseType::NoFoodDrops,
        CurseType::NoBoosterPackDrops,
        CurseType::NoStructureLoot,
        CurseType::OneLessVoidChest,
        CurseType::OneLessVoidChestSecond,
        CurseType::MonstersDropFewerGems,
        CurseType::BossAppearsSooner,
        CurseType::DeadlierBosses,
        CurseType::DeadlierBossesTwo
    ];
    
    // Find available curse types (not yet taken)
    let available_curses: Vec<CurseType> = all_curse_types
        .into_iter()
        .filter(|curse_type| !existing_curses.contains(curse_type))
        .collect();
    
    let selected_curse = if available_curses.is_empty() {
        // All regular curses are taken, add scaling curse
        log::info!("All curse types are taken, adding Scaling curse");
        CurseType::Scaling
    } else {
        // Randomly select from available curses
        let mut rng = ctx.rng();
        let index = rng.gen_range(0..available_curses.len());
        let selected = available_curses[index].clone();
        log::info!("Selected curse: {:?} from {} available options", selected, available_curses.len());
        selected
    };
    
    // Add the curse to the table
    ctx.db.curses().insert(Curse {
        curse_id: 0, // Auto-incremented
        curse_type: selected_curse.clone(),
    });
    
    log::info!("Added curse: {:?}", selected_curse);
    
    // Log current total curse count
    let total_curses = ctx.db.curses().count();
    log::info!("Total active curses: {}", total_curses);
}

// Helper function to clear all curses on defeat
pub fn clear_all_curses(ctx: &ReducerContext) {
    log::info!("Clearing all curses after defeat...");
    
    let curse_count = ctx.db.curses().count();
    if curse_count == 0 {
        log::info!("No curses to clear");
        return;
    }
    
    // Delete all curses
    let curses_to_delete: Vec<u64> = ctx.db.curses().iter().map(|curse| curse.curse_id).collect();
    for curse_id in curses_to_delete {
        ctx.db.curses().curse_id().delete(&curse_id);
    }
    
    log::info!("Cleared {} curses", curse_count);
}

// Admin reducer to manually add a curse (as if players won)
#[reducer]
pub fn admin_add_curse(ctx: &ReducerContext) {
    crate::require_admin_access(ctx, "AdminAddCurse");
    
    log::info!("Admin manually adding curse");
    add_random_curse(ctx);
}

// Admin reducer to clear all curses
#[reducer]
pub fn admin_clear_curses(ctx: &ReducerContext) {
    crate::require_admin_access(ctx, "AdminClearCurses");
    
    log::info!("Admin manually clearing all curses");
    clear_all_curses(ctx);
}
