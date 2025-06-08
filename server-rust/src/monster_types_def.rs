use spacetimedb::SpacetimeType;

// Monster types enum
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq, Hash)]
pub enum MonsterType {
    Rat = 0,
    Slime = 1,
    Bat = 2,
    Orc = 3,
    Imp = 4,
    Zombie = 5,
    VoidChest = 6,
    EnderClaw = 7,
    FinalBossPhase1 = 8,
    FinalBossPhase2 = 9,
} 