"use strict";
// Команды чата: разбор на русском и латинице, права, паузы.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadGlobal } = require("./helpers");

const SB = loadGlobal(["js/commands.js"]);
const Commands = SB.Commands;

test("commands: тринадцать команд — игроков семь, стримера четыре", () => {
  assert.equal(Commands.PLAYER_COMMANDS.length, 7);
  assert.equal(Commands.MODERATOR_COMMANDS.length, 4);
  assert.deepEqual(Array.from(Commands.PLAYER_COMMANDS).sort(), [
    "fire", "join", "leave", "left", "repair", "right", "shield",
  ]);
  assert.deepEqual(Array.from(Commands.MODERATOR_COMMANDS).sort(), [
    "clear", "pause", "resume", "round",
  ]);
});

test("commands: русские названия разбираются", () => {
  const cases = {
    "!огонь": "fire",
    "!вперёд": "right",
    "!вперед": "right",
    "!назад": "left",
    "!щит": "shield",
    "!ремонт": "repair",
    "!играть": "join",
    "!уйти": "leave",
    "!раунд": "round",
    "!пауза": "pause",
    "!продолжить": "resume",
    "!очистить": "clear",
  };
  for (const [text, name] of Object.entries(cases)) {
    assert.equal(Commands.parse(text).name, name, text);
  }
});

test("commands: латиница разбирается", () => {
  const cases = {
    "!fire": "fire",
    "!left": "left",
    "!right": "right",
    "!shield": "shield",
    "!repair": "repair",
    "!join": "join",
    "!leave": "leave",
    "!round": "round",
    "!pause": "pause",
    "!resume": "resume",
    "!clear": "clear",
    "!forward": "right",
    "!back": "left",
  };
  for (const [text, name] of Object.entries(cases)) {
    assert.equal(Commands.parse(text).name, name, text);
  }
});

test("commands: регистр команды не важен", () => {
  assert.equal(Commands.parse("!ОГОНЬ").name, "fire");
  assert.equal(Commands.parse("!FiRe").name, "fire");
  assert.equal(Commands.parse("!Щит").name, "shield");
  assert.equal(Commands.parse("!ПРОДОЛЖИТЬ").name, "resume");
});

test("commands: аргумент ника отделяется и чистится", () => {
  assert.equal(Commands.parse("!огонь Вася").arg, "Вася");
  assert.equal(Commands.parse("!огонь @Вася").arg, "Вася");
  assert.equal(Commands.parse("!огонь #Вася").arg, "Вася");
  assert.equal(Commands.parse("!огонь    Вася   ").arg, "Вася");
  assert.equal(Commands.parse("!огонь Луна Кот").arg, "Луна Кот");
  assert.equal(Commands.parse("!огонь").arg, "");
  assert.equal(Commands.parse("!огонь @").arg, "");
});

test("commands: не команда — не «!» или неизвестное слово", () => {
  assert.equal(Commands.parse("привет !огонь"), null);
  assert.equal(Commands.parse("огонь"), null);
  assert.equal(Commands.parse(""), null);
  assert.equal(Commands.parse(null), null);
  assert.equal(Commands.parse("!"), null);
  assert.equal(Commands.parse("!!"), null);
  assert.equal(Commands.parse("! ,"), null);
  assert.equal(Commands.parse("!огоньвася"), null);
  assert.equal(Commands.parse("!огне"), null);
  assert.equal(Commands.parse("!help"), null);
});

test("commands: пробелы после «!» и вокруг не мешают", () => {
  assert.equal(Commands.parse("   !огонь   ").name, "fire");
  assert.equal(Commands.parse(" !щит").name, "shield");
  assert.equal(Commands.parse("! огонь").name, "fire");
  assert.equal(Commands.parse("! огонь Вася").arg, "Вася");
});

test("commands: знаки препинания после команды не мешают", () => {
  const cases = [
    // [сообщение зрителя, имя команды, аргумент] — таблица §1 ТЗ v3.
    ["!огонь", "fire", ""],
    ["! огонь", "fire", ""],
    ["!вперёд,", "right", ""],
    ["!Огонь!", "fire", ""],
    ["!огонь!!!", "fire", ""],
    ["!щит.", "shield", ""],
    ["!огонь, Вася", "fire", "Вася"],
    ["!огонь,Вася", "fire", "Вася"],
    ["!ремонт?", "repair", ""],
    ["!огонь Вася!", "fire", "Вася"],
  ];
  for (const [text, name, arg] of cases) {
    const parsed = Commands.parse(text);
    assert.ok(parsed, text);
    assert.equal(parsed.name, name, text);
    assert.equal(parsed.arg, arg, text);
  }
  // Склейка и команда без «!» остаются не командой (строки 19 и 21).
  assert.equal(Commands.parse("!огоньвася"), null);
  assert.equal(Commands.parse("огонь"), null);
});

test("commands: слово из одних знаков — не команда", () => {
  assert.equal(Commands.parse("!!!"), null);
  assert.equal(Commands.parse("!?"), null);
  assert.equal(Commands.parse("!..."), null);
  assert.equal(Commands.parse("! ,"), null);
});

test("commands: запятая после слова и знаки в конце аргумента", () => {
  const alone = Commands.parse("!огонь,");
  assert.ok(alone);
  assert.equal(alone.name, "fire");
  assert.equal(alone.arg, "");
  assert.equal(Commands.parse("!ОГОНЬ.").name, "fire");
  assert.equal(Commands.parse("!вперед!").name, "right");
});

