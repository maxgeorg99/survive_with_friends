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
    
    // Loading events
    LOADING_COMPLETE = 'loading_complete',
    LOADING_ERROR = 'loading_error',
    
    // Game state events
    GAME_STARTED = 'game_started',
    GAME_ENDED = 'game_ended',
    SUBSCRIPTION_APPLIED = 'subscription:applied'
} 