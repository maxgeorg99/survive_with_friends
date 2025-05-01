import Phaser from 'phaser';
import { Gem } from '../autobindings/gem_type';
import GemLevel from '../autobindings/gem_level_type';

export class GemManager {
    private scene: Phaser.Scene;
    private particleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
    
    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        
        // Create the particle emitter
        this.particleEmitter = scene.add.particles(0, 0, 'gems', {
            frame: 'gem_blue',
            lifespan: 800,
            speed: { min: 100, max: 200 },
            scale: { start: 0.6, end: 0 },
            alpha: { start: 1, end: 0 },
            angle: { min: 0, max: 360 },
            blendMode: 'ADD',
            quantity: 10
        });
        
        // Initially stop the emitter
        this.particleEmitter.stop();
    }
    
    public collectGem(x: number, y: number, gem: Gem): void {
        // Set emitter position to the gem's location
        this.particleEmitter.setPosition(x, y);
        
        // Set the particle frame based on gem type
        let gemLevel = 0;
        if (gem.level.tag === "Small") gemLevel = 1;
        else if (gem.level.tag === "Medium") gemLevel = 2;
        else if (gem.level.tag === "Large") gemLevel = 3;
        else if (gem.level.tag === "Huge") gemLevel = 4;
        
        switch (gemLevel) {
            case 1:
                this.particleEmitter.setFrame('gem_blue');
                break;
            case 2:
                this.particleEmitter.setFrame('gem_green');
                break;
            case 3:
                this.particleEmitter.setFrame('gem_orange');
                break;
            case 4:
                this.particleEmitter.setFrame('gem_purple');
                break;
            default:
                this.particleEmitter.setFrame('gem_blue');
        }
        
        // Emit a burst of particles
        this.particleEmitter.explode(10, x, y);
        
        console.log(`Gem collected - Level: ${gem.level.tag}, EXP reward: ${this.getExperienceReward(gem)}`);
    }
    
    private getExperienceReward(gem: Gem): number {
        // Calculate experience based on gem level
        switch (gem.level.tag) {
            case "Small": return 10;
            case "Medium": return 25;
            case "Large": return 50;
            case "Huge": return 100;
            default: return 10;
        }
    }
    
    public destroy(): void {
        if (this.particleEmitter) {
            this.particleEmitter.destroy();
        }
    }
} 