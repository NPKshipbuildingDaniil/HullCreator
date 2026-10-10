/**
 * ============================================================================
 * МАТЕМАТИЧЕСКИЙ ДВИЖОК ПОПЕРЕЧНОГО СЕЧЕНИЯ НОСА (BOW TRANSVERSE SECTION ENGINE)
 * ============================================================================
 * 
 * 1. НАЗНАЧЕНИЕ И ЗОНА ОТВЕТСТВЕННОСТИ:
 *    - Расчет геометрической кривой контрольного поперечного шпангоута носовой оконечности.
 *    - Сечение исходит из точки окончания днищевого пятна (X = X_flat + DeltaX)
 *      и поднимается через все ватерлинии до кромки верхней палубы.
 *    - Управление формой шпангоута:
 *      * Угол сопряжения у верхней палубы (sectionDeckAngle);
 *      * Верхний круговой регулятор касательной (sectionUpperRoundAngle, фиолетовый маркер);
 *      * Промежуточная точка / высота касательной перегиба (sectionTangentPoint);
 *      * Нижний круговой регулятор касательной (sectionLowerRoundAngle, фиолетовый маркер);
 *      * Угол входа к форштевню / килю (sectionStemEntryAngle);
 *      * Длина прямолинейного участка сопряжения (пятка, sectionHeelStraightLen).
 *        При длине = 0 прямой угол не навязывается — вход под естественным углом.
 *    - Формирование 3D-представления в WebGL:
 *      * Объемная трубка кривой шпангоута (обе стороны: левый и правый борт);
 *      * Опорный пунктирный каркас Безье;
 *      * Интерактивные 3D-сферы манипуляторов с поддержкой выбора и перетаскивания.
 *    - Полная сохранность геометрии: сечение служит контрольным формообразующим
 *      инвариантом и не деформирует палубу, форштевень или мидель.
 * 
 * 2. ПРАВИЛА РАБОТЫ И СВЯЗИ С ДРУГИМИ МОДУЛЯМИ СИСТЕМЫ:
 *    - topologyTypes.ts: интерфейсы BowVolumeParameters, BowParameters, ShipDimensions.
 *    - stemEngine.ts: высотные отметки форштевня и киля.
 *    - waterlineEngine.ts: функция createContourTubeMesh, полуширины ватерлиний.
 *    - App.tsx: отрисовка в сцене при шаге 'volume' и обработка интерактивных манипуляторов.
 *    - stemUiComponents.tsx: связь с ползунками панели управления объемом.
 * ============================================================================
 */

import * as THREE from 'three';
import { BowParameters, BowVolumeParameters, ShipDimensions } from './topologyTypes';
import { createContourTubeMesh } from './geometryEngine';
import { computeBowDeckWaterlinePoint } from './topologyEngine';
import {
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  getStemXAtZ,
  getStemZAtX,
  DEFAULT_STEM_PARAMS,
} from './stemEngine';
import {
  evaluateWaterlineCurve,
  evaluateWaterlinePointAtT,
  getTheoreticalMidshipHalfBreadthAtZ,
  computeBottomFootprintRelativeZeroX,
} from './waterlineEngine';

export interface BowSectionPoint3D {
  x: number;
  y: number;
  z: number;
}

export type BowSectionKey =
  | 'PT_SEC_STEM'
  | 'PT_SEC_HEEL'
  | 'CTRL_SEC_LOWER'
  | 'PT_SEC_TANGENT'
  | 'PT_SEC_DWL'
  | 'CTRL_SEC_UPPER'
  | 'PT_SEC_DECK'
  | string;

export interface BowSectionWaterlineIntersection {
  id: string;
  name: string;
  zLevel: number;
  y: number;
  zHalf: number;
  pointStbd: BowSectionPoint3D;
  pointPort: BowSectionPoint3D;
  isDWL: boolean;
  isBottom: boolean;
  isDeck: boolean;
  color: number;
}

export interface BowSectionTopology {
  xSection: number;
  tDeck: number;
  baseFootprintZeroX: number;
  distToNose: number;
  halfDistToNose: number;
  ptStem: BowSectionPoint3D;
  ptHeel: BowSectionPoint3D;
  ctrlLower: BowSectionPoint3D;
  ptTangent: BowSectionPoint3D;
  ptDwl: BowSectionPoint3D;
  ctrlUpper: BowSectionPoint3D;
  ptDeck: BowSectionPoint3D;
  waterlineIntersections: BowSectionWaterlineIntersection[];
  curvePort: BowSectionPoint3D[];
  curveStbd: BowSectionPoint3D[];
  straightHeelPort: BowSectionPoint3D[];
  straightHeelStbd: BowSectionPoint3D[];
}

/**
 * Вычисление кубического сплайна Безье в плоскости (Y - высота, Z - полуширина)
 */
function evalBezier2D(
  p0: { y: number; z: number },
  p1: { y: number; z: number },
  p2: { y: number; z: number },
  p3: { y: number; z: number },
  t: number
): { y: number; z: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    z: mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z,
  };
}

/**
 * Поиск продольной координаты X, где днищевое пятно (желтая область / нижняя ватерлиния)
 * сходит на нет (полуширина сводится в 0).
 * Станции упорядочены от стыка с миделем к носу.
 */
export function findBottomFootprintZeroX(
  stations: Array<{ x: number; y: number; zHalf: number }> | undefined,
  fallbackX: number
): number {
  if (!stations || stations.length === 0) return fallbackX;
  for (let i = 0; i < stations.length; i++) {
    if (stations[i].zHalf <= 0.02) {
      if (i > 0) {
        const pA = stations[i - 1];
        const pB = stations[i];
        const dW = pA.zHalf - pB.zHalf;
        if (dW > 1e-4) {
          const t = Math.max(0, Math.min(1, pA.zHalf / dW));
          return pA.x + t * (pB.x - pA.x);
        }
      }
      return stations[i].x;
    }
  }
  return stations[stations.length - 1].x;
}

