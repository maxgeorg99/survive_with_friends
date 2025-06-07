use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, MAX_MONSTERS, WORLD_SIZE, DELTA_TIME, 
           get_world_cell_from_position, spatial_hash_collision_checker,
           WORLD_CELL_MASK, WORLD_CELL_BIT_SHIFT, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, config, player, game_state, bestiary, ActiveAttack, active_attacks, entity, account};
use crate::monster_ai_defs::AIState;
use std::collections::HashMap;
use std::time::Duration;

// Define which monster types can spawn during normal gameplay (excludes bosses)
const SPAWNABLE_MONSTER_TYPES: &[MonsterType] = &[
    MonsterType::Rat,
    MonsterType::Slime,
    MonsterType::Orc,
    MonsterType::Imp,
    MonsterType::Zombie,
    // Add new normal monster types here as they are created
    // Bosses are excluded from this list to prevent them from spawning randomly
];

// Main monsters table
#[table(name = monsters, public)]
#[derive(Clone)]
pub struct Monsters {
    #[primary_key]
    #[auto_inc]
    pub monster_id: u32,

    // monster attributes
    pub bestiary_id: MonsterType,
    pub hp: u32,
    pub max_hp: u32, // Maximum HP copied from bestiary
    pub atk: f32,
    pub speed: f32,
    pub target_player_id: u32,
    pub ai_state: AIState,  // AI state for boss behaviors
    // entity attributes
    pub radius: f32,
    pub spawn_position: DbVector2,
}

// Monster position/boid table
#[table(name = monsters_boid, public)]
pub struct MonsterBoid {
    #[primary_key]
    pub monster_id: u32,
    pub position: DbVector2,
}

// Timer table for spawning monsters
#[table(name = monster_spawn_timer, scheduled(pre_spawn_monster_wave), public)]
pub struct MonsterSpawnTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// New table for monster spawners (scheduled)
#[table(name = monster_spawners, scheduled(spawn_monster), public)]
pub struct MonsterSpawners {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub position: DbVector2,          // Where the monster will spawn
    pub monster_type: MonsterType,    // The type of monster to spawn
    pub scheduled_at: ScheduleAt,     // When the monster will be spawned
}

// Table to track which monsters have been hit by which attacks
#[table(name = monster_damage, public)]
pub struct MonsterDamage {
    #[primary_key]
    #[auto_inc]
    pub damage_id: u32,
    
    #[index(btree)]
    pub monster_id: u32,       // The monster that was hit

    #[index(btree)]
    pub attack_entity_id: u32, // The attack entity that hit the monster
}

// Scheduled table for monster hit cleanup
#[table(name = monster_hit_cleanup, scheduled(cleanup_monster_hit_record), public)]
pub struct MonsterHitCleanup {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub damage_id: u32,        // The damage record to clean up
    pub scheduled_at: ScheduleAt, // When to clean up the record
}

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

// TODO: Placeholder types for systems not yet ported
// These will be replaced when we port the attacks and other systems

// Global collision cache - this should be a static variable in a real implementation
// For now, we'll pass it as needed or use the collision cache from collision.rs
static mut COLLISION_CACHE: Option<Box<crate::collision::CollisionCache>> = None;

pub fn get_collision_cache() -> &'static mut crate::collision::CollisionCache {
    unsafe {
        if COLLISION_CACHE.is_none() {
            log::info!("Initializing global collision cache for the first time (Boxed)...");
            let mut cache = Box::new(crate::collision::CollisionCache::default());
            cache.player.player_id_to_cache_index.clear();
            cache.monster.key_to_cache_index_monster.clear();
            COLLISION_CACHE = Some(cache);
        }
        COLLISION_CACHE.as_mut().unwrap().as_mut()
    }
}

#[reducer]
pub fn pre_spawn_monster_wave(ctx: &ReducerContext, _timer: MonsterSpawnTimer) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer PreSpawnMonsterWave may not be invoked by clients, only via scheduling.");
    }

    // Get wave size
    let config = ctx.db.config().id().find(&0)
        .expect("PreSpawnMonsterWave: Could not find game configuration!");
    let wave_size = config.monster_wave_size;

    // For each player, spawn a wave of monsters
    let players: Vec<_> = ctx.db.player().iter().collect();
    for _player in players {
        // For each wave size, pre-spawn a monster
        for _i in 0..wave_size {
            pre_spawn_monster(ctx, &_timer);
        }
    }
}

