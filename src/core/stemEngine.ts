/**
 * stemEngine.ts
 * Математическое ядро, параметризация и топология форштевня судна в ДП (Y = 0).
 */

export interface Point2D {
  x: number;
  z: number;
}

export interface StemTopologyPoints {
  PT_STEM_DECK: Point2D;
  CTRL_STEM_UPPER: Point2D;
  PT_STEM_KNUCKLE: Point2D;
  PT_STEM_DWL: Point2D;
  CTRL_STEM_BULB_UPPER: Point2D;
  PT_BULB_APEX: Point2D;
  CTRL_STEM_BULB_LOWER: Point2D;
  PT_FOREFOOT: Point2D;
  PT_KEEL_TANGENT: Point2D;
}

export type StemPointKey = keyof StemTopologyPoints;

export interface StemProfileParams {
  // Выше КВЛ (Z in [T, H])
  stemRakeAngle: number;        // alpha_rake in degrees [-45 .. +60] (общий угол наклона форштевня)
  deckTangentAngle?: number;    // alpha_deck in degrees [-110 .. +110] (угол касательной сплайна у палубы с расширенным диапазоном)
  stemAboveCurvature: number;   // k_above [-1.0 .. +1.0] (прогиб клипера / серповидность)
  knuckleHeightRatio: number;   // eta_knuckle [0.1 .. 0.9] (положение кнакла по высоте)
  knuckleOffset: number;        // Delta X_knuckle [-5.0 .. +5.0] м (вынос точки излома)
  deckOverhang: number;         // L_overhang [-3.0 .. +10.0] м (доп. свес/вылет палубы вперед/назад)
  deckHeightOffset?: number;    // Delta Z_deck [-3.0 .. +5.0] м (смещение высоты носовой палубы вверх/вниз)

  // Ниже КВЛ (Z in [0, T])
  bulbLength: number;           // L_bulb [-10.0 .. +15.0] м (вылет бульба вперед)
  bulbHeightRatio: number;      // zeta_bulb_height [0.1 .. 0.95] (высота носка бульба)
  bulbFullness: number;         // C_bulb_prof [0.1 .. 1.0] (полнота капли бульба)
  bulbUpperTangentAngle?: number; // alpha_bulb_up in degrees [-110 .. +110] (угол касательной верхней дуги бульба от носка к КВЛ)
  bulbLowerTangentAngle?: number; // alpha_bulb_low in degrees [-110 .. +110] (угол касательной нижней дуги бульба от носка к пятке)
  stemEntryAngleBelow: number;  // beta_stem_entry in degrees [15 .. 90] (ледовый угол / наклон)
  forefootRadius: number;       // R_forefoot [0.0 .. 15.0] м (радиус подзора / пятки)
  forefootHeightRatio?: number; // zeta_forefoot [0.0 .. 0.85] (высота пятки относительно осадки T)
  keelTransitionLength: number; // L_keel_run [1.0 .. 30.0] м (длина сопряжения с килем)
  bulbContinuityG1: boolean;    // G1 непрерывность на КВЛ (иначе G0 угол)
  undercutFactor?: number;      // коэффициент подсечки подзора (default 0.25 .. 0.5)

  // Ручные смещения точек при прямом редактировании в 2D/3D (опционально)
  customPointOverrides?: Partial<Record<StemPointKey, Point2D>>;
}

export interface StemPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  params: Partial<StemProfileParams>;
}

