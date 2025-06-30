use spacetimedb::{table, reducer, Table, ReducerContext, Identity, SpacetimeType};
use crate::account;

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq, Hash)]
pub enum QuestType {
    Til,        // Track 5 Running Sessions
    Marc,       // Win a Card Game Session with the boys
    Max,        // Track 5 Gym Sessions  
    Chris,      // Track Food for 5 days
    Qwen,      // Enjoy the beach ;)
}

#[table(name = game_quests, public)]
pub struct QuestDefinition {
    #[primary_key]
    #[auto_inc]
    pub quest_id: u32,
    #[index(btree)]
    pub account_identity: Identity, // Player's identity
    pub quest_type: QuestType,
    pub is_completed: bool,    // Simple boolean flag for completion
    pub progress: u32,       // For reroll quest - tracks monsters killed today
    pub max_progress: u32,    // For reroll quest - max is 10 monsters per day
}

// Helper function to initialize player quests when they first spawn
pub fn initialize_player_quests(ctx: &ReducerContext, identity: Identity) {
    log::info!("Initializing quests for player {}", identity);

    // Create all quest types for this player
    for quest_type in [QuestType::Til, QuestType::Marc, QuestType::Max, QuestType::Chris, QuestType::Qwen].iter() {
        let max_progress = 1; // All quests just need completion now

        // Get next available ID
        let mut max_id = 0;
        for quest in ctx.db.game_quests().iter() {
            if quest.quest_id > max_id {
                max_id = quest.quest_id;
            }
        }
        let next_id = max_id + 1;

        ctx.db.game_quests().insert(QuestDefinition {
            quest_id: next_id,
            account_identity: identity,
            quest_type: quest_type.clone(),
            is_completed: false,
            progress: 0,
            max_progress,
        });
    }

    log::info!("Created {} quests for player {}", 5, identity); // 5 is the number of quest types
}

// Complete a specific quest for a player
pub fn complete_quest(ctx: &ReducerContext, identity: Identity, quest_type: QuestType) {
    log::info!("Completing quest {:?} for player {}", quest_type, identity);

    // Find the quest for this player
    let mut quest = None;
    for q in ctx.db.game_quests().account_identity().filter(&identity) {
        if q.quest_type == quest_type {
            quest = Some(q);
            break;
        }
    }

    let Some(mut quest) = quest else {
        log::warn!("Quest {:?} not found for player {}. Quest not completed.", quest_type, identity);
        return;
    };

    // Skip if already completed
    if quest.is_completed {
        log::info!("Quest {:?} already completed for player {}", quest_type, identity);
        return;
    }

    // Update the quest to completed
    quest.is_completed = true;
    ctx.db.game_quests().quest_id().update(quest);
    
    log::info!("Player {} has completed quest: {:?}!", identity, quest_type);
}

// Admin reducer to complete a specific quest for a player by name
#[reducer]
pub fn admin_complete_quest(ctx: &ReducerContext, account_name: String, quest_type_id: u32) {
    let identity = ctx.sender;
    log::info!("AdminCompleteQuest called by {} for account '{}' with quest type {}", identity, account_name, quest_type_id);

    // Basic validation for quest type
    if quest_type_id > 4 {
        log::error!("AdminCompleteQuest: Invalid quest type ID {}. Must be 0-4.", quest_type_id);
        return;
    }

    let quest_type = match quest_type_id {
        0 => QuestType::Til,
        1 => QuestType::Marc,
        2 => QuestType::Max,
        3 => QuestType::Chris,
        4 => QuestType::Qwen,
        _ => unreachable!(),
    };

    // Find the account by name
    let mut target_account = None;
    for account in ctx.db.account().iter() {
        if account.name.eq_ignore_ascii_case(&account_name) {
            target_account = Some(account);
            break;
        }
    }

    let Some(target_account) = target_account else {
        log::error!("AdminCompleteQuest: Account '{}' not found.", account_name);
        return;
    };

    // Complete the quest for the target account
    complete_quest(ctx, target_account.identity, quest_type.clone());
    
    log::info!("Admin {} completed quest {:?} for account '{}'", identity, quest_type, account_name);
}

// Admin reducer to complete all major quests for a player
#[reducer]
pub fn admin_complete_all_major_quests(ctx: &ReducerContext, account_name: String) {
    let identity = ctx.sender;
    log::info!("AdminCompleteAllMajorQuests called by {} for account '{}'", identity, account_name);

    // Find the account by name
    let mut target_account = None;
    for account in ctx.db.account().iter() {
        if account.name.eq_ignore_ascii_case(&account_name) {
            target_account = Some(account);
            break;
        }
    }

    let Some(target_account) = target_account else {
        log::error!("AdminCompleteAllMajorQuests: Account '{}' not found.", account_name);
        return;
    };

    let target_identity = target_account.identity;

    // Complete all major quests (now including Qwen quest)
    complete_quest(ctx, target_identity, QuestType::Til);
    complete_quest(ctx, target_identity, QuestType::Marc);
    complete_quest(ctx, target_identity, QuestType::Max);
    complete_quest(ctx, target_identity, QuestType::Chris);
    complete_quest(ctx, target_identity, QuestType::Qwen);
    
    log::info!("Admin {} completed all major quests for account '{}'", identity, account_name);
}