const WheelComponent = {
    props: ['segments', 'rotation', 'size', 'font', 'accent', 'skin', 'logo', 'borders'],
    setup(props) {
        const svgRef = Vue.ref(null);

        // Aufgelöste Design-Tokens (Skin) mit Defaults
        const DEFAULT_SKIN = {
            segment_fill_mode: 'image', rim_enabled: '1', rim_style: 'gold', rim_color: '#C8A866',
            pointer_position: 'top',
            hub_color: '#C8A866', separator_color: '#FFFFFF', overlay_strength: 30,
            label_enabled: '1', label_color: '#FFFFFF', label_scale: 1,
            pointer_enabled: '1', pointer_color: '#C8A866', pointer_style: 'triangle',
            rim_glow: '0', segment_gap: 0, segment_palette: '',
            hub_enabled: '1', hub_type: 'shape', hub_shape: 'circle',
            hub_text: '', hub_text_color: '#FFFFFF', hub_size: 0.16
        };
        const sk = Vue.computed(() => Object.assign({}, DEFAULT_SKIN, props.skin || {}));
        const gapDeg = Vue.computed(() => {
            const g = parseFloat(sk.value.segment_gap);
            return isNaN(g) ? 0 : Math.max(0, Math.min(8, g));
        });
        const overlayColor = Vue.computed(() => {
            const p = Math.max(0, Math.min(70, Number(sk.value.overlay_strength))) / 100;
            return 'rgba(0,0,0,' + p + ')';
        });
        const labelScale = Vue.computed(() => {
            const s = parseFloat(sk.value.label_scale);
            return isNaN(s) ? 1 : Math.max(0.6, Math.min(1.6, s));
        });
        // Optionale Segment-Palette (überschreibt Einzelfarben zyklisch)
        const palette = Vue.computed(() =>
            (sk.value.segment_palette || '').split(',').map(s => s.trim()).filter(Boolean)
        );
        const luminance = (hex) => {
            const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
            if (!m) return 1;
            const n = parseInt(m[1], 16);
            const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        };
        const contrastColor = (hex) => luminance(hex) > 0.55 ? '#1A1A1A' : '#FFFFFF';

        // Hub-Geometrie (immer um den Mittelpunkt zentriert)
        const hubR = Vue.computed(() => {
            const s = parseFloat(sk.value.hub_size);
            const frac = isNaN(s) ? 0.16 : Math.max(0.08, Math.min(0.45, s));
            return radiusValue.value * frac;
        });
        const hubArcPath = Vue.computed(() => {
            const c = centerValue.value, r = hubR.value * 0.72;
            return `M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`;
        });
        const hubDiamond = Vue.computed(() => {
            const c = centerValue.value, r = hubR.value;
            return `${c},${c - r} ${c + r},${c} ${c},${c + r} ${c - r},${c}`;
        });
        // Aussenränder (mehrere Ringe, von innen nach aussen gestapelt)
        const borderRings = Vue.computed(() => {
            const list = Array.isArray(props.borders) ? props.borders : [];
            let r = radiusValue.value + 5;
            return list.map((b, i) => {
                const w = Math.max(1, Number(b.width) || 4);
                r += w / 2 + 2;
                const ring = {
                    id: i, r, width: w, glow: !!b.glow, fill: b.fill,
                    c1: b.c1 || '#C8A866', c2: b.c2 || b.c1 || '#C8A866',
                    stroke: b.fill === 'gradient' ? 'url(#bgrad' + i + ')' : (b.c1 || '#C8A866')
                };
                r += w / 2 + 2;
                return ring;
            });
        });

        const hubStar = Vue.computed(() => {
            const c = centerValue.value, R = hubR.value, r = R * 0.42, pts = [];
            for (let i = 0; i < 10; i++) {
                const ang = (-90 + i * 36) * Math.PI / 180;
                const rad = i % 2 === 0 ? R : r;
                pts.push(`${(c + rad * Math.cos(ang)).toFixed(1)},${(c + rad * Math.sin(ang)).toFixed(1)}`);
            }
            return pts.join(' ');
        });
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
            const gap = gapDeg.value;
            return props.segments.map((segment, index) => {
                const startDeg = index * anglePerSegment + gap / 2;
                const endDeg = (index + 1) * anglePerSegment - gap / 2;
                const startAngle = (startDeg - 90) * (Math.PI / 180);
                const endAngle = (endDeg - 90) * (Math.PI / 180);
                const x1 = center + radius * Math.cos(startAngle);
                const y1 = center + radius * Math.sin(startAngle);
                const x2 = center + radius * Math.cos(endAngle);
                const y2 = center + radius * Math.sin(endAngle);
                const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
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

            const gap = gapDeg.value;
            return props.segments.map((segment, index) => {
                const startDeg = index * anglePerSegmentDeg + gap / 2;
                const endDeg = (index + 1) * anglePerSegmentDeg - gap / 2;
                const startAngle = (startDeg - 90) * (Math.PI / 180);
                const endAngle = (endDeg - 90) * (Math.PI / 180);
                const x1 = center + radius * Math.cos(startAngle);
                const y1 = center + radius * Math.sin(startAngle);
                const x2 = center + radius * Math.cos(endAngle);
                const y2 = center + radius * Math.sin(endAngle);
                const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
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

                const pal = palette.value;
                const fillColor = pal.length ? pal[index % pal.length] : (segment.color || CONFIG.DEFAULTS.segment_color);
                let labelColor = sk.value.label_color;
                if (labelColor === 'auto') {
                    labelColor = sk.value.segment_fill_mode === 'color' ? contrastColor(fillColor) : '#FFFFFF';
                }

                return {
                    name: segment.name,
                    image: segment.image,
                    color: fillColor,
                    labelColor: labelColor,
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
            sk,
            overlayColor,
            labelScale,
            gapDeg,
            hubR,
            hubDiamond,
            hubStar,
            hubArcPath,
            borderRings,
            config: CONFIG
        };
    },
    template: '#wheel-template'
};
