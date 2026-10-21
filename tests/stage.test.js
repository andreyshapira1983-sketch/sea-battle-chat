"use strict";
/* Тесты общей сцены OBS (SB.Stage): переключатель режимов, postMessage
 * видимости, DOM-инициализация на поддельных iframe и статические правила
 * stage.html. Ни сети, ни настоящих секунд: часы, таймеры и окна — свои. */

const nodeTest = require("node:test");
const test = nodeTest;
const assert = require("node:assert/strict");
const { beforeEach, afterEach } = nodeTest;
const { loadGlobal, readProject } = require("./helpers");

// Без document: stage.js не должен сам инициализироваться в тестах.
delete globalThis.document;
const SB = loadGlobal(["js/config.js", "js/chat.js", "js/commands.js", "js/stage.js"]);
const Stage = SB.Stage;
const Config = SB.Config;

// Файлы тестов идут в одном процессе (--test-isolation=none), и smoke.test.js
// оставляет на globalThis свои фейковые document/location/raf. Перед каждым
// тестом убираем их: иначе Stage.init() без параметров найдёт «чужой» document
// и заведёт настоящий секундный таймер — прогон не завершится.
beforeEach(() => {
  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

// Все созданные сцены останавливаем: таймеры и чат не должны жить после теста.
const createdHandles = [];
afterEach(() => {
  while (createdHandles.length > 0) {
    const handle = createdHandles.pop();
    if (handle && typeof handle.stop === "function") {
      try {
        handle.stop();
      } catch (error) {
        // Остановка уже могла случиться в самом тесте.
      }
    }
  }
});

// init на реальной странице заводит настоящий клиент чата и пошёл бы в сеть.
// В тестах вместо него — заглушка; конкретные проверки подменяют её своей.
function FakeChatClient(options) {
  this.options = options;
  this.started = false;
  this.stopped = false;
}
FakeChatClient.prototype.start = function () {
  this.started = true;
  return this;
};
FakeChatClient.prototype.stop = function () {
  this.stopped = true;
  return this;
};
SB.Chat.Client = FakeChatClient;

/** Поддельные часы и таймеры: время идёт только по команде теста. */
class FakeTimers {
  constructor() {
    this.current = 0;
    this.tasks = [];
    this.nextId = 1;
  }

  now() {
    return this.current;
  }

  setTimeout(fn, ms) {
    const id = this.nextId;
    this.nextId += 1;
    const delay = Math.max(0, Math.floor(Number(ms) || 0));
    this.tasks.push({ id, at: this.current + delay, fn });
    return id;
  }

  clearTimeout(id) {
    this.tasks = this.tasks.filter((task) => task.id !== id);
  }

  get pending() {
    return this.tasks.length;
  }

  /** Продвинуть время и выполнить всё, что наступило, по порядку. */
  advance(ms) {
    const target = this.current + ms;
    let guard = 0;
    for (;;) {
      let next = null;
      for (const task of this.tasks) {
        if (task.at > target) continue;
        if (next === null || task.at < next.at || (task.at === next.at && task.id < next.id)) {
          next = task;
        }
      }
      if (!next) break;
      guard += 1;
      if (guard > 10000) throw new Error("слишком много таймеров — похоже на цикл");
      this.tasks = this.tasks.filter((task) => task !== next);
      this.current = Math.max(this.current, next.at);
      next.fn();
    }
    this.current = target;
  }
}

/** Поддельный iframe: src, классы, style, слушатели и contentWindow. */
class FakeElement {
  constructor(id) {
    this.id = id;
    this.src = "";
    this.style = {};
    this.listeners = Object.create(null);
    this.contentWindow = null;
    const classes = new Set();
    this._classes = classes;
    this.classList = {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    };
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  dispatch(type, event) {
    for (const handler of this.listeners[type] || []) handler(event);
  }

  hasClass(name) {
    return this._classes.has(name);
  }
}

/** Поддельное окно iframe боя: запоминает postMessage. */
class FakeTargetWindow {
  constructor() {
    this.messages = [];
    this.throwOnPost = false;
  }

  postMessage(data, target) {
    if (this.throwOnPost) throw new Error("нельзя");
    this.messages.push({ data, target });
  }

  last() {
    return this.messages[this.messages.length - 1];
  }
}

/** Собрать поддельную страницу сцены и запустить Stage.init. */
function makeStagePage(search, extra) {
  const timers = new FakeTimers();
  const svet = new FakeElement("svet");
  const battle = new FakeElement("battle");
  const target = new FakeTargetWindow();
  battle.contentWindow = target;
  const document = {
    getElementById(id) {
      if (id === "svet") return svet;
      if (id === "battle") return battle;
      return null;
    },
  };
  const window = { document: document, location: { search: search } };
  const intervals = [];
  const options = Object.assign(
    {
      window: window,
      document: document,
      search: search,
      setTimeoutFn: (fn, ms) => timers.setTimeout(fn, ms),
      clearTimeoutFn: (id) => timers.clearTimeout(id),
      setIntervalFn: (fn, ms) => {
        intervals.push({ fn, ms });
        return intervals.length;
      },
      clearIntervalFn: () => {},
      now: () => timers.now(),
    },
    extra || {},
  );
  const handle = Stage.init(options);
  if (handle) createdHandles.push(handle);
  return { handle, timers, svet, battle, target, document, window, intervals };
}

/** Сообщение чата в формате движка. */
function chatMessage(text, extra) {
  return Object.assign(
    {
      user: "vasya",
      display_name: "Вася",
      text: text,
      first_msg: false,
      is_mod: false,
      is_broadcaster: false,
      chat_msg_id: "",
      chat_color: "",
    },
    extra || {},
  );
}

// ---------------------------------------------------------------------
// Константы и режим по умолчанию.
// ---------------------------------------------------------------------

test("сцена: константы режимов, команд и алиасов", () => {
  assert.equal(Stage.FADE_MS, 1500);
  assert.equal(Stage.MIN_BATTLE_MS, 30000);
  assert.equal(Stage.DEMO_SWITCH_MS, 20000);
  assert.deepEqual(Stage.BATTLE_COMMANDS, [
    "fire",
    "right",
    "left",
    "shield",
    "repair",
    "join",
    "leave",
  ]);
  assert.deepEqual(Stage.STAGE_ALIASES, {
    "бой": "battle",
    battle: "battle",
    "светлячки": "svet",
    svet: "svet",
  });
});

test("сцена: по умолчанию видны «Светлячки», status() описывает режим", () => {
  const switcher = Stage.createSwitcher({ now: 1000 });
  assert.equal(switcher.mode, "svet");
  assert.deepEqual(switcher.status(), {
    mode: "svet",
    auto: true,
    fadeMs: 1500,
    lastBattleAt: 1000,
    enteredAt: 1000,
    battleIdleMinutes: 3,
    minBattleMs: 30000,
    visibleBattle: false,
    visibleSvet: true,
  });
  assert.deepEqual(switcher.onMessage(chatMessage("привет")), {
    changed: false,
    mode: "svet",
    reason: null,
  });
});

test("сцена: команда боя зрителя включает бой", () => {
  const switcher = Stage.createSwitcher({ now: 5000 });
  const result = switcher.onMessage(chatMessage("!огонь"));
  assert.deepEqual(result, { changed: true, mode: "battle", reason: "command" });
  assert.equal(switcher.mode, "battle");
  const status = switcher.status();
  assert.equal(status.visibleBattle, true);
  assert.equal(status.visibleSvet, false);
  assert.equal(status.lastBattleAt, 5000);
  assert.equal(status.enteredAt, 5000);
});

test("сцена: боевые команды латиницей и в разном регистре тоже включают бой", () => {
  for (const text of ["!огонь", "!Огонь", "!fire", "!играть", "!join", "!щит", "!left"]) {
    const switcher = Stage.createSwitcher({ now: 0 });
    const result = switcher.onMessage(chatMessage(text));
    assert.equal(result.mode, "battle", "команда не включила бой: " + text);
    assert.equal(result.reason, "command");
  }
});

test("сцена: простой battle_idle (от подставных часов) возвращает «Светлячков»", () => {
  const switcher = Stage.createSwitcher({ auto: true, battleIdleMinutes: 3, now: 0 });
  switcher.onMessage(chatMessage("!огонь"));
  assert.equal(switcher.mode, "battle");
  // 3 минуты ещё не прошли.
  assert.equal(switcher.tick(179999).changed, false);
  assert.equal(switcher.mode, "battle");
  // Ровно battle_idle — возврат, причина idle.
  assert.deepEqual(switcher.tick(180000), { changed: true, mode: "svet", reason: "idle" });
  assert.equal(switcher.mode, "svet");
});

test("сцена: таймер простоя считается от последней команды боя", () => {
  const switcher = Stage.createSwitcher({ auto: true, battleIdleMinutes: 1, now: 0 });
  switcher.onMessage(chatMessage("!огонь"));
  switcher.tick(100000);
  // Новая команда продлила бой: обновляем lastBattleAt через onMessage.
  switcher.onMessage(chatMessage("!вперёд"));
  assert.equal(switcher.status().lastBattleAt, 100000);
  // Прошло 100 с от входа, но только 20 с от команды — ещё бой.
  assert.equal(switcher.tick(120000).changed, false);
  assert.equal(switcher.mode, "battle");
  // 60 с от последней команды — возврат.
  assert.equal(switcher.tick(160000).changed, true);
  assert.equal(switcher.mode, "svet");
});

test("сцена: минимум 30 с боя — раньше не выходим, даже если простой короче", () => {
  const switcher = Stage.createSwitcher({
    auto: true,
    battleIdleMinutes: 0.2, // 12 с простоя
    minBattleMs: 30000,
    now: 0,
  });
  switcher.onMessage(chatMessage("!огонь"));
  assert.equal(switcher.mode, "battle");
  // Простой уже 12 с, но минимум боя 30 с не вышел.
  assert.equal(switcher.tick(15000).changed, false);
  assert.equal(switcher.mode, "battle");
  assert.deepEqual(switcher.tick(30000), { changed: true, mode: "svet", reason: "idle" });
});

test("сцена: команда боя при уже включённом бое только продлевает таймер", () => {
  const switcher = Stage.createSwitcher({ battleIdleMinutes: 1, now: 0 });
  switcher.onMessage(chatMessage("!огонь"));
  const again = switcher.onMessage(chatMessage("!огонь"));
  assert.deepEqual(again, { changed: false, mode: "battle", reason: "command" });
  assert.equal(switcher.mode, "battle");
});

// ---------------------------------------------------------------------
// Ручные команды !бой / !светлячки и права.
// ---------------------------------------------------------------------

test("сцена: !бой от модератора включает бой сразу", () => {
  const switcher = Stage.createSwitcher({ auto: false, now: 0 });
  const result = switcher.onMessage(chatMessage("!бой", { is_mod: true }));
  assert.deepEqual(result, { changed: true, mode: "battle", reason: "mod" });
  assert.equal(switcher.mode, "battle");
});

test("сцена: !светлячки от стримера возвращает «Светлячков», автозапуск жив", () => {
  const switcher = Stage.createSwitcher({ auto: true, now: 0 });
  switcher.onMessage(chatMessage("!огонь"));
  assert.equal(switcher.mode, "battle");
  const result = switcher.onMessage(chatMessage("!светлячки", { is_broadcaster: true }));
  assert.deepEqual(result, { changed: true, mode: "svet", reason: "mod" });
  assert.equal(switcher.mode, "svet");
  // auto не выключился: следующая боевая команда снова включает бой.
  assert.equal(switcher.onMessage(chatMessage("!огонь")).mode, "battle");
});

test("сцена: !бой и !светлячки зрителю не подчиняются", () => {
  const switcher = Stage.createSwitcher({ now: 0 });
  const battle = switcher.onMessage(chatMessage("!бой"));
  assert.deepEqual(battle, { changed: false, mode: "svet", reason: "no_rights" });
  assert.equal(switcher.mode, "svet");

  // Зритель не может выключить уже включённый бой.
  switcher.onMessage(chatMessage("!огонь"));
  const svet = switcher.onMessage(chatMessage("!светлячки"));
  assert.deepEqual(svet, { changed: false, mode: "battle", reason: "no_rights" });
  assert.equal(switcher.mode, "battle");
});

test("сцена: !БОЙ и !SVET в верхнем регистре понимаются", () => {
  const switcher = Stage.createSwitcher({ auto: false, now: 0 });
  assert.equal(switcher.onMessage(chatMessage("!БОЙ", { is_mod: true })).mode, "battle");
  assert.equal(switcher.onMessage(chatMessage("!SVET", { is_mod: true })).mode, "svet");
});

// ---------------------------------------------------------------------
// auto=0.
// ---------------------------------------------------------------------

test("сцена: auto=0 — команды зрителей не переключают, но продлевают таймер", () => {
  const switcher = Stage.createSwitcher({ auto: false, now: 0 });
  const result = switcher.onMessage(chatMessage("!огонь"));
  assert.deepEqual(result, { changed: false, mode: "svet", reason: "no_auto" });
  assert.equal(switcher.mode, "svet");
  assert.equal(switcher.status().lastBattleAt, 0);
  assert.equal(switcher.status().auto, false);
});

test("сцена: auto=0 — только !бой/!светлячки, обратно тоже вручную", () => {
  const switcher = Stage.createSwitcher({ auto: false, now: 0 });
  switcher.onMessage(chatMessage("!бой", { is_mod: true }));
  assert.equal(switcher.mode, "battle");
  // Зрительская команда в бою не выводит из него и не продлевает простой.
  switcher.onMessage(chatMessage("!огонь"));
  assert.equal(switcher.mode, "battle");
  // Простой не работает: auto выключен.
  assert.equal(switcher.tick(1000000).changed, false);
  assert.equal(switcher.mode, "battle");
  switcher.onMessage(chatMessage("!светлячки", { is_mod: true }));
  assert.equal(switcher.mode, "svet");
});

// ---------------------------------------------------------------------
// Демо-режим конструктора.
// ---------------------------------------------------------------------

test("сцена: demo переключает режим сам каждые 20 секунд", () => {
  const switcher = Stage.createSwitcher({ demo: true, now: 0 });
  assert.equal(switcher.mode, "svet");
  assert.equal(switcher.tick(19999).changed, false);
  assert.deepEqual(switcher.tick(20000), { changed: true, mode: "battle", reason: "demo" });
  assert.equal(switcher.mode, "battle");
  assert.equal(switcher.tick(39999).changed, false);
  assert.deepEqual(switcher.tick(40000), { changed: true, mode: "svet", reason: "demo" });
  assert.deepEqual(switcher.tick(60000), { changed: true, mode: "battle", reason: "demo" });
});

test("сцена: demo не зависит от auto и battle_idle", () => {
  const switcher = Stage.createSwitcher({
    demo: true,
    auto: false,
    battleIdleMinutes: 1,
    now: 0,
  });
  // Даже с автостопом выключенным демо само включает бой.
  assert.equal(switcher.tick(20000).mode, "battle");
  // И не возвращается по простою раньше своих 20 с.
  assert.equal(switcher.tick(25000).changed, false);
  assert.equal(switcher.mode, "battle");
});

// ---------------------------------------------------------------------
// postMessage видимости.
// ---------------------------------------------------------------------

test("postVisibility шлёт ровно {type, visible} в targetWindow", () => {
  const target = new FakeTargetWindow();
  assert.equal(Stage.postVisibility(target, true), true);
  assert.equal(target.messages.length, 1);
  assert.deepEqual(target.last(), {
    data: { type: "sea-battle-visibility", visible: true },
    target: "*",
  });
  assert.equal(Stage.postVisibility(target, false), true);
  assert.deepEqual(target.last().data, {
    type: "sea-battle-visibility",
    visible: false,
  });
  // Видимость всегда булева.
  Stage.postVisibility(target, 0);
  assert.equal(target.last().data.visible, false);
});

test("postVisibility не падает без окна и при ошибке postMessage", () => {
  assert.equal(Stage.postVisibility(null, true), false);
  assert.equal(Stage.postVisibility({}, true), false);
  const broken = new FakeTargetWindow();
  broken.throwOnPost = true;
  assert.equal(Stage.postVisibility(broken, true), false);
});

// ---------------------------------------------------------------------
// DOM: init на поддельных iframe.
// ---------------------------------------------------------------------

test("init: выставляет src слоям по настройкам из адреса", () => {
  const { handle, svet, battle } = makeStagePage(
    "?channel=vasya&theme=none&svet_theme=city&svet_backdrop=40"
  );
  assert.ok(handle, "init вернул null");
  const battleSettings = Config.sanitize({ channel: "vasya", theme: "none" });
  const svetUrl = Config.buildSvetUrl(
    { svetTheme: "city", svetBackdrop: 40 },
    battleSettings
  );
  assert.equal(svet.src, svetUrl);
  assert.equal(battle.src, Config.buildUrl("index.html", battleSettings));
  assert.match(battle.src, /^index\.html\?/);
  assert.match(battle.src, /channel=vasya/);
  assert.equal(handle.settings.battle.channel, "vasya");
});

test("init: старт — «Светлячки» видны, бой скрыт и получает visible:false", () => {
  const { svet, battle, target } = makeStagePage("?channel=vasya");
  assert.equal(svet.hasClass("is-hidden"), false);
  assert.equal(svet.style.opacity, "1");
  assert.equal(battle.hasClass("is-hidden"), true);
  assert.equal(battle.style.opacity, "0");
  assert.deepEqual(target.last().data, {
    type: "sea-battle-visibility",
    visible: false,
  });
});

test("init: боевая команда показывает бой через затухание и visible:true", () => {
  const { handle, timers, svet, battle, target } = makeStagePage("?channel=vasya");
  const before = target.messages.length;
  const result = handle.onMessage(chatMessage("!огонь"));
  assert.equal(result.changed, true);
  assert.equal(result.mode, "battle");
  // Бой проявился, «Светлячки» начали гаснуть.
  assert.equal(battle.hasClass("is-hidden"), false);
  assert.equal(battle.style.opacity, "1");
  assert.equal(svet.style.opacity, "0");
  assert.equal(svet.hasClass("is-hidden"), false, "сначала плавное затухание");
  assert.deepEqual(target.last().data, {
    type: "sea-battle-visibility",
    visible: true,
  });
  assert.ok(target.messages.length > before);
  // Через 1,5 с затухание закончено — слой уходит из видимости.
  timers.advance(1499);
  assert.equal(svet.hasClass("is-hidden"), false);
  timers.advance(1);
  assert.equal(svet.hasClass("is-hidden"), true);
});

test("init: !светлячки от модератора возвращает «Светлячков» и visible:false", () => {
  const { handle, timers, svet, battle, target } = makeStagePage("?channel=vasya");
  handle.onMessage(chatMessage("!огонь"));
  handle.onMessage(chatMessage("!светлячки", { is_mod: true }));
  assert.equal(handle.switcher.mode, "svet");
  assert.equal(svet.hasClass("is-hidden"), false);
  assert.equal(svet.style.opacity, "1");
  assert.equal(battle.style.opacity, "0");
  assert.deepEqual(target.last().data, {
    type: "sea-battle-visibility",
    visible: false,
  });
  timers.advance(1500);
  assert.equal(battle.hasClass("is-hidden"), true);
});

test("init: после load iframe боя видимость отправляется ещё раз", () => {
  const { battle, target } = makeStagePage("?channel=vasya");
  assert.equal(battle.listeners.load.length, 1);
  const before = target.messages.length;
  battle.dispatch("load");
  assert.equal(target.messages.length, before + 1);
  assert.equal(target.last().data.visible, false);
});

test("init: без document возвращает null и не падает", () => {
  assert.equal(Stage.init({ document: null, window: {} }), null);
  assert.equal(Stage.init(), null);
});

test("init: чат сцены создаётся при канале и останавливается stop()", () => {
  const original = SB.Chat.Client;
  let created = null;
  SB.Chat.Client = function FakeClient(options) {
    created = { options, started: false, stopped: false };
    this.start = () => {
      created.started = true;
    };
    this.stop = () => {
      created.stopped = true;
    };
  };
  try {
    const page = makeStagePage("?channel=vasya");
    assert.ok(created, "клиент чата не создан");
    assert.equal(created.options.channel, "vasya");
    assert.equal(created.started, true);
    assert.equal(page.handle.chat !== null, true);
    page.handle.onMessage(chatMessage("!огонь"));
    assert.equal(page.handle.switcher.mode, "battle");
    page.handle.stop();
    assert.equal(created.stopped, true);
  } finally {
    SB.Chat.Client = original;
  }
});

test("init: без канала чат не создаётся, сцена просто показывает «Светлячков»", () => {
  const original = SB.Chat.Client;
  let created = 0;
  SB.Chat.Client = function FakeClient() {
    created += 1;
  };
  try {
    const page = makeStagePage("");
    assert.equal(created, 0);
    assert.equal(page.handle.chat, null);
    assert.equal(page.handle.switcher.mode, "svet");
  } finally {
    SB.Chat.Client = original;
  }
});

test("init: demo-режим — в адресе боя demo=1, режимы сменяются через tick", () => {
  const { handle, target, battle } = makeStagePage("?demo=1");
  assert.match(battle.src, /demo=1/);
  assert.equal(handle.switcher.mode, "svet");
  handle.tick(19999);
  assert.equal(handle.switcher.mode, "svet");
  handle.tick(20000);
  assert.equal(handle.switcher.mode, "battle");
  assert.equal(battle.hasClass("is-hidden"), false);
  assert.deepEqual(target.last().data, {
    type: "sea-battle-visibility",
    visible: true,
  });
  handle.tick(40000);
  assert.equal(handle.switcher.mode, "svet");
  assert.equal(target.last().data.visible, false);
});

test("init: секундный интервал проверяет простой, stop его снимает", () => {
  const originalClear = [];
  const page = makeStagePage("?channel=vasya", {
    clearIntervalFn: (id) => originalClear.push(id),
  });
  assert.equal(page.intervals.length, 1);
  assert.equal(page.intervals[0].ms, 1000);
  // Часы сцены: команда боя, потом 3 минуты простоя через тик интервала.
  page.handle.onMessage(chatMessage("!огонь"));
  page.handle.tick(180000);
  assert.equal(page.handle.switcher.mode, "svet");
  page.handle.stop();
  assert.deepEqual(originalClear, [1]);
});

// ---------------------------------------------------------------------
// Ссылки stage ⇄ настройки.
// ---------------------------------------------------------------------

test("сцена: ссылка stage собирается из настроек боя и сцены", () => {
  const search =
    "?channel=vasya&auto=0&battle_idle=5&svet_theme=city&svet_backdrop=40";
  const parsed = Config.parseStageSearch(search);
  assert.equal(parsed.battle.channel, "vasya");
  assert.equal(parsed.stage.auto, false);
  assert.equal(parsed.stage.battleIdle, 5);
  assert.equal(parsed.stage.svetTheme, "city");
  assert.equal(parsed.stage.svetBackdrop, 40);
  const url = Config.buildStageUrl("stage.html", parsed.battle, parsed.stage);
  assert.match(url, /^stage\.html\?/);
  assert.match(url, /channel=vasya/);
  assert.match(url, /auto=0/);
  assert.match(url, /battle_idle=5/);
  assert.match(url, /svet_theme=city/);
  assert.match(url, /svet_backdrop=40/);
  // Круг «настройки → ссылка → настройки» не теряет значений.
  const again = Config.parseStageSearch(url.slice(url.indexOf("?")));
  assert.equal(again.stage.auto, false);
  assert.equal(again.stage.battleIdle, 5);
  assert.equal(again.stage.svetTheme, "city");
  assert.equal(again.stage.svetBackdrop, 40);
});

test("сцена: своя ссылка «Светлячков» передаётся как есть", () => {
  const own = "https://example.com/svet/index.html?theme=space&x=1";
  const parsed = Config.parseStageSearch("?svet_url=" + encodeURIComponent(own));
  assert.equal(parsed.stage.svetUrl, own);
  const svetUrl = Config.buildSvetUrl(parsed.stage, parsed.battle);
  assert.equal(svetUrl, own, "чужая ссылка не должна переписываться");
  const stageUrl = Config.buildStageUrl("stage.html", parsed.battle, parsed.stage);
  assert.equal(stageUrl.indexOf("svet_url=") >= 0, true);
  const again = Config.parseStageSearch(stageUrl.slice(stageUrl.indexOf("?")));
  assert.equal(again.stage.svetUrl, own);
});

test("сцена: ссылка «Светлячков» по умолчанию получает канал и вид", () => {
  const battle = Config.sanitize({ channel: "vasya" });
  assert.equal(
    Config.buildSvetUrl({}, battle),
    Config.SVET_DEFAULT_URL + "?channel=vasya"
  );
  assert.equal(
    Config.buildSvetUrl({ svetTheme: "space", svetBackdrop: 25 }, battle),
    Config.SVET_DEFAULT_URL + "?channel=vasya&theme=space&backdrop=25"
  );
  assert.equal(Config.buildSvetUrl({}, {}), Config.SVET_DEFAULT_URL);
});

test("сцена: умолчания сцены не пишутся в ссылку", () => {
  const battle = Config.sanitize({});
  const search = Config.buildStageSearch(battle, {});
  assert.equal(search, "");
  assert.equal(Config.buildStageUrl("stage.html", battle, {}), "stage.html");
});

// ---------------------------------------------------------------------
// Статические правила stage.html.
// ---------------------------------------------------------------------

test("stage.html: два прозрачных iframe на весь кадр", () => {
  const html = readProject("stage.html");
  assert.match(html, /<iframe[^>]+id=["']svet["']/);
  assert.match(html, /<iframe[^>]+id=["']battle["']/);
  assert.match(html, /src=["']https:\/\/andreyshapira1983-sketch\.github\.io\/svetlyachki\/index\.html["']/);
  assert.match(html, /id=["']battle["'][^>]*src=["']index\.html["']/);
  assert.match(html, /position:\s*fixed/);
  assert.match(html, /inset:\s*0/);
  assert.match(html, /background:\s*transparent/);
  assert.match(html, /transition:\s*opacity 1\.5s ease/);
  assert.match(html, /\.is-hidden\s*\{[^}]*opacity:\s*0/);
  assert.match(html, /\.is-hidden\s*\{[^}]*visibility:\s*hidden/);
});

test("stage.html: только локальные скрипты, нет color-scheme и чужих адресов", () => {
  const html = readProject("stage.html");
  // Скрипты — ровно те четыре локальных файла, и только они.
  const sources = Array.from(html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)).map(
    (match) => match[1]
  );
  assert.deepEqual(sources, [
    "js/config.js",
    "js/chat.js",
    "js/commands.js",
    "js/stage.js",
  ]);
  // Нет модулей, color-scheme и сборщиков.
  assert.equal(/type=["']module["']/.test(html), false);
  assert.equal(/color-scheme/i.test(html), false);
  assert.equal(/\bimport\b|\bexport\b/.test(html), false);
  assert.equal(/cdn\.|unpkg|jsdelivr|googleapis/.test(html), false);
  // Внешний адрес в разметке ровно один — «Светлячки».
  const urls = html.match(/https?:\/\/[^\s"')]+/g) || [];
  assert.deepEqual(urls, [
    "https://andreyshapira1983-sketch.github.io/svetlyachki/index.html",
  ]);
});
