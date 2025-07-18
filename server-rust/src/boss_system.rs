use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, player, config, monster_spawners, bestiary, monsters, monsters_boid, entity, gems, dead_players, monster_spawn_timer,
    active_attacks, attack_burst_cooldowns, player_scheduled_attacks};
use std::time::Duration;

// Boss type enum for selecting which boss to spawn
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BossType {
    Ender = 0,
    Agna = 1,
    Simon = 2,
}

// Game state table to track boss-related information
#[table(name = game_state, public)]
pub struct GameState {
    #[primary_key]
    pub id: u32, // We'll use id=0 for the main game state
    
    pub boss_active: bool, // Whether a boss is currently active
    pub boss_phase: u32, // 0 = no boss, 1 = phase 1, 2 = phase 2
    pub boss_monster_id: u32, // ID of the current boss monster
    pub boss_type: BossType, // Which boss type is currently selected
    pub normal_spawning_paused: bool, // Whether normal monster spawning is paused
    pub game_start_time: Timestamp, // When the current game session started
}

// Timer for boss spawn (scheduled every 5 minutes)
#[table(name = boss_spawn_timer, scheduled(spawn_boss_phase_one), public)]
pub struct BossSpawnTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub session_start_time: Timestamp, // When this timer was created (session start)
}

// Timer for delayed boss phase 2 spawn (to allow pre-transform VFX)
#[table(name = boss_phase_two_timer, scheduled(spawn_boss_phase_two_delayed), public)]
pub struct BossPhase2Timer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub position: DbVector2,
    pub scheduled_at: ScheduleAt,
}

// Boss selection table to store the chosen boss type
#[table(name = boss_selection, public)]
pub struct BossSelection {
    #[primary_key]
    pub id: u32, // We'll use id=0 for the main boss selection
    
    pub boss_type: BossType, // Which boss type is selected
}

// Initialize the game state
pub fn init_game_state(ctx: &ReducerContext) {
    log::info!("Initializing game state...");
    
    // Only initialize if the state is empty
    if ctx.db.game_state().count() > 0 {
        log::info!("Game state already exists, skipping");
        return;
    }

    // Insert default game state
    ctx.db.game_state().insert(GameState {
        id: 0,
        boss_active: false,
        boss_phase: 0,
        boss_monster_id: 0,
        boss_type: BossType::Ender,
        normal_spawning_paused: false,
        game_start_time: ctx.timestamp, // Set game start time to current timestamp
    });

    log::info!("Game state initialized successfully");
    
    // NOTE: Boss spawn timer is NOT scheduled here on server startup
    // It will be scheduled when the first player spawns (see spawn_player in lib.rs)
    // This prevents the "end of the world counter" from appearing in the class select screen
    // when the server is freshly initialized with no players
}

// Initialize boss selection - will be set randomly when boss spawn is first scheduled
pub fn init_boss_selection(_ctx: &ReducerContext) {
    log::info!("Boss selection will be randomly chosen when boss spawn is first scheduled");
    
    // No need to pre-initialize boss selection anymore
    // It will be randomly selected in schedule_boss_spawn when the first player joins
}

