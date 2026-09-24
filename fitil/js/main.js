var RC = (typeof RC !== 'undefined') ? RC : {};
// Запуск игры в браузере: экран «Нажми, чтобы начать», цикл с фиксированным шагом 60 кадров/с
// (накопитель времени RC.Ticker — кадры логики не зависят от скорости компьютера), клавиатура,
// пауза (Esc), звук (M), финиш «Сонный замок впереди!», запись/повтор нажатий для режима проверки
// и window.RC_TEST — чтобы проверять игру из браузера автоматизации.
//
// RC_TEST.state()              — снимок состояния (экран, герой, огоньки, искорки, фонари, ошибки…)
// RC_TEST.replay(arr[, opts])  — начать уровень заново и проиграть записанные нажатия
//                                (по кадру за кадр в реальном времени; opts.instant — сразу, без ожидания;
//                                 opts.invincible — включить/выключить бессмертие перед повтором)
// RC_TEST.setInvincible(bool)  — бессмертие (режим проверки)
// Дополнительно: start(), restart(), warp(i), recording(), setGrayMode(m), freeze(bool).

(function (RC) {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var T = RC.TILE, VW = RC.VIEW_W, VH = RC.VIEW_H;
  var REC_KEY = 'rc_fitil_rec_v1', MUTE_KEY = 'rc_fitil_muted_v1';
  var S = null, canvas = null, wrap = null, lastTs = 0, fpsAvg = 60, errors = [], booted = false;

  function save(key, val) {
    try { if (val === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, val); } catch (e) { /* нет хранилища — не страшно */ }
  }
  function load(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function report(err) {
    var m = String((err && (err.stack || err.message)) || err);
    if (errors.length < 20) errors.push(m.split('\n').slice(0, 3).join(' | '));
    if (errors.length <= 3 && window.console) window.console.error('Фитиль: ' + m);
  }

  function loadRec() {
    var s = load(REC_KEY);
    if (!s) return null;
    try {
      var o = JSON.parse(s);
      if (o && o.bits && o.bits.length) return { bits: o.bits, invincible: !!o.invincible };
    } catch (e) { /* испорченная запись — забываем */ }
    return null;
  }

  function makeWorld() {
    var w = RC.newWorld(RC.LEVEL1);
    w.invincible = S.invincible;
    return w;
  }

  function restart() {
    S.world = makeWorld();
    RC.render.reset(S.world);
    S.screen = 'play';
    S.paused = false;
    S.finishT = 0;
    S.playT = 0;
    S.rep = null;
    S.ticker.reset();
    RC.audio.pause(false);
  }

  function ensureAudio() {
    if (S.audioOn) { RC.audio.init(); return; }
    S.audioOn = RC.audio.init();
    if (S.audioOn) {
      RC.audio.mute(S.muted);
      if (S.screen !== 'title') RC.audio.startMusic();
    }
  }

  function startGame(gesture) {
    if (gesture) ensureAudio();
    if (S.screen !== 'title') return;
    S.screen = 'play';
    S.playT = 0;
    S.ticker.reset();
    if (S.audioOn) { RC.audio.startMusic(); RC.audio.play('start'); }
  }

  function setPaused(b) {
    if (S.screen !== 'play') b = false;
    if (S.paused === b) return;
    S.paused = b;
    if (b) RC.audio.play('pause');
    RC.audio.pause(b);
    S.ticker.reset();
  }

  function toggleMute() {
    S.muted = !S.muted;
    RC.audio.mute(S.muted);
    save(MUTE_KEY, S.muted ? '1' : '0');
  }

  // Один кадр логики.
  function stepOnce(silent) {
    var w = S.world, bits;
    if (S.rep) bits = S.rep.next(); else bits = S.input.bits();
    if (S.rec) S.rec.push(bits);
    var was = w.finished;
    RC.stepWorld(w, bits);
    RC.render.onStep(w);
    if (!silent) {
      for (var i = 0; i < w.events.length; i++) RC.audio.play(w.events[i], w);
      for (i = 0; i < w.enemies.length; i++) {
        var e = w.enemies[i];
        if (e.kind === 'T' && e.state === 'flee' && e.t === 0) RC.audio.play('flee', w);
      }
    }
    if (!was && w.finished) {
      S.screen = 'finish';
      S.finishT = 0;
      if (S.rec) recStop();
    }
    if (S.rep && S.rep.done()) S.rep = null;
    S.playT++;
    if (S.screen === 'finish') S.finishT++;
  }

  function uiState() {
    return {
      screen: S.screen, paused: S.paused, muted: S.muted, playT: S.playT, finishT: S.finishT,
      recording: !!S.rec, replaying: !!S.rep, invincible: S.invincible
    };
  }

  function frame(ts) {
    window.requestAnimationFrame(frame);
    try {
      var dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60;
      lastTs = ts;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.25) dt = 0.25;
      if (dt > 0) fpsAvg += (1 / dt - fpsAvg) * 0.05;
      RC.render.tick(dt * 60);
      if (S.screen !== 'title' && !S.paused && !S.frozen) {
        var n = S.ticker.add(dt);
        for (var i = 0; i < n; i++) stepOnce(false);
      }
      RC.render.draw(S.world, uiState());
      RC.debug.update(false);
    } catch (err) {
      report(err);
    }
  }

  // ---------------------------------------------------------------- запись и повтор

  function recStart() {
    if (S.rep) return false;
    restart();
    S.rec = RC.Recorder();
    S.recInv = S.invincible;
    return true;
  }
  function recStop() {
    if (!S.rec) return 0;
    var bits = S.rec.data();
    S.rec = null;
    if (bits.length) {
      S.lastRec = { bits: bits, invincible: !!S.recInv };
      save(REC_KEY, JSON.stringify(S.lastRec));
    }
    return bits.length;
  }

  function setInvincible(b) {
    S.invincible = !!b;
    S.world.invincible = S.invincible;
    return S.invincible;
  }

  function replay(arr, opts) {
    opts = opts || {};
    if (!arr || typeof arr.length !== 'number') throw new Error('replay: нужен массив нажатий (по числу на кадр)');
    var bits = [];
    for (var i = 0; i < arr.length; i++) bits.push(arr[i] | 0);
    if (S.rec) recStop();
    if (typeof opts.invincible === 'boolean') setInvincible(opts.invincible);
    restart();
    S.rep = bits.length ? RC.Replayer(bits) : null;
    if (opts.instant) {
      while (S.rep) stepOnce(true);
      return state();
    }
    return { frames: bits.length };
  }

  function warp(i) {
    if (S.rec || S.rep) return 'во время записи и повтора перенос выключен';
    if (!S.world.lanterns[i]) return 'фонаря №' + (i + 1) + ' нет';
    if (S.screen === 'title') startGame(false);
    if (S.world.finished) restart();
    RC.warpToLantern(S.world, i);
    RC.render.snap(S.world);
    return true;
  }

  // ---------------------------------------------------------------- состояние для проверки

  function state() {
    var w = S.world, p = w.player, i;
    var lit = [], enemies = [];
    for (i = 0; i < w.lit.length; i++) lit.push(w.lit[i].index);
    for (i = 0; i < w.enemies.length; i++) {
      var e = w.enemies[i];
      enemies.push({ kind: e.kind, state: e.state, tx: Math.floor((e.x + e.w / 2) / T) });
    }
    return {
      screen: S.screen, paused: S.paused, muted: S.muted, audio: RC.audio.state(),
      debugOpen: RC.debug.isOpen(), reach: RC.debug.reachResult(),
      invincible: S.invincible,
      recording: !!S.rec, recLength: S.rec ? S.rec.length() : 0,
      lastRecLength: S.lastRec ? S.lastRec.bits.length : 0,
      replaying: !!S.rep, replayPos: S.rep ? S.rep.pos() : 0, replayLength: S.rep ? S.rep.length() : 0,
      frame: w.frame, finished: w.finished, finishFrame: w.finishFrame,
      time: RC.render.mmss(w.finished ? w.finishFrame : w.frame),
      player: {
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, onGround: p.onGround, facing: p.facing, anim: p.anim,
        tx: Math.floor((p.x + p.w / 2) / T), ty: Math.floor((p.y + p.h - 1) / T)
      },
      flames: w.flames, sparks: w.sparks, sparksTotal: RC.render.sparksTotal(), bigFlame: w.bigFlame,
      pageTaken: w.pageTaken, invuln: w.invuln, hurtFlash: w.hurtFlash,
      lit: lit, checkpoint: { tx: w.checkpoint.tx, ty: w.checkpoint.ty, lantern: w.checkpoint.lantern },
      enemies: enemies,
      stats: { hurts: w.stats.hurts, respawns: w.stats.respawns, stomps: w.stats.stomps, jumps: w.stats.jumps },
      camera: RC.render.camera(), renderScale: RC.render.scale(), grayMode: RC.render.grayMode(),
      fps: Math.round(fpsAvg), errors: errors.slice()
    };
  }

  // ---------------------------------------------------------------- клавиши, щелчок, размер окна

  function onKeyDown(e) {
    var code = e.code || '';
    var game = RC.KEYMAP[code] !== undefined;
    if (game || code === 'Escape' || code === 'Backquote') e.preventDefault();
    ensureAudio();
    if (code === 'Backquote') { if (!e.repeat) RC.debug.toggle(); return; }
    if (RC.debug.isOpen() && !e.repeat && RC.debug.handleKey(code)) return;
    if (code === 'KeyM') { if (!e.repeat) toggleMute(); return; }
    if (S.screen === 'title') {
      if (!e.repeat && code !== 'Escape') startGame(true);
      return;
    }
    if (S.screen === 'finish') {
      if (!e.repeat && (code === 'Space' || code === 'Enter') && S.finishT > 70) restart();
      return;
    }
    if (code === 'Escape') { if (!e.repeat) setPaused(!S.paused); return; }
    if (game) S.input.down(code);
  }
  function onKeyUp(e) {
    var code = e.code || '';
    if (RC.KEYMAP[code] !== undefined) { e.preventDefault(); S.input.up(code); }
  }
  function onPointer() {
    ensureAudio();
    if (canvas && canvas.focus) { try { canvas.focus(); } catch (err) { /* не важно */ } }
    if (S.screen === 'title') startGame(true);
    else if (S.screen === 'finish' && S.finishT > 70) restart();
  }

  function resize() {
    var ww = window.innerWidth || VW, wh = window.innerHeight || VH;
    var s = Math.min(ww / VW, wh / VH);
    if (!(s > 0)) s = 1;
    var cw = Math.max(1, Math.floor(VW * s)), ch = Math.max(1, Math.floor(VH * s));
    if (wrap) { wrap.style.width = cw + 'px'; wrap.style.height = ch + 'px'; }
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    var dpr = window.devicePixelRatio || 1;
    var rs = Math.max(0.5, Math.min(2, s * dpr));
    RC.render.setScale(Math.round(rs * 4) / 4);
  }

  function boot() {
    if (booted) return;
    booted = true;
    canvas = document.getElementById('game');
    wrap = document.getElementById('wrap');
    S = {
      screen: 'title', paused: false, world: null, input: RC.Input(), ticker: RC.Ticker(15),
      invincible: false, muted: load(MUTE_KEY) === '1', audioOn: false,
      rec: null, recInv: false, lastRec: loadRec(), rep: null, finishT: 0, playT: 0, frozen: false
    };
    RC.audio.mute(S.muted);
    RC.render.init(canvas);
    RC.debug.init(document.getElementById('dbg'));
    S.world = makeWorld();
    RC.render.reset(S.world);
    resize();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { S.input.clear(); });
    window.addEventListener('resize', resize);
    window.addEventListener('error', function (e) { report(e && (e.error || e.message)); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && S.screen === 'play' && !S.paused) setPaused(true);
    });
    canvas.addEventListener('pointerdown', onPointer);

    RC.game = {
      world: function () { return S.world; },
      restart: restart,
      setInvincible: setInvincible,
      isInvincible: function () { return S.invincible; },
      warp: warp,
      recStart: recStart,
      recStop: recStop,
      isRecording: function () { return !!S.rec; },
      recLength: function () { return S.rec ? S.rec.length() : 0; },
      lastRecording: function () { return S.lastRec ? S.lastRec.bits.slice() : null; },
      lastRecordingInvincible: function () { return S.lastRec ? S.lastRec.invincible : false; },
      replay: replay,
      isReplaying: function () { return !!S.rep; },
      replayInfo: function () { return S.rep ? { pos: S.rep.pos(), length: S.rep.length() } : null; },
      fps: function () { return fpsAvg; },
      state: state
    };

    window.RC_TEST = {
      state: state,
      replay: replay,
      setInvincible: setInvincible,
      start: function () { startGame(false); return state(); },
      restart: function () { restart(); return state(); },
      warp: function (i) { return warp(i); },
      recording: function () { return S.lastRec ? S.lastRec.bits.slice() : null; },
      setGrayMode: function (m) { return RC.render.setGrayMode(m); },
      // для снимков: остановить время мира без экрана паузы (украшения продолжают мерцать)
      freeze: function (b) { S.frozen = !!b; S.ticker.reset(); return S.frozen; }
    };

    window.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(RC);
