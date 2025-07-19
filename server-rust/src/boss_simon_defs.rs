use std::cmp::PartialEq;
use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{DbVector2, MonsterType, MonsterAttackType, config, player, bestiary, monsters, monsters_boid, Player};
use crate::monster_attacks_def::active_monster_attacks;
use crate::monster_ai_defs::monster_state_changes;
use std::time::Duration;

// General constants for Simon boss
const SIMON_IDLE_DURATION_MS: u64 = 2000;            // 2 seconds idle between patterns
const TOXIC_SPRAY_PATTERN_DURATION_MS: u64 = 8000;   // Duration of toxic spray pattern

// Phase 1 Chemical Bolt attack constants
const CHEMICAL_BOLT_DAMAGE: u32 = 35;                // Base damage for chemical bolts
const CHEMICAL_BOLT_RADIUS: f32 = 32.0;              // Collision radius
const CHEMICAL_BOLT_SPEED: f32 = 400.0;              // Movement speed
const CHEMICAL_BOLT_DURATION_MS: u64 = 3000;         // Time until bolt expires
const CHEMICAL_BOLT_INTERVAL_MS: u64 = 1200;         // Time between shots (every 1.2 seconds)
const CHEMICAL_BOLT_PATTERN_DURATION_MS: u64 = 8000; // Duration of bolt attack pattern

// Phase 1 Toxic Zone attack constants
const TOXIC_ZONE_DAMAGE: u32 = 10;                   // Reduced damage per tick (from 20)
const TOXIC_ZONE_RADIUS: f32 = 96.0;                 // Large area of effect
const TOXIC_ZONE_DURATION_MS: u64 = 6000;            // Zone lasts 6 seconds
const TOXIC_ZONE_INTERVAL_MS: u64 = 4000;            // Time between zones (every 4 seconds)
const TOXIC_ZONE_PATTERN_DURATION_MS: u64 = 12000;   // Duration of toxic zone pattern

// Phase 2 Toxic Spray attack constants (chemical breath)
const TOXIC_SPRAY_DAMAGE: u32 = 45;                  // Higher damage in phase 2
const TOXIC_SPRAY_RADIUS: f32 = 48.0;                // Breath weapon radius
const TOXIC_SPRAY_SPEED: f32 = 350.0;                // Projectile speed
const TOXIC_SPRAY_DURATION_MS: u64 = 1500;           // Each spray duration
const TOXIC_SPRAY_INTERVAL_MS: u64 = 800;            // Time between sprays (increased from 250ms)
const TOXIC_SPRAY_PATTERN_MS: u64 = 8000;            // Total spray attack duration
const TOXIC_SPRAY_ARC_DEGREES: f32 = 60.0;           // Arc of toxic spray attack
const TOXIC_SPRAY_PROJECTILES: u32 = 4;              // Projectiles per spray (reduced from 5)

// Phase 2 Chemical Zombie spawn constants
const ZOMBIE_SPAWN_COUNT: u32 = 2;                   // Zombies per wave
const ZOMBIE_SPAWN_INTERVAL_MS: u64 = 15000;         // Time between zombie waves
const ZOMBIE_SPAWN_RADIUS_MIN: f32 = 150.0;          // Min spawn distance
const ZOMBIE_SPAWN_RADIUS_MAX: f32 = 300.0;          // Max spawn distance

// Phase 2 Chemical Enhancement constants
const PHASE2_DAMAGE_MULTIPLIER: f32 = 1.5;           // Increased damage
const PHASE2_SPEED_MULTIPLIER: f32 = 1.3;            // Increased speed
const PHASE2_DOT_DAMAGE: u32 = 10;                   // Chemical damage over time
const PHASE2_DOT_INTERVAL_MS: u64 = 1000;            // Tick interval for DoT

// Table to track the last chosen pattern for each Simon boss to avoid repetition
#[table(name = boss_simon_last_patterns, public)]
pub struct BossSimonLastPattern {
    #[primary_key]
    pub monster_id: u32,

    pub last_pattern: crate::monster_ai_defs::AIState,
}

// Table for Chemical Zombie spawning during Phase 2
#[table(name = simon_zombie_wave_scheduler, scheduled(spawn_chemical_zombie_wave), public)]
pub struct SimonZombieWaveScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,

    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster ID
    pub scheduled_at: ScheduleAt, // When to spawn zombies
}

