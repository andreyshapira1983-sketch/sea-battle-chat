"use strict";
// Раскладка кораблей и подписей: ряды, зазоры, порядок «имя → сердечки»,
// отсутствие пересечений подписей у 30 кораблей.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal } = require("./helpers");

const SB = loadGlobal(["js/layout.js"]);
const Layout = SB.Layout;

const W = 1920;
const H = 1080;

function ship(name, row, slot, extra) {
  const base = {
    user: "user_" + name,
    name,
    row,
    x: Layout.slotX(row, slot, 1),
    y: Layout.rowY(row, 0.3),
    state: "sailing",
    hp: 3,
    maxHp: 3,
  };
  return Object.assign(base, extra || {});
}

/** 30 кораблей так, как их разложил бы мир: ряды по capacity. */
function fleet30() {
  const ships = [];
  let index = 0;
  for (let row = 0; row < Layout.ROW_COUNT; row += 1) {
    const count = Layout.capacity(row, 1);
    for (let slot = 0; slot < count && ships.length < 30; slot += 1) {
      index += 1;
      ships.push(ship("Капитан" + index, row, slot));
    }
  }
  return ships;
}

test("layout: три ряда, глубже и мельче к третьему", () => {
  assert.equal(Layout.ROW_COUNT, 3);
  assert.equal(Layout.ROW_SCALES.length, 3);
  assert.ok(Layout.ROW_SCALES[0] > Layout.ROW_SCALES[1]);
  assert.ok(Layout.ROW_SCALES[1] > Layout.ROW_SCALES[2]);
  assert.ok(Layout.ROW_DEPTHS[0] < Layout.ROW_DEPTHS[1]);
  assert.ok(Layout.ROW_DEPTHS[1] < Layout.ROW_DEPTHS[2]);
});

test("layout: все 30 кораблей помещаются в ряды по местам", () => {
  assert.ok(Layout.totalCapacity(1) >= 30, "мест меньше 30: " + Layout.totalCapacity(1));
  const fleet = fleet30();
  assert.equal(fleet.length, 30);
  for (const item of fleet) {
    assert.ok(item.x >= Layout.MARGIN);
    assert.ok(item.x <= 1 - Layout.MARGIN);
    assert.ok(item.y > 0.7 && item.y < 1);
  }
});

test("layout: места в ряду не выходят за поля и идут по порядку", () => {
  for (let row = 0; row < Layout.ROW_COUNT; row += 1) {
    const count = Layout.capacity(row, 1);
    assert.ok(count >= 1);
    let previous = -Infinity;
    for (let slot = 0; slot < count; slot += 1) {
      const x = Layout.slotX(row, slot, 1);
      assert.ok(x > previous, "места должны идти слева направо");
      assert.ok(x >= Layout.MARGIN && x <= 1 - Layout.MARGIN);
      previous = x;
    }
    // Мусорный номер места зажимается в ряд, а не улетает.
    assert.equal(Layout.slotX(row, -5, 1), Layout.slotX(row, 0, 1));
    assert.equal(Layout.slotX(row, 999, 1), Layout.slotX(row, count - 1, 1));
  }
});

test("layout: зазор между кораблями не меньше ширины корабля × 1,15", () => {
  for (let row = 0; row < Layout.ROW_COUNT; row += 1) {
    const need = Layout.shipWidthFraction(row, 1) * Layout.GAP_FACTOR;
    assert.ok(Layout.slotStepFraction(row, 1) >= need - 1e-9);
    // И соседние места действительно разнесены не меньше шага.
    const count = Layout.capacity(row, 1);
    if (count >= 2) {
      const step = Layout.slotX(row, 1, 1) - Layout.slotX(row, 0, 1);
      assert.ok(step >= Layout.slotStepFraction(row, 1) - 1e-9);
    }
  }
  assert.equal(Layout.GAP_FACTOR, 1.15);
});

test("layout: глубокие ряды мельче и ниже", () => {
  const unit0 = Layout.unitPx(0, 1, W, H);
  const unit1 = Layout.unitPx(1, 1, W, H);
  const unit2 = Layout.unitPx(2, 1, W, H);
  assert.ok(unit0 > unit1 && unit1 > unit2);
  assert.ok(Math.abs(unit0 - H * 0.055) < 0.01);
  const y0 = Layout.rowY(0, 0.3);
  const y1 = Layout.rowY(1, 0.3);
  const y2 = Layout.rowY(2, 0.3);
  assert.ok(y0 < y1 && y1 < y2);
  assert.ok(y2 < 1);
});

test("layout: высота моря сдвигает полосу и ряды", () => {
  assert.ok(Math.abs(Layout.seaTop(0.3) - 0.7) < 1e-9);
  assert.ok(Layout.rowY(0, 0.3) > 0.7);
  // Чем выше полоса моря, тем выше (меньше y) её первый ряд.
  assert.ok(Layout.rowY(0, 0.5) < Layout.rowY(0, 0.3));
  assert.ok(Layout.rowY(0, 0.5) > Layout.seaTop(0.5));
  assert.ok(Layout.rowY(2, 0.6) <= 1);
});