export const STEM_PRESETS: StemPreset[] = [
  {
    id: 'bulbous_bow',
    name: 'Танкер / Балкер (Bulbous Bow)',
    category: 'Коммерческий флот',
    description: 'Каплевидный носовой бульб для снижения волнового сопротивления водоизмещающих судов.',
    params: {
      stemRakeAngle: 18,
      stemAboveCurvature: 0.05,
      knuckleHeightRatio: 0.5,
      knuckleOffset: 0.0,
      deckOverhang: 0.5,
      bulbLength: 6.0,
      bulbHeightRatio: 0.48,
      bulbFullness: 0.75,
      stemEntryAngleBelow: 85,
      forefootRadius: 2.0,
      keelTransitionLength: 6.0,
      bulbContinuityG1: false,
    }
  },
  {
    id: 'ice_bow',
    name: 'Ледокол (Spoon / Ice Bow)',
    category: 'Специальный флот',
    description: 'Ложкообразный форштевень с пологим углом для наползания корпуса на ледяные поля.',
    params: {
      stemRakeAngle: 30,
      stemAboveCurvature: -0.15,
      knuckleHeightRatio: 0.4,
      knuckleOffset: 0.8,
      deckOverhang: 0.2,
      bulbLength: -1.5,
      bulbHeightRatio: 0.35,
      bulbFullness: 0.3,
      stemEntryAngleBelow: 26,
      forefootRadius: 10.0,
      keelTransitionLength: 12.0,
      bulbContinuityG1: true,
    }
  },
  {
    id: 'x_bow',
    name: 'Инверсный нос (Ulstein X-Bow)',
    category: 'Офшорные суда',
    description: 'Инверсный штевень с обратным наклоном, устраняющий слеминг на встречном волнении.',
    params: {
      stemRakeAngle: -25,
      stemAboveCurvature: -0.4,
      knuckleHeightRatio: 0.65,
      knuckleOffset: -0.5,
      deckOverhang: -1.2,
      bulbLength: 2.2,
      bulbHeightRatio: 0.85,
      bulbFullness: 0.8,
      stemEntryAngleBelow: 52,
      forefootRadius: 4.5,
      keelTransitionLength: 8.0,
      bulbContinuityG1: true,
    }
  },
  {
    id: 'axe_bow',
    name: 'Топорообразный нос (Axe Bow)',
    category: 'Скоростные патрульные',
    description: 'Строго вертикальный глубокий форштевень типа «топор» для прорезания волны без ударов.',
    params: {
      stemRakeAngle: 0,
      stemAboveCurvature: 0.0,
      knuckleHeightRatio: 0.5,
      knuckleOffset: 0.0,
      deckOverhang: 0.0,
      bulbLength: 0.0,
      bulbHeightRatio: 0.5,
      bulbFullness: 0.2,
      stemEntryAngleBelow: 90,
      forefootRadius: 0.3,
      keelTransitionLength: 3.0,
      bulbContinuityG1: true,
    }
  },
  {
    id: 'clipper_bow',
    name: 'Клиперский нос (Clipper / Yacht)',
    category: 'Парусники и Суперъяхты',
    description: 'Классический серповидный прогиб с большим развалом и изящным вылетом планширя.',
    params: {
      stemRakeAngle: 42,
      stemAboveCurvature: 0.45,
      knuckleHeightRatio: 0.45,
      knuckleOffset: -0.8,
      deckOverhang: 3.5,
      bulbLength: 0.0,
      bulbHeightRatio: 0.5,
      bulbFullness: 0.2,
      stemEntryAngleBelow: 58,
      forefootRadius: 3.5,
      keelTransitionLength: 5.0,
      bulbContinuityG1: true,
    }
  },
  {
    id: 'deep_v_foot',
    name: 'Скоростной катер (Deep-V Foot)',
    category: 'Маломерные суда',
    description: 'Острый наклонный форштевень с минимальным радиусом сопряжения с килем.',
    params: {
      stemRakeAngle: 26,
      stemAboveCurvature: 0.1,
      knuckleHeightRatio: 0.5,
      knuckleOffset: 0.0,
      deckOverhang: 0.8,
      bulbLength: 0.0,
      bulbHeightRatio: 0.4,
      bulbFullness: 0.2,
      stemEntryAngleBelow: 45,
      forefootRadius: 0.1,
      keelTransitionLength: 2.0,
      bulbContinuityG1: true,
    }
  }
];

export const DEFAULT_STEM_PARAMS: StemProfileParams = {
  stemRakeAngle: 16,
  deckTangentAngle: 18,
  stemAboveCurvature: 0.08,
  knuckleHeightRatio: 0.5,
  knuckleOffset: 0.0,
  deckOverhang: 0.6,
  deckHeightOffset: 0.0,
  bulbLength: 4.5,
  bulbHeightRatio: 0.48,
  bulbFullness: 0.65,
  bulbUpperTangentAngle: 55,
  bulbLowerTangentAngle: 55,
  stemEntryAngleBelow: 80,
  forefootRadius: 1.8,
  forefootHeightRatio: 0.0,
  keelTransitionLength: 5.0,
  bulbContinuityG1: false,
};

