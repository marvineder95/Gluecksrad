const DashboardPage = {
    components: { WheelComponent, SegmentImageEditor, ColorPicker },
    setup() {
        const isAuthenticated = Vue.ref(false);
        const user = Vue.ref({});
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
        // Aktiver Tab im Dashboard: 'design' | 'gewinne' | 'statistik'
        const activeTab = Vue.ref('design');
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
        const segmentImageOffsetX = Vue.ref(0);
        const segmentImageOffsetY = Vue.ref(0);
        const segmentImageRotation = Vue.ref(0);
        const segmentImageScale = Vue.ref(1);
        const showPasswordModal = Vue.ref(false);
        const passwordForm = Vue.ref({ current: '', new: '', confirm: '' });
        const passwordError = Vue.ref('');
        const showResetModal = Vue.ref(false);
        const leads = Vue.ref([]);
        const resetting = Vue.ref(false);
        const leadCaptureEnabled = Vue.computed(() => {
            return formSettings.value.lead_capture_enabled === '1' || formSettings.value.lead_capture_enabled === 1 || formSettings.value.lead_capture_enabled === true;
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

        const segmentEditorIndex = Vue.computed(() => {
            if (!editingSegment.value) return segments.value.length;
            const idx = segments.value.findIndex(s => s.id === editingSegment.value);
            return idx >= 0 ? idx : segments.value.length;
        });

        const segmentEditorCount = Vue.computed(() => {
            return editingSegment.value ? segments.value.length : segments.value.length + 1;
        });

        const canEditSegmentImage = Vue.computed(() => {
            return !!segmentForm.value.image;
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
                theme: sets.theme || CONFIG.DEFAULTS.theme,
                lead_capture_enabled: (sets.lead_capture_enabled === '1' || sets.lead_capture_enabled === 1 || sets.lead_capture_enabled === true) ? '1' : '0',
                winner_email_enabled: (sets.winner_email_enabled === '1' || sets.winner_email_enabled === 1 || sets.winner_email_enabled === true) ? '1' : '0',
                winner_email_subject: sets.winner_email_subject || CONFIG.DEFAULTS.winner_email_subject,
                winner_email_body: sets.winner_email_body || CONFIG.DEFAULTS.winner_email_body,
                winner_email_sender: sets.winner_email_sender || CONFIG.DEFAULTS.winner_email_sender,
                // Design-Tokens
                segment_fill_mode: sets.segment_fill_mode || CONFIG.DEFAULTS.segment_fill_mode,
                rim_style: sets.rim_style || CONFIG.DEFAULTS.rim_style,
                rim_color: sets.rim_color || CONFIG.DEFAULTS.rim_color,
                hub_color: sets.hub_color || CONFIG.DEFAULTS.hub_color,
                separator_color: sets.separator_color || CONFIG.DEFAULTS.separator_color,
                overlay_strength: sets.overlay_strength != null && sets.overlay_strength !== '' ? sets.overlay_strength : CONFIG.DEFAULTS.overlay_strength,
                label_enabled: (sets.label_enabled === '0' || sets.label_enabled === 0) ? '0' : '1',
                label_color: sets.label_color || CONFIG.DEFAULTS.label_color,
                label_scale: sets.label_scale != null && sets.label_scale !== '' ? sets.label_scale : CONFIG.DEFAULTS.label_scale,
                spin_button_text: sets.spin_button_text || CONFIG.DEFAULTS.spin_button_text,
                pointer_enabled: (sets.pointer_enabled === '0' || sets.pointer_enabled === 0) ? '0' : '1',
                pointer_color: sets.pointer_color || CONFIG.DEFAULTS.pointer_color,
                pointer_style: sets.pointer_style || CONFIG.DEFAULTS.pointer_style,
                rim_glow: (sets.rim_glow === '1' || sets.rim_glow === 1) ? '1' : '0',
                segment_gap: sets.segment_gap != null && sets.segment_gap !== '' ? sets.segment_gap : CONFIG.DEFAULTS.segment_gap,
                hub_style: sets.hub_style || CONFIG.DEFAULTS.hub_style,
                segment_palette: sets.segment_palette != null ? sets.segment_palette : CONFIG.DEFAULTS.segment_palette,
                background_mode: sets.background_mode || CONFIG.DEFAULTS.background_mode,
                background_color: sets.background_color || CONFIG.DEFAULTS.background_color
            };
            // autoRemoveBg bleibt lokal für das Segment-Modal, wird nicht mehr global gespeichert
        };

        const loadAll = async () => {
            try {
                const [statsData, segs, sets, leadsData] = await Promise.all([
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.stats),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.segments),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.settings),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.leads)
                ]);
                stats.value = statsData;
                segments.value = segs;
                settings.value = sets;
                leads.value = leadsData || [];
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
        const formatDateTime = (isoString) => {
            let dateStr = '';
            let timeStr = '';
            try {
                const date = new Date(isoString + 'Z');
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
                dateStr = isoString || '';
            }
            return { date: dateStr, time: timeStr };
        };

        const formattedSpins = Vue.computed(() => {
            const spins = stats.value.recent_spins || [];
            return spins.map(spin => ({
                ...spin,
                ...formatDateTime(spin.created_at)
            }));
        });

        const formattedLeads = Vue.computed(() => {
            return leads.value.map(lead => ({
                ...lead,
                ...formatDateTime(lead.created_at)
            }));
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

        // Live-Branding-Vorschau: Hintergrund, Schrift & Akzent aus dem aktuell
        // bearbeiteten (ungespeicherten) Formular – damit man sieht, was man ändert.
        const previewBrandStyle = Vue.computed(() => {
            const style = {
                fontFamily: formSettings.value.font_family || 'Montserrat',
                borderColor: formSettings.value.accent_color || 'transparent'
            };
            if (formSettings.value.background_mode === 'solid') {
                style.background = formSettings.value.background_color || '#0F172A';
                style.backgroundImage = 'none';
                return style;
            }
            let bg = '';
            if (formSettings.value.theme === 'custom') {
                bg = formSettings.value.background_image || '';
            } else {
                const t = THEMES.find(x => x.id === formSettings.value.theme);
                bg = t ? t.image : '';
            }
            style.backgroundImage = bg ? 'url("' + bg + '")' : 'none';
            return style;
        });

        // Rad-Designs als Presets (Basis, danach jeder Token frei überschreibbar)
        const designPresets = [
            { id: 'clean', name: 'Clean', swatch: '#E2E8F0', values: {
                segment_fill_mode: 'color', rim_style: 'solid', rim_color: '#E2E8F0',
                hub_color: '#CBD5E1', separator_color: '#FFFFFF', overlay_strength: 0,
                label_enabled: '1', label_color: '#1E293B', label_scale: 0.95,
                pointer_enabled: '1', pointer_color: '#64748B', pointer_style: 'triangle',
                rim_glow: '0', segment_gap: 0, hub_style: 'ring',
                background_mode: 'solid', background_color: '#F8FAFC',
                font_family: 'Inter', primary_color: '#1E293B', secondary_color: '#CBD5E1', accent_color: '#94A3B8' } },
            { id: 'tech', name: 'Tech', swatch: '#22D3EE', values: {
                segment_fill_mode: 'image', rim_style: 'solid', rim_color: '#22D3EE',
                hub_color: '#22D3EE', separator_color: '#334155', overlay_strength: 60,
                label_enabled: '1', label_color: '#E0F7FF', label_scale: 1,
                pointer_enabled: '1', pointer_color: '#EC4899', pointer_style: 'arrow',
                rim_glow: '1', segment_gap: 0, hub_style: 'glow',
                background_mode: 'solid', background_color: '#0B1120',
                font_family: 'Space Grotesk', primary_color: '#22D3EE', secondary_color: '#EC4899', accent_color: '#22D3EE' } },
            { id: 'glamour', name: 'Glamour', swatch: '#C8A866', values: {
                segment_fill_mode: 'color', rim_style: 'gold', rim_color: '#C8A866',
                hub_color: '#C8A866', separator_color: '#E8C87A', overlay_strength: 0,
                label_enabled: '1', label_color: '#FFFFFF', label_scale: 1,
                pointer_enabled: '1', pointer_color: '#E8C87A', pointer_style: 'diamond',
                rim_glow: '0', segment_gap: 0, hub_style: 'gem',
                background_mode: 'solid', background_color: '#2A0E14',
                font_family: 'Playfair Display', primary_color: '#E8C87A', secondary_color: '#7B2D3A', accent_color: '#E8C87A' } },
            { id: 'bubbly', name: 'Round / Bubbly', swatch: '#F472B6', values: {
                segment_fill_mode: 'color', rim_style: 'solid', rim_color: '#FBCFE8',
                hub_color: '#FFFFFF', separator_color: '#FFFFFF', overlay_strength: 0,
                label_enabled: '1', label_color: '#FFFFFF', label_scale: 1.1,
                pointer_enabled: '1', pointer_color: '#F472B6', pointer_style: 'tab',
                rim_glow: '0', segment_gap: 4, hub_style: 'star', segment_palette: '',
                background_mode: 'solid', background_color: '#FFF1F2',
                font_family: 'Fredoka', primary_color: '#F472B6', secondary_color: '#FDE68A', accent_color: '#FB7185' } },
            { id: 'editorial', name: 'Editorial Mono', swatch: '#111111', values: {
                segment_fill_mode: 'color', rim_style: 'solid', rim_color: '#111111',
                hub_color: '#111111', separator_color: '#111111', overlay_strength: 0,
                label_enabled: '1', label_color: 'auto', label_scale: 1,
                pointer_enabled: '1', pointer_color: '#EF4444', pointer_style: 'triangle',
                rim_glow: '0', segment_gap: 0, hub_style: 'dot',
                segment_palette: '#111111,#FFFFFF',
                background_mode: 'solid', background_color: '#FFFFFF',
                font_family: 'Montserrat', primary_color: '#111111', secondary_color: '#EF4444', accent_color: '#EF4444' } },
            { id: 'nature', name: 'Nature / Organic', swatch: '#7C8B5A', values: {
                segment_fill_mode: 'color', rim_style: 'solid', rim_color: '#9C8466',
                hub_color: '#6B4F3A', separator_color: '#F3EEE3', overlay_strength: 0,
                label_enabled: '1', label_color: 'auto', label_scale: 1,
                pointer_enabled: '1', pointer_color: '#6B4F3A', pointer_style: 'triangle',
                rim_glow: '0', segment_gap: 2, hub_style: 'dot',
                segment_palette: '#7C8B5A,#C97B5A,#D9C4A0,#A98467,#8A9A5B,#B98B5E',
                background_mode: 'solid', background_color: '#F5F0E6',
                font_family: 'Lora', primary_color: '#5A6B3A', secondary_color: '#C97B5A', accent_color: '#8A9A5B' } }
        ];
        const applyPreset = (preset) => {
            Object.assign(formSettings.value, preset.values);
            addToast('Design "' + preset.name + '" angewendet');
        };

        // Design-Tokens (Skin) für das Vorschaurad aus dem aktuellen Formular
        const previewSkin = Vue.computed(() => ({
            segment_fill_mode: formSettings.value.segment_fill_mode,
            rim_style: formSettings.value.rim_style,
            rim_color: formSettings.value.rim_color,
            hub_color: formSettings.value.hub_color,
            separator_color: formSettings.value.separator_color,
            overlay_strength: formSettings.value.overlay_strength,
            label_enabled: formSettings.value.label_enabled,
            label_color: formSettings.value.label_color,
            label_scale: formSettings.value.label_scale,
            pointer_enabled: formSettings.value.pointer_enabled,
            pointer_color: formSettings.value.pointer_color,
            pointer_style: formSettings.value.pointer_style,
            rim_glow: formSettings.value.rim_glow,
            segment_gap: formSettings.value.segment_gap,
            hub_style: formSettings.value.hub_style,
            segment_palette: formSettings.value.segment_palette
        }));

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
                    color: segment.color || CONFIG.DEFAULTS.segment_color,
                    image: segment.image || '',
                    removeBg: false
                };
                segmentImageOffsetX.value = parseFloat(segment.image_offset_x) || 0;
                segmentImageOffsetY.value = parseFloat(segment.image_offset_y) || 0;
                segmentImageRotation.value = parseFloat(segment.image_rotation) || 0;
                segmentImageScale.value = parseFloat(segment.image_scale) || 1;
            } else {
                editingSegment.value = null;
                segmentForm.value = {
                    name: '', win_text: '', weight: 100,
                    sort_order: segments.value.length, max_count: 1,
                    theme: 'neutral', color: CONFIG.DEFAULTS.segment_color,
                    image: '', removeBg: autoRemoveBg.value
                };
                segmentImageOffsetX.value = 0;
                segmentImageOffsetY.value = 0;
                segmentImageRotation.value = 0;
                segmentImageScale.value = 1;
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
                formData.append('color', segmentForm.value.color || CONFIG.DEFAULTS.segment_color);
                formData.append('remove_bg', segmentForm.value.removeBg ? '1' : '0');
                formData.append('image_offset_x', String(segmentImageOffsetX.value || 0));
                formData.append('image_offset_y', String(segmentImageOffsetY.value || 0));
                formData.append('image_rotation', String(segmentImageRotation.value || 0));
                formData.append('image_scale', String(segmentImageScale.value || 1));
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
            draggedIndex.value = null;

            // Neue Reihenfolge der Tabelle berechnen
            const segs = [...segmentStats.value];
            const [moved] = segs.splice(fromIndex, 1);
            segs.splice(index, 0, moved);

            // Optimistisch anzeigen: Tabelle UND Live-Vorschau (Rad) sofort umsortieren,
            // damit sichtbar ist, was sich ändert – nicht erst nach dem Server-Reload.
            if (stats.value) stats.value.segment_stats = segs;
            const orderById = new Map(segs.map((s, i) => [s.id, i]));
            segments.value = [...segments.value].sort((a, b) =>
                (orderById.has(a.id) ? orderById.get(a.id) : 999) -
                (orderById.has(b.id) ? orderById.get(b.id) : 999)
            );

            const orders = segs.map((seg, i) => ({ id: seg.id, sort_order: i }));
            try {
                await api.put(CONFIG.API_BASE + CONFIG.ENDPOINTS.segments, { orders });
                addToast('Reihenfolge aktualisiert');
                loadAll();
            } catch (e) {
                addToast('Fehler beim Sortieren', 'error');
                loadAll();
            }
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
                formData.append('lead_capture_enabled', formSettings.value.lead_capture_enabled === '1' ? '1' : '0');
                formData.append('winner_email_enabled', formSettings.value.winner_email_enabled === '1' ? '1' : '0');
                formData.append('winner_email_subject', formSettings.value.winner_email_subject);
                formData.append('winner_email_body', formSettings.value.winner_email_body);
                formData.append('winner_email_sender', formSettings.value.winner_email_sender);
                // Design-Tokens
                formData.append('segment_fill_mode', formSettings.value.segment_fill_mode);
                formData.append('rim_style', formSettings.value.rim_style);
                formData.append('rim_color', formSettings.value.rim_color);
                formData.append('hub_color', formSettings.value.hub_color);
                formData.append('separator_color', formSettings.value.separator_color);
                formData.append('overlay_strength', formSettings.value.overlay_strength);
                formData.append('label_enabled', formSettings.value.label_enabled === '0' ? '0' : '1');
                formData.append('label_color', formSettings.value.label_color);
                formData.append('label_scale', formSettings.value.label_scale);
                formData.append('spin_button_text', formSettings.value.spin_button_text);
                formData.append('pointer_enabled', formSettings.value.pointer_enabled === '0' ? '0' : '1');
                formData.append('pointer_color', formSettings.value.pointer_color);
                formData.append('pointer_style', formSettings.value.pointer_style);
                formData.append('rim_glow', formSettings.value.rim_glow === '1' ? '1' : '0');
                formData.append('segment_gap', formSettings.value.segment_gap);
                formData.append('hub_style', formSettings.value.hub_style);
                formData.append('segment_palette', formSettings.value.segment_palette || '');
                formData.append('background_mode', formSettings.value.background_mode);
                formData.append('background_color', formSettings.value.background_color);
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

        const deleteLead = async (id) => {
            if (!confirm('Lead wirklich löschen?')) return;
            try {
                await api.delete(CONFIG.API_BASE + CONFIG.ENDPOINTS.leads + '?id=' + id);
                addToast('Lead gelöscht');
                loadAll();
            } catch (e) {
                addToast('Fehler beim Löschen', 'error');
            }
        };

        const exportLeadsCSV = () => {
            const headers = ['Name', 'E-Mail', 'Gewinn', 'Einwilligung', 'Datum', 'Uhrzeit'];
            const rows = formattedLeads.value.map(lead => [
                lead.name || '',
                lead.email || '',
                lead.prize || '-',
                lead.consent_given ? 'Ja' : 'Nein',
                lead.date || '',
                lead.time || ''
            ]);

            const escapeCsv = (value) => {
                const str = String(value ?? '');
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            };

            const csvContent = [headers, ...rows]
                .map(row => row.map(escapeCsv).join(','))
                .join('\n');

            const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = 'leads_' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            addToast('CSV exportiert');
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
                clearAuth();
                navigateTo('#/');
            }
        };

        let authRedirectTimer = null;

        Vue.onMounted(() => {
            checkAuth().then(res => {
                isAuthenticated.value = res.authenticated;
                user.value = res.user || {};
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
            user,
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
            formattedLeads,
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
            navigateTo,

            getThemeImage,
            getThemeName,
            previewBrandStyle,
            previewSkin,
            designPresets,
            applyPreset,
            activeTab,
            segmentImageFile,
            segmentImageOffsetX,
            segmentImageOffsetY,
            segmentImageRotation,
            segmentImageScale,
            segmentEditorIndex,
            segmentEditorCount,
            canEditSegmentImage,
            onSegmentImageChange,
            segmentFormErrors,
            showPasswordModal,
            passwordForm,
            passwordError,
            openPasswordModal,
            changePassword,
            validateSegmentForm,
            showResetModal,
            resetting,
            leads,
            leadCaptureEnabled,
            onDragStart,
            onDragOver,
            onDragLeave,
            onDragEnd,
            onDrop,
            draggedIndex,
            dragOverIndex,
            deleteLead,
            exportLeadsCSV
        };
    },
    template: '#dashboard-template'
};
