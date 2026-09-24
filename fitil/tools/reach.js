var RC = (typeof RC !== 'undefined') ? RC : {};
// Проверка достижимости: «до каждой платформы и каждого предмета можно допрыгнуть».
//
// Метод: поиск в ширину по «стоянкам». Стоянка — плитка, на верхней грани которой можно стоять
// (земля или ветка, над ней пусто и не колючки). Соседние стоянки в одной строке — «отрезок»:
// по нему можно просто пройти. Из каждого отрезка прогоняем НАСТОЯЩИЙ RC.updatePlayer:
//   • с места: влево / вправо / вверх, прыжок держится 1…18 кадров;
//   • с места с задержкой направления (сначала вверх, потом вбок);
//   • с разбега: бег от дальнего конца отрезка, прыжки в разных точках разбега (1…18 кадров),
//     включая прыжки в первые кадры после края («кадры после края»);
//   • шаг с края: медленно и с разбега.
// Где герой приземлился — та стоянка (и весь её отрезок) достижима. По пути отмечаем предметы,
// которых коснулось тело героя. Враги не учитываются (только форма уровня).
//
// RC.checkReach(level) → { ok, unreachable: [{tx, ty, kind}], reachedFinish, reachedPage, stats }
//   kind: 'stand' (платформа), 'spark', 'lantern', 'page', 'finish'.

