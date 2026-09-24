var RC = (typeof RC !== 'undefined') ? RC : {};
// Ядро игры «Фитиль и правильный замок»: константы, сид-генератор, фиксированный шаг.
// Правило логики: никаких обращений к окну браузера, часам и случайным числам браузера —
// всё детерминировано, чтобы игру можно было гонять в Node и повторять записи нажатий.

(function (RC) {
  'use strict';

  RC.TILE = 48;          // размер плитки в пикселях
  RC.FPS = 60;           // кадров логики в секунду
  RC.DT = 1 / 60;        // длительность кадра логики, с
  RC.VIEW_W = 960;       // размер холста
  RC.VIEW_H = 540;

  // Сид-генератор mulberry32. Только для украшений (частицы, мерцание) — не для правил игры.
  RC.rng = function (seed) {
    var a = (seed >>> 0);
    return {
      next: function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range: function (lo, hi) { return lo + (hi - lo) * this.next(); }
    };
  };

  // Фиксированный шаг: накопитель реального времени → сколько кадров логики прогнать.
  // Время подаёт снаружи main.js (из часов браузера); сама логика часов не знает.
  RC.Ticker = function (maxSteps) {
    var acc = 0;
    var cap = maxSteps || 15;               // не больше 15 кадров за раз (0,25 с)
    var EPS = 1e-7;
    return {
      add: function (dtSeconds) {
        if (!(dtSeconds > 0)) dtSeconds = 0;
        acc += dtSeconds;
        var n = Math.floor((acc + EPS) / RC.DT);
        if (n > cap) { n = cap; acc = 0; return n; }   // зависли — не догоняем, хвост сбрасываем
        acc -= n * RC.DT;
        if (acc < 0) acc = 0;
        return n;
      },
      reset: function () { acc = 0; }
    };
  };

  // Мелкие помощники для логики.
  RC.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  RC.approach = function (v, target, step) {
    if (v < target) return Math.min(v + step, target);
    if (v > target) return Math.max(v - step, target);
    return v;
  };
  RC.sign = function (v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); };
  RC.overlap = function (ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  };
})(RC);
