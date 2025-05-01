using SpacetimeDB;
using System;
using System.Collections.Generic;

public static partial class Module
{
    // Define the gem levels (1-4)
    [SpacetimeDB.Type]
    public enum GemLevel
    {
        Small,  // = 1
        Medium, // = 2
        Large,  // = 3
        Huge    // = 4
    }

    // Table for storing gem objects in the game
    [SpacetimeDB.Table(Name = "gems", Public = true)]
    public partial struct Gem
    {
        [PrimaryKey, AutoInc]
        public uint gem_id;

        [Unique]
        public uint entity_id; // Associated entity for this gem

        public GemLevel level; // Level of the gem (1-4)

    }

    // Table for storing experience configuration
    [SpacetimeDB.Table(Name = "exp_config", Public = true)]
    public partial struct ExpConfig
    {
        [PrimaryKey]
        public uint config_id; // Should always be 0 for the one global config

        // Base experience granted per gem level
        public uint exp_small_gem;
        public uint exp_medium_gem;
        public uint exp_large_gem;
        public uint exp_huge_gem;

        // Base experience required for each level
        public uint base_exp_per_level;
        
        // Factor for calculating experience needed for level up
        // Formula: base_exp_per_level * (level ^ level_exp_factor)
        public float level_exp_factor;

        // Radius of the gem
        public float gem_radius;
    }

    // Initialize exp configuration during module init
    // This should be called from the main Init function
    public static void InitExpSystem(ReducerContext ctx)
    {
        // Check if exp config already exists
        var configOpt = ctx.Db.exp_config.config_id.Find(0);
        if (configOpt != null)
        {
            // Config already exists
            return;
        }

        // Create default exp configuration
        ctx.Db.exp_config.Insert(new ExpConfig
        {
            config_id = 0,
            exp_small_gem = 10,
            exp_medium_gem = 25,
            exp_large_gem = 50,
            exp_huge_gem = 100,
            base_exp_per_level = 100,
            level_exp_factor = 1.5f,
            gem_radius = 18.0f
        });

        Log.Info("Experience system initialized with default configuration");
    }

    // Creates a gem of the specified level at the given position
    public static uint CreateGem(ReducerContext ctx, DbVector2 position, GemLevel level)
    {
        var configOpt = ctx.Db.exp_config.config_id.Find(0);
        if (configOpt == null)
        {
            Log.Error("Experience system not initialized");
            return 0;
        }

        var config = configOpt.Value;   
        var gem_radius = config.gem_radius;

        // Create an entity for the gem
        Entity? gemEntityOpt = ctx.Db.entity.Insert(new Entity
        {
            position = position,
            direction = new DbVector2(0, 0), // Gems don't move
            is_moving = false,
            radius = gem_radius // Fixed 18 pixel radius for gems
        });

        if (gemEntityOpt == null)
        {
            Log.Error($"Failed to create entity for gem at position {position.x}, {position.y}");
            return 0;
        }

        // Create the gem and link it to the entity
        Gem? gemOpt = ctx.Db.gems.Insert(new Gem
        {
            entity_id = gemEntityOpt.Value.entity_id,
            level = level
        });

        if (gemOpt == null)
        {
            // If gem creation fails, clean up the entity
            ctx.Db.entity.entity_id.Delete(gemEntityOpt.Value.entity_id);
            Log.Error($"Failed to create gem record for entity {gemEntityOpt.Value.entity_id}");
            return 0;
        }

        Log.Info($"Created {level} gem (ID: {gemOpt.Value.gem_id}) at position {position.x}, {position.y}");
        return gemOpt.Value.gem_id;
    }

    // Helper method to spawn a gem with a random level at the given position
    public static uint SpawnRandomGem(ReducerContext ctx, DbVector2 position)
    {
        // Randomly select a gem level with weighted probabilities
        int randomValue = ctx.Rng.Next(1, 101); // 1-100
        GemLevel level;

        if (randomValue <= 79)
        {
            level = GemLevel.Small;
        }
        else if (randomValue <= 94)
        {
            level = GemLevel.Medium;
        }
        else if (randomValue <= 99)
        {
            level = GemLevel.Large;
        }
        else
        {
            level = GemLevel.Huge;
        }

        return CreateGem(ctx, position, level);
    }

    // Spawns a gem at the position of a killed monster
    public static void SpawnGemOnMonsterDeath(ReducerContext ctx, uint monsterId, DbVector2 position)
    {
        // Get monster data to determine gem drop chance and level
        var monsterOpt = ctx.Db.monsters.monster_id.Find(monsterId);
        if (monsterOpt == null)
        {
            return; // Monster not found (likely already deleted)
        }

        // Set a default drop chance
        float dropChance = 0.5f; // Default 50% drop chance

        // Roll for gem drop
        float roll = (float)ctx.Rng.NextDouble();
        if (roll <= dropChance)
        {
            SpawnRandomGem(ctx, position);
            Log.Info($"Monster {monsterId} dropped a gem at position {position.x}, {position.y}");
        }
    }

