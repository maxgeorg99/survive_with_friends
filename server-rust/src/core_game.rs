use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType};
use crate::{DbVector2, GameTickTimer, DeadPlayer, MonsterType, monsters_def, gems_def, boss_system, reset_world, 
    monster_damage, monsters, monsters_boid, player, attack_utils, game_state, dead_players, active_attacks,
    attack_burst_cooldowns, player_scheduled_attacks, active_attack_cleanup, entity, config, class_data, world,
    game_tick_timer, loot_capsule_defs, monster_attacks_def};
use std::time::Duration;

static mut ERROR_FLAG: bool = false;

// Helper function to remove all damage records for a given attack entity
fn cleanup_attack_damage_records(ctx: &ReducerContext, attack_entity_id: u32) {
    let damage_records: Vec<_> = ctx.db.monster_damage().attack_entity_id().filter(&attack_entity_id).collect();
    
    // Delete all found damage records
    for damage_record in damage_records {
        ctx.db.monster_damage().damage_id().delete(&damage_record.damage_id);
    }
}

// Helper function to remove all damage records for a given monster
fn cleanup_monster_damage_records(ctx: &ReducerContext, monster_id: u32) {
    let damage_records: Vec<_> = ctx.db.monster_damage().monster_id().filter(&monster_id).collect();
    
    // Delete all found damage records
    for damage_record in damage_records {
        ctx.db.monster_damage().damage_id().delete(&damage_record.damage_id);
    }
}

// Helper function to damage a monster
// Returns true if the monster died, false otherwise
pub fn damage_monster(ctx: &ReducerContext, monster_id: u32, damage_amount: u32) -> bool {
    // Find the monster
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    let mut monster = match monster_opt {
        Some(monster) => monster,
        None => return false,
    };
    
    // Get the monster's position from boid (we'll need this for pinata logic)
    let boid_opt = ctx.db.monsters_boid().monster_id().find(&monster_id);
    let position = match boid_opt {
        Some(boid) => boid.position,
        None => {
            panic!("Monster {} has no boid record!", monster.monster_id);
        }
    };
    
    // Check if this is a VoidChest for pinata logic
    let is_void_chest = monster.bestiary_id == MonsterType::VoidChest;
    
    // Make sure we don't underflow
    if monster.hp <= damage_amount {
        // Monster is dead - log and delete
        //Log::info(&format!("Monster {} (type: {:?}) was killed!", monster.monster_id, monster.bestiary_id));
        
        // VoidChest death pinata - spawn multiple loot capsules in a large area
        if is_void_chest {
            log::info!("VoidChest {} destroyed! Triggering death pinata at ({:.1}, {:.1})", 
                      monster.monster_id, position.x, position.y);
            loot_capsule_defs::trigger_void_chest_death_pinata(ctx, position);
        }
        
        // Clean up any monster damage records for this monster
        cleanup_monster_damage_records(ctx, monster_id);
        
        // Check if this is a boss monster
        let mut is_boss = false;
        if let Some(game_state) = ctx.db.game_state().id().find(&0) {
            if game_state.boss_active && game_state.boss_monster_id == monster_id {
                is_boss = true;
                log::info!("BOSS MONSTER CONFIRMED: ID={}, Phase={}, Monster Type: {:?}",
                    monster_id, game_state.boss_phase, monster.bestiary_id);
                
                // Handle based on boss phase
                if game_state.boss_phase == 1 {
                    log::info!("BOSS PHASE 1 DEFEATED! TRANSITIONING TO PHASE 2...");
                    log::info!("Phase 1 details - Monster ID: {}, Position: ({}, {})",
                        monster.monster_id, position.x, position.y);
                    
                    // Store the entity ID and position before deletion
                    let boss_position = position;
                    
                    // Spawn phase 2 first, before deleting phase 1 monster
                    log::info!("Calling spawn_boss_phase_two now...");
                    crate::boss_system::spawn_boss_phase_two(ctx, boss_position);
                    log::info!("spawn_boss_phase_two completed successfully");
                    
                    // Only after successful spawn of phase 2, delete phase 1
                    ctx.db.monsters().monster_id().delete(&monster_id);
                    ctx.db.monsters_boid().monster_id().delete(&monster_id);
                    log::info!("Phase 1 boss monster and entity deleted after phase 2 spawned");
                    
                    // Verify phase 2 boss was created
                    log::info!("Verifying phase 2 boss was created:");
                    let game_state_after = ctx.db.game_state().id().find(&0).unwrap();
                    log::info!("Game state after transition - Phase: {}, BossActive: {}, BossMonsterID: {}",
                        game_state_after.boss_phase, game_state_after.boss_active, game_state_after.boss_monster_id);

                    // Verify the new boss monster exists
                    if let Some(phase2_boss) = ctx.db.monsters().monster_id().find(&game_state_after.boss_monster_id) {
                        log::info!("Phase 2 boss verified: Monster ID={}", phase2_boss.monster_id);
                    } else {
                        log::info!("ERROR: Phase 2 boss with ID {} not found in monsters table!",
                            game_state_after.boss_monster_id);
                    }

                    if game_state_after.boss_phase != 2 {
                        log::info!("ERROR: Game state still shows phase 1 after transition!");
                    }

                    return true;
                } else if game_state.boss_phase == 2 {
                    // Phase 2 boss defeated - VICTORY!
                    log::info!("BOSS PHASE 2 DEFEATED! GAME COMPLETE!");
                    
                    // Delete the monster and entity
                    ctx.db.monsters().monster_id().delete(&monster_id);
                    ctx.db.monsters_boid().monster_id().delete(&monster_id);
                    
                    // Handle boss defeated (true victory!)
                    crate::boss_system::handle_boss_defeated(ctx);
                    
                    return true;
                } else {
                    log::info!("WARNING: Boss killed but phase is unexpected: {}", game_state.boss_phase);
                }
            }
        }
        
        // For non-boss monsters or if game state not found, spawn a gem
        if !is_boss {
            // Spawn a gem at the monster's position (but not for VoidChest since it already spawned capsules)
            if !is_void_chest {
                let cache = crate::monsters_def::get_collision_cache();
                crate::gems_def::spawn_gem_on_monster_death(ctx, monster_id, position, cache);
            }
            
            // Delete the monster
            ctx.db.monsters().monster_id().delete(&monster_id);
            ctx.db.monsters_boid().monster_id().delete(&monster_id);
        }
        
        true
    } else {
        // Monster is still alive, update with reduced HP
        monster.hp -= damage_amount;
        ctx.db.monsters().monster_id().update(monster);
        
        // VoidChest damage pinata - chance to spawn a loot capsule when damaged
        if is_void_chest {
            loot_capsule_defs::trigger_void_chest_damage_pinata(ctx, position);
        }
        
        false
    }
}