pub fn pre_spawn_monster(ctx: &ReducerContext, _timer: &MonsterSpawnTimer) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer PreSpawnMonster may not be invoked by clients, only via scheduling.");
    }

    // Check if there are any players online
    let player_count = ctx.db.player().count();
    if player_count == 0 {
        //Log::info("PreSpawnMonster: No players online, skipping monster spawn.");
        return;
    }
    
    // Get game configuration
    let config = ctx.db.config().id().find(&0)
        .expect("PreSpawnMonster: Could not find game configuration!");
    
    // Check if boss fight is active - skip normal spawning during boss fights
    if let Some(game_state) = ctx.db.game_state().id().find(&0) {
        if game_state.boss_active || game_state.normal_spawning_paused {
            //Log::info("PreSpawnMonster: Boss fight active, skipping normal monster spawn.");
            return;
        }
    }
    
    // Check if we're at monster capacity
    let monster_count = ctx.db.monsters().count();
    if monster_count >= config.max_monsters as u64 {
        //Log::info(&format!("PreSpawnMonster: At maximum monster capacity ({}/{}), skipping spawn.", monster_count, config.max_monsters));
        return;
    }
    
    // Get a random monster type FROM THE SPAWNABLE LIST (not from all monster types)
    let mut rng = ctx.rng();
    
    // 5% chance to spawn a rare VoidChest instead of regular monsters
    let rare_spawn_roll = rng.gen_range(1..=200);
    let monster_type = if rare_spawn_roll <= 1 {
        // Rare VoidChest spawn (5% chance)
        MonsterType::VoidChest
    } else {
        // Regular monster spawn (95% chance)
        let random_type_index = (rng.gen::<f32>() * SPAWNABLE_MONSTER_TYPES.len() as f32) as usize;
        SPAWNABLE_MONSTER_TYPES[random_type_index].clone()
    };
    
    // Get monster stats from bestiary using the monster type as numerical ID
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster_type.clone() as u32))
        .expect(&format!("PreSpawnMonster: Could not find bestiary entry for monster type: {:?}", monster_type));
    
    // Calculate spawn position
    let mut position = if monster_type == MonsterType::VoidChest {
        // VoidChests spawn randomly across the entire map
        let margin = bestiary_entry.radius + 50.0; // Extra margin for safety
        let spawn_area_size = config.world_size as f32 - (2.0 * margin);
        
        DbVector2::new(
            margin + (rng.gen::<f32>() * spawn_area_size),
            margin + (rng.gen::<f32>() * spawn_area_size)
        )
    } else {
        // Regular monsters spawn near players
        // Choose a random player to spawn near
        let players: Vec<_> = ctx.db.player().iter().collect();
        let random_skip = (rng.gen::<f32>() * players.len() as f32) as usize;
        let target_player = &players[random_skip];
        
        // Calculate spawn position near the player (random direction, within 300-800 pixel radius)
        let spawn_radius = 300.0 + (rng.gen::<f32>() * 501.0); // Distance from player
        let spawn_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0; // Random angle in radians
        
        DbVector2::new(
            target_player.position.x + spawn_radius * spawn_angle.cos(),
            target_player.position.y + spawn_radius * spawn_angle.sin()
        )
    };
    
    // Clamp to world boundaries using monster radius (safety check)
    let monster_radius = bestiary_entry.radius;
    position.x = position.x.clamp(monster_radius, config.world_size as f32 - monster_radius);
    position.y = position.y.clamp(monster_radius, config.world_size as f32 - monster_radius);
    
    // Instead of immediately spawning the monster, schedule it for actual spawning
    // with a delay to give the player time to respond
    const PRE_SPAWN_DELAY_MS: u64 = 2000; // 2 seconds warning before monster spawns
    
    ctx.db.monster_spawners().insert(MonsterSpawners {
        scheduled_id: 0,
        position,
        monster_type,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(PRE_SPAWN_DELAY_MS)),
    });
    
    //Log::info(&format!("PreSpawned {:?} monster for position ({}, {}) for player: {}. Will spawn in {}ms", monster_type, position.x, position.y, target_player.name, PRE_SPAWN_DELAY_MS));
}

