var RC = (typeof RC !== 'undefined') ? RC : {};
// Картинка игры — только фигуры (нарисованных картинок пока нет).
// Камера с упреждением, небо с луной и звёздами, два слоя леса (дальние круглые кроны и ближние
// стволы) с разной скоростью, земля и ветки, фонари-привалы, Сонный замок, враги, искорки,
// страница письма, светлячки, герой Фитиль (круглый шлем, огонёк = здоровье, красный шарф),
// пыль и искры, «волна цвета» (мир серый, у зажжённого фонаря расходится круг цвета),
// темнота на тёмном участке, HUD и экраны старта / паузы / финиша.
//
// Как устроена волна цвета: лес, земля, ветки, фонари и замок рисуются на отдельный слой в цвете.
// Слой выводится на экран серым (ctx.filter = 'grayscale(1)', а где фильтра нет — смешиванием
// «saturation»), затем второй проход выводит тот же слой в цвете, но только внутри мягких кругов:
// вокруг зажжённых фонарей (круг растёт за 45 кадров), маленький круг вокруг огонька героя и
// большой круг от ворот замка на финише. Небо, герой, враги, искорки и светлячки всегда цветные.
//
// Файл только рисует: мир он читает, но ничего в нём не меняет.

(function (RC) {
  'use strict';

  var T = RC.TILE, VW = RC.VIEW_W, VH = RC.VIEW_H;
  var TAU = Math.PI * 2;
  var FONT = '"Trebuchet MS", "Avenir Next", "Segoe UI", system-ui, sans-serif';
  var WAVE_FRAMES = 45;        // за сколько кадров расходится круг цвета от фонаря
  var WAVE_R = 11 * T;         // до какого радиуса он дорастает
  var LAMP_LIGHT = 4.6 * T;    // свет фонаря в темноте (Тенюшки уходят, если ближе 4 плиток)
  var FAR_P = 2400, NEAR_P = 2160;
  var SOLID = RC.CELL ? RC.CELL.SOLID : 1;

  var R = RC.render = {};

  var canvas = null, ctx = null, RS = 1;
  var layer = null, lctx = null, tmp = null, tctx = null, grayC = null, gctx = null, darkC = null, dctx = null;
  var grayMode = 'filter';
  var cam = { x: 0, y: 0, look: 0, ty: 0, shake: 0 };
  var parts = [];
  var vt = 0;                                  // «видимое время» в кадрах: мерцание, светлячки
  var prng = RC.rng(9001);                     // случайность только для украшений
  var hero = { walk: 0, sdx: -0.4, sdy: 0.9 };
  var fade = 0;
  var seen = null;
  var worldRef = null;
  var sparksTotal = 0;
  var SPR = {};
  var DECO = null;
  var GC = {}, GL = {};                        // запомненные градиенты: GC — экран, GL — слой
  var frameFlowers = [], frameWindows = [], owlAt = null;

  // ---------------------------------------------------------------- мелочи

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function hash(a, b) {
    var h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function circle(c, x, y, r) { r = Math.max(0, r); c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
  function oval(c, x, y, rx, ry, rot) {
    rx = Math.max(0, rx); ry = Math.max(0, ry);
    c.moveTo(x + rx * Math.cos(rot || 0), y + rx * Math.sin(rot || 0));
    c.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
  }
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r);
    c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h);
    c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r);
    c.arcTo(x, y, x + r, y, r);
    c.closePath();
  }
  function text(c, s, x, y, size, color, align, weight, shadow) {
    c.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
    c.textAlign = align || 'center';
    c.textBaseline = 'middle';
    if (shadow) {
      c.fillStyle = 'rgba(0,0,10,0.55)';
      c.fillText(s, x + 2, y + 3);
    }
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
  function mmss(frames) {
    var s = Math.max(0, Math.floor(frames / 60));
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  R.mmss = mmss;

  // ---------------------------------------------------------------- серый слой: чем делать

  function detectGray() {
    try {
      var c = mk(4, 4), x = c.getContext('2d');
      if ('filter' in x) {
        x.filter = 'grayscale(1)';
        x.fillStyle = '#ff0000';
        x.fillRect(0, 0, 4, 4);
        var d = x.getImageData(1, 1, 1, 1).data;
        if (d[3] > 200 && Math.abs(d[0] - d[1]) < 24 && Math.abs(d[1] - d[2]) < 24) return 'filter';
      }
      c = mk(4, 4); x = c.getContext('2d');
      x.fillStyle = '#ff0000';
      x.fillRect(0, 0, 4, 4);
      x.globalCompositeOperation = 'saturation';
      x.fillStyle = '#808080';
      x.fillRect(0, 0, 4, 4);
      var e = x.getImageData(1, 1, 1, 1).data;
      if (Math.abs(e[0] - e[1]) < 24 && Math.abs(e[1] - e[2]) < 24) return 'blend';
    } catch (err) { /* проверить не вышло — ниже запасной путь */ }
    return 'dim';
  }

  // ---------------------------------------------------------------- заготовки: свечения и украшения

  function makeGlow(rgb) {
    var s = 128, c = mk(s, s), x = c.getContext('2d');
    var g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(' + rgb + ',1)');
    g.addColorStop(0.22, 'rgba(' + rgb + ',0.55)');
    g.addColorStop(0.55, 'rgba(' + rgb + ',0.16)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    return c;
  }
  function buildSprites() {
    SPR.warm = makeGlow('255,160,60');
    SPR.gold = makeGlow('255,214,100');
    SPR.fly = makeGlow('190,255,110');
    SPR.cold = makeGlow('130,170,255');
    SPR.moon = makeGlow('185,205,255');
    SPR.teal = makeGlow('80,230,205');
    SPR.eye = makeGlow('255,240,150');
    SPR.white = makeGlow('255,255,255');
    SPR.pink = makeGlow('255,80,120');
  }
  function glow(c, spr, x, y, r, a) {
    if (!(a > 0) || !(r > 0)) return;
    c.globalAlpha = a > 1 ? 1 : a;
    c.drawImage(spr, x - r, y - r, r * 2, r * 2);
  }

  function buildDeco() {
    var r = RC.rng(20260925);
    var d = { stars: [], far: [], near: [], flies: [] };
    var i, j;
    for (i = 0; i < 130; i++) {
      d.stars.push({ x: r.next() * (VW + 200), y: r.next() * 330, s: 0.6 + r.next() * 1.5,
        p: r.next() * TAU, f: 0.015 + r.next() * 0.05, big: r.next() < 0.07 });
    }
    for (i = 0; i < 17; i++) {
      var tr = { x: i * (FAR_P / 17) + r.range(-40, 40), tw: r.range(7, 13), th: r.range(70, 170),
        glow: r.next() < 0.4, crowns: [] };
      var n = 3 + Math.floor(r.next() * 3);
      for (j = 0; j < n; j++) tr.crowns.push({ dx: r.range(-38, 38), dy: r.range(-40, 10), r: r.range(26, 48) });
      d.far.push(tr);
    }
    for (i = 0; i < 7; i++) {
      var nt = { x: i * (NEAR_P / 7) + r.range(-70, 70), w: r.range(26, 44), lean: r.range(-18, 18), crowns: [],
        moss: r.next() < 0.6 };
      for (j = 0; j < 4; j++) nt.crowns.push({ dx: r.range(-80, 80), dy: r.range(-40, 30), r: r.range(45, 80) });
      d.near.push(nt);
    }
    for (i = 0; i < 130; i++) {
      d.flies.push({ x: r.next() * 9300, y: r.range(150, 600), ax: r.range(18, 60), ay: r.range(10, 36),
        fx: r.range(0.004, 0.014), fy: r.range(0.006, 0.02), p1: r.next() * TAU, p2: r.next() * TAU,
        p3: r.next() * TAU, bf: r.range(0.02, 0.06), s: r.range(0.7, 1.3) });
    }
    return d;
  }

  // ---------------------------------------------------------------- запуск, размер, сброс

  R.init = function (cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    layer = mk(VW, VH); lctx = layer.getContext('2d');
    tmp = mk(VW, VH); tctx = tmp.getContext('2d');
    grayC = mk(VW, VH); gctx = grayC.getContext('2d');
    darkC = mk(VW, VH); dctx = darkC.getContext('2d');
    grayMode = detectGray();
    buildSprites();
    DECO = buildDeco();
    R.setScale(1);
  };

  // Во сколько раз холст чётче 960×540 (под размер окна и ретину). Логика этого не видит.
  R.setScale = function (s) {
    if (!canvas) return;
    s = clamp(s || 1, 0.5, 2);
    RS = s;
    var w = Math.round(VW * s), h = Math.round(VH * s);
    var all = [canvas, layer, tmp, grayC, darkC];
    for (var i = 0; i < all.length; i++) {
      if (all[i].width !== w || all[i].height !== h) { all[i].width = w; all[i].height = h; }
    }
  };
  R.scale = function () { return RS; };
  R.grayMode = function () { return grayMode; };
  R.setGrayMode = function (m) { if (m === 'filter' || m === 'blend' || m === 'dim') grayMode = m; return grayMode; };
  R.camera = function () { return { x: Math.round(cam.x), y: Math.round(cam.y) }; };
  R.tick = function (dtFrames) { if (dtFrames > 0) vt += Math.min(dtFrames, 30); };

  R.reset = function (world) {
    worldRef = world;
    parts.length = 0;
    seen = new Uint8Array(world.items.length);
    sparksTotal = 0;
    for (var i = 0; i < world.items.length; i++) {
      seen[i] = world.items[i].taken ? 1 : 0;
      if (world.items[i].kind === 'spark') sparksTotal++;
    }
    hero.walk = 0;
    hero.sdx = -0.4 * (world.player.facing || 1);
    hero.sdy = 0.9;
    fade = 0;
    snapCamera(world);
  };
  R.snap = function (world) { snapCamera(world); fade = 0.8; };
  R.sparksTotal = function () { return sparksTotal; };

  // ---------------------------------------------------------------- камера

  function clampCam(world) {
    var maxX = Math.max(0, world.grid.w * T - VW), maxY = Math.max(0, world.grid.h * T - VH);
    cam.x = clamp(cam.x, 0, maxX);
    cam.y = clamp(cam.y, 0, maxY);
    cam.ty = clamp(cam.ty, 0, maxY);
  }
  function snapCamera(world) {
    var p = world.player;
    cam.look = (p.facing || 1) * 60;
    cam.x = p.x + p.w / 2 + cam.look - VW / 2;
    cam.ty = p.y + p.h - VH * 0.66;
    cam.y = cam.ty;
    cam.shake = 0;
    clampCam(world);
  }
  function updateCamera(world) {
    var p = world.player;
    var speed = Math.min(1, Math.abs(p.vx) / RC.P.runMax);
    var lookT = (p.facing || 1) * (50 + 85 * speed);          // упреждение по направлению бега
    cam.look += (lookT - cam.look) * 0.045;
    var tx = p.x + p.w / 2 + cam.look - VW / 2;
    cam.x += (tx - cam.x) * 0.14;                               // плавное следование
    var cy = p.y + p.h / 2;
    if (p.onGround) cam.ty = p.y + p.h - VH * 0.66;
    else {
      var sy = cy - cam.ty;
      if (sy < VH * 0.28) cam.ty = cy - VH * 0.28;
      else if (sy > VH * 0.76) cam.ty = cy - VH * 0.76;
    }
    cam.y += (cam.ty - cam.y) * 0.09;
    if (cam.shake > 0) { cam.shake *= 0.86; if (cam.shake < 0.25) cam.shake = 0; }
    clampCam(world);
  }

  // ---------------------------------------------------------------- частицы (пыль, искры, конфетти)

  function addPart(o) {
    if (parts.length >= 420) parts.shift();
    o.life = 0;
    parts.push(o);
  }
  function dust(x, y, n, dir) {
    for (var i = 0; i < n; i++) {
      var d = dir || (prng.next() < 0.5 ? -1 : 1);
      addPart({ k: 'dust', x: x + prng.range(-9, 9), y: y - prng.range(0, 3), vx: d * prng.range(0.3, 1.9),
        vy: -prng.range(0.2, 1.2), g: -0.012, drag: 0.92, max: prng.range(18, 32), s: prng.range(3, 6.5) });
    }
  }
  function burst(x, y, n, kind, sp) {
    for (var i = 0; i < n; i++) {
      var a = prng.next() * TAU, v = prng.range(0.35, 1) * sp;
      addPart({ k: 'glint', c: kind, x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, g: 0.045,
        drag: 0.95, max: prng.range(28, 55), s: prng.range(1.6, 3.4) });
    }
  }
  function ring(x, y, r0, r1, max, kind) { addPart({ k: 'ring', c: kind, x: x, y: y, vx: 0, vy: 0, g: 0, drag: 1, r0: r0, r1: r1, max: max, s: 1 }); }
  function embers(x, y, n) {
    for (var i = 0; i < n; i++) {
      addPart({ k: 'glint', c: 'warm', x: x + prng.range(-8, 8), y: y + prng.range(-6, 6), vx: prng.range(-2.4, 2.4),
        vy: prng.range(-3.2, -0.6), g: 0.06, drag: 0.96, max: prng.range(22, 40), s: prng.range(1.6, 3) });
    }
  }
  function wisps(x, y, n, dir) {
    for (var i = 0; i < n; i++) {
      addPart({ k: 'wisp', x: x + prng.range(-12, 12), y: y + prng.range(-14, 14), vx: dir * prng.range(0.3, 1.6),
        vy: -prng.range(0.1, 0.9), g: 0, drag: 0.97, max: prng.range(30, 50), s: prng.range(5, 10) });
    }
  }
  var CONF = ['#ffd45e', '#ff6b6b', '#6be3a0', '#7fb5ff', '#ffa3e0', '#fff4c0'];
  function confetti(x, y, n) {
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + prng.range(-1.2, 1.2), v = prng.range(3, 8);
      addPart({ k: 'conf', c: CONF[i % CONF.length], x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.12,
        drag: 0.985, max: prng.range(70, 120), s: prng.range(3, 5), rot: prng.next() * TAU, vr: prng.range(-0.3, 0.3) });
    }
  }
  function updateParts() {
    for (var i = parts.length - 1; i >= 0; i--) {
      var q = parts[i];
      q.life++;
      if (q.life >= q.max) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      q.vx *= q.drag;
      q.vy = q.vy * q.drag + q.g;
      q.x += q.vx;
      q.y += q.vy;
      if (q.vr) q.rot += q.vr;
    }
  }

  function lampPos(l) { return { x: (l.tx + 0.5) * T, y: (l.ty + 1) * T - 79 }; }

  // Один кадр логики прошёл: камера, события → частицы.
  R.onStep = function (world) {
    if (world !== worldRef) R.reset(world);
    var p = world.player, ev = world.events, i;
    updateCamera(world);
    if (p.onGround) hero.walk += Math.abs(p.vx) * 0.13;
    // куда тянется хвост шарфа: назад от скорости, вниз при взлёте, вверх при падении
    var tdx = -p.vx * 0.2 - (p.facing || 1) * 0.35, tdy = 0.75 - p.vy * 0.085;
    var len = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
    hero.sdx += (tdx / len - hero.sdx) * 0.18;
    hero.sdy += (tdy / len - hero.sdy) * 0.18;

    var fx = p.x + p.w / 2, fy = p.y + p.h;
    if (!world.finished) {
      if (p.onGround && Math.abs(p.vx) > RC.P.walkMax + 0.3 && world.frame % 5 === 0) dust(fx - p.facing * 10, fy, 1, -p.facing);
      if (p.onGround && p.vx * p.facing < -1.2 && world.frame % 3 === 0) dust(fx, fy, 1, p.vx > 0 ? 1 : -1);
    }
    for (i = 0; i < ev.length; i++) {
      var name = ev[i];
      if (name === 'jump') dust(fx, fy, 5, 0);
      else if (name === 'land') dust(fx, fy, Math.round(clamp(p.landImpact * 0.8, 3, 12)), 0);
      else if (name === 'hurt') { cam.shake = 9; embers(fx, p.y + 8, 14); }
      else if (name === 'lantern') {
        var l = world.lit[world.lit.length - 1];
        if (l) { var lp = lampPos(l); burst(lp.x, lp.y, 40, 'gold', 4.8); ring(lp.x, lp.y, 10, 90, 30, 'gold'); }
      } else if (name === 'respawn') { fade = 1; snapCamera(world); burst(fx, fy - 22, 18, 'gold', 2.6); }
      else if (name === 'finish' && world.finish) confetti((world.finish.tx + 0.5) * T, (world.finish.ty - 1) * T, 90);
    }
    for (i = 0; i < world.items.length; i++) {
      var it = world.items[i];
      if (it.taken && !seen[i]) {
        seen[i] = 1;
        var ix = it.tx * T + 24, iy = it.ty * T + 24;
        if (it.kind === 'spark') { burst(ix, iy, 9, 'gold', 2.6); ring(ix, iy, 4, 26, 16, 'gold'); }
        else { burst(ix, iy, 34, 'gold', 3.8); burst(ix, iy, 14, 'white', 2.2); ring(ix, iy, 8, 70, 30, 'white'); }
      }
    }
    for (i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (e.t !== 0) continue;
      if (e.state === 'squashed') { burst(e.x + e.w / 2, e.y + 4, 10, 'white', 2.4); dust(e.x + e.w / 2, e.y + e.h, 6, 0); }
      else if (e.state === 'flee') wisps(e.x + e.w / 2, e.y + e.h / 2, 12, e.fleeDir || 1);
    }
    updateParts();
    if (fade > 0) fade = Math.max(0, fade - 0.045);
  };

  // ---------------------------------------------------------------- небо и фон

  function drawSky(c, v) {
    if (!GC.sky) {
      GC.sky = c.createLinearGradient(0, 0, 0, VH);
      GC.sky.addColorStop(0, '#050a24');
      GC.sky.addColorStop(0.45, '#0d1b50');
      GC.sky.addColorStop(0.8, '#19306f');
      GC.sky.addColorStop(1, '#223d7c');
    }
    c.fillStyle = GC.sky;
    c.fillRect(0, 0, VW, VH);
    var oy = (228 - v.y) * 0.05, WR = VW + 200, i, s;
    c.fillStyle = '#fff6dc';
    for (i = 0; i < DECO.stars.length; i++) {
      s = DECO.stars[i];
      var x = mod(s.x - v.x * 0.02, WR) - 100, y = s.y + oy;
      var a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(vt * s.f + s.p));
      c.globalAlpha = a;
      c.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
      if (s.big) {
        c.globalAlpha = a * 0.5;
        c.fillRect(x - 4, y - 0.5, 8, 1);
        c.fillRect(x - 0.5, y - 4, 1, 8);
      }
    }
    c.globalAlpha = 1;
    // луна
    var mx = 772, my = 88 + oy * 2;
    c.globalCompositeOperation = 'lighter';
    glow(c, SPR.moon, mx, my, 170, 0.32);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#f4f0da';
    c.beginPath(); circle(c, mx, my, 33); c.fill();
    c.fillStyle = 'rgba(170,176,200,0.35)';
    c.beginPath(); circle(c, mx - 10, my - 6, 7); circle(c, mx + 9, my + 9, 5); circle(c, mx + 12, my - 12, 3.5); c.fill();
  }

  function drawFar(c, v) {
    var ox = v.x * 0.22;
    var base = 395 + (228 - v.y) * 0.3;
    var sx, i, j;
    // дальние холмы
    c.fillStyle = '#0a1c3c';
    c.beginPath();
    c.moveTo(0, VH);
    for (sx = 0; sx <= VW + 20; sx += 20) {
      var wx = sx + ox;
      c.lineTo(sx, base - 26 - 22 * Math.sin(wx * 0.0037) - 12 * Math.sin(wx * 0.011 + 1.7));
    }
    c.lineTo(VW + 20, VH);
    c.closePath();
    c.fill();
    // деревья с круглыми кронами; часть крон светится
    for (i = 0; i < DECO.far.length; i++) {
      var tr = DECO.far[i];
      var x = mod(tr.x - ox, FAR_P) - 120;
      if (x > VW + 120) continue;
      var top = base - tr.th;
      c.fillStyle = '#081630';
      c.fillRect(x - tr.tw / 2, top, tr.tw, tr.th + 60);
      c.fillStyle = tr.glow ? '#14506a' : '#0d2848';
      c.beginPath();
      for (j = 0; j < tr.crowns.length; j++) circle(c, x + tr.crowns[j].dx, top + tr.crowns[j].dy, tr.crowns[j].r);
      c.fill();
      if (tr.glow) {
        c.fillStyle = 'rgba(70,170,170,0.35)';
        c.beginPath();
        for (j = 0; j < tr.crowns.length; j++) {
          circle(c, x + tr.crowns[j].dx - tr.crowns[j].r * 0.25, top + tr.crowns[j].dy - tr.crowns[j].r * 0.25, tr.crowns[j].r * 0.55);
        }
        c.fill();
        c.globalCompositeOperation = 'lighter';
        glow(c, SPR.teal, x, top - 10, 110, 0.22 + 0.06 * Math.sin(vt * 0.03 + i));
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
      }
    }
  }

  function drawMist(c, v) {
    var base = 395 + (228 - v.y) * 0.3;
    var g = c.createLinearGradient(0, base - 80, 0, base + 70);
    g.addColorStop(0, 'rgba(130,160,240,0)');
    g.addColorStop(0.55, 'rgba(130,160,240,' + (0.12 + 0.03 * Math.sin(vt * 0.01)) + ')');
    g.addColorStop(1, 'rgba(130,160,240,0)');
    c.fillStyle = g;
    c.fillRect(0, base - 80, VW, 150);
  }

  function drawNear(c, v) {
    var ox = v.x * 0.5;
    var base = 480 + (228 - v.y) * 0.55;
    var topY = 25 + (228 - v.y) * 0.55;
    for (var i = 0; i < DECO.near.length; i++) {
      var nt = DECO.near[i];
      var x = mod(nt.x - ox, NEAR_P) - 160;
      if (x > VW + 160) continue;
      var w = nt.w;
      c.fillStyle = '#110e29';
      c.beginPath();
      c.moveTo(x - w / 2 - 8, base);
      c.lineTo(x - w * 0.34 + nt.lean, topY);
      c.lineTo(x + w * 0.34 + nt.lean, topY);
      c.lineTo(x + w / 2 + 8, base);
      c.closePath();
      c.fill();
      c.strokeStyle = '#1b1740';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - w * 0.12, base - 20); c.lineTo(x - w * 0.1 + nt.lean * 0.8, topY + 40);
      c.moveTo(x + w * 0.18, base - 60); c.lineTo(x + w * 0.14 + nt.lean * 0.7, topY + 90);
      c.stroke();
      c.fillStyle = '#0d2236';
      c.beginPath();
      for (var j = 0; j < nt.crowns.length; j++) circle(c, x + nt.lean + nt.crowns[j].dx, topY - 25 + nt.crowns[j].dy, nt.crowns[j].r);
      c.fill();
      if (nt.moss) {
        c.strokeStyle = '#17414a';
        c.lineWidth = 1.5;
        c.beginPath();
        for (j = 0; j < 5; j++) {
          var mx = x + nt.lean - 50 + j * 24, my = topY + 20 + (j % 2) * 14;
          c.moveTo(mx, my);
          c.quadraticCurveTo(mx + 4 * Math.sin(vt * 0.02 + j), my + 30, mx, my + 55 + (j % 3) * 10);
        }
        c.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- земля, пеньки, ветки, цветы

  function isStump(g, tx, ty) {
    return g.code(tx, ty) === SOLID && g.code(tx - 1, ty) !== SOLID && g.code(tx + 1, ty) !== SOLID &&
      g.code(tx, ty - 1) !== SOLID && g.code(tx, ty + 1) === SOLID;
  }
  function flowerAt(tx, ty) {
    var h = hash(tx * 7 + 3, ty * 13 + 5);
    return h < 0.2 ? 8 + hash(tx, ty + 99) * 30 : -1;
  }

  function drawTerrain(c, world, v) {
    var g = world.grid;
    var tx0 = Math.max(0, Math.floor(v.x / T) - 1), tx1 = Math.min(g.w - 1, Math.floor((v.x + VW) / T) + 1);
    var ty0 = Math.max(0, Math.floor(v.y / T) - 1), ty1 = Math.min(g.h - 1, Math.floor((v.y + VH) / T) + 1);
    var tx, ty, x, y, k, h;
    var stumps = [], tops = [];
    frameFlowers.length = 0;

    if (!GL.earth) {
      GL.earth = c.createLinearGradient(0, 560, 0, 16 * T);
      GL.earth.addColorStop(0, '#6f4731');
      GL.earth.addColorStop(0.35, '#573626');
      GL.earth.addColorStop(1, '#361f17');
    }
    // тело земли
    c.fillStyle = GL.earth;
    c.beginPath();
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (g.code(tx, ty) !== SOLID) continue;
        if (isStump(g, tx, ty)) { stumps.push(tx, ty); continue; }
        c.rect(tx * T, ty * T, T, T);
        if (g.code(tx, ty - 1) !== SOLID) tops.push(tx, ty);
      }
    }
    c.fill();
    // бока ям темнее, камушки
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (g.code(tx, ty) !== SOLID || isStump(g, tx, ty)) continue;
        if (g.code(tx - 1, ty) !== SOLID) c.rect(tx * T, ty * T, 6, T);
        if (g.code(tx + 1, ty) !== SOLID) c.rect(tx * T + T - 6, ty * T, 6, T);
      }
    }
    c.fill();
    c.fillStyle = '#7d5540';
    c.beginPath();
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (g.code(tx, ty) !== SOLID || isStump(g, tx, ty) || g.code(tx, ty - 1) !== SOLID) continue;
        h = hash(tx, ty);
        oval(c, tx * T + 8 + h * 30, ty * T + 10 + hash(ty, tx) * 26, 4 + h * 3, 2.5 + h * 1.5, 0);
      }
    }
    c.fill();
    c.fillStyle = '#2c1811';
    c.beginPath();
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (g.code(tx, ty) !== SOLID || isStump(g, tx, ty)) continue;
        h = hash(tx + 11, ty + 17);
        circle(c, tx * T + 6 + h * 36, ty * T + 20 + hash(tx + 5, ty) * 24, 1.6 + h * 1.4);
      }
    }
    c.fill();

    // трава сверху: полоса, травинки, свисающая бахрома
    c.fillStyle = '#237a4b';
    c.beginPath();
    for (k = 0; k < tops.length; k += 2) {
      x = tops[k] * T; y = tops[k + 1] * T;
      c.rect(x, y, T, 11);
      for (var b = 0; b < 6; b++) {
        var bx = x + 1 + b * 8 + hash(tops[k] + b, 3) * 3, bh = 4 + hash(tops[k], b) * 7;
        c.moveTo(bx, y + 1); c.lineTo(bx + 2.5, y - bh); c.lineTo(bx + 5, y + 1); c.closePath();
      }
      if (g.code(tops[k] - 1, tops[k + 1]) !== SOLID) { c.moveTo(x + 7, y + 6); c.arc(x + 1, y + 6, 6, 0, TAU); }
      if (g.code(tops[k] + 1, tops[k + 1]) !== SOLID) { c.moveTo(x + T + 5, y + 6); c.arc(x + T - 1, y + 6, 6, 0, TAU); }
    }
    c.fill();
    c.fillStyle = '#1a5e3a';
    c.beginPath();
    for (k = 0; k < tops.length; k += 2) {
      x = tops[k] * T; y = tops[k + 1] * T;
      for (var f = 0; f < 6; f++) {
        var fx0 = x + f * 8, fd = 3 + hash(tops[k] + f, 7) * 6;
        c.moveTo(fx0, y + 10); c.lineTo(fx0 + 4, y + 10 + fd); c.lineTo(fx0 + 8, y + 10); c.closePath();
      }
    }
    c.fill();
    c.fillStyle = '#48c47c';
    c.beginPath();
    for (k = 0; k < tops.length; k += 2) c.rect(tops[k] * T, tops[k + 1] * T, T, 3);
    c.fill();

    // лунные цветы на траве
    for (k = 0; k < tops.length; k += 2) {
      var off = flowerAt(tops[k], tops[k + 1]);
      if (off < 0 || g.code(tops[k], tops[k + 1] - 1) !== 0) continue;
      x = tops[k] * T + off; y = tops[k + 1] * T;
      var sway = Math.sin(vt * 0.03 + tops[k]) * 1.5;
      c.strokeStyle = '#2e8a5a';
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(x, y + 2); c.quadraticCurveTo(x - 2, y - 8, x + sway, y - 15); c.stroke();
      c.fillStyle = '#c9d3ff';
      c.beginPath();
      for (var pp = 0; pp < 5; pp++) {
        var pa = pp * TAU / 5 + tops[k];
        oval(c, x + sway + Math.cos(pa) * 3.6, y - 15 + Math.sin(pa) * 3.6, 3.2, 2.2, pa);
      }
      c.fill();
      c.fillStyle = '#fff2a6';
      c.beginPath(); circle(c, x + sway, y - 15, 2); c.fill();
      frameFlowers.push(x + sway, y - 15);
    }

    // пеньки
    for (k = 0; k < stumps.length; k += 2) drawStump(c, stumps[k], stumps[k + 1]);

    // ветки
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (!g.oneWay(tx, ty)) continue;
        var a = tx, e = tx;
        while (a > 0 && g.oneWay(a - 1, ty)) a--;
        while (e < g.w - 1 && g.oneWay(e + 1, ty)) e++;
        drawBranch(c, a, e, ty);
        tx = e;
      }
    }
  }

  function drawStump(c, tx, ty) {
    var x = tx * T, y = ty * T, cx = x + T / 2;
    c.fillStyle = '#6b4128';
    c.beginPath();
    c.moveTo(x + 2, y + 6);
    c.lineTo(x + T - 2, y + 6);
    c.lineTo(x + T + 3, y + T);
    c.lineTo(x - 3, y + T);
    c.closePath();
    c.fill();
    c.strokeStyle = '#4a2a18';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + 12, y + 14); c.lineTo(x + 10, y + T - 4);
    c.moveTo(x + 26, y + 12); c.lineTo(x + 27, y + T - 8);
    c.moveTo(x + 38, y + 16); c.lineTo(x + 40, y + T - 2);
    c.stroke();
    c.fillStyle = '#c9975f';
    c.beginPath(); oval(c, cx, y + 6, T / 2 - 2, 6, 0); c.fill();
    c.strokeStyle = '#9a6a40';
    c.lineWidth = 1.2;
    c.beginPath(); oval(c, cx, y + 6, 14, 3.6, 0); oval(c, cx, y + 6, 7, 1.8, 0); c.stroke();
    c.fillStyle = '#2f9a5f';
    c.beginPath(); oval(c, x + 6, y + 6, 6, 3, -0.4); oval(c, x + T - 8, y + 4, 4, 2.5, 0.5); c.fill();
    c.strokeStyle = '#3aa86a';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x + T - 10, y + 2); c.quadraticCurveTo(x + T - 6, y - 8, x + T - 1, y - 10); c.stroke();
    c.fillStyle = '#4cc87e';
    c.beginPath(); oval(c, x + T - 1, y - 10, 4, 2.2, -0.6); c.fill();
  }

  function drawBranch(c, a, e, ty) {
    var x0 = a * T - 6, x1 = (e + 1) * T + 6, y = ty * T, w = x1 - x0, i;
    c.fillStyle = '#6b4126';
    c.beginPath(); rr(c, x0, y, w, 15, 7); c.fill();
    c.fillStyle = '#9c6a3e';
    c.beginPath(); rr(c, x0 + 5, y + 1.5, w - 10, 4, 2); c.fill();
    c.fillStyle = '#4b2b18';
    c.beginPath();
    for (i = a; i <= e; i++) if (hash(i, ty) < 0.45) oval(c, i * T + 12 + hash(ty, i) * 24, y + 9, 3.2, 2, 0);
    c.fill();
    // листья на концах и снизу
    c.fillStyle = '#2f9a5f';
    c.beginPath();
    oval(c, x0 + 3, y + 4, 8, 4, -0.5);
    oval(c, x0 + 1, y + 11, 6, 3, 0.4);
    oval(c, x1 - 3, y + 3, 8, 4, 0.5);
    oval(c, x1 - 2, y + 11, 6, 3, -0.3);
    for (i = a; i <= e; i++) {
      if (hash(i + 3, ty + 1) < 0.55) {
        var lx = i * T + 10 + hash(i, ty + 7) * 28, sw = Math.sin(vt * 0.04 + i) * 0.25;
        oval(c, lx, y + 19, 3.2, 6.5, sw);
      }
    }
    c.fill();
    c.fillStyle = '#48c47c';
    c.beginPath();
    oval(c, x0 + 5, y + 2, 4, 2, -0.5);
    oval(c, x1 - 5, y + 1, 4, 2, 0.5);
    c.fill();
  }

  // ---------------------------------------------------------------- фонари (столбы — на слой мира)

  function drawLanternPosts(c, world, v) {
    for (var i = 0; i < world.lanterns.length; i++) {
      var l = world.lanterns[i];
      var x = (l.tx + 0.5) * T, ground = (l.ty + 1) * T, ly = ground - 79;
      if (x < v.x - 80 || x > v.x + VW + 80) continue;
      c.fillStyle = '#272a42';
      c.beginPath();
      c.moveTo(x - 13, ground); c.lineTo(x - 7, ground - 9); c.lineTo(x + 7, ground - 9); c.lineTo(x + 13, ground);
      c.closePath();
      c.rect(x - 3, ly + 12, 6, ground - ly - 20);
      rr(c, x - 12, ly - 14, 24, 4, 2);
      rr(c, x - 11, ly + 12, 22, 4, 2);
      c.moveTo(x - 15, ly - 13); c.lineTo(x, ly - 25); c.lineTo(x + 15, ly - 13); c.closePath();
      c.fill();
      c.fillStyle = '#3b4063';
      c.beginPath(); c.rect(x - 5, ground - 44, 10, 4); c.rect(x - 5, ly + 18, 10, 3); c.fill();
      c.strokeStyle = '#272a42';
      c.lineWidth = 2;
      c.beginPath(); circle(c, x, ly - 28, 3.5); c.stroke();
      c.fillStyle = l.lit ? '#ffd46b' : '#46506c';
      c.fillRect(x - 9, ly - 10, 18, 22);
      c.fillStyle = '#272a42';
      c.fillRect(x - 10, ly - 10, 2, 22);
      c.fillRect(x + 8, ly - 10, 2, 22);
      c.fillRect(x - 1, ly - 10, 2, 22);
    }
  }

  // ---------------------------------------------------------------- Сонный замок (слой мира)

  function drawCastle(c, world, v) {
    frameWindows.length = 0;
    owlAt = null;
    var f = world.finish;
    if (!f) return;
    var gx = f.tx * T, ground = (f.ty + 1) * T;
    if (gx + 6 * T < v.x || gx - 4 * T > v.x + VW) return;
    var stone = '#77739f', stoneD = '#5b5783', roof = '#3d3680', i;
    var wl = gx - 2 * T, wr = gx + 5 * T;
    // стена с зубцами
    c.fillStyle = stoneD;
    c.beginPath();
    c.rect(wl, ground - 150, wr - wl, 150);
    for (i = 0; wl + i * 26 < wr - 10; i++) c.rect(wl + i * 26, ground - 164, 15, 16);
    c.fill();
    // середина (донжон)
    var kx = gx - 20, kw = 2.4 * T;
    c.fillStyle = stone;
    c.beginPath(); c.rect(kx, ground - 250, kw, 110); c.fill();
    c.fillStyle = roof;
    c.beginPath(); c.moveTo(kx - 10, ground - 248); c.lineTo(kx + kw / 2, ground - 318); c.lineTo(kx + kw + 10, ground - 248); c.closePath(); c.fill();
    // башни
    tower(c, wl - 30, ground, 72, 262, stone, roof);
    tower(c, wr - 50, ground, 84, 300, stone, roof);
    // кладка
    c.strokeStyle = 'rgba(20,16,50,0.22)';
    c.lineWidth = 1.5;
    c.beginPath();
    for (i = 1; i < 6; i++) { c.moveTo(wl, ground - i * 26); c.lineTo(wr, ground - i * 26); }
    c.stroke();
    // ворота
    var dx = gx + 4, dw = T - 8, dt = ground - 92;
    c.fillStyle = '#1b1230';
    c.beginPath(); c.rect(dx - 6, dt + 16, dw + 12, ground - dt - 16); c.arc(dx + dw / 2, dt + 16, dw / 2 + 6, Math.PI, 0); c.fill();
    if (world.finished) {
      c.fillStyle = '#ffcf6a';
      c.beginPath(); c.rect(dx, dt + 16, dw, ground - dt - 16); c.arc(dx + dw / 2, dt + 16, dw / 2, Math.PI, 0); c.fill();
    } else {
      c.fillStyle = '#6a3f25';
      c.beginPath(); c.rect(dx, dt + 16, dw, ground - dt - 16); c.arc(dx + dw / 2, dt + 16, dw / 2, Math.PI, 0); c.fill();
      c.strokeStyle = '#4a2a18';
      c.lineWidth = 2;
      c.beginPath();
      for (i = 1; i < 4; i++) { c.moveTo(dx + i * dw / 4, dt + 4); c.lineTo(dx + i * dw / 4, ground); }
      c.stroke();
      c.fillStyle = '#e0b04a';
      c.beginPath(); circle(c, dx + dw - 8, dt + 52, 2.6); c.fill();
    }
    // окна (свет — поверх, в цвете)
    var wins = [[wl - 30 + 36, ground - 200], [wr - 50 + 42, ground - 230], [wr - 50 + 42, ground - 150],
      [kx + kw / 2 - 18, ground - 205], [kx + kw / 2 + 18, ground - 205], [wl + 40, ground - 95], [wr - 80, ground - 95]];
    c.fillStyle = '#231b3c';
    c.beginPath();
    for (i = 0; i < wins.length; i++) {
      var wx = wins[i][0], wy = wins[i][1];
      c.rect(wx - 7, wy - 4, 14, 16);
      c.moveTo(wx + 7, wy - 4); c.arc(wx, wy - 4, 7, 0, Math.PI, true);
      frameWindows.push(wx, wy + 3);
    }
    c.fill();
    c.fillStyle = '#e8b85a';
    c.beginPath();
    for (i = 0; i < wins.length; i++) if (i % 3 !== 1) c.rect(wins[i][0] - 5, wins[i][1] - 2, 10, 12);
    c.fill();
    // флажок
    var fxp = wr - 50 + 42, fyp = ground - 300 - 76;
    c.strokeStyle = '#2a2448';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(fxp, fyp + 8); c.lineTo(fxp, fyp - 22); c.stroke();
    c.fillStyle = '#ff7a3c';
    c.beginPath();
    c.moveTo(fxp, fyp - 22);
    c.quadraticCurveTo(fxp + 12, fyp - 22 + 3 * Math.sin(vt * 0.1), fxp + 24, fyp - 18);
    c.lineTo(fxp, fyp - 12);
    c.closePath();
    c.fill();
    // сова Дрёма спит на башне в ночном колпаке
    var ox = wl - 30 + 36, oy = ground - 262 - 20;
    owlAt = { x: ox, y: oy };
    c.fillStyle = '#8e7a66';
    c.beginPath(); oval(c, ox, oy, 15, 18, 0); c.fill();
    c.fillStyle = '#cdb99a';
    c.beginPath(); oval(c, ox, oy + 5, 9, 11, 0); c.fill();
    c.strokeStyle = '#3b2b20';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(ox - 5.5, oy - 6, 3.5, 0.2, Math.PI - 0.2);
    c.moveTo(ox + 9, oy - 6 + 1); c.arc(ox + 5.5, oy - 6, 3.5, 0.2, Math.PI - 0.2);
    c.stroke();
    c.fillStyle = '#e0a040';
    c.beginPath(); c.moveTo(ox - 2.5, oy - 2); c.lineTo(ox + 2.5, oy - 2); c.lineTo(ox, oy + 2); c.closePath(); c.fill();
    c.fillStyle = '#4f6fd0';
    c.beginPath(); c.moveTo(ox - 14, oy - 12); c.quadraticCurveTo(ox, oy - 34, ox + 20, oy - 24); c.lineTo(ox + 14, oy - 12); c.closePath(); c.fill();
    c.fillStyle = '#f2f2ff';
    c.beginPath(); circle(c, ox + 21, oy - 24, 3.5); c.fill();
  }
  function tower(c, x, ground, w, h, stone, roof) {
    c.fillStyle = stone;
    c.beginPath();
    c.rect(x, ground - h, w, h);
    for (var i = 0; i < 4; i++) c.rect(x + i * (w / 4) + 2, ground - h - 12, w / 4 - 6, 13);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(x + w - 10, ground - h, 10, h);
    c.fillStyle = roof;
    c.beginPath(); c.moveTo(x - 10, ground - h - 10); c.lineTo(x + w / 2, ground - h - 80); c.lineTo(x + w + 10, ground - h - 10); c.closePath(); c.fill();
  }

  // ---------------------------------------------------------------- колючки и враги (в цвете)

  function drawSpikes(c, world, v) {
    var g = world.grid;
    var tx0 = Math.max(0, Math.floor(v.x / T) - 1), tx1 = Math.min(g.w - 1, Math.floor((v.x + VW) / T) + 1);
    for (var ty = 0; ty < g.h; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        if (!g.spike(tx, ty)) continue;
        var base = (ty + 1) * T;
        c.globalCompositeOperation = 'lighter';
        glow(c, SPR.pink, tx * T + T / 2, base - 10, 34, 0.25 + 0.08 * Math.sin(vt * 0.1 + tx));
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
        c.fillStyle = '#ff3f68';
        c.strokeStyle = '#7a0f30';
        c.lineWidth = 1.5;
        c.beginPath();
        for (var k = 0; k < 3; k++) {
          var x = tx * T + k * 16;
          c.moveTo(x + 1, base); c.lineTo(x + 8, base - 26); c.lineTo(x + 15, base); c.closePath();
        }
        c.fill();
        c.stroke();
        c.fillStyle = '#ffd3de';
        c.beginPath();
        for (k = 0; k < 3; k++) { var hx = tx * T + k * 16; c.moveTo(hx + 8, base - 26); c.lineTo(hx + 9.5, base - 16); c.lineTo(hx + 7, base - 16); c.closePath(); }
        c.fill();
      }
    }
  }

  function drawShish(c, e) {
    var cx = e.x + e.w / 2, by = e.y + e.h, k;
    c.save();
    c.globalAlpha = clamp(e.alpha, 0, 1);
    c.translate(cx, by);
    if (e.state === 'squashed') {
      c.fillStyle = '#ff3f68';
      c.beginPath();
      for (k = 0; k < 5; k++) { var sx = -16 + k * 8; c.moveTo(sx - 3, -9); c.lineTo(sx, -15); c.lineTo(sx + 3, -9); c.closePath(); }
      c.fill();
      c.fillStyle = '#95592f';
      c.beginPath(); oval(c, 0, -6, 20, 7, 0); c.fill();
      c.strokeStyle = '#2a1a10';
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(-8, -9); c.lineTo(-3, -4); c.moveTo(-3, -9); c.lineTo(-8, -4);
      c.moveTo(3, -9); c.lineTo(8, -4); c.moveTo(8, -9); c.lineTo(3, -4);
      c.stroke();
      c.fillStyle = '#fff3b0';
      for (k = 0; k < 3; k++) {
        var a = vt * 0.12 + k * TAU / 3;
        star(c, Math.cos(a) * 15, -22 + Math.sin(a) * 4, 3.4, a);
      }
    } else {
      var step = Math.sin(e.t * 0.22);
      var bob = Math.abs(step) * 1.6;
      c.scale(e.facing || -1, 1);
      c.fillStyle = '#3b2415';
      c.beginPath(); oval(c, -8 + step * 3, -3, 5.5, 3.2, 0); oval(c, 7 - step * 3, -3, 5.5, 3.2, 0); c.fill();
      c.translate(0, -bob);
      // колючки по спине — сигнальный цвет опасности
      c.fillStyle = '#ff3f68';
      c.beginPath();
      for (k = 0; k < 6; k++) {
        var ang = -Math.PI * 0.98 + k * (Math.PI * 0.78 / 5);
        var bx1 = Math.cos(ang - 0.17) * 16, by1 = -17 + Math.sin(ang - 0.17) * 14;
        var bx2 = Math.cos(ang + 0.17) * 16, by2 = -17 + Math.sin(ang + 0.17) * 14;
        c.moveTo(bx1, by1); c.lineTo(Math.cos(ang) * 24, -17 + Math.sin(ang) * 22); c.lineTo(bx2, by2); c.closePath();
      }
      c.fill();
      c.fillStyle = '#9c6034';
      c.beginPath(); oval(c, 0, -17, 17, 15, 0); c.fill();
      c.strokeStyle = '#6b3b1b';
      c.lineWidth = 1.6;
      c.beginPath();
      for (var row = 0; row < 3; row++) {
        for (var col = 0; col < 3 - (row === 2 ? 1 : 0); col++) {
          var qx = -11 + col * 8 + (row % 2) * 4, qy = -24 + row * 7;
          c.moveTo(qx - 3.5, qy); c.quadraticCurveTo(qx, qy + 4, qx + 3.5, qy);
        }
      }
      c.stroke();
      var sad = e.state === 'leave';
      c.fillStyle = '#fff8ea';
      c.beginPath(); circle(c, 6, -20, 3.8); circle(c, 12.5, -19, 3.3); c.fill();
      c.fillStyle = '#221408';
      c.beginPath(); circle(c, 7.2, sad ? -18.6 : -19.6, 1.9); circle(c, 13.3, sad ? -17.6 : -18.6, 1.7); c.fill();
      c.strokeStyle = '#2a1608';
      c.lineWidth = 1.8;
      c.beginPath();
      if (sad) { c.moveTo(3, -24); c.lineTo(8, -26); c.moveTo(10.5, -25.5); c.lineTo(15, -24); }
      else { c.moveTo(2.5, -26); c.lineTo(8.5, -23.5); c.moveTo(10, -23.5); c.lineTo(15.5, -25.5); }
      c.moveTo(6, -12); c.quadraticCurveTo(9, sad ? -14.5 : -10.5, 12, -12);
      c.stroke();
      if (sad) { c.fillStyle = '#9fd4ff'; c.beginPath(); oval(c, 4.5, -14 + (e.t % 30) * 0.3, 1.4, 2.2, 0); c.fill(); }
    }
    c.restore();
  }
  function star(c, x, y, s, rot) {
    c.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = rot + i * Math.PI / 4, r = i % 2 ? s * 0.38 : s;
      if (i === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  }

  function tenGeom(e) {
    var bob = e.state === 'idle' ? Math.sin(vt * 0.06 + e.tx) * 2.5 : 0;
    return { cx: e.x + e.w / 2, top: e.y + bob };
  }
  function drawTenBody(c, e) {
    var g = tenGeom(e);
    c.save();
    c.globalAlpha = clamp(e.alpha, 0, 1) * 0.95;
    c.translate(g.cx, g.top);
    if (e.state === 'flee') c.transform(1.12, 0, -0.3 * (e.fleeDir || 1), 0.96, 0, 0);
    if (!GC.ten) {
      GC.ten = c.createRadialGradient(-3, 12, 2, 0, 18, 28);
      GC.ten.addColorStop(0, '#3e2d70');
      GC.ten.addColorStop(1, '#130b29');
    }
    var w = vt * 0.12 + e.tx;
    c.fillStyle = GC.ten;
    c.beginPath();
    c.moveTo(-16, 36);
    c.bezierCurveTo(-19, 12, -12, 0, 0, 0);
    c.bezierCurveTo(12, 0, 19, 12, 16, 36);
    for (var k = 0; k < 4; k++) {
      var x0 = 16 - k * 8;
      c.quadraticCurveTo(x0 - 4, 44 + 4 * Math.sin(w + k * 1.4), x0 - 8, 37 + 2 * Math.sin(w + k));
    }
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(150,120,255,0.35)';
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
  }
  function drawTenEyes(c, world, v) {
    var p = world.player;
    for (var i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (e.kind !== 'T' || e.state === 'gone') continue;
      if (e.x + e.w < v.x - 40 || e.x > v.x + VW + 40) continue;
      var g = tenGeom(e), a = clamp(e.alpha, 0, 1);
      var scared = e.state === 'flee';
      var look = scared ? -(e.fleeDir || 1) : (p.x + p.w / 2 < g.cx ? -1 : 1);
      var ex = g.cx + look * 3 + (scared ? (e.fleeDir || 1) * 2 : 0), ey = g.top + 15;
      c.globalCompositeOperation = 'lighter';
      glow(c, SPR.eye, ex, ey, 22, 0.4 * a);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = a;
      c.fillStyle = '#fff4a8';
      c.beginPath();
      var blink = !scared && mod(vt + e.tx * 37, 190) < 7;
      if (blink) { c.rect(ex - 8, ey - 0.8, 5, 1.6); c.rect(ex + 3, ey - 0.8, 5, 1.6); }
      else if (scared) { circle(c, ex - 5.5, ey, 4); circle(c, ex + 5.5, ey, 4); }
      else { oval(c, ex - 5.5, ey, 2.6, 3.8, 0); oval(c, ex + 5.5, ey, 2.6, 3.8, 0); }
      c.fill();
      if (scared) {
        c.fillStyle = '#1a1030';
        c.beginPath(); circle(c, ex - 5.5 + look, ey, 1.6); circle(c, ex + 5.5 + look, ey, 1.6); oval(c, ex, ey + 9, 2.2, 3, 0); c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  function drawEnemies(c, world, v) {
    for (var i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (e.state === 'gone') continue;
      if (e.x + e.w < v.x - 60 || e.x > v.x + VW + 60) continue;
      if (e.kind === 'S') drawShish(c, e); else if (e.kind === 'T') drawTenBody(c, e);
    }
  }

  // ---------------------------------------------------------------- свет: фонари, окна, цветы, волна

  function drawLights(c, world, v) {
    var i, l, lp;
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < world.lanterns.length; i++) {
      l = world.lanterns[i];
      lp = lampPos(l);
      if (lp.x < v.x - 200 || lp.x > v.x + VW + 200) continue;
      if (l.lit) {
        var since = world.frame - l.litFrame, flare = since < 40 ? 1 - since / 40 : 0;
        var pulse = 0.88 + 0.12 * Math.sin(vt * 0.09 + i * 2);
        glow(c, SPR.warm, lp.x, lp.y, 150 * pulse + flare * 140, 0.5 + flare * 0.4);
        glow(c, SPR.gold, lp.x, lp.y, 34, 0.9);
        c.globalAlpha = 0.32 * pulse;
        c.drawImage(SPR.warm, lp.x - 95, (l.ty + 1) * T - 16, 190, 30);
      } else {
        glow(c, SPR.cold, lp.x, lp.y, 36 + 5 * Math.sin(vt * 0.05 + i), 0.5);
      }
    }
    for (i = 0; i < frameWindows.length; i += 2) {
      glow(c, SPR.warm, frameWindows[i], frameWindows[i + 1], 26 + 3 * Math.sin(vt * 0.04 + i), 0.45);
    }
    for (i = 0; i < frameFlowers.length; i += 2) {
      glow(c, SPR.cold, frameFlowers[i], frameFlowers[i + 1], 16 + 3 * Math.sin(vt * 0.05 + i), 0.45);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    // огонь в фонаре, светлячки-спутники вокруг зажжённого фонаря
    for (i = 0; i < world.lanterns.length; i++) {
      l = world.lanterns[i];
      lp = lampPos(l);
      if (lp.x < v.x - 200 || lp.x > v.x + VW + 200) continue;
      if (l.lit) {
        drawFlame(c, lp.x, lp.y + 10, 15 + Math.sin(vt * 0.3 + i) * 1.5, 0, vt * 0.33 + i, false);
        c.globalCompositeOperation = 'lighter';
        for (var k = 0; k < 6; k++) {
          var a = vt * (0.02 + k * 0.004) + k * 1.3;
          var fx = lp.x + Math.cos(a) * (34 + k * 7), fy = lp.y + Math.sin(a * 1.3) * (18 + k * 3);
          glow(c, SPR.gold, fx, fy, 10, 0.6 + 0.4 * Math.sin(vt * 0.1 + k));
        }
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
      } else {
        c.fillStyle = 'rgba(170,200,255,' + (0.45 + 0.25 * Math.sin(vt * 0.05 + i)) + ')';
        c.beginPath(); circle(c, lp.x, lp.y + 5, 2.5); c.fill();
      }
    }
    // сова спит: «з-з-з»
    if (owlAt && !world.finished) {
      for (i = 0; i < 3; i++) {
        var t = mod(vt * 0.012 + i / 3, 1);
        c.globalAlpha = Math.sin(t * Math.PI) * 0.85;
        text(c, 'з', owlAt.x + 16 + t * 26, owlAt.y - 30 - t * 40, 12 + t * 10, '#dfe6ff', 'center', 'bold', false);
      }
      c.globalAlpha = 1;
    }
  }

  function drawWaveRings(c, world) {
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < world.lit.length; i++) {
      var l = world.lit[i];
      var t = (world.frame - l.frame) / WAVE_FRAMES;
      if (t >= 1.25 || t < 0) continue;
      var r = WAVE_R * easeOut(t), a = 1 - t / 1.25;
      c.strokeStyle = 'rgba(255,205,120,' + (0.45 * a) + ')';
      c.lineWidth = 14 * a + 2;
      c.beginPath(); circle(c, l.x, l.y, r); c.stroke();
      c.strokeStyle = 'rgba(255,250,220,' + (0.75 * a) + ')';
      c.lineWidth = 2;
      c.beginPath(); circle(c, l.x, l.y, Math.max(0, r - 5)); c.stroke();
    }
    if (world.finished && world.finish) {
      var ft = (world.frame - world.finishFrame) / 70;
      if (ft < 1.25) {
        var fr = 1400 * easeOut(ft), fa = 1 - ft / 1.25;
        c.strokeStyle = 'rgba(255,220,140,' + (0.5 * fa) + ')';
        c.lineWidth = 18 * fa + 2;
        c.beginPath(); circle(c, (world.finish.tx + 0.5) * T, (world.finish.ty - 1) * T, fr); c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  function colorCircles(world, v) {
    var out = [], i;
    for (i = 0; i < world.lit.length; i++) {
      var l = world.lit[i];
      var r = WAVE_R * easeOut((world.frame - l.frame) / WAVE_FRAMES);
      if (r < 2) continue;
      out.push({ x: l.x - v.x, y: l.y - v.y, r: r, soft: Math.max(0, 1 - 80 / r), a: 1 });
    }
    var p = world.player;
    var hr = 60 + 14 * world.flames + (world.bigFlame ? 22 : 0);
    out.push({ x: p.x + p.w / 2 - v.x, y: p.y + 2 - v.y, r: hr, soft: 0.3, a: 0.85 });
    if (world.finished && world.finish) {
      var fr = 1400 * easeOut((world.frame - world.finishFrame) / 70);
      if (fr > 2) out.push({ x: (world.finish.tx + 0.5) * T - v.x, y: (world.finish.ty - 1) * T - v.y, r: fr, soft: Math.max(0, 1 - 140 / fr), a: 1 });
    }
    var vis = [];
    for (i = 0; i < out.length; i++) {
      var q = out[i];
      if (q.x + q.r > 0 && q.x - q.r < VW && q.y + q.r > 0 && q.y - q.r < VH) vis.push(q);
    }
    return vis;
  }
  function coversScreen(q) {
    var ri = q.r * q.soft;
    if (q.a < 1) return false;
    var dx = Math.max(q.x, VW - q.x), dy = Math.max(q.y, VH - q.y);
    return dx * dx + dy * dy <= ri * ri;
  }

  // Слой мира → экран: серым, потом цветом внутри кругов.
  function composite(circles) {
    var i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (i = 0; i < circles.length; i++) {
      if (coversScreen(circles[i])) {
        ctx.drawImage(layer, 0, 0);
        ctx.setTransform(RS, 0, 0, RS, 0, 0);
        return;
      }
    }
    if (grayMode === 'filter') {
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(layer, 0, 0);
      ctx.filter = 'none';
    } else if (grayMode === 'blend') {
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.globalCompositeOperation = 'source-over';
      gctx.clearRect(0, 0, grayC.width, grayC.height);
      gctx.drawImage(layer, 0, 0);
      gctx.globalCompositeOperation = 'saturation';
      gctx.fillStyle = '#808080';
      gctx.fillRect(0, 0, grayC.width, grayC.height);
      gctx.globalCompositeOperation = 'destination-in';
      gctx.drawImage(layer, 0, 0);
      gctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(grayC, 0, 0);
    } else {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(layer, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (circles.length) {
      // второй проход: цветной слой, вырезанный мягкими кругами
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(0, 0, tmp.width, tmp.height);
      tctx.setTransform(RS, 0, 0, RS, 0, 0);
      for (i = 0; i < circles.length; i++) {
        var q = circles[i];
        var g = tctx.createRadialGradient(q.x, q.y, q.r * q.soft, q.x, q.y, q.r);
        g.addColorStop(0, 'rgba(0,0,0,' + q.a + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        tctx.fillStyle = g;
        tctx.beginPath(); circle(tctx, q.x, q.y, q.r); tctx.fill();
      }
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.drawImage(layer, 0, 0);
      tctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tmp, 0, 0);
    }
    ctx.setTransform(RS, 0, 0, RS, 0, 0);
  }

  // Темнота на тёмном участке: дыры света у героя и у фонарей.
  function drawDarkness(world, v) {
    var zones = (world.level && world.level.dark) || [];
    for (var z = 0; z < zones.length; z++) {
      var x0 = zones[z].from * T - v.x, x1 = (zones[z].to + 1) * T - v.x;
      if (x1 + 3 * T < 0 || x0 - 3 * T > VW) continue;
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.globalCompositeOperation = 'source-over';
      dctx.clearRect(0, 0, darkC.width, darkC.height);
      dctx.setTransform(RS, 0, 0, RS, 0, 0);
      var a0 = x0 - 2.5 * T, a1 = x1 + 2.5 * T, span = a1 - a0;
      var g = dctx.createLinearGradient(a0, 0, a1, 0);
      g.addColorStop(0, 'rgba(3,5,18,0)');
      g.addColorStop(clamp((3.5 * T) / span, 0, 0.5), 'rgba(3,5,18,0.8)');
      g.addColorStop(clamp(1 - (3.5 * T) / span, 0.5, 1), 'rgba(3,5,18,0.8)');
      g.addColorStop(1, 'rgba(3,5,18,0)');
      dctx.fillStyle = g;
      dctx.fillRect(0, 0, VW, VH);
      dctx.globalCompositeOperation = 'destination-out';
      var p = world.player;
      hole(dctx, p.x + p.w / 2 - v.x, p.y - v.y, 120 + 22 * world.flames + (world.bigFlame ? 30 : 0), 1);
      for (var i = 0; i < world.lit.length; i++) {
        var l = world.lit[i];
        var r = LAMP_LIGHT * easeOut((world.frame - l.frame) / 30);
        if (r > 4) hole(dctx, l.x - v.x, l.y - 30 - v.y, r, 1);
      }
      for (i = 0; i < world.lanterns.length; i++) {
        if (world.lanterns[i].lit) continue;
        var lp = lampPos(world.lanterns[i]);
        hole(dctx, lp.x - v.x, lp.y - v.y, 44, 0.6);
      }
      if (world.finished && world.finish) {
        var fr = 1400 * easeOut((world.frame - world.finishFrame) / 70);
        if (fr > 4) hole(dctx, (world.finish.tx + 0.5) * T - v.x, (world.finish.ty - 1) * T - v.y, fr, 1);
      }
      dctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(darkC, 0, 0);
      ctx.setTransform(RS, 0, 0, RS, 0, 0);
    }
  }
  function hole(c, x, y, r, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    g.addColorStop(0.55, 'rgba(0,0,0,' + (a * 0.85) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); circle(c, x, y, r); c.fill();
  }

  // ---------------------------------------------------------------- искорки, страница, светлячки

  function drawSparks(c, world, v) {
    var i, it, list = [];
    for (i = 0; i < world.items.length; i++) {
      it = world.items[i];
      if (it.taken || it.kind !== 'spark') continue;
      var x = it.tx * T + 24, y = it.ty * T + 24;
      if (x < v.x - 30 || x > v.x + VW + 30 || y < v.y - 30 || y > v.y + VH + 30) continue;
      var ph = it.tx * 1.7 + it.ty * 2.3;
      list.push(x, y + Math.sin(vt * 0.07 + ph) * 3, 0.82 + 0.25 * Math.sin(vt * 0.15 + ph * 3), ph);
    }
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < list.length; i += 4) glow(c, SPR.gold, list[i], list[i + 1], 22 * list[i + 2], 0.5);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#ffd95a';
    for (i = 0; i < list.length; i += 4) star(c, list[i], list[i + 1], 9.5 * list[i + 2], vt * 0.02 + list[i + 3]);
    c.fillStyle = '#fffbea';
    c.beginPath();
    for (i = 0; i < list.length; i += 4) circle(c, list[i], list[i + 1], 2.4 * list[i + 2]);
    c.fill();
  }

  function drawPageIcon(c, x, y, s, rot) {
    c.save();
    c.translate(x, y);
    c.rotate(rot || 0);
    c.scale(s, s);
    c.fillStyle = '#fff3d6';
    c.strokeStyle = '#c9a26a';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(-12, -15); c.lineTo(6, -15); c.lineTo(12, -9); c.lineTo(12, 15); c.lineTo(-12, 15); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#e6cf9e';
    c.beginPath(); c.moveTo(6, -15); c.lineTo(6, -9); c.lineTo(12, -9); c.closePath(); c.fill();
    c.strokeStyle = '#b08d5a';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-8, -8); c.lineTo(4, -8);
    c.moveTo(-8, -3); c.lineTo(8, -3);
    c.moveTo(-8, 2); c.lineTo(6, 2);
    c.moveTo(-8, 7); c.lineTo(1, 7);
    c.stroke();
    c.fillStyle = '#e0304a';
    c.beginPath(); circle(c, 6, 9.5, 3.6); c.fill();
    c.restore();
  }
  function drawPage(c, world, v) {
    var pg = world.page;
    if (!pg || pg.taken) return;
    var x = pg.tx * T + 24, y = pg.ty * T + 24 + Math.sin(vt * 0.05) * 4;
    if (x < v.x - 60 || x > v.x + VW + 60) return;
    c.globalCompositeOperation = 'lighter';
    glow(c, SPR.gold, x, y, 46 + 6 * Math.sin(vt * 0.08), 0.55);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    drawPageIcon(c, x, y, 1, Math.sin(vt * 0.03) * 0.14);
  }

  function drawFireflies(c, v) {
    var fl = DECO.flies, i, f, pts = [];
    for (i = 0; i < fl.length; i++) {
      f = fl[i];
      var x = f.x + Math.sin(vt * f.fx + f.p1) * f.ax, y = f.y + Math.cos(vt * f.fy + f.p2) * f.ay;
      if (x < v.x - 30 || x > v.x + VW + 30 || y < v.y - 30 || y > v.y + VH + 30) continue;
      var b = Math.sin(vt * f.bf + f.p3);
      pts.push(x, y, b > 0 ? 0.2 + 0.8 * b * b : 0.12, f.s);
    }
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < pts.length; i += 4) glow(c, SPR.fly, pts[i], pts[i + 1], 15 * pts[i + 3], pts[i + 2] * 0.8);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#f2ffc4';
    for (i = 0; i < pts.length; i += 4) {
      c.globalAlpha = pts[i + 2];
      c.beginPath(); circle(c, pts[i], pts[i + 1], 1.7 * pts[i + 3]); c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawParts(c, front) {
    var i, q, t, a;
    if (!front) {
      for (i = 0; i < parts.length; i++) {
        q = parts[i];
        t = q.life / q.max; a = 1 - t;
        if (q.k === 'dust') {
          c.globalAlpha = a * 0.55;
          c.fillStyle = '#cfc4b2';
          c.beginPath(); circle(c, q.x, q.y, q.s * (0.6 + t * 0.9)); c.fill();
        } else if (q.k === 'wisp') {
          c.globalAlpha = a * 0.5;
          c.fillStyle = '#2a1a4a';
          c.beginPath(); circle(c, q.x, q.y, q.s * (0.5 + t)); c.fill();
        }
      }
      c.globalAlpha = 1;
      return;
    }
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < parts.length; i++) {
      q = parts[i];
      t = q.life / q.max; a = 1 - t;
      if (q.k === 'glint') {
        var spr = q.c === 'white' ? SPR.white : (q.c === 'warm' ? SPR.warm : SPR.gold);
        glow(c, spr, q.x, q.y, q.s * 4, a * 0.7);
      } else if (q.k === 'ring') {
        c.globalAlpha = a * 0.8;
        c.strokeStyle = q.c === 'white' ? '#ffffff' : '#ffd97a';
        c.lineWidth = 2.5 * a + 0.5;
        c.beginPath(); circle(c, q.x, q.y, q.r0 + (q.r1 - q.r0) * easeOut(t)); c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
    for (i = 0; i < parts.length; i++) {
      q = parts[i];
      t = q.life / q.max; a = 1 - t;
      if (q.k === 'glint') {
        c.globalAlpha = a;
        c.fillStyle = q.c === 'warm' ? '#ffb347' : '#fff6d0';
        c.beginPath(); circle(c, q.x, q.y, q.s * 0.6); c.fill();
      } else if (q.k === 'conf') {
        c.globalAlpha = Math.min(1, a * 2);
        c.fillStyle = q.c;
        c.save(); c.translate(q.x, q.y); c.rotate(q.rot); c.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2); c.restore();
      }
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- огонёк

  function flamePath(c, x, y, h, lean, ph) {
    var w = h * 0.42;
    var sway = Math.sin(ph) * h * 0.08 + Math.sin(ph * 2.3 + 1) * h * 0.04 + lean;
    var tipX = x + sway, tipY = y - h;
    c.beginPath();
    c.moveTo(tipX, tipY);
    c.bezierCurveTo(x + w * 0.4 + sway * 0.5, y - h * 0.62, x + w * 1.05, y - h * 0.38, x + w, y - w * 0.95);
    c.arc(x, y - w * 0.95, w, 0, Math.PI, false);
    c.bezierCurveTo(x - w * 1.05, y - h * 0.38, x - w * 0.4 + sway * 0.5, y - h * 0.62, tipX, tipY);
    c.closePath();
  }
  function drawFlame(c, x, y, h, lean, ph, big) {
    if (!(h > 0)) return;
    flamePath(c, x, y, h, lean, ph);
    c.fillStyle = big ? '#ffb347' : '#ff6a1c';
    c.fill();
    flamePath(c, x, y, h * 0.72, lean * 0.8, ph + 0.7);
    c.fillStyle = big ? '#ffe68f' : '#ffb21f';
    c.fill();
    flamePath(c, x, y + 0.5, h * 0.42, lean * 0.6, ph + 1.3);
    c.fillStyle = big ? '#ffffff' : '#fff2bd';
    c.fill();
  }
  R.drawFlame = drawFlame;

  // ---------------------------------------------------------------- Фитиль

  function drawScarfTail(c, bx, by, f, sx, sy, bob, speed, airborne) {
    var ax = bx - f * 7 * sx, ay = by - (20 + bob) * sy;
    var n = 7, seg = 4.4 + Math.min(1.8, speed * 0.3);
    var base = Math.atan2(hero.sdy, hero.sdx);
    var amp = 0.1 + Math.min(1, speed / 6) * 0.24 + (airborne ? 0.12 : 0);
    var pts = [ax, ay], x = ax, y = ay, i;
    for (i = 1; i <= n; i++) {
      var a = base + Math.sin(vt * 0.32 - i * 0.75) * amp * (i / n + 0.3);
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
      pts.push(x, y);
    }
    var L = [], Rr = [];
    for (i = 0; i <= n; i++) {
      var i0 = Math.max(0, i - 1), i1 = Math.min(n, i + 1);
      var dx = pts[i1 * 2] - pts[i0 * 2], dy = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      var ln = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / ln, ny = dx / ln, w = 3.6 - 1.7 * (i / n);
      L.push(pts[i * 2] + nx * w, pts[i * 2 + 1] + ny * w);
      Rr.push(pts[i * 2] - nx * w, pts[i * 2 + 1] - ny * w);
    }
    c.fillStyle = '#e3263a';
    c.beginPath();
    c.moveTo(L[0], L[1]);
    for (i = 1; i <= n; i++) c.lineTo(L[i * 2], L[i * 2 + 1]);
    for (i = n; i >= 0; i--) c.lineTo(Rr[i * 2], Rr[i * 2 + 1]);
    c.closePath();
    c.fill();
    c.strokeStyle = '#a8172a';
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (i = 1; i <= n; i++) c.lineTo(pts[i * 2], pts[i * 2 + 1]);
    c.stroke();
    var ex = pts[n * 2], ey = pts[n * 2 + 1];
    c.strokeStyle = '#ffd35a';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(ex, ey); c.lineTo(ex + Math.cos(base + 0.4) * 4, ey + Math.sin(base + 0.4) * 4);
    c.moveTo(ex, ey); c.lineTo(ex + Math.cos(base - 0.4) * 4, ey + Math.sin(base - 0.4) * 4);
    c.stroke();
  }

  function drawHero(c, world) {
    var p = world.player, P = RC.P;
    var f = p.facing || 1;
    var bx = p.x + p.w / 2, by = p.y + p.h;
    var sx = 1, sy = 1, k;
    var speed = Math.abs(p.vx);
    if (p.onGround && p.landT < 10) {
      k = clamp(p.landImpact / 12, 0.25, 1) * (1 - p.landT / 10);     // приседание при приземлении
      sy = 1 - 0.3 * k; sx = 1 + 0.24 * k;
    } else if (!p.onGround) {
      if (p.vy < 0) { k = clamp(-p.vy / 12, 0, 1); sy = 1 + 0.14 * k; sx = 1 - 0.1 * k; }   // вытягивание в прыжке
      else { k = clamp(p.vy / 13, 0, 1); sy = 1 + 0.06 * k; sx = 1 - 0.05 * k; }
    } else if (speed < 0.3) {
      sy = 1 + 0.018 * Math.sin(vt * 0.07); sx = 1 - 0.01 * Math.sin(vt * 0.07);          // дышит
    }
    var moving = p.onGround && speed > 0.3;
    var bob = moving ? Math.abs(Math.sin(hero.walk)) * 2.2 : 0;
    var lean = (p.onGround ? 1 : 0.5) * clamp(p.vx / P.runMax, -1, 1) * 0.1;
    var blink = world.invuln > 0 && !world.finished && ((world.frame >> 2) & 1);
    var hurtFace = world.lastHurtFrame >= 0 && world.frame - world.lastHurtFrame < 24;
    var alpha = blink ? 0.35 : 1;
    if (world.finished) alpha *= 1 - clamp((world.frame - world.finishFrame - 20) / 40, 0, 1);
    if (alpha <= 0.01) return;

    if (p.onGround) {
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.beginPath(); oval(c, bx, by, 14 * sx, 3.2, 0); c.fill();
    }
    c.save();
    c.globalAlpha = alpha;
    drawScarfTail(c, bx, by, f, sx, sy, bob, speed, !p.onGround);
    c.translate(bx, by);
    c.rotate(lean);
    c.scale(f * sx, sy);
    c.translate(0, -bob);

    // ноги-сапожки
    c.fillStyle = '#3b2c52';
    c.beginPath();
    if (!p.onGround) {
      rr(c, 0, -11, 10, 7, 3);
      rr(c, -10, -7, 9, 7, 3);
    } else if (moving) {
      var ph = hero.walk, a1 = Math.sin(ph) * 5, la = Math.max(0, Math.cos(ph)) * 3, lb = Math.max(0, -Math.cos(ph)) * 3;
      rr(c, -5 + a1, -7 - la, 10, 7, 3);
      rr(c, -5 - a1, -7 - lb, 10, 7, 3);
    } else {
      rr(c, -10, -7, 9, 7, 3);
      rr(c, 1, -7, 10, 7, 3);
    }
    c.fill();
    var swing = moving ? Math.sin(hero.walk) * 4 : 0;
    // дальняя рука
    c.fillStyle = '#c65712';
    c.beginPath(); oval(c, -7 - swing, -14, 4, 5.5, 0); c.fill();
    // курточка
    c.fillStyle = '#ff8a2a';
    c.beginPath(); rr(c, -10.5, -22, 21, 16, 7); c.fill();
    c.fillStyle = '#e36d14';
    c.beginPath(); rr(c, -10.5, -10, 21, 4.5, 2.5); c.fill();
    c.fillStyle = '#5a3322';
    c.fillRect(-10.5, -12.5, 21, 3);
    c.fillStyle = '#ffd35a';
    c.fillRect(2, -13.2, 4.2, 4.4);
    // ближняя рука
    c.fillStyle = '#ff9a3c';
    c.beginPath();
    if (!p.onGround && p.vy < 0) oval(c, 8.5, -24, 3.8, 5.8, -0.5);
    else oval(c, 7 + swing, -14, 4, 5.5, 0);
    c.fill();
    c.fillStyle = '#ffd7b0';
    c.beginPath();
    if (!p.onGround && p.vy < 0) circle(c, 10.5, -29, 2.8); else circle(c, 7.5 + swing * 1.1, -9, 2.8);
    c.fill();

    // шлем — круглый, великоватый, забрало поднято, лицо открыто
    var hy = -34, hr = 13.5;
    if (!GC.helmet) {
      GC.helmet = c.createLinearGradient(-10, hy - 12, 8, hy + 12);
      GC.helmet.addColorStop(0, '#eef4fc');
      GC.helmet.addColorStop(0.5, '#b9c6da');
      GC.helmet.addColorStop(1, '#7f8ca8');
    }
    c.fillStyle = GC.helmet;
    c.beginPath(); circle(c, 0, hy, hr); c.fill();
    c.strokeStyle = '#56627e';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#ffd7b0';
    c.beginPath(); oval(c, 5, hy + 2, 7.6, 8.4, 0); c.fill();
    c.strokeStyle = '#dde5f1';
    c.lineWidth = 3.2;
    c.beginPath(); c.arc(5, hy + 2, 10, -2.55, -0.45); c.stroke();
    c.fillStyle = '#6f7c98';
    c.beginPath(); circle(c, -5, hy + 1, 1.8); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.65)';
    c.lineWidth = 2.4;
    c.beginPath(); c.arc(0, hy, hr - 3.2, -2.75, -1.95); c.stroke();
    // лицо
    var ex = 3.6, ey = hy + 1;
    c.strokeStyle = '#2a2238';
    c.fillStyle = '#2a2238';
    c.lineWidth = 1.5;
    var closed = mod(vt, 230) < 7;
    if (hurtFace) {
      c.beginPath();
      c.moveTo(ex - 1.6, ey - 2); c.lineTo(ex + 1.2, ey); c.lineTo(ex - 1.6, ey + 2);
      c.moveTo(ex + 7.6, ey - 2); c.lineTo(ex + 4.8, ey); c.lineTo(ex + 7.6, ey + 2);
      c.stroke();
    } else if (closed || world.finished) {
      c.beginPath();
      c.moveTo(ex - 1.6, ey + 0.4); c.quadraticCurveTo(ex, ey - 1.4, ex + 1.6, ey + 0.4);
      c.moveTo(ex + 4.6, ey + 0.4); c.quadraticCurveTo(ex + 6.2, ey - 1.4, ex + 7.8, ey + 0.4);
      c.stroke();
    } else {
      c.beginPath(); oval(c, ex, ey, 1.5, 2.3, 0); oval(c, ex + 6.2, ey, 1.5, 2.3, 0); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); circle(c, ex + 0.5, ey - 0.9, 0.6); circle(c, ex + 6.7, ey - 0.9, 0.6); c.fill();
    }
    c.fillStyle = 'rgba(255,110,110,0.45)';
    c.beginPath(); circle(c, ex + 7.4, ey + 4.2, 2); c.fill();
    c.strokeStyle = '#7a3a2a';
    c.lineWidth = 1.2;
    c.beginPath();
    if (!p.onGround && p.vy > 7) { oval(c, ex + 3.6, ey + 5.6, 1.4, 1.8, 0); }
    else { c.moveTo(ex + 1.8, ey + 5); c.quadraticCurveTo(ex + 3.6, ey + 7, ex + 5.4, ey + 5); }
    c.stroke();
    // шарф на шее
    c.fillStyle = '#e3263a';
    c.beginPath(); rr(c, -10, -23, 20, 6, 3); c.fill();
    c.fillStyle = '#a8172a';
    c.fillRect(-9, -19, 18, 1.4);
    c.fillStyle = '#e3263a';
    c.beginPath(); circle(c, -8.5, -20.5, 3.2); c.fill();
    // подсвечник на макушке
    c.fillStyle = '#d9a441';
    c.beginPath(); rr(c, -4.5, hy - hr - 2.5, 9, 4, 1.5); c.fill();

    // огонёк = здоровье: три размера, большой огонь — ярче и белее
    var fl = world.bigFlame ? 25 : [0, 11, 15, 19][clamp(world.flames | 0, 0, 3)];
    if (hurtFace) fl *= 0.8 + 0.2 * Math.sin((world.frame - world.lastHurtFrame) * 0.8);
    var fh = fl * (1 + clamp(-p.vy, -10, 12) * 0.012);
    var fy0 = hy - hr - 2;
    c.globalCompositeOperation = 'lighter';
    glow(c, SPR.warm, 0, fy0 - fh * 0.4, 24 + fl * 1.7, 0.75 * alpha);
    if (world.bigFlame) glow(c, SPR.white, 0, fy0 - fh * 0.45, 20, 0.35 * alpha);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = alpha;
    drawFlame(c, 0, fy0, fh, -(p.vx * f) * 0.9, vt * 0.35, world.bigFlame);
    c.restore();
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- экран: виньетка, вспышка, HUD

  function drawScreenFx(c, world) {
    if (!GC.vig) {
      GC.vig = c.createRadialGradient(VW / 2, VH / 2, VH * 0.42, VW / 2, VH / 2, VW * 0.72);
      GC.vig.addColorStop(0, 'rgba(0,0,12,0)');
      GC.vig.addColorStop(1, 'rgba(0,0,14,0.5)');
    }
    c.fillStyle = GC.vig;
    c.fillRect(0, 0, VW, VH);
    if (world.hurtFlash > 0) {
      var a = world.hurtFlash / 18;
      c.fillStyle = 'rgba(255,60,50,' + (0.3 * a) + ')';
      c.fillRect(0, 0, VW, VH);
      if (world.hurtFlash > 14) { c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, 0, VW, VH); }
    }
    if (fade > 0) {
      c.fillStyle = 'rgba(3,5,16,' + clamp(fade, 0, 1) + ')';
      c.fillRect(0, 0, VW, VH);
    }
  }

  function drawHud(c, world, ui) {
    var i;
    var wide = world.bigFlame ? 30 : 0;
    c.fillStyle = 'rgba(8,12,34,0.55)';
    c.beginPath(); rr(c, 12, 10, 300 + wide, 50, 16); c.fill();
    c.strokeStyle = 'rgba(255,220,150,0.28)';
    c.lineWidth = 1.5;
    c.stroke();
    // три огонька
    for (i = 0; i < 3; i++) {
      var x = 38 + i * 30, y = 47;
      if (i < world.flames) {
        c.globalCompositeOperation = 'lighter';
        glow(c, SPR.warm, x, y - 9, 22, 0.55);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
        drawFlame(c, x, y, 23, 0, vt * 0.3 + i * 1.7, false);
      } else {
        flamePath(c, x, y, 17, 0, 0);
        c.fillStyle = 'rgba(150,160,195,0.35)';
        c.fill();
      }
    }
    if (world.bigFlame) {
      var bxx = 128;
      c.globalCompositeOperation = 'lighter';
      glow(c, SPR.gold, bxx, 36, 26, 0.6 + 0.2 * Math.sin(vt * 0.1));
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      drawFlame(c, bxx, 49, 28, 0, vt * 0.3, true);
    }
    // искорки
    var sx0 = 138 + wide;
    c.globalCompositeOperation = 'lighter';
    glow(c, SPR.gold, sx0, 35, 18, 0.55);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#ffd95a';
    star(c, sx0, 35, 11, vt * 0.02);
    text(c, '× ' + world.sparks, sx0 + 18, 36, 22, '#ffe9a8', 'left', 'bold', true);
    // страница письма
    var px0 = 280 + wide;
    c.globalAlpha = world.pageTaken ? 1 : 0.3;
    if (world.pageTaken) {
      c.globalCompositeOperation = 'lighter';
      glow(c, SPR.gold, px0, 35, 22, 0.5);
      c.globalCompositeOperation = 'source-over';
    }
    drawPageIcon(c, px0, 35, 0.78, -0.08);
    c.globalAlpha = 1;
    // справа: название, отметки
    text(c, world.name || '', VW - 18, 26, 15, 'rgba(215,225,255,0.55)', 'right', 'bold', false);
    var ry = 50;
    if (ui.recording) {
      c.fillStyle = (vt >> 4) & 1 ? '#ff3b4e' : '#a01626';
      c.beginPath(); circle(c, VW - 118, ry, 6); c.fill();
      text(c, 'ЗАПИСЬ', VW - 18, ry, 15, '#ffb3bb', 'right', 'bold', true);
      ry += 22;
    }
    if (ui.replaying) { text(c, '▶ ПОВТОР', VW - 18, ry, 15, '#b8e1ff', 'right', 'bold', true); ry += 22; }
    if (ui.invincible) { text(c, 'бессмертие', VW - 18, ry, 13, '#c8ffc8', 'right', 'bold', true); ry += 20; }
    if (ui.muted) text(c, 'звук выключен (M)', VW - 18, ry, 13, 'rgba(215,225,255,0.6)', 'right', 'normal', true);
  }

  function drawOverlay(c, world, ui) {
    var a;
    if (ui.screen === 'title') {
      c.fillStyle = 'rgba(4,7,24,0.5)';
      c.fillRect(0, 0, VW, VH);
      c.globalCompositeOperation = 'lighter';
      glow(c, SPR.warm, VW / 2, 150, 260, 0.22);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      text(c, 'Фитиль', VW / 2, 128, 78, '#ffcc66', 'center', 'bold', true);
      text(c, 'и правильный замок', VW / 2, 194, 36, '#ffe8b8', 'center', 'bold', true);
      text(c, 'Уровень 1 · Тропа светлячков · черновик', VW / 2, 240, 18, 'rgba(210,222,255,0.85)', 'center', 'normal', true);
      a = 0.55 + 0.45 * Math.sin(vt * 0.08);
      c.globalAlpha = a;
      text(c, 'Нажми, чтобы начать', VW / 2, 306, 30, '#ffffff', 'center', 'bold', true);
      c.globalAlpha = 1;
      drawFlame(c, VW / 2 - 175, 318, 24, 0, vt * 0.3, false);
      drawFlame(c, VW / 2 + 175, 318, 24, 0, vt * 0.3 + 2, false);
      c.fillStyle = 'rgba(8,12,34,0.62)';
      c.beginPath(); rr(c, VW / 2 - 330, 372, 660, 116, 18); c.fill();
      c.strokeStyle = 'rgba(255,220,150,0.25)';
      c.lineWidth = 1.5;
      c.stroke();
      text(c, '← →  или  A D  — идти, держи — бег', VW / 2, 400, 19, '#e8eeff', 'center', 'normal', false);
      text(c, 'Пробел  или  ↑  — прыжок (держи — выше)', VW / 2, 430, 19, '#e8eeff', 'center', 'normal', false);
      text(c, 'Esc — пауза        M — звук', VW / 2, 460, 17, 'rgba(232,238,255,0.75)', 'center', 'normal', false);
      return;
    }
    if (ui.screen === 'play' && ui.playT < 200 && !ui.paused) {
      a = clamp(Math.min(ui.playT / 25, (200 - ui.playT) / 40), 0, 1);
      c.globalAlpha = a;
      text(c, 'Светлячковый лес', VW / 2, 112, 18, 'rgba(210,222,255,0.9)', 'center', 'normal', true);
      text(c, 'Тропа светлячков', VW / 2, 146, 40, '#ffd27a', 'center', 'bold', true);
      c.globalAlpha = 1;
    }
    if (ui.paused && ui.screen !== 'title') {
      c.fillStyle = 'rgba(4,7,24,0.62)';
      c.fillRect(0, 0, VW, VH);
      text(c, 'Пауза', VW / 2, 220, 66, '#ffe0a0', 'center', 'bold', true);
      text(c, 'Esc — продолжить', VW / 2, 292, 24, '#ffffff', 'center', 'normal', true);
      text(c, 'M — звук: ' + (ui.muted ? 'выключен' : 'включён'), VW / 2, 330, 18, 'rgba(220,230,255,0.8)', 'center', 'normal', true);
      return;
    }
    if (ui.screen === 'finish') {
      a = clamp((ui.finishT - 40) / 40, 0, 1);
      if (a <= 0) return;
      c.globalAlpha = a;
      c.fillStyle = 'rgba(4,7,24,0.5)';
      c.fillRect(0, 0, VW, VH);
      c.fillStyle = 'rgba(14,20,54,0.88)';
      c.beginPath(); rr(c, VW / 2 - 290, 100, 580, 330, 24); c.fill();
      c.strokeStyle = 'rgba(255,210,120,0.6)';
      c.lineWidth = 2;
      c.stroke();
      text(c, 'Сонный замок впереди!', VW / 2, 160, 40, '#ffd27a', 'center', 'bold', true);
      text(c, 'Время: ' + mmss(world.finishFrame), VW / 2, 228, 26, '#ffffff', 'center', 'normal', true);
      text(c, 'Искорки: ' + world.sparks + ' из ' + sparksTotal, VW / 2, 272, 26, '#ffe9a8', 'center', 'normal', true);
      text(c, 'Страница письма: ' + (world.pageTaken ? 'да' : 'нет'), VW / 2, 316, 26, world.pageTaken ? '#c8ffd0' : '#d0d6ea', 'center', 'normal', true);
      c.globalAlpha = a * (0.55 + 0.45 * Math.sin(vt * 0.08));
      text(c, 'Пробел — пройти ещё раз', VW / 2, 384, 20, '#ffffff', 'center', 'normal', true);
      c.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- кадр целиком

  R.draw = function (world, ui) {
    if (!ctx || !world) return;
    if (world !== worldRef) R.reset(world);
    ui = ui || {};
    var sx = cam.x, sy = cam.y;
    if (cam.shake > 0) { sx += (prng.next() - 0.5) * cam.shake; sy += (prng.next() - 0.5) * cam.shake; }
    sx = Math.round(sx * RS) / RS;
    sy = Math.round(sy * RS) / RS;
    var v = { x: sx, y: sy };

    ctx.setTransform(RS, 0, 0, RS, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawSky(ctx, v);

    // слой мира (в цвете)
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(RS, 0, 0, RS, 0, 0);
    drawFar(lctx, v);
    drawMist(lctx, v);
    drawNear(lctx, v);
    lctx.translate(-v.x, -v.y);
    drawTerrain(lctx, world, v);
    drawLanternPosts(lctx, world, v);
    drawCastle(lctx, world, v);

    composite(colorCircles(world, v));

    ctx.save();
    ctx.translate(-v.x, -v.y);
    drawSpikes(ctx, world, v);
    drawEnemies(ctx, world, v);
    ctx.restore();

    drawDarkness(world, v);

    ctx.save();
    ctx.translate(-v.x, -v.y);
    drawLights(ctx, world, v);
    drawWaveRings(ctx, world);
    drawSparks(ctx, world, v);
    drawPage(ctx, world, v);
    drawTenEyes(ctx, world, v);
    drawFireflies(ctx, v);
    drawParts(ctx, false);
    drawHero(ctx, world);
    drawParts(ctx, true);
    if (RC.debug && RC.debug.drawWorld) RC.debug.drawWorld(ctx, world, v);
    ctx.restore();

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawScreenFx(ctx, world);
    if (ui.screen !== 'title') drawHud(ctx, world, ui);
    drawOverlay(ctx, world, ui);
  };
})(RC);
