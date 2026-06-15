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

        const segmentPaths = Vue.computed(() => {
            const count = props.segments.length;
            if (count === 0) return [];

            const anglePerSegment = 360 / count;
            const center = centerValue.value;
            const radius = radiusValue.value;
            const segCount = count;

            // Scale factors based on segment count
            const scale = segCount <= 6 ? 1.0 : (segCount <= 8 ? 0.85 : 0.68);

            const imageRadius = radius * 0.70 * scale;
            const imageSize = Math.max(65, radius * 0.32 * scale);
            const fontSize = Math.max(14, radius * 0.046 * scale);

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
                const cross = (x1 - center) * (y2 - center) - (y1 - center) * (x2 - center);
                const sweep = cross > 0 ? 1 : 0;
                const path = 'M ' + center + ' ' + center + ' L ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' ' + sweep + ' ' + x2 + ' ' + y2 + ' Z';

                const midDeg = startDeg + anglePerSegment / 2;
                const midAngle = (midDeg - 90) * (Math.PI / 180);

                const imageX = center + imageRadius * Math.cos(midAngle);
                const imageY = center + imageRadius * Math.sin(midAngle);

                const themeKey = segment.theme || 'neutral';
                const theme = SEGMENT_THEMES[themeKey] || SEGMENT_THEMES.neutral;

                return {
                    name: segment.name,
                    image: segment.image,
                    theme,
                    path,
                    imageX,
                    imageY,
                    imageSize,
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
