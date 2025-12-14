// Sequence Designer — app.js
(() => {
    const filesEl = document.getElementById('files');
    const timelineEl = document.getElementById('timeline');
    const svg = document.getElementById('connectorLayer');
    const logEl = document.getElementById('log');

    // i18n messages (Japanese)
    const MSG = {
        close: '閉じる',
        validationErrors: '検証エラー',
        jsonParseError: 'JSON解析エラー: ',
        invalidJson: '無効なJSON',
        notJsonFile: 'JSONファイルではありません',
        invalidTimeValues: '無効な時間値: ',
        multipleThreadEntryModules: '複数のスレッドエントリモジュール: ',
        inconsistentFromTo: 'from/toの関係に不整合: ',
        circularDependency: 'モジュール間で循環依存を検出: ',
        validationFailed: 'エラー: 検証に失敗しました — ポップアップを確認してください',
        failedToReadFiles: 'ファイルの読み込みに失敗しました: ',
        exportFailed: 'エクスポート失敗'
    };

    function log(s) { logEl.textContent = s }

    // show an in-page popup message (error/info)
    function showPopup(title, msg) {
        // remove existing
        const prev = document.getElementById('seq-popup'); if (prev) prev.remove();
        const overlay = document.createElement('div'); overlay.id = 'seq-popup'; overlay.className = 'popup-overlay';
        const content = document.createElement('div'); content.className = 'popup-content';
        content.innerHTML = `<h3>${title}</h3><p>${msg}</p>`;
        const btn = document.createElement('button'); btn.className = 'popup-close'; btn.textContent = MSG.close;
        btn.onclick = () => overlay.remove();
        content.appendChild(btn);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
    }

    // CSV parsing removed — app now accepts JSON-only inputs.

    function buildModulesFromFiles(filesMap) {
        const modules = {};
        const parseErrors = [];
        for (const name in filesMap) {
            // strip final extension (csv/json or others)
            const base = name.replace(/\.[^.]+$/, '');
            const text = (filesMap[name] || '').trim();
            let rows = [];
            let parsedAsJSON = false;
            if (text.startsWith('{') || text.startsWith('[')) {
                try {
                    const parsed = JSON.parse(text);
                    parsedAsJSON = true;
                    rows = Array.isArray(parsed) ? parsed : [parsed];
                } catch (e) {
                    parseErrors.push(`${name}: ${MSG.invalidJson} (${e.message})`);
                    continue;
                }
            } else {
                parseErrors.push(`${name}: ${MSG.notJsonFile}`);
                continue;
            }

            const m = { name: base, rawRows: rows, thread: null, time: 0, from: [], to: [], timeProvided: false };

            if (parsedAsJSON && rows.length === 1) {
                // JSON single-object spec: use fields directly
                const r = rows[0];
                if (r.thread != null && String(r.thread) !== '') m.thread = String(r.thread);
                if (r.time != null && r.time !== '') {
                    m.timeProvided = true;
                    const n = Number(r.time);
                    if (Number.isFinite(n)) m.time = n;
                }
                if (Array.isArray(r.from)) m.from = r.from.filter(x => x && String(x).toLowerCase() !== 'none');
                else if (r.from && String(r.from).toLowerCase() !== 'none') m.from.push(String(r.from));
                if (Array.isArray(r.to)) m.to = r.to.filter(x => x && String(x).toLowerCase() !== 'none');
                else if (r.to && String(r.to).toLowerCase() !== 'none') m.to.push(String(r.to));
            } else {
                // CSV-style rows or JSON array-of-rows: accumulate fields
                for (const r of rows) {
                    if (!r) continue;
                    if (r.thread && r.thread !== '') m.thread = r.thread;
                    if (r.time && r.time !== '') {
                        m.timeProvided = true;
                        const n = Number(r.time);
                        if (Number.isFinite(n)) m.time = n;
                    }
                    // handle from/to possibly being arrays (from JSON arrays inside CSV-array case)
                    if (Array.isArray(r.from)) {
                        for (const f of r.from) if (f && String(f).toLowerCase() !== 'none') m.from.push(String(f));
                    } else if (r.from && r.from !== '' && String(r.from).toLowerCase() !== 'none') m.from.push(r.from);
                    if (Array.isArray(r.to)) {
                        for (const t of r.to) if (t && String(t).toLowerCase() !== 'none') m.to.push(String(t));
                    } else if (r.to && r.to !== '' && String(r.to).toLowerCase() !== 'none') m.to.push(r.to);
                }
            }

            // normalize lists
            m.from = Array.from(new Set(m.from));
            m.to = Array.from(new Set(m.to));
            if (m.thread === null || m.thread === '') m.thread = '0';
            modules[base] = m;
        }
        return { modules, parseErrors };
    }

    function schedule(modules) {
        // threads map
        const threadAvail = {};
        const scheduled = {};
        const moduleNames = Object.keys(modules);
        // convert thread to string key
        for (const n of moduleNames) threadAvail[modules[n].thread] = 0;

        let remaining = new Set(moduleNames);
        let loopguard = 0;
        while (remaining.size > 0 && loopguard++ < 1000) {
            let progressed = false;
            for (const name of Array.from(remaining)) {
                const m = modules[name];
                const deps = m.from.filter(x => x && x !== '').map(x => x);
                const depsSatisfied = deps.every(d => {
                    // if referenced module not present, consider satisfied (or could warn)
                    const ref = modules[d] || null;
                    return !ref || (ref && scheduled[d]);
                });
                if (!depsSatisfied) continue;
                // compute earliest start
                const depFinish = deps.map(d => modules[d] && scheduled[d] ? scheduled[d].finish : 0);
                const depsMax = depFinish.length ? Math.max(...depFinish) : 0;
                const tAvail = threadAvail[m.thread] ?? 0;
                const start = Math.max(depsMax, tAvail);
                const dur = isFinite(m.time) ? m.time : 0;
                const finish = start + dur;
                scheduled[name] = { start, finish, thread: m.thread, dur };
                threadAvail[m.thread] = finish;
                remaining.delete(name);
                progressed = true;
            }
            if (!progressed) break; // cycle or unresolved
        }
        const cycles = remaining.size > 0 ? Array.from(remaining) : [];
        if (cycles.length > 0) console.warn('Unscheduled modules (possible cycles):', cycles);
        return { scheduled, cycles };
    }

    function render(modules, scheduled) {
        timelineEl.innerHTML = '';
        svg.innerHTML = '';
        // color map for source modules — use a palette for clearer distinct colors
        const colorMap = {};
        const palette = [
            '#1f78b4', '#33a02c', '#e31a1c', '#ff7f00', '#6a3d9a', '#b15928',
            '#a6cee3', '#b2df8a', '#fb9a99', '#fdbf6f', '#cab2d6', '#ffff99'
        ];
        function colorFor(name) {
            if (colorMap[name]) return colorMap[name];
            // simple hash to pick a palette index
            let h = 0; for (let i = 0; i < name.length; i++) h = (h * 131 + name.charCodeAt(i)) >>> 0;
            const idx = h % palette.length;
            const col = palette[idx];
            colorMap[name] = col; return col;
        }
        // collect threads
        const threads = Array.from(new Set(Object.values(modules).map(m => m.thread))).sort((a, b) => parseFloat(a) - parseFloat(b));
        const laneH = 110; // match CSS --lane-h
        const pad = 20;
        const totalDuration = Math.max(...Object.values(scheduled).map(s => s.finish), 100);
        // adaptive pixels per millisecond to ensure small-duration timelines get enough space
        // Increased values to provide more horizontal spacing across the timeline.
        const minPPM = 60; // minimum pixels per ms (was 30)
        const maxPPM = 320; // maximum pixels per ms (was 180)
        const targetWidth = 2000; // desired minimum width (was 1400)
        let ppm = Math.max(minPPM, Math.min(maxPPM, Math.floor(targetWidth / Math.max(1, totalDuration))));
        const width = Math.max(targetWidth, Math.ceil(totalDuration * ppm) + 400);
        const scale = ppm; // px per ms
        const lanes = {};
        threads.forEach((t, i) => {
            const lane = document.createElement('div');
            lane.className = 'lane';
            lane.style.height = laneH + 'px';
            lane.dataset.thread = t;
            lane.style.position = 'relative';
            lane.style.minWidth = width + 'px';
            const label = document.createElement('div'); label.className = 'laneLabel'; label.textContent = 'Thread ' + t;
            lane.appendChild(label);
            timelineEl.appendChild(lane);
            lanes[t] = { el: lane, index: i };
        });

        // create module boxes inside lanes (centered vertically)
        for (const name in scheduled) {
            const s = scheduled[name];
            const m = modules[name];
            const lane = lanes[s.thread];
            const box = document.createElement('div');
            box.className = 'module';
            box.dataset.name = name;
            const leftMargin = 200; // account for label area (increased)
            box.style.left = (s.start * scale + leftMargin) + 'px';
            // ensure a small visible width even for zero-duration modules
            box.style.width = Math.max(40, Math.round(s.dur * scale)) + 'px';
            box.style.top = '50%';
            box.style.transform = 'translateY(-50%)';
            // normal module rendering (no border/name color highlight)
            box.innerHTML = `<div class="name">${name}</div><div class="meta">${s.start} → ${s.finish} ms</div>`;
            // apply a left accent color to match outgoing arrows
            const boxColor = colorFor(name);
            box.style.borderLeft = `6px solid ${boxColor}`;
            lane.el = lane.el || lane;
            lane.el.appendChild(box);
        }

        // compute box rects using DOM geometry so arrows align to edges
        const boxRects = {};
        // ensure svg has the correct size
        svg.setAttribute('width', width);
        svg.setAttribute('height', threads.length * laneH + 80);
        svg.style.height = (threads.length * laneH + 80) + 'px';
        // reflow to get correct bounding boxes
        let svgRect = svg.getBoundingClientRect();

        // layout adjustment: ensure each module is positioned strictly to the right of its `from` modules
        // if necessary, shift the module right and propagate shifts to later modules on the same thread
        const DEP_GAP = 40; // pixels gap after from.right (increased for readability)
        // collect initial rects
        const rects = {};
        for (const name in scheduled) {
            const el = timelineEl.querySelector(`.module[data-name="${name}"]`);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            rects[name] = { el, left: r.left, width: r.width, laneIndex: lanes[scheduled[name].thread].index };
        }

        // sort modules by left (visual start) to process in-order
        const order = Object.keys(rects).sort((a, b) => rects[a].left - rects[b].left);

        for (const name of order) {
            const entry = rects[name];
            // compute max right of dependencies
            const deps = (modules[name].from || []).filter(d => d && d in rects);
            let maxRight = -Infinity;
            for (const d of deps) {
                const r = rects[d];
                if (!r) continue;
                const right = r.left + r.width;
                if (right > maxRight) maxRight = right;
            }
            if (maxRight === -Infinity) continue; // no deps
            const desiredLeft = Math.max(entry.left, maxRight + DEP_GAP);
            if (desiredLeft <= entry.left + 0.5) continue; // already ok (allow tiny epsilon)
            const delta = desiredLeft - entry.left;
            // shift this module
            const curLeftPx = parseFloat(entry.el.style.left || entry.el.getBoundingClientRect().left - svgRect.left);
            entry.el.style.left = (curLeftPx + delta) + 'px';
            // update its rect
            entry.left += delta;
            // propagate shift to later modules on same thread that would overlap
            for (const otherName in rects) {
                if (otherName === name) continue;
                const other = rects[otherName];
                if (other.laneIndex !== entry.laneIndex) continue;
                if (other.left >= entry.left - delta - 1) {
                    // if other is positioned at or after original, shift it by delta to preserve ordering
                    const otherCurLeftPx = parseFloat(other.el.style.left || other.el.getBoundingClientRect().left - svgRect.left);
                    other.el.style.left = (otherCurLeftPx + delta) + 'px';
                    other.left += delta;
                }
            }
            // update rects for dependencies that were shifted earlier may affect later ones, continue loop
        }

        // recompute svgRect after layout shifts
        svgRect = svg.getBoundingClientRect();
        for (const name in scheduled) {
            const el = timelineEl.querySelector(`.module[data-name="${name}"]`);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const left = (r.left - svgRect.left);
            const right = left + r.width;
            const cy = (r.top - svgRect.top) + r.height / 2;
            boxRects[name] = { left, right, cy };
        }

        // draw arrows for to relationships from right-edge to left-edge
        const svgNS = 'http://www.w3.org/2000/svg';
        for (const name in modules) {
            const m = modules[name];
            for (const tgt of m.to) {
                if (!(name in boxRects) || !(tgt in boxRects)) continue;
                const a = boxRects[name];
                const b = boxRects[tgt];
                const startX = a.right;
                const startY = a.cy;
                const endX = b.left;
                const endY = b.cy;
                const dx = Math.abs(endX - startX);
                const mx = Math.max(60, dx * 0.55);
                const d = `M ${startX} ${startY} C ${startX + mx} ${startY} ${endX - mx} ${endY} ${endX} ${endY}`;
                const path = document.createElementNS(svgNS, 'path');
                path.setAttribute('d', d);
                const col = colorFor(name);
                path.setAttribute('stroke', col);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linecap', 'round');
                svg.appendChild(path);

                // arrow head as a small left-pointing triangle at endX,endY
                const tri = document.createElementNS(svgNS, 'path');
                const px = 8; // triangle length
                const py = 5; // half height
                const triD = `M ${endX} ${endY} L ${endX - px} ${endY - py} L ${endX - px} ${endY + py} Z`;
                tri.setAttribute('d', triD);
                tri.setAttribute('fill', col);
                svg.appendChild(tri);
            }
        }

        timelineEl.style.minWidth = width + 'px';
    }

    function handleFiles(fileList) {
        const map = {};
        const readers = [];
        for (const f of fileList) {
            readers.push(new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => { map[f.name] = r.result; res(); };
                r.onerror = rej;
                r.readAsText(f);
            }));
        }
        return Promise.all(readers).then(() => map);
    }

    // removed sample and render buttons; files are auto-rendered on selection

    // Auto-render immediately after files are selected in the file input
    filesEl.addEventListener('change', () => {
        const fl = filesEl.files;
        if (!fl || fl.length === 0) { return; }
        handleFiles(fl).then(filesMap => {
            const res = buildModulesFromFiles(filesMap);
            const modules = res.modules || {};
            const errors = [];
            // collect parse errors (if any) instead of aborting immediately
            if (res.parseErrors && res.parseErrors.length > 0) {
                for (const pe of res.parseErrors) errors.push(MSG.jsonParseError + pe);
            }

            // validate: time values provided must be positive numbers (> 0)
            const badTimes = [];
            for (const name in modules) {
                const m = modules[name];
                if (m.timeProvided) {
                    if (!Number.isFinite(m.time) || m.time <= 0) {
                        badTimes.push(`${name}: ${m.time}`);
                    }
                }
            }
            if (badTimes.length > 0) errors.push(MSG.invalidTimeValues + badTimes.join(' ; '));

            // validate: each thread should have at most one module with no `from` (entry module)
            const threadStarts = {};
            for (const name in modules) {
                const m = modules[name];
                if (!m.from || m.from.length === 0) {
                    const t = String(m.thread || '0');
                    threadStarts[t] = threadStarts[t] || [];
                    threadStarts[t].push(name);
                }
            }
            const bad = Object.entries(threadStarts).filter(([t, arr]) => arr.length > 1);
            if (bad.length > 0) {
                const lines = bad.map(([t, arr]) => `Thread ${t}: ${arr.join(', ')}`);
                errors.push(MSG.multipleThreadEntryModules + lines.join(' ; '));
            }

            // validate from/to consistency: for every a.to contains b, b.from must contain a, and vice versa
            const inconsistencies = [];
            const fromSets = {}, toSets = {};
            for (const name in modules) {
                fromSets[name] = new Set((modules[name].from || []).filter(x => x));
                toSets[name] = new Set((modules[name].to || []).filter(x => x));
            }
            for (const a in toSets) {
                for (const b of toSets[a]) {
                    if (!(b in modules)) {
                        inconsistencies.push(`Module ${a} has to->${b} but module ${b} not found`);
                        continue;
                    }
                    if (!fromSets[b].has(a)) {
                        inconsistencies.push(`Mismatch: ${a} lists ${b} in to, but ${b} does not list ${a} in from`);
                    }
                }
            }
            for (const a in fromSets) {
                for (const b of fromSets[a]) {
                    if (!(b in modules)) {
                        inconsistencies.push(`Module ${a} has from->${b} but module ${b} not found`);
                        continue;
                    }
                    if (!toSets[b].has(a)) {
                        inconsistencies.push(`Mismatch: ${a} lists ${b} in from, but ${b} does not list ${a} in to`);
                    }
                }
            }
            if (inconsistencies.length > 0) errors.push(MSG.inconsistentFromTo + inconsistencies.join(' ; '));

            // schedule and check cycles
            const result = schedule(modules);
            if (result.cycles && result.cycles.length > 0) {
                errors.push(MSG.circularDependency + result.cycles.join(', '));
            }

            if (errors.length > 0) {
                showPopup(MSG.validationErrors, errors.map(e => ('* ' + e)).join('<br>'));
                log(MSG.validationFailed);
                return;
            }

            render(modules, result.scheduled);
            log('Auto-rendered ' + Object.keys(modules).length + ' modules');
        }).catch(err => { console.error(err); log(MSG.failedToReadFiles + err); });
    });

    // Export current diagram as an SVG file for download
    const exportBtn = document.getElementById('exportSvgBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        try {
            // Build an SVG snapshot: copy paths and render module boxes as SVG rects/text
            const svgRect = svg.getBoundingClientRect();
            const outW = parseFloat(svg.getAttribute('width')) || svgRect.width;
            const outH = parseFloat(svg.getAttribute('height')) || svgRect.height;
            const xmlns = 'http://www.w3.org/2000/svg';
            const out = document.createElementNS(xmlns, 'svg');
            out.setAttribute('xmlns', xmlns);
            out.setAttribute('width', outW);
            out.setAttribute('height', outH);
            out.setAttribute('viewBox', `0 0 ${outW} ${outH}`);

            // embed basic styles to match page fonts and simple text styling
            const styleEl = document.createElementNS(xmlns, 'style');
            let fontFamily = 'sans-serif';
            try { fontFamily = window.getComputedStyle(document.body).fontFamily || fontFamily; } catch (e) { }
            const cssText = `
                /* embedded from page to make exported SVG match HTML */
                text { font-family: ${fontFamily}; }
                .module-name { font-size:13px; font-weight:600; }
                .module-meta { font-size:11px; fill:#333; }
                rect.module-rect { rx:6; }
                .lane-label { font-size:14px; font-weight:700; fill:#111; }
            `;
            styleEl.textContent = cssText;
            out.appendChild(styleEl);

            // clone connector paths and other SVG children
            const clones = svg.querySelectorAll('path');
            for (const c of clones) out.appendChild(c.cloneNode(true));

            // render module rectangles and labels
            const modulesGroup = document.createElementNS(xmlns, 'g');
            const moduleEls = timelineEl.querySelectorAll('.module');
            const baseRect = svg.getBoundingClientRect();
            // render lane/thread labels
            const lanesGroup = document.createElementNS(xmlns, 'g');
            const laneEls = timelineEl.querySelectorAll('.lane');
            for (const laneEl of laneEls) {
                const labelEl = laneEl.querySelector('.laneLabel');
                if (!labelEl) continue;
                const lr = laneEl.getBoundingClientRect();
                const lx = (lr.left - baseRect.left) + 12; // small inset from left
                const ly = (lr.top - baseRect.top) + (lr.height / 2) + 6; // center-ish baseline
                const text = document.createElementNS(xmlns, 'text');
                text.setAttribute('class', 'lane-label');
                text.setAttribute('x', lx);
                text.setAttribute('y', ly);
                text.textContent = labelEl.textContent || '';
                lanesGroup.appendChild(text);
            }
            out.appendChild(lanesGroup);
            for (const el of moduleEls) {
                const name = el.dataset.name || '';
                const r = el.getBoundingClientRect();
                const left = r.left - baseRect.left;
                const top = r.top - baseRect.top;
                const w = r.width;
                const h = r.height;
                const cs = window.getComputedStyle(el);
                const fill = cs.backgroundColor || '#ffffff';
                const stroke = cs.borderLeftColor || '#000000';

                const rect = document.createElementNS(xmlns, 'rect');
                rect.setAttribute('class', 'module-rect');
                rect.setAttribute('x', left);
                rect.setAttribute('y', top);
                rect.setAttribute('width', w);
                rect.setAttribute('height', h);
                rect.setAttribute('rx', 6);
                rect.setAttribute('fill', fill);
                rect.setAttribute('stroke', '#aaa');
                rect.setAttribute('stroke-width', 1);
                modulesGroup.appendChild(rect);

                // left accent as smaller rect
                const accent = document.createElementNS(xmlns, 'rect');
                accent.setAttribute('class', 'module-accent');
                accent.setAttribute('x', left);
                accent.setAttribute('y', top);
                accent.setAttribute('width', 6);
                accent.setAttribute('height', h);
                accent.setAttribute('fill', stroke);
                modulesGroup.appendChild(accent);

                // name text
                const nameEl = document.createElementNS(xmlns, 'text');
                nameEl.setAttribute('class', 'module-name');
                nameEl.setAttribute('x', left + 10 + 0);
                nameEl.setAttribute('y', top + 18);
                nameEl.setAttribute('font-size', '13');
                nameEl.setAttribute('fill', cs.color || '#000');
                nameEl.textContent = name;
                modulesGroup.appendChild(nameEl);

                // meta text (start→finish) if present
                const meta = el.querySelector('.meta');
                if (meta) {
                    const metaEl = document.createElementNS(xmlns, 'text');
                    metaEl.setAttribute('class', 'module-meta');
                    metaEl.setAttribute('x', left + 10);
                    metaEl.setAttribute('y', top + h - 8);
                    metaEl.setAttribute('font-size', '11');
                    metaEl.setAttribute('fill', '#333');
                    metaEl.textContent = meta.textContent || '';
                    modulesGroup.appendChild(metaEl);
                }
            }
            out.appendChild(modulesGroup);

            const serializer = new XMLSerializer();
            const str = serializer.serializeToString(out);
            const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sequence-diagram.svg';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) {
            console.error('Export SVG failed', e);
            showPopup(MSG.exportFailed, String(e));
        }
    });
})();
