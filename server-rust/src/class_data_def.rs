#[table(name = class_data, public)]
pub struct ClassData {
    #[primary_key]
    pub class_id: u32,
    
    pub player_class: PlayerClass,
    
    // Base stats for this class
    pub max_hp: i32,
    pub armor: i32,
    pub speed: f32,
    
    // Starting attack for this class
    pub starting_attack_type: AttackType,
}

impl ClassData {
    // Constructor with required fields
    pub fn new(player_class: PlayerClass, max_hp: i32, armor: i32, speed: f32, starting_attack_type: AttackType) -> Self {
        ClassData {
            player_class: player_class.clone(),
            class_id: player_class as u32,
            max_hp,
            armor,
            speed,
            starting_attack_type,
        }
    }
}

// Initialize class data with default values for each class
pub fn initialize_class_data(ctx: &ReducerContext) {
    log::info!("Initializing class data...");
    
    // Clear any existing class data
    for class_data in ctx.db.class_data().iter() {
        ctx.db.class_data().class_id().delete(&class_data.class_id);
    }
    
    // Insert Fighter class data
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Fighter as u32,
        player_class: PlayerClass::Fighter,
        max_hp: 100,
        armor: 0,
        speed: 200.0,
        starting_attack_type: AttackType::Sword,
    });
    
    // Insert Rogue class data
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Rogue as u32,
        player_class: PlayerClass::Rogue,
        max_hp: 100,
        armor: 0,
        speed: 200.0,
        starting_attack_type: AttackType::Knives,
    });
    
    // Insert Mage class data
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Mage as u32,
        player_class: PlayerClass::Mage,
        max_hp: 100,
        armor: 0,
        speed: 200.0,
        starting_attack_type: AttackType::Wand,
    });
    
    // Insert Paladin class data
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Paladin as u32,
        player_class: PlayerClass::Paladin,
        max_hp: 100,
        armor: 0,
        speed: 200.0,
        starting_attack_type: AttackType::Shield,
    });
    
    // Til (Football class)
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Football as u32,
        player_class: PlayerClass::Football,
        max_hp: 130,
        armor: 3,
        speed: 210.0,
        starting_attack_type: AttackType::Football,
    });
    
    // Yu-gi-oh Marc (Gambler class)
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Gambler as u32,
        player_class: PlayerClass::Gambler,
        max_hp: 90,
        armor: 0,
        speed: 220.0,
        starting_attack_type: AttackType::Cards,
    });
    
    // Gym Max (Athlete class)
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Athlete as u32,
        player_class: PlayerClass::Athlete,
        max_hp: 110,
        armor: 1,
        speed: 200.0,
        starting_attack_type: AttackType::Dumbbell,
    });
    
    // Chef Chris (Gourmand class)
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Gourmand as u32,
        player_class: PlayerClass::Gourmand,
        max_hp: 120,
        armor: 2,
        speed: 160.0,
        starting_attack_type: AttackType::Garlic,
    });
    
    // Insert Valkyrie class data
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Valkyrie as u32,
        player_class: PlayerClass::Valkyrie,
        max_hp: 100,
        armor: 0,
        speed: 200.0,
        starting_attack_type: AttackType::ThunderHorn,
    });
    
    // Volleyball Gwen (Volleyball class)
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Volleyball as u32,
        player_class: PlayerClass::Volleyball,
        max_hp: 100,
        armor: 0,
        speed: 230.0,
        starting_attack_type: AttackType::EnergyOrb,
    });
    
    // Enno Healer class
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Healer as u32,
        player_class: PlayerClass::Healer,
        max_hp: 110,
        armor: 1,
        speed: 200.0,
        starting_attack_type: AttackType::HealingWand,
    });
    
    // Enno (Stoner class)
    ctx.db.class_data().insert(ClassData {
        class_id: PlayerClass::Stoner as u32,
        player_class: PlayerClass::Stoner,
        max_hp: 120,
        armor: 1,
        speed: 190.0,
        starting_attack_type: AttackType::Joint,
    });
    
    log::info!("Class data initialization complete.");
}