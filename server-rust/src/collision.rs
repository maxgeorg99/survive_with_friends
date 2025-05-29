use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};
use crate::{MAX_PLAYERS, MAX_MONSTERS, MAX_GEM_COUNT, MAX_ATTACK_COUNT, NUM_WORLD_CELLS, 
           WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, WORLD_CELL_BIT_SHIFT, WORLD_CELL_MASK, WORLD_CELL_SIZE};
use std::collections::HashMap;

// --- Player Collision ---
pub struct PlayerCollisionCache {
    pub keys_player: [u32; MAX_PLAYERS as usize],
    pub player_id_to_cache_index: HashMap<u32, u32>,
    pub cell_player: [i32; MAX_PLAYERS as usize],
    pub heads_player: [i32; NUM_WORLD_CELLS as usize],
    pub nexts_player: [i32; MAX_PLAYERS as usize],
    pub pos_x_player: [f32; MAX_PLAYERS as usize],
    pub pos_y_player: [f32; MAX_PLAYERS as usize],
    pub radius_player: [f32; MAX_PLAYERS as usize],
    pub damage_to_player: [f32; MAX_PLAYERS as usize],
    pub shield_count_player: [u32; MAX_PLAYERS as usize],
    pub cached_count_players: u32,
}

impl Default for PlayerCollisionCache {
    fn default() -> Self {
        Self {
            keys_player: [0; MAX_PLAYERS as usize],
            player_id_to_cache_index: HashMap::with_capacity(MAX_PLAYERS as usize),
            cell_player: [0; MAX_PLAYERS as usize],
            heads_player: [-1; NUM_WORLD_CELLS as usize],
            nexts_player: [-1; MAX_PLAYERS as usize],
            pos_x_player: [0.0; MAX_PLAYERS as usize],
            pos_y_player: [0.0; MAX_PLAYERS as usize],
            radius_player: [0.0; MAX_PLAYERS as usize],
            damage_to_player: [0.0; MAX_PLAYERS as usize],
            shield_count_player: [0; MAX_PLAYERS as usize],
            cached_count_players: 0,
        }
    }
}

// --- Monster Collision ---
pub struct MonsterCollisionCache {
    pub keys_monster: [u32; MAX_MONSTERS as usize],
    pub key_to_cache_index_monster: HashMap<u32, u32>,
    pub heads_monster: [i32; NUM_WORLD_CELLS as usize],
    pub nexts_monster: [i32; MAX_MONSTERS as usize],
    pub cell_monster: [i32; MAX_MONSTERS as usize],
    pub pos_x_monster: [f32; MAX_MONSTERS as usize],
    pub pos_y_monster: [f32; MAX_MONSTERS as usize],
    pub vel_x_monster: [f32; MAX_MONSTERS as usize],
    pub vel_y_monster: [f32; MAX_MONSTERS as usize],
    pub target_id_monster: [i32; MAX_MONSTERS as usize],
    pub target_x_monster: [f32; MAX_MONSTERS as usize],
    pub target_y_monster: [f32; MAX_MONSTERS as usize],
    pub radius_monster: [f32; MAX_MONSTERS as usize],
    pub speed_monster: [f32; MAX_MONSTERS as usize],
    pub atk_monster: [f32; MAX_MONSTERS as usize],
    pub cached_count_monsters: i32,
}

impl Default for MonsterCollisionCache {
    fn default() -> Self {
        Self {
            keys_monster: [0; MAX_MONSTERS as usize],
            key_to_cache_index_monster: HashMap::with_capacity(MAX_MONSTERS as usize),
            heads_monster: [-1; NUM_WORLD_CELLS as usize],
            nexts_monster: [-1; MAX_MONSTERS as usize],
            cell_monster: [0; MAX_MONSTERS as usize],
            pos_x_monster: [0.0; MAX_MONSTERS as usize],
            pos_y_monster: [0.0; MAX_MONSTERS as usize],
            vel_x_monster: [0.0; MAX_MONSTERS as usize],
            vel_y_monster: [0.0; MAX_MONSTERS as usize],
            target_id_monster: [-1; MAX_MONSTERS as usize],
            target_x_monster: [0.0; MAX_MONSTERS as usize],
            target_y_monster: [0.0; MAX_MONSTERS as usize],
            radius_monster: [0.0; MAX_MONSTERS as usize],
            speed_monster: [0.0; MAX_MONSTERS as usize],
            atk_monster: [0.0; MAX_MONSTERS as usize],
            cached_count_monsters: 0,
        }
    }
}

// --- Gem Collision ---
pub struct GemCollisionCache {
    pub keys_gem: [u32; MAX_GEM_COUNT as usize],
    pub heads_gem: [i32; NUM_WORLD_CELLS as usize],
    pub nexts_gem: [i32; MAX_GEM_COUNT as usize],
    pub pos_x_gem: [f32; MAX_GEM_COUNT as usize],
    pub pos_y_gem: [f32; MAX_GEM_COUNT as usize],
    pub radius_gem: [f32; MAX_GEM_COUNT as usize],
    pub cached_count_gems: i32,
}

impl Default for GemCollisionCache {
    fn default() -> Self {
        Self {
            keys_gem: [0; MAX_GEM_COUNT as usize],
            heads_gem: [-1; NUM_WORLD_CELLS as usize],
            nexts_gem: [-1; MAX_GEM_COUNT as usize],
            pos_x_gem: [0.0; MAX_GEM_COUNT as usize],
            pos_y_gem: [0.0; MAX_GEM_COUNT as usize],
            radius_gem: [0.0; MAX_GEM_COUNT as usize],
            cached_count_gems: 0,
        }
    }
}

