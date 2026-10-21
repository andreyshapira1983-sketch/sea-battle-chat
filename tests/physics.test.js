"use strict";
// Тесты физики и часов мира «Морского боя чата»: фиксированный шаг 20 мс,
// подставные часы (step), детерминизм, полёт ядра, потопление, надпись
// победителя, пауза раунда, зазор между кораблями и потолок частиц.
//
// Никаких настоящих секунд: время двигаем только через world.step(dt).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal, makeMessage, fakeStorage, plain } = require("./helpers");

const SB = loadGlobal([
  "js/config.js",
  "js/commands.js",
  "js/mask.js",
  "js/colors.js",
  "js/layout.js",
  "js/game.js",
]);
const Game = SB.Game;
const Layout = SB.Layout;

function makeWorld(settings, extra) {
  return Game.createWorld(
    Object.assign(
      { settings: settings || {}, seed: 20261021, storage: fakeStorage() },
      extra || {},
    ),
  );
}

/** Продвинуть мир ровно на ms (кратно 20) кусками по 20 мс. */
function advance(world, ms) {
  const steps = Math.round(Number(ms) / 20);
  for (let index = 0; index < steps; index += 1) world.step(20);
}

function chat(world, user, messageText) {
  return world.onMessage(
    makeMessage({ user, display_name: user, text: messageText === undefined ? "привет" : messageText }),
  );
}

/** Корабль в снимке (или null). */
function shipFrame(world, user) {
  return world.frame().ships.filter((ship) => ship.user === user)[0] || null;
}

/** Сделать жертву почти потопленной и выстрелить: попадание на 700 мс. */
function sinkShot(world, shooter, target) {
  const victim = world.ships.find((ship) => ship.user === target);
  victim.hp = 1;
  world.onMessage(makeMessage({ user: shooter, text: "!огонь" }));
  advance(world, 700);
}

// ------------------------------------------------------------------
// 1. Часы и фиксированный шаг
// ------------------------------------------------------------------
test("шаг: step(20*n) продвигает now ровно на 20*n", () => {
  const world = makeWorld();
  advance(world, 600);
  assert.equal(world.now, 600);
  assert.equal(world.frame().now, 600);
});

test("шаг: больше MAX_FRAME_MS за вызов не берём и не зацикливаемся", () => {
  const world = makeWorld();
  world.step(10000);
  assert.equal(world.now, Game.MAX_FRAME_MS);
  world.step(10000);
  assert.equal(world.now, 2 * Game.MAX_FRAME_MS);
});

test("шаг: остаток сверх лимита не копится", () => {
  const world = makeWorld();
  world.step(10000); // 100 мс, остальные 9900 выбрасываются
  assert.equal(world.now, 100);
  world.step(1); // меньше шага — пока не двигаем
  assert.equal(world.now, 100);
  world.step(19);
  assert.equal(world.now, 120);
});

test("шаг: куски меньше 20 мс накапливаются, а не теряются", () => {
  const world = makeWorld();
  world.step(10);
  assert.equal(world.now, 0);
  world.step(10);
  assert.equal(world.now, 20);
  world.step(5);
  assert.equal(world.now, 20);
  world.step(15);
  assert.equal(world.now, 40);
});

test("шаг: дробные 33+33 мс дают ровно два тика физики", () => {
  const world = makeWorld();
  world.step(33);
  assert.equal(world.now, 20);
  world.step(33);
  assert.equal(world.now, 60);
});

test("шаг: мусор и отрицательное время игнорируются", () => {
  const world = makeWorld();
  world.step(-100);
  world.step(NaN);
  world.step("abc");
  world.step(undefined);
  assert.equal(world.now, 0);
  world.step(20);
  assert.equal(world.now, 20);
});

test("пауза: step не двигает время, после снятия — снова идёт", () => {
  const world = makeWorld();
  chat(world, "a");
  world.setPaused(true);
  world.step(10000);
  assert.equal(world.now, 0);
  assert.equal(world.frame().paused, true);
  world.setPaused(false);
  world.step(20);
  assert.equal(world.now, 20);
});

