/* ================================================================
   SONICFORGE STUDIO v4.0 — Content Script
   Professional Real-Time Audio Processing Engine

   16D Surround • 360° Spatial • Studio Monitor • Concert Hall
   10-Band Parametric EQ • Advanced Compression • Analog Warmth
   Crossfeed • Stereo Width • Noise Gate • Dynamic Range Control

   Made by Harjas
   ================================================================ */

(() => {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════

    const DEBUG = false; // Set to true for verbose logging
    const EQ_FREQ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const RECONNECT_DELAY = 500;
    const VIDEO_CHECK_INTERVAL = 1000;
    const MAX_RECONNECT_ATTEMPTS = 5;

    const log = (...args) => DEBUG && console.log('[SonicForge]', ...args);
    const warn = (...args) => console.warn('[SonicForge]', ...args);
    const error = (...args) => console.error('[SonicForge]', ...args);

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════

    let audioContext = null;
    let sourceNode = null;
    let currentVideo = null;
    let isConnected = false;
    let processingState = null;
    let audioNodes = {};
    let reconnectAttempts = 0;
    let videoCheckInterval = null;
    let isProcessingEnabled = false;
    let lastVideoSrc = null;

    // ═══════════════════════════════════════════════════════════════
    // AUDIO GRAPH BUILDER
    // ═══════════════════════════════════════════════════════════════

    function createAudioNodes() {
        if (!audioContext) return;

        log('Creating audio node graph...');

        const ctx = audioContext;
        const nodes = {};

        try {
            // Master controls
            nodes.masterGain = ctx.createGain();
            nodes.outputGain = ctx.createGain();

            // Filters
            nodes.highPass = ctx.createBiquadFilter();
            nodes.highPass.type = 'highpass';
            nodes.highPass.frequency.value = 0;
            nodes.highPass.Q.value = 0.707;

            nodes.lowPass = ctx.createBiquadFilter();
            nodes.lowPass.type = 'lowpass';
            nodes.lowPass.frequency.value = 22000;
            nodes.lowPass.Q.value = 0.707;

            // 10-band parametric EQ
            nodes.eq = EQ_FREQ.map(freq => {
                const filter = ctx.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.4;
                filter.gain.value = 0;
                return filter;
            });

            // Tone shaping
            nodes.subBass = ctx.createBiquadFilter();
            nodes.subBass.type = 'lowshelf';
            nodes.subBass.frequency.value = 60;
            nodes.subBass.gain.value = 0;

            nodes.presence = ctx.createBiquadFilter();
            nodes.presence.type = 'peaking';
            nodes.presence.frequency.value = 3000;
            nodes.presence.Q.value = 1.0;
            nodes.presence.gain.value = 0;

            nodes.air = ctx.createBiquadFilter();
            nodes.air.type = 'highshelf';
            nodes.air.frequency.value = 12000;
            nodes.air.gain.value = 0;

            // Dynamics
            nodes.compressor = ctx.createDynamicsCompressor();
            nodes.compressor.threshold.value = -24;
            nodes.compressor.knee.value = 12;
            nodes.compressor.ratio.value = 4;
            nodes.compressor.attack.value = 0.003;
            nodes.compressor.release.value = 0.25;

            nodes.gate = ctx.createDynamicsCompressor();
            nodes.gate.threshold.value = -100;
            nodes.gate.knee.value = 0;
            nodes.gate.ratio.value = 1;
            nodes.gate.attack.value = 0.001;
            nodes.gate.release.value = 0.05;

            // Reverb (Convolver)
            nodes.convolver = ctx.createConvolver();
            nodes.convolver.buffer = generateImpulseResponse(2, ctx.sampleRate, 0.5);
            nodes.wetGain = ctx.createGain();
            nodes.wetGain.gain.value = 0;
            nodes.dryGain = ctx.createGain();
            nodes.dryGain.gain.value = 1;

            // Spatial processing - 16 delay lines
            nodes.spatialDelays = [];
            nodes.spatialGains = [];
            nodes.spatialPanners = [];

            for (let i = 0; i < 16; i++) {
                const delay = ctx.createDelay(0.2);
                delay.delayTime.value = 0;

                const gain = ctx.createGain();
                gain.gain.value = 0;

                const panner = ctx.createStereoPanner();
                panner.pan.value = -1 + (i / 15) * 2;

                nodes.spatialDelays.push(delay);
                nodes.spatialGains.push(gain);
                nodes.spatialPanners.push(panner);
            }

            // Early reflections
            nodes.earlyDelays = [];
            nodes.earlyGains = [];

            for (let i = 0; i < 6; i++) {
                const delay = ctx.createDelay(0.1);
                delay.delayTime.value = 0.005 + i * 0.008;

                const gain = ctx.createGain();
                gain.gain.value = 0;

                nodes.earlyDelays.push(delay);
                nodes.earlyGains.push(gain);
            }

            // Crossfeed (for headphone spatial enhancement)
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

            // Balance
            nodes.balancePanner = ctx.createStereoPanner();
            nodes.balancePanner.pan.value = 0;

            // Analog warmth (waveshaping)
            nodes.waveshaper = ctx.createWaveShaper();
            nodes.waveshaper.curve = generateWarmthCurve(0);
            nodes.waveshaper.oversample = '4x';
            nodes.warmthWet = ctx.createGain();
            nodes.warmthWet.gain.value = 0;
            nodes.warmthDry = ctx.createGain();
            nodes.warmthDry.gain.value = 1;
            nodes.warmthMerge = ctx.createGain();

            log('Audio nodes created successfully');
            return nodes;

        } catch (err) {
            error('Failed to create audio nodes:', err);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SIGNAL ROUTING
    // ═══════════════════════════════════════════════════════════════

    function connectAudioGraph() {
        if (!sourceNode || !audioNodes.masterGain) {
            error('Cannot connect graph: missing source or nodes');
            return false;
        }

        log('Connecting audio graph...');

        try {
            const nodes = audioNodes;

            // Main signal chain
            let chain = sourceNode;
            const filters = [
                nodes.highPass,
                nodes.lowPass,
                ...nodes.eq,
                nodes.subBass,
                nodes.presence,
                nodes.air,
                nodes.compressor,
                nodes.gate,
                nodes.masterGain,
                nodes.balancePanner
            ];

            filters.forEach(node => {
                chain.connect(node);
                chain = node;
            });

            // After balance → Crossfeed
            nodes.balancePanner.connect(nodes.crossSplitter);

            // Crossfeed network
            nodes.crossSplitter.connect(nodes.directL, 0);
            nodes.crossSplitter.connect(nodes.directR, 1);
            nodes.crossSplitter.connect(nodes.crossL2R, 0);
            nodes.crossSplitter.connect(nodes.crossR2L, 1);

            nodes.directL.connect(nodes.crossMerger, 0, 0);
            nodes.crossR2L.connect(nodes.crossMerger, 0, 0);
            nodes.directR.connect(nodes.crossMerger, 0, 1);
            nodes.crossL2R.connect(nodes.crossMerger, 0, 1);

            // After crossfeed → Warmth processing
            nodes.crossMerger.connect(nodes.warmthDry);
            nodes.crossMerger.connect(nodes.waveshaper);
            nodes.waveshaper.connect(nodes.warmthWet);
            nodes.warmthDry.connect(nodes.warmthMerge);
            nodes.warmthWet.connect(nodes.warmthMerge);

            // Parallel paths from warmth merge

            // 1. Dry path
            nodes.warmthMerge.connect(nodes.dryGain);
            nodes.dryGain.connect(nodes.outputGain);

            // 2. Reverb (wet) path
            nodes.warmthMerge.connect(nodes.convolver);
            nodes.convolver.connect(nodes.wetGain);
            nodes.wetGain.connect(nodes.outputGain);

            // 3. Spatial delays (16D/360)
            nodes.spatialDelays.forEach((delay, i) => {
                nodes.warmthMerge.connect(delay);
                delay.connect(nodes.spatialGains[i]);
                nodes.spatialGains[i].connect(nodes.spatialPanners[i]);
                nodes.spatialPanners[i].connect(nodes.outputGain);
            });

            // 4. Early reflections
            nodes.earlyDelays.forEach((delay, i) => {
                nodes.warmthMerge.connect(delay);
                delay.connect(nodes.earlyGains[i]);
                nodes.earlyGains[i].connect(nodes.outputGain);
            });

            // Final output
            nodes.outputGain.connect(audioContext.destination);

            log('Audio graph connected successfully');
            return true;

        } catch (err) {
            error('Failed to connect audio graph:', err);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // AUDIO UTILITIES
    // ═══════════════════════════════════════════════════════════════

    function generateImpulseResponse(channels, sampleRate, decay) {
        const length = sampleRate * Math.max(0.1, decay);
        const buffer = audioContext.createBuffer(channels, length, sampleRate);

        for (let ch = 0; ch < channels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 3.5);
            }
        }

        return buffer;
    }

    function generateWarmthCurve(amount) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        const k = amount;
        const deg = Math.PI / 180;

        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }

        return curve;
    }

    // ═══════════════════════════════════════════════════════════════
    // CONNECTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    function disconnectAudio(preserveSource = false) {
        log('Disconnecting audio...', preserveSource ? 'preserve source' : 'clear source');

        try {
            if (sourceNode) {
                try {
                    sourceNode.disconnect();
                } catch (e) {
                    // Already disconnected
                }
            }

            Object.values(audioNodes).forEach(node => {
                if (node && typeof node.disconnect === 'function') {
                    try {
                        node.disconnect();
                    } catch (e) {
                        // Already disconnected
                    }
                } else if (Array.isArray(node)) {
                    node.forEach(n => {
                        if (n && typeof n.disconnect === 'function') {
                            try {
                                n.disconnect();
                            } catch (e) {
                                // Already disconnected
                            }
                        }
                    });
                }
            });

        } catch (err) {
            warn('Error during disconnect:', err);
        }

        if (!preserveSource) {
            sourceNode = null;
            currentVideo = null;
            lastVideoSrc = null;
        }

        audioNodes = {};
        isConnected = false;

        log('Audio disconnected');
    }

    function initializeAudioContext() {
        if (audioContext) {
            if (audioContext.state === 'closed') {
                audioContext = null;
            } else {
                if (audioContext.state === 'suspended') {
                    audioContext.resume().catch(err => warn('Failed to resume context:', err));
                }
                return audioContext;
            }
        }

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            log('AudioContext created, state:', audioContext.state);

            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(err => warn('Failed to resume context:', err));
            }

            return audioContext;
        } catch (err) {
            error('Failed to create AudioContext:', err);
            return null;
        }
    }

    function connectToVideo(video) {
        if (!video) {
            warn('No video element provided');
            return false;
        }

        const videoSrc = video.currentSrc || video.src;
        const isSameElement = currentVideo === video;

        if (isConnected && isSameElement && lastVideoSrc === videoSrc) {
            log('Already connected to this video');
            return true;
        }

        if (isConnected && !isSameElement) {
            log('Video element changed, disconnecting previous audio');
            disconnectAudio();
        }

        log('Connecting to video element...', videoSrc);

        try {
            // Initialize audio context
            const ctx = initializeAudioContext();
            if (!ctx) return false;

            // Create source node if we don't already have one for this element
            if (!sourceNode) {
                try {
                    sourceNode = ctx.createMediaElementSource(video);
                    log('MediaElementSource created');
                } catch (err) {
                    if (err.name === 'InvalidStateError' && isSameElement && currentVideo === video) {
                        warn('Video element already has a MediaElementSourceNode; reusing existing source');
                    } else {
                        throw err;
                    }
                }
            } else if (!isSameElement) {
                warn('Existing source node belongs to a different video element, clearing it');
                disconnectAudio();
                return connectToVideo(video);
            }

            // Create audio nodes
            audioNodes = createAudioNodes();
            if (!audioNodes) {
                disconnectAudio();
                return false;
            }

            // Connect the graph
            if (!connectAudioGraph()) {
                disconnectAudio();
                return false;
            }

            // Success
            isConnected = true;
            currentVideo = video;
            lastVideoSrc = videoSrc;
            reconnectAttempts = 0;

            log('Successfully connected to video');
            return true;

        } catch (err) {
            error('Failed to connect to video:', err);
            disconnectAudio();
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // STATE APPLICATION
    // ═══════════════════════════════════════════════════════════════

    function applyProcessing() {
        if (!processingState) {
            log('No processing state available');
            return;
        }

        if (!processingState.enabled) {
            log('Processing disabled, bypassing...');
            bypassProcessing();
            return;
        }

        // Ensure we're connected
        const video = findVideoElement();
        if (!video) {
            warn('No video element found for processing');
            return;
        }

        if (!isConnected) {
            if (!connectToVideo(video)) {
                warn('Failed to connect for processing');
                return;
            }
        }

        if (!audioContext || !audioNodes.masterGain) {
            warn('Audio system not ready');
            return;
        }

        log('Applying audio processing...');

        try {
            const ctx = audioContext;
            const t = ctx.currentTime;
            const ramp = 0.016; // Smooth parameter changes
            const state = processingState;

            const spatial = state.spatial || {};
            const enhance = state.enhance || {};
            const tone = state.tone || {};
            const mode = state.mode || 'default';

            // Master volume
            audioNodes.masterGain.gain.setTargetAtTime(
                (enhance.masterVol || 100) / 100,
                t,
                ramp
            );

            // Balance
            audioNodes.balancePanner.pan.setTargetAtTime(
                (enhance.balance || 0) / 100,
                t,
                ramp
            );

            // High-pass (clarity)
            audioNodes.highPass.frequency.setTargetAtTime(
                enhance.clarity || 0,
                t,
                ramp
            );

            // Low-pass (warmth)
            audioNodes.lowPass.frequency.setTargetAtTime(
                enhance.warmth || 22000,
                t,
                ramp
            );

            // EQ
            if (state.eq && state.eq.length === 10) {
                state.eq.forEach((gain, i) => {
                    audioNodes.eq[i].gain.setTargetAtTime(gain, t, ramp);
                });
            }

            // Tone shaping
            audioNodes.subBass.gain.setTargetAtTime(tone.subBass || 0, t, ramp);
            audioNodes.presence.gain.setTargetAtTime(tone.presence || 0, t, ramp);
            audioNodes.air.gain.setTargetAtTime(tone.air || 0, t, ramp);

            // Compression
            audioNodes.compressor.threshold.setTargetAtTime(
                enhance.compThreshold ?? -24,
                t,
                ramp
            );
            audioNodes.compressor.ratio.setTargetAtTime(
                enhance.compRatio ?? 4,
                t,
                ramp
            );
            audioNodes.compressor.attack.setTargetAtTime(
                (enhance.compAttack ?? 3) / 1000,
                t,
                ramp
            );
            audioNodes.compressor.release.setTargetAtTime(
                (enhance.compRelease ?? 250) / 1000,
                t,
                ramp
            );

            // Loudness normalization
            if (enhance.loudnessNorm) {
                audioNodes.compressor.threshold.setTargetAtTime(-18, t, ramp);
                audioNodes.compressor.ratio.setTargetAtTime(6, t, ramp);
                audioNodes.outputGain.gain.setTargetAtTime(1.15, t, ramp);
            } else {
                audioNodes.outputGain.gain.setTargetAtTime(1, t, ramp);
            }

            // Noise gate
            if (enhance.noiseGate) {
                audioNodes.gate.threshold.setTargetAtTime(-45, t, ramp);
                audioNodes.gate.ratio.setTargetAtTime(20, t, ramp);
            } else {
                audioNodes.gate.threshold.setTargetAtTime(-100, t, ramp);
                audioNodes.gate.ratio.setTargetAtTime(1, t, ramp);
            }

            // Crossfeed
            const crossfeed = (spatial.crossfeed || 0) / 100;
            audioNodes.crossL2R.gain.setTargetAtTime(crossfeed * 0.35, t, ramp);
            audioNodes.crossR2L.gain.setTargetAtTime(crossfeed * 0.35, t, ramp);
            audioNodes.directL.gain.setTargetAtTime(1 - crossfeed * 0.15, t, ramp);
            audioNodes.directR.gain.setTargetAtTime(1 - crossfeed * 0.15, t, ramp);

            // Mono compatibility
            if (enhance.monoCompat) {
                audioNodes.crossL2R.gain.setTargetAtTime(0.5, t, ramp);
                audioNodes.crossR2L.gain.setTargetAtTime(0.5, t, ramp);
                audioNodes.directL.gain.setTargetAtTime(0.5, t, ramp);
                audioNodes.directR.gain.setTargetAtTime(0.5, t, ramp);
            }

            // Analog warmth
            if (enhance.analogWarmth) {
                audioNodes.waveshaper.curve = generateWarmthCurve(50);
                audioNodes.warmthWet.gain.setTargetAtTime(0.15, t, ramp);
                audioNodes.warmthDry.gain.setTargetAtTime(0.85, t, ramp);
            } else {
                audioNodes.warmthWet.gain.setTargetAtTime(0, t, ramp);
                audioNodes.warmthDry.gain.setTargetAtTime(1, t, ramp);
            }

            // Reverb
            const wet = (spatial.wetDry || 0) / 100;
            const roomSize = (spatial.roomSize || 0) / 100;
            const decay = (spatial.reverbDecay || 0) / 100;

            let reverbScale = 1;
            if (mode === 'studio') reverbScale = 0.25;
            else if (mode === 'concert') reverbScale = 2.0;
            else if (mode === '360') reverbScale = 1.5;
            else if (mode === '16d') reverbScale = 0.8;
            else if (mode === 'vocal') reverbScale = 0.5;

            const finalWet = Math.min(wet * reverbScale, 1);
            audioNodes.wetGain.gain.setTargetAtTime(finalWet, t, ramp);
            audioNodes.dryGain.gain.setTargetAtTime(1 - finalWet * 0.3, t, ramp);

            // Update impulse response
            const impulseDecay = 0.1 + roomSize * 3 * reverbScale + decay * 2;
            try {
                audioNodes.convolver.buffer = generateImpulseResponse(
                    2,
                    ctx.sampleRate,
                    Math.min(impulseDecay, 5)
                );
            } catch (err) {
                warn('Failed to update impulse response:', err);
            }

            // Early reflections
            const earlyRef = (spatial.earlyRef || 0) / 100;
            let earlyScale = 1;
            if (mode === 'concert') earlyScale = 1.5;
            else if (mode === 'studio') earlyScale = 0.3;

            audioNodes.earlyDelays.forEach((delay, i) => {
                const baseDelay = 0.004 + i * 0.007;
                delay.delayTime.setTargetAtTime(baseDelay, t, ramp);
            });

            audioNodes.earlyGains.forEach((gain, i) => {
                const level = earlyRef * earlyScale * 0.2 * (1 - i * 0.12);
                gain.gain.setTargetAtTime(Math.max(0, level), t, ramp);
            });

            // Spatial processing (16D / 360 / Concert)
            const depth = (spatial.depth16d || 0) / 100;
            const spread = (spatial.spatialSpread || 0) / 180;
            const preDelay = (spatial.preDelay || 0) / 1000;
            const stereoWidth = (spatial.stereoWidth || 100) / 100;

            applySpatialMode(mode, depth, spread, preDelay, stereoWidth, t, ramp);

            // Playback speed
            if (currentVideo && enhance.speed) {
                const newSpeed = (enhance.speed || 100) / 100;
                if (Math.abs(currentVideo.playbackRate - newSpeed) > 0.01) {
                    currentVideo.playbackRate = newSpeed;
                }
            }

            log('Processing applied successfully');
            isProcessingEnabled = true;

        } catch (err) {
            error('Failed to apply processing:', err);
        }
    }

    function applySpatialMode(mode, depth, spread, preDelay, stereoWidth, time, ramp) {
        const nodes = audioNodes;

        if (mode === '16d') {
            // 16D Surround: Fixed positions, moderate depth
            nodes.spatialDelays.forEach((delay, i) => {
                const delayTime = 0.001 + preDelay * 0.1 + (i * 0.0035 * depth);
                delay.delayTime.setTargetAtTime(Math.min(0.15, delayTime), time, ramp);
            });

            nodes.spatialGains.forEach((gain, i) => {
                const level = depth * 0.22 * (1 - (i / 16) * 0.5) * spread;
                gain.gain.setTargetAtTime(Math.max(0, level), time, ramp);
            });

            nodes.spatialPanners.forEach((panner, i) => {
                const pan = (-1 + (i / 15) * 2) * stereoWidth;
                panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), time, ramp);
            });

        } else if (mode === '360') {
            // 360° Audio: Spherical, deeper immersion
            nodes.spatialDelays.forEach((delay, i) => {
                const delayTime = 0.002 + preDelay * 0.15 + (i * 0.005 * depth);
                delay.delayTime.setTargetAtTime(Math.min(0.15, delayTime), time, ramp);
            });

            nodes.spatialGains.forEach((gain, i) => {
                const level = depth * 0.28 * (1 - (i / 16) * 0.35) * spread;
                gain.gain.setTargetAtTime(Math.max(0, level), time, ramp);
            });

            nodes.spatialPanners.forEach((panner, i) => {
                const angle = (i / 16) * Math.PI * 2;
                const pan = Math.sin(angle) * stereoWidth;
                panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), time, ramp);
            });

        } else if (mode === 'concert') {
            // Concert Hall: Large space, long delays
            nodes.spatialDelays.forEach((delay, i) => {
                const delayTime = 0.005 + preDelay * 0.2 + (i * 0.006 * depth);
                delay.delayTime.setTargetAtTime(Math.min(0.15, delayTime), time, ramp);
            });

            nodes.spatialGains.forEach((gain, i) => {
                const level = depth * 0.3 * (1 - (i / 16) * 0.4) * spread;
                gain.gain.setTargetAtTime(Math.max(0, level), time, ramp);
            });

            nodes.spatialPanners.forEach((panner, i) => {
                const pan = (-1 + (i / 15) * 2) * stereoWidth * 0.8;
                panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), time, ramp);
            });

        } else {
            // Default/Studio/Vocal: Minimal spatial processing
            nodes.spatialGains.forEach(gain => {
                gain.gain.setTargetAtTime(0, time, ramp);
            });
        }
    }

    function bypassProcessing() {
        if (!audioContext || !audioNodes.masterGain) return;

        log('Bypassing processing (pass-through mode)');

        try {
            const ctx = audioContext;
            const t = ctx.currentTime;
            const ramp = 0.05; // Slightly slower for bypass

            // Reset to neutral/bypass values
            audioNodes.masterGain.gain.setTargetAtTime(1, t, ramp);
            audioNodes.balancePanner.pan.setTargetAtTime(0, t, ramp);
            audioNodes.highPass.frequency.setTargetAtTime(0, t, ramp);
            audioNodes.lowPass.frequency.setTargetAtTime(22000, t, ramp);

            audioNodes.eq.forEach(filter => {
                filter.gain.setTargetAtTime(0, t, ramp);
            });

            audioNodes.subBass.gain.setTargetAtTime(0, t, ramp);
            audioNodes.presence.gain.setTargetAtTime(0, t, ramp);
            audioNodes.air.gain.setTargetAtTime(0, t, ramp);

            audioNodes.compressor.threshold.setTargetAtTime(-50, t, ramp);
            audioNodes.compressor.ratio.setTargetAtTime(1, t, ramp);

            audioNodes.wetGain.gain.setTargetAtTime(0, t, ramp);
            audioNodes.dryGain.gain.setTargetAtTime(1, t, ramp);

            audioNodes.spatialGains.forEach(gain => {
                gain.gain.setTargetAtTime(0, t, ramp);
            });

            audioNodes.earlyGains.forEach(gain => {
                gain.gain.setTargetAtTime(0, t, ramp);
            });

            audioNodes.crossL2R.gain.setTargetAtTime(0, t, ramp);
            audioNodes.crossR2L.gain.setTargetAtTime(0, t, ramp);
            audioNodes.directL.gain.setTargetAtTime(1, t, ramp);
            audioNodes.directR.gain.setTargetAtTime(1, t, ramp);

            audioNodes.warmthWet.gain.setTargetAtTime(0, t, ramp);
            audioNodes.warmthDry.gain.setTargetAtTime(1, t, ramp);

            audioNodes.gate.ratio.setTargetAtTime(1, t, ramp);
            audioNodes.outputGain.gain.setTargetAtTime(1, t, ramp);

            if (currentVideo) {
                currentVideo.playbackRate = 1;
            }

            isProcessingEnabled = false;
            log('Processing bypassed');

        } catch (err) {
            warn('Error during bypass:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // VIDEO DETECTION
    // ═══════════════════════════════════════════════════════════════

    function findVideoElement() {
        // Primary: YouTube video player
        let video = document.querySelector('video.html5-main-video');

        // Fallback: any video element
        if (!video) {
            video = document.querySelector('video');
        }

        return video;
    }

    function startVideoMonitoring() {
        if (videoCheckInterval) {
            clearInterval(videoCheckInterval);
        }

        videoCheckInterval = setInterval(() => {
            const video = findVideoElement();

            if (!video) {
                if (isConnected) {
                    log('Video element lost, disconnecting...');
                    disconnectAudio();
                }
                return;
            }

            const videoSrc = video.currentSrc || video.src;

            // Check if video element changed
            if (video !== currentVideo) {
                log('Video element changed');

                if (isConnected) {
                    disconnectAudio();
                }

                if (processingState && processingState.enabled) {
                    setTimeout(() => {
                        if (connectToVideo(video)) {
                            applyProcessing();
                        }
                    }, RECONNECT_DELAY);
                }
            } else if (videoSrc !== lastVideoSrc) {
                log('Video source changed on same element');
                lastVideoSrc = videoSrc;

                if (processingState && processingState.enabled && !isConnected) {
                    setTimeout(() => {
                        if (connectToVideo(video)) {
                            applyProcessing();
                        }
                    }, RECONNECT_DELAY);
                }
            }

            // Ensure AudioContext is running
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().catch(err => warn('Failed to resume:', err));
            }

        }, VIDEO_CHECK_INTERVAL);

        log('Video monitoring started');
    }

    function stopVideoMonitoring() {
        if (videoCheckInterval) {
            clearInterval(videoCheckInterval);
            videoCheckInterval = null;
            log('Video monitoring stopped');
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // MESSAGE HANDLING
    // ═══════════════════════════════════════════════════════════════

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log('Message received:', message.type);

        if (message.type === 'HR_UPDATE') {
            processingState = message.state;

            if (processingState.enabled) {
                applyProcessing();
            } else {
                bypassProcessing();
            }

            sendResponse({ success: true });
        }

        if (message.type === 'HR_STATUS') {
            sendResponse({
                connected: isConnected,
                enabled: processingState?.enabled || false,
                hasVideo: !!findVideoElement(),
                contextState: audioContext?.state
            });
        }

        return true;
    });

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    function initialize() {
        log('Initializing SonicForge Studio...');

        // Load saved state
        chrome.storage.local.get(['hrState'], (result) => {
            if (result.hrState) {
                processingState = result.hrState;
                log('State loaded from storage');

                if (processingState.enabled) {
                    const video = findVideoElement();
                    if (video) {
                        setTimeout(() => {
                            if (connectToVideo(video)) {
                                applyProcessing();
                            }
                        }, RECONNECT_DELAY);
                    }
                }
            }
        });

        // Start monitoring
        startVideoMonitoring();

        // User interaction handlers (required for AudioContext)
        const interactionHandler = () => {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    log('AudioContext resumed after user interaction');
                }).catch(err => warn('Failed to resume:', err));
            }

            if (processingState && processingState.enabled && !isConnected) {
                const video = findVideoElement();
                if (video && connectToVideo(video)) {
                    applyProcessing();
                }
            }
        };

        document.addEventListener('click', interactionHandler, { passive: true, once: false });
        document.addEventListener('keydown', interactionHandler, { passive: true, once: false });

        // Handle YouTube SPA navigation
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                log('URL changed:', currentUrl);
                lastUrl = currentUrl;

                const video = findVideoElement();
                const videoSrc = video ? (video.currentSrc || video.src) : '';

                if (video !== currentVideo) {
                    if (isConnected) {
                        disconnectAudio();
                    }
                } else if (videoSrc !== lastVideoSrc) {
                    lastVideoSrc = videoSrc;
                }

                // Wait for new video to load
                setTimeout(() => {
                    const nextVideo = findVideoElement();
                    if (nextVideo && processingState && processingState.enabled) {
                        if (connectToVideo(nextVideo)) {
                            applyProcessing();
                        }
                    }
                }, 1500);
            }
        });

        urlObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        log('SonicForge Studio initialized');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        // DOM already loaded
        setTimeout(initialize, 500);
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopVideoMonitoring();
        disconnectAudio();
        if (audioContext) {
            audioContext.close();
        }
    });

})();
 
