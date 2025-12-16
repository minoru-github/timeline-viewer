// Sequence Designer — app.js
(() => {
    const filesEl = document.getElementById('files');
    const timelineEl = document.getElementById('timeline');
    const svg = document.getElementById('connectorLayer');
    const logEl = document.getElementById('log');
    // current state kept so DnD can update threads and re-schedule
    let currentModules = {};
    let currentScheduled = {};
    // undo history: list of module snapshots (deep-cloned objects)
    const history = [];
    const MAX_HISTORY = 100;
    // redo stack for undone snapshots
    const redoStack = [];

    function pushRedo(modules) {
        try {
            const snap = JSON.parse(JSON.stringify(modules));
            redoStack.push(snap);
            if (redoStack.length > MAX_HISTORY) redoStack.shift();
            setRedoButtonState(true);
        } catch (e) { console.warn('pushRedo failed', e); }
    }

    function popRedo() {
        if (redoStack.length === 0) return null;
        const s = redoStack.pop();
        setRedoButtonState(redoStack.length > 0);
        return s;
    }

    function clearRedo() { redoStack.length = 0; setRedoButtonState(false); }

    function setRedoButtonState(enabled) {
        const btn = document.getElementById('redoBtn');
        if (!btn) return;
        btn.disabled = !enabled;
    }

    function pushHistory(modules) {
        try {
            const snap = JSON.parse(JSON.stringify(modules));
            history.push(snap);
            if (history.length > MAX_HISTORY) history.shift();
            setUndoButtonState(true);
            // a new user action invalidates redo history
            clearRedo();
        } catch (e) { console.warn('pushHistory failed', e); }
    }

    function popHistory() {
        if (history.length === 0) return null;
        const s = history.pop();
        setUndoButtonState(history.length > 0);
        return s;
    }

    function clearHistory() { history.length = 0; setUndoButtonState(false); clearRedo(); }


    function setUndoButtonState(enabled) {
        const btn = document.getElementById('undoBtn');
        if (!btn) return;
        btn.disabled = !enabled;
    }

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
        exportFailed: 'エクスポートに失敗しました'
        , ambiguousOrdering: '同一スレッド上の順序が不明: '
        , renderFailed: 'レンダリング中にエラーが発生しました: '
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

    // Clear internal UI/state before selecting new files
    if (filesEl) {
        filesEl.addEventListener('click', () => {
            try {
                // clear in-memory structures
                currentModules = {};
                currentScheduled = {};
                // clear history/redo stacks
                clearHistory();
                clearRedo();
                // clear selection state
                if (typeof selectedConnector !== 'undefined' && selectedConnector) {
                    try { selectedConnector.classList.remove('selected'); } catch (e) { }
                    selectedConnector = null;
                }
                clearCtrlSource();
                // clear UI panels and timeline
                displayValidationErrors([]);
                if (timelineEl) timelineEl.innerHTML = '';
                if (svg) svg.innerHTML = '';
                const delBtn = document.getElementById('deleteArrowBtn'); if (delBtn) delBtn.disabled = true;
                setUndoButtonState(false);
                setRedoButtonState(false);
                // Reset the file input value so selecting the same file again will fire `change`
                try { filesEl.value = ''; } catch (e) { }
                log('Cleared current state for new file selection');
            } catch (e) { console.warn('Failed to clear state on file select', e); }
        });
    }

    // --- Add Module UI handlers ---
    const addModuleBtn = document.getElementById('addModuleBtn');
    const addModuleModal = document.getElementById('addModuleModal');
    const amThread = document.getElementById('am-thread');
    const amName = document.getElementById('am-name');
    const amTime = document.getElementById('am-time');
    const amFrom = document.getElementById('am-from');
    const amTo = document.getElementById('am-to');
    const amCancel = document.getElementById('am-cancel');
    const amCreate = document.getElementById('am-create');
    let editingModuleId = null;

    function openAddModule() {
        // populate thread and selections from currentModules
        const threads = Array.from(new Set(Object.values(currentModules).map(m => String(m.thread || (m.name && m.name.split(':')[0]) || '0')))).sort();
        amThread.value = threads.length ? threads[0] : '0';
        // populate module lists
        populateAddModuleLists();
        if (addModuleModal) addModuleModal.classList.add('open');
        if (amName) amName.focus();
    }

    function openModuleEditor(moduleId) {
        if (!moduleId || !currentModules[moduleId]) { openAddModule(); return; }
        const m = currentModules[moduleId];
        populateAddModuleLists();
        editingModuleId = moduleId;
        // populate fields
        try {
            amThread.value = String(m.thread || (m.name && m.name.split(':')[0]) || '0');
            amName.value = String(m.shortName || (m.name && m.name.split(':')[1]) || '');
            amTime.value = m.timeProvided ? String(m.time) : '';
            // select from/to options
            const fromVals = new Set(m.from || []);
            const toVals = new Set(m.to || []);
            for (const opt of (amFrom && amFrom.options) || []) opt.selected = fromVals.has(opt.value);
            for (const opt of (amTo && amTo.options) || []) opt.selected = toVals.has(opt.value);
            // change button text to Save
            if (amCreate) amCreate.textContent = '保存';
        } catch (e) { console.warn('openModuleEditor failed', e); }
        if (addModuleModal) addModuleModal.classList.add('open');
        if (amName) amName.focus();
    }

    function closeAddModule() {
        if (addModuleModal) addModuleModal.classList.remove('open');
        // clear fields
        try { amName.value = ''; amTime.value = ''; amFrom.innerHTML = ''; amTo.innerHTML = ''; } catch (e) { }
        // reset edit state
        editingModuleId = null;
        if (amCreate) amCreate.textContent = '作成';
    }

    function populateAddModuleLists() {
        // options are current module ids with readable labels
        const keys = Object.keys(currentModules || {}).sort();
        const makeOpt = (id) => {
            const m = currentModules[id];
            const label = m && m.shortName ? `${m.thread}:${m.shortName}` : id;
            return `<option value="${id}">${label}</option>`;
        };
        if (amFrom) amFrom.innerHTML = keys.map(makeOpt).join('');
        if (amTo) amTo.innerHTML = keys.map(makeOpt).join('');
    }

    if (addModuleBtn) addModuleBtn.addEventListener('click', (ev) => { ev.preventDefault(); openAddModule(); });
    if (amCancel) amCancel.addEventListener('click', (ev) => { ev.preventDefault(); closeAddModule(); });

    if (amCreate) amCreate.addEventListener('click', (ev) => {
        ev.preventDefault();
        const thread = String((amThread && amThread.value) || '0').trim();
        const short = String((amName && amName.value) || '').trim();
        const timeVal = (amTime && amTime.value) ? Number(amTime.value) : null;
        if (!short) { showPopup('Invalid', 'Module name is required'); return; }
        // collect from/to selections
        const fromSel = Array.from((amFrom && amFrom.selectedOptions) || []).map(o => o.value);
        const toSel = Array.from((amTo && amTo.selectedOptions) || []).map(o => o.value);

        // If editing an existing module
        if (editingModuleId) {
            const oldId = editingModuleId;
            if (!currentModules[oldId]) { showPopup('Error', 'Module not found'); editingModuleId = null; if (amCreate) amCreate.textContent = '作成'; return; }
            // determine new id and ensure uniqueness (allow same id if unchanged)
            let newId = `${thread}:${short}`;
            if (newId !== oldId) {
                let suffix = 1;
                while (currentModules[newId]) {
                    newId = `${thread}:${short}_${suffix++}`;
                }
            }
            try { pushHistory(currentModules || {}); } catch (e) { console.warn('pushHistory failed', e); }
            const m = currentModules[oldId];
            const prevFrom = Array.from(m.from || []);
            const prevTo = Array.from(m.to || []);
            // update or rename in map
            if (newId !== oldId) {
                currentModules[newId] = m;
                delete currentModules[oldId];
            }
            m.name = newId;
            m.thread = thread;
            m.shortName = short;
            m.timeProvided = false;
            if (timeVal != null && Number.isFinite(timeVal) && timeVal > 0) { m.time = timeVal; m.timeProvided = true; }
            // set new from/to (deduped)
            m.from = Array.from(new Set(fromSel));
            m.to = Array.from(new Set(toSel));

            // update DOM data-name if renamed
            try {
                const domEl = timelineEl.querySelector(`.module[data-name="${oldId}"]`);
                if (domEl) { domEl.dataset.name = newId; domEl.setAttribute('data-name', newId); }
            } catch (e) { console.warn('Failed to update DOM data-name on edit', e); }

            // replace oldId references across all modules
            const allKeys = Object.keys(currentModules);
            for (const k of allKeys) {
                const mm = currentModules[k];
                if (!mm) continue;
                if (Array.isArray(mm.from) && mm.from.length) mm.from = mm.from.map(x => x === oldId ? newId : x);
                if (Array.isArray(mm.to) && mm.to.length) mm.to = mm.to.map(x => x === oldId ? newId : x);
            }

            // adjust reciprocal references: ensure selected from/to point back to this module
            for (const f of m.from) {
                if (!currentModules[f]) continue;
                currentModules[f].to = Array.from(new Set((currentModules[f].to || []).concat([m.name])));
            }
            for (const t of m.to) {
                if (!currentModules[t]) continue;
                currentModules[t].from = Array.from(new Set((currentModules[t].from || []).concat([m.name])));
            }

            // remove reciprocals that were present before but not selected now
            for (const f of prevFrom) {
                if (!m.from.includes(f) && currentModules[f]) {
                    currentModules[f].to = (currentModules[f].to || []).filter(x => x !== m.name);
                }
            }
            for (const t of prevTo) {
                if (!m.to.includes(t) && currentModules[t]) {
                    currentModules[t].from = (currentModules[t].from || []).filter(x => x !== m.name);
                }
            }

            // done editing
            editingModuleId = null;
            if (amCreate) amCreate.textContent = '作成';
            // revalidate and render
            const vres = validateModules(currentModules);
            currentScheduled = vres.scheduled || {};
            displayValidationErrors(vres.errors || []);
            try { render(currentModules, currentScheduled); } catch (e) { displayValidationErrors([{ type: 'render', msg: MSG.renderFailed + ': ' + e.message }]); }
            closeAddModule();
            log('Edited module ' + m.name);
            return;
        }

        // create-new flow (unchanged)
        let newId = `${thread}:${short}`;
        let suffix = 1;
        while (currentModules[newId]) {
            newId = `${thread}:${short}_${suffix++}`;
        }

        // create module object
        const m = { name: newId, shortName: short, thread: thread, time: 0, from: [], to: [], timeProvided: false };
        if (timeVal != null && Number.isFinite(timeVal) && timeVal > 0) { m.time = timeVal; m.timeProvided = true; }
        m.from = Array.from(new Set(fromSel));
        m.to = Array.from(new Set(toSel));

        // push history and add to currentModules
        try { pushHistory(currentModules || {}); } catch (e) { console.warn('pushHistory failed', e); }
        currentModules[newId] = m;

        // update reciprocal references on existing modules
        for (const f of m.from) {
            if (!currentModules[f]) continue;
            currentModules[f].to = Array.from(new Set((currentModules[f].to || []).concat([newId])));
        }
        for (const t of m.to) {
            if (!currentModules[t]) continue;
            currentModules[t].from = Array.from(new Set((currentModules[t].from || []).concat([newId])));
        }

        // revalidate, schedule and render
        const vres = validateModules(currentModules);
        currentScheduled = vres.scheduled || {};
        displayValidationErrors(vres.errors || []);
        try { render(currentModules, currentScheduled); } catch (e) { displayValidationErrors([{ type: 'render', msg: MSG.renderFailed + ': ' + e.message }]); }
        log('Created module ' + newId);
        closeAddModule();
    });
    // show or remove inline error panel and popup for given errors array
    function displayValidationErrors(errors, opts) {
        opts = opts || {};
        const showPopupFlag = opts.popup === undefined ? true : Boolean(opts.popup);
        const errorPanelId = 'errorPanel';
        const existingErrPanel = document.getElementById(errorPanelId);
        if (errors && errors.length > 0) {
            if (showPopupFlag) showPopup(MSG.validationErrors, errors.map(e => ('* ' + e)).join('<br>'));
            if (showPopupFlag) log(MSG.validationFailed);
            let errPanel = existingErrPanel;
            if (!errPanel) {
                errPanel = document.createElement('div');
                errPanel.id = errorPanelId;
                errPanel.className = 'error-panel';
                if (timelineEl && timelineEl.parentNode) timelineEl.parentNode.appendChild(errPanel);
                else document.body.appendChild(errPanel);
            }
            errPanel.innerHTML = `<div class="error-header"><strong>${MSG.validationErrors}</strong></div><ul>` + errors.map(e => `<li>${e}</li>`).join('') + '</ul>';
        } else {
            if (existingErrPanel) existingErrPanel.remove();
        }
    }

    // CSV parsing removed — app now accepts JSON-only inputs.

    function buildModulesFromFiles(filesMap) {
        // New spec: each JSON file's basename is the `thread` name. Each file contains
        // an array of module objects: { module, time, from:[{thread,module}], to:[{thread,module}] }
        const modules = {};
        const parseErrors = [];
        for (const fname in filesMap) {
            const baseThread = fname.replace(/\.[^.]+$/, '');
            const text = (filesMap[fname] || '').trim();
            if (!text) continue;
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                parseErrors.push(`${fname}: ${MSG.invalidJson} (${e.message})`);
                continue;
            }

            // handle array-of-modules format
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            for (const r of rows) {
                if (!r || !r.module) continue;
                const short = String(r.module);
                const id = `${baseThread}:${short}`;
                const m = { name: id, shortName: short, thread: String(baseThread), time: 0, from: [], to: [], timeProvided: false };
                if (r.time != null && r.time !== '') {
                    m.timeProvided = true;
                    const n = Number(r.time);
                    if (Number.isFinite(n)) m.time = n;
                }
                // from/to entries expected to be arrays of {thread,module}
                if (Array.isArray(r.from)) {
                    for (const f of r.from) {
                        if (!f || !f.module) continue;
                        const ft = String(f.thread || baseThread);
                        const fm = String(f.module);
                        if (ft.toLowerCase() === 'none' || fm.toLowerCase() === 'none') continue;
                        m.from.push(`${ft}:${fm}`);
                    }
                }
                if (Array.isArray(r.to)) {
                    for (const t of r.to) {
                        if (!t || !t.module) continue;
                        const tt = String(t.thread || baseThread);
                        const tm = String(t.module);
                        if (tt.toLowerCase() === 'none' || tm.toLowerCase() === 'none') continue;
                        m.to.push(`${tt}:${tm}`);
                    }
                }
                // dedupe
                m.from = Array.from(new Set(m.from));
                m.to = Array.from(new Set(m.to));
                modules[id] = m;
            }
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

    // Validate modules: returns { errors: string[], scheduled, cycles }
    function validateModules(modules) {
        const errors = [];
        if (!modules) return { errors, scheduled: {}, cycles: [] };
        // time value checks
        const badTimes = [];
        for (const name in modules) {
            const m = modules[name];
            if (m.timeProvided) {
                if (!Number.isFinite(m.time) || m.time <= 0) badTimes.push(`${name}: ${m.time}`);
            }
        }
        if (badTimes.length) errors.push(MSG.invalidTimeValues + badTimes.join(' ; '));

        // thread entry checks (at most one module with no from per thread)
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
            const lines = bad.map(([t, arr]) => `スレッド ${t}: ${arr.join(', ')}`);
            errors.push(MSG.multipleThreadEntryModules + lines.join(' ; '));
        }

        // from/to consistency
        const inconsistencies = [];
        const fromSets = {}, toSets = {};
        for (const name in modules) {
            fromSets[name] = new Set((modules[name].from || []).filter(x => x));
            toSets[name] = new Set((modules[name].to || []).filter(x => x));
        }
        for (const a in toSets) {
            for (const b of toSets[a]) {
                if (!(b in modules)) {
                    inconsistencies.push(`モジュール ${b} が見つかりません（${a} の to に ${b} が含まれています）`);
                    continue;
                }
                if (!fromSets[b].has(a)) inconsistencies.push(`不整合: ${a} は to に ${b} を含みますが、${b} の from に ${a} がありません`);
            }
        }
        for (const a in fromSets) {
            for (const b of fromSets[a]) {
                if (!(b in modules)) {
                    inconsistencies.push(`モジュール ${b} が見つかりません（${a} の from に ${b} が含まれています）`);
                    continue;
                }
                if (!toSets[b].has(a)) inconsistencies.push(`不整合: ${a} は from に ${b} を含みますが、${b} の to に ${a} がありません`);
            }
        }
        if (inconsistencies.length > 0) errors.push(MSG.inconsistentFromTo + inconsistencies.join(' ; '));

        // same-thread ambiguous ordering
        const adj = {};
        for (const name in modules) adj[name] = new Set((modules[name].to || []).filter(x => x));
        const reachable = {};
        for (const name in modules) {
            const seen = new Set();
            const stack = Array.from(adj[name] || []);
            while (stack.length) {
                const v = stack.pop();
                if (!v || seen.has(v)) continue;
                seen.add(v);
                const next = adj[v];
                if (next) for (const w of next) if (!seen.has(w)) stack.push(w);
            }
            reachable[name] = seen;
        }
        const threadAmbiguities = [];
        const byThread = {};
        for (const name in modules) {
            const t = String(modules[name].thread || '0');
            (byThread[t] = byThread[t] || []).push(name);
        }
        for (const t in byThread) {
            const arr = byThread[t];
            if (arr.length <= 1) continue;
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    const a = arr[i], b = arr[j];
                    const aToB = reachable[a] && reachable[a].has(b);
                    const bToA = reachable[b] && reachable[b].has(a);
                    if (!aToB && !bToA) threadAmbiguities.push(`スレッド ${t}: ${a} と ${b} の実行順序が不明`);
                }
            }
        }
        if (threadAmbiguities.length > 0) errors.push(MSG.ambiguousOrdering + threadAmbiguities.join(' ; '));

        // cycles via schedule
        const res = schedule(modules);
        if (res.cycles && res.cycles.length > 0) errors.push(MSG.circularDependency + res.cycles.join(', '));

        return { errors, scheduled: res.scheduled, cycles: res.cycles };
    }

    function attachDragHandlers(modules) {
        // modules: current modules map; lanes and module elements exist in DOM
        const moduleEls = timelineEl.querySelectorAll('.module');
        moduleEls.forEach(el => {
            el.setAttribute('draggable', 'true');
            el.addEventListener('dragstart', (ev) => {
                // If Control is held, disable dragging (Ctrl used for ctrl-click selection)
                if (ev.ctrlKey) { ev.preventDefault(); return; }
                const name = el.dataset.name;
                try { ev.dataTransfer.setData('text/plain', name); ev.dataTransfer.effectAllowed = 'move'; } catch (e) { }
                el.classList.add('dragging');
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
            });
        });

        // lane handlers must be attached separately to avoid referencing undefined `lane`
        const laneEls = timelineEl.querySelectorAll('.lane');
        laneEls.forEach(lane => {
            lane.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                try { ev.dataTransfer.dropEffect = 'move'; } catch (e) { }
                lane.classList.add('drag-over');
            });
            lane.addEventListener('dragleave', () => lane.classList.remove('drag-over'));
            lane.addEventListener('drop', (ev) => {
                ev.preventDefault();
                lane.classList.remove('drag-over');
                let name = null;
                try { name = ev.dataTransfer.getData('text/plain'); } catch (e) { }
                if (!name) return;
                const targetThread = lane.dataset.thread;
                if (!modules[name]) return;
                // record history snapshot before changing
                pushHistory(modules);
                const oldId = name;
                const mObj = modules[oldId];
                if (!mObj) return;
                const prevThread = mObj.thread;
                // compute short name and new id for the moved module
                const shortName = mObj.shortName || (oldId.includes(':') ? oldId.split(':')[1] : oldId);
                let newId = `${targetThread}:${shortName}`;
                // ensure newId is unique (append suffix if collision)
                if (newId !== oldId) {
                    let suffix = 1;
                    while (modules[newId]) {
                        newId = `${targetThread}:${shortName}_${suffix++}`;
                    }
                }
                // rename key in modules map and update module metadata
                modules[newId] = mObj;
                delete modules[oldId];
                mObj.name = newId;
                mObj.thread = String(targetThread);
                mObj.shortName = shortName;
                // update the DOM module element's data-name attribute so event handlers and queries remain consistent
                try {
                    const domEl = timelineEl.querySelector(`.module[data-name="${oldId}"]`);
                    if (domEl) {
                        domEl.dataset.name = newId;
                        domEl.setAttribute('data-name', newId);
                    }
                } catch (e) {
                    console.warn('Failed to update DOM data-name for moved module', e);
                }
                // update all references across modules: replace oldId with newId in from/to arrays
                const allKeys = Object.keys(modules);
                for (const k of allKeys) {
                    const mm = modules[k];
                    if (!mm) continue;
                    if (Array.isArray(mm.from) && mm.from.length) {
                        mm.from = mm.from.map(x => x === oldId ? newId : x);
                    }
                    if (Array.isArray(mm.to) && mm.to.length) {
                        mm.to = mm.to.map(x => x === oldId ? newId : x);
                    }
                }
                // update `name` variable to point to the moved module's new id for subsequent logic
                name = newId;

                // determine drop X coordinate relative to viewport
                const dropX = ev.clientX;
                // find other modules in the same lane (after change)
                const candidates = Array.from(lane.querySelectorAll('.module'))
                    .filter(el => el.dataset && el.dataset.name && el.dataset.name !== name);

                // pick immediate left and right neighbors by center X
                let leftNeighbor = null;
                let rightNeighbor = null;
                let leftDist = Infinity;
                let rightDist = Infinity;
                for (const el of candidates) {
                    const r = el.getBoundingClientRect();
                    const cx = r.left + r.width / 2;
                    if (cx < dropX) {
                        const d = dropX - cx;
                        if (d < leftDist) { leftDist = d; leftNeighbor = { el, cx }; }
                    } else {
                        const d = cx - dropX;
                        if (d < rightDist) { rightDist = d; rightNeighbor = { el, cx }; }
                    }
                }

                // (connector selection and delete handler moved to top-level)

                // ensure arrays exist on moved module
                modules[name].from = modules[name].from || [];
                modules[name].to = modules[name].to || [];

                // if left neighbor exists, set left -> moved
                if (leftNeighbor) {
                    const otherName = leftNeighbor.el.dataset.name;
                    modules[name].from = modules[name].from || [];
                    modules[otherName].to = modules[otherName].to || [];
                    if (!modules[name].from.includes(otherName)) modules[name].from.push(otherName);
                    if (!modules[otherName].to.includes(name)) modules[otherName].to.push(name);
                }

                // if right neighbor exists, set moved -> right
                if (rightNeighbor) {
                    const otherName = rightNeighbor.el.dataset.name;
                    modules[name].to = modules[name].to || [];
                    modules[otherName].from = modules[otherName].from || [];
                    if (!modules[name].to.includes(otherName)) modules[name].to.push(otherName);
                    if (!modules[otherName].from.includes(name)) modules[otherName].from.push(name);
                }

                // dedupe arrays for involved modules
                if (leftNeighbor) {
                    const o = leftNeighbor.el.dataset.name;
                    modules[o].to = Array.from(new Set(modules[o].to || []));
                    modules[name].from = Array.from(new Set(modules[name].from || []));
                }
                if (rightNeighbor) {
                    const o = rightNeighbor.el.dataset.name;
                    modules[o].from = Array.from(new Set(modules[o].from || []));
                    modules[name].to = Array.from(new Set(modules[name].to || []));
                }

                // If the moved module was inserted between a left and right neighbor,
                // remove any direct dependency links between left and right (a <-> c),
                // and ensure links are a -> moved and moved -> c.
                if (leftNeighbor && rightNeighbor) {
                    const aName = leftNeighbor.el.dataset.name;
                    const cName = rightNeighbor.el.dataset.name;
                    try {
                        // remove any references between a and c in both to/from arrays
                        if (modules[aName]) {
                            modules[aName].to = (modules[aName].to || []).filter(x => x !== cName);
                            modules[aName].from = (modules[aName].from || []).filter(x => x !== cName);
                        }
                        if (modules[cName]) {
                            modules[cName].to = (modules[cName].to || []).filter(x => x !== aName);
                            modules[cName].from = (modules[cName].from || []).filter(x => x !== aName);
                        }
                        // also ensure the moved module is present in the correct arrays (defensive)
                        modules[name].from = Array.from(new Set(modules[name].from || []));
                        modules[name].to = Array.from(new Set(modules[name].to || []));
                    } catch (e) {
                        console.warn('Failed to adjust neighbor relations after insert', e);
                    }
                }

                const res = schedule(modules);
                currentModules = modules;
                currentScheduled = res.scheduled;
                // if scheduling produced cycles, show them in the error panel and popup
                const dropErrors = [];
                if (res.cycles && res.cycles.length > 0) {
                    dropErrors.push(MSG.circularDependency + res.cycles.join(', '));
                    displayValidationErrors(dropErrors);
                } else {
                    // clear any previous error panel related to drop
                    displayValidationErrors([]);
                }
                try {
                    render(modules, res.scheduled);
                    // build human-readable neighbor info
                    let neighborInfo = '';
                    if (leftNeighbor && rightNeighbor) {
                        neighborInfo = ` (between ${leftNeighbor.el.dataset.name} and ${rightNeighbor.el.dataset.name})`;
                    } else if (leftNeighbor) {
                        neighborInfo = ` (after ${leftNeighbor.el.dataset.name})`;
                    } else if (rightNeighbor) {
                        neighborInfo = ` (before ${rightNeighbor.el.dataset.name})`;
                    }
                    log(`Moved ${name} → thread ${targetThread}` + neighborInfo);
                } catch (e) {
                    console.error('Render after drop failed', e);
                    showPopup(MSG.renderFailed, String(e && e.message ? e.message : e));
                    log(MSG.renderFailed + (e && e.message ? e.message : String(e)));
                }
            });
        });
    }

    // Selection state and Delete-key handler for connectors (top-level)
    let selectedConnector = null;
    function selectArrow(el) {
        if (selectedConnector && selectedConnector !== el) {
            selectedConnector.classList.remove('selected');
        }
        if (selectedConnector === el) {
            el.classList.remove('selected');
            selectedConnector = null;
            // disable delete button when nothing selected
            const delBtn0 = document.getElementById('deleteArrowBtn'); if (delBtn0) delBtn0.disabled = true;
            return;
        }
        el.classList.add('selected');
        selectedConnector = el;
        // enable delete button when selected
        const delBtn = document.getElementById('deleteArrowBtn'); if (delBtn) delBtn.disabled = false;
    }

    // Ctrl-click dependency builder state
    let ctrlSourceName = null;
    function setCtrlSource(name) {
        // clear previous visual
        if (ctrlSourceName) {
            const prev = timelineEl.querySelector(`.module[data-name="${ctrlSourceName}"]`);
            if (prev) prev.classList.remove('ctrl-source');
        }
        ctrlSourceName = name;
        if (ctrlSourceName) {
            const el = timelineEl.querySelector(`.module[data-name="${ctrlSourceName}"]`);
            if (el) el.classList.add('ctrl-source');
        }
    }
    function clearCtrlSource() {
        if (!ctrlSourceName) return;
        const el = timelineEl.querySelector(`.module[data-name="${ctrlSourceName}"]`);
        if (el) el.classList.remove('ctrl-source');
        ctrlSourceName = null;
    }

    // clear ctrl source when Control is released
    document.addEventListener('keyup', (ev) => {
        if (ev.key === 'Control') clearCtrlSource();
    });

    // click elsewhere clears selection
    document.addEventListener('click', (ev) => {
        if (!selectedConnector) return;
        // if click target is within the selected connector, ignore
        if (ev.target && (ev.target.classList && (ev.target.classList.contains('connector-path') || ev.target.classList.contains('connector-tri')))) return;
        selectedConnector.classList.remove('selected');
        selectedConnector = null;
        const delBtn = document.getElementById('deleteArrowBtn'); if (delBtn) delBtn.disabled = true;
    });

    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Delete' && ev.key !== 'Del') return;
        if (!selectedConnector) return;
        deleteSelected(true);
    });

    // shared deletion routine used by Delete key and Delete Arrow button
    function deleteSelected(showPopup) {
        if (!selectedConnector) return;
        const src = selectedConnector.dataset.src;
        const tgt = selectedConnector.dataset.tgt;
        if (!src || !tgt) return;
        try { pushHistory(currentModules || {}); } catch (e) { console.warn('pushHistory failed', e); }
        if (currentModules[src]) currentModules[src].to = (currentModules[src].to || []).filter(x => x !== tgt);
        if (currentModules[tgt]) currentModules[tgt].from = (currentModules[tgt].from || []).filter(x => x !== src);
        // clear selection and disable button
        try { selectedConnector.classList.remove('selected'); } catch (e) { }
        selectedConnector = null;
        const delBtn = document.getElementById('deleteArrowBtn'); if (delBtn) delBtn.disabled = true;
        // validate, reschedule and render. popup shown only when showPopup===true
        const vres = validateModules(currentModules);
        currentScheduled = vres.scheduled || {};
        displayValidationErrors(vres.errors || [], { popup: Boolean(showPopup) });
        try { render(currentModules, currentScheduled); } catch (e) { displayValidationErrors([{ type: 'render', msg: MSG.renderFailed + ': ' + e.message }], { popup: Boolean(showPopup) }); }
    }

    function render(modules, scheduled) {
        timelineEl.innerHTML = '';
        svg.innerHTML = '';
        // color map for source modules — use a palette for clearer distinct colors
        const colorMap = {};
        const palette = [
            '#1f78b4', '#33a02c', '#e31a1c', '#ff7f00', '#6a3d9a', '#b15928',
            '#a6cee3', '#b2df8a', '#fb9a99', '#fdbf6f', '#cab2d6', '#ffff99',
            '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#d95f02', '#1b9e77', '#7570b3', '#e7298a'
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
            box.dataset.thread = s.thread;
            const leftMargin = 200; // account for label area (increased)
            box.style.left = (s.start * scale + leftMargin) + 'px';
            // ensure a small visible width even for zero-duration modules
            box.style.width = Math.max(40, Math.round(s.dur * scale)) + 'px';
            box.style.top = '50%';
            box.style.transform = 'translateY(-50%)';
            // display the short module name (module id is thread:module)
            const label = m && m.shortName ? m.shortName : name;
            box.innerHTML = `<div class="name">${label}</div><div class="meta">${s.start} → ${s.finish} ms</div>`;
            // apply a left accent color to match outgoing arrows
            const boxColor = colorFor(name);
            box.style.borderLeft = `6px solid ${boxColor}`;
            // click handler: support ctrl-click dependency creation (ctrl: select source -> click target)
            box.addEventListener('click', (ev) => {
                // only operate while Ctrl is held
                if (!ev.ctrlKey) { clearCtrlSource(); return; }
                // if no source selected yet, set this as source
                if (!ctrlSourceName) { setCtrlSource(name); log(`Ctrl-source: ${name}`); return; }
                // if source is same as clicked, ignore
                if (ctrlSourceName === name) return;
                // create dependency ctrlSourceName -> name
                try { pushHistory(currentModules || {}); } catch (e) { console.warn('pushHistory failed', e); }
                // ensure modules exist in currentModules
                currentModules[ctrlSourceName] = currentModules[ctrlSourceName] || (modules[ctrlSourceName] ? JSON.parse(JSON.stringify(modules[ctrlSourceName])) : { name: ctrlSourceName, thread: null, from: [], to: [], time: 0 });
                currentModules[name] = currentModules[name] || (modules[name] ? JSON.parse(JSON.stringify(modules[name])) : { name: name, thread: null, from: [], to: [], time: 0 });
                if (!currentModules[ctrlSourceName].to) currentModules[ctrlSourceName].to = [];
                if (!currentModules[name].from) currentModules[name].from = [];
                if (!currentModules[ctrlSourceName].to.includes(name)) currentModules[ctrlSourceName].to.push(name);
                if (!currentModules[name].from.includes(ctrlSourceName)) currentModules[name].from.push(ctrlSourceName);
                // dedupe
                currentModules[ctrlSourceName].to = Array.from(new Set(currentModules[ctrlSourceName].to));
                currentModules[name].from = Array.from(new Set(currentModules[name].from));
                // clear ctrl visual
                clearCtrlSource();
                // validate, reschedule and render
                const vres = validateModules(currentModules);
                currentScheduled = vres.scheduled || {};
                displayValidationErrors(vres.errors || []);
                try { render(currentModules, currentScheduled); } catch (e) { displayValidationErrors([{ type: 'render', msg: MSG.renderFailed + ': ' + e.message }]); }
                log(`Added dependency ${ctrlSourceName} → ${name}`);
            });
            // double-click to edit module
            box.addEventListener('dblclick', (ev) => {
                ev.preventDefault();
                openModuleEditor(name);
            });
            lane.el = lane.el || lane;
            lane.el.appendChild(box);
        }

        // compute box rects using DOM geometry so arrows align to edges
        const boxRects = {};
        // ensure svg has the correct size and will scroll in sync with the timeline content
        const contentH = threads.length * laneH + 80;
        svg.setAttribute('width', width);
        svg.setAttribute('height', contentH);
        // set explicit style sizes so CSS width:100% doesn't clip content width
        svg.style.width = width + 'px';
        svg.style.height = contentH + 'px';

        // ensure the SVG sits inside the scrolling timeline content so it scrolls
        // together with module boxes. This avoids needing CSS transforms that
        // can desynchronize coordinates.
        try {
            if (svg.parentNode !== timelineEl) {
                timelineEl.insertBefore(svg, timelineEl.firstChild);
            }
            // clear any previous transform state
            svg.style.transform = '';
        } catch (e) {
            // ignore if DOM operations fail
        }
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
        // Draw connectors and make them clickable/selectable for deletion
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
                // hit area (invisible, wide) for easier selection
                const hit = document.createElementNS(svgNS, 'path');
                hit.setAttribute('d', d);
                hit.setAttribute('stroke', 'transparent');
                hit.setAttribute('fill', 'none');
                hit.setAttribute('stroke-width', '14');
                hit.classList.add('connector-hit');
                hit.dataset.src = name;
                hit.dataset.tgt = tgt;
                hit.addEventListener('click', (ev) => { ev.stopPropagation(); selectArrow(path); });
                svg.appendChild(hit);

                const path = document.createElementNS(svgNS, 'path');
                path.setAttribute('d', d);
                const col = colorFor(name);
                path.setAttribute('stroke', col);
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linecap', 'round');
                path.classList.add('clickable', 'connector-path');
                // store source/target ids for deletion
                path.dataset.src = name;
                path.dataset.tgt = tgt;
                // click selects
                path.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    selectArrow(path);
                });
                svg.appendChild(path);

                // arrow head as a small left-pointing triangle at endX,endY
                const tri = document.createElementNS(svgNS, 'path');
                const px = 8; // triangle length
                const py = 5; // half height
                const triD = `M ${endX} ${endY} L ${endX - px} ${endY - py} L ${endX - px} ${endY + py} Z`;
                // hit triangle (invisible, slightly larger) to ease selection of arrowhead
                const triHit = document.createElementNS(svgNS, 'path');
                triHit.setAttribute('d', triD);
                triHit.setAttribute('fill', 'transparent');
                triHit.classList.add('connector-tri-hit');
                triHit.dataset.src = name;
                triHit.dataset.tgt = tgt;
                triHit.addEventListener('click', (ev) => { ev.stopPropagation(); selectArrow(path); });
                svg.appendChild(triHit);

                tri.setAttribute('d', triD);
                tri.setAttribute('fill', col);
                tri.classList.add('clickable', 'connector-tri');
                tri.dataset.src = name;
                tri.dataset.tgt = tgt;
                tri.addEventListener('click', (ev) => { ev.stopPropagation(); selectArrow(path); });
                svg.appendChild(tri);
            }
        }

        timelineEl.style.minWidth = width + 'px';
        // attach drag handlers so modules can be moved between lanes
        try { attachDragHandlers(modules); } catch (e) { console.warn('attachDragHandlers failed', e); }
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
            // new load -> clear undo history
            clearHistory();
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
                const lines = bad.map(([t, arr]) => `スレッド ${t}: ${arr.join(', ')}`);
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
                        inconsistencies.push(`モジュール ${b} が見つかりません（${a} の to に ${b} が含まれています）`);
                        continue;
                    }
                    if (!fromSets[b].has(a)) {
                        inconsistencies.push(`不整合: ${a} は to に ${b} を含みますが、${b} の from に ${a} がありません`);
                    }
                }
            }
            for (const a in fromSets) {
                for (const b of fromSets[a]) {
                    if (!(b in modules)) {
                        inconsistencies.push(`モジュール ${b} が見つかりません（${a} の from に ${b} が含まれています）`);
                        continue;
                    }
                    if (!toSets[b].has(a)) {
                        inconsistencies.push(`不整合: ${a} は from に ${b} を含みますが、${b} の to に ${a} がありません`);
                    }
                }
            }
            if (inconsistencies.length > 0) errors.push(MSG.inconsistentFromTo + inconsistencies.join(' ; '));

            // validate same-thread ordering: modules on same thread must have a transitive dependency
            // build adjacency (to) and compute reachability
            const adj = {};
            for (const name in modules) adj[name] = new Set((modules[name].to || []).filter(x => x));
            const reachable = {};
            for (const name in modules) {
                const seen = new Set();
                const stack = Array.from(adj[name] || []);
                while (stack.length) {
                    const v = stack.pop();
                    if (!v || seen.has(v)) continue;
                    seen.add(v);
                    const next = adj[v];
                    if (next) for (const w of next) if (!seen.has(w)) stack.push(w);
                }
                reachable[name] = seen;
            }

            const threadAmbiguities = [];
            const byThread = {};
            for (const name in modules) {
                const t = String(modules[name].thread || '0');
                (byThread[t] = byThread[t] || []).push(name);
            }
            for (const t in byThread) {
                const arr = byThread[t];
                if (arr.length <= 1) continue;
                for (let i = 0; i < arr.length; i++) {
                    for (let j = i + 1; j < arr.length; j++) {
                        const a = arr[i], b = arr[j];
                        const aToB = reachable[a] && reachable[a].has(b);
                        const bToA = reachable[b] && reachable[b].has(a);
                        if (!aToB && !bToA) {
                            threadAmbiguities.push(`スレッド ${t}: ${a} と ${b} の実行順序が不明`);
                        }
                    }
                }
            }
            if (threadAmbiguities.length > 0) errors.push(MSG.ambiguousOrdering + threadAmbiguities.join(' ; '));

            // schedule and check cycles
            const result = schedule(modules);
            if (result.cycles && result.cycles.length > 0) {
                errors.push(MSG.circularDependency + result.cycles.join(', '));
            }

            // show inline + popup errors (if any)
            displayValidationErrors(errors);

            // Keep current state so DnD can update threads and re-schedule
            currentModules = modules;
            currentScheduled = result.scheduled;
            // Proceed to render even if there were validation issues (some modules may not be scheduled).
            render(modules, result.scheduled);
            log('Auto-rendered ' + Object.keys(modules).length + ' modules' + (errors.length > 0 ? ' (with validation warnings)' : ''));
        }).catch(err => { console.error(err); log(MSG.failedToReadFiles + err); });
    });

    // Export current diagram as an SVG file for download
    const exportBtn = document.getElementById('exportSvgBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        try {
            // Build an SVG snapshot: copy paths and render module boxes as SVG rects/text
            const svgRect = svg.getBoundingClientRect();
            // Use the timeline wrapper as the base rect so exported SVG can include
            // the timeline plus any inline error panel appended under it.
            const wrap = document.getElementById('timelineWrap') || timelineEl.parentNode || document.body;
            const baseRect = wrap.getBoundingClientRect();
            // compute output width/height from wrapper to ensure everything visible
            const outW = Math.max(parseFloat(svg.getAttribute('width')) || svgRect.width, Math.ceil(baseRect.width));
            const outH = Math.max(parseFloat(svg.getAttribute('height')) || svgRect.height, Math.ceil(baseRect.height));
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
                /* error panel styles */
                .error-svg-header { font-size:14px; font-weight:700; fill:#7a0b0b; }
                .error-svg-line { font-size:12px; fill:#7a0b0b; }
            `;
            styleEl.textContent = cssText;
            out.appendChild(styleEl);

            // clone connector paths and other SVG children, offset them so they align
            // with the wrapper's origin (baseRect). Paths live in SVG coords (svgRect),
            // so translate by svgRect - baseRect when placing into the output SVG.
            const dx = svgRect.left - baseRect.left;
            const dy = svgRect.top - baseRect.top;
            const pathsGroup = document.createElementNS(xmlns, 'g');
            if (dx !== 0 || dy !== 0) pathsGroup.setAttribute('transform', `translate(${dx}, ${dy})`);
            const clones = svg.querySelectorAll('path');
            for (const c of clones) pathsGroup.appendChild(c.cloneNode(true));
            out.appendChild(pathsGroup);

            // render module rectangles and labels
            const modulesGroup = document.createElementNS(xmlns, 'g');
            const moduleEls = timelineEl.querySelectorAll('.module');
            // baseRect corresponds to the wrapper so we position modules relative to it
            // (we already computed baseRect earlier)
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

            // If there is an inline error panel displayed below the timeline, render it into the SVG.
            try {
                const errEl = document.getElementById('errorPanel');
                if (errEl) {
                    const er = errEl.getBoundingClientRect();
                    const ex = (er.left - baseRect.left);
                    const ey = (er.top - baseRect.top);
                    const ew = er.width;
                    const eh = er.height;
                    const errGroup = document.createElementNS(xmlns, 'g');

                    const errBg = document.createElementNS(xmlns, 'rect');
                    errBg.setAttribute('x', ex);
                    errBg.setAttribute('y', ey);
                    errBg.setAttribute('width', ew);
                    errBg.setAttribute('height', eh);
                    errBg.setAttribute('fill', '#fff4f4');
                    errBg.setAttribute('stroke', '#e74c3c');
                    errBg.setAttribute('stroke-width', '1');
                    errGroup.appendChild(errBg);

                    const accent = document.createElementNS(xmlns, 'rect');
                    accent.setAttribute('x', ex);
                    accent.setAttribute('y', ey);
                    accent.setAttribute('width', 6);
                    accent.setAttribute('height', eh);
                    accent.setAttribute('fill', '#e74c3c');
                    errGroup.appendChild(accent);

                    const headerEl = errEl.querySelector('.error-header');
                    let textY = ey + 18;
                    if (headerEl) {
                        const hText = document.createElementNS(xmlns, 'text');
                        hText.setAttribute('class', 'error-svg-header');
                        hText.setAttribute('x', ex + 12);
                        hText.setAttribute('y', textY);
                        hText.textContent = headerEl.textContent.trim();
                        errGroup.appendChild(hText);
                        textY += 18;
                    }
                    const items = errEl.querySelectorAll('li');
                    let idx = 0;
                    for (const li of items) {
                        const t = document.createElementNS(xmlns, 'text');
                        t.setAttribute('class', 'error-svg-line');
                        t.setAttribute('x', ex + 12);
                        t.setAttribute('y', textY + (idx * 14));
                        t.textContent = '• ' + li.textContent.trim();
                        errGroup.appendChild(t);
                        idx++;
                    }
                    out.appendChild(errGroup);
                }
            } catch (e) {
                console.warn('Failed to include error panel in SVG export', e);
            }

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

    // Undo button handler
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) {
        setUndoButtonState(false);
        undoBtn.addEventListener('click', () => {
            const prev = popHistory();
            if (!prev) { log('Nothing to undo'); return; }
            // push current state to redo so user can redo the undo
            try { pushRedo(currentModules || {}); } catch (e) { console.warn(e); }
            // prev is a snapshot of modules; restore threads and other fields
            currentModules = prev;
            const vres = validateModules(currentModules);
            currentScheduled = vres.scheduled || {};
            // show only inline errors for undo/redo (no popup)
            displayValidationErrors(vres.errors || [], { popup: false });
            render(currentModules, currentScheduled);
            log('Undo applied');
        });
    }

    // Redo button handler
    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) {
        setRedoButtonState(false);
        redoBtn.addEventListener('click', () => {
            const next = popRedo();
            if (!next) { log('Nothing to redo'); return; }
            // before re-applying redo snapshot, push current state to history so undo remains possible
            try { pushHistory(currentModules || {}); } catch (e) { console.warn(e); }
            currentModules = next;
            const vres = validateModules(currentModules);
            currentScheduled = vres.scheduled || {};
            // show only inline errors for undo/redo (no popup)
            displayValidationErrors(vres.errors || [], { popup: false });
            render(currentModules, currentScheduled);
            log('Redo applied');
        });
    }

    // Delete Arrow button handler (UI button)
    const deleteBtn = document.getElementById('deleteArrowBtn');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.addEventListener('click', () => {
            // no extra popup suppression here — reuse deleteSelected with popup
            deleteSelected(true);
            log('Deleted selected arrow');
        });
    }

    // Export snapshot as JSON for external save into workspace/output
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => {
            try {
                const snap = JSON.parse(JSON.stringify(currentModules || {}));
                // group by thread and build arrays in input-spec format
                const byThread = {};
                for (const id of Object.keys(snap)) {
                    const m = snap[id];
                    const thread = String(m.thread || (id.includes(':') ? id.split(':')[0] : '0'));
                    const short = m.shortName || (id.includes(':') ? id.split(':')[1] : id);
                    const entry = { module: short };
                    if (m.time != null) entry.time = m.time;
                    if (Array.isArray(m.from) && m.from.length) entry.from = m.from.map(x => {
                        const parts = String(x).split(':');
                        return { thread: parts[0] || thread, module: parts[1] || parts[0] };
                    });
                    if (Array.isArray(m.to) && m.to.length) entry.to = m.to.map(x => {
                        const parts = String(x).split(':');
                        return { thread: parts[0] || thread, module: parts[1] || parts[0] };
                    });
                    (byThread[thread] = byThread[thread] || []).push(entry);
                }

                // trigger downloads for each thread file
                const threads = Object.keys(byThread).sort();
                if (threads.length === 0) { showPopup('Export', 'No modules to export'); return; }
                for (const t of threads) {
                    const content = JSON.stringify(byThread[t], null, 2);
                    const blob = new Blob([content], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${t}.json`;
                    document.body.appendChild(a);
                    // small timeout to allow multiple downloads to register
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                }
                log('Exported ' + threads.length + ' JSON files (one per thread)');
            } catch (e) {
                console.error('Export per-thread JSON failed', e);
                showPopup('Export failed', String(e));
            }
        });
    }
})();
