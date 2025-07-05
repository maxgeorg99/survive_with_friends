use spacetimedb::{rand::Rng, reducer, table, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};
use std::time::Duration;

// Module declarations
pub mod config_def;
pub mod class_data_def;
pub mod monster_types_def;
pub mod bestiary_def;
pub mod player_def;
pub mod reset_world;
pub mod collision;
pub mod bots_def;
pub mod attack_utils;
pub mod gems_def;
pub mod gem_drop_defs;
pub mod loot_capsule_defs;
pub mod boss_system;
pub mod boss_ender_defs;
pub mod boss_agna_defs;
pub mod monsters_def;
pub mod monster_ai_defs;
pub mod monster_spawn_defs;
pub mod attacks_def;
pub mod monster_attacks_def;
pub mod core_game;
pub mod upgrades_def;
pub mod structure_defs;
pub mod lorescrolls_defs;
pub mod cheats_def;
pub mod curses_defs;

// Re-export public items from modules
pub use config_def::*;
pub use class_data_def::*;
pub use monster_types_def::*;
pub use bestiary_def::*;
pub use player_def::*;
pub use reset_world::*;
pub use collision::*;
pub use bots_def::*;
pub use attack_utils::*;
pub use gems_def::*;
pub use gem_drop_defs::*;
pub use loot_capsule_defs::*;
pub use boss_system::*;
pub use boss_ender_defs::*;
pub use boss_agna_defs::*;
pub use monsters_def::*;
pub use monster_ai_defs::*;
pub use monster_spawn_defs::*;
pub use attacks_def::*;
pub use monster_attacks_def::*;
pub use core_game::*;
pub use upgrades_def::*;
pub use structure_defs::*;
pub use lorescrolls_defs::*;
pub use cheats_def::*;
pub use curses_defs::*;

// --- Types ---
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PlayerClass {
    Fighter,
    Rogue,
    Mage,
    Paladin,
    Valkyrie,
    Priest,
}

// Account state enum for player progression
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AccountState {
    ChoosingName,
    ChoosingClass,
    Playing,
    Dead,
    Winner,
}

// Attack type enum
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AttackType {
    Sword,
    Wand,
    Knives,
    Shield,
    ThunderHorn,
    AngelStaff,
}

// Monster attack type enum
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum MonsterAttackType {
    ImpBolt,
    EnderBolt,
    EnderScytheSpawn,
    EnderScythe,
    ChaosBall,
    VoidZone,
    AgnaFlamethrowerJet,
    AgnaOrbSpawn,
    AgnaFireOrb,
    AgnaCandleBolt,
    AgnaPhase2FlameJet,
    AgnaGroundFlame,
}

// Monster variant enum for shiny monsters
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum MonsterVariant {
    Default,
    Shiny,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq)]
pub struct DbVector2 {
    pub x: f32,
    pub y: f32,
}

impl DbVector2 {
    pub fn new(x: f32, y: f32) -> Self {
        DbVector2 { x, y }
    }
    
    // Get normalized vector (direction only)
    pub fn normalize(&self) -> DbVector2 {
        let d2 = self.x * self.x + self.y * self.y;
        if d2 > 0.0 {
            let inv_mag = 1.0 / d2.sqrt();
            DbVector2::new(self.x * inv_mag, self.y * inv_mag)
        } else {
            DbVector2::new(0.0, 0.0)
        }
    }
    
    // Get magnitude (length) of vector
    pub fn magnitude(&self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
}

impl std::ops::Add for DbVector2 {
    type Output = DbVector2;
    
    fn add(self, other: DbVector2) -> DbVector2 {
        DbVector2::new(self.x + other.x, self.y + other.y)
    }
}

impl std::ops::Mul<f32> for DbVector2 {
    type Output = DbVector2;
    
