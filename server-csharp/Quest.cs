using SpacetimeDB;
using System;

public static partial class Module {
    [SpacetimeDB.Type]
    public enum QuestType
    {
        Til,        // Track 5 Running Sessions
        Marc,       // Win a Card Game Session with the boys
        Max,        // Track 5 Gym Sessions  
        Chris,      // Track Food for 5 days
        Reroll      // Daily reroll challenge - track progress for rerolls
    }
    [Table(Name = "game_quests", Public = true)]
    public partial struct QuestDefinition
    {
        [PrimaryKey, AutoInc]
        public uint QuestId;

        [SpacetimeDB.Index.BTree]
        public Identity accountIdentity; // Player's identity
        public QuestType QuestTypeType;
        public bool IsCompleted;    // Simple boolean flag for completion
        public uint Progress;       // For reroll quest - tracks monsters killed today
        public uint MaxProgress;    // For reroll quest - max is 10 monsters per day

        public QuestDefinition() { 
            // Initialize with default values
            Progress = 0;
            MaxProgress = 0;
            IsCompleted = false;
        }
    }

// Helper method to initialize player quests when they first spawn
public static void InitializePlayerQuests(ReducerContext ctx, SpacetimeDB.Identity identity)
{
    Log.Info($"Initializing quests for player {identity}");

    // Create all quest types for this player
    foreach (QuestType type in Enum.GetValues(typeof(QuestType)))
    {
        uint nextId = GetNextQuestId(ctx);
        uint maxProgress = (type == QuestType.Reroll) ? 10u : 1u; // Reroll quest has progress, others are just boolean

        ctx.Db.game_quests.Insert(new QuestDefinition
        {
            QuestId = nextId,
            accountIdentity = identity,
            QuestTypeType = type,
            IsCompleted = false,
            Progress = 0,
            MaxProgress = maxProgress
        });
    }
    Log.Info($"Created {Enum.GetValues(typeof(QuestType)).Length} quests for player {identity}");
}

// Helper to get the next available quest ID
private static uint GetNextQuestId(ReducerContext ctx)
{
    uint maxId = 0;
    foreach (var quest in ctx.Db.game_quests.Iter())
    {
        if (quest.QuestId > maxId)
        {
            maxId = quest.QuestId;
        }
    }
    return maxId + 1;
}

// Complete a specific quest for a player
public static void CompleteQuest(ReducerContext ctx, SpacetimeDB.Identity identity, QuestType questType)
{
    Log.Info($"Completing quest {questType} for player {identity}");

    // Find the quest for this player
    QuestDefinition? quest = null;
    foreach (var q in ctx.Db.game_quests.accountIdentity.Filter(identity))
    {
        if (q.QuestTypeType == questType)
        {
            quest = q;
            break;
        }
    }

    if (quest == null)
    {
        Log.Warn($"Quest {questType} not found for player {identity}. Quest not completed.");
        return;
    }

    // Skip if already completed
    if (quest.Value.IsCompleted)
    {
        Log.Info($"Quest {questType} already completed for player {identity}");
        return;
    }

    // Update the quest to completed
    var updatedQuest = quest.Value;
    updatedQuest.IsCompleted = true;
    ctx.Db.game_quests.QuestId.Update(updatedQuest);
    
    Log.Info($"Player {identity} has completed quest: {questType}!");
}

// Track progress on the reroll quest (kill monsters for rerolls)
public static void TrackRerollQuestProgress(ReducerContext ctx, SpacetimeDB.Identity identity)
{
    Log.Info($"TrackRerollQuestProgress: Tracking monster kill for player {identity}");

    // Find the reroll quest for this player
    QuestDefinition? rerollQuest = null;
    foreach (var questVar in ctx.Db.game_quests.accountIdentity.Filter(identity))
    {
        if (questVar.QuestTypeType == QuestType.Reroll)
        {
            rerollQuest = questVar;
            break;
        }
    }

    if (rerollQuest == null)
    {
        Log.Warn($"Reroll quest not found for player {identity}. This should not happen if quests are initialized correctly.");
        return;
    }

    // Skip if already completed (but allow it to continue tracking for potential future rewards)
    var quest = rerollQuest.Value;
    
    // Increment progress
    quest.Progress += 1;
    Log.Info($"Player {identity} reroll quest progress: {quest.Progress}/{quest.MaxProgress}");

    // Check if quest is completed (every 10 monsters killed)
    if (quest.Progress >= quest.MaxProgress && !quest.IsCompleted)
    {
        quest.IsCompleted = true;
        
        // Award rerolls to the player
        AwardRerollsToPlayer(ctx, identity, 1);
        
        Log.Info($"Player {identity} completed the reroll quest! Awarded 10 rerolls.");
        
        // Reset the quest for next cycle (allow repeatable completion)
        quest.Progress = 0;
        quest.IsCompleted = false; // Reset completion status so they can earn more rerolls
        
        Log.Info($"Reset reroll quest for player {identity} - they can earn more rerolls by killing another {quest.MaxProgress} monsters");
    }

    // Update the quest in the database
    ctx.Db.game_quests.QuestId.Update(quest);
}

// Helper method to award rerolls to a player
private static void AwardRerollsToPlayer(ReducerContext ctx, SpacetimeDB.Identity identity, uint rerollsToAward)
{
    // Find the player's account
    var accountOpt = ctx.Db.account.identity.Find(identity);
    if (accountOpt == null)
    {
        Log.Error($"AwardRerollsToPlayer: Account not found for identity {identity}");
        return;
    }

    var account = accountOpt.Value;
    
    // Find the player
    var playerOpt = ctx.Db.player.player_id.Find(account.current_player_id);
    if (playerOpt == null)
    {
        Log.Error($"AwardRerollsToPlayer: Player not found for account {identity}");
        return;
    }

    var player = playerOpt.Value;
    
    // Award the rerolls
    player.rerolls += rerollsToAward;
    
    // Update the player in the database
    ctx.Db.player.player_id.Update(player);
    
    Log.Info($"Awarded {rerollsToAward} rerolls to player {player.name} (total rerolls: {player.rerolls})");
}

// Reset daily quests (call this once per day, probably from a scheduler)
public static void ResetDailyQuests(ReducerContext ctx)
{
    Log.Info("Resetting daily quests for all players");

    foreach (var quest in ctx.Db.game_quests.Iter())
    {
        if (quest.QuestTypeType == QuestType.Reroll)
        {
            // Reset reroll quest progress and completion
            var updatedQuest = quest;
            updatedQuest.Progress = 0;
            updatedQuest.IsCompleted = false;
            ctx.Db.game_quests.QuestId.Update(updatedQuest);
        }
    }
    
    Log.Info("Daily quests reset completed");
}

// ADMIN REDUCER: Complete a specific quest for a player by name
[Reducer]
public static void AdminCompleteQuest(ReducerContext ctx, string accountName, uint questTypeId)
{
    var identity = ctx.Sender;
    Log.Info($"AdminCompleteQuest called by {identity} for account '{accountName}' with quest type {questTypeId}");

    // Basic validation for quest type
    if (questTypeId > 4) // We have 5 quest types (0-4)
    {
        throw new Exception($"AdminCompleteQuest: Invalid quest type ID {questTypeId}. Must be 0-4.");
    }

    var questType = (QuestType)questTypeId;

    // Find the account by name
    Account? targetAccount = null;
    foreach (var account in ctx.Db.account.Iter())
    {
        if (account.name.Equals(accountName, StringComparison.OrdinalIgnoreCase))
        {
            targetAccount = account;
            break;
        }
    }

    if (targetAccount == null)
    {
        throw new Exception($"AdminCompleteQuest: Account '{accountName}' not found.");
    }

    // Complete the quest for the target account
    CompleteQuest(ctx, targetAccount.Value.identity, questType);
    
    Log.Info($"Admin {identity} completed quest {questType} for account '{accountName}'");
}

// ADMIN REDUCER: Complete all major quests (Til, Marc, Max, Chris) for a player
[Reducer]
public static void AdminCompleteAllMajorQuests(ReducerContext ctx, string accountName)
{
    var identity = ctx.Sender;
    Log.Info($"AdminCompleteAllMajorQuests called by {identity} for account '{accountName}'");

    // Find the account by name
    Account? targetAccount = null;
    foreach (var account in ctx.Db.account.Iter())
    {
        if (account.name.Equals(accountName, StringComparison.OrdinalIgnoreCase))
        {
            targetAccount = account;
            break;
        }
    }

    if (targetAccount == null)
    {
        throw new Exception($"AdminCompleteAllMajorQuests: Account '{accountName}' not found.");
    }

    var targetIdentity = targetAccount.Value.identity;

    // Complete all major quests (excluding Reroll quest)
    CompleteQuest(ctx, targetIdentity, QuestType.Til);
    CompleteQuest(ctx, targetIdentity, QuestType.Marc);
    CompleteQuest(ctx, targetIdentity, QuestType.Max);
    CompleteQuest(ctx, targetIdentity, QuestType.Chris);
    
    Log.Info($"Admin {identity} completed all major quests for account '{accountName}'");
}

}