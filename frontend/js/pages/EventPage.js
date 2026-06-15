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
        let confetti = null;
        const secretClicks = Vue.ref(0);
        let secretTimer = null;
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
            } catch (e) {
                console.error('Fehler beim Laden:', e);
            }
        };

        const handleKeydown = (event) => {
            if (event.code === 'Space' || event.code === 'Enter') {
                event.preventDefault();
                if (!spinning.value && !showWin.value) spin();
            }
        };

        const handleSecretClick = () => {
            secretClicks.value++;
            if (secretTimer) clearTimeout(secretTimer);
            secretTimer = setTimeout(() => {
                secretClicks.value = 0;
            }, CONFIG.ANIMATION.secret_click_timeout_ms);
            if (secretClicks.value >= CONFIG.ANIMATION.secret_click_threshold) {
                secretClicks.value = 0;
                navigateTo('#/admin');
            }
        };

        const spin = async () => {
            if (spinning.value || showWin.value || campaignEnded.value) return;
            spinning.value = true;
            showWin.value = false;
            SoundFX.playSpin();

            try {
                const result = await api.post(CONFIG.API_BASE + CONFIG.ENDPOINTS.spin);
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
            showWin.value = false;
            if (confetti) confetti.stop();
        };

        const bgStyle = Vue.computed(() => getBackgroundStyle(settings.value));
        const logoUrl = Vue.computed(() => getLogoUrl(settings.value));

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
            if (confetti) confetti.destroy();
        });

        return {
            segments, settings, rotation, spinning, showWin, winner, campaignEnded,
            confettiCanvas, spin, nextRound, bgStyle, handleSecretClick, logoUrl,
            wheelSize, wheelAreaRef, navigateTo
        };
    },
    template: '#event-template'
};