    fn mul(self, scalar: f32) -> DbVector2 {
        DbVector2::new(self.x * scalar, self.y * scalar)
    }
}

// --- Game Constants ---
pub const PLAYER_SPEED: f32 = 200.0; // Units per second
pub const TICK_RATE: f32 = 20.0; // Updates per second (50ms)
pub const DELTA_TIME: f32 = 1.0 / TICK_RATE; // Time between ticks in seconds

// --- World Constants ---
pub const WORLD_SIZE: u32 = 6400;
pub const NUM_WORLD_CELLS: u16 = 40704;
pub const WORLD_GRID_WIDTH: u16 = 157;
pub const WORLD_GRID_HEIGHT: u16 = 157;
pub const WORLD_CELL_SIZE: u16 = 128;
pub const WORLD_CELL_BIT_SHIFT: u16 = 8;
pub const WORLD_CELL_MASK: u16 = (1 << WORLD_CELL_BIT_SHIFT) - 1;
pub const MAX_PLAYERS: u16 = 32;
pub const MAX_MONSTERS: u16 = 1024;
pub const MAX_GEM_COUNT: u16 = 1024;
pub const MAX_ATTACK_COUNT: u16 = 4096;
pub const MAX_MONSTER_ATTACK_COUNT: u16 = 2048;

// --- Timer Table ---
#[table(name = game_tick_timer, scheduled(game_tick))]
pub struct GameTickTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// Timer for transitioning dead players back to character select
#[table(name = dead_player_transition_timer, scheduled(transition_dead_to_choosing_class))]
pub struct DeadPlayerTransitionTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub identity: Identity,  // Which player this timer is for
}

// Timer for transitioning winner players back to character select  
#[table(name = winner_transition_timer, scheduled(transition_winner_to_choosing_class))]
pub struct WinnerTransitionTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub identity: Identity,  // Which player this timer is for
}

// --- Tables ---
#[table(name = entity, public)]
pub struct Entity {
    #[primary_key]
    #[auto_inc]
    pub entity_id: u32,

    pub position: DbVector2,
    
    // Added direction and movement state directly to Entity
    pub direction: DbVector2,   // Direction vector (normalized)
    pub radius: f32,            // Collision radius for this entity
    
    // Added waypoint for tap-to-move
    pub waypoint: DbVector2,    // Target position for movement
    pub has_waypoint: bool,     // Whether entity has an active waypoint
}

#[table(name = world, public)]
pub struct World {
    #[primary_key]
    pub world_id: u32,

    pub tick_count: u32,
    
    // Fields for tracking game tick timing
    pub last_tick_time: Timestamp,      // Last timestamp when a game tick occurred
    pub average_tick_ms: f64,            // Rolling average of tick intervals in milliseconds
    pub min_tick_ms: f64,                // Minimum tick interval observed
    pub max_tick_ms: f64,                // Maximum tick interval observed
    pub timing_samples_collected: u32,   // Number of timing samples collected
}

#[table(name = account, public)]
pub struct Account {
    #[primary_key]
    pub identity: Identity,

    pub name: String,
    
    pub current_player_id: u32,

    pub last_login: Timestamp,
    
    pub state: AccountState,  // Current progression state
    
    pub soul_id: u32,  // gem_id of the soul created when this player last died (0 if no soul)
}

