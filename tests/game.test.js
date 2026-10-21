"use strict";
// Тесты мира игры «Морского боя чата»: вход и очередь, команды зрителей,
// права модераторов, урон/щит/ремонт/потопление, раунды и победа, счёт
// побед и storage, уход неактивных, снимок frame().
//
// Время не ждём: шаг физики двигаем сами, часы — параметр step().
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, makeMessage, fakeStorage, plain, readProject } = require("./helpers");

// Порядок как на странице: настройки, команды, маска, цвета, раскладка, мир.
const SB = loadGlobal([
  "js/config.js",
  "js/commands.js",
  "js/mask.js",
  "js/colors.js",
  "js/layout.js",
  "js/game.js",
]);
const Layout = SB.Layout;
const Game = SB.Game;

/** Мир с полным набором настроек (SB.Config.sanitize) и поддельным storage. */
function makeWorld(settings, extra) {
  return Game.createWorld(
    Object.assign(
      { settings: settings || {}, seed: 20261021, storage: fakeStorage() },
      extra || {},
    ),
  );
}

/** Сообщение чата: ник логином, отображаемое имя с заглавной буквы. */
function chat(world, user, messageText, extra) {
  const name = user.charAt(0).toUpperCase() + user.slice(1);
  return world.onMessage(
    makeMessage(
      Object.assign(
        { user, display_name: name, text: messageText === undefined ? "привет" : messageText },
        extra || {},
      ),
    ),
  );
}

/** Продвинуть мир ровно на ms (кратно 20) — без настоящих часов. */
function advance(world, ms) {
  const steps = Math.round(Number(ms) / 20);
  for (let index = 0; index < steps; index += 1) world.step(20);
}

/** Выстрел с обнулённой паузы: тест про урон, а не про ожидание. */
function hit(world, shooter, target) {
  world._cooldowns = Object.create(null);
  const report = world.onMessage(
    makeMessage({
      user: shooter,
      display_name: shooter,
      text: target ? "!огонь " + target : "!огонь",
    }),
  );
  advance(world, 720);
  return report;
}

/** Снимок корабля по логину (или null). */
function shipFrame(world, user) {
  const found = world.frame().ships.filter((ship) => ship.user === user);
  return found.length ? found[0] : null;
}

// ------------------------------------------------------------------
// 1. Константы и генератор
// ------------------------------------------------------------------
test("константы SB.Game — ровно как в договоре", () => {
  assert.equal(Game.FIXED_STEP_MS, 20);
  assert.equal(Game.MAX_FRAME_MS, 100);
  assert.equal(Game.MAX_HP, 3);
  assert.equal(Game.MAX_PARTICLES, 300);
  assert.equal(Game.SINK_MS, 2000);
  assert.equal(Game.BANNER_MS, 6000);
  assert.equal(Game.SHOT_FLIGHT_MS, 700);
  assert.equal(Game.SHIELD_MS, 5000);
  assert.equal(Game.MARGIN, 0.05);
  assert.equal(Game.MIN_GAP, 0.09);
  assert.equal(Game.STORAGE_PREFIX, "sea-battle-wins:");
  assert.equal(Game.SHAKE_MS, 350);
  assert.equal(Game.HIT_LABEL_MS, 900);
  assert.equal(Game.SHIELD_LABEL_MS, 1000);
  assert.equal(Game.SHOT_MARK_MS, 1000);
  assert.equal(typeof Game.createRng, "function");
  assert.equal(typeof Game.createWorld, "function");
});

test("createRng: одинаковый seed — одинаковая последовательность", () => {
  const first = Game.createRng(12345);
  const second = Game.createRng(12345);
  const one = [first.random(), first.random(), first.random()];
  const two = [second.random(), second.random(), second.random()];
  assert.deepEqual(one, two);
  assert.ok(one.every((value) => value >= 0 && value < 1));
});

test("createRng: все методы работают в своих пределах", () => {
  const rng = Game.createRng(7);
  for (let index = 0; index < 50; index += 1) {
    const value = rng.uniform(-2, 5);
    assert.ok(value >= -2 && value <= 5);
    const whole = rng.randint(3, 6);
    assert.ok(whole >= 3 && whole <= 6 && Number.isInteger(whole));
    const pick = rng.choice(["a", "b", "c"]);
    assert.ok(["a", "b", "c"].includes(pick));
    const indexPick = rng.randrange(4);
    assert.ok(indexPick >= 0 && indexPick < 4);
  }
  assert.deepEqual(Game.createRng(1).randrange(0), 0);
  assert.equal(Game.createRng(1).choice([]), undefined);
});

// ------------------------------------------------------------------
// 2. Пустой мир и вход
// ------------------------------------------------------------------
test("пустой мир: frame() без кораблей не падает и отдаёт waiting", () => {
  const world = Game.createWorld({});
  world.step(10000);
  const frame = world.frame();
  assert.equal(frame.now, 100);
  assert.deepEqual(frame.ships, []);
  assert.deepEqual(frame.shots, []);
  assert.deepEqual(frame.particles, []);
  assert.deepEqual(frame.drowned, []);
  assert.equal(frame.queue, 0);
  assert.equal(frame.round.state, "waiting");
  assert.equal(frame.round.number, 1);
  assert.equal(frame.round.alive, 0);
  assert.equal(frame.round.winner, null);
  assert.equal(frame.round.banner, null);
});

test("пустое сообщение не создаёт корабль и не падает", () => {
  const world = makeWorld();
  const report = world.onMessage(makeMessage({ user: "" }));
  assert.deepEqual(report, {
    joined: false,
    queued: false,
    command: null,
    ok: false,
    reason: null,
  });
  assert.equal(world.frame().ships.length, 0);
});

