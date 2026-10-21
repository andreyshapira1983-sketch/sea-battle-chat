"use strict";
// Тесты рисования «Морского боя чата», часть 2. Поддельный холст из
// tests/helpers.js, но с записью стилей и путей: так проверяем, что подписи
// стоят в правильном порядке, корона крупная, ядро заметное, а метки и
// частицы действительно рисуются.
//
// Главные требования ТЗ: 100 кадров без исключений, прозрачный фон вне моря,
// текст с обводкой, подписи без наезда (через SB.Layout), «−1»/«щит!»,
// стрелка стрелка и прицел, все виды частиц.
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, readProject, makeFakeCanvas } = require("./helpers");

const LAYOUT_FILE = "js/layout.js";
const RENDER_FILE = "js/render.js";

// ------------------------------------------------------------------
// Загрузка скриптов
// ------------------------------------------------------------------
function loadPair() {
  const SB = loadGlobal([LAYOUT_FILE, RENDER_FILE]);
  return { SB: SB, Render: SB.Render, Layout: SB.Layout };
}

function loadRenderOnly() {
  // Страница части 1 без js/layout.js: рисование обязано пережить.
  const SB = loadGlobal([RENDER_FILE]);
  return SB.Render;
}

// ------------------------------------------------------------------
// Поддельный холст со счётчиками, стилями и границами путей
// ------------------------------------------------------------------
function makeTrackedCanvas(width, height) {
  const fake = makeFakeCanvas(width, height);
  const { canvas, ctx, calls } = fake;
  const records = {
    events: [],
    clearRects: [],
    fillRects: [],
    strokeRects: [],
    fills: [],
    strokes: [],
    pathFills: [],
    pathStrokes: [],
    texts: [],
    textStyles: [],
    strokeTexts: [],
    strokeTextStyles: [],
    gradients: [],
    transforms: [],
  };
  const pathState = { points: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  function track(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    pathState.points.push([x, y]);
    pathState.minX = Math.min(pathState.minX, x);
    pathState.minY = Math.min(pathState.minY, y);
    pathState.maxX = Math.max(pathState.maxX, x);
    pathState.maxY = Math.max(pathState.maxY, y);
  }

  function resetPath() {
    pathState.points = [];
    pathState.minX = Infinity;
    pathState.minY = Infinity;
    pathState.maxX = -Infinity;
    pathState.maxY = -Infinity;
  }

  function pathBounds() {
    if (!Number.isFinite(pathState.minX)) return null;
    return {
      x: pathState.minX,
      y: pathState.minY,
      w: pathState.maxX - pathState.minX,
      h: pathState.maxY - pathState.minY,
      minX: pathState.minX,
      minY: pathState.minY,
      maxX: pathState.maxX,
      maxY: pathState.maxY,
      cx: (pathState.minX + pathState.maxX) / 2,
      cy: (pathState.minY + pathState.maxY) / 2,
    };
  }

  function snapshotPath() {
    return { points: pathState.points.slice(), bounds: pathBounds() };
  }

  function wrap(name, handler) {
    const original = ctx[name];
    if (typeof original !== "function") return;
    ctx[name] = function () {
      const args = Array.prototype.slice.call(arguments);
      handler(args);
      return original.apply(ctx, args);
    };
  }

  wrap("beginPath", function () {
    resetPath();
  });
  wrap("moveTo", function (args) {
    track(args[0], args[1]);
  });
  wrap("lineTo", function (args) {
    track(args[0], args[1]);
  });
  wrap("quadraticCurveTo", function (args) {
    track(args[0], args[1]);
    track(args[2], args[3]);
  });
  wrap("bezierCurveTo", function (args) {
    track(args[0], args[1]);
    track(args[2], args[3]);
    track(args[4], args[5]);
  });
  wrap("arc", function (args) {
    const radius = Math.abs(Number(args[2]) || 0);
    track(args[0] - radius, args[1] - radius);
    track(args[0] + radius, args[1] + radius);
  });
  wrap("ellipse", function (args) {
    const rx = Math.abs(Number(args[2]) || 0);
    const ry = Math.abs(Number(args[3]) || 0);
    track(args[0] - rx, args[1] - ry);
    track(args[0] + rx, args[1] + ry);
  });
  wrap("clearRect", function (args) {
    records.clearRects.push(args.slice(0, 4));
    records.events.push({ name: "clearRect" });
  });
  wrap("fillRect", function (args) {
    records.fillRects.push({
      x: args[0], y: args[1], w: args[2], h: args[3],
      style: ctx.fillStyle, alpha: ctx.globalAlpha,
    });
    records.events.push({ name: "fillRect" });
  });
  wrap("strokeRect", function (args) {
    records.strokeRects.push({ x: args[0], y: args[1], w: args[2], h: args[3] });
  });
  wrap("fill", function () {
    records.fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha });
    records.pathFills.push({
      style: ctx.fillStyle,
      alpha: ctx.globalAlpha,
      bounds: pathBounds(),
      points: pathState.points.slice(),
    });
  });
  wrap("stroke", function () {
    records.strokes.push({
      style: ctx.strokeStyle,
      width: ctx.lineWidth,
      alpha: ctx.globalAlpha,
    });
    records.pathStrokes.push({
      style: ctx.strokeStyle,
      width: ctx.lineWidth,
      alpha: ctx.globalAlpha,
      bounds: pathBounds(),
      points: pathState.points.slice(),
    });
  });
  wrap("fillText", function (args) {
    const value = String(args[0]);
    records.texts.push(value);
    records.textStyles.push({
      text: value,
      x: args[1],
      y: args[2],
      fill: ctx.fillStyle,
      font: ctx.font,
      align: ctx.textAlign,
      alpha: ctx.globalAlpha,
      lineWidth: ctx.lineWidth,
    });
    records.events.push({ name: "fillText", text: value });
  });
  wrap("strokeText", function (args) {
    const value = String(args[0]);
    records.strokeTexts.push(value);
    records.strokeTextStyles.push({
      text: value,
      color: ctx.strokeStyle,
      lineWidth: ctx.lineWidth,
      font: ctx.font,
    });
  });
  wrap("setTransform", function (args) {
    records.transforms.push(args.slice(0, 6));
  });

  ctx.createLinearGradient = function () {
    const stops = [];
    records.gradients.push(stops);
    calls.createGradient = (calls.createGradient || 0) + 1;
    return {
      addColorStop(offset, color) {
        stops.push([offset, color]);
      },
    };
  };
  ctx.createRadialGradient = function () {
    const stops = [];
    records.gradients.push(stops);
    return {
      addColorStop(offset, color) {
        stops.push([offset, color]);
      },
    };
  };

  return {
    canvas,
    ctx,
    calls,
    records,
    reset() {
      for (const key of Object.keys(records)) {
        if (records[key] === null) delete records[key];
        else records[key].length = 0;
      }
      for (const key of Object.keys(calls)) delete calls[key];
    },
  };
}

function makeRenderer(width, height, options) {
  const pair = loadPair();
  const tracked = makeTrackedCanvas(width || 1280, height || 720);
  const renderer = pair.Render.create(tracked.canvas, options || {});
  return { tracked, renderer, Render: pair.Render, Layout: pair.Layout };
}

function pathFills(records, style) {
  return records.pathFills.filter(function (item) {
    return item.style === style && item.bounds;
  });
}

function pathStrokes(records, style) {
  return records.pathStrokes.filter(function (item) {
    return item.style === style && item.bounds;
  });
}

function mergeBounds(items) {
  let result = null;
  for (const item of items) {
    const box = item.bounds;
    if (!box) continue;
    if (!result) {
      result = { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY };
    } else {
      result.minX = Math.min(result.minX, box.minX);
      result.minY = Math.min(result.minY, box.minY);
      result.maxX = Math.max(result.maxX, box.maxX);
      result.maxY = Math.max(result.maxY, box.maxY);
    }
  }
  if (!result) return null;
  result.w = result.maxX - result.minX;
  result.h = result.maxY - result.minY;
  result.cx = (result.minX + result.maxX) / 2;
  result.cy = (result.minY + result.maxY) / 2;
  return result;
}

function fontSize(font) {
  const match = /^(?:\d+\s+)?(\d+(?:\.\d+)?)px/.exec(String(font));
  return match ? Number(match[1]) : NaN;
}