// Table for Toxic Zone attack scheduling
#[table(name = toxic_zone_scheduler, scheduled(trigger_toxic_zone), public)]
pub struct ToxicZoneScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster ID
    pub scheduled_at: ScheduleAt, // When to spawn toxic zone
}

// Table for Chemical Bolt attack scheduling
#[table(name = chemical_bolt_scheduler, scheduled(trigger_chemical_bolt), public)]
pub struct ChemicalBoltScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster ID
    pub target_player_id: u32,
    pub scheduled_at: ScheduleAt, // When to fire bolt
}

// Table for Toxic Spray attack scheduling
#[table(name = toxic_spray_scheduler, scheduled(trigger_toxic_spray), public)]
pub struct ToxicSprayScheduler {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    
    #[index(btree)]
    pub boss_monster_id: u32,     // The boss monster ID
    pub scheduled_at: ScheduleAt, // When to trigger spray
    pub spray_count: u32,         // Number of sprays remaining
}

// Reducer for spawning chemical zombies
#[reducer]
pub fn spawn_chemical_zombie_wave(ctx: &ReducerContext, spawner: SimonZombieWaveScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("spawn_chemical_zombie_wave may not be invoked by clients.");
    }

    // Check if boss still exists
    let boss_opt = ctx.db.monsters().monster_id().find(&spawner.boss_monster_id);
    if boss_opt.is_none() {
        return;
    }

    let mut rng = ctx.rng();
    
    // Spawn zombies around the boss
    for _ in 0..ZOMBIE_SPAWN_COUNT {
        let spawn_distance = ZOMBIE_SPAWN_RADIUS_MIN + 
            (rng.gen::<f32>() * (ZOMBIE_SPAWN_RADIUS_MAX - ZOMBIE_SPAWN_RADIUS_MIN));
        let spawn_angle = rng.gen::<f32>() * std::f32::consts::PI * 2.0;
        
        // Calculate spawn position
        let boss_pos = ctx.db.monsters_boid().monster_id()
            .find(&spawner.boss_monster_id)
            .expect("Boss boid not found")
            .position;
            
        let spawn_pos = DbVector2::new(
            boss_pos.x + spawn_distance * spawn_angle.cos(),
            boss_pos.y + spawn_distance * spawn_angle.sin()
        );

        // Create zombie spawner
        crate::monsters_def::create_monster_spawner(
            ctx,
            spawn_pos,
            MonsterType::Zombie,
            ScheduleAt::Time(ctx.timestamp + Duration::from_millis(1000))
        );
    }

    // Schedule next wave
    schedule_next_zombie_wave(ctx, spawner.boss_monster_id);
}

// Reducer for toxic zone attack
#[reducer]
pub fn trigger_toxic_zone(ctx: &ReducerContext, scheduler: ToxicZoneScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_toxic_zone may not be invoked by clients.");
    }

    // Find random player position
    let players: Vec<_> = ctx.db.player().iter().collect();
    if players.is_empty() {
        schedule_next_toxic_zone(ctx, scheduler.boss_monster_id);
        return;
    }

    let mut rng = ctx.rng();
    let target_player = &players[(rng.gen::<f32>() * players.len() as f32) as usize];
    
    // Create toxic zone at player position
    ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(TOXIC_ZONE_DURATION_MS)),
        position: target_player.position,
        direction: DbVector2::new(0.0, 0.0), // Stationary
        monster_attack_type: MonsterAttackType::SimonToxicZone,
        piercing: true,
        damage: TOXIC_ZONE_DAMAGE,
        radius: TOXIC_ZONE_RADIUS,
        speed: 0.0,
        parameter_u: scheduler.boss_monster_id,
        parameter_f: 0.0,
        ticks_elapsed: 0,
        from_shiny_monster: false,
    });

    schedule_next_toxic_zone(ctx, scheduler.boss_monster_id);
}