test("join=chat: любое сообщение нового зрителя создаёт корабль", () => {
  const world = makeWorld();
  const report = chat(world, "vasya", "привет!");
  assert.deepEqual(report, {
    joined: true,
    queued: false,
    command: null,
    ok: true,
    reason: "ok",
  });
  const frame = world.frame();
  assert.equal(frame.ships.length, 1);
  assert.equal(frame.ships[0].user, "vasya");
  assert.equal(frame.ships[0].name, "Vasya");
  assert.equal(frame.ships[0].hp, 3);
  assert.equal(frame.ships[0].state, "sailing");
});

test("join=chat: повторное сообщение не плодит второй корабль", () => {
  const world = makeWorld();
  chat(world, "vasya");
  const report = chat(world, "vasya", "ещё раз");
  assert.equal(report.joined, false);
  assert.equal(report.ok, true);
  assert.equal(world.frame().ships.length, 1);
});

test("join=command: обычное сообщение не входит, !играть входит", () => {
  const world = makeWorld({ join: "command" });
  const quiet = chat(world, "petya", "просто болтаю");
  assert.equal(quiet.joined, false);
  assert.equal(world.frame().ships.length, 0);

  const before = world.onMessage(makeMessage({ user: "petya", text: "!огонь" }));
  assert.equal(before.reason, "not_in_game");
  assert.equal(before.command, "fire");

  const joined = world.onMessage(makeMessage({ user: "petya", text: "!играть" }));
  assert.equal(joined.joined, true);
  assert.equal(joined.command, "join");
  assert.equal(joined.ok, true);
  assert.equal(world.frame().ships.length, 1);
});

test("join=command: !уйти убирает корабль", () => {
  const world = makeWorld({ join: "command" });
  world.onMessage(makeMessage({ user: "petya", text: "!играть" }));
  const left = world.onMessage(makeMessage({ user: "petya", text: "!уйти" }));
  assert.equal(left.ok, true);
  assert.equal(shipFrame(world, "petya").state, "leaving");
  advance(world, 2000);
  assert.equal(shipFrame(world, "petya"), null);
});

test("!огоньвася — не команда, но сообщение в чат-режиме всё равно вводит", () => {
  const world = makeWorld();
  const report = chat(world, "kolya", "!огоньвася");
  assert.equal(report.command, null);
  assert.equal(report.joined, true);
  assert.equal(world.frame().shots.length, 0);
});

test("low-level join/leave — для main и тестов", () => {
  const world = makeWorld();
  const joined = world.join("nick", { displayName: "Ник", chatColor: "#ff0000" });
  assert.equal(joined.joined, true);
  const frame = world.frame();
  assert.equal(frame.ships.length, 1);
  assert.equal(frame.ships[0].color, SB.Colors.colorForChat("nick", "#ff0000"));
  assert.equal(world.join("", {}).ok, false);
  assert.equal(world.leave("никого"), false);
  assert.equal(world.leave("nick"), true);
});

// ------------------------------------------------------------------
// 3. Лимит кораблей и очередь
// ------------------------------------------------------------------
test("лимит maxShips: сверху очередь, «!уйти» убирает из очереди", () => {
  const world = makeWorld({ maxShips: 5 });
  for (let index = 1; index <= 5; index += 1) chat(world, "u" + index);
  assert.equal(world.frame().ships.length, 5);

  const sixth = chat(world, "u6");
  assert.equal(sixth.joined, false);
  assert.equal(sixth.queued, true);
  assert.equal(sixth.reason, "queued");
  assert.equal(world.frame().queue, 1);

  const leaveQueue = chat(world, "u6", "!уйти");
  assert.equal(leaveQueue.ok, true);
  assert.equal(world.frame().queue, 0);
  assert.equal(world.frame().ships.length, 5);
});

test("освободилось место — следующий из очереди входит сам (в step)", () => {
  const world = makeWorld({ maxShips: 5 });
  for (let index = 1; index <= 5; index += 1) chat(world, "u" + index);
  chat(world, "u6");
  assert.equal(world.frame().queue, 1);

  world.leave("u1");
  advance(world, 2500);
  const frame = world.frame();
  assert.equal(frame.queue, 0);
  assert.equal(frame.ships.length, 5);
  assert.ok(frame.ships.some((ship) => ship.user === "u6"), "u6 не вошёл из очереди");
  assert.ok(!frame.ships.some((ship) => ship.user === "u1"), "u1 не уплыл");
});

// ------------------------------------------------------------------
// 4. Выстрел, урон, щит, ремонт
// ------------------------------------------------------------------
test("!огонь: ядро летит 700 мс и снимает 1 hp", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  const report = world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  assert.equal(report.ok, true);
  assert.equal(report.reason, "ok");
  const flying = world.frame();
  assert.equal(flying.shots.length, 1);
  assert.ok(flying.shots[0].progress < 1);

  advance(world, 720);
  assert.equal(world.frame().shots.length, 0);
  assert.equal(shipFrame(world, "b").hp, 2);
});

test("пауза команды: повторный !огонь тихо игнорируется, потом снова можно", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  assert.equal(world.onMessage(makeMessage({ user: "a", text: "!огонь" })).ok, true);
  advance(world, 720);
  const second = world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  assert.equal(second.ok, false);
  assert.equal(second.reason, "cooldown");
  assert.equal(world.frame().shots.length, 0, "в паузе ядро не вылетает");

  advance(world, 5300);
  const third = world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  assert.equal(third.ok, true);
});