/**
 * Расчет топологических ключевых и контрольных точек форштевня (9 точек)
 * Точки положения (PT_STEM_DECK, PT_STEM_KNUCKLE, PT_BULB_APEX, PT_FOREFOOT, PT_KEEL_TANGENT)
 * работают как контрольные точки сплайна (как на верхней палубе).
 * @param params Параметры форштевня
 * @param T Осадка судна (КВЛ, Z = T)
 * @param H Высота борта в носу (Палуба, Z = H)
 */
export function calculateStemTopologyPoints(
  params: StemProfileParams,
  T: number,
  H: number,
  bowLength?: number
): StemTopologyPoints {
  const p = { ...DEFAULT_STEM_PARAMS, ...(params || {}) };
  const safeT = Math.max(0.5, Number.isFinite(T) ? T : 4.5);
  const safeH = Math.max(safeT + 0.2, Number.isFinite(H) ? H : 9.0);

  const rakeAngle = Number.isFinite(p.stemRakeAngle) ? p.stemRakeAngle : 16;
  const rakeRad = (rakeAngle * Math.PI) / 180;
  const entryAngle = Number.isFinite(p.stemEntryAngleBelow) ? p.stemEntryAngleBelow : 80;
  const entryRad = (entryAngle * Math.PI) / 180;

  // 1. Управляющая точка палубы (PT_STEM_DECK)
  const deckHeightOffset = Number.isFinite(p.deckHeightOffset) ? p.deckHeightOffset! : 0;
  const Z_deck = Math.max(safeT + 0.1, safeH + deckHeightOffset);
  const freeboard = Math.max(0.1, Z_deck - safeT); // Z_deck - T
  const deckOverhang = Number.isFinite(p.deckOverhang) ? p.deckOverhang! : 0;
  const X_deck = freeboard * Math.tan(rakeRad) + deckOverhang;

  // 2. Управляющая точка излома/прогиба (PT_STEM_KNUCKLE)
  const knuckleRatio = Number.isFinite(p.knuckleHeightRatio) ? p.knuckleHeightRatio : 0.5;
  const eta = Math.min(0.95, Math.max(0.05, knuckleRatio));
  const Z_knuckle = safeT + freeboard * eta;
  const chordX_knuckle = (Z_knuckle - safeT) * Math.tan(rakeRad);
  const curvature = Number.isFinite(p.stemAboveCurvature) ? p.stemAboveCurvature : 0.08;
  const curvDeltaX = -curvature * freeboard * 0.35 * Math.sin(Math.PI * eta);
  const knuckleOffset = Number.isFinite(p.knuckleOffset) ? p.knuckleOffset : 0;
  const X_knuckle = chordX_knuckle + knuckleOffset + curvDeltaX;

  // 3. Управляющая точка касательной палубы (CTRL_STEM_UPPER):
  // Управляет направлением/углом касательной сплайна форштевня у палубы
  const tangentAngle = Number.isFinite(p.deckTangentAngle)
    ? p.deckTangentAngle!
    : (rakeAngle + curvature * 25);
  const tanRad = (tangentAngle * Math.PI) / 180;
  const upperSpan = Math.max(0.3, Z_deck - Z_knuckle);
  const armLength = Math.max(0.4, Math.min(freeboard * 0.8, upperSpan * 0.5));
  const X_c_up = X_deck - armLength * Math.sin(tanRad);
  const Z_c_up = Z_deck - armLength * Math.cos(tanRad);

  // 4. Управляющая точка вершины бульба / носка форштевня (PT_BULB_APEX)
  // Поддерживает как положительный вылет (бульб), так и отрицательный (ледокольная ложка / наклонный форштевень)
  const bulbHeightRatio = Number.isFinite(p.bulbHeightRatio) ? p.bulbHeightRatio : 0.48;
  const zeta = Math.min(0.95, Math.max(0.05, bulbHeightRatio));
  const Z_bulb = safeT * zeta;
  const X_bulb_max = Math.max(-6.0, Math.min(6.0, Number.isFinite(p.bulbLength) ? p.bulbLength : 4.5));

  // 5. Управляющая точка верхней касательной бульба (CTRL_STEM_BULB_UPPER) между КВЛ (0, safeT) и носком бульба
  const spanUpX = 0 - X_bulb_max;
  const spanUpZ = safeT - Z_bulb;
  const chordUpLen = Math.hypot(spanUpX, spanUpZ);
  const baseAngleUpDeg = (Math.atan2(spanUpX, spanUpZ) * 180) / Math.PI;
  const upperBulbAngle = Number.isFinite(p.bulbUpperTangentAngle)
    ? p.bulbUpperTangentAngle!
    : (baseAngleUpDeg + (p.bulbFullness - 0.5) * 40);
  const radUp = (upperBulbAngle * Math.PI) / 180;
  const armUpLen = Math.max(0.3, chordUpLen * (0.35 + (p.bulbFullness ?? 0.65) * 0.25));
  const X_c_bulb_up = X_bulb_max + armUpLen * Math.sin(radUp);
  const Z_c_bulb_up = Z_bulb + armUpLen * Math.cos(radUp);

  // 6. Управляющая точка подзора / пятки (PT_FOREFOOT)
  // Точка пятки управляет положением и скруглением перехода от носка/форштевня к килю (свободное перемещение по X и Z).
  // Точка Пятка априори должна иметь Z = 0.0 (на линии киля), после чего оператор может её свободно корректировать.
  const forefootRadius = Number.isFinite(p.forefootRadius) ? p.forefootRadius : 1.8;
  const R_foot = Math.max(0.0, forefootRadius);
  const k_undercut = Number.isFinite(p.undercutFactor) ? p.undercutFactor! : 0.35;
  const X_foot_base = X_bulb_max > 0 ? X_bulb_max * k_undercut : X_bulb_max;
  const X_foot = X_foot_base - R_foot;
  const footZRatio = Number.isFinite(p.forefootHeightRatio)
    ? Math.max(0.0, Math.min(0.85, p.forefootHeightRatio!))
    : 0.0;
  const Z_foot = safeT * footZRatio;

  // 7. Управляющая точка нижней касательной бульба (CTRL_STEM_BULB_LOWER) между носком бульба и пяткой
  const spanDownX = X_foot - X_bulb_max;
  const spanDownZ = Z_foot - Z_bulb;
  const chordDownLen = Math.hypot(spanDownX, spanDownZ);
  const baseAngleDownDeg = (Math.atan2(spanDownX, -spanDownZ) * 180) / Math.PI;
  const lowerBulbAngle = Number.isFinite(p.bulbLowerTangentAngle)
    ? p.bulbLowerTangentAngle!
    : (baseAngleDownDeg - (p.bulbFullness - 0.5) * 35);
  const radDown = (lowerBulbAngle * Math.PI) / 180;
  const armDownLen = Math.max(0.3, chordDownLen * (0.35 + (p.bulbFullness ?? 0.65) * 0.25));
  const X_c_bulb_low = X_bulb_max + armDownLen * Math.sin(radDown);
  const Z_c_bulb_low = Z_bulb - armDownLen * Math.cos(radDown);

  // 8. Управляющая точка сопряжения с килем (PT_KEEL_TANGENT) на Z = 0
  const keelLen = Number.isFinite(p.keelTransitionLength) ? p.keelTransitionLength : 5.0;
  const L_keel = Math.max(0.5, keelLen);
  let X_keel = X_foot - L_keel;
  if (bowLength !== undefined) {
    X_keel = Math.max(-bowLength, X_keel);
  }

  const points: StemTopologyPoints = {
    PT_STEM_DECK: { x: Number.isFinite(X_deck) ? X_deck : 0, z: Number.isFinite(Z_deck) ? Z_deck : safeH },
    CTRL_STEM_UPPER: { x: Number.isFinite(X_c_up) ? X_c_up : 0, z: Number.isFinite(Z_c_up) ? Z_c_up : safeH * 0.8 },
    PT_STEM_KNUCKLE: { x: Number.isFinite(X_knuckle) ? X_knuckle : 0, z: Number.isFinite(Z_knuckle) ? Z_knuckle : safeH * 0.6 },
    PT_STEM_DWL: { x: 0.0, z: safeT },
    CTRL_STEM_BULB_UPPER: { x: Number.isFinite(X_c_bulb_up) ? X_c_bulb_up : 0, z: Number.isFinite(Z_c_bulb_up) ? Z_c_bulb_up : safeT * 0.7 },
    PT_BULB_APEX: { x: Number.isFinite(X_bulb_max) ? X_bulb_max : 0, z: Number.isFinite(Z_bulb) ? Z_bulb : safeT * 0.5 },
    CTRL_STEM_BULB_LOWER: { x: Number.isFinite(X_c_bulb_low) ? X_c_bulb_low : 0, z: Number.isFinite(Z_c_bulb_low) ? Z_c_bulb_low : safeT * 0.3 },
    PT_FOREFOOT: { x: Number.isFinite(X_foot) ? X_foot : 0, z: Number.isFinite(Z_foot) ? Z_foot : 0.0 },
    PT_KEEL_TANGENT: { x: Number.isFinite(X_keel) ? X_keel : -5, z: 0.0 },
  };

  // Точка КВЛ (PT_STEM_DWL) фиксирована на X=0, Z=T (определяет длину судна по КВЛ)
  points.PT_STEM_DWL = { x: 0.0, z: safeT };

  return points;
}

