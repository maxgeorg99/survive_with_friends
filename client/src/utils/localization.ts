import en from '../../public/loca/en.json';
import de from '../../public/loca/de.json';

type LocalizationData = typeof en;

class LocalizationManager {
    private static instance: LocalizationManager;
    private currentLanguage: string = 'en';
    private translations: Record<string, LocalizationData> = {
        'en': en,
        'de': de
    };

    private constructor() {}

    public static getInstance(): LocalizationManager {
        if (!LocalizationManager.instance) {
            LocalizationManager.instance = new LocalizationManager();
        }
        return LocalizationManager.instance;
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
}

export const localization = LocalizationManager.getInstance(); 