test("!огонь ник: цель по отображаемому имени, с @ и без регистра", () => {
  const world = makeWorld();
  chat(world, "a");
  world.onMessage(makeMessage({ user: "b", display_name: "Борис", text: "привет" }));
  chat(world, "c");
  // Ставим корабли так, чтобы «ближайшим» был точно не Борис.
  world.ships.find((ship) => ship.user === "a").x = 0.1;
  world.ships.find((ship) => ship.user === "b").x = 0.5;
  world.ships.find((ship) => ship.user === "c").x = 0.9;
  world.ships.forEach((ship) => {
    ship.y = 0.9;
  });

  world.onMessage(makeMessage({ user: "a", text: "!огонь @борИС" }));
  advance(world, 720);
  assert.equal(shipFrame(world, "b").hp, 2);
  assert.equal(shipFrame(world, "c").hp, 3);
});

test("!огонь ник: неизвестный ник — стреляем по ближайшему", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "c");
  world.ships.find((ship) => ship.user === "a").x = 0.1;
  world.ships.find((ship) => ship.user === "b").x = 0.4;
  world.ships.find((ship) => ship.user === "c").x = 0.9;
  world.ships.forEach((ship) => {
    ship.y = 0.9;
  });

  world.onMessage(makeMessage({ user: "a", text: "!огонь ктототам" }));
  advance(world, 720);
  assert.equal(shipFrame(world, "b").hp, 2);
  assert.equal(shipFrame(world, "c").hp, 3);
});

test("сам в себя не стреляет: ядро по пустой воде без урона", () => {
  const world = makeWorld();
  chat(world, "solo");
  world.onMessage(makeMessage({ user: "solo", text: "!огонь" }));
  assert.equal(world.frame().shots.length, 1);
  advance(world, 720);
  assert.equal(world.frame().shots.length, 0);
  assert.equal(shipFrame(world, "solo").hp, 3);
});

test("!щит: поглощает ровно одно попадание и снимается", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  const raised = world.onMessage(makeMessage({ user: "b", text: "!щит" }));
  assert.equal(raised.ok, true);
  assert.equal(shipFrame(world, "b").shield, true);

  hit(world, "a", "b");
  const afterFirst = shipFrame(world, "b");
  assert.equal(afterFirst.shield, false, "щит должен сняться");
  assert.equal(afterFirst.hp, 3, "щит поглотил попадание");

  hit(world, "a", "b");
  assert.equal(shipFrame(world, "b").hp, 2);
});

test("!щит: через 5 секунд гаснет сам", () => {
  const world = makeWorld();
  chat(world, "b");
  world.onMessage(makeMessage({ user: "b", text: "!щит" }));
  advance(world, 4980);
  assert.equal(shipFrame(world, "b").shield, true);
  advance(world, 20);
  assert.equal(shipFrame(world, "b").shield, false);
});

test("!ремонт: +1 hp не выше 3 и пауза 30 с", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  assert.equal(shipFrame(world, "b").hp, 2);

  const repaired = world.onMessage(makeMessage({ user: "b", text: "!ремонт" }));
  assert.equal(repaired.ok, true);
  assert.equal(shipFrame(world, "b").hp, 3);

  const early = world.onMessage(makeMessage({ user: "b", text: "!ремонт" }));
  assert.equal(early.reason, "cooldown");

  advance(world, 30000);
  const later = world.onMessage(makeMessage({ user: "b", text: "!ремонт" }));
  assert.equal(later.ok, true, "через 30 с ремонт снова доступен");
  assert.equal(shipFrame(world, "b").hp, 3, "выше трёх прочность не растёт");
});

test("!вперёд и !назад: сдвиг 0.08, направление и поля MARGIN", () => {
  const world = makeWorld();
  chat(world, "a");
  const rowBefore = world.ships[0].row;
  assert.ok(rowBefore >= 0 && rowBefore <= 2, "ряд корабля");
  world.ships[0].x = 0.5;
  const ship = () => shipFrame(world, "a");

  const forward = chat(world, "a", "!вперёд");
  assert.equal(forward.ok, true);
  assert.equal(ship().x, 0.58);
  assert.equal(ship().dir, 1);
  assert.equal(ship().row, rowBefore, "сдвиг не меняет ряд");

  // У «!вперёд» и «!назад» свои паузы — назад сразу можно.
  const back = chat(world, "a", "!назад");
  assert.equal(back.ok, true);
  assert.equal(ship().x, 0.5);
  assert.equal(ship().dir, -1);

  const blocked = chat(world, "a", "!назад");
  assert.equal(blocked.reason, "cooldown", "повторная команда ждёт своей паузы");

  for (let index = 0; index < 20; index += 1) {
    world._cooldowns = Object.create(null);
    chat(world, "a", "!назад");
  }
  assert.equal(ship().x, Game.MARGIN, "за левое поле не выходим");
});

// ------------------------------------------------------------------
// 5. Потопление и возвращение
// ------------------------------------------------------------------
test("потопление: sinking 2 с, затем drowned и ник «на дне»", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");

  const sinking = shipFrame(world, "b");
  assert.equal(sinking.state, "sinking");
  assert.equal(sinking.hp, 0);
  assert.ok(sinking.sinkProgress < 0.1);

  advance(world, 1000);
  const middle = shipFrame(world, "b");
  assert.ok(middle.sinkProgress > 0.4 && middle.sinkProgress < 0.65, middle.sinkProgress);

  advance(world, 1000);
  assert.equal(shipFrame(world, "b"), null, "потопленный уходит из ships");
  const frame = world.frame();
  assert.deepEqual(frame.drowned, [{ user: "b", name: "B" }]);
});

test("потопленного нельзя добить: промах без урона", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  advance(world, 1000);
  assert.equal(shipFrame(world, "b").state, "sinking");
  assert.equal(shipFrame(world, "b").hp, 0);
  hit(world, "a", "b");
  assert.equal(shipFrame(world, "b").hp, 0);
});

