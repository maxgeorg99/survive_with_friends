use spacetimedb::{table, Table, ReducerContext, Identity, SpacetimeType};
use crate::{account, chosen_upgrades, AttackType, MonsterType};

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq, Hash)]
pub enum AchievementType {
    SlimeSlayer,     // Kill X slimes
    RatSlayer,       // Kill X rats
    WormSlayer,      // Kill X worms
    ScorpionSlayer,  // Kill X scorpions
    OrcHunter,       // Kill X orcs
    WolfHunter,      // Kill X wolves
    DefeatJorge,     // Defeat Jorge boss
    DefeatBjörn,     // Defeat Björn boss
    DefeatSimon,     // Defeat Simon boss
    Expert,          // Reach level 10
    WeaponArsenal,   // Collect X different weapons
    Survivor,        // Win the game
}

#[table(name = achievements, public)]
pub struct AchievementDefinition {
    #[primary_key]
    #[auto_inc]
    pub achievement_id: u32,

    #[index(btree)]
    pub account_identity: Identity,
    pub achievement_type: AchievementType,
    pub title_key: String,
    pub description_key: String,
    pub sprite_path: String,
    pub progress: u32,
    pub target: u32,
    pub is_completed: bool,
}

// Helper structure to define achievement properties
pub struct AchievementBlueprint {
    pub achievement_type: AchievementType,
    pub title_key: &'static str,
    pub description_key: &'static str,
    pub sprite_path: &'static str,
    pub target: u32,
}

// Define the achievement blueprints
pub const ACHIEVEMENT_BLUEPRINTS: &[AchievementBlueprint] = &[
    AchievementBlueprint {
        achievement_type: AchievementType::SlimeSlayer,
        title_key: "achievement_slime_slayer_title",
        description_key: "achievement_slime_slayer_desc",
        sprite_path: "assets/achievements/slime_slayer.png",
        target: 50,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::RatSlayer,
        title_key: "achievement_rat_slayer_title",
        description_key: "achievement_rat_slayer_desc",
        sprite_path: "assets/achievements/rat_slayer.png",
        target: 50,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::WormSlayer,
        title_key: "achievement_worm_slayer_title",
        description_key: "achievement_worm_slayer_desc",
        sprite_path: "assets/achievements/worm_slayer.png",
        target: 50,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::ScorpionSlayer,
        title_key: "achievement_scorpion_slayer_title",
        description_key: "achievement_scorpion_slayer_desc",
        sprite_path: "assets/achievements/scorpion_slayer.png",
        target: 50,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::OrcHunter,
        title_key: "achievement_orc_hunter_title",
        description_key: "achievement_orc_hunter_desc",
        sprite_path: "assets/achievements/orc_hunter.png",
        target: 30,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::WolfHunter,
        title_key: "achievement_wolf_hunter_title",
        description_key: "achievement_wolf_hunter_desc",
        sprite_path: "assets/achievements/wolf_hunter.png",
        target: 30,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::DefeatJorge,
        title_key: "achievement_defeat_jorge_title",
        description_key: "achievement_defeat_jorge_desc",
        sprite_path: "assets/achievements/defeat_jorge.png",
        target: 1,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::DefeatBjörn,
        title_key: "achievement_defeat_bjorn_title",
        description_key: "achievement_defeat_bjorn_desc",
        sprite_path: "assets/achievements/defeat_bjorn.png",
        target: 1,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::DefeatSimon,
        title_key: "achievement_defeat_simon_title",
        description_key: "achievement_defeat_simon_desc",
        sprite_path: "assets/achievements/defeat_simon.png",
        target: 1,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::Expert,
        title_key: "achievement_expert_title",
        description_key: "achievement_expert_desc",
        sprite_path: "assets/achievements/expert.png",
        target: 10,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::WeaponArsenal,
        title_key: "achievement_weapon_arsenal_title",
        description_key: "achievement_weapon_arsenal_desc",
        sprite_path: "assets/achievements/weapon_arsenal.png",
        target: 5,
    },
    AchievementBlueprint {
        achievement_type: AchievementType::Survivor,
        title_key: "achievement_survivor_title",
        description_key: "achievement_survivor_desc",
        sprite_path: "assets/achievements/survivor.png",
        target: 1,
    },
];

// Helper function to get a blueprint by achievement type
pub fn get_achievement_blueprint(achievement_type: &AchievementType) -> Option<&'static AchievementBlueprint> {
    ACHIEVEMENT_BLUEPRINTS.iter().find(|bp| bp.achievement_type == *achievement_type)
}

// Helper function to initialize player achievements when they first spawn
pub fn initialize_player_achievements(ctx: &ReducerContext, identity: Identity) {
    log::info!("Initializing achievements for player {}", identity);

    for blueprint in ACHIEVEMENT_BLUEPRINTS {
        let mut max_id = 0;
        for achievement in ctx.db.achievements().iter() {
            if achievement.achievement_id > max_id {
                max_id = achievement.achievement_id;
            }
        }
        let next_id = max_id + 1;

        ctx.db.achievements().insert(AchievementDefinition {
            achievement_id: next_id,
            account_identity: identity,
            achievement_type: blueprint.achievement_type.clone(),
            title_key: blueprint.title_key.into(),
            description_key: blueprint.description_key.into(),
            sprite_path: blueprint.sprite_path.into(),
            progress: 0,
            target: blueprint.target,
            is_completed: false,
        });
    }

    log::info!("Created {} achievements for player {}", ACHIEVEMENT_BLUEPRINTS.len(), identity);
}

