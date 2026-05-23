/* ================================================================
   SONICFORGE STUDIO v4.0 — Popup Controller
   Real-time state management and UI synchronization
   ================================================================ */

(() => {
    'use strict';

    /* ---- EQ Frequency Bands ---- */
    const EQ_BANDS = [
        { freq: 31, label: '31' },
        { freq: 62, label: '62' },
        { freq: 125, label: '125' },
        { freq: 250, label: '250' },
        { freq: 500, label: '500' },
        { freq: 1000, label: '1K' },
        { freq: 2000, label: '2K' },
        { freq: 4000, label: '4K' },
        { freq: 8000, label: '8K' },
        { freq: 16000, label: '16K' },
    ];

    /* ---- Factory Presets ---- */
    const FACTORY_PRESETS = {
        flat: {
            mode: 'default', eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            spatial: { roomSize: 0, reverbDecay: 0, wetDry: 0, stereoWidth: 100, depth16d: 0, preDelay: 0, spatialSpread: 0, earlyRef: 0, crossfeed: 0 },
            enhance: { masterVol: 100, balance: 0, compThreshold: -24, compRatio: 4, compAttack: 3, compRelease: 250, clarity: 0, warmth: 22000, loudnessNorm: false, monoCompat: false, analogWarmth: false, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 0, presence: 0, air: 0 }
        },
        'bass-heavy': {
            mode: 'default', eq: [9, 8, 6, 4, 1, 0, 0, -1, 0, 1],
            spatial: { roomSize: 35, reverbDecay: 20, wetDry: 15, stereoWidth: 120, depth16d: 30, preDelay: 8, spatialSpread: 40, earlyRef: 20, crossfeed: 10 },
            enhance: { masterVol: 105, balance: 0, compThreshold: -20, compRatio: 5, compAttack: 5, compRelease: 200, clarity: 0, warmth: 22000, loudnessNorm: false, monoCompat: false, analogWarmth: true, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 8, presence: 0, air: 0 }
        },
        bright: {
            mode: 'default', eq: [-2, -1, 0, 0, 1, 2, 4, 6, 7, 8],
            spatial: { roomSize: 25, reverbDecay: 15, wetDry: 18, stereoWidth: 130, depth16d: 20, preDelay: 5, spatialSpread: 50, earlyRef: 30, crossfeed: 15 },
            enhance: { masterVol: 100, balance: 0, compThreshold: -22, compRatio: 3, compAttack: 3, compRelease: 250, clarity: 30, warmth: 22000, loudnessNorm: false, monoCompat: false, analogWarmth: false, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 0, presence: 3, air: 6 }
        },
        warm: {
            mode: 'default', eq: [4, 3, 2, 1, 0, -1, -2, -1, 0, 0],
            spatial: { roomSize: 45, reverbDecay: 35, wetDry: 30, stereoWidth: 100, depth16d: 40, preDelay: 18, spatialSpread: 55, earlyRef: 40, crossfeed: 25 },
            enhance: { masterVol: 100, balance: 0, compThreshold: -22, compRatio: 4, compAttack: 5, compRelease: 300, clarity: 0, warmth: 14000, loudnessNorm: false, monoCompat: false, analogWarmth: true, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 3, presence: -2, air: 0 }
        },
        vocal: {
            mode: 'vocal', eq: [0, -1, -2, 2, 5, 6, 5, 3, 1, 0],
            spatial: { roomSize: 20, reverbDecay: 10, wetDry: 12, stereoWidth: 90, depth16d: 15, preDelay: 4, spatialSpread: 30, earlyRef: 15, crossfeed: 20 },
            enhance: { masterVol: 100, balance: 0, compThreshold: -18, compRatio: 3, compAttack: 2, compRelease: 200, clarity: 80, warmth: 18000, loudnessNorm: false, monoCompat: false, analogWarmth: false, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 0, presence: 4, air: 2 }
        },
        podcast: {
            mode: 'studio', eq: [-4, -3, 0, 4, 5, 6, 4, 2, 0, -2],
            spatial: { roomSize: 8, reverbDecay: 5, wetDry: 5, stereoWidth: 80, depth16d: 5, preDelay: 2, spatialSpread: 10, earlyRef: 5, crossfeed: 30 },
            enhance: { masterVol: 115, balance: 0, compThreshold: -15, compRatio: 8, compAttack: 1, compRelease: 150, clarity: 120, warmth: 16000, loudnessNorm: true, monoCompat: false, analogWarmth: false, noiseGate: true, speed: 100, pitch: 0 },
            tone: { subBass: 0, presence: 5, air: 0 }
        },
        lofi: {
            mode: 'default', eq: [3, 2, 0, -1, -2, -1, 0, -2, -3, -4],
            spatial: { roomSize: 55, reverbDecay: 40, wetDry: 35, stereoWidth: 85, depth16d: 30, preDelay: 25, spatialSpread: 40, earlyRef: 45, crossfeed: 35 },
            enhance: { masterVol: 95, balance: 0, compThreshold: -20, compRatio: 6, compAttack: 10, compRelease: 400, clarity: 0, warmth: 10000, loudnessNorm: false, monoCompat: false, analogWarmth: true, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 4, presence: -3, air: 0 }
        },
        cinema: {
            mode: '16d', eq: [5, 4, 2, 0, -1, 0, 2, 4, 5, 4],
            spatial: { roomSize: 70, reverbDecay: 50, wetDry: 40, stereoWidth: 160, depth16d: 70, preDelay: 20, spatialSpread: 120, earlyRef: 50, crossfeed: 10 },
            enhance: { masterVol: 110, balance: 0, compThreshold: -28, compRatio: 5, compAttack: 5, compRelease: 300, clarity: 20, warmth: 20000, loudnessNorm: true, monoCompat: false, analogWarmth: false, noiseGate: false, speed: 100, pitch: 0 },
            tone: { subBass: 6, presence: 2, air: 4 }
        },
        night: {
            mode: 'default', eq: [2, 1, 0, 0, 0, 0, 0, -1, -2, -3],
            spatial: { roomSize: 30, reverbDecay: 20, wetDry: 20, stereoWidth: 90, depth16d: 20, preDelay: 10, spatialSpread: 30, earlyRef: 20, crossfeed: 30 },
            enhance: { masterVol: 80, balance: 0, compThreshold: -12, compRatio: 12, compAttack: 1, compRelease: 100, clarity: 0, warmth: 12000, loudnessNorm: true, monoCompat: false, analogWarmth: true, noiseGate: true, speed: 100, pitch: 0 },
            tone: { subBass: 2, presence: 0, air: 0 }
        },
    };

    /* ---- Default State ---- */
    function getDefaultState() {
        return {
            enabled: false,
            mode: 'default',
            eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            spatial: {
                roomSize: 40, reverbDecay: 25, wetDry: 30, stereoWidth: 100,
                depth16d: 50, preDelay: 15, spatialSpread: 60, earlyRef: 35, crossfeed: 20,
            },
            enhance: {
                masterVol: 100, balance: 0, compThreshold: -24, compRatio: 4,
                compAttack: 3, compRelease: 250, clarity: 0, warmth: 22000,
                loudnessNorm: false, monoCompat: false, analogWarmth: false,
                noiseGate: false, speed: 100, pitch: 0,
            },
            tone: { subBass: 0, presence: 0, air: 0 },
        };
    }

    let state = getDefaultState();
    let userPresets = [];

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    /* ---- Lifecycle ---- */
    document.addEventListener('DOMContentLoaded', async () => {
        await loadState();
        buildEQ();
        bindAll();
        syncUI();
    });

    /* ---- Storage ---- */
    function loadState() {
        return new Promise(resolve => {
            chrome.storage.local.get(['hrState', 'hrPresets'], data => {
                if (data.hrState) {
                    state = {
                        ...getDefaultState(),
                        ...data.hrState,
                        spatial: { ...getDefaultState().spatial, ...(data.hrState.spatial || {}) },
                        enhance: { ...getDefaultState().enhance, ...(data.hrState.enhance || {}) },
                        tone: { ...getDefaultState().tone, ...(data.hrState.tone || {}) }
                    };
                }
                if (data.hrPresets) userPresets = data.hrPresets;
                resolve();
            });
        });
    }

    function saveState() {
        chrome.storage.local.set({ hrState: state });
        pushToContent();
    }

    function savePresets() {
        chrome.storage.local.set({ hrPresets: userPresets });
    }

    function pushToContent() {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.url?.includes('youtube.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'HR_UPDATE', state }).catch(() => { });
            }
        });
    }

    /* ---- Bind All Controls ---- */
    function bindAll() {
        bindTabs();
        bindMaster();
        bindModes();
        bindSliders();
        bindEQ();
        bindSwitches();
        bindPresets();
        bindFactory();
        bindReset();
    }

    /* ---- Tabs ---- */
    function bindTabs() {
        $$('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                $$('.panel').forEach(p => p.classList.remove('active'));
                $(`#panel-${tab.dataset.tab}`).classList.add('active');
            });
        });
    }

    /* ---- Master Toggle ---- */
    function bindMaster() {
        $('#masterToggle').addEventListener('change', e => {
            state.enabled = e.target.checked;
            updateMasterUI();
            saveState();
        });
    }

    function updateMasterUI() {
        const enabled = state.enabled;
        $('#masterToggle').checked = enabled;
        $('#masterLabel').textContent = enabled ? 'ON' : 'OFF';
        $('#masterLabel').classList.toggle('on', enabled);
        $('#statusDot').classList.toggle('on', enabled);
        $('#statusText').classList.toggle('on', enabled);

        let modeText = state.mode.toUpperCase();
        if (state.mode === 'default') modeText = 'PURE';
        if (state.mode === '16d') modeText = '16D SURROUND';
        if (state.mode === '360') modeText = '360° SPHERE';

        $('#statusText').textContent = enabled ? `ACTIVE · ${modeText}` : 'SYSTEM IDLE';
    }

    /* ---- Mode Cards ---- */
    function bindModes() {
        $$('.mode-card').forEach(card => {
            card.addEventListener('click', () => {
                state.mode = card.dataset.mode;
                updateModesUI();
                updateMasterUI();
                saveState();
            });
        });
    }

    function updateModesUI() {
        $$('.mode-card').forEach(card => {
            card.classList.toggle('active', card.dataset.mode === state.mode);
        });
    }

    /* ---- Sliders ---- */
    const SLIDER_MAP = [
        // Spatial
        { id: 'roomSize', path: 'spatial', key: 'roomSize', fmt: v => v },
        { id: 'reverbDecay', path: 'spatial', key: 'reverbDecay', fmt: v => v },
        { id: 'wetDry', path: 'spatial', key: 'wetDry', fmt: v => v + '%' },
        { id: 'preDelay', path: 'spatial', key: 'preDelay', fmt: v => v + ' ms' },
        { id: 'stereoWidth', path: 'spatial', key: 'stereoWidth', fmt: v => v + '%' },
        { id: 'depth16d', path: 'spatial', key: 'depth16d', fmt: v => v },
        { id: 'spatialSpread', path: 'spatial', key: 'spatialSpread', fmt: v => v + '°' },
        { id: 'earlyRef', path: 'spatial', key: 'earlyRef', fmt: v => v },
        { id: 'crossfeed', path: 'spatial', key: 'crossfeed', fmt: v => v },
        // Enhance
        { id: 'masterVol', path: 'enhance', key: 'masterVol', fmt: v => v + '%' },
        { id: 'balance', path: 'enhance', key: 'balance', fmt: v => v === 0 ? 'C' : (v < 0 ? `L${Math.abs(v)}` : `R${v}`) },
        { id: 'compThreshold', path: 'enhance', key: 'compThreshold', fmt: v => (v >= 0 ? v : `−${Math.abs(v)}`) + ' dB' },
        { id: 'compRatio', path: 'enhance', key: 'compRatio', fmt: v => v + ':1' },
        { id: 'compAttack', path: 'enhance', key: 'compAttack', fmt: v => v + ' ms' },
        { id: 'compRelease', path: 'enhance', key: 'compRelease', fmt: v => v + ' ms' },
        { id: 'clarity', path: 'enhance', key: 'clarity', fmt: v => v === 0 ? 'OFF' : v + ' Hz' },
        { id: 'warmth', path: 'enhance', key: 'warmth', fmt: v => v >= 22000 ? 'OFF' : (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v + ' Hz') },
        { id: 'speed', path: 'enhance', key: 'speed', fmt: v => (v / 100).toFixed(2) + '×' },
        { id: 'pitch', path: 'enhance', key: 'pitch', fmt: v => (v > 0 ? '+' : '') + v },
        // Tone
        { id: 'subBass', path: 'tone', key: 'subBass', fmt: v => v + ' dB' },
        { id: 'presence', path: 'tone', key: 'presence', fmt: v => (v > 0 ? '+' : '') + v + ' dB' },
        { id: 'air', path: 'tone', key: 'air', fmt: v => v + ' dB' },
    ];

    function bindSliders() {
        SLIDER_MAP.forEach(({ id, path, key, fmt }) => {
            const el = $(`#${id}`);
            if (!el) return;
            el.addEventListener('input', () => {
                const val = parseFloat(el.value);
                state[path][key] = val;
                $(`#v-${id}`).textContent = fmt(val);
                saveState();
            });
        });
    }

    function updateSliders() {
        SLIDER_MAP.forEach(({ id, path, key, fmt }) => {
            const el = $(`#${id}`);
            if (!el) return;
            const val = state[path][key];
            el.value = val;
            $(`#v-${id}`).textContent = fmt(val);
        });
    }

    /* ---- Switches ---- */
    const SWITCH_MAP = [
        { id: 'loudnessNorm', path: 'enhance', key: 'loudnessNorm' },
        { id: 'monoCompat', path: 'enhance', key: 'monoCompat' },
        { id: 'analogWarmth', path: 'enhance', key: 'analogWarmth' },
        { id: 'noiseGate', path: 'enhance', key: 'noiseGate' },
    ];

    function bindSwitches() {
        SWITCH_MAP.forEach(({ id, path, key }) => {
            $(`#${id}`).addEventListener('change', e => {
                state[path][key] = e.target.checked;
                saveState();
            });
        });
    }

    function updateSwitches() {
        SWITCH_MAP.forEach(({ id, path, key }) => {
            $(`#${id}`).checked = state[path][key];
        });
    }

    /* ---- EQ ---- */
    function buildEQ() {
        const container = $('#eqBands');
        container.innerHTML = '';
        EQ_BANDS.forEach((band, i) => {
            const div = document.createElement('div');
            div.className = 'eq-band';
            div.innerHTML = `
        <span class="eq-band-val" id="eqV${i}">0</span>
        <input type="range" class="eq-band-slider" id="eqS${i}" min="-12" max="12" value="0" data-i="${i}"/>
        <span class="eq-band-label">${band.label}</span>
      `;
            container.appendChild(div);
        });
    }

    function bindEQ() {
        EQ_BANDS.forEach((_, i) => {
            $(`#eqS${i}`).addEventListener('input', e => {
                const val = parseInt(e.target.value);
                state.eq[i] = val;
                $(`#eqV${i}`).textContent = val > 0 ? `+${val}` : val;
                updateBassTreeble();
                saveState();
            });
        });

        $('#bassUp').addEventListener('click', () => { adjustBass(1); saveState(); });
        $('#bassDown').addEventListener('click', () => { adjustBass(-1); saveState(); });
        $('#trebleUp').addEventListener('click', () => { adjustTreble(1); saveState(); });
        $('#trebleDown').addEventListener('click', () => { adjustTreble(-1); saveState(); });

        $('#eqFlat').addEventListener('click', () => {
            state.eq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            state.tone = { subBass: 0, presence: 0, air: 0 };
            updateEQ();
            updateBassTreeble();
            updateSliders();
            saveState();
        });
    }

    function adjustBass(delta) {
        for (let i = 0; i < 3; i++) {
            state.eq[i] = Math.max(-12, Math.min(12, state.eq[i] + delta));
        }
        updateEQ();
        updateBassTreeble();
    }

    function adjustTreble(delta) {
        for (let i = 7; i < 10; i++) {
            state.eq[i] = Math.max(-12, Math.min(12, state.eq[i] + delta));
        }
        updateEQ();
        updateBassTreeble();
    }

    function updateBassTreeble() {
        const bass = Math.round((state.eq[0] + state.eq[1] + state.eq[2]) / 3);
        const treble = Math.round((state.eq[7] + state.eq[8] + state.eq[9]) / 3);
        $('#bassVal').textContent = (bass > 0 ? '+' : '') + bass;
        $('#trebleVal').textContent = (treble > 0 ? '+' : '') + treble;
    }

    function updateEQ() {
        EQ_BANDS.forEach((_, i) => {
            const val = state.eq[i];
            $(`#eqS${i}`).value = val;
            $(`#eqV${i}`).textContent = val > 0 ? `+${val}` : val;
        });
    }

    /* ---- Presets ---- */
    function bindPresets() {
        $('#savePreset').addEventListener('click', () => {
            const name = $('#presetName').value.trim();
            if (!name) return;

            const presetData = JSON.parse(JSON.stringify(state));
            delete presetData.enabled;

            userPresets.push({ name, ts: Date.now(), data: presetData });
            savePresets();
            renderPresets();
            $('#presetName').value = '';
        });
    }

    function renderPresets() {
        const container = $('#presetList');
        if (!userPresets.length) {
            container.innerHTML = '<div class="empty-state">No saved presets</div>';
            return;
        }

        container.innerHTML = '';
        userPresets.forEach((preset, index) => {
            const div = document.createElement('div');
            div.className = 'preset-item';
            div.innerHTML = `
        <span class="preset-item-name">${preset.name}</span>
        <div class="preset-item-actions">
          <button class="p-btn" data-action="load" data-i="${index}">LOAD</button>
          <button class="p-btn del" data-action="del" data-i="${index}">×</button>
        </div>
      `;
            container.appendChild(div);
        });

        container.querySelectorAll('.p-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.i);

                if (btn.dataset.action === 'load') {
                    const presetData = JSON.parse(JSON.stringify(userPresets[index].data));
                    state = {
                        ...state,
                        ...presetData,
                        enabled: state.enabled,
                        spatial: { ...getDefaultState().spatial, ...presetData.spatial },
                        enhance: { ...getDefaultState().enhance, ...presetData.enhance },
                        tone: { ...getDefaultState().tone, ...presetData.tone }
                    };
                    syncUI();
                    saveState();
                } else {
                    userPresets.splice(index, 1);
                    savePresets();
                    renderPresets();
                }
            });
        });
    }

    /* ---- Factory Presets ---- */
    function bindFactory() {
        $$('.factory-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetKey = btn.dataset.f;
                const preset = FACTORY_PRESETS[presetKey];
                if (!preset) return;

                state.mode = preset.mode;
                state.eq = [...preset.eq];
                state.spatial = { ...preset.spatial };
                state.enhance = { ...preset.enhance };
                state.tone = { ...preset.tone };

                syncUI();
                saveState();
            });
        });
    }

    /* ---- Reset ---- */
    function bindReset() {
        $('#resetAll').addEventListener('click', () => {
            state = getDefaultState();
            syncUI();
            saveState();
        });
    }

    /* ---- Sync All UI ---- */
    function syncUI() {
        updateMasterUI();
        updateModesUI();
        updateSliders();
        updateEQ();
        updateBassTreeble();
        updateSwitches();
        renderPresets();
    }

})(); 
 
