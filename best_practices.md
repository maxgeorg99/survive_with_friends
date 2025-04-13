# SpacetimeDB C# Reducer Best Practices

This document outlines recommended practices for writing effective and maintainable reducers in your SpacetimeDB C# server module.

## 1. Purpose and Scope

*   **Modify State:** Reducers are the *only* way your module logic should modify database tables. They encapsulate state changes.
*   **Transactional:** Every reducer call runs within a transaction. All database operations within a reducer succeed or fail together (atomicity). If an exception is thrown or the reducer otherwise fails, all its changes are rolled back.
*   **Keep Focused:** Aim for reducers with a clear, single responsibility (e.g., `SetName`, `UpdatePosition`, `PlayerShoot`). Avoid overly complex reducers doing too many unrelated things.

## 2. Interacting with Tables

*   **Use `ReducerContext` (`ctx`):** Always interact with database tables via the `ctx.Db` property provided in the `ReducerContext` argument.
*   **Use Indexes:** Access specific rows for finding, updating, or deleting primarily through defined table indexes (especially the primary key).
    *   **Find:** `var recordOpt = ctx.Db.yourTable.yourIndex.Find(key);` (Returns nullable)
    *   **Update:** `ctx.Db.yourTable.yourIndex.Update(modifiedRecord);`
    *   **Delete:** `ctx.Db.yourTable.yourIndex.Delete(key);`
    *   **Insert:** `ctx.Db.yourTable.Insert(new YourTableStruct { ... });`
*   **Check Nulls:** When using `Find`, always check if the result is `null` before accessing `.Value`.

```csharp
// Good example: Accessing via ctx.Db and primary key index
var playerOpt = ctx.Db.player.identity.Find(ctx.Sender);
if (playerOpt != null)
{
    var player = playerOpt.Value;
    player.name = "New Name";
    ctx.Db.player.identity.Update(player); // Update through the index
}
```

## 3. Logging

*   **Use `Log.*`:** Use the static `Log` class (`Log.Info`, `Log.Warn`, `Log.Error`, `Log.Debug`) for logging within reducers. This ensures output goes to the SpacetimeDB logs.
*   **Avoid `Console.WriteLine`:** This may not route output correctly.

## 4. Input Validation

*   **Validate Inputs:** Always validate arguments passed into your reducers from clients.
*   **Fail Explicitly:** If validation fails, you can:
    *   Simply `return` to do nothing (silently ignore).
    *   `throw new Exception("Reason for failure");` to signal an error back to the client (via error callback) and ensure the transaction rolls back.
    *   Log a warning using `Log.Warn`.

```csharp
[Reducer]
public static void SetName(ReducerContext ctx, string name)
{
    // Good: Validate input early
    if (string.IsNullOrWhiteSpace(name) || name.Length > 16)
    {
        Log.Warn($"Invalid name received: '{name}'");
        throw new Exception("Invalid name. Must be 1-16 characters."); // Fail explicitly
    }
    // ... rest of reducer logic ...
}
```

## 5. Lifecycle Reducers

*   **Use Appropriately:** Leverage the special lifecycle reducers for setup and connection handling:
    *   `[Reducer(ReducerKind.Init)]`: For one-time database initialization (setting up config tables, initial data).
    *   `[Reducer(ReducerKind.ClientConnected)]`: To handle logic when a client connects (e.g., creating/loading player state).
    *   `[Reducer(ReducerKind.ClientDisconnected)]`: To handle logic when a client disconnects (e.g., saving state, cleaning up).
*   **Parameterless (except ctx):** Remember these reducers cannot take custom parameters.

## 6. Handling Player Connect/Disconnect

*   **Consider the Two-Table Pattern:** As shown in the SpacetimeDB tutorials, using separate `player` (online) and `logged_out_player` (offline) tables can be an effective pattern:
    *   Simplifies querying online players.
    *   Potentially improves memory efficiency.
    *   Makes checking login status straightforward (check for existence in `player` table).
    *   Implement logic in `ClientConnected` and `ClientDisconnected` reducers to move player records between these tables.

## 7. Remember to Build

*   **Build After Changes:** Always run `spacetimedb build` in your server module directory after making code changes to ensure they compile before publishing or generating client bindings. 