// Reducer for chemical bolt attacks
#[reducer]
pub fn trigger_chemical_bolt(ctx: &ReducerContext, scheduler: ChemicalBoltScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_chemical_bolt may not be invoked by clients.");
    }

    // Get boss position and target
    let boss_opt = ctx.db.monsters().monster_id().find(&scheduler.boss_monster_id);
    let boss = match boss_opt {
        Some(m) => m,
        None => return,
    };

    let boss_pos = ctx.db.monsters_boid().monster_id()
        .find(&scheduler.boss_monster_id)
        .expect("Boss boid not found")
        .position;

    let target_player_opt = ctx.db.player().player_id().find(&boss.target_player_id);
    let target_player = match target_player_opt {
        Some(p) => p,
        None => return,
    };

    // Calculate direction to target
    let dir = DbVector2::new(
        target_player.position.x - boss_pos.x,
        target_player.position.y - boss_pos.y
    ).normalize();

    // Create chemical bolt
    ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CHEMICAL_BOLT_DURATION_MS)),
        position: boss_pos,
        direction: dir,
        monster_attack_type: MonsterAttackType::SimonChemicalBolt,
        piercing: false,
        damage: CHEMICAL_BOLT_DAMAGE,
        radius: CHEMICAL_BOLT_RADIUS,
        speed: CHEMICAL_BOLT_SPEED,
        parameter_u: scheduler.boss_monster_id,
        parameter_f: 0.0,
        ticks_elapsed: 0,
        from_shiny_monster: false,
    });

    schedule_next_chemical_bolt(ctx, scheduler.boss_monster_id, target_player.player_id);
}

// Reducer for toxic spray attacks (Phase 2)
#[reducer]
pub fn trigger_toxic_spray(ctx: &ReducerContext, scheduler: ToxicSprayScheduler) {
    if ctx.sender != ctx.identity() {
        panic!("trigger_toxic_spray may not be invoked by clients.");
    }

    // Get boss position
    let boss_pos = match ctx.db.monsters_boid().monster_id().find(&scheduler.boss_monster_id) {
        Some(boid) => boid.position,
        None => return,
    };

    // Calculate spray angles
    let base_angle = scheduler.spray_count as f32 * std::f32::consts::PI / 6.0;
    let angle_step = TOXIC_SPRAY_ARC_DEGREES * std::f32::consts::PI / (180.0 * TOXIC_SPRAY_PROJECTILES as f32);
    
    // Create spray projectiles in an arc
    for i in 0..TOXIC_SPRAY_PROJECTILES {
        let angle = base_angle + (i as f32 * angle_step) - (TOXIC_SPRAY_ARC_DEGREES * std::f32::consts::PI / 360.0);
        let dir = DbVector2::new(angle.cos(), angle.sin());

        ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
            active_monster_attack_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(TOXIC_SPRAY_DURATION_MS)),
            position: boss_pos,
            direction: dir,
            monster_attack_type: MonsterAttackType::SimonToxicSpray,
            piercing: true,
            damage: TOXIC_SPRAY_DAMAGE,
            radius: TOXIC_SPRAY_RADIUS,
            speed: TOXIC_SPRAY_SPEED,
            parameter_u: scheduler.boss_monster_id,
            parameter_f: angle,
            ticks_elapsed: 0,
            from_shiny_monster: false,
        });
    }

    // Schedule next spray if not done
    if scheduler.spray_count > 0 {
        ctx.db.toxic_spray_scheduler().insert(ToxicSprayScheduler {
            scheduled_id: 0,
            boss_monster_id: scheduler.boss_monster_id,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(TOXIC_SPRAY_INTERVAL_MS)),
            spray_count: scheduler.spray_count - 1,
        });
    }
}

// Helper functions for scheduling next attacks
pub fn schedule_next_zombie_wave(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.simon_zombie_wave_scheduler().insert(SimonZombieWaveScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(ZOMBIE_SPAWN_INTERVAL_MS)),
    });
}

pub fn schedule_next_toxic_zone(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.toxic_zone_scheduler().insert(ToxicZoneScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(TOXIC_ZONE_INTERVAL_MS)),
    });
}

pub fn schedule_next_chemical_bolt(ctx: &ReducerContext, boss_monster_id: u32, target_player_id: u32) {
    ctx.db.chemical_bolt_scheduler().insert(ChemicalBoltScheduler {
        scheduled_id: 0,
        boss_monster_id,
        target_player_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CHEMICAL_BOLT_INTERVAL_MS)),
    });
}

pub fn start_toxic_spray_pattern(ctx: &ReducerContext, boss_monster_id: u32) {
    ctx.db.toxic_spray_scheduler().insert(ToxicSprayScheduler {
        scheduled_id: 0,
        boss_monster_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(1000)),
        spray_count: (TOXIC_SPRAY_PATTERN_MS / TOXIC_SPRAY_INTERVAL_MS) as u32,
    });
}