// ------------------------------------------------------------------
// 6. Раунды и победитель
// ------------------------------------------------------------------
test("раунд: <2 кораблей — waiting, 2+ — playing", () => {
  const world = makeWorld();
  chat(world, "a");
  assert.equal(world.frame().round.state, "waiting");
  chat(world, "b");
  const frame = world.frame();
  assert.equal(frame.round.state, "playing");
  assert.equal(frame.round.number, 1);
  assert.equal(frame.round.alive, 2);
  assert.equal(frame.round.total, 2);
  assert.deepEqual(frame.round.participants.slice().sort(), ["a", "b"]);
});

test("победитель: корона, надпись, +1 победа и storage", () => {
  const storage = fakeStorage();
  const world = Game.createWorld({ settings: {}, seed: 1, storage });
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");

  const frame = world.frame();
  assert.equal(frame.round.state, "finished");
  assert.deepEqual(frame.round.winner.user, "a");
  assert.equal(frame.round.winner.name, "A");
  assert.equal(frame.round.banner.text, "Победитель раунда: A");
  assert.ok(frame.round.banner.until > frame.now);
  assert.equal(frame.round.banner.name, "A");
  assert.equal(shipFrame(world, "a").crown, true);

  assert.deepEqual(world.wins().a, { name: "A", wins: 1 });
  const saved = JSON.parse(storage.data["sea-battle-wins:local"]);
  assert.deepEqual(saved.a, { name: "A", wins: 1 });
});

test("новый раунд через round_pause: все снова с 3 hp, номер растёт", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  // Раунд кончился на попадании; ждём паузу раунда (10 с).
  advance(world, 10000);

  const frame = world.frame();
  assert.equal(frame.round.number, 2);
  assert.equal(frame.round.state, "playing");
  assert.equal(frame.round.alive, 2);
  assert.equal(frame.round.banner, null);
  assert.equal(frame.round.winner, null);
  assert.deepEqual(frame.drowned, []);
  for (const ship of frame.ships) {
    assert.equal(ship.hp, 3);
    assert.equal(ship.state, "sailing");
    assert.equal(ship.crown, false);
  }
});

test("все потоплены — раунд без победителя, побед не начислено", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  for (let exchange = 0; exchange < 3; exchange += 1) {
    world._cooldowns = Object.create(null);
    world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
    world.onMessage(makeMessage({ user: "b", text: "!огонь" }));
    advance(world, 720);
  }
  const frame = world.frame();
  assert.equal(frame.round.state, "finished");
  assert.equal(frame.round.winner, null);
  assert.equal(frame.round.banner, null);
  assert.equal(frame.round.alive, 0);
  assert.deepEqual(world.wins(), {});
});

test("пока waiting, надписи победителя нет", () => {
  const world = makeWorld();
  chat(world, "a");
  advance(world, 500);
  const frame = world.frame();
  assert.equal(frame.round.state, "waiting");
  assert.equal(frame.round.banner, null);
  assert.equal(frame.round.winner, null);
});

test("forceRound: новый раунд сейчас, с полной прочностью", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  assert.equal(shipFrame(world, "b").hp, 2);

  world.forceRound();
  const frame = world.frame();
  assert.equal(frame.round.number, 2);
  assert.equal(frame.round.state, "playing");
  assert.equal(frame.round.banner, null);
  assert.equal(shipFrame(world, "b").hp, 3);
});

// ------------------------------------------------------------------
// 7. Модераторы и пауза
// ------------------------------------------------------------------
test("модераторские команды без прав — no_rights и ничего не происходит", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");

  for (const command of ["!раунд", "!пауза", "!продолжить", "!очистить"]) {
    const report = world.onMessage(makeMessage({ user: "a", text: command }));
    assert.equal(report.ok, false, command);
    assert.equal(report.reason, "no_rights", command);
  }
  assert.equal(world.paused, false);
  assert.equal(world.frame().round.number, 1);
  assert.equal(world.frame().ships.length, 2);
});

test("модератор и стример: пауза, продолжение, раунд, очистка", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");

  const paused = world.onMessage(makeMessage({ user: "mod", text: "!пауза", is_mod: true }));
  assert.equal(paused.ok, true);
  assert.equal(world.paused, true);

  const resumed = world.onMessage(
    makeMessage({ user: "streamer", text: "!продолжить", is_broadcaster: true }),
  );
  assert.equal(resumed.ok, true);
  assert.equal(world.paused, false);

  const round = world.onMessage(
    makeMessage({ user: "streamer", text: "!раунд", is_broadcaster: true }),
  );
  assert.equal(round.ok, true);
  assert.equal(world.frame().round.number, 2);

  const cleared = world.onMessage(makeMessage({ user: "mod", text: "!очистить", is_mod: true }));
  assert.equal(cleared.ok, true);
  const frame = world.frame();
  assert.equal(frame.ships.length, 0);
  assert.equal(frame.queue, 0);
  assert.deepEqual(frame.drowned, []);
  assert.equal(frame.round.state, "waiting");
});

test("пауза: время стоит, команды игроков молчат, модератор работает", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "mod", text: "!пауза", is_mod: true }));
  const frozen = world.now;

  advance(world, 1000);
  assert.equal(world.now, frozen, "в паузе время мира не идёт");

  const shot = world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  assert.equal(shot.reason, "paused");
  assert.equal(world.frame().shots.length, 0);

  const attempt = chat(world, "newbie");
  assert.equal(attempt.joined, false);
  assert.equal(attempt.reason, "paused");
  assert.equal(world.frame().ships.length, 2);

  world.onMessage(makeMessage({ user: "mod", text: "!продолжить", is_mod: true }));
  advance(world, 20);
  assert.equal(world.now, frozen + 20);
});

