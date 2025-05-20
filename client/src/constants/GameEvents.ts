/**
 * Game event constants for the event-driven architecture
 */
export enum GameEvents {
    // Connection events
    CONNECTION_ESTABLISHED = 'connection_established',
    CONNECTION_LOST = 'connection_lost',
    SUBSCRIPTION_APPLIED = 'subscription_applied',
    
    // Account events
    ACCOUNT_CREATED = 'account_created',
    ACCOUNT_UPDATED = 'account_updated',
    NAME_SET = 'name_set',
    
    // Player events
    PLAYER_CREATED = 'player_created',
    PLAYER_UPDATED = 'player_updated',
    PLAYER_DELETED = 'player_deleted',
    PLAYER_DIED = 'player_died',
    
    // Entity events
    ENTITY_CREATED = 'entity_created',
    ENTITY_UPDATED = 'entity_updated',
    ENTITY_DELETED = 'entity_deleted',
    
    // Monster events
    MONSTER_CREATED = 'monster_created',
    MONSTER_UPDATED = 'monster_updated',
    MONSTER_DELETED = 'monster_deleted',
    
    // Attack events
    ATTACK_CREATED = 'attack_created',
    ATTACK_UPDATED = 'attack_updated',
    ATTACK_DELETED = 'attack_deleted',
    
    // Loading events
    LOADING_COMPLETE = 'loading_complete',
    LOADING_ERROR = 'loading_error',
    
    // Scene transition events
    SCENE_READY = 'scene_ready',
    SCENE_TRANSITION_START = 'scene_transition_start',
    SCENE_TRANSITION_COMPLETE = 'scene_transition_complete',
    
    // UI events
    LAYOUT_READY = 'layout_ready',
    MOBILE_DETECTED = 'mobile_detected',
    
    // Boss attack events
    BOSS_ATTACK_CREATED = 'BOSS_ATTACK_CREATED',
    BOSS_ATTACK_UPDATED = 'BOSS_ATTACK_UPDATED',
    BOSS_ATTACK_DELETED = 'BOSS_ATTACK_DELETED',
    
    // Gem events
    GEM_CREATED = 'gem:created',
    GEM_UPDATED = 'gem:updated',
    GEM_DELETED = 'gem:deleted',
    
    // Game state events
    GAME_STARTED = 'game_started',
    GAME_ENDED = 'game_ended',
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
    ATTACK_DATA_UPDATED = 'ATTACK_DATA_UPDATED',
    
    // Poison effect events
    POISON_EFFECT_CREATED = 'poison_effect:created',
    POISON_EFFECT_DELETED = 'poison_effect:deleted'
}