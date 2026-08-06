const LandingPage = {
    setup() {
        // === Login state ===
        const email = Vue.ref('');
        const password = Vue.ref('');
        const error = Vue.ref('');
        const showPassword = Vue.ref(false);
        const isLoading = Vue.ref(false);
        const showLoginModal = Vue.ref(false);

        // === Mobile nav ===
        const mobileMenuOpen = Vue.ref(false);

        // === Contact form ===
        const contactForm = Vue.ref({
            name: '',
            company: '',
            email: '',
            phone: '',
            event_date: '',
            message: '',
            copy_to_sender: false,
            privacy_consent: false
        });
        const contactSubmitting = Vue.ref(false);
        const contactSuccess = Vue.ref('');
        const contactError = Vue.ref('');

        const togglePassword = () => {
            showPassword.value = !showPassword.value;
        };

        const openLogin = () => {
            showLoginModal.value = true;
            window.location.hash = '#/login';
        };

        const closeLogin = () => {
            showLoginModal.value = false;
            if (window.location.hash === '#/login') {
                window.location.hash = '#/';
            }
        };

        const login = async () => {
            error.value = '';
            if (!email.value || !password.value) {
                error.value = 'E-Mail und Passwort erforderlich';
                return;
            }
            isLoading.value = true;
            try {
                const res = await api.post(CONFIG.ENDPOINTS.auth.login, {
                    email: email.value,
                    password: password.value
                });
                if (res.success) {
                    saveAuth(res);
                    navigateTo(getLoginRedirectHash(res.user?.role));
                } else {
                    error.value = res.error || 'Login fehlgeschlagen';
                }
            } catch (e) {
                error.value = 'Netzwerkfehler';
            } finally {
                isLoading.value = false;
            }
        };

        const toggleMobileMenu = () => {
            mobileMenuOpen.value = !mobileMenuOpen.value;
        };

        const closeMobileMenu = () => {
            mobileMenuOpen.value = false;
        };

        const handleNavClick = (event) => {
            const href = event.currentTarget.getAttribute('href');
            if (href === '#') {
                event.preventDefault();
                event.stopPropagation();
                closeMobileMenu();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            if (href && href.startsWith('#') && href.length > 1 && !href.startsWith('#/')) {
                event.preventDefault();
                event.stopPropagation();
                const targetId = href.substring(1);
                const target = document.getElementById(targetId);
                if (target) {
                    closeMobileMenu();
                    const nav = document.querySelector('.landing-nav');
                    const navHeight = nav?.offsetHeight || 72;
                    const top = target.offsetTop - navHeight;
                    window.scrollTo({ top, behavior: 'smooth' });
                }
            }
        };

        const submitContact = async () => {
            contactSuccess.value = '';
            contactError.value = '';

            const f = contactForm.value;
            if (!f.name.trim()) {
                contactError.value = 'Bitte geben Sie Ihren Namen ein.';
                return;
            }
            if (!f.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
                contactError.value = 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
                return;
            }
            if (!f.message.trim()) {
                contactError.value = 'Bitte geben Sie eine Nachricht ein.';
                return;
            }
            if (!f.privacy_consent) {
                contactError.value = 'Bitte stimmen Sie der Datenschutzerklärung zu.';
                return;
            }

            contactSubmitting.value = true;
            try {
                const res = await fetch(CONFIG.API_BASE + '/contact.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: f.name.trim(),
                        company: f.company.trim(),
                        email: f.email.trim(),
                        phone: f.phone.trim(),
                        event_date: f.event_date,
                        message: f.message.trim(),
                        copy_to_sender: f.copy_to_sender,
                        privacy_consent: true
                    })
                });
                const data = await res.json();
                if (data.success) {
                    contactSuccess.value = data.copy_sent
                        ? 'Vielen Dank! Ihre Anfrage wurde versendet. Sie erhalten in Kürze eine Bestätigung an Ihre E-Mail-Adresse.'
                        : 'Vielen Dank! Ihre Anfrage wurde versendet. Wir melden uns in Kürze bei Ihnen.';
                    contactForm.value = {
                        name: '',
                        company: '',
                        email: '',
                        phone: '',
                        event_date: '',
                        message: '',
                        copy_to_sender: false,
                        privacy_consent: false
                    };
                } else {
                    contactError.value = data.error || 'Beim Versenden ist ein Fehler aufgetreten.';
                }
            } catch (e) {
                contactError.value = 'Netzwerkfehler. Bitte versuchen Sie es erneut.';
            } finally {
                contactSubmitting.value = false;
            }
        };

        const handleKeydown = (event) => {
            if (event.key === 'Enter' && showLoginModal.value) login();
            if (event.key === 'Escape' && showLoginModal.value) closeLogin();
        };

        Vue.onMounted(() => {
            window.addEventListener('keydown', handleKeydown);
            if (window.location.hash === '#/login') {
                showLoginModal.value = true;
            }

            // Attach smooth scroll to nav links
            document.querySelectorAll('a[href^="#"]:not([href^="#/"])').forEach(link => {
                link.addEventListener('click', handleNavClick);
            });

            // IntersectionObserver for fade-in animations
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

            document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
        });

        Vue.onUnmounted(() => {
            window.removeEventListener('keydown', handleKeydown);
            document.querySelectorAll('a[href^="#"]:not([href^="#/"])').forEach(link => {
                link.removeEventListener('click', handleNavClick);
            });
        });

        return {
            email, password, error, showPassword, togglePassword, login, isLoading,
            showLoginModal, openLogin, closeLogin,
            mobileMenuOpen, toggleMobileMenu, closeMobileMenu,
            contactForm, contactSubmitting, contactSuccess, contactError, submitContact
        };
    },
    template: '#landing-template'
};
