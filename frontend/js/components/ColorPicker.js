// Eigener, design-konformer Farbwähler (kein System-/Browser-Picker).
// SV-Feld + Hue-Slider + Hex-Eingabe + Presets. v-model gibt Hex zurück.

function cpHsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = c; b = x; }
    else { r = c; b = x; }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}
function cpRgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function cpHexToRgb(hex) {
    hex = (hex || '').replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
    };
}
function cpRgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}
const cpClamp = n => Math.max(0, Math.min(1, n));

const ColorPicker = {
    props: {
        modelValue: { type: String, default: '#000000' },
        presets: {
            type: Array,
            default: () => [
                '#1E3A8A', '#2563EB', '#0EA5E9', '#06B6D4', '#10B981', '#22C55E',
                '#D4AF37', '#F59E0B', '#EF4444', '#EC4899', '#F6A7C4', '#8B5CF6',
                '#1E293B', '#475569', '#94A3B8', '#E2E8F0', '#FFFFFF', '#000000'
            ]
        }
    },
    emits: ['update:modelValue'],
    data() {
        return { open: false, h: 0, s: 0, v: 0, hexInput: '', dragging: null };
    },
    computed: {
        rgb() { return cpHsvToRgb(this.h, this.s, this.v); },
        hex() { return cpRgbToHex(this.rgb.r, this.rgb.g, this.rgb.b); },
        hueColor() { const c = cpHsvToRgb(this.h, 1, 1); return cpRgbToHex(c.r, c.g, c.b); },
        svBackground() {
            return 'linear-gradient(to top, #000, rgba(0,0,0,0)),'
                + 'linear-gradient(to right, #fff, rgba(255,255,255,0)),'
                + this.hueColor;
        }
    },
    watch: {
        modelValue: {
            immediate: true,
            handler(val) {
                if (val && val.toUpperCase() === this.hex) return;
                this.syncFrom(val);
            }
        }
    },
    methods: {
        syncFrom(val) {
            const rgb = cpHexToRgb(val);
            if (!rgb) { this.hexInput = val || ''; return; }
            const hsv = cpRgbToHsv(rgb.r, rgb.g, rgb.b);
            // Hue nur bei bunten Werten übernehmen, damit der Slider bei
            // Grau/Schwarz nicht auf 0 zurückspringt.
            if (hsv.s > 0) this.h = hsv.h;
            this.s = hsv.s;
            this.v = hsv.v;
            this.hexInput = this.hex;
        },
        emit() {
            this.hexInput = this.hex;
            this.$emit('update:modelValue', this.hex);
        },
        toggle() { this.open = !this.open; if (this.open) this.hexInput = this.hex; },
        close() { this.open = false; },
        onHexInput() {
            const rgb = cpHexToRgb(this.hexInput);
            if (rgb) {
                const hsv = cpRgbToHsv(rgb.r, rgb.g, rgb.b);
                if (hsv.s > 0) this.h = hsv.h;
                this.s = hsv.s; this.v = hsv.v;
                this.$emit('update:modelValue', this.hex);
            }
        },
        pickPreset(c) { this.syncFrom(c); this.emit(); },
        startSV(e) { this.dragging = 'sv'; this.moveSV(e); this.bind(); },
        startHue(e) { this.dragging = 'hue'; this.moveHue(e); this.bind(); },
        bind() {
            this._move = (ev) => {
                const p = ev.touches ? ev.touches[0] : ev;
                if (this.dragging === 'sv') this.moveSV(p);
                else if (this.dragging === 'hue') this.moveHue(p);
                ev.preventDefault();
            };
            this._up = () => {
                this.dragging = null;
                window.removeEventListener('mousemove', this._move);
                window.removeEventListener('mouseup', this._up);
                window.removeEventListener('touchmove', this._move);
                window.removeEventListener('touchend', this._up);
            };
            window.addEventListener('mousemove', this._move);
            window.addEventListener('mouseup', this._up);
            window.addEventListener('touchmove', this._move, { passive: false });
            window.addEventListener('touchend', this._up);
        },
        moveSV(e) {
            const r = this.$refs.sv.getBoundingClientRect();
            this.s = cpClamp((e.clientX - r.left) / r.width);
            this.v = 1 - cpClamp((e.clientY - r.top) / r.height);
            this.emit();
        },
        moveHue(e) {
            const r = this.$refs.hue.getBoundingClientRect();
            this.h = cpClamp((e.clientX - r.left) / r.width) * 360;
            this.emit();
        }
    },
    template: `
        <div class="cp" v-click-outside="close">
            <button type="button" class="cp-trigger" @click="toggle">
                <span class="cp-swatch" :style="{ background: hex }"></span>
                <span class="cp-hex-label">{{ hex }}</span>
            </button>
            <div v-if="open" class="cp-popover" @mousedown.stop>
                <div class="cp-sv" ref="sv" :style="{ background: svBackground }" @mousedown="startSV" @touchstart.prevent="startSV">
                    <div class="cp-sv-thumb" :style="{ left: (s*100)+'%', top: ((1-v)*100)+'%', background: hex }"></div>
                </div>
                <div class="cp-hue" ref="hue" @mousedown="startHue" @touchstart.prevent="startHue">
                    <div class="cp-hue-thumb" :style="{ left: (h/360*100)+'%' }"></div>
                </div>
                <div class="cp-row">
                    <span class="cp-swatch cp-swatch-lg" :style="{ background: hex }"></span>
                    <input type="text" class="cp-hex-input" v-model="hexInput" @input="onHexInput" @keydown.enter="onHexInput" maxlength="7">
                </div>
                <div class="cp-presets">
                    <button type="button" v-for="c in presets" :key="c" class="cp-preset"
                            :class="{ active: c.toUpperCase() === hex }"
                            :style="{ background: c }" :title="c" @click="pickPreset(c)"></button>
                </div>
            </div>
        </div>
    `
};
