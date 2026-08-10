/* ================================================================
   AUDIO ENGINE v2.1 — Content Script
   Fixed: Volume levels, no refresh on settings change
   ================================================================ */
(() => {
  'use strict';

  const EQ_FREQ = [31,62,125,250,500,1000,2000,4000,8000,16000];

  let ctx = null;
  let src = null;
  let connected = false;
  let state = null;
  let video = null;
  let analyserNode = null;
  let bassEnhancer = null;
  let lastState = null;

  // Node references
  let nodes = {};

  /* ---- Messages ---- */
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'HR_UPDATE') {
      state = msg.state;
      // Only reconnect if mode changed, otherwise just apply settings
      if (!lastState || lastState.mode !== state.mode) {
        reconnect();
      } else {
        apply();
      }
      lastState = JSON.parse(JSON.stringify(state));
    }
  });

  /* ---- Initial load ---- */
  chrome.storage.local.get(['hrState'], d => {
    if (d.hrState) { 
      state = d.hrState; 
      lastState = JSON.parse(JSON.stringify(state));
      apply(); 
    }
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
    } catch (e) {
      if (e.name === 'InvalidStateError') {
        connected = true;
        if (!nodes.masterGain) buildGraph();
      }
    }
  }

  function reconnect() {
    // Disconnect old nodes
    if (src && connected) {
      try { src.disconnect(); } catch(e) {}
    }
    connected = false;
    src = null;
    nodes = {};
    connect();
    if (state) apply();
  }

  /* ---- Build complete audio graph ---- */
  function buildGraph() {
    if (!ctx || !src) return;

    // ---- Analyser for visualization ----
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;

    // ---- Master gain - START AT 1.0 (full volume) ----
    nodes.masterGain = ctx.createGain();
    nodes.masterGain.gain.value = 1.0;

    // ---- Subharmonic Bass Enhancer ----
    bassEnhancer = ctx.createWaveShaper();
    bassEnhancer.curve = makeSubBassCurve(0);
    nodes.bassMix = ctx.createGain();
    nodes.bassMix.gain.value = 0;
    nodes.bassDry = ctx.createGain();
    nodes.bassDry.gain.value = 1;
    nodes.bassMerge = ctx.createGain();

    // ---- Multi-band processing ----
    nodes.lowBandFilter = ctx.createBiquadFilter();
    nodes.lowBandFilter.type = 'lowpass';
    nodes.lowBandFilter.frequency.value = 200;
    nodes.lowBandGain = ctx.createGain();
    nodes.lowBandGain.gain.value = 1;
    
    nodes.midBandFilter = ctx.createBiquadFilter();
    nodes.midBandFilter.type = 'bandpass';
    nodes.midBandFilter.frequency.value = 1000;
    nodes.midBandFilter.Q.value = 0.5;
    nodes.midBandGain = ctx.createGain();
    nodes.midBandGain.gain.value = 1;
    
    nodes.highBandFilter = ctx.createBiquadFilter();
    nodes.highBandFilter.type = 'highpass';
    nodes.highBandFilter.frequency.value = 4000;
    nodes.highBandGain = ctx.createGain();
    nodes.highBandGain.gain.value = 1;
    
    nodes.bandMerger = ctx.createGain();

    // ---- Vocal Enhancer (Multi-stage) ----
    nodes.vocalPresence1 = ctx.createBiquadFilter();
    nodes.vocalPresence1.type = 'peaking';
    nodes.vocalPresence1.frequency.value = 800;
    nodes.vocalPresence1.Q.value = 0.8;
    nodes.vocalPresence1.gain.value = 0;

    nodes.vocalPresence2 = ctx.createBiquadFilter();
    nodes.vocalPresence2.type = 'peaking';
    nodes.vocalPresence2.frequency.value = 2500;
    nodes.vocalPresence2.Q.value = 1.2;
    nodes.vocalPresence2.gain.value = 0;

    nodes.vocalPresence3 = ctx.createBiquadFilter();
    nodes.vocalPresence3.type = 'peaking';
    nodes.vocalPresence3.frequency.value = 5000;
    nodes.vocalPresence3.Q.value = 0.7;
    nodes.vocalPresence3.gain.value = 0;

    // ---- Vocal Exciter (Harmonics) ----
    nodes.vocalExciter = ctx.createWaveShaper();
    nodes.vocalExciter.curve = makeExciterCurve(0);
    nodes.vocalExciterMix = ctx.createGain();
    nodes.vocalExciterMix.gain.value = 0;
    nodes.vocalExciterDry = ctx.createGain();
    nodes.vocalExciterDry.gain.value = 1;
    nodes.vocalExciterMerge = ctx.createGain();

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
      n.Q.value = 1.0;
      n.gain.value = 0;
      return n;
    });

    // ---- Sub-bass boost (low shelf) ----
    nodes.subBass = ctx.createBiquadFilter();
    nodes.subBass.type = 'lowshelf';
    nodes.subBass.frequency.value = 60;
    nodes.subBass.gain.value = 0;

    // ---- Bass punch (peaking at ~80Hz) ----
    nodes.bassPunch = ctx.createBiquadFilter();
    nodes.bassPunch.type = 'peaking';
    nodes.bassPunch.frequency.value = 80;
    nodes.bassPunch.Q.value = 0.7;
    nodes.bassPunch.gain.value = 0;

    // ---- Presence (peaking at ~3kHz) ----
    nodes.presence = ctx.createBiquadFilter();
    nodes.presence.type = 'peaking';
    nodes.presence.frequency.value = 3000;
    nodes.presence.Q.value = 0.8;
    nodes.presence.gain.value = 0;

    // ---- Air / shimmer (high shelf at ~12kHz) ----
    nodes.air = ctx.createBiquadFilter();
    nodes.air.type = 'highshelf';
    nodes.air.frequency.value = 12000;
    nodes.air.gain.value = 0;

    // ---- Ultra-high sparkle (16kHz shelf) ----
    nodes.sparkle = ctx.createBiquadFilter();
    nodes.sparkle.type = 'highshelf';
    nodes.sparkle.frequency.value = 16000;
    nodes.sparkle.gain.value = 0;

    // ---- Compressor - HIGHER THRESHOLD, LOWER RATIO ----
    nodes.comp = ctx.createDynamicsCompressor();
    nodes.comp.threshold.value = -12;
    nodes.comp.knee.value = 20;
    nodes.comp.ratio.value = 2;
    nodes.comp.attack.value = 0.005;
    nodes.comp.release.value = 0.15;

    // ---- Multi-band Compressor ----
    nodes.mbLowComp = ctx.createDynamicsCompressor();
    nodes.mbLowComp.threshold.value = -50;
    nodes.mbLowComp.knee.value = 8;
    nodes.mbLowComp.ratio.value = 1;
    nodes.mbLowComp.attack.value = 0.01;
    nodes.mbLowComp.release.value = 0.15;

    nodes.mbHighComp = ctx.createDynamicsCompressor();
    nodes.mbHighComp.threshold.value = -50;
    nodes.mbHighComp.knee.value = 10;
    nodes.mbHighComp.ratio.value = 1;
    nodes.mbHighComp.attack.value = 0.002;
    nodes.mbHighComp.release.value = 0.1;

    // ---- Convolver (reverb) with dry/wet ----
    nodes.convolver = ctx.createConvolver();
    try { nodes.convolver.buffer = impulse(2, ctx.sampleRate, 1.5); } catch(e) {}
    nodes.wetGain = ctx.createGain();
    nodes.wetGain.gain.value = 0;
    nodes.dryGain = ctx.createGain();
    nodes.dryGain.gain.value = 1;

    // ---- Early Reflections convolver ----
    nodes.earlyConvolver = ctx.createConvolver();
    try { nodes.earlyConvolver.buffer = createEarlyReflections(2, ctx.sampleRate); } catch(e) {}
    nodes.earlyWetGain = ctx.createGain();
    nodes.earlyWetGain.gain.value = 0;
    nodes.earlyMerge = ctx.createGain();

    // ---- Spatial: 16 micro-delays ----
    nodes.spatialDelays = [];
    nodes.spatialGains = [];
    nodes.spatialPans = [];
    nodes.spatialFilters = [];
    for (let i = 0; i < 16; i++) {
      const del = ctx.createDelay(0.15);
      del.delayTime.value = 0;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = -1 + (i / 15) * 2;
      
      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 300;
      lowShelf.gain.value = 0;
      
      nodes.spatialDelays.push(del);
      nodes.spatialGains.push(g);
      nodes.spatialPans.push(pan);
      nodes.spatialFilters.push(lowShelf);
    }

    // ---- Early reflections (short delays) ----
    nodes.earlyDelays = [];
    nodes.earlyGains = [];
    nodes.earlyFilters = [];
    for (let i = 0; i < 8; i++) {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = Math.min(0.005 + i * 0.005, 0.04);
      const g = ctx.createGain();
      g.gain.value = 0;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 8000;
      nodes.earlyDelays.push(d);
      nodes.earlyGains.push(g);
      nodes.earlyFilters.push(lowpass);
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
    nodes.midGain = ctx.createGain();
    nodes.sideGain = ctx.createGain();
    nodes.midGain.gain.value = 1;
    nodes.sideGain.gain.value = 1;

    // ---- Balance ----
    nodes.balancePan = ctx.createStereoPanner();
    nodes.balancePan.pan.value = 0;

    // ---- Analog warmth ----
    nodes.waveshaper = ctx.createWaveShaper();
    nodes.waveshaper.curve = makeWarmthCurve(0);
    nodes.warmthMix = ctx.createGain();
    nodes.warmthMix.gain.value = 0;
    nodes.warmthDry = ctx.createGain();
    nodes.warmthDry.gain.value = 1;
    nodes.warmthMerge = ctx.createGain();

    // ---- Tube saturation ----
    nodes.tubeSaturator = ctx.createWaveShaper();
    nodes.tubeSaturator.curve = makeTubeCurve(1);
    nodes.tubeMix = ctx.createGain();
    nodes.tubeMix.gain.value = 0;
    nodes.tubeDry = ctx.createGain();
    nodes.tubeDry.gain.value = 1;
    nodes.tubeMerge = ctx.createGain();

    // ---- Noise gate ----
    nodes.gate = ctx.createDynamicsCompressor();
    nodes.gate.threshold.value = -100;
    nodes.gate.knee.value = 0;
    nodes.gate.ratio.value = 1;
    nodes.gate.attack.value = 0.001;
    nodes.gate.release.value = 0.05;

    // ---- De-esser ----
    nodes.deEsser = ctx.createBiquadFilter();
    nodes.deEsser.type = 'peaking';
    nodes.deEsser.frequency.value = 6500;
    nodes.deEsser.Q.value = 0.01;
    nodes.deEsser.gain.value = 0;

    // ---- Output gain ----
    nodes.outputGain = ctx.createGain();
    nodes.outputGain.gain.value = 1;

    // ---- Limiter - SOFTER ----
    nodes.limiter = ctx.createDynamicsCompressor();
    nodes.limiter.threshold.value = -1;
    nodes.limiter.knee.value = 1;
    nodes.limiter.ratio.value = 4;
    nodes.limiter.attack.value = 0.001;
    nodes.limiter.release.value = 0.05;

    /* ================================================================
       SIMPLIFIED SIGNAL CHAIN (less gain reduction):
       src → analyser → vocal enhancers → EQ → tone shaping
       → comp → gate → masterGain → stereo width
       → reverb → spatial → outputGain → limiter → destination
       ================================================================ */

    // Source → Analyser
    src.connect(analyserNode);
    let chain = analyserNode;

    // Subharmonic Bass (parallel, subtle)
    src.connect(bassEnhancer);
    bassEnhancer.connect(nodes.bassMix);
    src.connect(nodes.bassDry);
    nodes.bassDry.connect(nodes.bassMerge);
    nodes.bassMix.connect(nodes.bassMerge);
    
    chain = nodes.bassMerge;

    // Vocal enhancers
    chain.connect(nodes.vocalPresence1);
    nodes.vocalPresence1.connect(nodes.vocalPresence2);
    nodes.vocalPresence2.connect(nodes.vocalPresence3);
    chain = nodes.vocalPresence3;

    // Multi-band (parallel)
    chain.connect(nodes.lowBandFilter);
    nodes.lowBandFilter.connect(nodes.lowBandGain);
    nodes.lowBandGain.connect(nodes.mbLowComp);
    nodes.mbLowComp.connect(nodes.bandMerger);

    chain.connect(nodes.midBandFilter);
    nodes.midBandFilter.connect(nodes.midBandGain);
    nodes.midBandGain.connect(nodes.bandMerger);

    chain.connect(nodes.highBandFilter);
    nodes.highBandFilter.connect(nodes.highBandGain);
    nodes.highBandGain.connect(nodes.mbHighComp);
    nodes.mbHighComp.connect(nodes.bandMerger);

    chain = nodes.bandMerger;

    // Main processing chain
    const filters = [
      nodes.highPass, nodes.lowPass, 
      ...nodes.eq, 
      nodes.subBass, nodes.bassPunch, 
      nodes.presence, nodes.air, nodes.sparkle,
      nodes.comp, nodes.deEsser, nodes.gate, 
      nodes.masterGain, nodes.balancePan
    ];
    filters.forEach(n => { chain.connect(n); chain = n; });

    // Stereo width
    chain.connect(nodes.widthSplitter);
    nodes.widthSplitter.connect(nodes.midGain, 0);
    nodes.widthSplitter.connect(nodes.sideGain, 1);
    nodes.midGain.connect(nodes.widthMerger, 0, 0);
    nodes.sideGain.connect(nodes.widthMerger, 0, 1);

    // Crossfeed
    nodes.widthMerger.connect(nodes.crossSplitter);
    nodes.crossSplitter.connect(nodes.directL, 0);
    nodes.crossSplitter.connect(nodes.directR, 1);
    nodes.crossSplitter.connect(nodes.crossL2R, 0);
    nodes.crossSplitter.connect(nodes.crossR2L, 1);
    nodes.directL.connect(nodes.crossMerger, 0, 0);
    nodes.crossR2L.connect(nodes.crossMerger, 0, 0);
    nodes.directR.connect(nodes.crossMerger, 0, 1);
    nodes.crossL2R.connect(nodes.crossMerger, 0, 1);

    // Dry path
    nodes.crossMerger.connect(nodes.dryGain);
    nodes.dryGain.connect(nodes.earlyMerge);

    // Reverb path
    nodes.crossMerger.connect(nodes.convolver);
    nodes.convolver.connect(nodes.wetGain);
    nodes.wetGain.connect(nodes.earlyMerge);

    // Early reflections
    nodes.crossMerger.connect(nodes.earlyConvolver);
    nodes.earlyConvolver.connect(nodes.earlyWetGain);
    nodes.earlyWetGain.connect(nodes.earlyMerge);

    // Spatial delays
    nodes.spatialDelays.forEach((del, i) => {
      nodes.crossMerger.connect(del);
      del.connect(nodes.spatialFilters[i]);
      nodes.spatialFilters[i].connect(nodes.spatialGains[i]);
      nodes.spatialGains[i].connect(nodes.spatialPans[i]);
      nodes.spatialPans[i].connect(nodes.earlyMerge);
    });

    // Short early delays
    nodes.earlyDelays.forEach((del, i) => {
      nodes.crossMerger.connect(del);
      del.connect(nodes.earlyFilters[i]);
      nodes.earlyFilters[i].connect(nodes.earlyGains[i]);
      nodes.earlyGains[i].connect(nodes.earlyMerge);
    });

    // Output
    nodes.earlyMerge.connect(nodes.outputGain);
    nodes.outputGain.connect(nodes.limiter);
    nodes.limiter.connect(ctx.destination);
  }

  /* ---- Generate impulse response ---- */
  function impulse(ch, sr, decay) {
    const len = Math.floor(sr * Math.max(0.3, Math.min(decay, 3)));
    const buf = ctx.createBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3 / (decay + 0.5));
      }
    }
    return buf;
  }

  /* ---- Early Reflections IR ---- */
  function createEarlyReflections(ch, sr) {
    const len = Math.floor(sr * 0.08);
    const buf = ctx.createBuffer(ch, len, sr);
    const reflections = [0.012, 0.022, 0.032, 0.042];
    
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      d.fill(0);
      for (let r = 0; r < reflections.length; r++) {
        const pos = Math.floor(reflections[r] * sr);
        if (pos < len) {
          d[pos] = (Math.random() * 2 - 1) * (1 - r * 0.15) * 0.3;
        }
      }
    }
    return buf;
  }

  /* ---- Subharmonic Bass Curve ---- */
  function makeSubBassCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = x + Math.sin(x * Math.PI * 2) * amount * 0.2;
    }
    return curve;
  }

  /* ---- Vocal Exciter Curve ---- */
  function makeExciterCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = x + (x * x * x * 0.3) * amount;
    }
    return curve;
  }

  /* ---- Tube Saturation Curve ---- */
  function makeTubeCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * (1 + amount * 0.3));
    }
    return curve;
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
    const r = 0.025;
    const s = state;

    /* ---- If disabled, set to clean pass-through with FULL volume ---- */
    if (!s.enabled) {
      // Reset everything to neutral/pass-through
      nodes.masterGain.gain.setTargetAtTime(1.0, t, r);
      nodes.eq.forEach(n => n.gain.setTargetAtTime(0, t, r));
      nodes.subBass.gain.setTargetAtTime(0, t, r);
      nodes.bassPunch.gain.setTargetAtTime(0, t, r);
      nodes.presence.gain.setTargetAtTime(0, t, r);
      nodes.air.gain.setTargetAtTime(0, t, r);
      nodes.sparkle.gain.setTargetAtTime(0, t, r);
      nodes.highPass.frequency.setTargetAtTime(0, t, r);
      nodes.lowPass.frequency.setTargetAtTime(22000, t, r);
      nodes.comp.threshold.setTargetAtTime(0, t, r);
      nodes.comp.ratio.setTargetAtTime(1, t, r);
      nodes.wetGain.gain.setTargetAtTime(0, t, r);
      nodes.dryGain.gain.setTargetAtTime(1, t, r);
      nodes.earlyWetGain.gain.setTargetAtTime(0, t, r);
      nodes.spatialGains.forEach(g => g.gain.setTargetAtTime(0, t, r));
      nodes.earlyGains.forEach(g => g.gain.setTargetAtTime(0, t, r));
      nodes.crossL2R.gain.setTargetAtTime(0, t, r);
      nodes.crossR2L.gain.setTargetAtTime(0, t, r);
      nodes.directL.gain.setTargetAtTime(1, t, r);
      nodes.directR.gain.setTargetAtTime(1, t, r);
      nodes.warmthMix.gain.setTargetAtTime(0, t, r);
      nodes.warmthDry.gain.setTargetAtTime(1, t, r);
      nodes.tubeMix.gain.setTargetAtTime(0, t, r);
      nodes.tubeDry.gain.setTargetAtTime(1, t, r);
      nodes.bassMix.gain.setTargetAtTime(0, t, r);
      nodes.bassDry.gain.setTargetAtTime(1, t, r);
      nodes.vocalExciterMix.gain.setTargetAtTime(0, t, r);
      nodes.vocalExciterDry.gain.setTargetAtTime(1, t, r);
      nodes.vocalPresence1.gain.setTargetAtTime(0, t, r);
      nodes.vocalPresence2.gain.setTargetAtTime(0, t, r);
      nodes.vocalPresence3.gain.setTargetAtTime(0, t, r);
      nodes.lowBandGain.gain.setTargetAtTime(1, t, r);
      nodes.midBandGain.gain.setTargetAtTime(1, t, r);
      nodes.highBandGain.gain.setTargetAtTime(1, t, r);
      nodes.midGain.gain.setTargetAtTime(1, t, r);
      nodes.sideGain.gain.setTargetAtTime(1, t, r);
      nodes.balancePan.pan.setTargetAtTime(0, t, r);
      nodes.outputGain.gain.setTargetAtTime(1, t, r);
      nodes.limiter.threshold.setTargetAtTime(0, t, r);
      nodes.gate.threshold.setTargetAtTime(-100, t, r);
      nodes.gate.ratio.setTargetAtTime(1, t, r);
      nodes.mbLowComp.threshold.setTargetAtTime(-50, t, r);
      nodes.mbLowComp.ratio.setTargetAtTime(1, t, r);
      nodes.mbHighComp.threshold.setTargetAtTime(-50, t, r);
      nodes.mbHighComp.ratio.setTargetAtTime(1, t, r);
      nodes.deEsser.Q.setTargetAtTime(0.01, t, r);
      nodes.deEsser.gain.setTargetAtTime(0, t, r);
      if (video) { video.playbackRate = 1; }
      return;
    }

    const sp = s.spatial || {};
    const en = s.enhance || {};
    const tn = s.tone || {};
    const mode = s.mode || 'default';

    /* ---- Master Volume - NO REDUCTION ---- */
    const vol = (en.masterVol || 100) / 100;
    nodes.masterGain.gain.setTargetAtTime(vol, t, r);

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
    nodes.bassPunch.gain.setTargetAtTime(tn.bassPunch || 0, t, r);
    nodes.presence.gain.setTargetAtTime(tn.presence || 0, t, r);
    nodes.air.gain.setTargetAtTime(tn.air || 0, t, r);
    nodes.sparkle.gain.setTargetAtTime(tn.sparkle || 0, t, r);

    /* ---- Sub-Bass Enhancer ---- */
    if (en.subBassEnhance) {
      nodes.bassMix.gain.setTargetAtTime(0.15, t, r);
      nodes.bassDry.gain.setTargetAtTime(0.9, t, r);
      bassEnhancer.curve = makeSubBassCurve(40);
    } else {
      nodes.bassMix.gain.setTargetAtTime(0, t, r);
      nodes.bassDry.gain.setTargetAtTime(1, t, r);
    }

    /* ---- Vocal Enhancement - LESS AGGRESSIVE ---- */
    const vocalEnhance = (en.vocalEnhance || 0) / 100;
    nodes.vocalPresence1.gain.setTargetAtTime(vocalEnhance * 2, t, r);
    nodes.vocalPresence2.gain.setTargetAtTime(vocalEnhance * 3, t, r);
    nodes.vocalPresence3.gain.setTargetAtTime(vocalEnhance * 1.5, t, r);

    const vocalExciter = (en.vocalExciter || 0) / 100;
    nodes.vocalExciter.curve = makeExciterCurve(vocalExciter * 0.7);
    nodes.vocalExciterMix.gain.setTargetAtTime(vocalExciter * 0.15, t, r);
    nodes.vocalExciterDry.gain.setTargetAtTime(1 - vocalExciter * 0.05, t, r);

    /* ---- Multi-band - NO ADDITIONAL GAIN ---- */
    nodes.lowBandGain.gain.setTargetAtTime(1, t, r);
    nodes.midBandGain.gain.setTargetAtTime(1, t, r);
    nodes.highBandGain.gain.setTargetAtTime(1, t, r);

    /* ---- Compressor - LESS AGGRESSIVE ---- */
    nodes.comp.threshold.setTargetAtTime(en.compThreshold ?? -12, t, r);
    nodes.comp.ratio.setTargetAtTime(en.compRatio ?? 2, t, r);
    nodes.comp.attack.setTargetAtTime((en.compAttack ?? 5) / 1000, t, r);
    nodes.comp.release.setTargetAtTime((en.compRelease ?? 150) / 1000, t, r);

    /* ---- Multi-band compression ---- */
    if (en.multiBandComp) {
      nodes.mbLowComp.threshold.setTargetAtTime(-24, t, r);
      nodes.mbLowComp.ratio.setTargetAtTime(6, t, r);
      nodes.mbHighComp.threshold.setTargetAtTime(-18, t, r);
      nodes.mbHighComp.ratio.setTargetAtTime(3, t, r);
    } else {
      nodes.mbLowComp.threshold.setTargetAtTime(-50, t, r);
      nodes.mbLowComp.ratio.setTargetAtTime(1, t, r);
      nodes.mbHighComp.threshold.setTargetAtTime(-50, t, r);
      nodes.mbHighComp.ratio.setTargetAtTime(1, t, r);
    }

    /* ---- De-esser ---- */
    if (en.deEsser) {
      nodes.deEsser.Q.setTargetAtTime(0.3, t, r);
      nodes.deEsser.gain.setTargetAtTime(-3, t, r);
    } else {
      nodes.deEsser.Q.setTargetAtTime(0.01, t, r);
      nodes.deEsser.gain.setTargetAtTime(0, t, r);
    }

    /* ---- Loudness normalization - LESS BOOST ---- */
    if (en.loudnessNorm) {
      nodes.comp.threshold.setTargetAtTime(Math.min(en.compThreshold ?? -12, -16), t, r);
      nodes.comp.ratio.setTargetAtTime(Math.max(en.compRatio ?? 2, 4), t, r);
      nodes.outputGain.gain.setTargetAtTime(1.05, t, r);
      nodes.limiter.threshold.setTargetAtTime(-1, t, r);
    } else {
      nodes.outputGain.gain.setTargetAtTime(1, t, r);
      nodes.limiter.threshold.setTargetAtTime(0, t, r);
    }

    /* ---- Noise gate ---- */
    if (en.noiseGate) {
      nodes.gate.threshold.setTargetAtTime(-45, t, r);
      nodes.gate.ratio.setTargetAtTime(12, t, r);
    } else {
      nodes.gate.threshold.setTargetAtTime(-100, t, r);
      nodes.gate.ratio.setTargetAtTime(1, t, r);
    }

    /* ---- Crossfeed ---- */
    const cf = (sp.crossfeed || 0) / 100;
    nodes.crossL2R.gain.setTargetAtTime(cf * 0.25, t, r);
    nodes.crossR2L.gain.setTargetAtTime(cf * 0.25, t, r);
    nodes.directL.gain.setTargetAtTime(1 - cf * 0.05, t, r);
    nodes.directR.gain.setTargetAtTime(1 - cf * 0.05, t, r);

    /* ---- Stereo Width ---- */
    const stereoW = (sp.stereoWidth || 100) / 100;
    nodes.midGain.gain.setTargetAtTime(stereoW < 1 ? 1 : Math.max(0.2, 2 - stereoW), t, r);
    nodes.sideGain.gain.setTargetAtTime(Math.min(stereoW, 1.5), t, r);

    /* ---- Analog warmth - SUBTLE ---- */
    if (en.analogWarmth) {
      nodes.waveshaper.curve = makeWarmthCurve(40);
      nodes.warmthMix.gain.setTargetAtTime(0.1, t, r);
      nodes.warmthDry.gain.setTargetAtTime(0.9, t, r);
    } else {
      nodes.warmthMix.gain.setTargetAtTime(0, t, r);
      nodes.warmthDry.gain.setTargetAtTime(1, t, r);
    }

    /* ---- Tube saturation - SUBTLE ---- */
    if (en.tubeSaturation) {
      nodes.tubeSaturator.curve = makeTubeCurve(0.4);
      nodes.tubeMix.gain.setTargetAtTime(0.1, t, r);
      nodes.tubeDry.gain.setTargetAtTime(0.9, t, r);
    } else {
      nodes.tubeMix.gain.setTargetAtTime(0, t, r);
      nodes.tubeDry.gain.setTargetAtTime(1, t, r);
    }

    /* ---- Reverb ---- */
    const wet = (sp.wetDry || 0) / 100;
    const roomFactor = (sp.roomSize || 0) / 100;
    const decayFactor = (sp.reverbDecay || 0) / 100;

    let reverbScale = 1;
    if (mode === 'studio') reverbScale = 0.3;
    else if (mode === 'concert') reverbScale = 2.0;
    else if (mode === '360') reverbScale = 1.5;
    else if (mode === '16d') reverbScale = 1.0;
    else if (mode === 'vocal') reverbScale = 0.5;
    else if (mode === 'arena') reverbScale = 2.5;
    else if (mode === 'club') reverbScale = 1.3;

    const finalWet = wet * reverbScale;
    nodes.wetGain.gain.setTargetAtTime(Math.min(finalWet * 0.8, 1.2), t, r);
    nodes.dryGain.gain.setTargetAtTime(Math.max(0.5, 1 - finalWet * 0.3), t, r);

    const erLevel = (sp.earlyRef || 0) / 100;
    nodes.earlyWetGain.gain.setTargetAtTime(erLevel * reverbScale * 0.3, t, r);

    const iDec = 0.2 + roomFactor * 2.5 * reverbScale + decayFactor * 1.5;
    try { 
      nodes.convolver.buffer = impulse(2, ctx.sampleRate, Math.min(iDec, 3)); 
      nodes.earlyConvolver.buffer = createEarlyReflections(2, ctx.sampleRate);
    } catch(e) {}

    /* ---- Early reflections (short delays) ---- */
    let erScale = 1;
    if (mode === 'concert') erScale = 1.5;
    else if (mode === 'arena') erScale = 2.0;

    nodes.earlyDelays.forEach((d, i) => {
      const baseT = Math.min(0.004 + i * 0.005, 0.035);
      d.delayTime.setTargetAtTime(baseT, t, r);
    });
    nodes.earlyGains.forEach((g, i) => {
      const v = erLevel * erScale * 0.15 * (1 - i * 0.1);
      g.gain.setTargetAtTime(Math.max(0, v), t, r);
    });

    /* ---- Spatial Processing ---- */
    const depth = (sp.depth16d || 0) / 100;
    const spread = (sp.spatialSpread || 0) / 180;
    const preDelay = (sp.preDelay || 0) / 1000;

    if (mode === '16d') {
      nodes.spatialDelays.forEach((del, i) => {
        const dt = Math.min(0.001 + preDelay * 0.08 + (i * 0.003 * depth), 0.12);
        del.delayTime.setTargetAtTime(dt, t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.2 * (1 - (i / 16) * 0.4) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        const pan = (-1 + (i / 15) * 2) * (1 + spread * 0.3);
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });
    } else if (mode === '360') {
      nodes.spatialDelays.forEach((del, i) => {
        const dt = Math.min(0.002 + preDelay * 0.12 + (i * 0.005 * depth), 0.12);
        del.delayTime.setTargetAtTime(dt, t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.25 * (1 - (i / 16) * 0.3) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        const angle = (i / 16) * Math.PI * 2;
        const pan = Math.sin(angle) * (1 + spread * 0.5);
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });
    } else if (mode === 'concert') {
      nodes.spatialDelays.forEach((del, i) => {
        const dt = Math.min(0.005 + preDelay * 0.15 + (i * 0.006 * depth), 0.12);
        del.delayTime.setTargetAtTime(dt, t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.3 * (1 - (i / 16) * 0.35) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        const pan = (-1 + (i / 15) * 2) * (1 + spread) * 0.7;
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });
    } else if (mode === 'arena') {
      nodes.spatialDelays.forEach((del, i) => {
        const dt = Math.min(0.008 + preDelay * 0.2 + (i * 0.007 * depth), 0.12);
        del.delayTime.setTargetAtTime(dt, t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.35 * (1 - (i / 16) * 0.25) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
      nodes.spatialPans.forEach((p, i) => {
        const pan = (-1 + (i / 15) * 2) * (1 + spread);
        p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, r);
      });
    } else if (mode === 'club') {
      nodes.spatialDelays.forEach((del, i) => {
        const dt = Math.min(0.003 + preDelay * 0.1 + (i * 0.004 * depth), 0.1);
        del.delayTime.setTargetAtTime(dt, t, r);
      });
      nodes.spatialGains.forEach((g, i) => {
        const v = depth * 0.15 * (1 - (i / 16) * 0.45) * spread;
        g.gain.setTargetAtTime(Math.max(0, v), t, r);
      });
    } else if (mode === 'vocal' || mode === 'studio') {
      nodes.spatialGains.forEach(g => g.gain.setTargetAtTime(0, t, r));
    } else {
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
    if (state) apply();

    const obs = new MutationObserver(() => {
      if (!connected && document.querySelector('video')) {
        setTimeout(() => { connect(); if (state) apply(); }, 300);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    const urlObs = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        connected = false;
        src = null;
        ctx = null;
        nodes = {};
        setTimeout(() => { connect(); if (state) apply(); }, 1200);
      }
    });
    urlObs.observe(document, { subtree: true, childList: true });

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