function textStylesByText(records, value) {
  return records.textStyles.filter(function (style) {
    return style.text === value;
  });
}

// ------------------------------------------------------------------
// Снимки кадра
// ------------------------------------------------------------------
function makeShip(extra) {
  return Object.assign(
    {
      id: 1,
      user: "captain",
      name: "Капитан",
      color: "#ff3366",
      x: 0.3,
      y: 0.8,
      dir: 1,
      hp: 3,
      maxHp: 3,
      shield: false,
      state: "sailing",
      sinkProgress: 0,
      crown: false,
      phase: 0.25,
      lastActiveAt: 0,
      row: 0,
      scale: 1,
      shake: 0,
    },
    extra || {},
  );
}

function makeFrame(extra) {
  return Object.assign(
    {
      now: 1000,
      paused: false,
      theme: "sea",
      seaHeight: 0.3,
      shipScale: 1,
      lang: "ru",
      leaderboardOn: true,
      round: {
        state: "playing",
        number: 1,
        alive: 2,
        total: 2,
        participants: [],
        winner: null,
        banner: null,
        finishedAt: null,
        nextRoundAt: null,
      },
      ships: [],
      shots: [],
      particles: [],
      labels: [],
      marks: [],
      queue: 0,
      drowned: [],
      leaderboard: [],
    },
    extra || {},
  );
}

function makeLeaderboard(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ user: "user" + (i + 1), name: "Игрок" + (i + 1), wins: 10 - i });
  }
  return rows;
}

function shipInRow(Layout, row, slot, extra) {
  return makeShip(
    Object.assign(
      {
        row: row,
        scale: Layout.rowScale(row),
        x: Layout.slotX(row, slot, 1),
        y: Layout.rowY(row, 0.3),
      },
      extra || {},
    ),
  );
}

/** Набор кадров на все требования части 2. */
function makeShowcaseFrames(Layout) {
  const frames = [];
  const push = function (title, frame) {
    frames.push({ title: title, frame: frame });
  };

  push("пустой кадр", makeFrame());
  push("старый кадр без новых полей", {
    now: 500,
    paused: false,
    theme: "sea",
    seaHeight: 0.3,
    shipScale: 1,
    lang: "ru",
    leaderboardOn: true,
    round: { state: "waiting", banner: null },
    ships: [
      { id: 1, user: "old", name: "Старый", color: "#88ccff", x: 0.3, y: 0.8, dir: 1, hp: 3, maxHp: 3, shield: false, state: "sailing", sinkProgress: 0, crown: false, phase: 0.1 },
    ],
    shots: [],
    particles: [],
    queue: 0,
    drowned: [],
    leaderboard: [],
  });
  push("три ряда кораблей", makeFrame({
    now: 2500,
    ships: [
      shipInRow(Layout, 0, 1, { id: 1, user: "a", name: "Анна", color: "#ff3366" }),
      shipInRow(Layout, 1, 2, { id: 2, user: "b", name: "Борис", color: "#33cc88", dir: -1 }),
      shipInRow(Layout, 2, 3, { id: 3, user: "c", name: "Вера", color: "#6699ff", hp: 2 }),
    ],
  }));
  push("корабль тонет", makeFrame({
    now: 3100,
    ships: [
      shipInRow(Layout, 0, 1, { state: "sinking", sinkProgress: 0.5, name: "Тонущий" }),
      shipInRow(Layout, 1, 2, { id: 2, user: "b", name: "Борис", color: "#33cc88" }),
    ],
  }));
  push("корабль уплывает", makeFrame({
    now: 4000,
    ships: [shipInRow(Layout, 0, 8, { state: "leaving", dir: 1, name: "Уплыл" })],
  }));
  push("щит, корона и баннер", makeFrame({
    now: 5000,
    ships: [shipInRow(Layout, 0, 4, { shield: true, crown: true, hp: 2, name: "Победитель", user: "w" })],
    round: {
      state: "finished",
      number: 1,
      alive: 1,
      total: 2,
      participants: [],
      winner: { user: "w", name: "Победитель", color: "#ff3366" },
      banner: { text: "Победитель раунда: Победитель", until: 11000, name: "Победитель", color: "#ff3366" },
      finishedAt: 5000,
      nextRoundAt: 11000,
    },
  }));
  push("тряска от попадания", makeFrame({
    now: 5200,
    ships: [shipInRow(Layout, 1, 5, { shake: 1, hp: 2, name: "Трясётся", color: "#ffaa33" })],
  }));
  push("метки и ярлыки", makeFrame({
    now: 5400,
    ships: [shipInRow(Layout, 0, 2, { name: "Стрелок", user: "shooter" })],
    labels: [
      { text: "-1", color: "#ff4d5e", x: 0.45, y: 0.8, born: 5000, until: 5900, size: 1 },
      { text: "щит!", color: "#9fe8ff", x: 0.6, y: 0.82, born: 5100, until: 6100, size: 1 },
    ],
    marks: [
      { kind: "shot", x: 0.3, y: 0.8, tx: 0.7, ty: 0.82, until: 6400, born: 5400 },
      { kind: "aim", x: 0.7, y: 0.82, tx: 0.3, ty: 0.8, until: 6100, born: 5400 },
    ],
  }));
  push("ядра и все частицы", makeFrame({
    now: 6000,
    ships: [shipInRow(Layout, 0, 1, { name: "Анна" }), shipInRow(Layout, 1, 3, { name: "Борис", color: "#33cc88" })],
    shots: [
      { id: 1, fromX: 0.2, fromY: 0.78, toX: 0.7, toY: 0.82, x: 0.45, y: 0.6, progress: 0.5, shooter: "a" },
      { id: 2, fromX: 0.4, fromY: 0.86, toX: 0.2, toY: 0.8, x: 0.2, y: 0.8, progress: 1 },
    ],
    particles: [
      { x: 0.3, y: 0.8, vx: 0.1, vy: -0.2, life: 0.6, maxLife: 1.2, color: "#ffe9a8", kind: "muzzle", size: 3 },
      { x: 0.35, y: 0.8, vx: 0.1, vy: -0.1, life: 0.5, maxLife: 1, color: "#cfd6de", kind: "smoke", size: 4 },
      { x: 0.5, y: 0.85, vx: 0, vy: -0.3, life: 0.4, maxLife: 0.8, color: "#7ec8ff", kind: "splash", size: 5 },
      { x: 0.55, y: 0.84, vx: 0.2, vy: -0.2, life: 0.3, maxLife: 0.6, color: "#ff3366", kind: "hit", size: 3 },
      { x: 0.6, y: 0.83, vx: -0.2, vy: -0.3, life: 0.4, maxLife: 0.8, color: "#a9743f", kind: "splinter", size: 2.5 },
      { x: 0.65, y: 0.82, vx: 0, vy: -0.1, life: 0.5, maxLife: 1, color: "#9fe8ff", kind: "shield", size: 4 },
      { x: 0.7, y: 0.82, vx: 0, vy: 0, life: 0.2, maxLife: 0.4, color: "#abcdef", kind: "unknown", size: 2 },
    ],
  }));
  push("без моря", makeFrame({
    now: 9000,
    theme: "none",
    ships: [shipInRow(Layout, 0, 1, { name: "Анна" }), shipInRow(Layout, 2, 4, { name: "Вера", color: "#6699ff" })],
    leaderboard: makeLeaderboard(5),
  }));
  push("мелкий масштаб и английский", makeFrame({
    now: 10000,
    seaHeight: 0.6,
    shipScale: 0.6,
    lang: "en",
    leaderboardOn: false,
    ships: [shipInRow(Layout, 0, 3, { name: "VeryLongName", x: 0.5, color: "#33cc88" })],
  }));
  push("таблица, очередь и дно", makeFrame({
    now: 6000,
    ships: [shipInRow(Layout, 0, 2, { name: "Анна" })],
    leaderboard: makeLeaderboard(7),
    queue: 3,
    drowned: [{ user: "d", name: "Гарри" }, { user: "e", name: "Джек" }],
  }));
  push("английский и пауза", makeFrame({
    now: 7000,
    paused: true,
    lang: "en",
    ships: [shipInRow(Layout, 0, 2, { name: "Anna" })],
    leaderboard: makeLeaderboard(3),
    queue: 2,
    drowned: [{ user: "d", name: "Harry" }],
    round: {
      state: "finished",
      number: 2,
      banner: { text: "Round winner: Anna", until: 12000, name: "Anna", color: "#ff3366" },
      finishedAt: 7000,
      nextRoundAt: 17000,
    },
  }));
  push("мусор в снимке", {
    now: "не число",
    theme: 42,
    seaHeight: "высоко",
    shipScale: null,
    lang: "xx",
    ships: [
      null,
      "корабль",
      {},
      makeShip({ row: "x", scale: "y", shake: "z", x: "слева", y: null, color: null }),
    ],
    shots: [null, {}, { fromX: "a" }],
    particles: [null, {}, { life: 1, maxLife: 0, kind: null }],
    labels: [null, {}, { text: null }, { text: "x", born: "a", until: "b" }],
    marks: [null, {}, { kind: "shot" }, { kind: "aim" }],
    queue: "много",
    drowned: [null, {}, { name: 42 }],
    leaderboard: [null, {}, { name: "Без побед" }],
    round: "раунд",
  });
  return frames;
}

