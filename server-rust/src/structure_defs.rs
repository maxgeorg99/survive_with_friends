use spacetimedb::{ReducerContext, Table, rand::Rng};
use crate::{DbVector2, MonsterType, WORLD_CELL_SIZE, WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, 
           config_def::config, boss_system::game_state, monsters_def::monsters, monsters_def::monsters_boid};

// Structure spawn thresholds for noise-based generation
const CRATE_NOISE_THRESHOLD: f32 = 0.98;  // Moderately high values
const TREE_NOISE_THRESHOLD: f32 = 0.994;   // High values  
const STATUE_NOISE_THRESHOLD: f32 = 0.999; // Very high values

// Structure health values
const CRATE_HEALTH: u32 = 150;
const TREE_HEALTH: u32 = 300;
const STATUE_HEALTH: u32 = 500;

// Structure radius values
const CRATE_RADIUS: f32 = 48.0;
const TREE_RADIUS: f32 = 64.0;
const STATUE_RADIUS: f32 = 72.0;

// Loot capsule counts when structures are destroyed
const CRATE_LOOT_COUNT: u32 = 1;
const TREE_LOOT_COUNT: u32 = 2;
const STATUE_LOOT_COUNT: u32 = 3;

// Simple noise function for deterministic but random-looking distribution
fn simple_noise(x: f32, y: f32, seed: u32) -> f32 {
    let mut hash = seed;
    hash ^= (x as u32).wrapping_mul(73856093);
    hash ^= (y as u32).wrapping_mul(19349663);
    hash ^= hash >> 13;
    hash ^= hash << 17;
    hash ^= hash >> 5;
    
    // Convert to 0.0-1.0 range
    (hash as f32) / (u32::MAX as f32)
}

// Function to spawn structures across the world using noise-based distribution
pub fn spawn_world_structures(ctx: &ReducerContext) {
    log::info!("Spawning world structures using noise-based distribution...");
    
    let mut structures_spawned = 0;
    let mut crates_spawned = 0;
    let mut trees_spawned = 0; 
    let mut statues_spawned = 0;
    
    // Get world configuration
    let config = ctx.db.config().id().find(&0)
        .expect("spawn_world_structures: Could not find game configuration!");
    
    // Use a simple seed based on timestamp seconds - this gives different layouts per session
    let game_state = ctx.db.game_state().id().find(&0)
        .expect("spawn_world_structures: Could not find game state!");
    // Use a simple seed based on config values and some randomness
    let mut rng = ctx.rng();
    let seed = config.world_size.wrapping_mul(rng.gen::<u32>());
    
    // Iterate through each collision cell
    for cell_y in 0..WORLD_GRID_HEIGHT {
        for cell_x in 0..WORLD_GRID_WIDTH {
            // Calculate center position of this cell
            let center_x = (cell_x as f32 + 0.5) * WORLD_CELL_SIZE as f32;
            let center_y = (cell_y as f32 + 0.5) * WORLD_CELL_SIZE as f32;
            
            // Skip cells that are too close to world edges (leave margin for structure radius)
            let margin = 100.0; // Safety margin
            if center_x < margin || center_x > (config.world_size as f32 - margin) ||
               center_y < margin || center_y > (config.world_size as f32 - margin) {
                continue;
            }
            
            // Generate noise value for this cell
            let noise_value = simple_noise(center_x, center_y, seed);
            
            // Determine structure type based on noise thresholds
            let structure_type = if noise_value >= STATUE_NOISE_THRESHOLD {
                Some(MonsterType::Statue)
            } else if noise_value >= TREE_NOISE_THRESHOLD {
                Some(MonsterType::Tree) 
            } else if noise_value >= CRATE_NOISE_THRESHOLD {
                Some(MonsterType::Crate)
            } else {
                None
            };
            
            if let Some(monster_type) = structure_type {
                // Add some random offset within the cell to avoid perfect grid alignment
                let mut rng = ctx.rng();
                let offset_range = WORLD_CELL_SIZE as f32 * 0.3; // 30% of cell size
                let offset_x = (rng.gen::<f32>() - 0.5) * offset_range;
                let offset_y = (rng.gen::<f32>() - 0.5) * offset_range;
                
                let spawn_position = DbVector2::new(
                    center_x + offset_x,
                    center_y + offset_y
                );
                
                // Clamp to world boundaries with structure radius
                let structure_radius = match monster_type {
                    MonsterType::Crate => CRATE_RADIUS,
                    MonsterType::Tree => TREE_RADIUS,
                    MonsterType::Statue => STATUE_RADIUS,
                    _ => 50.0, // fallback
                };
                
                let clamped_position = DbVector2::new(
                    spawn_position.x.clamp(structure_radius, config.world_size as f32 - structure_radius),
                    spawn_position.y.clamp(structure_radius, config.world_size as f32 - structure_radius)
                );
                
                // Spawn the structure immediately (no delay needed for world initialization)
                spawn_structure(ctx, clamped_position, monster_type.clone());
                
                structures_spawned += 1;
                match monster_type {
                    MonsterType::Crate => crates_spawned += 1,
                    MonsterType::Tree => trees_spawned += 1,
                    MonsterType::Statue => statues_spawned += 1,
                    _ => {}
                }
            }
        }
    }
    
    log::info!("World structures spawned: {} total ({} Crates, {} Trees, {} Statues)", 
              structures_spawned, crates_spawned, trees_spawned, statues_spawned);
}