// Cleanup functions for each attack type
pub fn cleanup_chemical_zombie_spawning(ctx: &ReducerContext, boss_monster_id: u32) {
    let spawners: Vec<u64> = ctx.db.simon_zombie_wave_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
        
    for id in spawners {
        ctx.db.simon_zombie_wave_scheduler().scheduled_id().delete(&id);
    }
}

pub fn cleanup_toxic_zones(ctx: &ReducerContext, boss_monster_id: u32) {
    // Cleanup schedulers
    let schedulers: Vec<u64> = ctx.db.toxic_zone_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
        
    for id in schedulers {
        ctx.db.toxic_zone_scheduler().scheduled_id().delete(&id);
    }

    // Cleanup active zones
    let active_zones: Vec<u64> = ctx.db.active_monster_attacks()
        .iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonToxicZone &&
                    a.parameter_u == boss_monster_id)
        .map(|a| a.active_monster_attack_id)
        .collect();
        
    for id in active_zones {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&id);
    }
}

pub fn cleanup_chemical_bolts(ctx: &ReducerContext, boss_monster_id: u32) {
    // Similar cleanup pattern for chemical bolt attacks
    let schedulers: Vec<u64> = ctx.db.chemical_bolt_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
        
    for id in schedulers {
        ctx.db.chemical_bolt_scheduler().scheduled_id().delete(&id);
    }

    let active_bolts: Vec<u64> = ctx.db.active_monster_attacks()
        .iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonChemicalBolt)
        .map(|a| a.active_monster_attack_id)
        .collect();
        
    for id in active_bolts {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&id);
    }
}

pub fn cleanup_toxic_sprays(ctx: &ReducerContext, boss_monster_id: u32) {
    // Cleanup spray schedulers
    let schedulers: Vec<u64> = ctx.db.toxic_spray_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
        
    for id in schedulers {
        ctx.db.toxic_spray_scheduler().scheduled_id().delete(&id);
    }

    // Cleanup active sprays
    let active_sprays: Vec<u64> = ctx.db.active_monster_attacks()
        .iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonToxicSpray)
        .map(|a| a.active_monster_attack_id)
        .collect();
        
    for id in active_sprays {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(&id);
    }
}

// Helper function to apply chemical enhancement effects in Phase 2
pub fn apply_chemical_enhancement(_ctx: &ReducerContext, monster: &mut crate::Monsters) {
    monster.speed *= PHASE2_SPEED_MULTIPLIER;
    // Additional Phase 2 enhancements can be added here
}

// Boss Simon AI States and Phase Control
#[derive(PartialEq)]
pub enum SimonBossPhase {
    Phase1,
    Phase2,
}

// AI State machine for Simon boss
pub fn execute_boss_simon_idle_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} entering idle state", monster.monster_id);
    
    // Get current phase
    let phase = if monster.bestiary_id == MonsterType::BossSimonPhase2 {
        SimonBossPhase::Phase2
    } else {
        SimonBossPhase::Phase1
    };

    match phase {
        SimonBossPhase::Phase1 => {
            // Ensure chemical bolts are active in Phase 1
            start_chemical_bolt_attacks(ctx, monster.monster_id);
        },
        SimonBossPhase::Phase2 => {
            // Only maintain Phase 2 attacks (no chemical bolts)
            start_toxic_zone_attacks(ctx, monster.monster_id);
            start_toxic_spray_pattern(ctx, monster.monster_id);
        }
    }

    // Schedule next attack pattern
    let next_state = schedule_random_simon_pattern(ctx, monster.monster_id);
    let mut updated_monster = monster.clone();
    updated_monster.ai_state = next_state;
    ctx.db.monsters().monster_id().update(updated_monster);
}

// Execute pattern behaviors
pub fn execute_boss_simon_zombie_wave_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} starting zombie wave", monster.monster_id);
    
    // Spawn a wave of zombies
    spawn_chemical_zombie_wave(ctx, SimonZombieWaveScheduler {
        scheduled_id: 0,
        boss_monster_id: monster.monster_id,
        scheduled_at: ScheduleAt::from(ctx.timestamp),
    });
    
    // Return to idle after animation
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        2000); // 2 second animation
}

pub fn execute_boss_simon_transform_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} starting transform", monster.monster_id);
    
    // Return to idle after animation
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        3000); // 3 second transform animation
}