test("!очистить сохраняет счёт побед", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  assert.equal(world.wins().a.wins, 1);

  world.onMessage(makeMessage({ user: "mod", text: "!очистить", is_mod: true }));
  assert.equal(world.wins().a.wins, 1);
  assert.deepEqual(world.leaderboard().map((item) => item.user), ["a"]);
});

// ------------------------------------------------------------------
// 8. Неактивность и «!уйти»
// ------------------------------------------------------------------
test("неактивный уплывает через idle_minutes и удаляется за краем", () => {
  const world = makeWorld({ idleMinutes: 1 });
  chat(world, "a");
  advance(world, 59980);
  assert.equal(shipFrame(world, "a").state, "sailing");
  advance(world, 20);
  assert.equal(shipFrame(world, "a").state, "leaving");
  advance(world, 2000);
  assert.equal(shipFrame(world, "a"), null);
});

test("любое сообщение продлевает активность", () => {
  const world = makeWorld({ idleMinutes: 1 });
  chat(world, "a");
  advance(world, 50000);
  chat(world, "a", "я тут");
  advance(world, 59980);
  assert.equal(shipFrame(world, "a").state, "sailing");
  advance(world, 20);
  assert.equal(shipFrame(world, "a").state, "leaving");
});

test("!уйти: сразу leaving, потом удаление за краем", () => {
  const world = makeWorld();
  chat(world, "a");
  const report = chat(world, "a", "!уйти");
  assert.equal(report.ok, true);
  const frame = world.frame();
  assert.equal(frame.ships.length, 1);
  assert.equal(frame.ships[0].state, "leaving");
  advance(world, 2000);
  assert.equal(world.frame().ships.length, 0);
});

// ------------------------------------------------------------------
// 9. Счёт побед и storage
// ------------------------------------------------------------------
test("storage: старые победы читаются, топ-5 сортируется", () => {
  const key = "sea-battle-wins:chan";
  const saved = {};
  for (let index = 1; index <= 6; index += 1) {
    saved["u" + index] = { name: "U" + index, wins: index };
  }
  const world = Game.createWorld({
    settings: { channel: "chan" },
    seed: 5,
    storage: fakeStorage({ [key]: JSON.stringify(saved) }),
  });

  const board = world.leaderboard();
  assert.deepEqual(board.map((item) => item.user), ["u6", "u5", "u4", "u3", "u2"]);
  assert.equal(board[0].wins, 6);
  assert.deepEqual(world.frame().leaderboard, board);

  const copy = world.wins();
  copy.u6.wins = 100;
  assert.equal(world.wins().u6.wins, 6, "wins() отдаёт копию");
});

test("storage: победа дописывается к старому счёту", () => {
  const key = "sea-battle-wins:chan";
  const storage = fakeStorage({
    [key]: JSON.stringify({ old: { name: "Old", wins: 4 } }),
  });
  const world = Game.createWorld({ settings: { channel: "chan" }, seed: 3, storage });
  chat(world, "a");
  chat(world, "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");

  const saved = JSON.parse(storage.data[key]);
  assert.equal(saved.old.wins, 4);
  assert.equal(saved.a.wins, 1);
});

test("битое storage не роняет мир", () => {
  const key = "sea-battle-wins:local";
  const world = Game.createWorld({
    settings: {},
    seed: 9,
    storage: fakeStorage({ [key]: "{это не json" }),
  });
  assert.deepEqual(world.wins(), {});
  assert.deepEqual(world.frame().leaderboard, []);
});

// ------------------------------------------------------------------
// 10. Снимок кадра
// ------------------------------------------------------------------
test("frame(): ровно схема договора — ключи, типы, JSON", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));

  const frame = world.frame();
  assert.deepEqual(Object.keys(frame).sort(), [
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
  assert.deepEqual(Object.keys(frame.round).sort(), [
    "alive",
    "banner",
    "finishedAt",
    "nextRoundAt",
    "number",
    "participants",
    "state",
    "total",
    "winner",
  ]);
  assert.deepEqual(Object.keys(frame.ships[0]).sort(), [
    "color",
    "crown",
    "dir",
    "hp",
    "id",
    "lastActiveAt",
    "maxHp",
    "name",
    "phase",
    "row",
    "scale",
    "shake",
    "shield",
    "sinkProgress",
    "state",
    "user",
    "x",
    "y",
  ]);
  assert.deepEqual(Object.keys(frame.shots[0]).sort(), [
    "born",
    "fromX",
    "fromY",
    "id",
    "progress",
    "shooter",
    "shooterName",
    "targetId",
    "targetName",
    "toX",
    "toY",
    "x",
    "y",
  ]);
  assert.equal(typeof frame.seaHeight, "number");
  assert.ok(frame.seaHeight > 0 && frame.seaHeight < 1);
  assert.equal(typeof frame.shipScale, "number");
  assert.equal(JSON.stringify(frame), JSON.stringify(frame));
  assert.deepEqual(plain(frame), frame, "кадр должен быть JSON-сериализуемым");
});

test("frame(): частицы по схеме, копии, а не ссылки", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 700);
  const frame = world.frame();
  assert.ok(frame.particles.length > 0, "попадание должно дать частицы");
  assert.deepEqual(Object.keys(frame.particles[0]).sort(), [
    "color",
    "kind",
    "life",
    "maxLife",
    "size",
    "vx",
    "vy",
    "x",
    "y",
  ]);

  frame.ships[0].x = -5;
  frame.ships.push({ id: 999 });
  frame.round.participants.push("hacker");
  frame.round.winner = { user: "hacker" };
  frame.shots.push({});
  frame.particles.push({});
  frame.drowned.push({ user: "hacker" });
  frame.labels.push({ text: "hack" });
  frame.marks.push({ kind: "hack" });
  frame.leaderboard.push({ user: "hacker", name: "H", wins: 99 });

  const fresh = world.frame();
  assert.equal(fresh.ships.length, 2);
  assert.notEqual(fresh.ships[0].x, -5);
  assert.ok(Math.abs(world.ships[0].x - fresh.ships[0].x) < 1e-4, "кадр округлён");
  assert.deepEqual(world.frame().round.participants.slice().sort(), ["a", "b"]);
  assert.equal(fresh.drowned.length, 0);
  assert.equal(fresh.particles.filter((item) => item.maxLife === undefined).length, 0);
  assert.equal(fresh.labels.filter((item) => item.text === "hack").length, 0);
  assert.equal(fresh.marks.filter((item) => item.kind === "hack").length, 0);
});

