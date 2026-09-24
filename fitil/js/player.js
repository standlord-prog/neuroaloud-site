var RC = (typeof RC !== 'undefined') ? RC : {};
// Движение героя Фитиля: шаг и разгон, прыжок (коротко — низкий, держишь — высокий),
// поблажки: «кадры после края» (coyote), «нажал заранее» (buffer), обход угла (corner).
// Все скорости — в пикселях за кадр при 60 кадрах в секунду.

(function (RC) {
  'use strict';

  RC.P = {
    walkMax: 4.2,     // скорость шага
    runMax: 6.2,      // скорость бега
    runAfter: 36,     // держишь направление 36 кадров → разгон до runMax
    accel: 0.38,      // разгон на земле
    airAccel: 0.26,   // разгон в воздухе
    decel: 0.55,      // торможение на земле, если ничего не нажато
    airDecel: 0.08,   // торможение в воздухе, если ничего не нажато
    turn: 0.9,        // разворот на земле (тормозит быстрее)
    airTurn: 0.45,    // разворот в воздухе
    gravity: 0.56,    // тяжесть при взлёте
    fallGravity: 0.78,// тяжесть при падении (падает быстрее, чем взлетает — прыжок «упругий»)
    maxFall: 13,      // предельная скорость падения
    jumpV: 11.6,      // толчок прыжка с места/шагом
    runJumpV: 12.6,   // толчок прыжка с бега
    cutMul: 0.45,     // отпустил прыжок при vy < −3 → vy *= cutMul (короткий прыжок)
    coyote: 6,        // кадры «после края», когда ещё можно прыгнуть
    buffer: 6,        // кадры «нажал заранее» до приземления
    corner: 10,       // пиксели обхода угла макушкой
    bounceV: 7.5,     // отскок от Шишколапа, если прыжок не зажат
    w: 30,            // ширина героя
    h: 42             // рост героя
  };

  RC.newPlayer = function (x, y) {
    return {
      x: x, y: y, w: RC.P.w, h: RC.P.h,
      vx: 0, vy: 0,
      onGround: false, hitHead: false, hitWall: 0,
      facing: 1,          // куда смотрит: 1 вправо, −1 влево
      runDir: 0,          // в какую сторону держится направление
      runT: 0,            // сколько кадров держится направление (для разгона)
      coyoteT: 0,
      bufferT: 0,
      jumping: false,     // идёт прыжок, который ещё можно «обрезать» отпусканием
      prevBits: 0,
      airT: 0,            // кадров в воздухе
      landT: 999,         // кадров с последнего приземления (для приседания в рисовании)
      landImpact: 0,      // скорость падения в момент приземления
      anim: 'stand',      // stand | walk | run | jump | fall — для рисования
      events: []          // события кадра: 'jump', 'land'
    };
  };

  function doJump(p) {
    var P = RC.P;
    p.vy = -(Math.abs(p.vx) > P.walkMax + 0.5 ? P.runJumpV : P.jumpV);
    p.bufferT = 0;
    p.coyoteT = 0;
    p.jumping = true;
    p.onGround = false;
    p.events.push('jump');
  }

  // Один кадр движения героя. bits — биты RC.KEY, нажатые в этом кадре.
  RC.updatePlayer = function (p, bits, grid) {
    var P = RC.P, K = RC.KEY;
    p.events = [];
    var pressed = bits & ~p.prevBits;

    // --- по горизонтали: шаг, разгон, разворот
    var dir = ((bits & K.RIGHT) ? 1 : 0) - ((bits & K.LEFT) ? 1 : 0);
    if (dir !== 0) {
      if (dir === p.runDir) p.runT++;
      else { p.runDir = dir; p.runT = 1; }
      p.facing = dir;
    } else {
      p.runDir = 0;
      p.runT = 0;
    }
    var max = p.runT >= P.runAfter ? P.runMax : P.walkMax;
    if (dir !== 0) {
      var s = p.vx * dir;
      if (s < max) {
        var a = p.onGround ? (s < 0 ? P.turn : P.accel) : (s < 0 ? P.airTurn : P.airAccel);
        s = Math.min(s + a, max);
      } else if (p.onGround && s > max) {
        s = Math.max(s - P.decel, max);
      }
      p.vx = s * dir;
    } else {
      p.vx = RC.approach(p.vx, 0, p.onGround ? P.decel : P.airDecel);
    }

    // --- прыжок с поблажками
    if (p.onGround) p.coyoteT = P.coyote; else if (p.coyoteT > 0) p.coyoteT--;
    if (pressed & K.JUMP) p.bufferT = P.buffer; else if (p.bufferT > 0) p.bufferT--;
    if (p.bufferT > 0 && p.coyoteT > 0) doJump(p);
    if (p.jumping && !(bits & K.JUMP) && p.vy < -3) { p.vy *= P.cutMul; p.jumping = false; }

    // --- тяжесть
    p.vy = Math.min(p.vy + (p.vy < 0 ? P.gravity : P.fallGravity), P.maxFall);

    // --- движение и столкновения
    var wasGround = p.onGround;
    var vyBefore = p.vy;
    RC.moveAndCollide(p, grid, P.corner);
    if (p.hitWall) p.runT = 0;
    if (p.hitHead) p.jumping = false;

    if (p.onGround) {
      p.jumping = false;
      p.airT = 0;
      if (!wasGround) {
        p.events.push('land');
        p.landImpact = vyBefore;
        p.landT = 0;
        // «нажал заранее»: прыжок срабатывает в тот же кадр, что и приземление
        if (p.bufferT > 0) doJump(p);
      }
    } else {
      p.airT++;
      if (p.vy >= 0) p.jumping = false;
    }
    if (p.landT < 999) p.landT++;

    var speed = Math.abs(p.vx);
    if (p.onGround) p.anim = speed < 0.3 ? 'stand' : (speed > P.walkMax + 0.5 ? 'run' : 'walk');
    else p.anim = p.vy < 0 ? 'jump' : 'fall';

    p.prevBits = bits;
    return p;
  };
})(RC);
