// === Confetti Effect ===
class Confetti {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.running = false;
        this.resize();
        this.resizeHandler = () => this.resize();
        window.addEventListener('resize', this.resizeHandler);
    }

    destroy() {
        this.stop();
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    start(colors) {
        colors = colors || ['#FFD700', '#C9A227', '#FF6B35', '#3B82F6', '#10B981'];
        this.particles = [];
        const count = CONFIG.ANIMATION.confetti_particle_count;
        const minSize = CONFIG.ANIMATION.confetti_min_size;
        const maxSize = CONFIG.ANIMATION.confetti_max_size;

        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height - this.canvas.height,
                w: Math.random() * (maxSize - minSize) + minSize,
                h: Math.random() * (maxSize - minSize) + minSize,
                color: colors[Math.floor(Math.random() * colors.length)],
                vx: Math.random() * 6 - 3,
                vy: Math.random() * 6 + 2,
                rotation: Math.random() * 360,
                rotationSpeed: Math.random() * 10 - 5,
                gravity: 0.1,
                opacity: 1
            });
        }
        this.running = true;
        this.animate();
    }

    animate() {
        if (!this.running) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.vy += particle.gravity;
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.rotation += particle.rotationSpeed;
            particle.opacity -= 0.003;

            if (particle.opacity <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate((particle.rotation * Math.PI) / 180);
            this.ctx.globalAlpha = particle.opacity;
            this.ctx.fillStyle = particle.color;
            this.ctx.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
            this.ctx.restore();
        }

        if (this.particles.length > 0) {
            requestAnimationFrame(() => this.animate());
        } else {
            this.running = false;
        }
    }

    stop() {
        this.running = false;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
