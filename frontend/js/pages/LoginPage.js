const LoginPage = {
    setup() {
        const username = Vue.ref('');
        const password = Vue.ref('');
        const error = Vue.ref('');
        const settings = Vue.ref({});
        const showPassword = Vue.ref(false);

        const loadSettings = async () => {
            try {
                const sets = await api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.settings);
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
                const res = await api.post(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth, {
                    username: username.value,
                    password: password.value
                });
                if (res.success) {
                    localStorage.setItem('admin_token', res.token);
                    if (res.csrf_token) {
                        localStorage.setItem('csrf_token', res.csrf_token);
                    }
                    navigateTo('#/dashboard');
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

        return { username, password, error, login, logoUrl, showPassword, togglePassword };
    },
    template: '#login-template'
};