/**
 * Вычисление кубической кривой Безье в 2D
 */
export function evaluateCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    z: mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z,
  };
}

/**
 * Вычисление кривой Безье 4-й степени (degree-4) в 2D по 5 управляющим точкам
 * B(t) = (1-t)^4 * p0 + 4*(1-t)^3*t * p1 + 6*(1-t)^2*t^2 * p2 + 4*(1-t)*t^3 * p3 + t^4 * p4
 */
export function evaluateDegree4Bezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const mt4 = mt3 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;

  const b0 = mt4;
  const b1 = 4 * mt3 * t;
  const b2 = 6 * mt2 * t2;
  const b3 = 4 * mt * t3;
  const b4 = t4;

  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x + b4 * p4.x,
    z: b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z + b4 * p4.z,
  };
}

/**
 * Универсальное вычисление кривой Безье произвольной степени методом де Кастельжо (de Casteljau's algorithm).
 * Обеспечивает абсолютную математическую устойчивость без деления и переполнений.
 */
export function evaluateBezier(points: Point2D[], t: number): Point2D {
  if (points.length === 0) return { x: 0, z: 0 };
  if (points.length === 1) return points[0];
  
  let pts = points;
  while (pts.length > 1) {
    const next: Point2D[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push({
        x: (1 - t) * pts[i].x + t * pts[i + 1].x,
        z: (1 - t) * pts[i].z + t * pts[i + 1].z,
      });
    }
    pts = next;
  }
  return pts[0];
}