function drawFrame(renderer, frame, title) {
  try {
    renderer.draw(frame, 0.033);
  } catch (error) {
    assert.fail(
      "кадр «" + title + "» бросил исключение: " +
        (error && error.stack ? error.stack : error),
    );
  }
}

// ------------------------------------------------------------------
// Статические правила файла и API
// ------------------------------------------------------------------
test("render.js: IIFE без внешних адресов, картинок и модулей", function () {
  const source = readProject(RENDER_FILE);
  assert.match(
    source,
    /^\s*\/\*[\s\S]*?\*\/\s*\(function\s*\(global\)/,
    "должен быть IIFE с шапкой-комментарием",
  );
  assert.match(source, /"use strict"/);
  assert.ok(!/^\s*import\s/m.test(source), "найден import");
  assert.ok(!/^\s*export\s/m.test(source), "найден export");
  assert.ok(!/\bimport\s*\(/.test(source), "найден динамический import");
  assert.ok(!/\beval\s*\(/.test(source), "найден eval");
  assert.equal(source.match(/(?:https?|wss?):\/\//g), null, "внешних адресов быть не должно");
  assert.ok(!/\bnew\s+Image\b/.test(source), "картинок из интернета быть не должно");
  assert.ok(!/\bdocument\./.test(source), "рисованию не нужен document");
  assert.ok(source.indexOf("SB.Layout") >= 0, "геометрия берётся из SB.Layout");
});

test("SB.Render: API части 1 и новые экспорты ядра", function () {
  const { Render } = loadPair();
  assert.equal(Render.SEA_ALPHA, 0.5);
  assert.equal(Render.CANNONBALL_MIN, 3);
  assert.equal(Render.CANNONBALL_MAX, 5.5);
  assert.equal(typeof Render.cannonballRadius, "function");
  assert.equal(typeof Render.create, "function");
  const fake = makeFakeCanvas(800, 600);
  const renderer = Render.create(fake.canvas);
  assert.equal(renderer.canvas, fake.canvas);
  assert.equal(typeof renderer.draw, "function");
  assert.equal(typeof renderer.resize, "function");
  assert.equal(typeof renderer.clear, "function");
  assert.equal(renderer.width, 800);
});

test("cannonballRadius: 1920×1080 ≈ 3,5 и всегда в границах 3–5,5", function () {
  const { Render } = loadPair();
  const clean = Render.cannonballRadius(1920, 1080, 1);
  assert.ok(Math.abs(clean - 3.456) < 0.05, "при 1920×1080 радиус ≈ 3,5, а " + clean);
  const sizes = [
    [320, 180],
    [640, 360],
    [1280, 720],
    [1920, 1080],
    [3840, 2160],
    [100, 10000],
  ];
  for (const pair of sizes) {
    const radius = Render.cannonballRadius(pair[0], pair[1], 1);
    assert.ok(radius >= 3 && radius <= 5.5, "радиус вне границ: " + radius);
  }
  assert.ok(Render.cannonballRadius(1920, 1080, 0) >= 3);
  assert.ok(Render.cannonballRadius(1920, 1080, 4) <= 5.5);
  assert.ok(Number.isFinite(Render.cannonballRadius("x", null, "y")));
});

test("create(): без 2d-контекста — понятная ошибка", function () {
  const { Render } = loadPair();
  assert.throws(function () {
    Render.create(null);
  }, /2d/);
  assert.throws(function () {
    Render.create({ getContext: function () { return null; } });
  }, /2d/);
});

// ------------------------------------------------------------------
// 100 кадров, очистка и прозрачность
// ------------------------------------------------------------------
test("100 кадров подряд на новых снимках — без единого исключения", function () {
  const { tracked, renderer, Layout } = makeRenderer();
  const frames = makeShowcaseFrames(Layout);
  assert.ok(frames.length >= 10);
  tracked.reset();
  for (let i = 0; i < 100; i += 1) {
    const item = frames[i % frames.length];
    drawFrame(renderer, item.frame, "круг " + i + ", " + item.title);
  }
  assert.equal(tracked.records.clearRects.length, 100, "каждый кадр начинается с clearRect");
  assert.ok(tracked.calls.fillText > 100, "кадры действительно рисуют текст");
  assert.ok(tracked.calls.stroke > 100, "кадры действительно рисуют линии");
});

test("кадр очищается, а полоса воды — единственная широкая заливка", function () {
  const { tracked, renderer, Layout } = makeRenderer(1280, 720);
  const frames = makeShowcaseFrames(Layout);
  tracked.reset();
  for (const item of frames) drawFrame(renderer, item.frame, item.title);

  assert.equal(tracked.records.clearRects.length, frames.length);
  for (const rect of tracked.records.clearRects) {
    assert.deepEqual(rect, [0, 0, 1280, 720]);
  }
  // Фон вне моря прозрачен: заливать весь кадр нельзя.
  for (const rect of tracked.records.fillRects) {
    const full = rect.x <= 0.5 && rect.y <= 0.5 && rect.w >= 1279 && rect.h >= 719;
    assert.ok(!full, "полный кадр залит fillRect");
  }
  const wide = tracked.records.fillRects.filter(function (rect) {
    return rect.w >= 1279;
  });
  // Широкая заливка — только вода (у остальных панелей ширина меньше).
  for (const rect of wide) {
    assert.ok(rect.h <= 720 && rect.y >= 0, "широкая заливка должна быть полосой воды");
  }
  assert.equal(tracked.records.events[0].name, "clearRect", "кадр начинается с очистки");
});

test("тема sea: полупрозрачный градиент, волны и пена", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(makeFrame({ theme: "sea", seaHeight: 0.3 }), 0.033);
  const water = tracked.records.fillRects.find(function (rect) {
    return rect.w >= 1279 && Math.abs(rect.h - 216) <= 2;
  });
  assert.ok(water, "вода должна заливать полосу 30% кадра");
  assert.ok(Math.abs(water.y - 504) <= 1, "вода прижата к низу");
  const gradient = tracked.records.gradients.find(function (stops) {
    return stops.length >= 2;
  });
  assert.ok(gradient, "вода должна быть градиентом");
  for (const stop of gradient) {
    assert.match(String(stop[1]), /,0\.5\)$/, "цвет воды полупрозрачный: " + stop[1]);
  }
  assert.ok(tracked.calls.stroke > 0 && tracked.calls.arc > 0);
});

test("тема none: воды нет, корабли и подписи остаются", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(makeFrame({ theme: "none", ships: [makeShip()] }), 0.033);
  const wideWater = tracked.records.fillRects.filter(function (rect) {
    return rect.w >= 1279 && rect.h >= 72;
  });
  assert.equal(wideWater.length, 0, "без моря широкой заливки быть не должно");
  assert.ok(tracked.records.texts.includes("Капитан"));
});

// ------------------------------------------------------------------
// Ряды и подписи (SB.Layout)
// ------------------------------------------------------------------
test("ряды: дальний ряд ниже и мельче, имя идёт по SB.Layout", function () {
  const { tracked, renderer, Layout } = makeRenderer(1920, 1080);
  const ships = [
    makeShip({ id: 1, row: 0, scale: Layout.rowScale(0), name: "Ряд0", x: 0.2, y: Layout.rowY(0, 0.3) }),
    makeShip({ id: 2, row: 1, scale: Layout.rowScale(1), name: "Ряд1", x: 0.5, y: Layout.rowY(1, 0.3) }),
    makeShip({ id: 3, row: 2, scale: Layout.rowScale(2), name: "Ряд2", x: 0.8, y: Layout.rowY(2, 0.3) }),
  ];
  tracked.reset();
  renderer.draw(makeFrame({ ships: ships }), 0.033);
  const first = textStylesByText(tracked.records, "Ряд0")[0];
  const second = textStylesByText(tracked.records, "Ряд1")[0];
  const third = textStylesByText(tracked.records, "Ряд2")[0];
  assert.ok(first && second && third, "все три имени нарисованы");
  const font0 = fontSize(first.font);
  const font1 = fontSize(second.font);
  const font2 = fontSize(third.font);
  assert.ok(font0 > font1 && font1 > font2, "размер шрифта падает с рядом: " + [font0, font1, font2]);
  assert.ok(first.y < second.y && second.y < third.y, "дальний ряд ниже");
  // Порядок рисования: дальний ряд первым, чтобы передние перекрывали.
  assert.equal(tracked.records.texts[0], "Ряд2");
  assert.equal(tracked.records.texts[tracked.records.texts.length - 1], "Ряд0");
});

test("подпись: имя выше сердечек, оба выше корабля", function () {
  const { tracked, renderer, Layout } = makeRenderer(1920, 1080);
  const y = Layout.rowY(0, 0.3);
  const frame = makeFrame({ ships: [makeShip({ name: "Капитан", x: 0.5, y: y, row: 0, scale: 1 })] });
  tracked.reset();
  renderer.draw(frame, 0.033);
  const name = textStylesByText(tracked.records, "Капитан")[0];
  assert.ok(name, "имя нарисовано");
  const hearts = mergeBounds(pathFills(tracked.records, "#ff5d7e"));
  assert.ok(hearts, "сердечки нарисованы заливкой");
  assert.ok(name.y < hearts.cy, "имя должно быть выше сердечек");
  assert.ok(hearts.maxY < y * 1080, "сердечки должны быть выше корабля");
  assert.ok(hearts.minY > name.y, "низ имени не наезжает на сердечки");
});

test("30 кораблей на трёх рядах: подписи не пересекаются и рисуются", function () {
  const { tracked, renderer, Layout } = makeRenderer(1920, 1080);
  const plan = [9, 11, 10];
  for (let row = 0; row < 3; row += 1) {
    assert.ok(plan[row] <= Layout.capacity(row, 1), "план не влезает в ряд " + row);
  }
  const ships = [];
  let index = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let slot = 0; slot < plan[row]; slot += 1) {
      index += 1;
      ships.push(
        shipInRow(Layout, row, slot, {
          id: index,
          user: "u" + index,
          name: "Капитан" + index,
          color: index % 2 ? "#ff3366" : "#33cc88",
        }),
      );
    }
  }
  assert.equal(ships.length, 30);
  const options = { width: 1920, height: 1080, shipScale: 1, seaHeight: 0.3 };
  assert.deepEqual(Layout.findLabelCollisions(ships, options), [], "подписи пересекаются");
  tracked.reset();
  assert.doesNotThrow(function () {
    renderer.draw(makeFrame({ ships: ships }), 0.033);
  });
  assert.equal(tracked.records.texts.length, 30, "должны быть все 30 подписей");
});

