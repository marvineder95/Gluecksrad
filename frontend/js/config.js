// === Konfiguration und Konstanten ===

const CONFIG = {
    API_URL: '',
    API_BASE: '/backend/api',
    ENDPOINTS: {
        segments: '/segments.php',
        settings: '/settings.php',
        spin: '/spin.php',
        stats: '/stats.php',
        auth: '/auth.php',
        themes: '/themes.php'
    },
    DEFAULTS: {
        total_spins_limit: 1000,
        campaign_status: 'running',
        primary_color: '#1E3A8A',
        secondary_color: '#F6A7C4',
        accent_color: '#D4AF37',
        font_family: 'Montserrat',
        wheel_title: 'Glücksrad',
        segment_color: '#FF6B35',
        segment_weight: 100,
        logo_fallback: 'doveLogo.png',
        theme: 'dove'
    },
    ANIMATION: {
        confetti_particle_count: 200,
        confetti_min_size: 5,
        confetti_max_size: 10,
        spin_extra_rotations: 5,
        spin_duration_ms: 6000,
        spin_ease_power: 3,
        win_overlay_delay_ms: 300,
        test_spin_refresh_delay_ms: 500,
        secret_click_timeout_ms: 2000,
        secret_click_threshold: 5,
        auth_redirect_delay_ms: 800,
        toast_duration_ms: 3000
    },
    WHEEL: {
        text_radius_factor: 0.58,
        font_size_min: 14,
        font_size_factor: 0.042,
        svg_padding: 30,
        flip_start_deg: 90,
        flip_end_deg: 270,
        flip_offset_deg: 180
    },
    CAMPAIGN_STATUS: {
        running: { label: 'Läuft', class: 'running' },
        paused: { label: 'Pausiert', class: 'paused' },
        ended: { label: 'Beendet', class: 'ended' }
    }
};

const THEMES = [
    { id: 'dove', name: 'Standard', image: 'frontend/assets/themes/dove.jpg' },
    { id: 'ocean', name: 'Ozean', image: 'frontend/assets/themes/ocean.jpg' },
    { id: 'flowers', name: 'Blumen', image: 'frontend/assets/themes/flowers.jpg' },
    { id: 'mountains', name: 'Berge', image: 'frontend/assets/themes/mountains.jpg' },
    { id: 'forest', name: 'Wald', image: 'frontend/assets/themes/forest.jpg' },
    { id: 'sunset', name: 'Sonnenuntergang', image: 'frontend/assets/themes/sunset.jpg' }
];

const THEME_MAP = {
    'dove': 'frontend/assets/themes/dove.jpg',
    'ocean': 'frontend/assets/themes/ocean.jpg',
    'flowers': 'frontend/assets/themes/flowers.jpg',
    'mountains': 'frontend/assets/themes/mountains.jpg',
    'forest': 'frontend/assets/themes/forest.jpg',
    'sunset': 'frontend/assets/themes/sunset.jpg'
};

