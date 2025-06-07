use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt};
use crate::{DbVector2, MonsterType, player, config, monster_spawners, bestiary, monsters, monsters_boid, entity, gems, dead_players, monster_spawn_timer,
    active_attacks, attack_burst_cooldowns, player_scheduled_attacks};
use std::time::Duration;
// Game state table to track boss-related information
#[table(name = game_state, public)]
pub struct GameState {
    #[primary_key]
    pub id: u32, // We'll use id=0 for the main game state
    
    pub boss_active: bool, // Whether a boss is currently active
    pub boss_phase: u32, // 0 = no boss, 1 = phase 1, 2 = phase 2
    pub boss_monster_id: u32, // ID of the current boss monster
    pub normal_spawning_paused: bool, // Whether normal monster spawning is paused
}

// Timer for boss spawn (scheduled every 5 minutes)
#[table(name = boss_spawn_timer, scheduled(spawn_boss_phase_one), public)]
pub struct BossSpawnTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
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
        normal_spawning_paused: false,
    });

    log::info!("Game state initialized successfully");
    
    // Schedule first boss spawn after 5 minutes
    schedule_boss_spawn(ctx);
}

// Schedule the boss to spawn after 5 minutes
pub fn schedule_boss_spawn(ctx: &ReducerContext) {
    log::info!("Scheduling boss spawn after 5 minutes...");
    
    // Create timer that will trigger after 5 minutes
    const BOSS_SPAWN_DELAY_MS: u64 = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    ctx.db.boss_spawn_timer().insert(BossSpawnTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(BOSS_SPAWN_DELAY_MS)),
    });
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
    
    // Create spawner for the boss
    let spawner_opt = ctx.db.monster_spawners().insert(crate::MonsterSpawners {
        scheduled_id: 0,
        position,
        monster_type: MonsterType::FinalBossPhase1,
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
    
    // Get boss stats from bestiary
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::FinalBossPhase2 as u32))
        .expect("SpawnBossPhaseTwo: Could not find bestiary entry for boss phase 2!");
    
    // Find the closest player to target
    let closest_player_id = crate::monsters_def::get_closest_player(ctx, &position);
    
    // Create the phase 2 boss monster
    let monster_opt = ctx.db.monsters().insert(crate::Monsters {
        monster_id: 0,
        bestiary_id: MonsterType::FinalBossPhase2,
        hp: bestiary_entry.max_hp,
        max_hp: bestiary_entry.max_hp,
        atk: bestiary_entry.atk,
        speed: bestiary_entry.speed,
        target_player_id: closest_player_id,
        radius: bestiary_entry.radius,
        spawn_position: position.clone(),
        ai_state: crate::monster_ai_defs::AIState::BossIdle,
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

    // Initialize Phase 2 boss AI (BossIdle only, no automatic patterns)
    crate::monster_ai_defs::initialize_phase2_boss_ai(ctx, monster.monster_id);
    
    // Start EnderClaw spawning for Phase 2 boss
    log::info!("Starting EnderClaw spawning for Phase 2 boss {}", monster.monster_id);
    crate::monsters_def::start_ender_claw_spawning(ctx, monster.monster_id);
}

// Called when phase 2 boss is defeated - all players defeat the game!
pub fn handle_boss_defeated(ctx: &ReducerContext) {
    log::info!("FINAL BOSS DEFEATED! VICTORY!");
    
    // Get game state
    let mut game_state = ctx.db.game_state().id().find(&0)
        .expect("HandleBossDefeated: Could not find game state!");
    
    // Cleanup all boss-related scheduled attacks if there was a boss
    if game_state.boss_monster_id != 0 {
        crate::monsters_def::cleanup_ender_claw_spawning(ctx, game_state.boss_monster_id);
        // Clean up EnderScythe attack schedules that might still be active
        crate::monster_attacks_def::cleanup_ender_scythe_schedules(ctx, game_state.boss_monster_id);
        // Clean up Imp attack schedules if the boss was an Imp
        crate::monster_attacks_def::cleanup_imp_attack_schedule(ctx, game_state.boss_monster_id);
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
    
    // Now that all players have been removed, call reset_world to clean up everything else
    // This will clean up all monsters, gems, spawners, attacks, cooldowns, etc. and reschedule monster spawning
    crate::reset_world::reset_world(ctx);
    
    // Schedule the next boss spawn
    schedule_boss_spawn(ctx);
}

// Test/debug utility to manually spawn the boss for testing
#[reducer]
pub fn spawn_boss_for_testing(ctx: &ReducerContext) {
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
    // Check if this is a boss monster (FinalBossPhase1)
    if monster.bestiary_id == MonsterType::FinalBossPhase1 {
        log::info!("BOSS PHASE 1 CREATED: Updating game state with boss_monster_id={}", monster_id);
        
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
        panic!("Reducer spawn_boss_phase_two_delayed may not be invoked by clients, only via scheduling.");
    }

    log::info!("Delayed boss phase 2 spawn timer triggered at ({}, {})", timer.position.x, timer.position.y);
    
    // Call the existing spawn_boss_phase_two function
    spawn_boss_phase_two(ctx, timer.position);
}