test("фиксированный шаг: step(100) = пять шагов по 20", () => {
  const first = makeWorld();
  const second = makeWorld();
  for (const world of [first, second]) {
    chat(world, "a");
    chat(world, "b");
    chat(world, "a", "!огонь");
  }
  first.step(100);
  for (let index = 0; index < 5; index += 1) second.step(20);
  assert.equal(first.now, second.now);
  assert.deepEqual(plain(first.frame()), plain(second.frame()));
});

// ------------------------------------------------------------------
// 2. Детерминизм
// ------------------------------------------------------------------
test("детерминизм: одинаковый seed и сообщения — одинаковый кадр", () => {
  const first = makeWorld({}, { seed: 4242 });
  const second = makeWorld({}, { seed: 4242 });
  for (const world of [first, second]) {
    chat(world, "a");
    chat(world, "b");
    chat(world, "c");
    advance(world, 200);
    chat(world, "a", "!огонь");
    advance(world, 800);
    chat(world, "b", "!вперёд");
    advance(world, 400);
  }
  assert.deepEqual(plain(first.frame()), plain(second.frame()));
});

test("детерминизм: другой seed — другой кадр", () => {
  const first = makeWorld({}, { seed: 1 });
  const second = makeWorld({}, { seed: 2 });
  chat(first, "a");
  chat(second, "a");
  assert.notDeepEqual(plain(first.frame().ships), plain(second.frame().ships));
});

// ------------------------------------------------------------------
// 3. Ядро, потопление, надпись
// ------------------------------------------------------------------
test("ядро: летит SHOT_FLIGHT_MS и попадает ровно на 700 мс", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "a", "!огонь");

  advance(world, 680);
  assert.equal(world.frame().shots.length, 1);
  assert.ok(world.frame().shots[0].progress > 0.9);
  assert.equal(shipFrame(world, "b").hp, 3, "до 700 мс урона нет");

  advance(world, 20);
  assert.equal(world.frame().shots.length, 0);
  assert.equal(shipFrame(world, "b").hp, 2, "на 700 мс — попадание");
});

test("ядро: прогресс растёт и не выходит за 0..1", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "a", "!огонь");
  let previous = -1;
  for (let index = 0; index < 35; index += 1) {
    const shot = world.frame().shots[0];
    assert.ok(shot.progress >= 0 && shot.progress <= 1);
    assert.ok(shot.progress > previous);
    previous = shot.progress;
    world.step(20);
  }
  assert.equal(world.frame().shots.length, 0);
});

test("потопление: ровно SINK_MS от 0 до drowned", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  sinkShot(world, "a", "b");

  const start = shipFrame(world, "b");
  assert.equal(start.state, "sinking");
  assert.equal(start.sinkProgress, 0);

  advance(world, 1000);
  assert.equal(shipFrame(world, "b").sinkProgress, 0.5);

  advance(world, 980);
  assert.equal(shipFrame(world, "b").sinkProgress, 0.99);

  advance(world, 20);
  assert.equal(shipFrame(world, "b"), null);
  assert.deepEqual(world.frame().drowned.map((item) => item.user), ["b"]);
});

test("надпись победителя живёт BANNER_MS", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  sinkShot(world, "a", "b");

  const frame = world.frame();
  assert.equal(frame.round.state, "finished");
  assert.equal(frame.round.banner.until, 700 + Game.BANNER_MS);
  assert.deepEqual(frame.round.winner.user, "a");

  advance(world, 5980); // now = 6680
  assert.equal(world.now, 6680);
  assert.ok(world.frame().round.banner, "до 6 с надпись ещё есть");

  advance(world, 20); // now = 6700
  assert.equal(world.frame().round.banner, null);
  assert.ok(world.frame().round.winner, "победитель остаётся до нового раунда");
});

test("новый раунд начинается ровно через round_pause", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  sinkShot(world, "a", "b");
  // Попадание на 700 мс, новый раунд — на 700 + 10 000.
  advance(world, 9980);
  const waiting = world.frame();
  assert.equal(waiting.now, 10680);
  assert.equal(waiting.round.state, "finished");

  advance(world, 20);
  const fresh = world.frame();
  assert.equal(fresh.now, 10700);
  assert.equal(fresh.round.state, "playing");
  assert.equal(fresh.round.number, 2);
  assert.equal(fresh.ships.length, 2);
  assert.equal(fresh.ships.filter((ship) => ship.hp === 3).length, 2);
});