/**
 * Дискретизация полного профиля форштевня от киля (Z=0) до палубы (Z=H).
 * Точки PT_STEM_KNUCKLE, PT_BULB_APEX и PT_FOREFOOT являются управляющими точками каркаса Безье (Control Points).
 * @param points Набор 9 топологических точек
 * @param samplesPerSegment Количество точек на сегмент кривой
 * @param bowLength Длина носовой части (для гарантированного единого охвата от стыка с миделем)
 */
export function sampleStemCurvePoints(
  points: StemTopologyPoints,
  samplesPerSegment: number = 40,
  bowLength?: number
): Point2D[] {
  // Гарантируем 100% согласованность с 3D-трубками форштевня (включая зоны бульба, пятки и киля)
  const zones = sampleStemCurveZones(points, samplesPerSegment, bowLength);
  return zones.fullCurve;
}

/**
 * Непрерывное аналитическое вычисление точки на сплайне форштевня по параметру v \in [0, 1]
 * v = 0: пятка / сопряжение с килем (PT_KEEL_TANGENT, z = 0)
 * v = 0.5: точка на ватерлинии (PT_STEM_DWL, z = T)
 * v = 1: точка на палубе (PT_STEM_DECK, z = H_deck)
 */
export function evaluateStemSplineContinuous(
  points: StemTopologyPoints,
  v: number
): Point2D {
  const clV = Math.max(0, Math.min(1, v));
  const zDeck = Math.max(0.1, points.PT_STEM_DECK.z);
  const zFoot = Math.max(0.0, points.PT_FOREFOOT.z);
  const zDwl = Math.max(zFoot + 0.1, points.PT_STEM_DWL.z);

  const vFoot = Math.max(0.01, Math.min(0.45, zFoot / zDeck));
  const vDwl = Math.max(vFoot + 0.05, Math.min(0.95, zDwl / zDeck));

  const keelSpan = points.PT_FOREFOOT.x - points.PT_KEEL_TANGENT.x;
  const ctrlKeel: Point2D = {
    x: points.PT_KEEL_TANGENT.x + Math.max(0.2, keelSpan * 0.45),
    z: 0.0,
  };

  if (clV <= vFoot) {
    const t = clV / vFoot;
    return evaluateBezier([points.PT_KEEL_TANGENT, ctrlKeel, points.PT_FOREFOOT], t);
  } else if (clV <= vDwl) {
    const t = (clV - vFoot) / (vDwl - vFoot);
    return evaluateBezier(
      [
        points.PT_FOREFOOT,
        points.CTRL_STEM_BULB_LOWER,
        points.PT_BULB_APEX,
        points.CTRL_STEM_BULB_UPPER,
        points.PT_STEM_DWL,
      ],
      t
    );
  } else {
    const t = (clV - vDwl) / (1.0 - vDwl);
    return evaluateBezier(
      [
        points.PT_STEM_DWL,
        points.PT_STEM_KNUCKLE,
        points.CTRL_STEM_UPPER,
        points.PT_STEM_DECK,
      ],
      t
    );
  }
}

