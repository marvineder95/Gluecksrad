const LoginPage = {
    setup() {
        const email = Vue.ref('');
        const password = Vue.ref('');
        const error = Vue.ref('');
        const settings = Vue.ref({});
        const showPassword = Vue.ref(false);

        const loadSettings = async () => {
            try {
                // Login page loads settings without campaign_id (public, no campaign context yet)
                const sets = await api.get(CONFIG.ENDPOINTS.settings);
                settings.value = sets;
            } catch (e) {
                console.error('Fehler beim Laden der Settings:', e);
            }
        };

        const togglePassword = () => {
            showPassword.value = !showPassword.value;
        };

        const login = async () => {
            error.value = '';
            try {
                const res = await api.post(CONFIG.ENDPOINTS.auth.login, {
                    email: email.value,
                    password: password.value
                });
                if (res.success) {
                    // Save token – Go backend does not use CSRF
                    localStorage.setItem('api_token', res.token);
                    if (res.user) {
                        localStorage.setItem('user_role', res.user.role || '');
                        localStorage.setItem('customer_id', res.user.customer_id || '');
                        localStorage.setItem('user_email', res.user.email || '');
                        localStorage.setItem('user_id', res.user.id || '');
                    }
                    const role = res.user?.role || '';
                    navigateTo(getLoginRedirectHash(role));
                } else {
                    error.value = res.error || 'Login fehlgeschlagen';
                }
            } catch (e) {
                error.value = 'Netzwerkfehler';
            }
        };

        const logoUrl = Vue.computed(() => getLogoUrl(settings.value));

        Vue.onMounted(() => {
            loadSettings();
        });

        return { email, password, error, login, logoUrl, showPassword, togglePassword };
    },
    template: '#login-template'
};
