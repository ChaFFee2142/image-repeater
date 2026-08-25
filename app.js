    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const canvasRepeat = document.getElementById('canvasRepeat');
    const ctxRepeat = canvasRepeat.getContext('2d');
    const marginInput = document.getElementById('margin');
    const repeatInput = document.getElementById('repeat');
    const marginSlider = document.getElementById('marginSlider');
    const repeatSlider = document.getElementById('repeatSlider');
    const offsetModeButtons = document.querySelectorAll('#offsetModes button');
    const seamBlendButtons = document.querySelectorAll('#seamModes button');
    const trimButtons = document.querySelectorAll('#trimModes button');
    const pbgButtons = document.querySelectorAll('#pbgModes button');
    const offsetInput = document.getElementById('offset');
    const offsetSlider = document.getElementById('offsetSlider');
    const overlay = document.getElementById('overlay');
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const downloadBtn = document.getElementById('download');
    const outputStamp = document.getElementById('outputStamp');
    const dragChip = document.getElementById('dragChip');
    const themeToggle = document.getElementById('themeToggle');

    let fileName = 'image';
    let exportType = 'image/jpeg';
    let exportExt = 'jpg';
    const JPEG_QUALITY = 0.92;
    let hasImage = false;
    let hasAlpha = false;
    const DEFAULT_ZOOM = 1;
    const ZOOMED_OUT = 0.5;
    let zoomLevel = DEFAULT_ZOOM;
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 5;
    const SNAP = 6; // px window for offset detents
    // Preview-only canvas budget: export output remains full resolution.
    const MAX_REPEAT_PREVIEW_PIXELS = 4 * 1024 * 1024;

    let offset = 0;
    let offsetModeValue = 'center';
    let accentColor = '#7c8cff'; // cached; refreshed only on theme change
    let seamBlend = 'equal'; // 'equal' | 'top' | 'bottom'
    let trimDirection = 'bottom'; // 'bottom' | 'both' | 'top'

    let isDraggingCanvas = false; // right column -> margin
    let startY = 0;
    let startMargin = 0;

    let isDraggingLeft = false;   // left column -> offset
    let startYLeft = 0;
    let startOffset = 0;
    let leftScaleFactor = 1;
    let pendingProcessFrame = 0;

    let img = new Image();
    const zoomWrapper = document.querySelector('.zoom-wrapper');

    ///////////////////////////////////
    /////////// --- Theme --- /////////
    ///////////////////////////////////

    const SUN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="7" y2="7"/><line x1="17" y1="17" x2="18.8" y2="18.8"/><line x1="5.2" y1="18.8" x2="7" y2="17"/><line x1="17" y1="7" x2="18.8" y2="5.2"/></svg>';
    const MOON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/></svg>';

    function prefersDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    function isDark() {
        const t = document.documentElement.getAttribute('data-theme');
        if (t) return t === 'dark';
        return prefersDark();
    }
    function updateThemeIcon() { themeToggle.innerHTML = isDark() ? SUN : MOON; }

    // Read the accent once per theme change instead of every frame.
    function refreshAccent() {
        const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (c) accentColor = c;
    }

    (function initTheme() {
        try {
            const saved = localStorage.getItem('ir-theme');
            if (saved) document.documentElement.setAttribute('data-theme', saved);
        } catch (e) {}
        updateThemeIcon();
        refreshAccent();
    })();

    themeToggle.onclick = () => {
        const next = isDark() ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('ir-theme', next); } catch (e) {}
        updateThemeIcon();
        refreshAccent();
        if (hasImage) processImage(); // recolor seam markers for the new accent
    };

    ///////////////////////////////////
    //// --- Global drag events --- ///
    ///////////////////////////////////

    ['dragenter', 'dragover'].forEach(eventName => {
        window.addEventListener(eventName, e => {
            e.preventDefault();
            overlay.classList.add('active');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, e => e.preventDefault());
    });

    window.addEventListener('dragleave', e => {
        if (e.clientX === 0 && e.clientY === 0) overlay.classList.remove('active');
    });

    window.addEventListener('drop', e => {
        overlay.classList.remove('active');

        const file = e.dataTransfer.files[0];
        if (!file || !file.type.startsWith('image/')) {
            statusText.innerText = 'Not an image';
            return;
        }

        fileName = file.name.replace(/\.[^/.]+$/, "");
        statusText.innerText = 'Loading…';

        const reader = new FileReader();
        reader.onload = () => { img.src = reader.result; };
        reader.readAsDataURL(file);
    });

    img.onload = () => {
        hasImage = true;
        document.body.classList.add('has-image');
        downloadBtn.disabled = false;

        // Detect real transparency -> keep alpha by exporting PNG (JPEG can't).
        hasAlpha = detectAlpha();
        exportType = hasAlpha ? 'image/png' : 'image/jpeg';
        exportExt = hasAlpha ? 'png' : 'jpg';
        document.body.classList.toggle('has-alpha', hasAlpha);

        zoomLevel = DEFAULT_ZOOM;

        // Offset can span the full image height in either direction.
        const half = Math.floor(img.height / 2);
        offsetSlider.min = -half;
        offsetSlider.max = half;

        // The seam band needs a non-negative core above it.
        const marginCap = Math.floor(img.height / 3);
        marginSlider.max = Math.min(300, marginCap);
        const initialMargin = Math.min(parseInt(marginInput.value) || 0, marginCap);
        marginInput.value = initialMargin;
        marginSlider.value = Math.min(initialMargin, parseInt(marginSlider.max));

        zoomWrapper.querySelector('canvas').style.transform = `scale(${zoomLevel})`;

        statusText.innerText = 'Image loaded';
        statusEl.classList.add('loaded');
        processImage();
    };

    ///////////////////////////////////
    ///////// --- Helpers --- /////////
    ///////////////////////////////////

    function getMargin() {
        const raw = parseInt(marginInput.value) || 0;
        // The output needs an m-tall blend band plus the source core above it.
        const cap = img.height ? Math.max(0, Math.floor(img.height / 3)) : 300;
        return Math.max(0, Math.min(raw, cap));
    }

    // The source loses m rows to make room for the seam band. Choose whether
    // those rows are taken from the top, split evenly, or taken from the bottom.
    function getTrimTop(m) {
        if (trimDirection === 'top') return m;
        if (trimDirection === 'both') return Math.floor(m / 2);
        return 0;
    }

    // Sample the source for any non-opaque pixel (sparse scan for speed).
    function detectAlpha() {
        try {
            const t = document.createElement('canvas');
            t.width = img.width;
            t.height = img.height;
            const tc = t.getContext('2d');
            tc.drawImage(img, 0, 0);
            const data = tc.getImageData(0, 0, img.width, img.height).data;
            const step = Math.max(1, Math.floor((img.width * img.height) / 150000)) * 4;
            for (let i = 3; i < data.length; i += step) {
                if (data[i] < 250) return true;
            }
        } catch (e) {
            return false; // e.g. tainted canvas — assume opaque
        }
        return false;
    }

    // Cyclically shift a finished (already seamless) tile vertically.
    // Applied AFTER blending, so the seam is untouched: a wrap-around shift
    // of a seamless tile is still seamless, so repeatability is preserved.
    function shiftCanvasVertically(cnv, off) {
        const H = cnv.height;
        const W = cnv.width;
        const o = ((off % H) + H) % H;
        if (o === 0) return;

        const tmp = document.createElement('canvas');
        tmp.width = W;
        tmp.height = H;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(cnv, 0, o);
        tctx.drawImage(cnv, 0, o - H);

        const c = cnv.getContext('2d');
        c.clearRect(0, 0, W, H);
        c.drawImage(tmp, 0, 0);
    }

    // The repeat canvas is only a visual inspector. Downscaling it prevents a
    // high-resolution source with several repeats from monopolizing memory.
    function renderRepeatPreview(tileH, repeatCount, blendH = 0) {
        const fullPixels = canvas.width * tileH * repeatCount;
        const scale = fullPixels > MAX_REPEAT_PREVIEW_PIXELS
            ? Math.sqrt(MAX_REPEAT_PREVIEW_PIXELS / fullPixels)
            : 1;
        const previewW = Math.max(1, Math.round(canvas.width * scale));
        const previewH = Math.max(1, Math.round(tileH * repeatCount * scale));

        canvasRepeat.width = previewW;
        canvasRepeat.height = previewH;
        ctxRepeat.clearRect(0, 0, previewW, previewH);
        for (let i = 0; i < repeatCount; i++) {
            const y0 = Math.round(i * tileH * scale);
            const y1 = Math.round((i + 1) * tileH * scale);
            ctxRepeat.drawImage(canvas, 0, 0, canvas.width, tileH, 0, y0, previewW, y1 - y0);
        }
        drawSeamMarkers(tileH * scale, repeatCount, previewW, blendH * scale);
    }

    // Coalesce pointer-drag updates to one full canvas rebuild per frame.
    function scheduleProcessImage() {
        if (pendingProcessFrame) return;
        pendingProcessFrame = requestAnimationFrame(() => {
            pendingProcessFrame = 0;
            processImage();
        });
    }

    function processImageNow() {
        if (pendingProcessFrame) cancelAnimationFrame(pendingProcessFrame);
        pendingProcessFrame = 0;
        processImage();
    }

    // Build the m-tall seam band that makes the tile loop. Three blend modes:
    //   equal  - both edges cross-fade at the same rate
    //   top    - the top edge takes over sooner
    //   bottom - the bottom edge remains visible longer
    // The outgoing strip directly follows the retained core. The incoming strip
    // is the m rows directly before it, so the next tile resumes without a jump.
    function buildSeam(w, m, outgoingY, incomingY) {
        // a strip canvas of m rows sampled from source row sy
        const mk = (sy) => {
            const c = document.createElement('canvas');
            c.width = w; c.height = m;
            c.getContext('2d').drawImage(img, 0, sy, w, m, 0, 0, w, m);
            return c;
        };
        // Scale a strip's alpha by a vertical gradient. Several stops make the
        // top/bottom-biased transition curves visibly distinct for opaque JPEGs.
        const fade = (c, alphaAt) => {
            const cx = c.getContext('2d');
            const g = cx.createLinearGradient(0, 0, 0, m);
            const steps = 16;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                g.addColorStop(t, `rgba(0,0,0,${alphaAt(t)})`);
            }
            cx.globalCompositeOperation = 'destination-in';
            cx.fillStyle = g;
            cx.fillRect(0, 0, w, m);
            cx.globalCompositeOperation = 'source-over';
            return c;
        };

        const temp = document.createElement('canvas');
        temp.width = w; temp.height = m;
        const tctx = temp.getContext('2d');

        const topWeight = (t) => {
            if (seamBlend === 'top') return 1 - (1 - t) * (1 - t); // ease out
            if (seamBlend === 'bottom') return t * t;               // ease in
            return t;
        };

        // Add premultiplied, complementary alpha contributions. Unlike normal
        // source-over stacking, this never builds extra opacity in PNG seams.
        tctx.drawImage(fade(mk(outgoingY), t => 1 - topWeight(t)), 0, 0);
        tctx.globalCompositeOperation = 'lighter';
        tctx.drawImage(fade(mk(incomingY), topWeight), 0, 0);
        return temp;
    }

    // Small triangular ticks at the centre of each blend band. The band occupies
    // the final `blendH` rows of a tile, not the boundary below it.
    function drawSeamMarkers(tileH, count, w, blendH = 0) {
        if (count < 2) return;
        const acc = accentColor;
        const s = Math.max(6, Math.min(16, w * 0.05));
        ctxRepeat.save();
        ctxRepeat.fillStyle = acc;
        ctxRepeat.globalAlpha = 0.92;
        for (let i = 1; i < count; i++) {
            const y = i * tileH - blendH / 2;
            ctxRepeat.beginPath();
            ctxRepeat.moveTo(0, y - s); ctxRepeat.lineTo(0, y + s); ctxRepeat.lineTo(s, y);
            ctxRepeat.closePath(); ctxRepeat.fill();
            ctxRepeat.beginPath();
            ctxRepeat.moveTo(w, y - s); ctxRepeat.lineTo(w, y + s); ctxRepeat.lineTo(w - s, y);
            ctxRepeat.closePath(); ctxRepeat.fill();
        }
        ctxRepeat.restore();
    }

    ///////////////////////////////////
    ///////// --- Process --- /////////
    ///////////////////////////////////

    function processImage() {
        if (!img.src) return;

        const m = getMargin();
        const w = img.width;
        const h = img.height;
        const newH = h - 2 * m;
        const trimTop = getTrimTop(m);
        const coreStart = trimTop + m;
        const coreH = newH - m;

        // Resolve offset from the selected alignment mode.
        // Center -> no shift; Top -> +m; Bottom -> -m; Custom -> user pixels.
        if (offsetModeValue === 'center') offset = 0;
        else if (offsetModeValue === 'top') offset = m;
        else if (offsetModeValue === 'bottom') offset = -m;
        else offset = parseInt(offsetInput.value) || 0;

        offsetInput.value = offset;
        offsetSlider.value = Math.max(parseInt(offsetSlider.min), Math.min(parseInt(offsetSlider.max), offset));
        marginInput.value = m;
        marginSlider.value = Math.min(m, parseInt(marginSlider.max));

        if (m === 0) {
            canvas.width = w;
            canvas.height = h;
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0);

            // A zero-margin image has no blend band, so its boundary is the seam.
            const repeatCount = Math.max(1, parseInt(repeatInput.value) || 1);
            renderRepeatPreview(h, repeatCount);

            // Offset the result preview + download.
            shiftCanvasVertically(canvas, offset);

            afterProcess();
            return;
        }

        canvas.width = w;
        canvas.height = newH;

        ctx.clearRect(0, 0, w, newH);

        // The retained core moves according to Trim from. The final m rows are
        // replaced by the blend band below, preserving the seamless loop.
        ctx.drawImage(img, 0, coreStart, w, coreH, 0, 0, w, coreH);

        // Seam band (blend mode chosen by the user); replace, don't overlay,
        // so alpha isn't stacked onto the middle underneath.
        const temp = buildSeam(w, m, coreStart + coreH, trimTop);
        ctx.clearRect(0, newH - m, w, m);
        ctx.drawImage(temp, 0, newH - m);

        // --- REPEAT PREVIEW (seam inspection) ---
        // Keep the preview fixed and mark the centre of each visible blend band.
        const repeatCount = Math.max(1, parseInt(repeatInput.value) || 1);
        renderRepeatPreview(newH, repeatCount, m);

        // Offset the finished seamless tile (wrap-around) for the left preview + download.
        shiftCanvasVertically(canvas, offset);

        afterProcess();
    }

    function afterProcess() {
        refreshSliders();
        outputStamp.textContent = `${canvas.width} × ${canvas.height}px · ${exportExt.toUpperCase()}`;
    }

    ///////////////////////////////////
    ////// --- Slider visuals --- /////
    ///////////////////////////////////

    function refreshSliders() {
        [marginSlider, offsetSlider, repeatSlider].forEach(updateSlider);
    }

    function updateSlider(el) {
        const min = parseFloat(el.min), max = parseFloat(el.max);
        const p = max === min ? 0 : (parseFloat(el.value) - min) / (max - min);
        const pct = Math.max(0, Math.min(1, p)) * 100;
        el.style.background = `linear-gradient(to right, var(--accent) 0 ${pct}%, var(--track) ${pct}% 100%)`;

        const wrap = el.closest('.slider-wrap');
        if (!wrap) return;
        const bub = wrap.querySelector('.bubble');
        if (!bub) return;
        bub.textContent = el.value;
        const thumb = 18;
        const x = thumb / 2 + (pct / 100) * (el.clientWidth - thumb);
        bub.style.left = x + 'px';
    }

    // show the bubble while actually dragging a slider thumb
    [marginSlider, offsetSlider, repeatSlider].forEach(el => {
        const wrap = el.closest('.slider-wrap');
        el.addEventListener('pointerdown', () => wrap.classList.add('dragging'));
    });
    window.addEventListener('pointerup', () => {
        document.querySelectorAll('.slider-wrap.dragging').forEach(w => w.classList.remove('dragging'));
    });

    ///////////////////////////////////
    ///////// --- Download --- ////////
    ///////////////////////////////////

    const download = () => {
        if (!hasImage) return;
        const link = document.createElement('a');
        link.download = `${fileName}.${exportExt}`;
        link.href = canvas.toDataURL(exportType, JPEG_QUALITY);
        link.click();
    };

    downloadBtn.onclick = download;

    document.addEventListener('keydown', (e) => {
        // Enter -> re-render + download
        if (e.key === 'Enter' && hasImage) {
            e.preventDefault();
            processImage();
            download();
            return;
        }
        // Shift + Arrow on a number field -> nudge by 10
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            const t = e.target;
            if (t === marginInput || t === offsetInput || t === repeatInput) {
                e.preventDefault();
                const step = e.key === 'ArrowUp' ? 10 : -10;
                if (t === offsetInput) {
                    applyOffsetValue((parseInt(offsetInput.value) || 0) + step);
                } else {
                    t.value = (parseInt(t.value) || 0) + step;
                    t.dispatchEvent(new Event('input'));
                }
            }
        }
    });

    ///////////////////////////////////
    ///// --- Margin controls --- /////
    ///////////////////////////////////

    // Interactive edits are coalesced to one rebuild per frame (rAF), matching
    // the canvas drags, so fast slider drags on large images can't queue up
    // multiple full processImage() passes within a single frame.
    marginSlider.oninput = () => {
        marginInput.value = marginSlider.value;
        scheduleProcessImage();
    };
    marginInput.oninput = () => {
        marginSlider.value = marginInput.value;
        scheduleProcessImage();
    };

    repeatSlider.oninput = () => {
        repeatInput.value = repeatSlider.value;
        scheduleProcessImage();
    };
    repeatInput.oninput = () => {
        repeatSlider.value = repeatInput.value;
        scheduleProcessImage();
    };

    ///////////////////////////////////
    ///// --- Offset controls --- /////
    ///////////////////////////////////

    function setOffsetMode(mode, reprocess = true) {
        offsetModeValue = mode;
        offsetModeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        if (reprocess) processImage();
    }

    // Central entry point for a raw offset value: snaps to detents
    // (0 / +m / -m) and lights the matching alignment button.
    function applyOffsetValue(raw, reprocess = true) {
        const m = getMargin();
        let val = Math.round(raw);

        const detents = [[0, 'center'], [m, 'top'], [-m, 'bottom']];
        for (const [d, mode] of detents) {
            if (Math.abs(val - d) <= SNAP) {
                offset = d;
                setOffsetMode(mode, reprocess);
                return;
            }
        }
        offset = val;
        offsetInput.value = val;
        offsetSlider.value = Math.max(parseInt(offsetSlider.min), Math.min(parseInt(offsetSlider.max), val));
        setOffsetMode('custom', reprocess);
    }

    offsetModeButtons.forEach(b => {
        b.onclick = () => setOffsetMode(b.dataset.mode);
    });

    // Seam blend mode
    seamBlendButtons.forEach(b => {
        b.onclick = () => {
            seamBlend = b.dataset.blend;
            seamBlendButtons.forEach(x => x.classList.toggle('active', x === b));
            processImage();
        };
    });

    trimButtons.forEach(b => {
        b.onclick = () => {
            trimDirection = b.dataset.trim;
            trimButtons.forEach(x => x.classList.toggle('active', x === b));
            processImage();
        };
    });

    // Preview background (transparent PNGs only; preview-only, export stays clear)
    pbgButtons.forEach(b => {
        b.onclick = () => {
            document.body.classList.remove('pbg-checker', 'pbg-white', 'pbg-black');
            document.body.classList.add('pbg-' + b.dataset.bg);
            pbgButtons.forEach(x => x.classList.toggle('active', x === b));
        };
    });

    offsetSlider.oninput = () => { applyOffsetValue(parseInt(offsetSlider.value) || 0, false); scheduleProcessImage(); };
    offsetInput.oninput = () => { applyOffsetValue(parseInt(offsetInput.value) || 0, false); scheduleProcessImage(); };

    ///////////////////////////////////
    //// --- Drag chip helpers --- ////
    ///////////////////////////////////

    function showChip(x, y, text) {
        dragChip.textContent = text;
        dragChip.style.left = x + 'px';
        dragChip.style.top = y + 'px';
        dragChip.classList.add('show');
    }
    function hideChip() { dragChip.classList.remove('show'); }

    ///////////////////////////////////
    //////////// --- Zoom --- /////////
    ///////////////////////////////////

    zoomWrapper.addEventListener('wheel', (e) => {
        if (!hasImage) return;
        e.preventDefault();
        zoomLevel += (-e.deltaY) * 0.002;
        zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel));
        zoomWrapper.querySelector('canvas').style.transform = `scale(${zoomLevel})`;
    }, { passive: false });

    zoomWrapper.addEventListener('dblclick', () => {
        zoomLevel = zoomLevel > 0.9 ? ZOOMED_OUT : DEFAULT_ZOOM;
        zoomWrapper.querySelector('canvas').style.transform = `scale(${zoomLevel})`;
    });

    ///////////////////////////////////
    // --- Right canvas -> margin --- /
    ///////////////////////////////////

    zoomWrapper.addEventListener('pointerdown', (e) => {
        if (!hasImage) return;
        isDraggingCanvas = true;
        startY = e.clientY;
        startMargin = parseInt(marginInput.value) || 0;
        document.getElementById('canvas-box-right').classList.add('dragging');
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDraggingCanvas) return;
        const delta = startY - e.clientY;
        let newMargin = Math.round(startMargin + delta * 0.5);
        newMargin = Math.max(0, Math.min(newMargin, 300));
        marginInput.value = newMargin;
        marginSlider.value = newMargin;
        showChip(e.clientX, e.clientY, `Margin ${newMargin}px`);
        scheduleProcessImage();
    });

    window.addEventListener('pointerup', () => {
        if (!isDraggingCanvas) return;
        isDraggingCanvas = false;
        document.getElementById('canvas-box-right').classList.remove('dragging');
        hideChip();
        processImageNow();
    });

    ///////////////////////////////////
    // --- Left canvas -> offset --- //
    ///////////////////////////////////

    const leftBox = document.querySelector('.canvas-box.left');

    leftBox.addEventListener('pointerdown', (e) => {
        if (!hasImage) return;
        isDraggingLeft = true;
        startYLeft = e.clientY;
        startOffset = offset;
        const rect = leftBox.querySelector('canvas').getBoundingClientRect();
        leftScaleFactor = rect.height ? (canvas.height / rect.height) : 1;
        leftBox.classList.add('dragging');
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDraggingLeft) return;
        const delta = e.clientY - startYLeft; // drag down -> shift content down
        const raw = startOffset + delta * leftScaleFactor;
        applyOffsetValue(raw, false);
        const sign = offset > 0 ? '+' : '';
        showChip(e.clientX, e.clientY, `Offset ${sign}${offset}px`);
        scheduleProcessImage();
    });

    window.addEventListener('pointerup', () => {
        if (!isDraggingLeft) return;
        isDraggingLeft = false;
        leftBox.classList.remove('dragging');
        hideChip();
        processImageNow();
    });

    // init slider fills on first paint
    refreshSliders();