export interface StemZoneDefinition {
  id: string;
  name: string;
  shortName: string;
  color2D: string;
  color3D: number;
  bgBadge: string;
  borderBadge: string;
  textBadge: string;
  rangeText: string;
  description: string;
  hydrodynamics: string;
  points: StemPointKey[];
}

export const STEM_ZONES: Record<'wavebreaker' | 'forefoot' | 'shoulder', StemZoneDefinition> = {
  wavebreaker: {
    id: 'wavebreaker',
    name: '1. Волнорезная часть',
    shortName: 'Волнорез (ПВ → КВЛ)',
    color2D: '#38bdf8', // небесно-голубой
    color3D: 0x38bdf8,
    bgBadge: 'bg-sky-500/15',
    borderBadge: 'border-sky-400/50',
    textBadge: 'text-sky-300',
    rangeText: 'От палубы (Z = H) до КВЛ (Z = T)',
    description: 'Верхняя надводная часть форштевня, разрезающая гребни встречных волн.',
    hydrodynamics: 'Обеспечивает всхожесть судна на волну, выталкивание носа и защиту палубы от заливания.',
    points: ['PT_STEM_DECK', 'CTRL_STEM_UPPER', 'PT_STEM_KNUCKLE'],
  },
  forefoot: {
    id: 'forefoot',
    name: '2. Пятка и бульб',
    shortName: 'Пятка (КВЛ → Пятка)',
    color2D: '#10b981', // изумрудно-зеленый
    color3D: 0x10b981,
    bgBadge: 'bg-emerald-500/15',
    borderBadge: 'border-emerald-400/50',
    textBadge: 'text-emerald-300',
    rangeText: 'От КВЛ (Z = T) вниз до пятки (Z = Z_foot)',
    description: 'Подводная часть форштевня с каплевидным бульбом или ледокольной ложкой.',
    hydrodynamics: 'Формирует интерференционную систему носовых волн для кардинального снижения волнового сопротивления.',
    points: ['PT_STEM_DWL', 'CTRL_STEM_BULB_UPPER', 'PT_BULB_APEX', 'CTRL_STEM_BULB_LOWER', 'PT_FOREFOOT'],
  },
  shoulder: {
    id: 'shoulder',
    name: '3. Носовое плечо',
    shortName: 'Плечо (Пятка → Мидель)',
    color2D: '#f59e0b', // янтарно-оранжевый
    color3D: 0xf59e0b,
    bgBadge: 'bg-amber-500/15',
    borderBadge: 'border-amber-400/50',
    textBadge: 'text-amber-300',
    rangeText: 'От пятки (Z = Z_foot) до стыка с килем и миделем (Z = 0)',
    description: 'Плавный переходный участок сопряжения форштевня с горизонтальной линией киля.',
    hydrodynamics: 'Обеспечивает безотрывное обтекание днища, отсечение брызговой пелены и вход в киль под 90° к шпангоуту.',
    points: ['PT_KEEL_TANGENT'],
  },
};

export interface StemControlPolygonNode {
  key: StemPointKey | 'PT_KEEL_MIDSHIP';
  point: Point2D;
  label: string;
  index: number;
  zone: 'wavebreaker' | 'forefoot' | 'shoulder';
}

/**
 * Получение упорядоченного опорного многоугольника Безье (Bezier Control Polygon)
 * для форштевня от вершины палубы (S0) до стыка с миделем (S9).
 */