// ------------------------------------------------------------------
// 11. Настройки: тема, язык, таблица
// ------------------------------------------------------------------
test('theme:"none" и lang:"en" не ломают мир', () => {
  const world = makeWorld({ theme: "none", lang: "en", leaderboard: false });
  chat(world, "a");
  chat(world, "b");
  world.ships.find((ship) => ship.user === "b").hp = 1;
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 720);

  const frame = world.frame();
  assert.equal(frame.theme, "none");
  assert.equal(frame.lang, "en");
  assert.equal(frame.leaderboardOn, false);
  assert.deepEqual(frame.leaderboard, []);
  assert.equal(frame.round.state, "finished");
  assert.ok(frame.round.banner.text.startsWith("Round winner: "), frame.round.banner.text);
  for (const ship of frame.ships) {
    assert.ok(ship.x >= 0 && ship.x <= 1);
    assert.ok(ship.y > 0 && ship.y < 1);
  }
});

test("lastActiveAt корабля обновляется сообщением", () => {
  const world = makeWorld();
  chat(world, "a");
  advance(world, 1000);
  chat(world, "a", "ещё");
  assert.equal(shipFrame(world, "a").lastActiveAt, 1000);
});

// ------------------------------------------------------------------
// 12. Чистота кода: никаких настоящих часов и Math.random
// ------------------------------------------------------------------
test("в js/game.js нет Date.now, Math.random и таймеров", () => {
  const code = readProject("js/game.js");
  assert.equal(/Date\.now\s*\(/.test(code), false);
  assert.equal(/new\s+Date\s*\(/.test(code), false);
  assert.equal(/Math\.random\s*\(/.test(code), false);
  assert.equal(/setTimeout\s*\(/.test(code), false);
  assert.equal(/setInterval\s*\(/.test(code), false);
  assert.equal(/\bimport\s/.test(code), false);
  assert.equal(/\bexport\s/.test(code), false);
  assert.equal(/require\s*\(/.test(code), false);
});


// ------------------------------------------------------------------
// 13. Ряды и раскладка (часть 2, договор §B.1–B.3)
// ------------------------------------------------------------------
test("ряды: 30 кораблей занимают три ряда, x из slotX, y = rowY", () => {
  const world = makeWorld({ maxShips: 30 });
  for (let index = 1; index <= 30; index += 1) chat(world, "u" + index);
  const frame = world.frame();
  assert.equal(frame.ships.length, 30);
  const counts = { 0: 0, 1: 0, 2: 0 };
  for (const ship of frame.ships) {
    assert.ok(ship.row >= 0 && ship.row <= 2, "ряд вне 0..2: " + ship.row);
    counts[ship.row] += 1;
    assert.equal(ship.scale, Layout.rowScale(ship.row));
    const expectedY = Layout.rowY(ship.row, 0.3);
    assert.ok(Math.abs(ship.y - expectedY) < 1e-3, "y не по ряду: " + ship.y);
    let matched = false;
    const capacity = Layout.capacity(ship.row, 1);
    for (let slot = 0; slot < capacity; slot += 1) {
      if (Math.abs(ship.x - Layout.slotX(ship.row, slot, 1)) < 1e-3) {
        matched = true;
        break;
      }
    }
    assert.ok(matched, "x не совпал с местом ряда: " + ship.x);
  }
  assert.ok(counts[0] > 0 && counts[1] > 0 && counts[2] > 0, "нужны все три ряда");
  assert.ok(Layout.totalCapacity(1) >= 30, "мест должно хватать");
});

test("ряды: y зависит от sea_height", () => {
  const world = makeWorld({ seaHeight: 60 });
  for (let index = 1; index <= 3; index += 1) chat(world, "u" + index);
  for (const ship of world.frame().ships) {
    assert.ok(Math.abs(ship.y - Layout.rowY(ship.row, 0.6)) < 1e-3);
  }
});

test("ряды: внутри ряда зазор не меньше slotStepFraction", () => {
  const world = makeWorld({ maxShips: 30 });
  for (let index = 1; index <= 30; index += 1) chat(world, "u" + index);
  const ships = world.frame().ships;
  for (let first = 0; first < ships.length; first += 1) {
    for (let second = first + 1; second < ships.length; second += 1) {
      const a = ships[first];
      const b = ships[second];
      if (a.row !== b.row) continue;
      const step = Layout.slotStepFraction(a.row, 1);
      assert.ok(
        Math.abs(a.x - b.x) >= step - 1e-4,
        "наезд в ряду " + a.row + ": " + Math.abs(a.x - b.x),
      );
    }
  }
});

test("ряды: корабли разных рядов друг друга не раздвигают", () => {
  const world = makeWorld();
  world.join("a");
  world.join("b");
  const first = world.ships.find((ship) => ship.user === "a");
  const second = world.ships.find((ship) => ship.user === "b");
  first.row = 0;
  second.row = 2;
  first.y = Layout.rowY(0, 0.3);
  second.y = Layout.rowY(2, 0.3);
  first.x = 0.5;
  second.x = 0.52;

  world.step(20);
  assert.equal(first.x, 0.5);
  assert.equal(second.x, 0.52);
});

test("подписи 30 кораблей не пересекаются (SB.Layout.findLabelCollisions)", () => {
  const world = makeWorld({ maxShips: 30 });
  for (let index = 1; index <= 30; index += 1) chat(world, "u" + index);
  const collisions = Layout.findLabelCollisions(world.frame().ships, {
    width: 1920,
    height: 1080,
    shipScale: 1,
    seaHeight: 0.3,
  });
  assert.equal(collisions.length, 0, "пересечений подписей: " + collisions.length);
});

test("!вперёд: сдвиг по x не меняет ряд", () => {
  const world = makeWorld();
  chat(world, "a");
  const ship = world.ships[0];
  ship.row = 1;
  ship.y = Layout.rowY(1, 0.3);
  ship.x = Layout.slotX(1, 3, 1);
  const rowBefore = ship.row;
  const xBefore = ship.x;

  const report = chat(world, "a", "!вперёд");
  assert.equal(report.ok, true);
  assert.equal(ship.row, rowBefore);
  const moved = shipFrame(world, "a");
  assert.ok(moved.x > xBefore, "кораблю не сдвинулось");
  assert.equal(moved.row, rowBefore);
});

test("новый раунд: потопленный возвращается в свой ряд", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  const second = world.ships.find((ship) => ship.user === "b");
  second.row = 2;
  second.y = Layout.rowY(2, 0.3);

  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  advance(world, 10000);

  const frame = world.frame();
  const restored = frame.ships.find((ship) => ship.user === "b");
  assert.ok(restored, "потопленный не вернулся");
  assert.equal(restored.row, 2);
  assert.equal(restored.hp, 3);
  assert.ok(Math.abs(restored.y - Layout.rowY(2, 0.3)) < 1e-3);
});

test("новый раунд: если место занято — первый свободный в ряду", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  const second = world.ships.find((ship) => ship.user === "b");
  second.row = 0;
  second.y = Layout.rowY(0, 0.3);
  second.x = Layout.slotX(0, 1, 1);
  const takenX = second.x;

  hit(world, "a", "b");
  hit(world, "a", "b");
  hit(world, "a", "b");
  advance(world, 2000); // b на дне, его место свободно
  chat(world, "c"); // новый зритель занимает освободившееся место
  const newcomer = world.ships.find((ship) => ship.user === "c");
  assert.ok(newcomer, "новый корабль не появился");
  assert.equal(newcomer.row, 0);
  assert.ok(Math.abs(newcomer.x - takenX) < 1e-3, "новый корабль не встал на место b");

  world.forceRound();
  const restored = shipFrame(world, "b");
  assert.ok(restored, "потопленный не вернулся");
  assert.equal(restored.row, 0, "ряд сохранён");
  assert.ok(Math.abs(restored.x - takenX) > 1e-3, "место b должно быть занято");
  assert.ok(
    Math.abs(restored.x - Layout.slotX(0, 2, 1)) < 1e-3,
    "ожидалось первое свободное место ряда: " + restored.x,
  );
});

test("очередь и уход: следующий входит в свободный слот ряда", () => {
  const world = makeWorld({ maxShips: 5 });
  for (let index = 1; index <= 5; index += 1) chat(world, "u" + index);
  chat(world, "u6");
  world.leave("u1");
  advance(world, 2500);

  const frame = world.frame();
  assert.equal(frame.queue, 0);
  const entered = frame.ships.find((ship) => ship.user === "u6");
  assert.ok(entered, "u6 не вошёл из очереди");
  assert.equal(entered.row, 0);
  assert.ok(Math.abs(entered.x - Layout.slotX(0, 0, 1)) < 1e-3);
});

// ------------------------------------------------------------------
// 14. События боя (договор §B.4–B.9)
// ------------------------------------------------------------------
test("выстрел: вспышка muzzle и дым smoke у борта стрелка", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));

  const frame = world.frame();
  const muzzle = frame.particles.filter((item) => item.kind === "muzzle");
  const smoke = frame.particles.filter((item) => item.kind === "smoke");
  assert.equal(muzzle.length, 4);
  assert.equal(smoke.length, 3);
  assert.equal(muzzle[0].color, "#ffe9a8");
  assert.equal(smoke[0].color, "#cfd6de");
  const shooter = shipFrame(world, "a");
  for (const particle of muzzle.concat(smoke)) {
    assert.ok(Math.abs(particle.x - shooter.x) < 0.06, "частица не у борта стрелка");
    assert.ok(particle.y <= shooter.y, "частица не над корпусом");
  }
});

test("выстрел: в shots есть стрелок, цель и время рождения", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  const target = world.ships.find((ship) => ship.user === "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));

  const shot = world.frame().shots[0];
  assert.equal(shot.shooter, "a");
  assert.equal(shot.shooterName, "A");
  assert.equal(shot.targetId, target.id);
  assert.equal(shot.targetName, "B");
  assert.equal(shot.born, 0);
});

test("выстрел: стрелка над стрелком и «прицел» на цели", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));

  const marks = world.frame().marks;
  assert.equal(marks.length, 2);
  const shotMark = marks.find((mark) => mark.kind === "shot");
  const aimMark = marks.find((mark) => mark.kind === "aim");
  assert.ok(shotMark && aimMark, "нет стрелки или прицела");
  assert.equal(shotMark.until, Game.SHOT_MARK_MS);
  assert.equal(aimMark.until, Game.SHOT_FLIGHT_MS);
  const target = shipFrame(world, "b");
  assert.ok(Math.abs(aimMark.x - target.x) < 1e-3);
  assert.ok(Math.abs(aimMark.y - target.y) < 1e-3);

  advance(world, 680);
  assert.deepEqual(world.frame().marks.map((mark) => mark.kind), ["shot", "aim"]);
  advance(world, 20); // попадание: прицел снимается
  assert.deepEqual(world.frame().marks.map((mark) => mark.kind), ["shot"]);
  advance(world, 300);
  assert.deepEqual(world.frame().marks, []);
});

