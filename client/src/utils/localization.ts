import en from '@/loca/en.json';
import de from '@/loca/de.json';

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
}

export const localization = LocalizationManager.getInstance();