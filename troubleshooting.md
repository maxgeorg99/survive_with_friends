# SpacetimeDB C# Reducer Troubleshooting

This document covers common issues and solutions when working with SpacetimeDB tables inside C# reducers.

## Error: CS1061: 'TableName' does not contain a definition for 'FilterBy...' or 'Update'

**Problem:**
You might encounter errors like:
```
error CS1061: 'Module.Player' does not contain a definition for 'FilterByIdentity'...
error CS1061: 'Module.Player' does not contain a definition for 'Update'...
```
This usually happens when trying to call find or update methods directly on the table struct definition (e.g., `Player.FilterByIdentity(...)` or `Player.Update(...)`) inside a reducer.

**Solution:**

Table operations within reducers **must** go through the `ReducerContext` instance (commonly named `ctx`) provided as the first argument to the reducer method. Specifically, you interact with tables via `ctx.Db`.

Furthermore, finding, updating, or deleting specific rows typically involves accessing the table through one of its defined **indexes**. For primary key operations, you use the index named after the primary key field.

**Correct Pattern:**

1.  **Access the table via `ctx.Db`:** `ctx.Db.yourTableName`
2.  **Access the specific index:** `ctx.Db.yourTableName.yourIndexName` (e.g., `ctx.Db.player.identity` if `identity` is the primary key)
3.  **Use the index methods:**
    *   **Find:** `var recordOpt = ctx.Db.yourTableName.yourIndexName.Find(keyValue);`
        *   This returns a nullable struct (e.g., `Player?`). Check if `recordOpt == null`.
        *   If not null, get the value using `var record = recordOpt.Value;`.
    *   **Update:** Modify the `record` variable, then call `ctx.Db.yourTableName.yourIndexName.Update(record);`
    *   **Insert:** `ctx.Db.yourTableName.Insert(new YourTableStruct { ... });` (Note: Insert doesn't usually use an index directly)
    *   **Delete:** `ctx.Db.yourTableName.yourIndexName.Delete(keyValue);`

**Example (from `SetName` reducer):**

```csharp
[Reducer]
public static void SetName(ReducerContext ctx, string name)
{
    var identity = ctx.Sender;

    // ... validation ...

    // CORRECT: Find using ctx.Db and the 'identity' primary key index
    var playerOpt = ctx.Db.player.identity.Find(identity);
    if (playerOpt == null)
    {
        Log.Warn($"Attempted to set name for non-existent player {identity}.");
        return;
    }

    var player = playerOpt.Value;

    // Update local variable
    player.name = name.Trim();

    // CORRECT: Update using ctx.Db and the 'identity' primary key index
    ctx.Db.player.identity.Update(player);
    Log.Info($"Player {identity} name set to {player.name}.");
}
```

## Logging

**Problem:** Using `Console.WriteLine` inside a reducer might not send logs to the expected SpacetimeDB log output.

**Solution:** Use the `Log` static class provided by SpacetimeDB:
*   `Log.Info("...");`
*   `Log.Warn("...");`
*   `Log.Error("...");`
*   `Log.Debug("...");`

These will correctly route messages to the SpacetimeDB logs accessible via `spacetime logs <your_db_name>`.

## SpacetimeDB TypeScript SDK Package Name

**Problem:** Client-side code fails to resolve imports from `@spacetimedb/sdk`.

**Solution:** The correct npm package name for the SpacetimeDB TypeScript SDK is `@clockworklabs/spacetimedb-sdk`.

Make sure your imports look like this:
```typescript
import { Identity, SpacetimeDBClient } from '@clockworklabs/spacetimedb-sdk';
```
And ensure it's correctly listed in your `client/package.json` dependencies:
```json
"dependencies": {
  "phaser": "^3.80.1",
  "@clockworklabs/spacetimedb-sdk": "^0.8.1" 
},
```
(Double-check the version number against the latest available if needed).

## Remember to Rebuild

After making changes to your server module code (`.cs` files), always rebuild it using the SpacetimeDB CLI before publishing or generating client bindings:

```bash
cd server-csharp # Or your server module directory
spacetimedb build
``` 