test("выстрел без цели: marks только shot, без прицела", () => {
  const world = makeWorld();
  chat(world, "solo");
  world.onMessage(makeMessage({ user: "solo", text: "!огонь" }));
  const frame = world.frame();
  assert.equal(frame.shots[0].targetId, 0);
  assert.equal(frame.shots[0].targetName, "");
  assert.deepEqual(frame.marks.map((mark) => mark.kind), ["shot"]);
});

test("попадание: «-1», щепки splinter и тряска корабля", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 700);

  const frame = world.frame();
  const target = frame.ships.find((ship) => ship.user === "b");
  assert.equal(target.hp, 2);
  assert.equal(frame.labels.length, 1);
  assert.equal(frame.labels[0].text, "-1");
  assert.equal(frame.labels[0].color, "#ff4d5e");
  assert.equal(frame.labels[0].until, 700 + Game.HIT_LABEL_MS);
  assert.ok(Math.abs(frame.labels[0].y - (target.y - 0.02)) < 1e-3);

  const kinds = frame.particles.map((particle) => particle.kind);
  assert.equal(kinds.filter((kind) => kind === "hit").length, 8);
  assert.equal(kinds.filter((kind) => kind === "splinter").length, 6);
  assert.ok(frame.particles.some((item) => item.kind === "splinter" && item.color === "#a9743f"));
  assert.equal(target.shake, 1);

  advance(world, 350);
  assert.equal(
    world.frame().ships.find((ship) => ship.user === "b").shake,
    0,
    "тряска должна пройти",
  );
});