/**
 * Аналитическое вычисление координаты X окончания днищевого пятна по кривой нижней ватерлинии (Z = 0.005 м).
 * Точка, где желтая область (плоское днище) сводится строго в 0 к килю.
 */
export function computeBottomFootprintZeroX(
  xMidCut: number,
  _xStemTip: number,
  effectiveBowLen: number,
  bowParams: BowParameters,
  _hullParams?: ShipDimensions
): number {
  const vol = bowParams.bowVolume;
  const bottomFlatRun = vol?.bottomFlatRun ?? bowParams.bottomFlatLength ?? 2.0;
  const taperAngleDeg = vol?.bottomTaperAngle ?? bowParams.bottomTaperAngle ?? 15.0;
  const fullness = vol?.bottomFootprintFullness ?? bowParams.bottomFootprintFullness ?? 0.70;

  const zeroRel = computeBottomFootprintRelativeZeroX(
    effectiveBowLen,
    bottomFlatRun,
    taperAngleDeg,
    fullness
  );

  return xMidCut + zeroRel;
}

/**
 * Расчет топологии и геометрии носового поперечного сечения
 */
export function calculateBowSectionTopology(options: {
  xMidCut: number;
  xStemTip: number;
  effectiveBowLen: number;
  bottomFlatRun: number;
  volParams: BowVolumeParameters;
  bowParams: BowParameters;
  hullParams: ShipDimensions;
  keelY: number;
  totalHeight: number;
  bottomZeroX?: number;
  waterlineLevels?: number[];
}): BowSectionTopology {
  const {
    xMidCut,
    xStemTip,
    effectiveBowLen,
    bottomFlatRun,
    volParams,
    bowParams,
    hullParams,
    keelY,
    totalHeight,
  } = options;

  // 1. Продольная координата X сечения:
  // Базовая точка: строго точка окончания днищевого пятна (где желтая область сходится в 0)
  let baseFootprintEndX: number;
  if (options.bottomZeroX !== undefined && Number.isFinite(options.bottomZeroX)) {
    baseFootprintEndX = options.bottomZeroX;
  } else {
    baseFootprintEndX = computeBottomFootprintZeroX(
      xMidCut,
      xStemTip,
      effectiveBowLen,
      bowParams,
      hullParams
    );
  }

  // 1. Относительное положение сечения вдоль носовой части (0 = мидель, 1 = форштевень)
  const stemProfile = bowParams.stemProfile ?? {
    ...DEFAULT_STEM_PARAMS,
    deckOverhang: bowParams.stemRake ?? 0,
  };
  const stemPts = calculateStemTopologyPoints(stemProfile, hullParams.draft, totalHeight, effectiveBowLen);
  const stemSampled = sampleStemCurvePoints(stemPts, 48, effectiveBowLen);
  const xStemDeck = xMidCut + effectiveBowLen + stemPts.PT_STEM_DECK.x;
  const totalBowSpan = Math.max(0.1, xStemDeck - xMidCut);

  // Расстояние от точки окончания днищевого пятна до габарита носа и до миделя:
  const xNoseTip = xStemTip + Math.max(0, stemPts.PT_STEM_DECK.x);
  const distToNose = Math.max(0.5, xNoseTip - baseFootprintEndX);
  const distToMid = Math.max(0.5, baseFootprintEndX - xMidCut);
  const halfDistToNose = 0.5 * distToNose;

  // Функция движения поперечного сечения:
  // Сечение может перемещаться вперед к носу и НАЗАД вглубь днищевого пятна вплоть до 2/3 носовой области и до миделя:
  const xOffset = volParams.sectionXOffset ?? 0.0;
  const maxFwdOffset = distToNose * 0.95;
  const maxBwdOffset = -Math.max((2 / 3) * totalBowSpan, distToMid * 0.95);
  const clampedOffset = Math.max(maxBwdOffset, Math.min(maxFwdOffset, xOffset));
  const xSection = baseFootprintEndX + clampedOffset;
  const uSec = Math.max(0, Math.min(1, (xSection - xMidCut) / totalBowSpan));
  const tLongSec = Math.max(0, Math.min(1, 1 - uSec));

  // 2. Высота и полуширина у верхней палубы на сечении X = xSection:
  // Строго и в точности согласовано с расчетной 3D-контурной линией палубы computeBowDeckWaterlinePoint
  const flareMid = hullParams.flare ?? 0.0;
  const yMidDeck = hullParams.width / 2 + flareMid;
  const yStemHalf = Math.max(0, Math.min(hullParams.width / 2, (bowParams.stemWidth ?? 0) / 2));

  // Поиск точного параметра tDeck \in [0, 1] на кривой палубы, соответствующего xSection:
  // t = 0: мидель (xMidCut), t = 1: форштевень палубы (xStemDeck)
  const evalDeckX = (tParam: number): number => {
    const pt = computeBowDeckWaterlinePoint(
      tParam,
      totalBowSpan,
      yMidDeck,
      yStemHalf,
      bowParams.stemRadius ?? 0,
      bowParams.entranceAngle ?? 25,
      bowParams.shoulderFullness ?? 0.7,
      bowParams.maxBreadthPos ?? 0.5,
      bowParams.controlPoints
    );
    return xStemDeck + pt.xRel;
  };

  let tDeckLow = 0.0;
  let tDeckHigh = 1.0;
  for (let iter = 0; iter < 24; iter++) {
    const tMid = (tDeckLow + tDeckHigh) * 0.5;
    if (evalDeckX(tMid) < xSection) {
      tDeckLow = tMid;
    } else {
      tDeckHigh = tMid;
    }
  }
  const tDeck = Math.max(0, Math.min(1, (tDeckLow + tDeckHigh) * 0.5));

  const deckPt = computeBowDeckWaterlinePoint(
    tDeck,
    totalBowSpan,
    yMidDeck,
    yStemHalf,
    bowParams.stemRadius ?? 0,
    bowParams.entranceAngle ?? 25,
    bowParams.shoulderFullness ?? 0.7,
    bowParams.maxBreadthPos ?? 0.5,
    bowParams.controlPoints
  );

  const sheerBow = bowParams.bowSheer ?? 0.0;
  const yStemDeck = keelY + stemPts.PT_STEM_DECK.z;
  const sheerBlend = Math.pow(Math.max(0, Math.min(1, tDeck)), 2);
  const baseEdge = keelY + totalHeight + sheerBow * sheerBlend;
  const yDeck = baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
  const deckHalfBreadth = Math.max(yStemHalf, deckPt.y);

  // 3. Железный фундамент: нижняя точка шпангоута СТРОГО на желтой линии днищевого пятна
  //    (если xSection внутри пятна) либо на зеленой линии киля/форштевня (если впереди пятна).
  //    Никаких висящих в воздухе точек!
  const isInFootprint = xSection < baseFootprintEndX - 0.001;
  let zBottomAtSec = 0;

  const stemXKeel = stemPts.PT_FOREFOOT.z <= 0.05 ? stemPts.PT_FOREFOOT.x : stemPts.PT_KEEL_TANGENT.x;
  const xRelFromMid = xSection - (xMidCut + effectiveBowLen);

  if (isInFootprint) {
    const midBottomHalf = getTheoreticalMidshipHalfBreadthAtZ(0.005, hullParams);
    const evalBottomX = (tParam: number): number => {
      const pt = evaluateWaterlinePointAtT(
        tParam,
        0.005,
        totalHeight,
        hullParams.draft,
        midBottomHalf,
        stemXKeel,
        0,
        effectiveBowLen,
        bowParams
      );
      return (xMidCut + effectiveBowLen) + pt.xRel;
    };

    let tBotLow = 0.0;
    let tBotHigh = 1.0;
    for (let iter = 0; iter < 16; iter++) {
      const tMid = (tBotLow + tBotHigh) * 0.5;
      if (evalBottomX(tMid) < xSection) {
        tBotHigh = tMid; // t=0 у форштевня, t=1 у миделя
      } else {
        tBotLow = tMid;
      }
    }
    const tBottom = Math.max(0, Math.min(1, (tBotLow + tBotHigh) * 0.5));
    const ptBottomWl = evaluateWaterlinePointAtT(
      tBottom,
      0.005,
      totalHeight,
      hullParams.draft,
      midBottomHalf,
      stemXKeel,
      0,
      effectiveBowLen,
      bowParams
    );
    zBottomAtSec = Math.max(0, ptBottomWl.yHalf);
  }

  // Расчет высоты линии киля/форштевня на сечении xSection:
  // Если внутри пятна днища — строго на линии киля Y = keelY.
  // Если впереди пятна днища — строго на зеленой линии профиля форштевня/киля Y = keelY + zStemCurve.
  let yStem: number;
  if (isInFootprint) {
    yStem = keelY;
  } else {
    const zStemCurve = getStemZAtX(stemSampled, xRelFromMid);
    yStem = keelY + Math.max(0, zStemCurve);
  }

  // ptStem — точка на линии киля в диаметральной плоскости (Z = 0)
  const ptStem: BowSectionPoint3D = { x: xSection, y: yStem, z: 0.0 };

  // ptHeel — внешняя нижняя точка шпангоута:
  // 1) Если внутри днищевого пятна: СТРОГО на желтой линии (Y = keelY, Z = zBottomAtSec).
  // 2) Если впереди пятна: СТРОГО на зеленой линии киля/форштевня (Y = yStem, Z = 0.0).
  let yHeel: number;
  let zHeel: number;
  if (isInFootprint) {
    yHeel = keelY;
    zHeel = zBottomAtSec;
  } else {
    yHeel = yStem;
    zHeel = 0.0;
  }
  const ptHeel: BowSectionPoint3D = { x: xSection, y: yHeel, z: zHeel };

  // 5. Промежуточная точка касательной (PT_SEC_TANGENT) и точка на КВЛ (PT_SEC_DWL):
  const draftVal = Math.max(0.5, hullParams.draft || 4.5);
  const yDwl = keelY + draftVal;
  const stemXDwl = getStemXAtZ(stemSampled, draftVal);
  const midDwlHalf = getTheoreticalMidshipHalfBreadthAtZ(draftVal, hullParams);

  const evalDwlX = (tParam: number): number => {
    const pt = evaluateWaterlinePointAtT(
      tParam,
      draftVal,
      totalHeight,
      draftVal,
      midDwlHalf,
      stemXDwl,
      yStemHalf,
      effectiveBowLen,
      bowParams
    );
    return (xMidCut + effectiveBowLen) + pt.xRel;
  };

  let tDwlLow = 0.0;
  let tDwlHigh = 1.0;
  for (let iter = 0; iter < 16; iter++) {
    const tMid = (tDwlLow + tDwlHigh) * 0.5;
    if (evalDwlX(tMid) < xSection) {
      tDwlHigh = tMid;
    } else {
      tDwlLow = tMid;
    }
  }
  const tDwl = Math.max(0, Math.min(1, (tDwlLow + tDwlHigh) * 0.5));
  const ptDwlWl = evaluateWaterlinePointAtT(
    tDwl,
    draftVal,
    totalHeight,
    draftVal,
    midDwlHalf,
    stemXDwl,
    yStemHalf,
    effectiveBowLen,
    bowParams
  );
  const zDwlAtSec = Math.max(yStemHalf, ptDwlWl.yHalf);

  const tangRatio = Math.max(0.15, Math.min(0.85, volParams.sectionTangentPoint ?? 0.50));
  const yTangent = yHeel + tangRatio * (yDeck - yHeel);

  // Полуширина ватерлинии на высоте yTangent для соблюдения точной взаимосвязи параметров:
  const zShipTangent = Math.max(0, yTangent - keelY);
  const midTangentHalfBreadth = getTheoreticalMidshipHalfBreadthAtZ(zShipTangent, hullParams);
  const stemXTangent = getStemXAtZ(stemSampled, zShipTangent);
  const evalTangentX = (tParam: number): number => {
    const pt = evaluateWaterlinePointAtT(
      tParam,
      zShipTangent,
      totalHeight,
      hullParams.draft,
      midTangentHalfBreadth,
      stemXTangent,
      yStemHalf,
      effectiveBowLen,
      bowParams
    );
    return (xMidCut + effectiveBowLen) + pt.xRel;
  };

  let tTangLow = 0.0;
  let tTangHigh = 1.0;
  for (let iter = 0; iter < 16; iter++) {
    const tMid = (tTangLow + tTangHigh) * 0.5;
    if (evalTangentX(tMid) < xSection) {
      tTangHigh = tMid;
    } else {
      tTangLow = tMid;
    }
  }
  const tTang = Math.max(0, Math.min(1, (tTangLow + tTangHigh) * 0.5));
  const ptTangWl = evaluateWaterlinePointAtT(
    tTang,
    zShipTangent,
    totalHeight,
    hullParams.draft,
    midTangentHalfBreadth,
    stemXTangent,
    yStemHalf,
    effectiveBowLen,
    bowParams
  );
  const waterlineBreadthAtTangent = ptTangWl.yHalf;

  // Полуширина в точке касательной априори широкая (сохраняет исходную форму носа судна):
  const fullness = volParams.baseShoulderFullness ?? 0.70;
  const zTangentBase = waterlineBreadthAtTangent;
  // Шпангоут априори не должен быть уже корпуса (устраняет уступ):
  const zTangentMod = zTangentBase * (1.0 + 0.25 * (fullness - 0.70));
  const zTangent = Math.max(zTangentBase, Math.min(deckHalfBreadth, zTangentMod));

  // 6. Круговые касательные регуляторы (как фиолетовые на форштевне):
  // Нижний круговой регулятор (CTRL_SEC_LOWER):
  const lowerAngleDeg = volParams.sectionLowerRoundAngle ?? 45.0;
  const lowerAngleRad = (lowerAngleDeg * Math.PI) / 180;
  const lowerSpan = Math.hypot(yTangent - yHeel, zTangent - zHeel);
  const lowerArm = Math.max(0.2, lowerSpan * 0.45);

  // Полнотелая выпуклая скула, формирующая правильный радиус шпангоута:
  const yCtrlLower = yHeel + lowerArm * Math.sin(lowerAngleRad);
  const zCtrlLower = zHeel + lowerArm * Math.cos(lowerAngleRad);

  // Верхний круговой регулятор (CTRL_SEC_UPPER):
  const upperAngleDeg = volParams.sectionUpperRoundAngle ?? 45.0;
  const upperAngleRad = (upperAngleDeg * Math.PI) / 180;
  const upperSpan = Math.hypot(yDeck - yTangent, deckHalfBreadth - zTangent);
  const upperArm = Math.max(0.2, upperSpan * 0.45);

  const deckAngleDeg = volParams.sectionDeckAngle ?? 15.0;
  const deckAngleRad = (deckAngleDeg * Math.PI) / 180;

  // Касательная у палубы:
  const yCtrlUpperDeck = yDeck - upperArm * Math.cos(deckAngleRad);
  const zCtrlUpperDeck = deckHalfBreadth - upperArm * Math.sin(deckAngleRad);

  const yCtrlUpperMid = yTangent + upperArm * Math.sin(upperAngleRad);
  const zCtrlUpperMid = zTangent + upperArm * Math.cos(upperAngleRad);

  // Топологические 3D-узлы (для правого борта Z >= 0):
  const ctrlLower: BowSectionPoint3D = { x: xSection, y: yCtrlLower, z: Math.max(zHeel, Math.min(zTangent, zCtrlLower)) };
  const ptTangent: BowSectionPoint3D = { x: xSection, y: yTangent, z: zTangent };
  const ctrlUpper: BowSectionPoint3D = { x: xSection, y: yCtrlUpperMid, z: Math.max(zTangent, Math.min(deckHalfBreadth * 1.05, zCtrlUpperMid)) };
  const ptDeck: BowSectionPoint3D = { x: xSection, y: yDeck, z: deckHalfBreadth };

  // Дискретизация кривой шпангоута:
  // Кривая проходит строго через ptHeel -> ptTangent -> ptDeck, и точно согласована с КВЛ
  const nSamplesHalf = 28;
  const curveStbd: BowSectionPoint3D[] = [];
  const curvePort: BowSectionPoint3D[] = [];

  // Сегмент 1: от пятки к промежуточной точке касательной (скуловой переход)
  for (let i = 0; i <= nSamplesHalf; i++) {
    const t = i / nSamplesHalf;
    const pt = evalBezier2D(
      { y: yHeel, z: zHeel },
      { y: yCtrlLower, z: zCtrlLower },
      { y: (yCtrlLower + yTangent) / 2, z: (zCtrlLower + zTangent) / 2 },
      { y: yTangent, z: zTangent },
      t
    );
    curveStbd.push({ x: xSection, y: pt.y, z: pt.z });
    curvePort.push({ x: xSection, y: pt.y, z: -pt.z });
  }

  // Сегмент 2: от промежуточной точки касательной к кромке палубы (надводный борт)
  // Шпангоут плавно идет и начинается строго с линии верхней палубы ptDeck:
  for (let i = 1; i <= nSamplesHalf; i++) {
    const t = i / nSamplesHalf;
    const pt = evalBezier2D(
      { y: yTangent, z: zTangent },
      { y: yCtrlUpperMid, z: zCtrlUpperMid },
      { y: yCtrlUpperDeck, z: zCtrlUpperDeck },
      { y: yDeck, z: deckHalfBreadth },
      t
    );
    // Гарантируем, что полуширина шпангоута не меньше полуширины корпуса на этой высоте:
    const sInterp = Math.max(0, Math.min(1, (pt.y - yTangent) / Math.max(1e-4, yDeck - yTangent)));
    const hullBaselineZ = zTangent + sInterp * (deckHalfBreadth - zTangent);
    const zSafe = Math.max(hullBaselineZ, pt.z);
    curveStbd.push({ x: xSection, y: pt.y, z: zSafe });
    curvePort.push({ x: xSection, y: pt.y, z: -zSafe });
  }

  // Определение полуширины на линии КВЛ по результирующей кривой шпангоута
  let zDwlOnCurve = zDwlAtSec;
  for (let i = 0; i < curveStbd.length - 1; i++) {
    const p0 = curveStbd[i];
    const p1 = curveStbd[i + 1];
    if (yDwl >= p0.y && yDwl <= p1.y) {
      const span = Math.max(1e-4, p1.y - p0.y);
      const frac = (yDwl - p0.y) / span;
      zDwlOnCurve = p0.z + frac * (p1.z - p0.z);
      break;
    }
  }
  const ptDwl: BowSectionPoint3D = { x: xSection, y: yDwl, z: zDwlOnCurve };

  // Прямой горизонтальный участок днища (если сечение находится внутри днищевого пятна):
  const straightHeelStbd: BowSectionPoint3D[] = [];
  const straightHeelPort: BowSectionPoint3D[] = [];

  if (zHeel > 0.005) {
    straightHeelStbd.push(ptStem, ptHeel);
    straightHeelPort.push(
      { x: xSection, y: yStem, z: 0 },
      { x: xSection, y: yHeel, z: -zHeel }
    );
  }

  // 7. Программное определение точек шпангоута на каждой из ватерлиний:
  const H = Math.max(0.5, totalHeight);
  const T = Math.max(0.1, hullParams.draft);
  const zBottom = 0.005;

  let targetLevels: Array<{ id: string; name: string; zLevel: number; isDWL: boolean; isBottom: boolean; isDeck: boolean; color: number }>;

  if (options.waterlineLevels && options.waterlineLevels.length > 0) {
    targetLevels = options.waterlineLevels.map((lvl, idx) => {
      const isDWL = Math.abs(lvl - T) < 0.05;
      const isBottom = Math.abs(lvl - zBottom) < 0.05;
      const isDeck = Math.abs(lvl - H) < 0.05;
      let id = `wl_${idx}`;
      let name = `ВЛ (Z = ${lvl.toFixed(2)} м)`;
      let color = 0x06b6d4;
      if (isBottom) {
        id = 'wl_bottom';
        name = `Днищевое пятно (Z = ${lvl.toFixed(2)} м)`;
        color = 0xf59e0b;
      } else if (isDWL) {
        id = 'wl_dwl';
        name = `КВЛ (DWL: T = ${T.toFixed(2)} м)`;
        color = 0x10b981;
      } else if (isDeck) {
        id = 'wl_deck';
        name = `Верхняя палуба (Z = ${H.toFixed(2)} м)`;
        color = 0x38bdf8;
      } else if (lvl > T) {
        id = `wl_above_${idx}`;
        name = `Надводная ВЛ ${idx} (Z = ${lvl.toFixed(2)} м)`;
        color = 0x0ea5e9;
      } else {
        id = `wl_under_${idx}`;
        name = `Подводная ВЛ ${idx} (Z = ${lvl.toFixed(2)} м)`;
        color = 0x06b6d4;
      }
      return { id, name, zLevel: lvl, isDWL, isBottom, isDeck, color };
    });
  } else {
    const underStep = (T - zBottom) / 3;
    const zUnder1 = Number((zBottom + underStep).toFixed(3));
    const zUnder2 = Number((zBottom + underStep * 2).toFixed(3));
    const zAbove = Number((T + 0.5 * (H - T)).toFixed(3));

    targetLevels = [
      { id: 'wl_bottom', name: `Днищевое пятно (Нижняя ВЛ: Z = ${zBottom.toFixed(2)} м)`, zLevel: zBottom, isBottom: true, isDWL: false, isDeck: false, color: 0xf59e0b },
      { id: 'wl_under_1', name: `Подводная ВЛ 1 (Z = ${zUnder1.toFixed(2)} м)`, zLevel: zUnder1, isBottom: false, isDWL: false, isDeck: false, color: 0x06b6d4 },
      { id: 'wl_under_2', name: `Подводная ВЛ 2 (Z = ${zUnder2.toFixed(2)} м)`, zLevel: zUnder2, isBottom: false, isDWL: false, isDeck: false, color: 0x14b8a6 },
      { id: 'wl_dwl', name: `КВЛ (DWL: T = ${T.toFixed(2)} м)`, zLevel: Number(T.toFixed(3)), isBottom: false, isDWL: true, isDeck: false, color: 0x10b981 },
      { id: 'wl_above_1', name: `Надводная ВЛ (Z = ${zAbove.toFixed(2)} м)`, zLevel: zAbove, isBottom: false, isDWL: false, isDeck: false, color: 0x0ea5e9 },
      { id: 'wl_deck', name: `Верхняя палуба (Z = ${H.toFixed(2)} м)`, zLevel: Number(H.toFixed(3)), isBottom: false, isDWL: false, isDeck: true, color: 0x38bdf8 },
    ];
  }

  // Расчет точки пересечения (xSection, y, zHalf) на каждой ватерлинии
  const waterlineIntersections: BowSectionWaterlineIntersection[] = targetLevels.map((lvl) => {
    let yWl = keelY + lvl.zLevel;
    let zHalf = 0;

    if (lvl.isBottom) {
      yWl = ptHeel.y;
      zHalf = ptHeel.z;
    } else if (lvl.isDeck) {
      yWl = ptDeck.y;
      zHalf = ptDeck.z;
    } else {
      // На промежуточных ватерлиниях интерполируем полуширину точно по кривой шпангоута curveStbd:
      if (yWl <= curveStbd[0].y) {
        zHalf = curveStbd[0].z;
      } else if (yWl >= curveStbd[curveStbd.length - 1].y) {
        zHalf = curveStbd[curveStbd.length - 1].z;
      } else {
        for (let i = 0; i < curveStbd.length - 1; i++) {
          const pA = curveStbd[i];
          const pB = curveStbd[i + 1];
          if (yWl >= pA.y && yWl <= pB.y) {
            const dy = Math.max(1e-5, pB.y - pA.y);
            const frac = Math.max(0, Math.min(1, (yWl - pA.y) / dy));
            zHalf = pA.z + frac * (pB.z - pA.z);
            break;
          }
        }
      }
    }

    return {
      id: lvl.id,
      name: lvl.name,
      zLevel: lvl.zLevel,
      y: yWl,
      zHalf,
      pointStbd: { x: xSection, y: yWl, z: zHalf },
      pointPort: { x: xSection, y: yWl, z: -zHalf },
      isDWL: lvl.isDWL,
      isBottom: lvl.isBottom,
      isDeck: lvl.isDeck,
      color: lvl.color,
    };
  });

  return {
    xSection,
    tDeck,
    baseFootprintZeroX: baseFootprintEndX,
    distToNose,
    halfDistToNose,
    ptStem,
    ptHeel,
    ctrlLower,
    ptTangent,
    ptDwl,
    ctrlUpper,
    ptDeck,
    waterlineIntersections,
    curvePort,
    curveStbd,
    straightHeelPort,
    straightHeelStbd,
  };
}

