use spacetimedb::{table, reducer, Table, ReducerContext, SpacetimeType, rand::Rng};
use crate::monsters;

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
    
    // Start monster health regeneration if needed
    start_monster_health_regen_if_needed(ctx);
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

// Helper function to check if a specific curse type is currently active
pub fn is_curse_active(ctx: &ReducerContext, target_curse_type: CurseType) -> bool {
    for curse in ctx.db.curses().iter() {
        if curse.curse_type == target_curse_type {
            return true;
        }
    }
    false
}

// Admin reducer to manually add a curse (as if players won)
#[reducer]
pub fn admin_add_curse(ctx: &ReducerContext) {
    crate::require_admin_access(ctx, "AdminAddCurse");
    
    log::info!("Admin manually adding curse");
    add_random_curse(ctx);
    
    // Note: start_monster_health_regen_if_needed is already called within add_random_curse
}

// Admin reducer to clear all curses
#[reducer]
pub fn admin_clear_curses(ctx: &ReducerContext) {
    crate::require_admin_access(ctx, "AdminClearCurses");
    
    log::info!("Admin manually clearing all curses");
    clear_all_curses(ctx);
}

// Admin reducer to add a specific curse from debug list (for testing)
#[reducer]
pub fn admin_add_debug_curse(ctx: &ReducerContext) {
    crate::require_admin_access(ctx, "AdminAddDebugCurse");
    
    // Hardcoded list of curses for testing - starting with NegativeHealthRegen
    let debug_curses = vec![
        CurseType::NegativeHealthRegen,
        CurseType::NoHealOnLevelUp,
        CurseType::NoFreeReroll,
        CurseType::CursedMonstersSpawn,
        // Add more curses here as needed for testing
    ];
    
    log::info!("Admin adding debug curse from test list...");
    
    // Try to find a curse from the list that isn't already active
    let mut curse_to_add: Option<CurseType> = None;
    
    for curse_type in &debug_curses {
        if !is_curse_active(ctx, curse_type.clone()) {
            curse_to_add = Some(curse_type.clone());
            break;
        }
    }
    
    match curse_to_add {
        Some(curse_type) => {
            // Add the specific curse
            let curse = ctx.db.curses().insert(Curse {
                curse_id: 0,
                curse_type: curse_type.clone(),
            });
            
            log::info!("Admin added debug curse: {:?} (ID: {})", curse_type, curse.curse_id);
            
            // Log current total curse count
            let total_curses = ctx.db.curses().count();
            log::info!("Total active curses: {}", total_curses);
            
            // Start monster health regeneration if needed
            start_monster_health_regen_if_needed(ctx);
        },
        None => {
            log::info!("Admin debug curse: All test curses are already active!");
            
            // Log which curses are currently active
            let active_curses: Vec<CurseType> = ctx.db.curses().iter().map(|curse| curse.curse_type).collect();
            log::info!("Currently active curses: {:?}", active_curses);
        }
    }
}

// Monster health regeneration system
#[table(name = monster_health_regen_timer, scheduled(monster_health_regen_tick), public)]
pub struct MonsterHealthRegenTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

// Reducer to handle monster health regeneration
#[reducer]
pub fn monster_health_regen_tick(ctx: &ReducerContext, _timer: MonsterHealthRegenTimer) {
    if ctx.sender != ctx.identity() {
        panic!("MonsterHealthRegenTick may not be invoked by clients, only via scheduling.");
    }
    
    // Only regenerate if the MonsterHealthRegen curse is active
    if !is_curse_active(ctx, CurseType::MonsterHealthRegen) {
        return;
    }
    
    const REGEN_AMOUNT: u32 = 1; // HP to regenerate per tick
    
    // Iterate through all living monsters and regenerate their health
    let monsters_to_update: Vec<_> = ctx.db.monsters().iter().collect();
    
    for monster in monsters_to_update {
        if monster.hp < monster.max_hp {
            let mut updated_monster = monster;
            updated_monster.hp = (updated_monster.hp + REGEN_AMOUNT).min(updated_monster.max_hp);
            ctx.db.monsters().monster_id().update(updated_monster);
        }
    }
    
    // Schedule the next regeneration tick
    schedule_monster_health_regen(ctx);
}

// Helper function to schedule monster health regeneration
pub fn schedule_monster_health_regen(ctx: &ReducerContext) {
    use std::time::Duration;
    
    // Schedule regeneration every 2 seconds
    ctx.db.monster_health_regen_timer().insert(MonsterHealthRegenTimer {
        scheduled_id: 0,
        scheduled_at: spacetimedb::ScheduleAt::Time(ctx.timestamp + Duration::from_millis(2000)),
    });
}

// Function to start monster health regeneration when curse becomes active
pub fn start_monster_health_regen_if_needed(ctx: &ReducerContext) {
    if is_curse_active(ctx, CurseType::MonsterHealthRegen) {
        // Check if there's already a regen timer scheduled
        let existing_timer_count = ctx.db.monster_health_regen_timer().count();
        if existing_timer_count == 0 {
            log::info!("Starting monster health regeneration due to active curse");
            schedule_monster_health_regen(ctx);
        }
    }
}