test("те же 30 подписей не пересекаются и на 1280×720", function () {
  const { Layout } = makeRenderer(1280, 720);
  const ships = [];
  const plan = [9, 11, 10];
  let index = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let slot = 0; slot < plan[row]; slot += 1) {
      index += 1;
      ships.push(shipInRow(Layout, row, slot, { id: index, user: "u" + index, name: "Капитан" + index }));
    }
  }
  assert.deepEqual(
    Layout.findLabelCollisions(ships, { width: 1280, height: 720, shipScale: 1, seaHeight: 0.3 }),
    [],
  );
});

test("shipScale увеличивает корабль и подпись", function () {
  const { tracked, renderer } = makeRenderer(1920, 1080);
  tracked.reset();
  renderer.draw(
    makeFrame({ shipScale: 0.6, ships: [makeShip({ name: "Мелкий", x: 0.3, y: 0.8 })] }),
    0.033,
  );
  const small = fontSize(textStylesByText(tracked.records, "Мелкий")[0].font);
  tracked.reset();
  renderer.draw(
    makeFrame({ shipScale: 2, ships: [makeShip({ name: "Крупный", x: 0.7, y: 0.8 })] }),
    0.033,
  );
  const large = fontSize(textStylesByText(tracked.records, "Крупный")[0].font);
  assert.ok(large > small, "при ship_scale=2 подпись крупнее: " + [small, large]);
});

test("старый кадр без row/scale использует нулевой ряд раскладки", function () {
  const { tracked, renderer, Layout } = makeRenderer(1920, 1080);
  const ship = makeShip({ name: "Старый", x: 0.4, y: 0.8 });
  delete ship.row;
  delete ship.scale;
  delete ship.shake;
  tracked.reset();
  renderer.draw({ now: 0, theme: "sea", seaHeight: 0.3, shipScale: 1, ships: [ship] }, 0.033);
  const name = textStylesByText(tracked.records, "Старый")[0];
  assert.ok(name, "имя нарисовано");
  const expected = Math.round(clampLocal(Layout.fontPx(0, 1, 1920), 12, 30));
  assert.equal(fontSize(name.font), expected);
});

function clampLocal(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// ------------------------------------------------------------------
// Корабли: состояния, щит, тряска, корона
// ------------------------------------------------------------------
test("корабль: ник с обводкой 3–5 px и парус цветом ника", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(makeFrame({ ships: [makeShip()] }), 0.033);
  assert.ok(tracked.records.texts.includes("Капитан"));
  assert.ok(tracked.records.strokeTexts.includes("Капитан"));
  const outlined = tracked.records.strokeTextStyles.find(function (style) {
    return style.text === "Капитан";
  });
  assert.ok(outlined.lineWidth >= 3 && outlined.lineWidth <= 5);
  assert.ok(
    tracked.records.fills.some(function (fill) {
      return fill.style === "#ff3366";
    }),
    "парус цветом корабля",
  );
});

test("сердца: целые заливкой, потерянные контуром (3 из 3 и 2 из 3)", function () {
  const { Render } = loadPair();
  const full = makeTrackedCanvas(1280, 720);
  Render.create(full.canvas).draw(makeFrame({ ships: [makeShip({ hp: 3 })] }), 0.033);
  assert.equal(
    full.records.fills.filter(function (fill) { return fill.style === "#ff5d7e"; }).length,
    3,
  );

  const hurt = makeTrackedCanvas(1280, 720);
  Render.create(hurt.canvas).draw(makeFrame({ ships: [makeShip({ hp: 2 })] }), 0.033);
  assert.equal(
    hurt.records.fills.filter(function (fill) { return fill.style === "#ff5d7e"; }).length,
    2,
  );
  assert.equal(
    hurt.records.strokes.filter(function (stroke) {
      return stroke.style === "rgba(214,229,240,0.85)";
    }).length,
    1,
    "одно потерянное сердце — контуром",
  );
});

test("все состояния: sailing, sinking с прогрессом, leaving", function () {
  const { tracked, renderer } = makeRenderer();
  tracked.reset();
  drawFrame(renderer, makeFrame({ ships: [makeShip({ state: "sailing" })] }), "sailing");
  assert.ok(tracked.records.fills.length > 0);

  tracked.reset();
  drawFrame(
    renderer,
    makeFrame({ ships: [makeShip({ state: "sinking", sinkProgress: 0.5 })] }),
    "sinking",
  );
  assert.ok(
    tracked.records.fills.some(function (fill) {
      return fill.alpha < 0.9 && fill.alpha > 0.1;
    }),
    "тонущий корабль бледнеет",
  );

  tracked.reset();
  drawFrame(renderer, makeFrame({ ships: [makeShip({ state: "leaving", x: 0.98 })] }), "leaving");
  assert.ok(
    tracked.records.fills.some(function (fill) {
      return Math.abs(fill.alpha - 0.92) < 0.0001;
    }),
    "уплывающий корабль чуть прозрачнее",
  );
});

