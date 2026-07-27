const WheelComponent = {
    props: ['segments', 'rotation', 'size'],
    setup(props) {
        const svgRef = Vue.ref(null);
        const svgSize = Vue.computed(() => props.size || 600);
        const centerValue = Vue.computed(() => svgSize.value / 2);
        const padding = CONFIG.WHEEL.svg_padding;
        const radiusValue = Vue.computed(() => centerValue.value - padding);
        const viewBoxValue = Vue.computed(() => '0 0 ' + svgSize.value + ' ' + svgSize.value);
        const wheelStyle = Vue.computed(() => ({ transform: 'rotate(' + (props.rotation || 0) + 'deg)' }));

        // Cache natural aspect ratios of segment images
        const imageAspects = Vue.ref({});
        const loadImageAspect = (url, index) => {
            if (!url) {
                imageAspects.value = { ...imageAspects.value, [index]: 1 };
                return;
            }
            const img = new Image();
            img.onload = () => {
                const aspect = img.naturalWidth / img.naturalHeight || 1;
                imageAspects.value = { ...imageAspects.value, [index]: aspect };
            };
            img.onerror = () => {
                imageAspects.value = { ...imageAspects.value, [index]: 1 };
            };
            img.src = url;
        };

        Vue.watch(() => props.segments, (segments, oldSegments) => {
            segments.forEach((segment, index) => {
                const oldUrl = oldSegments && oldSegments[index] && oldSegments[index].image;
                if (segment.image !== oldUrl) {
                    loadImageAspect(segment.image, index);
                }
            });
        }, { immediate: true, deep: true });

        const setViewBox = () => {
            Vue.nextTick(() => {
                if (svgRef.value) {
                    svgRef.value.setAttribute('viewBox', viewBoxValue.value);
                }
            });
        };

        Vue.watch(svgSize, setViewBox);
        Vue.onMounted(setViewBox);

        // Generate unique clipPath IDs for each segment
        const clipPaths = Vue.computed(() => {
            const count = props.segments.length;
            if (count === 0) return [];
            const center = centerValue.value;
            const radius = radiusValue.value;
            const anglePerSegment = 360 / count;
            return props.segments.map((segment, index) => {
                const startDeg = index * anglePerSegment;
                const endDeg = (index + 1) * anglePerSegment;
                const startAngle = (startDeg - 90) * (Math.PI / 180);
                const endAngle = (endDeg - 90) * (Math.PI / 180);
                const x1 = center + radius * Math.cos(startAngle);
                const y1 = center + radius * Math.sin(startAngle);
                const x2 = center + radius * Math.cos(endAngle);
                const y2 = center + radius * Math.sin(endAngle);
                const largeArc = anglePerSegment > 180 ? 1 : 0;
                // Determine sweep direction: cross product tells us which side x2,y2 is on relative to x1,y1
                const cross = (x1 - center) * (y2 - center) - (y1 - center) * (x2 - center);
                const sweep = cross > 0 ? 1 : 0;
                const path = 'M ' + center + ' ' + center + ' L ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' ' + sweep + ' ' + x2 + ' ' + y2 + ' Z';
                return { id: 'clip-' + index, path };
            });
        });

        // Curved text paths along the outer edge of each segment
        const textPaths = Vue.computed(() => {
            const count = props.segments.length;
            if (count === 0) return [];
            const center = centerValue.value;
            const radius = radiusValue.value;
            const anglePerSegment = 360 / count;
            const textArcRadius = radius * 0.92;

            return props.segments.map((segment, index) => {
                const midDeg = index * anglePerSegment + anglePerSegment / 2;
                // Arc covering ~70% of the segment width
                const arcSpanDeg = anglePerSegment * 0.70;

                const isLeftSide = midDeg > 90 && midDeg < 270;
                let startArcDeg, endArcDeg;

                if (isLeftSide) {
                    // Flip arc direction so text reads correctly on left side
                    startArcDeg = midDeg + arcSpanDeg / 2;
                    endArcDeg = midDeg - arcSpanDeg / 2;
                } else {
                    startArcDeg = midDeg - arcSpanDeg / 2;
                    endArcDeg = midDeg + arcSpanDeg / 2;
                }

                const startArcAngle = (startArcDeg - 90) * (Math.PI / 180);
                const endArcAngle = (endArcDeg - 90) * (Math.PI / 180);

                const x1 = center + textArcRadius * Math.cos(startArcAngle);
                const y1 = center + textArcRadius * Math.sin(startArcAngle);
                const x2 = center + textArcRadius * Math.cos(endArcAngle);
                const y2 = center + textArcRadius * Math.sin(endArcAngle);

                const sweep = isLeftSide ? 0 : 1;
                const d = `M ${x1} ${y1} A ${textArcRadius} ${textArcRadius} 0 0 ${sweep} ${x2} ${y2}`;

                return { id: 'textArc-' + index, d };
            });
        });

        // Constants for image fitting inside the wheel sector
        const IMAGE_FIT = {
            RADIUS_RATIO: 0.52,
            SAFETY_FACTOR: 0.88,
            INNER_MARGIN_RATIO: 0.05,
            MIN_SIZE: 30,
            BINARY_ITERATIONS: 20
        };
        const EDITOR_REF_SIZE = 400; // Bezugssystem des Segment-Bild-Editors

        const fitsInSector = (height, imageRadius, aspectRatio, radius, halfAngle) => {
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

        const segmentPaths = Vue.computed(() => {
            const count = props.segments.length;
            if (count === 0) return [];

            const anglePerSegmentDeg = 360 / count;
            const anglePerSegment = (2 * Math.PI) / count;
            const center = centerValue.value;
            const radius = radiusValue.value;
            const segCount = count;
            const halfAngle = anglePerSegment / 2;

            // Scale factors based on segment count
            const scale = segCount <= 4 ? 1.15 : segCount <= 6 ? 1.0 : segCount <= 8 ? 0.80 : 0.60;

            // Center of the image target box along the segment bisector
            const imageRadius = radius * IMAGE_FIT.RADIUS_RATIO * scale;
            const fontSize = Math.max(14, radius * 0.046 * scale);

            return props.segments.map((segment, index) => {
                const startDeg = index * anglePerSegmentDeg;
                const endDeg = (index + 1) * anglePerSegmentDeg;
                const startAngle = (startDeg - 90) * (Math.PI / 180);
                const endAngle = (endDeg - 90) * (Math.PI / 180);
                const x1 = center + radius * Math.cos(startAngle);
                const y1 = center + radius * Math.sin(startAngle);
                const x2 = center + radius * Math.cos(endAngle);
                const y2 = center + radius * Math.sin(endAngle);
                const largeArc = anglePerSegmentDeg > 180 ? 1 : 0;
                const cross = (x1 - center) * (y2 - center) - (y1 - center) * (x2 - center);
                const sweep = cross > 0 ? 1 : 0;
                const path = 'M ' + center + ' ' + center + ' L ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' ' + sweep + ' ' + x2 + ' ' + y2 + ' Z';

                const midDeg = startDeg + anglePerSegmentDeg / 2;
                const midAngle = (midDeg - 90) * (Math.PI / 180);

                const imageX = center + imageRadius * Math.cos(midAngle);
                const imageY = center + imageRadius * Math.sin(midAngle);

                // Calculate the largest rectangle that fits inside the sector,
                // aligned to the segment bisector and preserving the image aspect ratio.
                const aspectRatio = imageAspects.value[index] || 1;
                let low = 0;
                let high = 2 * radius;
                for (let i = 0; i < IMAGE_FIT.BINARY_ITERATIONS; i++) {
                    const mid = (low + high) / 2;
                    if (fitsInSector(mid, imageRadius, aspectRatio, radius, halfAngle)) {
                        low = mid;
                    } else {
                        high = mid;
                    }
                }

                const boxHeight = Math.max(IMAGE_FIT.MIN_SIZE, low * IMAGE_FIT.SAFETY_FACTOR) * (parseFloat(segment.image_scale) || 1);
                const boxWidth = boxHeight * aspectRatio;
                const imageRotation = midDeg - 90;

                // Gespeicherte Editor-Offsets auf aktuelle Radgröße skalieren
                const offsetScale = svgSize.value / EDITOR_REF_SIZE;
                const offsetX = (parseFloat(segment.image_offset_x) || 0) * offsetScale;
                const offsetY = (parseFloat(segment.image_offset_y) || 0) * offsetScale;
                const extraRotation = parseFloat(segment.image_rotation) || 0;

                const themeKey = segment.theme || 'neutral';
                const theme = SEGMENT_THEMES[themeKey] || SEGMENT_THEMES.neutral;

                return {
                    name: segment.name,
                    image: segment.image,
                    theme,
                    path,
                    imageX: imageX + offsetX,
                    imageY: imageY + offsetY,
                    boxWidth,
                    boxHeight,
                    imageRotation: imageRotation + extraRotation,
                    fontSize,
                    midDeg
                };
            });
        });

        return {
            svgRef,
            viewBox: viewBoxValue,
            center: centerValue,
            radius: radiusValue,
            segmentPaths,
            clipPaths,
            textPaths,
            wheelStyle,
            config: CONFIG
        };
    },
    template: '#wheel-template'
};
