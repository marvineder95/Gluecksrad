const EventPage = {
    components: { WheelComponent },
    setup() {
        const segments = Vue.ref([]);
        const settings = Vue.ref({});
        const rotation = Vue.ref(0);
        const spinning = Vue.ref(false);
        const showWin = Vue.ref(false);
        const winner = Vue.ref(null);
        const campaignEnded = Vue.ref(false);
        const confettiCanvas = Vue.ref(null);
        const leadCaptureEnabled = Vue.ref(false);
        const showLeadForm = Vue.ref(false);
        const leadForm = Vue.ref({ name: '', email: '' });
        const consentGiven = Vue.ref(false);
        const currentLeadId = Vue.ref(null);
        const leadSkipped = Vue.ref(false);
        const leadError = Vue.ref('');
        let confetti = null;
        const secretClicks = Vue.ref(0);
        let secretTimer = null;
        let winTimer = null;
        const wheelSize = Vue.ref(600);
        const wheelAreaRef = Vue.ref(null);

        const updateWheelSize = () => {
            if (!wheelAreaRef.value) return;
            const rect = wheelAreaRef.value.getBoundingClientRect();
            // Generous safety margin for: padding, SVG rim overflow, marker, and gold border
            const safetyMargin = 80;
            const maxSize = Math.min(rect.width, rect.height) - safetyMargin;
            wheelSize.value = Math.max(280, Math.min(Math.floor(maxSize), 1400));
        };

        const loadData = async () => {
            try {
                const [segs, sets, statsData] = await Promise.all([
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.segments),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.settings),
                    api.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.stats)
                ]);
                segments.value = segs;
                settings.value = sets;
                campaignEnded.value = statsData.remaining_spins <= 0 || statsData.campaign_status === 'ended';
                leadCaptureEnabled.value = sets.lead_capture_enabled === '1' || sets.lead_capture_enabled === 1 || sets.lead_capture_enabled === true;
            } catch (e) {
                console.error('Fehler beim Laden:', e);
            }
        };

        const handleKeydown = (event) => {
            // Keine Reaktion, wenn ein Eingabefeld fokussiert ist (Lead-Formular o.ä.)
            const activeTag = document.activeElement?.tagName?.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
                return;
            }

            // System-/Modifier-Tasten ignorieren
            if (['Escape', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(event.key)) {
                return;
            }
            if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(event.key)) {
                return;
            }
            // Browser-Shortcuts nicht blockieren (z.B. Strg+R, Cmd+T)
            if (event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }

            event.preventDefault();

            // Gewinnbildschirm schließen, falls offen
            if (showWin.value) {
                nextRound();
                return;
            }

            if (!spinning.value) spin();
        };

        const handleSecretClick = () => {
            secretClicks.value++;
            if (secretTimer) clearTimeout(secretTimer);
            secretTimer = setTimeout(() => {
                secretClicks.value = 0;
            }, CONFIG.ANIMATION.secret_click_timeout_ms);
            if (secretClicks.value >= CONFIG.ANIMATION.secret_click_threshold) {
                secretClicks.value = 0;
                navigateTo('#/dashboard');
            }
        };

        const submitLead = async (skip = false) => {
            leadError.value = '';
            if (!skip) {
                if (!leadForm.value.name.trim() || !leadForm.value.email.trim()) {
                    leadError.value = 'Bitte Name und E-Mail eingeben';
                    return false;
                }
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(leadForm.value.email.trim())) {
                    leadError.value = 'Bitte eine gültige E-Mail-Adresse eingeben';
                    return false;
                }
                if (!consentGiven.value) {
                    leadError.value = 'Bitte stimme den Teilnahmebedingungen zu.';
                    return false;
                }
                try {
                    const result = await api.post(CONFIG.API_BASE + CONFIG.ENDPOINTS.leads, {
                        name: leadForm.value.name.trim(),
                        email: leadForm.value.email.trim(),
                        consent_given: true
                    });
                    currentLeadId.value = result.id;
                } catch (e) {
                    leadError.value = 'Fehler beim Speichern. Bitte versuche es erneut.';
                    return false;
                }
            }
            showLeadForm.value = false;
            spin(true);
            return true;
        };

        const skipLead = () => {
            leadSkipped.value = true;
            showLeadForm.value = false;
            spin(true);
        };

        const spin = async (fromLeadForm = false) => {
            if (spinning.value || showWin.value || campaignEnded.value) return;

            if (leadCaptureEnabled.value && !currentLeadId.value && !leadSkipped.value && !fromLeadForm) {
                console.log('opening lead form');
                showLeadForm.value = true;
                return;
            }

            spinning.value = true;
            showWin.value = false;
            SoundFX.playSpin();

            try {
                const payload = currentLeadId.value ? { lead_id: currentLeadId.value } : {};
                const result = await api.post(CONFIG.API_BASE + CONFIG.ENDPOINTS.spin, payload);
                if (result.error) {
                    spinning.value = false;
                    campaignEnded.value = result.code === 'campaign_ended';
                    loadData();
                    return;
                }

                winner.value = result.winner;

                runSpinAnimation({
                    rotationRef: rotation,
                    winnerIndex: result.winner_index,
                    totalSegments: result.total_segments,
                    onComplete: () => {
                        spinning.value = false;
                        setTimeout(() => {
                            showWin.value = true;
                            SoundFX.playWin();
                            if (confetti) confetti.start();
                            // Gewinnbildschirm nach 5 Sekunden automatisch schließen
                            if (winTimer) clearTimeout(winTimer);
                            winTimer = setTimeout(() => {
                                if (showWin.value) nextRound();
                            }, 5000);
                        }, CONFIG.ANIMATION.win_overlay_delay_ms);
                        // Daten neu laden, um remaining spins zu aktualisieren
                        loadData();
                    }
                });
            } catch (e) {
                spinning.value = false;
                console.error('Spin-Fehler:', e);
                loadData();
            }
        };

        const nextRound = () => {
            if (winTimer) {
                clearTimeout(winTimer);
                winTimer = null;
            }
            showWin.value = false;
            if (confetti) confetti.stop();
            // Lead-Formular für nächste Runde zurücksetzen, wenn aktiviert
            if (leadCaptureEnabled.value) {
                currentLeadId.value = null;
                leadSkipped.value = false;
                leadForm.value = { name: '', email: '' };
                consentGiven.value = false;
                showLeadForm.value = false;
            }
        };

        const bgStyle = Vue.computed(() => {
            const s = settings.value || {};
            if (s.background_mode === 'solid') {
                return { backgroundColor: s.background_color || '#0F172A', backgroundImage: 'none', opacity: 1 };
            }
            return getBackgroundStyle(s);
        });
        const logoUrl = Vue.computed(() => getLogoUrl(settings.value));

        // Design-Tokens (Skin) für das echte Kiosk-Rad
        const skin = Vue.computed(() => {
            const s = settings.value || {};
            return {
                segment_fill_mode: s.segment_fill_mode, rim_style: s.rim_style, rim_color: s.rim_color,
                hub_color: s.hub_color, separator_color: s.separator_color, overlay_strength: s.overlay_strength,
                label_enabled: s.label_enabled, label_color: s.label_color, label_scale: s.label_scale,
                pointer_enabled: s.pointer_enabled, pointer_color: s.pointer_color, pointer_style: s.pointer_style,
                rim_glow: s.rim_glow, segment_gap: s.segment_gap, segment_palette: s.segment_palette,
                hub_enabled: s.hub_enabled, hub_type: s.hub_type, hub_shape: s.hub_shape,
                hub_text: s.hub_text, hub_text_color: s.hub_text_color, hub_size: s.hub_size
            };
        });
        const wheelFont = Vue.computed(() => settings.value.font_family || 'Montserrat');
        const wheelAccent = Vue.computed(() => settings.value.accent_color || '');
        const buttonStyle = Vue.computed(() => {
            const s = settings.value || {};
            const style = { fontFamily: s.font_family || 'Montserrat' };
            if (s.primary_color) style.background = s.primary_color;
            return style;
        });
        const buttonText = Vue.computed(() => settings.value.spin_button_text || 'DREHEN');

        Vue.onMounted(() => {
            checkAuth({ redirectOnFailure: true });
            loadData();
            if (confettiCanvas.value) {
                confetti = new Confetti(confettiCanvas.value);
            }
            window.addEventListener('keydown', handleKeydown);
            Vue.nextTick(() => {
                updateWheelSize();
            });
            window.addEventListener('resize', updateWheelSize);
        });

        Vue.onUnmounted(() => {
            window.removeEventListener('keydown', handleKeydown);
            window.removeEventListener('resize', updateWheelSize);
            if (secretTimer) clearTimeout(secretTimer);
            if (winTimer) clearTimeout(winTimer);
            if (confetti) confetti.destroy();
        });

        return {
            segments, settings, rotation, spinning, showWin, winner, campaignEnded,
            confettiCanvas, spin, nextRound, bgStyle, handleSecretClick, logoUrl,
            skin, wheelFont, wheelAccent, buttonStyle, buttonText,
            wheelSize, wheelAreaRef, navigateTo,
            leadCaptureEnabled, showLeadForm, leadForm, leadError,
            submitLead, skipLead, currentLeadId, leadSkipped, consentGiven
        };
    },
    template: '#event-template'
};