// Schedule the boss to spawn after 5 minutes (or 4.5 minutes with BossAppearsSooner curse)
pub fn schedule_boss_spawn(ctx: &ReducerContext) {
    // Check for BossAppearsSooner curse to reduce boss spawn delay
    let boss_spawn_delay_ms = if crate::curses_defs::is_curse_active(ctx, crate::curses_defs::CurseType::BossAppearsSooner) {
        270_000 // 4.5 minutes when curse is active
    } else {
        300_000 // Normal 5 minutes
    };
    
    let delay_minutes = boss_spawn_delay_ms as f32 / 60_000.0;
    log::info!("Scheduling boss spawn in {:.1} minutes...", delay_minutes);
    
    // Randomly select boss type when first scheduling the boss spawn
    let mut rng = ctx.rng();
    let selected_boss_type = match rng.gen_range(0..3) {
        0 => BossType::Ender,
        1 => BossType::Agna,
        _ => BossType::Simon,
    };
    let boss_name = match selected_boss_type {
        BossType::Ender => "Ender",
        BossType::Agna => "Agna",
        BossType::Simon => "Simon",
    };
    
    log::info!("Randomly selected boss type: {} ({:?})", boss_name, selected_boss_type);
    
    // Update or create boss selection with the randomly chosen boss
    let boss_selection_opt = ctx.db.boss_selection().id().find(&0);
    if let Some(mut selection) = boss_selection_opt {
        selection.boss_type = selected_boss_type;
        ctx.db.boss_selection().id().update(selection);
        log::info!("Updated boss selection to randomly chosen {} ({:?})", boss_name, selected_boss_type);
    } else {
        // Create new selection if it doesn't exist
        ctx.db.boss_selection().insert(BossSelection {
            id: 0,
            boss_type: selected_boss_type,
        });
        log::info!("Created new boss selection with randomly chosen {} ({:?})", boss_name, selected_boss_type);
    }
    
    // Schedule the boss spawn timer
    ctx.db.boss_spawn_timer().insert(BossSpawnTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(boss_spawn_delay_ms)),
        session_start_time: ctx.timestamp,
    });
    
    log::info!("Boss spawn timer scheduled - {} boss will spawn in 5 minutes", boss_name);
    
    // Spawn world structures at the start of a new game session
    log::info!("Initializing world structures for new game session...");
    crate::structure_defs::spawn_world_structures(ctx);
    log::info!("World structure initialization complete");
}

// Called when the boss spawn timer fires
#[reducer]
pub fn spawn_boss_phase_one(ctx: &ReducerContext, _timer: BossSpawnTimer) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer SpawnBossPhaseOne may not be invoked by clients, only via scheduling.");
    }

    log::info!("Boss phase 1 spawn timer triggered!");
    
    // Check if there are any players online
    let player_count = ctx.db.player().count();
    if player_count == 0 {
        log::info!("No players online, not spawning boss. Rescheduling for later.");
        schedule_boss_spawn(ctx);
        return;
    }
    
    // Get game configuration for world size
    let config = ctx.db.config().id().find(&0)
        .expect("SpawnBossPhaseOne: Could not find game configuration!");
    
    // Get game state to update boss status
    let mut game_state = ctx.db.game_state().id().find(&0)
        .expect("SpawnBossPhaseOne: Could not find game state!");
    
    // Update game state to indicate boss is active
    game_state.boss_active = true;
    game_state.boss_phase = 1;
    game_state.normal_spawning_paused = true;
    let boss_type = ctx.db.boss_selection().id().find(&0)
        .map(|selection| selection.boss_type)
        .unwrap_or(BossType::Ender);
    game_state.boss_type = boss_type;
    ctx.db.game_state().id().update(game_state);
    
    // Calculate position at center of map
    let center_x = config.world_size as f32 / 2.0;
    let center_y = config.world_size as f32 / 2.0;
    let center_position = DbVector2::new(center_x, center_y);
    
    // Create a pre-spawner for the boss at the center of map
    
    // Schedule the boss to spawn using the existing monster spawning system
    schedule_boss_spawning(ctx, center_position);
}

