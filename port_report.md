# SpacetimeDB Server Port Evaluation Report
## C# to Rust Port Analysis

This report evaluates the completeness and accuracy of the Rust server port from the C# implementation.

### File Mapping Overview

| C# File | Rust File | Status |
|---------|-----------|---------|
| CoreGame.cs (484 lines) | core_game.rs (445 lines) | To be evaluated |
| Upgrades.cs (684 lines) | upgrades_def.rs (666 lines) | To be evaluated |
| Attacks.cs (655 lines) | attacks_def.rs (632 lines) | To be evaluated |
| AttackUtils.cs (152 lines) | attack_utils.rs (112 lines) | To be evaluated |
| Lib.cs (475 lines) | lib.rs (453 lines) | To be evaluated |
| BossSystem.cs (359 lines) | boss_system.rs (280 lines) | To be evaluated |
| Bots.cs (135 lines) | bots_def.rs (125 lines) | To be evaluated |
| Gems.cs (399 lines) | gems_def.rs (346 lines) | To be evaluated |
| ResetWorld.cs (156 lines) | reset_world.rs (146 lines) | To be evaluated |
| Monsters.cs (721 lines) | monsters_def.rs (682 lines) | To be evaluated |
| Player.cs (324 lines) | player_def.rs (360 lines) | To be evaluated |
| Collision.cs (133 lines) | collision.rs (228 lines) | To be evaluated |
| Bestiary.cs (106 lines) | bestiary_def.rs (85 lines) | To be evaluated |
| ClassData.cs (103 lines) | class_data_def.rs (93 lines) | To be evaluated |
| Config.cs (51 lines) | config_def.rs (40 lines) | To be evaluated |
| MonsterTypes.cs (9 lines) | monster_types_def.rs (11 lines) | To be evaluated |

## Detailed Analysis 

### 1. Config.cs → config_def.rs
**Status**: ✅ Fully Ported

The Config structure has been completely ported with all fields and functionality:
- All configuration fields are present (id, world_size, game_tick_rate, max_monsters, player_spawn_grace_period, monster_hit_cleanup_delay, monster_wave_size)
- InitGameConfig function properly ported as init_game_config
- Default values match the C# implementation
- Proper use of SpacetimeDB attributes

### 2. MonsterTypes.cs → monster_types_def.rs
**Status**: ✅ Fully Ported

The MonsterType enum has been completely ported:
- All monster types present (Rat, Slime, Orc, FinalBossPhase1, FinalBossPhase2)
- Proper enum values (0-4) maintained
- Appropriate Rust derives added (SpacetimeType, Clone, Debug, PartialEq)

### 3. ClassData.cs → class_data_def.rs
**Status**: ⚠️ Partially Ported

The ClassData structure is mostly ported but has one missing functionality:
- ✅ All fields properly ported (class_id, player_class, max_hp, armor, speed, starting_attack_type)
- ✅ initialize_class_data function properly implemented
- ✅ All four classes (Fighter, Rogue, Mage, Paladin) with correct stats
- ❌ The C# helper method `ScheduleAttack(ReducerContext ctx, uint playerId, AttackType attackType)` is missing in `class_data_def.rs`. This method was used to call `ScheduleNewPlayerAttack` (from `Attacks.cs`). It needs to be determined if this functionality was moved elsewhere in the Rust port or if it needs to be added to `class_data_def.rs` or an equivalent location.

### Continuing evaluation...

### 4. Bestiary.cs → bestiary_def.rs
**Status**: ✅ Fully Ported (with improvement)

The Bestiary structure has been completely ported:
- ✅ All fields properly ported (bestiary_id, monster_type, max_hp, speed, exp, atk, radius)
- ✅ init_bestiary function properly implemented
- ✅ All five monster types with correct stats (Rat, Slime, Orc, FinalBossPhase1, FinalBossPhase2)
- **Improvement**: Rust version correctly imports MonsterType from monster_types_def.rs instead of duplicating the enum

### 5. Player.cs → player_def.rs
**Status**: ✅ Fully Ported (pending review of related cleanup functions)

