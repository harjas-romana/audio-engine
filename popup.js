/* ================================================================
   AUDIO ENGINE v2.0 — Popup Controller
   Full real-time control, instant state sync to content script.
   ================================================================ */
(() => {
  'use strict';

  /* ---- Constants ---- */
  const EQ_BANDS = [
    { freq: 31,    label: '31'  },
    { freq: 62,    label: '62'  },
    { freq: 125,   label: '125' },
    { freq: 250,   label: '250' },
    { freq: 500,   label: '500' },
    { freq: 1000,  label: '1K'  },
    { freq: 2000,  label: '2K'  },
    { freq: 4000,  label: '4K'  },
    { freq: 8000,  label: '8K'  },
    { freq: 16000, label: '16K' },
  ];

  const FACTORY_PRESETS = {
    flat: {
      mode:'default',eq:[0,0,0,0,0,0,0,0,0,0],
      spatial:{roomSize:0,reverbDecay:0,wetDry:0,stereoWidth:100,depth16d:0,preDelay:0,spatialSpread:0,earlyRef:0,crossfeed:0},
      enhance:{masterVol:100,balance:0,compThreshold:-24,compRatio:4,compAttack:3,compRelease:250,clarity:0,warmth:22000,loudnessNorm:false,monoCompat:false,analogWarmth:false,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:0,presence:0,air:0}
    },
    'bass-heavy': {
      mode:'default',eq:[9,8,6,4,1,0,0,-1,0,1],
      spatial:{roomSize:35,reverbDecay:20,wetDry:15,stereoWidth:120,depth16d:30,preDelay:8,spatialSpread:40,earlyRef:20,crossfeed:10},
      enhance:{masterVol:105,balance:0,compThreshold:-20,compRatio:5,compAttack:5,compRelease:200,clarity:0,warmth:22000,loudnessNorm:false,monoCompat:false,analogWarmth:true,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:8,presence:0,air:0}
    },
    bright: {
      mode:'default',eq:[-2,-1,0,0,1,2,4,6,7,8],
      spatial:{roomSize:25,reverbDecay:15,wetDry:18,stereoWidth:130,depth16d:20,preDelay:5,spatialSpread:50,earlyRef:30,crossfeed:15},
      enhance:{masterVol:100,balance:0,compThreshold:-22,compRatio:3,compAttack:3,compRelease:250,clarity:30,warmth:22000,loudnessNorm:false,monoCompat:false,analogWarmth:false,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:0,presence:3,air:6}
    },
    warm: {
      mode:'default',eq:[4,3,2,1,0,-1,-2,-1,0,0],
      spatial:{roomSize:45,reverbDecay:35,wetDry:30,stereoWidth:100,depth16d:40,preDelay:18,spatialSpread:55,earlyRef:40,crossfeed:25},
      enhance:{masterVol:100,balance:0,compThreshold:-22,compRatio:4,compAttack:5,compRelease:300,clarity:0,warmth:14000,loudnessNorm:false,monoCompat:false,analogWarmth:true,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:3,presence:-2,air:0}
    },
    vocal: {
      mode:'vocal',eq:[0,-1,-2,2,5,6,5,3,1,0],
      spatial:{roomSize:20,reverbDecay:10,wetDry:12,stereoWidth:90,depth16d:15,preDelay:4,spatialSpread:30,earlyRef:15,crossfeed:20},
      enhance:{masterVol:100,balance:0,compThreshold:-18,compRatio:3,compAttack:2,compRelease:200,clarity:80,warmth:18000,loudnessNorm:false,monoCompat:false,analogWarmth:false,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:0,presence:4,air:2}
    },
    podcast: {
      mode:'studio',eq:[-4,-3,0,4,5,6,4,2,0,-2],
      spatial:{roomSize:8,reverbDecay:5,wetDry:5,stereoWidth:80,depth16d:5,preDelay:2,spatialSpread:10,earlyRef:5,crossfeed:30},
      enhance:{masterVol:115,balance:0,compThreshold:-15,compRatio:8,compAttack:1,compRelease:150,clarity:120,warmth:16000,loudnessNorm:true,monoCompat:false,analogWarmth:false,noiseGate:true,speed:100,pitch:0},
      tone:{subBass:0,presence:5,air:0}
    },
    lofi: {
      mode:'default',eq:[3,2,0,-1,-2,-1,0,-2,-3,-4],
      spatial:{roomSize:55,reverbDecay:40,wetDry:35,stereoWidth:85,depth16d:30,preDelay:25,spatialSpread:40,earlyRef:45,crossfeed:35},
      enhance:{masterVol:95,balance:0,compThreshold:-20,compRatio:6,compAttack:10,compRelease:400,clarity:0,warmth:10000,loudnessNorm:false,monoCompat:false,analogWarmth:true,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:4,presence:-3,air:0}
    },
    cinema: {
      mode:'16d',eq:[5,4,2,0,-1,0,2,4,5,4],
      spatial:{roomSize:70,reverbDecay:50,wetDry:40,stereoWidth:160,depth16d:70,preDelay:20,spatialSpread:120,earlyRef:50,crossfeed:10},
      enhance:{masterVol:110,balance:0,compThreshold:-28,compRatio:5,compAttack:5,compRelease:300,clarity:20,warmth:20000,loudnessNorm:true,monoCompat:false,analogWarmth:false,noiseGate:false,speed:100,pitch:0},
      tone:{subBass:6,presence:2,air:4}
    },
    night: {
      mode:'default',eq:[2,1,0,0,0,0,0,-1,-2,-3],
      spatial:{roomSize:30,reverbDecay:20,wetDry:20,stereoWidth:90,depth16d:20,preDelay:10,spatialSpread:30,earlyRef:20,crossfeed:30},
      enhance:{masterVol:80,balance:0,compThreshold:-12,compRatio:12,compAttack:1,compRelease:100,clarity:0,warmth:12000,loudnessNorm:true,monoCompat:false,analogWarmth:true,noiseGate:true,speed:100,pitch:0},
      tone:{subBass:2,presence:0,air:0}
    },
  };

  /* ---- Default state ---- */
  function defaults() {
    return {
      enabled: false,
      mode: 'default',
      eq: [0,0,0,0,0,0,0,0,0,0],
      spatial: {
        roomSize:40, reverbDecay:25, wetDry:30, stereoWidth:100,
        depth16d:50, preDelay:15, spatialSpread:60, earlyRef:35, crossfeed:20,
      },
      enhance: {
        masterVol:100, balance:0, compThreshold:-24, compRatio:4,
        compAttack:3, compRelease:250, clarity:0, warmth:22000,
        loudnessNorm:false, monoCompat:false, analogWarmth:false,
        noiseGate:false, speed:100, pitch:0,
      },
      tone: { subBass:0, presence:0, air:0 },
    };
  }

  let S = defaults();
  let userPresets = [];

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  /* ---- Lifecycle ---- */
  document.addEventListener('DOMContentLoaded', async () => {
    await load();
    buildEQ();
    bindAll();
    syncUI();
  });

  /* ---- Storage ---- */
  function load() {
    return new Promise(r => {
      chrome.storage.local.get(['hrState','hrPresets'], d => {
        if (d.hrState) S = { ...defaults(), ...d.hrState, spatial:{...defaults().spatial,...(d.hrState.spatial||{})}, enhance:{...defaults().enhance,...(d.hrState.enhance||{})}, tone:{...defaults().tone,...(d.hrState.tone||{})} };
        if (d.hrPresets) userPresets = d.hrPresets;
        r();
      });
    });
  }

  function save() {
    chrome.storage.local.set({ hrState: S });
    push();
  }
  function savePresets() {
    chrome.storage.local.set({ hrPresets: userPresets });
  }

  function push() {
    chrome.tabs.query({ active:true, currentWindow:true }, tabs => {
      if (tabs[0]?.url?.includes('youtube.com')) {
        chrome.tabs.sendMessage(tabs[0].id, { type:'HR_UPDATE', state:S }).catch(()=>{});
      }
    });
  }

  /* ---- Bind Everything ---- */
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
    $$('.tab').forEach(t => {
      t.addEventListener('click', () => {
        $$('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        $$('.panel').forEach(p => p.classList.remove('active'));
        $(`#panel-${t.dataset.tab}`).classList.add('active');
      });
    });
  }

  /* ---- Master Toggle ---- */
  function bindMaster() {
    $('#masterToggle').addEventListener('change', e => {
      S.enabled = e.target.checked;
      updateMaster();
      save();
    });
  }

  function updateMaster() {
    const on = S.enabled;
    $('#masterToggle').checked = on;
    $('#masterLabel').textContent = on ? 'ON' : 'OFF';
    $('#masterLabel').classList.toggle('on', on);
    $('#statusDot').classList.toggle('on', on);
    $('#statusText').classList.toggle('on', on);
    $('#statusText').textContent = on ? `Active · ${S.mode.toUpperCase().replace('16D','16D SURROUND').replace('DEFAULT','PURE').replace('360','360°')}` : 'Engine Inactive';
  }

  /* ---- Mode Cards ---- */
  function bindModes() {
    $$('.mode-card').forEach(c => {
      c.addEventListener('click', () => {
        S.mode = c.dataset.mode;
        updateModes();
        updateMaster();
        save();
      });
    });
  }

  function updateModes() {
    $$('.mode-card').forEach(c => c.classList.toggle('active', c.dataset.mode === S.mode));
  }

  /* ---- All Sliders (Spatial, Enhance, Tone) ---- */
  const SLIDER_MAP = [
    // Spatial
    { id:'roomSize',      path:'spatial', key:'roomSize',      fmt: v => v },
    { id:'reverbDecay',   path:'spatial', key:'reverbDecay',   fmt: v => v },
    { id:'wetDry',        path:'spatial', key:'wetDry',        fmt: v => v+'%' },
    { id:'preDelay',      path:'spatial', key:'preDelay',      fmt: v => v+' ms' },
    { id:'stereoWidth',   path:'spatial', key:'stereoWidth',   fmt: v => v+'%' },
    { id:'depth16d',      path:'spatial', key:'depth16d',      fmt: v => v },
    { id:'spatialSpread', path:'spatial', key:'spatialSpread', fmt: v => v+'°' },
    { id:'earlyRef',      path:'spatial', key:'earlyRef',      fmt: v => v },
    { id:'crossfeed',     path:'spatial', key:'crossfeed',     fmt: v => v },
    // Enhance
    { id:'masterVol',     path:'enhance', key:'masterVol',     fmt: v => v+'%' },
    { id:'balance',       path:'enhance', key:'balance',       fmt: v => v==0?'Center':v<0?`L ${Math.abs(v)}`:`R ${v}` },
    { id:'compThreshold', path:'enhance', key:'compThreshold', fmt: v => v+' dB' },
    { id:'compRatio',     path:'enhance', key:'compRatio',     fmt: v => v+' : 1' },
    { id:'compAttack',    path:'enhance', key:'compAttack',    fmt: v => v+' ms' },
    { id:'compRelease',   path:'enhance', key:'compRelease',   fmt: v => v+' ms' },
    { id:'clarity',       path:'enhance', key:'clarity',       fmt: v => v==0?'Off':v+' Hz' },
    { id:'warmth',        path:'enhance', key:'warmth',        fmt: v => v>=22000?'Off':v>=1000?(v/1000).toFixed(1)+' kHz':v+' Hz' },
    { id:'speed',         path:'enhance', key:'speed',         fmt: v => (v/100).toFixed(2)+'x' },
    { id:'pitch',         path:'enhance', key:'pitch',         fmt: v => (v>0?'+':'')+v },
    // Tone
    { id:'subBass',       path:'tone',    key:'subBass',       fmt: v => v+' dB' },
    { id:'presence',      path:'tone',    key:'presence',      fmt: v => (v>0?'+':'')+v+' dB' },
    { id:'air',           path:'tone',    key:'air',           fmt: v => v+' dB' },
  ];

  function bindSliders() {
    SLIDER_MAP.forEach(({ id, path, key, fmt }) => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        S[path][key] = v;
        $(`#v-${id}`).textContent = fmt(v);
        save();
      });
    });
  }

  function updateSliders() {
    SLIDER_MAP.forEach(({ id, path, key, fmt }) => {
      const el = $(`#${id}`);
      if (!el) return;
      const v = S[path][key];
      el.value = v;
      $(`#v-${id}`).textContent = fmt(v);
    });
  }

  /* ---- Switches ---- */
  const SWITCH_MAP = [
    { id:'loudnessNorm', path:'enhance', key:'loudnessNorm' },
    { id:'monoCompat',   path:'enhance', key:'monoCompat' },
    { id:'analogWarmth', path:'enhance', key:'analogWarmth' },
    { id:'noiseGate',    path:'enhance', key:'noiseGate' },
  ];

  function bindSwitches() {
    SWITCH_MAP.forEach(({ id, path, key }) => {
      $(`#${id}`).addEventListener('change', e => {
        S[path][key] = e.target.checked;
        save();
      });
    });
  }

  function updateSwitches() {
    SWITCH_MAP.forEach(({ id, path, key }) => {
      $(`#${id}`).checked = S[path][key];
    });
  }

  /* ---- EQ ---- */
  function buildEQ() {
    const c = $('#eqBands');
    c.innerHTML = '';
    EQ_BANDS.forEach((b, i) => {
      const d = document.createElement('div');
      d.className = 'eq-band';
      d.innerHTML = `
        <span class="eq-band-val" id="eqV${i}">0</span>
        <input type="range" class="eq-band-slider" id="eqS${i}" min="-12" max="12" value="0" data-i="${i}"/>
        <span class="eq-band-label">${b.label}</span>
      `;
      c.appendChild(d);
    });
  }

  function bindEQ() {
    EQ_BANDS.forEach((_, i) => {
      $(`#eqS${i}`).addEventListener('input', e => {
        const v = parseInt(e.target.value);
        S.eq[i] = v;
        $(`#eqV${i}`).textContent = v > 0 ? `+${v}` : v;
        recalcBT();
        save();
      });
    });

    $('#bassUp').addEventListener('click', () => { adjustBass(1); save(); });
    $('#bassDown').addEventListener('click', () => { adjustBass(-1); save(); });
    $('#trebleUp').addEventListener('click', () => { adjustTreble(1); save(); });
    $('#trebleDown').addEventListener('click', () => { adjustTreble(-1); save(); });
    $('#eqFlat').addEventListener('click', () => {
      S.eq = [0,0,0,0,0,0,0,0,0,0];
      S.tone = { subBass:0, presence:0, air:0 };
      updateEQ(); recalcBT(); updateSliders(); save();
    });
  }

  function adjustBass(d) {
    for (let i = 0; i < 3; i++) S.eq[i] = Math.max(-12, Math.min(12, S.eq[i] + d));
    updateEQ(); recalcBT();
  }
  function adjustTreble(d) {
    for (let i = 7; i < 10; i++) S.eq[i] = Math.max(-12, Math.min(12, S.eq[i] + d));
    updateEQ(); recalcBT();
  }

  function recalcBT() {
    const bv = Math.round((S.eq[0]+S.eq[1]+S.eq[2])/3);
    const tv = Math.round((S.eq[7]+S.eq[8]+S.eq[9])/3);
    $('#bassVal').textContent = (bv>0?'+':'')+bv+' dB';
    $('#trebleVal').textContent = (tv>0?'+':'')+tv+' dB';
  }

  function updateEQ() {
    EQ_BANDS.forEach((_, i) => {
      const v = S.eq[i];
      $(`#eqS${i}`).value = v;
      $(`#eqV${i}`).textContent = v > 0 ? `+${v}` : v;
    });
  }

  /* ---- Presets ---- */
  function bindPresets() {
    $('#savePreset').addEventListener('click', () => {
      const name = $('#presetName').value.trim();
      if (!name) return;
      const copy = JSON.parse(JSON.stringify(S));
      delete copy.enabled;
      userPresets.push({ name, ts: Date.now(), data: copy });
      savePresets();
      renderPresets();
      $('#presetName').value = '';
    });
  }

  function renderPresets() {
    const c = $('#presetList');
    if (!userPresets.length) { c.innerHTML = '<div class="empty-state">No saved presets yet. Create one above.</div>'; return; }
    c.innerHTML = '';
    userPresets.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'preset-item';
      d.innerHTML = `
        <span class="preset-item-name">${p.name}</span>
        <div class="preset-item-actions">
          <button class="p-btn" data-action="load" data-i="${i}">LOAD</button>
          <button class="p-btn del" data-action="del" data-i="${i}">✕</button>
        </div>
      `;
      c.appendChild(d);
    });
    c.querySelectorAll('.p-btn').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const i = parseInt(b.dataset.i);
        if (b.dataset.action === 'load') {
          const d = JSON.parse(JSON.stringify(userPresets[i].data));
          S = { ...S, ...d, enabled: S.enabled };
          S.spatial = { ...defaults().spatial, ...d.spatial };
          S.enhance = { ...defaults().enhance, ...d.enhance };
          S.tone = { ...defaults().tone, ...d.tone };
          syncUI(); save();
        } else {
          userPresets.splice(i, 1);
          savePresets(); renderPresets();
        }
      });
    });
  }

  /* ---- Factory ---- */
  function bindFactory() {
    $$('.factory-btn').forEach(b => {
      b.addEventListener('click', () => {
        const f = FACTORY_PRESETS[b.dataset.f];
        if (!f) return;
        S.mode = f.mode;
        S.eq = [...f.eq];
        S.spatial = { ...f.spatial };
        S.enhance = { ...f.enhance };
        S.tone = { ...f.tone };
        syncUI(); save();
      });
    });
  }

  /* ---- Reset ---- */
  function bindReset() {
    $('#resetAll').addEventListener('click', () => {
      S = defaults();
      syncUI(); save();
    });
  }

  /* ---- Sync All UI ---- */
  function syncUI() {
    updateMaster();
    updateModes();
    updateSliders();
    updateEQ();
    recalcBT();
    updateSwitches();
    renderPresets();
  }

})();