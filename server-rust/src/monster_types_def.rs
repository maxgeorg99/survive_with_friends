use spacetimedb::SpacetimeType;

// Monster types enum
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum MonsterType {
    Rat = 0,
    Slime = 1,
    Orc = 2,
    FinalBossPhase1 = 3,
    FinalBossPhase2 = 4,
    VoidChest = 5,
    Imp = 6,
    Zombie = 7,
    EnderClaw = 8,
    Bat = 9,
} 