// Ensure Simon shoots chemical bolts during Phase 1
pub fn execute_boss_simon_chemical_bolt_pattern(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} starting chemical bolt pattern", monster.monster_id);

    // Start continuous bolt attacks
    start_chemical_bolt_attacks(ctx, monster.monster_id);

    // Schedule return to idle after pattern duration
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        CHEMICAL_BOLT_PATTERN_DURATION_MS);
}

// Implement toxic zone attack for Phase 2
pub fn execute_boss_simon_toxic_zone_pattern(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} starting toxic zone pattern", monster.monster_id);

    // Start continuous toxic zone spawning
    start_toxic_zone_attacks(ctx, monster.monster_id);

    // Schedule return to idle after pattern duration
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        TOXIC_ZONE_PATTERN_DURATION_MS);
}

// Implement toxic spray attack for Phase 2
pub fn execute_boss_simon_toxic_spray_behavior(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} starting toxic spray pattern", monster.monster_id);

    // Start continuous toxic spray attacks
    start_toxic_spray_pattern(ctx, monster.monster_id);

    // Schedule return to idle after pattern duration
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        TOXIC_SPRAY_PATTERN_DURATION_MS);
}

pub fn execute_boss_simon_phase2_transform(ctx: &ReducerContext, monster: &crate::Monsters) {
    log::info!("Boss Simon {} entering Phase 2 transform", monster.monster_id);
    
    // Apply phase 2 enhancements
    let mut enhanced_monster = monster.clone();
    enhanced_monster.ai_state = crate::monster_ai_defs::AIState::BossSimonPhase2Transform;

    // Get monster stats from bestiary for phase 2
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::BossSimonPhase2 as u32))
        .expect("Could not find Simon Phase 2 bestiary entry!");

    enhanced_monster.bestiary_id = MonsterType::BossSimonPhase2;
    enhanced_monster.speed = bestiary_entry.speed * PHASE2_SPEED_MULTIPLIER;
    enhanced_monster.atk = bestiary_entry.atk * PHASE2_DAMAGE_MULTIPLIER;
    enhanced_monster.max_hp = bestiary_entry.max_hp;
    enhanced_monster.hp = enhanced_monster.max_hp; // Full heal for phase 2
    
    // Update monster with phase 2 stats
    ctx.db.monsters().monster_id().update(enhanced_monster);

    // Schedule return to idle after transform animation
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        3000); // 3 second transform animation

    // Cleanup all Phase 1 attacks first
    cleanup_chemical_bolts(ctx, monster.monster_id);
    cleanup_toxic_zones(ctx, monster.monster_id);
    
    // Start Phase 2 mechanics with slight delays to avoid overwhelming
    // First toxic zone pattern
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster.monster_id,
        target_state: crate::monster_ai_defs::AIState::BossSimonToxicZonePattern,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(3500)),
    });

    // Then chemical bolt pattern
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster.monster_id,
        target_state: crate::monster_ai_defs::AIState::BossSimonChemicalBoltPattern,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(4000)),
    });

    // Start toxic spray pattern
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster.monster_id,
        target_state: crate::monster_ai_defs::AIState::BossSimonToxicSpray,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(4500)),
    });

    // Start zombie spawning immediately since it's independent
    spawn_chemical_zombie_wave(ctx, SimonZombieWaveScheduler {
        scheduled_id: 0,
        boss_monster_id: monster.monster_id,
        scheduled_at: ScheduleAt::from(ctx.timestamp),
    });
}

// Initialize Simon boss AI when spawned
pub fn initialize_simon_boss_ai(ctx: &ReducerContext, monster_id: u32) {
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if let Some(mut monster) = monster_opt {
        // Set initial state to chemical bolt pattern
        monster.ai_state = crate::monster_ai_defs::AIState::BossSimonChemicalBoltPattern;
        ctx.db.monsters().monster_id().update(monster.clone());
        
        // Start chemical bolt pattern immediately
        start_chemical_bolt_attacks(ctx, monster_id);
        
        // Schedule next state change after pattern duration
        schedule_state_change(ctx, monster_id,
            crate::monster_ai_defs::AIState::BossSimonIdle,
            CHEMICAL_BOLT_PATTERN_DURATION_MS);
        
        log::info!("Initialized Simon boss {} in Phase 1 with chemical bolt pattern", monster_id);
    }
}

