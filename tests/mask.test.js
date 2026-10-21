"use strict";
// Ники: маска мата (первая буква + звёздочки) и обрезка до 16 знаков.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal } = require("./helpers");

const SB = loadGlobal(["js/mask.js"]);
const Mask = SB.Mask;

test("mask: список корней взят из «Светлячков» и заморожен", () => {
  assert.equal(Object.isFrozen(Mask.DEFAULT_ROOTS), true);
  for (const root of ["^бля", "хуй", "пизд", "нахуй", "^сука", "мудак"]) {
    assert.equal(Mask.DEFAULT_ROOTS.includes(root), true, root);
  }
  assert.equal(Mask.NAME_CHARS, 16);
});

test("mask: корень закрывает слово, оставляя первую букву", () => {
  const roots = ["хуй"];
  assert.equal(Mask.maskRoots("хуй", roots), "х**");
  assert.equal(Mask.maskRoots("нахуй", roots), "н****");
  assert.equal(Mask.maskRoots("ХУЙ", roots), "Х**");
  assert.equal(Mask.maskRoots("ну и хуй", roots), "ну и х**");
});

test("mask: «^бля» закрывает только начало слова", () => {
  const roots = ["^бля"];
  assert.equal(Mask.maskRoots("бля", roots), "б**");
  assert.equal(Mask.maskRoots("Блять!", roots), "Б****!");
  assert.equal(Mask.maskRoots("бляха", roots), "б****");
  for (const word of ["рубля", "оскорблять", "корабля", "сабля", "дирижабля"]) {
    assert.equal(Mask.maskRoots(word, roots), word, word);
  }
});

test("mask: без крыши корень ищется в любом месте слова", () => {
  assert.equal(Mask.maskRoots("рубля", ["бля"]), "р****");
  assert.equal(Mask.maskRoots("нахуй и нахуй", ["^бля", "нахуй"]), "н**** и н****");
});

test("mask: исключения не закрываются никогда", () => {
  assert.equal(
    Mask.maskRoots("Бляха, бля и рубля", ["^бля"], ["бляха"]),
    "Бляха, б** и рубля"
  );
  assert.equal(Mask.maskRoots("БЛЯХА", ["^бля"], ["Бляха"]), "БЛЯХА");
  assert.equal(Mask.maskRoots("бляха, блятина", ["^бля"], ["бляха"]), "бляха, б******");
});

test("mask: пустой список корней и пустой текст ничего не меняют", () => {
  assert.equal(Mask.maskRoots("хуй", []), "хуй");
  assert.equal(Mask.maskRoots("хуй", null), "хуй");
  assert.equal(Mask.maskRoots("", ["хуй"]), "");
  assert.equal(Mask.maskRoots(null, ["хуй"]), "");
  assert.equal(Mask.maskRoots("привет", ["хуй"]), "привет");
});

test("mask: эмодзи не сбивают границы слов и кодовые точки", () => {
  assert.equal(Mask.maskRoots("😀хуй😀", ["хуй"]), "😀х**😀");
  assert.equal(Mask.maskRoots("хуй_зритель", ["хуй"]), "х**********");
});

test("mask: короткий ник остаётся как есть", () => {
  assert.equal(Mask.shortName("Луна Кот", Mask.DEFAULT_ROOTS), "Луна Кот");
  assert.equal(Mask.shortName("  Луна   Кот  ", Mask.DEFAULT_ROOTS), "Луна Кот");
  assert.equal(Mask.shortName("", Mask.DEFAULT_ROOTS), "");
});

test("mask: ник до 16 знаков не обрезается, длиннее — с «…»", () => {
  const sixteen = "abcdefghijklmnop";
  assert.equal(Mask.shortName(sixteen, Mask.DEFAULT_ROOTS), sixteen);
  assert.equal(Mask.shortName("abcdefghijklmnopq", Mask.DEFAULT_ROOTS), "abcdefghijklmno…");
  assert.equal(Array.from(Mask.shortName("abcdefghijklmnopq", Mask.DEFAULT_ROOTS)).length, 16);
});

test("mask: мат в нике закрывается, а не вырезается", () => {
  assert.equal(Mask.shortName("хуй_зритель", Mask.DEFAULT_ROOTS), "х**********");
  assert.equal(Mask.shortName("нахуй", Mask.DEFAULT_ROOTS), "н****");
  assert.equal(Mask.shortName("мудак228", Mask.DEFAULT_ROOTS), "м*******");
});

test("mask: корни-исключения игнорируются, пустые корни отбрасываются", () => {
  assert.equal(Mask.maskRoots("бляха", ["^бля"], []), "б****");
  assert.equal(Mask.maskRoots("привет", ["", "   "]), "привет");
  assert.equal(Mask.maskRoots("привет", ["^"]), "привет");
});

test("mask: слова через дефис закрываются по отдельности", () => {
  assert.equal(
    Mask.maskRoots("хуй-хуй", ["хуй"]),
    "х**-х**"
  );
});

test("mask: shorten обрезает по кодовым точкам, а не по UTF-16", () => {
  assert.equal(Mask.shorten("😀😀😀😀", 2), "😀😀");
  assert.equal(Mask.shorten("  много   пробелов ", 20), "много пробелов");
  assert.equal(Mask.shorten("текст", 0), "");
});

test("mask: collapseSpaces убирает переводы строк и лишние пробелы", () => {
  assert.equal(Mask.collapseSpaces("  а\n\nб\tв  "), "а б в");
  assert.equal(Mask.collapseSpaces(null), "");
});