// --- Lifecycle Hooks ---
#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    log::info!("Initializing game and scheduling game tick...");

    // Initialize world        
    if ctx.db.world().count() == 0 {
        // Insert default configuration
        ctx.db.world().insert(World {
            world_id: 0,
            tick_count: 0,
            last_tick_time: ctx.timestamp,
            average_tick_ms: 0.0,
            min_tick_ms: 0.0,
            max_tick_ms: 0.0,
            timing_samples_collected: 0,
        });
    }
    
    // Initialize game configuration first
    init_game_config(ctx);
    
    // TODO: Initialize game state
    init_game_state(ctx);
    
    // Initialize boss selection (choose between Ender and Agna)
    boss_system::init_boss_selection(ctx);
    
    // TODO: Initialize class data
    initialize_class_data(ctx);

    let game_tick_rate = if let Some(config) = ctx.db.config().id().find(&0) {
        config.game_tick_rate
    } else {
        50
    };
    
    // Schedule first game tick as a one-off event
    ctx.db.game_tick_timer().insert(GameTickTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(game_tick_rate as u64)),
    });
    
    log::info!("Initial game tick scheduled successfully");
    
    // TODO: Initialize bestiary with monster data
    init_bestiary(ctx);
    
    // Note: When adding new monster types to the Bestiary, remember to update the
    // SpawnableMonsterTypes array in Monsters.rs if they should be part of normal spawning.
    // Boss monsters should NOT be added to the spawnable list.
    
    init_exp_system(ctx);
    initialize_attack_system(ctx);
    init_health_regen_system(ctx);
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    let identity = ctx.sender;
    log::info!("Client connected: {}", identity);

    // Check if account already exists - if so, reconnect them
    if let Some(account) = ctx.db.account().identity().find(&identity) {
        log::info!("Client has existing account: {} reconnected.", identity);
        log::info!("Account details: Name={}, PlayerID={}, State={:?}", 
                  account.name, account.current_player_id, account.state);

        // Handle reconnection based on account state
        match account.state {
            AccountState::ChoosingName => {
                log::info!("Account {} reconnected in ChoosingName state", identity);
            },
            AccountState::ChoosingClass => {
                log::info!("Account {} reconnected in ChoosingClass state", identity);
            },
            AccountState::Playing => {
                // Check if player still exists
                if account.current_player_id != 0 {
                    let player_opt = ctx.db.player().player_id().find(&account.current_player_id);
                    if player_opt.is_none() 
                    {
                        log::info!(
                            "Account {} was in Playing state but no living player found (PlayerID: {}). Transitioning to ChoosingClass.", 
                            identity, account.current_player_id
                        );
                        
                        let mut updated_account = account;
                        updated_account.state = AccountState::ChoosingClass;
                        updated_account.current_player_id = 0;  // Reset player ID since no living player found
                        ctx.db.account().identity().update(updated_account);
                    } 
                    else 
                    {
                        log::info!(
                            "Found living player {} for account {} (PlayerID: {}) in Playing state.", 
                            player_opt.unwrap().name, identity, account.current_player_id
                        );
                    }
                } 
                else 
                {
                    log::info!("Account {} was in Playing state but has no PlayerID. Transitioning to ChoosingClass.", identity);
                    let mut updated_account = account;
                    updated_account.state = AccountState::ChoosingClass;
                    updated_account.current_player_id = 0;  // Ensure player ID is 0
                    ctx.db.account().identity().update(updated_account);
                }
            },
            AccountState::Dead => {
                log::info!("Account {} reconnected in Dead state", identity);
            },
            AccountState::Winner => {
                log::info!("Account {} reconnected in Winner state", identity);
            },
        }
    } else {
        // Create a new account
        log::info!("New connection from {}. Creating a new account.", identity);
        
        if let Ok(_new_account) = ctx.db.account().try_insert(Account {
            identity,
            name: "".to_string(),
            current_player_id: 0, // PlayerID 0 indicates no character yet
            last_login: ctx.timestamp,
            state: AccountState::ChoosingName,
            soul_id: 0, // No soul initially
        }) {
            log::info!("Created new account for {} in ChoosingName state", identity);
        } else {
            log::error!("Failed to create new account for {}.", identity);
        }
    }
}