#[reducer]
pub fn spawn_monster(ctx: &ReducerContext, spawner: MonsterSpawners) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer SpawnMonster may not be invoked by clients, only via scheduling.");
    }

    // Double-check if there are still players online
    let player_count = ctx.db.player().count();
    if player_count == 0 {
        //Log::info("SpawnMonster: No players online, skipping monster spawn.");
        return;
    }
    
    // Get game configuration
    let config = ctx.db.config().id().find(&0)
        .expect("SpawnMonster: Could not find game configuration!");
    
    // Check if we're at monster capacity (player could have spawned during delay)
    let monster_count = ctx.db.monsters().count();
    if monster_count >= config.max_monsters as u64 && 
       spawner.monster_type != MonsterType::FinalBossPhase1 && 
       spawner.monster_type != MonsterType::FinalBossPhase2 {
        //Log::info(&format!("SpawnMonster: At maximum monster capacity ({}/{}), skipping spawn.", monster_count, config.max_monsters));
        return;
    }
    
    // Get monster stats from bestiary using the monster type as numerical ID
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(spawner.monster_type.clone() as u32))
        .expect(&format!("SpawnMonster: Could not find bestiary entry for monster type: {:?}", spawner.monster_type.clone()));
    
    // Find the closest player to target
    let closest_player_id = get_closest_player(ctx, &spawner.position);
    
    // Determine initial AI state based on monster type
    let initial_ai_state = if spawner.monster_type == MonsterType::FinalBossPhase1 || 
                              spawner.monster_type == MonsterType::FinalBossPhase2 {
        AIState::BossIdle
    } else if spawner.monster_type == MonsterType::VoidChest {
        AIState::Stationary
    } else if spawner.monster_type == MonsterType::EnderClaw {
        AIState::Default  // EnderClaws use normal AI but are fast and aggressive
    } else {
        AIState::Default
    };
    
    // Create the monster
    let monster_opt = ctx.db.monsters().insert(Monsters {
        monster_id: 0,
        bestiary_id: spawner.monster_type.clone(),
        hp: bestiary_entry.max_hp,
        max_hp: bestiary_entry.max_hp,
        atk: bestiary_entry.atk,
        speed: bestiary_entry.speed,
        target_player_id: closest_player_id,
        radius: bestiary_entry.radius,
        spawn_position: spawner.position.clone(),
        ai_state: initial_ai_state,
    });

    let monster = monster_opt;

    // Create the boid
    let _boid_opt = ctx.db.monsters_boid().insert(MonsterBoid {
        monster_id: monster.monster_id,
        position: spawner.position,
    }); 

    //Log::info(&format!("Spawned {:?} monster. Total monsters: {}", spawner.monster_type, ctx.db.monsters().count()));
    
    // If this is a boss monster, update the game state and initialize AI
    if spawner.monster_type.clone() == MonsterType::FinalBossPhase1 || spawner.monster_type.clone() == MonsterType::FinalBossPhase2 {
        log::info!("Boss monster of type {:?} created with ID {}", spawner.monster_type, monster.monster_id);
        crate::boss_system::update_boss_monster_id(ctx, monster.monster_id);
        
        // Initialize boss AI
        crate::monster_ai_defs::initialize_boss_ai(ctx, monster.monster_id);
    }
    
    // If this is an Imp, start its attack schedule
    if spawner.monster_type == MonsterType::Imp {
        crate::monster_attacks_def::start_imp_attack_schedule(ctx, monster.monster_id);
    }
}

pub fn get_closest_player(ctx: &ReducerContext, position: &DbVector2) -> u32 {
    let mut closest_player_id = 0;
    let mut closest_distance = f32::MAX;
    
    for player in ctx.db.player().iter() {
        // Calculate distance to this player
        let dx = player.position.x - position.x;
        let dy = player.position.y - position.y;
        let distance_squared = dx * dx + dy * dy;
        
        // Update closest player if this one is closer
        if distance_squared < closest_distance {
            closest_distance = distance_squared;
            closest_player_id = player.player_id;
        }
    }

    //Pair of closest player and its ordinal index
    closest_player_id
}

// Method to schedule monster spawning - called from Init in Lib.cs
pub fn schedule_monster_spawning(ctx: &ReducerContext) {
    log::info!("Scheduling monster spawning...");
    
    // Schedule monster spawning every 0.2 seconds
    ctx.db.monster_spawn_timer().insert(MonsterSpawnTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(Duration::from_millis(3000).into()),
    });
    
    // Schedule guaranteed VoidChest spawns
    crate::loot_capsule_defs::schedule_guaranteed_void_chest_spawns(ctx);
    
    log::info!("Monster spawning scheduled successfully");
}

pub fn process_monster_movements(ctx: &ReducerContext) {
    let cache = get_collision_cache();
    populate_monster_cache(ctx, cache);
    move_monsters(ctx, cache);
    calculate_monster_spatial_hash_grid(cache);
    solve_monster_repulsion_spatial_hash(cache);
    calculate_monster_spatial_hash_grid(cache);
    commit_monster_motion(ctx, cache);
}

