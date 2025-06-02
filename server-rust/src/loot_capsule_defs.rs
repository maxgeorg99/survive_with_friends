use spacetimedb::{table, reducer, Table, ReducerContext, ScheduleAt, rand::Rng};
use crate::{DbVector2, GemLevel, account, player, config, gems_def};
use std::time::Duration;

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

// Debug reducer to schedule a loot capsule near the calling player
#[reducer]
pub fn spawn_debug_loot_capsule(ctx: &ReducerContext) {
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
    
    // Schedule the loot capsule to spawn in 3 seconds
    const CAPSULE_DELAY_MS: u64 = 3000;
    
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