test("layout: кегль ника уменьшается с глубиной и не вырождается", () => {
  const font0 = Layout.fontPx(0, 1, W);
  const font2 = Layout.fontPx(2, 1, W);
  assert.ok(font0 >= 16 && font0 <= 24, String(font0));
  assert.ok(font2 >= 11 && font2 < font0);
  assert.ok(Layout.fontPx(0, 1, 640) < font0);
});

test("layout: единица масштабируется вместе с кадром 16:9", () => {
  const big = Layout.unitPx(0, 1, 1920, 1080);
  const small = Layout.unitPx(0, 1, 1280, 720);
  assert.ok(Math.abs(small - big * (1280 / 1920)) < 0.01);
  assert.ok(Layout.unitPx(0, 2, 1920, 1080) > Layout.unitPx(0, 1, 1920, 1080));
});

test("layout: подпись — имя сверху, сердечки под ним, ниже корабль", () => {
  const item = ship("Белая Чайка", 0, 0);
  const geo = Layout.labelLayout(item, { width: W, height: H, shipScale: 1, seaHeight: 0.3 });
  const shipY = item.y * H;
  assert.ok(geo.nameBaseline < geo.heartsY, "имя должно быть выше сердечек");
  assert.ok(geo.heartsY + geo.heartSize < shipY, "сердечки должны быть выше корабля");
  assert.ok(geo.crownBase < geo.nameBaseline, "корона выше имени");
  assert.ok(geo.rect.h > 0);
  assert.ok(geo.rect.y < geo.nameBaseline);
  assert.ok(geo.rect.y + geo.rect.h >= geo.heartsY);
});

test("layout: прямоугольник подписи покрывает текст и сердечки", () => {
  const item = ship("Пират Ня", 1, 1);
  const geo = Layout.labelLayout(item, { width: W, height: H, shipScale: 1, seaHeight: 0.3 });
  assert.ok(geo.rect.x <= geo.x);
  assert.ok(geo.rect.x + geo.rect.w >= geo.x);
  assert.ok(geo.rect.y <= geo.nameBaseline);
  assert.ok(geo.rect.y + geo.rect.h >= geo.heartsY + geo.heartSize - 1e-6);
});

test("layout: ширина подписи не больше шага места в ряду", () => {
  const longName = "А".repeat(Layout.LABEL_MAX_CHARS);
  for (let row = 0; row < Layout.ROW_COUNT; row += 1) {
    const label = Layout.labelWidthFraction(longName, row, 1);
    assert.ok(label <= Layout.slotStepFraction(row, 1) + 1e-9, "ряд " + row);
  }
});

test("layout: подписи 30 кораблей на трёх рядах не пересекаются", () => {
  const fleet = fleet30();
  const collisions = Layout.findLabelCollisions(fleet, {
    width: W,
    height: H,
    shipScale: 1,
    seaHeight: 0.3,
  });
  assert.deepEqual(
    collisions.map((pair) => pair.map((item) => item.name)),
    [],
  );
});

test("layout: подписи соседних рядов тоже не пересекаются", () => {
  const first = ship("Капитан Шторм", 0, 0);
  const second = ship("Штурман Боб", 1, 0);
  const rects = [first, second].map((item) =>
    Layout.labelRect(item, { width: W, height: H, shipScale: 1, seaHeight: 0.3 }),
  );
  assert.equal(Layout.rectsOverlap(rects[0], rects[1]), false);
});

test("layout: пересечение подписей находится, если поставить их в одну точку", () => {
  const first = ship("Капитан", 0, 0);
  const second = Object.assign({}, first, { user: "other", name: "Другой" });
  const rects = [first, second].map((item) =>
    Layout.labelRect(item, { width: W, height: H, shipScale: 1, seaHeight: 0.3 }),
  );
  assert.equal(Layout.rectsOverlap(rects[0], rects[1]), true);
  const collisions = Layout.findLabelCollisions([first, second], {
    width: W,
    height: H,
    shipScale: 1,
    seaHeight: 0.3,
  });
  assert.equal(collisions.length, 1);
});

test("layout: rectsOverlap учитывает зазор", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 10, y: 0, w: 10, h: 10 };
  assert.equal(Layout.rectsOverlap(a, b), false);
  assert.equal(Layout.rectsOverlap(a, b, 2), true);
  assert.equal(Layout.rectsOverlap(a, null), false);
});

test("layout: подпись длинного ника оценивается по 16 знакам", () => {
  const names = ["korotko", "x".repeat(16), "y".repeat(40)];
  const widths = names.map((name) => Layout.nameWidthFraction(name, 0, 1));
  assert.ok(widths[0] < widths[1]);
  assert.equal(widths[1], widths[2]);
});

test("layout: пустые данные не ломают геометрию", () => {
  const geo = Layout.labelLayout(null, {});
  assert.ok(Number.isFinite(geo.nameBaseline));
  assert.ok(Number.isFinite(geo.rect.w));
  assert.ok(geo.rect.w > 0);
  assert.deepEqual(Layout.findLabelCollisions(null, {}), []);
  assert.equal(Layout.rectsOverlap(undefined, undefined), false);
});
