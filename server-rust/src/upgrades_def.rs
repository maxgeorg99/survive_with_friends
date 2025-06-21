use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp, ScheduleAt, SpacetimeType, rand::Rng};
use crate::{AttackType, Player, account, attack_data, active_attacks, entity, game_state, monsters, monsters_boid, gems, monster_spawners, boss_spawn_timer, monster_spawn_timer, monster_hit_cleanup, active_attack_cleanup, attack_burst_cooldowns, player_scheduled_attacks, monster_damage, player};
use std::time::Duration;

// Upgrade type enum
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum UpgradeType {
    MaxHp,
    HpRegen,
    Speed,
    Armor,
    AttackSword,
    AttackWand,
    AttackKnives,
    AttackShield,
}

// Attack stat enum for upgrades
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AttackStat {
    Damage,
    CooldownReduction,
    Projectiles,
    Speed,
    Radius,
}

// Table for upgrade options offered to players
#[table(name = upgrade_options, public)]
pub struct UpgradeOptionData {
    #[primary_key]
    #[auto_inc]
    pub upgrade_id: u32,

    #[index(btree)]
    pub player_id: u32,
    pub upgrade_index: u32,
    
    pub upgrade_type: UpgradeType,
    pub is_attack_upgrade: bool,
    pub value: u32,

    // Attack upgrade data
    pub attack_type: u32,
    pub damage: u32,
    pub cooldown_ratio: u32,
    pub projectiles: u32,
    pub speed: u32,
    pub radius: u32,

    pub is_new_attack: bool,
}

// Table for chosen upgrades (permanent record)
#[table(name = chosen_upgrades, public)]
pub struct ChosenUpgradeData {
    #[primary_key]
    #[auto_inc]
    pub chosen_upgrade_id: u32,

    #[index(btree)]
    pub player_id: u32,
    
    pub upgrade_type: UpgradeType,
    pub is_attack_upgrade: bool,
    pub value: u32,

    // Attack upgrade data
    pub attack_type: u32,
    pub damage: u32,
    pub cooldown_ratio: u32,
    pub projectiles: u32,
    pub speed: u32,
    pub radius: u32,
    pub is_new_attack: bool,
}

// Main function to draw upgrade options for a player
pub fn draw_upgrade_options(ctx: &ReducerContext, player_id: u32) {
    // See if player has any existing upgrade options
    let existing_options: Vec<_> = ctx.db.upgrade_options().player_id().filter(&player_id).collect();
    if !existing_options.is_empty() {
        // Skip drawing upgrade options
        return;
    }

    // Create a list of all upgrade types
    let all_upgrade_types = vec![
        UpgradeType::MaxHp,
        UpgradeType::HpRegen,
        UpgradeType::Speed,
        UpgradeType::Armor,
        UpgradeType::AttackSword,
        UpgradeType::AttackWand,
        UpgradeType::AttackKnives,
        UpgradeType::AttackShield,
    ];
    
    // Shuffle the list randomly using Fisher-Yates algorithm
    let mut rng = ctx.rng();
    let mut shuffled_types = all_upgrade_types.clone();
    for i in (1..shuffled_types.len()).rev() 
    {
        let j = rng.gen_range(0..=i);
        shuffled_types.swap(i, j);
    }
    
    // Pick the first 3 types
    let selected_types: Vec<_> = shuffled_types.into_iter().take(3).collect();
    
    log::info!("Selected upgrade types for player {}: {:?}", player_id, selected_types);
    
    // Insert upgrade options into database
    for (i, upgrade_type) in selected_types.iter().enumerate() {
        let upgrade_option_data = create_upgrade_option_data(ctx, upgrade_type.clone(), player_id);
        let mut option = upgrade_option_data;
        option.player_id = player_id;
        option.upgrade_index = i as u32;
        
        ctx.db.upgrade_options().insert(option);
    }
}