// Initialize Phase 2 Boss Simon AI (enhanced abilities)
pub fn initialize_phase2_boss_simon_ai(ctx: &ReducerContext, monster_id: u32) {
    log::info!("Initializing Phase 2 Boss Simon AI for monster {}", monster_id);
    
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if monster_opt.is_none() {
        log::warn!("initialize_phase2_boss_simon_ai: Monster {} not found", monster_id);
        return;
    }
    
    let monster = monster_opt.unwrap();
    
    // Start with transform state
    let mut updated_monster = monster.clone();
    updated_monster.ai_state = crate::monster_ai_defs::AIState::BossSimonPhase2Transform;
    
    // Get bestiary entry for phase 2 stats
    let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::BossSimonPhase2 as u32))
        .expect("Could not find Simon Phase 2 bestiary entry!");
        
    // Update monster stats for Phase 2
    updated_monster.speed = bestiary_entry.speed * PHASE2_SPEED_MULTIPLIER;
    updated_monster.atk = bestiary_entry.atk * PHASE2_DAMAGE_MULTIPLIER;
    updated_monster.max_hp = bestiary_entry.max_hp;
    updated_monster.hp = updated_monster.max_hp; // Full heal for phase 2
    ctx.db.monsters().monster_id().update(updated_monster);

    // Schedule return to idle after transform animation
    schedule_state_change(ctx, monster.monster_id,
        crate::monster_ai_defs::AIState::BossSimonIdle,
        3000); // 3 second transform animation

    // Cleanup all Phase 1 attacks first
    cleanup_chemical_bolts(ctx, monster.monster_id);
    cleanup_toxic_zones(ctx, monster.monster_id);
    
    // Start Phase 2 mechanics with slight delays to avoid overwhelming
    // First toxic zone pattern
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster.monster_id,
        target_state: crate::monster_ai_defs::AIState::BossSimonToxicZonePattern,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(3500)),
    });

    // Then chemical bolt pattern
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster.monster_id,
        target_state: crate::monster_ai_defs::AIState::BossSimonChemicalBoltPattern,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(4000)),
    });

    // Start toxic spray pattern
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster.monster_id,
        target_state: crate::monster_ai_defs::AIState::BossSimonToxicSpray,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(4500)),
    });
    
    // Start zombie spawning immediately
    spawn_chemical_zombie_wave(ctx, SimonZombieWaveScheduler {
        scheduled_id: 0,
        boss_monster_id: monster.monster_id,
        scheduled_at: ScheduleAt::from(ctx.timestamp),
    });
}

// Transition to Phase 2
pub fn transition_to_phase2(ctx: &ReducerContext, monster_id: u32) {
    let monster_opt = ctx.db.monsters().monster_id().find(&monster_id);
    if let Some(mut monster) = monster_opt {
        // Cleanup Phase 1 patterns first
        cleanup_chemical_bolts(ctx, monster_id);
        cleanup_toxic_zones(ctx, monster_id);
        
        // Change bestiary ID to Phase 2 version
        monster.bestiary_id = MonsterType::BossSimonPhase2;
        monster.ai_state = crate::monster_ai_defs::AIState::BossSimonPhase2Transform;
        
        // Apply phase 2 enhancements
        let bestiary_entry = ctx.db.bestiary().bestiary_id().find(&(MonsterType::BossSimonPhase2 as u32))
            .expect("Could not find Simon Phase 2 bestiary entry!");
            
        monster.speed = bestiary_entry.speed * PHASE2_SPEED_MULTIPLIER;
        monster.atk = bestiary_entry.atk * PHASE2_DAMAGE_MULTIPLIER;
        monster.max_hp = bestiary_entry.max_hp;
        monster.hp = monster.max_hp; // Full heal for phase 2
        
        ctx.db.monsters().monster_id().update(monster.clone());
        
        log::info!("Boss Simon {} transitioning to Phase 2", monster_id);
        
        // Schedule return to normal patterns after transform animation
        ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
            scheduled_id: 0,
            target_monster_id: monster_id,
            target_state: crate::monster_ai_defs::AIState::BossSimonIdle,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(3000)),
        });
        
        // Start all Phase 2 continuous patterns
        start_chemical_bolt_attacks(ctx, monster_id);
        start_toxic_zone_attacks(ctx, monster_id);
        
        // Start continuous zombie spawning
        spawn_chemical_zombie_wave(ctx, SimonZombieWaveScheduler {
            scheduled_id: 0,
            boss_monster_id: monster_id,
            scheduled_at: ScheduleAt::from(ctx.timestamp),
        });
    }
}