test("commands: внутри ника знаки препинания не трогаем", () => {
  assert.equal(Commands.parse("!огонь Вася.Пупкин").arg, "Вася.Пупкин");
  assert.equal(Commands.parse("!огонь vasya_99").arg, "vasya_99");
  assert.equal(Commands.parse("!огонь Вася!").arg, "Вася");
  assert.equal(Commands.parse("!огонь @Вася!").arg, "Вася");
});

test("commands: буква «ё» нужна только слову «вперёд»", () => {
  for (const word of Object.keys(Commands.ALIASES)) {
    if (word === "вперёд") continue;
    assert.equal(word.indexOf("ё"), -1, word);
  }
  assert.equal(Commands.parse("!вперёд,").name, "right");
  assert.equal(Commands.parse("!вперед!").name, "right");
});

test("commands: исходный текст сохраняется для отладки", () => {
  const parsed = Commands.parse("!огонь Вася");
  assert.equal(parsed.raw, "!огонь Вася");
});

test("commands: у каждой команды игрока своя пауза по умолчанию", () => {
  assert.equal(Commands.COOLDOWN_SEC.fire, 6);
  assert.equal(Commands.COOLDOWN_SEC.right, 6);
  assert.equal(Commands.COOLDOWN_SEC.left, 6);
  assert.equal(Commands.COOLDOWN_SEC.join, 6);
  assert.equal(Commands.COOLDOWN_SEC.leave, 6);
  assert.equal(Commands.COOLDOWN_SEC.shield, 20);
  assert.equal(Commands.COOLDOWN_SEC.repair, 30);
});

test("commands: пауза щита и ремонта не опускается ниже ТЗ", () => {
  assert.equal(Commands.cooldownSeconds("shield", 6), 20);
  assert.equal(Commands.cooldownSeconds("repair", 6), 30);
  assert.equal(Commands.cooldownSeconds("fire", 6), 6);
});

test("commands: настройка cooldown увеличивает паузу игроков", () => {
  assert.equal(Commands.cooldownSeconds("fire", 10), 10);
  assert.equal(Commands.cooldownSeconds("right", 10), 10);
  assert.equal(Commands.cooldownSeconds("shield", 10), 20);
  assert.equal(Commands.cooldownSeconds("repair", 25), 30);
  assert.equal(Commands.cooldownSeconds("shield", 25), 25);
  assert.equal(Commands.cooldownSeconds("repair", 30), 30);
});

test("commands: мусор в настройке cooldown не ломает паузы", () => {
  assert.equal(Commands.cooldownSeconds("fire", "мусор"), 6);
  assert.equal(Commands.cooldownSeconds("fire", 0), 6);
  assert.equal(Commands.cooldownSeconds("fire", -5), 6);
  assert.equal(Commands.cooldownSeconds("fire", null), 6);
});

test("commands: модераторские команды без паузы", () => {
  for (const name of Commands.MODERATOR_COMMANDS) {
    assert.equal(Commands.cooldownSeconds(name, 10), 0, name);
    assert.equal(Commands.isModeratorCommand(name), true);
    assert.equal(Commands.isPlayerCommand(name), false);
  }
});

test("commands: isPlayerCommand знает только команды зрителей", () => {
  assert.equal(Commands.isPlayerCommand("fire"), true);
  assert.equal(Commands.isPlayerCommand("join"), true);
  assert.equal(Commands.isPlayerCommand("round"), false);
  assert.equal(Commands.isPlayerCommand("нет"), false);
});

test("commands: цель ищется без регистра и по любому варианту ника", () => {
  assert.equal(Commands.targetMatches(["Vasya"], "vasya"), true);
  assert.equal(Commands.targetMatches(["Vasya"], " VASYA "), true);
  assert.equal(Commands.targetMatches(["vasya", "Вася"], "вася"), true);
  assert.equal(Commands.targetMatches(["vasya"], "петя"), false);
  assert.equal(Commands.targetMatches(["vasya"], ""), false);
  assert.equal(Commands.targetMatches([], "vasya"), false);
  assert.equal(Commands.targetMatches("vasya", "VASYA"), true);
});

test("commands: латинское имя и русское отображаемое — один зритель", () => {
  const names = ["luna_kot", "Луна Кот"];
  assert.equal(Commands.targetMatches(names, "luna_kot"), true);
  assert.equal(Commands.targetMatches(names, "Луна Кот"), true);
  assert.equal(Commands.targetMatches(names, "луна кот"), true);
  assert.equal(Commands.targetMatches(names, "Луна"), false);
});

test("commands: таблица соответствий полна и значения канонические", () => {
  const canonical = new Set([
    ...Commands.PLAYER_COMMANDS,
    ...Commands.MODERATOR_COMMANDS,
  ]);
  for (const value of Object.values(Commands.ALIASES)) {
    assert.equal(canonical.has(value), true, value);
  }
  assert.equal(Object.isFrozen(Commands.ALIASES), true);
  assert.equal(Object.isFrozen(Commands.PLAYER_COMMANDS), true);
  assert.equal(Object.isFrozen(Commands.MODERATOR_COMMANDS), true);
  assert.equal(Object.isFrozen(Commands.COOLDOWN_SEC), true);
});

test("commands: все алиасы из ТЗ на месте", () => {
  const expected = [
    "огонь", "fire", "вперёд", "назад", "left", "right", "щит", "shield",
    "ремонт", "repair", "играть", "join", "уйти", "leave", "раунд", "round",
    "пауза", "pause", "продолжить", "resume", "очистить", "clear",
  ];
  for (const word of expected) {
    assert.equal(Object.prototype.hasOwnProperty.call(Commands.ALIASES, word), true, word);
  }
});