test("щит: вокруг корабля появляется защитный круг", function () {
  const { Render } = loadPair();
  const plain = makeTrackedCanvas(1280, 720);
  Render.create(plain.canvas).draw(makeFrame({ ships: [makeShip()] }), 0.033);
  const shielded = makeTrackedCanvas(1280, 720);
  Render.create(shielded.canvas).draw(makeFrame({ ships: [makeShip({ shield: true })] }), 0.033);
  assert.ok(shielded.calls.ellipse > plain.calls.ellipse, "щит добавляет эллипс");
  assert.ok(
    shielded.records.strokes.some(function (stroke) {
      return stroke.style === "#9fe1ff";
    }),
  );
});

test("тряска: корабль и подпись смещаются по X на sin(now·2π·9)·unit·0.12", function () {
  const { tracked, renderer, Layout } = makeRenderer(1280, 720);
  const unit = Layout.unitPx(0, 1, 1280, 720);
  const y = Layout.rowY(0, 0.3);
  const frameAt = function (now) {
    return makeFrame({
      now: now,
      ships: [makeShip({ name: "Тряска", x: 0.5, y: y, row: 0, scale: 1, shake: 1 })],
    });
  };
  tracked.reset();
  renderer.draw(frameAt(0), 0.033);
  const x0 = textStylesByText(tracked.records, "Тряска")[0].x;
  tracked.reset();
  renderer.draw(frameAt(1000 / 36), 0.033); // sin(π/2) = 1
  const x1 = textStylesByText(tracked.records, "Тряска")[0].x;
  assert.ok(
    Math.abs((x1 - x0) - unit * 0.12) < 0.0001,
    "смещение " + (x1 - x0) + " вместо " + unit * 0.12,
  );

  // Без тряски подпись не прыгает.
  const calm = function (now) {
    return makeFrame({
      now: now,
      ships: [makeShip({ name: "Тряска", x: 0.5, y: y, row: 0, scale: 1, shake: 0 })],
    });
  };
  tracked.reset();
  renderer.draw(calm(0), 0.033);
  const calm0 = textStylesByText(tracked.records, "Тряска")[0].x;
  tracked.reset();
  renderer.draw(calm(1000 / 36), 0.033);
  const calm1 = textStylesByText(tracked.records, "Тряска")[0].x;
  assert.equal(calm1, calm0, "без тряски X подписи не меняется");
});

test("качка: ник плавно покачивается по Y от frame.now", function () {
  const { tracked, renderer, Layout } = makeRenderer(1280, 720);
  const unit = Layout.unitPx(0, 1, 1280, 720);
  const y = Layout.rowY(0, 0.3);
  const frameAt = function (now) {
    return makeFrame({
      now: now,
      ships: [makeShip({ name: "Качка", x: 0.4, y: y, row: 0, scale: 1, phase: 0, shake: 0 })],
    });
  };
  tracked.reset();
  renderer.draw(frameAt(0), 0.033);
  const y0 = textStylesByText(tracked.records, "Качка")[0].y;
  tracked.reset();
  renderer.draw(frameAt(1000 / 0.48), 0.033); // sin = 1 при 2π·0.12·t
  const y1 = textStylesByText(tracked.records, "Качка")[0].y;
  assert.ok(Math.abs((y1 - y0) - unit * 0.08) < 0.6, "покачивание по Y: " + (y1 - y0));
});

test("корона крупная, золотая и над именем", function () {
  const { tracked, renderer, Layout } = makeRenderer(1920, 1080);
  const unit = Layout.unitPx(0, 1, 1920, 1080);
  const y = Layout.rowY(0, 0.3);
  tracked.reset();
  renderer.draw(
    makeFrame({ ships: [makeShip({ name: "Король", crown: true, x: 0.5, y: y, row: 0, scale: 1 })] }),
    0.033,
  );
  const crowns = pathFills(tracked.records, "#ffd75e");
  const crown = mergeBounds(crowns);
  assert.ok(crown, "корона нарисована золотом");
  assert.ok(crown.h >= unit * 0.9 - 0.01, "высота короны " + crown.h + " при unit " + unit);
  const name = textStylesByText(tracked.records, "Король")[0];
  assert.ok(crown.maxY <= name.y, "корона должна быть над именем");
});

test("потопленный уходит вниз вместе с подписью", function () {
  const { tracked, renderer, Layout } = makeRenderer(1280, 720);
  const y = Layout.rowY(0, 0.3);
  tracked.reset();
  renderer.draw(makeFrame({ ships: [makeShip({ name: "Тонет", x: 0.5, y: y, sinkProgress: 0, state: "sinking" })] }), 0.033);
  const before = textStylesByText(tracked.records, "Тонет")[0].y;
  tracked.reset();
  renderer.draw(makeFrame({ ships: [makeShip({ name: "Тонет", x: 0.5, y: y, sinkProgress: 1, state: "sinking" })] }), 0.033);
  const after = textStylesByText(tracked.records, "Тонет")[0].y;
  assert.ok(after > before, "при sinkProgress=1 подпись ниже");
});

// ------------------------------------------------------------------
// Ядро, след, размер
// ------------------------------------------------------------------
test("ядро: дуга-след, тёмный кружок с обводкой и бликом", function () {
  const { tracked, renderer } = makeRenderer(1920, 1080);
  tracked.reset();
  renderer.draw(
    makeFrame({
      ships: [makeShip()],
      shots: [
        { id: 1, fromX: 0.15, fromY: 0.78, toX: 0.75, toY: 0.82, x: 0.5, y: 0.6, progress: 0.5 },
      ],
    }),
    0.033,
  );
  assert.ok(
    tracked.records.strokes.some(function (stroke) {
      return String(stroke.style).indexOf("rgba(236,247,255") === 0;
    }),
    "след полёта — светлая дуга",
  );
  assert.ok(tracked.records.fills.some(function (fill) { return fill.style === "#151b23"; }), "ядро тёмное");
  const outline = pathStrokes(tracked.records, "#04080d");
  const box = mergeBounds(outline);
  assert.ok(box, "ядро с тёмной обводкой");
  const expected = Render_radius(1920, 1080);
  assert.ok(
    Math.abs(box.w - expected * 2) < 0.6,
    "диаметр ядра " + box.w + " вместо " + expected * 2,
  );
  assert.ok(tracked.calls.lineTo > 5, "след строится из отрезков дуги");
});

function Render_radius(width, height) {
  const pair = loadPair();
  return pair.Render.cannonballRadius(width, height, 1);
}

test("ядро на краях полёта (progress 0 и 1) не ломает кадр", function () {
  const { renderer } = makeRenderer();
  assert.doesNotThrow(function () {
    renderer.draw(
      makeFrame({
        shots: [
          { fromX: 0.15, fromY: 0.78, toX: 0.75, toY: 0.82, progress: 0 },
          { fromX: 0.15, fromY: 0.78, toX: 0.75, toY: 0.82, progress: 1 },
        ],
      }),
      0.033,
    );
  });
});

// ------------------------------------------------------------------
// Частицы
// ------------------------------------------------------------------
test("частицы всех видов: muzzle, smoke, splash, hit, splinter, shield, точка", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(
    makeFrame({
      particles: [
        { x: 0.2, y: 0.8, vx: 0.1, vy: -0.2, life: 0.5, maxLife: 1, color: "#ffe9a8", kind: "muzzle", size: 3 },
        { x: 0.3, y: 0.8, vx: 0.1, vy: -0.1, life: 0.5, maxLife: 1, color: "#cfd6de", kind: "smoke", size: 4 },
        { x: 0.4, y: 0.82, vx: 0, vy: -0.3, life: 0.4, maxLife: 0.8, color: "#7ec8ff", kind: "splash", size: 5 },
        { x: 0.5, y: 0.82, vx: 0.2, vy: -0.2, life: 0.3, maxLife: 0.6, color: "#ff3366", kind: "hit", size: 3 },
        { x: 0.6, y: 0.82, vx: -0.2, vy: -0.3, life: 0.4, maxLife: 0.8, color: "#a9743f", kind: "splinter", size: 2.5 },
        { x: 0.7, y: 0.82, vx: 0, vy: -0.1, life: 0.5, maxLife: 1, color: "#9fe8ff", kind: "shield", size: 4 },
        { x: 0.8, y: 0.82, vx: 0, vy: 0, life: 0.2, maxLife: 0.4, color: "#abcdef", kind: "unknown", size: 2 },
      ],
    }),
    0.033,
  );
  assert.ok(pathFills(tracked.records, "#ffe9a8").length > 0, "muzzle — жёлтая звезда");
  assert.ok(
    pathFills(tracked.records, "#cfd6de").some(function (item) { return item.alpha < 0.6; }),
    "smoke — полупрозрачный клуб",
  );
  assert.ok(pathStrokes(tracked.records, "#7ec8ff").length > 0, "splash — кольцо");
  assert.ok(pathStrokes(tracked.records, "#ff3366").length > 0, "hit — искры цвета");
  assert.ok(pathStrokes(tracked.records, "#a9743f").length > 0, "splinter — щепки");
  assert.ok(pathStrokes(tracked.records, "#9fe8ff").length > 0, "shield — кольцо");
  assert.ok(pathFills(tracked.records, "#abcdef").length > 0, "неизвестный вид — точка");
});