// Schedule boss spawning using the existing monster spawning system
fn schedule_boss_spawning(ctx: &ReducerContext, position: DbVector2) {    
    // Use the existing monster spawner system, but for the boss
    const BOSS_SPAWN_VISUALIZATION_DELAY_MS: u64 = 3000; // 3 seconds for pre-spawn animation
    
    // Get the selected boss type
    let boss_selection = ctx.db.boss_selection().id().find(&0)
        .expect("schedule_boss_spawning: Could not find boss selection!");
    
    // Determine which boss type to spawn based on selection
    let boss_monster_type = match boss_selection.boss_type {
        BossType::Ender => MonsterType::BossEnderPhase1,
        BossType::Agna => MonsterType::BossAgnaPhase1,
        BossType::Simon => MonsterType::BossSimonPhase1,
    };
    
    let boss_name = match boss_selection.boss_type {
        BossType::Ender => "Ender",
        BossType::Agna => "Agna",
        BossType::Simon => "Simon",
    };
    
    log::info!("Spawning {} boss (type {:?}) at position ({}, {})", boss_name, boss_selection.boss_type, position.x, position.y);
    
    // Create spawner for the boss
    let spawner_opt = ctx.db.monster_spawners().insert(crate::MonsterSpawners {
        scheduled_id: 0,
        position,
        monster_type: boss_monster_type,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(BOSS_SPAWN_VISUALIZATION_DELAY_MS)),
    });
}

// Called when phase 1 boss is defeated
pub fn spawn_boss_phase_two(ctx: &ReducerContext, position: DbVector2) {
    // Get game state
    let game_state_opt = ctx.db.game_state().id().find(&0)
        .expect("SpawnBossPhaseTwo: Could not find game state!");
    
    // Update game state to indicate phase 2
    let mut game_state = game_state_opt;
    game_state.boss_phase = 2;
    
    log::info!("Game state updated to phase 2");
    
    // Get the selected boss type
    let boss_selection = ctx.db.boss_selection().id().find(&0)
        .expect("SpawnBossPhaseTwo: Could not find boss selection!");
    
    // Determine which boss phase 2 type to spawn based on selection
    let (boss_monster_type, ai_state) = match boss_selection.boss_type {
        BossType::Ender => (MonsterType::BossEnderPhase2, crate::monster_ai_defs::AIState::BossEnderIdle),
        BossType::Agna => (MonsterType::BossAgnaPhase2, crate::monster_ai_defs::AIState::BossAgnaIdle),
        BossType::Simon => (MonsterType::BossSimonPhase2, crate::monster_ai_defs::AIState::BossSimonPhase2Transform),
    };
    
    let boss_name = match boss_selection.boss_type {
        BossType::Ender => "Ender",
        BossType::Agna => "Agna", 
        BossType::Simon => "Simon",
    };
    
    log::info!("Spawning {} Phase 2 boss at position ({}, {})", boss_name, position.x, position.y);
    
    // Get boss stats from bestiary
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(boss_monster_type.clone() as u32))
        .expect("SpawnBossPhaseTwo: Could not find bestiary entry for boss phase 2!");
    
    // Find the closest player to target
    let closest_player_id = crate::monsters_def::get_closest_player(ctx, &position);
    
    // Apply boss stat modification curses for Phase 2 bosses
    let mut final_hp = bestiary_entry.max_hp;
    let mut final_max_hp = bestiary_entry.max_hp;
    let mut final_atk = bestiary_entry.atk;
    let mut final_speed = bestiary_entry.speed;
    
    // Apply DeadlierBosses curse modifications
    if crate::curses_defs::is_curse_active(ctx, crate::curses_defs::CurseType::DeadlierBosses) {
        final_hp = (final_hp as f32 * 2.0) as u32; // 2x HP
        final_max_hp = (final_max_hp as f32 * 2.0) as u32; // Additional 2x max HP
        final_atk *= 1.5; // Additional 1.5x damage
        final_speed *= 1.2; // Additional 1.2x speed
        log::info!("DeadlierBossesTwo curse applied to Phase 2 boss - HP: {}, ATK: {:.1}, Speed: {:.1}", final_hp, final_atk, final_speed);
    }
    
    // Create the phase 2 boss monster
    let monster_opt = ctx.db.monsters().insert(crate::Monsters {
        monster_id: 0,
        bestiary_id: boss_monster_type,
        variant: crate::MonsterVariant::Default,
        hp: final_hp,
        max_hp: final_max_hp,
        atk: final_atk,
        speed: final_speed,
        target_player_id: closest_player_id,
        radius: bestiary_entry.radius,
        spawn_position: position.clone(),
        ai_state,
    });
    
    let monster = monster_opt;

    // Update game state with new boss monster ID
    game_state.boss_monster_id = monster.monster_id;
    game_state.boss_active = true;
    
    let _boid_opt = ctx.db.monsters_boid().insert(crate::MonsterBoid {
        monster_id: monster.monster_id,
        position,
    });
    
    ctx.db.game_state().id().update(game_state);

    // Initialize boss AI based on boss type
    match boss_selection.boss_type {
        BossType::Ender => {
            // Initialize Ender Phase 2 boss AI (BossEnderIdle only, no automatic patterns)
            crate::monster_ai_defs::initialize_phase2_boss_ai(ctx, monster.monster_id);
            
            // Start EnderClaw spawning for Phase 2 boss
            log::info!("Starting EnderClaw spawning for Phase 2 boss {}", monster.monster_id);
            crate::boss_ender_defs::start_ender_claw_spawning(ctx, monster.monster_id);
            
            // Start ChaosBall and VoidZone attacks for Phase 2 boss
            log::info!("Starting ChaosBall and VoidZone attacks for Phase 2 boss {}", monster.monster_id);
            crate::boss_ender_defs::start_chaos_ball_attacks(ctx, monster.monster_id);
            crate::boss_ender_defs::start_void_zone_attacks(ctx, monster.monster_id);
            
            // Start boss target switching for Phase 2 boss
            log::info!("Starting boss target switching for Phase 2 boss {}", monster.monster_id);
            crate::boss_ender_defs::start_boss_target_switching(ctx, monster.monster_id);
        },
        BossType::Agna => {
            // Initialize Agna Phase 2 boss AI with summoning circles, target switching, and flamethrower
            crate::monster_ai_defs::initialize_phase2_boss_ai(ctx, monster.monster_id);
        },
        BossType::Simon => {
            // Initialize Simon Phase 2 boss AI (custom AI logic for Simon)
            crate::monster_ai_defs::initialize_phase2_boss_ai(ctx, monster.monster_id);
            
            // Start Simon's special attacks and behaviors
            log::info!("Starting Simon's special attacks for Phase 2 boss {}", monster.monster_id);
            // Note: These will be activated after transform state completes
            crate::boss_simon_defs::initialize_phase2_boss_simon_ai(ctx, monster.monster_id);
        },
    }
}