// Master cleanup function for all Simon boss AI schedules
pub fn cleanup_simon_ai_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Cleaning up all Simon boss AI schedules for boss {}", boss_monster_id);

    // Phase 1 & 2 Chemical Bolt cleanup
    let bolt_schedulers: Vec<u64> = ctx.db.chemical_bolt_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
    
    for id in &bolt_schedulers {
        ctx.db.chemical_bolt_scheduler().scheduled_id().delete(id);
    }

    let active_bolts: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonChemicalBolt && 
               a.parameter_u == boss_monster_id)
        .map(|a| a.active_monster_attack_id)
        .collect();
    
    for id in &active_bolts {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(id);
    }

    // Phase 1 & 2 Toxic Zone cleanup
    let zone_schedulers: Vec<u64> = ctx.db.toxic_zone_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
    
    for id in &zone_schedulers {
        ctx.db.toxic_zone_scheduler().scheduled_id().delete(id);
    }

    let active_zones: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonToxicZone && 
               a.parameter_u == boss_monster_id)
        .map(|a| a.active_monster_attack_id)
        .collect();
    
    for id in &active_zones {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(id);
    }

    // Phase 2 Toxic Spray cleanup
    let spray_schedulers: Vec<u64> = ctx.db.toxic_spray_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
    
    for id in &spray_schedulers {
        ctx.db.toxic_spray_scheduler().scheduled_id().delete(id);
    }

    let active_sprays: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonToxicSpray && 
               a.parameter_u == boss_monster_id)
        .map(|a| a.active_monster_attack_id)
        .collect();
    
    for id in &active_sprays {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(id);
    }

    // Phase 2 Zombie Wave cleanup
    let zombie_schedulers: Vec<u64> = ctx.db.simon_zombie_wave_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
    
    for id in &zombie_schedulers {
        ctx.db.simon_zombie_wave_scheduler().scheduled_id().delete(id);
    }

    // Remove pattern tracking
    if ctx.db.boss_simon_last_patterns().monster_id().find(&boss_monster_id).is_some() {
        ctx.db.boss_simon_last_patterns().monster_id().delete(&boss_monster_id);
    }

    log::info!("Cleaned up Simon boss schedules: {} chemical bolts, {} active bolts, {} toxic zones, {} active zones, {} toxic sprays, {} active sprays, {} zombie waves", 
        bolt_schedulers.len(), active_bolts.len(), 
        zone_schedulers.len(), active_zones.len(),
        spray_schedulers.len(), active_sprays.len(),
        zombie_schedulers.len());
}

// Function to cleanup all Phase 2 specific attacks when boss dies
pub fn cleanup_simon_phase2_schedules(ctx: &ReducerContext, boss_monster_id: u32) {
    log::info!("Cleaning up Simon Phase 2 schedules for boss {}", boss_monster_id);

    // Cleanup toxic spray schedulers and active sprays
    let spray_schedulers: Vec<u64> = ctx.db.toxic_spray_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
    
    for id in &spray_schedulers {
        ctx.db.toxic_spray_scheduler().scheduled_id().delete(id);
    }

    let active_sprays: Vec<u64> = ctx.db.active_monster_attacks().iter()
        .filter(|a| a.monster_attack_type == MonsterAttackType::SimonToxicSpray && 
               a.parameter_u == boss_monster_id)
        .map(|a| a.active_monster_attack_id)
        .collect();
    
    for id in &active_sprays {
        ctx.db.active_monster_attacks().active_monster_attack_id().delete(id);
    }

    // Cleanup zombie wave schedulers
    let zombie_schedulers: Vec<u64> = ctx.db.simon_zombie_wave_scheduler()
        .boss_monster_id()
        .filter(&boss_monster_id)
        .map(|s| s.scheduled_id)
        .collect();
    
    for id in &zombie_schedulers {
        ctx.db.simon_zombie_wave_scheduler().scheduled_id().delete(id);
    }

    log::info!("Cleaned up Simon Phase 2 schedules: {} toxic sprays, {} active sprays, {} zombie waves",
        spray_schedulers.len(), active_sprays.len(), zombie_schedulers.len());
}

