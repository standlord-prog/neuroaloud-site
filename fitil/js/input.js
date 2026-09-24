var RC = (typeof RC !== 'undefined') ? RC : {};
// Ввод: клавиши → биты одного кадра; запись и повтор нажатий.
// Кадр ввода — одно целое число (сумма битов RC.KEY). Клавиатуру слушает main.js
// и передаёт сюда коды клавиш (event.code) через RC.Input().down/up.

(function (RC) {
  'use strict';

  RC.KEY = { LEFT: 1, RIGHT: 2, JUMP: 4, ACT: 8 };

  // Какие клавиши что значат (event.code). Esc, M и ` обрабатывает main.js/debug.js отдельно.
  RC.KEYMAP = {
    KeyA: RC.KEY.LEFT, ArrowLeft: RC.KEY.LEFT,
    KeyD: RC.KEY.RIGHT, ArrowRight: RC.KEY.RIGHT,
    Space: RC.KEY.JUMP, ArrowUp: RC.KEY.JUMP,
    KeyE: RC.KEY.ACT
  };

  // Состояние клавиатуры: держим множество нажатых кодов, биты считаем из него.
  RC.Input = function () {
    var held = {};
    return {
      down: function (code) {
        if (RC.KEYMAP[code] === undefined) return false;
        held[code] = true;
        return true;
      },
      up: function (code) {
        if (RC.KEYMAP[code] === undefined) return false;
        delete held[code];
        return true;
      },
      clear: function () { held = {}; },
      bits: function () {
        var b = 0;
        for (var code in held) {
          if (held[code]) b |= RC.KEYMAP[code];
        }
        return b;
      }
    };
  };

  // Запись нажатий: по одному числу на кадр.
  RC.Recorder = function () {
    var arr = [];
    return {
      push: function (bits) { arr.push(bits | 0); },
      data: function () { return arr.slice(); },
      length: function () { return arr.length; },
      clear: function () { arr = []; }
    };
  };

  // Повтор записи: next() отдаёт биты следующего кадра, после конца — 0.
  RC.Replayer = function (data) {
    var arr = (data || []).slice();
    var pos = 0;
    return {
      next: function () { return pos < arr.length ? arr[pos++] : (pos++, 0); },
      done: function () { return pos >= arr.length; },
      pos: function () { return pos; },
      length: function () { return arr.length; }
    };
  };
})(RC);