export function getStemControlPolygon(
  points: StemTopologyPoints,
  bowLength?: number
): StemControlPolygonNode[] {
  const effectiveBowLen = Math.max(5, bowLength ?? Math.max(10, -points.PT_KEEL_TANGENT.x + 2));
  return [
    { key: 'PT_STEM_DECK', point: points.PT_STEM_DECK, label: 'S0: Палуба', index: 0, zone: 'wavebreaker' },
    { key: 'CTRL_STEM_UPPER', point: points.CTRL_STEM_UPPER, label: 'S1: Кас. палубы', index: 1, zone: 'wavebreaker' },
    { key: 'PT_STEM_KNUCKLE', point: points.PT_STEM_KNUCKLE, label: 'S2: Управл. Кнакл (Сплайн)', index: 2, zone: 'wavebreaker' },
    { key: 'PT_STEM_DWL', point: points.PT_STEM_DWL, label: 'S3: КВЛ (Фикс)', index: 3, zone: 'forefoot' },
    { key: 'CTRL_STEM_BULB_UPPER', point: points.CTRL_STEM_BULB_UPPER, label: 'S4: Кас. КВЛ-бульб', index: 4, zone: 'forefoot' },
    { key: 'PT_BULB_APEX', point: points.PT_BULB_APEX, label: 'S5: Управл. Бульб (Сплайн)', index: 5, zone: 'forefoot' },
    { key: 'CTRL_STEM_BULB_LOWER', point: points.CTRL_STEM_BULB_LOWER, label: 'S6: Кас. бульб-пятка', index: 6, zone: 'forefoot' },
    { key: 'PT_FOREFOOT', point: points.PT_FOREFOOT, label: 'S7: Пятка', index: 7, zone: 'forefoot' },
    { key: 'PT_KEEL_TANGENT', point: points.PT_KEEL_TANGENT, label: 'S8: Линия киля', index: 8, zone: 'shoulder' },
    { key: 'PT_KEEL_MIDSHIP', point: { x: -effectiveBowLen, z: 0.0 }, label: 'S9: Стык с миделем', index: 9, zone: 'shoulder' },
  ];
}

export interface StemCurveZones {
  fullCurve: Point2D[];
  zone1_wavebreaker: Point2D[];
  zone2_forefoot: Point2D[];
  zone3_shoulder: Point2D[];
  controlPolygon: StemControlPolygonNode[];
}

/**
 * Дискретизация сплайна Безье форштевня с разделением на 3 функциональные зоны
 */
export function sampleStemCurveZones(
  points: StemTopologyPoints,
  samplesPerSegment: number = 40,
  bowLength?: number
): StemCurveZones {
  const effectiveBowLen = Math.max(5, bowLength ?? Math.max(10, -points.PT_KEEL_TANGENT.x + 2));

  // Зона 3: Носовое плечо (от стыка с миделем X = -bowLen до сопряжения с килем PT_KEEL_TANGENT и плавный переход к пятке)
  const z3Pts: Point2D[] = [];
  const xMid = -effectiveBowLen;
  if (xMid < points.PT_KEEL_TANGENT.x - 0.05) {
    const keelSteps = Math.max(6, Math.floor(samplesPerSegment * 0.5));
    for (let i = 0; i < keelSteps; i++) {
      const t = i / keelSteps;
      const x = xMid + t * (points.PT_KEEL_TANGENT.x - xMid);
      z3Pts.push({ x, z: 0.0 });
    }
  }

  const keelSpan = points.PT_FOREFOOT.x - points.PT_KEEL_TANGENT.x;
  const ctrlKeel: Point2D = {
    x: points.PT_KEEL_TANGENT.x + Math.max(0.2, keelSpan * 0.45),
    z: 0.0,
  };

  for (let i = 0; i <= samplesPerSegment; i++) {
    const t = i / samplesPerSegment;
    const pt = evaluateBezier([points.PT_KEEL_TANGENT, ctrlKeel, points.PT_FOREFOOT], t);
    z3Pts.push(pt);
  }

  // Зона 2: Пятка и бульб / наклонный форштевень (от пятки PT_FOREFOOT до КВЛ PT_STEM_DWL)
  const z2Pts: Point2D[] = [];
  const bulbSteps = samplesPerSegment * 2;
  for (let i = 0; i <= bulbSteps; i++) {
    const t = i / bulbSteps;
    const pt = evaluateBezier(
      [
        points.PT_FOREFOOT,
        points.CTRL_STEM_BULB_LOWER,
        points.PT_BULB_APEX,
        points.CTRL_STEM_BULB_UPPER,
        points.PT_STEM_DWL,
      ],
      t
    );
    z2Pts.push(pt);
  }

  // Зона 1: Волнорезная надводная часть (от КВЛ PT_STEM_DWL до палубы PT_STEM_DECK)
  const z1Pts: Point2D[] = [];
  const waveSteps = samplesPerSegment * 2;
  for (let i = 0; i <= waveSteps; i++) {
    const t = i / waveSteps;
    const pt = evaluateBezier(
      [
        points.PT_STEM_DWL,
        points.PT_STEM_KNUCKLE,
        points.CTRL_STEM_UPPER,
        points.PT_STEM_DECK,
      ],
      t
    );
    z1Pts.push(pt);
  }

  // Полная непрерывная кривая снизу вверх (от миделя по килю до палубы)
  const fullCurve: Point2D[] = [...z3Pts, ...z2Pts.slice(1), ...z1Pts.slice(1)];
  const controlPolygon = getStemControlPolygon(points, effectiveBowLen);

  return {
    fullCurve,
    zone1_wavebreaker: z1Pts,
    zone2_forefoot: z2Pts,
    zone3_shoulder: z3Pts,
    controlPolygon,
  };
}

