// Direct imports thanks to Vite's built-in JSON support
import enTranslations from '../loca/en.json';
import deTranslations from '../loca/de.json';

class LocalizationManager {
    private static instance: LocalizationManager;
    private currentLanguage: string = 'en';
    private translations: Record<string, Record<string, string | number>> = {
        'en': enTranslations,
        'de': deTranslations
    };

    private constructor() {
        this.detectBrowserLanguage();
    }

    public static getInstance(): LocalizationManager {
        if (!LocalizationManager.instance) {
            LocalizationManager.instance = new LocalizationManager();
        }
        return LocalizationManager.instance;
    }

    private detectBrowserLanguage(): void {
        try {
            const browserLang = navigator.language.split('-')[0];
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

    public setLanguage(language: string): void {
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

        const text = translation[key];
        if (text === undefined) {
            console.warn(`No translation found for key ${key} in language ${this.currentLanguage}`);
            return key;
        }

        return text.toString();
    }

    public getWeaponName(tag: string): string {
        return this.getText(`weapon.${tag}.name`);
    }

    public getWeaponDescription(tag: string): string {
        return this.getText(`weapon.${tag}.description`);
    }
}

export const localization = LocalizationManager.getInstance();