// Adjust Phase 1 logic to ensure Simon shoots chemical bolts
fn schedule_random_simon_pattern(ctx: &ReducerContext, monster_id: u32) -> crate::monster_ai_defs::AIState {
    let mut rng = ctx.rng();

    // Get current phase
    let monster = ctx.db.monsters().monster_id().find(&monster_id)
        .expect("Could not find Simon boss");

    let phase = if monster.bestiary_id == MonsterType::BossSimonPhase2 {
        SimonBossPhase::Phase2
    } else {
        SimonBossPhase::Phase1
    };

    // Select pattern based on phase
    let next_state = match phase {
        SimonBossPhase::Phase1 => {
            // Only chemical bolts in Phase 1
            crate::monster_ai_defs::AIState::BossSimonChemicalBoltPattern
        },
        SimonBossPhase::Phase2 => {
            // Phase 2: Only toxic spray and toxic zone attacks
            let random_value = rng.gen::<f32>();
            if random_value < 0.5 {
                crate::monster_ai_defs::AIState::BossSimonToxicZonePattern
            } else {
                crate::monster_ai_defs::AIState::BossSimonToxicSpray
            }
        }
    };

    // Store the last pattern to avoid repetition
    if let Some(mut last_pattern) = ctx.db.boss_simon_last_patterns().monster_id().find(&monster_id) {
        last_pattern.last_pattern = next_state;
        ctx.db.boss_simon_last_patterns().monster_id().update(last_pattern);
    } else {
        ctx.db.boss_simon_last_patterns().insert(BossSimonLastPattern {
            monster_id,
            last_pattern: next_state,
        });
    }

    // For Phase 2, maintain continuous zombie spawning regardless of pattern
    if phase == SimonBossPhase::Phase2 {
        schedule_next_zombie_wave(ctx, monster_id);
    }

    next_state
}

// Helper function to schedule state changes for the boss
fn schedule_state_change(ctx: &ReducerContext, monster_id: u32, target_state: crate::monster_ai_defs::AIState, delay_ms: u64) {
    ctx.db.monster_state_changes().insert(crate::monster_ai_defs::MonsterStateChange {
        scheduled_id: 0,
        target_monster_id: monster_id,
        target_state,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(delay_ms)),
    });
}

// Attack pattern start functions 
pub fn start_chemical_bolt_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    // Get boss info to find target
    let boss_opt = ctx.db.monsters().monster_id().find(&boss_monster_id);
    let boss = match boss_opt {
        Some(b) => b,
        None => return,
    };

    // Fire first bolt immediately
    let boss_pos = ctx.db.monsters_boid().monster_id()
        .find(&boss_monster_id)
        .expect("Boss boid not found")
        .position;

    let target_player_opt = ctx.db.player().player_id().find(&boss.target_player_id);
    if let Some(target_player) = target_player_opt {
        // Calculate direction to target
        let dir = DbVector2::new(
            target_player.position.x - boss_pos.x,
            target_player.position.y - boss_pos.y
        ).normalize();

        // Create initial chemical bolt
        ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
            active_monster_attack_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(CHEMICAL_BOLT_DURATION_MS)),
            position: boss_pos,
            direction: dir,
            monster_attack_type: MonsterAttackType::SimonChemicalBolt,
            piercing: false,
            damage: CHEMICAL_BOLT_DAMAGE,
            radius: CHEMICAL_BOLT_RADIUS,
            speed: CHEMICAL_BOLT_SPEED,
            parameter_u: boss_monster_id,
            parameter_f: 0.0,
            ticks_elapsed: 0,
            from_shiny_monster: false,
        });
    }

    // Schedule next bolt
    schedule_next_chemical_bolt(ctx, boss_monster_id, boss.target_player_id);
}

pub fn start_toxic_zone_attacks(ctx: &ReducerContext, boss_monster_id: u32) {
    // Start initial toxic zone immediately
    ctx.db.active_monster_attacks().insert(crate::ActiveMonsterAttack {
        active_monster_attack_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(TOXIC_ZONE_DURATION_MS)),
        position: ctx.db.monsters_boid().monster_id().find(&boss_monster_id)
            .expect("Boss boid not found").position,
        direction: DbVector2::new(0.0, 0.0), // Stationary
        monster_attack_type: MonsterAttackType::SimonToxicZone,
        piercing: true,
        damage: TOXIC_ZONE_DAMAGE,
        radius: TOXIC_ZONE_RADIUS,
        speed: 0.0,
        parameter_u: boss_monster_id,
        parameter_f: 0.0,
        ticks_elapsed: 0,
        from_shiny_monster: false,
    });

    // Schedule continuous toxic zone spawning
    schedule_next_toxic_zone(ctx, boss_monster_id);
}