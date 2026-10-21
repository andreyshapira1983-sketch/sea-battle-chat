/* «Морской бой чата», часть 2: рисование снимка мира.
 *
 * render.js ничего не считает и не двигает: он берёт готовый кадр из
 * game.js (world.frame()) и переносит его на холст. Геометрию кораблей и
 * подписей задаёт js/layout.js (ряды, единица корабля, место имени и
 * сердечек) — рисование только читает эти числа, чтобы картинка, мир и
 * тесты совпадали.
 *
 * Всё — кодом: вода с волнами, корабли по рядам, крупные ядра с обводкой,
 * вспышки/дым/щепки/искры, тряска от попадания, «−1»/«щит!», стрелка
 * стрелка и прицел, корона и баннер. Никаких картинок, шрифтов и адресов
 * из интернета.
 *
 * Фон кадра прозрачный: каждый кадр начинается с clearRect, а вода —
 * полупрозрачная полоса внизу. Так картинка кладётся поверх стрима в OBS.
 *
 * Файл — обычный браузерный скрипт (без import/export).
 */
(function (global) {
  "use strict";

  const SB = global.SB || (global.SB = {});

  // Вода полупрозрачная: сквозь неё видно стрим. Число из договора.
  const SEA_ALPHA = 0.5;
  const DEFAULT_WIDTH = 1920;
  const DEFAULT_HEIGHT = 1080;
  // На экранах с высокой плотностью не раздуваем холст больше чем втрое.
  const MAX_DPR = 3;

  // Ядро должно быть заметным: радиус считается от меньшей стороны кадра.
  // 1920×1080 → 1080 * 0.0032 ≈ 3,46, то есть диаметр около 7 px.
  const CANNONBALL_MIN = 3;
  const CANNONBALL_MAX = 5.5;

  const FONT_STACK = "'Segoe UI', 'Trebuchet MS', system-ui, sans-serif";
  const OUTLINE_COLOR = "rgba(3,14,26,0.92)";
  const TEXT_LIGHT = "#f4fbff";
  const TEXT_GOLD = "#ffe6a3";
  const TEXT_GREY = "#c3ccd6";
  const TEXT_BLUE = "#bfe3ff";
  const CROWN_COLOR = "#ffd75e";
  const HEART_COLOR = "#ff5d7e";
  const HULL_COLOR = "#33465c";
  const HULL_DARK = "#1d2a38";
  const MAST_COLOR = "#e8dcc4";
  const FLAG_COLOR = "#ffcf5c";
  const SHIELD_COLOR = "#9fe1ff";
  const MARK_COLOR = "#ffe6a3";

  // ------------------------------------------------------------------
  // Мелкие помощники: числа, массивы, цвета
  // ------------------------------------------------------------------
  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function num(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function positive(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function textOf(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function colorOr(value, fallback) {
    const text = textOf(value).trim();
    return text || fallback;
  }

  // Детерминированное «случайное» число 0..1: пена и блики должны лежать
  // на своих местах при каждой перерисовке.
  function pseudo(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  /**
   * Цвет с прозрачностью: понимает #rgb, #rrggbb, rgb(), rgba(), hsl().
   * Непонятное значение отдаём как есть — canvas сам решит, что рисовать.
   */
  function withAlpha(color, alpha) {
    const raw = textOf(color).trim();
    const a = clamp(num(alpha, 1), 0, 1);
    let match = /^#([0-9a-f]{6})$/i.exec(raw);
    if (match) {
      const hex = match[1];
      return (
        "rgba(" +
        parseInt(hex.slice(0, 2), 16) + "," +
        parseInt(hex.slice(2, 4), 16) + "," +
        parseInt(hex.slice(4, 6), 16) + "," +
        a + ")"
      );
    }
    match = /^#([0-9a-f]{3})$/i.exec(raw);
    if (match) {
      const hex = match[1];
      return (
        "rgba(" +
        parseInt(hex[0] + hex[0], 16) + "," +
        parseInt(hex[1] + hex[1], 16) + "," +
        parseInt(hex[2] + hex[2], 16) + "," +
        a + ")"
      );
    }
    match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(raw);
    if (match) {
      return (
        "rgba(" +
        Math.round(num(match[1], 0)) + "," +
        Math.round(num(match[2], 0)) + "," +
        Math.round(num(match[3], 0)) + "," +
        a + ")"
      );
    }
    if (/^hsla\(/i.test(raw)) return raw;
    if (/^hsl\(/i.test(raw)) {
      return raw.replace(/^hsl\(/i, "hsla(").replace(/\)\s*$/, ", " + a + ")");
    }
    if (!raw) return "rgba(255,255,255," + a + ")";
    return raw;
  }

  /**
   * Радиус ядра в пикселях: заметный на любом холсте, в пределах 3–5,5 px.
   * shipScale слегка увеличивает ядро у крупных кораблей (при 1 — ровно
   * формула из договора: min(W,H) * 0.0032).
   */
  function cannonballRadius(width, height, shipScale) {
    const w = clamp(num(width, DEFAULT_WIDTH), 1, 100000);
    const h = clamp(num(height, DEFAULT_HEIGHT), 1, 100000);
    const scale = clamp(num(shipScale, 1), 0.6, 2);
    const raw = Math.min(w, h) * 0.0032 * scale;
    return clamp(raw, CANNONBALL_MIN, CANNONBALL_MAX);
  }

  // ------------------------------------------------------------------
  // Создание рисовальщика
  // ------------------------------------------------------------------
  function create(canvas, options) {
    const opts = isObject(options) ? options : {};
    const ctx =
      canvas && typeof canvas.getContext === "function"
        ? canvas.getContext("2d")
        : null;
    if (!ctx) throw new Error("SB.Render.create: у холста нет 2d-контекста");

    // Логический размер (CSS-пиксели) и плотность устройства. Задний буфер
    // холста всегда равен width * dpr: так картинка остаётся резкой.
    let width =
      positive(opts.width) ||
      positive(canvas.clientWidth) ||
      positive(canvas.width) ||
      DEFAULT_WIDTH;
    let height =
      positive(opts.height) ||
      positive(canvas.clientHeight) ||
      positive(canvas.height) ||
      DEFAULT_HEIGHT;
    // Явный размер из options — повод выставить и CSS-размер холста.
    // На странице размером управляет CSS (100%), туда не лезем.
    const explicitSize =
      positive(opts.width) > 0 || positive(opts.height) > 0;
    let dpr = 1;

    function resolveDpr() {
      const raw =
        opts.devicePixelRatio !== undefined
          ? opts.devicePixelRatio
          : global.devicePixelRatio;
      return clamp(num(raw, 1), 1, MAX_DPR);
    }

    function layoutApi() {
      const Layout = SB.Layout;
      return Layout && typeof Layout.unitPx === "function" ? Layout : null;
    }

    // ------------------------------------------------------------------
    // Общие кисти (всё через ctx, без картинок)
    // ------------------------------------------------------------------
    function resetState() {
      // Сбрасываем эффекты после предыдущего кадра. Canvas сам вернёт
      // состояние через restore, но поддельный холст в тестах этого не
      // делает — поэтому все поля выставляем руками.
      if (typeof ctx.setTransform === "function") {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      ctx.shadowColor = "rgba(0,0,0,0)";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    function measureText(value, font) {
      const text = textOf(value);
      if (font) ctx.font = font;
      if (typeof ctx.measureText === "function") {
        try {
          const measured = ctx.measureText(text);
          if (measured && Number.isFinite(measured.width)) return measured.width;
        } catch (error) {
          // Поддельный холст без меры — ниже оценим по символам.
        }
      }
      return text.length * 9;
    }

    /** Обрезать строку многоточием, чтобы она влезла в maxWidth. */
    function fitText(value, maxWidth, font) {
      let text = textOf(value);
      if (font) ctx.font = font;
      if (!(maxWidth > 0)) return "";
      if (measureText(text) <= maxWidth) return text;
      let cut = text;
      while (cut.length > 1 && measureText(cut + "…") > maxWidth) {
        cut = cut.slice(0, -1);
      }
      return cut + "…";
    }

    /** Подпись с тёмной обводкой: читается и на белом, и на чёрном фоне. */
    function paintText(value, x, y, fill, font, align, outlineWidth, alpha, baseline) {
      const text = textOf(value);
      if (!text) return;
      ctx.font = font;
      ctx.textAlign = align || "center";
      ctx.textBaseline = baseline || "middle";
      ctx.globalAlpha = clamp(num(alpha, 1), 0, 1);
      if (typeof ctx.strokeText === "function") {
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(1, num(outlineWidth, 3));
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.strokeText(text, x, y);
      }
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
    }

    function dot(x, y, radius, style) {
      const size = num(radius, 0);
      if (!(size > 0)) return;
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    function ring(x, y, radius, style, lineWidth, alpha) {
      const size = num(radius, 0);
      if (!(size > 0)) return;
      ctx.globalAlpha = clamp(num(alpha, 1), 0, 1);
      ctx.strokeStyle = style;
      ctx.lineWidth = Math.max(1, num(lineWidth, 2));
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function roundRectPath(x, y, w, h, radius) {
      const r = clamp(num(radius, 0), 0, Math.min(w, h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function paintPanel(x, y, w, h, radius, fill, stroke, lineWidth) {
      roundRectPath(x, y, w, h, radius);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = num(lineWidth, 1);
        ctx.stroke();
      }
    }

    function ellipsePath(cx, cy, rx, ry) {
      ctx.beginPath();
      if (typeof ctx.ellipse === "function") {
        ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, Math.max(rx, ry), 0, Math.PI * 2);
      }
    }

    /** Звезда с заданным числом лучей — для вспышки выстрела. */
    function starPath(cx, cy, outer, inner, points, rotation) {
      ctx.beginPath();
      for (let index = 0; index < points * 2; index += 1) {
        const angle = rotation + (index * Math.PI) / points;
        const radius = index % 2 === 0 ? outer : inner;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    // ------------------------------------------------------------------
    // Вода: градиент, волны, пена, блики
    // ------------------------------------------------------------------
    function drawWater(nowSec, seaHeight) {
      const bandHeight = height * seaHeight;
      if (!(bandHeight > 0.5)) return;
      const top = height - bandHeight;

      // Полупрозрачный вертикальный градиент: верх светлее, глубина темнее.
      let painted = false;
      if (typeof ctx.createLinearGradient === "function") {
        try {
          const gradient = ctx.createLinearGradient(0, top, 0, height);
          if (gradient && typeof gradient.addColorStop === "function") {
            gradient.addColorStop(0, withAlpha("#2f86b8", SEA_ALPHA));
            gradient.addColorStop(0.55, withAlpha("#15547f", SEA_ALPHA));
            gradient.addColorStop(1, withAlpha("#082a4d", SEA_ALPHA));
            ctx.fillStyle = gradient;
            painted = true;
          }
        } catch (error) {
          painted = false;
        }
      }
      if (!painted) ctx.fillStyle = withAlpha("#15547f", SEA_ALPHA);
      ctx.fillRect(0, top, width, bandHeight);

      // Линия поверхности: чуть светлее воды.
      ctx.strokeStyle = "rgba(200,240,255,0.5)";
      ctx.lineWidth = Math.max(1, height * 0.0025);
      ctx.beginPath();
      const surfaceStep = Math.max(12, width / 40);
      for (let x = 0; x <= width; x += surfaceStep) {
        const ratio = width > 0 ? x / width : 0;
        const wave =
          Math.sin(ratio * Math.PI * 2 * 1.7 + nowSec * 1.3) * bandHeight * 0.025;
        if (x === 0) ctx.moveTo(x, top + wave);
        else ctx.lineTo(x, top + wave);
      }
      ctx.stroke();

      // Волны: несколько синусоид друг под другом, бегут по времени кадра.
      const waveCount = 3;
      for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
        const base = top + bandHeight * (0.16 + waveIndex * 0.22);
        const amplitude = bandHeight * (0.035 + waveIndex * 0.012);
        const frequency = 1.2 + waveIndex * 0.45;
        const speed = 0.9 + waveIndex * 0.5;
        ctx.strokeStyle =
          "rgba(190,236,255," + (0.26 - waveIndex * 0.05) + ")";
        ctx.lineWidth = Math.max(1, height * (0.0022 + waveIndex * 0.0005));
        ctx.beginPath();
        const step = Math.max(10, width / 56);
        for (let x = 0; x <= width; x += step) {
          const ratio = width > 0 ? x / width : 0;
          const y =
            base +
            Math.sin(
              ratio * Math.PI * 2 * frequency +
                nowSec * speed +
                waveIndex * 2.1,
            ) * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Блики: короткие светлые штрихи, качаются на волне.
      const glints = Math.round(clamp(width / 120, 6, 18));
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = Math.max(1, height * 0.002);
      for (let i = 0; i < glints; i += 1) {
        const gx = pseudo(i * 7.31 + 1.7) * width;
        const gy = top + bandHeight * (0.12 + pseudo(i * 2.93 + 4.1) * 0.82);
        const length = width * (0.008 + pseudo(i * 5.17) * 0.02);
        const sway = Math.sin(nowSec * 0.9 + i * 1.7) * bandHeight * 0.02;
        ctx.beginPath();
        ctx.moveTo(gx - length / 2, gy + sway);
        ctx.lineTo(gx + length / 2, gy + sway);
        ctx.stroke();
      }

      // Пена: маленькие пузырьки у поверхности.
      const foam = Math.round(clamp(width / 90, 6, 26));
      for (let i = 0; i < foam; i += 1) {
        const fx = pseudo(i * 3.71 + 2.3) * width;
        const fy = top + bandHeight * (0.025 + pseudo(i * 5.13 + 0.7) * 0.22);
        const bob = Math.sin(nowSec * 1.1 + i * 0.9) * bandHeight * 0.012;
        const alpha = 0.2 + 0.16 * Math.abs(Math.sin(nowSec * 0.7 + i));
        const radius =
          Math.max(1, bandHeight * 0.006) * (0.6 + pseudo(i * 9.1) * 1.1);
        dot(
          fx + Math.sin(nowSec * 0.4 + i * 1.7) * width * 0.006,
          fy + bob,
          radius,
          "rgba(236,250,255," + alpha + ")",
        );
      }
      ctx.globalAlpha = 1;
    }

    // ------------------------------------------------------------------
    // Геометрия корабля и подписи — из SB.Layout (единый источник правды)
    // ------------------------------------------------------------------
    function rowOf(ship) {
      return clamp(Math.floor(num(ship && ship.row, 0)), 0, 2);
    }

    function fallbackRowScale(row) {
      if (row <= 0) return 1;
      return row === 1 ? 0.84 : 0.7;
    }

    /** Единица корабля в пикселях: из Layout, иначе — как в части 1. */
    function shipUnit(ship, shipScale) {
      const row = rowOf(ship);
      const Layout = layoutApi();
      if (Layout) {
        const fromLayout = Layout.unitPx(row, shipScale, width, height);
        if (Number.isFinite(fromLayout) && fromLayout > 0) {
          // Мир части 2 всегда даёт row; если ряд не пришёл, но есть scale,
          // учитываем его как масштаб ряда (совместимость со снимками).
          const hasRow = Number.isFinite(Number(ship && ship.row));
          const scale = Number(ship && ship.scale);
          if (!hasRow && Number.isFinite(scale)) {
            const baseScale =
              typeof Layout.rowScale === "function"
                ? Layout.rowScale(row)
                : fallbackRowScale(row);
            if (baseScale > 0) {
              return fromLayout * (clamp(scale, 0.4, 1.6) / baseScale);
            }
          }
          return fromLayout;
        }
      }
      const baseUnit = Math.min(width, height) * 0.055 * shipScale;
      const scale = Number.isFinite(Number(ship && ship.scale))
        ? clamp(Number(ship.scale), 0.4, 1.6)
        : fallbackRowScale(row);
      return clamp(
        baseUnit * scale,
        8,
        Math.max(12, Math.min(width, height) * 0.16),
      );
    }

    /** Запасная подпись, если js/layout.js ещё не подключён (старая страница). */
    function fallbackLabel(ship, unit, seaHeight) {
      const cx = clamp(num(ship.x, 0.5), 0, 1) * width;
      const py = clamp(num(ship.y, 0.8), 0, 1) * height;
      const font = Math.round(clamp(unit * 0.3, 12, 24));
      const nameBaseline = py - unit * 3.0;
      const heartsY = nameBaseline + font * 1.35;
      const heartSize = unit * 0.17;
      const name = textOf(ship.name) || textOf(ship.user);
      const nameWidth = Array.from(name).length * font * 0.55;
      const rectWidth = Math.max(nameWidth, unit * 0.72) + unit * 0.3;
      const top = nameBaseline - font * 0.85;
      return {
        row: rowOf(ship),
        unit: unit,
        font: font,
        x: cx,
        nameX: cx,
        nameBaseline: nameBaseline,
        heartsX: cx,
        heartsY: heartsY,
        heartSize: heartSize,
        crownX: cx,
        crownBase: nameBaseline - font * 0.95,
        rect: {
          x: cx - rectWidth / 2,
          y: top,
          w: rectWidth,
          h: heartsY + heartSize - top,
        },
        seaTop: (1 - clamp(num(seaHeight, 0.3), 0, 1)) * height,
      };
    }

    /** Геометрия подписи: имя, под ним сердечки, над именем корона. */
    function labelFor(ship, shipScale, seaHeight) {
      const Layout = layoutApi();
      if (Layout && typeof Layout.labelLayout === "function") {
        try {
          const fromLayout = Layout.labelLayout(ship, {
            width: width,
            height: height,
            shipScale: shipScale,
            seaHeight: seaHeight,
          });
          if (
            fromLayout &&
            Number.isFinite(fromLayout.nameBaseline) &&
            Number.isFinite(fromLayout.font) &&
            Number.isFinite(fromLayout.unit)
          ) {
            return fromLayout;
          }
        } catch (error) {
          // Кривой снимок — ниже нарисуем запасную подпись.
        }
      }
      return fallbackLabel(ship, shipUnit(ship, shipScale), seaHeight);
    }

    // ------------------------------------------------------------------
    // Сердца и корона
    // ------------------------------------------------------------------
    function heartPath(cx, cy, size) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + size * 0.55);
      ctx.bezierCurveTo(
        cx - size * 1.25, cy - size * 0.25,
        cx - size * 0.55, cy - size * 1.05,
        cx, cy - size * 0.35,
      );
      ctx.bezierCurveTo(
        cx + size * 0.55, cy - size * 1.05,
        cx + size * 1.25, cy - size * 0.25,
        cx, cy + size * 0.55,
      );
      ctx.closePath();
    }

    function drawHearts(label, ship, alpha, shakeX, yOffset) {
      const maxHp = Math.round(clamp(num(ship.maxHp, 3), 1, 5));
      const hp = Math.round(clamp(num(ship.hp, maxHp), 0, maxHp));
      const unit = Math.max(1, num(label.unit, 20));
      // Сердечки — под именем, внутри отведённого Layout прямоугольника:
      // ряд из maxHp штук с шагом около 0.2 единицы корабля.
      const size = Math.max(2.5, num(label.heartSize, unit * 0.17) * 0.78);
      const step = Math.max(size * 2.1, unit * 0.2);
      const cy = num(label.heartsY, 0) + yOffset + size * 0.55;
      const startX =
        num(label.heartsX, 0) + shakeX - ((maxHp - 1) * step) / 2;
      for (let i = 0; i < maxHp; i += 1) {
        heartPath(startX + i * step, cy, size);
        ctx.globalAlpha = alpha;
        if (i < hp) {
          ctx.fillStyle = HEART_COLOR;
          ctx.fill();
          ctx.strokeStyle = OUTLINE_COLOR;
          ctx.lineWidth = Math.max(1.5, size * 0.35);
          ctx.stroke();
        } else {
          // Потерянная прочность — только контур.
          ctx.globalAlpha = alpha * 0.8;
          ctx.strokeStyle = "rgba(214,229,240,0.85)";
          ctx.lineWidth = Math.max(1.3, size * 0.3);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawCrown(label, unit, font, alpha, shakeX, yOffset) {
      // Крупная корона: высота не меньше unit*0.9 (требование договора).
      const crownHeight = Math.max(unit * 0.9, font * 1.2);
      const crownWidth = Math.max(crownHeight * 0.95, unit * 0.9);
      const cx = num(label.crownX, num(label.nameX, 0)) + shakeX;
      // Чуть отступаем от верхушки букв, чтобы корона не касалась текста.
      let baseY = num(label.crownBase, 0) + yOffset - font * 0.12;
      if (Number.isFinite(label.nameBaseline)) {
        baseY = Math.min(baseY, label.nameBaseline - font * 1.05);
      }
      baseY = Math.max(baseY, crownHeight + 2);

      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.beginPath();
      ctx.moveTo(cx - crownWidth / 2, baseY);
      ctx.lineTo(cx - crownWidth / 2, baseY - crownHeight * 0.55);
      ctx.lineTo(cx - crownWidth * 0.24, baseY - crownHeight * 0.18);
      ctx.lineTo(cx, baseY - crownHeight);
      ctx.lineTo(cx + crownWidth * 0.24, baseY - crownHeight * 0.18);
      ctx.lineTo(cx + crownWidth / 2, baseY - crownHeight * 0.55);
      ctx.lineTo(cx + crownWidth / 2, baseY);
      ctx.closePath();
      ctx.fillStyle = CROWN_COLOR;
      ctx.fill();
      ctx.lineWidth = Math.max(2, unit * 0.06);
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
      // Шарики на зубцах — как у большой короны.
      const dotRadius = Math.max(2, unit * 0.075);
      dot(cx - crownWidth / 2, baseY - crownHeight * 0.55, dotRadius, "#fff0b8");
      dot(cx, baseY - crownHeight, dotRadius, "#fff0b8");
      dot(cx + crownWidth / 2, baseY - crownHeight * 0.55, dotRadius, "#fff0b8");
      ctx.globalAlpha = 1;
    }

    // ------------------------------------------------------------------
    // Корабли
    // ------------------------------------------------------------------
    function drawShip(ship, frame, seaHeight, shipScale, nowSec) {
      if (!isObject(ship)) return;
      const label = labelFor(ship, shipScale, seaHeight);
      const unit = Number.isFinite(label.unit) ? label.unit : shipUnit(ship, shipScale);
      const state = textOf(ship.state);
      const sinking = state === "sinking";
      const leaving = state === "leaving";
      const progress = sinking ? clamp(num(ship.sinkProgress, 0), 0, 1) : 0;
      const phase = num(ship.phase, 0);
      // Качка: медленная синусоида от времени кадра и фазы корабля.
      const rock = Math.sin(
        (nowSec * Math.PI * 2 * 0.12) + phase * Math.PI * 2,
      );
      // Тряска от попадания: смещает и корабль, и подпись вместе с ним.
      const shake = clamp(num(ship.shake, 0), 0, 1);
      const shakeX = Math.sin(nowSec * Math.PI * 2 * 9) * unit * 0.12 * shake;
      const dir = num(ship.dir, 1) < 0 ? -1 : 1;
      const baseX = clamp(num(ship.x, 0.5), 0, 1) * width;
      const baseY = clamp(num(ship.y, 0.82), 0, 1) * height;
      const px = baseX + shakeX;
      const py = baseY;
      const color = colorOr(ship.color, "#8fd8ff");
      const alpha = sinking
        ? clamp(1 - progress * 0.85, 0.12, 1)
        : leaving
          ? 0.92
          : 1;
      const drop = sinking ? progress * unit * 2.2 : 0;
      const yOffset = drop + rock * unit * 0.08;

      // Тень на воде — чтобы корабль не «висел» в воздухе.
      ctx.save();
      ctx.globalAlpha = 0.22 * alpha;
      ellipsePath(px, py + unit * 0.32 + drop, unit * 1.15, unit * 0.22);
      ctx.fillStyle = "#04202f";
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;

      // Корпус, мачта, паруса и флажок — в местных координатах корабля.
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py + drop + rock * unit * 0.05);
      ctx.rotate(rock * 0.06);
      ctx.scale(dir, 1);

      ctx.beginPath();
      ctx.moveTo(-1.15 * unit, -0.05 * unit);
      ctx.quadraticCurveTo(-1.05 * unit, 0.32 * unit, -0.6 * unit, 0.4 * unit);
      ctx.lineTo(0.6 * unit, 0.4 * unit);
      ctx.quadraticCurveTo(1.05 * unit, 0.32 * unit, 1.15 * unit, -0.05 * unit);
      ctx.quadraticCurveTo(0.85 * unit, -0.22 * unit, 0.35 * unit, -0.24 * unit);
      ctx.lineTo(-0.35 * unit, -0.24 * unit);
      ctx.quadraticCurveTo(-0.85 * unit, -0.22 * unit, -1.15 * unit, -0.05 * unit);
      ctx.closePath();
      ctx.fillStyle = HULL_COLOR;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, unit * 0.045);
      ctx.strokeStyle = HULL_DARK;
      ctx.stroke();

      // Палуба.
      ctx.beginPath();
      ctx.moveTo(-0.85 * unit, -0.12 * unit);
      ctx.lineTo(0.85 * unit, -0.12 * unit);
      ctx.strokeStyle = "rgba(232,220,196,0.4)";
      ctx.lineWidth = Math.max(1, unit * 0.03);
      ctx.stroke();

      // Мачта.
      ctx.strokeStyle = MAST_COLOR;
      ctx.lineWidth = Math.max(1.5, unit * 0.07);
      ctx.beginPath();
      ctx.moveTo(0, -0.22 * unit);
      ctx.lineTo(0, -1.9 * unit);
      ctx.stroke();

      // Большой парус — цветом ника (уже осветлённым в colors.js).
      ctx.beginPath();
      ctx.moveTo(0.04 * unit, -1.75 * unit);
      ctx.quadraticCurveTo(0.85 * unit, -1.15 * unit, 0.95 * unit, -0.35 * unit);
      ctx.lineTo(0.08 * unit, -0.35 * unit);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(1, unit * 0.035);
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();

      // Малый парус (кливер) — тот же цвет, чуть прозрачнее.
      ctx.beginPath();
      ctx.moveTo(-0.05 * unit, -1.32 * unit);
      ctx.quadraticCurveTo(-0.55 * unit, -0.95 * unit, -0.8 * unit, -0.4 * unit);
      ctx.lineTo(-0.12 * unit, -0.4 * unit);
      ctx.closePath();
      ctx.fillStyle = withAlpha(color, 0.78);
      ctx.fill();
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();

      // Флажок на верхушке мачты.
      ctx.beginPath();
      ctx.moveTo(0, -2.02 * unit);
      ctx.lineTo(0.5 * unit, -1.9 * unit);
      ctx.lineTo(0, -1.78 * unit);
      ctx.closePath();
      ctx.fillStyle = FLAG_COLOR;
      ctx.fill();
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;

      // Щит — круг вокруг корабля.
      if (ship.shield) {
        ctx.save();
        ctx.globalAlpha = 0.62;
        ellipsePath(px, py - unit * 0.1 + drop, unit * 1.55, unit * 1.25);
        ctx.strokeStyle = SHIELD_COLOR;
        ctx.lineWidth = Math.max(2, unit * 0.06);
        ctx.stroke();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = SHIELD_COLOR;
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // Ник, сердца и корона — всегда вертикально, даже когда корабль качает.
      const name = textOf(ship.name) || textOf(ship.user);
      if (!name) return;
      const font = Math.round(clamp(num(label.font, unit * 0.3), 12, 30));
      const fontStyle = font + "px " + FONT_STACK;
      const nameY = num(label.nameBaseline, py - unit * 3) + yOffset;
      const textAlpha = sinking ? clamp(1 - progress * 0.6, 0.2, 1) : 0.98;
      paintText(
        name,
        num(label.nameX, baseX) + shakeX,
        nameY,
        TEXT_LIGHT,
        fontStyle,
        "center",
        clamp(Math.round(font * 0.2), 3, 5),
        textAlpha,
        "alphabetic",
      );
      drawHearts(label, ship, textAlpha, shakeX, yOffset);
      const winner = isObject(frame.round) && isObject(frame.round.winner)
        ? frame.round.winner
        : null;
      const isWinner =
        ship.crown === true ||
        (winner && textOf(winner.user) === textOf(ship.user));
      if (isWinner) {
        drawCrown(label, unit, font, textAlpha, shakeX, yOffset);
      }
    }

    // ------------------------------------------------------------------
    // Ядра: летят дугой от стрелка к цели
    // ------------------------------------------------------------------
    function drawShots(shots, shipScale) {
      const items = list(shots);
      const radius = cannonballRadius(width, height, shipScale);
      for (const shot of items) {
        if (!isObject(shot)) continue;
        const fromX = num(shot.fromX, NaN);
        const fromY = num(shot.fromY, NaN);
        const toX = num(shot.toX, NaN);
        const toY = num(shot.toY, NaN);
        const curX = num(shot.x, NaN);
        const curY = num(shot.y, NaN);
        const progress = clamp(
          num(shot.progress, Number.isFinite(curX) ? 1 : 0),
          0,
          1,
        );
        const originX = Number.isFinite(fromX)
          ? fromX
          : Number.isFinite(curX) ? curX : 0.5;
        const originY = Number.isFinite(fromY)
          ? fromY
          : Number.isFinite(curY) ? curY : 0.8;
        const targetX = Number.isFinite(toX)
          ? toX
          : Number.isFinite(curX) ? curX : originX;
        const targetY = Number.isFinite(toY)
          ? toY
          : Number.isFinite(curY) ? curY : originY;

        const ax = clamp(originX, 0, 1) * width;
        const ay = clamp(originY, 0, 1) * height;
        const bx = clamp(targetX, 0, 1) * width;
        const by = clamp(targetY, 0, 1) * height;
        // Мир поднимает ядро на 0,05 высоты кадра в середине полёта —
        // повторяем ту же дугу, чтобы след совпадал с движением мира.
        const arc = height * 0.05;

        function pointAt(t) {
          return {
            x: ax + (bx - ax) * t,
            y: ay + (by - ay) * t - Math.sin(Math.PI * t) * arc,
          };
        }

        // След полёта — часть дуги до текущего положения.
        const steps = Math.max(3, Math.round(progress * 16));
        ctx.strokeStyle = "rgba(236,247,255,0.55)";
        ctx.lineWidth = Math.max(2, radius * 0.7);
        ctx.beginPath();
        for (let i = 0; i <= steps; i += 1) {
          const t = progress * (i / steps);
          const spot = pointAt(t);
          if (i === 0) ctx.moveTo(spot.x, spot.y);
          else ctx.lineTo(spot.x, spot.y);
        }
        ctx.stroke();

        // Само ядро: берём точку из снимка (мир уже посчитал её), а если её
        // нет — точку на дуге. Тёмный кружок с обводкой и бликом.
        const spot = pointAt(progress);
        const ballX = Number.isFinite(curX) ? clamp(curX, 0, 1) * width : spot.x;
        const ballY = Number.isFinite(curY) ? clamp(curY, 0, 1) * height : spot.y;
        dot(ballX, ballY, radius, "#151b23");
        ctx.strokeStyle = "#04080d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ballX, ballY, radius, 0, Math.PI * 2);
        ctx.stroke();
        dot(
          ballX - radius * 0.32,
          ballY - radius * 0.36,
          radius * 0.38,
          "rgba(255,255,255,0.7)",
        );
        // Маленькие искры следа — ядро «летит», а не стоит.
        for (let i = 1; i <= 2; i += 1) {
          const t = Math.max(0, progress - i * 0.06);
          const tail = pointAt(t);
          dot(tail.x, tail.y, radius * (0.5 - i * 0.12), "rgba(255,255,255,0.35)");
        }
      }
    }

    // ------------------------------------------------------------------
    // Частицы: вспышка, дым, всплеск, искры, щепки, щит
    // ------------------------------------------------------------------
    function drawParticles(particles) {
      const items = list(particles);
      // Размер частицы в снимке задан для кадра 720p — на большом холсте
      // брызги должны быть заметны, на маленьком не разрастаться.
      const particleScale = clamp(height / 540, 0.8, 2.6);
      for (const particle of items) {
        if (!isObject(particle)) continue;
        const px = clamp(num(particle.x, 0.5), 0, 1) * width;
        const py = clamp(num(particle.y, 0.8), 0, 1) * height;
        const maxLife = Math.max(0.0001, num(particle.maxLife, 1));
        const life = num(particle.life, maxLife);
        if (!(life > 0)) continue; // отжившую частицу не рисуем
        const ratio = clamp(life / maxLife, 0, 1);
        const kind = textOf(particle.kind).toLowerCase();
        const color = colorOr(particle.color, "#bfe9ff");
        const size = clamp(
          num(particle.size, 3),
          0.5,
          Math.max(width, height) * 0.15,
        ) * particleScale;

        if (kind === "muzzle") {
          // Вспышка-звезда у борта: жёлтая, яркая, быстро тает.
          const outer = Math.max(4, size * 1.9) * (0.7 + ratio * 0.6);
          ctx.globalAlpha = clamp(ratio * 0.95, 0, 1);
          starPath(px, py, outer, outer * 0.34, 8, ratio * 2.4);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = "#fff6cf";
          ctx.lineWidth = Math.max(1, outer * 0.12);
          ctx.stroke();
          ctx.globalAlpha = clamp(ratio, 0, 1);
          dot(px, py, Math.max(1.5, outer * 0.28), "#fffdf2");
        } else if (kind === "smoke" || kind === "дым") {
          // Растущие серые клубы.
          const smokeRadius = size * (1.6 + (1 - ratio) * 2.6);
          ctx.globalAlpha = ratio * 0.35;
          dot(px, py, smokeRadius, color);
          ctx.globalAlpha = ratio * 0.2;
          dot(
            px + smokeRadius * 0.5,
            py - smokeRadius * 0.4,
            smokeRadius * 0.75,
            "#dfe9f2",
          );
        } else if (kind === "splash" || kind === "foam" || kind === "всплеск") {
          // Голубые капли и расходящееся кольцо.
          ctx.globalAlpha = clamp(ratio * 0.75, 0, 1);
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.5, size * 0.3);
          ctx.beginPath();
          ctx.arc(px, py, size * (1.4 + (1 - ratio) * 1.8), 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = clamp(ratio * 0.95, 0, 1);
          dot(px, py, Math.max(1.2, size * 0.55), color);
          for (let index = 0; index < 3; index += 1) {
            const angle = -1.9 + index * 0.6;
            const distance = size * (1.1 + (1 - ratio) * 1.6);
            ctx.globalAlpha = clamp(ratio * 0.6, 0, 1);
            dot(
              px + Math.cos(angle) * distance,
              py + Math.sin(angle) * distance,
              Math.max(0.8, size * 0.26),
              color,
            );
          }
        } else if (kind === "hit" || kind === "spark" || kind === "sparks") {
          // Яркие искры цвета цели.
          ctx.globalAlpha = clamp(ratio, 0, 1);
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.4, size * 0.26);
          const outer = size * (1.1 + ratio * 1.4);
          for (let index = 0; index < 6; index += 1) {
            const angle = index * (Math.PI / 3) + ratio * 1.7;
            const inner = outer * 0.28;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(angle) * inner, py + Math.sin(angle) * inner);
            ctx.lineTo(px + Math.cos(angle) * outer, py + Math.sin(angle) * outer);
            ctx.stroke();
          }
          dot(px, py, Math.max(1.2, size * 0.32), "#fffdf2");
        } else if (kind === "splinter" || kind === "щепки") {
          // Коричневые короткие линии-щепки.
          const angle = Number.isFinite(num(particle.vy, NaN))
            ? Math.atan2(num(particle.vy, 0), num(particle.vx, 0))
            : -0.7;
          const length = Math.max(3, size * (1.4 + ratio * 1.4));
          ctx.globalAlpha = clamp(ratio, 0, 1);
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.5, size * 0.24);
          for (let index = 0; index < 2; index += 1) {
            const shift = index === 0 ? 0 : length * 0.45;
            const nx = Math.cos(angle + Math.PI / 2) * shift;
            const ny = Math.sin(angle + Math.PI / 2) * shift;
            ctx.beginPath();
            ctx.moveTo(px + nx, py + ny);
            ctx.lineTo(
              px + nx + Math.cos(angle) * length,
              py + ny + Math.sin(angle) * length,
            );
            ctx.stroke();
          }
        } else if (kind === "shield") {
          // Голубое кольцо-вспышка щита.
          const shieldRadius = size * (1.5 + (1 - ratio) * 1.6);
          ring(px, py, shieldRadius, color, Math.max(2, size * 0.36), clamp(ratio * 0.85, 0, 1));
          ring(
            px,
            py,
            shieldRadius * 0.7,
            "#e6fbff",
            Math.max(1.2, size * 0.2),
            clamp(ratio * 0.45, 0, 1),
          );
          ctx.globalAlpha = clamp(ratio * 0.5, 0, 1);
          dot(px, py, Math.max(1.5, size * 0.3), color);
        } else {
          // Неизвестный вид — простая точка, как в части 1.
          ctx.globalAlpha = clamp(ratio, 0, 1);
          dot(px, py, Math.max(1, size * 0.5), color);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ------------------------------------------------------------------
    // Метки: «-1»/«щит!», стрелка стрелка и прицел
    // ------------------------------------------------------------------
    function drawLabels(labels, frame) {
      const items = list(labels);
      const now = num(frame.now, 0);
      for (const label of items) {
        if (!isObject(label)) continue;
        const until = num(label.until, Infinity);
        if (Number.isFinite(until) && now >= until) continue;
        const text = textOf(label.text);
        if (!text) continue;
        const born = num(label.born, now);
        const total = until > born ? until - born : 1;
        const life = clamp((now - born) / total, 0, 1);
        const x = clamp(num(label.x, 0.5), 0, 1) * width;
        const y = clamp(num(label.y, 0.5), 0, 1) * height;
        // Поднимается за время жизни и чуть бледнеет к концу.
        const rise = height * 0.07 * life;
        const sizeFactor = clamp(num(label.size, 1), 0.6, 2);
        const font = Math.round(
          clamp(height * 0.028 * sizeFactor, 16, 40),
        );
        const alpha = clamp(1 - life * 0.75, 0.15, 1);
        paintText(
          text,
          x,
          y - rise,
          colorOr(label.color, "#ff4d5e"),
          font + "px " + FONT_STACK,
          "center",
          clamp(Math.round(font * 0.18), 3, 6),
          alpha,
          "middle",
        );
      }
    }

    function drawShotMark(mark, x, y, size) {
      const tx = num(mark.tx, NaN);
      const targetX = Number.isFinite(tx) ? clamp(tx, 0, 1) * width : x;
      const dir = targetX >= x ? 1 : -1;
      const cy = Math.max(size * 1.2, y - size * 2);
      const chevron = function () {
        ctx.beginPath();
        ctx.moveTo(x - dir * size * 0.35, cy - size * 0.5);
        ctx.lineTo(x + dir * size * 0.55, cy);
        ctx.lineTo(x - dir * size * 0.35, cy + size * 0.5);
      };
      // Тёмная подложка, потом яркая стрелка: видно на любом фоне.
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = Math.max(3, size * 0.4);
      chevron();
      ctx.stroke();
      ctx.strokeStyle = MARK_COLOR;
      ctx.lineWidth = Math.max(1.6, size * 0.18);
      chevron();
      ctx.stroke();
      dot(x, y - size * 0.75, Math.max(2, size * 0.24), MARK_COLOR);
    }

    function drawAimMark(mark, x, y, size, nowSec) {
      const pulse = 1 + Math.sin(nowSec * Math.PI * 4) * 0.08;
      const radius = size * 1.35 * pulse;
      // Прицел: кружок с перекрестием, тёмная основа + светлая линия.
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = Math.max(2.5, size * 0.3);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.moveTo(x - radius * 1.35, y);
      ctx.lineTo(x - radius * 0.55, y);
      ctx.moveTo(x + radius * 0.55, y);
      ctx.lineTo(x + radius * 1.35, y);
      ctx.moveTo(x, y - radius * 1.35);
      ctx.lineTo(x, y - radius * 0.55);
      ctx.moveTo(x, y + radius * 0.55);
      ctx.lineTo(x, y + radius * 1.35);
      ctx.stroke();
      ctx.strokeStyle = MARK_COLOR;
      ctx.lineWidth = Math.max(1.6, size * 0.16);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.moveTo(x - radius * 1.35, y);
      ctx.lineTo(x - radius * 0.55, y);
      ctx.moveTo(x + radius * 0.55, y);
      ctx.lineTo(x + radius * 1.35, y);
      ctx.moveTo(x, y - radius * 1.35);
      ctx.lineTo(x, y - radius * 0.55);
      ctx.moveTo(x, y + radius * 0.55);
      ctx.lineTo(x, y + radius * 1.35);
      ctx.stroke();
    }

    function drawMarks(marks, frame) {
      const items = list(marks);
      const now = num(frame.now, 0);
      const size = clamp(Math.min(width, height) * 0.014, 8, 22);
      for (const mark of items) {
        if (!isObject(mark)) continue;
        const until = num(mark.until, Infinity);
        if (Number.isFinite(until) && now >= until) continue;
        const kind = textOf(mark.kind);
        const x = clamp(num(mark.x, 0.5), 0, 1) * width;
        const y = clamp(num(mark.y, 0.8), 0, 1) * height;
        if (kind === "shot") drawShotMark(mark, x, y, size);
        else if (kind === "aim") drawAimMark(mark, x, y, size, now / 1000);
      }
    }

    // ------------------------------------------------------------------
    // Таблица лучших капитанов
    // ------------------------------------------------------------------
    function leaderboardBox(frame, lang) {
      if (!frame.leaderboardOn) return null;
      const entries = list(frame.leaderboard)
        .filter(function (entry) {
          return isObject(entry) && (textOf(entry.name) || textOf(entry.user));
        })
        .slice(0, 5);
      if (!entries.length) return null;
      const margin = Math.max(8, Math.round(width * 0.018));
      const titleFont = Math.round(clamp(width * 0.014, 13, 24));
      const rowFont = Math.round(clamp(width * 0.013, 12, 22));
      const padding = Math.max(8, Math.round(rowFont * 0.7));
      const boxWidth = clamp(Math.round(width * 0.21), 150, 320);
      const rowHeight = Math.round(rowFont * 1.55);
      const boxHeight =
        padding * 2 + Math.round(titleFont * 1.6) + entries.length * rowHeight;
      return {
        x: width - margin - boxWidth,
        y: margin,
        w: boxWidth,
        h: boxHeight,
        margin: margin,
        padding: padding,
        titleFont: titleFont,
        rowFont: rowFont,
        rowHeight: rowHeight,
        title: lang === "en" ? "Best captains" : "Лучшие капитаны",
        entries: entries,
      };
    }

    function drawLeaderboard(box) {
      paintPanel(
        box.x, box.y, box.w, box.h,
        Math.max(6, Math.round(box.rowFont * 0.5)),
        "rgba(5,18,33,0.62)",
        "rgba(150,215,255,0.55)",
        1.5,
      );

      const titleFont = "600 " + box.titleFont + "px " + FONT_STACK;
      paintText(
        box.title,
        box.x + box.w / 2,
        box.y + box.padding + box.titleFont * 0.55,
        TEXT_GOLD,
        titleFont,
        "center",
        3,
      );

      const top = box.y + box.padding + box.titleFont * 1.35;
      // Тонкая черта под заголовком.
      ctx.strokeStyle = "rgba(150,215,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(box.x + box.padding, top - box.rowHeight * 0.12);
      ctx.lineTo(box.x + box.w - box.padding, top - box.rowHeight * 0.12);
      ctx.stroke();

      const rowFont = box.rowFont + "px " + FONT_STACK;
      const rankWidth = box.rowFont * 1.7;
      const winsWidth = box.rowFont * 2.3;
      const nameX = box.x + box.padding + rankWidth;
      const nameMax = box.w - box.padding * 2 - rankWidth - winsWidth;
      for (let i = 0; i < box.entries.length; i += 1) {
        const entry = box.entries[i];
        const centerY = top + box.rowHeight * (i + 0.5);
        const name = textOf(entry.name) || textOf(entry.user) || "—";
        const wins = Math.round(num(entry.wins, 0));
        paintText(
          (i + 1) + ".",
          box.x + box.padding,
          centerY,
          i === 0 ? TEXT_GOLD : TEXT_LIGHT,
          rowFont,
          "left",
          3,
        );
        paintText(
          fitText(name, nameMax, rowFont),
          nameX,
          centerY,
          TEXT_LIGHT,
          rowFont,
          "left",
          3,
        );
        paintText(
          String(wins),
          box.x + box.w - box.padding,
          centerY,
          TEXT_BLUE,
          rowFont,
          "right",
          3,
        );
      }
    }

    function drawQueue(frame, lang, box) {
      const count = Math.floor(clamp(num(frame.queue, 0), 0, 9999));
      if (!(count > 0)) return;
      const margin = box ? box.margin : Math.max(8, Math.round(width * 0.018));
      const font = Math.round(clamp(width * 0.012, 12, 20));
      const text =
        lang === "en" ? "+" + count + " in queue" : "+" + count + " в очереди";
      const y = box ? box.y + box.h + font * 1.1 : margin + font * 0.9;
      paintText(
        text,
        width - margin,
        y,
        "#d7ecff",
        font + "px " + FONT_STACK,
        "right",
        3,
      );
    }

    function drawDrowned(frame, lang) {
      const names = list(frame.drowned)
        .map(function (item) {
          if (isObject(item)) return textOf(item.name) || textOf(item.user);
          return textOf(item);
        })
        .filter(function (name) {
          return Boolean(name);
        });
      if (!names.length) return;
      const font = Math.round(clamp(width * 0.012, 12, 20));
      const margin = Math.max(8, Math.round(width * 0.018));
      const prefix = lang === "en" ? "at the bottom: " : "на дне: ";
      const value = fitText(
        prefix + names.join(", "),
        width - margin * 2,
        font + "px " + FONT_STACK,
      );
      paintText(
        value,
        margin,
        height - margin - font * 0.5,
        TEXT_GREY,
        font + "px " + FONT_STACK,
        "left",
        3,
      );
    }

    // ------------------------------------------------------------------
    // Крупный баннер победителя и пауза
    // ------------------------------------------------------------------
    function drawBanner(frame, lang, seaHeight) {
      const round = isObject(frame.round) ? frame.round : null;
      if (!round || !isObject(round.banner)) return;
      const banner = round.banner;
      const text = textOf(banner.text);
      if (!text) return;
      // Сравнение с frame.now: после banner.until надписи уже нет.
      const until = num(banner.until, Infinity);
      const now = num(frame.now, 0);
      if (Number.isFinite(until) && now >= until) return;

      const font = Math.round(clamp(height * 0.045, 24, 64));
      const fontStyle = "600 " + font + "px " + FONT_STACK;
      const margin = Math.max(8, Math.round(width * 0.018));
      const boxWidth = clamp(
        measureText(text, fontStyle) + font * 1.8,
        font * 3,
        width - margin * 2,
      );
      const boxHeight = font * 1.8;
      const seaTop = (1 - clamp(num(seaHeight, 0.3), 0, 1)) * height;
      // Баннер висит по центру над морем: его середина — у линии воды.
      // Ниже имени победителя, чтобы подпись не перекрывалась.
      const centerY = clamp(
        seaTop,
        margin + boxHeight / 2,
        Math.max(margin + boxHeight / 2, height - margin - boxHeight / 2),
      );
      const y = centerY - boxHeight / 2;
      const x = (width - boxWidth) / 2;
      paintPanel(
        x, y, boxWidth, boxHeight,
        boxHeight * 0.4,
        "rgba(4,16,30,0.72)",
        "rgba(255,218,140,0.72)",
        2.5,
      );
      paintText(
        fitText(text, boxWidth - font * 0.9, fontStyle),
        width / 2,
        y + boxHeight / 2,
        TEXT_GOLD,
        fontStyle,
        "center",
        clamp(Math.round(font * 0.12), 4, 7),
      );
    }

    function drawPause(frame, lang) {
      if (!frame.paused) return;
      const font = Math.round(clamp(width * 0.013, 12, 20));
      const fontStyle = "600 " + font + "px " + FONT_STACK;
      const margin = Math.max(8, Math.round(width * 0.018));
      const text = lang === "en" ? "Paused" : "Пауза";
      const boxWidth = measureText(text, fontStyle) + font * 1.2;
      const boxHeight = font * 1.9;
      paintPanel(
        margin, margin, boxWidth, boxHeight,
        boxHeight * 0.5,
        "rgba(5,18,33,0.5)",
        "rgba(160,220,255,0.45)",
        1.5,
      );
      paintText(
        text,
        margin + boxWidth / 2,
        margin + boxHeight / 2,
        "#e8f6ff",
        fontStyle,
        "center",
        3,
      );
    }

    // ------------------------------------------------------------------
    // Размеры холста
    // ------------------------------------------------------------------
    function resize() {
      dpr = resolveDpr();
      const clientWidth = positive(canvas.clientWidth);
      const clientHeight = positive(canvas.clientHeight);
      if (clientWidth > 0) width = clientWidth;
      if (clientHeight > 0) height = clientHeight;
      width = Math.max(1, Math.round(width));
      height = Math.max(1, Math.round(height));

      // Задний буфер — с учётом плотности устройства.
      const backingWidth = Math.max(1, Math.round(width * dpr));
      const backingHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      if (explicitSize && canvas.style && typeof canvas.style === "object") {
        try {
          canvas.style.width = width + "px";
          canvas.style.height = height + "px";
        } catch (error) {
          // Поддельный холст может запрещать style — не беда.
        }
      }
      if (typeof ctx.setTransform === "function") {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return { width: width, height: height, devicePixelRatio: dpr };
    }

    function clear() {
      resetState();
      if (typeof ctx.clearRect === "function") {
        ctx.clearRect(0, 0, width, height);
      }
    }

    // ------------------------------------------------------------------
    // Один кадр
    // ------------------------------------------------------------------
    function draw(frame) {
      const snapshot = isObject(frame) ? frame : {};
      const nowSec = Math.max(0, num(snapshot.now, 0)) / 1000;
      const seaHeight = clamp(num(snapshot.seaHeight, 0.3), 0, 1);
      const theme = snapshot.theme === "none" ? "none" : "sea";
      const lang = snapshot.lang === "en" ? "en" : "ru";
      const shipScale = clamp(num(snapshot.shipScale, 1), 0.2, 4);

      resetState();
      // Главное правило прозрачности: сначала стереть весь кадр.
      if (typeof ctx.clearRect === "function") {
        ctx.clearRect(0, 0, width, height);
      }

      if (theme === "sea") drawWater(nowSec, seaHeight);

      // Дальние ряды — раньше: передние корабли перекрывают задние.
      const ships = list(snapshot.ships)
        .filter(isObject)
        .slice()
        .sort(function (a, b) {
          return rowOf(b) - rowOf(a) || num(a.y, 0) - num(b.y, 0);
        });
      for (const ship of ships) {
        drawShip(ship, snapshot, seaHeight, shipScale, nowSec);
      }

      drawMarks(snapshot.marks, snapshot);
      drawShots(snapshot.shots, shipScale);
      drawParticles(snapshot.particles);
      drawLabels(snapshot.labels, snapshot);

      const box = leaderboardBox(snapshot, lang);
      if (box) drawLeaderboard(box);
      drawQueue(snapshot, lang, box);
      drawDrowned(snapshot, lang);
      drawBanner(snapshot, lang, seaHeight);
      drawPause(snapshot, lang);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
    }

    // Начальный размер: на странице холст растянут CSS, в тестах —
    // берём canvas.width/height (clientWidth там нет).
    resize();

    return {
      canvas: canvas,
      ctx: ctx,
      draw: draw,
      resize: resize,
      clear: clear,
      get width() {
        return width;
      },
      get height() {
        return height;
      },
      get devicePixelRatio() {
        return dpr;
      },
    };
  }

  SB.Render = {
    SEA_ALPHA: SEA_ALPHA,
    CANNONBALL_MIN: CANNONBALL_MIN,
    CANNONBALL_MAX: CANNONBALL_MAX,
    cannonballRadius: cannonballRadius,
    create: create,
  };
})(typeof window !== "undefined" ? window : globalThis);
