// === Auth Utilities ===

async function checkAuth(options = {}) {
    const { redirectOnFailure = false } = options;
    try {
        const res = await api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth);
        if (res.csrf_token) {
            localStorage.setItem('csrf_token', res.csrf_token);
        }
        if (!res.authenticated && redirectOnFailure) {
            window.location.hash = '#/login';
            window.location.reload();
        }
        return res;
    } catch (e) {
        if (redirectOnFailure) {
            window.location.hash = '#/login';
            window.location.reload();
        }
        return { authenticated: false };
    }
}

function navigateTo(hash) {
    window.location.hash = hash;
    window.location.reload();
}

function getLogoUrl(settings) {
    return settings?.logo || CONFIG.DEFAULTS.logo_fallback;
}

function getBackgroundStyle(settings) {
    const theme = settings?.theme;
    const customBg = settings?.background_image;

    if (theme && theme !== 'custom' && THEME_MAP[theme]) {
        return { backgroundImage: 'url(' + THEME_MAP[theme] + ')' };
    }
    if (customBg) {
        return { backgroundImage: 'url(' + customBg + ')' };
    }
    return {};
}
