"use strict";
// Цвета кораблей «Морского боя чата».
//
// Цвет ника в чате Twitch бывает тёмным, а на воде тёмный парус теряется.
// Поэтому colorForChat поднимает светлоту тёмных цветов до ночного
// минимума (HSL L = 0,55), сохраняя оттенок и насыщенность. Если цвета в
// чате нет, цвет выбирается по контрольной сумме ника (crc32) — так один
// и тот же зритель всегда одного цвета.
//
// Код взят из «Светлячков для всех» (наш же проект, MIT) и упрощён:
// осталось только то, что нужно парусу и подписям.
//
// Это обычный браузерный скрипт, без модулей: страница должна работать
// и с GitHub Pages, и открытой как локальный файл в OBS.
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Яркая палитра: фиолетово-розовые, мятные, золотые и голубые оттенки
  // без тёмных и грязных цветов — паруса должны читаться на воде.
  const PALETTE = [
    "#ff9ee6",
    "#c9a6ff",
    "#8fd8ff",
    "#ffb8e0",
    "#a6ffd9",
    "#ffe08a",
    "#b8b0ff",
    "#ff8fb8",
    "#9be7ff",
    "#e0c3ff",
    "#ffd1f0",
    "#7dffd4",
  ];

  // Минимальная светлота цвета паруса, как в «Светлячках».
  const MIN_LIGHTNESS = 0.55;

  // Таблица CRC32 (IEEE, тот же многочлен, что у zlib.crc32).
  const CRC_TABLE = (function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  // Строку в UTF-8 собираем сами: TextEncoder есть не везде.
  function _utf8Bytes(text) {
    const bytes = [];
    for (const char of text) {
      const point = char.codePointAt(0);
      if (point < 0x80) {
        bytes.push(point);
      } else if (point < 0x800) {
        bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      } else if (point < 0x10000) {
        bytes.push(
          0xe0 | (point >> 12),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f)
        );
      } else {
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f)
        );
      }
    }
    return bytes;
  }

  function _fold(text) {
    return text.toLowerCase();
  }

  /** CRC32 (IEEE) для строки в UTF-8 — как zlib.crc32 в Python. */
  function crc32(text) {
    const bytes = _utf8Bytes(typeof text === "string" ? text : String(text));
    let checksum = 0xffffffff;
    for (const byte of bytes) {
      checksum = (checksum >>> 8) ^ CRC_TABLE[(checksum ^ byte) & 0xff];
    }
    return (checksum ^ 0xffffffff) >>> 0;
  }

  /** Вернуть цвет в виде «#rrggbb» в нижнем регистре или null. */
  function normalizeHex(value) {
    if (typeof value !== "string") return null;
    const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    if (match === null) return null;
    return "#" + match[1].toLowerCase();
  }

  /** Преобразовать «#rrggbb» или «rrggbb» в {r, g, b}. */
  function hexToRgb(value) {
    const normalized = normalizeHex(value);
    if (normalized === null) {
      throw new RangeError("некорректный цвет: " + JSON.stringify(value));
    }
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16),
    };
  }

  function _clampChannel(value) {
    let number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) number = 0;
    return Math.max(0, Math.min(255, number));
  }

  function _rgbChannels(rgb) {
    if (rgb && typeof rgb === "object") {
      if (typeof rgb.length === "number") return [rgb[0], rgb[1], rgb[2]];
      return [rgb.r, rgb.g, rgb.b];
    }
    throw new Error("некорректный цвет: нужны каналы r, g, b");
  }

  /** Преобразовать последовательность (r, g, b) в «#rrggbb». */
  function rgbToHex(rgb) {
    const channels = _rgbChannels(rgb).map(_clampChannel);
    return (
      "#" +
      channels
        .map(function (value) {
          return value.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  /** Выбрать цвет для ника по его контрольной сумме crc32. */
  function colorForNick(nick, palette) {
    const colors = palette == null ? PALETTE : palette;
    if (!colors || colors.length === 0) {
      throw new Error("палитра не должна быть пустой");
    }
    const text = typeof nick === "string" ? nick : String(nick);
    if (text === "") return colors[0];
    const checksum = crc32(_fold(text));
    return colors[checksum % colors.length];
  }

  // colorsys.rgb_to_hls из Python: hue, lightness, saturation в 0..1.
  function _rgbToHls(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    if (max === min) return [0, lightness, 0];

    const delta = max - min;
    const saturation =
      lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === red) {
      hue = (green - blue) / delta + (green < blue ? 6 : 0);
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    return [hue / 6, lightness, saturation];
  }

  // colorsys.hls_to_rgb из Python: hue 0..1, lightness 0..1,
  // saturation 0..1, результат — доли каналов 0..1.
  function _hueChannel(m1, m2, hue) {
    let shifted = hue % 1;
    if (shifted < 0) shifted += 1;
    if (shifted < 1 / 6) return m1 + (m2 - m1) * shifted * 6;
    if (shifted < 0.5) return m2;
    if (shifted < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - shifted) * 6;
    return m1;
  }

  function _hlsToRgb(hue, lightness, saturation) {
    if (saturation === 0) return [lightness, lightness, lightness];
    const m2 =
      lightness <= 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const m1 = 2 * lightness - m2;
    return [
      _hueChannel(m1, m2, hue + 1 / 3),
      _hueChannel(m1, m2, hue),
      _hueChannel(m1, m2, hue - 1 / 3),
    ];
  }

  /** Поднять светлоту цвета до 0,55, сохранив оттенок и насыщенность. */
  function liftBrightness(color, minLightness) {
    const threshold = minLightness === undefined ? MIN_LIGHTNESS : minLightness;
    const normalized = normalizeHex(color);
    if (normalized === null) return color;
    const rgb = hexToRgb(normalized);
    const hls = _rgbToHls(rgb.r / 255, rgb.g / 255, rgb.b / 255);
    const hue = hls[0];
    const lightness = hls[1];
    const saturation = hls[2];
    if (lightness < threshold) {
      const lifted = _hlsToRgb(hue, threshold, saturation);
      // Округляем вверх: после перевода в 8 бит светлота не должна
      // оказаться чуть ниже обещанных 0,55. Для очень светлых каналов
      // потолок — 255, но там светлота и так выше порога.
      return rgbToHex([
        Math.min(255, Math.ceil(lifted[0] * 255)),
        Math.min(255, Math.ceil(lifted[1] * 255)),
        Math.min(255, Math.ceil(lifted[2] * 255)),
      ]);
    }
    return normalized;
  }

  /** Цвет паруса: цвет из чата (осветлённый) или цвет из ника. */
  function colorForChat(nick, chatColor, palette) {
    if (chatColor) {
      const normalized = normalizeHex(chatColor);
      if (normalized !== null) return liftBrightness(normalized);
    }
    return colorForNick(nick, palette);
  }

  /** Чистая функция: {r, g, b} -> {h в градусах, s, l}. */
  function rgbToHsl(rgb) {
    const channels = _rgbChannels(rgb);
    const hls = _rgbToHls(channels[0] / 255, channels[1] / 255, channels[2] / 255);
    return { h: hls[0] * 360, s: hls[2], l: hls[1] };
  }

  /** Чистая функция: h в градусах, s и l в 0..1 -> {r, g, b}. */
  function hslToRgb(hue, saturation, lightness) {
    let normalizedHue = Number(hue) % 360;
    if (normalizedHue < 0) normalizedHue += 360;
    const rgb = _hlsToRgb(
      normalizedHue / 360,
      Number(lightness),
      Number(saturation)
    );
    return {
      r: Math.round(rgb[0] * 255),
      g: Math.round(rgb[1] * 255),
      b: Math.round(rgb[2] * 255),
    };
  }

  SB.Colors = {
    PALETTE,
    MIN_LIGHTNESS,
    normalizeHex,
    hexToRgb,
    rgbToHex,
    crc32,
    colorForNick,
    liftBrightness,
    colorForChat,
    rgbToHsl,
    hslToRgb,
  };
})(typeof window !== "undefined" ? window : globalThis);
