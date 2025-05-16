using SpacetimeDB;
using System;
using System.Runtime.CompilerServices;

public static partial class Module
{  
    // --- Player Collision ---
    private static readonly uint[] KeysPlayer = new uint[MAX_PLAYERS];
    private static readonly int[] CellPlayer = new int[MAX_PLAYERS];
    private static readonly int[] HeadsPlayer = new int[NUM_WORLD_CELLS];
    private static readonly int[] NextsPlayer = new int[MAX_PLAYERS];
    private static readonly float[] PosXPlayer = new float[MAX_PLAYERS];
    private static readonly float[] PosYPlayer = new float[MAX_PLAYERS];
    private static readonly float[] RadiusPlayer = new float[MAX_PLAYERS];
    private static uint CachedCountPlayers = 0;

    // --- Monster Collision ---
    private static readonly uint[] KeysMonster = new uint[MAX_MONSTERS];
    private static readonly int[] CachedTargetPlayerOrdinalIndex = new int[MAX_MONSTERS];
    private static readonly int[] HeadsMonster = new int[NUM_WORLD_CELLS];
    private static readonly int[] NextsMonster = new int[MAX_MONSTERS];
    private static readonly int[] CellMonster = new int[MAX_MONSTERS];
    private static readonly float[] PosXMonster = new float[MAX_MONSTERS];
    private static readonly float[] PosYMonster = new float[MAX_MONSTERS];
    private static readonly float[] RadiusMonster = new float[MAX_MONSTERS];
    private static readonly float[] SpeedMonster = new float[MAX_MONSTERS];
    private static int CachedCountMonsters = 0;

    // --- Gem Collision ---
    private static readonly uint[] KeysGem = new uint[MAX_GEM_COUNT];
    private static readonly int[] HeadsGem = new int[NUM_WORLD_CELLS];
    private static readonly int[] NextsGem = new int[MAX_GEM_COUNT];
    private static readonly float[] PosXGem = new float[MAX_GEM_COUNT];
    private static readonly float[] PosYGem = new float[MAX_GEM_COUNT];
    private static readonly float[] RadiusGem = new float[MAX_GEM_COUNT];
    private static int CachedCountGems = 0;

    // --- Attack Collision ---
    private static readonly uint[] KeysAttack = new uint[MAX_ATTACK_COUNT];
    private static readonly int[] HeadsAttack = new int[NUM_WORLD_CELLS];
    private static readonly int[] NextsAttack = new int[MAX_ATTACK_COUNT];
    private static readonly float[] PosXAttack = new float[MAX_ATTACK_COUNT];
    private static readonly float[] PosYAttack = new float[MAX_ATTACK_COUNT];
    private static readonly float[] RadiusAttack = new float[MAX_ATTACK_COUNT];
    private static int CachedCountAttacks = 0;

    private static void ClearCollisionCacheForFrame()
    {
        CachedCountPlayers = 0;
        CachedCountMonsters = 0;
        CachedCountGems = 0;
        CachedCountAttacks = 0;

        Array.Fill(KeysPlayer, (uint)0);
        Array.Fill(CellPlayer, 0);
        Array.Fill(HeadsPlayer, -1);
        Array.Fill(NextsPlayer, -1);
        Array.Fill(PosXPlayer, 0);
        Array.Fill(PosYPlayer, 0);
        Array.Fill(RadiusPlayer, 0);

        Array.Fill(KeysMonster, (uint)0);
        Array.Fill(CachedTargetPlayerOrdinalIndex, -1);
        Array.Fill(CellMonster, 0);
        Array.Fill(HeadsMonster, -1);
        Array.Fill(NextsMonster, -1);
        Array.Fill(PosXMonster, 0);
        Array.Fill(PosYMonster, 0);
        Array.Fill(RadiusMonster, 0);

        Array.Fill(KeysGem, (uint)0);
        Array.Fill(HeadsGem, -1);
        Array.Fill(NextsGem, -1);
        Array.Fill(PosXGem, 0);
        Array.Fill(PosYGem, 0);
        Array.Fill(RadiusGem, 0);

        Array.Fill(KeysAttack, (uint)0);
        Array.Fill(HeadsAttack, -1);
        Array.Fill(NextsAttack, -1);
        Array.Fill(PosXAttack, 0);
        Array.Fill(PosYAttack, 0);
        Array.Fill(RadiusAttack, 0);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static ushort GetWorldCellFromPosition(float x, float y)
    {
        // 1. Convert world-space to *integer* cell coordinates
        //    (fast floor because they’re non-negative here)
        ushort cellX = (ushort)(x / WORLD_GRID_WIDTH);      // 0 … 156
        ushort cellY = (ushort)(y / WORLD_GRID_HEIGHT);      // 0 … 156

        // 2. Pack into one 16-bit value:  cellY in the high byte, cellX in the low
        return (ushort)((cellY << WORLD_CELL_BIT_SHIFT) | (cellX & WORLD_CELL_MASK));
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool SpatialHashCollisionChecker(float ax, float ay, float ar, float bx, float by, float br)
    {
        // Get the distance between the two entities
        float dx = ax - bx;
        float dy = ay - by;
        float distanceSquared = dx * dx + dy * dy;
        
        // Calculate the minimum distance to avoid collision (sum of both radii)
        float minDistance = ar + br;
        float minDistanceSquared = minDistance * minDistance;
        
        // If distance squared is less than minimum distance squared, they are colliding
        return distanceSquared < minDistanceSquared;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float FastInvSqrt(float x)
    {
        unsafe
        {
            float xhalf = 0.5f * x;
            int i = *(int*)&x;              // get bits for floating value
            i = 0x5f3759df - (i >> 1);      // initial guess
            x = *(float*)&i;                // convert bits back to float
            x = x * (1.5f - xhalf * x * x); // one Newton-Raphson iteration
            return x;
        }
    }
}