var RC = (typeof RC !== 'undefined') ? RC : {};
// Звук — только синтез в браузере (WebAudio), без звуковых файлов.
// Звуки: прыжок, приземление, искорка (с каждой следующей подряд — нота выше), прыжок на
// Шишколапа, удар, фонарь, страница письма, возврат к фонарю, финиш, бегство Тенюшки.
// Тихая мелодия леса по кругу: 8 тактов (ля минор, 84 удара в минуту) — подкладка аккордами,
// бас, флейта с эхом и «музыкальная шкатулка».
// Браузер разрешает звук только после первого нажатия, поэтому RC.audio.init() зовёт main.js
// из обработчика клавиши или щелчка. RC.audio.mute(true/false) — выключить / включить.

(function (RC) {
  'use strict';

  var A = RC.audio = {};
  var ac = null, master = null, sfx = null, mus = null, echo = null, noiseBuf = null;
  var muted = false, paused = false, musicOn = false, timer = null, nextT = 0, stepI = 0;
  var combo = 0, lastSparkT = -10;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  A.init = function () {
    if (ac) {
      if (ac.state === 'suspended' && !paused) { try { ac.resume(); } catch (e) { /* не вышло — тихо */ } }
      return true;
    }
    var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try {
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      var comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ac.destination);
      sfx = ac.createGain();
      sfx.gain.value = 0.8;
      sfx.connect(master);
      mus = ac.createGain();
      mus.gain.value = 0.34;
      mus.connect(master);
      // эхо для мелодии
      echo = ac.createDelay(1.0);
      echo.delayTime.value = 0.357;
      var fb = ac.createGain();
      fb.gain.value = 0.33;
      var lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      echo.connect(lp);
      lp.connect(fb);
      fb.connect(echo);
      var wet = ac.createGain();
      wet.gain.value = 0.55;
      lp.connect(wet);
      wet.connect(mus);
      // шум для «пыли», удара и шорохов (сид-генератор, не Math.random)
      var len = Math.floor(ac.sampleRate * 1.0);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      var d = noiseBuf.getChannelData(0), r = RC.rng(1234);
      for (var i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
    } catch (e) {
      ac = null;
      return false;
    }
    return true;
  };

  // Одна нота: f — частота, f2 — куда скользит, d — длительность, v — громкость, a — нарастание.
  function tone(o) {
    if (!ac) return;
    var t0 = o.at !== undefined ? o.at : ac.currentTime + (o.t || 0);
    var d = o.d || 0.1, v = Math.max(0.0002, o.v || 0.1), a = o.a || 0.005;
    var osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + (o.gd || d));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(d, a + 0.01));
    osc.connect(g);
    g.connect(o.bus || sfx);
    if (o.send && echo) g.connect(echo);
    if (o.vib) {
      var lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = o.vib[0];
      lg.gain.value = o.vib[1];
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + d + 0.05);
    }
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  }

  // Шум через фильтр.
  function hiss(o) {
    if (!ac || !noiseBuf) return;
    var t0 = ac.currentTime + (o.t || 0), d = o.d || 0.1;
    var src = ac.createBufferSource();
    src.buffer = noiseBuf;
    var flt = ac.createBiquadFilter();
    flt.type = o.type || 'lowpass';
    flt.frequency.setValueAtTime(o.f || 800, t0);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t0 + d);
    flt.Q.value = o.q || 0.7;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.v || 0.1), t0 + (o.a || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    src.connect(flt);
    flt.connect(g);
    g.connect(sfx);
    src.start(t0, (o.off || 0) % 0.9);
    src.stop(t0 + d + 0.05);
  }

  var SPARK_NOTES = [84, 86, 88, 91, 93, 96, 98, 100];

  var SFX = {
    jump: function () {
      tone({ f: 290, f2: 660, gd: 0.12, d: 0.16, type: 'triangle', v: 0.12 });
      tone({ f: 290, f2: 660, gd: 0.12, d: 0.12, type: 'square', v: 0.035 });
    },
    land: function (w) {
      var imp = w ? clamp(w.player.landImpact / 13, 0.15, 1) : 0.5;
      hiss({ d: 0.08, v: 0.03 + 0.09 * imp, f: 420, off: 0.1 });
      tone({ f: 150, f2: 60, d: 0.09, v: 0.03 + 0.07 * imp });
    },
    spark: function () {
      var now = ac.currentTime;
      combo = now - lastSparkT < 0.55 ? Math.min(combo + 1, SPARK_NOTES.length - 1) : 0;
      lastSparkT = now;
      var n = SPARK_NOTES[combo];
      tone({ f: mtof(n), d: 0.12, type: 'triangle', v: 0.08 });
      tone({ f: mtof(n + 7), t: 0.045, d: 0.2, type: 'sine', v: 0.06 });
    },
    stomp: function () {
      tone({ f: 620, f2: 150, gd: 0.16, d: 0.18, type: 'square', v: 0.045 });
      tone({ f: 320, f2: 90, d: 0.16, type: 'sine', v: 0.15 });
      hiss({ d: 0.06, v: 0.07, f: 1400, type: 'bandpass', off: 0.3 });
    },
    hurt: function () {
      tone({ f: 520, f2: 130, d: 0.36, type: 'sawtooth', v: 0.05, vib: [16, 28] });
      hiss({ d: 0.22, v: 0.08, f: 1100, f2: 180, off: 0.5 });
    },
    lantern: function () {
      var notes = [60, 64, 67, 71, 74, 79];
      for (var i = 0; i < notes.length; i++) {
        tone({ f: mtof(notes[i]), t: i * 0.07, d: 1.5, a: 0.01, type: 'sine', v: 0.07 });
        tone({ f: mtof(notes[i] + 12), t: i * 0.07 + 0.02, d: 0.8, type: 'triangle', v: 0.02 });
      }
      hiss({ d: 0.7, v: 0.04, f: 500, f2: 4000, type: 'bandpass', q: 2, off: 0.2 });
    },
    page: function () {
      var notes = [79, 83, 86, 91, 95, 98];
      for (var i = 0; i < notes.length; i++) tone({ f: mtof(notes[i]), t: i * 0.06, d: 0.55, type: 'triangle', v: 0.06 });
      tone({ f: mtof(103), t: 0.4, d: 0.9, type: 'sine', v: 0.04, vib: [7, 12] });
    },
    respawn: function () {
      hiss({ d: 0.5, v: 0.06, f: 300, f2: 2600, type: 'bandpass', q: 1.5, off: 0.6 });
      tone({ f: 300, f2: 720, d: 0.45, type: 'sine', v: 0.06 });
    },
    finish: function () {
      var mel = [67, 72, 76, 79, 84], i;
      for (i = 0; i < mel.length; i++) tone({ f: mtof(mel[i]), t: i * 0.14, d: i === mel.length - 1 ? 1.3 : 0.2, type: 'triangle', v: 0.09 });
      var ch = [60, 64, 67, 72];
      for (i = 0; i < ch.length; i++) tone({ f: mtof(ch[i]), t: 0.56, d: 1.8, a: 0.05, type: 'sine', v: 0.045 });
    },
    start: function () {
      tone({ f: mtof(72), d: 0.25, type: 'triangle', v: 0.07 });
      tone({ f: mtof(79), t: 0.08, d: 0.3, type: 'triangle', v: 0.06 });
      tone({ f: mtof(84), t: 0.16, d: 0.5, type: 'sine', v: 0.06 });
    },
    flee: function () {
      tone({ f: 880, f2: 280, d: 0.4, type: 'sine', v: 0.04, vib: [9, 20] });
    },
    pause: function () { tone({ f: 523, d: 0.09, type: 'triangle', v: 0.05 }); }
  };

  A.play = function (name, world) {
    if (!ac || muted || paused) return;
    var fn = SFX[name];
    if (!fn) return;
    try { fn(world); } catch (e) { /* звук не должен ломать игру */ }
  };

  // ---------------------------------------------------------------- мелодия леса

  var BPM = 84, STEP = 60 / BPM / 2;                   // шаг — восьмая
  var CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]];   // Am7 Fmaj7 C G
  var BASS = [45, 41, 48, 43];
  var MEL = [[0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 69, 2], [8, 72, 2], [10, 74, 2], [12, 76, 4],
    [16, 81, 3], [19, 79, 1], [20, 76, 2], [22, 72, 2], [24, 74, 3], [27, 72, 1], [28, 69, 4],
    [32, 67, 2], [34, 72, 2], [36, 76, 2], [38, 79, 2], [40, 76, 6],
    [48, 74, 2], [50, 76, 1], [51, 74, 1], [52, 67, 2], [54, 74, 2], [56, 74, 6]];
  var BOX = { 5: 93, 13: 88, 21: 96, 29: 91, 37: 88, 45: 93, 53: 91, 61: 96 };
  var melAt = {};
  for (var mi = 0; mi < MEL.length; mi++) melAt[MEL[mi][0]] = MEL[mi];

  function scheduleStep(i, t) {
    var s = i % 64, bar = Math.floor(s / 8), ch = Math.floor(bar / 2) % 4, k;
    if (s % 16 === 0) {
      for (k = 0; k < CHORDS[ch].length; k++) {
        tone({ at: t, f: mtof(CHORDS[ch][k]), d: STEP * 16, a: 0.9, type: 'sine', v: 0.03, bus: mus });
      }
    }
    if (s % 4 === 0) tone({ at: t, f: mtof(BASS[ch]), d: STEP * 3.2, a: 0.02, type: 'triangle', v: 0.08, bus: mus });
    var m = melAt[s];
    if (m) {
      tone({ at: t, f: mtof(m[1]), d: STEP * m[2] * 0.95 + 0.12, a: 0.04, type: 'sine', v: 0.065, bus: mus, vib: [5, 3], send: true });
      tone({ at: t, f: mtof(m[1]), d: STEP * m[2] * 0.8, a: 0.04, type: 'triangle', v: 0.018, bus: mus });
    }
    if (BOX[s]) tone({ at: t, f: mtof(BOX[s]), d: 0.6, a: 0.004, type: 'sine', v: 0.022, bus: mus, send: true });
  }

  function pump() {
    if (!ac || !musicOn) return;
    if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
    while (nextT < ac.currentTime + 0.3) {
      if (!muted && !paused) scheduleStep(stepI, nextT);
      stepI = (stepI + 1) % 128;
      nextT += STEP;
    }
  }

  A.startMusic = function () {
    if (!ac || musicOn) return;
    musicOn = true;
    nextT = ac.currentTime + 0.12;
    stepI = 0;
    timer = setInterval(pump, 50);
    pump();
  };
  A.stopMusic = function () {
    musicOn = false;
    if (timer) { clearInterval(timer); timer = null; }
  };

  A.mute = function (b) {
    muted = !!b;
    if (ac && master) {
      try {
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.03);
      } catch (e) { master.gain.value = muted ? 0 : 0.9; }
    }
    return muted;
  };
  A.isMuted = function () { return muted; };

  // Пауза: останавливаем весь звук, после паузы — продолжаем.
  A.pause = function (b) {
    paused = !!b;
    if (!ac) return;
    try {
      if (paused) setTimeout(function () { if (paused && ac) ac.suspend(); }, 150);   // дать прозвучать щелчку паузы
      else ac.resume();
    } catch (e) { /* не вышло — тихо */ }
  };

  A.state = function () {
    return { ready: !!ac, state: ac ? ac.state : 'нет', muted: muted, music: musicOn };
  };
})(RC);