fn move_monsters(ctx: &ReducerContext, cache: &mut crate::collision::CollisionCache) {
    for i in 0..cache.monster.cached_count_monsters {
        let i = i as usize;
        
        // Get cached movement behavior
        let movement_behavior = crate::monster_ai_defs::movement_behavior_from_u8(cache.monster.movement_behavior[i]);
        
        // Check if monster should stand still
        if movement_behavior == crate::monster_ai_defs::MovementBehavior::StandStill {
            continue; // Skip movement for this monster
        }
        
        let dist_x = cache.monster.target_x_monster[i] - cache.monster.pos_x_monster[i];
        let dist_y = cache.monster.target_y_monster[i] - cache.monster.pos_y_monster[i];

        let dist_squared = dist_x * dist_x + dist_y * dist_y;
        let inv_dist = 1.0 / dist_squared.sqrt().max(0.001); // Avoid division by zero

        let norm_x = dist_x * inv_dist;
        let norm_y = dist_y * inv_dist;

        let mut speed = cache.monster.speed_monster[i];
        
        // Check if this is a boss in chase mode and close to target
        if movement_behavior == crate::monster_ai_defs::MovementBehavior::Chase {
            // Check if this is a boss monster
            let monster_id = cache.monster.keys_monster[i];
            let real_monster = ctx.db.monsters().monster_id().find(&monster_id);
            if let Some(monster) = real_monster {
                let monster_type_name = get_monster_type_name(&monster.bestiary_id);
                if monster_type_name == "FinalBossPhase1" || monster_type_name == "FinalBossPhase2" {
                    // Check distance to target for boss monsters
                    let monster_position = DbVector2::new(cache.monster.pos_x_monster[i], cache.monster.pos_y_monster[i]);
                    let target_position = DbVector2::new(cache.monster.target_x_monster[i], cache.monster.target_y_monster[i]);
                    
                    crate::monster_ai_defs::check_boss_chase_distance(ctx, monster_id, &monster_position, &target_position);
                    
                    // Re-check if monster is still in chase mode (might have been changed by check_boss_chase_distance)
                    let updated_monster = ctx.db.monsters().monster_id().find(&monster_id);
                    if let Some(updated_monster) = updated_monster {
                        let updated_behavior = crate::monster_ai_defs::get_movement_behavior_for_state(&updated_monster.ai_state);
                        if updated_behavior != crate::monster_ai_defs::MovementBehavior::Chase {
                            continue; // Skip movement if no longer chasing
                        }
                    }
                }
            }
            
            // Apply chase acceleration if still in chase mode
            speed *= crate::monster_ai_defs::CHASE_ACCELERATION_MULTIPLIER;
            speed = speed.min(crate::monster_ai_defs::MAX_CHASE_SPEED);
            
            cache.monster.speed_monster[i] = speed; // Update cached speed for next frame

            let real_monster = ctx.db.monsters().monster_id().find(&cache.monster.keys_monster[i]);
            if let Some(monster) = real_monster {
                let mut updated_monster = monster;
                updated_monster.speed = speed;
                ctx.db.monsters().monster_id().update(updated_monster);
            }
        }
        
        let move_x = norm_x * speed * DELTA_TIME;
        let move_y = norm_y * speed * DELTA_TIME;

        cache.monster.pos_x_monster[i] += move_x;
        cache.monster.pos_y_monster[i] += move_y;

        cache.monster.pos_x_monster[i] = cache.monster.pos_x_monster[i].clamp(cache.monster.radius_monster[i], WORLD_SIZE as f32 - cache.monster.radius_monster[i]);
        cache.monster.pos_y_monster[i] = cache.monster.pos_y_monster[i].clamp(cache.monster.radius_monster[i], WORLD_SIZE as f32 - cache.monster.radius_monster[i]);
    }

    // Clean up monster status
    for i in 0..cache.monster.cached_count_monsters {
        let i = i as usize;
        if cache.monster.target_id_monster[i] == -1 {
            if let Some(monster) = ctx.db.monsters().monster_id().find(&cache.monster.keys_monster[i]) {
                reassign_monster_target(ctx, monster);
            }
        }
    }
}

fn calculate_monster_spatial_hash_grid(cache: &mut crate::collision::CollisionCache) {
    // Reset the spatial hash grid
    cache.monster.cell_monster.fill(-1);
    cache.monster.heads_monster.fill(-1);
    cache.monster.nexts_monster.fill(-1);

    // Calculate the spatial hash grid
    for mid in 0..cache.monster.cached_count_monsters {
        let mid = mid as usize;
        let grid_cell_key = get_world_cell_from_position(cache.monster.pos_x_monster[mid], cache.monster.pos_y_monster[mid]);
        cache.monster.nexts_monster[mid] = cache.monster.heads_monster[grid_cell_key as usize];
        cache.monster.heads_monster[grid_cell_key as usize] = mid as i32;
        cache.monster.cell_monster[mid] = grid_cell_key as i32;
    }
}

