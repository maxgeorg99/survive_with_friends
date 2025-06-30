import en from '../loca/en.json';
import de from '../loca/de.json';

type LocalizationData = typeof en;

class LocalizationManager {
    private static instance: LocalizationManager;
    private currentLanguage: string = 'en';
    private translations: Record<string, LocalizationData> = {
        'en': en,
        'de': de
    };

    private constructor() {
        // Initialize with browser language if available
        this.detectBrowserLanguage();
    }

    public static getInstance(): LocalizationManager {
        if (!LocalizationManager.instance) {
            LocalizationManager.instance = new LocalizationManager();
        }
        return LocalizationManager.instance;
    }

    /**
     * Detects the browser's preferred language and sets it if available
     */
    private detectBrowserLanguage(): void {
        try {
            // Get browser language (returns something like 'en-US' or 'de')
            const browserLang = navigator.language.split('-')[0];
            
            // Check if we support this language
            if (this.translations[browserLang]) {
                console.log(`Setting language to browser preference: ${browserLang}`);
                this.currentLanguage = browserLang;
            } else {
                console.log(`Browser language ${browserLang} not supported, using default: en`);
            }
        } catch (error) {
            console.warn('Failed to detect browser language:', error);
        }
    }

    public setLanguage(language: string) {
        if (this.translations[language]) {
            this.currentLanguage = language;
        } else {
            console.warn(`Language ${language} not found, falling back to English`);
            this.currentLanguage = 'en';
        }
    }

    public getLanguage(): string {
        return this.currentLanguage;
    }

    public getText(key: string): string {
        const translation = this.translations[this.currentLanguage];
        if (!translation) {
            console.warn(`No translations found for language ${this.currentLanguage}`);
            return key;
        }

        const text = translation[key as keyof LocalizationData];
        if (!text) {
            console.warn(`No translation found for key ${key} in language ${this.currentLanguage}`);
            return key;
        }

        return text;
    }

    /**
     * Gets the localized name for a weapon based on its tag
     * @param tag The weapon tag (e.g., "Sword", "FireSword")
     * @returns Localized weapon name
     */
    public getWeaponName(tag: string): string {
        return this.getText(`weapon.${tag}.name`);
    }

    /**
     * Gets the localized description for a weapon based on its tag
     * @param tag The weapon tag (e.g., "Sword", "FireSword")
     * @returns Localized weapon description
     */
    public getWeaponDescription(tag: string): string {
        return this.getText(`weapon.${tag}.description`);
    }

    /**
     * Gets all weapon names mapped by their tag
     */
    get weaponNames(): Record<string, string> {
        const translation = this.translations[this.currentLanguage];
        const result: Record<string, string> = {};
        
        const prefix = 'weapon.';
        const suffix = '.name';
        
        // Find all weapon name keys and parse them
        for (const key in translation) {
            if (key.startsWith(prefix) && key.endsWith(suffix)) {
                const weaponTag = key.slice(prefix.length, key.length - suffix.length);
                result[weaponTag] = translation[key as keyof LocalizationData] as string;
            }
        }
        
        return result;
    }
    
    /**
     * Gets all weapon descriptions mapped by their tag
     */
    get weaponDescriptions(): Record<string, string> {
        const translation = this.translations[this.currentLanguage];
        const result: Record<string, string> = {};
        
        const prefix = 'weapon.';
        const suffix = '.description';
        
        // Find all weapon description keys and parse them
        for (const key in translation) {
            if (key.startsWith(prefix) && key.endsWith(suffix)) {
                const weaponTag = key.slice(prefix.length, key.length - suffix.length);
                result[weaponTag] = translation[key as keyof LocalizationData] as string;
            }
        }
        
        return result;
    }

    /**
     * Gets all weapon stats mapped by their tag
     */
    get weaponStats(): Record<string, { damage: number, cooldown: number, range: number, special: string }> {
        const translation = this.translations[this.currentLanguage];
        const result: Record<string, { damage: number, cooldown: number, range: number, special: string }> = {};
        
        const prefix = 'weapon.';
        
        // We'll loop through all keys once and build up the stats objects
        const statsMap: Record<string, Partial<{ damage: number, cooldown: number, range: number, special: string }>> = {};
        
        for (const key in translation) {
            if (!key.startsWith(prefix)) continue;
            
            // Extract the weapon tag and stat property from the key
            const keyParts = key.split('.');
            if (keyParts.length !== 3) continue;
            
            const weaponTag = keyParts[1];
            const statProperty = keyParts[2];
            
            // Initialize the object for this weapon if it doesn't exist
            if (!statsMap[weaponTag]) {
                statsMap[weaponTag] = {};
            }
            
            // Add the stat to the object
            const value = translation[key as keyof LocalizationData];
            switch (statProperty) {
                case 'damage':
                    statsMap[weaponTag].damage = Number(value);
                    break;
                case 'cooldown':
                    statsMap[weaponTag].cooldown = Number(value);
                    break;
                case 'range':
                    statsMap[weaponTag].range = Number(value);
                    break;
                case 'special':
                    statsMap[weaponTag].special = value as string;
                    break;
            }
        }
        
        // Convert all partial objects to complete objects with defaults
        for (const weaponTag in statsMap) {
            const stats = statsMap[weaponTag];
            result[weaponTag] = {
                damage: stats.damage ?? 0,
                cooldown: stats.cooldown ?? 0,
                range: stats.range ?? 0,
                special: stats.special ?? 'None'
            };
        }
        
        return result;
    }
}

export const localization = LocalizationManager.getInstance();