(function (RC) {
  'use strict';

  var HOLDS = [];
  for (var hk = 1; hk <= 18; hk++) HOLDS.push(hk);
  var DIR_DELAYS = [4, 8, 12, 16];
  var MAX_FRAMES = 240;
  var EPS = 1e-6;

  function copyPlayer(src) {
    var q = {};
    for (var k in src) q[k] = src[k];
    q.events = [];
    return q;
  }

  RC.checkReach = function (level) {
    var T = RC.TILE, P = RC.P, K = RC.KEY;
    var L = RC.parseLevel(level);
    var grid = L.grid, w = grid.w, h = grid.h;
    var stats = { segments: 0, stands: 0, sims: 0, frames: 0 };

    function isStand(tx, ty) {
      return tx >= 0 && tx < w && ty >= 1 && ty < h &&
        grid.standable(tx, ty) && !grid.solid(tx, ty - 1) && !grid.spike(tx, ty - 1);
    }

    // --- отрезки стоянок
    var segOf = new Int32Array(w * h).fill(-1);
    var segs = [];
    for (var ty = 1; ty < h; ty++) {
      var tx = 0;
      while (tx < w) {
        if (!isStand(tx, ty)) { tx++; continue; }
        var x0 = tx;
        while (tx < w && isStand(tx, ty)) { segOf[ty * w + tx] = segs.length; tx++; }
        segs.push({ id: segs.length, ty: ty, x0: x0, x1: tx - 1 });
        stats.stands += tx - x0;
      }
    }
    stats.segments = segs.length;

    // --- предметы, которых надо коснуться
    var items = [];
    var itemsAt = [];
    function addItem(kind, itx, ity) {
      var it = { kind: kind, tx: itx, ty: ity, box: RC.itemBox(kind, itx, ity), touched: false };
      items.push(it);
      var b = it.box;
      var a0 = Math.floor(b.x / T), a1 = Math.floor((b.x + b.w - EPS) / T);
      var c0 = Math.floor(b.y / T), c1 = Math.floor((b.y + b.h - EPS) / T);
      for (var yy = c0; yy <= c1; yy++) {
        for (var xx = a0; xx <= a1; xx++) {
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          var key = yy * w + xx;
          (itemsAt[key] || (itemsAt[key] = [])).push(it);
        }
      }
      return it;
    }
    var i;
    for (i = 0; i < L.items.length; i++) addItem(L.items[i].kind, L.items[i].tx, L.items[i].ty);
    for (i = 0; i < L.lanterns.length; i++) addItem('lantern', L.lanterns[i].tx, L.lanterns[i].ty);
    var finishItem = L.finish ? addItem('finish', L.finish.tx, L.finish.ty) : null;
    var pageItem = null;
    for (i = 0; i < items.length; i++) if (items[i].kind === 'page') pageItem = items[i];

    function touch(p) {
      var a0 = Math.floor(p.x / T), a1 = Math.floor((p.x + p.w - EPS) / T);
      var c0 = Math.floor(p.y / T), c1 = Math.floor((p.y + p.h - EPS) / T);
      for (var yy = c0; yy <= c1; yy++) {
        if (yy < 0 || yy >= h) continue;
        for (var xx = a0; xx <= a1; xx++) {
          if (xx < 0 || xx >= w) continue;
          var list = itemsAt[yy * w + xx];
          if (!list) continue;
          for (var j = 0; j < list.length; j++) {
            var it = list[j];
            if (!it.touched && RC.overlap(p.x, p.y, p.w, p.h, it.box.x, it.box.y, it.box.w, it.box.h)) it.touched = true;
          }
        }
      }
    }

    // --- очередь отрезков
    var reached = new Uint8Array(segs.length);
    var queue = [];
    function reachSeg(id) {
      if (id < 0 || reached[id]) return;
      reached[id] = 1;
      queue.push(id);
    }

    // На какую стоянку встал герой.
    function standUnder(p) {
      var row = Math.round((p.y + p.h) / T);
      var cols = [Math.floor((p.x + p.w / 2) / T), Math.floor(p.x / T), Math.floor((p.x + p.w - EPS) / T)];
      for (var j = 0; j < cols.length; j++) {
        if (isStand(cols[j], row)) return segOf[row * w + cols[j]];
      }
      return -1;
    }

    function standingAt(stx, sty) {
      var p = RC.newPlayer(stx * T + (T - P.w) / 2, sty * T - P.h);
      p.onGround = true;
      p.coyoteT = P.coyote;
      return p;
    }

    // Прогнать героя по «сценарию» до приземления. bitsAt(i) — биты кадра i.
    function simulate(p, bitsAt) {
      stats.sims++;
      var left = !p.onGround;
      for (var f = 0; f < MAX_FRAMES; f++) {
        RC.updatePlayer(p, bitsAt(f), grid);
        stats.frames++;
        touch(p);
        if (!p.onGround) left = true;
        else if (left) { reachSeg(standUnder(p)); return; }
        else if (p.hitWall) return;                 // упёрся в стену, не сорвавшись
        if (p.y > (h + 1) * T) return;              // упал в пропасть
      }
    }

    function dirBits(dir) { return dir > 0 ? K.RIGHT : (dir < 0 ? K.LEFT : 0); }

    function processSegment(seg) {
      var sx, dir, j, k, db;
      // пройти по отрезку пешком — коснуться всего, что над ним
      for (sx = seg.x0; sx <= seg.x1; sx++) touch(standingAt(sx, seg.ty));

      // прыжки с места
      for (sx = seg.x0; sx <= seg.x1; sx++) {
        for (dir = -1; dir <= 1; dir++) {
          db = dirBits(dir);
          for (j = 0; j < HOLDS.length; j++) {
            k = HOLDS[j];
            simulate(standingAt(sx, seg.ty), (function (kk, dbb) {
              return function (f) { return dbb | (f < kk ? K.JUMP : 0); };
            })(k, db));
          }
          if (dir === 0) continue;
          for (j = 0; j < DIR_DELAYS.length; j++) {
            simulate(standingAt(sx, seg.ty), (function (dd, dbb) {
              return function (f) { return (f < 18 ? K.JUMP : 0) | (f >= dd ? dbb : 0); };
            })(DIR_DELAYS[j], db));
          }
        }
      }

      // разбег от дальнего конца + прыжки по ходу разбега; шаг с края
      for (dir = -1; dir <= 1; dir += 2) {
        db = dirBits(dir);
        var p = standingAt(dir > 0 ? seg.x0 : seg.x1, seg.ty);
        var snaps = [];      // состояния, из которых пробуем прыгнуть
        var recent = [];     // последние 10 кадров разбега перед краем/стеной
        for (var f = 0; f < 600; f++) {
          var before = copyPlayer(p);
          RC.updatePlayer(p, db, grid);
          stats.frames++;
          touch(p);
          if (p.onGround) {
            var cx = Math.floor((p.x + p.w / 2) / T);
            if (cx < seg.x0 || cx > seg.x1 || p.hitWall) { recent.push(before); break; }
            if (f % 6 === 0) snaps.push(before);
            recent.push(before);
            if (recent.length > 10) recent.shift();
          } else {
            // сорвался с края с разгону: прыжки в «кадры после края», потом долетаем до земли
            var q = copyPlayer(p);
            for (var a = 0; a < P.coyote - 1; a++) {
              snaps.push(copyPlayer(q));
              RC.updatePlayer(q, db, grid);
              stats.frames++;
              touch(q);
              if (q.onGround) { reachSeg(standUnder(q)); break; }
            }
            if (!q.onGround) simulate(q, function () { return db; });
            break;
          }
        }
        for (j = 0; j < recent.length; j++) snaps.push(recent[j]);
        for (j = 0; j < snaps.length; j++) {
          for (var hh = 0; hh < HOLDS.length; hh++) {
            simulate(copyPlayer(snaps[j]), (function (kk, dbb) {
              return function (f2) { return dbb | (f2 < kk ? K.JUMP : 0); };
            })(HOLDS[hh], db));
          }
        }
        // медленный шаг с края
        simulate(standingAt(dir > 0 ? seg.x1 : seg.x0, seg.ty), function () { return db; });
      }
    }

    // --- старт: где встанет герой из клетки P
    var sp = RC.newPlayer(L.start.tx * T + (T - P.w) / 2, (L.start.ty + 1) * T - P.h);
    for (var s = 0; s < MAX_FRAMES && !sp.onGround && sp.y < (h + 1) * T; s++) RC.updatePlayer(sp, 0, grid);
    if (sp.onGround) reachSeg(standUnder(sp));

    while (queue.length) processSegment(segs[queue.shift()]);

    // --- итог
    var unreachable = [];
    for (var id = 0; id < segs.length; id++) {
      if (reached[id]) continue;
      for (var ux = segs[id].x0; ux <= segs[id].x1; ux++) unreachable.push({ tx: ux, ty: segs[id].ty, kind: 'stand' });
    }
    for (i = 0; i < items.length; i++) {
      if (!items[i].touched) unreachable.push({ tx: items[i].tx, ty: items[i].ty, kind: items[i].kind });
    }
    var reachedFinish = !!(finishItem && finishItem.touched);
    return {
      ok: unreachable.length === 0 && (finishItem ? reachedFinish : true),
      unreachable: unreachable,
      reachedFinish: reachedFinish,
      reachedPage: !!(pageItem && pageItem.touched),
      stats: stats
    };
  };
})(RC);