// === Segment Themes (für Rad-Segmente) – mit Hintergrundbildern ===
const SEGMENT_THEMES = {
    'floral': {
        name: 'Floral',
        image: 'frontend/assets/segment-themes/floral.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.35)'
    },
    'water': {
        name: 'Wasser',
        image: 'frontend/assets/segment-themes/water.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.25)'
    },
    'ocean': {
        name: 'Meer',
        image: 'frontend/assets/segment-themes/ocean.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.25)'
    },
    'sky': {
        name: 'Himmel',
        image: 'frontend/assets/segment-themes/sky.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.25)'
    },
    'sand': {
        name: 'Sand',
        image: 'frontend/assets/segment-themes/sand.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.25)'
    },
    'wellness': {
        name: 'Wellness',
        image: 'frontend/assets/segment-themes/wellness.jpg',
        textColor: '#5A4A3A',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(90,74,58,0.2)',
        overlay: 'rgba(255,255,255,0.25)'
    },
    'luxury': {
        name: 'Luxury',
        image: 'frontend/assets/segment-themes/luxury.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.4)'
    },
    'nature': {
        name: 'Natur',
        image: 'frontend/assets/segment-themes/nature.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.35)'
    },
    'ice': {
        name: 'Eis',
        image: 'frontend/assets/segment-themes/ice.jpg',
        textColor: '#2A4A5A',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(42,74,90,0.2)',
        overlay: 'rgba(255,255,255,0.2)'
    },
    'clouds': {
        name: 'Wolken',
        image: 'frontend/assets/segment-themes/clouds.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.35)'
    },
    'summer': {
        name: 'Sommer',
        image: 'frontend/assets/segment-themes/summer.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.2)'
    },
    'winter': {
        name: 'Winter',
        image: 'frontend/assets/segment-themes/winter.jpg',
        textColor: '#3A5A7A',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(58,90,122,0.2)',
        overlay: 'rgba(255,255,255,0.2)'
    },
    'beauty': {
        name: 'Beauty',
        image: 'frontend/assets/segment-themes/beauty.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.35)'
    },
    'premium': {
        name: 'Premium',
        image: 'frontend/assets/segment-themes/premium.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(90,74,58,0.2)',
        overlay: 'rgba(255,255,255,0.2)'
    },
    'gold': {
        name: 'Gold',
        image: 'frontend/assets/segment-themes/gold.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.3)'
    },
    'neutral': {
        name: 'Neutral',
        image: 'frontend/assets/segment-themes/neutral.jpg',
        textColor: '#555555',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(85,85,85,0.15)',
        overlay: 'rgba(0,0,0,0.08)'
    },
    'rose': {
        name: 'Rose',
        image: 'frontend/assets/segment-themes/rose.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.25)'
    },
    'champagne': {
        name: 'Champagne',
        image: 'frontend/assets/segment-themes/champagne.jpg',
        textColor: '#5A4A3A',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(90,74,58,0.2)',
        overlay: 'rgba(0,0,0,0.1)'
    },
    'silk': {
        name: 'Seide',
        image: 'frontend/assets/segment-themes/silk.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.2)'
    },
    'marble': {
        name: 'Marmor',
        image: 'frontend/assets/segment-themes/marble.jpg',
        textColor: '#555555',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(85,85,85,0.15)',
        overlay: 'rgba(0,0,0,0.08)'
    },
    'pastel': {
        name: 'Pastell',
        image: 'frontend/assets/segment-themes/pastel.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.15)'
    },
    'pearl': {
        name: 'Perle',
        image: 'frontend/assets/segment-themes/pearl.jpg',
        textColor: '#555555',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(85,85,85,0.15)',
        overlay: 'rgba(0,0,0,0.08)'
    },
    'lavender': {
        name: 'Lavendel',
        image: 'frontend/assets/segment-themes/lavender.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.2)'
    },
    'blush': {
        name: 'Blush',
        image: 'frontend/assets/segment-themes/blush.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.2)'
    },
    'velvet': {
        name: 'Samt',
        image: 'frontend/assets/segment-themes/velvet.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.35)'
    },
    'aurora': {
        name: 'Aurora',
        image: 'frontend/assets/segment-themes/aurora.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.15)'
    },
    'cream': {
        name: 'Cream',
        image: 'frontend/assets/segment-themes/cream.jpg',
        textColor: '#555555',
        iconBg: 'rgba(255,255,255,0.65)',
        iconBorder: 'rgba(85,85,85,0.15)',
        overlay: 'rgba(0,0,0,0.08)'
    },
    'dustyrose': {
        name: 'Dusty Rose',
        image: 'frontend/assets/segment-themes/dustyrose.jpg',
        textColor: '#FFFFFF',
        iconBg: 'rgba(255,255,255,0.45)',
        iconBorder: 'rgba(255,255,255,0.6)',
        overlay: 'rgba(0,0,0,0.25)'
    }
};
