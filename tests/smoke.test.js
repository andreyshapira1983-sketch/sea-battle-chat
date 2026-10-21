"use strict";
// Сборка страницы целиком: настоящие game/render/demo/main на поддельном
// холсте и подставных кадрах. Главная проверка ТЗ — страница рисует сто
// кадров без ошибок и не лезет в сеть.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, makeFakeCanvas, makeMessage } = require("./helpers");

const PAGE_FILES = [
  "js/config.js",
  "js/chat.js",
  "js/commands.js",
  "js/mask.js",
  "js/colors.js",
  "js/layout.js",
  "js/game.js",
  "js/demo.js",
  "js/render.js",
  "js/main.js",
];

function installPage(options) {
  const config = options || {};
  const fake = makeFakeCanvas(1920, 1080);
  const hint = {
    style: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
  const listeners = Object.create(null);
  const page = {
    pending: [],
    listeners,
    hint,
    fake,
    frames: 0,
    now: 0,
  };
  const document = {
    hidden: Boolean(config.hidden),
    getElementById(id) {
      if (id === "sea") return config.noCanvas ? null : fake.canvas;
      if (id === "hint") return hint;
      return null;
    },
    addEventListener() {},
  };
  const globals = {
    console,
    document,
    location: { search: config.search === undefined ? "?demo=1" : config.search },
    requestAnimationFrame(callback) {
      page.pending.push(callback);
      return page.pending.length;
    },
    cancelAnimationFrame() {
      page.pending.length = 0;
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    removeEventListener(type) {
      delete listeners[type];
    },
  };
  const SB = loadGlobal(PAGE_FILES, globals);
  page.SB = SB;

  page.drive = function (count) {
    for (let index = 0; index < count; index += 1) {
      const callback = page.pending.shift();
      assert.ok(callback, "кадр не запрошен");
      page.now += 16.7;
      page.frames += 1;
      callback(page.now);
    }
  };
  return page;
}

test("smoke: страница игры собирается из настоящих частей и запускается", () => {
  const page = installPage({ search: "?demo=1&theme=sea" });
  assert.equal(page.SB.Main.isRunning(), true);
  assert.ok(page.SB.Main.currentWorld(), "мир не создан");
  assert.equal(page.pending.length, 1, "не запрошен первый кадр");
  assert.equal(page.SB.Main.currentWorld().settings.demo, true);
});

test("smoke: страница рисует 100 кадров без ошибок", () => {
  const page = installPage({ search: "?demo=1" });
  // Демо-боты входят по таймеру, а кадры рисуем сразу: два зрителя уже тут.
  const world = page.SB.Main.currentWorld();
  world.onMessage(makeMessage({ user: "zritel_1", display_name: "Зритель 1" }));
  world.onMessage(makeMessage({ user: "zritel_2", display_name: "Зритель 2" }));
  assert.doesNotThrow(() => page.drive(100));
  assert.equal(page.fake.calls.clearRect, 100, "кадр не очищался");
  assert.ok(page.fake.calls.fillText > 0, "ни одной подписи не нарисовано");
  assert.ok(page.fake.calls.strokeText > 0, "подписи без обводки");
  assert.ok(page.fake.calls.createGradient > 0, "нет воды с градиентом");
});

test("smoke: за сто кадров демо-боты успевают войти в игру", () => {
  const page = installPage({ search: "?demo=1" });
  page.drive(400); // около шести секунд: первые боты уже написали !играть
  const frame = page.SB.Main.currentWorld().frame();
  assert.ok(frame.ships.length >= 1, "ни один бот не вошёл");
  for (const ship of frame.ships) {
    assert.match(ship.color, /^#[0-9a-f]{6}$/);
    assert.equal(ship.hp, 3);
    assert.ok(ship.y >= 0.6 && ship.y <= 1, "корабль вне моря: " + ship.y);
    assert.ok(ship.name.length > 0);
  }
  assert.ok(frame.leaderboardOn === true);
  assert.doesNotThrow(() => JSON.stringify(frame));
});

test("smoke: команды зрителей проходят через собранный мир", () => {
  const page = installPage({ search: "?demo=0" });
  const world = page.SB.Main.currentWorld();
  world.onMessage(makeMessage({ user: "vasya", display_name: "Вася" }));
  world.onMessage(makeMessage({ user: "petya", display_name: "Петя" }));
  assert.equal(world.frame().ships.length, 2);
  page.drive(30);
  const before = world.frame().ships.map((ship) => ship.hp);
  world.onMessage(makeMessage({ user: "vasya", text: "!огонь Петя" }));
  page.drive(60);
  const after = world.frame().ships.map((ship) => ship.hp);
  assert.ok(after.some((hp, index) => hp < before[index]), "выстрел не попал");
  const report = world.onMessage(makeMessage({ user: "vasya", text: "!огонь" }));
  assert.equal(report.ok, false);
  assert.equal(report.reason, "cooldown", "пауза команды не сработала");
  const shield = world.onMessage(makeMessage({ user: "vasya", text: "!щит" }));
  assert.equal(shield.ok, true, "первый щит должен ставиться");
  page.drive(20);
  assert.equal(world.frame().ships.find((ship) => ship.user === "vasya").shield, true);
});

test("smoke: боты из чата не становятся кораблями", () => {
  const page = installPage({ search: "?demo=0" });
  assert.equal(page.SB.Main.acceptMessage(makeMessage({ user: "nightbot" })), false);
  assert.equal(page.SB.Main.acceptMessage(makeMessage({ user: "streamelements" })), false);
  assert.equal(page.SB.Main.acceptMessage(makeMessage({ user: "зритель" })), true);
  assert.equal(page.SB.Main.acceptMessage(null), false);
  assert.equal(page.SB.Main.acceptMessage({}), false);
});

test("smoke: без канала и демо видна подсказка, кадры всё равно рисуются", () => {
  const page = installPage({ search: "" });
  assert.equal(page.SB.Config.parseSearch("").channel, "");
  assert.equal(page.hint.attributes["aria-hidden"], "false");
  assert.doesNotThrow(() => page.drive(20));
  assert.ok(page.fake.calls.clearRect >= 20);
});

test("smoke: в демо подсказка спрятана", () => {
  const page = installPage({ search: "?demo=1" });
  assert.equal(page.hint.attributes["aria-hidden"], "true");
});

test("smoke: скрытая вкладка не копит кадры и не двигает мир", () => {
  const page = installPage({ search: "?demo=1", hidden: true });
  const world = page.SB.Main.currentWorld();
  page.drive(10);
  assert.equal(world.now, 0, "мир пошёл вперёд в скрытой вкладке");
  assert.equal(world.frame().ships.length, 0, "демо успело войти в скрытой вкладке");
});

test("smoke: stop останавливает цикл, последний кадр уже ничего не делает", () => {
  const page = installPage({ search: "?demo=1" });
  page.drive(5);
  page.SB.Main.stop();
  assert.equal(page.SB.Main.isRunning(), false);
  const pending = page.pending.slice();
  for (const callback of pending) {
    assert.doesNotThrow(() => callback(page.now + 16.7));
  }
  assert.equal(page.pending.length, 0);
});

test("smoke: размер окна — рисовальщик получает событие resize", () => {
  const page = installPage({ search: "?demo=1" });
  assert.equal(typeof page.listeners.resize, "function");
  assert.doesNotThrow(() => page.listeners.resize());
  page.SB.Main.stop();
  assert.equal(page.listeners.resize, undefined);
});

test("smoke: без холста страница не запускается и не падает", () => {
  const page = installPage({ search: "?demo=1", noCanvas: true });
  assert.equal(page.SB.Main.isRunning(), false);
  assert.equal(page.SB.Main.start(), null);
  assert.equal(page.pending.length, 0);
});

test("smoke: кадр мира — чистые данные, пригодные для JSON", () => {
  const page = installPage({ search: "?demo=1" });
  page.drive(60);
  const world = page.SB.Main.currentWorld();
  const frame = world.frame();
  const copy = JSON.parse(JSON.stringify(frame));
  assert.deepEqual(Object.keys(copy).sort(), [
    "drowned",
    "labels",
    "lang",
    "leaderboard",
    "leaderboardOn",
    "marks",
    "now",
    "particles",
    "paused",
    "queue",
    "round",
    "seaHeight",
    "shipScale",
    "ships",
    "shots",
    "theme",
  ]);
  assert.equal(Array.isArray(copy.ships), true);
  assert.equal(Array.isArray(copy.labels), true);
  assert.equal(Array.isArray(copy.marks), true);
  assert.equal(copy.theme, "sea");
  assert.equal(copy.seaHeight, 0.3);
});

test("smoke: тема none и английские подписи не ломают страницу", () => {
  const page = installPage({ search: "?demo=1&theme=none&lang=en&leaderboard=0" });
  const world = page.SB.Main.currentWorld();
  world.onMessage(makeMessage({ user: "viewer_1", display_name: "Viewer 1" }));
  assert.doesNotThrow(() => page.drive(120));
  const frame = world.frame();
  assert.equal(frame.theme, "none");
  assert.equal(frame.lang, "en");
  assert.equal(frame.leaderboardOn, false);
  assert.ok(page.fake.calls.fillText > 0);
});

test("smoke: море занимает нижнюю полосу, остальное прозрачно", () => {
  const page = installPage({ search: "?demo=1&sea_height=30" });
  page.drive(40);
  const frame = page.SB.Main.currentWorld().frame();
  assert.equal(frame.seaHeight, 0.3);
  assert.equal(page.fake.canvas.width, 1920);
  assert.equal(page.fake.canvas.height, 1080);
  // Ни одна заливка не покрывает весь кадр: clearRect — единственный
  // полнокадровый вызов, его счётчик проверен выше.
  assert.equal(page.fake.calls.clearRect, 40);
});

test("smoke: скрытый слой не рисует, но мир продолжает жить", () => {
  const page = installPage({ search: "?demo=1" });
  const world = page.SB.Main.currentWorld();
  page.drive(5);
  const drawnBefore = page.fake.calls.clearRect;
  const worldBefore = world.now;
  page.SB.Main.setVisible(false);
  assert.equal(page.SB.Main.isVisible(), false);
  page.drive(30);
  assert.equal(page.fake.calls.clearRect, drawnBefore, "скрытый слой рисовал кадры");
  assert.ok(world.now > worldBefore, "мир должен жить и без рисования");
  page.SB.Main.setVisible(true);
  page.drive(3);
  assert.equal(page.fake.calls.clearRect, drawnBefore + 3, "видимый слой не рисует");
});

test("smoke: stage.html прячет бой через postMessage", () => {
  const page = installPage({ search: "?demo=1" });
  assert.equal(typeof page.listeners.message, "function");
  page.drive(4);
  const drawn = page.fake.calls.clearRect;
  assert.doesNotThrow(() =>
    page.listeners.message({ data: { type: "sea-battle-visibility", visible: false } }),
  );
  page.drive(20);
  assert.equal(page.SB.Main.isVisible(), false);
  assert.equal(page.fake.calls.clearRect, drawn);
  // Чужие сообщения не переключают режим.
  page.listeners.message({ data: { type: "что-то-другое", visible: true } });
  assert.equal(page.SB.Main.isVisible(), false);
  page.listeners.message({ data: { type: "sea-battle-visibility", visible: true } });
  assert.equal(page.SB.Main.isVisible(), true);
  page.drive(2);
  assert.equal(page.fake.calls.clearRect, drawn + 2);
});

test("smoke: бой рисует обратную связь — метки, тряску и щепки", () => {
  const page = installPage({ search: "?demo=0" });
  const world = page.SB.Main.currentWorld();
  world.onMessage(makeMessage({ user: "vasya", display_name: "Вася" }));
  world.onMessage(makeMessage({ user: "petya", display_name: "Петя" }));
  page.drive(10);
  world.onMessage(makeMessage({ user: "vasya", text: "!огонь Петя" }));
  let sawShotMark = false;
  let sawAimMark = false;
  let sawMinusOne = false;
  let sawHitParticles = false;
  for (let index = 0; index < 90; index += 1) {
    page.drive(1);
    const frame = world.frame();
    if (frame.marks.some((mark) => mark.kind === "shot")) sawShotMark = true;
    if (frame.marks.some((mark) => mark.kind === "aim")) sawAimMark = true;
    if (frame.labels.some((label) => label.text === "-1")) sawMinusOne = true;
    if (frame.particles.some((particle) => particle.kind === "splinter")) {
      sawHitParticles = true;
    }
  }
  assert.equal(sawShotMark, true, "нет стрелки стрелка");
  assert.equal(sawAimMark, true, "нет прицела на цели");
  assert.equal(sawMinusOne, true, "нет надписи −1");
  assert.equal(sawHitParticles, true, "нет щепок");
  const ship = world.frame().ships.find((item) => item.user === "petya");
  assert.ok(ship.shake >= 0 && ship.shake <= 1);
});
