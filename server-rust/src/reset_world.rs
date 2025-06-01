use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};
use crate::{entity, monsters, monsters_boid, gems, monster_spawners, boss_spawn_timer, game_state, monster_spawn_timer, monster_hit_cleanup, active_attack_cleanup, attack_burst_cooldowns, player_scheduled_attacks, monster_damage, player, upgrade_options, active_attacks};

// ResetWorld reducer - clears all monsters, gems, monster spawners, and resets boss state
// This should be called when the last player dies
#[reducer]
pub fn reset_world(ctx: &ReducerContext) {
    log::info!("ResetWorld: Resetting game world after all players died");

    // Verify that no players are alive
    let player_count = ctx.db.player().count();
    if player_count > 0 {
        log::info!("ResetWorld: Canceled reset because {} players are still alive", player_count);
        return;
    }

    // 1. Clear all monsters
    let mut monster_count = 0;
    
    let monsters_to_delete: Vec<u32> = ctx.db.monsters().iter().map(|m| m.monster_id).collect();
    for monster_id in monsters_to_delete {
        ctx.db.monsters().monster_id().delete(&monster_id);
        ctx.db.monsters_boid().monster_id().delete(&monster_id);
        monster_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} monsters", monster_count);
    
    // 2. Clear all gems
    let mut gem_count = 0;
    let mut gem_entity_ids = Vec::new();
    
    for gem in ctx.db.gems().iter() {
        gem_entity_ids.push(gem.entity_id);
        ctx.db.gems().gem_id().delete(&gem.gem_id);
        gem_count += 1;
    }
    
    // Delete gem entities
    for entity_id in gem_entity_ids {
        ctx.db.entity().entity_id().delete(&entity_id);
    }
    
    log::info!("ResetWorld: Cleared {} gems", gem_count);
    
    // 3. Clear all monster spawners
    let mut spawner_count = 0;
    
    let spawners_to_delete: Vec<u64> = ctx.db.monster_spawners().iter().map(|s| s.scheduled_id).collect();
    for scheduled_id in spawners_to_delete {
        ctx.db.monster_spawners().scheduled_id().delete(&scheduled_id);
        spawner_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} monster spawners", spawner_count);
    
    // 4. Clear boss spawn timer
    let mut boss_timer_count = 0;
    
    let boss_timers_to_delete: Vec<u64> = ctx.db.boss_spawn_timer().iter().map(|t| t.scheduled_id).collect();
    for scheduled_id in boss_timers_to_delete {
        ctx.db.boss_spawn_timer().scheduled_id().delete(&scheduled_id);
        boss_timer_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} boss spawn timers", boss_timer_count);
    
    // 5. Reset game state (boss status)
    if let Some(mut game_state) = ctx.db.game_state().id().find(&0) {
        game_state.boss_active = false;
        game_state.boss_phase = 0;
        game_state.boss_monster_id = 0;
        game_state.normal_spawning_paused = false;
        ctx.db.game_state().id().update(game_state);
        
        log::info!("ResetWorld: Reset game state (boss status)");
    }
    
    // 6. Clear the monster spawn timer
    let mut monster_timer_count = 0;
    
    let monster_timers_to_delete: Vec<u64> = ctx.db.monster_spawn_timer().iter().map(|t| t.scheduled_id).collect();
    for scheduled_id in monster_timers_to_delete {
        ctx.db.monster_spawn_timer().scheduled_id().delete(&scheduled_id);
        monster_timer_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} monster spawn timers", monster_timer_count);
    
    // 7. Clean up monster hit cleanup records
    let mut monster_hit_cleanup_count = 0;
    let cleanup_to_delete: Vec<u64> = ctx.db.monster_hit_cleanup().iter().map(|c| c.scheduled_id).collect();
    for scheduled_id in cleanup_to_delete {
        ctx.db.monster_hit_cleanup().scheduled_id().delete(&scheduled_id);
        monster_hit_cleanup_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} monster hit cleanup records", monster_hit_cleanup_count);
    
    // 8. Clean up active attack cleanup records
    let mut active_attack_cleanup_count = 0;
    let attack_cleanup_to_delete: Vec<u64> = ctx.db.active_attack_cleanup().iter().map(|c| c.scheduled_id).collect();
    for scheduled_id in attack_cleanup_to_delete {
        ctx.db.active_attack_cleanup().scheduled_id().delete(&scheduled_id);
        active_attack_cleanup_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} active attack cleanup records", active_attack_cleanup_count);
    
    // 9. Clean up attack burst cooldowns
    let mut burst_cooldown_count = 0;
    let burst_cooldowns_to_delete: Vec<u64> = ctx.db.attack_burst_cooldowns().iter().map(|c| c.scheduled_id).collect();
    for scheduled_id in burst_cooldowns_to_delete {
        ctx.db.attack_burst_cooldowns().scheduled_id().delete(&scheduled_id);
        burst_cooldown_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} attack burst cooldowns", burst_cooldown_count);
    
    // 10. Clean up player scheduled attacks
    let mut scheduled_attack_count = 0;
    let scheduled_attacks_to_delete: Vec<u64> = ctx.db.player_scheduled_attacks().iter().map(|a| a.scheduled_id).collect();
    for scheduled_id in scheduled_attacks_to_delete {
        ctx.db.player_scheduled_attacks().scheduled_id().delete(&scheduled_id);
        scheduled_attack_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} player scheduled attacks", scheduled_attack_count);
    
    // 11. Clean up any remaining active attacks and their entities
    let mut active_attack_count = 0;
    let mut attack_entity_ids = Vec::new();
    
    for active_attack in ctx.db.active_attacks().iter() {
        attack_entity_ids.push(active_attack.entity_id);
        ctx.db.active_attacks().active_attack_id().delete(&active_attack.active_attack_id);
        active_attack_count += 1;
    }
    
    // Delete attack entities
    for entity_id in attack_entity_ids {
        ctx.db.entity().entity_id().delete(&entity_id);
    }
    
    log::info!("ResetWorld: Cleared {} active attacks and their entities", active_attack_count);
    
    // 12. Clean up any remaining monster damage records
    let mut monster_damage_count = 0;
    let damage_records_to_delete: Vec<u32> = ctx.db.monster_damage().iter().map(|d| d.damage_id).collect();
    for damage_id in damage_records_to_delete {
        ctx.db.monster_damage().damage_id().delete(&damage_id);
        monster_damage_count += 1;
    }
    
    log::info!("ResetWorld: Cleared {} monster damage records", monster_damage_count);

    // 13. Clean up all player upgrade options
    let mut upgrade_options_count = 0;
    let upgrade_options_to_delete: Vec<u32> = ctx.db.upgrade_options().iter().map(|uo| uo.upgrade_id).collect();
    for upgrade_id in upgrade_options_to_delete {
        ctx.db.upgrade_options().upgrade_id().delete(&upgrade_id);
        upgrade_options_count += 1;
    }
    log::info!("ResetWorld: Cleared {} player upgrade options", upgrade_options_count);
    
    // 14. Reschedule monster spawning
    log::info!("Resuming normal monster spawning...");
    
    // Check if monster spawning is already scheduled
    if ctx.db.monster_spawn_timer().count() == 0 {
        // Schedule monster spawning
        crate::monsters_def::schedule_monster_spawning(ctx);
    } else {
        log::info!("Monster spawning already scheduled");
    }
    
    log::info!("ResetWorld: Game world reset completed successfully");
} 