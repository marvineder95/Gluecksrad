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
        const leadData = Vue.ref({});
        const activeLeadFields = Vue.computed(() => {
            let fields = [];
            try { const a = JSON.parse(settings.value.lead_fields || '[]'); if (Array.isArray(a)) fields = a; } catch (e) {}
            const enabled = fields.filter(f => f.enabled);
            // Fallback: wenn nichts konfiguriert -> Name + E-Mail
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
                // Lead-Formular proaktiv anzeigen (vor dem Drehen)
                if (leadCaptureEnabled.value && !currentLeadId.value && !leadSkipped.value && !campaignEnded.value) {
                    showLeadForm.value = true;
                }
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
                const fields = activeLeadFields.value;
                const val = (k) => (leadData.value[k] != null ? String(leadData.value[k]).trim() : '');
                // Pflichtfelder prüfen
                for (const f of fields) {
                    if (f.required && !val(f.key)) {
                        leadError.value = 'Bitte „' + f.label + '" ausfüllen.';
                        return false;
                    }
                }
                // E-Mail-Format prüfen (falls E-Mail-Feld vorhanden und ausgefüllt)
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
                // Name/E-Mail für die bestehenden Spalten ableiten
                const derivedEmail = emailField ? val(emailField.key) : '';
                let derivedName = val('name');
                if (!derivedName) derivedName = (val('vorname') + ' ' + val('nachname')).trim();
                if (!derivedName) derivedName = derivedEmail || 'Gast';
                // Daten mit Labels für Anzeige/Export aufbereiten
                const dataOut = {};
                fields.forEach(f => { dataOut[f.label] = val(f.key); });
                try {
                    const result = await api.post(CONFIG.API_BASE + CONFIG.ENDPOINTS.leads, {
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
                    duration: animOverride ? animOverride.duration : undefined,
                    extraRotations: animOverride ? animOverride.extraRotations : undefined,
                    onComplete: () => {
                        spinning.value = false;
                        setTimeout(() => {
                            showWin.value = true;
                            SoundFX.playWin();
                            if (confetti) confetti.start();
                            // Gewinnbildschirm nach 5 Sekunden automatisch schließen
                            if (winTimer) clearTimeout(winTimer);
                            winTimer = setTimeout(() => {
                                if (showWin.value) {
                                    (winner.value && parseInt(winner.value.is_respin)) ? respinAgain() : nextRound();
                                }
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

        // Neu-Dreh: Overlay schliessen und direkt erneut drehen, Lead bleibt erhalten
        const respinAgain = () => {
            if (winTimer) { clearTimeout(winTimer); winTimer = null; }
            showWin.value = false;
            if (confetti) confetti.stop();
            spin(true);
        };

        // === Start-Auslöser: Button | Mittelelement | Swipe ===
        const spinTrigger = Vue.computed(() => settings.value.spin_trigger || 'button');
        let dragState = null;

        // Winkel des Zeigers relativ zum Radmittelpunkt (in Grad)
        const wheelAngleAt = (clientX, clientY) => {
            const el = wheelAreaRef.value;
            if (!el) return 0;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            return Math.atan2(clientY - cy, clientX - cx) * 180 / Math.PI;
        };

        // Klick/Tap auf das Rad -> nur im Modus "hub" (Mittelelement) auslösen
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
            // Rad folgt dem Finger
            rotation.value += d;
            dragState.moved += Math.abs(d);
            // Geglättete Winkelgeschwindigkeit (Grad/ms)
            dragState.velocity = 0.7 * dragState.velocity + 0.3 * (d / dt);
            dragState.lastAngle = ang;
            dragState.lastTime = now;
        };

        const onWheelPointerUp = () => {
            if (!dragState) return;
            const v = Math.abs(dragState.velocity);
            const moved = dragState.moved;
            dragState = null;
            // Reiner Tap (kaum Bewegung) -> ignorieren, echter Swipe nötig
            if (moved < 10) return;
            // Geschwindigkeit -> Animationsdauer/Umdrehungen (Ergebnis bleibt fix!)
            // Langsamer Swipe: wenige Umdrehungen, aber lange Dauer (dreht langsam, aber lange).
            // Schneller Swipe: viele Umdrehungen, kürzere Dauer (dreht schnell).
            const extraRotations = Math.min(9, Math.max(2, 2 + v * 3));
            const duration = Math.min(8500, Math.max(3500, 7000 - v * 900));
            spin(false, { extraRotations, duration });
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
                leadData.value = {};
                consentGiven.value = false;
                // Formular für den nächsten Spieler direkt wieder anzeigen
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

        // Design-Tokens (Skin) für das echte Kiosk-Rad
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
                hub_text_layout: s.hub_text_layout
            };
        });
        // Angezeigte Segmente: erschöpfte je nach depleted_behavior ausblenden/ausgrauen
        const displaySegments = Vue.computed(() => {
            const list = segments.value || [];
            const isDepleted = (s) => !parseInt(s.unlimited || 0) && s.remaining !== null && s.remaining !== undefined && Number(s.remaining) <= 0;
            return list
                .filter(s => !(isDepleted(s) && (s.depleted_behavior || 'hide') === 'hide'))
                .map(s => isDepleted(s) ? Object.assign({}, s, { depleted: true }) : s);
        });

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
            if (spinTrigger.value === 'hub') return 'Auf die Mitte tippen zum Drehen';
            if (spinTrigger.value === 'swipe') return 'Rad mit dem Finger anschwingen';
            return 'Buzzer drücken zum Drehen';
        });

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
            confettiCanvas, spin, nextRound, respinAgain, bgStyle, handleSecretClick, logoUrl,
            skin, wheelFont, wheelAccent, buttonStyle, buttonText, spinHint, wheelBorders, displaySegments,
            wheelSize, wheelAreaRef, navigateTo,
            spinTrigger, onWheelClick, onWheelPointerDown, onWheelPointerMove, onWheelPointerUp,
            leadCaptureEnabled, showLeadForm, leadForm, leadError, leadData, activeLeadFields,
            submitLead, skipLead, currentLeadId, leadSkipped, consentGiven
        };
    },
    template: '#event-template'
};
