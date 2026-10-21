"use strict";
// Общий загрузчик скриптов для тестов «Морского боя чата».
//
// Страница собрана из обычных скриптов (без import/export), поэтому тесты
// выполняют их в общем пространстве Node и берут готовое SB. Здесь же
// лежат помощники, чтобы каждый набор проверок не повторял одно и то же:
// сообщение чата, поддельное хранилище и поддельный холст.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

let lastFiles = [];

/** Загрузить скрипты страницы в общее пространство имён и вернуть SB. */
function loadGlobal(files, globals) {
  lastFiles = files.slice();
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  delete globalThis.SB;
  if (globals) Object.assign(globalThis, globals);
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInThisContext(code, { filename: file });
  }
  if (!globalThis.SB) throw new Error("скрипты не создали window.SB");
  return globalThis.SB;
}

/** Прочитать файл проекта как текст. */
function readProject(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/** Есть ли файл в проекте. */
function hasProject(file) {
  return fs.existsSync(path.join(ROOT, file));
}

/** Перечень файлов из последней загрузки (для проверок в тестах). */
function loadedFiles() {
  return lastFiles.slice();
}

/** Значение, безопасное для строгого сравнения: только данные. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Сообщение чата в формате, который ждёт js/game.js. */
function makeMessage(extra) {
  return Object.assign(
    {
      user: "test_viewer",
      display_name: "Тестовый Зритель",
      text: "привет",
      first_msg: true,
      is_mod: false,
      is_broadcaster: false,
      chat_color: "",
      msg_id: "",
      action: false,
      emotes: [],
    },
    extra || {},
  );
}

/** Поддельное localStorage: те же getItem/setItem, ничего не сохраняет на диск. */
function fakeStorage(initial) {
  const data = Object.assign(Object.create(null), initial || {});
  return {
    data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

/**
 * Поддельный холст: все обычные методы CanvasRenderingContext2D, которые
 * может позвать рисование. Счётчики вызовов помогают проверять, что
 * страница действительно рисует, а не молча падает.
 */
function makeFakeCanvas(width, height) {
  const calls = Object.create(null);
  const bump = (name) => {
    calls[name] = (calls[name] || 0) + 1;
  };
  const noop = (name) => function () {
    bump(name);
  };
  const gradient = () => {
    bump("createGradient");
    return { addColorStop() {} };
  };
  const ctx = {
    canvas: null,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: noop("save"),
    restore: noop("restore"),
    clearRect: noop("clearRect"),
    fillRect: noop("fillRect"),
    strokeRect: noop("strokeRect"),
    beginPath: noop("beginPath"),
    closePath: noop("closePath"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    quadraticCurveTo: noop("quadraticCurveTo"),
    bezierCurveTo: noop("bezierCurveTo"),
    arc: noop("arc"),
    arcTo: noop("arcTo"),
    ellipse: noop("ellipse"),
    rect: noop("rect"),
    fill: noop("fill"),
    stroke: noop("stroke"),
    clip: noop("clip"),
    translate: noop("translate"),
    rotate: noop("rotate"),
    scale: noop("scale"),
    setTransform: noop("setTransform"),
    resetTransform: noop("resetTransform"),
    setLineDash: noop("setLineDash"),
    fillText: noop("fillText"),
    strokeText: noop("strokeText"),
    drawImage: noop("drawImage"),
    measureText(value) {
      bump("measureText");
      return { width: String(value).length * 9 };
    },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: gradient,
  };
  const canvas = {
    width: width || 1920,
    height: height || 1080,
    style: {},
    getContext() {
      return ctx;
    },
  };
  ctx.canvas = canvas;
  return { canvas, ctx, calls, reset() {
    for (const key of Object.keys(calls)) delete calls[key];
  } };
}

module.exports = {
  ROOT,
  loadGlobal,
  readProject,
  hasProject,
  loadedFiles,
  plain,
  makeMessage,
  fakeStorage,
  makeFakeCanvas,
};