// --- Reducers ---
#[reducer]
pub fn set_name(ctx: &ReducerContext, name: String) {
    let identity = ctx.sender;
    log::info!("SetName called by identity: {} with name: {}", identity, name);

    // Basic validation
    if name.trim().is_empty() || name.len() > 16 {
        panic!("SetName: Invalid name provided by {}: '{}'. Name must be 1-16 characters.", identity, name);
    }

    // Find the account using the context's Db object and the primary key index (identity)
    let mut account = ctx.db.account().identity().find(&identity)
        .expect(&format!("SetName: Attempted to set name for non-existent account {}.", identity));

    // Check if account is in the correct state
    if account.state != AccountState::ChoosingName {
        panic!("SetName: Account {} is not in ChoosingName state. Current state: {:?}", identity, account.state);
    }

    account.name = name.trim().to_string();
    account.state = AccountState::ChoosingClass;  // Transition to choosing class
    let account_name = account.name.clone(); // Clone before moving

    ctx.db.account().identity().update(account);
    log::info!("Account {} name set to {} and transitioned to ChoosingClass state.", identity, account_name);
}

#[reducer]
pub fn update_last_login(ctx: &ReducerContext) {
    let identity = ctx.sender;
    
    // Get account for the caller
    let mut account = ctx.db.account().identity().find(&identity)
        .expect(&format!("UpdateLastLogin: Account not found for identity {}", identity));
    
    // Update the last login time
    account.last_login = ctx.timestamp;
    ctx.db.account().identity().update(account);
    
    log::info!("Updated last login time for account {}", identity);
}

#[reducer]
pub fn spawn_player(ctx: &ReducerContext, class_id: u32) {
    let identity = ctx.sender;

    log::info!("SpawnPlayer called by identity: {}", identity);

    // Check if spawning a new player would exceed MAX_PLAYERS limit
    let current_player_count = ctx.db.player().count();
    if current_player_count >= MAX_PLAYERS as u64 {
        panic!("SpawnPlayer: Server has reached maximum player capacity ({}/{}). Cannot spawn new player for {}.", 
               current_player_count, MAX_PLAYERS, identity);
    }

    // Check if account exists
    let account = ctx.db.account().identity().find(&identity)
        .expect(&format!("SpawnPlayer: Account {} does not exist.", identity));

    // Check if account is in the correct state
    if account.state != AccountState::ChoosingClass {
        panic!("SpawnPlayer: Account {} is not in ChoosingClass state. Current state: {:?}", identity, account.state);
    }

    // Check if the account already has an active player (current_player_id should be 0 for accounts ready to create new characters)
    if account.current_player_id != 0 {
        // Double-check if the player actually exists (in case of data inconsistency)
        if ctx.db.player().player_id().find(&account.current_player_id).is_some() {
            panic!("SpawnPlayer: Account {} already has an active player (ID: {})", identity, account.current_player_id);
        } else {
            // Player ID is non-zero but player doesn't exist - reset the account state
            log::warn!("SpawnPlayer: Account {} had non-zero player ID {} but no player exists. Resetting.", identity, account.current_player_id);
            let fixed_account = Account {
                identity,
                name: account.name.clone(),
                current_player_id: 0,
                last_login: account.last_login,
                state: AccountState::ChoosingClass,
                soul_id: account.soul_id, // Keep existing soul_id when resetting account
            };
            ctx.db.account().identity().update(fixed_account);
        }
    }

    // Create a new player with a random class
    let name = account.name.clone();

    log::info!("Creating new player for {} with name: {}", identity, name);
    
    // Cast the class_id to a PlayerClass enum
    let player_class = match class_id {
        0 => PlayerClass::Fighter,
        1 => PlayerClass::Rogue,
        2 => PlayerClass::Mage,
        3 => PlayerClass::Paladin,
        4 => PlayerClass::Valkyrie,
        5 => PlayerClass::Priest,
        _ => panic!("SpawnPlayer: Invalid class ID provided by {}: {}. Valid class IDs are 0-5 (Fighter, Rogue, Mage, Paladin, Valkyrie, Priest).", identity, class_id),
    };
    
    // Create the player and entity
    let new_player = create_new_player(ctx, &name, player_class.clone())
        .expect(&format!("Failed to create new player for {}!", identity));

    // Update the account to point to the new player and transition to playing state
    let mut updated_account = account;
    updated_account.current_player_id = new_player.player_id;
    updated_account.state = AccountState::Playing;  // Transition to playing
    ctx.db.account().identity().update(updated_account);

    log::info!("Created new player record for {} with class {:?} and transitioned to Playing state.", identity, player_class);
    
    // Check if this is the first player - if so, schedule boss spawn
    if ctx.db.player().count() == 1 {
        log::info!("First player spawned - scheduling boss timer for new world");
        
        // Clear any existing boss spawn timers first
        let timers_to_delete: Vec<u64> = ctx.db.boss_spawn_timer()
            .iter()
            .map(|timer| timer.scheduled_id)
            .collect();
        
        for scheduled_id in timers_to_delete {
            ctx.db.boss_spawn_timer().scheduled_id().delete(&scheduled_id);
        }
        
        // Schedule a new boss spawn
        schedule_boss_spawn(ctx);
        
        // Also schedule monster spawning and guaranteed void chest spawns for the new world
        log::info!("First player spawned - scheduling monster spawning for new world");
        
        // Clear any existing monster spawn timers first
        let monster_timers_to_delete: Vec<u64> = ctx.db.monster_spawn_timer()
            .iter()
            .map(|timer| timer.scheduled_id)
            .collect();
        
        for scheduled_id in monster_timers_to_delete {
            ctx.db.monster_spawn_timer().scheduled_id().delete(&scheduled_id);
        }
        
        // Clear any existing guaranteed void chest spawns
        crate::loot_capsule_defs::cleanup_guaranteed_void_chest_spawns(ctx);
        
        // Schedule new monster spawning and guaranteed void chest spawns
        schedule_monster_spawning(ctx);
    }
}

