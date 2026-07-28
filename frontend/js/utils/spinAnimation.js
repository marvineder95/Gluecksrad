// === Geteilte Spin-Animations-Logik ===

function runSpinAnimation({ rotationRef, winnerIndex, totalSegments, onComplete, duration, extraRotations, direction }) {
    const anglePerSegment = 360 / totalSegments;
    const targetAngle = (winnerIndex + 0.5) * anglePerSegment;

    // Current effective angle (normalized 0-360)
    const currentEffective = ((-rotationRef.value) % 360 + 360) % 360;

    // Drehrichtung: -1 (Standard) dreht die Rotation nach unten (Effekt-Winkel
    // wächst), +1 dreht andersherum. Beim Swipe wird die Richtung des Fingers
    // übergeben, damit die Nachdrehung nicht gegen die Wischrichtung läuft.
    const spinSign = (direction > 0) ? 1 : -1;

    // Restweg bis zum Zielsegment in der gewählten Richtung (0, 360]
    let rotateAmount = spinSign > 0
        ? (currentEffective - targetAngle) % 360
        : (targetAngle - currentEffective) % 360;
    if (rotateAmount <= 0) rotateAmount += 360;

    // Anzahl der Zusatzumdrehungen (bei Swipe geschwindigkeitsabhängig übergeben)
    const spins = (extraRotations != null ? extraRotations : CONFIG.ANIMATION.spin_extra_rotations);
    const extraSpins = spins * 360;
    const finalRotation = rotationRef.value + spinSign * (rotateAmount + extraSpins);

    const actualDuration = duration || CONFIG.ANIMATION.spin_duration_ms;
    const startTime = performance.now();
    const startRotation = rotationRef.value;
    const rotationDiff = finalRotation - startRotation;
    const easePower = CONFIG.ANIMATION.spin_ease_power;

    function animate(time) {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / actualDuration, 1);
        const easeOut = 1 - Math.pow(1 - progress, easePower);
        rotationRef.value = startRotation + rotationDiff * easeOut;

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else if (onComplete) {
            onComplete();
        }
    }

    requestAnimationFrame(animate);
}
