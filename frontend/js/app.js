// Vue global build - keine Destrukturierung nötig

const routes = {
    '#/': LandingPage,
    '#/login': LandingPage,
    '#/dashboard': DashboardPage,
    '#/settings': SettingsPage,
    '#/superadmin': SettingsPage,
    '#/event': EventPage,
};

// Geschützte Bereiche
const protectedRoutes = ['#/dashboard', '#/settings'];

const App = {
    setup() {
        const currentRoute = Vue.ref(window.location.hash || '#/');
        const isAuthenticated = Vue.ref(false);
        const authChecked = Vue.ref(false);
        const userRole = Vue.ref('');

        const checkRouteAuth = async () => {
            const hash = window.location.hash || '#/';
            const needsAuth = protectedRoutes.includes(hash);

            if (needsAuth) {
                try {
                    const res = await api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth);
                    isAuthenticated.value = res.authenticated;
                    userRole.value = res.user?.role || '';
                    if (!res.authenticated) {
                        window.location.hash = '#/';
                        currentRoute.value = '#/';
                        authChecked.value = true;
                        return;
                    }
                    // Einstellungen nur für Super Admin
                    if (hash === '#/settings' && res.user?.role !== 'super_admin') {
                        window.location.hash = '#/dashboard';
                        currentRoute.value = '#/dashboard';
                        authChecked.value = true;
                        return;
                    }

                } catch (e) {
                    isAuthenticated.value = false;
                    window.location.hash = '#/';
                    currentRoute.value = '#/';
                    authChecked.value = true;
                    return;
                }
            }

            isAuthenticated.value = true;
            currentRoute.value = hash;
            authChecked.value = true;
        };

        // Initial auth check
        checkRouteAuth();

        const currentComponent = Vue.computed(() => {
            if (!authChecked.value) return null;
            return routes[currentRoute.value] || routes['#/'];
        });

        const hashChangeHandler = () => {
            checkRouteAuth();
        };

        window.addEventListener('hashchange', hashChangeHandler);

        Vue.onUnmounted(() => {
            window.removeEventListener('hashchange', hashChangeHandler);
        });

        return { currentComponent };
    }
};

const app = Vue.createApp(App);

// v-click-outside directive for dropdowns
app.directive('click-outside', {
    mounted(el, binding) {
        el._clickOutside = (event) => {
            if (!(el === event.target || el.contains(event.target))) {
                binding.value();
            }
        };
        document.addEventListener('click', el._clickOutside);
    },
    unmounted(el) {
        document.removeEventListener('click', el._clickOutside);
    }
});

app.mount('#app');

// Service Worker registrieren für PWA-Support (Add to Homescreen)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('Service Worker registriert:', registration.scope);
            })
            .catch((error) => {
                console.log('Service Worker Registrierung fehlgeschlagen:', error);
            });
    });
}