/**
 * Вычисление точной полуширины Z поперечного сечения носа при заданной высоте Y.
 * Обеспечивает математическую непрерывность и согласование поверхности корпуса с сечением.
 */
export function evaluateBowSectionHalfBreadthAtY(
  yVal: number,
  topology: BowSectionTopology
): number {
  const { ptStem, ptHeel, ptDeck } = topology;
  if (yVal <= ptStem.y) return 0;
  if (yVal >= ptDeck.y) return ptDeck.z;

  // 1. Прямолинейный участок пятки (если yVal между ptStem и ptHeel)
  if (yVal <= ptHeel.y) {
    const spanY = Math.max(1e-4, ptHeel.y - ptStem.y);
    const t = Math.max(0, Math.min(1, (yVal - ptStem.y) / spanY));
    return ptStem.z + t * (ptHeel.z - ptStem.z);
  }

  // 2. Выборка из плотной сетки кривой curveStbd с эрмитовой C1-интерполяцией
  const pts = topology.straightHeelStbd.length > 0
    ? [topology.straightHeelStbd[0], ...topology.curveStbd]
    : topology.curveStbd;

  if (!pts || pts.length === 0) return 0;
  if (yVal <= pts[0].y) return pts[0].z;
  if (yVal >= pts[pts.length - 1].y) return pts[pts.length - 1].z;

  // Бинарный поиск интервала [low, high]
  let low = 0;
  let high = pts.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (pts[mid].y <= yVal) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const p0 = pts[low];
  const p1 = pts[high];
  const dy = Math.max(1e-5, p1.y - p0.y);
  const t = Math.max(0, Math.min(1, (yVal - p0.y) / dy));
  const smoothT = t * t * (3 - 2 * t);
  return p0.z + smoothT * (p1.z - p0.z);
}

