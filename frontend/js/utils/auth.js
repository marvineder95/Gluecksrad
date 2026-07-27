// === Auth Utilities ===

function saveAuth(res) {
    if (res.token) localStorage.setItem('admin_token', res.token);
    if (res.csrf_token) localStorage.setItem('csrf_token', res.csrf_token);
    if (res.user) {
        localStorage.setItem('user_role', res.user.role);
        localStorage.setItem('customer_id', res.user.customer_id || '');
        localStorage.setItem('user_email', res.user.email);
    }
}

function clearAuth() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('csrf_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('customer_id');
    localStorage.removeItem('user_email');
}

function getStoredAuth() {
    return {
        token: localStorage.getItem('admin_token'),
        csrf: localStorage.getItem('csrf_token'),
        role: localStorage.getItem('user_role'),
        customerId: localStorage.getItem('customer_id'),
        email: localStorage.getItem('user_email')
    };
}

async function checkAuth(options = {}) {
    const { redirectOnFailure = false } = options;
    try {
        const res = await api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth);
        if (res.csrf_token) {
            localStorage.setItem('csrf_token', res.csrf_token);
        }
        if (res.user) {
            localStorage.setItem('user_role', res.user.role);
            localStorage.setItem('customer_id', res.user.customer_id || '');
            localStorage.setItem('user_email', res.user.email);
        }
        if (!res.authenticated && redirectOnFailure) {
            window.location.hash = '#/';
            window.location.reload();
        }
        return res;
    } catch (e) {
        if (redirectOnFailure) {
            window.location.hash = '#/';
            window.location.reload();
        }
        return { authenticated: false };
    }
}

function getLoginRedirectHash(role) {
    if (role === 'super_admin') return '#/settings';
    if (role === 'customer_admin') return '#/dashboard';
    return '#/';
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