// Helper function to create a new player with an associated entity
fn create_new_player(ctx: &ReducerContext, name: &str, player_class: PlayerClass) -> Option<Player> {
    // Get collision cache for safe spawn detection
    let collision_cache = crate::monsters_def::get_collision_cache();
    
    // Find a safe spawn position using the same logic as bots
    // This ensures players spawn at least 200 pixels away from any monsters
    let spawn_position = crate::player_def::find_safe_spawn_position(ctx, 48.0, &collision_cache); // Using standard player radius
    let spawn_position = match spawn_position {
        Some(pos) => pos,
        None => {
            log::error!("CreateNewPlayer: Failed to find safe spawn position for player '{}'", name);
            // Fall back to a reasonable default if safe position not found
            DbVector2::new(3200.0, 3200.0) // World center as fallback
        }
    };
    
    log::info!("Placing new player '{}' at safe position: {}, {}", name, spawn_position.x, spawn_position.y);
    
    create_new_player_with_position(ctx, name, player_class, spawn_position)
}

// Helper function that takes a position parameter
pub fn create_new_player_with_position(ctx: &ReducerContext, name: &str, player_class: PlayerClass, position: DbVector2) -> Option<Player> {
    // Look up class data to use for stats
    let class_data = ctx.db.class_data().class_id().find(&(player_class.clone() as u32));
    
    // Define default stats in case class data isn't found
    let (max_hp, armor, speed, starting_attack_type) = if let Some(class_data) = class_data {
        (class_data.max_hp as f32, class_data.armor, class_data.speed, class_data.starting_attack_type)
    } else {
        log::error!("CreateNewPlayerWithPosition: No class data found for {:?}", player_class.clone());
        // Fall back to default values if class data not found
        (100.0, 0, PLAYER_SPEED, AttackType::Sword)
    };

    let shield_count = if starting_attack_type == AttackType::Shield { 2 } else { 0 };
    
    let initial_exp_needed = calculate_exp_for_level(ctx, 1);

    let player_spawn_grace_period = if let Some(config) = ctx.db.config().id().find(&0) {
        config.player_spawn_grace_period
    } else {
        5000
    };

    // Create the Player record
    let new_player = ctx.db.player().insert(Player {
        player_id: 0,
        name: name.to_string(),
        spawn_grace_period_remaining: player_spawn_grace_period,
        player_class,
        level: 1,
        exp: 0,
        exp_for_next_level: initial_exp_needed,
        max_hp,
        hp: max_hp,
        hp_regen: 0,
        speed,
        armor: armor as u32,
        unspent_upgrades: 0,
        rerolls: 1,
        shield_count,
        pvp: false,  // PvP is disabled by default
        position,
        radius: 48.0,
        is_bot: false,
        waypoint: DbVector2::new(0.0, 0.0),
        has_waypoint: false,
    });
    
    let new_player = new_player;
    
    // Schedule the starting attack for this class
    attacks_def::schedule_new_player_attack(ctx, new_player.player_id, starting_attack_type.clone(), 1);
    log::info!("Scheduled starting attack type {:?} for player {}", starting_attack_type.clone(), new_player.player_id);

    Some(new_player)
}

