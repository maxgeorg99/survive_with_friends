use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, monsters, monsters_boid, player, bestiary};
use std::time::Duration;

// AI State enum for monster behavior
#[derive(SpacetimeType, Clone, Debug, PartialEq, Copy)]
pub enum AIState {
    Default = 0,
    BossIdle = 1,
    BossChase = 2,
    BossDance = 3,
    BossVanish = 4,
    BossTeleport = 5,
    BossTransform = 6,
    Stationary = 7,
}

// Scheduled table for changing monster AI states
#[table(name = monster_state_changes, scheduled(change_monster_state), public)]
pub struct MonsterStateChange {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    pub target_monster_id: u32,
    pub target_state: AIState,
    pub scheduled_at: ScheduleAt,
}

// Table to track the last chosen pattern for each boss to avoid repetition
#[table(name = boss_last_patterns, public)]
pub struct BossLastPattern {
    #[primary_key]
    pub monster_id: u32,
    
    pub last_pattern: AIState,
}

// Configuration constants for boss AI timing
const BOSS_IDLE_DURATION_MS: u64 = 5000;        // 3 seconds idle
const BOSS_CHASE_DURATION_MS: u64 = 15000;       // 8 seconds chase
pub const BOSS_DANCE_DURATION_MS: u64 = 15000;       // 5 seconds dance
const BOSS_VANISH_DURATION_MS: u64 = 4000;      // 2 seconds vanish
const BOSS_TELEPORT_DURATION_MS: u64 = 1000;     // 0.5 seconds teleport
const BOSS_TRANSFORM_DURATION_MS: u64 = 2000;   // 2 seconds transform

// Speed multiplier for chase state
const BOSS_CHASE_SPEED_MULTIPLIER: f32 = 1.5;

// Chase distance threshold (when boss gets this close, stop chasing and attack)
const BOSS_CHASE_STOP_DISTANCE: f32 = 128.0; 

// Chase acceleration per frame
pub const CHASE_ACCELERATION_MULTIPLIER: f32 = 1.02; // 2% increase per frame

// Maximum chase speed multiplier (cap at 3x base speed)
pub const MAX_CHASE_SPEED: f32 = 255.0;

// Scheduled reducer to change monster AI state
#[reducer]
pub fn change_monster_state(ctx: &ReducerContext, state_change: MonsterStateChange) {
    if ctx.sender != ctx.identity() {
        panic!("Reducer change_monster_state may not be invoked by clients, only via scheduling.");
    }

    log::info!("Changing monster {} state to {:?}", state_change.target_monster_id, state_change.target_state);

    // Find the target monster
    let monster_opt = ctx.db.monsters().monster_id().find(&state_change.target_monster_id);
    if monster_opt.is_none() {
        log::info!("change_monster_state: Monster {} not found, state change cancelled", state_change.target_monster_id);
        return;
    }

    let mut monster = monster_opt.unwrap();
    
    // Update the monster's AI state
    monster.ai_state = state_change.target_state.clone();
    ctx.db.monsters().monster_id().update(monster.clone());
    
    // Execute behavior based on the new state
    execute_state_entry_behavior(ctx, &monster, &state_change.target_state);
}

// Execute behavior when entering a new AI state
fn execute_state_entry_behavior(ctx: &ReducerContext, monster: &crate::Monsters, state: &AIState) {
    match state {
        AIState::BossIdle => {
            log::info!("Monster {} entering BossIdle state", monster.monster_id);
            
            // Reset speed to bestiary entry
            reset_monster_speed_to_bestiary(ctx, monster);
            
            // Schedule next random boss pattern after idle duration
            schedule_random_boss_pattern(ctx, monster.monster_id);
        },
        
        AIState::BossChase => {
            log::info!("Monster {} entering BossChase state", monster.monster_id);
            
            // Increase speed by multiplier
            increase_monster_speed(ctx, monster, BOSS_CHASE_SPEED_MULTIPLIER);
            
            // Change target to random player
            change_monster_target_to_random_player(ctx, monster);
            
            // Schedule return to idle after chase duration
            schedule_state_change(ctx, monster.monster_id, AIState::BossIdle, BOSS_CHASE_DURATION_MS);
        },
        
        AIState::BossDance => {
            log::info!("Monster {} entering BossDance state", monster.monster_id);
            
            // Schedule EnderScythe attack pattern
            crate::monster_attacks_def::schedule_ender_scythe_attacks(ctx, monster.monster_id);
            
            // Schedule EnderBolt attacks to fire periodically during dance
            crate::monster_attacks_def::start_ender_bolt_attacks(ctx, monster.monster_id);
            
            // Schedule return to idle after dance duration
            schedule_state_change(ctx, monster.monster_id, AIState::BossIdle, BOSS_DANCE_DURATION_MS);
        },
        
        AIState::BossVanish => {
            log::info!("Monster {} entering BossVanish state", monster.monster_id);
            
            // Change target to random player
            change_monster_target_to_random_player(ctx, monster);
            
            // Schedule transition to teleport after vanish duration
            schedule_state_change(ctx, monster.monster_id, AIState::BossTeleport, BOSS_VANISH_DURATION_MS);
        },
        
        AIState::BossTeleport => {
            log::info!("Monster {} entering BossTeleport state", monster.monster_id);
            
            // Teleport to target player position
            teleport_monster_to_target(ctx, monster);
            
            // Schedule return to idle after teleport duration
            schedule_state_change(ctx, monster.monster_id, AIState::BossIdle, BOSS_TELEPORT_DURATION_MS);
        },
        
        AIState::BossTransform => {
            log::info!("Monster {} entering BossTransform state", monster.monster_id);
            
            // Schedule return to idle after transform duration
            schedule_state_change(ctx, monster.monster_id, AIState::BossIdle, BOSS_TRANSFORM_DURATION_MS);
        },
        
        AIState::Default => {
            log::info!("Monster {} entering Default state", monster.monster_id);
            // No special behavior for default state
        },
        
        AIState::Stationary => {
            log::info!("Monster {} entering Stationary state", monster.monster_id);
            // No special behavior for stationary state - just stands still
        },
    }
}