The Player structure and its associated direct functionalities appear to be fully ported:
- ✅ All player struct fields properly ported.
- ✅ DeadPlayer struct properly ported.
- ✅ set_player_waypoint reducer implemented.
- ✅ HealthRegenScheduler and health regeneration system implemented.
- ✅ process_player_movement function implemented (Rust version improved by passing CollisionCache).
- ✅ process_player_monster_collisions_spatial_hash function implemented (Rust version improved by passing CollisionCache).
- ✅ commit_player_damage and its call to `damage_player` (now in `core_game.rs`) seem correctly implemented.
- ⚠️ The previous report mentioned "missing cleanup integrations." This will be re-evaluated when reviewing `CoreGame.cs`, `ResetWorld.cs`, and other related modules that might handle player-related cleanup tasks. For now, the direct content of `Player.cs` seems ported.

### 6. Bots.cs → bots_def.rs
**Status**: ⚠️ Partially Ported

Bot functionality is mostly ported but has potential collision system issues and a hardcoded class selection:
- ✅ MAX_SPAWN_ATTEMPTS and MIN_SPAWN_DISTANCE constants properly defined.
- ✅ `is_position_safe` function implemented (Rust version improved by taking CollisionCache as a parameter).
- ✅ `find_safe_spawn_position` function implemented (Rust version improved by passing CollisionCache).
- ✅ `spawn_bot` reducer implemented.
- ⚠️ Random class selection is commented out in both C# and Rust, hardcoded to Rogue. This is a carried-over state, not a new Rust bug. Recommendation to enable this is valid.
- ⚠️ **Collision Cache Usage**: The Rust `spawn_bot` calls `crate::monsters_def::get_collision_cache()` to get monster locations for `is_position_safe`. This relies on a global static cache in `monsters_def`. There's a potential issue if `spawn_bot` is called when this global cache is not yet populated or is stale for the current game tick. This could lead to bots spawning in unsafe locations. This confirms the previous report's concern about collision cache population timing.

### 7. ResetWorld.cs → reset_world.rs
**Status**: ✅ Fully Ported (and enhanced)

World reset functionality appears to be completely ported and now also handles upgrade options:
- ✅ `reset_world` reducer properly declared.
- ✅ All original 11 cleanup steps for various tables (monsters, gems, spawners, timers, etc.) are properly implemented.
- ✅ **Enhancement**: Added step 12 to clear all `upgrade_options` from the `upgrade_options` table. This makes `reset_world` more comprehensive.
- ✅ Game state reset logic for boss status is implemented.
- ✅ Step 13 (previously 12), rescheduling monster spawning, correctly calls `crate::monsters_def::schedule_monster_spawning(ctx)`.

### 8. AttackUtils.cs → attack_utils.rs
**Status**: ✅ Fully Ported (with improvement)

All attack utility functions have been properly ported, with one notable improvement:
- ✅ `get_parameter_u` function logic is identical for all attack types.
- ✅ `determine_attack_direction` function logic is correctly ported for Sword, Wand, and Shield attack types. 
    - **Improvement/Fix**: The angle calculation for `AttackType.Knives` in the Rust version correctly uses radians for all parts of the calculation (`start_angle` and `angle_step`), which appears to fix a potential bug in the C# version where degrees and radians might have been mixed incorrectly.
- ✅ `find_nearest_enemy` function logic is identical.
- ✅ TODO comments regarding spatial hash optimization are preserved in both `determine_attack_direction` (for Wand) and `find_nearest_enemy`.
- The C# static class methods are correctly represented as free functions in the Rust module.

### 9. Collision.cs → collision.rs
**Status**: ✅ Fully Ported (with significant improvements/fixes)

The collision system has been completely ported with Rust-specific improvements and apparent bug fixes:
- ✅ All collision cache data structures (for Player, Monster, Gem, Attack) are ported.
    - **Improvement**: Rust organizes these into separate structs (`PlayerCollisionCache`, etc.) and a main `CollisionCache` struct, which is better for encapsulation and passing data, instead of C# global static arrays.
    - **Improvement**: Consistent use of `HashMap` for ID lookups where C# used `Dictionary`.
- ✅ `clear_collision_cache_for_frame` logic is ported correctly as `CollisionCache::clear_for_frame`.
- ✅ `get_world_cell_from_position` function ported.
    - **Improvement/Critical Fix**: The C# version used `pos / WORLD_GRID_WIDTH` (where `WORLD_GRID_WIDTH` is the number of cells), which seems incorrect for calculating a cell index from a pixel position. The Rust version uses `pos / WORLD_CELL_SIZE`, which is the correct logic. This is a significant fix.