// Scheduled reducer to transition dead players back to choosing class
#[reducer]
pub fn transition_dead_to_choosing_class(ctx: &ReducerContext, timer: DeadPlayerTransitionTimer) {
    if ctx.sender != ctx.identity() {
        panic!("TransitionDeadToChoosingClass may not be invoked by clients, only via scheduling.");
    }

    let identity = timer.identity;
    log::info!("Transitioning dead player {} back to choosing class", identity);

    // Find the account
    if let Some(mut account) = ctx.db.account().identity().find(&identity) {
        if account.state == AccountState::Dead {
            account.state = AccountState::ChoosingClass;
            account.current_player_id = 0;  // Reset player ID
            ctx.db.account().identity().update(account);
            log::info!("Account {} transitioned from Dead to ChoosingClass", identity);
        } else {
            log::warn!("Account {} was not in Dead state when transition timer fired. Current state: {:?}", identity, account.state);
        }
    } else {
        log::warn!("Account {} not found when dead transition timer fired", identity);
    }
}

// Scheduled reducer to transition winner players back to choosing class
#[reducer]
pub fn transition_winner_to_choosing_class(ctx: &ReducerContext, timer: WinnerTransitionTimer) {
    if ctx.sender != ctx.identity() {
        panic!("TransitionWinnerToChoosingClass may not be invoked by clients, only via scheduling.");
    }

    let identity = timer.identity;
    log::info!("Transitioning winner player {} back to choosing class", identity);

    // Find the account
    if let Some(mut account) = ctx.db.account().identity().find(&identity) {
        if account.state == AccountState::Winner {
            account.state = AccountState::ChoosingClass;
            account.current_player_id = 0;  // Reset player ID
            ctx.db.account().identity().update(account);
            log::info!("Account {} transitioned from Winner to ChoosingClass", identity);
        } else {
            log::warn!("Account {} was not in Winner state when transition timer fired. Current state: {:?}", identity, account.state);
        }
    } else {
        log::warn!("Account {} not found when winner transition timer fired", identity);
    }
}

// Helper function to transition player to dead state and schedule return to choosing class
pub fn transition_player_to_dead_state(ctx: &ReducerContext, player_id: u32) {
    // Find the account associated with this player by iterating through all accounts
    let mut found_account = None;
    for account in ctx.db.account().iter() {
        if account.current_player_id == player_id && account.current_player_id != 0 {
            found_account = Some(account);
            break;
        }
    }
    
    if let Some(account) = found_account {
        let identity = account.identity;
        
        // Update account state to dead and reset player ID immediately
        let mut updated_account = account;
        updated_account.state = AccountState::Dead;
        updated_account.current_player_id = 0;  // Reset player ID immediately to prevent conflicts
        ctx.db.account().identity().update(updated_account);
        
        log::info!("Account {} transitioned to Dead state and reset player ID to 0", identity);
        
        // Schedule transition back to choosing class after a few seconds
        const DEAD_TRANSITION_DELAY_MS: u64 = 5000; // 5 seconds
        
        ctx.db.dead_player_transition_timer().insert(DeadPlayerTransitionTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(DEAD_TRANSITION_DELAY_MS)),
            identity,
        });
        
        log::info!("Scheduled transition from Dead to ChoosingClass for account {} in {} ms", identity, DEAD_TRANSITION_DELAY_MS);
    } else {
        log::warn!("Could not find account for player {} when transitioning to dead state", player_id);
    }
}

