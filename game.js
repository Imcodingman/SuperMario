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

  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
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
      hint.style.top = Math.round(bottom + 22) + 'px';
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
    };

    // ---- 原创背景音乐循环 ----
    const MEL = [72, 0, 76, 79, 81, 79, 76, 0, 74, 0, 77, 81, 79, 77, 74, 0,
      72, 76, 79, 84, 83, 79, 76, 74, 72, 0, 67, 0, 72, 0, 0, 0];
    const ROOTS = [48, 50, 43, 48];
    const BASS_PAT = [0, 0, 7, 0, 12, 0, 7, 0];
    let bgmOn = false;
    let nextTime = 0;
    let idx = 0;
    let fast = false;
    setInterval(() => {
      if (!bgmOn || !actx) return;
      const step = fast ? 0.13 : 0.19;
      if (nextTime < actx.currentTime - 0.1) nextTime = actx.currentTime + 0.05;
      while (nextTime < actx.currentTime + 0.25) {
        const i = idx % 32;
        const m = MEL[i];
        if (m) tone(midi(m), step * 0.8, { when: nextTime, vol: 0.035 });
        const b = BASS_PAT[i % 8];
        if (i % 2 === 0) tone(midi(ROOTS[Math.floor(i / 8)] + b), step * 0.9, { when: nextTime, type: 'triangle', vol: 0.12 });
        nextTime += step;
        idx++;
      }
    }, 50);

    return {
      init,
      sfx,
      startBgm(isFast = false) {
        if (!actx) return;
        fast = isFast;
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

  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');

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
    return e.clientX - (rc.left + rc.width / 2);
  }
  dpad.addEventListener('pointerdown', e => {
    e.preventDefault();
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
    anyPress();
  });
  document.getElementById('pauseBtn').addEventListener('click', e => { e.currentTarget.blur(); togglePause(); });
  document.getElementById('muteBtn').addEventListener('click', e => { e.currentTarget.blur(); toggleMute(); });
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
    PTL = 7, PTR = 8, PL = 9, PR = 10, BRICK_COINS = 11;
  const tiles = new Uint8Array(LW * LH);
  const coinBricks = new Map();

  const getT = (x, y) => (x < 0 || x >= LW || y < 0 || y >= LH) ? E : tiles[y * LW + x];
  const setT = (x, y, v) => { if (x >= 0 && x < LW && y >= 0 && y < LH) tiles[y * LW + x] = v; };
  const solid = (x, y) => {
    if (x < 0 || x >= LW) return true;
    if (y < 0 || y >= LH) return false;
    return tiles[y * LW + x] !== E;
  };

  const ENEMY_SPAWNS = [
    [22, 12], [40, 12], [51, 12], [52.5, 12], [80, 4], [82, 4],
    [97, 12], [98.5, 12], [114, 12], [115.5, 12], [124, 12], [125.5, 12],
    [128, 12], [129.5, 12], [174, 12], [175.5, 12],
  ];

  function buildLevel() {
    tiles.fill(E);
    coinBricks.clear();
    const gaps = [[69, 70], [86, 88], [153, 154]];
    for (let x = 0; x < LW; x++) {
      if (gaps.some(([a, b]) => x >= a && x <= b)) continue;
      setT(x, 13, GROUND);
      setT(x, 14, GROUND);
    }
    const row = (xs, y, v) => xs.forEach(x => setT(x, y, v));
    const pipe = (x, h) => {
      const top = 13 - h;
      setT(x, top, PTL); setT(x + 1, top, PTR);
      for (let y = top + 1; y < 13; y++) { setT(x, y, PL); setT(x + 1, y, PR); }
    };
    const stairs = (x, heights) => heights.forEach((h, i) => {
      for (let k = 0; k < h; k++) setT(x + i, 12 - k, HARD);
    });

    setT(16, 9, QCOIN);
    row([20, 22, 24], 9, BRICK);
    setT(21, 9, QMUSH);
    setT(23, 9, QCOIN);
    setT(22, 5, QCOIN);
    pipe(28, 2); pipe(38, 3); pipe(46, 4); pipe(57, 4);

    row([77, 79], 9, BRICK);
    setT(78, 9, QMUSH);
    row([80, 81, 82, 83, 84, 85, 86, 87], 5, BRICK);
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
  }

  // 背景装饰（山、草丛、云）
  const DECO = [];
  for (let b = 0; b < LW - 16; b += 48) {
    DECO.push({ k: 'hill', x: b, s: 2 }, { k: 'cloud', x: b + 8, y: 3, n: 1 },
      { k: 'bush', x: b + 11, n: 3 }, { k: 'hill', x: b + 16, s: 1 },
      { k: 'cloud', x: b + 19, y: 2, n: 1 }, { k: 'bush', x: b + 23, n: 1 },
      { k: 'cloud', x: b + 27, y: 3, n: 3 }, { k: 'cloud', x: b + 36, y: 2, n: 2 },
      { k: 'bush', x: b + 41, n: 2 });
  }

  // ============================================================
  // 游戏状态
  // ============================================================
  let best = 0;
  try { best = parseInt(localStorage.getItem('smb_best') || '0', 10) || 0; } catch (e) { /* ignore */ }

  const game = {
    state: 'title',   // title | intro | play | dying | flag | clear | gameover
    score: 0, coins: 0, lives: 3, time: 400, timeTick: 0,
    frame: 0, stateT: 0, checkpoint: false,
    flagY: 0, flagPhase: 0, combo: 0,
  };
  let paused = false;
  let camX = 0;
  let player = null;
  let enemies = [];
  let items = [];
  let effects = [];
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
    startIntro();
  }

  function startIntro() {
    game.state = 'intro';
    game.stateT = 0;
  }

  function startLevel() {
    buildLevel();
    bumps.clear();
    items = [];
    effects = [];
    const sx = game.checkpoint ? 90 * T : 40;
    player = newPlayer(sx);
    camX = Math.max(0, sx - 40);
    enemies = ENEMY_SPAWNS.map(([tx, ty]) => ({
      x: tx * T + 1, y: ty * T + 2, w: 14, h: 14, vx: -0.5, vy: 0,
      state: 'walk', active: false, anim: 0, t: 0, remove: false,
    }));
    game.time = 400;
    game.timeTick = 0;
    game.flagY = 3 * T + 10;
    game.flagPhase = 0;
    game.combo = 0;
    game.state = 'play';
    game.stateT = 0;
    jumpBuf = 0;
    Sound.startBgm(false);
  }

  function anyPress() {
    Sound.init();
    if (paused) return;
    if (game.state === 'title') { newGame(); jumpBuf = 0; }
    else if ((game.state === 'gameover' || game.state === 'clear') && game.stateT > 45) {
      game.state = 'title';
      game.stateT = 0;
      jumpBuf = 0;
    }
  }

  function togglePause() {
    if (!['play', 'flag', 'dying'].includes(game.state)) return;
    paused = !paused;
    Sound.init();
    if (paused) { Sound.stopBgm(); Sound.sfx.pause(); }
    else if (game.state === 'play') Sound.startBgm(game.time <= 100);
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
      if (e.state !== 'walk' || !e.active) continue;
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
    Sound.stopBgm();
    Sound.sfx.die();
  }

  function updatePlayer() {
    const p = player;
    const L = input.left, R = input.right;
    // 自动加速：朝同一方向持续前进约 0.5 秒后开始提速，约 1.2 秒达到跑步速度；
    // 松开方向、反向或撞墙都会重新计时（空中保持不变）
    const dir = R && !L ? 1 : L && !R ? -1 : 0;
    if (dir === 0 || dir !== Math.sign(p.vx || dir)) { if (p.onGround) p.runT = 0; }
    else p.runT++;
    const runK = Math.max(0, Math.min(1, (p.runT - 30) / 40));
    const maxV = 1.5 + runK * 1.1;
    const acc = p.onGround ? 0.07 + runK * 0.02 : 0.06;

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
        p.vy = -(4.5 + Math.abs(p.vx) * 0.25);
        p.onGround = false;
        p.coyote = 0;
        jumpBuf = 0;
        Sound.sfx.jump(p.big);
      } else {
        jumpBuf--;
      }
    }
    const g = (input.jump && p.vy < 0) ? 0.16 : 0.38;
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

    if (p.onGround) {
      if (Math.abs(p.vx) > 0.05) p.anim += Math.abs(p.vx) * 0.11; else p.anim = 0;
    }
    if (p.invuln > 0) p.invuln--;
    if (p.x > 90 * T) game.checkpoint = true;

    if (p.y > VIEW_H + 8) { killPlayer(true); return; }
    if (p.x + p.w >= FLAG_X * T + 6) startFlag();
  }

  // ============================================================
  // 敌人 / 道具 / 特效
  // ============================================================
  function updateEnemies() {
    const p = player;
    for (const e of enemies) {
      if (e.remove) continue;
      if (e.x < camX - 64 || e.y > VIEW_H + 32) { e.remove = true; continue; }
      if (!e.active) {
        if (e.x < camX + VIEW_W + 24) e.active = true; else continue;
      }
      if (e.state === 'squish') { if (--e.t <= 0) e.remove = true; continue; }
      if (e.state === 'flip') { e.vy += 0.3; e.x += e.vx; e.y += e.vy; continue; }

      e.vy = Math.min(e.vy + 0.3, 5);
      e.x += e.vx;
      if (collideX(e)) e.vx = -e.vx;
      e.y += e.vy;
      const r = collideY(e);
      if (r && r.floor) e.vy = 0;
      e.anim++;

      // 敌人之间相互掉头
      for (const o of enemies) {
        if (o === e || o.state !== 'walk' || !o.active || o.remove) continue;
        if (overlap(e, o)) {
          if (e.x < o.x) { e.vx = -Math.abs(e.vx); o.vx = Math.abs(o.vx); }
          else { e.vx = Math.abs(e.vx); o.vx = -Math.abs(o.vx); }
        }
      }

      if (overlap(p, e)) {
        if (p.vy >= 0 && p.prevBottom <= e.y + 5) {
          e.state = 'squish';
          e.t = 30;
          const pts = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000][Math.min(game.combo, 9)];
          game.combo++;
          addScore(pts, e.x, e.y - 8);
          p.y = e.y - p.h;
          p.vy = input.jump ? -5.2 : -3.5;
          Sound.sfx.stomp();
        } else {
          hurtPlayer();
          if (game.state !== 'play') return;
        }
      }
    }
    enemies = enemies.filter(e => !e.remove);
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
      // 剩余时间换算分数
      if (game.time > 0) {
        const d = Math.min(game.time, 2);
        game.time -= d;
        game.score += d * 50;
        if (game.stateT % 3 === 0) Sound.sfx.tick();
      } else if (game.stateT > 60) {
        saveBest();
        game.state = 'clear';
        game.stateT = 0;
      }
    }
    updateEffects();
    updateCamera();
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
        updatePlayer();
        if (game.state !== 'play') break;
        updateItems();
        updateEnemies();
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
    for (const d of DECO) {
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

  function tileImage(t) {
    switch (t) {
      case GROUND: return TILE.ground;
      case BRICK: case BRICK_COINS: return TILE.brick;
      case QCOIN: case QMUSH: {
        const seq = [0, 0, 0, 0, 1, 2, 2, 1];
        return TILE.q[seq[Math.floor(game.frame / 8) % seq.length]];
      }
      case USED: return TILE.used;
      case HARD: return TILE.hard;
      case PTL: return TILE.pipeTL;
      case PTR: return TILE.pipeTR;
      case PL: return TILE.pipeL;
      case PR: return TILE.pipeR;
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
        const b = bumps.get(ty * LW + tx);
        const off = b !== undefined ? -Math.round(Math.sin(b / 10 * Math.PI) * 5) : 0;
        ctx.drawImage(tileImage(t), tx * T - cx, ty * T + off);
      }
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
    text('1-1', cols[2], 16);
    text('时间', cols[3], 6);
    const showTime = ['play', 'dying', 'flag'].includes(game.state);
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
    ctx.fillStyle = SKY;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawDeco(cx);
    drawCastle(cx);
    drawFlag(cx);
    drawItems(cx, true);
    drawTiles(cx);
    drawItems(cx, false);
    drawEnemies(cx);
    if (player) drawPlayer(cx);
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
        text('世界 1-1', mid, 90, { size: 10, align: 'center' });
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
      const w = Math.min(220, VIEW_W - 24), h = 92;
      const x = Math.round(mid - w / 2), y = 36;
      panel(x, y, w, h);
      text('超级玛丽', mid, y + 12, { size: 22, align: 'center', color: '#fcd8a8' });
      text('SUPER MARIO · H5', mid, y + 42, { size: 8, align: 'center', color: '#fff' });
      text('最高分 ' + pad(best, 6), mid, y + 62, { size: 7, align: 'center', color: '#fcd8a8' });
      if (Math.floor(game.frame / 30) % 2 === 0) {
        text('▶ 点击屏幕 / 按回车 开始', mid, 140, { size: 9, align: 'center' });
      }
      const touchUI = document.body.classList.contains('touch');
      text(touchUI ? '◀ ▶ 移动(一直走会自动加速)   A 跳跃' : '←→ 移动(一直走会自动加速)   Z/空格 跳跃   P 暂停',
        mid, 158, { size: 7, align: 'center', color: '#fcfcfc' });
    } else if (game.state === 'clear') {
      const w = Math.min(200, VIEW_W - 24), h = 70;
      const x = Math.round(mid - w / 2), y = 50;
      panel(x, y, w, h);
      text('恭喜通关！', mid, y + 12, { size: 16, align: 'center', color: '#fcd8a8' });
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
  window.__smb = { game, get player() { return player; }, get enemies() { return enemies; }, get camX() { return camX; } };
})();