fn populate_monster_cache(ctx: &ReducerContext, cache: &mut crate::collision::CollisionCache) {
    cache.monster.cached_count_monsters = 0;
    cache.monster.key_to_cache_index_monster.clear();
    
    for monster in ctx.db.monsters().iter() {
        let idx = cache.monster.cached_count_monsters as usize;
        
        cache.monster.keys_monster[idx] = monster.monster_id;
        cache.monster.key_to_cache_index_monster.insert(monster.monster_id, cache.monster.cached_count_monsters as u32);
        cache.monster.radius_monster[idx] = monster.radius;
        cache.monster.speed_monster[idx] = monster.speed;
        cache.monster.atk_monster[idx] = monster.atk;
        
        // Cache movement behavior based on AI state
        let movement_behavior = crate::monster_ai_defs::get_movement_behavior_for_state(&monster.ai_state);
        cache.monster.movement_behavior[idx] = crate::monster_ai_defs::movement_behavior_to_u8(movement_behavior);
        
        //Structures and bosses have their weight set to 0.0 to prevent them from being pushed around
        if monster.bestiary_id == MonsterType::VoidChest || 
           monster.bestiary_id == MonsterType::FinalBossPhase1 || 
           monster.bestiary_id == MonsterType::FinalBossPhase2 {
            cache.monster.push_ratio_monster[idx] = 0;
        }
        else {
            cache.monster.push_ratio_monster[idx] = 1;
        }

        let target_player_id = monster.target_player_id;
        if cache.player.player_id_to_cache_index.contains_key(&target_player_id) {
            cache.monster.target_id_monster[idx] = target_player_id as i32;
        } else {
            cache.monster.target_id_monster[idx] = -1;
        }

        if cache.monster.target_id_monster[idx] != -1 {
            if let Some(&player_cache_idx) = cache.player.player_id_to_cache_index.get(&(target_player_id)) {
                cache.monster.target_x_monster[idx] = cache.player.pos_x_player[player_cache_idx as usize];
                cache.monster.target_y_monster[idx] = cache.player.pos_y_player[player_cache_idx as usize];
            }
        } else {
            cache.monster.target_x_monster[idx] = cache.monster.pos_x_monster[idx];
            cache.monster.target_y_monster[idx] = cache.monster.pos_y_monster[idx];
        }

        cache.monster.cached_count_monsters += 1;
    }

    for boid in ctx.db.monsters_boid().iter() {
        if let Some(&monster_cache_idx) = cache.monster.key_to_cache_index_monster.get(&boid.monster_id) {
            let idx = monster_cache_idx as usize;
            cache.monster.pos_x_monster[idx] = boid.position.x;
            cache.monster.pos_y_monster[idx] = boid.position.y;

            let grid_cell_key = get_world_cell_from_position(boid.position.x, boid.position.y);
            cache.monster.cell_monster[idx] = grid_cell_key as i32;
            cache.monster.nexts_monster[idx] = cache.monster.heads_monster[grid_cell_key as usize];
            cache.monster.heads_monster[grid_cell_key as usize] = idx as i32;
        }
    }
}

fn commit_monster_motion(ctx: &ReducerContext, cache: &mut crate::collision::CollisionCache) {
    for boid in ctx.db.monsters_boid().iter() {
        if let Some(&monster_cache_idx) = cache.monster.key_to_cache_index_monster.get(&boid.monster_id) {
            let idx = monster_cache_idx as usize;
            let mut boid_updated = boid;
            boid_updated.position.x = cache.monster.pos_x_monster[idx].clamp(cache.monster.radius_monster[idx], WORLD_SIZE as f32 - cache.monster.radius_monster[idx]);
            boid_updated.position.y = cache.monster.pos_y_monster[idx].clamp(cache.monster.radius_monster[idx], WORLD_SIZE as f32 - cache.monster.radius_monster[idx]);

            ctx.db.monsters_boid().monster_id().update(boid_updated);
        }
    }
}

// Helper method to reassign a monster's target when original target is gone
fn reassign_monster_target(ctx: &ReducerContext, monster: Monsters) {
    // Find a new target among existing players
    let players: Vec<_> = ctx.db.player().iter().collect();
    let player_count = players.len();
    if player_count == 0 {
        return;
    }
    
    // Choose a random player as the new target
    let mut rng = ctx.rng();
    let random_index = (rng.gen::<f32>() * player_count as f32) as usize;
    let new_target = &players[random_index];
    
    // Update the monster with the new target
    let mut updated_monster = monster;
    updated_monster.target_player_id = new_target.player_id;
    
    let cache = get_collision_cache();
    if let Some(&monster_cache_idx) = cache.monster.key_to_cache_index_monster.get(&updated_monster.monster_id) {
        cache.monster.target_id_monster[monster_cache_idx as usize] = new_target.player_id as i32;
    }
    
    ctx.db.monsters().monster_id().update(updated_monster);
}

