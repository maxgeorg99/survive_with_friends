use spacetimedb::{table, reducer, Table, ReducerContext, ScheduleAt};
use crate::{AttackType, account, player, player_scheduled_attacks};
use std::time::Duration;

// Table to store a saved player build's core stats
#[table(name = saved_build, public)]
pub struct SavedBuild {
    #[primary_key]
    pub build_id: u32,
    
    pub max_hp: f32,
    pub armor: u32,
    pub speed: f32,
    pub hp_regen: u32,
}

// Table to store saved attacks (copy of PlayerScheduledAttack without scheduling fields)
#[table(name = saved_attacks, public)]
pub struct SavedAttack {
    #[primary_key]
    #[auto_inc]
    pub saved_attack_id: u32,
    
    pub attack_type: AttackType,
    pub skill_level: u32,
    pub parameter_u: u32,
    pub parameter_i: i32,
    pub attack_count: u32,
    
    // Combat stats
    pub duration: u32,
    pub projectiles: u32,
    pub fire_delay: u32,
    pub speed: f32,
    pub piercing: bool,
    pub radius: f32,
    pub damage: u32,
    pub armor_piercing: u32,
}

// Admin-only cheat reducer to save the current player's build
#[reducer]
pub fn save_build(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "SaveBuild");
    
    // Get the identity of the caller
    let identity = ctx.sender;
    
    // Find the account for the caller
    let account = ctx.db.account().identity().find(&identity)
        .expect("SaveBuild: Account does not exist for caller");

    let player_id = account.current_player_id;
    if player_id == 0 {
        log::error!("SaveBuild: Account {} has no current player", account.name);
        panic!("SaveBuild: No current player to save build from");
    }

    // Get the player data
    let player = ctx.db.player().player_id().find(&player_id)
        .expect(&format!("SaveBuild: Player {} does not exist", player_id));

    log::info!("SaveBuild: Saving build for player {} ({})", player.name, player_id);

    // Clear existing saved build data (only holds one build at a time)
    let existing_builds: Vec<_> = ctx.db.saved_build().iter().collect();
    let builds_count = existing_builds.len();
    for build in existing_builds {
        ctx.db.saved_build().build_id().delete(&build.build_id);
    }
    log::info!("SaveBuild: Cleared {} existing saved builds", builds_count);

    // Clear existing saved attacks
    let existing_attacks: Vec<_> = ctx.db.saved_attacks().iter().collect();
    let attacks_count = existing_attacks.len();
    for attack in existing_attacks {
        ctx.db.saved_attacks().saved_attack_id().delete(&attack.saved_attack_id);
    }
    log::info!("SaveBuild: Cleared {} existing saved attacks", attacks_count);

    // Save the player's core stats
    ctx.db.saved_build().insert(SavedBuild {
        build_id: 1, // Fixed ID since we only store one build
        max_hp: player.max_hp,
        armor: player.armor,
        speed: player.speed,
        hp_regen: player.hp_regen,
    });

    log::info!("SaveBuild: Saved core stats - MaxHP: {}, Armor: {}, Speed: {}, HPRegen: {}", 
               player.max_hp, player.armor, player.speed, player.hp_regen);

    // Save all player's scheduled attacks
    let scheduled_attacks: Vec<_> = ctx.db.player_scheduled_attacks().player_id().filter(&player_id).collect();
    let mut saved_count = 0;
    
    for scheduled_attack in scheduled_attacks {
        ctx.db.saved_attacks().insert(SavedAttack {
            saved_attack_id: 0,
            attack_type: scheduled_attack.attack_type.clone(),
            skill_level: scheduled_attack.skill_level,
            parameter_u: scheduled_attack.parameter_u,
            parameter_i: scheduled_attack.parameter_i,
            attack_count: scheduled_attack.attack_count,
            duration: scheduled_attack.duration,
            projectiles: scheduled_attack.projectiles,
            fire_delay: scheduled_attack.fire_delay,
            speed: scheduled_attack.speed,
            piercing: scheduled_attack.piercing,
            radius: scheduled_attack.radius,
            damage: scheduled_attack.damage,
            armor_piercing: scheduled_attack.armor_piercing,
        });
        saved_count += 1;
        
        log::info!("SaveBuild: Saved attack {:?} - Damage: {}, Projectiles: {}, Speed: {}", 
                   scheduled_attack.attack_type, scheduled_attack.damage, scheduled_attack.projectiles, scheduled_attack.speed);
    }

    log::info!("SaveBuild: Successfully saved build with {} attacks for player {} ({})", 
               saved_count, player.name, player_id);
}