test("частица с нулевой жизнью не рисуется", function () {
  const { tracked, renderer } = makeRenderer();
  tracked.reset();
  renderer.draw(
    makeFrame({
      particles: [
        { x: 0.3, y: 0.8, life: 0, maxLife: 1, color: "#abcdef", kind: "splash", size: 4 },
        { x: 0.3, y: 0.8, life: 0, maxLife: 1, color: "#abcdef", kind: "hit", size: 4 },
      ],
    }),
    0.033,
  );
  assert.equal(pathFills(tracked.records, "#abcdef").length, 0);
  assert.equal(pathStrokes(tracked.records, "#abcdef").length, 0);
});

test("300 частиц не роняют кадр (потолок — из мира)", function () {
  const { renderer } = makeRenderer();
  const particles = [];
  for (let i = 0; i < 300; i += 1) {
    particles.push({
      x: (i % 30) / 30,
      y: 0.7 + (i % 7) * 0.03,
      vx: 0.1,
      vy: -0.1,
      life: 1,
      maxLife: 2,
      color: i % 2 ? "#ff3366" : "#7ec8ff",
      kind: ["muzzle", "smoke", "splash", "hit", "splinter", "shield"][i % 6],
      size: 3,
    });
  }
  assert.doesNotThrow(function () {
    renderer.draw(makeFrame({ particles: particles }), 0.033);
  });
});

// ------------------------------------------------------------------
// Метки «-1»/«щит!» и стрелка/прицел
// ------------------------------------------------------------------
test("ярлыки «-1» и «щит!»: цвет, крупный кегль и подъём", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  const labels = [
    { text: "-1", color: "#ff4d5e", x: 0.4, y: 0.8, born: 0, until: 900, size: 1 },
    { text: "щит!", color: "#9fe8ff", x: 0.6, y: 0.8, born: 0, until: 1000, size: 1 },
  ];
  tracked.reset();
  renderer.draw(makeFrame({ now: 0, labels: labels }), 0.033);
  const minus = textStylesByText(tracked.records, "-1")[0];
  const shield = textStylesByText(tracked.records, "щит!")[0];
  assert.ok(minus && shield, "обе метки нарисованы");
  assert.equal(minus.fill, "#ff4d5e", "«-1» красная");
  assert.equal(shield.fill, "#9fe8ff", "«щит!» голубая");
  assert.ok(fontSize(minus.font) >= 20, "«-1» крупно: " + minus.font);
  assert.ok(minus.lineWidth >= 3, "у метки есть обводка");

  tracked.reset();
  renderer.draw(makeFrame({ now: 450, labels: labels }), 0.033);
  const risen = textStylesByText(tracked.records, "-1")[0];
  assert.ok(risen.y < minus.y, "метка поднимается за время жизни: " + [minus.y, risen.y]);

  tracked.reset();
  renderer.draw(makeFrame({ now: 1200, labels: labels }), 0.033);
  assert.equal(textStylesByText(tracked.records, "-1").length, 0, "просроченная метка исчезает");
});

test("стрелка стрелка: направление вправо и влево от стреляющего", function () {
  const { Render } = loadPair();
  const drawMark = function (tx) {
    const tracked = makeTrackedCanvas(1280, 720);
    Render.create(tracked.canvas).draw(
      makeFrame({
        now: 100,
        marks: [{ kind: "shot", x: 0.2, y: 0.8, tx: tx, ty: 0.8, born: 0, until: 1000 }],
      }),
      0.033,
    );
    const strokes = pathStrokes(tracked.records, "#ffe6a3");
    assert.ok(strokes.length > 0, "яркая стрелка нарисована");
    return strokes[strokes.length - 1].points;
  };

  const shooterX = 0.2 * 1280;
  const right = drawMark(0.9);
  assert.ok(
    right.some(function (point) { return point[0] > shooterX + 2; }),
    "стрелка смотрит вправо: " + JSON.stringify(right),
  );
  const left = drawMark(0.05);
  assert.ok(
    left.some(function (point) { return point[0] < shooterX - 2; }),
    "стрелка смотрит влево: " + JSON.stringify(left),
  );
});

test("прицел на цели: кружок с перекрестием, живёт до until", function () {
  const { Render } = loadPair();
  const aimFrame = function (now) {
    return makeFrame({
      now: now,
      marks: [{ kind: "aim", x: 0.7, y: 0.82, tx: 0.2, ty: 0.8, born: 0, until: 700 }],
    });
  };
  const visible = makeTrackedCanvas(1280, 720);
  Render.create(visible.canvas).draw(aimFrame(100), 0.033);
  const aimStrokes = pathStrokes(visible.records, "#ffe6a3");
  assert.ok(aimStrokes.length > 0, "прицел нарисован");
  const box = mergeBounds(aimStrokes);
  assert.ok(Math.abs(box.cx - 0.7 * 1280) < 30, "прицел стоит на цели по X");
  assert.ok(Math.abs(box.cy - 0.82 * 720) < 30, "прицел стоит на цели по Y");
  assert.ok(visible.calls.arc >= 2, "у прицела есть кружок");

  const expired = makeTrackedCanvas(1280, 720);
  Render.create(expired.canvas).draw(aimFrame(900), 0.033);
  assert.equal(pathStrokes(expired.records, "#ffe6a3").length, 0, "после until прицела нет");
});

test("стрелка над стрелком, а не на нём", function () {
  const { Render } = loadPair();
  const tracked = makeTrackedCanvas(1280, 720);
  Render.create(tracked.canvas).draw(
    makeFrame({
      now: 100,
      marks: [{ kind: "shot", x: 0.3, y: 0.8, tx: 0.8, ty: 0.8, born: 0, until: 1000 }],
    }),
    0.033,
  );
  const box = mergeBounds(pathStrokes(tracked.records, "#ffe6a3"));
  assert.ok(box.maxY < 0.8 * 720 - 4, "стрелка выше корабля");
});

// ------------------------------------------------------------------
// Баннер победителя
// ------------------------------------------------------------------
test("баннер победителя: крупный, по центру над морем, до until", function () {
  const { Render } = loadPair();
  const banner = { text: "Победитель раунда: Капитан", until: 5000, name: "Капитан", color: "#ff3366" };
  const visible = makeTrackedCanvas(1280, 720);
  Render.create(visible.canvas).draw(
    makeFrame({
      now: 1000,
      round: Object.assign(makeFrame().round, { banner: banner }),
    }),
    0.033,
  );
  const style = textStylesByText(visible.records, banner.text)[0];
  assert.ok(style, "баннер виден");
  const expected = clampLocal(720 * 0.045, 24, 64);
  assert.ok(Math.abs(fontSize(style.font) - expected) <= 1, "кегль баннера ~" + expected);
  assert.equal(style.fill, "#ffe6a3", "баннер золотой");
  assert.ok(Math.abs(style.x - 640) < 2, "баннер по центру");
  assert.ok(
    Math.abs(style.y - 0.7 * 720) <= 30,
    "середина баннера у линии моря, а не " + style.y,
  );
  assert.ok(style.y > 100, "баннер не улетел за верх кадра");
  assert.ok(visible.calls.strokeText > 0, "у баннера есть обводка");

  const expired = makeTrackedCanvas(1280, 720);
  Render.create(expired.canvas).draw(
    makeFrame({
      now: 6000,
      round: Object.assign(makeFrame().round, { banner: banner }),
    }),
    0.033,
  );
  assert.equal(textStylesByText(expired.records, banner.text).length, 0, "после until баннера нет");
});