// Called when phase 2 boss is defeated - all players defeat the game!
pub fn handle_boss_defeated(ctx: &ReducerContext) {
    log::info!("FINAL BOSS DEFEATED! VICTORY!");
    
    // Get game state
    let mut game_state = ctx.db.game_state().id().find(&0)
        .expect("HandleBossDefeated: Could not find game state!");
    
    // Cleanup all boss-related scheduled attacks if there was a boss
    if game_state.boss_monster_id != 0 {
        crate::boss_ender_defs::cleanup_ender_claw_spawning(ctx, game_state.boss_monster_id);
        // Clean up EnderScythe attack schedules that might still be active
        crate::boss_ender_defs::cleanup_ender_scythe_schedules(ctx, game_state.boss_monster_id);
        // Clean up Imp attack schedules if the boss was an Imp
        crate::monster_attacks_def::cleanup_imp_attack_schedule(ctx, game_state.boss_monster_id);
        // Clean up ChaosBall and VoidZone attack schedules for Phase 2 boss
        crate::boss_ender_defs::cleanup_chaos_ball_schedules(ctx, game_state.boss_monster_id);
        crate::boss_ender_defs::cleanup_void_zone_schedules(ctx, game_state.boss_monster_id);
        // Clean up boss target switching schedules for Phase 2 boss
        crate::boss_ender_defs::cleanup_boss_target_switching(ctx, game_state.boss_monster_id);
        // Clean up Agna boss attack schedules (magic circles, flamethrower, fire orbs)
        crate::boss_agna_defs::cleanup_agna_ai_schedules(ctx, game_state.boss_monster_id);
        // Clean up Simon boss attack schedules (lightning, fire, etc.)
        crate::boss_simon_defs::cleanup_simon_ai_schedules(ctx, game_state.boss_monster_id);
        //Also remove zombies toxic zones...
    }
    
    // Reset game state
    game_state.boss_active = false;
    game_state.boss_phase = 0;
    game_state.boss_monster_id = 0;
    game_state.normal_spawning_paused = false;
    ctx.db.game_state().id().update(game_state);
    
    // Mark all players as "true survivors" and transition them to winner state
    let mut true_survivors_count = 0;
    let players_to_process: Vec<_> = ctx.db.player().iter().collect();
    
    for player in players_to_process {
        // Store the player in the dead_players table with special flag
        ctx.db.dead_players().insert(crate::DeadPlayer {
            player_id: player.player_id,
            name: player.name.clone(),
            is_true_survivor: true,  // Mark as true survivor
        });
        
        // Transition the account to winner state and schedule return to character select
        crate::transition_player_to_winner_state(ctx, player.player_id);
        
        // IMPORTANT: Clean up all attack-related data for this player before deletion
        // This was missing and causing orphaned attacks to persist in the database
        crate::core_game::cleanup_player_attacks(ctx, player.player_id);
        
        true_survivors_count += 1;
        
        // Delete the player
        ctx.db.player().player_id().delete(&player.player_id);
    }
    
    log::info!("{} players marked as True Survivors and transitioned to Winner state!", true_survivors_count);
    
    // Add a new curse for increased difficulty in future runs
    crate::curses_defs::add_random_curse(ctx);
    
    // Now that all players have been removed, call reset_world to clean up everything else
    // This will clean up all monsters, gems, spawners, attacks, cooldowns, etc.
    crate::reset_world::reset_world(ctx);
    
    // Note: Boss spawn will be scheduled when the first player joins again (via spawn_player in lib.rs)
    // This prevents the boss timer from appearing when no players are active
}

