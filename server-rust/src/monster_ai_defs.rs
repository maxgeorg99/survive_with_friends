use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, monsters, monsters_boid, player, bestiary};
use std::time::Duration;

// AI State enum for monster behavior
#[derive(SpacetimeType, Clone, Debug, PartialEq, Copy)]
pub enum AIState {
    Default = 0,
    BossEnderIdle = 1,
    BossEnderChase = 2,
    BossEnderDance = 3,
    BossEnderVanish = 4,
    BossEnderLurk = 5,
    BossEnderTeleport = 6,
    BossEnderTransform = 7,
    Stationary = 8,
    BossAgnaIdle = 9,
    BossAgnaFlamethrower = 10,
    BossAgnaMagicCircle = 11,
    BossAgnaRitualMatch = 12,
    BossAgnaRitualWick = 13,
    BossAgnaRitualFailed = 14,
    BossAgnaRitualComplete = 15,
    BossSimonIdle = 16,
    BossSimonChemicalBoltPattern = 17,
    BossSimonToxicZonePattern = 18,
    BossSimonPhase2Transform = 19,
    BossJorgeIdle = 20,
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

// Note: Boss-specific constants and tables have been moved to boss_bjorn_defs

// Chase acceleration per frame
pub const CHASE_ACCELERATION_MULTIPLIER: f32 = 1.02; // 2% increase per frame

// Maximum chase speed multiplier (cap at 3x base speed)
pub const MAX_CHASE_SPEED: f32 = 1000.0;

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
        AIState::BossEnderIdle => {
            log::info!("Monster {} entering BossEnderIdle state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_idle_behavior(ctx, monster);
        },
        
        AIState::BossEnderChase => {
            log::info!("Monster {} entering BossEnderChase state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_chase_behavior(ctx, monster);
        },
        
        AIState::BossEnderDance => {
            log::info!("Monster {} entering BossEnderDance state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_dance_behavior(ctx, monster);
        },
        
        AIState::BossEnderVanish => {
            log::info!("Monster {} entering BossEnderVanish state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_vanish_behavior(ctx, monster);
        },
        
        AIState::BossEnderLurk => {
            log::info!("Monster {} entering BossEnderLurk state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_lurk_behavior(ctx, monster);
        },
        
        AIState::BossEnderTeleport => {
            log::info!("Monster {} entering BossEnderTeleport state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_teleport_behavior(ctx, monster);
        },
        
        AIState::BossEnderTransform => {
            log::info!("Monster {} entering BossEnderTransform state", monster.monster_id);
            
            // Delegate to boss_ender_defs for Björn boss specific behavior
            crate::boss_bjorn_defs::execute_boss_ender_transform_behavior(ctx, monster);
        },
        
        AIState::BossAgnaIdle => {
            log::info!("Monster {} entering BossAgnaIdle state", monster.monster_id);
            
            // Delegate to boss_agna_defs for Claudia boss specific behavior
            crate::boss_claudia_defs::execute_boss_agna_idle_behavior(ctx, monster);
        },
        
        AIState::BossAgnaFlamethrower => {
            log::info!("Monster {} entering BossAgnaFlamethrower state", monster.monster_id);
            
            // Then execute the behavior
            crate::boss_claudia_defs::execute_boss_agna_flamethrower_behavior(ctx, monster);
        },
        
        AIState::BossAgnaMagicCircle => {
            log::info!("Monster {} entering BossAgnaMagicCircle state", monster.monster_id);
            
            // Delegate to boss_agna_defs for Claudia boss specific behavior
            crate::boss_claudia_defs::execute_boss_agna_magic_circle_behavior(ctx, monster);
        },
        
        AIState::BossAgnaRitualMatch => {
            log::info!("Monster {} entering BossAgnaRitualMatch state", monster.monster_id);
            
            // Delegate to boss_agna_defs for Claudia ritual behavior
            crate::boss_claudia_defs::execute_boss_agna_ritual_match_behavior(ctx, monster);
        },
        
        AIState::BossAgnaRitualWick => {
            log::info!("Monster {} entering BossAgnaRitualWick state", monster.monster_id);
            
            // Delegate to boss_agna_defs for Claudia ritual behavior
            crate::boss_claudia_defs::execute_boss_agna_ritual_wick_behavior(ctx, monster);
        },
        
        AIState::BossAgnaRitualFailed => {
            log::info!("Monster {} entering BossAgnaRitualFailed state", monster.monster_id);
            
            // Delegate to boss_agna_defs for Claudia ritual behavior
            crate::boss_claudia_defs::execute_boss_agna_ritual_failed_behavior(ctx, monster);
        },
        
        AIState::BossAgnaRitualComplete => {
            log::info!("Monster {} entering BossAgnaRitualComplete state", monster.monster_id);
            
            // Delegate to boss_agna_defs for Claudia ritual behavior
            crate::boss_claudia_defs::execute_boss_agna_ritual_complete_behavior(ctx, monster);
        },
        
        AIState::Default => {
            log::info!("Monster {} entering Default state", monster.monster_id);
            // No special behavior for default state
        },
        
        AIState::Stationary => {
            log::info!("Monster {} entering Stationary state", monster.monster_id);
            // No special behavior for stationary state - just stands still
        },
        AIState::BossSimonIdle => {
            log::info!("Monster {} entering BossSimonIdle state", monster.monster_id);
            crate::boss_simon_defs::execute_boss_simon_idle_behavior(ctx, monster);
        }
        AIState::BossSimonChemicalBoltPattern => {
            log::info!("Monster {} entering BossSimonChemicalBoltPattern state", monster.monster_id);
            crate::boss_simon_defs::execute_boss_simon_chemical_bolt_pattern(ctx, monster);
        }
        AIState::BossSimonToxicZonePattern => {
            log::info!("Monster {} entering BossSimonToxicZonePattern state", monster.monster_id);
            crate::boss_simon_defs::execute_boss_simon_toxic_zone_pattern(ctx, monster);
        }
        AIState::BossSimonPhase2Transform => {
            log::info!("Monster {} entering BossSimonPhase2Transform state", monster.monster_id);
            crate::boss_simon_defs::execute_boss_simon_phase2_transform(ctx, monster);
        }
        AIState::BossJorgeIdle => {
            log::info!("Monster {} entering BossJorgeIdle state", monster.monster_id);
            crate::boss_jorge_defs::execute_boss_jorge_idle_behavior(ctx, monster);
        }
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
    crate::boss_bjorn_defs::cleanup_ender_scythe_schedules(ctx, monster_id);
    
    // Also cleanup any pending Claudia attacks for this boss
    crate::boss_claudia_defs::cleanup_agna_ai_schedules(ctx, monster_id);
}

// Public function to cleanup all AI schedules for a monster (used during boss transitions)
pub fn cleanup_monster_ai_schedules(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Cleaning up all AI schedules for monster {}", monster_id);
    
    // Cancel all scheduled state changes
    cancel_scheduled_state_changes(ctx, monster_id);
    
    // Note: Boss ender last pattern cleanup is now handled in boss_bjorn_defs
}

// Schedule a random boss ender pattern (chase, dance, or vanish) - will be moved to boss_ender_defs
fn schedule_random_boss_ender_pattern(ctx: &ReducerContext, monster_id: u32) {
    // Delegate to boss_ender_defs for Björn boss specific behavior
    crate::boss_bjorn_defs::schedule_random_boss_ender_pattern(ctx, monster_id);
}

// Initialize boss AI state when a boss is spawned
pub fn initialize_boss_ai(ctx: &ReducerContext, monster_id: u32) {
    // Get the monster to determine its type
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if monster_opt.is_none() {
        log::warn!("initialize_boss_ai: Monster {} not found", monster_id);
        return;
    }
    
    let monster = monster_opt.unwrap();
    
    match monster.bestiary_id {
        MonsterType::BossEnderPhase1 | MonsterType::BossEnderPhase2 => {
            log::info!("Initializing Björn boss AI for monster {}", monster_id);
            // Delegate to boss_ender_defs for Björn boss specific initialization
            crate::boss_bjorn_defs::initialize_boss_ender_ai(ctx, monster_id);
        },
        MonsterType::BossAgnaPhase1 | MonsterType::BossAgnaPhase2 => {
            log::info!("Initializing Claudia boss AI for monster {}", monster_id);
            // Delegate to boss_agna_defs for Claudia boss specific initialization
            crate::boss_claudia_defs::initialize_boss_agna_ai(ctx, monster_id);
        },
        _ => {
            log::warn!("initialize_boss_ai called for non-boss monster {} of type {:?}", monster_id, monster.bestiary_id);
        }
    }
}

// Initialize Phase 2 boss AI state (stays idle, no patterns)
pub fn initialize_phase2_boss_ai(ctx: &ReducerContext, monster_id: u32) {
    // Get the monster to determine its type
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if monster_opt.is_none() {
        log::warn!("initialize_phase2_boss_ai: Monster {} not found", monster_id);
        return;
    }
    
    let monster = monster_opt.unwrap();
    
    match monster.bestiary_id {
        MonsterType::BossEnderPhase2 => {
            log::info!("Initializing Phase 2 Björn boss AI for monster {} (BossEnderIdle only, no patterns)", monster_id);
            // Delegate to boss_ender_defs for Björn boss specific initialization
            crate::boss_bjorn_defs::initialize_phase2_boss_ender_ai(ctx, monster_id);
        },
        MonsterType::BossAgnaPhase2 => {
            log::info!("Initializing Phase 2 Claudia boss AI for monster {}", monster_id);
            // Delegate to boss_agna_defs for Claudia boss specific initialization
            crate::boss_claudia_defs::initialize_phase2_boss_agna_ai(ctx, monster_id);
        },
        _ => {
            log::warn!("initialize_phase2_boss_ai called for non-phase-2-boss monster {} of type {:?}", monster_id, monster.bestiary_id);
        }
    }
}

// Get movement behavior based on AI state
pub fn get_movement_behavior_for_state(state: &AIState) -> MovementBehavior {
    match state {
        AIState::Default => MovementBehavior::Normal,
        AIState::BossEnderIdle => MovementBehavior::Normal,
        AIState::BossEnderChase => MovementBehavior::EnderChase,
        AIState::BossEnderDance => MovementBehavior::StandStill,
        AIState::BossEnderVanish => MovementBehavior::StandStill,
        AIState::BossEnderLurk => MovementBehavior::StandStill,
        AIState::BossEnderTeleport => MovementBehavior::StandStill,
        AIState::BossEnderTransform => MovementBehavior::StandStill,
        AIState::BossAgnaIdle => MovementBehavior::Normal,
        AIState::BossAgnaFlamethrower => MovementBehavior::Normal, // Use chase behavior for flamethrower
        AIState::BossAgnaMagicCircle => MovementBehavior::StandStill, // Claudia stands still during magic circle
        AIState::BossAgnaRitualMatch => MovementBehavior::StandStill, // Claudia stands still during ritual
        AIState::BossAgnaRitualWick => MovementBehavior::StandStill, // Claudia stands still during ritual
        AIState::BossAgnaRitualFailed => MovementBehavior::StandStill, // Claudia stands still when vulnerable
        AIState::BossAgnaRitualComplete => MovementBehavior::StandStill, // Claudia stands still during completion
        AIState::BossSimonIdle => MovementBehavior::Normal,
        AIState::BossSimonChemicalBoltPattern => MovementBehavior::StandStill,
        AIState::BossSimonToxicZonePattern => MovementBehavior::StandStill,
        AIState::BossSimonPhase2Transform => MovementBehavior::StandStill,
        AIState::BossJorgeIdle => MovementBehavior::Normal,
        AIState::Stationary => MovementBehavior::StandStill,
    }
}

// Movement behavior enum
#[derive(Debug, PartialEq)]
pub enum MovementBehavior {
    Normal = 0,
    EnderChase = 1,
    StandStill = 2,
}

// Helper functions to convert between MovementBehavior and u8 for caching
pub fn movement_behavior_to_u8(behavior: MovementBehavior) -> u8 {
    behavior as u8
}

pub fn movement_behavior_from_u8(value: u8) -> MovementBehavior {
    match value {
        0 => MovementBehavior::Normal,
        1 => MovementBehavior::EnderChase,
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
    if distance <= 128.0 { // BOSS_ENDER_CHASE_STOP_DISTANCE moved to boss_ender_defs
        log::info!("Boss {} is close enough to target (distance: {:.1}), stopping chase and scheduling attack", monster_id, distance);
        
        // Cancel any existing scheduled state changes (like the original chase->idle transition)
        cancel_scheduled_state_changes(ctx, monster_id);
        
        // Change state back to idle immediately
        let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
        if let Some(mut monster) = monster_opt {
            monster.ai_state = AIState::BossEnderIdle;
            ctx.db.monsters().monster_id().update(monster.clone());
            
            // Reset speed to base bestiary speed since we're exiting chase mode
            reset_monster_speed_to_bestiary(ctx, &monster);
            
            // Schedule new random boss pattern with short delay (immediate attack)
            schedule_random_boss_ender_pattern(ctx, monster_id);
        }
    }
}

// Helper function to check if a monster should deal damage based on its AI state
pub fn can_monster_deal_damage(state: &AIState) -> bool {
    match state {
        AIState::Default => true,
        AIState::BossEnderIdle => true,
        AIState::BossEnderChase => true,
        AIState::BossEnderDance => true,
        AIState::BossEnderVanish => true,
        AIState::BossEnderLurk => false, 
        AIState::BossEnderTeleport => true, 
        AIState::BossEnderTransform => true,
        AIState::BossAgnaIdle => true,
        AIState::BossAgnaFlamethrower => true,
        AIState::BossAgnaMagicCircle => true,
        AIState::BossAgnaRitualMatch => false, // Invulnerable during ritual match
        AIState::BossAgnaRitualWick => false, // Invulnerable during ritual wick
        AIState::BossAgnaRitualFailed => true, // Vulnerable when ritual failed
        AIState::BossAgnaRitualComplete => false, // Invulnerable during completion
        AIState::BossSimonIdle => true,
        AIState::BossSimonChemicalBoltPattern => true,
        AIState::BossSimonToxicZonePattern => true,
        AIState::BossSimonPhase2Transform => true,
        AIState::Stationary => true,
        AIState::BossJorgeIdle => true,
    }
}

// Helper function to check if a monster can receive damage based on its AI state
pub fn can_monster_receive_damage(state: &AIState) -> bool {
    match state {
        AIState::Default => true,
        AIState::BossEnderIdle => true,
        AIState::BossEnderChase => true,
        AIState::BossEnderDance => true,
        AIState::BossEnderVanish => false, // Immune while vanishing
        AIState::BossEnderLurk => false,   // Immune while lurking (hidden)
        AIState::BossEnderTeleport => true,
        AIState::BossEnderTransform => true,
        AIState::BossAgnaIdle => true,
        AIState::BossAgnaFlamethrower => true,
        AIState::BossAgnaMagicCircle => true,
        AIState::BossAgnaRitualMatch => false, // Immune during ritual match
        AIState::BossAgnaRitualWick => false,  // Immune during ritual wick
        AIState::BossAgnaRitualFailed => true, // Vulnerable when ritual failed
        AIState::BossAgnaRitualComplete => false, // Immune during completion
        AIState::BossSimonIdle => true,
        AIState::BossSimonChemicalBoltPattern => true,
        AIState::BossSimonToxicZonePattern => true,
        AIState::BossSimonPhase2Transform => true,
        AIState::Stationary => true,
        AIState::BossJorgeIdle => true,
    }
}

