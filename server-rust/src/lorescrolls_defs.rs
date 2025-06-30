use spacetimedb::{table, Table, ReducerContext};

// Table to track lore scroll pickups by players
#[table(name = found_lore_scrolls, public)]
pub struct FoundLoreScrolls {
    #[primary_key]
    #[auto_inc]
    pub pickup_id: u64,
    
    pub player_id: u32,    // The player who picked up the scroll
    pub scroll_id: u32,    // The scroll type (0-12) that was picked up
}

// Function to log a lore scroll pickup
pub fn log_lore_scroll_pickup(ctx: &ReducerContext, player_id: u32, scroll_id: u32) {
    let pickup = ctx.db.found_lore_scrolls().insert(FoundLoreScrolls {
        pickup_id: 0,
        player_id,
        scroll_id,
    });
    
    log::info!("Logged lore scroll pickup: Player {} found scroll type {} (pickup ID: {})", 
              player_id, scroll_id, pickup.pickup_id);
}

// Function to clear all lore scroll pickups (called during world reset)
pub fn clear_lore_scroll_pickups(ctx: &ReducerContext) {
    log::info!("Clearing all lore scroll pickup records...");
    
    // Delete all pickup records
    let pickups: Vec<_> = ctx.db.found_lore_scrolls().iter().collect();
    for pickup in pickups {
        ctx.db.found_lore_scrolls().pickup_id().delete(&pickup.pickup_id);
    }
    
    log::info!("Lore scroll pickup records cleared");
}

// Function to get pickup count for a specific player
pub fn get_player_lore_scroll_count(ctx: &ReducerContext, player_id: u32) -> u32 {
    ctx.db.found_lore_scrolls()
        .iter()
        .filter(|pickup| pickup.player_id == player_id)
        .count() as u32
}

// Function to get pickup count for a specific scroll type
pub fn get_scroll_type_pickup_count(ctx: &ReducerContext, scroll_id: u32) -> u32 {
    ctx.db.found_lore_scrolls()
        .iter()
        .filter(|pickup| pickup.scroll_id == scroll_id)
        .count() as u32
} 