// Helper method to process collisions between player attacks and monsters using spatial hash
pub fn process_player_attack_monster_collisions_spatial_hash(ctx: &ReducerContext) {
    let cache = get_collision_cache();
    
    for aid in 0..cache.attack.cached_count_attacks {
        let aid = aid as usize;
        let ax = cache.attack.pos_x_attack[aid];
        let ay = cache.attack.pos_y_attack[aid];
        let ar = cache.attack.radius_attack[aid];

        let mut attack_hit_monster = false;

        // Check against all monsters in the same spatial hash cell
        let cell_key = get_world_cell_from_position(ax, ay);

        let cx = (cell_key & WORLD_CELL_MASK) as i32;
        let cy = (cell_key >> WORLD_CELL_BIT_SHIFT) as i32;

        let mut current_attack_data: Option<crate::ActiveAttack> = None;
        let mut active_attack_is_piercing = false;

        for dy in -1..=1 {
            let ny = cy + dy;
            if ny < 0 || ny >= WORLD_GRID_HEIGHT as i32 {
                continue;
            }

            let row_base = ny << WORLD_CELL_BIT_SHIFT;
            for dx in -1..=1 {
                let nx = cx + dx;
                if nx < 0 || nx >= WORLD_GRID_WIDTH as i32 {
                    continue;
                }

                let test_cell_key = (row_base | nx) as usize;
                let mut mid = cache.monster.heads_monster[test_cell_key];
                while mid != -1 {
                    let mid_usize = mid as usize;
                    let mx = cache.monster.pos_x_monster[mid_usize];
                    let my = cache.monster.pos_y_monster[mid_usize];
                    let mr = cache.monster.radius_monster[mid_usize];

                    if spatial_hash_collision_checker(ax, ay, ar, mx, my, mr) {
                        // Get the active attack data
                        if current_attack_data.is_none() {
                            if let Some(active_attack) = ctx.db.active_attacks().active_attack_id().find(&cache.attack.keys_attack[aid]) {
                                current_attack_data = Some(active_attack);
                            } else {
                                mid = cache.monster.nexts_monster[mid_usize];
                                continue;
                            }
                        }

                        let active_attack = current_attack_data.as_ref().unwrap();
                        active_attack_is_piercing = active_attack.piercing;

                        // Check if this monster has already been hit by this attack
                        if has_monster_been_hit_by_attack(ctx, cache.monster.keys_monster[mid_usize], active_attack.entity_id) {
                            mid = cache.monster.nexts_monster[mid_usize];
                            continue;
                        }
                        
                        // Record the hit
                        record_monster_hit_by_attack(ctx, cache.monster.keys_monster[mid_usize], active_attack.entity_id);
                        
                        // Apply damage to monster using the active attack's damage value
                        let damage = active_attack.damage;
                        cache.monster.damage_to_monster[mid_usize] += damage as f32;
                        attack_hit_monster = true;
                        
                        // For non-piercing attacks, stop checking other monsters and destroy the attack
                        if !active_attack_is_piercing {
                            break;
                        }
                    }

                    mid = cache.monster.nexts_monster[mid_usize];
                }

                // If attack hit a monster and it's not piercing, break out of the cell checks
                if attack_hit_monster && !active_attack_is_piercing {
                    break;
                }
            }

            // If attack hit a monster and it's not piercing, break out of the cell checks
            if attack_hit_monster && !active_attack_is_piercing {
                break;
            }
        }
        
        // If the attack hit a monster and it's not piercing, remove the attack
        if attack_hit_monster && !active_attack_is_piercing {
            if let Some(active_attack) = current_attack_data {
                // Delete the attack entity
                ctx.db.entity().entity_id().delete(&active_attack.entity_id);
                
                // Delete the active attack record
                ctx.db.active_attacks().active_attack_id().delete(&active_attack.active_attack_id);
                
                // Clean up any damage records for this attack
                crate::attacks_def::cleanup_attack_damage_records(ctx, active_attack.entity_id);
            }
        }
    }
}

fn solve_monster_repulsion_spatial_hash(cache: &mut crate::collision::CollisionCache) {
    for i_a in 0..cache.monster.cached_count_monsters {
        let i_a = i_a as usize;
        let ax = cache.monster.pos_x_monster[i_a];
        let ay = cache.monster.pos_y_monster[i_a];
        let r_a = cache.monster.radius_monster[i_a];

        let key_a = cache.monster.cell_monster[i_a];
        let monster_id_a = cache.monster.keys_monster[i_a];
        let cx = key_a & WORLD_CELL_MASK as i32;
        let cy = key_a >> WORLD_CELL_BIT_SHIFT;

        for dy in -1..=1 {
            let ny = cy + dy;
            if ny < 0 || ny >= WORLD_GRID_HEIGHT as i32 {
                continue;
            }

            let row_base = ny << WORLD_CELL_BIT_SHIFT;
            for dx in -1..=1 {
                let nx = cx + dx;
                if nx < 0 || nx >= WORLD_GRID_WIDTH as i32 {
                    continue;
                }

                let key = (row_base | nx) as usize;
                let mut i_b = cache.monster.heads_monster[key];
                while i_b != -1 {
                    let i_b_usize = i_b as usize;
                    if i_b <= i_a as i32 {
                        i_b = cache.monster.nexts_monster[i_b_usize];
                        continue;
                    }

                    let dx_ab = ax - cache.monster.pos_x_monster[i_b_usize];
                    let dy_ab = ay - cache.monster.pos_y_monster[i_b_usize];
                    let d2 = (dx_ab * dx_ab + dy_ab * dy_ab).max(0.1);

                    let r_sum = r_a + cache.monster.radius_monster[i_b_usize];
                    let r_sum2 = r_sum * r_sum;
                    if d2 >= r_sum2 {
                        i_b = cache.monster.nexts_monster[i_b_usize];
                        continue;
                    }

                    // penetration & normal (inv-sqrt)
                    let inv_len = 1.0 / d2.sqrt();
                    let penetration = r_sum2 / d2;
                    let nx_ab = dx_ab * inv_len;
                    let ny_ab = dy_ab * inv_len;

                    let push_factor = 0.5;
                    let push_power = penetration * penetration * push_factor;

                    let push_x = (nx_ab * push_power).clamp(-r_sum, r_sum);
                    let push_y = (ny_ab * push_power).clamp(-r_sum, r_sum);

                    // Push the younger monster away from the older monster
                    let monster_id_b = cache.monster.keys_monster[i_b_usize];

                    let monster_a_push_value = cache.monster.push_ratio_monster[i_a] * monster_id_a;
                    let monster_b_push_value = cache.monster.push_ratio_monster[i_b_usize] * monster_id_b;

                    if monster_a_push_value > monster_b_push_value {
                        cache.monster.pos_x_monster[i_a] = (cache.monster.pos_x_monster[i_a] + push_x).clamp(r_a, WORLD_SIZE as f32 - r_a);
                        cache.monster.pos_y_monster[i_a] = (cache.monster.pos_y_monster[i_a] + push_y).clamp(r_a, WORLD_SIZE as f32 - r_a);
                    } else {
                        cache.monster.pos_x_monster[i_b_usize] = (cache.monster.pos_x_monster[i_b_usize] - push_x).clamp(r_a, WORLD_SIZE as f32 - r_a);
                        cache.monster.pos_y_monster[i_b_usize] = (cache.monster.pos_y_monster[i_b_usize] - push_y).clamp(r_a, WORLD_SIZE as f32 - r_a);
                    }

                    i_b = cache.monster.nexts_monster[i_b_usize];
                }
            }
        }
    }
}

