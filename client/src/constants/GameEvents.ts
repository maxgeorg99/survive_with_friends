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

    // Monster Boid events
    MONSTER_BOID_UPDATED = 'monster_boid:updated',
    
    // Attack events
    ATTACK_CREATED = 'attack:created',
    ATTACK_UPDATED = 'attack:updated',
    ATTACK_DELETED = 'attack:deleted',
    
    // Gem events
    GEM_CREATED = 'gem:created',
    GEM_UPDATED = 'gem:updated',
    GEM_DELETED = 'gem:deleted',
    
    // LootCapsule events
    LOOT_CAPSULE_CREATED = 'loot_capsule:created',
    LOOT_CAPSULE_UPDATED = 'loot_capsule:updated',
    LOOT_CAPSULE_DELETED = 'loot_capsule:deleted',
    
    // Loading events
    LOADING_COMPLETE = 'loading_complete',
    LOADING_ERROR = 'loading_error',
    
    // Game state events
    GAME_STARTED = 'game_started',
    GAME_ENDED = 'game_ended',
    SUBSCRIPTION_APPLIED = 'subscription:applied',
    
    // World events
    WORLD_UPDATED = 'world:updated',
    
    // Boss-related events
    GAME_STATE_UPDATED = 'game_state:updated',
    BOSS_SPAWN_TIMER_CREATED = 'boss_spawn_timer:created',
    BOSS_SPAWN_TIMER_DELETED = 'boss_spawn_timer:deleted',
    BOSS_PHASE_CHANGED = 'boss_phase_changed'
} 