// Helper function for creating upgrade option data based on upgrade type
fn create_upgrade_option_data(ctx: &ReducerContext, upgrade_type: UpgradeType, player_id: u32) -> UpgradeOptionData {
    // Check if this is an attack upgrade
    let is_attack_upgrade = match upgrade_type {
        UpgradeType::AttackSword | UpgradeType::AttackWand | 
        UpgradeType::AttackKnives | UpgradeType::AttackShield => true,
        _ => false,
    };

    // If it's an attack upgrade, check if player already has it
    if is_attack_upgrade {
        let attack_type = get_attack_type_from_upgrade(&upgrade_type);
        let mut player_has_attack = false;
        
        // Check player's scheduled attacks to see if they already have this attack type
        for attack in ctx.db.player_scheduled_attacks().player_id().filter(&player_id) {
            if attack.attack_type == attack_type {
                player_has_attack = true;
                break;
            }
        }
        
        // If player doesn't have this attack yet, return a "new attack" upgrade option
        if !player_has_attack {
            log::info!("Player {} doesn't have {:?} yet, offering as new attack", player_id, attack_type);
            
            return UpgradeOptionData {
                upgrade_id: 0,
                player_id,
                upgrade_index: 0,
                upgrade_type,
                is_attack_upgrade: true,
                is_new_attack: true,  // Flag to indicate this is a new attack
                attack_type: attack_type as u32,
                value: 0,   // No stat upgrades for new attacks
                damage: 0,
                cooldown_ratio: 0,
                projectiles: 0,
                speed: 0,
                radius: 0,
            };
        }
    }
    
    // For non-attack upgrades or attacks the player already has, proceed with normal upgrade options
    match upgrade_type {
        UpgradeType::MaxHp => {
            UpgradeOptionData {
                upgrade_id: 0,
                player_id,
                upgrade_index: 0,
                upgrade_type,
                value: 100,
                is_attack_upgrade: false,
                is_new_attack: false,
                attack_type: 0,
                damage: 0,
                cooldown_ratio: 0,
                projectiles: 0,
                speed: 0,
                radius: 0,
            }
        }
        UpgradeType::HpRegen => {
            UpgradeOptionData {
                upgrade_id: 0,
                player_id,
                upgrade_index: 0,
                upgrade_type,
                value: 2,
                is_attack_upgrade: false,
                is_new_attack: false,
                attack_type: 0,
                damage: 0,
                cooldown_ratio: 0,
                projectiles: 0,
                speed: 0,
                radius: 0,
            }
        }
        UpgradeType::Speed => {
            UpgradeOptionData {
                upgrade_id: 0,
                player_id,
                upgrade_index: 0,
                upgrade_type,
                value: 32,
                is_attack_upgrade: false,
                is_new_attack: false,
                attack_type: 0,
                damage: 0,
                cooldown_ratio: 0,
                projectiles: 0,
                speed: 0,
                radius: 0,
            }
        }
        UpgradeType::Armor => {
            UpgradeOptionData {
                upgrade_id: 0,
                player_id,
                upgrade_index: 0,
                upgrade_type,
                value: 1,
                is_attack_upgrade: false,
                is_new_attack: false,
                attack_type: 0,
                damage: 0,
                cooldown_ratio: 0,
                projectiles: 0,
                speed: 0,
                radius: 0,
            }
        }
        UpgradeType::AttackSword => {
            // Generate sword-specific stat upgrade
            let possible_stats = vec![
                (AttackStat::Damage, 2),
                (AttackStat::CooldownReduction, 25),
                (AttackStat::Radius, 4),
                (AttackStat::Projectiles, 1),
                (AttackStat::Speed, 100),
            ];
            generate_attack_upgrade(ctx, 1, possible_stats, upgrade_type)
        }
        UpgradeType::AttackWand => {
            // Generate wand-specific stat upgrade
            let possible_stats = vec![
                (AttackStat::Damage, 1),
                (AttackStat::CooldownReduction, 15),
                (AttackStat::Projectiles, 1),
                (AttackStat::Speed, 100),
            ];
            generate_attack_upgrade(ctx, 2, possible_stats, upgrade_type)
        }
        UpgradeType::AttackKnives => {
            // Generate knives-specific stat upgrade
            let possible_stats = vec![
                (AttackStat::Damage, 1),
                (AttackStat::CooldownReduction, 20),
                (AttackStat::Projectiles, 2),
                (AttackStat::Speed, 200),
                (AttackStat::Radius, 3),
            ];
            generate_attack_upgrade(ctx, 3, possible_stats, upgrade_type)
        }
        UpgradeType::AttackShield => {
            // Generate shield-specific stat upgrade
            let possible_stats = vec![
                (AttackStat::Damage, 2),
                (AttackStat::Radius, 4),
                (AttackStat::CooldownReduction, 25),
                (AttackStat::Projectiles, 1),
                (AttackStat::Speed, 45),
            ];
            generate_attack_upgrade(ctx, 4, possible_stats, upgrade_type)
        }
    }
}