// Admin-only cheat reducer to load the saved build onto the current player
#[reducer]
pub fn load_build(ctx: &ReducerContext) {
    // Check admin access first
    crate::require_admin_access(ctx, "LoadBuild");
    
    // Get the identity of the caller
    let identity = ctx.sender;
    
    // Find the account for the caller
    let account = ctx.db.account().identity().find(&identity)
        .expect("LoadBuild: Account does not exist for caller");

    let player_id = account.current_player_id;
    if player_id == 0 {
        log::error!("LoadBuild: Account {} has no current player", account.name);
        panic!("LoadBuild: No current player to load build onto");
    }

    // Get the player data
    let mut player = ctx.db.player().player_id().find(&player_id)
        .expect(&format!("LoadBuild: Player {} does not exist", player_id));

    log::info!("LoadBuild: Loading build onto player {} ({})", player.name, player_id);

    // Check if we have a saved build to load
    let saved_build = ctx.db.saved_build().build_id().find(&1);
    if saved_build.is_none() {
        log::error!("LoadBuild: No saved build found to load");
        panic!("LoadBuild: No saved build found to load");
    }
    let saved_build = saved_build.unwrap();

    // Cancel all existing scheduled attacks for the player
    let existing_attacks: Vec<_> = ctx.db.player_scheduled_attacks().player_id().filter(&player_id).collect();
    let mut cancelled_count = 0;
    
    for attack in existing_attacks {
        ctx.db.player_scheduled_attacks().scheduled_id().delete(&attack.scheduled_id);
        cancelled_count += 1;
    }
    log::info!("LoadBuild: Cancelled {} existing scheduled attacks", cancelled_count);

    // Update player's core stats from saved build
    player.max_hp = saved_build.max_hp;
    player.hp = saved_build.max_hp; // Set current HP to max HP when loading
    player.armor = saved_build.armor;
    player.speed = saved_build.speed;
    player.hp_regen = saved_build.hp_regen;

    // Store player name before moving the player
    let player_name = player.name.clone();

    // Update the player in the database
    ctx.db.player().player_id().update(player);

    log::info!("LoadBuild: Updated core stats - MaxHP: {}, Armor: {}, Speed: {}, HPRegen: {}", 
               saved_build.max_hp, saved_build.armor, saved_build.speed, saved_build.hp_regen);

    // Load and schedule all saved attacks
    let saved_attacks: Vec<_> = ctx.db.saved_attacks().iter().collect();
    let mut loaded_count = 0;

    for saved_attack in saved_attacks {
        // Get base attack data to determine cooldown
        let attack_data = crate::attacks_def::find_attack_data_by_type(ctx, &saved_attack.attack_type);
        let cooldown = match attack_data {
            Some(data) => data.cooldown,
            None => {
                log::error!("LoadBuild: Attack data not found for type {:?}", saved_attack.attack_type);
                continue;
            }
        };

        // Create new scheduled attack using saved data
        ctx.db.player_scheduled_attacks().insert(crate::PlayerScheduledAttack {
            scheduled_id: 0,
            player_id,
            attack_type: saved_attack.attack_type.clone(),
            skill_level: saved_attack.skill_level,
            parameter_u: saved_attack.parameter_u,
            parameter_i: saved_attack.parameter_i,
            attack_count: saved_attack.attack_count,
            duration: saved_attack.duration,
            projectiles: saved_attack.projectiles,
            fire_delay: saved_attack.fire_delay,
            speed: saved_attack.speed,
            piercing: saved_attack.piercing,
            radius: saved_attack.radius,
            damage: saved_attack.damage,
            armor_piercing: saved_attack.armor_piercing,
            scheduled_at: ScheduleAt::Interval(Duration::from_millis(cooldown as u64).into()),
        });
        loaded_count += 1;

        log::info!("LoadBuild: Loaded attack {:?} - Damage: {}, Projectiles: {}, Speed: {}", 
                   saved_attack.attack_type, saved_attack.damage, saved_attack.projectiles, saved_attack.speed);
    }

    log::info!("LoadBuild: Successfully loaded build with {} attacks onto player {} ({})", 
               loaded_count, player_name, player_id);
} 