// Test/debug utility to manually spawn the boss for testing
#[reducer]
pub fn spawn_boss_for_testing(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "SpawnBossForTesting");
    
    log::info!("DEVELOPER TEST: Looking for existing boss spawn timer...");
    
    // Find the existing boss spawn timer
    let timer_opt = ctx.db.boss_spawn_timer().iter().next();
    
    if let Some(timer) = timer_opt {
        log::info!("DEVELOPER TEST: Found existing boss timer, updating to trigger in 5 seconds...");
        
        // Delete the old timer
        ctx.db.boss_spawn_timer().scheduled_id().delete(&timer.scheduled_id);
        
        // Create a new timer that triggers in 5 seconds
        const TEST_BOSS_SPAWN_DELAY_MS: u64 = 5000; // 5 seconds
        
        ctx.db.boss_spawn_timer().insert(BossSpawnTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(TEST_BOSS_SPAWN_DELAY_MS)),
            session_start_time: ctx.timestamp, // Record when this session started
        });
        
        log::info!("DEVELOPER TEST: Boss timer updated to trigger in 5 seconds");
    } else {
        log::info!("DEVELOPER TEST: No existing boss timer found, doing nothing");
    }
}

pub fn update_boss_monster_id(ctx: &ReducerContext, monster_id: u32) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer UpdateBossMonsterID may not be invoked by clients.");
    }

    // Get the monster from the monsters table
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if monster_opt.is_none() {
        log::info!("UpdateBossMonsterID: Monster with ID {} not found!", monster_id);
        return;
    }

    let monster = monster_opt.unwrap();
    // Check if this is a boss monster (Phase 1 of any boss type)
    if monster.bestiary_id == MonsterType::BossEnderPhase1 ||
       monster.bestiary_id == MonsterType::BossAgnaPhase1 ||
       monster.bestiary_id == MonsterType::BossSimonPhase1 {
        let boss_name = if monster.bestiary_id == MonsterType::BossEnderPhase1 { "Ender" } else if monster.bestiary_id == MonsterType::BossAgnaPhase1 { "Agna" } else { "Simon" };
        log::info!("BOSS {} PHASE 1 CREATED: Updating game state with boss_monster_id={}", boss_name, monster_id);
        
        // Get game state
        let mut game_state = ctx.db.game_state().id().find(&0)
            .expect("UpdateBossMonsterID: Could not find game state!");
        
        // Update the boss_monster_id in the game state
        game_state.boss_monster_id = monster_id;

        log::info!("Game state updated with boss_monster_id={}, boss_active={}, boss_phase={}", 
        monster_id, game_state.boss_active, game_state.boss_phase);

        ctx.db.game_state().id().update(game_state);
    }
}