    // Calculate how much exp is needed for a given level
    public static uint CalculateExpForLevel(ReducerContext ctx, uint level)
    {
        var configOpt = ctx.Db.exp_config.config_id.Find(0);
        if (configOpt == null)
        {
            // Fallback if config not found
            return level * 100;
        }

        var config = configOpt.Value;
        return (uint)(config.base_exp_per_level * Math.Pow(level, config.level_exp_factor));
    }

    // Get exp value for a gem level
    public static uint GetExpValueForGem(ReducerContext ctx, GemLevel level)
    {
        var configOpt = ctx.Db.exp_config.config_id.Find(0);
        if (configOpt == null)
        {
            // Fallback values if config not found
            return level switch
            {
                GemLevel.Small => 10,
                GemLevel.Medium => 25,
                GemLevel.Large => 50,
                GemLevel.Huge => 100,
                _ => 0
            };
        }

        var config = configOpt.Value;
        return level switch
        {
            GemLevel.Small => config.exp_small_gem,
            GemLevel.Medium => config.exp_medium_gem,
            GemLevel.Large => config.exp_large_gem,
            GemLevel.Huge => config.exp_huge_gem,
            _ => 0
        };
    }

    // Apply experience to a player and handle level ups
    public static void GivePlayerExp(ReducerContext ctx, uint playerId, uint expAmount)
    {
        var playerOpt = ctx.Db.player.player_id.Find(playerId);
        if (playerOpt == null)
        {
            return; // Player not found
        }

        Player player = playerOpt.Value;
        uint newExp = player.exp + expAmount;
        uint currentLevel = player.level;
        bool leveledUp = false;
        
        // Get exp needed for current level from player data
        uint expNeeded = player.exp_for_next_level;
        
        // Loop to handle multiple level ups
        while (newExp >= expNeeded)
        {
            // Level up
            currentLevel++;
            newExp -= expNeeded;
            leveledUp = true;
            
            // Calculate exp needed for next level
            expNeeded = CalculateExpForLevel(ctx, currentLevel);
        }
        
        // Apply updates to player
        player.exp = newExp;
        
        if (leveledUp)
        {
            player.level = currentLevel;
            // Store the new exp needed for next level
            player.exp_for_next_level = expNeeded;
            
            // Grant an unspent upgrade point for each level gained
            player.unspent_upgrades += (currentLevel - playerOpt.Value.level);

            if(player.unspent_upgrades == 1)
            {
                DrawUpgradeOptions(ctx, playerId);
            }
            
            Log.Info($"Player {playerId} leveled up to level {currentLevel}! Exp: {newExp}/{expNeeded}");
        }
        else
        {
            Log.Info($"Player {playerId} gained {expAmount} exp. Now: {newExp}/{expNeeded}");
        }
        
        // Update player record
        ctx.Db.player.player_id.Update(player);
    }

    // Process a gem collection by a player
    public static void CollectGem(ReducerContext ctx, uint gemId, uint playerId)
    {
        // Find the gem
        var gemOpt = ctx.Db.gems.gem_id.Find(gemId);
        if (gemOpt == null)
        {
            return; // Gem not found
        }

        var gem = gemOpt.Value;

        // Get the entity ID for the gem
        uint gemEntityId = gem.entity_id;

        // Calculate exp based on gem level
        uint expValue = GetExpValueForGem(ctx, gem.level);

        // Give player exp
        GivePlayerExp(ctx, playerId, expValue);

        // Log the collection
        Log.Info($"Player {playerId} collected a {gem.level} gem worth {expValue} exp");

        // Delete the gem and its entity
        ctx.Db.gems.gem_id.Delete(gemId);
        ctx.Db.entity.entity_id.Delete(gemEntityId);
    }

    // This function should be called from GameTick to process gem collections
    public static void ProcessGemCollisions(ReducerContext ctx)
    {
        // Cache of gem entities for faster lookup
        var gemEntities = new Dictionary<uint, (Entity entity, Gem gem)>();
        
        // Load all gems with their entities
        foreach (var gem in ctx.Db.gems.Iter())
        {
            var entityOpt = ctx.Db.entity.entity_id.Find(gem.entity_id);
            if (entityOpt != null)
            {
                gemEntities[gem.entity_id] = (entityOpt.Value, gem);
            }
        }
        
        // If no gems exist, skip the rest of processing
        if (gemEntities.Count == 0)
        {
            return;
        }
        
        // Check each player for collisions with gems
        foreach (var player in ctx.Db.player.Iter())
        {
            var playerEntityOpt = ctx.Db.entity.entity_id.Find(player.entity_id);
            if (playerEntityOpt == null)
            {
                continue; // Skip if player has no entity
            }
            
            Entity playerEntity = playerEntityOpt.Value;
            
            // List to track gems that player has collected
            var collectedGems = new List<uint>();
            
            // Check against each gem
            foreach (var gemEntry in gemEntities)
            {
                uint gemEntityId = gemEntry.Key;
                var (gemEntity, gem) = gemEntry.Value;
                
                // Check if player is colliding with this gem
                if (AreEntitiesColliding(playerEntity, gemEntity))
                {
                    // Add to collected list
                    collectedGems.Add(gem.gem_id);
                }
            }
            
            // Process all collected gems for this player
            foreach (var gemId in collectedGems)
            {
                CollectGem(ctx, gemId, player.player_id);
            }
        }
    }
} 