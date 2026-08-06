// === API Service ===

function getAuthHeaders() {
    const token = localStorage.getItem('api_token');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

async function handleResponse(response) {
    const text = await response.text();
    if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + text);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('Ungültige Server-Antwort: ' + text.substring(0, 200));
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return res;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            throw new Error('Request timeout');
        }
        throw e;
    }
}

async function retryFetch(url, options = {}, maxRetries = 1) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fetchWithTimeout(url, options);
        } catch (e) {
            lastError = e;
            // Kein Retry für nicht-idempotente Methoden (POST, PUT, PATCH, DELETE),
            // da diese serverseitige Seiteneffekte auslösen können.
            const method = (options.method || 'GET').toUpperCase();
            if (method !== 'GET' && method !== 'HEAD') {
                break;
            }
            if (i < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
            }
        }
    }
    throw lastError;
}

const api = {
    async get(endpoint) {
        const res = await retryFetch(CONFIG.API_URL + endpoint, {
            headers: getAuthHeaders()
        });
        return handleResponse(res);
    },

    async post(endpoint, data) {
        const res = await retryFetch(CONFIG.API_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(data)
        });
        return handleResponse(res);
    },

    async postForm(endpoint, formData) {
        const res = await retryFetch(CONFIG.API_URL + endpoint, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });
        return handleResponse(res);
    },

    async put(endpoint, data) {
        const res = await retryFetch(CONFIG.API_URL + endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(data)
        });
        return handleResponse(res);
    },

    async delete(endpoint) {
        const res = await retryFetch(CONFIG.API_URL + endpoint, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return handleResponse(res);
    },

    async patch(endpoint, data) {
        const res = await retryFetch(CONFIG.API_URL + endpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(data)
        });
        return handleResponse(res);
    }
};