// Helper method to generate attack upgrades with specific stat improvements
fn generate_attack_upgrade(ctx: &ReducerContext, attack_type: u32, possible_stats: Vec<(AttackStat, u32)>, upgrade_type: UpgradeType) -> UpgradeOptionData {
    // Choose a random stat to upgrade from the possible stats for this attack type
    let mut rng = ctx.rng();
    let chosen_index = rng.gen_range(0..possible_stats.len());
    let (chosen_stat, upgrade_value) = &possible_stats[chosen_index];
    
    log::info!("Generated attack upgrade: {:?}, Stat: {:?}, Value: {}", upgrade_type, chosen_stat, upgrade_value);
    
    // Create base upgrade data with attack type and is_attack_upgrade flag
    let mut upgrade_data = UpgradeOptionData {
        upgrade_id: 0,
        player_id: 0,
        upgrade_index: 0,
        upgrade_type,
        is_attack_upgrade: true,
        is_new_attack: false,
        attack_type,
        value: *upgrade_value,
        damage: 0,
        cooldown_ratio: 0,
        projectiles: 0,
        speed: 0,
        radius: 0,
    };
    
    // Set the specific stat value based on the chosen stat
    match chosen_stat {
        AttackStat::Damage => {
            upgrade_data.damage = *upgrade_value;
        }
        AttackStat::CooldownReduction => {
            upgrade_data.cooldown_ratio = *upgrade_value;
        }
        AttackStat::Projectiles => {
            upgrade_data.projectiles = *upgrade_value;
        }
        AttackStat::Speed => {
            upgrade_data.speed = *upgrade_value;
        }
        AttackStat::Radius => {
            upgrade_data.radius = *upgrade_value;
        }
    }
    
    upgrade_data
}

