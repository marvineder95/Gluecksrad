// Vue global build - keine Destrukturierung nötig

const routes = {
    '#/event': EventPage,
    '#/login': LoginPage,
    '#/admin': AdminPage,
};

// Event-Seite ist öffentlich (Teilnehmer dürfen drehen), nur Admin ist geschützt
const protectedRoutes = ['#/admin'];

const App = {
    setup() {
        const currentRoute = Vue.ref(window.location.hash || '#/login');
        const isAuthenticated = Vue.ref(false);
        const authChecked = Vue.ref(false);

        const checkRouteAuth = async () => {
            const hash = window.location.hash || '#/login';
            const needsAuth = protectedRoutes.includes(hash);
            
            if (needsAuth) {
                try {
                    const res = await api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth);
                    isAuthenticated.value = res.authenticated;
                    if (!res.authenticated) {
                        window.location.hash = '#/login';
                        currentRoute.value = '#/login';
                        authChecked.value = true;
                        return;
                    }
                } catch (e) {
                    isAuthenticated.value = false;
                    window.location.hash = '#/login';
                    currentRoute.value = '#/login';
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
            return routes[currentRoute.value] || routes['#/login'];
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

// Service Worker deaktivieren (verhindert Cache-Probleme bei Live-Events)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
            registration.unregister();
        }
    });
}