// Reset monster speed to bestiary entry
fn reset_monster_speed_to_bestiary(ctx: &ReducerContext, monster: &crate::Monsters) {
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32))
        .expect("reset_monster_speed_to_bestiary: Could not find bestiary entry");
    
    let mut updated_monster = monster.clone();
    updated_monster.speed = bestiary_entry.speed;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Monster {} speed reset to {}", monster.monster_id, bestiary_entry.speed);
}

// Increase monster speed by multiplier
fn increase_monster_speed(ctx: &ReducerContext, monster: &crate::Monsters, multiplier: f32) {
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(monster.bestiary_id.clone() as u32))
        .expect("increase_monster_speed: Could not find bestiary entry");
    
    let mut updated_monster = monster.clone();
    updated_monster.speed = bestiary_entry.speed * multiplier;
    let new_speed = updated_monster.speed; // Store the speed before moving the monster
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Monster {} speed increased to {} ({}x multiplier)", monster.monster_id, new_speed, multiplier);
}

// Change monster target to a random player
fn change_monster_target_to_random_player(ctx: &ReducerContext, monster: &crate::Monsters) {
    let players: Vec<_> = ctx.db.player().iter().collect();
    if players.is_empty() {
        log::info!("No players available for monster {} to target", monster.monster_id);
        return;
    }
    
    let mut rng = ctx.rng();
    let random_index = (rng.gen::<f32>() * players.len() as f32) as usize;
    let target_player = &players[random_index];
    
    let mut updated_monster = monster.clone();
    updated_monster.target_player_id = target_player.player_id;
    ctx.db.monsters().monster_id().update(updated_monster);
    
    log::info!("Monster {} target changed to player {}", monster.monster_id, target_player.player_id);
}

// Teleport monster to target player position
fn teleport_monster_to_target(ctx: &ReducerContext, monster: &crate::Monsters) {
    let target_player = ctx.db.player().player_id().find(&monster.target_player_id);
    if target_player.is_none() {
        log::info!("Target player {} not found, selecting new random target for monster {}", monster.target_player_id, monster.monster_id);
        // If target player is gone, select a new random player
        change_monster_target_to_random_player(ctx, monster);
        
        // Try again with new target
        let updated_monster = ctx.db.monsters().monster_id().find(&monster.monster_id).unwrap();
        let new_target_player = ctx.db.player().player_id().find(&updated_monster.target_player_id);
        if new_target_player.is_none() {
            log::info!("No players available for teleport, cancelling teleport for monster {}", monster.monster_id);
            return;
        }
        
        teleport_monster_to_position(ctx, monster.monster_id, &new_target_player.unwrap().position);
    } else {
        teleport_monster_to_position(ctx, monster.monster_id, &target_player.unwrap().position);
    }
}

// Helper function to teleport monster to specific position
fn teleport_monster_to_position(ctx: &ReducerContext, monster_id: u32, position: &DbVector2) {
    // Update monster boid position
    let monster_boid = ctx.db.monsters_boid().monster_id().find(&monster_id);
    if let Some(mut boid) = monster_boid {
        boid.position = position.clone();
        ctx.db.monsters_boid().monster_id().update(boid);
        log::info!("Monster {} teleported to position ({}, {})", monster_id, position.x, position.y);
    }
}

// Schedule a state change for a monster
fn schedule_state_change(ctx: &ReducerContext, monster_id: u32, target_state: AIState, delay_ms: u64) {
    ctx.db.monster_state_changes().insert(MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster_id,
        target_state,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(delay_ms)),
    });
    
    log::info!("Scheduled state change for monster {} to {:?} in {}ms", monster_id, target_state, delay_ms);
}

// Cancel all scheduled state changes for a monster
fn cancel_scheduled_state_changes(ctx: &ReducerContext, monster_id: u32) {
    // Find all scheduled state changes for this monster by iterating through all changes
    let scheduled_changes: Vec<_> = ctx.db.monster_state_changes().iter()
        .filter(|change| change.target_monster_id == monster_id)
        .collect();
    
    // Delete each scheduled change
    for change in scheduled_changes {
        ctx.db.monster_state_changes().scheduled_id().delete(&change.scheduled_id);
        log::info!("Cancelled scheduled state change for monster {} to {:?}", monster_id, change.target_state);
    }
    
    // Also cleanup any pending EnderScythe attacks for this boss
    crate::monster_attacks_def::cleanup_ender_scythe_schedules(ctx, monster_id);
}

