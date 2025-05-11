/**
 * Game event constants for the event-driven architecture
 */
export enum GameEvents {
    // Connection events
    CONNECTION_ESTABLISHED = 'connection_established',
    CONNECTION_LOST = 'connection_lost',
    
    // Account events
    ACCOUNT_CREATED = 'account_created',
    ACCOUNT_UPDATED = 'account:updated',
    NAME_SET = 'name_set',
    
    // Player events
    PLAYER_CREATED = 'player_created',
    PLAYER_UPDATED = 'player:updated',
    PLAYER_DELETED = 'player:deleted',
    PLAYER_DIED = 'player_died',
    
    // Entity events
    ENTITY_CREATED = 'entity:created',
    ENTITY_UPDATED = 'entity:updated',
    ENTITY_DELETED = 'entity:deleted',

    // Monster events
    MONSTER_CREATED = 'monster:created',
    MONSTER_UPDATED = 'monster:updated',
    MONSTER_DELETED = 'monster:deleted',
    
    // Attack events
    ATTACK_CREATED = 'ATTACK_CREATED',
    ATTACK_UPDATED = 'ATTACK_UPDATED',
    ATTACK_DELETED = 'ATTACK_DELETED',
    
    // Boss attack events
    BOSS_ATTACK_CREATED = 'BOSS_ATTACK_CREATED',
    BOSS_ATTACK_UPDATED = 'BOSS_ATTACK_UPDATED',
    BOSS_ATTACK_DELETED = 'BOSS_ATTACK_DELETED',
    
    // Gem events
    GEM_CREATED = 'gem:created',
    GEM_UPDATED = 'gem:updated',
    GEM_DELETED = 'gem:deleted',
    
    // Loading events
    LOADING_COMPLETE = 'loading_complete',
    LOADING_ERROR = 'loading_error',
    
    // Game state events
    GAME_STARTED = 'game_started',
    GAME_ENDED = 'game_ended',
    SUBSCRIPTION_APPLIED = 'subscription:applied',
    
    // Boss-related events
    GAME_STATE_UPDATED = 'game_state:updated',
    BOSS_SPAWN_TIMER_CREATED = 'boss_spawn_timer:created',
    BOSS_SPAWN_TIMER_DELETED = 'boss_spawn_timer:deleted',
    BOSS_PHASE_CHANGED = 'boss_phase_changed',
    
    // New attack-related events
    ACTIVE_ATTACK_CLEANUP_CREATED = 'ACTIVE_ATTACK_CLEANUP_CREATED',
    ACTIVE_ATTACK_CLEANUP_DELETED = 'ACTIVE_ATTACK_CLEANUP_DELETED',
    ACTIVE_BOSS_ATTACK_CLEANUP_CREATED = 'ACTIVE_BOSS_ATTACK_CLEANUP_CREATED',
    ACTIVE_BOSS_ATTACK_CLEANUP_DELETED = 'ACTIVE_BOSS_ATTACK_CLEANUP_DELETED',
    ATTACK_DATA_CREATED = 'ATTACK_DATA_CREATED',
    ATTACK_DATA_UPDATED = 'ATTACK_DATA_UPDATED'
} 