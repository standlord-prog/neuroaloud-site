var RC = (typeof RC !== 'undefined') ? RC : {};
// Мир уровня: герой, враги, искорки, фонари-привалы, страница письма, финиш, здоровье.
// RC.newWorld(level) создаёт мир из текстовой карты, RC.stepWorld(world, bits) — один кадр.
// События кадра — в world.events: 'jump','land','spark','stomp','hurt','lantern','page','respawn','finish'.

(function (RC) {
  'use strict';

  // Настройки мира (можно подстраивать, как RC.P у героя).
  RC.WP = {
    flames: 3,            // огоньков здоровья
    invuln: 60,           // кадров мигания-неуязвимости после удара
    knockX: 3.5,          // отбрасывание при ударе
    knockY: 5.5,
    bigFlameEvery: 100,   // каждые 100 искорок — большой огонь (выдерживает один удар)
    shishSpeed: 0.8,      // Шишколап: скорость ходьбы
    shishW: 36, shishH: 32,
    squashT: 40,          // сколько кадров лежит сбитый, потом обиженно уходит
    leaveT: 90,           // сколько кадров уходит, растворяясь
    leaveSpeed: 1.6,
    tenW: 32, tenH: 40,   // Тенюшка
    tenRadius: 4,         // от зажжённого фонаря ближе 4 плиток — уходит
    tenFleeSpeed: 2.2,
    tenFade: 1 / 60,
    stompSlack: 12        // «сверху» = низ героя в прошлом кадре не ниже верха врага + 12 px
  };

  var T = RC.TILE;

  // Прямоугольники касания для предметов (в пикселях мира).
  RC.itemBox = function (kind, tx, ty) {
    if (kind === 'spark') return { x: tx * T + 10, y: ty * T + 10, w: 28, h: 28 };
    if (kind === 'page') return { x: tx * T + 8, y: ty * T + 8, w: 32, h: 32 };
    if (kind === 'lantern') return { x: tx * T + 8, y: ty * T - 24, w: 32, h: T + 24 };
    if (kind === 'finish') return { x: tx * T + 4, y: (ty - 2) * T, w: T - 8, h: 3 * T };
    if (kind === 'spike') return { x: tx * T + 6, y: ty * T + 22, w: T - 12, h: T - 22 };
    return { x: tx * T, y: ty * T, w: T, h: T };
  };

  function hits(a, b) { return RC.overlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h); }

  function newShishkolap(tx, ty) {
    var W = RC.WP;
    return {
      kind: 'S', tx: tx, ty: ty,
      x: tx * T + (T - W.shishW) / 2, y: (ty + 1) * T - W.shishH, w: W.shishW, h: W.shishH,
      vx: -W.shishSpeed, vy: 0, onGround: true, hitWall: 0, hitHead: false,
      facing: -1, state: 'walk', t: 0, alpha: 1
    };
  }

  function newTenyushka(tx, ty) {
    var W = RC.WP;
    return {
      kind: 'T', tx: tx, ty: ty,
      x: tx * T + (T - W.tenW) / 2, y: (ty + 1) * T - W.tenH - 2, w: W.tenW, h: W.tenH,
      vx: 0, vy: 0, facing: -1, state: 'idle', t: 0, alpha: 1, fleeDir: 0
    };
  }

  // Опасен ли враг при касании.
  RC.enemyHarmful = function (e) {
    return (e.kind === 'S' && e.state === 'walk') || (e.kind === 'T' && e.state === 'idle');
  };

  // Разбор карты: плитки → сетка, буквы → предметы, враги, фонари.
  RC.parseLevel = function (level) {
    var lines = level.lines;
    var grid = RC.makeGrid(lines);
    var out = { grid: grid, start: null, lanterns: [], items: [], enemies: [], page: null, finish: null };
    for (var ty = 0; ty < grid.h; ty++) {
      for (var tx = 0; tx < grid.w; tx++) {
        var c = lines[ty].charAt(tx);
        if (c === 'P') out.start = { tx: tx, ty: ty };
        else if (c === 'L') out.lanterns.push({ index: out.lanterns.length, tx: tx, ty: ty, lit: false, litFrame: -1, box: RC.itemBox('lantern', tx, ty) });
        else if (c === '*') out.items.push({ kind: 'spark', tx: tx, ty: ty, taken: false, box: RC.itemBox('spark', tx, ty) });
        else if (c === 'W') { out.page = { kind: 'page', tx: tx, ty: ty, taken: false, box: RC.itemBox('page', tx, ty) }; out.items.push(out.page); }
        else if (c === 'F') out.finish = { tx: tx, ty: ty, box: RC.itemBox('finish', tx, ty) };
        else if (c === 'S') out.enemies.push(newShishkolap(tx, ty));
        else if (c === 'T') out.enemies.push(newTenyushka(tx, ty));
      }
    }
    if (!out.start) throw new Error('на карте нет старта P');
    return out;
  };

  // Поставить героя в клетку (tx, ty) — ногами на её нижнюю грань.
  function placeAt(p, tx, ty) {
    var fresh = RC.newPlayer(tx * T + (T - RC.P.w) / 2, (ty + 1) * T - RC.P.h);
    for (var k in fresh) p[k] = fresh[k];
    p.onGround = true;
    p.coyoteT = RC.P.coyote;
    p.landT = 999;
    return p;
  }

  RC.newWorld = function (level) {
    var L = RC.parseLevel(level);
    var p = placeAt({}, L.start.tx, L.start.ty);
    var itemAt = {};
    for (var i = 0; i < L.items.length; i++) itemAt[L.items[i].ty * L.grid.w + L.items[i].tx] = L.items[i];
    return {
      level: level,
      name: level.name,
      grid: L.grid,
      frame: 0,
      player: p,
      start: L.start,
      flames: RC.WP.flames,
      sparks: 0,
      bigFlame: false,
      invuln: 0,
      invincible: false,       // режим проверки: удары не действуют
      lanterns: L.lanterns,
      lit: [],                 // зажжённые фонари: { index, tx, ty, x, y, frame }
      items: L.items,          // искорки и страница: { kind, tx, ty, taken, box }
      itemAt: itemAt,
      page: L.page,
      pageTaken: false,
      finish: L.finish,
      finished: false,
      finishFrame: -1,
      enemies: L.enemies,
      checkpoint: { tx: L.start.tx, ty: L.start.ty, lantern: -1 },
      events: [],
      hurtFlash: 0,            // кадров вспышки экрана после удара (для рисования)
      lastHurtFrame: -1,
      lastRespawnFrame: -1,
      stats: { hurts: 0, respawns: 0, stomps: 0, jumps: 0 }
    };
  };

  function respawn(world) {
    var cp = world.checkpoint;
    placeAt(world.player, cp.tx, cp.ty);
    if (world.flames <= 0) world.flames = RC.WP.flames;
    world.invuln = RC.WP.invuln;
    world.events.push('respawn');
    world.stats.respawns++;
    world.lastRespawnFrame = world.frame;
  }

  // Удар по герою. fromX — откуда пришёл удар (для отбрасывания).
  function hurt(world, fromX) {
    if (world.invuln > 0 || world.invincible) return false;
    var p = world.player, W = RC.WP;
    world.events.push('hurt');
    world.stats.hurts++;
    world.hurtFlash = 18;
    world.lastHurtFrame = world.frame;
    if (world.bigFlame) {
      world.bigFlame = false;
    } else {
      world.flames--;
      if (world.flames <= 0) { respawn(world); return true; }
    }
    world.invuln = W.invuln;
    var cx = p.x + p.w / 2;
    var dir = cx < fromX ? -1 : (cx > fromX ? 1 : -p.facing);
    p.vx = dir * W.knockX;
    p.vy = -W.knockY;
    p.onGround = false;
    p.jumping = false;
    p.coyoteT = 0;
    p.runT = 0;
    return true;
  }
  RC.hurtPlayer = hurt;

  function fellIntoPit(world) {
    if (!world.invincible) {
      world.events.push('hurt');
      world.stats.hurts++;
      world.hurtFlash = 18;
      world.lastHurtFrame = world.frame;
      if (world.bigFlame) world.bigFlame = false; else world.flames--;
    }
    respawn(world);
  }

  function updateEnemy(world, e) {
    var W = RC.WP, grid = world.grid;
    e.t++;
    if (e.kind === 'S') {
      if (e.state === 'walk') {
        e.vy = Math.min(e.vy + RC.P.fallGravity, RC.P.maxFall);
        if (e.onGround) {
          var ahead = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
          if (!grid.standable(Math.floor(ahead / T), Math.floor((e.y + e.h + 1) / T))) e.vx = -e.vx;
        }
        RC.moveAndCollide(e, grid, 0);
        if (e.hitWall) e.vx = -e.hitWall * W.shishSpeed;
        if (e.vx !== 0) e.facing = e.vx > 0 ? 1 : -1;
      } else if (e.state === 'squashed') {
        if (e.t >= W.squashT) {
          e.state = 'leave'; e.t = 0;
          var p = world.player;
          e.facing = (e.x + e.w / 2) >= (p.x + p.w / 2) ? 1 : -1;
          e.vx = e.facing * W.leaveSpeed;
        }
      } else if (e.state === 'leave') {
        e.vy = Math.min(e.vy + RC.P.fallGravity, RC.P.maxFall);
        RC.moveAndCollide(e, grid, 0);
        if (e.hitWall) { e.facing = -e.hitWall; e.vx = e.facing * W.leaveSpeed; }
        e.alpha = Math.max(0, 1 - e.t / W.leaveT);
        if (e.t >= W.leaveT || e.y > grid.h * T) { e.state = 'gone'; e.alpha = 0; }
      }
    } else if (e.kind === 'T') {
      if (e.state === 'idle') {
        // круг света радиусом 4 плитки от центра фонаря задевает тело Тенюшки → она уходит
        var r = W.tenRadius * T;
        for (var i = 0; i < world.lit.length; i++) {
          var l = world.lit[i];
          var nx = RC.clamp(l.x, e.x, e.x + e.w), ny = RC.clamp(l.y, e.y, e.y + e.h);
          var dx = nx - l.x, dy = ny - l.y;
          if (dx * dx + dy * dy <= r * r) {
            e.state = 'flee'; e.t = 0; e.fleeDir = (e.x + e.w / 2) >= l.x ? 1 : -1; e.facing = e.fleeDir;
            break;
          }
        }
      } else if (e.state === 'flee') {
        e.x += e.fleeDir * W.tenFleeSpeed;
        e.y -= 0.4;
        e.alpha = Math.max(0, e.alpha - W.tenFade);
        if (e.alpha <= 0) e.state = 'gone';
      }
    }
  }

  function squash(world, e, bits) {
    var p = world.player;
    e.state = 'squashed'; e.t = 0; e.vx = 0;
    world.events.push('stomp');
    world.stats.stomps++;
    var held = (bits & RC.KEY.JUMP) !== 0;
    p.vy = held ? -RC.P.jumpV : -RC.P.bounceV;
    p.jumping = held;
    p.onGround = false;
    p.coyoteT = 0;
    p.bufferT = 0;
  }

  RC.stepWorld = function (world, bits) {
    world.events = [];
    world.frame++;
    if (world.hurtFlash > 0) world.hurtFlash--;
    if (world.finished) return world;

    var p = world.player, grid = world.grid, i, e;
    if (world.invuln > 0) world.invuln--;

    var prevBottom = p.y + p.h;
    RC.updatePlayer(p, bits, grid);
    for (i = 0; i < p.events.length; i++) {
      world.events.push(p.events[i]);
      if (p.events[i] === 'jump') world.stats.jumps++;
    }

    for (i = 0; i < world.enemies.length; i++) updateEnemy(world, world.enemies[i]);

    // враги: сверху — сбить (только Шишколапа), иначе — удар
    var movingDown = p.y + p.h > prevBottom;
    for (i = 0; i < world.enemies.length; i++) {
      e = world.enemies[i];
      if (!RC.enemyHarmful(e) || !hits(p, e)) continue;
      if (e.kind === 'S' && movingDown && prevBottom <= e.y + RC.WP.stompSlack) squash(world, e, bits);
      else hurt(world, e.x + e.w / 2);
    }

    // колючки
    var tx0 = Math.floor(p.x / T), tx1 = Math.floor((p.x + p.w - 1e-6) / T);
    var ty0 = Math.floor(p.y / T), ty1 = Math.floor((p.y + p.h - 1e-6) / T);
    var tx, ty;
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (grid.spike(tx, ty) && hits(p, RC.itemBox('spike', tx, ty))) hurt(world, (tx + 0.5) * T);
      }
    }

    // искорки и страница письма
    p = world.player;
    tx0 = Math.floor(p.x / T); tx1 = Math.floor((p.x + p.w - 1e-6) / T);
    ty0 = Math.floor(p.y / T); ty1 = Math.floor((p.y + p.h - 1e-6) / T);
    for (ty = ty0; ty <= ty1; ty++) {
      for (tx = tx0; tx <= tx1; tx++) {
        if (tx < 0 || tx >= grid.w) continue;
        var it = world.itemAt[ty * grid.w + tx];
        if (!it || it.taken || !hits(p, it.box)) continue;
        it.taken = true;
        if (it.kind === 'spark') {
          world.sparks++;
          world.events.push('spark');
          if (world.sparks % RC.WP.bigFlameEvery === 0) world.bigFlame = true;
        } else if (it.kind === 'page') {
          world.pageTaken = true;
          world.events.push('page');
        }
      }
    }

    // фонари-привалы: зажечь касанием, запомнить как точку возврата, восстановить огоньки
    for (i = 0; i < world.lanterns.length; i++) {
      var lan = world.lanterns[i];
      if (lan.lit || !hits(p, lan.box)) continue;
      lan.lit = true;
      lan.litFrame = world.frame;
      world.lit.push({ index: i, tx: lan.tx, ty: lan.ty, x: (lan.tx + 0.5) * T, y: (lan.ty + 0.5) * T, frame: world.frame });
      world.checkpoint = { tx: lan.tx, ty: lan.ty, lantern: i };
      world.flames = RC.WP.flames;
      world.events.push('lantern');
    }

    // финиш
    if (world.finish && hits(p, world.finish.box)) {
      world.finished = true;
      world.finishFrame = world.frame;
      p.vx = 0;
      world.events.push('finish');
      return world;
    }

    // упал в пропасть
    if (p.y > (grid.h + 1) * T) fellIntoPit(world);

    return world;
  };

  // Для режима проверки: перенести героя к фонарю номер i (и зажечь его).
  RC.warpToLantern = function (world, i) {
    var lan = world.lanterns[i];
    if (!lan) return false;
    placeAt(world.player, lan.tx, lan.ty);
    return true;
  };
})(RC);
