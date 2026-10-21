/* «Морской бой чата», часть 2: раскладка кораблей и подписей.
 *
 * Часть 2 просила убрать наезд подписей: имя сверху, под ним сердечки, ниже
 * корабль; соседние подписи не пересекаются, а при тесноте корабли уходят
 * во второй и третий ряд — глубже в воду и чуть меньше.
 *
 * Здесь только геометрия (доли кадра и пиксели при известном размере холста)
 * — её используют и мир (js/game.js выбирает ряд и место), и рисование
 * (js/render.js ставит подписи по тем же числам), и тесты (прямоугольники
 * подписей). Один источник правды: если поменять числа здесь, поменяется и
 * игра, и картинка, и проверки.
 *
 * Файл — обычный браузерный скрипт (без import/export).
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Единица рисования корабля — как в render.js: 5,5 % меньшей стороны
  // кадра, умноженные на ship_scale и на масштаб ряда.
  const UNIT_FRACTION = 0.055;
  // Поля по краям воды (доля ширины кадра).
  const MARGIN = 0.05;
  // Ширина корпуса в единицах: от -1.15u до +1.15u.
  const SHIP_WIDTH_UNITS = 2.3;
  // ТЗ: зазор между кораблями по горизонтали ≈ ширина корабля × 1,15.
  const GAP_FACTOR = 1.15;

  // Три ряда: первый у поверхности, второй и третий глубже и мельче.
  const ROW_SCALES = [1, 0.84, 0.7];
  const ROW_DEPTHS = [0.33, 0.6, 0.86];
  const ROW_COUNT = ROW_SCALES.length;

  // Подпись: кегль ника = unit × 0.30, но не мельче 12 px и не крупнее
  // 24 px при ширине кадра 1920 (на других размерах масштабируется).
  const NAME_FONT_RATIO = 0.3;
  const FONT_MIN_FRACTION = 12 / 1920;
  const FONT_MAX_FRACTION = 24 / 1920;
  // Средняя ширина знака в долях кегля — для оценки ширины подписи.
  const CHAR_WIDTH = 0.55;
  // Ник в игре не длиннее 16 знаков (js/mask.js), считаем по худшему случаю.
  const LABEL_MAX_CHARS = 16;
  // Сердечки в ряд и отступы вокруг подписи, в единицах корабля.
  const HEARTS_WIDTH_UNITS = 0.72;
  const HEARTS_HEIGHT_UNITS = 0.52;
  const LABEL_PAD_UNITS = 0.15;
  // Высота подписи над кораблём: имя, под ним сердечки, ниже — мачта.
  const NAME_LIFT_UNITS = 3.0;
  const HEARTS_OFFSET_FONT = 1.35;
  const HEART_SIZE_UNITS = 0.17;
  const CROWN_LIFT_FONT = 0.95;
  const CROWN_HEIGHT_FONT = 1.2;
  // Корона победителя поднимает верх подписи на эту величину (в кеглях).
  const NAME_TOP_FONT = 0.85;

  // 16:9 — соотношение сторон, под которое рассчитаны доли.
  const DEFAULT_ASPECT = 1080 / 1920;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function aspectOf(width, height) {
    const w = number(width, 0);
    const h = number(height, 0);
    if (w > 0 && h > 0) return h / w;
    return DEFAULT_ASPECT;
  }

  function rowScale(row) {
    const index = clamp(Math.floor(number(row, 0)), 0, ROW_COUNT - 1);
    return ROW_SCALES[index];
  }

  function rowDepth(row) {
    const index = clamp(Math.floor(number(row, 0)), 0, ROW_COUNT - 1);
    return ROW_DEPTHS[index];
  }

  /** Единица корабля в долях ширины кадра. */
  function unitFraction(row, shipScale, aspect) {
    const scale = Math.max(0.1, number(shipScale, 1));
    return UNIT_FRACTION * scale * rowScale(row) * number(aspect, DEFAULT_ASPECT);
  }

  /** Единица корабля в пикселях. */
  function unitPx(row, shipScale, width, height) {
    const w = Math.max(1, number(width, 1920));
    return unitFraction(row, shipScale, aspectOf(width, height)) * w;
  }

  /** Кегль ника в долях ширины кадра. */
  function fontFraction(row, shipScale) {
    const raw = unitFraction(row, shipScale, DEFAULT_ASPECT) * NAME_FONT_RATIO;
    return clamp(raw, FONT_MIN_FRACTION, FONT_MAX_FRACTION);
  }

  /** Кегль ника в пикселях. */
  function fontPx(row, shipScale, width) {
    return fontFraction(row, shipScale) * Math.max(1, number(width, 1920));
  }

  /** Ширина корпуса в долях ширины кадра. */
  function shipWidthFraction(row, shipScale) {
    return unitFraction(row, shipScale, DEFAULT_ASPECT) * SHIP_WIDTH_UNITS;
  }

  /** Минимальный зазор между кораблями одного ряда (доля ширины кадра). */
  function shipGapFraction(row, shipScale) {
    return shipWidthFraction(row, shipScale) * GAP_FACTOR;
  }

  function heartsWidthFraction(row, shipScale) {
    return unitFraction(row, shipScale, DEFAULT_ASPECT) * HEARTS_WIDTH_UNITS;
  }

  function padFraction(row, shipScale) {
    return unitFraction(row, shipScale, DEFAULT_ASPECT) * LABEL_PAD_UNITS * 2;
  }

  function nameWidthFraction(name, row, shipScale) {
    const chars = Math.min(LABEL_MAX_CHARS, Array.from(String(name == null ? "" : name)).length);
    return chars * fontFraction(row, shipScale) * CHAR_WIDTH;
  }

  /** Ширина подписи конкретного корабля (доля ширины кадра). */
  function labelWidthFraction(name, row, shipScale) {
    return (
      Math.max(nameWidthFraction(name, row, shipScale), heartsWidthFraction(row, shipScale)) +
      padFraction(row, shipScale)
    );
  }

  /** Ширина самой широкой подписи ряда: по ней и раскладываем места. */
  function maxLabelWidthFraction(row, shipScale) {
    return (
      Math.max(
        LABEL_MAX_CHARS * fontFraction(row, shipScale) * CHAR_WIDTH,
        heartsWidthFraction(row, shipScale),
      ) + padFraction(row, shipScale)
    );
  }

  /**
   * Шаг между соседними кораблями одного ряда: не меньше зазора из ТЗ и не
   * меньше самой широкой подписи — тогда подписи не пересекаются.
   */
  function slotStepFraction(row, shipScale) {
    return Math.max(shipGapFraction(row, shipScale), maxLabelWidthFraction(row, shipScale));
  }

  /** Сколько кораблей влезает в ряд с таким шагом. */
  function capacity(row, shipScale) {
    const step = slotStepFraction(row, shipScale);
    if (!(step > 0)) return 1;
    return Math.max(1, Math.floor((1 - 2 * MARGIN) / step));
  }

  function totalCapacity(shipScale) {
    let total = 0;
    for (let row = 0; row < ROW_COUNT; row += 1) {
      total += capacity(row, shipScale);
    }
    return total;
  }

  /** X места slot в ряду (центр корабля, доля ширины кадра). */
  function slotX(row, slot, shipScale) {
    const count = capacity(row, shipScale);
    const index = clamp(Math.floor(number(slot, 0)), 0, count - 1);
    return MARGIN + ((index + 0.5) * (1 - 2 * MARGIN)) / count;
  }

  /** Y ряда (центр корабля, доля высоты кадра) при данной высоте моря. */
  function rowY(row, seaHeight) {
    const height = clamp(number(seaHeight, 0.3), 0, 1);
    return 1 - height + height * rowDepth(row);
  }

  /** Y поверхности воды (доля высоты кадра). */
  function seaTop(seaHeight) {
    return 1 - clamp(number(seaHeight, 0.3), 0, 1);
  }

  /**
   * Геометрия подписи в пикселях: где имя, где сердечки, где корона и какой
   * прямоугольник занимает вся подпись. Рисование и тесты берут одно и то же.
   */
  function labelLayout(ship, options) {
    const data = ship && typeof ship === "object" ? ship : {};
    const opts = options && typeof options === "object" ? options : {};
    const width = Math.max(1, number(opts.width, 1920));
    const height = Math.max(1, number(opts.height, 1080));
    const shipScale = Math.max(0.1, number(opts.shipScale, 1));
    const seaHeight = number(opts.seaHeight, 0.3);
    const row = clamp(Math.floor(number(data.row, 0)), 0, ROW_COUNT - 1);
    const shipX = clamp(number(data.x, 0.5), 0, 1);
    const shipY = clamp(number(data.y, rowY(row, seaHeight)), 0, 1);
    const unit = unitPx(row, shipScale, width, height);
    const font = fontPx(row, shipScale, width);
    const name = String(data.name == null ? "" : data.name).slice(0, LABEL_MAX_CHARS * 4);
    const cx = shipX * width;
    const py = shipY * height;
    const nameBaseline = py - unit * NAME_LIFT_UNITS;
    const heartsY = nameBaseline + font * HEARTS_OFFSET_FONT;
    const heartSize = unit * HEART_SIZE_UNITS;
    const crownBase = nameBaseline - font * CROWN_LIFT_FONT;
    const nameWidth = Array.from(name).length * font * CHAR_WIDTH;
    const heartsWidth = unit * HEARTS_WIDTH_UNITS;
    const rectWidth = Math.max(nameWidth, heartsWidth) + unit * LABEL_PAD_UNITS * 2;
    const top = nameBaseline - font * NAME_TOP_FONT;
    const bottom = heartsY + heartSize;
    return {
      row,
      unit,
      font,
      x: cx,
      nameX: cx,
      nameBaseline,
      heartsX: cx,
      heartsY,
      heartSize,
      crownX: cx,
      crownBase,
      rect: {
        x: cx - rectWidth / 2,
        y: top,
        w: rectWidth,
        h: bottom - top,
      },
      seaTop: seaTop(seaHeight) * height,
    };
  }

  /** Прямоугольник подписи корабля (пиксели) — короткая обёртка. */
  function labelRect(ship, options) {
    return labelLayout(ship, options).rect;
  }

  /** Пересекаются ли прямоугольники (с запасом pad). */
  function rectsOverlap(first, second, pad) {
    if (!first || !second) return false;
    const gap = Math.max(0, number(pad, 0));
    return (
      first.x < second.x + second.w + gap &&
      second.x < first.x + first.w + gap &&
      first.y < second.y + second.h + gap &&
      second.y < first.y + first.h + gap
    );
  }

  /** Есть ли среди подписей пересекающиеся (для тестов и отладки). */
  function findLabelCollisions(ships, options) {
    const items = Array.isArray(ships) ? ships : [];
    const rects = [];
    for (const ship of items) {
      if (!ship || ship.state === "drowning") continue;
      rects.push({ ship, rect: labelRect(ship, options) });
    }
    const collisions = [];
    for (let first = 0; first < rects.length; first += 1) {
      for (let second = first + 1; second < rects.length; second += 1) {
        if (rectsOverlap(rects[first].rect, rects[second].rect)) {
          collisions.push([rects[first].ship, rects[second].ship]);
        }
      }
    }
    return collisions;
  }

  SB.Layout = {
    UNIT_FRACTION,
    MARGIN,
    SHIP_WIDTH_UNITS,
    GAP_FACTOR,
    ROW_COUNT,
    ROW_SCALES,
    ROW_DEPTHS,
    LABEL_MAX_CHARS,
    CHAR_WIDTH,
    NAME_FONT_RATIO,
    HEARTS_WIDTH_UNITS,
    HEARTS_HEIGHT_UNITS,
    LABEL_PAD_UNITS,
    NAME_LIFT_UNITS,
    HEART_SIZE_UNITS,
    DEFAULT_ASPECT,
    clamp,
    aspectOf,
    rowScale,
    rowDepth,
    unitFraction,
    unitPx,
    fontFraction,
    fontPx,
    shipWidthFraction,
    shipGapFraction,
    heartsWidthFraction,
    nameWidthFraction,
    labelWidthFraction,
    maxLabelWidthFraction,
    slotStepFraction,
    capacity,
    totalCapacity,
    slotX,
    rowY,
    seaTop,
    labelLayout,
    labelRect,
    rectsOverlap,
    findLabelCollisions,
  };
})(typeof window !== "undefined" ? window : globalThis);
