use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, config, player, bestiary, monsters, monsters_boid, MonsterSpawners};
use std::time::Duration;

// Configuration constants for EnderClaw spawning
const ENDER_CLAW_INITIAL_INTERVAL_MS: u64 = 6000;   // Start spawning every 6 seconds
const ENDER_CLAW_MIN_INTERVAL_MS: u64 = 2000;       // Minimum spawn interval (2 seconds)
const ENDER_CLAW_INTERVAL_REDUCTION_RATIO: f32 = 0.85; // Reduce interval by 15% each wave (multiply by 0.85)
const ENDER_CLAW_PRE_SPAWN_DELAY_MS: u64 = 1000;   // Reduced pre-spawn delay (1 second)

// Scheduled table for EnderClaw spawning during Phase 2 boss fights
#[table(name = ender_claw_spawner, scheduled(spawn_ender_claw_wave), public)]
pub struct EnderClawSpawner {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The Phase 2 boss ID
    pub spawn_interval_ms: u64,   // Current spawn interval (decreases over time)
    pub scheduled_at: ScheduleAt, // When to spawn the next wave
}

// Reducer to spawn a wave of EnderClaws (one per player)
#[reducer]
pub fn spawn_ender_claw_wave(ctx: &ReducerContext, spawner: EnderClawSpawner) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_ender_claw_wave may not be invoked by clients, only via scheduling.");
    }

    // Check if the Phase 2 boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&spawner.boss_monster_id);
    let boss = match boss_opt {
        Some(monster) => monster,
        None => {
            log::info!("Phase 2 boss {} no longer exists, stopping EnderClaw spawning", spawner.boss_monster_id);
            return;
        }
    };

    // Verify this is actually a Phase 2 boss
    if boss.bestiary_id != MonsterType::FinalBossPhase2 {
        log::info!("Boss {} is not Phase 2, stopping EnderClaw spawning", spawner.boss_monster_id);
        return;
    }

    // Get all active players
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    
    if player_count == 0 {
        log::info!("No players online, skipping EnderClaw spawn wave");
        schedule_next_ender_claw_wave(ctx, spawner.boss_monster_id, spawner.spawn_interval_ms);
        return;
    }

    log::info!("Spawning EnderClaw wave: {} EnderClaws for {} players (interval: {}ms)", 
              player_count, player_count, spawner.spawn_interval_ms);

    // Spawn one EnderClaw per player
    for player in players {
        spawn_single_ender_claw(ctx, &player);
    }

    // Schedule the next wave with reduced interval
    schedule_next_ender_claw_wave(ctx, spawner.boss_monster_id, spawner.spawn_interval_ms);
}

// Helper function to spawn a single EnderClaw near a player
fn spawn_single_ender_claw(ctx: &ReducerContext, target_player: &crate::Player) {
    // Get EnderClaw stats from bestiary
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::EnderClaw as u32))
        .expect("spawn_single_ender_claw: Could not find bestiary entry for EnderClaw");

    // Calculate spawn position near the target player (150-250 pixels away) - closer for more threat
    let mut rng = ctx.rng();
    let spawn_distance = 150.0 + (rng.gen::<f32>() * 100.0); // 150-250 pixels from player (reduced from 300-600)
    let spawn_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0; // Random angle

    let mut spawn_position = DbVector2::new(
        target_player.position.x + spawn_distance * spawn_angle.cos(),
        target_player.position.y + spawn_distance * spawn_angle.sin()
    );

    // Get world boundaries from config
    let config = ctx.db.config().id().find(&0)
        .expect("spawn_single_ender_claw: Could not find game configuration!");
    
    // Clamp to world boundaries using monster radius
    let monster_radius = bestiary_entry.radius;
    spawn_position.x = spawn_position.x.clamp(monster_radius, config.world_size as f32 - monster_radius);
    spawn_position.y = spawn_position.y.clamp(monster_radius, config.world_size as f32 - monster_radius);

    // Create a pre-spawner with reduced delay
    crate::monsters_def::create_monster_spawner(
        ctx,
        spawn_position,
        MonsterType::EnderClaw,
        ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_CLAW_PRE_SPAWN_DELAY_MS))
    );

    log::info!("Pre-spawned EnderClaw for player {} at position ({:.1}, {:.1})", 
              target_player.name, spawn_position.x, spawn_position.y);
}

// Helper function to schedule the next EnderClaw wave with interval reduction
fn schedule_next_ender_claw_wave(ctx: &ReducerContext, boss_monster_id: u32, current_interval_ms: u64) {
    // Calculate next interval (reduce by 15% each wave, but don't go below minimum)
    let next_interval_ms = ((current_interval_ms as f32 * ENDER_CLAW_INTERVAL_REDUCTION_RATIO) as u64)
        .max(ENDER_CLAW_MIN_INTERVAL_MS);

    // Schedule the next wave
    ctx.db.ender_claw_spawner().insert(EnderClawSpawner {
        scheduled_id: 0,
        boss_monster_id,
        spawn_interval_ms: next_interval_ms,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(next_interval_ms)),
    });

    log::info!("Scheduled next EnderClaw wave for boss {} in {}ms (reduced from {}ms)", 
              boss_monster_id, next_interval_ms, current_interval_ms);
}

// Function to start EnderClaw spawning when Phase 2 boss is spawned
pub fn start_ender_claw_spawning(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Starting EnderClaw spawning for Phase 2 boss {}", boss_monster_id);

    // Schedule the first EnderClaw wave after a brief delay
    ctx.db.ender_claw_spawner().insert(EnderClawSpawner {
        scheduled_id: 0,
        boss_monster_id,
        spawn_interval_ms: ENDER_CLAW_INITIAL_INTERVAL_MS,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_CLAW_INITIAL_INTERVAL_MS)),
    });

    log::info!("EnderClaw spawning scheduled for boss {} (first wave in {}ms)", 
              boss_monster_id, ENDER_CLAW_INITIAL_INTERVAL_MS);
}

// Function to cleanup EnderClaw spawning schedules when Phase 2 boss is defeated
pub fn cleanup_ender_claw_spawning(ctx: &ReducerContext, boss_monster_id: u32) {
    // Find and delete all scheduled EnderClaw spawners for this boss
    let spawners_to_delete: Vec<u64> = ctx.db.ender_claw_spawner()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|spawner| spawner.scheduled_id)
        .collect();
    
    let spawner_count = spawners_to_delete.len();
    
    for scheduled_id in spawners_to_delete {
        ctx.db.ender_claw_spawner().scheduled_id().delete(&scheduled_id);
    }

    if spawner_count > 0 {
        log::info!("Cleaned up {} EnderClaw spawners for boss {}", spawner_count, boss_monster_id);
    }
} 