import Phaser from 'phaser';

export default class LoadingScene extends Phaser.Scene {
    private loadingText!: Phaser.GameObjects.Text;
    private spinner!: Phaser.GameObjects.Container;
    private dots!: Phaser.GameObjects.Text;
    private dotCount: number = 0;
    private dotTimer!: Phaser.Time.TimerEvent;
    private nextScene: string = '';
    private message: string = '';
    private timeoutDuration: number = 10000; // 10 seconds timeout by default
    private timeoutTimer: Phaser.Time.TimerEvent | null = null;

    constructor() {
        super('LoadingScene');
    }

    init(data: { message?: string, nextScene?: string, timeoutDuration?: number }) {
        this.message = data.message || 'Loading...';
        this.nextScene = data.nextScene || '';
        this.timeoutDuration = data.timeoutDuration || 10000;
        console.log(`LoadingScene initialized with message: ${this.message}, next scene: ${this.nextScene}`);
    }

    create() {
        const { width, height } = this.scale;
        
        // Set background color
        this.cameras.main.setBackgroundColor('#042E64');
        
        // Create loading text
        this.loadingText = this.add.text(width / 2, height / 2 - 50, this.message, {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);
        
        // Create animated dots
        this.dots = this.add.text(width / 2, height / 2 - 20, '', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);
        
        // Create spinner animation
        this.createSpinner(width / 2, height / 2 + 50);
        
        // Start dot animation
        this.dotTimer = this.time.addEvent({
            delay: 500,
            callback: this.updateDots,
            callbackScope: this,
            loop: true
        });
        
        // Set timeout to prevent indefinite loading
        if (this.nextScene) {
            this.timeoutTimer = this.time.delayedCall(this.timeoutDuration, () => {
                console.log(`Loading timed out after ${this.timeoutDuration}ms, proceeding to ${this.nextScene}`);
                this.proceedToNextScene();
            });
        }
        
        // Handle window resize
        this.scale.on('resize', this.handleResize, this);
    }
    
    private createSpinner(x: number, y: number) {
        // Create a container for the spinner
        this.spinner = this.add.container(x, y);
        
        // Create spinner circles
        const radius = 30;
        const numDots = 8;
        
        for (let i = 0; i < numDots; i++) {
            const angle = (i / numDots) * Math.PI * 2;
            const dotX = Math.cos(angle) * radius;
            const dotY = Math.sin(angle) * radius;
            const dotSize = 8;
            const alpha = 0.3 + (0.7 * i / numDots);
            
            const dot = this.add.circle(dotX, dotY, dotSize, 0xffffff, alpha);
            this.spinner.add(dot);
        }
        
        // Animate spinner rotation
        this.tweens.add({
            targets: this.spinner,
            angle: 360,
            duration: 2000,
            repeat: -1,
            ease: 'Linear'
        });
    }
    
    private updateDots() {
        this.dotCount = (this.dotCount + 1) % 4;
        this.dots.setText('.'.repeat(this.dotCount));
    }
    
    private handleResize() {
        const { width, height } = this.scale;
        
        if (this.loadingText) {
            this.loadingText.setPosition(width / 2, height / 2 - 50);
        }
        
        if (this.dots) {
            this.dots.setPosition(width / 2, height / 2 - 20);
        }
        
        if (this.spinner) {
            this.spinner.setPosition(width / 2, height / 2 + 50);
        }
    }
    
    /**
     * Call this method to complete loading and move to the next scene
     */
    public completeLoading() {
        if (this.timeoutTimer) {
            this.timeoutTimer.remove();
            this.timeoutTimer = null;
        }
        
        if (this.nextScene) {
            this.proceedToNextScene();
        }
    }
    
    private proceedToNextScene() {
        if (this.nextScene) {
            console.log(`Loading complete, proceeding to ${this.nextScene}`);
            this.scene.start(this.nextScene);
        } else {
            console.warn('No next scene specified, staying in LoadingScene');
        }
    }
    
    shutdown() {
        // Clean up timers
        if (this.dotTimer) {
            this.dotTimer.remove();
        }
        
        if (this.timeoutTimer) {
            this.timeoutTimer.remove();
            this.timeoutTimer = null;
        }
        
        // Remove resize listener
        this.scale.off('resize', this.handleResize);
    }
} 