#[reducer]
pub fn choose_upgrade(ctx: &ReducerContext, player_id: u32, upgrade_index: u32) {
    // Ensure the caller's identity is the player's identity
    let caller_identity = ctx.sender;
    let identity_account = ctx.db.account().identity().find(&caller_identity)
        .expect("ChooseUpgrade called by null identity");

    if identity_account.current_player_id != player_id {
        // Enhanced error logging with detailed information
        log::error!(
            "ChooseUpgrade called by wrong player! Caller Identity: {}, Account Name: '{}', Account Current Player ID: {}, Requested Player ID: {}, Account State: {:?}",
            caller_identity,
            identity_account.name,
            identity_account.current_player_id,
            player_id,
            identity_account.state
        );
        
        // Also log if the requested player exists
        if let Some(requested_player) = ctx.db.player().player_id().find(&player_id) {
            log::error!(
                "Requested Player Details - ID: {}, Name: '{}', Is Bot: {}, Level: {}",
                requested_player.player_id,
                requested_player.name,
                requested_player.is_bot,
                requested_player.level
            );
        } else {
            log::error!("Requested Player ID {} does not exist in the database", player_id);
        }
        
        // Log the caller's actual player if they have one
        if identity_account.current_player_id > 0 {
            if let Some(caller_player) = ctx.db.player().player_id().find(&identity_account.current_player_id) {
                log::error!(
                    "Caller's Actual Player Details - ID: {}, Name: '{}', Is Bot: {}, Level: {}",
                    caller_player.player_id,
                    caller_player.name,
                    caller_player.is_bot,
                    caller_player.level
                );
            } else {
                log::error!(
                    "Caller's account points to player ID {} but that player does not exist",
                    identity_account.current_player_id
                );
            }
        } else {
            log::error!("Caller's account has no current player (current_player_id = 0)");
        }
        
        panic!("ChooseUpgrade called by wrong player - see detailed logs above");
    }

    // Log successful authentication
    log::info!(
        "ChooseUpgrade: Valid request from Identity: {}, Account: '{}', Player ID: {}, Upgrade Index: {}",
        caller_identity,
        identity_account.name,
        player_id,
        upgrade_index
    );

    // Get the upgrade option data for the player
    let upgrade_options_data: Vec<_> = ctx.db.upgrade_options().player_id().filter(&player_id).collect();

    // Log available upgrade options for debugging
    log::info!("Player {} has {} upgrade options available:", player_id, upgrade_options_data.len());
    for (i, option) in upgrade_options_data.iter().enumerate() {
        log::info!(
            "  Option {}: Index {}, Type: {:?}, Attack: {}, Value: {}",
            i,
            option.upgrade_index,
            option.upgrade_type,
            option.is_attack_upgrade,
            option.value
        );
    }

    // Ensure the player has upgrades to choose from
    if upgrade_options_data.is_empty() {
        log::error!("Player {} has no available upgrades to choose from", player_id);
        panic!("Player has no available upgrades to choose from");
    }

    // Find the specific upgrade option selected
    let mut selected_upgrade = None;
    for option in &upgrade_options_data {
        if option.upgrade_index == upgrade_index {
            selected_upgrade = Some(option.clone());
            break;
        }
    }

    let selected_upgrade = match selected_upgrade {
        Some(upgrade) => {
            log::info!(
                "Player {} selected upgrade index {} (Type: {:?})",
                player_id,
                upgrade_index,
                upgrade.upgrade_type
            );
            upgrade
        }
        None => {
            log::error!(
                "Upgrade with index {} not found for player {}. Available indices: {:?}",
                upgrade_index,
                player_id,
                upgrade_options_data.iter().map(|opt| opt.upgrade_index).collect::<Vec<_>>()
            );
            panic!("Upgrade with index {} not found", upgrade_index);
        }
    };

    // Get count of player's current chosen upgrades to determine the order
    let upgrade_order = ctx.db.chosen_upgrades().player_id().filter(&player_id).count() as u32;

    // Create a chosen upgrade entry based on the selected upgrade
    let chosen_upgrade = ChosenUpgradeData {
        chosen_upgrade_id: 0,
        player_id,
        upgrade_type: selected_upgrade.upgrade_type.clone(),
        is_attack_upgrade: selected_upgrade.is_attack_upgrade,
        value: selected_upgrade.value,
        attack_type: selected_upgrade.attack_type,
        damage: selected_upgrade.damage,
        cooldown_ratio: selected_upgrade.cooldown_ratio,
        projectiles: selected_upgrade.projectiles,
        speed: selected_upgrade.speed,
        radius: selected_upgrade.radius,
        is_new_attack: selected_upgrade.is_new_attack,
    };

    // Apply the upgrade to the player
    apply_player_upgrade(ctx, &chosen_upgrade);

    // Insert the chosen upgrade
    ctx.db.chosen_upgrades().insert(chosen_upgrade);
    
    log::info!("Player {} chose upgrade: {:?}, Order: {}", player_id, selected_upgrade.upgrade_type, upgrade_order);

    // Delete all upgrade options for the player
    let mut delete_count = 0;
    for option in &upgrade_options_data {
        if ctx.db.upgrade_options().upgrade_id().delete(&option.upgrade_id) {
            delete_count += 1;
        }
    }
    
    log::info!("Deleted {} upgrade options for player {}", delete_count, player_id);

    // Try to get player data to update their unspent upgrades
    if let Some(mut player) = ctx.db.player().player_id().find(&player_id) {
        // Check if player has unspent upgrades
        if player.unspent_upgrades > 0 {
            // Decrement unspent upgrades
            player.unspent_upgrades -= 1;

            // If player still has unspent upgrades, draw new options
            if player.unspent_upgrades > 0 {
                draw_upgrade_options(ctx, player_id);
            }

            ctx.db.player().player_id().update(player);
        }
    }
}

