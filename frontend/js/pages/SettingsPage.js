const SettingsPage = {
    setup() {
        const customers = Vue.ref([]);
        const toasts = Vue.ref([]);
        const currentUser = Vue.ref({});
        const showCustomerModal = Vue.ref(false);
        const editingCustomer = Vue.ref(null);
        const customerForm = Vue.ref({ company_name: '', contact_name: '', email: '', subdomain: '' });
        const savingCustomer = Vue.ref(false);

        const showConfirmModal = Vue.ref(false);
        const confirmCustomer = Vue.ref(null);

        const showCredentialsModal = Vue.ref(false);
        const newCredentials = Vue.ref({ email: '', error: null });

        const showOwnPasswordModal = Vue.ref(false);
        const ownPasswordForm = Vue.ref({ current_password: '', new_password: '', confirm_password: '' });

        const showOwnEmailModal = Vue.ref(false);
        const ownEmailForm = Vue.ref({ email: '' });
        const ownEmailError = Vue.ref('');

        const toastTimers = [];
        const addToast = (message, type = 'success') => {
            const id = Date.now();
            toasts.value.push({ id, msg: message, type });
            const timer = setTimeout(() => {
                toasts.value = toasts.value.filter(t => t.id !== id);
            }, CONFIG.ANIMATION.toast_duration_ms);
            toastTimers.push(timer);
        };

        const loadCustomers = async () => {
            try {
                const res = await api.get(CONFIG.ENDPOINTS.customers);
                customers.value = res;
            } catch (e) {
                addToast('Fehler beim Laden der Kunden', 'error');
            }
        };

        const loadUser = async () => {
            try {
                const res = await checkAuth();
                if (res.user) currentUser.value = res.user;
            } catch (e) {
                console.error('Fehler beim Laden des Benutzers:', e);
            }
        };

        const openCustomerModal = (customer) => {
            editingCustomer.value = customer ? customer.id : null;
            customerForm.value = customer
                ? { company_name: customer.company_name, contact_name: customer.contact_name, email: customer.email, subdomain: customer.subdomain || '' }
                : { company_name: '', contact_name: '', email: '', subdomain: '' };
            showCustomerModal.value = true;
        };

        const saveCustomer = async () => {
            if (savingCustomer.value) return;
            savingCustomer.value = true;
            try {
                const endpoint = CONFIG.ENDPOINTS.customers + (editingCustomer.value ? '?id=' + editingCustomer.value : '');
                if (editingCustomer.value) {
                    await api.put(endpoint, customerForm.value);
                    addToast('Kunde aktualisiert');
                    showCustomerModal.value = false;
                    loadCustomers();
                } else {
                    const res = await api.post(endpoint, customerForm.value);
                    showCustomerModal.value = false;
                    loadCustomers();
                    if (res.email_sent) {
                        newCredentials.value = { email: customerForm.value.email, error: null };
                        addToast('Kunde angelegt – Zugangsdaten wurden per E-Mail versendet');
                    } else {
                        newCredentials.value = { email: customerForm.value.email, error: res.email_error || 'Unbekannter Fehler' };
                        addToast('Kunde angelegt – E-Mail konnte nicht gesendet werden', 'error');
                    }
                    showCredentialsModal.value = true;
                }
            } catch (e) {
                const message = e.message || '';
                if (message.includes('E-Mail wird bereits verwendet')) {
                    addToast('E-Mail wird bereits verwendet', 'error');
                } else if (message.includes('Subdomain wird bereits verwendet')) {
                    addToast('Subdomain wird bereits verwendet', 'error');
                } else {
                    addToast('Fehler beim Speichern', 'error');
                }
            } finally {
                savingCustomer.value = false;
            }
        };

        const toggleCustomer = async (customer) => {
            try {
                await api.put(CONFIG.ENDPOINTS.customers + '?id=' + customer.id, { is_active: customer.is_active ? 0 : 1 });
                addToast('Kunde ' + (customer.is_active ? 'deaktiviert' : 'aktiviert'));
                loadCustomers();
            } catch (e) {
                addToast('Fehler', 'error');
            }
        };

        const openConfirm = (customer) => {
            confirmCustomer.value = customer;
            showConfirmModal.value = true;
        };

        const cancelDelete = () => {
            showConfirmModal.value = false;
            confirmCustomer.value = null;
        };

        const confirmDelete = async () => {
            if (!confirmCustomer.value) return;
            try {
                await api.delete(CONFIG.ENDPOINTS.customers + '?id=' + confirmCustomer.value.id);
                addToast('Kunde gelöscht');
                loadCustomers();
            } catch (e) {
                addToast('Fehler beim Löschen', 'error');
            } finally {
                cancelDelete();
            }
        };

        const closeCredentialsModal = () => {
            showCredentialsModal.value = false;
            newCredentials.value = { email: '', error: null };
        };

        const copyEmail = () => {
            if (navigator.clipboard && newCredentials.value.email) {
                navigator.clipboard.writeText(newCredentials.value.email).then(() => addToast('E-Mail-Adresse kopiert'));
            }
        };

        const openOwnPasswordModal = () => {
            ownPasswordForm.value = { current_password: '', new_password: '', confirm_password: '' };
            showOwnPasswordModal.value = true;
        };

        const openOwnEmailModal = () => {
            ownEmailForm.value = { email: currentUser.value.email || '' };
            ownEmailError.value = '';
            showOwnEmailModal.value = true;
        };

        const closeOwnEmailModal = () => {
            showOwnEmailModal.value = false;
            ownEmailForm.value = { email: '' };
            ownEmailError.value = '';
        };

        const saveOwnEmail = async () => {
            const email = ownEmailForm.value.email?.trim();
            if (!email) {
                ownEmailError.value = 'E-Mail ist erforderlich';
                return;
            }
            try {
                const res = await api.patch(CONFIG.ENDPOINTS.auth.me, { email });
                currentUser.value.email = res.email || email;
                addToast('E-Mail geändert');
                closeOwnEmailModal();
            } catch (e) {
                const message = e.message || '';
                if (message.includes('E-Mail wird bereits verwendet')) {
                    ownEmailError.value = 'E-Mail wird bereits verwendet';
                } else if (message.includes('Subdomain wird bereits verwendet')) {
                    ownEmailError.value = 'Subdomain wird bereits verwendet';
                } else if (message.includes('Gültige E-Mail')) {
                    ownEmailError.value = 'Bitte gültige E-Mail eingeben';
                } else {
                    ownEmailError.value = 'Fehler beim Ändern der E-Mail';
                }
            }
        };

        const closeOwnPasswordModal = () => {
            showOwnPasswordModal.value = false;
            ownPasswordForm.value = { current_password: '', new_password: '', confirm_password: '' };
        };

        const saveOwnPassword = async () => {
            const { current_password, new_password, confirm_password } = ownPasswordForm.value;
            if (!current_password || !new_password) {
                addToast('Bitte alle Felder ausfüllen', 'error');
                return;
            }
            if (new_password.length < 8) {
                addToast('Neues Passwort muss mindestens 8 Zeichen haben', 'error');
                return;
            }
            if (new_password !== confirm_password) {
                addToast('Passwörter stimmen nicht überein', 'error');
                return;
            }
            try {
                await api.put(CONFIG.ENDPOINTS.auth.me, {
                    current_password,
                    new_password
                });
                addToast('Passwort geändert');
                closeOwnPasswordModal();
            } catch (e) {
                const message = e.message || '';
                if (message.includes('falsch')) {
                    addToast('Aktuelles Passwort ist falsch', 'error');
                } else {
                    addToast('Fehler beim Ändern des Passworts', 'error');
                }
            }
        };

        const logout = async () => {
            try {
                await api.post(CONFIG.ENDPOINTS.auth.logout);
            } catch (e) {
                console.error('Logout-Fehler:', e);
            } finally {
                clearAuth();
                navigateTo('#/');
            }
        };

        Vue.onMounted(() => {
            checkAuth({ redirectOnFailure: true });
            loadCustomers();
            loadUser();
        });

        Vue.onUnmounted(() => {
            toastTimers.forEach(timer => clearTimeout(timer));
            toastTimers.length = 0;
        });

        return {
            customers,
            toasts,
            currentUser,
            showCustomerModal,
            editingCustomer,
            customerForm,
            showConfirmModal,
            confirmCustomer,
            showCredentialsModal,
            newCredentials,
            showOwnPasswordModal,
            ownPasswordForm,
            showOwnEmailModal,
            ownEmailForm,
            ownEmailError,
            openOwnEmailModal,
            closeOwnEmailModal,
            saveOwnEmail,
            openCustomerModal,
            saveCustomer,
            savingCustomer,
            toggleCustomer,
            openConfirm,
            cancelDelete,
            confirmDelete,
            closeCredentialsModal,
            copyEmail,
            openOwnPasswordModal,
            closeOwnPasswordModal,
            saveOwnPassword,
            logout,
            navigateTo
        };
    },
    template: '#settings-template'
};
