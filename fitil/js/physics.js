var RC = (typeof RC !== 'undefined') ? RC : {};
// Физика: сетка плиток и столкновения прямоугольника с ней.
// Знаки карты: '#' — твёрдая плитка, '=' — ветка (запрыгнуть можно снизу, стоять сверху),
// '^' — колючки (не твёрдые, ранят — обрабатывает world.js). Всё остальное — пусто.
// За левым и правым краем карты — стена; над картой и под ней — пусто (снизу — пропасть).

(function (RC) {
  'use strict';

  var EMPTY = 0, SOLID = 1, ONEWAY = 2, SPIKE = 3;
  var EPS = 1e-6;
  RC.CELL = { EMPTY: EMPTY, SOLID: SOLID, ONEWAY: ONEWAY, SPIKE: SPIKE };

  RC.makeGrid = function (lines) {
    var h = lines.length;
    var w = 0;
    var x, y;
    for (y = 0; y < h; y++) if (lines[y].length > w) w = lines[y].length;
    var cells = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var line = lines[y];
      for (x = 0; x < w; x++) {
        var c = x < line.length ? line.charAt(x) : '.';
        cells[y * w + x] = c === '#' ? SOLID : (c === '=' ? ONEWAY : (c === '^' ? SPIKE : EMPTY));
      }
    }
    function code(tx, ty) {
      if (tx < 0 || tx >= w) return SOLID;
      if (ty < 0 || ty >= h) return EMPTY;
      return cells[ty * w + tx];
    }
    return {
      w: w,
      h: h,
      lines: lines.slice(),
      code: code,
      solid: function (tx, ty) { return code(tx, ty) === SOLID; },
      oneWay: function (tx, ty) { return code(tx, ty) === ONEWAY; },
      spike: function (tx, ty) { return code(tx, ty) === SPIKE; },
      // можно ли стоять на верхней грани плитки (твёрдая или ветка)
      standable: function (tx, ty) { var c = code(tx, ty); return c === SOLID || c === ONEWAY; },
      ch: function (tx, ty) {
        if (ty < 0 || ty >= h || tx < 0 || tx >= w) return '';
        return lines[ty].charAt(tx) || '.';
      }
    };
  };

  // Задевает ли прямоугольник хоть одну твёрдую плитку.
  RC.rectHitsSolid = function (grid, x, y, w, h) {
    var T = RC.TILE;
    var tx0 = Math.floor(x / T), tx1 = Math.floor((x + w - EPS) / T);
    var ty0 = Math.floor(y / T), ty1 = Math.floor((y + h - EPS) / T);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        if (grid.code(tx, ty) === SOLID) return true;
      }
    }
    return false;
  };

  // Сдвинуть тело на (vx, vy): сначала по X, потом по Y.
  // body: { x, y, w, h, vx, vy, onGround }. Выставляет onGround, hitHead, hitWall (−1/0/1).
  // corner — «обход угла»: если макушка задела угол блока не больше чем на corner пикселей,
  // тело сдвигается вбок и летит дальше вверх.
  RC.moveAndCollide = function (body, grid, corner) {
    var T = RC.TILE;
    var tx, ty, tx0, tx1, ty0, ty1, c;
    body.hitHead = false;
    body.hitWall = 0;
    body.onGround = false;

    // --- по X
    if (body.vx !== 0) {
      body.x += body.vx;
      ty0 = Math.floor(body.y / T);
      ty1 = Math.floor((body.y + body.h - EPS) / T);
      if (body.vx > 0) {
        tx = Math.floor((body.x + body.w - EPS) / T);
        for (ty = ty0; ty <= ty1; ty++) {
          if (grid.code(tx, ty) === SOLID) {
            body.x = tx * T - body.w; body.vx = 0; body.hitWall = 1; break;
          }
        }
      } else {
        tx = Math.floor(body.x / T);
        for (ty = ty0; ty <= ty1; ty++) {
          if (grid.code(tx, ty) === SOLID) {
            body.x = (tx + 1) * T; body.vx = 0; body.hitWall = -1; break;
          }
        }
      }
    }

    // --- по Y
    if (body.vy === 0) return body;
    var y0 = body.y;
    body.y += body.vy;
    tx0 = Math.floor(body.x / T);
    tx1 = Math.floor((body.x + body.w - EPS) / T);
    if (body.vy > 0) {
      var bottom = body.y + body.h;
      var prevBottom = y0 + body.h;
      ty = Math.floor((bottom - EPS) / T);
      var top = ty * T;
      for (tx = tx0; tx <= tx1; tx++) {
        c = grid.code(tx, ty);
        if (c === SOLID || (c === ONEWAY && prevBottom <= top + 0.01)) {
          body.y = top - body.h; body.vy = 0; body.onGround = true; break;
        }
      }
    } else {
      ty = Math.floor(body.y / T);
      var hit = false;
      for (tx = tx0; tx <= tx1; tx++) {
        if (grid.code(tx, ty) === SOLID) { hit = true; break; }
      }
      if (hit) {
        var nudged = false;
        if (corner > 0) {
          for (var d = 1; d <= corner && !nudged; d++) {
            for (var s = -1; s <= 1; s += 2) {
              var nx = body.x + s * d;
              if (!RC.rectHitsSolid(grid, nx, body.y, body.w, body.h) &&
                  !RC.rectHitsSolid(grid, nx, y0, body.w, body.h)) {
                body.x = nx; nudged = true; break;
              }
            }
          }
        }
        if (!nudged) {
          body.y = (ty + 1) * T; body.vy = 0; body.hitHead = true;
        }
      }
    }
    return body;
  };
})(RC);
