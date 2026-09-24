var RC = (typeof RC !== 'undefined') ? RC : {};
// Режим проверки (скрытая клавиша ` — обратная кавычка). Панель справа сверху:
//   I   — бессмертие вкл/выкл (удары и колючки не действуют; яма всё равно возвращает к фонарю)
//   1–9 — перенести героя к фонарю с этим номером (он зажжётся в следующем кадре)
//   R   — запись нажатий: старт (уровень начинается заново) / стоп
//   P   — повтор последней записи с начала уровня
//   C   — проверить достижимость; недостижимые плитки отмечаются красным
// Пока панель открыта, на поле видны рамки касаний героя, врагов, предметов и финиша.
// Команды выполняет RC.game (main.js); этот файл — только панель и отметки.

(function (RC) {
  'use strict';

  var D = RC.debug = {};
  var open = false, panel = null, reach = null, busy = false, msg = '', msgT = 0, tick = 0, lanCount = -1;
  var el = {};

  function $(id) { return el[id] || null; }
  function setText(id, s) { var e = $(id); if (e && e.textContent !== s) e.textContent = s; }
  function say(s) { msg = s; msgT = 240; setText('msg', s); }

  D.init = function (node) {
    panel = node;
    if (!panel) return;
    panel.innerHTML =
      '<div class="dbg-t">Режим проверки <span>` — закрыть</span></div>' +
      '<div class="dbg-r"><button type="button" tabindex="-1" data-k="KeyI">I</button> бессмертие: <b data-id="inv">выкл</b></div>' +
      '<div class="dbg-r">к фонарю: <span data-id="lan"></span></div>' +
      '<div class="dbg-r"><button type="button" tabindex="-1" data-k="KeyR">R</button> запись: <b data-id="rec">нет</b></div>' +
      '<div class="dbg-r"><button type="button" tabindex="-1" data-k="KeyP">P</button> повтор: <b data-id="rep">—</b></div>' +
      '<div class="dbg-r"><button type="button" tabindex="-1" data-k="KeyC">C</button> проверить достижимость</div>' +
      '<div class="dbg-r dbg-res" data-id="reach">ещё не проверяли</div>' +
      '<div class="dbg-r dbg-info" data-id="info"></div>' +
      '<div class="dbg-r dbg-msg" data-id="msg"></div>';
    var nodes = panel.querySelectorAll('[data-id]');
    for (var i = 0; i < nodes.length; i++) el[nodes[i].getAttribute('data-id')] = nodes[i];
    // кнопки панели не забирают фокус у игры (иначе пробел «нажимал» бы кнопку)
    panel.addEventListener('mousedown', function (e) { e.preventDefault(); });
    panel.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== panel && !(t.getAttribute && t.getAttribute('data-k'))) t = t.parentNode;
      if (t && t !== panel) D.handleKey(t.getAttribute('data-k'));
    });
    panel.hidden = true;
  };

  D.isOpen = function () { return open; };
  D.toggle = function () {
    open = !open;
    if (panel) panel.hidden = !open;
    if (open) { lanCount = -1; D.update(true); }
    return open;
  };

  D.handleKey = function (code) {
    if (!open) return false;
    var G = RC.game;
    if (!G) return false;
    if (code === 'KeyI') {
      G.setInvincible(!G.isInvincible());
      say(G.isInvincible() ? 'бессмертие включено' : 'бессмертие выключено');
      return true;
    }
    if (code === 'KeyR') {
      if (G.isReplaying()) { say('идёт повтор — запись недоступна'); return true; }
      if (G.isRecording()) say('запись остановлена: ' + G.recStop() + ' кадров');
      else { G.recStart(); say('запись идёт — уровень начат заново'); }
      return true;
    }
    if (code === 'KeyP') {
      var rec = G.lastRecording();
      if (!rec || !rec.length) say('записи нет — сначала R');
      else { G.replay(rec, { invincible: G.lastRecordingInvincible() }); say('повтор: ' + rec.length + ' кадров'); }
      return true;
    }
    if (code === 'KeyC') { D.checkReach(); return true; }
    var m = /^Digit([1-9])$/.exec(code || '');
    if (m) {
      var n = +m[1];
      var r = G.warp(n - 1);
      say(r === true ? 'перенёс к фонарю №' + n : r);
      return true;
    }
    return false;
  };

  D.checkReach = function () {
    if (busy || !RC.checkReach || !RC.game) return;
    busy = true;
    setText('reach', 'проверяю… (1–3 секунды)');
    setTimeout(function () {
      try {
        var t0 = Date.now();
        var r = RC.checkReach(RC.game.world().level);
        D.setReach(r, (Date.now() - t0) / 1000);
      } catch (e) {
        setText('reach', 'проверка сломалась: ' + (e && e.message));
      }
      busy = false;
    }, 40);
  };
  D.setReach = function (r, sec) {
    reach = r;
    var s = (r.ok ? 'всё достижимо' : 'недостижимо: ' + r.unreachable.length + ' (красным)') +
      ' · финиш: ' + (r.reachedFinish ? 'да' : 'нет') + ' · страница: ' + (r.reachedPage ? 'да' : 'нет') +
      (sec !== undefined ? ' · ' + sec.toFixed(1) + ' с' : '');
    setText('reach', s);
  };
  D.reachResult = function () {
    return reach ? { ok: reach.ok, unreachable: reach.unreachable.length, reachedFinish: reach.reachedFinish, reachedPage: reach.reachedPage } : null;
  };

  // Раз в 10 кадров освежить надписи панели.
  D.update = function (force) {
    if (!open || !panel || !RC.game) return;
    tick++;
    if (msgT > 0 && --msgT === 0) setText('msg', '');
    if (!force && tick % 10) return;
    var G = RC.game, w = G.world(), p = w.player;
    setText('inv', G.isInvincible() ? 'ВКЛ' : 'выкл');
    setText('rec', G.isRecording() ? 'идёт, ' + G.recLength() + ' кадров' :
      (G.lastRecording() ? 'есть, ' + G.lastRecording().length + ' кадров' : 'нет'));
    var ri = G.replayInfo();
    setText('rep', ri ? 'идёт ' + ri.pos + ' / ' + ri.length : (G.lastRecording() ? 'P — запустить' : '—'));
    setText('info', 'кадр ' + w.frame + ' · x ' + p.x.toFixed(1) + ' y ' + p.y.toFixed(1) +
      ' · плитка ' + Math.floor((p.x + p.w / 2) / RC.TILE) + ',' + Math.floor((p.y + p.h - 1) / RC.TILE) +
      ' · скорость ' + p.vx.toFixed(2) + ' · ' + Math.round(G.fps()) + ' к/с');
    if (lanCount !== w.lanterns.length) {
      lanCount = w.lanterns.length;
      var box = $('lan');
      if (box) {
        box.innerHTML = '';
        for (var i = 0; i < w.lanterns.length && i < 9; i++) {
          var b = document.createElement('button');
          b.type = 'button';
          b.tabIndex = -1;
          b.setAttribute('data-k', 'Digit' + (i + 1));
          b.textContent = String(i + 1);
          box.appendChild(b);
        }
      }
    }
  };

  // Отметки на поле (вызывает render.js в координатах мира).
  D.drawWorld = function (c, world) {
    if (!open) return;
    var T = RC.TILE, i;
    c.save();
    if (reach && reach.unreachable.length) {
      c.fillStyle = 'rgba(255,20,50,0.42)';
      c.strokeStyle = '#ff2040';
      c.lineWidth = 2;
      for (i = 0; i < reach.unreachable.length; i++) {
        var u = reach.unreachable[i];
        c.fillRect(u.tx * T, u.ty * T, T, T);
        c.strokeRect(u.tx * T + 1, u.ty * T + 1, T - 2, T - 2);
      }
    }
    c.lineWidth = 1;
    var p = world.player;
    c.strokeStyle = '#3cf0ff';
    c.strokeRect(p.x, p.y, p.w, p.h);
    for (i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (e.state === 'gone') continue;
      c.strokeStyle = RC.enemyHarmful(e) ? '#ff5050' : '#8a8a8a';
      c.strokeRect(e.x, e.y, e.w, e.h);
    }
    c.strokeStyle = 'rgba(255,230,120,0.7)';
    for (i = 0; i < world.items.length; i++) {
      var it = world.items[i];
      if (!it.taken) c.strokeRect(it.box.x, it.box.y, it.box.w, it.box.h);
    }
    c.strokeStyle = '#ffb040';
    c.setLineDash([5, 4]);
    for (i = 0; i < world.lanterns.length; i++) {
      var l = world.lanterns[i];
      c.strokeRect(l.box.x, l.box.y, l.box.w, l.box.h);
      c.beginPath();
      c.arc((l.tx + 0.5) * T, (l.ty + 0.5) * T, RC.WP.tenRadius * T, 0, Math.PI * 2);
      c.stroke();
    }
    c.setLineDash([]);
    if (world.finish) {
      c.strokeStyle = '#60ff90';
      c.strokeRect(world.finish.box.x, world.finish.box.y, world.finish.box.w, world.finish.box.h);
    }
    c.restore();
  };
})(RC);
