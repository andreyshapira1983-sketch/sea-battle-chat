"use strict";
// Цвета паруса: осветление тёмного цвета ника и стабильный цвет по нику.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal } = require("./helpers");

const SB = loadGlobal(["js/colors.js"]);
const Colors = SB.Colors;

function lightness(color) {
  return Colors.rgbToHsl(Colors.hexToRgb(color)).l;
}

test("colors: normalizeHex приводит цвет к #rrggbb", () => {
  assert.equal(Colors.normalizeHex("#AABBCC"), "#aabbcc");
  assert.equal(Colors.normalizeHex("aabbcc"), "#aabbcc");
  assert.equal(Colors.normalizeHex(" #00ff00 "), "#00ff00");
  assert.equal(Colors.normalizeHex("#fff"), null);
  assert.equal(Colors.normalizeHex("red"), null);
  assert.equal(Colors.normalizeHex(null), null);
  assert.equal(Colors.normalizeHex(42), null);
});

test("colors: hexToRgb и rgbToHex ходят туда и обратно", () => {
  const rgb = Colors.hexToRgb("#1e2a3b");
  assert.deepEqual(rgb, { r: 30, g: 42, b: 59 });
  assert.equal(Colors.rgbToHex(rgb), "#1e2a3b");
  assert.equal(Colors.rgbToHex([255, 0, 128]), "#ff0080");
});

test("colors: bad hex бросает RangeError, а не молча врёт", () => {
  assert.throws(() => Colors.hexToRgb("#xyzxyz"), RangeError);
});

test("colors: crc32 совпадает с эталоном zlib", () => {
  assert.equal(Colors.crc32("a"), 0xe8b7be43);
  assert.equal(Colors.crc32(""), 0);
  assert.equal(Colors.crc32("Привет"), Colors.crc32("Привет"));
  assert.notEqual(Colors.crc32("Привет"), Colors.crc32("привет"));
});

test("colors: цвет по нику стабилен и всегда из палитры", () => {
  const first = Colors.colorForNick("зритель_1");
  assert.equal(first, Colors.colorForNick("зритель_1"));
  assert.equal(Colors.PALETTE.includes(first), true);
  assert.equal(Colors.colorForNick(""), Colors.PALETTE[0]);
  assert.equal(Colors.colorForNick("x", ["#123456"]), "#123456");
});

test("colors: палитра состоит из ярких корректных цветов", () => {
  assert.ok(Colors.PALETTE.length >= 8);
  for (const color of Colors.PALETTE) {
    assert.equal(Colors.normalizeHex(color), color);
    assert.ok(lightness(color) >= Colors.MIN_LIGHTNESS, color);
  }
});

test("colors: тёмный цвет осветляется до HSL L >= 0.55", () => {
  const lifted = Colors.liftBrightness("#000000");
  assert.equal(lifted, "#8d8d8d");
  assert.ok(lightness(lifted) >= 0.55);
  const blue = Colors.liftBrightness("#0000ff");
  assert.ok(lightness(blue) >= 0.55, blue);
  const dark = Colors.liftBrightness("#3a1020");
  assert.ok(lightness(dark) >= 0.55, dark);
});

test("colors: светлый цвет не портится осветлением", () => {
  assert.equal(Colors.liftBrightness("#ff9ee6"), "#ff9ee6");
  assert.equal(Colors.liftBrightness("#ffffff"), "#ffffff");
});

test("colors: порог осветления можно задать явно, мусор возвращается как есть", () => {
  assert.ok(lightness(Colors.liftBrightness("#101010", 0.7)) >= 0.7);
  assert.equal(Colors.liftBrightness("не цвет"), "не цвет");
  assert.equal(Colors.MIN_LIGHTNESS, 0.55);
});

test("colors: цвет паруса берётся из чата, тёмный осветляется", () => {
  const fromChat = Colors.colorForChat("ник", "#000000");
  assert.equal(fromChat, "#8d8d8d");
  const bright = Colors.colorForChat("ник", "#8fd8ff");
  assert.equal(bright, "#8fd8ff");
});

test("colors: без цвета в чате парус красится по нику", () => {
  const byNick = Colors.colorForNick("луна");
  assert.equal(Colors.colorForChat("луна", ""), byNick);
  assert.equal(Colors.colorForChat("луна", null), byNick);
  assert.equal(Colors.colorForChat("луна", "мусор"), byNick);
});

test("colors: разные ники не обязаны различаться, но цвет воспроизводим", () => {
  const seen = new Set();
  for (let index = 0; index < 50; index += 1) {
    seen.add(Colors.colorForNick("зритель_" + index));
  }
  assert.ok(seen.size > 1);
  assert.equal(Colors.colorForNick("  луна  "), Colors.colorForNick("  луна  "));
});

test("colors: rgbToHsl и hslToRgb согласованы", () => {
  const hsl = Colors.rgbToHsl({ r: 255, g: 0, b: 0 });
  assert.equal(hsl.h, 0);
  assert.equal(hsl.s, 1);
  assert.equal(hsl.l, 0.5);
  const back = Colors.hslToRgb(120, 1, 0.5);
  assert.equal(Colors.rgbToHex(back), "#00ff00");
  const rounded = Colors.rgbToHex(Colors.hslToRgb(240, 0.5, 0.5));
  assert.match(rounded, /^#[0-9a-f]{6}$/);
});