test("баннер не перекрывает ник победителя", function () {
  const { Render } = loadPair();
  const bannerText = "Победитель раунда: Капитан";
  const tracked = makeTrackedCanvas(1920, 1080);
  Render.create(tracked.canvas).draw(
    makeFrame({
      now: 1000,
      ships: [makeShip({ name: "Капитан", x: 0.5, y: 0.799, row: 0, scale: 1 })],
      round: Object.assign(makeFrame().round, {
        winner: { user: "captain", name: "Капитан", color: "#ff3366" },
        banner: { text: bannerText, until: 5000, name: "Капитан", color: "#ff3366" },
      }),
    }),
    0.033,
  );
  const banner = textStylesByText(tracked.records, bannerText)[0];
  const name = textStylesByText(tracked.records, "Капитан")[0];
  assert.ok(banner && name, "и баннер, и имя нарисованы");
  const bannerTop = banner.y - fontSize(banner.font) * 0.9;
  assert.ok(name.y < bannerTop, "имя победителя выше баннера: " + [name.y, bannerTop]);
});

// ------------------------------------------------------------------
// Таблица, очередь, «на дне», пауза
// ------------------------------------------------------------------
test("таблица «Лучшие капитаны»: топ-5 в правом верхнем углу", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(makeFrame({ leaderboardOn: true, leaderboard: makeLeaderboard(7) }), 0.033);
  assert.ok(tracked.records.texts.includes("Лучшие капитаны"));
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(tracked.records.texts.includes("Игрок" + i));
  }
  assert.ok(!tracked.records.texts.includes("Игрок6"));
  const panel = tracked.records.fills.find(function (fill) {
    return String(fill.style).indexOf("rgba(5,18,33,0.62)") === 0;
  });
  assert.ok(panel, "таблица на тёмной подложке");
  const title = textStylesByText(tracked.records, "Лучшие капитаны")[0];
  assert.ok(title.x > 640 && title.y < 360, "таблица справа сверху");

  tracked.reset();
  renderer.draw(makeFrame({ leaderboardOn: false, leaderboard: makeLeaderboard(7) }), 0.033);
  assert.ok(!tracked.records.texts.includes("Лучшие капитаны"));
});

test("таблица по-английски: «Best captains»", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(makeFrame({ lang: "en", leaderboard: makeLeaderboard(3) }), 0.033);
  assert.ok(tracked.records.texts.includes("Best captains"));
});

test("очередь и «на дне»: русские и английские подписи", function () {
  const { Render } = loadPair();
  const drowned = [{ user: "d", name: "Гарри" }];
  const ru = makeTrackedCanvas(1280, 720);
  Render.create(ru.canvas).draw(makeFrame({ queue: 3, drowned: drowned, lang: "ru" }), 0.033);
  assert.ok(ru.records.texts.includes("+3 в очереди"));
  assert.ok(
    ru.records.texts.some(function (value) {
      return value.indexOf("на дне:") === 0 && value.indexOf("Гарри") >= 0;
    }),
  );

  const en = makeTrackedCanvas(1280, 720);
  Render.create(en.canvas).draw(makeFrame({ queue: 3, drowned: drowned, lang: "en" }), 0.033);
  assert.ok(en.records.texts.includes("+3 in queue"));
  assert.ok(
    en.records.texts.some(function (value) {
      return value.indexOf("at the bottom:") === 0 && value.indexOf("Гарри") >= 0;
    }),
  );

  const empty = makeTrackedCanvas(1280, 720);
  Render.create(empty.canvas).draw(makeFrame({ queue: 0, drowned: [] }), 0.033);
  assert.equal(empty.records.texts.length, 0);
});

test("пауза: пометка «Пауза» / «Paused»", function () {
  const { Render } = loadPair();
  const ru = makeTrackedCanvas(1280, 720);
  Render.create(ru.canvas).draw(makeFrame({ paused: true }), 0.033);
  assert.ok(ru.records.texts.includes("Пауза"));
  const en = makeTrackedCanvas(1280, 720);
  Render.create(en.canvas).draw(makeFrame({ paused: true, lang: "en" }), 0.033);
  assert.ok(en.records.texts.includes("Paused"));
  const playing = makeTrackedCanvas(1280, 720);
  Render.create(playing.canvas).draw(makeFrame({ paused: false }), 0.033);
  assert.ok(!playing.records.texts.includes("Пауза"));
});

test("все подписи рисуются с тёмной обводкой", function () {
  const { tracked, renderer } = makeRenderer();
  tracked.reset();
  renderer.draw(
    makeFrame({
      ships: [makeShip()],
      leaderboard: makeLeaderboard(5),
      queue: 2,
      drowned: [{ name: "Гарри" }],
      paused: true,
      labels: [{ text: "-1", color: "#ff4d5e", x: 0.4, y: 0.8, born: 0, until: 900, size: 1 }],
    }),
    0.033,
  );
  assert.ok(tracked.calls.fillText > 0);
  assert.ok(tracked.calls.strokeText > 0);
  assert.ok(tracked.calls.strokeText >= tracked.calls.fillText, "у каждой подписи есть strokeText");
  for (const stroke of tracked.records.strokeTextStyles) {
    assert.equal(stroke.color, "rgba(3,14,26,0.92)", "обводка тёмная");
    assert.ok(stroke.lineWidth >= 1);
  }
});

// ------------------------------------------------------------------
// Пустой/мусорный кадр, сохранность снимка
// ------------------------------------------------------------------
test("пустой кадр без кораблей: только очистка", function () {
  const { tracked, renderer } = makeRenderer();
  tracked.reset();
  renderer.draw(makeFrame(), 0.033);
  assert.equal(tracked.records.clearRects.length, 1);
  assert.equal(tracked.records.texts.length, 0);
});

test("кадры без новых полей и мусор в снимке не ломают рисование", function () {
  const { tracked, renderer, Layout } = makeRenderer();
  const frames = makeShowcaseFrames(Layout);
  for (const item of frames) {
    assert.doesNotThrow(function () {
      renderer.draw(item.frame, 0.033);
    }, "кадр: " + item.title);
  }
  tracked.reset();
  assert.doesNotThrow(function () {
    renderer.draw(null, 0.033);
    renderer.draw(undefined, 0.033);
    renderer.draw({}, 0.033);
  });
});

test("draw не меняет снимок кадра с новыми полями", function () {
  const { tracked, renderer, Layout } = makeRenderer();
  tracked.reset();
  const frame = makeFrame({
    now: 5400,
    ships: [
      shipInRow(Layout, 0, 2, { name: "Анна", shake: 1, hp: 2 }),
      shipInRow(Layout, 2, 3, { name: "Вера", color: "#6699ff" }),
    ],
    shots: [{ id: 1, fromX: 0.2, fromY: 0.8, toX: 0.7, toY: 0.82, x: 0.5, y: 0.6, progress: 0.4, shooter: "a" }],
    particles: [{ x: 0.3, y: 0.8, life: 0.5, maxLife: 1, color: "#cfd6de", kind: "smoke", size: 4 }],
    labels: [{ text: "-1", color: "#ff4d5e", x: 0.4, y: 0.8, born: 5000, until: 5900, size: 1 }],
    marks: [{ kind: "aim", x: 0.7, y: 0.82, tx: 0.2, ty: 0.8, until: 6100, born: 5400 }],
    queue: 2,
    drowned: [{ user: "d", name: "Гарри" }],
    leaderboard: makeLeaderboard(5),
  });
  const before = JSON.stringify(frame);
  renderer.draw(frame, 0.033);
  renderer.draw(frame, 0.016);
  assert.equal(JSON.stringify(frame), before, "снимок должен остаться прежним");
});