// ------------------------------------------------------------------
// 4. Зазор между кораблями
// ------------------------------------------------------------------
test("зазор: соседи одного ряда раздвигаются до slotStepFraction", () => {
  const world = makeWorld();
  world.join("a");
  world.join("b");
  const first = world.ships.find((ship) => ship.user === "a");
  const second = world.ships.find((ship) => ship.user === "b");
  // Ставим в один ряд: зазор работает только внутри ряда.
  first.row = 0;
  second.row = 0;
  first.y = Layout.rowY(0, 0.3);
  second.y = Layout.rowY(0, 0.3);
  first.x = 0.5;
  second.x = 0.55;
  const step = Layout.slotStepFraction(0, 1);

  world.step(20);
  assert.ok(
    Math.abs(first.x - second.x) >= step - 1e-9,
    "зазор " + Math.abs(first.x - second.x) + " при шаге " + step,
  );
  for (const ship of [first, second]) {
    assert.ok(ship.x >= Game.MARGIN - 1e-9 && ship.x <= 1 - Game.MARGIN + 1e-9);
  }
});

test("зазор: корабли разных рядов не трогают друг друга", () => {
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

test("зазор: раздвигание не выводит корабли за поля", () => {
  const world = makeWorld();
  world.join("a");
  world.join("b");
  const first = world.ships.find((ship) => ship.user === "a");
  const second = world.ships.find((ship) => ship.user === "b");
  first.row = 0;
  second.row = 0;
  first.x = Game.MARGIN;
  second.x = Game.MARGIN + 0.01;
  first.y = Layout.rowY(0, 0.3);
  second.y = Layout.rowY(0, 0.3);

  for (let index = 0; index < 3; index += 1) world.step(20);
  for (const ship of [first, second]) {
    assert.ok(ship.x >= Game.MARGIN - 1e-9 && ship.x <= 1 - Game.MARGIN + 1e-9);
  }
});

// ------------------------------------------------------------------
// 5. Частицы
// ------------------------------------------------------------------
test("частицы: потолок MAX_PARTICLES, старые вытесняются", () => {
  const world = makeWorld();
  chat(world, "a");
  for (let index = 0; index < 20; index += 1) {
    world._splash(0.5, 0.9, "hit", "#ffffff", 40);
  }
  const frame = world.frame();
  assert.equal(frame.particles.length, Game.MAX_PARTICLES);
  assert.equal(JSON.stringify(frame.particles).length > 0, true);
});

test("частицы: угасают сами и не копятся", () => {
  const world = makeWorld();
  chat(world, "a");
  world._splash(0.5, 0.9, "splash", "#bfe9ff", 10);
  assert.equal(world.frame().particles.length, 10);
  advance(world, 1000);
  assert.equal(world.frame().particles.length, 0);
});

test("частицы: попадание даёт искры и щепки", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "a", "!огонь");
  advance(world, 700);
  const kinds = world.frame().particles.map((particle) => particle.kind);
  assert.ok(kinds.includes("hit"), "нет искр попадания");
  assert.ok(kinds.includes("splinter"), "нет щепок");
  assert.ok(world.frame().particles.length <= Game.MAX_PARTICLES);
});

// ------------------------------------------------------------------
// 6. Пустой мир и большие числа
// ------------------------------------------------------------------
test("пустой мир: большие шаги и frame() без ошибок", () => {
  const world = Game.createWorld({});
  world.step(10000);
  world.step(10000);
  world.step(0);
  world.step(-20);
  const frame = world.frame();
  assert.equal(frame.now, 200);
  assert.deepEqual(frame.ships, []);
  assert.deepEqual(frame.shots, []);
  assert.deepEqual(frame.particles, []);
});