- ✅ `spatial_hash_collision_checker` function ported.
    - **Improvement**: The Rust version uses `f32` for delta calculations before squaring, which is more precise than the C# version's casting to `int` before calculating deltas.

### 10. CoreGame.cs → core_game.rs
**Status**: ✅ Fully Ported (with structural improvements and increased robustness)

Core game functionality has been completely ported with some beneficial changes:
- ✅ `ERROR_FLAG` global variable behavior is maintained (using `unsafe` in Rust as required).
- ✅ Helper functions `CleanupAttackDamageRecords` and `CleanupMonsterDamageRecords` are correctly ported.
- ✅ `DamageMonster` function, including boss transition logic (calling `SpawnBossPhaseTwo` and `HandleBossDefeated` from `boss_system.rs`) and non-boss gem spawning (calling `spawn_gem_on_monster_death` from `gems_def.rs`), is correctly ported. 
    - Note: Rust's `spawn_gem_on_monster_death` takes an additional collision cache argument.
- ✅ `DamagePlayer` function, including armor calculation, death handling (inserting into `DeadPlayer` table), and calls to `ResetWorld` are correctly ported.
    - Calls to `CleanupPlayerAttacks` are ported.
    - `CleanupPlayerUpgradeOptions` is ported by delegating to `crate::upgrades_def::cleanup_player_upgrade_options`. The functionality of this delegated function will be verified with `Upgrades.cs`.
- ✅ `CleanupPlayerAttacks` function (cleaning active attacks, entities, burst cooldowns, scheduled attacks, and active attack cleanups) is correctly ported.
- ✅ `GameTick` reducer logic is fully ported:
    - Tick timing calculations (min, max, average) are ported, with Rust version having more robust handling of timestamp differences.
    - Scheduling of the next game tick is identical.
    - The sequence of calls at the end of the tick (`ClearCollisionCacheForFrame`, `ProcessPlayerMovement`, `ProcessMonsterMovements`, etc.) is maintained. Many of these are now local helper functions in `core_game.rs` that retrieve the global collision cache and call the actual implementations in their respective modules (e.g., `player_def.rs`, `monsters_def.rs`), which is a sound structural adaptation for Rust.
- The concern about "missing player cleanup integrations" seems largely addressed by the porting of `CleanupPlayerAttacks` and the delegation of `CleanupPlayerUpgradeOptions` within `DamagePlayer`.

### 11. Lib.cs → lib.rs
**Status**: ⚠️ Partially Ported

