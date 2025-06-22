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
    BossEnderPhase1 = 8,
    BossEnderPhase2 = 9,
    BossAgnaPhase1 = 10,
    BossAgnaPhase2 = 11,
    AgnaCandle = 12,
    Crate = 13,
    Tree = 14,
    Statue = 15,
}

// Helper function to get monster type name from bestiary ID
pub fn get_monster_type_name(bestiary_id: &MonsterType) -> &'static str {
    match bestiary_id {
        MonsterType::Rat => "Rat",
        MonsterType::Slime => "Slime", 
        MonsterType::Bat => "Bat",
        MonsterType::Orc => "Orc",
        MonsterType::Imp => "Imp",
        MonsterType::Zombie => "Zombie",
        MonsterType::VoidChest => "VoidChest",
        MonsterType::EnderClaw => "EnderClaw",
        MonsterType::BossEnderPhase1 => "BossEnderPhase1",
        MonsterType::BossEnderPhase2 => "BossEnderPhase2",
        MonsterType::BossAgnaPhase1 => "BossAgnaPhase1",
        MonsterType::BossAgnaPhase2 => "BossAgnaPhase2",
        MonsterType::AgnaCandle => "AgnaCandle",
        MonsterType::Crate => "Crate",
        MonsterType::Tree => "Tree",
        MonsterType::Statue => "Statue",
    }
} 