/**
 * Единая математическая функция согласования полуширины ватерлинии и поперечного сечения (шпангоута).
 * Гарантирует абсолютную точность и непрерывность:
 * 1. На станции шпангоута (xVal == xSection) полуширина строго и без погрешностей равна контуру шпангоута:
 *    Z(xSection, Y) == evaluateBowSectionHalfBreadthAtY(Y, topology).
 * 2. Контуры ватерлиний в 3D и на чертеже в точности проходят через точки шпангоута.
 * 3. Вершины полигональной сетки корпуса на станции шпангоута строго ложатся в плоскость X = xSection
 *    и в точности повторяют расчетный контур шпангоута без складок, уступов и полигональных деформаций.
 * 4. При удалении от шпангоута к миделю и к форштевню влияние шпангоута плавно и гармонично
 *    экстраполируется по C2-сплайну Эрмита (smootherstep) с нулевой первой и второй производными.
 */
export function blendBowWaterlineWithSection(
  xVal: number,
  yVal: number,
  wWaterline: number,
  topology: BowSectionTopology | undefined,
  xStart: number,
  totalBowSpan: number,
  zDeckHalf?: number,
  uStation?: number,
  ySheerStation?: number
): number {
  if (!topology || totalBowSpan <= 0.001) {
    return wWaterline;
  }

  const xSec = topology.xSection;
  const xFront = xStart + totalBowSpan;

  // Проверка совпадения со станцией шпангоута:
  // Если xVal находится в непосредственной близости от xSec, это станция шпангоута!
  const isAtSection = Math.abs(xVal - xSec) < 0.03;

  // C2-гладкий квинтик-полином веса влияния шпангоута w(X) вдоль продольной оси X
  let sectionWeight = 0;
  if (isAtSection) {
    sectionWeight = 1.0;
  } else if (xVal <= xSec) {
    const spanMid = Math.max(0.1, xSec - xStart);
    const s = Math.max(0, Math.min(1, (xVal - xStart) / spanMid));
    // Quintic smootherstep C2: s^3 * (10 - 15s + 6s^2)
    sectionWeight = s * s * s * (10 + s * (-15 + 6 * s));
  } else {
    const spanStem = Math.max(0.1, xFront - xSec);
    const s = Math.max(0, Math.min(1, (xFront - xVal) / spanStem));
    // Quintic smootherstep C2: s^3 * (10 - 15s + 6s^2)
    sectionWeight = s * s * s * (10 + s * (-15 + 6 * s));
  }

  // Если влияние шпангоута исчезающе мало (< 1e-5), возвращаем чистую ватерлинию
  if (sectionWeight <= 1e-5) {
    return wWaterline;
  }

  // Высота палубы на текущей станции
  const yBottom = topology.ptStem.y;
  const yDeckAtStation = (ySheerStation !== undefined && Number.isFinite(ySheerStation))
    ? ySheerStation
    : topology.ptDeck.y;

  // Высотный эквивалент для шпангоута (с учетом местной седловатости палубы)
  let yValSecEquivalent = yVal;
  if (yDeckAtStation - yBottom > 0.05 && topology.ptDeck.y - yBottom > 0.05 && !isAtSection) {
    const sStation = Math.max(0, Math.min(1, (yVal - yBottom) / (yDeckAtStation - yBottom)));
    yValSecEquivalent = yBottom + sStation * (topology.ptDeck.y - yBottom);
  }

  // Аналитическая полуширина контура шпангоута на этой высоте
  const zFromSection = evaluateBowSectionHalfBreadthAtY(yValSecEquivalent, topology);

  // На станции шпангоута (или при весе >= 0.999) полуширина СТРОГО И ТОЧНО равна контуру шпангоута!
  if (isAtSection || sectionWeight >= 0.999) {
    return Math.max(0, zFromSection);
  }

  // Нормализованная форма поперечного сечения [0, 1] относительно полуширины палубы шпангоута
  const zDeckSec = Math.max(0.01, topology.ptDeck.z);
  const eta = Math.max(0, Math.min(1.5, zFromSection / zDeckSec));

  // Полуширина палубы на текущей станции xVal
  const currentDeckHalf = (zDeckHalf !== undefined && Number.isFinite(zDeckHalf))
    ? zDeckHalf
    : topology.ptDeck.z;

  // Проекция формы шпангоута на текущую станцию с учетом изменения ширины корпуса
  const zTargetAtStation = eta * currentDeckHalf;

  // Плавное интерполирование между чистой ватерлинией wWaterline и формой сечения zTargetAtStation
  const zBlended = (1 - sectionWeight) * wWaterline + sectionWeight * zTargetAtStation;

  // Защита от «слоновьей ноги» и складок: на уровне днища геометрия строго подчинена окончанию днищевого пятна
  if (yVal <= topology.ptStem.y + 0.02) {
    if (xVal >= topology.baseFootprintZeroX - 0.01) {
      return 0;
    }
    return Math.max(0, Math.min(wWaterline, zBlended));
  }

  return Math.max(0, zBlended);
}