test("шаг много раз подряд: время монотонно и точно", () => {
  const world = makeWorld();
  chat(world, "a");
  for (let index = 0; index < 100; index += 1) world.step(20);
  assert.equal(world.now, 2000);
  for (let index = 0; index < 100; index += 1) world.step(100);
  assert.equal(world.now, 2000 + 100 * 100);
  assert.ok(world.frame().now === world.now);
});


// ------------------------------------------------------------------
// 7. События боя на подставных часах (часть 2)
// ------------------------------------------------------------------
test("метки: shot живёт SHOT_MARK_MS, aim — ровно полёт ядра", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "a", "!огонь");
  const marks = world.frame().marks;
  assert.deepEqual(marks.map((mark) => mark.kind), ["shot", "aim"]);
  assert.equal(marks[0].until, Game.SHOT_MARK_MS);
  assert.equal(marks[1].until, Game.SHOT_FLIGHT_MS);

  advance(world, 700); // попадание: прицел снимается вместе с ним
  assert.deepEqual(world.frame().marks.map((mark) => mark.kind), ["shot"]);
  advance(world, 280);
  assert.equal(world.frame().marks.length, 1);
  advance(world, 20);
  assert.equal(world.frame().marks.length, 0, "метка ушла ровно на 1000 мс");
});

test("тряска: shake=1 в момент попадания и гаснет за SHAKE_MS", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "a", "!огонь");
  advance(world, 700);
  const afterHit = world.frame().ships.find((ship) => ship.user === "b");
  assert.equal(afterHit.shake, 1);

  advance(world, 170);
  const middle = world.frame().ships.find((ship) => ship.user === "b");
  assert.ok(middle.shake > 0.4 && middle.shake < 0.6, String(middle.shake));

  advance(world, 180);
  assert.equal(world.frame().ships.find((ship) => ship.user === "b").shake, 0);
});

test("частицы выстрела и всплеска угасают сами", () => {
  const world = makeWorld();
  chat(world, "solo");
  chat(world, "solo", "!огонь");
  advance(world, 740);
  const kinds = world.frame().particles.map((particle) => particle.kind);
  assert.ok(!kinds.includes("muzzle"), "вспышка должна угаснуть");
  assert.ok(!kinds.includes("smoke"), "дым выстрела должен угаснуть");
  assert.ok(kinds.includes("splash"), "всплеск на 700 мс ещё жив");
  advance(world, 1000);
  assert.equal(world.frame().particles.length, 0);
});

test("щит: надпись и частицы живут по своим срокам", () => {
  const world = makeWorld();
  chat(world, "a");
  chat(world, "b");
  chat(world, "b", "!щит");
  chat(world, "a", "!огонь");
  advance(world, 700);
  assert.equal(world.frame().particles.filter((item) => item.kind === "shield").length, 10);
  assert.equal(world.frame().labels[0].text, "щит!");

  advance(world, 980); // now = 1680
  assert.equal(world.frame().labels.length, 1);
  assert.equal(world.frame().particles.filter((item) => item.kind === "shield").length, 0);
  advance(world, 20); // now = 1700
  assert.equal(world.frame().labels.length, 0);
});

test("30 кораблей: шаги не ломают детерминизм и зазор", () => {
  const first = makeWorld({ maxShips: 30 }, { seed: 777 });
  const second = makeWorld({ maxShips: 30 }, { seed: 777 });
  for (const world of [first, second]) {
    for (let index = 1; index <= 30; index += 1) chat(world, "u" + index);
    for (let step = 0; step < 50; step += 1) world.step(20);
  }
  const frame = first.frame();
  assert.deepEqual(plain(frame), plain(second.frame()));
  assert.equal(new Set(frame.ships.map((ship) => ship.row)).size, 3);
  for (let one = 0; one < frame.ships.length; one += 1) {
    for (let two = one + 1; two < frame.ships.length; two += 1) {
      const a = frame.ships[one];
      const b = frame.ships[two];
      if (a.row !== b.row) continue;
      const step = Layout.slotStepFraction(a.row, 1);
      assert.ok(Math.abs(a.x - b.x) >= step - 1e-4, "наезд после шагов");
    }
  }
});