//Helper function to damage a player
//Returns true if the player is dead, false otherwise
pub fn damage_player(ctx: &ReducerContext, player_id: u32, damage_amount: f32) -> bool {
    // Find the player
    let player_opt = ctx.db.player().player_id().find(&player_id);
    let mut player = match player_opt {
        Some(player) => player,
        None => {
            unsafe { ERROR_FLAG = true; }
            panic!("DamagePlayer: Player {} does not exist.", player_id);
        }
    };
    
    if player.spawn_grace_period_remaining > 0 {
        // Player is still in spawn grace period - don't take damage
        return false;
    }
    
    // Apply armor damage reduction
    // Formula: DR = armor/(armor+3)
    // At 3 armor, they take 50% damage
    // At 6 armor, they take 33% damage
    let mut reduced_damage = damage_amount;
    if player.armor > 0 {
        let damage_reduction = player.armor as f32 / (player.armor as f32 + 3.0);
        let remaining_damage_percent = 1.0 - damage_reduction;
        reduced_damage = damage_amount * remaining_damage_percent;
    }
    
    // Make sure we don't underflow
    if player.hp <= reduced_damage {
        
        // Log the death
        log::info!("Player {} (ID: {}) has died!", player.name, player.player_id);
        
        // Create a Soul gem worth 25% of the player's experience at their death location
        // Ensure minimum value of 1 exp
        let soul_gem_value = std::cmp::max(1, (player.exp as f32 * 0.25) as u32);
        crate::gems_def::create_soul_gem(ctx, player.position, soul_gem_value);
        log::info!("Created Soul gem worth {} exp at player {}'s death location", soul_gem_value, player.name);
        
        // Store the player in the dead_players table before removing them
        let _dead_player_opt = ctx.db.dead_players().insert(DeadPlayer {
            player_id: player.player_id,
            name: player.name.clone(),
            is_true_survivor: false,
        });

        log::info!("Player {} (ID: {}) moved to dead_players table.", player.name, player.player_id);
        
        // Transition the account to dead state and schedule return to character select
        crate::transition_player_to_dead_state(ctx, player_id);
        
        // Clean up all attack-related data for this player
        cleanup_player_attacks(ctx, player_id);
        
        // Clean up all pending upgrade options for this player
        cleanup_player_upgrade_options(ctx, player_id);
        
        // Delete the player and their entity
        // Note: The client will detect this deletion through the onDelete handler

        //Delete the player from the player table
        ctx.db.player().player_id().delete(&player_id);
        
        // Check if all players are now dead
        if ctx.db.player().count() == 0 {
            log::info!("Last player has died! Resetting the game world...");
            crate::reset_world::reset_world(ctx);
        }

        true
    } else {
        // Player is still alive, update with reduced HP
        player.hp -= reduced_damage;
        ctx.db.player().player_id().update(player);

        false
    }
}