// Track when a player kills a specific monster type
pub fn track_monster_kill(ctx: &ReducerContext, identity: Identity, monster_type: MonsterType) {
    let monster_type_value = monster_type.clone() as u32;
    log::info!("TrackMonsterKill: Player {} killed monster of type {:?} (value: {})", 
               identity, monster_type, monster_type_value);


    // Find achievement type based on monster type
    let achievement_type = match monster_type {
        MonsterType::Slime => Some(AchievementType::SlimeSlayer),
        MonsterType::Rat => Some(AchievementType::RatSlayer),
        MonsterType::Bat => Some(AchievementType::WormSlayer), // Using Bat for WormSlayer achievement
        MonsterType::Orc => Some(AchievementType::OrcHunter),
        MonsterType::Zombie => Some(AchievementType::WolfHunter), // Using Zombie for WolfHunter achievement
        MonsterType::BossEnderPhase2 => Some(AchievementType::DefeatJorge), // Using Björn for Jorge boss
        MonsterType::BossAgnaPhase2 => Some(AchievementType::DefeatSimon), // Using Claudia for Simon boss
        _ => None,
    };

    if let Some(achievement_type) = achievement_type {
        log::info!("Found achievement type {:?} for monster type {:?}, incrementing progress",
                  achievement_type, monster_type);
        increment_achievement_progress(ctx, identity, achievement_type);
    }
}

// Track when a player reaches a new level
pub fn track_player_level(ctx: &ReducerContext, identity: Identity, level: u32) {
    log::info!("Tracking player level for player {}, level: {}", identity, level);

    // The Expert achievement tracks reaching level 10
    if level <= 10 {
        set_achievement_progress(ctx, identity, AchievementType::Expert, level);
    }
}

// Track when a player acquires a new weapon
pub fn track_weapon_acquisition(ctx: &ReducerContext, identity: Identity, attack_type: AttackType) {
    log::info!("Tracking weapon acquisition for player {}", identity);

    // Find player's account
    let Some(account) = ctx.db.account().identity().find(&identity) else {
        log::error!("TrackWeaponAcquisition: Account not found for identity {}", identity);
        return;
    };

    // Count unique weapon types for this player
    let mut unique_weapons = std::collections::HashSet::new();
    for upgrade in ctx.db.chosen_upgrades().iter() {
        if upgrade.player_id == account.current_player_id && upgrade.attack_type > 0 {
            unique_weapons.insert(upgrade.attack_type);
        }
    }
    let weapon_count = (unique_weapons.len() + 1) as u32; // +1 for base weapon
    log::info!("TrackWeaponAcquisition: Player {} has {} unique weapons", 
               identity, weapon_count);

    // Update the WeaponArsenal achievement
    set_achievement_progress(ctx, identity, AchievementType::WeaponArsenal, weapon_count);
}

// Track when a player defeats the final boss (wins the game)
pub fn track_game_win(ctx: &ReducerContext, identity: Identity) {
    log::info!("Tracking game win for player {}", identity);
    increment_achievement_progress(ctx, identity, AchievementType::Survivor);
}

// Increment achievement progress by one
fn increment_achievement_progress(ctx: &ReducerContext, identity: Identity, achievement_type: AchievementType) {
    // Find the achievement for this player
    let mut achievement = None;
    for ach in ctx.db.achievements().account_identity().filter(&identity) {
        if ach.achievement_type == achievement_type {
            achievement = Some(ach);
            break;
        }
    }

    let Some(mut achievement) = achievement else {
        log::warn!("Achievement {:?} not found for player {}. Progress not updated.", 
                  achievement_type, identity);
        return;
    };

    // Skip if already completed
    if achievement.is_completed {
        return;
    }

    // Update the progress
    achievement.progress += 1;

    // Check if completed
    if achievement.progress >= achievement.target {
        achievement.is_completed = true;
        log::info!("Player {} has completed achievement: {:?}!", identity, achievement_type);
    }

    // Update the achievement in the database
    let progress = achievement.progress;
    let target = achievement.target;
    ctx.db.achievements().achievement_id().update(achievement);
    log::info!("Updated achievement {:?} for player {}: Progress={}/{}",
               achievement_type, identity, progress, target);
}

// Set achievement progress to a specific value
fn set_achievement_progress(ctx: &ReducerContext, identity: Identity, achievement_type: AchievementType, progress: u32) {
    // Find the achievement for this player
    let mut achievement = None;
    for ach in ctx.db.achievements().account_identity().filter(&identity) {
        if ach.achievement_type == achievement_type {
            achievement = Some(ach);
            break;
        }
    }

    let Some(mut achievement) = achievement else {
        log::warn!("Achievement {:?} not found for player {}. Progress not updated.", 
                  achievement_type, identity);
        return;
    };

    // Skip if already completed
    if achievement.is_completed {
        return;
    }

    // Only update if the new progress is greater than the current progress
    // (except for Expert and WeaponArsenal which can fluctuate)
    if progress <= achievement.progress 
        && achievement_type != AchievementType::Expert 
        && achievement_type != AchievementType::WeaponArsenal {
        return;
    }

    // Update the progress
    achievement.progress = progress;

    // Check if completed
    if achievement.progress >= achievement.target {
        achievement.is_completed = true;
        log::info!("Player {} has completed achievement: {:?}!", identity, achievement_type);
    }

    // Update the achievement in the database
    let progress = achievement.progress;
    let target = achievement.target;
    ctx.db.achievements().achievement_id().update(achievement);
    log::info!("Set achievement {:?} for player {}: Progress={}/{}",
               achievement_type, identity, progress, target);
}