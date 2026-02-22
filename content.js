/* ================================================================
   AUDIO ENGINE v2.0 — Content Script
   Real-time Web Audio API processing for YouTube.
   16D Surround · 360° · Studio · Concert Hall · Vocal Clarity
   10-Band EQ · Sub-Bass · Presence · Air · Compression
   Analog Warmth · Noise Gate · Crossfeed · Stereo Width
   Playback Speed · Pitch Shift
   ================================================================ */
(() => {
  'use strict';

  const EQ_FREQ = [31,62,125,250,500,1000,2000,4000,8000,16000];

  let ctx = null;
  let src = null;
  let connected = false;
  let state = null;
  let video = null;

  // Node references
  let nodes = {};

  /* ---- Messages ---- */
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'HR_UPDATE') {
      state = msg.state;
      apply();
    }
  });

  /* ---- Initial load ---- */
  chrome.storage.local.get(['hrState'], d => {
    if (d.hrState) { state = d.hrState; apply(); }
  });

  /* ---- Find video and connect ---- */
  function connect() {
    video = document.querySelector('video');
    if (!video || connected) return;

    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      src = ctx.createMediaElementSource(video);
      connected = true;
      buildGraph();
      if (state) apply();
    } catch (e) {
      if (e.name === 'InvalidStateError') {
        connected = true;
        if (!nodes.masterGain) buildGraph();
        if (state) apply();
      }
    }
  }

  /* ---- Build complete audio graph ---- */
  function buildGraph() {
    if (!ctx || !src) return;

    // ---- Master gain ----
    nodes.masterGain = ctx.createGain();

    // ---- High-pass (clarity / rumble cut) ----
    nodes.highPass = ctx.createBiquadFilter();
    nodes.highPass.type = 'highpass';
    nodes.highPass.frequency.value = 0;
    nodes.highPass.Q.value = 0.707;

    // ---- Low-pass (warmth) ----
    nodes.lowPass = ctx.createBiquadFilter();
    nodes.lowPass.type = 'lowpass';
    nodes.lowPass.frequency.value = 22000;
    nodes.lowPass.Q.value = 0.707;

    // ---- 10-band EQ ----
    nodes.eq = EQ_FREQ.map(f => {
      const n = ctx.createBiquadFilter();
      n.type = 'peaking';
      n.frequency.value = f;
      n.Q.value = 1.4;
      n.gain.value = 0;
      return n;
    });

    // ---- Sub-bass boost (low shelf) ----
    nodes.subBass = ctx.createBiquadFilter();
    nodes.subBass.type = 'lowshelf';
    nodes.subBass.frequency.value = 60;
    nodes.subBass.gain.value = 0;

    // ---- Presence (peaking at ~3kHz) ----
    nodes.presence = ctx.createBiquadFilter();
    nodes.presence.type = 'peaking';
    nodes.presence.frequency.value = 3000;
    nodes.presence.Q.value = 1.0;
    nodes.presence.gain.value = 0;

    // ---- Air / shimmer (high shelf at ~12kHz) ----
    nodes.air = ctx.createBiquadFilter();
    nodes.air.type = 'highshelf';
    nodes.air.frequency.value = 12000;
    nodes.air.gain.value = 0;

    // ---- Compressor ----
    nodes.comp = ctx.createDynamicsCompressor();
    nodes.comp.threshold.value = -24;
    nodes.comp.knee.value = 12;
    nodes.comp.ratio.value = 4;
    nodes.comp.attack.value = 0.003;
    nodes.comp.release.value = 0.25;

    // ---- Convolver (reverb) with dry/wet ----
    nodes.convolver = ctx.createConvolver();
    nodes.convolver.buffer = impulse(2, ctx.sampleRate, 0.5);
    nodes.wetGain = ctx.createGain();
    nodes.wetGain.gain.value = 0;
    nodes.dryGain = ctx.createGain();
    nodes.dryGain.gain.value = 1;
    nodes.reverbMerge = ctx.createGain();

    // ---- Spatial: 16 micro-delays for 16D / 360 / Concert ----
    nodes.spatialDelays = [];
    nodes.spatialGains = [];
    nodes.spatialPans = [];
    for (let i = 0; i < 16; i++) {
      const del = ctx.createDelay(0.15);
      del.delayTime.value = 0;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      // Distribute pans evenly across -1 to +1
      pan.pan.value = -1 + (i / 15) * 2;
      nodes.spatialDelays.push(del);
      nodes.spatialGains.push(g);
      nodes.spatialPans.push(pan);
    }

    // ---- Early reflections (short delays) ----
    nodes.earlyDelays = [];
    nodes.earlyGains = [];
    for (let i = 0; i < 6; i++) {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = 0.005 + i * 0.008;
      const g = ctx.createGain();
      g.gain.value = 0;
      nodes.earlyDelays.push(d);
      nodes.earlyGains.push(g);
    }

    // ---- Crossfeed ----
    nodes.crossSplitter = ctx.createChannelSplitter(2);
    nodes.crossMerger = ctx.createChannelMerger(2);
    nodes.crossL2R = ctx.createGain();
    nodes.crossR2L = ctx.createGain();
    nodes.crossL2R.gain.value = 0;
    nodes.crossR2L.gain.value = 0;
    nodes.directL = ctx.createGain();
    nodes.directR = ctx.createGain();
    nodes.directL.gain.value = 1;
    nodes.directR.gain.value = 1;

    // ---- Stereo width (mid/side) ----
    nodes.widthSplitter = ctx.createChannelSplitter(2);
    nodes.widthMerger = ctx.createChannelMerger(2);

    // ---- Balance ----
    nodes.balancePan = ctx.createStereoPanner();
    nodes.balancePan.pan.value = 0;

    // ---- Analog warmth (waveshaper) ----
    nodes.waveshaper = ctx.createWaveShaper();
    nodes.waveshaper.curve = makeWarmthCurve(0);
    nodes.waveshaper.oversample = '4x';
    nodes.warmthMix = ctx.createGain();
    nodes.warmthMix.gain.value = 0;
    nodes.warmthDry = ctx.createGain();
    nodes.warmthDry.gain.value = 1;
    nodes.warmthMerge = ctx.createGain();

    // ---- Noise gate (expander via compressor trick) ----
    nodes.gate = ctx.createDynamicsCompressor();
    nodes.gate.threshold.value = -50;
    nodes.gate.knee.value = 0;
    nodes.gate.ratio.value = 1;
    nodes.gate.attack.value = 0.001;
    nodes.gate.release.value = 0.05;

    // ---- Output gain (for loudness normalization) ----
    nodes.outputGain = ctx.createGain();
    nodes.outputGain.gain.value = 1;

    /* ================================================================
       SIGNAL CHAIN:
       src → highPass → lowPass → EQ[0-9] → subBass → presence → air
       → comp → gate → masterGain → balancePan
       → crossfeed processing
       → warmth processing
       → reverb (dry/wet)
       → spatial delays (16D/360/Concert)
       → early reflections
       → outputGain → destination
       ================================================================ */

    // Source → Filters chain
    let chain = src;
    const filters = [nodes.highPass, nodes.lowPass, ...nodes.eq, nodes.subBass, nodes.presence, nodes.air, nodes.comp, nodes.gate, nodes.masterGain, nodes.balancePan];
    filters.forEach(n => { chain.connect(n); chain = n; });

    // Balance → Crossfeed
    const afterBalance = nodes.balancePan;
    afterBalance.connect(nodes.crossSplitter);

    // Crossfeed network
    nodes.crossSplitter.connect(nodes.directL, 0);
    nodes.crossSplitter.connect(nodes.directR, 1);
    nodes.crossSplitter.connect(nodes.crossL2R, 0);
    nodes.crossSplitter.connect(nodes.crossR2L, 1);

    nodes.directL.connect(nodes.crossMerger, 0, 0);
    nodes.crossR2L.connect(nodes.crossMerger, 0, 0);
    nodes.directR.connect(nodes.crossMerger, 0, 1);
    nodes.crossL2R.connect(nodes.crossMerger, 0, 1);

    const afterCross = nodes.crossMerger;

    // Crossfeed → Warmth
    afterCross.connect(nodes.warmthDry);
    afterCross.connect(nodes.waveshaper);
    nodes.waveshaper.connect(nodes.warmthMix);
    nodes.warmthDry.connect(nodes.warmthMerge);
    nodes.warmthMix.connect(nodes.warmthMerge);

    const afterWarmth = nodes.warmthMerge;

    // Warmth → Dry path
    afterWarmth.connect(nodes.dryGain);
    nodes.dryGain.connect(nodes.outputGain);

    // Warmth → Reverb (wet path)
    afterWarmth.connect(nodes.convolver);
    nodes.convolver.connect(nodes.wetGain);
    nodes.wetGain.connect(nodes.outputGain);

    // Warmth → Spatial delays (16D / 360)
    nodes.spatialDelays.forEach((del, i) => {
      afterWarmth.connect(del);
      del.connect(nodes.spatialGains[i]);
      nodes.spatialGains[i].connect(nodes.spatialPans[i]);
      nodes.spatialPans[i].connect(nodes.outputGain);
    });

    // Warmth → Early reflections
    nodes.earlyDelays.forEach((del, i) => {
      afterWarmth.connect(del);
      del.connect(nodes.earlyGains[i]);
      nodes.earlyGains[i].connect(nodes.outputGain);
    });

    // Output
    nodes.outputGain.connect(ctx.destination);
  }

  /* ---- Generate impulse response ---- */
  function impulse(ch, sr, decay) {
    const len = sr * Math.max(0.1, decay);
    const buf = ctx.createBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 3.5);
      }
    }
    return buf;
  }

  /* ---- Waveshaper curve for analog warmth ---- */
  function makeWarmthCurve(amount) {
    const k = amount;
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  /* ---- Apply all state ---- */
  function apply() {
    if (!state) return;
    connect();
    if (!ctx || !nodes.masterGain) return;
    if (ctx.state === 'suspended') ctx.resume();

    const t = ctx.currentTime;
    const r = 0.016; // ~1 frame smooth
    const s = state;

    /* ---- If disabled, bypass everything ---- */
    if (!s.enabled) {
      nodes.masterGain.gain.setTargetAtTime(1, t, r);
      nodes.eq.forEach(n => n.gain.setTargetAtTime(0, t, r));
      nodes.subBass.gain.setTargetAtTime(0, t, r);
      nodes.presence.gain.setTargetAtTime(0, t, r);
      nodes.air.gain.setTargetAtTime(0, t, r);
      nodes.highPass.frequency.setTargetAtTime(0, t, r);
      nodes.lowPass.frequency.setTargetAtTime(22000, t, r);
      nodes.comp.threshold.setTargetAtTime(-50, t, r);
      nodes.comp.ratio.setTargetAtTime(1, t, r);
      nodes.wetGain.gain.setTargetAtTime(0, t, r);
      nodes.dryGain.gain.setTargetAtTime(1, t, r);
      nodes.spatialGains.forEach(g => g.gain.setTargetAtTime(0, t, r));
      nodes.earlyGains.forEach(g => g.gain.setTargetAtTime(0, t, r));
      nodes.crossL2R.gain.setTargetAtTime(0, t, r);
      nodes.crossR2L.gain.setTargetAtTime(0, t, r);
      nodes.directL.gain.setTargetAtTime(1, t, r);
      nodes.directR.gain.setTargetAtTime(1, t, r);
      nodes.warmthMix.gain.setTargetAtTime(0, t, r);
      nodes.warmthDry.gain.setTargetAtTime(1, t, r);
      nodes.balancePan.pan.setTargetAtTime(0, t, r);
      nodes.outputGain.gain.setTargetAtTime(1, t, r);
      nodes.gate.ratio.setTargetAtTime(1, t, r);
      if (video) { video.playbackRate = 1; }
      return;
    }

    const sp = s.spatial || {};
    const en = s.enhance || {};
    const tn = s.tone || {};
    const mode = s.mode || 'default';

    /* ---- Master Volume ---- */
    nodes.masterGain.gain.setTargetAtTime((en.masterVol || 100) / 100, t, r);

    /* ---- Balance ---- */
    nodes.balancePan.pan.setTargetAtTime((en.balance || 0) / 100, t, r);

    /* ---- High-pass (clarity) ---- */
    nodes.highPass.frequency.setTargetAtTime(en.clarity || 0, t, r);

    /* ---- Low-pass (warmth) ---- */
    nodes.lowPass.frequency.setTargetAtTime(en.warmth || 22000, t, r);

    /* ---- EQ ---- */
    if (s.eq && s.eq.length === 10) {
      s.eq.forEach((v, i) => nodes.eq[i].gain.setTargetAtTime(v, t, r));
    }

    /* ---- Tone shaping ---- */
    nodes.subBass.gain.setTargetAtTime(tn.subBass || 0, t, r);
    nodes.presence.gain.setTargetAtTime(tn.presence || 0, t, r);
    nodes.air.gain.setTargetAtTime(tn.air || 0, t, r);

    /* ---- Compressor ---- */
    nodes.comp.threshold.setTargetAtTime(en.compThreshold ?? -24, t, r);
    nodes.comp.ratio.setTargetAtTime(en.compRatio ?? 4, t, r);
    nodes.comp.attack.setTargetAtTime((en.compAttack ?? 3) / 1000, t, r);
    nodes.comp.release.setTargetAtTime((en.compRelease ?? 250) / 1000, t, r);

    /* ---- Loudness normalization ---- */
    if (en.loudnessNorm) {
      nodes.comp.threshold.setTargetAtTime(Math.min(en.compThreshold ?? -24, -18), t, r);
      nodes.comp.ratio.setTargetAtTime(Math.max(en.compRatio ?? 4, 6), t, r);
      nodes.outputGain.gain.setTargetAtTime(1.15, t, r);
    } else {
      nodes.outputGain.gain.setTargetAtTime(1, t, r);
    }

    /* ---- Noise gate ---- */
    if (en.noiseGate) {
      nodes.gate.threshold.setTargetAtTime(-45, t, r);
      nodes.gate.ratio.setTargetAtTime(20, t, r);
      nodes.gate.attack.setTargetAtTime(0.001, t, r);
      nodes.gate.release.setTargetAtTime(0.05, t, r);
    } else {
      nodes.gate.threshold.setTargetAtTime(-100, t, r);
      nodes.gate.ratio.setTargetAtTime(1, t, r);
    }

    /* ---- Crossfeed ---- */
    const cf = (sp.crossfeed || 0) / 100;
    nodes.crossL2R.gain.setTargetAtTime(cf * 0.35, t, r);
    nodes.crossR2L.gain.setTargetAtTime(cf * 0.35, t, r);
    nodes.directL.gain.setTargetAtTime(1 - cf * 0.15, t, r);
    nodes.directR.gain.setTargetAtTime(1 - cf * 0.15, t, r);

    /* ---- Analog warmth ---- */
    if (en.analogWarmth) {
      nodes.waveshaper.curve = makeWarmthCurve(50);
      nodes.warmthMix.gain.setTargetAtTime(0.15, t, r);
      nodes.warmthDry.gain.setTargetAtTime(0.85, t, r);
    } else {
      nodes.warmthMix.gain.setTargetAtTime(0, t, r);
      nodes.warmthDry.gain.setTargetAtTime(1, t, r);
    }

    /* ---- Reverb ---- */
    const wet = (sp.wetDry || 0) / 100;
    const roomFactor = (sp.roomSize || 0) / 100;
    const decayFactor = (sp.reverbDecay || 0) / 100;

    // Mode-dependent reverb scaling
    let reverbScale = 1;
    if (mode === 'studio') reverbScale = 0.25;
    else if (mode === 'concert') reverbScale = 2.0;
    else if (mode === '360') reverbScale = 1.5;
    else if (mode === '16d') reverbScale = 0.8;
    else if (mode === 'vocal') reverbScale = 0.5;

    const finalWet = wet * reverbScale;
    nodes.wetGain.gain.setTargetAtTime(Math.min(finalWet, 1), t, r);
    nodes.dryGain.gain.setTargetAtTime(1 - finalWet * 0.3, t, r);

    // Generate new impulse response
    const iDec = 0.1 + roomFactor * 3 * reverbScale + decayFactor * 2;
    try { nodes.convolver.buffer = impulse(2, ctx.sampleRate, Math.min(iDec, 5)); } catch(e) {}

    /* ---- Early reflections ---- */
    const erLevel = (sp.earlyRef || 0) / 100;
    let erScale = 1;
    if (mode === 'concert') erScale = 1.5;
    else if (mode === 'studio') erScale = 0.3;

    nodes.earlyDelays.forEach((d, i) => {
      const baseT = 0.004 + i * 0.007;
      d.delayTime.setTargetAtTime(baseT, t, r);
    });
    nodes.earlyGains.forEach((g, i) => {
      const v = erLevel * erScale * 0.2 * (1 - i * 0.12);
      g.gain.setTargetAtTime(Math.max(0, v), t, r);
    });

    /* ---- Spatial Processing (16D / 360 / Concert) ---- */
    const depth = (sp.depth16d || 0) / 100;
    const spread = (sp.spatialSpread || 0) / 180;
    const preDelay = (sp.preDelay || 0) / 1000;
    const stereoW = (sp.stereoWidth || 100) / 100;

    if (mode === '16d') {
      // 16 fixed directions, short delays, moderate gain
      nodes.spatialDelays.forEach((del, i) => {
        const dt = 0.001 + preDelay * 0.1 + (i * 0.0035 * depth);
        del.delayTime.setTargetAtTime(Math.min(0.12, dt), t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.22 * (1 - (i / 16) * 0.5) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        const pan = (-1 + (i / 15) * 2) * stereoW;
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });

    } else if (mode === '360') {
      // Deeper, more spread, longer delays
      nodes.spatialDelays.forEach((del, i) => {
        const dt = 0.002 + preDelay * 0.15 + (i * 0.005 * depth);
        del.delayTime.setTargetAtTime(Math.min(0.14, dt), t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.28 * (1 - (i / 16) * 0.35) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        // Spiral panning
        const angle = (i / 16) * Math.PI * 2;
        const pan = Math.sin(angle) * stereoW;
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });

    } else if (mode === 'concert') {
      // Large room, lots of spatial depth
      nodes.spatialDelays.forEach((del, i) => {
        const dt = 0.005 + preDelay * 0.2 + (i * 0.006 * depth);
        del.delayTime.setTargetAtTime(Math.min(0.14, dt), t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.3 * (1 - (i / 16) * 0.4) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        const pan = (-1 + (i / 15) * 2) * stereoW * 0.8;
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });

    } else if (mode === 'vocal') {
      // Center-focused, minimal spatial
      nodes.spatialGains.forEach(g => g.gain.setTargetAtTime(0, t, r));

    } else if (mode === 'studio') {
      // Clean, no spatial delays
      nodes.spatialGains.forEach(g => g.gain.setTargetAtTime(0, t, r));

    } else {
      // Default — clean, no spatial delays
      nodes.spatialGains.forEach(g => g.gain.setTargetAtTime(0, t, r));
    }

    /* ---- Playback speed ---- */
    if (video && en.speed) {
      const newSpeed = (en.speed || 100) / 100;
      if (Math.abs(video.playbackRate - newSpeed) > 0.01) {
        video.playbackRate = newSpeed;
      }
    }

    /* ---- Mono downmix ---- */
    // Handled by setting stereo width to 0 effectively
    // For true mono, we'd need to re-wire, so we use crossfeed at 100%
    if (en.monoCompat) {
      nodes.crossL2R.gain.setTargetAtTime(0.5, t, r);
      nodes.crossR2L.gain.setTargetAtTime(0.5, t, r);
      nodes.directL.gain.setTargetAtTime(0.5, t, r);
      nodes.directR.gain.setTargetAtTime(0.5, t, r);
    }
  }

  /* ---- Observers & Auto-connect ---- */
  function init() {
    connect();

    // Watch for DOM changes (YouTube SPA navigation)
    const obs = new MutationObserver(() => {
      if (!connected && document.querySelector('video')) {
        setTimeout(() => { connect(); if (state) apply(); }, 300);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // URL change detection
    let lastUrl = location.href;
    const urlObs = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Reset connection on navigation
        connected = false;
        src = null;
        ctx = null;
        nodes = {};
        setTimeout(() => { connect(); if (state) apply(); }, 1200);
      }
    });
    urlObs.observe(document, { subtree: true, childList: true });

    // Resume AudioContext on user interaction
    document.addEventListener('click', () => {
      if (ctx?.state === 'suspended') ctx.resume();
      if (!connected) { connect(); if (state) apply(); }
    }, { passive: true });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 800);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
  }

})();