// Helper method to clean up all attack-related data for a player
pub fn cleanup_player_attacks(ctx: &ReducerContext, player_id: u32) {
    log::info!("Cleaning up all attack data for player {}", player_id);
    
    // Step 1: Clean up active attacks using filter on player_id
    let mut active_attacks_to_delete = Vec::new();
    let mut attack_entities_to_delete = Vec::new();
    
    // Use player_id filter on active_attacks if BTree index exists
    for active_attack in ctx.db.active_attacks().player_id().filter(&player_id) {
        active_attacks_to_delete.push(active_attack.active_attack_id);
        attack_entities_to_delete.push(active_attack.entity_id);
        
        // Clean up any damage records associated with this attack
        cleanup_attack_damage_records(ctx, active_attack.entity_id);
    }
    
    // Delete the active attacks
    for attack_id in &active_attacks_to_delete {
        ctx.db.active_attacks().active_attack_id().delete(attack_id);
    }
    
    // Delete the attack entities
    for entity_id in &attack_entities_to_delete {
        ctx.db.entity().entity_id().delete(entity_id);
    }
    
    log::info!("Deleted {} active attacks and their associated entities for player {}", 
             active_attacks_to_delete.len(), player_id);
    
    // Step 2: Clean up attack burst cooldowns using filter on player_id
    let mut burst_cooldowns_to_delete = Vec::new();
    
    for burst_cooldown in ctx.db.attack_burst_cooldowns().player_id().filter(&player_id) {
        burst_cooldowns_to_delete.push(burst_cooldown.scheduled_id);
    }
    
    // Delete the burst cooldowns
    for scheduled_id in &burst_cooldowns_to_delete {
        ctx.db.attack_burst_cooldowns().scheduled_id().delete(scheduled_id);
    }
    
    log::info!("Deleted {} attack burst cooldowns for player {}", 
             burst_cooldowns_to_delete.len(), player_id);
    
    // Step 3: Clean up scheduled attacks using filter on player_id
    let mut scheduled_attacks_to_delete = Vec::new();
    
    for scheduled_attack in ctx.db.player_scheduled_attacks().player_id().filter(&player_id) {
        scheduled_attacks_to_delete.push(scheduled_attack.scheduled_id);
    }
    
    // Delete the scheduled attacks
    for scheduled_id in &scheduled_attacks_to_delete {
        ctx.db.player_scheduled_attacks().scheduled_id().delete(scheduled_id);
    }
    
    log::info!("Deleted {} scheduled attacks for player {}", 
             scheduled_attacks_to_delete.len(), player_id);
    
    // Step 4: Clean up active attack cleanup schedules
    // We need to do this more efficiently using the attackIDs we already collected
    if !active_attacks_to_delete.is_empty() {
        let mut attack_cleanups_to_delete = Vec::new();
        
        // Process cleanup entries in batches for better performance
        for attack_id in &active_attacks_to_delete {
            // Filter by active_attack_id if available as an index
            for cleanup in ctx.db.active_attack_cleanup().active_attack_id().filter(attack_id) {
                attack_cleanups_to_delete.push(cleanup.scheduled_id);
            }
        }
        
        // Delete the attack cleanups
        for scheduled_id in &attack_cleanups_to_delete {
            ctx.db.active_attack_cleanup().scheduled_id().delete(scheduled_id);
        }
        
        log::info!("Deleted {} attack cleanup schedules for player {}", 
                 attack_cleanups_to_delete.len(), player_id);
    }
}

// Helper method to clean up all pending upgrade options for a player
fn cleanup_player_upgrade_options(ctx: &ReducerContext, player_id: u32) {
    crate::upgrades_def::cleanup_player_upgrade_options(ctx, player_id);
}

fn clear_collision_cache_for_frame() {
    let cache = crate::monsters_def::get_collision_cache();
    cache.clear_for_frame();
}

fn process_player_movement(ctx: &ReducerContext, tick_rate: u32) {
    let collision_cache = crate::monsters_def::get_collision_cache();
    crate::player_def::process_player_movement(ctx, tick_rate, collision_cache);
}

fn process_monster_movements(ctx: &ReducerContext) {
    crate::monsters_def::process_monster_movements(ctx);
}

fn process_attack_movements(ctx: &ReducerContext) {
    crate::attacks_def::process_attack_movements(ctx);
}

fn process_monster_attack_movements(ctx: &ReducerContext) {
    crate::monster_attacks_def::process_monster_attack_movements(ctx);
}

fn maintain_gems(ctx: &ReducerContext) {
    let cache = crate::monsters_def::get_collision_cache();
    crate::gems_def::maintain_gems(ctx, cache);
}

