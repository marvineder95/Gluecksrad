const EventPage = {
    components: { WheelComponent },
    setup() {
        // === KAMPAGNEN-ID aus URL lesen ===
        // Die App nutzt Hash-Routing (#/event). campaign_id kann in zwei Formen auftauchen:
        //   1. Vor dem Hash: /index.html?campaign_id=1#/event  (window.location.search)
        //   2. Nach dem Hash: /index.html#/event?campaign_id=1  (im Hash-String)
        const getCampaignIdFromUrl = () => {
            // Erst in window.location.search suchen
            const searchParams = new URLSearchParams(window.location.search);
            if (searchParams.get('campaign_id')) return searchParams.get('campaign_id');
            // Dann im Hash-Teil suchen (alles nach dem ersten '?')
            const hash = window.location.hash || '';
            const qIdx = hash.indexOf('?');
            if (qIdx !== -1) {
                const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
                if (hashParams.get('campaign_id')) return hashParams.get('campaign_id');
            }
            return null;
        };

        const campaignId = getCampaignIdFromUrl();
        const noCampaign = Vue.ref(!campaignId);

        // Helper: append campaign_id to url
        const withCid = (url) => {
            if (!campaignId) return url;
            const sep = url.includes('?') ? '&' : '?';
            return url + sep + 'campaign_id=' + campaignId;
        };

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
        const leadData = Vue.ref({});
        const activeLeadFields = Vue.computed(() => {
            let fields = [];
            try { const a = JSON.parse(settings.value.lead_fields || '[]'); if (Array.isArray(a)) fields = a; } catch (e) {}
            const enabled = fields.filter(f => f.enabled);
            if (enabled.length === 0) {
                return [
                    { key: 'name', label: 'Name', type: 'text', multiline: false, required: true },
                    { key: 'email', label: 'E-Mail', type: 'text', multiline: false, required: true }
                ];
            }
            return enabled;
        });
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
            const safetyMargin = 80;
            const maxSize = Math.min(rect.width, rect.height) - safetyMargin;
            wheelSize.value = Math.max(280, Math.min(Math.floor(maxSize), 1400));
        };

        const loadData = async () => {
            if (!campaignId) return;
            try {
                const [segs, sets, statsData] = await Promise.all([
                    api.get(withCid(CONFIG.ENDPOINTS.segments)),
                    api.get(withCid(CONFIG.ENDPOINTS.settings)),
                    api.get(withCid(CONFIG.ENDPOINTS.stats))
                ]);
                segments.value = segs;
                // Fehlende Keys mit Defaults auffüllen, sonst überschreiben
                // undefined-Werte die Skin-Defaults (schwarzes Rad bei dünnem Settings-Satz).
                settings.value = Object.assign({}, CONFIG.DEFAULTS, sets);
                campaignEnded.value = statsData.remaining_spins <= 0 || statsData.campaign_status === 'ended';
                leadCaptureEnabled.value = sets.lead_capture_enabled === '1' || sets.lead_capture_enabled === 1 || sets.lead_capture_enabled === true;
                if (leadCaptureEnabled.value && !currentLeadId.value && !leadSkipped.value && !campaignEnded.value) {
                    showLeadForm.value = true;
                }
            } catch (e) {
                console.error('Fehler beim Laden:', e);
            }
        };

        const handleKeydown = (event) => {
            const activeTag = document.activeElement?.tagName?.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
                return;
            }
            if (['Escape', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(event.key)) {
                return;
            }
            if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(event.key)) {
                return;
            }
            if (event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }
            event.preventDefault();
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
                const fields = activeLeadFields.value;
                const val = (k) => (leadData.value[k] != null ? String(leadData.value[k]).trim() : '');
                for (const f of fields) {
                    if (f.required && !val(f.key)) {
                        leadError.value = 'Bitte „' + f.label + '" ausfüllen.';
                        return false;
                    }
                }
                const emailField = fields.find(f => f.key === 'email' || /mail/i.test(f.label));
                if (emailField && val(emailField.key)) {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(val(emailField.key))) {
                        leadError.value = 'Bitte eine gültige E-Mail-Adresse eingeben.';
                        return false;
                    }
                }
                if (!consentGiven.value) {
                    leadError.value = 'Bitte stimme den Teilnahmebedingungen zu.';
                    return false;
                }
                const derivedEmail = emailField ? val(emailField.key) : '';
                let derivedName = val('name');
                if (!derivedName) derivedName = (val('vorname') + ' ' + val('nachname')).trim();
                if (!derivedName) derivedName = derivedEmail || 'Gast';
                const dataOut = {};
                fields.forEach(f => { dataOut[f.label] = val(f.key); });
                try {
                    const result = await api.post(withCid(CONFIG.ENDPOINTS.leads), {
                        name: derivedName,
                        email: derivedEmail,
                        consent_given: true,
                        data: dataOut
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

        const spin = async (fromLeadForm = false, animOverride = null) => {
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
                const result = await api.post(withCid(CONFIG.ENDPOINTS.spin), payload);
                if (result.error) {
                    spinning.value = false;
                    campaignEnded.value = result.code === 'campaign_ended';
                    loadData();
                    return;
                }

                winner.value = result.winner;

                frozenSegments.value = displaySegments.value.slice();

                runSpinAnimation({
                    rotationRef: rotation,
                    winnerIndex: result.winner_index,
                    totalSegments: result.total_segments,
                    duration: animOverride ? animOverride.duration : undefined,
                    extraRotations: animOverride ? animOverride.extraRotations : undefined,
                    direction: animOverride ? animOverride.direction : undefined,
                    onComplete: () => {
                        spinning.value = false;
                        setTimeout(() => {
                            showWin.value = true;
                            SoundFX.playWin();
                            if (confetti) confetti.start();
                            if (winTimer) clearTimeout(winTimer);
                            winTimer = setTimeout(() => {
                                if (showWin.value) {
                                    (winner.value && parseInt(winner.value.is_respin)) ? respinAgain() : nextRound();
                                }
                            }, 5000);
                        }, CONFIG.ANIMATION.win_overlay_delay_ms);
                        loadData();
                    }
                });
            } catch (e) {
                spinning.value = false;
                console.error('Spin-Fehler:', e);
                loadData();
            }
        };

        const respinAgain = () => {
            if (winTimer) { clearTimeout(winTimer); winTimer = null; }
            showWin.value = false;
            if (confetti) confetti.stop();
            frozenSegments.value = null;
            spin(true);
        };

        const spinTrigger = Vue.computed(() => settings.value.spin_trigger || 'button');
        let dragState = null;

        const wheelAngleAt = (clientX, clientY) => {
            const el = wheelAreaRef.value;
            if (!el) return 0;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            return Math.atan2(clientY - cy, clientX - cx) * 180 / Math.PI;
        };

        const onWheelClick = () => {
            if (spinTrigger.value !== 'hub') return;
            if (spinning.value || showWin.value || campaignEnded.value) return;
            spin();
        };

        const canGesture = () =>
            spinTrigger.value === 'swipe' && !spinning.value && !showWin.value &&
            !campaignEnded.value && !showLeadForm.value;

        const onWheelPointerDown = (e) => {
            if (!canGesture()) return;
            const ang = wheelAngleAt(e.clientX, e.clientY);
            dragState = { lastAngle: ang, lastTime: performance.now(), velocity: 0, moved: 0 };
            try { e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
        };

        const onWheelPointerMove = (e) => {
            if (!dragState) return;
            const ang = wheelAngleAt(e.clientX, e.clientY);
            let d = ang - dragState.lastAngle;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            const now = performance.now();
            const dt = Math.max(1, now - dragState.lastTime);
            rotation.value += d;
            dragState.moved += Math.abs(d);
            dragState.velocity = 0.7 * dragState.velocity + 0.3 * (d / dt);
            dragState.lastAngle = ang;
            dragState.lastTime = now;
        };

        const onWheelPointerUp = () => {
            if (!dragState) return;
            const vSigned = dragState.velocity;
            const v = Math.abs(vSigned);
            const moved = dragState.moved;
            dragState = null;
            if (moved < 10) return;
            const extraRotations = Math.min(9, Math.max(2, 2 + v * 3));
            const duration = Math.min(8500, Math.max(3500, 7000 - v * 900));
            const direction = vSigned >= 0 ? 1 : -1;
            spin(false, { extraRotations, duration, direction });
        };

        const nextRound = () => {
            if (winTimer) {
                clearTimeout(winTimer);
                winTimer = null;
            }
            showWin.value = false;
            if (confetti) confetti.stop();
            frozenSegments.value = null;
            if (leadCaptureEnabled.value) {
                currentLeadId.value = null;
                leadSkipped.value = false;
                leadForm.value = { name: '', email: '' };
                leadData.value = {};
                consentGiven.value = false;
                showLeadForm.value = true;
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

        const skin = Vue.computed(() => {
            const s = settings.value || {};
            return {
                segment_fill_mode: s.segment_fill_mode, rim_enabled: s.rim_enabled, pointer_position: s.pointer_position,
                rim_style: s.rim_style, rim_color: s.rim_color,
                hub_color: s.hub_color, separator_color: s.separator_color, separator_width: s.separator_width, overlay_strength: s.overlay_strength,
                label_enabled: s.label_enabled, label_color: s.label_color, label_scale: s.label_scale,
                label_shadow: s.label_shadow, label_shadow_color: s.label_shadow_color,
                label_font: s.label_font, hub_font: s.hub_font, hub_content_scale: s.hub_content_scale,
                pointer_enabled: s.pointer_enabled, pointer_color: s.pointer_color, pointer_style: s.pointer_style,
                rim_glow: s.rim_glow, segment_gap: s.segment_gap, segment_palette: s.segment_palette,
                hub_enabled: s.hub_enabled, hub_type: s.hub_type, hub_shape: s.hub_shape,
                hub_text: s.hub_text, hub_text_color: s.hub_text_color, hub_size: s.hub_size,
                hub_text_layout: s.hub_text_layout, hub_logo_bg: s.hub_logo_bg
            };
        });

        const displaySegments = Vue.computed(() => {
            const list = segments.value || [];
            const isDepleted = (s) => !parseInt(s.unlimited || 0) && s.remaining !== null && s.remaining !== undefined && Number(s.remaining) <= 0;
            return list
                .filter(s => !(isDepleted(s) && (s.depleted_behavior || 'hide') === 'hide'))
                .map(s => (isDepleted(s) && (s.depleted_behavior || 'hide') === 'grey')
                    ? Object.assign({}, s, { depleted: true })
                    : s);
        });

        const frozenSegments = Vue.ref(null);
        const wheelSegments = Vue.computed(() => frozenSegments.value || displaySegments.value);

        const wheelBorders = Vue.computed(() => {
            try {
                const arr = JSON.parse(settings.value.wheel_borders || '[]');
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        });
        const wheelFont = Vue.computed(() => settings.value.font_family || 'Montserrat');
        const wheelAccent = Vue.computed(() => settings.value.accent_color || '');
        const buttonStyle = Vue.computed(() => {
            const s = settings.value || {};
            const scale = parseFloat(s.button_size) || 1;
            const radius = s.button_shape === 'square' ? '8px' : s.button_shape === 'rounded' ? '18px' : '999px';
            const style = {
                fontFamily: (s.button_font || s.font_family || 'Montserrat'),
                borderRadius: radius,
                transform: 'scale(' + scale + ')'
            };
            if (s.button_color) style.background = s.button_color;
            if (s.button_text_color) style.color = s.button_text_color;
            return style;
        });
        const buttonText = Vue.computed(() => settings.value.spin_button_text || 'DREHEN');
        const spinHint = Vue.computed(() => {
            const custom = (settings.value.spin_hint || '').trim();
            if (custom) return custom;
            if (spinTrigger.value === 'hub') return 'Auf die Mitte tippen zum Drehen';
            if (spinTrigger.value === 'swipe') return 'Rad mit dem Finger anschwingen';
            return 'Buzzer drücken zum Drehen';
        });

        Vue.onMounted(() => {
            if (!campaignId) return; // noCampaign guard — show error message in template
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
            noCampaign,
            segments, settings, rotation, spinning, showWin, winner, campaignEnded,
            confettiCanvas, spin, nextRound, respinAgain, bgStyle, handleSecretClick, logoUrl,
            skin, wheelFont, wheelAccent, buttonStyle, buttonText, spinHint, wheelBorders, displaySegments, wheelSegments,
            wheelSize, wheelAreaRef, navigateTo,
            spinTrigger, onWheelClick, onWheelPointerDown, onWheelPointerMove, onWheelPointerUp,
            leadCaptureEnabled, showLeadForm, leadForm, leadError, leadData, activeLeadFields,
            submitLead, skipLead, currentLeadId, leadSkipped, consentGiven
        };
    },
    template: '#event-template'
};