/**
 * Получение X-координаты форштевня для заданной высоты Z методом численной интерполяции.
 * Для каждого уровня Z выбирается наиболее передняя точка форштевня (max X),
 * что исключает ошибочное попадание на горизонтальный киль или внутренние складки бульба.
 */
export function getStemXAtZ(curve: Point2D[], z: number): number {
  if (curve.length === 0) return 0;

  let bestX: number | null = null;

  for (let i = 0; i < curve.length - 1; i++) {
    const pA = curve[i];
    const pB = curve[i + 1];
    const zMin = Math.min(pA.z, pB.z);
    const zMax = Math.max(pA.z, pB.z);

    if (z >= zMin - 1e-6 && z <= zMax + 1e-6) {
      const dz = pB.z - pA.z;
      let xVal: number;
      if (Math.abs(dz) < 1e-6) {
        xVal = Math.max(pA.x, pB.x);
      } else {
        const t = Math.max(0, Math.min(1, (z - pA.z) / dz));
        xVal = pA.x + t * (pB.x - pA.x);
      }
      if (bestX === null || xVal > bestX) {
        bestX = xVal;
      }
    }
  }

  if (bestX !== null) return bestX;

  // Если z вне диапазона: корректный поиск экстремумов
  let minZ = Infinity;
  let maxXAtMinZ = -Infinity;
  let maxZ = -Infinity;
  let maxXAtMaxZ = -Infinity;

  for (const p of curve) {
    if (p.z < minZ - 1e-4) {
      minZ = p.z;
      maxXAtMinZ = p.x;
    } else if (Math.abs(p.z - minZ) <= 1e-4 && p.x > maxXAtMinZ) {
      maxXAtMinZ = p.x;
    }

    if (p.z > maxZ + 1e-4) {
      maxZ = p.z;
      maxXAtMaxZ = p.x;
    } else if (Math.abs(p.z - maxZ) <= 1e-4 && p.x > maxXAtMaxZ) {
      maxXAtMaxZ = p.x;
    }
  }

  if (z <= minZ) return maxXAtMinZ;
  if (z >= maxZ) return maxXAtMaxZ;

  return curve[curve.length - 1].x;
}

/**
 * Получение Z-высоты форштевня/киля для заданной координаты X (в системе координат форштевня).
 * Возвращает высоту нижней кромки профиля форштевня на координате xRel.
 */
export function getStemZAtX(curve: Point2D[], xRel: number): number {
  if (curve.length === 0) return 0;

  for (let i = 0; i < curve.length - 1; i++) {
    const pA = curve[i];
    const pB = curve[i + 1];
    const xMin = Math.min(pA.x, pB.x);
    const xMax = Math.max(pA.x, pB.x);

    if (xRel >= xMin - 1e-4 && xRel <= xMax + 1e-4) {
      const dx = pB.x - pA.x;
      if (Math.abs(dx) < 1e-6) {
        return Math.min(pA.z, pB.z);
      }
      const t = Math.max(0, Math.min(1, (xRel - pA.x) / dx));
      return Math.max(0, pA.z + t * (pB.z - pA.z));
    }
  }

  if (xRel <= curve[0].x) return Math.max(0, curve[0].z);
  return Math.max(0, curve[curve.length - 1].z);
}