Main module setup, type definitions, and most reducers are ported, but with some differences and one key missing piece of logic:
- ✅ All core type definitions (`PlayerClass`, `DbVector2`) and game constants are ported. (`AttackType` enum is defined here in Rust, versus `Attacks.cs` in C# - this is acceptable).
- ✅ All table structures (`Entity`, `World`, `Account`, `GameTickTimer`) are ported.
- ✅ `init` reducer:
    - All initialization calls present in C# (`InitGameConfig`, `InitGameState`, `InitializeClassData`, `InitBestiary`, `InitExpSystem`, `InitializeAttackSystem`, `InitHealthRegenSystem`, `ScheduleMonsterSpawning`) are also present in the Rust `init` function. Previous report items about missing `init_exp_system` are outdated.
    - TODO comments in Rust `init` seem to be just comments, as calls follow them.
- ✅ `set_name` and `update_last_login` reducers are correctly ported.
- ✅ `spawn_player` reducer, including logic to create a new player (via `create_new_player` helpers) and schedule the initial boss spawn (via `schedule_boss_spawn` from `boss_system.rs`) for the first player, is correctly ported. Previous report items about missing `schedule_boss_spawn` here are outdated.
    - The starting attack for a new player is scheduled by directly calling `attacks_def::schedule_new_player_attack`. This is a valid refactor from C# which used a `ClassData.ScheduleAttack` helper.
- ⚠️ `client_connected` reducer:
    - Logic for handling new connections and creating accounts is mostly ported (minor difference in default name and setting `last_login`).
    - ❌ **Missing**: The C# version checks if a re-connecting client has an existing live or dead player and logs details. This functionality is currently commented out with TODOs in the Rust version and needs to be implemented.

### 12. BossSystem.cs → boss_system.rs
**Status**: ⚠️ Partially Ported

Boss system functionality is mostly ported, but with a key difference in cleanup logic upon boss defeat, including missing specific player cleanup calls:
- ✅ `GameState` and `BossSpawnTimer` tables are correctly ported.
- ✅ `init_game_state` function (including initial `schedule_boss_spawn` call) is correctly ported.
- ✅ `schedule_boss_spawn` function (5-minute timer) is correctly ported.
- ✅ `spawn_boss_phase_one` reducer (triggered by timer, checks players, updates game state, calls `schedule_boss_spawning`) is correctly ported.
- ✅ `schedule_boss_spawning` helper (creates `MonsterSpawner` for Phase 1 boss) is correctly ported.
- ✅ `spawn_boss_phase_two` function (called on Phase 1 defeat, updates game state, creates Phase 2 monster) is correctly ported.
- ✅ `spawn_boss_for_testing` reducer is correctly ported.
- ✅ `update_boss_monster_id` function (updates game state with Phase 1 boss ID when it's actually spawned) is correctly ported.
- ⚠️ `handle_boss_defeated` function (called on Phase 2 defeat):
    - ✅ Game state reset (boss_active=false, etc.) is ported.
    - ✅ Moving players to `DeadPlayer` table with `is_true_survivor = true` and deleting them from `Player` table is ported.
    - ❌ **Missing Functionality**: The C# version calls `CleanupPlayerAttacks` and `CleanupPlayerUpgradeOptions` for each player *before* deleting them. These calls are missing in the Rust version of `handle_boss_defeated`. This means attack/upgrade data for victorious players might not be cleaned up properly.
    - ⚠️ **Different Cleanup Strategy**: 
        - C# `HandleBossDefeated` performs targeted cleanup (gems) and then reschedules boss and monster spawning.
        - Rust `handle_boss_defeated` calls `crate::reset_world::reset_world(ctx)` after processing players. `reset_world` performs a full cleanup of monsters, gems, all timers, etc., and reschedules monster spawning. Then, Rust `handle_boss_defeated` *also* calls `schedule_boss_spawn(ctx)`. While `reset_world` is comprehensive, this broader cleanup and the sequence (reset then new boss schedule) differs from C#'s more specific handling for a victory scenario. The critical missing part is the player-specific attack/upgrade cleanup.

### 13. Monsters.cs → monsters_def.rs
**Status**: ✅ Fully Ported

Monster system has been completely ported with all functionality:
- ✅ SPAWNABLE_MONSTER_TYPES array properly defined
- ✅ All tables properly ported (Monsters, MonsterBoid, MonsterSpawnTimer, MonsterSpawners, MonsterDamage, MonsterHitCleanup)
- ✅ Global collision cache implemented (with static mut pattern)
- ✅ pre_spawn_monster_wave reducer implemented
- ✅ spawn_monster reducer implemented
- ✅ get_closest_player function implemented
- ✅ schedule_monster_spawning function implemented
- ✅ All movement processing functions (process_monster_movements, populate_monster_cache, etc.)
- ✅ Monster-attack collision processing implemented
- ✅ Monster repulsion system implemented
- ✅ damage_monster function (defined elsewhere in core_game.rs)

### 14. Attacks.cs → attacks_def.rs
**Status**: ✅ Fully Ported

Attack system has been completely ported:
- ✅ All tables properly defined (AttackData, AttackBurstCooldown, ActiveAttack, ActiveAttackCleanup, PlayerScheduledAttack)
- ✅ init_attack_data reducer with all 4 attack types configured
- ✅ find_attack_data_by_type helper function
- ✅ trigger_attack_projectile function with collision cache integration
- ✅ handle_attack_burst_cooldown reducer
- ✅ server_trigger_attack reducer
- ✅ schedule_new_player_attack function
- ✅ cleanup_active_attack reducer
- ✅ process_attack_movements function with shield rotation logic
- ✅ process_player_attack_collisions_spatial_hash function
- ✅ cleanup_attack_damage_records helper function

### 15. Upgrades.cs → upgrades_def.rs
**Status**: ✅ Fully Ported

Upgrade system has been completely ported:
- ✅ All enums (`UpgradeType`, `AttackStat`) and tables (`UpgradeOptionData`, `ChosenUpgradeData`) properly defined.
- ✅ `draw_upgrade_options` function with proper randomization (C# `System.Random` vs Rust `ctx.rng()`).
- ✅ `create_upgrade_option_data` function, including logic for offering new attacks or stat upgrades for existing ones, using `generate_attack_upgrade` helper.
- ✅ `choose_upgrade` reducer, including applying the upgrade via `apply_player_upgrade` and handling player `unspent_upgrades`.
- ✅ `apply_player_upgrade` function with all stat modifications for player and attacks (including re-scheduling for cooldown changes).
- ✅ `get_attack_type_from_upgrade` helper function.
- ✅ `reroll_upgrades` reducer.
- ✅ `cleanup_player_upgrade_options` function (defined in `upgrades_def.rs`) correctly implements the logic for deleting a player's pending upgrade options. This confirms the delegation from `core_game.rs` is sound.

### 16. Gems.cs → gems_def.rs
**Status**: ✅ Fully Ported

Gem/experience system has been completely ported:
- ✅ `GemLevel` enum and tables `Gem`, `ExpConfig` are correctly ported.
- ✅ `init_exp_system` function and default config values are identical.
- ✅ `create_gem` and `spawn_random_gem` (with weighted probabilities) are correctly ported.
- ✅ `spawn_gem_on_monster_death` is ported; now correctly takes `CollisionCache` in Rust to check gem capacity.
- ✅ `calculate_exp_for_level` and `get_exp_value_for_gem` are correctly ported.
- ✅ `give_player_exp` function, including multi-level up logic and calling `draw_upgrade_options`, is ported.
- ✅ `collect_gem` function (giving exp, deleting gem and entity) is ported.
- ✅ `maintain_gems` (populating gem collision cache) and `process_gem_collisions_spatial_hash` (player-gem collision leading to `collect_gem`) are ported, adapted to use the explicit `CollisionCache`.

## Updated Summary of Port Status

### ✅ Fully Ported (all 16 files confirmed)
1. Config.cs → config_def.rs
2. MonsterTypes.cs → monster_types_def.rs
3. Bestiary.cs → bestiary_def.rs
4. Player.cs → player_def.rs (Cleanup integrations appear largely addressed by CoreGame.cs)
5. ResetWorld.cs → reset_world.rs
6. AttackUtils.cs → attack_utils.rs (with improvement)
7. Collision.cs → collision.rs (with significant improvements/fixes)
8. CoreGame.cs → core_game.rs (with structural improvements)
9. Monsters.cs → monsters_def.rs (adapted to use explicit CollisionCache)
10. Attacks.cs → attacks_def.rs (adapted to use explicit CollisionCache, AttackType enum consolidated)
11. Upgrades.cs → upgrades_def.rs (cleanup_player_upgrade_options confirmed correct)
12. Gems.cs → gems_def.rs (adapted to use explicit CollisionCache)

### ⚠️ Partially Ported (3 files with remaining issues)
1. ClassData.cs → class_data_def.rs (missing helper `ScheduleAttack` method - importance reduced due to refactoring in `lib.rs` player creation, but confirm if used elsewhere or can be considered fully superseded).
2. Bots.cs → bots_def.rs (Collision cache timing issue for `spawn_bot` using global cache; hardcoded class selection carried over from C#).
3. Lib.cs → lib.rs (Missing player live/dead status check logic in `client_connected` reducer for re-connecting clients).
4. BossSystem.cs → boss_system.rs (Missing player-specific cleanup calls for attacks/upgrades in `handle_boss_defeated`; different overall cleanup strategy post-victory using `reset_world`).

## Updated Key Issues Found

1.  **Missing/Moved Functionality & Integrations**:
    *   `ClassData.ScheduleAttack` helper (C#) is missing in `class_data_def.rs`. Its primary call site (new player starting attack) has been refactored in `lib.rs`. Confirm if this helper had other uses.
    *   `lib.rs` (`client_connected` reducer): Missing logic to check for and log existing live/dead player status for re-connecting clients.
    *   `BossSystem.rs` (`handle_boss_defeated` function): Missing calls to `cleanup_player_attacks` and `cleanup_player_upgrade_options` for victorious players before they are removed. This is a functional regression from C#.

2.  **Bot System Concerns**:
    *   **Collision Cache Dependency**: `bots_def.rs` (specifically `spawn_bot`) relies on `monsters_def::get_collision_cache()` being up-to-date.
    *   **Hardcoded Class Selection**: Bot class selection in `bots_def.rs` is hardcoded to Rogue (this state is carried over from C# but should be addressed for full functionality).

3.  **Boss System (`handle_boss_defeated`)**:
    *   **Missing Player-Specific Cleanup**: 
        *   With `reset_world` now handling `upgrade_options` cleanup, the critical part of this issue is addressed if `reset_world` is called appropriately in `handle_boss_defeated`.
        *   Rust `handle_boss_defeated` still does not call `cleanup_player_attacks` directly for victorious players before they are removed. While `reset_world` clears most related tables globally, C# handles this immediately and per-player.
    *   **Cleanup Strategy Divergence**: Rust uses a full `reset_world()` upon boss defeat. C# performs more targeted cleanup. The `reset_world()` in Rust `handle_boss_defeated` now also clears `upgrade_options`.
    *   **Spawn Scheduling**: Correct (no double boss spawn).

4.  **Potential Integration Issues from Previous Report (to be verified during specific file reviews)**:
    *   ~~**Upgrades**: `core_game.rs` delegates `cleanup_player_upgrade_options` to `upgrades_def.rs`. Need to confirm implementation there, especially since it's missed in `boss_system.rs::handle_boss_defeated`.~~ (Implementation in `upgrades_def.rs` is confirmed correct. The issue remains that `boss_system.rs` needs to call it.)

## Updated Recommendations

1.  **High Priority Fixes (Address Missing Functionality/Regressions)**:
    *   **BossSystem (`handle_boss_defeated`)**: 
        *   Since `reset_world.rs` now clears `upgrade_options`, the explicit call to `cleanup_player_upgrade_options` within `handle_boss_defeated` is no longer necessary *if `reset_world` is called after player processing*.
        *   Consider adding a call to `crate::core_game::cleanup_player_attacks(ctx, player_id)` for each victorious player within `boss_system.rs::handle_boss_defeated` (before `reset_world`) to align more closely with C#'s immediate per-player attack data cleanup, though most underlying tables are eventually cleared by `reset_world`.
    *   **Lib (`client_connected`)**: In `lib.rs`, implement the missing logic in the `client_connected` reducer to check for existing live/dead player status for re-connecting clients and log relevant details, similar to the C# version.

2.  **Integration & Systemic Fixes**:
    *   **Bots - Collision Cache**: Ensure that `monsters_def::get_collision_cache()` provides an up-to-date monster collision cache when `bots_def.rs::spawn_bot` is called. This might involve adjusting the call order in the main game loop or modifying how the cache is accessed/passed to `spawn_bot`.
    *   **ClassData (`ScheduleAttack` helper)**: Determine if the C# `ClassData.ScheduleAttack` helper method had any other call sites apart from new player creation. If its only use was for scheduling the starting attack (which is now handled directly in `lib.rs::create_new_player_with_position`), then its absence in `class_data_def.rs` is acceptable. If it had other uses, those need to be ported or refactored in Rust.

3.  **Improvements & Refinements**:
    *   **Bots - Class Selection**: Enable random class selection for bots in `bots_def.rs`.
    *   **BossSystem - Cleanup Strategy**: After addressing the missing player-specific cleanups in `handle_boss_defeated`, the use of `reset_world()` in this context is acceptable, as it ensures a clean state. The sequence (player processing, then `reset_world`, then `schedule_boss_spawn`) is logical.

4.  **Testing**:
    *   Thoroughly test all systems, especially after implementing fixes, paying attention to integrations between modules like player spawn, attack scheduling, upgrades, bot behavior, and boss fight progression and cleanup.

Overall, the port is remarkably complete with most functionality properly implemented. The Rust version often includes structural improvements (like explicit CollisionCache handling) and even some minor bug fixes (e.g., in attack angle calculations, world cell calculation). The main remaining issues are specific missing integration points or logic regressions, primarily in `lib.rs (client_connected)` and `boss_system.rs (handle_boss_defeated)`, and a critical timing dependency in `bots_def.rs`. 