// Helper function to transition player to winner state and schedule return to choosing class
pub fn transition_player_to_winner_state(ctx: &ReducerContext, player_id: u32) {
    // Find the account associated with this player by iterating through all accounts
    let mut found_account = None;
    for account in ctx.db.account().iter() {
        if account.current_player_id == player_id && account.current_player_id != 0 {
            found_account = Some(account);
            break;
        }
    }
    
    if let Some(account) = found_account {
        let identity = account.identity;
        
        // Update account state to winner and reset player ID immediately
        let mut updated_account = account;
        updated_account.state = AccountState::Winner;
        updated_account.current_player_id = 0;  // Reset player ID immediately to prevent conflicts
        ctx.db.account().identity().update(updated_account);
        
        log::info!("Account {} transitioned to Winner state and reset player ID to 0", identity);
        
        // Schedule transition back to choosing class after a few seconds
        const WINNER_TRANSITION_DELAY_MS: u64 = 10000; // 10 seconds to celebrate
        
        ctx.db.winner_transition_timer().insert(WinnerTransitionTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(WINNER_TRANSITION_DELAY_MS)),
            identity,
        });
        
        log::info!("Scheduled transition from Winner to ChoosingClass for account {} in {} ms", identity, WINNER_TRANSITION_DELAY_MS);
    } else {
        log::warn!("Could not find account for player {} when transitioning to winner state", player_id);
    }
}

// Helper function to check if the caller is an admin
pub fn is_admin_caller(ctx: &ReducerContext) -> bool {
    let caller_identity = ctx.sender;
    
    // Find the caller's account
    if let Some(account) = ctx.db.account().identity().find(&caller_identity) {
        account.name == "AdminXanadar"
    } else {
        false
    }
}

// Helper function to check admin and panic if not authorized
pub fn require_admin_access(ctx: &ReducerContext, function_name: &str) {
    if !is_admin_caller(ctx) {
        let caller_identity = ctx.sender;
        let caller_name = ctx.db.account().identity().find(&caller_identity)
            .map(|account| account.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        
        panic!("{}: Access denied. Only AdminXanadar can use debug commands. Caller: {} ({})", 
               function_name, caller_name, caller_identity);
    }
}

// Admin reducer to set player health to 10000 (both current and max)
#[reducer]
pub fn debug_set_super_health(ctx: &ReducerContext) {
    require_admin_access(ctx, "debug_set_super_health");
    
    let caller_identity = ctx.sender;
    
    // Find the caller's account and their current player
    if let Some(account) = ctx.db.account().identity().find(&caller_identity) {
        if account.current_player_id == 0 {
            log::warn!("Admin {} has no active player to set super health", account.name);
            return;
        }
        
        // Find and update the player
        if let Some(mut player) = ctx.db.player().player_id().find(&account.current_player_id) {
            let old_hp = player.hp;
            let old_max_hp = player.max_hp;
            
            player.hp = 10000.0;
            player.max_hp = 10000.0;
            ctx.db.player().player_id().update(player);
            
            log::info!("Admin {} set super health: Player {} HP changed from {}/{} to 10000/10000", 
                      account.name, account.current_player_id, old_hp, old_max_hp);
        } else {
            log::warn!("Admin {} player {} not found for super health", account.name, account.current_player_id);
        }
    } else {
        log::warn!("Admin account not found for super health command");
    }
}
