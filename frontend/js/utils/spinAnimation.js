// === Geteilte Spin-Animations-Logik ===

function runSpinAnimation({ rotationRef, winnerIndex, totalSegments, onComplete, duration, extraRotations }) {
    const anglePerSegment = 360 / totalSegments;
    const targetAngle = (winnerIndex + 0.5) * anglePerSegment;

    // Current effective angle (normalized 0-360)
    const currentEffective = ((-rotationRef.value) % 360 + 360) % 360;

    // How much more to rotate clockwise to reach target
    let rotateAmount = targetAngle - currentEffective;
    if (rotateAmount <= 0) rotateAmount += 360;

    // Anzahl der Zusatzumdrehungen (bei Swipe geschwindigkeitsabhängig übergeben)
    const spins = (extraRotations != null ? extraRotations : CONFIG.ANIMATION.spin_extra_rotations);
    const extraSpins = spins * 360;
    const finalRotation = rotationRef.value - rotateAmount - extraSpins;

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