// --- Attack Collision ---
pub struct AttackCollisionCache {
    pub keys_attack: [u32; MAX_ATTACK_COUNT as usize],
    pub heads_attack: [i32; NUM_WORLD_CELLS as usize],
    pub nexts_attack: [i32; MAX_ATTACK_COUNT as usize],
    pub pos_x_attack: [f32; MAX_ATTACK_COUNT as usize],
    pub pos_y_attack: [f32; MAX_ATTACK_COUNT as usize],
    pub radius_attack: [f32; MAX_ATTACK_COUNT as usize],
    pub cached_count_attacks: i32,
}

impl Default for AttackCollisionCache {
    fn default() -> Self {
        Self {
            keys_attack: [0; MAX_ATTACK_COUNT as usize],
            heads_attack: [-1; NUM_WORLD_CELLS as usize],
            nexts_attack: [-1; MAX_ATTACK_COUNT as usize],
            pos_x_attack: [0.0; MAX_ATTACK_COUNT as usize],
            pos_y_attack: [0.0; MAX_ATTACK_COUNT as usize],
            radius_attack: [0.0; MAX_ATTACK_COUNT as usize],
            cached_count_attacks: 0,
        }
    }
}

// --- Complete Collision Cache ---
pub struct CollisionCache {
    pub player: PlayerCollisionCache,
    pub monster: MonsterCollisionCache,
    pub gem: GemCollisionCache,
    pub attack: AttackCollisionCache,
}

impl Default for CollisionCache {
    fn default() -> Self {
        log::info!("Creating new collision cache...");
        Self {
            player: PlayerCollisionCache::default(),
            monster: MonsterCollisionCache::default(),
            gem: GemCollisionCache::default(),
            attack: AttackCollisionCache::default(),
        }
    }
}

impl CollisionCache {
    pub fn clear_for_frame(&mut self) {
        log::info!("Clearing collision cache for frame...");
        // Clear player cache
        self.player.cached_count_players = 0;
        self.player.keys_player.fill(0);
        self.player.cell_player.fill(0);
        self.player.heads_player.fill(-1);
        self.player.nexts_player.fill(-1);
        self.player.pos_x_player.fill(0.0);
        self.player.pos_y_player.fill(0.0);
        self.player.radius_player.fill(0.0);
        self.player.damage_to_player.fill(0.0);
        self.player.shield_count_player.fill(0);
        self.player.player_id_to_cache_index.clear();

        log::info!("Player cache cleared for frame...");

        // Clear monster cache
        self.monster.cached_count_monsters = 0;
        self.monster.keys_monster.fill(0);
        self.monster.cell_monster.fill(0);
        self.monster.heads_monster.fill(-1);
        self.monster.nexts_monster.fill(-1);
        self.monster.pos_x_monster.fill(0.0);
        self.monster.pos_y_monster.fill(0.0);
        self.monster.vel_x_monster.fill(0.0);
        self.monster.vel_y_monster.fill(0.0);
        self.monster.target_id_monster.fill(-1);
        self.monster.target_x_monster.fill(0.0);
        self.monster.target_y_monster.fill(0.0);
        self.monster.radius_monster.fill(0.0);
        self.monster.speed_monster.fill(0.0);
        self.monster.atk_monster.fill(0.0);
        self.monster.key_to_cache_index_monster.clear();

        log::info!("Monster cache cleared for frame...");

        // Clear gem cache
        self.gem.cached_count_gems = 0;
        self.gem.keys_gem.fill(0);
        self.gem.heads_gem.fill(-1);
        self.gem.nexts_gem.fill(-1);
        self.gem.pos_x_gem.fill(0.0);
        self.gem.pos_y_gem.fill(0.0);
        self.gem.radius_gem.fill(0.0);

        log::info!("Gem cache cleared for frame...");

        // Clear attack cache
        self.attack.cached_count_attacks = 0;
        self.attack.keys_attack.fill(0);
        self.attack.heads_attack.fill(-1);
        self.attack.nexts_attack.fill(-1);
        self.attack.pos_x_attack.fill(0.0);
        self.attack.pos_y_attack.fill(0.0);
        self.attack.radius_attack.fill(0.0);

        log::info!("Attack cache cleared for frame...");
    }
}

#[inline]
pub fn get_world_cell_from_position(x: f32, y: f32) -> u16 {
    // 1. Convert world-space to *integer* cell coordinates
    //    (fast floor because they're non-negative here)
    let cell_x = (x / WORLD_CELL_SIZE as f32) as u16;  // 0 … 156
    let cell_y = (y / WORLD_CELL_SIZE as f32) as u16; // 0 … 156

    // 2. Pack into one 16-bit value: cell_y in the high byte, cell_x in the low
    ((cell_y as u16) << WORLD_CELL_BIT_SHIFT) | ((cell_x as u16) & WORLD_CELL_MASK)
}

#[inline]
pub fn spatial_hash_collision_checker(ax: f32, ay: f32, ar: f32, bx: f32, by: f32, br: f32) -> bool {
    // Get the distance between the two entities
    let dx = ax - bx;
    let dy = ay - by;
    let distance_squared = dx * dx + dy * dy;
    
    // Calculate the minimum distance to avoid collision (sum of both radii)
    let min_distance = ar + br;
    let min_distance_squared = min_distance * min_distance;
    
    // If distance squared is less than minimum distance squared, they are colliding
    distance_squared < min_distance_squared
} 