// Schedule boss phase 2 spawn with delay for pre-transform VFX
pub fn schedule_boss_phase_two_spawn(ctx: &ReducerContext, position: DbVector2) {
    log::info!("Scheduling boss phase 2 spawn at ({}, {}) with 1.5 second delay", position.x, position.y);
    
    const PHASE_2_DELAY_MS: u64 = 1500; // 1.5 seconds delay for pre-transform VFX
    
    ctx.db.boss_phase_two_timer().insert(BossPhase2Timer {
        scheduled_id: 0,
        position,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(PHASE_2_DELAY_MS)),
    });
}

// Called when the delayed boss phase 2 timer fires
#[reducer]
pub fn spawn_boss_phase_two_delayed(ctx: &ReducerContext, timer: BossPhase2Timer) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer SpawnBossPhase2Delayed may not be invoked by clients, only via scheduling.");
    }

    log::info!("Boss phase 2 delayed spawn timer triggered!");
    spawn_boss_phase_two(ctx, timer.position);
}

// Debug reducer to set the boss type (client keys: 4 = Ender, 5 = Agna, 6 = Simon)
#[reducer]
pub fn debug_set_boss_type(ctx: &ReducerContext, client_key: u32) {
    // Check admin access first
    crate::require_admin_access(ctx, "DebugSetBossType");
    
    // Convert client key to boss type
    let boss_type = match client_key {
        4 => BossType::Ender,
        5 => BossType::Agna,
        6 => BossType::Simon,
        _ => {
            panic!("debug_set_boss_type: Invalid client key {}. Use 4 for Ender, 5 for Agna, or 6 for Simon.", client_key);
        }
    };
    
    let boss_name = match boss_type {
        BossType::Ender => "Ender",
        BossType::Agna => "Agna",
        BossType::Simon => "Simon",
    };
    log::info!("Debug: Setting boss type to {} ({:?}) from client key {}", boss_name, boss_type, client_key);
    
    // Update or create boss selection
    let existing_selection = ctx.db.boss_selection().id().find(&0);
    
    if let Some(mut selection) = existing_selection {
        // Update existing selection
        selection.boss_type = boss_type;
        ctx.db.boss_selection().id().update(selection);
        log::info!("Debug: Updated boss selection to {} ({:?})", boss_name, boss_type);
    } else {
        // Create new selection
        ctx.db.boss_selection().insert(BossSelection {
            id: 0,
            boss_type,
        });
        log::info!("Debug: Created new boss selection: {} ({:?})", boss_name, boss_type);
    }
    
    // Update game state to reflect the boss type
    let game_state_opt = ctx.db.game_state().id().find(&0);
    if let Some(mut game_state) = game_state_opt {
        game_state.boss_type = boss_type;
        ctx.db.game_state().id().update(game_state);
        log::info!("Debug: Updated game state boss_type to {:?}", boss_type);
    }
}
