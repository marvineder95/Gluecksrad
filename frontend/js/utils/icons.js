// === Icon Library ===
const ICONS = {
    'gift': { path: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z', viewBox: '0 0 24 24' },
    'tshirt': { path: 'M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z', viewBox: '0 0 24 24' },
    'crown': { path: 'm2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z', viewBox: '0 0 24 24' },
    'ticket': { path: 'M2 9a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v1H2V9zm0 3v4a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-4H2zm8 4h4', viewBox: '0 0 24 24' },
    'heart': { path: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z', viewBox: '0 0 24 24' },
    'star': { path: 'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', viewBox: '0 0 24 24' },
    'refresh': { path: 'M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2', viewBox: '0 0 24 24' },
    'bottle': { path: 'M9 2v2M9 4H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3M9 10v10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V10', viewBox: '0 0 24 24' },
    'trophy': { path: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z', viewBox: '0 0 24 24' },
    'bag': { path: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0', viewBox: '0 0 24 24' },
    'diamond': { path: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M12 22V6', viewBox: '0 0 24 24' },
    'medal': { path: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 2l-2 7h11l-2-7M8.5 2h7M7 9l-2 13h14L17 9', viewBox: '0 0 24 24' },
    'smile': { path: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01', viewBox: '0 0 24 24' },
    'zap': { path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z', viewBox: '0 0 24 24' },
    'coffee': { path: 'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3', viewBox: '0 0 24 24' },
    'music': { path: 'M9 18V5l12-2v13M9 9l12-2', viewBox: '0 0 24 24' },
    'camera': { path: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', viewBox: '0 0 24 24' },
    'sun': { path: 'M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', viewBox: '0 0 24 24' },
    'moon': { path: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z', viewBox: '0 0 24 24' },
    'plane': { path: 'M2 12h20M13 2l9 10-9 10', viewBox: '0 0 24 24' },
    'none': { path: '', viewBox: '0 0 24 24' }
};

// Hilfsfunktion: Icon-SVG als dynamisch renderbares Objekt zurückgeben
function getIconSvg(iconId, size, strokeColor) {
    const icon = ICONS[iconId];
    if (!icon || !icon.path) return null;
    return {
        path: icon.path,
        viewBox: icon.viewBox,
        size: size || 24,
        strokeColor: strokeColor || '#2E3A5C'
    };
}
