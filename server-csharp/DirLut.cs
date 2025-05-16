// *** AUTO-GENERATED – DO NOT EDIT BY HAND ***
using SpacetimeDB;
using System;
using System.Numerics;

public static partial class Module
{
    public const int LookupTableRange = 158;
    public const int LookupTableDim = LookupTableRange * 2 + 1;

    public readonly static float[,] LookupTableX = new float[LookupTableDim, LookupTableDim];
    public readonly static float[,] LookupTableY = new float[LookupTableDim, LookupTableDim];

    private static void BuildDirectionLookupTable()
    {
        for (int dy = -LookupTableRange; dy <= LookupTableRange; dy++)
        {
            for (int dx = -LookupTableRange; dx <= LookupTableRange; dx++)
            {
                if (dx == 0 && dy == 0) continue;
                float d2 = dx * dx + dy * dy;
                float inv = FastInvSqrt(d2);

                LookupTableX[dy + LookupTableRange, dx + LookupTableRange] = dx * inv;
                LookupTableY[dy + LookupTableRange, dx + LookupTableRange] = dy * inv;
            }
        }
    }
}