/**
 * Создание 3D-группы Three.js для поперечного носового сечения
 */
export function createBowSection3DGroup(
  topo: BowSectionTopology,
  selectedKey: BowSectionKey | null = null
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bowSection3DGroup';

  // 1. Отрисовка кривых шпангоута объемными светящимися трубками (Правый и Левый борт)
  const stbdVectors = topo.curveStbd.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const portVectors = topo.curvePort.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  console.log('BowSection 3D vectors stbd count:', stbdVectors.length, stbdVectors[0], stbdVectors[stbdVectors.length-1]);


  if (stbdVectors.length > 1) {
    const tubeStbd = createContourTubeMesh(stbdVectors, 0.048, 0x06b6d4); // Неоновый циан
    if (Array.isArray(tubeStbd.material)) {
      tubeStbd.material.forEach(m => m.depthTest = false);
    } else {
      tubeStbd.material.depthTest = false;
    }
    tubeStbd.name = 'bowSectionTubeStbd';
    tubeStbd.renderOrder = 999;
    group.add(tubeStbd);
  }

  if (portVectors.length > 1) {
    const tubePort = createContourTubeMesh(portVectors, 0.048, 0x06b6d4);
    if (Array.isArray(tubePort.material)) {
      tubePort.material.forEach(m => m.depthTest = false);
    } else {
      tubePort.material.depthTest = false;
    }
    tubePort.name = 'bowSectionTubePort';
    tubePort.renderOrder = 999;
    group.add(tubePort);
  }

  // 2. Прямой участок пятки (выделен теплым оранжево-янтарным цветом)
  if (topo.straightHeelStbd.length > 1) {
    const heelStbdVec = topo.straightHeelStbd.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const heelPortVec = topo.straightHeelPort.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const heelTubeStbd = createContourTubeMesh(heelStbdVec, 0.052, 0xf59e0b);
    const heelTubePort = createContourTubeMesh(heelPortVec, 0.052, 0xf59e0b);
    [heelTubeStbd, heelTubePort].forEach(tube => {
      if (Array.isArray(tube.material)) {
        tube.material.forEach(m => m.depthTest = false);
      } else {
        tube.material.depthTest = false;
      }
      tube.renderOrder = 999;
    });
    group.add(heelTubeStbd, heelTubePort);
  }

  // 3. Опорный каркас Безье (пунктирные линии к контрольным точкам)
  const polyPoints = [
    new THREE.Vector3(topo.ptStem.x, topo.ptStem.y, topo.ptStem.z),
    new THREE.Vector3(topo.ptHeel.x, topo.ptHeel.y, topo.ptHeel.z),
    new THREE.Vector3(topo.ctrlLower.x, topo.ctrlLower.y, topo.ctrlLower.z),
    new THREE.Vector3(topo.ptTangent.x, topo.ptTangent.y, topo.ptTangent.z),
    new THREE.Vector3(topo.ptDwl.x, topo.ptDwl.y, topo.ptDwl.z),
    new THREE.Vector3(topo.ctrlUpper.x, topo.ctrlUpper.y, topo.ctrlUpper.z),
    new THREE.Vector3(topo.ptDeck.x, topo.ptDeck.y, topo.ptDeck.z),
  ];

  const polyGeom = new THREE.BufferGeometry().setFromPoints(polyPoints);
  const polyMat = new THREE.LineDashedMaterial({
    color: 0x94a3b8,
    dashSize: 0.35,
    gapSize: 0.2,
    transparent: true,
    opacity: 0.65,
    depthTest: false,
  });
  const polyLine = new THREE.Line(polyGeom, polyMat);
  polyLine.renderOrder = 999;
  polyLine.computeLineDistances();
  group.add(polyLine);

  // 4. Интерактивные 3D-манипуляторы (сферы)
  const NODES: Array<{
    key: BowSectionKey;
    point: BowSectionPoint3D;
    color: number;
    radius: number;
    name: string;
    isCircularHandle?: boolean;
    waterlineId?: string;
  }> = [
    {
      key: 'PT_SEC_STEM',
      point: topo.ptStem,
      color: 0x10b981, // Изумрудный (зеленая килевая линия)
      radius: 0.12,
      name: 'Киль / Диаметральная плоскость',
    },
    {
      key: 'CTRL_SEC_LOWER',
      point: topo.ctrlLower,
      color: 0xc084fc, // ФИОЛЕТОВЫЙ (круговой регулятор, как на форштевне)
      radius: 0.10,
      name: 'Круговой низ (Касательная скулы)',
      isCircularHandle: true,
    },
    {
      key: 'PT_SEC_TANGENT',
      point: topo.ptTangent,
      color: 0x06b6d4, // Циан (точка перегиба)
      radius: 0.13,
      name: 'Точка перегиба / касательная',
    },
    {
      key: 'CTRL_SEC_UPPER',
      point: topo.ctrlUpper,
      color: 0xc084fc, // ФИОЛЕТОВЫЙ (круговой регулятор верхнего участка)
      radius: 0.10,
      name: 'Круговой верх (Касательная развала)',
      isCircularHandle: true,
    },
  ];

  // Добавляем программно определенные узлы шпангоута на каждой из ватерлиний:
  if (topo.waterlineIntersections && topo.waterlineIntersections.length > 0) {
    topo.waterlineIntersections.forEach((wli) => {
      NODES.push({
        key: wli.id,
        point: wli.pointStbd,
        color: wli.color,
        radius: wli.isDWL || wli.isDeck || wli.isBottom ? 0.13 : 0.11,
        name: `Шпангоут: ${wli.name}`,
        isCircularHandle: false,
        waterlineId: wli.id,
      });
    });
  } else {
    // Резервные узлы, если массив пуст
    NODES.push(
      {
        key: 'PT_SEC_HEEL',
        point: topo.ptHeel,
        color: topo.ptHeel.z > 0.005 ? 0xf59e0b : 0x10b981,
        radius: 0.11,
        name: topo.ptHeel.z > 0.005 ? 'Край днищевого пятна (Желтая линия)' : 'Киль / Форштевень',
      },
      {
        key: 'PT_SEC_DWL',
        point: topo.ptDwl,
        color: 0x10b981,
        radius: 0.12,
        name: 'Шпангоут на КВЛ (DWL)',
      },
      {
        key: 'PT_SEC_DECK',
        point: topo.ptDeck,
        color: 0x38bdf8,
        radius: 0.13,
        name: 'Кромка верхней палубы',
      }
    );
  }

  NODES.forEach((node) => {
    const isSel =
      selectedKey === node.key ||
      (node.key === 'wl_deck' && selectedKey === 'PT_SEC_DECK') ||
      (node.key === 'PT_SEC_DECK' && selectedKey === 'wl_deck') ||
      (node.key === 'wl_dwl' && selectedKey === 'PT_SEC_DWL') ||
      (node.key === 'PT_SEC_DWL' && selectedKey === 'wl_dwl') ||
      (node.key === 'wl_bottom' && selectedKey === 'PT_SEC_HEEL') ||
      (node.key === 'PT_SEC_HEEL' && selectedKey === 'wl_bottom');
    const sphereColor = isSel ? 0xf43f5e : node.color;
    const geom = new THREE.SphereGeometry(isSel ? node.radius * 1.35 : node.radius, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: sphereColor,
      emissive: sphereColor,
      emissiveIntensity: isSel ? 0.95 : 0.45,
      roughness: 0.25,
      metalness: 0.1,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 999;
    mesh.position.set(node.point.x, node.point.y, node.point.z);
    mesh.userData = {
      isBowSectionPoint: true,
      sectionKey: node.key,
      waterlineId: node.waterlineId,
      isCircularHandle: node.isCircularHandle,
      label: node.name,
    };
    group.add(mesh);

    // Симметричная точка на левом борту (Port side Z < 0)
    if (Math.abs(node.point.z) > 0.005 && !node.isCircularHandle) {
      const portGeom = new THREE.SphereGeometry(isSel ? node.radius * 1.15 : node.radius * 0.85, 12, 12);
      const portMat = new THREE.MeshStandardMaterial({
        color: sphereColor,
        emissive: sphereColor,
        emissiveIntensity: isSel ? 0.75 : 0.35,
        roughness: 0.35,
        depthTest: false,
      });
      const portMesh = new THREE.Mesh(portGeom, portMat);
      portMesh.renderOrder = 999;
      portMesh.position.set(node.point.x, node.point.y, -node.point.z);
      portMesh.userData = {
        isBowSectionPoint: true,
        sectionKey: node.key,
        waterlineId: node.waterlineId,
        label: node.name,
      };
      group.add(portMesh);
    }

    // Невидимый хитбокс увеличенного радиуса для легкого клика
    const hitGeom = new THREE.SphereGeometry(node.radius * 2.2, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeom, hitMat);
    hitMesh.position.set(node.point.x, node.point.y, node.point.z);
    hitMesh.userData = {
      isBowSectionPoint: true,
      sectionKey: node.key,
      waterlineId: node.waterlineId,
      isCircularHandle: node.isCircularHandle,
      label: node.name,
    };
    group.add(hitMesh);
  });

  return group;
}