// Helper method to apply an upgrade to a player
fn apply_player_upgrade(ctx: &ReducerContext, upgrade: &ChosenUpgradeData) {
    let player_id = upgrade.player_id;
    
    // Get player data
    let player_opt = ctx.db.player().player_id().find(&player_id);
    if player_opt.is_none() {
        log::info!("Cannot apply upgrade - player {} not found", player_id);
        return;
    }
    
    let mut player = player_opt.unwrap();
    
    log::info!("Applying upgrade {:?} to player {}", upgrade.upgrade_type, player_id);
    
    // Handle different upgrade types
    if !upgrade.is_attack_upgrade {
        // Handle non-attack upgrades (directly modify player stats)
        match upgrade.upgrade_type {
            UpgradeType::MaxHp => {
                player.max_hp += upgrade.value as f32;
                player.hp += upgrade.value as f32; // Heal player when max HP increases
                log::info!("Increased player {} max HP by {} to {}", player_id, upgrade.value, player.max_hp);
            }
            UpgradeType::HpRegen => {
                player.hp_regen += upgrade.value;
                log::info!("Increased player {} HP regen by {} to {}", player_id, upgrade.value, player.hp_regen);
            }
            UpgradeType::Speed => {
                player.speed += upgrade.value as f32 / 100.0; // Convert percent to speed factor
                log::info!("Increased player {} speed by {}% to {}", player_id, upgrade.value, player.speed);
            }
            UpgradeType::Armor => {
                player.armor += upgrade.value;
                log::info!("Increased player {} armor by {} to {}", player_id, upgrade.value, player.armor);
            }
            _ => {
                log::info!("Unknown non-attack upgrade type: {:?}", upgrade.upgrade_type);
            }
        }
        
        // Update player record with modified stats
        ctx.db.player().player_id().update(player);
    } else {
        // Handle attack upgrades
        // First, determine which attack type we're upgrading
        let attack_type = get_attack_type_from_upgrade(&upgrade.upgrade_type);

        if attack_type == AttackType::Shield && (upgrade.projectiles > 0 || upgrade.is_new_attack) {
            let new_shield_count = if upgrade.is_new_attack { 2 } else { upgrade.projectiles };
            player.shield_count += new_shield_count;
            ctx.db.player().player_id().update(player);
        }
        
        // Check if this is a new attack
        if upgrade.is_new_attack {
            // Simply schedule the new attack with base stats
            log::info!("Adding new attack {:?} for player {}", attack_type, player_id);
            schedule_new_player_attack(ctx, player_id, attack_type, 1);
            return; // No other modifications needed for new attacks
        }
        
        // This is an upgrade to an existing attack
        // Find the player's scheduled attack for this type
        let mut existing_attack = None;
        let mut scheduled_attack_id = 0;
        
        for attack in ctx.db.player_scheduled_attacks().player_id().filter(&player_id) {
            if attack.attack_type == attack_type {
                scheduled_attack_id = attack.scheduled_id;
                existing_attack = Some(attack);
                break;
            }
        }
        
        if existing_attack.is_none() {
            // Player doesn't have this attack yet (shouldn't happen with is_new_attack flag, but handle anyway)
            log::info!("Player {} doesn't have attack {:?} yet, scheduling new attack", player_id, attack_type);
            schedule_new_player_attack(ctx, player_id, attack_type, 1);
            return;
        }
        
        // Create a copy of the attack to modify
        let mut modified_attack = existing_attack.unwrap();
        let mut update_scheduled_attack = false;
        let mut update_schedule_interval = false;
        let mut cooldown_reduction = 0;
        
        // Apply upgrades to the attack stats
        if upgrade.damage > 0 {
            // Damage upgrade - increase the damage stat directly
            modified_attack.damage += upgrade.damage;
            update_scheduled_attack = true;
            log::info!("Increased attack {:?} damage by {} to {}", attack_type, upgrade.damage, modified_attack.damage);
        }
        
        if upgrade.cooldown_ratio > 0 {
            // Cooldown reduction (increased fire rate)
            cooldown_reduction = upgrade.cooldown_ratio;
            update_schedule_interval = true;
            log::info!("Increased attack {:?} fire rate by {}%", attack_type, upgrade.cooldown_ratio);
        }
        
        if upgrade.projectiles > 0 {
            // More projectiles - update the projectiles count
            modified_attack.projectiles += upgrade.projectiles;
            update_scheduled_attack = true;
            log::info!("Increased attack {:?} projectiles by {} to {}", attack_type, upgrade.projectiles, modified_attack.projectiles);
        }
        
        if upgrade.speed > 0 {
            // Projectile speed upgrade
            modified_attack.speed += modified_attack.speed * upgrade.speed as f32 / 100.0;
            update_scheduled_attack = true;
            log::info!("Increased attack {:?} speed by {}% to {}", attack_type, upgrade.speed, modified_attack.speed);
        }
        
        if upgrade.radius > 0 {
            // Attack radius upgrade
            modified_attack.radius += upgrade.radius as f32;
            update_scheduled_attack = true;
            log::info!("Increased attack {:?} radius by {} to {}", attack_type, upgrade.radius, modified_attack.radius);
        }
        
        // Handle cooldown reduction by updating the schedule interval
        if update_schedule_interval && cooldown_reduction > 0 {
            // Calculate new cooldown using the current cooldown (not base cooldown) for proper stacking
            let current_cooldown = modified_attack.cooldown;
            let reduction = current_cooldown * cooldown_reduction / 100;
            let new_cooldown = current_cooldown - reduction;
            
            // Update the cooldown in the modified attack
            modified_attack.cooldown = new_cooldown;
            update_scheduled_attack = true;
            
            // Update the attack scheduling interval
            ctx.db.player_scheduled_attacks().scheduled_id().delete(&scheduled_attack_id);
            
            // Create a new scheduled attack with the updated interval
            let new_scheduled_attack = crate::PlayerScheduledAttack {
                scheduled_id: 0,
                player_id,
                attack_type: attack_type.clone(),
                skill_level: modified_attack.skill_level,
                parameter_u: modified_attack.parameter_u,
                parameter_i: modified_attack.parameter_i,
                attack_count: modified_attack.attack_count, // Preserve attack count
                cooldown: new_cooldown,
                duration: modified_attack.duration,
                projectiles: modified_attack.projectiles,
                fire_delay: modified_attack.fire_delay,
                speed: modified_attack.speed,
                piercing: modified_attack.piercing,
                radius: modified_attack.radius,
                damage: modified_attack.damage,
                armor_piercing: modified_attack.armor_piercing,
                scheduled_at: ScheduleAt::Interval(Duration::from_millis(new_cooldown as u64).into()),
            };
            
            ctx.db.player_scheduled_attacks().insert(new_scheduled_attack);
            
            log::info!("Updated attack cooldown: reduced from {}ms to {}ms (stacking upgrade)", current_cooldown, new_cooldown);
        }

        // Update the scheduled attack record if any stats were changed
        if update_scheduled_attack {
            ctx.db.player_scheduled_attacks().scheduled_id().update(modified_attack);
            log::info!("Updated scheduled attack for player {}, attack type {:?}", player_id, attack_type);
        }
    }
}

