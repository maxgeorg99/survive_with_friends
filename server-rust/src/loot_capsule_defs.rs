use spacetimedb::{table, reducer, Table, ReducerContext, ScheduleAt, rand::Rng};
use crate::{DbVector2, GemLevel, account, player, config, gems_def, MonsterType, bestiary, monsters, monsters_boid};
use std::time::Duration;

// Constants for the VoidChest pinata system
const VOID_CHEST_DAMAGE_CAPSULE_CHANCE: f32 = 0.1; // chance per game tick when damaged
const VOID_CHEST_DEATH_CAPSULE_COUNT: usize = 16; // Number of capsules on death
const CAPSULE_FLIGHT_DURATION_MS: u64 = 1000; // How long capsules take to arrive
const MIN_RADIUS: f32 = 220.0; // Minimum radius for capsule spawn
const MODERATE_RADIUS: f32 = 550.0; // Radius for damage-triggered capsules
const LARGE_RADIUS: f32 = 650.0; // Radius for death-triggered capsules

// Table for LootCapsules - scheduled gem spawners that move from start to end position
#[table(name = loot_capsules, scheduled(spawn_loot_capsule), public)]
pub struct LootCapsules {
    #[primary_key]
    #[auto_inc]
    pub capsule_id: u64,
    
    pub start_position: DbVector2,     // Where the capsule starts
    pub end_position: DbVector2,       // Where the capsule will spawn the gem
    pub lootdrop_id: GemLevel,         // The type of gem it will spawn
    pub scheduled_at: ScheduleAt,      // When the capsule will spawn the gem
}

// Table for scheduled guaranteed VoidChest spawns
#[table(name = guaranteed_void_chest_spawns, scheduled(spawn_guaranteed_void_chest), public)]
pub struct GuaranteedVoidChestSpawn {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// Scheduled reducer to spawn a gem when a loot capsule arrives at its destination
#[reducer]
pub fn spawn_loot_capsule(ctx: &ReducerContext, capsule: LootCapsules) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_loot_capsule may not be invoked by clients, only via scheduling.");
    }
    
    log::info!(
        "LootCapsule {} arriving at destination ({:.1}, {:.1}) and spawning {:?} gem",
        capsule.capsule_id,
        capsule.end_position.x,
        capsule.end_position.y,
        capsule.lootdrop_id
    );
    
    // Create the specified gem at the end position
    let gem_id = gems_def::create_gem(ctx, capsule.end_position, capsule.lootdrop_id.clone());
    
    log::info!(
        "LootCapsule {} successfully spawned gem {} of type {:?}",
        capsule.capsule_id,
        gem_id,
        capsule.lootdrop_id
    );
}

// Scheduled reducer to spawn a guaranteed VoidChest at timed intervals
#[reducer]
pub fn spawn_guaranteed_void_chest(ctx: &ReducerContext, _spawn: GuaranteedVoidChestSpawn) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_guaranteed_void_chest may not be invoked by clients, only via scheduling.");
    }
    
    log::info!("Guaranteed VoidChest spawn triggered!");
    
    // Check if there are any players online
    let player_count = ctx.db.player().count();
    if player_count == 0 {
        log::info!("No players online, skipping guaranteed VoidChest spawn.");
        return;
    }
    
    // Get VoidChest stats from bestiary
    let bestiary_entry_opt = ctx.db.bestiary().bestiary_id().find(&(crate::MonsterType::VoidChest as u32));
    if bestiary_entry_opt.is_none() {
        log::error!("VoidChest not found in bestiary for guaranteed spawn");
        return;
    }
    
    let bestiary_entry = bestiary_entry_opt.unwrap();
    
    // Get world boundaries from config
    let config = ctx.db.config().id().find(&0);
    let world_size = if let Some(config) = config {
        config.world_size as f32
    } else {
        6400.0 // Default world size
    };
    
    // Generate a completely random position across the entire map
    let mut rng = ctx.rng();
    let margin = bestiary_entry.radius + 50.0; // Extra margin for safety
    let spawn_area_size = world_size - (2.0 * margin);
    
    let spawn_position = DbVector2::new(
        margin + (rng.gen::<f32>() * spawn_area_size),
        margin + (rng.gen::<f32>() * spawn_area_size)
    );
    
    // Find the closest player to target
    let closest_player_id = crate::monsters_def::get_closest_player(ctx, &spawn_position);
    
    // Create the VoidChest monster directly
    let monster = ctx.db.monsters().insert(crate::Monsters {
        monster_id: 0,
        bestiary_id: crate::MonsterType::VoidChest,
        hp: bestiary_entry.max_hp,
        max_hp: bestiary_entry.max_hp,
        atk: bestiary_entry.atk,
        speed: bestiary_entry.speed,
        target_player_id: closest_player_id,
        radius: bestiary_entry.radius,
        spawn_position: spawn_position.clone(),
        ai_state: crate::monster_ai_defs::AIState::Stationary,
    });
    
    // Create the boid for movement
    let _boid = ctx.db.monsters_boid().insert(crate::MonsterBoid {
        monster_id: monster.monster_id,
        position: spawn_position,
    });
    
    log::info!(
        "Guaranteed VoidChest spawned! ID: {}, Position: ({:.1}, {:.1}), Target Player: {}",
        monster.monster_id,
        spawn_position.x,
        spawn_position.y,
        closest_player_id
    );
}