test("рисование работает без js/layout.js (запасная геометрия)", function () {
  const Render = loadRenderOnly();
  const tracked = makeTrackedCanvas(1280, 720);
  const renderer = Render.create(tracked.canvas);
  const frame = makeFrame({
    now: 5400,
    ships: [makeShip({ name: "Без Layout", row: 2, scale: 0.7, x: 0.5, y: 0.9, shake: 0.5 })],
    labels: [{ text: "щит!", color: "#9fe8ff", x: 0.5, y: 0.7, born: 5000, until: 6000, size: 1 }],
    marks: [{ kind: "shot", x: 0.2, y: 0.8, tx: 0.8, ty: 0.8, until: 6000, born: 5000 }],
    particles: [{ x: 0.3, y: 0.8, life: 1, maxLife: 2, color: "#ffe9a8", kind: "muzzle", size: 3 }],
  });
  assert.doesNotThrow(function () {
    renderer.draw(frame, 0.033);
  });
  assert.ok(tracked.records.texts.includes("Без Layout"), "имя нарисовано без Layout");
  assert.ok(tracked.records.texts.includes("щит!"), "метка нарисована без Layout");
  assert.ok(pathFills(tracked.records, "#ff5d7e").length > 0, "сердечки нарисованы без Layout");
  assert.ok(pathStrokes(tracked.records, "#ffe6a3").length > 0, "метки нарисованы без Layout");
});

// ------------------------------------------------------------------
// Размеры, devicePixelRatio, ctx.canvas
// ------------------------------------------------------------------
test("resize(): devicePixelRatio увеличивает задний буфер, а не координаты", function () {
  const pair = loadPair();
  const tracked = makeTrackedCanvas(800, 450);
  const renderer = pair.Render.create(tracked.canvas, {
    devicePixelRatio: 2,
    width: 800,
    height: 450,
  });
  assert.equal(renderer.width, 800);
  assert.equal(renderer.devicePixelRatio, 2);
  assert.equal(tracked.canvas.width, 1600);
  assert.equal(tracked.canvas.height, 900);
  assert.equal(tracked.canvas.style.width, "800px");
  assert.deepEqual(
    tracked.records.transforms[tracked.records.transforms.length - 1],
    [2, 0, 0, 2, 0, 0],
  );

  tracked.reset();
  renderer.draw(makeFrame(), 0.033);
  assert.deepEqual(tracked.records.clearRects[0], [0, 0, 800, 450]);

  globalThis.devicePixelRatio = 3;
  try {
    const scaled = makeTrackedCanvas(400, 300);
    const scaledRenderer = pair.Render.create(scaled.canvas);
    assert.equal(scaledRenderer.devicePixelRatio, 3);
    assert.equal(scaled.canvas.width, 1200);
  } finally {
    delete globalThis.devicePixelRatio;
  }
});

test("холсты любого размера и без clientWidth рисуются", function () {
  const { Render } = loadPair();
  for (const size of [[1, 1], [320, 180], [640, 360], [4000, 3000]]) {
    const fake = makeFakeCanvas(size[0], size[1]);
    const renderer = Render.create(fake.canvas);
    assert.equal(renderer.width, size[0]);
    assert.doesNotThrow(function () {
      renderer.draw(
        makeFrame({ ships: [makeShip()], leaderboard: makeLeaderboard(3) }),
        0.033,
      );
    }, "холст " + size[0] + "x" + size[1]);
  }

  const fake = makeFakeCanvas(800, 600);
  fake.canvas.clientWidth = 640;
  fake.canvas.clientHeight = 360;
  const renderer = Render.create(fake.canvas);
  assert.equal(renderer.width, 640);
  assert.equal(renderer.height, 360);
  renderer.draw(makeFrame(), 0.033);
  assert.equal(fake.calls.clearRect, 1);
});

test("draw не падает без ctx.canvas", function () {
  const { Render } = loadPair();
  const fake = makeFakeCanvas(640, 360);
  fake.ctx.canvas = null;
  delete fake.ctx.canvas;
  const renderer = Render.create(fake.canvas);
  assert.doesNotThrow(function () {
    renderer.draw(
      makeFrame({
        ships: [makeShip()],
        labels: [{ text: "-1", color: "#ff4d5e", x: 0.4, y: 0.8, born: 0, until: 900, size: 1 }],
        marks: [{ kind: "aim", x: 0.7, y: 0.82, tx: 0.2, ty: 0.8, born: 0, until: 900 }],
      }),
      0.033,
    );
    renderer.clear();
  });
  assert.ok(fake.calls.clearRect >= 2);
});

test("clear() стирает холст и ничего не заливает", function () {
  const { tracked, renderer } = makeRenderer(1024, 512);
  renderer.draw(makeFrame({ ships: [makeShip()] }), 0.033);
  tracked.reset();
  renderer.clear();
  assert.equal(tracked.records.clearRects.length, 1);
  assert.deepEqual(tracked.records.clearRects[0], [0, 0, 1024, 512]);
  assert.equal(tracked.records.fillRects.length, 0);
  renderer.clear();
  assert.equal(tracked.records.clearRects.length, 2);
});

test("тряска смещает корпус корабля, а не только подпись", function () {
  const { tracked, renderer, Layout } = makeRenderer(1280, 720);
  const unit = Layout.unitPx(0, 1, 1280, 720);
  const y = Layout.rowY(0, 0.3);
  const frameAt = function (now) {
    return makeFrame({
      now: now,
      ships: [makeShip({ name: "Щит", x: 0.5, y: y, row: 0, scale: 1, shake: 1, shield: true })],
    });
  };
  tracked.reset();
  renderer.draw(frameAt(0), 0.033);
  const first = mergeBounds(pathStrokes(tracked.records, "#9fe1ff"));
  tracked.reset();
  renderer.draw(frameAt(1000 / 36), 0.033);
  const second = mergeBounds(pathStrokes(tracked.records, "#9fe1ff"));
  assert.ok(first && second, "щит (корпус) нарисован");
  assert.ok(
    Math.abs((second.cx - first.cx) - unit * 0.12) < 0.001,
    "корпус смещается по X: " + (second.cx - first.cx),
  );
});

test("размер метки из снимка увеличивает кегль", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  tracked.reset();
  renderer.draw(
    makeFrame({
      now: 0,
      labels: [
        { text: "мал", color: "#ff4d5e", x: 0.3, y: 0.8, born: 0, until: 900, size: 1 },
        { text: "круп", color: "#ff4d5e", x: 0.6, y: 0.8, born: 0, until: 900, size: 2 },
      ],
    }),
    0.033,
  );
  const small = fontSize(textStylesByText(tracked.records, "мал")[0].font);
  const large = fontSize(textStylesByText(tracked.records, "круп")[0].font);
  assert.ok(large > small, "метка size=2 крупнее: " + [small, large]);
});

test("старый кадр части 1 без row/labels/marks рисуется и прозрачен", function () {
  const { tracked, renderer } = makeRenderer(1280, 720);
  const frame = {
    now: 1000,
    paused: false,
    theme: "sea",
    seaHeight: 0.3,
    shipScale: 1,
    lang: "ru",
    leaderboardOn: true,
    round: { state: "playing", banner: null },
    ships: [
      {
        id: 1,
        user: "old",
        name: "Старый",
        color: "#88ccff",
        x: 0.4,
        y: 0.8,
        dir: 1,
        hp: 3,
        maxHp: 3,
        shield: false,
        state: "sailing",
        sinkProgress: 0,
        crown: false,
        phase: 0.2,
        lastActiveAt: 0,
      },
    ],
    shots: [],
    particles: [],
    queue: 0,
    drowned: [],
    leaderboard: [],
  };
  tracked.reset();
  assert.doesNotThrow(function () {
    renderer.draw(frame, 0.033);
  });
  assert.equal(tracked.records.clearRects.length, 1);
  assert.equal(tracked.records.texts.length, 1);
  assert.equal(tracked.records.texts[0], "Старый");
  for (const rect of tracked.records.fillRects) {
    const full = rect.x <= 0.5 && rect.y <= 0.5 && rect.w >= 1279 && rect.h >= 719;
    assert.ok(!full, "старый кадр тоже не должен заливаться целиком");
  }
});

// ------------------------------------------------------------------
// Файлы проекта
// ------------------------------------------------------------------
test("render.js и тест лежат в своих файлах проекта", function () {
  assert.ok(fs.existsSync(path.join(__dirname, "..", RENDER_FILE)));
  const source = readProject(RENDER_FILE);
  assert.ok(source.includes("SB.Render"));
  assert.ok(source.includes("cannonballRadius"));
  assert.ok(source.includes("CANNONBALL_MIN"));
  assert.ok(source.includes("CANNONBALL_MAX"));
});
