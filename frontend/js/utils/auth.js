// === Auth Utilities ===

function saveAuth(res) {
    if (res.token) localStorage.setItem('api_token', res.token);
    // csrf_token is not used by the Go backend — do not store or send it
    if (res.user) {
        localStorage.setItem('user_role', res.user.role);
        localStorage.setItem('customer_id', res.user.customer_id || '');
        localStorage.setItem('user_email', res.user.email);
        localStorage.setItem('user_id', res.user.id || '');
    }
}

function clearAuth() {
    localStorage.removeItem('api_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('customer_id');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_id');
    localStorage.removeItem('current_campaign_id');
}

function getStoredAuth() {
    return {
        token: localStorage.getItem('api_token'),
        role: localStorage.getItem('user_role'),
        customerId: localStorage.getItem('customer_id'),
        email: localStorage.getItem('user_email'),
        userId: localStorage.getItem('user_id')
    };
}

async function checkAuth(options = {}) {
    const { redirectOnFailure = false } = options;
    try {
        const res = await api.get(CONFIG.ENDPOINTS.auth.me);
        if (res.user) {
            localStorage.setItem('user_role', res.user.role);
            localStorage.setItem('customer_id', res.user.customer_id || '');
            localStorage.setItem('user_email', res.user.email);
            localStorage.setItem('user_id', res.user.id || '');
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
    return settings?.logo || '';
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