// Debug reducer to schedule a loot capsule near the calling player
#[reducer]
pub fn spawn_debug_loot_capsule(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "SpawnDebugLootCapsule");
    
    // Get the caller's identity
    let caller_identity = ctx.sender;
    
    // Find the caller's account
    let account_opt = ctx.db.account().identity().find(&caller_identity);
    if account_opt.is_none() {
        log::error!("spawn_debug_loot_capsule: Account not found for caller");
        return;
    }
    
    let account = account_opt.unwrap();
    if account.current_player_id == 0 {
        log::error!("spawn_debug_loot_capsule: Caller has no active player");
        return;
    }
    
    // Find the player
    let player_opt = ctx.db.player().player_id().find(&account.current_player_id);
    if player_opt.is_none() {
        log::error!("spawn_debug_loot_capsule: Player {} not found", account.current_player_id);
        return;
    }
    
    let player = player_opt.unwrap();
    
    // Set start position to player's current position
    let start_position = player.position.clone();
    
    // Generate a random end position nearby (100-300 units away)
    let mut rng = ctx.rng();
    let distance = rng.gen_range(100.0..300.0);
    let angle = rng.gen_range(0.0..(2.0 * std::f32::consts::PI));
    
    let end_position = DbVector2::new(
        player.position.x + distance * angle.cos(),
        player.position.y + distance * angle.sin(),
    );
    
    // Get world boundaries from config
    let config = ctx.db.config().id().find(&0);
    let world_size = if let Some(config) = config {
        config.world_size as f32
    } else {
        6400.0 // Default world size
    };
    
    // Clamp end position to world boundaries (with some margin)
    let margin = 50.0;
    let clamped_end_position = DbVector2::new(
        end_position.x.clamp(margin, world_size - margin),
        end_position.y.clamp(margin, world_size - margin)
    );
    
    // Randomly select a gem type to spawn
    let gem_types = [
        GemLevel::Small,
        GemLevel::Medium,
        GemLevel::Large,
        GemLevel::Huge,
        GemLevel::Fries,
        GemLevel::Dice,
        GemLevel::BoosterPack,
    ];
    let random_index = rng.gen_range(0..gem_types.len());
    let lootdrop_id = gem_types[random_index].clone();
    
    // Schedule the loot capsule to spawn in 1 second
    const CAPSULE_DELAY_MS: u64 = 1000;
    
    let capsule = ctx.db.loot_capsules().insert(LootCapsules {
        capsule_id: 0,
        start_position,
        end_position: clamped_end_position,
        lootdrop_id: lootdrop_id.clone(),
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CAPSULE_DELAY_MS)),
    });
    
    log::info!(
        "Debug: Scheduled LootCapsule {} for player {} ({}) - Start: ({:.1}, {:.1}), End: ({:.1}, {:.1}), Gem: {:?}, Arrives in {}ms",
        capsule.capsule_id,
        player.name,
        player.player_id,
        start_position.x,
        start_position.y,
        clamped_end_position.x,
        clamped_end_position.y,
        lootdrop_id,
        CAPSULE_DELAY_MS
    );
}

// Helper function to select a weighted random gem type for VoidChest loot
// About 25% special items, with food and dice being common, booster packs rarer
fn select_weighted_gem_type(rng: &mut impl Rng) -> GemLevel {
    let roll = rng.gen_range(1..=100);
    
    match roll {
        // Regular gems (75% total)
        1..=20 => GemLevel::Small,     // 35% chance
        21..=35 => GemLevel::Medium,   // 20% chance  
        36..=45 => GemLevel::Large,    // 15% chance
        46..=50 => GemLevel::Huge,     // 5% chance
        
        // Special items (25% total) 
        51..=70 => GemLevel::Fries,    // 12% chance (food is common)
        71..=90 => GemLevel::Dice,     // 9% chance (dice is common)
        91..=100 => GemLevel::BoosterPack, // 4% chance (booster packs are rarer)
        
        _ => GemLevel::Small, // Fallback (shouldn't happen)
    }
}

