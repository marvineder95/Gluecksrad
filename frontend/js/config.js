// === Konfiguration und Konstanten ===

const CONFIG = {
    API_URL: '',
    API_BASE: '',
    ENDPOINTS: {
        segments: '/api/segments',
        settings: '/api/settings',
        spin: '/api/spin',
        leads: '/api/leads',
        stats: '/api/stats',
        export: '/api/export',
        auth: {
            login: '/api/auth/login',
            me: '/api/auth/me',
            logout: '/api/auth/logout'
        },
        customers: '/api/customers',
        users: '/api/users',
        campaigns: '/api/campaigns'
        // themes: no backend endpoint in Go – use local THEMES constant instead
    },
    DEFAULTS: {
        total_spins_limit: 1000,
        campaign_status: 'running',
        primary_color: '#1E3A8A',
        secondary_color: '#F6A7C4',
        accent_color: '#D4AF37',
        font_family: 'Montserrat',
        label_font: '',               // '' = erbt font_family
        hub_font: '',
        button_font: '',
        wheel_title: 'Glücksrad',
        win_badge_text: 'GEWONNEN!',
        win_button_text: 'NÄCHSTE RUNDE',
        win_default_text: 'Herzlichen Glückwunsch!',
        segment_color: '#FF6B35',
        segment_weight: 100,
        logo_fallback: 'doveLogo.png',
        theme: 'dove',
        lead_capture_enabled: '0',
        lead_fields: '[{"key":"vorname","label":"Vorname","type":"text","multiline":false,"required":true,"enabled":true},{"key":"nachname","label":"Nachname","type":"text","multiline":false,"required":false,"enabled":false},{"key":"email","label":"E-Mail","type":"text","multiline":false,"required":true,"enabled":true},{"key":"telefon","label":"Telefon","type":"text","multiline":false,"required":false,"enabled":false},{"key":"adresse","label":"Adresse","type":"text","multiline":true,"required":false,"enabled":false}]',
        winner_email_enabled: '0',
        winner_email_subject: 'Herzlichen Glückwunsch zu deinem Gewinn!',
        winner_email_body: 'Hallo {{name}},\n\nherzlichen Glückwunsch! Du hast beim Glücksrad gewonnen: {{prize}}.\n\n{{win_text}}\n\nViel Freude damit!',
        winner_email_sender: 'noreply@point4spin.at',
        // === Design-Tokens (Rad-Stil, Labels, Texte) ===
        segment_fill_mode: 'image',   // 'image' = Theme-Bilder | 'color' = Segmentfarbe
        rim_enabled: '1',             // Aussenrand an/aus
        rim_style: 'gold',            // 'gold' = Premium-Verlauf | 'solid' = rim_color
        rim_color: '#C8A866',
        pointer_position: 'top',      // top | bottom | both
        hub_color: '#C8A866',
        separator_color: '#FFFFFF',
        separator_width: 2,           // Dicke der Trennlinien
        overlay_strength: 30,         // Abdunklung der Segment-Bilder in % (0-70)
        label_enabled: '1',
        label_color: '#FFFFFF',
        label_scale: 1,               // Multiplikator der Label-Größe (0.7-1.4)
        label_shadow: '1',            // Schatten/Glow der Labels an/aus
        label_shadow_color: '#000000',
        spin_button_text: 'Drehen',
        spin_trigger: 'button',       // button | hub | swipe | buzzer
        spin_hint: '',                // optionaler Hinweistext (leer = Standard je Modus)
        // Erweiterte Rad-Stil-Tokens (für Design-Presets)
        pointer_enabled: '1',
        pointer_color: '#C8A866',
        pointer_style: 'triangle',    // triangle | tab | arrow | diamond
        rim_glow: '0',                // Neon-Glow am Rand (0/1)
        segment_gap: 0,               // Lücke zwischen Segmenten in Grad (0-8)
        // Mittelelement (Hub) – frei konfigurierbar
        hub_enabled: '1',
        hub_type: 'shape',            // shape | text | logo
        hub_shape: 'circle',          // circle | ring | diamond | star | glow
        hub_text: '',
        hub_text_color: '#FFFFFF',
        hub_text_layout: 'straight',  // straight | arch (gebogen)
        hub_size: 0.16,               // Anteil des Radius (0.08-0.45)
        hub_content_scale: 1,         // Größe von Logo/Text INNERHALB des Hubs (0.4-1.6)
        hub_logo_bg: '#FFFFFF',       // Hintergrund hinter dem Logo im Mittelelement ('transparent' = keiner)
        segment_palette: '',          // intern (UI entfernt)
        background_mode: 'theme',     // 'theme' = Hintergrundbild | 'solid' = Farbe
        background_color: '#0F172A',
        // Spin-Button
        button_shape: 'pill',         // pill | rounded | square
        button_size: 1,               // 0.8-1.4
        button_color: '#1E3A8A',
        button_text_color: '#FFFFFF',
        button_position: 'below',     // below | above
        // Aussenränder: Liste (mehrere Ringe), je solid|gradient
        wheel_borders: '[{"fill":"gradient","c1":"#E8D5A3","c2":"#A68B4B","width":6,"glow":false}]'
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
        svg_padding: 46,
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
