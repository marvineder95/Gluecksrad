const SegmentImageEditor = {
    props: {
        segment: { type: Object, required: true },
        segmentCount: { type: Number, required: true },
        segmentIndex: { type: Number, required: true },
        offsetX: { type: Number, default: 0 },
        offsetY: { type: Number, default: 0 },
        rotation: { type: Number, default: 0 },
        scale: { type: Number, default: 1 }
    },
    emits: ['update:offsetX', 'update:offsetY', 'update:rotation', 'update:scale'],
    setup(props, { emit }) {
        const EDITOR_SIZE = 400;
        const PADDING = 30;
        const center = EDITOR_SIZE / 2;
        const radius = center - PADDING;

        const IMAGE_FIT = {
            RADIUS_RATIO: 0.52,
            SAFETY_FACTOR: 0.88,
            INNER_MARGIN_RATIO: 0.05,
            MIN_SIZE: 30,
            BINARY_ITERATIONS: 20
        };

        // Seitenverhältnis des Segmentbilds laden
        const imageAspect = Vue.ref(1);
        const loadImageAspect = () => {
            if (!props.segment || !props.segment.image) {
                imageAspect.value = 1;
                return;
            }
            const img = new Image();
            img.onload = () => {
                imageAspect.value = img.naturalWidth / img.naturalHeight || 1;
            };
            img.onerror = () => {
                imageAspect.value = 1;
            };
            img.src = props.segment.image;
        };
        Vue.watch(() => props.segment && props.segment.image, loadImageAspect, { immediate: true });

        // Pfad des Segment-Keils
        const wedgePath = Vue.computed(() => {
            const count = Math.max(1, props.segmentCount || 1);
            const anglePerSegment = 360 / count;
            const startDeg = props.segmentIndex * anglePerSegment;
            const endDeg = (props.segmentIndex + 1) * anglePerSegment;
            const startAngle = (startDeg - 90) * (Math.PI / 180);
            const endAngle = (endDeg - 90) * (Math.PI / 180);
            const x1 = center + radius * Math.cos(startAngle);
            const y1 = center + radius * Math.sin(startAngle);
            const x2 = center + radius * Math.cos(endAngle);
            const y2 = center + radius * Math.sin(endAngle);
            const largeArc = anglePerSegment > 180 ? 1 : 0;
            const cross = (x1 - center) * (y2 - center) - (y1 - center) * (x2 - center);
            const sweep = cross > 0 ? 1 : 0;
            return 'M ' + center + ' ' + center + ' L ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' ' + sweep + ' ' + x2 + ' ' + y2 + ' Z';
        });

        const clipId = Vue.computed(() => 'segment-editor-clip-' + (props.segmentIndex || 0) + '-' + Math.random().toString(36).slice(2, 8));

        // Auto-Fit-Layout für dieses Segment
        const layout = Vue.computed(() => {
            const count = Math.max(1, props.segmentCount || 1);
            const anglePerSegment = (2 * Math.PI) / count;
            const halfAngle = anglePerSegment / 2;
            const scale = count <= 4 ? 1.15 : count <= 6 ? 1.0 : count <= 8 ? 0.80 : 0.60;
            const imageRadius = radius * IMAGE_FIT.RADIUS_RATIO * scale;

            const anglePerSegmentDeg = 360 / count;
            const midDeg = props.segmentIndex * anglePerSegmentDeg + anglePerSegmentDeg / 2;
            const midAngle = (midDeg - 90) * (Math.PI / 180);
            const autoFitX = center + imageRadius * Math.cos(midAngle);
            const autoFitY = center + imageRadius * Math.sin(midAngle);
            const autoFitRotation = midDeg - 90;

            const aspectRatio = imageAspect.value || 1;

            const fitsInSector = (height) => {
                const width = height * aspectRatio;
                const topR = imageRadius + height / 2;
                const halfW = width / 2;
                const cornerR = Math.sqrt(topR * topR + halfW * halfW);
                const cornerAngle = Math.atan2(halfW, topR);
                const bottomR = imageRadius - height / 2;
                return cornerR <= radius &&
                       cornerAngle <= halfAngle &&
                       bottomR >= radius * IMAGE_FIT.INNER_MARGIN_RATIO;
            };

            let low = 0;
            let high = 2 * radius;
            for (let i = 0; i < IMAGE_FIT.BINARY_ITERATIONS; i++) {
                const mid = (low + high) / 2;
                if (fitsInSector(mid)) {
                    low = mid;
                } else {
                    high = mid;
                }
            }

            const baseBoxHeight = Math.max(IMAGE_FIT.MIN_SIZE, low * IMAGE_FIT.SAFETY_FACTOR);
            const boxHeight = baseBoxHeight * (props.scale || 1);
            const boxWidth = boxHeight * aspectRatio;

            return { autoFitX, autoFitY, autoFitRotation, boxWidth, boxHeight, baseBoxHeight };
        });

        const currentImageX = Vue.computed(() => layout.value.autoFitX + (props.offsetX || 0));
        const currentImageY = Vue.computed(() => layout.value.autoFitY + (props.offsetY || 0));
        const currentImageRotation = Vue.computed(() => layout.value.autoFitRotation + (props.rotation || 0));

        // Drag & Drop
        const dragging = Vue.ref(false);
        const startClient = Vue.ref({ x: 0, y: 0 });
        const startOffset = Vue.ref({ x: 0, y: 0 });

        const onPointerDown = (event) => {
            event.preventDefault();
            event.stopPropagation();
            dragging.value = true;
            startClient.value = { x: event.clientX, y: event.clientY };
            startOffset.value = { x: props.offsetX || 0, y: props.offsetY || 0 };
            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerUp, { once: true });
        };

        const onPointerMove = (event) => {
            if (!dragging.value) return;
            event.preventDefault();
            const dx = event.clientX - startClient.value.x;
            const dy = event.clientY - startClient.value.y;
            emit('update:offsetX', startOffset.value.x + dx);
            emit('update:offsetY', startOffset.value.y + dy);
        };

        const onPointerUp = () => {
            dragging.value = false;
            window.removeEventListener('pointermove', onPointerMove);
        };

        const onRotationInput = (event) => {
            emit('update:rotation', parseFloat(event.target.value) || 0);
        };

        const onScaleInput = (event) => {
            emit('update:scale', parseFloat(event.target.value) || 1);
        };

        const resetTransform = () => {
            emit('update:offsetX', 0);
            emit('update:offsetY', 0);
            emit('update:rotation', 0);
            emit('update:scale', 1);
        };

        Vue.onUnmounted(() => {
            dragging.value = false;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        });

        const theme = Vue.computed(() => {
            return SEGMENT_THEMES[props.segment.theme || 'neutral'] || SEGMENT_THEMES.neutral;
        });

        return {
            center,
            radius,
            wedgePath,
            clipId,
            layout,
            currentImageX,
            currentImageY,
            currentImageRotation,
            dragging,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onRotationInput,
            onScaleInput,
            resetTransform,
            theme,
            rotationDisplay: Vue.computed(() => Math.round(props.rotation || 0)),
            scaleDisplay: Vue.computed(() => {
                const s = props.scale || 1;
                return Math.round(s * 100) + '%';
            })
        };
    },
    template: '#segment-image-editor-template'
};