// Helper function to spawn a single LootCapsule from start position to a random position within radius
fn spawn_loot_capsule_in_radius(
    ctx: &ReducerContext, 
    start_position: DbVector2, 
    radius: f32,
    gem_type: GemLevel
) {
    let mut rng = ctx.rng();
    
    // Generate random position within radius
    let distance = rng.gen_range(MIN_RADIUS..radius);
    let angle = rng.gen_range(0.0..(2.0 * std::f32::consts::PI));
    
    let end_position = DbVector2::new(
        start_position.x + distance * angle.cos(),
        start_position.y + distance * angle.sin(),
    );
    
    // Get world boundaries from config and clamp position
    let config = ctx.db.config().id().find(&0);
    let world_size = if let Some(config) = config {
        config.world_size as f32
    } else {
        6400.0 // Default world size
    };
    
    let margin = 100.0; // Margin from world edge
    let clamped_end_position = DbVector2::new(
        end_position.x.clamp(margin, world_size - margin),
        end_position.y.clamp(margin, world_size - margin)
    );
    
    // Create the loot capsule
    let capsule = ctx.db.loot_capsules().insert(LootCapsules {
        capsule_id: 0,
        start_position,
        end_position: clamped_end_position,
        lootdrop_id: gem_type.clone(),
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CAPSULE_FLIGHT_DURATION_MS)),
    });
    
    log::info!(
        "VoidChest pinata: Spawned LootCapsule {} with {:?} gem from ({:.1}, {:.1}) to ({:.1}, {:.1})",
        capsule.capsule_id,
        gem_type,
        start_position.x,
        start_position.y,
        clamped_end_position.x,
        clamped_end_position.y
    );
}

// Public function to trigger VoidChest damage pinata (called when VoidChest takes damage)
pub fn trigger_void_chest_damage_pinata(ctx: &ReducerContext, chest_position: DbVector2) {
    let mut rng = ctx.rng();
    
    // Check if we should spawn a capsule (15% chance per damage tick)
    let roll = rng.gen_range(0.0..1.0);
    if roll <= VOID_CHEST_DAMAGE_CAPSULE_CHANCE {
        let gem_type = select_weighted_gem_type(&mut rng);
        spawn_loot_capsule_in_radius(ctx, chest_position, MODERATE_RADIUS, gem_type);
        
        log::info!("VoidChest damage pinata triggered at ({:.1}, {:.1})", chest_position.x, chest_position.y);
    }
}

// Public function to trigger VoidChest death pinata (called when VoidChest is destroyed)
pub fn trigger_void_chest_death_pinata(ctx: &ReducerContext, chest_position: DbVector2) {
    let mut rng = ctx.rng();
    
    log::info!("VoidChest death pinata triggered! Spawning {} capsules around ({:.1}, {:.1})", 
              VOID_CHEST_DEATH_CAPSULE_COUNT, chest_position.x, chest_position.y);
    
    // Spawn multiple capsules in a larger area
    for i in 0..VOID_CHEST_DEATH_CAPSULE_COUNT {
        let gem_type = select_weighted_gem_type(&mut rng);
        
        if i == 0 {
            log::info!("First death capsule: {:?} gem", gem_type);
        }
        
        spawn_loot_capsule_in_radius(ctx, chest_position, LARGE_RADIUS, gem_type);
    }
    
    log::info!("VoidChest death pinata complete - {} capsules spawned", VOID_CHEST_DEATH_CAPSULE_COUNT);
}

// Function to schedule guaranteed VoidChest spawns at game start
pub fn schedule_guaranteed_void_chest_spawns(ctx: &ReducerContext) {
    log::info!("Scheduling guaranteed VoidChest spawns...");
    
    // Schedule first guaranteed VoidChest at 90 seconds
    ctx.db.guaranteed_void_chest_spawns().insert(GuaranteedVoidChestSpawn {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(90)),
    });
    
    // Schedule second guaranteed VoidChest at 180 seconds (3 minutes)
    ctx.db.guaranteed_void_chest_spawns().insert(GuaranteedVoidChestSpawn {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(180)),
    });
    
    log::info!("Guaranteed VoidChest spawns scheduled for 90s and 180s");
}

// Function to clean up any pending guaranteed VoidChest spawns (called during world reset)
pub fn cleanup_guaranteed_void_chest_spawns(ctx: &ReducerContext) {
    log::info!("Cleaning up pending guaranteed VoidChest spawns...");
    
    // Delete all pending guaranteed void chest spawns
    let spawns: Vec<_> = ctx.db.guaranteed_void_chest_spawns().iter().collect();
    for spawn in spawns {
        ctx.db.guaranteed_void_chest_spawns().scheduled_id().delete(&spawn.scheduled_id);
    }
    
    log::info!("Guaranteed VoidChest spawns cleanup complete");
} 