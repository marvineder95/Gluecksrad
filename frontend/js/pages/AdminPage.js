const AdminPage = {
    components: { WheelComponent },
    setup() {
        const isAuthenticated = Vue.ref(false);
        const stats = Vue.ref({
            total_spins: 0,
            total_spins_limit: CONFIG.DEFAULTS.total_spins_limit,
            remaining_spins: 0,
            progress_percent: 0,
            campaign_status: CONFIG.DEFAULTS.campaign_status,
            active_segments: 0,
            segment_stats: []
        });
        const segments = Vue.ref([]);
        const settings = Vue.ref({});
        const toasts = Vue.ref([]);
        const previewRotation = Vue.ref(0);
        const testSpinning = Vue.ref(false);
        const showSegmentModal = Vue.ref(false);
        const showThemeDropdown = Vue.ref(false);
        const editingSegment = Vue.ref(null);
        const segmentForm = Vue.ref({
            name: '', win_text: '', weight: 100,
            sort_order: 0, max_count: 1, theme: 'neutral', image: '', removeBg: false
        });
        const segmentImageFile = Vue.ref(null);
        const logoFile = Vue.ref(null);
        const bgFile = Vue.ref(null);
        const segmentFormErrors = Vue.ref({});
        const showPasswordModal = Vue.ref(false);
        const passwordForm = Vue.ref({ current: '', new: '', confirm: '' });
        const passwordError = Vue.ref('');
        const showQrModal = Vue.ref(false);
        const showResetModal = Vue.ref(false);
        const resetting = Vue.ref(false);
        const qrCodeUrl = Vue.computed(() => {
            const base = window.location.origin + window.location.pathname;
            return 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(base + '#/event');
        });

        // Form-bound settings mit zentralen Defaults
        const formSettings = Vue.ref({ ...CONFIG.DEFAULTS });
        const themes = Vue.ref(THEMES);

        // Segment-Themes als Array für Dropdown
        const segmentThemes = Vue.computed(() => {
            return Object.entries(SEGMENT_THEMES).map(([id, theme]) => ({
                id,
                ...theme
            }));
        });

        const autoRemoveBg = Vue.ref(false);

        const syncFormSettings = () => {
            const sets = settings.value;
            formSettings.value = {
                campaign_status: sets.campaign_status || CONFIG.DEFAULTS.campaign_status,
                primary_color: sets.primary_color || CONFIG.DEFAULTS.primary_color,
                secondary_color: sets.secondary_color || CONFIG.DEFAULTS.secondary_color,
                accent_color: sets.accent_color || CONFIG.DEFAULTS.accent_color,
                font_family: sets.font_family || CONFIG.DEFAULTS.font_family,
                wheel_title: sets.wheel_title || CONFIG.DEFAULTS.wheel_title,
                logo: sets.logo || '',
                background_image: sets.background_image || '',
                theme: sets.theme || CONFIG.DEFAULTS.theme
            };
            // autoRemoveBg bleibt lokal für das Segment-Modal, wird nicht mehr global gespeichert
        };

        const loadAll = async () => {
            try {
                const [statsData, segs, sets] = await Promise.all([
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.stats),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.segments),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.settings)
                ]);
                stats.value = statsData;
                segments.value = segs;
                settings.value = sets;
                syncFormSettings();
            } catch (e) {
                console.error('Fehler beim Laden:', e);
            }
        };

        const toastTimers = [];

        const addToast = (message, type = 'success') => {
            const id = Date.now();
            toasts.value.push({ id, msg: message, type });
            const timer = setTimeout(() => {
                toasts.value = toasts.value.filter(t => t.id !== id);
            }, CONFIG.ANIMATION.toast_duration_ms);
            toastTimers.push(timer);
        };

        // KPI computed
        const campaignStatusLabel = Vue.computed(() => {
            return CONFIG.CAMPAIGN_STATUS[stats.value.campaign_status]?.label || stats.value.campaign_status;
        });

        // campaignDate entfernt – Kampagnenstatus-KPI wurde entfernt

        const segmentStats = Vue.computed(() => stats.value.segment_stats || []);

        const totalMaxCount = Vue.computed(() => {
            return segmentStats.value.reduce((sum, seg) => sum + (seg.max_count > 0 ? seg.max_count : 0), 0);
        });
        const totalUsedCount = Vue.computed(() => {
            return segmentStats.value.reduce((sum, seg) => sum + seg.used_count, 0);
        });
        const totalRemaining = Vue.computed(() => {
            return segmentStats.value.reduce((sum, seg) => sum + (seg.remaining !== null ? seg.remaining : 0), 0);
        });

        const formatNumber = (n) => {
            if (n === undefined || n === null) return '0';
            return n.toLocaleString('de-DE');
        };

        // Drehverlauf formatieren (österreichische Zeit)
        const formattedSpins = Vue.computed(() => {
            const spins = stats.value.recent_spins || [];
            return spins.map(spin => {
                let dateStr = '';
                let timeStr = '';
                try {
                    // '+Z' erzwingt UTC-Interpretation, damit toLocaleTimeString korrekt rechnet
                    const date = new Date(spin.created_at + 'Z');
                    dateStr = date.toLocaleDateString('de-AT', {
                        timeZone: 'Europe/Vienna',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                    timeStr = date.toLocaleTimeString('de-AT', {
                        timeZone: 'Europe/Vienna',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                } catch (e) {
                    dateStr = spin.created_at || '';
                }
                return {
                    ...spin,
                    date: dateStr,
                    time: timeStr
                };
            });
        });

        // Test spin
        const testSpin = async () => {
            if (testSpinning.value) return;
            testSpinning.value = true;
            try {
                const result = await api.post(CONFIG.API_BASE + CONFIG.ENDPOINTS.spin + '?test=1');
                if (result.error) {
                    addToast(result.error, 'error');
                    testSpinning.value = false;
                    return;
                }

                runSpinAnimation({
                    rotationRef: previewRotation,
                    winnerIndex: result.winner_index,
                    totalSegments: result.total_segments,
                    onComplete: () => {
                        testSpinning.value = false;
                        setTimeout(() => {
                            loadAll();
                        }, CONFIG.ANIMATION.test_spin_refresh_delay_ms);
                    }
                });
            } catch (e) {
                testSpinning.value = false;
                addToast('Fehler bei Test-Drehung', 'error');
            }
        };

        // Campaign reset
        const resetCampaign = async () => {
            if (resetting.value) return;
            resetting.value = true;
            try {
                await api.post(CONFIG.API_BASE + '/campaign.php?action=reset', {});
                addToast('Kampagne zurückgesetzt', 'success');
                showResetModal.value = false;
                loadAll();
            } catch (e) {
                addToast('Fehler beim Zurücksetzen', 'error');
            } finally {
                resetting.value = false;
            }
        };

        // Theme helpers for table display
        const getThemeImage = (themeKey) => {
            return SEGMENT_THEMES[themeKey]?.image || '';
        };
        const getThemeName = (themeKey) => {
            return SEGMENT_THEMES[themeKey]?.name || themeKey || '';
        };

        // Segment modal
        const openSegmentModal = (segment) => {
            segmentImageFile.value = null;
            if (segment) {
                editingSegment.value = segment.id;
                segmentForm.value = {
                    name: segment.name,
                    win_text: segment.win_text || '',
                    weight: segment.weight,
                    sort_order: segment.sort_order,
                    max_count: segment.max_count || 0,

                    theme: segment.theme || 'neutral',
                    image: segment.image || '',
                    removeBg: false
                };
            } else {
                editingSegment.value = null;
                segmentForm.value = {
                    name: '', win_text: '', weight: 100,
                    sort_order: segments.value.length, max_count: 1,
                    theme: 'neutral', image: '', removeBg: autoRemoveBg.value
                };
            }
            showSegmentModal.value = true;
        };

        const onSegmentImageChange = (event) => {
            segmentImageFile.value = event.target.files[0] || null;
            if (segmentImageFile.value) {
                segmentForm.value.image = URL.createObjectURL(segmentImageFile.value);
            }
        };

        const validateSegmentForm = () => {
            const errors = {};
            const form = segmentForm.value;
            if (!form.name || form.name.trim().length === 0) {
                errors.name = 'Name ist erforderlich';
            } else if (form.name.trim().length > 100) {
                errors.name = 'Name darf max. 100 Zeichen haben';
            }
            if (form.sort_order === '' || form.sort_order === null || form.sort_order === undefined) {
                errors.sort_order = 'Sortierung ist erforderlich';
            } else if (parseInt(form.sort_order) < 0) {
                errors.sort_order = 'Sortierung darf nicht negativ sein';
            }
            if (form.max_count === '' || form.max_count === null || form.max_count === undefined) {
                errors.max_count = 'Anzahl in Kampagne ist erforderlich';
            } else if (parseInt(form.max_count) < 1) {
                errors.max_count = 'Anzahl in Kampagne muss mindestens 1 sein';
            }
            segmentFormErrors.value = errors;
            return Object.keys(errors).length === 0;
        };

        const saveSegment = async () => {
            if (!validateSegmentForm()) {
                addToast('Bitte korrigiere die markierten Felder', 'error');
                return;
            }
            try {
                const formData = new FormData();
                formData.append('name', segmentForm.value.name);
                formData.append('win_text', segmentForm.value.win_text || '');
                formData.append('weight', segmentForm.value.weight);
                formData.append('sort_order', segmentForm.value.sort_order);
                formData.append('max_count', segmentForm.value.max_count);
                formData.append('theme', segmentForm.value.theme || 'neutral');
                formData.append('remove_bg', segmentForm.value.removeBg ? '1' : '0');
                if (segmentImageFile.value) {
                    formData.append('segment_image', segmentImageFile.value);
                } else if (segmentForm.value.image && !segmentForm.value.image.startsWith('blob:')) {
                    formData.append('existing_image', segmentForm.value.image);
                }

                const endpoint = editingSegment.value
                    ? CONFIG.API_BASE + CONFIG.ENDPOINTS.segments + '?id=' + editingSegment.value
                    : CONFIG.API_BASE + CONFIG.ENDPOINTS.segments;

                await api.postForm(endpoint, formData);
                addToast(editingSegment.value ? 'Segment aktualisiert' : 'Segment erstellt');
                showSegmentModal.value = false;
                segmentImageFile.value = null;
                loadAll();
            } catch (e) {
                const msg = e.message?.includes('HTTP') ? e.message.split(':').pop().trim() : 'Fehler beim Speichern';
                addToast(msg, 'error');
            }
        };

        const deleteSegment = async (id) => {
            if (!confirm('Segment wirklich löschen?')) return;
            try {
                await api.delete(CONFIG.API_BASE + CONFIG.ENDPOINTS.segments + '?id=' + id);
                addToast('Segment gelöscht');
                loadAll();
            } catch (e) {
                addToast('Fehler beim Löschen', 'error');
            }
        };

        // Drag & Drop for segment reordering
        const draggedIndex = Vue.ref(null);
        const dragOverIndex = Vue.ref(null);

        const onDragStart = (event, index) => {
            draggedIndex.value = index;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
        };

        const onDragOver = (event, index) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (draggedIndex.value === null || draggedIndex.value === index) {
                dragOverIndex.value = null;
                return;
            }
            dragOverIndex.value = index;
        };

        const onDragLeave = () => {
            dragOverIndex.value = null;
        };

        const onDragEnd = () => {
            draggedIndex.value = null;
            dragOverIndex.value = null;
        };

        const onDrop = async (event, index) => {
            event.preventDefault();
            dragOverIndex.value = null;
            if (draggedIndex.value === null || draggedIndex.value === index) return;
            const fromIndex = draggedIndex.value;
            const segs = [...segmentStats.value];
            const [moved] = segs.splice(fromIndex, 1);
            segs.splice(index, 0, moved);

            // Update sort_order for all
            const orders = segs.map((seg, i) => ({ id: seg.id, sort_order: i }));

            try {
                await api.put(CONFIG.API_BASE + CONFIG.ENDPOINTS.segments, { orders });
                addToast('Reihenfolge aktualisiert');
                loadAll();
            } catch (e) {
                addToast('Fehler beim Sortieren', 'error');
            }
            draggedIndex.value = null;
        };

        // Branding uploads
        const onLogoChange = (event) => {
            logoFile.value = event.target.files[0] || null;
            if (logoFile.value) {
                formSettings.value.logo = URL.createObjectURL(logoFile.value);
            }
        };

        const onBgChange = (event) => {
            bgFile.value = event.target.files[0] || null;
            if (bgFile.value) {
                formSettings.value.background_image = URL.createObjectURL(bgFile.value);
            }
        };

        // Save all
        const saveAll = async () => {
            try {
                const formData = new FormData();
                formData.append('campaign_status', formSettings.value.campaign_status);
                formData.append('primary_color', formSettings.value.primary_color);
                formData.append('secondary_color', formSettings.value.secondary_color);
                formData.append('accent_color', formSettings.value.accent_color);
                formData.append('font_family', formSettings.value.font_family);
                formData.append('wheel_title', formSettings.value.wheel_title);
                formData.append('theme', formSettings.value.theme);
                if (logoFile.value) formData.append('logo', logoFile.value);
                if (bgFile.value) formData.append('background_image', bgFile.value);

                await api.postForm(CONFIG.API_BASE + CONFIG.ENDPOINTS.settings, formData);
                addToast('Einstellungen gespeichert');
                logoFile.value = null;
                bgFile.value = null;
                loadAll();
            } catch (e) {
                addToast('Fehler beim Speichern', 'error');
            }
        };

        const goToWebsite = () => {
            navigateTo('#/event');
        };

        const openPasswordModal = () => {
            passwordForm.value = { current: '', new: '', confirm: '' };
            passwordError.value = '';
            showPasswordModal.value = true;
        };

        const changePassword = async () => {
            passwordError.value = '';
            const { current, new: newPw, confirm } = passwordForm.value;
            if (!current || !newPw || !confirm) {
                passwordError.value = 'Alle Felder sind erforderlich';
                return;
            }
            if (newPw.length < 8) {
                passwordError.value = 'Neues Passwort muss mindestens 8 Zeichen haben';
                return;
            }
            if (newPw !== confirm) {
                passwordError.value = 'Passwörter stimmen nicht überein';
                return;
            }
            try {
                const res = await api.put(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth, {
                    current_password: current,
                    new_password: newPw
                });
                if (res.success) {
                    addToast('Passwort erfolgreich geändert');
                    showPasswordModal.value = false;
                } else {
                    passwordError.value = res.error || 'Fehler beim Ändern';
                }
            } catch (e) {
                passwordError.value = 'Netzwerkfehler';
            }
        };

        const logout = async () => {
            try {
                await api.delete(CONFIG.API_BASE + CONFIG.ENDPOINTS.auth);
            } catch (e) {
                console.error('Logout-Fehler:', e);
            } finally {
                localStorage.removeItem('admin_token');
                navigateTo('#/login');
            }
        };

        let authRedirectTimer = null;

        Vue.onMounted(() => {
            checkAuth().then(res => {
                isAuthenticated.value = res.authenticated;
                if (!res.authenticated) {
                    authRedirectTimer = setTimeout(() => {
                        if (!isAuthenticated.value) {
                            navigateTo('#/login');
                        }
                    }, CONFIG.ANIMATION.auth_redirect_delay_ms);
                }
            });
            loadAll();
        });

        Vue.onUnmounted(() => {
            if (authRedirectTimer) clearTimeout(authRedirectTimer);
            toastTimers.forEach(timer => clearTimeout(timer));
            toastTimers.length = 0;
        });

        return {
            isAuthenticated,
            stats,
            segments,
            formSettings,
            autoRemoveBg,
            toasts,
            previewRotation,
            testSpinning,
            showSegmentModal,
            showThemeDropdown,
            editingSegment,
            segmentForm,
            SEGMENT_THEMES,
            campaignStatusLabel,
            segmentStats,
            totalMaxCount,
            totalUsedCount,
            totalRemaining,
            formatNumber,
            formattedSpins,
            testSpin,
            resetCampaign,
            openSegmentModal,
            saveSegment,
            deleteSegment,
            themes,
            segmentThemes,
            onLogoChange,
            onBgChange,
            saveAll,
            goToWebsite,
            logout,

            getThemeImage,
            getThemeName,
            segmentImageFile,
            onSegmentImageChange,
            segmentFormErrors,
            showPasswordModal,
            passwordForm,
            passwordError,
            openPasswordModal,
            changePassword,
            validateSegmentForm,
            showQrModal,
            showResetModal,
            resetting,
            qrCodeUrl,
            onDragStart,
            onDragOver,
            onDragLeave,
            onDragEnd,
            onDrop,
            draggedIndex,
            dragOverIndex
        };
    },
    template: '#admin-template'
};