fn process_player_monster_collisions_spatial_hash(ctx: &ReducerContext) {
    let collision_cache = crate::monsters_def::get_collision_cache();
    crate::player_def::process_player_monster_collisions_spatial_hash(ctx, collision_cache);
}

fn process_player_attack_monster_collisions_spatial_hash(ctx: &ReducerContext) {
    crate::monsters_def::process_player_attack_monster_collisions_spatial_hash(ctx);
}

fn process_monster_attack_collisions_spatial_hash(ctx: &ReducerContext) {
    crate::monster_attacks_def::process_monster_attack_collisions_spatial_hash(ctx);
}

fn process_player_attack_collisions_spatial_hash(ctx: &ReducerContext) {
    crate::attacks_def::process_player_attack_collisions_spatial_hash(ctx);
}

fn commit_player_damage(ctx: &ReducerContext) {
    let collision_cache = crate::monsters_def::get_collision_cache();
    crate::player_def::commit_player_damage(ctx, collision_cache);
}

fn process_gem_collisions_spatial_hash(ctx: &ReducerContext) {
    let collision_cache = crate::monsters_def::get_collision_cache();
    crate::gems_def::process_gem_collisions_spatial_hash(ctx, collision_cache);
}

#[reducer]
pub fn game_tick(ctx: &ReducerContext, _timer: GameTickTimer) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer GameTick may not be invoked by clients, only via scheduling.");
    }

    // Get current timestamp for timing measurements
    let current_timestamp = ctx.timestamp;

    // Get world configuration
    let mut tick_rate = 50;
    if let Some(config) = ctx.db.config().id().find(&0) {
        tick_rate = config.game_tick_rate;
    }

    if let Some(world) = ctx.db.world().world_id().find(&0) {
        let mut world = world;
        world.tick_count += 1;
        
        // Calculate time since last tick using Timestamp
        let mut time_since_last_tick_ms = tick_rate as f64; // Default to config tick rate
        
        if world.timing_samples_collected > 0 {
            // Get the last tick timestamp from world data
            let last_tick_timestamp = world.last_tick_time;
            
            // Calculate time difference using SpacetimeDB's duration_since method
            if let Some(time_duration) = current_timestamp.duration_since(last_tick_timestamp) {
                // Convert microseconds to milliseconds
                time_since_last_tick_ms = time_duration.as_millis() as f64;
                
                // Update timing stats
                if world.timing_samples_collected == 1 {
                    // First real measurement
                    world.min_tick_ms = time_since_last_tick_ms;
                    world.max_tick_ms = time_since_last_tick_ms;
                    world.average_tick_ms = time_since_last_tick_ms;
                } else {
                    // Update min/max if needed
                    if time_since_last_tick_ms < world.min_tick_ms {
                        world.min_tick_ms = time_since_last_tick_ms;
                    }
                    if time_since_last_tick_ms > world.max_tick_ms {
                        world.max_tick_ms = time_since_last_tick_ms;
                    }
                    
                    // Calculate rolling average (weighted toward more recent samples)
                    // Use a weight of 0.1 for new samples to smooth out the average
                    world.average_tick_ms = (world.average_tick_ms * 0.9) + (time_since_last_tick_ms * 0.1);
                }
            } else {
                // duration_since returned None, meaning current_timestamp is before last_tick_timestamp
                // This shouldn't normally happen, but if it does, use the configured tick rate
                log::warn!("Clock went backwards! Using configured tick rate as fallback.");
                time_since_last_tick_ms = tick_rate as f64;
            }
        }
        
        // Update timestamp for next tick
        world.last_tick_time = current_timestamp;
        world.timing_samples_collected += 1;
        
        // Log timing information every 200 ticks
        if world.tick_count % 200 == 0 {
            log::info!("Game tick: {} | Avg: {:.2}ms | Current: {:.2}ms | Min: {:.2}ms | Max: {:.2}ms", 
                     world.tick_count, world.average_tick_ms, time_since_last_tick_ms, 
                     world.min_tick_ms, world.max_tick_ms);
        }
        
        ctx.db.world().world_id().update(world);
    }
    
    // Schedule the next game tick as a one-off event
    ctx.db.game_tick_timer().insert(GameTickTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(tick_rate as u64)),
    });

    clear_collision_cache_for_frame();

    process_player_movement(ctx, tick_rate);

    process_monster_movements(ctx);

    process_attack_movements(ctx);

    process_monster_attack_movements(ctx);

    maintain_gems(ctx);

    process_player_monster_collisions_spatial_hash(ctx);

    process_player_attack_monster_collisions_spatial_hash(ctx);

    process_monster_attack_collisions_spatial_hash(ctx);

    process_player_attack_collisions_spatial_hash(ctx);

    crate::monsters_def::commit_monster_damage(ctx);

    commit_player_damage(ctx);

    process_gem_collisions_spatial_hash(ctx);
} 