// Helper function to check if a monster has already been hit by an attack
fn has_monster_been_hit_by_attack(ctx: &ReducerContext, monster_id: u32, attack_entity_id: u32) -> bool {
    // First filter: Use the BTree index to efficiently find all damage records for this attack
    let attack_damage_records: Vec<_> = ctx.db.monster_damage().attack_entity_id().filter(&attack_entity_id).collect();
    
    // Second filter: Check if any of those records match our monster
    for damage in attack_damage_records {
        if damage.monster_id == monster_id {
            return true; // Found a record - this monster was hit by this attack
        }
    }
    
    false // No matching record found
}

// Helper function to record a monster being hit by an attack
fn record_monster_hit_by_attack(ctx: &ReducerContext, monster_id: u32, attack_entity_id: u32) {
    // Insert the damage record
    let damage_record = ctx.db.monster_damage().insert(MonsterDamage {
        damage_id: 0,
        monster_id,
        attack_entity_id,
    });
    
    let damage_record = damage_record;
    
    // Get cleanup delay from config
    let mut cleanup_delay = 500; // Default to 500ms if config not found
    if let Some(config) = ctx.db.config().id().find(&0) {
        cleanup_delay = config.monster_hit_cleanup_delay;
    }
    
    // Schedule cleanup after the configured delay
    ctx.db.monster_hit_cleanup().insert(MonsterHitCleanup {
        scheduled_id: 0,
        damage_id: damage_record.damage_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(cleanup_delay as u64)),
    });
    
    //Log::info(&format!("Recorded monster {} hit by attack {}, cleanup scheduled in {}ms", monster_id, attack_entity_id, cleanup_delay));
}

pub fn commit_monster_damage(ctx: &ReducerContext) {
    let cache = get_collision_cache();
    for i in 0..cache.monster.cached_count_monsters {
        let i = i as usize;
        let monster_id = cache.monster.keys_monster[i];
        let damage = cache.monster.damage_to_monster[i];
        if damage > 0.0 {
            let _monster_killed = crate::core_game::damage_monster(ctx, monster_id, damage as u32);
        }
    }
}

// Reducer to clean up a monster hit record
#[reducer]
pub fn cleanup_monster_hit_record(ctx: &ReducerContext, cleanup: MonsterHitCleanup) {
    if ctx.sender != ctx.identity() {
        panic!("CleanupMonsterHitRecord may not be invoked by clients, only via scheduling.");
    }
    
    // Delete the damage record
    ctx.db.monster_damage().damage_id().delete(&cleanup.damage_id);
}

