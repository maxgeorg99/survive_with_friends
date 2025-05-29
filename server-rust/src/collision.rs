use spacetimedb::{table, reducer, Table, ReducerContext, Identity, Timestamp};
use crate::{MAX_PLAYERS, MAX_MONSTERS, MAX_GEM_COUNT, MAX_ATTACK_COUNT, NUM_WORLD_CELLS, 
           WORLD_GRID_WIDTH, WORLD_GRID_HEIGHT, WORLD_CELL_BIT_SHIFT, WORLD_CELL_MASK, WORLD_CELL_SIZE};
use std::collections::HashMap;

// --- Player Collision ---
pub struct PlayerCollisionCache {
    pub keys_player: Box<[u32]>,
    pub player_id_to_cache_index: HashMap<u32, u32>,
    pub cell_player: Box<[i32]>,
    pub heads_player: Box<[i32]>,
    pub nexts_player: Box<[i32]>,
    pub pos_x_player: Box<[f32]>,
    pub pos_y_player: Box<[f32]>,
    pub radius_player: Box<[f32]>,
    pub damage_to_player: Box<[f32]>,
    pub shield_count_player: Box<[u32]>,
    pub cached_count_players: u32,
}

impl Default for PlayerCollisionCache {
    fn default() -> Self {
        Self {
            keys_player: vec![0; MAX_PLAYERS as usize].into_boxed_slice(),
            player_id_to_cache_index: HashMap::with_capacity(MAX_PLAYERS as usize),
            cell_player: vec![0; MAX_PLAYERS as usize].into_boxed_slice(),
            heads_player: vec![-1; NUM_WORLD_CELLS as usize].into_boxed_slice(),
            nexts_player: vec![-1; MAX_PLAYERS as usize].into_boxed_slice(),
            pos_x_player: vec![0.0; MAX_PLAYERS as usize].into_boxed_slice(),
            pos_y_player: vec![0.0; MAX_PLAYERS as usize].into_boxed_slice(),
            radius_player: vec![0.0; MAX_PLAYERS as usize].into_boxed_slice(),
            damage_to_player: vec![0.0; MAX_PLAYERS as usize].into_boxed_slice(),
            shield_count_player: vec![0; MAX_PLAYERS as usize].into_boxed_slice(),
            cached_count_players: 0,
        }
    }
}

// --- Monster Collision ---
pub struct MonsterCollisionCache {
    pub keys_monster: Box<[u32]>,
    pub key_to_cache_index_monster: HashMap<u32, u32>,
    pub heads_monster: Box<[i32]>,
    pub nexts_monster: Box<[i32]>,
    pub cell_monster: Box<[i32]>,
    pub pos_x_monster: Box<[f32]>,
    pub pos_y_monster: Box<[f32]>,
    pub vel_x_monster: Box<[f32]>,
    pub vel_y_monster: Box<[f32]>,
    pub target_id_monster: Box<[i32]>,
    pub target_x_monster: Box<[f32]>,
    pub target_y_monster: Box<[f32]>,
    pub radius_monster: Box<[f32]>,
    pub speed_monster: Box<[f32]>,
    pub atk_monster: Box<[f32]>,
    pub cached_count_monsters: i32,
}

impl Default for MonsterCollisionCache {
    fn default() -> Self {
        Self {
            keys_monster: vec![0; MAX_MONSTERS as usize].into_boxed_slice(),
            key_to_cache_index_monster: HashMap::with_capacity(MAX_MONSTERS as usize),
            heads_monster: vec![-1; NUM_WORLD_CELLS as usize].into_boxed_slice(),
            nexts_monster: vec![-1; MAX_MONSTERS as usize].into_boxed_slice(),
            cell_monster: vec![0; MAX_MONSTERS as usize].into_boxed_slice(),
            pos_x_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            pos_y_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            vel_x_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            vel_y_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            target_id_monster: vec![-1; MAX_MONSTERS as usize].into_boxed_slice(),
            target_x_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            target_y_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            radius_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            speed_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            atk_monster: vec![0.0; MAX_MONSTERS as usize].into_boxed_slice(),
            cached_count_monsters: 0,
        }
    }
}

// --- Gem Collision ---
pub struct GemCollisionCache {
    pub keys_gem: Box<[u32]>,
    pub heads_gem: Box<[i32]>,
    pub nexts_gem: Box<[i32]>,
    pub pos_x_gem: Box<[f32]>,
    pub pos_y_gem: Box<[f32]>,
    pub radius_gem: Box<[f32]>,
    pub cached_count_gems: i32,
}

impl Default for GemCollisionCache {
    fn default() -> Self {
        Self {
            keys_gem: vec![0; MAX_GEM_COUNT as usize].into_boxed_slice(),
            heads_gem: vec![-1; NUM_WORLD_CELLS as usize].into_boxed_slice(),
            nexts_gem: vec![-1; MAX_GEM_COUNT as usize].into_boxed_slice(),
            pos_x_gem: vec![0.0; MAX_GEM_COUNT as usize].into_boxed_slice(),
            pos_y_gem: vec![0.0; MAX_GEM_COUNT as usize].into_boxed_slice(),
            radius_gem: vec![0.0; MAX_GEM_COUNT as usize].into_boxed_slice(),
            cached_count_gems: 0,
        }
    }
}

// --- Attack Collision ---
pub struct AttackCollisionCache {
    pub keys_attack: Box<[u32]>,
    pub heads_attack: Box<[i32]>,
    pub nexts_attack: Box<[i32]>,
    pub pos_x_attack: Box<[f32]>,
    pub pos_y_attack: Box<[f32]>,
    pub radius_attack: Box<[f32]>,
    pub cached_count_attacks: i32,
}

impl Default for AttackCollisionCache {
    fn default() -> Self {
        Self {
            keys_attack: vec![0; MAX_ATTACK_COUNT as usize].into_boxed_slice(),
            heads_attack: vec![-1; NUM_WORLD_CELLS as usize].into_boxed_slice(),
            nexts_attack: vec![-1; MAX_ATTACK_COUNT as usize].into_boxed_slice(),
            pos_x_attack: vec![0.0; MAX_ATTACK_COUNT as usize].into_boxed_slice(),
            pos_y_attack: vec![0.0; MAX_ATTACK_COUNT as usize].into_boxed_slice(),
            radius_attack: vec![0.0; MAX_ATTACK_COUNT as usize].into_boxed_slice(),
            cached_count_attacks: 0,
        }
    }
}

// --- Complete Collision Cache ---
#[derive(Default)]
pub struct CollisionCache {
    pub player: PlayerCollisionCache,
    pub monster: MonsterCollisionCache,
    pub gem: GemCollisionCache,
    pub attack: AttackCollisionCache,
}

impl CollisionCache {
    pub fn clear_for_frame(&mut self) {
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

        // Clear gem cache
        self.gem.cached_count_gems = 0;
        self.gem.keys_gem.fill(0);
        self.gem.heads_gem.fill(-1);
        self.gem.nexts_gem.fill(-1);
        self.gem.pos_x_gem.fill(0.0);
        self.gem.pos_y_gem.fill(0.0);
        self.gem.radius_gem.fill(0.0);

        // Clear attack cache
        self.attack.cached_count_attacks = 0;
        self.attack.keys_attack.fill(0);
        self.attack.heads_attack.fill(-1);
        self.attack.nexts_attack.fill(-1);
        self.attack.pos_x_attack.fill(0.0);
        self.attack.pos_y_attack.fill(0.0);
        self.attack.radius_attack.fill(0.0);
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