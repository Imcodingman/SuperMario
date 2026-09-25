/* 超级玛丽 H5 —— 纯 Canvas 实现，无外部依赖 */
(() => {
  'use strict';

  // ============================================================
  // 基础常量与画布
  // ============================================================
  const T = 16;                 // 图块尺寸（逻辑像素）
  const LH = 15;                // 关卡高度（图块）
  const LW = 212;               // 关卡宽度（图块）
  const VIEW_H = LH * T;        // 240
  const FLAG_X = 198;           // 旗杆所在列
  const CASTLE_X = 202;         // 城堡起始列
  const GROUND_Y = 13 * T;      // 地面顶部 y

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let VIEW_W = 256;
  let SCALE = 3;

  const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  // 微信、QQ、钉钉、支付宝等 App 内置的浏览器不跟随手机转屏
  const IN_APP = /MicroMessenger|QQ\/|DingTalk|AlipayClient|Weibo/i.test(navigator.userAgent);
  // 强制横屏：App 内置浏览器每次打开都默认开启，也可以用「横屏/竖屏」按钮临时切换
  let forceLandscape = IN_APP;
  let rotated = false;

  function resize() {
    const app = document.getElementById('app');
    const screenPortrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('show-rotate', screenPortrait);
    rotated = IS_TOUCH && forceLandscape && screenPortrait;
    document.body.classList.toggle('rotated', rotated);
    document.getElementById('rotateBtn').textContent = rotated ? '竖屏' : '横屏';
    if (rotated) {
      // 页面顺时针转 90 度：宽高互换，手机逆时针横过来拿
      app.style.width = window.innerHeight + 'px';
      app.style.height = window.innerWidth + 'px';
      app.style.left = window.innerWidth + 'px';
    } else {
      app.style.width = app.style.height = app.style.left = '';
    }
    const vw = rotated ? window.innerHeight : window.innerWidth;
    const vh = rotated ? window.innerWidth : window.innerHeight;
    const portrait = vh > vw;
    VIEW_W = portrait ? 256 : Math.round(Math.min(Math.max(VIEW_H * vw / vh, 256), 400));
    const s = Math.min(vw / VIEW_W, (portrait ? vh * 0.48 : vh) / VIEW_H);
    canvas.style.width = Math.floor(VIEW_W * s) + 'px';
    canvas.style.height = Math.floor(VIEW_H * s) + 'px';
    SCALE = Math.max(1, Math.min(4, Math.ceil(s * (window.devicePixelRatio || 1))));
    canvas.width = VIEW_W * SCALE;
    canvas.height = VIEW_H * SCALE;
    // 竖屏时把暂停/静音按钮和提示放到画面下方，避免与虚拟按键重叠
    const bar = document.getElementById('topbar');
    const hint = document.getElementById('hint');
    if (portrait) {
      const bottom = canvas.getBoundingClientRect().bottom;
      bar.style.cssText = `top:${Math.round(bottom + 12)}px;bottom:auto;left:auto;right:16px;transform:none`;
      hint.style.top = Math.round(bottom + 66) + 'px';
    } else {
      bar.style.cssText = '';
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  // ============================================================
  // 音效（WebAudio 合成，无需音频文件）
  // ============================================================
  const Sound = (() => {
    let actx = null;
    let master = null;
    let muted = false;
    try { muted = localStorage.getItem('smb_muted') === '1'; } catch (e) { /* ignore */ }

    function init() {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume();
    }

    function tone(freq, dur, opt = {}) {
      if (!actx) return;
      const { type = 'square', vol = 0.08, slide = 0, at = 0, when = 0 } = opt;
      const t = when || actx.currentTime + at;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    function noise(dur, vol = 0.2) {
      if (!actx) return;
      const len = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = actx.createBufferSource();
      const g = actx.createGain();
      g.gain.value = vol;
      src.buffer = buf;
      src.connect(g);
      g.connect(master);
      src.start();
    }

    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    function seq(notes, step, opt = {}) {
      notes.forEach((m, i) => { if (m) tone(midi(m), step * 0.95, { ...opt, at: i * step }); });
    }

    const sfx = {
      jump: big => tone(big ? 260 : 330, 0.2, { slide: big ? 700 : 880, vol: 0.06 }),
      coin: () => { tone(988, 0.07, { vol: 0.06 }); tone(1319, 0.35, { vol: 0.06, at: 0.07 }); },
      stomp: () => tone(700, 0.1, { slide: 180, vol: 0.1 }),
      kick: () => tone(900, 0.08, { slide: 300, vol: 0.08 }),
      bump: () => tone(160, 0.09, { type: 'triangle', vol: 0.3 }),
      brk: () => { noise(0.25, 0.25); tone(220, 0.12, { slide: 60, type: 'triangle', vol: 0.2 }); },
      sprout: () => seq([55, 59, 62, 67, 71, 74, 79], 0.035, { vol: 0.06 }),
      power: () => seq([60, 64, 67, 72, 64, 67, 72, 76, 67, 72, 76, 79], 0.04, { vol: 0.06 }),
      powerdown: () => seq([74, 69, 66, 62, 57, 54, 50], 0.06, { vol: 0.07 }),
      oneup: () => seq([76, 79, 88, 84, 86, 91], 0.08, { vol: 0.06 }),
      die: () => seq([72, 71, 70, 69, 0, 64, 60, 55, 48], 0.13, { type: 'triangle', vol: 0.2 }),
      flag: () => tone(1400, 1.0, { slide: 180, vol: 0.06 }),
      clear: () => seq([60, 64, 67, 72, 0, 67, 72, 76, 0, 79, 0, 84, 84, 84], 0.1, { vol: 0.06 }),
      tick: () => tone(1500, 0.03, { vol: 0.03 }),
      hurry: () => seq([84, 0, 84, 0, 84], 0.07, { vol: 0.05 }),
      gameover: () => seq([67, 0, 64, 0, 60, 55, 52, 48], 0.16, { type: 'triangle', vol: 0.2 }),
      pause: () => seq([76, 72, 76, 72], 0.06, { vol: 0.05 }),
      fire: () => { tone(220, 0.3, { slide: 70, type: 'sawtooth', vol: 0.04 }); noise(0.2, 0.08); },
      bridge: () => tone(120, 0.06, { type: 'triangle', vol: 0.25 }),
      boom: () => { noise(0.3, 0.2); tone(90, 0.2, { slide: 40, type: 'triangle', vol: 0.25 }); },
      bossFall: () => tone(500, 1.2, { slide: 45, type: 'triangle', vol: 0.2 }),
    };

    // ---- 原创背景音乐循环 ----
    const SONGS = [
      { // 地上
        mel: [72, 0, 76, 79, 81, 79, 76, 0, 74, 0, 77, 81, 79, 77, 74, 0,
          72, 76, 79, 84, 83, 79, 76, 74, 72, 0, 67, 0, 72, 0, 0, 0],
        roots: [48, 50, 43, 48], bass: [0, 0, 7, 0, 12, 0, 7, 0], step: 0.19,
      },
      { // 地下（小调、稀疏）
        mel: [69, 0, 72, 0, 76, 0, 75, 0, 69, 0, 72, 0, 74, 0, 0, 0,
          67, 0, 70, 0, 74, 0, 73, 0, 67, 0, 70, 0, 72, 0, 0, 0],
        roots: [45, 45, 43, 43], bass: [0, 0, 12, 0, 0, 0, 12, 0], step: 0.17,
      },
      { // 空中（轻快）
        mel: [74, 0, 78, 0, 81, 0, 78, 0, 76, 0, 79, 0, 83, 0, 79, 0,
          74, 78, 81, 86, 85, 81, 78, 76, 74, 0, 69, 0, 74, 0, 0, 0],
        roots: [50, 55, 57, 50], bass: [0, 0, 7, 0, 12, 0, 7, 0], step: 0.18,
      },
      { // 城堡（低沉、紧张）
        mel: [57, 0, 0, 56, 57, 0, 0, 56, 57, 0, 60, 0, 59, 0, 56, 0,
          57, 0, 0, 56, 57, 0, 0, 56, 57, 0, 62, 0, 60, 0, 59, 0],
        roots: [45, 45, 44, 45], bass: [0, 0, 0, 0, 12, 0, 0, 0], step: 0.16,
      },
    ];
    let song = SONGS[0];
    let bgmOn = false;
    let nextTime = 0;
    let idx = 0;
    let fast = false;
    setInterval(() => {
      if (!bgmOn || !actx) return;
      const step = fast ? song.step * 0.68 : song.step;
      if (nextTime < actx.currentTime - 0.1) nextTime = actx.currentTime + 0.05;
      while (nextTime < actx.currentTime + 0.25) {
        const i = idx % 32;
        const m = song.mel[i];
        if (m) tone(midi(m), step * 0.8, { when: nextTime, vol: 0.035 });
        const b = song.bass[i % 8];
        if (i % 2 === 0) tone(midi(song.roots[Math.floor(i / 8)] + b), step * 0.9, { when: nextTime, type: 'triangle', vol: 0.12 });
        nextTime += step;
        idx++;
      }
    }, 50);

    return {
      init,
      sfx,
      startBgm(isFast = false, songIdx) {
        if (!actx) return;
        fast = isFast;
        if (songIdx !== undefined) song = SONGS[songIdx] || SONGS[0];
        if (!bgmOn) { bgmOn = true; idx = 0; nextTime = actx.currentTime + 0.05; }
      },
      stopBgm() { bgmOn = false; },
      setFast(v) { fast = v; },
      toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.5;
        try { localStorage.setItem('smb_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
        return muted;
      },
      get muted() { return muted; },
    };
  })();

  // ============================================================
  // 输入（键盘 + 触屏）
  // ============================================================
  const keys = { left: false, right: false, jump: false };
  const touch = { left: false, right: false, jump: false };
  const input = { left: false, right: false, jump: false };
  let jumpBuf = 0;        // 跳跃缓冲（按下后若干帧内落地仍可起跳）

  function pressJump() { jumpBuf = 8; }

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'jump', KeyZ: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyK: 'jump',
  };

  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if (k || e.code === 'Enter') e.preventDefault();
    if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
    if (e.code === 'KeyM') { toggleMute(); return; }
    if (game.state === 'title' && (k === 'left' || k === 'right')) {
      Sound.init();
      changeSel(k === 'left' ? -1 : 1);
      return;
    }
    anyPress();
    if (!k) return;
    if (k === 'jump' && !keys.jump && !e.repeat) pressJump();
    keys[k] = true;
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  if (IS_TOUCH) document.body.classList.add('touch');

  // 方向键：根据触点在方向盘中的左右位置判断，支持手指滑动切换方向
  const dpad = document.getElementById('dpad');
  const dpadArrows = dpad.querySelectorAll('.arrow');
  const dpadPointers = new Map();
  function updateDpad() {
    let l = false, r = false;
    for (const v of dpadPointers.values()) { if (v < 0) l = true; else r = true; }
    touch.left = l;
    touch.right = r;
    dpadArrows[0].classList.toggle('on', l);
    dpadArrows[1].classList.toggle('on', r);
  }
  function dpadX(e) {
    const rc = dpad.getBoundingClientRect();
    // 页面旋转后，方向键的“左右”对应屏幕的上下
    return rotated ? e.clientY - (rc.top + rc.height / 2) : e.clientX - (rc.left + rc.width / 2);
  }
  dpad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (game.state === 'title') {
      Sound.init();
      changeSel(dpadX(e) < 0 ? -1 : 1);
      return;
    }
    anyPress();
    try { dpad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    dpadPointers.set(e.pointerId, dpadX(e));
    updateDpad();
  });
  dpad.addEventListener('pointermove', e => {
    if (!dpadPointers.has(e.pointerId)) return;
    dpadPointers.set(e.pointerId, dpadX(e));
    updateDpad();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => dpad.addEventListener(n, e => {
    dpadPointers.delete(e.pointerId);
    updateDpad();
  }));

  function bindHold(el, name, onPress) {
    const ids = new Set();
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      anyPress();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!ids.size && onPress) onPress();
      ids.add(e.pointerId);
      touch[name] = true;
      el.classList.add('on');
    });
    const up = e => {
      ids.delete(e.pointerId);
      if (!ids.size) { touch[name] = false; el.classList.remove('on'); }
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => el.addEventListener(n, up));
  }
  bindHold(document.getElementById('btnA'), 'jump', pressJump);

  document.getElementById('stage').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (paused) { togglePause(); return; }
    if (game.state === 'title' && titleArrows) {
      const pt = toCanvasPoint(e);
      const hit = r => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
      if (hit(titleArrows.l)) { Sound.init(); changeSel(-1); return; }
      if (hit(titleArrows.r)) { Sound.init(); changeSel(1); return; }
    }
    anyPress();
  });

  // 把点击位置换算成画布的逻辑坐标（考虑强制横屏的旋转）
  function toCanvasPoint(e) {
    const rc = canvas.getBoundingClientRect();
    if (rotated) {
      return { x: (e.clientY - rc.top) / rc.height * VIEW_W, y: (rc.right - e.clientX) / rc.width * VIEW_H };
    }
    return { x: (e.clientX - rc.left) / rc.width * VIEW_W, y: (e.clientY - rc.top) / rc.height * VIEW_H };
  }
  document.getElementById('pauseBtn').addEventListener('click', e => { e.currentTarget.blur(); togglePause(); });
  document.getElementById('muteBtn').addEventListener('click', e => { e.currentTarget.blur(); toggleMute(); });
  document.getElementById('rotateBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    forceLandscape = !forceLandscape;
    resize();
  });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('gesturestart', e => e.preventDefault());

  function toggleMute() {
    Sound.init();
    const m = Sound.toggleMute();
    document.getElementById('muteBtn').textContent = m ? '✕' : '♪';
  }
  document.getElementById('muteBtn').textContent = Sound.muted ? '✕' : '♪';

  function readInput() {
    input.left = keys.left || touch.left;
    input.right = keys.right || touch.right;
    input.jump = keys.jump || touch.jump;
  }

  // ============================================================
  // 像素精灵
  // ============================================================
  function makeSprite(rows, pal, w = 16) {
    const h = rows.length;
    const mk = flip => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      rows.forEach((row, y) => {
        const r = row.padEnd(w, '.').slice(0, w);
        for (let x = 0; x < w; x++) {
          const col = pal[r[x]];
          if (!col) continue;
          g.fillStyle = col;
          g.fillRect(flip ? w - 1 - x : x, y, 1, 1);
        }
      });
      return c;
    };
    return { r: mk(false), l: mk(true), w, h };
  }

  const MARIO_PAL = { R: '#d82800', B: '#8a4a00', S: '#fca044', Y: '#fcfc40', K: '#000' };
  const HEAD = [
    '.....RRRRR......',
    '....RRRRRRRRR...',
    '....BBBSSKS.....',
    '...BSBSSSKSSS...',
    '...BSBBSSSKSSSS.',
    '...BBSSSSBBBB...',
    '.....SSSSSSS....',
    '....BBRBBB......',
    '...BBBRBBRBBB...',
    '..BBBBRRRRBBBB..',
  ];
  const LEGS = {
    stand: [
      '..SSBRYRRYRBSS..',
      '..SSSRRRRRRSSS..',
      '..SSRRRRRRRRSS..',
      '....RRR..RRR....',
      '...BBB....BBB...',
      '..BBBB....BBBB..',
    ],
    walkA: [
      '...SBRYRRYRBS...',
      '...SRRRRRRRRS...',
      '...RRRRRRRRRR...',
      '..RRRR....RRRR..',
      '.BBBB......BBBB.',
      '.BBBBB....BBBBB.',
    ],
    walkB: [
      '....BRYRRYRB....',
      '...SSRRRRRRSS...',
      '...SSRRRRRRSS...',
      '.....RRRRRR.....',
      '.....BBBBBB.....',
      '....BBBBBBB.....',
    ],
    jump: [
      '.SSBBRYRRYRBB...',
      '.SSRRRRRRRRRR...',
      '...RRRRRRRRRR...',
      '..RRRR...RRRBB..',
      '.BBBB.....BBBB..',
      '.BBB............',
    ],
  };
  // 帧顺序：0 站立 1 走A 2 走B 3 跳跃
  const smallRows = ['stand', 'walkA', 'walkB', 'jump'].map(k => HEAD.concat(LEGS[k]));
  // 大号玛丽：单独绘制的 16x32 像素图（头 11 行 + 身体 12 行 + 腿 9 行）
  const BIG_UPPER = [
    '.....RRRRRR.....',
    '....RRRRRRRRR...',
    '...RRRRRRRRRRRR.',
    '...BBBSSSKKS....',
    '..BSSBSSSKKSSS..',
    '..BSSBSSSKKSSSS.',
    '..BSSBBSSSSSSSS.',
    '..BBSSSSBBBBBB..',
    '...BBSSSSBBBBB..',
    '....SSSSSSSSS...',
    '.....SSSSSSS....',
    '....BBBRRBB.....',
    '...BBBBRRBBBB...',
    '..BBBBBRRBBBBB..',
    '.BBBBBBRRBBBBBB.',
    '.BBBBBRRRRBBBBB.',
    '.BBBBRYRRYRBBBB.',
    '.SSBBRRRRRRBBSS.',
    'SSSSRRRRRRRRSSSS',
    'SSSRRRRRRRRRRSSS',
    '.SSRRRRRRRRRRSS.',
    '...RRRRRRRRRR...',
    '...RRRRRRRRRR...',
  ];
  const BIG_LEGS = {
    stand: [
      '...RRRRRRRRRR...',
      '..RRRRR..RRRRR..',
      '..RRRR....RRRR..',
      '..RRRR....RRRR..',
      '..RRRR....RRRR..',
      '..RRRR....RRRR..',
      '.BBBBB....BBBBB.',
      'BBBBBB....BBBBBB',
      'BBBBBB....BBBBBB',
    ],
    walkA: [
      '...RRRRRRRRRR...',
      '..RRRRRRRRRRRR..',
      '.RRRRR....RRRRR.',
      'RRRRR......RRRR.',
      'RRRR........RRR.',
      'RRR.........BBBB',
      'BBB.........BBBB',
      'BBBB.........BBB',
      '.BBBB...........',
    ],
    walkB: [
      '....RRRRRRRR....',
      '....RRRRRRRR....',
      '.....RRRRRR.....',
      '.....RRRRRR.....',
      '.....RRRRRR.....',
      '.....RRRRRR.....',
      '....BBBBBBB.....',
      '...BBBBBBBB.....',
      '...BBBBBBBBB....',
    ],
    jump: [
      '...RRRRRRRRRR...',
      '..RRRRRRRRRRRR..',
      '..RRRRR..RRRRRBB',
      '.RRRRR....RRRBBB',
      '.RRRR......RRBBB',
      'BBBB.........BB.',
      'BBBB............',
      'BBB.............',
      '................',
    ],
  };
  const bigRows = ['stand', 'walkA', 'walkB', 'jump'].map(k => BIG_UPPER.concat(BIG_LEGS[k]));
  const SPR = {
    small: smallRows.map(r => makeSprite(r, MARIO_PAL)),
    big: bigRows.map(r => makeSprite(r, MARIO_PAL)),
  };

  const GOOMBA_PAL = { B: '#a04000', T: '#fcb870', K: '#000', W: '#fcfcfc' };
  SPR.goomba = makeSprite([
    '......BBBB......',
    '.....BBBBBB.....',
    '....BBBBBBBB....',
    '...BKWBBBBWKB...',
    '..BBKWWKKWWKBB..',
    '..BBKWKBBKWKBB..',
    '.BBBWWWBBWWWBBB.',
    '.BBBBBBBBBBBBBB.',
    'BBBBBBBBBBBBBBBB',
    'BBBBBTTTTTTBBBBB',
    '.BBBTTTTTTTTBBB.',
    '....TTTTTTTT....',
    '...KKTTTTTTTK...',
    '..KKKKTTTTKKKK..',
    '..KKKKK..KKKKK..',
    '...KKK....KKK...',
  ], GOOMBA_PAL);
  SPR.goombaFlat = makeSprite([
    '....BBBBBBBB....',
    '..BBKWBBBBWKBB..',
    '.BBBBBBBBBBBBBB.',
    'BBBBBTTTTTTBBBBB',
    '...TTTTTTTTTT...',
    '..KKKKK..KKKKK..',
  ], GOOMBA_PAL);

  SPR.mushroom = makeSprite([
    '......RRRR......',
    '....RRRRWWRR....',
    '...RWWRRWWWWR...',
    '..RWWWWRRWWWWR..',
    '.RRWWWWRRRWWRRR.',
    '.RRRWWRRRRRRRRR.',
    'RRRRRRRRWWRRRRRR',
    'RRWWRRRWWWWRRWWR',
    'RWWWWRRWWWWRWWWR',
    'RRWWRRRRWWRRRWWR',
    '.RRRRRRRRRRRRRR.',
    '...SSSSSSSSSS...',
    '..SSSSKSSKSSSS..',
    '..SSSSKSSKSSSS..',
    '..SSSSSSSSSSSS..',
    '...SSSSSSSSSS...',
  ], { R: '#e52521', W: '#fcfcfc', S: '#fcd8a8', K: '#000' });

  // ---- 图块 ----
  const BRICK_PAL = { B: '#c84c0c', K: '#000', L: '#fcbcb0' };
  const TILE = {};
  TILE.ground = makeSprite([
    'BLLLLLLLLKBLLLLB',
    'LBBBBBBBBKLBBBBK',
    'LBBBBBBBBKLBBBBK',
    'LBBBBBBBBKLBBBBK',
    'LBBBBBBBBKLKBBBK',
    'LBBBBBBBBKBKKKKB',
    'LBBBBBBBBKLLLLBK',
    'LBBBBBBBBKLBBBBK',
    'LBBBBBBBBKLBBBBK',
    'LBBBBBBBBKLBBBBK',
    'KKBBBBBBBKLBBBBK',
    'LLKKBBBBKLBBBBBK',
    'LBLLKKKKLBBBBBBK',
    'LBBBLLLKLBBBBBBK',
    'LBBBBBBKLBBBBBKK',
    'BKKKKKKBKKKKKKKB',
  ], BRICK_PAL).r;
  TILE.brick = makeSprite([
    'LLLLLLLLLLLLLLLL',
    'BBBBBBBKBBBBBBBB',
    'BBBBBBBKBBBBBBBB',
    'KKKKKKKKKKKKKKKK',
    'BBBKBBBBBBBKBBBB',
    'BBBKBBBBBBBKBBBB',
    'BBBKBBBBBBBKBBBB',
    'KKKKKKKKKKKKKKKK',
    'BBBBBBBKBBBBBBBB',
    'BBBBBBBKBBBBBBBB',
    'BBBBBBBKBBBBBBBB',
    'KKKKKKKKKKKKKKKK',
    'BBBKBBBBBBBKBBBB',
    'BBBKBBBBBBBKBBBB',
    'BBBKBBBBBBBKBBBB',
    'KKKKKKKKKKKKKKKK',
  ], BRICK_PAL).r;
  const HARD_MID = 'LLLBBBBBBBBBBKKK';
  TILE.hard = makeSprite([
    'BLLLLLLLLLLLLLLK',
    'LBLLLLLLLLLLLLKK',
    'LLBLLLLLLLLLLKKK',
    HARD_MID, HARD_MID, HARD_MID, HARD_MID, HARD_MID,
    HARD_MID, HARD_MID, HARD_MID, HARD_MID, HARD_MID,
    'LLKKKKKKKKKKKBKK',
    'LKKKKKKKKKKKKKBK',
    'KKKKKKKKKKKKKKKB',
  ], BRICK_PAL).r;
  const USED_MID = 'KUUUUUUUUUUUUUUK';
  TILE.used = makeSprite([
    '.KKKKKKKKKKKKKK.',
    USED_MID,
    'KUKUUUUUUUUUUKUK',
    USED_MID, USED_MID, USED_MID, USED_MID, USED_MID,
    USED_MID, USED_MID, USED_MID, USED_MID,
    'KUKUUUUUUUUUUKUK',
    USED_MID, USED_MID,
    '.KKKKKKKKKKKKKK.',
  ], { U: '#a05010', K: '#000' }).r;
  const Q_ROWS = [
    '.DDDDDDDDDDDDDD.',
    'DOOOOOOOOOOOOOOK',
    'DODOOOOOOOOOODOK',
    'DOOOOYYYYYOOOOOK',
    'DOOOYYKKKYYOOOOK',
    'DOOOYYKOOYYKOOOK',
    'DOOOYYKOOYYKOOOK',
    'DOOOOKKOYYYKOOOK',
    'DOOOOOOYYKKKOOOK',
    'DOOOOOOYYKOOOOOK',
    'DOOOOOOOKKOOOOOK',
    'DOOOOOOYYOOOOOOK',
    'DOOOOOOYYKOOOOOK',
    'DODOOOOOKKOOODOK',
    'DOOOOOOOOOOOOOOK',
    'KKKKKKKKKKKKKKKK',
  ];
  TILE.q = ['#f8b800', '#e89000', '#c86c00'].map(o =>
    makeSprite(Q_ROWS, { O: o, D: '#c84c0c', K: '#000', Y: '#883800' }).r);
  // 地下主题：把砖块类图块的红褐色换成蓝色
  function recolor(src, map) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const pairs = Object.entries(map).map(([a, b]) => [hex(a), hex(b)]);
    for (let i = 0; i < d.length; i += 4) {
      for (const [a, b] of pairs) {
        if (d[i] === a[0] && d[i + 1] === a[1] && d[i + 2] === a[2]) { d[i] = b[0]; d[i + 1] = b[1]; d[i + 2] = b[2]; break; }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  const UG_MAP = { '#c84c0c': '#2a5fc0', '#fcbcb0': '#a8d8fc' };
  // 乌龟：头朝右绘制，向左走时用镜像
  const KOOPA_PAL = { G: '#00a800', L: '#80d010', W: '#fcfcfc', Y: '#fcbc3c', K: '#000', O: '#e45c10' };
  const KOOPA_TOP = [
    '..........YYY...',
    '.........YYYYY..',
    '.........YWKYY..',
    '.........YWKYYY.',
    '.........YYYYYY.',
    '..........YYYYYY',
    '..........YYYY..',
    '...........YYY..',
    '.....GGGG..YYY..',
    '...GGLLGGG.YYY..',
    '..GGLGGLGGGYY...',
    '.GLGGGGGGLGYY...',
    '.GGGGLLGGGGWY...',
    'GLGGLGGLGGLWW...',
    'GGGLGGGGLGGGW...',
    'GLGGGGGGGGLGW...',
    '.GGLLGGLLGGW....',
    '.WWWWWWWWWWW....',
    '..WWWWWWWWW.....',
  ];
  SPR.koopa = [
    makeSprite(KOOPA_TOP.concat([
      '...YYY..YYY.....',
      '...YYY..YYY.....',
      '..OOOO..OOOO....',
      '..OOOOO.OOOOO...',
      '................',
    ]), KOOPA_PAL),
    makeSprite(KOOPA_TOP.concat([
      '....YYYYYY......',
      '....YYYYY.......',
      '...OOOOOOO......',
      '...OOOOOOOO.....',
      '................',
    ]), KOOPA_PAL),
  ];
  SPR.shell = makeSprite([
    '................',
    '................',
    '.....GGGGGG.....',
    '...GGLGGGGLGG...',
    '..GLGGLLLLGGLG..',
    '.GGGLGGGGGGLGGG.',
    '.GLGGGLLLLGGGLG.',
    'GGGGLGGGGGGLGGGG',
    'GLGGGGLLLLGGGGLG',
    'GGGLLGGGGGGLLGGG',
    '.WWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWWW',
    '.WWWWWWWWWWWWWW.',
    '..WWWWWWWWWWWW..',
    '................',
    '................',
  ], KOOPA_PAL);

  // 食人花：头朝上，嘴一张一合
  const PIRANHA_PAL = { R: '#e40000', W: '#fcfcfc', G: '#00a800', L: '#80d010' };
  const PIRANHA_STEM = [
    '.......GG.......',
    '.......GG.......',
    '..GG...GG...GG..',
    '.GGGG..GG..GGGG.',
    'GGLGGG.GG.GGGLGG',
    'GGGLGGGGGGGGLGGG',
    '.GGGLGGGGGGLGGG.',
    '..GGGGGGGGGGGG..',
    '....GGGGGGGG....',
    '.......GG.......',
    '.......GG.......',
    '.......GG.......',
    '.......GG.......',
  ];
  const PIRANHA_HEAD = [
    '....RRR..RRR....',
    '...RRWRR.RWRR...',
    '..RRRRRR.RRRRR..',
    '..RWRRRR.RRRWR..',
    '..RRRRRW.WRRRR..',
    '..RRRRRR.RRRRR..',
    '...RRWRR.RRWR...',
    '...RRRRR.RRRR...',
    '....RRRR.RRR....',
    '.....RRRRRR.....',
    '......RRRR......',
  ];
  SPR.piranha = [
    makeSprite(PIRANHA_HEAD.concat(PIRANHA_STEM), PIRANHA_PAL),
    makeSprite(PIRANHA_HEAD.map(r => r.slice(0, 8) + (r[8] === '.' && r[7] === 'R' ? 'R' : r[8]) + r.slice(9)).concat(PIRANHA_STEM), PIRANHA_PAL),
  ];

  const CS_MAP = { '#c84c0c': '#7c7c7c', '#fcbcb0': '#c8c8c8' };
  const TILE_CS = {
    ground: recolor(TILE.ground, CS_MAP),
    brick: recolor(TILE.brick, CS_MAP),
    hard: recolor(TILE.hard, CS_MAP),
  };
  const TILE_UG = {
    ground: recolor(TILE.ground, UG_MAP),
    brick: recolor(TILE.brick, UG_MAP),
    hard: recolor(TILE.hard, UG_MAP),
  };
  // 空中关：树顶平台和树干
  const TREE_PAL = { K: '#000', L: '#b8f818', G: '#00a800', D: '#005800' };
  TILE.treeM = makeSprite([
    'KKKKKKKKKKKKKKKK',
    'LLLLLLLLLLLLLLLL',
    'LLGLLLLLLLGLLLLL',
    'GGGGGGGGGGGGGGGG',
    'GGGDGGGGGGGGDGGG',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGGDGGGGGGGG',
    'GGGGGGGGGGGGGGGG',
    'GDGGGGGGGGGGGGDG',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGDGGGGGGGGG',
    'GGGGGGGGGGGGGGGG',
    'GGGGGGGGGGDGGGGG',
    'GGGGGGGGGGGGGGGG',
    'DDDDDDDDDDDDDDDD',
    'KKKKKKKKKKKKKKKK',
  ], TREE_PAL).r;
  const TREE_CAP = makeSprite([
    '....KKKKKKKKKKKK',
    '..KKLLLLLLLLLLLL',
    '.KLLLGLLLLLLLGLL',
    '.KLGGGGGGGGGGGGG',
    'KLGGGDGGGGGGGGGG',
    'KLGGGGGGGGGGGGGG',
    'KGGGGGGGGDGGGGGG',
    'KGGGGGGGGGGGGGGG',
    'KGDGGGGGGGGGGGDG',
    'KGGGGGGGGGGGGGGG',
    'KGGGGGGDGGGGGGGG',
    'KGGGGGGGGGGGGGGG',
    '.KGGGGGGGGGDGGGG',
    '.KDGGGGGGGGGGGGG',
    '..KKDDDDDDDDDDDD',
    '....KKKKKKKKKKKK',
  ], TREE_PAL);
  TILE.treeL = TREE_CAP.r;
  TILE.treeR = TREE_CAP.l;
  TILE.trunk = makeSprite(Array.from({ length: 16 }, (_, i) =>
    i % 4 < 2 ? '..KTTSTTTTSTTK..' : '..KTSTTTTSTTTK..'), { K: '#000', T: '#c07838', S: '#8c4c18' }).r;

  const PIPE_PAL = { G: '#00a800', H: '#b8f818', D: '#005800', K: '#000' };
  const rep = (s, n) => Array(n).fill(s);
  TILE.pipeTL = makeSprite(['KKKKKKKKKKKKKKKK', ...rep('KGHHGGGGGGGGGGGG', 14), 'KKKKKKKKKKKKKKKK'], PIPE_PAL).r;
  TILE.pipeTR = makeSprite(['KKKKKKKKKKKKKKKK', ...rep('GGGGGGGDGDDDDDDK', 14), 'KKKKKKKKKKKKKKKK'], PIPE_PAL).r;
  TILE.pipeL = makeSprite(rep('..KGHHGGGGGGGGGG', 16), PIPE_PAL).r;
  TILE.pipeR = makeSprite(rep('GGGGGGDGDDDDDK..', 16), PIPE_PAL).r;

  // ============================================================
  // 关卡数据
  // ============================================================
  // 图块编号
  const E = 0, GROUND = 1, BRICK = 2, QCOIN = 3, QMUSH = 4, USED = 5, HARD = 6,
    PTL = 7, PTR = 8, PL = 9, PR = 10, BRICK_COINS = 11, COIN = 12,
    TREE_L = 13, TREE_M = 14, TREE_R = 15, TRUNK = 16, LAVA = 17, BRIDGE = 18, AXE = 19, CANNON = 20;
  const tiles = new Uint8Array(LW * LH);
  const coinBricks = new Map();

  const getT = (x, y) => (x < 0 || x >= LW || y < 0 || y >= LH) ? E : tiles[y * LW + x];
  const setT = (x, y, v) => { if (x >= 0 && x < LW && y >= 0 && y < LH) tiles[y * LW + x] = v; };
  const solid = (x, y) => {
    if (x < 0 || x >= LW) return true;
    if (y < 0 || y >= LH) return false;
    const t = tiles[y * LW + x];
    return t !== E && t !== COIN && t !== TRUNK && t !== LAVA && t !== AXE;
  };

  // ---- 搭建关卡用的小工具 ----
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const row = (xs, y, v) => xs.forEach(x => setT(x, y, v));
  const groundWithGaps = gaps => {
    for (let x = 0; x < LW; x++) {
      if (gaps.some(([a, b]) => x >= a && x <= b)) continue;
      setT(x, 13, GROUND);
      setT(x, 14, GROUND);
    }
  };
  const pipe = (x, h) => {
    const top = 13 - h;
    setT(x, top, PTL); setT(x + 1, top, PTR);
    for (let y = top + 1; y < 13; y++) { setT(x, y, PL); setT(x + 1, y, PR); }
  };
  const stairs = (x, heights) => heights.forEach((h, i) => {
    for (let k = 0; k < h; k++) setT(x + i, 12 - k, HARD);
  });
  // 树顶平台：x 起始列，w 宽度（≥3），top 树顶所在行；树干一直延伸到画面底部
  const tree = (x, w, top) => {
    setT(x, top, TREE_L);
    for (let i = 1; i < w - 1; i++) setT(x + i, top, TREE_M);
    setT(x + w - 1, top, TREE_R);
    const tc = x + Math.floor((w - 1) / 2);
    for (let y = top + 1; y < LH; y++) setT(tc, y, TRUNK);
  };

  // 背景装饰（山、草丛、云）
  const DECO_1 = [];
  for (let b = 0; b < LW - 16; b += 48) {
    DECO_1.push({ k: 'hill', x: b, s: 2 }, { k: 'cloud', x: b + 8, y: 3, n: 1 },
      { k: 'bush', x: b + 11, n: 3 }, { k: 'hill', x: b + 16, s: 1 },
      { k: 'cloud', x: b + 19, y: 2, n: 1 }, { k: 'bush', x: b + 23, n: 1 },
      { k: 'cloud', x: b + 27, y: 3, n: 3 }, { k: 'cloud', x: b + 36, y: 2, n: 2 },
      { k: 'bush', x: b + 41, n: 2 });
  }

  const LEVELS = [
    {
      name: '1-1',
      song: 0,
      ugEnd: 0,          // 地下区域结束列（0 表示整关都在地上）
      checkpoint: [90, 12],   // [列, 站立行]
      deco: DECO_1,
      enemies: [
        [22, 12], [40, 12], [51, 12], [52.5, 12], [80, 4], [82, 4],
        [97, 12], [98.5, 12], [114, 12], [115.5, 12], [124, 12], [125.5, 12],
        [128, 12], [129.5, 12], [174, 12], [175.5, 12],
      ],
      build() {
        groundWithGaps([[69, 70], [86, 88], [153, 154]]);
        setT(16, 9, QCOIN);
        row([20, 22, 24], 9, BRICK);
        setT(21, 9, QMUSH);
        setT(23, 9, QCOIN);
        setT(22, 5, QCOIN);
        pipe(28, 2); pipe(38, 3); pipe(46, 4); pipe(57, 4);

        row([77, 79], 9, BRICK);
        setT(78, 9, QMUSH);
        row(range(80, 87), 5, BRICK);
        row([91, 92, 93], 5, BRICK);
        setT(94, 5, QCOIN);
        setT(94, 9, BRICK_COINS);
        row([100, 101], 9, BRICK);
        row([106, 112], 9, QCOIN);
        setT(109, 9, QMUSH);
        setT(109, 5, QCOIN);
        setT(118, 9, BRICK);
        row([121, 122, 123], 5, BRICK);
        row([128, 131], 5, BRICK);
        row([129, 130], 5, QCOIN);
        row([129, 130], 9, BRICK);

        stairs(134, [1, 2, 3, 4]);
        stairs(140, [4, 3, 2, 1]);
        stairs(148, [1, 2, 3, 4, 4]);
        stairs(155, [4, 3, 2, 1]);
        pipe(163, 2);
        row([168, 169, 171], 9, BRICK);
        setT(170, 9, QCOIN);
        pipe(179, 2);
        stairs(181, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
        setT(FLAG_X, 12, HARD);
      },
    },
    {
      name: '1-2',
      song: 1,
      ugEnd: 182,
      checkpoint: [90, 12],
      deco: [
        { k: 'cloud', x: 186, y: 2, n: 1 }, { k: 'hill', x: 195, s: 1 },
        { k: 'cloud', x: 199, y: 3, n: 2 }, { k: 'bush', x: 207, n: 1 },
      ],
      enemies: [
        [16, 12], [18, 12], [27, 12], [31, 12],
        [47, 8], [51, 8], [60, 12], [61.5, 12],
        [88, 12], [98, 12], [99.5, 12], [106, 12], [107.5, 12],
        [125, 8], [134, 8], [136, 8], [145, 12], [146.5, 12],
        [161, 12], [162.5, 12], [164, 12], [172, 12], [173.5, 12],
      ],
      build() {
        groundWithGaps([[76, 78], [127, 132], [154, 155]]);
        // 入口墙和天花板
        for (let y = 2; y <= 12; y++) setT(0, y, BRICK);
        row(range(6, 179), 2, BRICK);

        // 开场：一排问号砖
        setT(10, 9, QMUSH);
        row([11, 12, 13, 14], 9, QCOIN);

        // 高低石柱，柱顶上方有金币
        const pillars = [[24, 1], [26, 2], [28, 3], [30, 4], [32, 3], [34, 2]];
        for (const [x, h] of pillars) {
          stairs(x, [h]);
          setT(x, 12 - h - 1, COIN);
        }

        // 双层砖块走廊，中间一排金币
        row(range(44, 55), 9, BRICK);
        row(range(44, 55), 5, BRICK);
        row(range(46, 53), 8, COIN);
        setT(50, 9, BRICK_COINS);
        setT(49, 5, QCOIN);

        // 小台阶和第一个坑
        stairs(64, [1, 2, 3]);
        row(range(68, 72), 9, BRICK);
        row(range(68, 72), 8, COIN);

        // 水管区
        pipe(84, 2);
        pipe(94, 3);
        row([94, 95], 8, COIN);
        pipe(102, 4);
        row([102, 103], 7, COIN);
        row([109, 111], 9, BRICK);
        setT(110, 9, QMUSH);

        // 大坑上方的长砖桥
        row(range(122, 139), 9, BRICK);
        row(range(126, 135), 8, COIN);
        row([125, 126], 5, QCOIN);

        // 台阶夹着的坑，坑上悬着金币
        stairs(150, [1, 2, 3, 4]);
        row([154, 155], 6, COIN);
        stairs(156, [4, 3, 2, 1]);

        // 最后一段敌人群
        row([164, 165, 167, 168], 9, BRICK);
        setT(166, 9, QCOIN);
        row(range(170, 176), 5, COIN);

        // 出口：回到地面，登上台阶去旗杆
        stairs(186, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
        setT(FLAG_X, 12, HARD);
      },
    },
  ];

  LEVELS.push({
    name: '1-3',
    song: 2,
    ugEnd: 0,
    checkpoint: [90, 10],
    deco: [
      { k: 'hill', x: 0, s: 2 }, { k: 'bush', x: 9, n: 1 },
      ...Array.from({ length: 9 }, (_, i) => [
        { k: 'cloud', x: i * 22 + 5, y: 2, n: 1 },
        { k: 'cloud', x: i * 22 + 16, y: 4, n: i % 3 + 1 },
      ]).flat(),
      { k: 'hill', x: 180, s: 1 }, { k: 'bush', x: 207, n: 1 },
    ],
    enemies: [
      [37, 9], [56, 7], [58, 7], [70, 5], [97, 7],
      [115, 8], [131, 9], [133, 9], [162, 7], [164, 7], [183, 12], [185, 12],
    ],
    // 升降平台：列、行、方向、往返范围（按方向轴，单位为图块）
    platforms: [
      { x: 43, y: 9, axis: 'x', min: 43, max: 52 },
      { x: 76, y: 5, axis: 'y', min: 4, max: 11 },
      { x: 100, y: 7, axis: 'x', min: 100, max: 110 },
      { x: 126, y: 9, axis: 'y', min: 5, max: 11 },
      { x: 142, y: 9, axis: 'x', min: 142, max: 152 },
      { x: 168, y: 10, axis: 'x', min: 168, max: 176 },
    ],
    build() {
      // 只有起点和终点有地面，中间全靠树顶和升降平台
      for (let x = 0; x < LW; x++) {
        if (x <= 15 || x >= 179) { setT(x, 13, GROUND); setT(x, 14, GROUND); }
      }
      tree(17, 4, 11);
      tree(23, 5, 9);
      tree(30, 3, 7);
      row([30, 31, 32], 5, COIN);
      tree(35, 6, 10);
      setT(38, 6, QMUSH);

      tree(55, 5, 8);
      tree(62, 3, 10);
      tree(67, 7, 6);
      row([69, 70, 71], 4, COIN);
      tree(81, 4, 10);
      tree(86, 8, 11);
      tree(96, 3, 8);

      tree(113, 5, 9);
      setT(115, 5, QCOIN);
      tree(120, 4, 6);
      row(range(120, 123), 4, COIN);
      tree(130, 6, 10);
      tree(138, 3, 7);

      tree(155, 4, 11);
      tree(161, 5, 8);
      setT(163, 4, QMUSH);

      stairs(188, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
      setT(FLAG_X, 12, HARD);
    },
  });

  LEVELS.push({
    name: '1-4',
    song: 0,
    ugEnd: 0,
    sky: '#141e4c',     // 夜空
    stars: true,
    checkpoint: [90, 12],
    deco: DECO_1.filter(d => d.k !== 'cloud'),
    // 第三项 'koopa' 表示乌龟，不写就是栗子怪
    enemies: [
      [20, 12, 'koopa'], [30, 12], [52, 7, 'koopa'], [58, 12, 'koopa'],
      [62, 12], [63.5, 12], [65, 12], [80, 12], [88, 12, 'koopa'],
      [110, 12, 'koopa'], [114, 12], [125, 12, 'koopa'], [127, 12, 'koopa'],
      [135, 12], [136.5, 12], [138, 12], [156, 12, 'koopa'],
      [165, 12], [166.5, 12], [176, 12, 'koopa'], [180, 12],
    ],
    build() {
      groundWithGaps([[40, 42], [95, 97], [150, 152]]);
      row([10, 11, 13, 14], 9, BRICK);
      setT(12, 9, QMUSH);
      setT(12, 5, QCOIN);
      pipe(24, 2);
      pipe(34, 3);

      // 高处砖块平台，上面的乌龟被踩成壳后会掉下来
      row(range(47, 56), 8, BRICK);
      row(range(49, 54), 5, COIN);

      stairs(70, [1, 2, 3, 4]);
      stairs(74, [4, 3, 2, 1]);
      row([82, 84], 9, QCOIN);
      setT(83, 9, QMUSH);

      pipe(104, 4);
      row(range(108, 114), 9, BRICK);
      setT(111, 9, BRICK_COINS);
      row(range(108, 114), 5, COIN);
      pipe(118, 3);

      row([142, 144, 146], 9, QCOIN);
      row([143, 145], 9, BRICK);
      pipe(160, 2);
      pipe(170, 3);

      stairs(186, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
      setT(FLAG_X, 12, HARD);
    },
  });

  LEVELS.push({
    name: '1-5',
    song: 3,
    ugEnd: 0,
    theme: 'castle',
    checkpoint: [100, 12],
    deco: [],
    enemies: [[57, 12], [74, 12], [97, 12], [128, 12, 'koopa'], [145, 12], [155, 12]],
    // 旋转火焰棍：[中心列, 中心行, 火球数, 方向(1 顺时针 / -1 逆时针)]
    firebars: [
      [26, 9, 6, 1], [45, 12, 5, -1], [66, 7, 5, 1], [108, 9, 6, 1],
      [120, 12, 5, 1], [126, 8, 6, -1], [150, 9, 6, 1], [160, 12, 5, -1], [168, 9, 6, 1],
    ],
    platforms: [{ x: 81, y: 10, axis: 'x', min: 81, max: 89 }],
    // 终点吊桥上的魔王：出生列和巡逻范围
    boss: { x: 186, min: 181, max: 190 },
    build() {
      const lavaPits = [[13, 15], [31, 34], [51, 54], [81, 92], [111, 114], [134, 136], [180, 192]];
      for (let x = 0; x < LW; x++) {
        const lava = lavaPits.some(([a, b]) => x >= a && x <= b);
        setT(x, 13, lava ? LAVA : GROUND);
        setT(x, 14, lava ? LAVA : GROUND);
        setT(x, 0, BRICK);
        setT(x, 1, BRICK);
      }
      setT(18, 9, QMUSH);
      // 低矮的天花板
      for (let x = 60; x <= 72; x++) for (let y = 2; y <= 6; y++) setT(x, y, BRICK);
      setT(104, 9, QMUSH);
      // 岩浆两边的石柱
      stairs(131, [2, 3, 4]);
      stairs(137, [4, 3, 2]);
      // 上吊桥前的台阶
      stairs(172, [1, 2, 3, 4, 4, 4, 4, 4]);
      row(range(180, 192), 9, BRIDGE);
      setT(193, 8, AXE);
      for (let x = 193; x < LW; x++) for (let y = 9; y <= 12; y++) setT(x, y, HARD);
      // 火焰棍的中心方块
      for (const [x, y] of this.firebars) setT(x, y, USED);
    },
  });

  // 炮台：在 (x, y) 放炮口，下面用石块垫到地面
  const cannon = (x, y) => {
    setT(x, y, CANNON);
    for (let yy = y + 1; yy <= 12; yy++) setT(x, yy, HARD);
  };

  // ---- 世界 2：难度提高（时间更少、敌人更快、新机关） ----
  LEVELS.push({
    name: '2-1',
    song: 2,
    ugEnd: 0,
    sky: '#f49a5c',     // 黄昏
    time: 300,
    enemySpeed: 0.75,
    checkpoint: [84, 12],
    deco: DECO_1,
    enemies: [
      [18, 12], [26, 12, 'koopa'], [34, 12], [35.5, 12], [43, 12, 'koopa'],
      [56, 12], [57.5, 12], [64, 12, 'koopa'], [74, 12], [75.5, 12],
      [93, 12, 'koopa'], [100, 12], [108, 12], [109.5, 12], [120, 12, 'koopa'],
      [130, 12], [136, 12], [137.5, 12], [146, 12, 'koopa'], [155, 12],
      [170, 12], [171.5, 12], [180, 12, 'koopa'],
    ],
    // 会钻出食人花的水管（水管左列）
    piranhas: [14, 30, 38, 60, 68, 96, 124, 150, 176],
    // 炮台 [列, 炮口行]：第 12 行贴地打小个子，第 11 行打大个子
    cannons: [[52, 12], [86, 11], [132, 12], [158, 11], [184, 12]],
    build() {
      groundWithGaps([[20, 22], [46, 49], [78, 81], [112, 116], [140, 143], [164, 167]]);
      row([6, 7, 9, 10], 9, BRICK);
      setT(8, 9, QMUSH);
      setT(8, 5, QCOIN);
      pipe(14, 2); pipe(30, 3); pipe(38, 4); pipe(60, 2); pipe(68, 3);
      pipe(96, 4); pipe(124, 3); pipe(150, 2); pipe(176, 3);
      for (const [x, y] of this.cannons) cannon(x, y);
      row([102, 103, 105, 106], 9, BRICK);
      setT(104, 9, QMUSH);
      row(range(112, 116), 8, COIN);
      row([141, 142], 7, COIN);
      row([165, 166], 7, COIN);
      stairs(186, [1, 2, 3, 4, 5, 6, 7, 8, 8]);
      setT(FLAG_X, 12, HARD);
    },
  });

  LEVELS.push({
    name: '2-2',
    song: 3,
    ugEnd: 0,
    theme: 'castle',
    time: 300,
    enemySpeed: 0.75,
    firebarSpeed: 0.045,
    checkpoint: [100, 12],
    deco: [],
    enemies: [
      [36, 12, 'koopa'], [56, 12], [57.5, 12], [78, 12, 'koopa'], [92, 12],
      [123, 12], [142, 12, 'koopa'], [160, 12], [161.5, 12],
    ],
    firebars: [
      [18, 9, 6, 1], [34, 12, 6, -1], [52, 8, 7, 1], [74, 9, 6, -1], [96, 12, 6, 1],
      [118, 8, 7, -1], [140, 10, 6, 1], [166, 9, 7, -1],
    ],
    // 会从岩浆里跳出来的火球（所在列）
    podoboos: [11, 26, 43, 63, 87, 107, 128, 153, 185],
    cannons: [[48, 12], [136, 11]],
    platforms: [
      { x: 60, y: 10, axis: 'x', min: 60, max: 64 },
      { x: 104, y: 9, axis: 'x', min: 104, max: 108 },
      { x: 150, y: 10, axis: 'x', min: 150, max: 154 },
    ],
    // 更凶的魔王：喷火更频繁、一次两颗、跳得更勤
    boss: { x: 186, min: 181, max: 190, fireRate: 80, double: true, hop: 70 },
    build() {
      const lavaPits = [[10, 13], [24, 28], [40, 45], [60, 66], [84, 89], [104, 110], [126, 131], [150, 156], [180, 192]];
      for (let x = 0; x < LW; x++) {
        const lava = lavaPits.some(([a, b]) => x >= a && x <= b);
        setT(x, 13, lava ? LAVA : GROUND);
        setT(x, 14, lava ? LAVA : GROUND);
        setT(x, 0, BRICK);
        setT(x, 1, BRICK);
      }
      setT(14, 9, QMUSH);
      setT(100, 9, QMUSH);
      for (let x = 30; x <= 38; x++) for (let y = 2; y <= 6; y++) setT(x, y, BRICK);
      for (let x = 112; x <= 122; x++) for (let y = 2; y <= 7; y++) setT(x, y, BRICK);
      for (const [x, y] of this.cannons) cannon(x, y);
      stairs(172, [1, 2, 3, 4, 4, 4, 4, 4]);
      row(range(180, 192), 9, BRIDGE);
      setT(193, 8, AXE);
      for (let x = 193; x < LW; x++) for (let y = 9; y <= 12; y++) setT(x, y, HARD);
      for (const [x, y] of this.firebars) setT(x, y, USED);
    },
  });

  function buildLevel() {
    tiles.fill(E);
    coinBricks.clear();
    LEVELS[game.level].build();
  }

  // ============================================================
  // 游戏状态
  // ============================================================
  let best = 0;
  try { best = parseInt(localStorage.getItem('smb_best') || '0', 10) || 0; } catch (e) { /* ignore */ }
  // 已解锁的最远关卡（进入过的关卡都能在标题画面选）
  let unlocked = 0;
  try { unlocked = parseInt(localStorage.getItem('smb_unlocked') || '0', 10) || 0; } catch (e) { /* ignore */ }
  unlocked = Math.max(0, Math.min(unlocked, LEVELS.length - 1));
  let titleArrows = null;   // 标题画面选关箭头的点击区域（逻辑坐标）

  const game = {
    state: 'title',   // title | intro | play | dying | flag | clear | gameover
    score: 0, coins: 0, lives: 3, time: 400, timeTick: 0,
    frame: 0, stateT: 0, checkpoint: false,
    flagY: 0, flagPhase: 0, combo: 0,
    level: unlocked, carryBig: false,
    sel: unlocked,    // 标题画面选中的关卡
  };
  let paused = false;
  let camX = 0;
  let player = null;
  let enemies = [];
  let items = [];
  let effects = [];
  let platforms = [];
  let firebars = [];
  let boss = null;
  let hazards = [];   // 魔王喷出的火球
  let piranhas = [];
  let cannons = [];
  let bullets = [];   // 炮弹
  let podoboos = [];  // 岩浆火球
  const bumps = new Map();   // 图块索引 -> 顶起动画帧

  function newPlayer(x) {
    return {
      x, y: GROUND_Y - 14, w: 12, h: 14, vx: 0, vy: 0,
      big: false, onGround: true, facing: 1, anim: 0, coyote: 0,
      invuln: 0, growT: 0, runT: 0, skid: false, hidden: false, prevBottom: 0,
    };
  }

  function newGame() {
    game.score = 0;
    game.coins = 0;
    game.lives = 3;
    game.checkpoint = false;
    game.level = game.sel;
    game.carryBig = false;
    startIntro();
  }

  function startIntro() {
    game.state = 'intro';
    game.stateT = 0;
  }

  function startLevel() {
    if (game.level > unlocked) {
      unlocked = game.level;
      try { localStorage.setItem('smb_unlocked', String(unlocked)); } catch (e) { /* ignore */ }
    }
    buildLevel();
    bumps.clear();
    items = [];
    effects = [];
    const lv = LEVELS[game.level];
    const sx = game.checkpoint ? lv.checkpoint[0] * T : 40;
    const standRow = game.checkpoint ? lv.checkpoint[1] : 12;
    player = newPlayer(sx);
    if (game.carryBig) { player.big = true; player.h = 28; }
    player.y = (standRow + 1) * T - player.h;
    camX = Math.max(0, sx - 40);
    platforms = (lv.platforms || []).map(d => ({
      x: d.x * T, y: d.y * T, w: 3 * T, h: 8, axis: d.axis,
      min: d.min * T, max: d.max * T, speed: 0.6, dir: 1, dx: 0, dy: 0,
    }));
    firebars = (lv.firebars || []).map(([x, y, len, dir]) => ({
      cx: x * T + 8, cy: y * T + 8, len, dir, a: 0, speed: lv.firebarSpeed || 0.03,
    }));
    hazards = [];
    piranhas = (lv.piranhas || []).map((x, i) => {
      let top = 12;
      for (let y = 0; y < LH; y++) if (getT(x, y) === PTL) { top = y; break; }
      return { x: x * T + 8, top: top * T, off: 0, phase: 'hidden', t: (i * 37) % 90 };
    });
    cannons = (lv.cannons || []).map(([x, y], i) => ({ x: x * T, y: y * T, t: 60 + (i * 53) % 120 }));
    bullets = [];
    podoboos = (lv.podoboos || []).map((x, i) => ({ x: x * T + 2, y: 15 * T, w: 12, h: 14, vy: 0, t: (i * 29) % 100 }));
    boss = lv.boss ? {
      x: lv.boss.x * T, y: 9 * T - 30, w: 28, h: 30, vx: -0.5, vy: 0,
      minX: lv.boss.min * T, maxX: lv.boss.max * T, face: -1, t: 0,
      hopT: 120, fireT: 90, mouthT: 0, active: false, onGround: false,
      fireRate: lv.boss.fireRate || 140, double: !!lv.boss.double, hop: lv.boss.hop || 100,
    } : null;
    game.axePhase = 0;
    enemies = lv.enemies.map(([tx, ty, type = 'goomba']) => ({
      type, x: tx * T + 1, y: type === 'koopa' ? ty * T - 6 : ty * T + 2,
      w: 14, h: type === 'koopa' ? 22 : 14, vx: -(lv.enemySpeed || 0.5), speed: lv.enemySpeed || 0.5,
      vy: 0, kickT: 0, shellCombo: 0,
      state: 'walk', active: false, anim: 0, t: 0, remove: false,
    }));
    game.time = lv.time || 400;
    game.timeTick = 0;
    game.flagY = 3 * T + 10;
    game.flagPhase = 0;
    game.combo = 0;
    game.state = 'play';
    game.stateT = 0;
    jumpBuf = 0;
    Sound.startBgm(false, lv.song);
  }

  // 回到标题画面：重置为第一关的场景
  function toTitle() {
    game.state = 'title';
    game.stateT = 0;
    game.sel = Math.min(game.sel, unlocked);
    game.level = game.sel;
    buildLevel();
    player = newPlayer(40);
    enemies = [];
    platforms = [];
    firebars = [];
    hazards = [];
    boss = null;
    piranhas = [];
    cannons = [];
    bullets = [];
    podoboos = [];
    items = [];
    effects = [];
    bumps.clear();
    camX = 0;
  }

  // 标题画面切换关卡，背景换成那一关的场景
  function changeSel(d) {
    if (unlocked === 0) return;
    const n = Math.max(0, Math.min(unlocked, game.sel + d));
    if (n === game.sel) return;
    game.sel = n;
    Sound.sfx.tick();
    toTitle();
  }

  function anyPress() {
    Sound.init();
    if (paused) return;
    if (game.state === 'title') { newGame(); jumpBuf = 0; }
    else if ((game.state === 'gameover' || game.state === 'clear') && game.stateT > 45) {
      toTitle();
      jumpBuf = 0;
    }
  }

  function togglePause() {
    if (!['play', 'flag', 'dying', 'axe'].includes(game.state)) return;
    paused = !paused;
    Sound.init();
    if (paused) { Sound.stopBgm(); Sound.sfx.pause(); }
    else if (game.state === 'play') Sound.startBgm(game.time <= 100, LEVELS[game.level].song);
    document.getElementById('pauseBtn').textContent = paused ? '▶' : '❚❚';
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !paused) togglePause();
  });

  function addScore(pts, x, y) {
    game.score += pts;
    if (x !== undefined) effects.push({ type: 'text', text: String(pts), x, y, t: 0 });
  }
  function addCoin() {
    game.coins++;
    if (game.coins >= 100) {
      game.coins -= 100;
      game.lives++;
      Sound.sfx.oneup();
    }
  }

  // ============================================================
  // 碰撞
  // ============================================================
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function collideX(e) {
    const y0 = Math.floor(e.y / T);
    const y1 = Math.floor((e.y + e.h - 0.001) / T);
    if (e.vx > 0) {
      const tx = Math.floor((e.x + e.w - 0.001) / T);
      for (let ty = y0; ty <= y1; ty++) {
        if (solid(tx, ty)) { e.x = tx * T - e.w; return true; }
      }
    } else if (e.vx < 0) {
      const tx = Math.floor(e.x / T);
      for (let ty = y0; ty <= y1; ty++) {
        if (solid(tx, ty)) { e.x = (tx + 1) * T; return true; }
      }
    }
    return false;
  }

  function collideY(e) {
    const x0 = Math.floor(e.x / T);
    const x1 = Math.floor((e.x + e.w - 0.001) / T);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h) / T);
      for (let tx = x0; tx <= x1; tx++) {
        if (solid(tx, ty)) { e.y = ty * T - e.h; return { floor: true }; }
      }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / T);
      let bestTx = -1, bestD = 1e9;
      for (let tx = x0; tx <= x1; tx++) {
        if (!solid(tx, ty)) continue;
        const d = Math.abs(tx * T + T / 2 - (e.x + e.w / 2));
        if (d < bestD) { bestD = d; bestTx = tx; }
      }
      if (bestTx >= 0) { e.y = (ty + 1) * T; return { ceil: true, tx: bestTx, ty }; }
    }
    return null;
  }

  // ============================================================
  // 方块被顶
  // ============================================================
  function hitFromBelow(tx, ty) {
    const top = ty * T;
    for (const e of enemies) {
      if ((e.state !== 'walk' && e.state !== 'shell') || !e.active) continue;
      if (Math.abs(e.y + e.h - top) < 4 && e.x + e.w > tx * T && e.x < tx * T + T) {
        e.state = 'flip';
        e.vy = -3.5;
        e.vx = e.x + e.w / 2 < tx * T + 8 ? -0.8 : 0.8;
        addScore(100, e.x, e.y);
        Sound.sfx.kick();
      }
    }
    for (const it of items) {
      if (it.rise > 0) continue;
      if (Math.abs(it.y + it.h - top) < 4 && it.x + it.w > tx * T && it.x < tx * T + T) {
        it.vy = -4;
        it.vx = it.x + it.w / 2 < tx * T + 8 ? -Math.abs(it.vx) : Math.abs(it.vx);
      }
    }
  }

  function bumpBlock(tx, ty) {
    const t = getT(tx, ty);
    const key = ty * LW + tx;
    if (t === QCOIN || t === QMUSH || t === BRICK_COINS) {
      bumps.set(key, 0);
      if (t === QMUSH) {
        items.push({ type: 'mush', x: tx * T + 1, y: ty * T, w: 14, h: 16, vx: 0, vy: 0, rise: 16 });
        Sound.sfx.sprout();
        setT(tx, ty, USED);
      } else {
        spawnCoinPop(tx, ty);
        if (t === BRICK_COINS) {
          const n = (coinBricks.get(key) || 0) + 1;
          coinBricks.set(key, n);
          if (n >= 8) setT(tx, ty, USED);
        } else {
          setT(tx, ty, USED);
        }
      }
      hitFromBelow(tx, ty);
    } else if (t === BRICK) {
      if (player.big) {
        setT(tx, ty, E);
        const cx = tx * T + 8, cy = ty * T + 8;
        [[-1, -5], [1, -5], [-1, -3], [1, -3]].forEach(([vx, vy], i) => {
          effects.push({ type: 'debris', x: cx + (i % 2 ? 2 : -6), y: cy + (i < 2 ? -6 : 2), vx: vx * 1.2, vy, t: 0 });
        });
        addScore(50);
        Sound.sfx.brk();
      } else {
        bumps.set(key, 0);
        Sound.sfx.bump();
      }
      hitFromBelow(tx, ty);
    } else {
      Sound.sfx.bump();
    }
  }

  function spawnCoinPop(tx, ty) {
    effects.push({ type: 'coin', x: tx * T + 4, y: ty * T - 14, vy: -5.5, t: 0 });
    addCoin();
    game.score += 200;
    Sound.sfx.coin();
  }

  // ============================================================
  // 玩家
  // ============================================================
  function setBig(big) {
    const p = player;
    if (big === p.big) return;
    p.big = big;
    if (big) { p.y -= 14; p.h = 28; } else { p.y += 14; p.h = 14; }
    p.growT = 48;
  }

  function hurtPlayer() {
    const p = player;
    if (p.invuln > 0 || p.growT > 0) return;
    if (p.big) {
      setBig(false);
      p.invuln = 120;
      Sound.sfx.powerdown();
    } else {
      killPlayer(false);
    }
  }

  function killPlayer(pit) {
    game.state = 'dying';
    game.stateT = 0;
    player.vx = 0;
    player.vy = pit ? 0 : -5;
    player.pit = pit;
    if (player.big) { player.big = false; player.h = 14; }
    game.carryBig = false;
    Sound.stopBgm();
    Sound.sfx.die();
  }

  // 吃掉与玩家重叠的金币图块
  function collectCoins(p) {
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - 0.001) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (getT(tx, ty) !== COIN) continue;
        setT(tx, ty, E);
        addCoin();
        game.score += 200;
        Sound.sfx.coin();
      }
    }
  }

  function updatePlatforms() {
    for (const pl of platforms) {
      const ox = pl.x, oy = pl.y;
      if (pl.axis === 'x') {
        pl.x += pl.speed * pl.dir;
        if (pl.x >= pl.max) { pl.x = pl.max; pl.dir = -1; } else if (pl.x <= pl.min) { pl.x = pl.min; pl.dir = 1; }
      } else {
        pl.y += pl.speed * pl.dir;
        if (pl.y >= pl.max) { pl.y = pl.max; pl.dir = -1; } else if (pl.y <= pl.min) { pl.y = pl.min; pl.dir = 1; }
      }
      pl.dx = pl.x - ox;
      pl.dy = pl.y - oy;
    }
  }

  function touchesTile(e, id) {
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.001) / T);
    const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) if (getT(tx, ty) === id) return true;
    }
    return false;
  }

  function updatePlayer() {
    const p = player;
    // 站在升降平台上时跟着平台移动
    if (p.plat) {
      p.x += p.plat.dx;
      p.y = p.plat.y - p.h;
    }
    const L = input.left, R = input.right;
    // 自动加速：朝同一方向持续前进约 0.5 秒后开始提速，约 1.2 秒达到跑步速度；
    // 松开方向、反向或撞墙都会重新计时（空中保持不变）
    const dir = R && !L ? 1 : L && !R ? -1 : 0;
    if (dir === 0 || dir !== Math.sign(p.vx || dir)) { if (p.onGround) p.runT = 0; }
    else p.runT++;
    const runK = Math.max(0, Math.min(1, (p.runT - 30) / 40));
    const maxV = 1.5 + runK * 1.1;
    const acc = p.onGround ? 0.07 + runK * 0.02 : 0.09;   // 空中也能较快转向

    if (R && !L) {
      if (p.onGround) p.facing = 1;
      if (p.vx < 0 && p.onGround) { p.vx += 0.18; p.skid = true; }
      else { p.skid = false; if (p.vx < maxV) p.vx = Math.min(maxV, p.vx + acc); }
    } else if (L && !R) {
      if (p.onGround) p.facing = -1;
      if (p.vx > 0 && p.onGround) { p.vx -= 0.18; p.skid = true; }
      else { p.skid = false; if (p.vx > -maxV) p.vx = Math.max(-maxV, p.vx - acc); }
    } else {
      p.skid = false;
      if (p.onGround) {
        const f = 0.08;
        p.vx = p.vx > 0 ? Math.max(0, p.vx - f) : Math.min(0, p.vx + f);
      }
    }
    if (p.onGround && Math.abs(p.vx) > maxV) p.vx -= Math.sign(p.vx) * 0.04;

    // 跳跃（带土狼时间与按键缓冲）
    if (p.onGround) p.coyote = 5; else if (p.coyote > 0) p.coyote--;
    if (jumpBuf > 0) {
      if (p.coyote > 0) {
        // 起跳速度：站着轻点能跳过 3 格高的水管，按住能跳过 4 格高
        p.vy = -(5.0 + Math.abs(p.vx) * 0.15);
        p.onGround = false;
        p.coyote = 0;
        jumpBuf = 0;
        Sound.sfx.jump(p.big);
      } else {
        jumpBuf--;
      }
    }
    const g = (input.jump && p.vy < 0) ? 0.16 : 0.3;
    p.vy = Math.min(p.vy + g, 5.5);

    p.prevBottom = p.y + p.h;
    p.x += p.vx;
    if (collideX(p)) { p.vx = 0; p.runT = 0; }
    if (p.x < camX) { p.x = camX; if (p.vx < 0) p.vx = 0; }

    p.y += p.vy;
    const r = collideY(p);
    p.onGround = false;
    if (r && r.floor) {
      p.vy = 0;
      p.onGround = true;
      game.combo = 0;
    } else if (r && r.ceil) {
      p.vy = 1;
      bumpBlock(r.tx, r.ty);
    }
    // 升降平台只能从上方站上去
    p.plat = null;
    if (!p.onGround && p.vy >= 0) {
      for (const pl of platforms) {
        if (p.x + p.w > pl.x && p.x < pl.x + pl.w && p.prevBottom <= pl.y + 1 && p.y + p.h >= pl.y) {
          p.y = pl.y - p.h;
          p.vy = 0;
          p.onGround = true;
          p.plat = pl;
          game.combo = 0;
          break;
        }
      }
    }

    if (p.onGround) {
      if (Math.abs(p.vx) > 0.05) p.anim += Math.abs(p.vx) * 0.11; else p.anim = 0;
    }
    if (p.invuln > 0) p.invuln--;
    if (p.x > LEVELS[game.level].checkpoint[0] * T) game.checkpoint = true;
    collectCoins(p);
    if (touchesTile(p, LAVA)) { killPlayer(false); return; }
    if (touchesTile(p, AXE)) { startAxe(); return; }

    if (p.y > VIEW_H + 8) { killPlayer(true); return; }
    if (!LEVELS[game.level].boss && p.x + p.w >= FLAG_X * T + 6) startFlag();
  }

  // ============================================================
  // 敌人 / 道具 / 特效
  // ============================================================
  const STOMP_PTS = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];
  const SHELL_PTS = [500, 800, 1000, 2000, 4000, 5000, 8000];

  function stompBounce(p, e) {
    p.y = e.y - p.h;
    p.vy = input.jump ? -5.2 : -3.5;
  }

  function updateEnemies() {
    const p = player;
    for (const e of enemies) {
      if (e.remove) continue;
      if (e.x < camX - 64 || e.y > VIEW_H + 32) { e.remove = true; continue; }
      if (e.state === 'slide' && e.x > camX + VIEW_W + 160) { e.remove = true; continue; }
      if (!e.active) {
        if (e.x < camX + VIEW_W + 24) e.active = true; else continue;
      }
      if (e.state === 'squish') { if (--e.t <= 0) e.remove = true; continue; }
      if (e.state === 'flip') { e.vy += 0.3; e.x += e.vx; e.y += e.vy; continue; }

      // 静止的龟壳过一会儿会重新钻出乌龟
      if (e.state === 'shell' && ++e.t > 420) {
        e.state = 'walk';
        e.y -= 8;
        e.h = 22;
        e.vx = p.x < e.x ? -e.speed : e.speed;
      }

      e.vy = Math.min(e.vy + 0.3, 5);
      e.x += e.vx;
      if (collideX(e)) {
        e.vx = -e.vx;
        if (e.state === 'slide' && e.x < camX + VIEW_W) Sound.sfx.bump();
      }
      e.y += e.vy;
      const r = collideY(e);
      if (r && r.floor) e.vy = 0;
      e.anim++;
      if (e.kickT > 0) e.kickT--;

      if (e.state === 'walk') {
        // 敌人之间相互掉头
        for (const o of enemies) {
          if (o === e || o.state !== 'walk' || !o.active || o.remove) continue;
          if (overlap(e, o)) {
            if (e.x < o.x) { e.vx = -Math.abs(e.vx); o.vx = Math.abs(o.vx); }
            else { e.vx = Math.abs(e.vx); o.vx = -Math.abs(o.vx); }
          }
        }
      } else if (e.state === 'slide') {
        // 滑行的龟壳撞倒沿途的敌人
        for (const o of enemies) {
          if (o === e || !o.active || o.remove) continue;
          if (o.state !== 'walk' && o.state !== 'shell' && o.state !== 'slide') continue;
          if (!overlap(e, o)) continue;
          o.state = 'flip';
          o.vy = -3.5;
          o.vx = Math.sign(e.vx) * 0.8;
          addScore(SHELL_PTS[Math.min(e.shellCombo++, SHELL_PTS.length - 1)], o.x, o.y - 8);
          Sound.sfx.kick();
        }
      }

      if (!overlap(p, e)) continue;
      const fromAbove = p.vy >= 0 && p.prevBottom <= e.y + 5;
      if (e.state === 'shell') {
        // 碰到静止的龟壳就把它踢出去
        const dir = p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1;
        e.state = 'slide';
        e.vx = 3.2 * dir;
        e.kickT = 12;
        e.shellCombo = 0;
        addScore(400, e.x, e.y - 8);
        Sound.sfx.kick();
        if (fromAbove) stompBounce(p, e);
      } else if (fromAbove) {
        if (e.type === 'koopa') {
          if (e.state === 'walk') { e.y += 8; e.h = 14; }
          e.state = 'shell';
          e.vx = 0;
          e.t = 0;
        } else {
          e.state = 'squish';
          e.t = 30;
        }
        addScore(STOMP_PTS[Math.min(game.combo++, STOMP_PTS.length - 1)], e.x, e.y - 8);
        stompBounce(p, e);
        Sound.sfx.stomp();
      } else if (!(e.state === 'slide' && e.kickT > 0)) {
        hurtPlayer();
        if (game.state !== 'play') return;
      }
    }
    enemies = enemies.filter(e => !e.remove);
  }

  // ---- 城堡关：火焰棍、魔王、魔王火球 ----
  function updateFirebars() {
    if (game.state !== 'play') return;
    const p = player;
    for (const fb of firebars) {
      fb.a += fb.speed * fb.dir;
      if (Math.abs(fb.cx - (p.x + p.w / 2)) > fb.len * 8 + 24) continue;
      for (let i = 1; i < fb.len; i++) {
        const bx = fb.cx + Math.cos(fb.a) * i * 8;
        const by = fb.cy + Math.sin(fb.a) * i * 8;
        if (bx > p.x - 3 && bx < p.x + p.w + 3 && by > p.y - 3 && by < p.y + p.h + 3) {
          hurtPlayer();
          return;
        }
      }
    }
  }

  function updateBoss() {
    const b = boss;
    if (!b || game.state !== 'play') return;
    if (!b.active) { if (b.x < camX + VIEW_W) b.active = true; else return; }
    const p = player;
    b.t++;
    b.face = p.x + p.w / 2 < b.x + b.w / 2 ? -1 : 1;
    b.x += b.vx;
    if (b.x < b.minX) { b.x = b.minX; b.vx = Math.abs(b.vx); }
    else if (b.x > b.maxX) { b.x = b.maxX; b.vx = -Math.abs(b.vx); }
    else if (b.t % 90 === 0 && Math.random() < 0.5) b.vx = -b.vx;
    b.vy = Math.min(b.vy + 0.3, 6);
    b.y += b.vy;
    const r = collideY(b);
    b.onGround = !!(r && r.floor);
    if (b.onGround) b.vy = 0;
    if (b.onGround && --b.hopT <= 0) { b.vy = -4.5; b.hopT = b.hop + Math.floor(Math.random() * 80); }
    if (b.mouthT > 0) b.mouthT--;
    if (--b.fireT <= 0) {
      b.fireT = b.fireRate + Math.floor(Math.random() * 60);
      if (Math.abs(p.x - b.x) < 14 * T) {
        hazards.push({ x: b.face < 0 ? b.x - 12 : b.x + b.w, y: b.y + 6, w: 12, h: 6, vx: 1.6 * b.face, t: 0 });
        // 双发：第二颗贴着吊桥平飞，不追踪
        if (b.double) hazards.push({ x: b.face < 0 ? b.x - 12 : b.x + b.w, y: 9 * T - 14, w: 12, h: 6, vx: 1.9 * b.face, t: 0, straight: true });
        b.mouthT = 24;
        Sound.sfx.fire();
      }
    }
    if (overlap(p, b)) hurtPlayer();
  }

  function updateHazards() {
    if (game.state !== 'play') return;
    const p = player;
    for (const h of hazards) {
      h.t++;
      h.x += h.vx;
      // 火球会慢慢对准玩家的高度
      const ty = p.y + p.h / 2 - h.h / 2;
      if (!h.straight) h.y += Math.max(-0.4, Math.min(0.4, ty - h.y));
      if (h.x < camX - 32 || h.x > camX + VIEW_W + 32) h.remove = true;
      if (overlap(p, h)) { hurtPlayer(); if (game.state !== 'play') return; }
    }
    hazards = hazards.filter(h => !h.remove);
  }

  // ---- 世界 2：食人花、炮台、岩浆火球 ----
  function updatePiranhas() {
    if (game.state !== 'play') return;
    const p = player;
    for (const pl of piranhas) {
      if (Math.abs(pl.x - camX - VIEW_W / 2) > VIEW_W) continue;
      pl.t++;
      if (pl.phase === 'hidden') {
        // 玩家站在水管旁边或上面时不会钻出来
        const near = Math.abs(p.x + p.w / 2 - (pl.x + 8)) < 28;
        if (pl.t > 90 && !near) { pl.phase = 'up'; pl.t = 0; }
      } else if (pl.phase === 'up') {
        pl.off = Math.min(24, pl.off + 0.8);
        if (pl.off >= 24) { pl.phase = 'out'; pl.t = 0; }
      } else if (pl.phase === 'out') {
        if (pl.t > 70) { pl.phase = 'down'; pl.t = 0; }
      } else {
        pl.off = Math.max(0, pl.off - 0.8);
        if (pl.off <= 0) { pl.phase = 'hidden'; pl.t = 0; }
      }
      if (pl.off > 4 && overlap(p, { x: pl.x + 2, y: pl.top - pl.off, w: 12, h: pl.off })) {
        hurtPlayer();
        if (game.state !== 'play') return;
      }
    }
  }

  function updateCannons() {
    if (game.state !== 'play') return;
    const p = player;
    for (const c of cannons) {
      if (c.x < camX - 16 || c.x > camX + VIEW_W + 16) continue;
      const dx = p.x + p.w / 2 - (c.x + 8);
      if (--c.t <= 0) {
        c.t = 170 + Math.floor(Math.random() * 90);
        if (Math.abs(dx) > 40) {
          const dir = Math.sign(dx);
          bullets.push({ x: c.x + (dir > 0 ? 16 : -16), y: c.y + 1, w: 16, h: 14, vx: 1.5 * dir, vy: 0, state: 'fly' });
          Sound.sfx.boom();
        }
      }
    }
    for (const b of bullets) {
      if (b.state === 'fly') b.x += b.vx;
      else { b.vy += 0.3; b.y += b.vy; b.x += b.vx * 0.3; }
      if (b.x < camX - 48 || b.x > camX + VIEW_W + 48 || b.y > VIEW_H + 16) { b.remove = true; continue; }
      if (b.state !== 'fly' || !overlap(p, b)) continue;
      if (p.vy >= 0 && p.prevBottom <= b.y + 5) {
        // 踩掉炮弹
        b.state = 'fall';
        addScore(200, b.x, b.y - 8);
        stompBounce(p, b);
        Sound.sfx.stomp();
      } else {
        hurtPlayer();
        if (game.state !== 'play') return;
      }
    }
    bullets = bullets.filter(b => !b.remove);
  }

  function updatePodoboos() {
    if (game.state !== 'play') return;
    const p = player;
    for (const f of podoboos) {
      if (Math.abs(f.x - camX - VIEW_W / 2) > VIEW_W) continue;
      if (f.y >= 15 * T && f.vy >= 0) {
        f.y = 15 * T;
        f.vy = 0;
        if (++f.t > 110) { f.t = 0; f.vy = -7.2; }
      } else {
        f.vy += 0.2;
        f.y += f.vy;
      }
      if (overlap(p, f)) { hurtPlayer(); if (game.state !== 'play') return; }
    }
  }

  // 碰到斧头：吊桥从右往左断掉，魔王掉进岩浆
  function startAxe() {
    const p = player;
    game.state = 'axe';
    game.axePhase = 0;
    game.stateT = 0;
    p.vx = 0;
    p.vy = 0;
    p.plat = null;
    hazards = [];
    bullets = [];
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) if (getT(x, y) === AXE) setT(x, y, E);
    Sound.stopBgm();
  }

  function updateAxe() {
    const b = boss;
    game.stateT++;
    if (game.axePhase === 0) {
      if (game.stateT % 4 === 0) {
        let removed = false;
        for (let x = LW - 1; x >= 0 && !removed; x--) {
          if (getT(x, 9) === BRIDGE) { setT(x, 9, E); removed = true; }
        }
        if (removed) Sound.sfx.bridge();
        else { game.axePhase = 1; game.stateT = 0; Sound.sfx.bossFall(); }
      }
    } else if (game.axePhase === 1) {
      if (!b || b.y > VIEW_H + 40) {
        game.axePhase = 2;
        game.stateT = 0;
        if (b) addScore(5000, b.x, VIEW_H - 40);
        Sound.sfx.clear();
      }
    } else if (game.axePhase === 2) {
      if (game.stateT > 120) { game.axePhase = 3; game.stateT = 0; }
    } else {
      tally();
    }
    if (b) {
      b.vy = Math.min(b.vy + 0.3, 6);
      b.y += b.vy;
      if (game.axePhase === 0) { const r = collideY(b); if (r && r.floor) b.vy = 0; }
    }
    // 玩家原地落到地面上
    const p = player;
    p.vy = Math.min(p.vy + 0.4, 5);
    p.y += p.vy;
    const pr = collideY(p);
    p.onGround = !!(pr && pr.floor);
    if (p.onGround) p.vy = 0;
    updateEffects();
    updateCamera();
  }

  function updateItems() {
    for (const it of items) {
      if (it.rise > 0) {
        it.y -= 0.5;
        it.rise -= 0.5;
        if (it.rise <= 0) it.vx = 1.1;
        continue;
      }
      it.vy = Math.min(it.vy + 0.3, 5);
      it.x += it.vx;
      if (collideX(it)) it.vx = -it.vx;
      it.y += it.vy;
      const r = collideY(it);
      if (r && r.floor) it.vy = 0;
      if (it.y > VIEW_H + 16 || it.x < camX - 64) it.remove = true;
      if (overlap(player, it)) {
        it.remove = true;
        addScore(1000, it.x, it.y);
        if (!player.big) { setBig(true); Sound.sfx.power(); } else Sound.sfx.oneup();
      }
    }
    items = items.filter(i => !i.remove);
  }

  function updateEffects() {
    for (const f of effects) {
      f.t++;
      if (f.type === 'text') { f.y -= 0.6; if (f.t > 45) f.remove = true; }
      else if (f.type === 'coin') {
        f.vy += 0.4;
        f.y += f.vy;
        if (f.t > 26) { f.remove = true; effects.push({ type: 'text', text: '200', x: f.x, y: f.y, t: 0 }); }
      } else if (f.type === 'debris') {
        f.vy += 0.3;
        f.x += f.vx;
        f.y += f.vy;
        if (f.y > VIEW_H + 16) f.remove = true;
      }
    }
    effects = effects.filter(f => !f.remove);
    for (const [k, v] of bumps) {
      if (v >= 10) bumps.delete(k); else bumps.set(k, v + 1);
    }
  }

  function updateCamera() {
    const target = player.x + player.w / 2 - VIEW_W * 0.42;
    if (target > camX) camX = target;
    camX = Math.max(0, Math.min(camX, LW * T - VIEW_W));
  }

  // ============================================================
  // 终点旗杆
  // ============================================================
  function startFlag() {
    const p = player;
    game.state = 'flag';
    game.flagPhase = 0;
    game.stateT = 0;
    p.vx = 0;
    p.vy = 0;
    p.x = FLAG_X * T + 7 - p.w;
    if (p.y < 3 * T) p.y = 3 * T;
    const h = 12 * T - (p.y + p.h);
    const pts = h >= 128 ? 5000 : h >= 96 ? 2000 : h >= 64 ? 800 : h >= 32 ? 400 : 100;
    addScore(pts, p.x + 18, p.y);
    Sound.stopBgm();
    Sound.sfx.flag();
  }

  function updateFlag() {
    const p = player;
    game.stateT++;
    if (game.flagPhase === 0) {
      // 滑下旗杆
      const bottom = 12 * T;
      if (p.y + p.h < bottom) p.y = Math.min(bottom - p.h, p.y + 2);
      if (game.flagY < bottom - 18) game.flagY += 2;
      p.anim = 0;
      if (p.y + p.h >= bottom && game.flagY >= bottom - 18) {
        game.flagPhase = 1;
        game.stateT = 0;
      }
    } else if (game.flagPhase === 1) {
      if (game.stateT > 20) { game.flagPhase = 2; Sound.sfx.clear(); }
    } else if (game.flagPhase === 2) {
      // 走进城堡
      p.facing = 1;
      p.vx = 1.2;
      p.vy = Math.min(p.vy + 0.4, 5);
      p.x += p.vx;
      collideX(p);
      p.y += p.vy;
      const r = collideY(p);
      p.onGround = !!(r && r.floor);
      if (p.onGround) p.vy = 0;
      p.anim += 0.15;
      if (p.x >= (CASTLE_X + 2) * T + 2) {
        p.hidden = true;
        game.flagPhase = 3;
        game.stateT = 0;
      }
    } else if (game.flagPhase === 3) {
      tally();
    }
    updateEffects();
    updateCamera();
  }

  // 剩余时间换算分数，然后进入下一关或全部通关
  function tally() {
    if (game.time > 0) {
      const d = Math.min(game.time, 2);
      game.time -= d;
      game.score += d * 50;
      if (game.stateT % 3 === 0) Sound.sfx.tick();
    } else if (game.stateT > 60) {
      saveBest();
      if (game.level < LEVELS.length - 1) {
        game.level++;
        game.checkpoint = false;
        game.carryBig = player.big;
        startIntro();
      } else {
        game.state = 'clear';
        game.stateT = 0;
      }
    }
  }

  function saveBest() {
    if (game.score > best) {
      best = game.score;
      try { localStorage.setItem('smb_best', String(best)); } catch (e) { /* ignore */ }
    }
  }

  // ============================================================
  // 主更新
  // ============================================================
  function step() {
    readInput();
    game.frame++;
    switch (game.state) {
      case 'title':
      case 'gameover':
      case 'clear':
        game.stateT++;
        if (game.state === 'title') camX = 0;
        if (jumpBuf > 0) { jumpBuf = 0; anyPress(); }
        break;
      case 'intro':
        if (++game.stateT > 150) startLevel();
        break;
      case 'play': {
        const p = player;
        if (p.growT > 0) { p.growT--; updateEffects(); break; }   // 变身时定格
        if (++game.timeTick >= 24) {
          game.timeTick = 0;
          game.time--;
          if (game.time === 100) { Sound.sfx.hurry(); Sound.setFast(true); }
          if (game.time <= 0) { game.time = 0; killPlayer(false); break; }
        }
        updatePlatforms();
        updatePlayer();
        if (game.state !== 'play') break;
        updateItems();
        updateEnemies();
        updateFirebars();
        updateBoss();
        updateHazards();
        updatePiranhas();
        updateCannons();
        updatePodoboos();
        updateEffects();
        updateCamera();
        break;
      }
      case 'dying': {
        const p = player;
        game.stateT++;
        if (game.stateT > 30 && !p.pit) { p.vy += 0.25; p.y += p.vy; }
        if (game.stateT > 190) {
          game.lives--;
          if (game.lives > 0) startIntro();
          else {
            saveBest();
            game.state = 'gameover';
            game.stateT = 0;
            Sound.sfx.gameover();
          }
        }
        break;
      }
      case 'flag':
        updateFlag();
        break;
      case 'axe':
        updateAxe();
        break;
    }
  }

  // ============================================================
  // 渲染
  // ============================================================
  const SKY = '#5c94fc';

  function text(str, x, y, opt = {}) {
    const { size = 8, color = '#fff', align = 'left', shadow = true, bold = true } = opt;
    ctx.font = `${bold ? 'bold ' : ''}${size}px "PingFang SC","Microsoft YaHei",monospace,sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillText(str, x + 0.6, y + 0.6);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function puffs(x, baseY, n, fill, stroke) {
    const circles = [];
    for (let i = 0; i < n + 1; i++) circles.push([x + 12 + i * 16, baseY - 10, 10]);
    for (let i = 0; i < n; i++) circles.push([x + 20 + i * 16, baseY - 16, 10]);
    ctx.fillStyle = stroke;
    for (const [cx, cy, r] of circles) { ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = fill;
    for (const [cx, cy, r] of circles) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
  }

  function drawDeco(cx) {
    for (const d of LEVELS[game.level].deco) {
      const x = d.x * T - cx;
      if (x > VIEW_W + 10 || x < -100) continue;
      if (d.k === 'hill') {
        const w = d.s === 2 ? 80 : 48, h = d.s === 2 ? 36 : 20;
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x + w / 2, GROUND_Y, w / 2 + 1, h + 1, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#00a800';
        ctx.beginPath(); ctx.ellipse(x + w / 2, GROUND_Y, w / 2, h, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#005800';
        ctx.fillRect(x + w / 2 - 6, GROUND_Y - h + 10, 2, 5);
        ctx.fillRect(x + w / 2 + 4, GROUND_Y - h + 10, 2, 5);
        if (d.s === 2) {
          ctx.fillRect(x + w / 2 - 14, GROUND_Y - 14, 2, 5);
          ctx.fillRect(x + w / 2 + 12, GROUND_Y - 12, 2, 5);
          ctx.fillRect(x + w / 2 - 1, GROUND_Y - 20, 2, 5);
        }
      } else if (d.k === 'bush') {
        puffs(x, GROUND_Y + 2, d.n, '#80d010', '#005800');
      } else if (d.k === 'cloud') {
        const y = d.y * T + 16;
        puffs(x, y, d.n, '#fcfcfc', '#3cbcfc');
        ctx.fillStyle = '#fcfcfc';
        ctx.fillRect(x + 6, y - 12, 12 + d.n * 16, 5);
      }
    }
  }

  function drawCastle(cx) {
    const x0 = CASTLE_X * T - cx;
    if (x0 > VIEW_W || x0 < -6 * T) return;
    const gy = GROUND_Y;
    for (let i = 0; i < 5; i++) for (let j = 1; j <= 3; j++) ctx.drawImage(TILE.brick, x0 + i * T, gy - j * T);
    for (let i = 1; i < 4; i++) for (let j = 4; j <= 5; j++) ctx.drawImage(TILE.brick, x0 + i * T, gy - j * T);
    const crenel = (x, y, count) => {
      for (let k = 0; k < count; k++) {
        if (k % 2) continue;
        ctx.fillStyle = '#000';
        ctx.fillRect(x + k * 8, y, 8, 8);
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(x + k * 8 + 1, y + 1, 6, 7);
      }
    };
    crenel(x0, gy - 3 * T - 8, 3);
    crenel(x0 + 4 * T - 8, gy - 3 * T - 8, 3);
    crenel(x0 + T, gy - 5 * T - 8, 6);
    ctx.fillStyle = '#000';
    ctx.fillRect(x0 + T + 6, gy - 5 * T + 6, 6, 12);
    ctx.fillRect(x0 + 3 * T + 4, gy - 5 * T + 6, 6, 12);
    // 城门
    ctx.fillRect(x0 + 2 * T + 2, gy - 22, 12, 22);
    ctx.beginPath(); ctx.arc(x0 + 2 * T + 8, gy - 22, 6, Math.PI, 0); ctx.fill();
  }

  function drawFlag(cx) {
    const px = FLAG_X * T + 7 - cx;
    if (px < -40 || px > VIEW_W + 40) return;
    ctx.fillStyle = '#80d010';
    ctx.fillRect(px, 3 * T + 8, 2, 12 * T - (3 * T + 8));
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(px + 1, 3 * T + 4, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00a800';
    ctx.beginPath(); ctx.arc(px + 1, 3 * T + 4, 3.5, 0, Math.PI * 2); ctx.fill();
    const fy = game.flagY;
    ctx.fillStyle = '#fcfcfc';
    ctx.beginPath(); ctx.moveTo(px, fy); ctx.lineTo(px - 16, fy); ctx.lineTo(px, fy + 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#00a800';
    ctx.beginPath(); ctx.arc(px - 5, fy + 5, 3, 0, Math.PI * 2); ctx.fill();
  }

  function tileImage(t, tx) {
    const lv = LEVELS[game.level];
    const set = lv.theme === 'castle' ? TILE_CS : tx < lv.ugEnd ? TILE_UG : TILE;
    switch (t) {
      case GROUND: return set.ground;
      case BRICK: case BRICK_COINS: return set.brick;
      case QCOIN: case QMUSH: {
        const seq = [0, 0, 0, 0, 1, 2, 2, 1];
        return TILE.q[seq[Math.floor(game.frame / 8) % seq.length]];
      }
      case USED: return TILE.used;
      case HARD: return set.hard;
      case PTL: return TILE.pipeTL;
      case PTR: return TILE.pipeTR;
      case PL: return TILE.pipeL;
      case PR: return TILE.pipeR;
      case TREE_L: return TILE.treeL;
      case TREE_M: return TILE.treeM;
      case TREE_R: return TILE.treeR;
      case TRUNK: return TILE.trunk;
    }
    return null;
  }

  function drawTiles(cx) {
    const x0 = Math.floor(cx / T);
    const x1 = Math.min(LW - 1, Math.floor((cx + VIEW_W) / T));
    for (let ty = 0; ty < LH; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tiles[ty * LW + tx];
        if (!t) continue;
        if (t === COIN) { drawCoin(tx * T - cx + 4, ty * T + 1, game.frame * 0.08 + tx); continue; }
        if (t === LAVA) { drawLava(tx * T - cx, ty * T, getT(tx, ty - 1) !== LAVA); continue; }
        if (t === BRIDGE) { drawBridge(tx * T - cx, ty * T); continue; }
        if (t === AXE) { drawAxe(tx * T - cx, ty * T); continue; }
        if (t === CANNON) { drawCannon(tx * T - cx, ty * T); continue; }
        const b = bumps.get(ty * LW + tx);
        const off = b !== undefined ? -Math.round(Math.sin(b / 10 * Math.PI) * 5) : 0;
        ctx.drawImage(tileImage(t, tx), tx * T - cx, ty * T + off);
      }
    }
  }

  function drawLava(x, y, surface) {
    ctx.fillStyle = '#e44800';
    ctx.fillRect(x, y + (surface ? 3 : 0), T, T - (surface ? 3 : 0));
    ctx.fillStyle = '#b82800';
    ctx.fillRect(x + ((game.frame >> 3) + x) % 12, y + 9, 4, 3);
    if (surface) {
      ctx.fillStyle = '#fca044';
      for (let k = 0; k < 4; k++) ctx.fillRect(x + ((k * 4 + (game.frame >> 2)) % 16), y + 2, 3, 2);
    }
  }

  function drawBridge(x, y) {
    ctx.fillStyle = '#9c9c9c';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 4 + 1, y, 2, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y + 4, T, 9);
    ctx.fillStyle = '#fca044';
    ctx.fillRect(x, y + 5, T, 7);
    ctx.fillStyle = '#c84c0c';
    ctx.fillRect(x + 7, y + 5, 1, 7);
    ctx.fillRect(x + 15, y + 5, 1, 7);
  }

  function drawAxe(x, y) {
    const bob = Math.floor(game.frame / 20) % 2;
    ctx.fillStyle = '#8c4c18';
    ctx.fillRect(x + 7, y + 4 + bob, 3, 12);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 2, y + bob, 12, 9);
    ctx.fillStyle = '#b0b0b0';
    ctx.fillRect(x + 3, y + 1 + bob, 10, 7);
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(x + 3, y + 1 + bob, 3, 7);
  }

  function drawCannon(x, y) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = '#5c5c5c';
    ctx.fillRect(x + 1, y + 1, T - 2, 4);
    ctx.fillRect(x + 1, y + 11, T - 2, 4);
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(x + 5, y + 6, 6, 4);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 7, y + 7, 2, 2);
  }

  function drawPiranhas(cx) {
    for (const pl of piranhas) {
      if (pl.off <= 0) continue;
      const spr = SPR.piranha[Math.floor(game.frame / 12) % 2];
      ctx.drawImage(spr.r, Math.round(pl.x - cx), Math.round(pl.top - pl.off));
    }
  }

  function drawBullets(cx) {
    for (const b of bullets) {
      const x = Math.round(b.x - cx), y = Math.round(b.y);
      const dir = Math.sign(b.vx) || 1;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x + 8, y + 7, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(dir > 0 ? x : x + 8, y, 8, 14);
      ctx.fillStyle = '#fcfcfc';
      ctx.fillRect(dir > 0 ? x + 9 : x + 4, y + 3, 3, 4);
      ctx.fillStyle = '#e40000';
      ctx.fillRect(dir > 0 ? x + 2 : x + 12, y + 9, 2, 2);
    }
  }

  function drawPodoboos(cx) {
    for (const f of podoboos) {
      if (f.y >= 15 * T) continue;
      drawFireball(f.x + 6 - cx, f.y + 7, 6);
    }
  }

  function drawFireball(x, y, r) {
    const flick = Math.floor(game.frame / 3) % 2;
    ctx.fillStyle = '#e44800';
    ctx.beginPath(); ctx.arc(x, y, r + flick * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fcd800';
    ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawFirebars(cx) {
    for (const fb of firebars) {
      if (Math.abs(fb.cx - cx - VIEW_W / 2) > VIEW_W) continue;
      for (let i = 0; i < fb.len; i++) {
        drawFireball(fb.cx + Math.cos(fb.a) * i * 8 - cx, fb.cy + Math.sin(fb.a) * i * 8, 3.5);
      }
    }
  }

  function drawHazards(cx) {
    for (const h of hazards) {
      const x = h.x - cx, y = h.y;
      ctx.fillStyle = '#e44800';
      ctx.beginPath(); ctx.ellipse(x + 6, y + 3, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fcd800';
      ctx.beginPath(); ctx.ellipse(x + 6 + Math.sign(h.vx) * 2, y + 3, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 魔王：头朝右绘制，面向左时镜像
  function drawBoss(cx) {
    const b = boss;
    if (!b || !b.active) return;
    const x = Math.round(b.x - 2 - cx), y = Math.round(b.y - 2);
    ctx.save();
    ctx.translate(x + 16, y);
    ctx.scale(b.face, 1);
    ctx.translate(-16, 0);
    // 腿
    const s = Math.floor(b.t / 12) % 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(3 + s * 2, 24, 8, 8);
    ctx.fillRect(14 - s * 2, 24, 8, 8);
    ctx.fillStyle = '#9cc800';
    ctx.fillRect(4 + s * 2, 25, 6, 6);
    ctx.fillRect(15 - s * 2, 25, 6, 6);
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(9 + s * 2, 29, 2, 2);
    ctx.fillRect(20 - s * 2, 29, 2, 2);
    // 龟壳和尖刺
    ctx.fillStyle = '#000';
    ctx.fillRect(1, 6, 22, 20);
    ctx.fillStyle = '#00a800';
    ctx.fillRect(2, 7, 20, 18);
    ctx.fillStyle = '#80d010';
    ctx.fillRect(5, 10, 5, 5); ctx.fillRect(12, 10, 5, 5); ctx.fillRect(8, 17, 5, 5); ctx.fillRect(15, 17, 4, 4);
    ctx.fillStyle = '#fcfcfc';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(2 + i * 5, 7); ctx.lineTo(4.5 + i * 5, 1); ctx.lineTo(7 + i * 5, 7); ctx.fill();
    }
    // 肚子
    ctx.fillStyle = '#000';
    ctx.fillRect(17, 11, 10, 15);
    ctx.fillStyle = '#fcd8a8';
    ctx.fillRect(18, 12, 8, 13);
    // 头、角、鬃毛
    ctx.fillStyle = '#e45c10';
    ctx.fillRect(17, 0, 4, 10);
    ctx.fillStyle = '#000';
    ctx.fillRect(19, 1, 13, 13);
    ctx.fillStyle = '#9cc800';
    ctx.fillRect(20, 2, 11, 11);
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(21, -2, 2, 4);
    ctx.fillRect(27, -2, 2, 4);
    ctx.fillRect(26, 4, 3, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(28, 5, 1, 2);
    ctx.fillStyle = '#e40000';
    ctx.fillRect(25, 9, 7, b.mouthT > 0 ? 4 : 1);
    ctx.restore();
  }

  function drawStars(cx) {
    ctx.fillStyle = '#fcfcfc';
    for (let i = 0; i < 90; i++) {
      const sx = ((i * 211) % (LW * T) - cx * 0.5 + LW * T) % (VIEW_W + 40) - 20;
      const sy = 30 + (i * 67) % 140;
      const size = (i + (game.frame >> 5)) % 7 === 0 ? 2 : 1;
      ctx.fillRect(Math.round(sx), sy, size, size);
    }
  }

  function drawPlatforms(cx) {
    for (const pl of platforms) {
      const x = Math.round(pl.x - cx), y = Math.round(pl.y);
      if (x > VIEW_W || x + pl.w < 0) continue;
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, pl.w, pl.h);
      ctx.fillStyle = '#fca044';
      ctx.fillRect(x + 1, y + 1, pl.w - 2, pl.h - 2);
      ctx.fillStyle = '#fcd8a8';
      ctx.fillRect(x + 1, y + 1, pl.w - 2, 1);
      ctx.fillStyle = '#8c4c18';
      for (let i = 4; i < pl.w - 2; i += 8) ctx.fillRect(x + i, y + 3, 2, 2);
    }
  }

  function drawCoin(x, y, phase) {
    const w = Math.max(2, Math.round(8 * Math.abs(Math.cos(phase))));
    const cx = x + 4;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(cx - w / 2) - 1, y, w + 2, 14);
    ctx.fillStyle = '#f8b800';
    ctx.fillRect(Math.round(cx - w / 2), y + 1, w, 12);
    if (w > 4) {
      ctx.fillStyle = '#fcfc9c';
      ctx.fillRect(Math.round(cx - 1), y + 3, 2, 8);
    }
  }

  function drawPlayer(cx) {
    const p = player;
    if (p.hidden) return;
    if (p.invuln > 0 && Math.floor(p.invuln / 3) % 2 === 0) return;
    let big = p.big;
    if (p.growT > 0 && Math.floor(p.growT / 6) % 2 === 0) big = !big;
    let frame = 0;
    if (game.state === 'dying') frame = 3;
    else if (game.state === 'flag' && game.flagPhase < 2) frame = 3;
    else if (!p.onGround) frame = 3;
    else if (p.skid) frame = 2;
    else if (Math.abs(p.vx) > 0.05 || (game.state === 'flag' && game.flagPhase === 2)) frame = [1, 2, 0][Math.floor(p.anim) % 3];
    const spr = (big ? SPR.big : SPR.small)[frame];
    const img = p.facing > 0 ? spr.r : spr.l;
    ctx.drawImage(img, Math.round(p.x - 2 - cx), Math.round(p.y + p.h - spr.h));
  }

  function drawEnemies(cx) {
    for (const e of enemies) {
      if (!e.active) continue;
      const x = Math.round(e.x - 1 - cx);
      const y = Math.round(e.y + e.h - 16);
      if (e.type === 'koopa') {
        if (e.state === 'walk') {
          const spr = SPR.koopa[Math.floor(e.anim / 10) % 2];
          ctx.drawImage(e.vx < 0 ? spr.l : spr.r, x, Math.round(e.y + e.h - 23));
        } else if (e.state === 'flip') {
          ctx.save();
          ctx.translate(x, Math.round(e.y + e.h));
          ctx.scale(1, -1);
          ctx.drawImage(SPR.shell.r, 0, -2);
          ctx.restore();
        } else {
          // 龟壳快复活时会抖动
          const shake = e.state === 'shell' && e.t > 340 && game.frame % 4 < 2 ? 1 : 0;
          ctx.drawImage(SPR.shell.r, x + shake, Math.round(e.y + e.h - 14));
        }
        continue;
      }
      if (e.state === 'squish') {
        ctx.drawImage(SPR.goombaFlat.r, x, y + 10);
      } else if (e.state === 'flip') {
        ctx.save();
        ctx.translate(x, y + 16);
        ctx.scale(1, -1);
        ctx.drawImage(SPR.goomba.r, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(Math.floor(e.anim / 10) % 2 ? SPR.goomba.l : SPR.goomba.r, x, y);
      }
    }
  }

  function drawItems(cx, rising) {
    for (const it of items) {
      if ((it.rise > 0) !== rising) continue;
      ctx.drawImage(SPR.mushroom.r, Math.round(it.x - 1 - cx), Math.round(it.y));
    }
  }

  function drawEffects(cx) {
    for (const f of effects) {
      if (f.type === 'coin') drawCoin(Math.round(f.x - cx), Math.round(f.y), f.t * 0.5);
      else if (f.type === 'debris') {
        ctx.fillStyle = '#000';
        ctx.fillRect(Math.round(f.x - cx), Math.round(f.y), 6, 6);
        ctx.fillStyle = '#c84c0c';
        ctx.fillRect(Math.round(f.x - cx) + 1, Math.round(f.y) + 1, 4, 4);
      } else if (f.type === 'text') {
        text(f.text, Math.round(f.x - cx), Math.round(f.y), { size: 6 });
      }
    }
  }

  function pad(n, len) { return String(n).padStart(len, '0'); }

  function drawHUD() {
    const cols = [0.05, 0.31, 0.56, 0.8].map(f => Math.round(VIEW_W * f));
    text('得分', cols[0], 6);
    text(pad(game.score, 6), cols[0], 16);
    drawCoin(cols[1], 10, game.frame * 0.1);
    text('×' + pad(game.coins, 2), cols[1] + 11, 12);
    text('世界', cols[2], 6);
    text(LEVELS[game.level].name, cols[2], 16);
    text('时间', cols[3], 6);
    const showTime = ['play', 'dying', 'flag', 'axe'].includes(game.state);
    text(showTime ? pad(game.time, 3) : '', cols[3], 16, { color: game.time <= 100 && showTime ? '#fcbc3c' : '#fff' });
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = '#c84c0c';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fcbcb0';
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x + w - 2, y, 2, h);
  }

  function drawWorld() {
    const cx = Math.floor(camX);
    const lv = LEVELS[game.level];
    const ugEnd = lv.ugEnd;
    ctx.fillStyle = lv.theme === 'castle' ? '#000' : lv.sky || SKY;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (lv.stars) drawStars(cx);
    if (ugEnd) {
      // 地下部分是黑色背景，出口之后是天空
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, Math.max(0, Math.min(VIEW_W, ugEnd * T - cx)), VIEW_H);
    }
    drawDeco(cx);
    if (!lv.boss) {
      drawCastle(cx);
      drawFlag(cx);
    }
    drawItems(cx, true);
    drawPiranhas(cx);
    drawTiles(cx);
    drawPlatforms(cx);
    drawItems(cx, false);
    drawEnemies(cx);
    drawBoss(cx);
    if (player) drawPlayer(cx);
    drawFirebars(cx);
    drawHazards(cx);
    drawBullets(cx);
    drawPodoboos(cx);
    drawEffects(cx);
  }

  function render() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const mid = VIEW_W / 2;

    if (game.state === 'intro' || game.state === 'gameover') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      drawHUD();
      if (game.state === 'intro') {
        text('世界 ' + LEVELS[game.level].name, mid, 90, { size: 10, align: 'center' });
        ctx.drawImage(SPR.small[0].r, mid - 26, 116);
        text('×  ' + game.lives, mid + 2, 120, { size: 10 });
      } else {
        text('游戏结束', mid, 96, { size: 16, align: 'center' });
        text('得分 ' + game.score + '   最高 ' + best, mid, 124, { size: 8, align: 'center', color: '#fcbcb0' });
        if (game.stateT > 45 && Math.floor(game.frame / 30) % 2 === 0) {
          text('点击屏幕 / 按回车 重新开始', mid, 150, { size: 8, align: 'center' });
        }
      }
      return;
    }

    if (game.state === 'title' && !player) {
      buildLevel();
      player = newPlayer(40);
    }
    drawWorld();
    drawHUD();

    if (game.state === 'title') {
      const canSelect = unlocked > 0;
      const w = Math.min(220, VIEW_W - 24), h = canSelect ? 108 : 92;
      const x = Math.round(mid - w / 2), y = canSelect ? 26 : 36;
      panel(x, y, w, h);
      text('超级玛丽', mid, y + 12, { size: 22, align: 'center', color: '#fcd8a8' });
      text('SUPER MARIO · H5', mid, y + 42, { size: 8, align: 'center', color: '#fff' });
      text('最高分 ' + pad(best, 6), mid, y + 62, { size: 7, align: 'center', color: '#fcd8a8' });
      titleArrows = null;
      if (canSelect) {
        // 选关：◀ 关卡名 ▶
        const sy = y + 80;
        text('选关', mid - 62, sy + 2, { size: 8, color: '#fcd8a8' });
        text(LEVELS[game.sel].name, mid + 8, sy, { size: 12, align: 'center' });
        const arrow = (ax, dir, on) => {
          ctx.fillStyle = on ? '#fcfcfc' : 'rgba(252,252,252,.3)';
          ctx.beginPath();
          ctx.moveTo(ax + (dir < 0 ? 0 : 10), sy + 6);
          ctx.lineTo(ax + (dir < 0 ? 10 : 0), sy);
          ctx.lineTo(ax + (dir < 0 ? 10 : 0), sy + 12);
          ctx.closePath();
          ctx.fill();
        };
        arrow(mid - 30, -1, game.sel > 0);
        arrow(mid + 36, 1, game.sel < unlocked);
        titleArrows = {
          l: { x: mid - 42, y: sy - 8, w: 34, h: 28 },
          r: { x: mid + 24, y: sy - 8, w: 34, h: 28 },
        };
      }
      const ly = canSelect ? 146 : 140;
      if (Math.floor(game.frame / 30) % 2 === 0) {
        text('▶ 点击屏幕 / 按回车 开始', mid, ly, { size: 9, align: 'center' });
      }
      const touchUI = document.body.classList.contains('touch');
      text(touchUI ? '◀ ▶ 移动(一直走会自动加速)   A 跳跃' : '←→ 移动(一直走会自动加速)   Z/空格 跳跃   P 暂停',
        mid, ly + 18, { size: 7, align: 'center', color: '#fcfcfc' });
    } else if (game.state === 'clear') {
      const w = Math.min(200, VIEW_W - 24), h = 70;
      const x = Math.round(mid - w / 2), y = 50;
      panel(x, y, w, h);
      text('全部通关！', mid, y + 12, { size: 16, align: 'center', color: '#fcd8a8' });
      text('得分 ' + game.score + '   最高 ' + best, mid, y + 40, { size: 8, align: 'center' });
      if (game.stateT > 45 && Math.floor(game.frame / 30) % 2 === 0) {
        text('点击屏幕 / 按回车 再玩一次', mid, y + h + 12, { size: 8, align: 'center' });
      }
    }

    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      text('暂停', mid, 96, { size: 16, align: 'center' });
      text('点击屏幕或按 P 继续', mid, 124, { size: 8, align: 'center' });
    }
  }

  // ============================================================
  // 主循环（固定 60Hz 逻辑步长）
  // ============================================================
  const STEP = 1000 / 60;
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    acc += Math.min(100, now - last);
    last = now;
    if (paused) acc = 0;
    while (acc >= STEP) {
      step();
      acc -= STEP;
    }
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 调试/测试钩子
  window.__smb = { game, get player() { return player; }, get enemies() { return enemies; }, get camX() { return camX; }, get platforms() { return platforms; }, get boss() { return boss; }, get firebars() { return firebars; }, get piranhas() { return piranhas; }, get bullets() { return bullets; }, get podoboos() { return podoboos; } };
})();