// Helper method to convert from UpgradeType to AttackType
fn get_attack_type_from_upgrade(upgrade_type: &UpgradeType) -> AttackType {
    match upgrade_type {
        UpgradeType::AttackSword => AttackType::Sword,
        UpgradeType::AttackWand => AttackType::Wand,
        UpgradeType::AttackKnives => AttackType::Knives,
        UpgradeType::AttackShield => AttackType::Shield,
        _ => panic!("Cannot convert upgrade type {:?} to attack type", upgrade_type),
    }
}

// Reroll upgrade options for a player
#[reducer]
pub fn reroll_upgrades(ctx: &ReducerContext, player_id: u32) {
    // Ensure the caller's identity is the player's identity
    let identity_account = ctx.db.account().identity().find(&ctx.sender)
        .expect("RerollUpgrades called by null identity");

    if identity_account.current_player_id != player_id {
        panic!("RerollUpgrades called by wrong player");
    }
    
    // Get player data
    let player_opt = ctx.db.player().player_id().find(&player_id);
    if player_opt.is_none() {
        panic!("Player with ID {} not found", player_id);
    }
    
    let mut player = player_opt.unwrap();
    
    // Check if player has rerolls and unspent upgrades
    if player.rerolls <= 0 {
        panic!("Player has no rerolls available");
    }
    
    if player.unspent_upgrades <= 0 {
        panic!("Player has no unspent upgrades to reroll");
    }
    
    // Delete existing upgrade options
    let upgrade_options_data: Vec<_> = ctx.db.upgrade_options().player_id().filter(&player_id).collect();
    let mut delete_count = 0;
    for option in &upgrade_options_data {
        if ctx.db.upgrade_options().upgrade_id().delete(&option.upgrade_id) {
            delete_count += 1;
        }
    }
    
    log::info!("Deleted {} upgrade options for player {} during reroll", delete_count, player_id);
    
    // Decrement player's rerolls
    player.rerolls -= 1;
    ctx.db.player().player_id().update(player);
    
    // Draw new upgrade options
    draw_upgrade_options(ctx, player_id);
}

// Helper function to schedule a new player attack
fn schedule_new_player_attack(ctx: &ReducerContext, player_id: u32, attack_type: AttackType, skill_level: u32) {
    crate::attacks_def::schedule_new_player_attack(ctx, player_id, attack_type, skill_level);
}

// Helper function to find attack data by type
fn find_attack_data_by_type(ctx: &ReducerContext, attack_type: &AttackType) -> Option<crate::AttackData> {
    ctx.db.attack_data().attack_type().find(attack_type)
}

// Helper function to clean up all pending upgrade options for a player
pub fn cleanup_player_upgrade_options(ctx: &ReducerContext, player_id: u32) {
    log::info!("Cleaning up all upgrade options for player {}", player_id);
    
    // Get all upgrade options for this player
    let upgrade_options_to_delete: Vec<_> = ctx.db.upgrade_options().player_id().filter(&player_id).collect();
    
    // Delete all found upgrade options
    for option in &upgrade_options_to_delete {
        ctx.db.upgrade_options().upgrade_id().delete(&option.upgrade_id);
    }
    
    log::info!("Deleted {} upgrade options for player {}", upgrade_options_to_delete.len(), player_id);
} 