// Schedule a random boss pattern (chase, dance, or vanish)
fn schedule_random_boss_pattern(ctx: &ReducerContext, monster_id: u32) {
    let mut rng = ctx.rng();
    
    // Get the last pattern for this boss (if any)
    let last_pattern_opt = ctx.db.boss_last_patterns().monster_id().find(&monster_id);
    let last_pattern = last_pattern_opt.as_ref().map(|p| p.last_pattern);
    
    // Create list of available patterns (excluding the last one used)
    let all_patterns = vec![AIState::BossChase, AIState::BossDance, AIState::BossVanish];
    let available_patterns: Vec<AIState> = all_patterns.into_iter()
        .filter(|pattern| Some(*pattern) != last_pattern)
        .collect();
    
    // Select random pattern from available options
    let target_state = if available_patterns.is_empty() {
        // Fallback (shouldn't happen, but just in case)
        AIState::BossChase
    } else {
        let random_index = (rng.gen::<f32>() * available_patterns.len() as f32) as usize;
        available_patterns[random_index]
    };
    
    // Update the last pattern for this boss
    if let Some(mut last_pattern_record) = last_pattern_opt {
        last_pattern_record.last_pattern = target_state;
        ctx.db.boss_last_patterns().monster_id().update(last_pattern_record);
    } else {
        // Create new record for this boss
        ctx.db.boss_last_patterns().insert(BossLastPattern {
            monster_id,
            last_pattern: target_state,
        });
    }
    
    schedule_state_change(ctx, monster_id, target_state, BOSS_IDLE_DURATION_MS);
    log::info!("Scheduled random boss pattern {:?} for monster {} after {}ms (avoiding repetition of {:?})", 
               target_state, monster_id, BOSS_IDLE_DURATION_MS, last_pattern);
}

// Initialize boss AI state when a boss is spawned
pub fn initialize_boss_ai(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Initializing boss AI for monster {}", monster_id);
    
    // Set boss to idle state
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if let Some(mut monster) = monster_opt {
        monster.ai_state = AIState::BossIdle;
        ctx.db.monsters().monster_id().update(monster);
        
        // Schedule first random boss pattern
        schedule_random_boss_pattern(ctx, monster_id);
    }
}

// Get movement behavior based on AI state
pub fn get_movement_behavior_for_state(state: &AIState) -> MovementBehavior {
    match state {
        AIState::Default => MovementBehavior::Normal,
        AIState::BossIdle => MovementBehavior::Normal,
        AIState::BossChase => MovementBehavior::Chase,
        AIState::BossDance => MovementBehavior::StandStill,
        AIState::BossVanish => MovementBehavior::StandStill,
        AIState::BossTeleport => MovementBehavior::StandStill,
        AIState::BossTransform => MovementBehavior::StandStill,
        AIState::Stationary => MovementBehavior::StandStill,
    }
}

// Movement behavior enum
#[derive(Debug, PartialEq)]
pub enum MovementBehavior {
    Normal = 0,
    Chase = 1,
    StandStill = 2,
}

// Helper functions to convert between MovementBehavior and u8 for caching
pub fn movement_behavior_to_u8(behavior: MovementBehavior) -> u8 {
    behavior as u8
}

pub fn movement_behavior_from_u8(value: u8) -> MovementBehavior {
    match value {
        0 => MovementBehavior::Normal,
        1 => MovementBehavior::Chase,
        2 => MovementBehavior::StandStill,
        _ => MovementBehavior::Normal, // Default fallback
    }
}

// Check if boss should stop chasing when close to target
pub fn check_boss_chase_distance(ctx: &ReducerContext, monster_id: u32, monster_position: &DbVector2, target_position: &DbVector2) {
    // Calculate distance to target
    let dx = target_position.x - monster_position.x;
    let dy = target_position.y - monster_position.y;
    let distance = (dx * dx + dy * dy).sqrt();
    
    // If boss is close enough, stop chasing and schedule new attack
    if distance <= BOSS_CHASE_STOP_DISTANCE {
        log::info!("Boss {} is close enough to target (distance: {:.1}), stopping chase and scheduling attack", monster_id, distance);
        
        // Cancel any existing scheduled state changes (like the original chase->idle transition)
        cancel_scheduled_state_changes(ctx, monster_id);
        
        // Change state back to idle immediately
        let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
        if let Some(mut monster) = monster_opt {
            monster.ai_state = AIState::BossIdle;
            ctx.db.monsters().monster_id().update(monster.clone());
            
            // Reset speed to base bestiary speed since we're exiting chase mode
            reset_monster_speed_to_bestiary(ctx, &monster);
            
            // Schedule new random boss pattern with short delay (immediate attack)
            schedule_random_boss_pattern(ctx, monster_id);
        }
    }
} 