// Function to spawn a single structure
fn spawn_structure(ctx: &ReducerContext, position: DbVector2, structure_type: MonsterType) {
    // Get structure stats based on type
    let (health, radius) = match structure_type {
        MonsterType::Crate => (CRATE_HEALTH, CRATE_RADIUS),
        MonsterType::Tree => (TREE_HEALTH, TREE_RADIUS),
        MonsterType::Statue => (STATUE_HEALTH, STATUE_RADIUS),
        _ => {
            log::error!("spawn_structure: Invalid structure type {:?}", structure_type);
            return;
        }
    };
    
    // Create the structure monster with stationary AI
    let monster = ctx.db.monsters().insert(crate::Monsters {
        monster_id: 0,
        bestiary_id: structure_type.clone(),
        variant: crate::MonsterVariant::Default,
        hp: health,
        max_hp: health,
        atk: 0.0,    // Structures don't attack
        speed: 0.0,  // Structures don't move
        target_player_id: 0, // No target needed
        radius,
        spawn_position: position.clone(),
        ai_state: crate::monster_ai_defs::AIState::Stationary,
    });
    
    // Create the boid for position tracking
    let _boid = ctx.db.monsters_boid().insert(crate::MonsterBoid {
        monster_id: monster.monster_id,
        position,
    });
    
    /*
    log::debug!("Spawned {:?} structure (ID: {}) at position ({:.1}, {:.1})", 
               structure_type, monster.monster_id, position.x, position.y);
    */
}

// Function to handle structure death loot drops
pub fn trigger_structure_death_loot(ctx: &ReducerContext, monster: &crate::Monsters) {
    // Get the structure's current position from the boid, fallback to spawn position if not found
    let structure_position = if let Some(boid) = ctx.db.monsters_boid().monster_id().find(&monster.monster_id) {
        boid.position
    } else {
        log::warn!("Structure {} has no boid data, using spawn position for death loot", monster.monster_id);
        monster.spawn_position
    };
    
    // Determine loot count based on structure type
    let loot_count = match monster.bestiary_id {
        MonsterType::Crate => CRATE_LOOT_COUNT,
        MonsterType::Tree => TREE_LOOT_COUNT,
        MonsterType::Statue => STATUE_LOOT_COUNT,
        _ => {
            log::error!("trigger_structure_death_loot: Invalid structure type {:?}", monster.bestiary_id);
            return;
        }
    };
    
    log::info!("{:?} destroyed! Spawning {} loot capsules at position ({:.1}, {:.1})", 
              monster.bestiary_id, loot_count, structure_position.x, structure_position.y);
    
    // Spawn the loot capsules
    for i in 0..loot_count {
        // Use public function from loot_capsule_defs with appropriate radius
        let gem_type = crate::loot_capsule_defs::select_weighted_gem_type(&mut ctx.rng());
        
        if i == 0 {
            log::debug!("First structure loot capsule: {:?} gem", gem_type);
        }
        
        // Use smaller radius for structure loot to keep it close
        crate::loot_capsule_defs::spawn_loot_capsule_in_radius(
            ctx, 
            structure_position, 
            32.0,  // Min radius - close to structure
            96.0,  // Max radius - moderate spread
            gem_type
        );
    }
    
    log::info!("Structure death loot complete - {} capsules spawned", loot_count);
}

// Helper function to check if a monster type is a structure
pub fn is_structure_type(monster_type: &MonsterType) -> bool {
    match monster_type {
        MonsterType::Crate | MonsterType::Tree | MonsterType::Statue => true,
        _ => false,
    }
} 