// Configuration constants for EnderClaw spawning
const ENDER_CLAW_INITIAL_INTERVAL_MS: u64 = 6000;   // Start spawning every 8 seconds
const ENDER_CLAW_MIN_INTERVAL_MS: u64 = 1000;       // Minimum spawn interval (2 seconds)
const ENDER_CLAW_INTERVAL_REDUCTION_MS: u64 = 200;  // Reduce interval by 200ms each wave
const ENDER_CLAW_PRE_SPAWN_DELAY_MS: u64 = 1000;   // Reduced pre-spawn delay (1 second)

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

    // Calculate spawn position near the target player (300-600 pixels away)
    let mut rng = ctx.rng();
    let spawn_distance = 300.0 + (rng.gen::<f32>() * 300.0); // 300-600 pixels from player  
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
    ctx.db.monster_spawners().insert(MonsterSpawners {
        scheduled_id: 0,
        position: spawn_position,
        monster_type: MonsterType::EnderClaw,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ENDER_CLAW_PRE_SPAWN_DELAY_MS)),
    });

    log::info!("Pre-spawned EnderClaw for player {} at position ({:.1}, {:.1})", 
              target_player.name, spawn_position.x, spawn_position.y);
}

// Helper function to schedule the next EnderClaw wave with interval reduction
fn schedule_next_ender_claw_wave(ctx: &ReducerContext, boss_monster_id: u32, current_interval_ms: u64) {
    // Calculate next interval (reduce by ENDER_CLAW_INTERVAL_REDUCTION_MS, but don't go below minimum)
    let next_interval_ms = (current_interval_ms.saturating_sub(ENDER_CLAW_INTERVAL_REDUCTION_MS))
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

// Debug reducer to spawn a VoidChest near the calling player
#[reducer]
pub fn spawn_debug_void_chest(ctx: &ReducerContext) {
    // Get the caller's identity
    let caller_identity = ctx.sender;
    
    // Find the caller's account
    let account_opt = ctx.db.account().identity().find(&caller_identity);
    if account_opt.is_none() {
        log::error!("spawn_debug_void_chest: Account not found for caller");
        return;
    }
    
    let account = account_opt.unwrap();
    if account.current_player_id == 0 {
        log::error!("spawn_debug_void_chest: Caller has no active player");
        return;
    }
    
    // Find the player
    let player_opt = ctx.db.player().player_id().find(&account.current_player_id);
    if player_opt.is_none() {
        log::error!("spawn_debug_void_chest: Player not found for caller");
        return;
    }
    
    let player = player_opt.unwrap();
    
    // Get VoidChest stats from bestiary
    let bestiary_entry_opt = ctx.db.bestiary().bestiary_id().find(&(MonsterType::VoidChest as u32));
    if bestiary_entry_opt.is_none() {
        log::error!("spawn_debug_void_chest: VoidChest not found in bestiary");
        return;
    }
    
    let bestiary_entry = bestiary_entry_opt.unwrap();
    
    // Calculate spawn position near the player (100-200 pixels away)
    let mut rng = ctx.rng();
    let spawn_distance = 100.0 + (rng.gen::<f32>() * 100.0); // 100-200 pixels from player
    let spawn_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0; // Random angle
    
    let spawn_position = DbVector2::new(
        player.position.x + spawn_distance * spawn_angle.cos(),
        player.position.y + spawn_distance * spawn_angle.sin()
    );
    
    // Get world boundaries from config
    let config = ctx.db.config().id().find(&0);
    let world_size = if let Some(config) = config {
        config.world_size as f32
    } else {
        6400.0 // Default world size
    };
    
    // Clamp to world boundaries
    let monster_radius = bestiary_entry.radius;
    let clamped_position = DbVector2::new(
        spawn_position.x.clamp(monster_radius, world_size - monster_radius),
        spawn_position.y.clamp(monster_radius, world_size - monster_radius)
    );
    
    // Create the VoidChest monster directly
    let monster = ctx.db.monsters().insert(Monsters {
        monster_id: 0,
        bestiary_id: MonsterType::VoidChest,
        hp: bestiary_entry.max_hp,
        max_hp: bestiary_entry.max_hp,
        atk: bestiary_entry.atk,
        speed: bestiary_entry.speed,
        target_player_id: player.player_id,
        radius: bestiary_entry.radius,
        spawn_position: clamped_position.clone(),
        ai_state: AIState::Stationary,
    });
    
    // Create the boid for movement
    let _boid = ctx.db.monsters_boid().insert(MonsterBoid {
        monster_id: monster.monster_id,
        position: clamped_position,
    });
    
    log::info!(
        "Debug: Spawned VoidChest (ID: {}) at position ({:.1}, {:.1}) for player {} ({})",
        monster.monster_id,
        clamped_position.x,
        clamped_position.y,
        player.name,
        player.player_id
    );
}

// Helper function to get monster type name from bestiary ID
fn get_monster_type_name(bestiary_id: &MonsterType) -> &'static str {
    match bestiary_id {
        MonsterType::Rat => "Rat",
        MonsterType::Slime => "Slime", 
        MonsterType::Orc => "Orc",
        MonsterType::FinalBossPhase1 => "FinalBossPhase1",
        MonsterType::FinalBossPhase2 => "FinalBossPhase2",
        MonsterType::VoidChest => "VoidChest",
        MonsterType::Imp => "Imp",
        MonsterType::Zombie => "Zombie",
        MonsterType::EnderClaw => "EnderClaw",
    }
}