test("щит: «щит!», частицы shield и целая прочность", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "b", "!щит");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 700);

  const frame = world.frame();
  assert.equal(frame.ships.find((ship) => ship.user === "b").hp, 3);
  assert.equal(frame.ships.find((ship) => ship.user === "b").shield, false);
  assert.equal(frame.labels[0].text, "щит!");
  assert.equal(frame.labels[0].color, "#9fe8ff");
  assert.equal(frame.labels[0].until, 700 + Game.SHIELD_LABEL_MS);
  assert.equal(frame.particles.filter((item) => item.kind === "shield").length, 10);
});

test("щит: по-английски «shield!»", () => {
  const world = makeWorld({ lang: "en" });
  chat(world, "a");
  chat(world, "b");
  chat(world, "b", "!щит");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 700);
  assert.equal(world.frame().labels[0].text, "shield!");
});

test("промах: только всплеск, без «-1» и тряски", () => {
  const world = makeWorld();
  chat(world, "solo");
  world.onMessage(makeMessage({ user: "solo", text: "!огонь" }));
  advance(world, 700);

  const frame = world.frame();
  assert.equal(frame.labels.length, 0);
  assert.equal(frame.ships.find((ship) => ship.user === "solo").shake, 0);
  const kinds = frame.particles.map((particle) => particle.kind);
  assert.equal(kinds.filter((kind) => kind === "splash").length, 8);
  assert.equal(kinds.filter((kind) => kind === "hit").length, 0);
});

test("просроченные labels и marks исчезают (now >= until)", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 700);
  assert.equal(world.frame().labels.length, 1);
  assert.equal(world.frame().marks.length, 1);

  advance(world, 880); // now = 1580: «-1» ещё жив (until 1600)
  assert.equal(world.frame().labels.length, 1);
  advance(world, 20); // now = 1600
  assert.equal(world.frame().labels.length, 0);
  assert.equal(world.frame().marks.length, 0);
});

test("потолки событий: labels ≤ 12, marks ≤ 20, старые вытесняются", () => {
  const world = makeWorld();
  chat(world, "a");
  for (let index = 0; index < 20; index += 1) {
    world._addLabel({
      text: "L" + index,
      color: "#ffffff",
      x: 0.5,
      y: 0.5,
      born: 0,
      until: 100000,
      size: 1,
    });
  }
  for (let index = 0; index < 30; index += 1) {
    world._addMark({
      kind: "shot",
      x: 0.5,
      y: 0.5,
      tx: 0.6,
      ty: 0.5,
      born: 0,
      until: 100000,
    });
  }
  const frame = world.frame();
  assert.equal(frame.labels.length, 12);
  assert.equal(frame.labels[11].text, "L19");
  assert.equal(frame.marks.length, 20);
  assert.equal(frame.marks[19].tx, 0.6);
});

test("frame(): новые поля событий — копия, не ссылки", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  world.onMessage(makeMessage({ user: "a", text: "!огонь" }));
  advance(world, 700);

  const frame = world.frame();
  const ship = frame.ships[0];
  assert.ok("row" in ship && "scale" in ship && "shake" in ship);
  assert.equal(typeof ship.scale, "number");
  assert.ok(Array.isArray(frame.labels) && Array.isArray(frame.marks));
  assert.ok(frame.labels.length > 0, "попадание должно дать «-1»");
  assert.deepEqual(plain(frame), frame, "кадр должен быть JSON-сериализуемым");

  frame.labels[0].text = "hack";
  frame.marks.push({ kind: "hack" });
  frame.ships[0].row = 7;
  const fresh = world.frame();
  assert.notEqual(fresh.labels[0].text, "hack");
  assert.equal(fresh.marks.filter((item) => item.kind === "hack").length, 0);
  assert.equal(fresh.ships[0].row, world.ships[0].row);
});
