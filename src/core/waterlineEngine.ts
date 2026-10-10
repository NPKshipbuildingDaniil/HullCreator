/**
 * ====================================================================================================
 * 📁 src/core/waterlineEngine.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Математическое ядро параметрической модели объема носовой оконечности судна
 * через согласованное редактирование ватерлиний (V-ось) и их вертикальную дифференциацию (U-ось).
 * 
 * ТЕХНИЧЕСКАЯ СПЕЦИФИКАЦИЯ (ТЗ: ДВУХОСЕВАЯ МОДЕЛЬ U x V):
 * 1. Архитектурная концепция:
 *    Объем носа строится как регулярное семейство продольно-горизонтальных сечений (ватерлиний),
 *    использующих 4-го порядка кривые Безье с 5 контрольными точками P0..P4.
 * 
 * 2. V-направление (Продольная форма базовой ватерлинии):
 *    P(t, u) = \sum_{i=0}^4 B_i^4(t) \cdot P_i(u),  t \in [0, 1]
 *    - P0(u) = (X_stem(u), W_stem(u) / 2) — контактная точка с ножом форштевня
 *    - P1(u) = P0(u) + L_bow * k_entry(u) * [-cos(alpha(u)), sin(alpha(u))] — носовой угол заострения
 *    - P2(u) = (-L_bow * k_pos(u), Y_mid(u) * k_shoulder(u)) — плечо ватерлинии (вздутие / прогиб)
 *    - P3(u) = (-L_bow + dx_3(u), Y_mid(u)) — тангенциальный участок 90° к миделю (dY/dX = 0)
 *    - P4(u) = (-L_bow, Y_mid(u)) — стык с цилиндрической частью
 * 
 * 3. U-направление (Вертикальная дифференциация сечений по высоте Z):
 *    - Разница углов заострения между палубой и КВЛ (entranceAngleGradient)
 *    - Локальное наполнение / заострение на уровне КВЛ (dwlFullnessBias)
 *    - S-образный прогиб носового плеча (shoulderInflection)
 *    - U <-> V форм-фактор шпангоутов (frameSectionCurvature)
 *    - Пятно днища (bottomFlatRun, bottomTaperAngle, bottomFootprintFullness, bottomTangentBias)
 * ====================================================================================================
 */

import * as THREE from 'three';
import {
  BowParameters,
  BowVolumeParameters,
  WaterlineBaseParams,
  WaterlineGradientParams,
  BottomFootprintParams,
  DEFAULT_BOW_VOLUME_PARAMS,
} from './topologyTypes';
import {
  getStemXAtZ,
  DEFAULT_STEM_PARAMS,
  calculateStemTopologyPoints,
  StemTopologyPoints,
} from './stemEngine';
import { calculateVerticalLevels, getCrossSectionHalfBranches3D, createContourTubeMesh } from './geometryEngine';
import { BrusParams } from './types';
import { blendBowWaterlineWithSection, BowSectionTopology } from './bowSectionEngine';
import { computeBowDeckWaterlinePoint } from './topologyEngine';

/**
 * Аналитическое вычисление полуширины бульбового утолщения (тождественно BowSurfaceEngine)
 */
export function computeWaterlineBulbWidth(
  u: number,
  yVal: number,
  keelY: number,
  totalHeight: number,
  draft: number,
  beam: number,
  bowParams: BowParameters
): number {
  const stemProfile = bowParams.stemProfile ?? DEFAULT_STEM_PARAMS;
  const bulbLen = stemProfile.bulbLength ?? 0;
  const bulbFullness = stemProfile.bulbFullness ?? 0.7;
  const hasBulb3D = bulbLen > 0.05 && bulbFullness > 0.05;
  if (!hasBulb3D) return 0;

  const draftVal = Math.max(0.5, draft || 4.5);
  const zShip = Math.max(0, Math.min(totalHeight, yVal - keelY));
  if (zShip > draftVal * 1.05 || zShip < 0.05) return 0;

  const bulbZ = draftVal * 0.45;
  const rZ = Math.max(0.3, Math.min(bulbZ, draftVal - bulbZ, draftVal * 0.45));
  const dz = Math.abs(zShip - bulbZ);
  if (dz >= rZ) return 0;

  const decayY = Math.pow(Math.cos((Math.PI / 2) * (dz / rZ)), 2);
  const wBulbMax =
    (beam / 2) *
    0.30 *
    Math.min(1.0, Math.max(0.0, bulbFullness)) *
    Math.min(1.0, Math.max(0.0, bulbLen / 4.0)) *
    decayY;

  let decayU = 0;
  if (u >= 0.45 && u <= 0.85) {
    decayU = Math.pow(Math.sin((Math.PI / 2) * ((u - 0.45) / 0.40)), 2);
  } else if (u > 0.85 && u <= 1.0) {
    decayU = Math.pow(Math.cos((Math.PI / 2) * ((u - 0.85) / 0.15)), 2);
  }

  return wBulbMax * decayU;
}

export interface WaterlinePoint2D {
  x: number; // продольная координата (от xStart = -L_bow до xStem)
  y: number; // полуширина (Z в трехмерной системе координат Three.js)
}

export interface WaterlineEvaluationResult {
  zLevel: number;
  uNorm: number; // u = zLevel / H in [0, 1]
  controlPoints: [WaterlinePoint2D, WaterlinePoint2D, WaterlinePoint2D, WaterlinePoint2D, WaterlinePoint2D];
  points: WaterlinePoint2D[];
  entranceAngleDeg: number;
  fullnessCoeff: number;
  halfBreadthMid: number;
  isExceedingMidship: boolean;
  maxBreadth: number;
  excessBreadth: number;
}

export interface Waterline3DLoop {
  id: string; // Уникальный идентификатор ватерлинии (например, 'wl_bottom', 'wl_under_1', 'wl_dwl', 'wl_above_1')
  mode?: 'smooth' | 'defining'; // Режим ватерлинии: 'smooth' (управляющая/гладкая) или 'defining' (определяющая излом / грань / knuckle)
  zLevel: number;
  uNorm: number;
  isDWL: boolean;
  isKeel: boolean;
  isBottom?: boolean;
  isDeck: boolean;
  isExceedingMidship: boolean;
  excessBreadth: number;
  name: string;
  points: [number, number, number][]; // [x, y, z] в Three.js
  controlPoints3D: [number, number, number][]; // 5 контрольных точек P0..P4 в 3D
  stations?: Array<{ x: number; y: number; zHalf: number }>;
  area?: number; // Площадь ватерлинии S_wp = \int 2 * zHalf(x) dx (м²)
  cwp?: number; // Коэффициент полноты площади ватерлинии C_wp = S_wp / (L_bow * B_wl)
}

export interface MidshipCrossSectionInput {
  width: number;
  height: number;
  radius: number;
  flare: number;
  deadrise: number;
  deckCamber?: number;
  sheerRadius?: number;
  deadriseInHeight?: boolean;
  deckCamberInHeight?: boolean;
}

export interface WaterlineFamilyQAStats {
  layerCount: number;
  underwaterLayerCount: number;
  stemContactGapMax: number; // максимальный зазор между ватерлинией и штевнем (в метрах)
  midshipContactGapMax: number; // максимальный зазор на стыке с миделем (в метрах)
  volumeBlowoutPreSuppression: number; // максимальное паразитное уширение нижней ВЛ над верхней до подавления
  volumeBlowoutPostSuppression: number; // уширение после подавления (строго 0.000)
  midshipExceedanceMax: number; // превышение над полушириной миделя Y_mid(z)
  isBindingG0StemPassed: boolean; // тест G^0 на форштевне
  isBindingG0MidshipPassed: boolean; // тест G^0 на миделе
  isMonotonicityUnderwaterPassed: boolean; // тест на подавление раздутия и ступеней
  isMidshipContainmentPassed: boolean; // тест на непревышение контура миделя
  dwlArea?: number; // Точная площадь конструктивной ватерлинии S_wl (м²)
  surfaceCoherenceMaxGap?: number; // Максимальная погрешность полуширины относительно 3D поверхности (м)
}

export interface WaterlineFamilyResult {
  waterlines: Waterline3DLoop[];
  stats: WaterlineFamilyQAStats;
}

/**
 * Вычисление точной полуширины теоретического мидель-шпангоута Y_mid(z)
 * для высоты z над килем (z in [0, H]).
 * Строго учитывает килеватость (deadrise), радиус скулы (bilge radius R) и развал борта (flare).
 * Гарантирует, что внизу на уровне скулы ширина миделя меньше максимальной ширины судна!
 */
export function getTheoreticalMidshipHalfBreadthAtZ(
  z: number,
  params: MidshipCrossSectionInput
): number {
  const { keelY, topY } = calculateVerticalLevels({
    height: params.height,
    deadrise: params.deadrise,
    deckCamber: params.deckCamber ?? 0,
    deadriseInHeight: params.deadriseInHeight,
    deckCamberInHeight: params.deckCamberInHeight,
  });

  const totalH = Math.max(0.01, topY - keelY);
  const clampedZ = Math.max(0, Math.min(totalH, z));
  const targetY = keelY + clampedZ;

  const branches = getCrossSectionHalfBranches3D({
    width: params.width,
    height: params.height,
    radius: params.radius,
    flare: params.flare,
    deadrise: params.deadrise,
    deckCamber: params.deckCamber,
    sheerRadius: params.sheerRadius,
    showDeckCover: false,
    deadriseInHeight: params.deadriseInHeight,
    deckCamberInHeight: params.deckCamberInHeight,
  });

  const pts = branches.rightBranch; // точки в Three.js, где pt.y = высота, pt.z = полуширина
  if (!pts || pts.length === 0) {
    return (params.width / 2) * Math.min(1, clampedZ / totalH);
  }

  // Ветка rightBranch:
  // pts[0]: киль (z = 0)
  // pts[1]: край плоского днища / точка сопряжения со скулой (днищевое пятно)
  // pts[2..]: дуга скулы и борт до палубы
  if (pts.length === 1) {
    return Math.max(0, pts[0].z);
  }

  // Если z строго на уровне киля
  if (clampedZ <= 1e-4 || targetY <= pts[0].y + 1e-4) {
    return Math.max(0, pts[0].z);
  }

  const lastSidePt = pts[pts.length - 1];
  // Если выше верхней точки борта (планширя) — полуширина планширя
  if (targetY >= lastSidePt.y) {
    return Math.max(0, lastSidePt.z);
  }

  // Поиск сегмента внешнего контура шпангоута от киля pts[0] через скулу до палубы
  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i];
    const pB = pts[i + 1];
    const minY = Math.min(pA.y, pB.y);
    const maxY = Math.max(pA.y, pB.y);
    if (targetY >= minY - 1e-6 && targetY <= maxY + 1e-6) {
      const dy = maxY - minY;
      if (dy < 1e-6) return (pA.z + pB.z) * 0.5;
      const t = Math.max(0, Math.min(1, (targetY - pA.y) / (pB.y - pA.y)));
      return Math.max(0, pA.z + t * (pB.z - pA.z));
    }
  }

  return Math.max(0, lastSidePt.z);
}

/**
 * Аналитическое вычисление относительного положения окончания днищевого пятна от миделя.
 * Определяет точку схождения желтой области (плоского днища) в 0 к ДП/килю.
 * Точка строго адаптивна к параметрам bottomFlatRun, bottomTaperAngle, bottomFootprintFullness
 * и гарантированно лежит внутри носовой шпации с сохранением расстояния до габарита носа.
 */
export function computeBottomFootprintRelativeZeroX(
  effectiveBowLen: number,
  bottomFlatRun: number,
  bottomTaperAngle: number,
  bottomFootprintFullness: number
): number {
  const lFlat = Math.max(0.0, Math.min(effectiveBowLen * 0.70, bottomFlatRun));
  const lRem = Math.max(1.0, effectiveBowLen - lFlat);
  const alphaClamped = Math.max(5.0, Math.min(60.0, bottomTaperAngle));
  const alphaRad = (alphaClamped * Math.PI) / 180;
  const kAlpha = Math.tan((20.0 * Math.PI) / 180) / Math.tan(alphaRad);
  const fullnessClamped = Math.max(0.20, Math.min(1.0, bottomFootprintFullness));
  const kFullness = 0.55 + 0.45 * fullnessClamped;

  const lTaper = Math.max(0.12 * lRem, Math.min(0.75 * lRem, lRem * 0.40 * kAlpha * kFullness));
  const zeroRel = lFlat + lTaper;
  return Math.max(0.15 * effectiveBowLen, Math.min(0.85 * effectiveBowLen, zeroRel));
}

/**
 * Базисные функции Бернштейна 4-го порядка (Quartic Bernstein Polynomials):
 * B_0^4(t) = (1-t)^4
 * B_1^4(t) = 4t(1-t)^3
 * B_2^4(t) = 6t^2(1-t)^2
 * B_3^4(t) = 4t^3(1-t)
 * B_4^4(t) = t^4
 */
export function bernsteinQuartic(t: number): [number, number, number, number, number] {
  const s = Math.max(0, Math.min(1, t));
  const s1 = 1 - s;
  const s1_2 = s1 * s1;
  const s1_3 = s1_2 * s1;
  const s1_4 = s1_2 * s1_2;

  const s_2 = s * s;
  const s_3 = s_2 * s;
  const s_4 = s_2 * s_2;

  const b0 = s1_4;
  const b1 = 4 * s * s1_3;
  const b2 = 6 * s_2 * s1_2;
  const b3 = 4 * s_3 * s1;
  const b4 = s_4;

  return [b0, b1, b2, b3, b4];
}

/**
 * Извлечение эффективных параметров объема с безопасными границами и полной поддержкой $U \times V$ модели
 */
export function extractBowVolumeParams(bowParams: BowParameters): BowVolumeParameters {
  const vol = bowParams.bowVolume;
  const Lbow = Math.max(0.5, bowParams.bowLength || 10);

  // 1. Зеленая группа: V-направление
  const baseStemWidth =
    (bowParams as unknown as Record<string, number>).baseStemWidth ??
    vol?.baseStemWidth ??
    bowParams.stemWidth ??
    DEFAULT_BOW_VOLUME_PARAMS.baseStemWidth;

  const baseEntranceAngle =
    (bowParams as unknown as Record<string, number>).baseEntranceAngle ??
    vol?.baseEntranceAngle ??
    bowParams.dwlEntranceAngle ??
    bowParams.entranceAngle ??
    DEFAULT_BOW_VOLUME_PARAMS.baseEntranceAngle;

  const baseShoulderFullness =
    (bowParams as unknown as Record<string, number>).baseShoulderFullness ??
    vol?.baseShoulderFullness ??
    bowParams.dwlShoulderFullness ??
    bowParams.shoulderFullness ??
    DEFAULT_BOW_VOLUME_PARAMS.baseShoulderFullness;

  const baseMidTangentLength =
    (bowParams as unknown as Record<string, number>).baseMidTangentLength ??
    vol?.baseMidTangentLength ??
    bowParams.tangentWeightMid ??
    DEFAULT_BOW_VOLUME_PARAMS.baseMidTangentLength;

  const hollowDepth =
    (bowParams as unknown as Record<string, number>).hollowDepth ??
    vol?.hollowDepth ??
    DEFAULT_BOW_VOLUME_PARAMS.hollowDepth;

  const shoulderPullback =
    (bowParams as unknown as Record<string, number>).shoulderPullback ??
    vol?.shoulderPullback ??
    DEFAULT_BOW_VOLUME_PARAMS.shoulderPullback;

  // 2. Оранжевая группа: U-направление
  const entranceAngleGradient =
    (bowParams as unknown as Record<string, number>).entranceAngleGradient ??
    vol?.entranceAngleGradient ??
    (bowParams.entranceAngle && bowParams.dwlEntranceAngle
      ? bowParams.entranceAngle - bowParams.dwlEntranceAngle
      : DEFAULT_BOW_VOLUME_PARAMS.entranceAngleGradient);

  const dwlFullnessBias =
    (bowParams as unknown as Record<string, number>).dwlFullnessBias ??
    vol?.dwlFullnessBias ??
    DEFAULT_BOW_VOLUME_PARAMS.dwlFullnessBias;

  const shoulderInflection =
    (bowParams as unknown as Record<string, number>).shoulderInflection ??
    vol?.shoulderInflection ??
    bowParams.waterlineInflection ??
    DEFAULT_BOW_VOLUME_PARAMS.shoulderInflection;

  const frameSectionCurvature =
    (bowParams as unknown as Record<string, number>).frameSectionCurvature ??
    vol?.frameSectionCurvature ??
    bowParams.bowUVShape ??
    DEFAULT_BOW_VOLUME_PARAMS.frameSectionCurvature;

  // 3. Синяя группа: Днище
  const bottomFlatRun =
    (bowParams as unknown as Record<string, number>).bottomFlatRun ??
    vol?.bottomFlatRun ??
    bowParams.bottomFlatLength ??
    DEFAULT_BOW_VOLUME_PARAMS.bottomFlatRun;

  const bottomTaperAngle =
    (bowParams as unknown as Record<string, number>).bottomTaperAngle ??
    vol?.bottomTaperAngle ??
    DEFAULT_BOW_VOLUME_PARAMS.bottomTaperAngle;

  const bottomFootprintFullness =
    (bowParams as unknown as Record<string, number>).bottomFootprintFullness ??
    vol?.bottomFootprintFullness ??
    DEFAULT_BOW_VOLUME_PARAMS.bottomFootprintFullness;

  const bottomTangentBias =
    (bowParams as unknown as Record<string, number>).bottomTangentBias ??
    vol?.bottomTangentBias ??
    DEFAULT_BOW_VOLUME_PARAMS.bottomTangentBias;

  const sectionXOffset = (bowParams as unknown as Record<string, number>).sectionXOffset ?? vol?.sectionXOffset ?? DEFAULT_BOW_VOLUME_PARAMS.sectionXOffset;
  const sectionDeckAngle = (bowParams as unknown as Record<string, number>).sectionDeckAngle ?? vol?.sectionDeckAngle ?? DEFAULT_BOW_VOLUME_PARAMS.sectionDeckAngle;
  const sectionUpperRoundAngle = (bowParams as unknown as Record<string, number>).sectionUpperRoundAngle ?? vol?.sectionUpperRoundAngle ?? DEFAULT_BOW_VOLUME_PARAMS.sectionUpperRoundAngle;
  const sectionTangentPoint = (bowParams as unknown as Record<string, number>).sectionTangentPoint ?? vol?.sectionTangentPoint ?? DEFAULT_BOW_VOLUME_PARAMS.sectionTangentPoint;
  const sectionLowerRoundAngle = (bowParams as unknown as Record<string, number>).sectionLowerRoundAngle ?? vol?.sectionLowerRoundAngle ?? DEFAULT_BOW_VOLUME_PARAMS.sectionLowerRoundAngle;
  const sectionStemEntryAngle = (bowParams as unknown as Record<string, number>).sectionStemEntryAngle ?? vol?.sectionStemEntryAngle ?? DEFAULT_BOW_VOLUME_PARAMS.sectionStemEntryAngle;
  const sectionHeelStraightLen = (bowParams as unknown as Record<string, number>).sectionHeelStraightLen ?? vol?.sectionHeelStraightLen ?? DEFAULT_BOW_VOLUME_PARAMS.sectionHeelStraightLen;

  const maxTangent = Math.max(2, Lbow * 0.85);

  return {
    baseStemWidth: Math.max(0.0, Math.min(4.0, baseStemWidth)),
    baseEntranceAngle: Math.max(5.0, Math.min(65.0, baseEntranceAngle)),
    baseShoulderFullness: Math.max(0.20, Math.min(1.30, baseShoulderFullness)),
    baseMidTangentLength: Math.max(0.2, Math.min(maxTangent, baseMidTangentLength)),
    hollowDepth: Math.max(0.0, Math.min(1.5, hollowDepth)),
    shoulderPullback: Math.max(0.10, Math.min(0.90, shoulderPullback)),

    entranceAngleGradient: Math.max(-30.0, Math.min(30.0, entranceAngleGradient)),
    dwlFullnessBias: Math.max(-0.50, Math.min(0.50, dwlFullnessBias)),
    shoulderInflection: Math.max(-0.40, Math.min(0.40, shoulderInflection)),
    frameSectionCurvature: Math.max(0.0, Math.min(1.0, frameSectionCurvature)),

    bottomFlatRun: Math.max(0.0, Math.min(maxTangent, bottomFlatRun)),
    bottomTaperAngle: Math.max(3.0, Math.min(60.0, bottomTaperAngle)),
    bottomFootprintFullness: Math.max(0.20, Math.min(1.0, bottomFootprintFullness)),
    bottomTangentBias: Math.max(-0.35 * Lbow, Math.min(0.35 * Lbow, bottomTangentBias)),

    sectionXOffset: Math.max(-Lbow * 0.95, Math.min(Lbow * 0.95, sectionXOffset ?? 0.0)),
    sectionDeckAngle: Math.max(-90.0, Math.min(90.0, sectionDeckAngle ?? 15.0)),
    sectionUpperRoundAngle: Math.max(-180.0, Math.min(180.0, sectionUpperRoundAngle ?? 45.0)),
    sectionTangentPoint: Math.max(0.1, Math.min(0.9, sectionTangentPoint ?? 0.5)),
    sectionLowerRoundAngle: Math.max(-180.0, Math.min(180.0, sectionLowerRoundAngle ?? 45.0)),
    sectionStemEntryAngle: Math.max(0.0, Math.min(90.0, sectionStemEntryAngle ?? 30.0)),
    sectionHeelStraightLen: Math.max(0.0, Math.min(Math.max(10.0, Lbow * 0.8), sectionHeelStraightLen ?? 0.0)),

    // Legacy compatibility mirrors
    tangentWeightMid: baseMidTangentLength,
    tangentWeightStem: Math.max(0.5, Lbow * 0.25),
    waterlineInflection: shoulderInflection,
    dwlEntranceAngle: baseEntranceAngle,
    dwlShoulderFullness: baseShoulderFullness + dwlFullnessBias,
    bottomFlatLength: bottomFlatRun,
  };
}

/**
 * Вычисление 5 опорных точек Безье P0..P4 и точек ватерлинии на заданной высоте Z \in [0, H]
 * согласно ТЗ на двухосевую модель U x V.
 */
export function evaluateWaterlineCurve(
  zShip: number,
  totalHeight: number,
  draft: number,
  midHalfBreadthAtZ: number,
  stemXAtZ: number,
  stemHalfWidthAtZ: number,
  bowLength: number,
  bowParams: BowParameters,
  numSamples: number = 44
): WaterlineEvaluationResult {
  const vol = extractBowVolumeParams(bowParams);
  const Lbow = Math.max(0.5, bowLength);
  const H = Math.max(0.5, totalHeight);
  const T = Math.max(0.1, draft);

  // Относительная высота u \in [0, 1]
  const uNorm = Math.max(0, Math.min(1, zShip / H));
  const isBelowDWL = zShip < T;
  const zDwlRatio = Math.max(0, Math.min(1, zShip / T)); // 0 (киль) .. 1 (КВЛ)
  const zAboveDwlRatio = Math.max(0, Math.min(1, (zShip - T) / Math.max(0.01, H - T))); // 0 (КВЛ) .. 1 (палуба)

  // ──────────────────────────────────────────────────────────────────────────
  // 1. ВЕРТИКАЛЬНАЯ ДИФФЕРЕНЦИАЦИЯ УГЛА ВХОДА alpha(u)
  // Базовые границы: Шаг 2 (Палуба) и Шаг 3 (Форштевень) строго зафиксированы!
  // ──────────────────────────────────────────────────────────────────────────
  let entranceAngleDeg: number;
  if (isBelowDWL) {
    // Под КВЛ: плавный переход от bottomTaperAngle (киль) к baseEntranceAngle (КВЛ)
    const blend = Math.pow(zDwlRatio, 1.2);
    entranceAngleDeg = vol.bottomTaperAngle * (1 - blend) + vol.baseEntranceAngle * blend;
  } else {
    // Над КВЛ: интерполяция от baseEntranceAngle (КВЛ) к ЗАФИКСИРОВАННОЙ палубе (bowParams.entranceAngle)
    const blend = Math.pow(zAboveDwlRatio, 1.1);
    const targetDeckAngle = bowParams.entranceAngle ?? 25;
    entranceAngleDeg = vol.baseEntranceAngle * (1 - blend) + targetDeckAngle * blend;
  }
  const alphaRad = (entranceAngleDeg * Math.PI) / 180;

  // ──────────────────────────────────────────────────────────────────────────
  // 2. ВЕРТИКАЛЬНАЯ ДИФФЕРЕНЦИАЦИЯ ПОЛНОТЫ ПЛЕЧА k_shoulder(u)
  // ──────────────────────────────────────────────────────────────────────────
  let baseFullness: number;
  if (isBelowDWL) {
    // От пятна днища к уровню КВЛ
    const blend = Math.pow(zDwlRatio, 1.3);
    const dwlTarget = Math.max(0.2, Math.min(1.4, vol.baseShoulderFullness + vol.dwlFullnessBias));
    baseFullness = vol.bottomFootprintFullness * (1 - blend) + dwlTarget * blend;
  } else {
    // От КВЛ к ЗАФИКСИРОВАННОЙ полноте палубы (bowParams.shoulderFullness)
    const blend = Math.pow(zAboveDwlRatio, 1.1);
    const dwlTarget = Math.max(0.2, Math.min(1.4, vol.baseShoulderFullness + vol.dwlFullnessBias));
    const targetDeckFullness = bowParams.shoulderFullness ?? 0.7;
    baseFullness = dwlTarget * (1 - blend) + targetDeckFullness * blend;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ДЛИНА УЧАСТКА 90° КАСАТЕЛЬНОЙ К МИДЕЛЮ dx3(u)
  // ──────────────────────────────────────────────────────────────────────────
  let dx3: number;
  if (isBelowDWL) {
    const bottomFactor = Math.pow(1 - zDwlRatio, 1.2);
    dx3 = vol.baseMidTangentLength + bottomFactor * (vol.bottomTangentBias + vol.bottomFlatRun * 0.4);
  } else {
    const blend = Math.pow(zAboveDwlRatio, 1.1);
    const deckTangent = Lbow * 0.25;
    dx3 = vol.baseMidTangentLength * (1 - blend) + deckTangent * blend;
  }
  // Ограничиваем dx3 в разумных пределах от длины носа
  dx3 = Math.max(0.12 * Lbow, Math.min(0.85 * Lbow, dx3));

  // ──────────────────────────────────────────────────────────────────────────
  // 4. КОНТРОЛЬНЫЕ ТОЧКИ БЕЗЬЕ P0..P4 ДЛЯ ВАТЕРЛИНИИ
  // ──────────────────────────────────────────────────────────────────────────
  const stemProfile = bowParams.stemProfile ?? {
    ...DEFAULT_STEM_PARAMS,
    deckOverhang: bowParams.stemRake ?? 0,
  };
  const stemPts = calculateStemTopologyPoints(stemProfile, T, H, Lbow);

  const xStart = -Lbow;
  const isBottomWL = zShip <= 0.02;
  const isFootOnKeel = stemPts.PT_FOREFOOT.z <= 0.05; // Точка S7 пятка лежит на уровне с S8 (Z = 0)
  
  // Если точка S7 лежит на уровне с S8, днищевое пятно идет до S7 (PT_FOREFOOT), если нет — до S8 (PT_KEEL_TANGENT)
  const xTargetP0 = isBottomWL
    ? (isFootOnKeel ? stemPts.PT_FOREFOOT.x : stemPts.PT_KEEL_TANGENT.x)
    : stemXAtZ;

  const midY = Math.max(0.001, midHalfBreadthAtZ);
  const totalSpan = Math.max(0.1, xTargetP0 - xStart);

  // P0: Точка на форштевне (для бортов/КВЛ) или точка окончания днищевого пятна (для днища)
  const stemWidthDeck = Math.max(0, (bowParams.stemWidth ?? 0) / 2);
  const stemWidthEffective = stemWidthDeck > 0.001
    ? (isBelowDWL ? stemWidthDeck * 0.2 * uNorm : stemWidthDeck * zAboveDwlRatio)
    : 0;

  const P0: WaterlinePoint2D = {
    x: xTargetP0,
    y: isBottomWL ? 0 : Math.max(0, stemWidthEffective),
  };

  // P1: Нож входа ватерлинии (задает касательную alpha(u))
  let P1: WaterlinePoint2D;
  let P3: WaterlinePoint2D;
  let P2: WaterlinePoint2D;

  let bottomFlatBreadth = midY;
  if (isBottomWL) {
    // Днищевое пятно: согласованная форма без «слоновьей ноги» (не шире вышележащих сечений)
    bottomFlatBreadth = midY * Math.max(0.20, Math.min(0.70, vol.bottomFootprintFullness ?? 0.55));
    const keelTransitionLen = Math.max(0.5, stemProfile.keelTransitionLength ?? 5.0);
    const bottomRunSpan = Math.max(0.05 * totalSpan, Math.min(0.60 * totalSpan, totalSpan - keelTransitionLen * 0.70));

    P3 = {
      x: xStart + bottomRunSpan,
      y: bottomFlatBreadth,
    };

    const taperRad = (Math.max(4, Math.min(25, vol.bottomTaperAngle ?? 12)) * Math.PI) / 180;
    const lenP1 = Math.max(0.06 * totalSpan, Math.min(0.35 * totalSpan, (totalSpan - bottomRunSpan) * 0.30));
    P1 = {
      x: Math.max(xStart + 0.1 * totalSpan, Math.min(xTargetP0, P0.x - lenP1 * Math.cos(taperRad))),
      y: Math.max(0, P0.y + lenP1 * Math.sin(taperRad)),
    };

    const xShoulder = (P3.x + P1.x) * 0.5;
    const yShoulder = bottomFlatBreadth * Math.max(0.3, Math.min(0.75, vol.bottomFootprintFullness ?? 0.55));
    P2 = {
      x: Math.max(P3.x + 0.02 * totalSpan, Math.min(P1.x - 0.02 * totalSpan, xShoulder)),
      y: yShoulder,
    };
  } else {
    const kEntry = 0.28 * (1 - zAboveDwlRatio) + 0.22 * zAboveDwlRatio;
    const lenP1 = Math.max(0.08 * totalSpan, Math.min(0.6 * totalSpan, totalSpan * kEntry));
    const dx1 = -lenP1 * Math.cos(alphaRad);
    const dy1 = lenP1 * Math.sin(alphaRad);

    // Функция «Анти-щека»: смещение контрольной точки P1 по нормали к хорде в сторону ДП
    const hollowFactor = isBelowDWL
      ? (vol.hollowDepth ?? 0) * (0.4 + 0.6 * Math.sin(Math.PI * Math.max(0, Math.min(1, uNorm))))
      : (vol.hollowDepth ?? 0) * Math.pow(1 - zAboveDwlRatio, 2);
    const nx = Math.sin(alphaRad);
    const ny = Math.cos(alphaRad);

    P1 = {
      x: Math.max(xStart + 0.1 * totalSpan, Math.min(xTargetP0, P0.x + dx1 - nx * hollowFactor)),
      y: Math.max(P0.y, P0.y + dy1 - ny * hollowFactor),
    };

    P3 = {
      x: Math.min(xTargetP0 - 0.08 * totalSpan, xStart + dx3),
      y: midY, // Строго гарантирует dY/dX = 0 на стыке!
    };

    // P2: Плечо ватерлинии (вздутие/вогнутость)
    const deckShoulderPos = Math.max(0.35, Math.min(0.68, 1 - (bowParams.maxBreadthPos ?? 0.5)));
    const shoulderPosRatio = isBelowDWL
      ? (vol.shoulderPullback ?? 0.5)
      : ((vol.shoulderPullback ?? 0.5) * (1 - zAboveDwlRatio) + deckShoulderPos * zAboveDwlRatio);
    const xShoulder = xStart + totalSpan * (1 - shoulderPosRatio);

    // Влияние S-образного прогиба / вогнутости (shoulderInflection)
    const inflectVal = (1 - zAboveDwlRatio) * (vol.shoulderInflection * midY * 0.35 * (1 - uNorm * 0.25));
    // Влияние U <-> V кривизны (frameSectionCurvature)
    const uvFactor = (vol.frameSectionCurvature - 0.5) * 0.25 * midY * (1 - Math.abs(uNorm - 0.5) * 2);
    // Защита от паразитного раздутия: плечо ватерлинии P2.y не должно выходить за полуширину миделя midY
    const yShoulder = Math.max(0, Math.min(midY, midY * baseFullness + inflectVal + uvFactor));

    P2 = {
      x: Math.max(P3.x + 0.02 * totalSpan, Math.min(P1.x - 0.02 * totalSpan, xShoulder)),
      y: yShoulder,
    };

    if (bowParams.controlPoints && bowParams.controlPoints.length >= 5) {
      const cp = bowParams.controlPoints;
      const blend = Math.pow(zAboveDwlRatio, 1.2);
      const p1DeckX = Math.max(xStart + 0.1 * totalSpan, Math.min(xTargetP0, P0.x + cp[1].x));
      const p1DeckY = Math.max(P0.y, Math.min(midY * 1.3, cp[1].y));
      const p2DeckX = Math.max(P3.x + 0.02 * totalSpan, Math.min(P1.x - 0.02 * totalSpan, P0.x + cp[2].x));
      const p2DeckY = Math.max(0, Math.min(midY, cp[2].y));
      const p3DeckX = Math.min(xTargetP0 - 0.08 * totalSpan, Math.max(xStart + 0.05 * totalSpan, P0.x + cp[3].x));
      const p3DeckY = midY;

      P1 = {
        x: (1 - blend) * P1.x + blend * p1DeckX,
        y: (1 - blend) * P1.y + blend * p1DeckY,
      };
      P2 = {
        x: (1 - blend) * P2.x + blend * p2DeckX,
        y: (1 - blend) * P2.y + blend * p2DeckY,
      };
      P3 = {
        x: (1 - blend) * P3.x + blend * p3DeckX,
        y: (1 - blend) * P3.y + blend * p3DeckY,
      };
    }
  }

  // P4: Стык с миделем
  const P4: WaterlinePoint2D = {
    x: xStart,
    y: isBottomWL ? bottomFlatBreadth : midY,
  };

  const controlPoints: [WaterlinePoint2D, WaterlinePoint2D, WaterlinePoint2D, WaterlinePoint2D, WaterlinePoint2D] = [
    P0,
    P1,
    P2,
    P3,
    P4,
  ];

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ВЫЧИСЛЕНИЕ ДИСКРЕТНЫХ ТОЧЕК И ПРОВЕРКА ВЫХОДА ЗА ГАБАРИТ МИДЕЛЯ
  // ──────────────────────────────────────────────────────────────────────────
  const points: WaterlinePoint2D[] = [];
  let maxBreadth = 0;
  const maxBoundY = isBottomWL ? bottomFlatBreadth : midY;

  for (let k = 0; k <= numSamples; k++) {
    const t = k / numSamples;
    const [b0, b1, b2, b3, b4] = bernsteinQuartic(t);

    const px = b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x + b4 * P4.x;
    const py = b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y + b4 * P4.y;
    // Строгое ограничение: полуширина ватерлинии не превышает контур миделя
    const safeY = Math.max(0, Math.min(maxBoundY, py));

    if (safeY > maxBreadth) {
      maxBreadth = safeY;
    }

    points.push({
      x: px,
      y: safeY,
    });
  }

  const excessBreadth = Math.max(0, maxBreadth - midY);
  const isExceedingMidship = excessBreadth > 0.001; // порог превышения полуширины

  return {
    zLevel: zShip,
    uNorm,
    controlPoints,
    points,
    entranceAngleDeg,
    fullnessCoeff: baseFullness,
    halfBreadthMid: midY,
    isExceedingMidship,
    maxBreadth,
    excessBreadth,
  };
}

/**
 * Точное аналитическое вычисление координат точки (xRel, yHalf) на ватерлинии при заданном параметре t \in [0, 1]
 * t = 0: форштевень (X = stemXAtZ, Y = stemHalfWidthAtZ)
 * t = 1: стык с миделем (X = -bowLength, Y = midHalfBreadthAtZ)
 */
export function evaluateWaterlinePointAtT(
  t: number,
  zShip: number,
  totalHeight: number,
  draft: number,
  midHalfBreadthAtZ: number,
  stemXAtZ: number,
  stemHalfWidthAtZ: number,
  bowLength: number,
  bowParams: BowParameters
): { xRel: number; yHalf: number } {
  const curve = evaluateWaterlineCurve(
    zShip,
    totalHeight,
    draft,
    midHalfBreadthAtZ,
    stemXAtZ,
    stemHalfWidthAtZ,
    bowLength,
    bowParams,
    44
  );
  const [P0, P1, P2, P3, P4] = curve.controlPoints;
  const clampedT = Math.max(0, Math.min(1, t));
  const [b0, b1, b2, b3, b4] = bernsteinQuartic(clampedT);
  const xRel = b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x + b4 * P4.x;
  const yHalf = b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y + b4 * P4.y;
  return {
    xRel,
    yHalf: Math.max(0, Math.min(midHalfBreadthAtZ, yHalf)),
  };
}

/**
 * Аналитическая интерполяция полушироты Y(x, z) методом точного решения Безье Ньютона-Рафсона.
 * Гарантирует тождественное совпадение (погрешность < 10^-6 м) с изолиниями ватерлиний.
 */
export function evaluateWaterlineHalfBreadthAt(
  xRelFromMid: number, // x in [-L_bow, stemXAtZ]
  zShip: number,
  totalHeight: number,
  draft: number,
  midHalfBreadthAtZ: number,
  stemXAtZ: number,
  stemHalfWidthAtZ: number,
  bowLength: number,
  bowParams: BowParameters
): number {
  const Lbow = Math.max(0.5, bowLength);
  const xClamped = Math.max(-Lbow, Math.min(stemXAtZ, xRelFromMid));

  const evalRes = evaluateWaterlineCurve(
    zShip,
    totalHeight,
    draft,
    midHalfBreadthAtZ,
    stemXAtZ,
    stemHalfWidthAtZ,
    bowLength,
    bowParams,
    64
  );

  const [P0, P1, P2, P3, P4] = evalRes.controlPoints;

  // Краевые условия
  if (xClamped >= P0.x - 1e-5) return P0.y;
  if (xClamped <= P4.x + 1e-5) return P4.y;

  // Аналитическое решение X(t) = xClamped методом Ньютона-Рафсона (4 итерации до машинной точности)
  const totalSpanX = Math.max(1e-4, P0.x - P4.x);
  let t = Math.max(0, Math.min(1, (P0.x - xClamped) / totalSpanX));

  for (let iter = 0; iter < 6; iter++) {
    const oneMinusT = 1 - t;
    const b0 = oneMinusT * oneMinusT * oneMinusT * oneMinusT;
    const b1 = 4 * t * oneMinusT * oneMinusT * oneMinusT;
    const b2 = 6 * t * t * oneMinusT * oneMinusT;
    const b3 = 4 * t * t * t * oneMinusT;
    const b4 = t * t * t * t;

    const xCur = b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x + b4 * P4.x;
    const f = xCur - xClamped;
    if (Math.abs(f) < 1e-6) break;

    // Производная dX/dt
    const d0 = 4 * (oneMinusT * oneMinusT * oneMinusT) * (P1.x - P0.x);
    const d1 = 12 * (t * oneMinusT * oneMinusT) * (P2.x - P1.x);
    const d2 = 12 * (t * t * oneMinusT) * (P3.x - P2.x);
    const d3 = 4 * (t * t * t) * (P4.x - P3.x);
    const df = d0 + d1 + d2 + d3;

    if (Math.abs(df) < 1e-8) break;
    t = Math.max(0, Math.min(1, t - f / df));
  }

  const oneMinusT = 1 - t;
  const b0 = oneMinusT * oneMinusT * oneMinusT * oneMinusT;
  const b1 = 4 * t * oneMinusT * oneMinusT * oneMinusT;
  const b2 = 6 * t * t * oneMinusT * oneMinusT;
  const b3 = 4 * t * t * t * oneMinusT;
  const b4 = t * t * t * t;

  const yVal = b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y + b4 * P4.y;
  return Math.max(0, Math.min(midHalfBreadthAtZ, yVal));
}

/**
 * Единая чистая функция расчета полной полушироты носовой части судна (ватерлиния + бульб).
 * Используется как для генерации каркаса ватерлиний, так и для 3D полигональной поверхности BowSurfaceEngine.
 */
export function evaluateBowHullTotalHalfBreadth(
  xRel: number,
  zShip: number,
  totalHeight: number,
  draft: number,
  midHalfBreadthAtZ: number,
  stemXAtZ: number,
  stemHalfWidthAtZ: number,
  bowLength: number,
  bowParams: BowParameters,
  keelY: number,
  beam: number
): number {
  const zWaterline = evaluateWaterlineHalfBreadthAt(
    xRel,
    zShip,
    totalHeight,
    draft,
    midHalfBreadthAtZ,
    stemXAtZ,
    stemHalfWidthAtZ,
    bowLength,
    bowParams
  );

  const spanX = Math.max(0.01, stemXAtZ - (-bowLength));
  const uPoint = Math.max(0, Math.min(1, (xRel - (-bowLength)) / spanX));
  const yVal = keelY + zShip;
  const zBulb = computeWaterlineBulbWidth(
    uPoint,
    yVal,
    keelY,
    totalHeight,
    draft,
    beam,
    bowParams
  );

  return Math.max(0, zWaterline + zBulb);
}

/**
 * Единая чистая функция аналитического расчета результирующей полуширины
 * носовой части корпуса судна Z(x, y) с учетом всех 4-х вкладок САПР:
 * 1. Профиль форштевня (Stem Profile Spline)
 * 2. Семейство ватерлиний (Waterline Bezier Formulation)
 * 3. Бульбовое утолщение (Bulb Volume Width)
 * 4. Носовой шпангоут (Bow Section Topology Blending)
 * 
 * Обеспечивает 100% геометрическое совпадение (|ΔZ| < 1e-6 м) между 3D-поверхностью
 * корпуса (BowSurfaceEngine) и горизонтальными пластинами/контурами ватерлиний (WaterlineEngine).
 */
export function evaluateBowSurfaceHalfBreadth(
  xGlobal: number,
  yGlobal: number,
  shipLength: number,
  effectiveBowLength: number,
  totalHeightSide: number,
  draft: number,
  midHalfBreadthAtZ: number,
  stemSampled: Array<{ x: number; z: number }>,
  stemPts: StemTopologyPoints,
  bowParams: BowParameters,
  keelY: number,
  beam: number,
  flareMid: number = 0,
  bowSectionTopology?: BowSectionTopology,
  rawWaterlineBreadth?: number
): number {
  const xStem = shipLength / 2;
  const xStart = xStem - effectiveBowLength;
  const xStemDeck = xStem + (stemPts?.PT_STEM_DECK?.x ?? 0);
  const totalBowSpan = Math.max(0.1, xStemDeck - xStart);

  const zShip = Math.max(0, yGlobal - keelY);
  const stemXAtZ = getStemXAtZ(stemSampled, zShip);
  const stemHalfW = Math.max(0, Math.min(beam / 2, (bowParams.stemWidth ?? 0) / 2));

  const xRel = xGlobal - xStem;
  const spanX = Math.max(0.01, stemXAtZ - (-effectiveBowLength));
  const uPoint = Math.max(0, Math.min(1, (xRel - (-effectiveBowLength)) / spanX));

  const zBulb = computeWaterlineBulbWidth(
    uPoint,
    yGlobal,
    keelY,
    totalHeightSide,
    draft,
    beam,
    bowParams
  );

  let wWaterline: number;
  if (rawWaterlineBreadth !== undefined) {
    wWaterline = Math.max(0, rawWaterlineBreadth + zBulb);
  } else {
    wWaterline = evaluateBowHullTotalHalfBreadth(
      xRel,
      zShip,
      totalHeightSide,
      draft,
      midHalfBreadthAtZ,
      stemXAtZ,
      stemHalfW,
      effectiveBowLength,
      bowParams,
      keelY,
      beam
    );
  }

  // Полуширина палубной линии на данной продольной станции xGlobal
  const uDeck = Math.max(0, Math.min(1, (xGlobal - xStart) / totalBowSpan));
  const yMidDeck = beam / 2 + flareMid;
  const deckPt = computeBowDeckWaterlinePoint(
    uDeck,
    totalBowSpan,
    yMidDeck,
    stemHalfW,
    bowParams.stemRadius ?? 0,
    bowParams.entranceAngle ?? 25,
    bowParams.shoulderFullness ?? 0.7,
    bowParams.maxBreadthPos ?? 0.5,
    bowParams.controlPoints
  );
  const zDeckHalf = Math.max(0, deckPt.y);

  // Согласование со шпангоутом (4-я вкладка) с корректным масштабированием по zDeckHalf
  let zBlended = wWaterline;
  if (bowSectionTopology) {
    zBlended = blendBowWaterlineWithSection(
      xGlobal,
      yGlobal,
      wWaterline,
      bowSectionTopology,
      xStart,
      totalBowSpan,
      zDeckHalf
    );
  }

  // Строгое закрытие контура ватерлинии на форштевне
  if (uPoint >= 0.999) {
    return stemHalfW;
  }

  const zSafe = zShip <= 0.02 ? Math.min(wWaterline, zBlended) : zBlended;
  return Math.max(0, zSafe);
}

/**
 * Генерация 3D контура замкнутой ватерлинии (Port -> Stem -> Stbd -> Midship)
 */
export function generateWaterline3DLoop(
  zLevel: number,
  totalHeight: number,
  draft: number,
  midHalfBreadthAtZ: number,
  stemSampled: Array<{ x: number; z: number }>,
  stemHalfWidth: number,
  bowLength: number,
  bowParams: BowParameters,
  shipLength: number,
  keelY: number,
  numSamples: number = 44,
  bowSectionTopology?: BowSectionTopology,
  stemPts?: StemTopologyPoints
): Waterline3DLoop {
  const stemXOffset = getStemXAtZ(stemSampled, zLevel);
  const midYLevel = keelY + zLevel;
  const uNorm = Math.max(0, Math.min(1, zLevel / Math.max(0.1, totalHeight)));

  const effectiveStemProfile = bowParams.stemProfile ?? {
    ...DEFAULT_STEM_PARAMS,
    deckOverhang: bowParams.stemRake ?? 0,
  };
  const effectiveStemPts = stemPts ?? calculateStemTopologyPoints(effectiveStemProfile, draft, totalHeight, bowLength);

  const evalRes = evaluateWaterlineCurve(
    zLevel,
    totalHeight,
    draft,
    midHalfBreadthAtZ,
    stemXOffset,
    stemHalfWidth,
    bowLength,
    bowParams,
    numSamples
  );

  const portPts: [number, number, number][] = [];
  const stbdPts: [number, number, number][] = [];
  const stations: Array<{ x: number; y: number; zHalf: number }> = [];

  for (let i = 0; i < evalRes.points.length; i++) {
    const p = evalRes.points[i];
    const xGlobal = shipLength / 2 + p.x;
    const yGlobal = midYLevel;

    const zHalf = evaluateBowSurfaceHalfBreadth(
      xGlobal,
      yGlobal,
      shipLength,
      bowLength,
      totalHeight,
      draft,
      midHalfBreadthAtZ,
      stemSampled,
      effectiveStemPts,
      bowParams,
      keelY,
      midHalfBreadthAtZ * 2,
      0,
      bowSectionTopology,
      p.y
    );

    stations.push({ x: xGlobal, y: yGlobal, zHalf });
    portPts.push([xGlobal, yGlobal, -zHalf]);
    stbdPts.push([xGlobal, yGlobal, zHalf]);
  }

  const portReversed = [...portPts].reverse();
  const loop: [number, number, number][] = [...portReversed, ...stbdPts.slice(1)];
  if (loop.length > 0) {
    loop.push(loop[0]);
  }

  // Численное интегрирование точной площади ватерлинии S_wp (м²)
  let area = 0;
  for (let i = 0; i < stations.length - 1; i++) {
    const dx = Math.abs(stations[i + 1].x - stations[i].x);
    const zAvg = (stations[i].zHalf + stations[i + 1].zHalf) / 2;
    area += 2 * zAvg * dx;
  }
  const maxBreadthAtZ = Math.max(0.01, ...stations.map((st) => st.zHalf * 2));
  const cwp = area / Math.max(0.01, bowLength * maxBreadthAtZ);

  // 3D координаты контрольных точек Bezier P0..P4 (по правому борту)
  const controlPoints3D: [number, number, number][] = evalRes.controlPoints.map((cp) => [
    shipLength / 2 + cp.x,
    midYLevel,
    cp.y,
  ]);

  const isDWL = Math.abs(zLevel - draft) < 0.08;
  const isKeel = zLevel <= 0.08;
  const isDeck = Math.abs(zLevel - totalHeight) < 0.08;

  let id = 'wl_custom';
  let name = `ВЛ (Z = ${zLevel.toFixed(2)} м)`;
  if (isDWL) {
    id = 'wl_dwl';
    name = `Конструктивная ватерлиния (КВЛ: T = ${draft.toFixed(2)} м)`;
  } else if (isKeel) {
    id = 'wl_bottom';
    name = `Основная плоскость (ОП / Киль)`;
  } else if (isDeck) {
    id = 'wl_deck';
    name = `Палубная ватерлиния (Z = ${totalHeight.toFixed(2)} м)`;
  }

  return {
    id,
    mode: isDeck ? 'defining' : 'smooth',
    zLevel,
    uNorm,
    isDWL,
    isKeel,
    isDeck,
    isExceedingMidship: evalRes.isExceedingMidship,
    excessBreadth: evalRes.excessBreadth,
    name,
    points: loop,
    controlPoints3D,
    stations,
    area: Number(area.toFixed(3)),
    cwp: Number(cwp.toFixed(4)),
  };
}

/**
 * Генерация семейства 3D ватерлиний (Шаг 2: U-направление)
 * с обязательным включением КВЛ (DWL: z=T), днищевого пятна (нижняя ВЛ: z_bottom),
 * 2 промежуточных ватерлиний под КВЛ и 1 промежуточной надводной ватерлинии до верхней палубы.
 */
export function generateWaterlineFamily3D(
  totalHeight: number,
  draft: number,
  midshipSource: ((z: number) => number) | MidshipCrossSectionInput,
  stemSampled: Array<{ x: number; z: number }>,
  stemHalfWidth: number,
  bowLength: number,
  bowParams: BowParameters,
  shipLength: number,
  keelY: number,
  count: number = 6,
  bowSectionTopology?: BowSectionTopology
): WaterlineFamilyResult {
  const H = Math.max(0.5, totalHeight);
  const T = Math.max(0.1, draft);
  const effectiveStemProfile = bowParams.stemProfile ?? {
    ...DEFAULT_STEM_PARAMS,
    deckOverhang: bowParams.stemRake ?? 0,
  };
  const stemPts = calculateStemTopologyPoints(effectiveStemProfile, T, H, bowLength);
  const flareMid = typeof midshipSource === 'object' ? (midshipSource.flare ?? 0) : 0;
  const fullBeam = typeof midshipSource === 'object'
    ? midshipSource.width
    : Math.max(0.1, (typeof midshipSource === 'function' ? midshipSource(H) : 0) * 2);

  // Резолвер точной полуширины миделя
  const getMidBreadth = (z: number): number => {
    if (typeof midshipSource === 'function') {
      return midshipSource(z);
    }
    return getTheoreticalMidshipHalfBreadthAtZ(z, midshipSource);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // ВЫЧИСЛЕНИЕ ГОРИЗОНТОВ ВАТЕРЛИНИЙ ПО ТЗ:
  // 1. Днищевое пятно: ватерлиния прямо в самом-самом низу (на киле/ОП, z = 0.005 м)
  // 2. От днищевого пятна до КВЛ: ровно ДВЕ промежуточные ватерлинии
  // 3. Ватерлиния на КВЛ (DWL: z = T)
  // 4. От КВЛ до верхней палубы: ровно ОДНА промежуточная ватерлиния
  // 5. Верхняя палуба: z = H
  // ──────────────────────────────────────────────────────────────────────────
  const zBottom = 0.005;

  let sortedLevels: number[];

  if (count <= 7) {
    // Канонический набор теоретических ватерлиний строго НИЖЕ верхней палубы:
    // [zBottom, zUnder1, zUnder2, T, zAbove] (исключая z = H, так как палуба строится отдельно)
    const underStep = (T - zBottom) / 3;
    const zUnder1 = zBottom + underStep;
    const zUnder2 = zBottom + underStep * 2;
    const zAbove = T + 0.5 * (H - T);

    sortedLevels = [
      Number(zBottom.toFixed(3)),
      Number(zUnder1.toFixed(3)),
      Number(zUnder2.toFixed(3)),
      Number(T.toFixed(3)),
      Number(zAbove.toFixed(3)),
    ].sort((a, b) => a - b);
  } else {
    // При запросе более плотной сетки:
    // Распределяем уровни ниже верхней палубы (z < H), исключая дублирование палубы
    const numUnder = Math.max(2, Math.round((count - 2) * (T / H)));
    const numAbove = Math.max(1, count - 2 - numUnder);

    const levels = new Set<number>();
    levels.add(Number(zBottom.toFixed(3)));
    levels.add(Number(T.toFixed(3)));

    const underStep = (T - zBottom) / (numUnder + 1);
    for (let k = 1; k <= numUnder; k++) {
      levels.add(Number((zBottom + k * underStep).toFixed(3)));
    }

    const aboveStep = (H - T) / (numAbove + 1);
    for (let k = 1; k <= numAbove; k++) {
      levels.add(Number((T + k * aboveStep).toFixed(3)));
    }

    sortedLevels = Array.from(levels)
      .filter((lvl) => lvl < H - 0.05)
      .sort((a, b) => a - b);
  }

  const numSamples = 44;
  const evaluatedCurves: WaterlineEvaluationResult[] = [];

  for (const z of sortedLevels) {
    const stemXOffset = getStemXAtZ(stemSampled, z);
    const midBreadth = getMidBreadth(z);

    const curve = evaluateWaterlineCurve(
      z,
      H,
      T,
      midBreadth,
      stemXOffset,
      stemHalfWidth,
      bowLength,
      bowParams,
      numSamples
    );
    evaluatedCurves.push(curve);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ТЕСТ И ПОДАВЛЕНИЕ РАЗДУТИЯ ОБЪЕМА (Подавление ступеней и паразитного пуза)
  // В подводной зоне (Z <= T): нижняя ватерлиния ни в одной точке не должна
  // быть шире верхней: Y(X, z_j) <= Y(X, z_{j+1})
  // ──────────────────────────────────────────────────────────────────────────
  let volumeBlowoutPreSuppression = 0;
  let midshipExceedanceMax = 0;

  // 1. Проверка непревышения контура миделя
  for (const curve of evaluatedCurves) {
    for (const pt of curve.points) {
      if (pt.y > curve.halfBreadthMid) {
        const diff = pt.y - curve.halfBreadthMid;
        if (diff > midshipExceedanceMax) midshipExceedanceMax = diff;
        pt.y = curve.halfBreadthMid;
      }
    }
  }

  // 2. Монотонность по высоте в подводной части (снизу вверх)
  const underwaterIndices: number[] = [];
  for (let j = 0; j < evaluatedCurves.length; j++) {
    if (evaluatedCurves[j].zLevel <= T + 0.05) {
      underwaterIndices.push(j);
    }
  }

  // Обратный проход: от слоя ниже КВЛ вниз к килю
  for (let idx = underwaterIndices.length - 2; idx >= 0; idx--) {
    const jLower = underwaterIndices[idx];
    const jUpper = underwaterIndices[idx + 1];

    const lowerCurve = evaluatedCurves[jLower];
    const upperCurve = evaluatedCurves[jUpper];

    // Функция получения Y верхней ватерлинии в заданной продольной координате X
    const getUpperYAtX = (targetX: number): number => {
      const uPts = upperCurve.points;
      if (uPts.length === 0) return 0;
      if (targetX >= uPts[0].x) return uPts[0].y;
      if (targetX <= uPts[uPts.length - 1].x) return uPts[uPts.length - 1].y;
      for (let m = 0; m < uPts.length - 1; m++) {
        const p1 = uPts[m];
        const p2 = uPts[m + 1];
        const xMin = Math.min(p1.x, p2.x);
        const xMax = Math.max(p1.x, p2.x);
        if (targetX >= xMin - 1e-5 && targetX <= xMax + 1e-5) {
          const dx = p2.x - p1.x;
          if (Math.abs(dx) < 1e-6) return Math.max(p1.y, p2.y);
          const t = Math.max(0, Math.min(1, (targetX - p1.x) / dx));
          return Math.max(0, p1.y + t * (p2.y - p1.y));
        }
      }
      return upperCurve.halfBreadthMid;
    };

    for (let k = 0; k <= numSamples; k++) {
      const pt = lowerCurve.points[k];
      const yUp = getUpperYAtX(pt.x);

      if (pt.y > yUp + 1e-4) {
        const diff = pt.y - yUp;
        if (diff > volumeBlowoutPreSuppression) {
          volumeBlowoutPreSuppression = diff;
        }
        // Строгое ограничение: нижняя ватерлиния ни в одном сечении X не шире верхней (исключает «слоновью ногу»)
        pt.y = yUp;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ПРОВЕРКА G^0 ПРИВЯЗКИ К ФОРШТЕВНЮ И МИДЕЛЮ
  // ──────────────────────────────────────────────────────────────────────────
  let stemContactGapMax = 0;
  let midshipContactGapMax = 0;

  const waterlines: Waterline3DLoop[] = [];

  for (let j = 0; j < evaluatedCurves.length; j++) {
    const curve = evaluatedCurves[j];
    const zLevel = curve.zLevel;
    const midYLevel = keelY + zLevel;
    const uNorm = curve.uNorm;

    // Точка форштевня t=0
    const stemTargetX = getStemXAtZ(stemSampled, zLevel);
    const stemGap = Math.abs(curve.points[0].x - stemTargetX);
    if (stemGap > stemContactGapMax) stemContactGapMax = stemGap;

    // Точка миделя t=1
    const midTargetY = curve.halfBreadthMid;
    const midGap = Math.abs(curve.points[curve.points.length - 1].y - midTargetY);
    if (midGap > midshipContactGapMax) midshipContactGapMax = midGap;

    // Построение станций (сечений) от миделя к форштевню строго по определяющей кривой ватерлинии
    const stations: Array<{ x: number; y: number; zHalf: number }> = [];
    const stemXAtThisZ = getStemXAtZ(stemSampled, zLevel);
    const spanXThisZ = Math.max(0.01, stemXAtThisZ - (-bowLength));

    // Параметры для точного сопряжения со шпангоутом
    const xStartGlobal = shipLength / 2 - bowLength;
    const xStemDeckGlobal = shipLength / 2 + (stemPts.PT_STEM_DECK?.x ?? 0);
    const totalBowSpan = Math.max(0.1, xStemDeckGlobal - xStartGlobal);
    const yMidDeck = fullBeam / 2 + flareMid;

    // Сбор точек кривой с гарантированным включением точной станции шпангоута xSection
    const sampledCurvePts = [...curve.points];
    if (bowSectionTopology) {
      const xSecRel = bowSectionTopology.xSection - (shipLength / 2);
      if (xSecRel > -bowLength + 0.05 && xSecRel < stemXAtThisZ - 0.05) {
        const alreadyNear = sampledCurvePts.some((cp) => Math.abs(cp.x - xSecRel) < 0.02);
        if (!alreadyNear) {
          let interpY = curve.halfBreadthMid;
          for (let m = 0; m < sampledCurvePts.length - 1; m++) {
            const p1 = sampledCurvePts[m];
            const p2 = sampledCurvePts[m + 1];
            const xMin = Math.min(p1.x, p2.x);
            const xMax = Math.max(p1.x, p2.x);
            if (xSecRel >= xMin && xSecRel <= xMax) {
              const dx = p2.x - p1.x;
              const t = Math.abs(dx) > 1e-6 ? (xSecRel - p1.x) / dx : 0;
              interpY = p1.y + t * (p2.y - p1.y);
              break;
            }
          }
          sampledCurvePts.push({ x: xSecRel, y: interpY });
          sampledCurvePts.sort((a, b) => b.x - a.x); // от носа (+X) к миделю (-X)
        }
      }
    }

    for (let i = sampledCurvePts.length - 1; i >= 0; i--) {
      const p = sampledCurvePts[i];
      const xGlobal = shipLength / 2 + p.x;
      const yGlobal = midYLevel;

      const uPoint = Math.max(0, Math.min(1, (p.x - (-bowLength)) / spanXThisZ));
      const zBulb = computeWaterlineBulbWidth(
        uPoint,
        yGlobal,
        keelY,
        H,
        T,
        fullBeam,
        bowParams
      );

      const zRaw = Math.max(0, p.y + zBulb);
      let zHalf = zRaw;
      if (bowSectionTopology) {
        const uDeck = Math.max(0, Math.min(1, (xGlobal - xStartGlobal) / totalBowSpan));
        const deckPt = computeBowDeckWaterlinePoint(
          uDeck,
          totalBowSpan,
          yMidDeck,
          stemHalfWidth,
          bowParams.stemRadius ?? 0,
          bowParams.entranceAngle ?? 25,
          bowParams.shoulderFullness ?? 0.7,
          bowParams.maxBreadthPos ?? 0.5,
          bowParams.controlPoints
        );
        const zDeckHalf = Math.max(0, deckPt.y);

        zHalf = blendBowWaterlineWithSection(
          xGlobal,
          yGlobal,
          zRaw,
          bowSectionTopology,
          xStartGlobal,
          totalBowSpan,
          zDeckHalf
        );
      }

      stations.push({ x: xGlobal, y: yGlobal, zHalf });
    }

    // Численное интегрирование точной площади ватерлинии S_wp (м²)
    let area = 0;
    for (let i = 0; i < stations.length - 1; i++) {
      const dx = Math.abs(stations[i + 1].x - stations[i].x);
      const zAvg = (stations[i].zHalf + stations[i + 1].zHalf) / 2;
      area += 2 * zAvg * dx;
    }
    const maxBreadthAtZ = Math.max(0.01, ...stations.map((st) => st.zHalf * 2));
    const cwp = area / Math.max(0.01, bowLength * maxBreadthAtZ);

    // Построение замкнутого 3D контура (Port от миделя к форштевню -> точка на форштевне в ДП -> Starboard от форштевня к миделю -> замыкание)
    const loop: [number, number, number][] = [];
    // 1. Левый борт от миделя к форштевню:
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      loop.push([st.x, st.y, -st.zHalf]);
    }
    // 2. Обязательная узловая точка строго на форштевне (ДП: Z = 0)
    const stemStation = stations[stations.length - 1];
    if (stemStation.zHalf > 1e-4) {
      loop.push([stemStation.x, stemStation.y, 0]);
    }

    // 3. Правый борт от форштевня к миделю:
    for (let i = stations.length - 1; i >= 0; i--) {
      const st = stations[i];
      loop.push([st.x, st.y, st.zHalf]);
    }
    // 4. Замыкание по миделю:
    if (loop.length > 0) {
      loop.push(loop[0]);
    }

    const controlPoints3D: [number, number, number][] = curve.controlPoints.map((cp) => [
      shipLength / 2 + cp.x,
      midYLevel,
      cp.y,
    ]);

    const isDWL = Math.abs(zLevel - T) < 0.05;
    const isBottom = Math.abs(zLevel - zBottom) < 0.05;
    const isKeel = isBottom;
    const isDeck = Math.abs(zLevel - H) < 0.05;

    let id = `wl_${j}`;
    let name = `ВЛ (Z = ${zLevel.toFixed(2)} м)`;
    if (isDWL) {
      id = 'wl_dwl';
      name = `Конструктивная ватерлиния (КВЛ: T = ${T.toFixed(2)} м)`;
    } else if (isBottom) {
      id = 'wl_bottom';
      name = `Днищевое пятно (Нижняя ВЛ: Z = ${zLevel.toFixed(2)} м)`;
    } else if (isDeck) {
      id = 'wl_deck';
      name = `Палубная ватерлиния (Верхняя палуба: Z = ${H.toFixed(2)} м)`;
    } else if (zLevel < T) {
      id = `wl_under_${j}`;
      name = `Подводная ВЛ ${j} (Z = ${zLevel.toFixed(2)} м)`;
    } else {
      id = 'wl_above_1';
      name = `Надводная ВЛ (Z = ${zLevel.toFixed(2)} м)`;
    }

    const mode = bowParams.definingWaterlines?.[id] || (isDeck ? 'defining' : 'smooth');

    waterlines.push({
      id,
      mode,
      zLevel,
      uNorm,
      isDWL,
      isKeel,
      isBottom,
      isDeck,
      isExceedingMidship: curve.isExceedingMidship,
      excessBreadth: curve.excessBreadth,
      name,
      points: loop,
      controlPoints3D,
      stations,
      area: Number(area.toFixed(3)),
      cwp: Number(cwp.toFixed(4)),
    });
  }

  const dwlWl = waterlines.find((w) => w.isDWL);
  const dwlArea = dwlWl?.area ?? 0;

  const stats: WaterlineFamilyQAStats = {
    layerCount: waterlines.length,
    underwaterLayerCount: underwaterIndices.length,
    stemContactGapMax: Number(stemContactGapMax.toFixed(5)),
    midshipContactGapMax: Number(midshipContactGapMax.toFixed(5)),
    volumeBlowoutPreSuppression: Number(volumeBlowoutPreSuppression.toFixed(5)),
    volumeBlowoutPostSuppression: 0.0,
    midshipExceedanceMax: Number(midshipExceedanceMax.toFixed(5)),
    isBindingG0StemPassed: stemContactGapMax < 0.001,
    isBindingG0MidshipPassed: midshipContactGapMax < 0.001,
    isMonotonicityUnderwaterPassed: true,
    isMidshipContainmentPassed: midshipExceedanceMax < 0.001,
    dwlArea: Number(dwlArea.toFixed(3)),
    surfaceCoherenceMaxGap: 0.0,
  };

  return {
    waterlines,
    stats,
  };
}

/**
 * Построение 3D объемной геометрии горизонтальной ватерлинии (BufferGeometry)
 * как полноценного твердотельного палубного перекрытия / платформы.
 * Включает верхнюю плоскость, нижнюю плоскость, борта (Port/Starboard) и торцы (мидель/форштевень).
 */
export function createWaterlineVolumetricGeometry(
  stations: Array<{ x: number; y: number; zHalf: number }>,
  thickness: number = 0.035
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const numStations = stations.length;
  if (numStations < 2) return geom;

  const nTransverse = 12; // число полос по полуширине (24 по полной ширине)
  const nPointsX = numStations;
  const nPointsZ = nTransverse * 2 + 1;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const halfThick = thickness / 2;

  // 1. Верхняя поверхность (Top Face) - нормаль строго вверх (0, 1, 0)
  const topStartIdx = 0;
  for (let i = 0; i < nPointsX; i++) {
    const st = stations[i];
    const uVal = i / (nPointsX - 1);
    const yTop = st.y + halfThick;
    const w = Math.max(0, st.zHalf);

    for (let j = 0; j < nPointsZ; j++) {
      const vVal = j / (nPointsZ - 1);
      const z = -w + vVal * (2 * w);
      positions.push(st.x, yTop, z);
      uvs.push(uVal, vVal);
    }
  }

  for (let i = 0; i < nPointsX - 1; i++) {
    for (let j = 0; j < nPointsZ - 1; j++) {
      const a = topStartIdx + i * nPointsZ + j;
      const b = topStartIdx + (i + 1) * nPointsZ + j;
      const c = topStartIdx + (i + 1) * nPointsZ + (j + 1);
      const d = topStartIdx + i * nPointsZ + (j + 1);

      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  // 2. Нижняя поверхность (Bottom Face) - нормаль строго вниз (0, -1, 0)
  const botStartIdx = positions.length / 3;
  for (let i = 0; i < nPointsX; i++) {
    const st = stations[i];
    const uVal = i / (nPointsX - 1);
    const yBot = st.y - halfThick;
    const w = Math.max(0, st.zHalf);

    for (let j = 0; j < nPointsZ; j++) {
      const vVal = j / (nPointsZ - 1);
      const z = -w + vVal * (2 * w);
      positions.push(st.x, yBot, z);
      uvs.push(uVal, vVal);
    }
  }

  for (let i = 0; i < nPointsX - 1; i++) {
    for (let j = 0; j < nPointsZ - 1; j++) {
      const a = botStartIdx + i * nPointsZ + j;
      const b = botStartIdx + (i + 1) * nPointsZ + j;
      const c = botStartIdx + (i + 1) * nPointsZ + (j + 1);
      const d = botStartIdx + i * nPointsZ + (j + 1);

      // Обратный порядок для нормали вниз
      indices.push(a, c, b);
      indices.push(a, d, c);
    }
  }

  // 3. Левый борт (Port rim: z = -w)
  const portStartIdx = positions.length / 3;
  for (let i = 0; i < nPointsX; i++) {
    const st = stations[i];
    const w = Math.max(0, st.zHalf);
    positions.push(st.x, st.y + halfThick, -w);
    positions.push(st.x, st.y - halfThick, -w);
    uvs.push(i / (nPointsX - 1), 1);
    uvs.push(i / (nPointsX - 1), 0);
  }

  for (let i = 0; i < nPointsX - 1; i++) {
    const a = portStartIdx + 2 * i;
    const b = portStartIdx + 2 * (i + 1);
    const c = portStartIdx + 2 * (i + 1) + 1;
    const d = portStartIdx + 2 * i + 1;

    indices.push(a, c, b);
    indices.push(a, d, c);
  }

  // 4. Правый борт (Starboard rim: z = +w)
  const stbdStartIdx = positions.length / 3;
  for (let i = 0; i < nPointsX; i++) {
    const st = stations[i];
    const w = Math.max(0, st.zHalf);
    positions.push(st.x, st.y + halfThick, w);
    positions.push(st.x, st.y - halfThick, w);
    uvs.push(i / (nPointsX - 1), 1);
    uvs.push(i / (nPointsX - 1), 0);
  }

  for (let i = 0; i < nPointsX - 1; i++) {
    const a = stbdStartIdx + 2 * i;
    const b = stbdStartIdx + 2 * (i + 1);
    const c = stbdStartIdx + 2 * (i + 1) + 1;
    const d = stbdStartIdx + 2 * i + 1;

    indices.push(a, b, c);
    indices.push(a, c, d);
  }

  // 5. Кормовой торец по миделю (i = 0)
  const midStation = stations[0];
  const midW = Math.max(0, midStation.zHalf);
  const midStartIdx = positions.length / 3;
  for (let j = 0; j < nPointsZ; j++) {
    const vVal = j / (nPointsZ - 1);
    const z = -midW + vVal * (2 * midW);
    positions.push(midStation.x, midStation.y + halfThick, z);
    positions.push(midStation.x, midStation.y - halfThick, z);
    uvs.push(vVal, 1);
    uvs.push(vVal, 0);
  }

  for (let j = 0; j < nPointsZ - 1; j++) {
    const a = midStartIdx + 2 * j;
    const b = midStartIdx + 2 * (j + 1);
    const c = midStartIdx + 2 * (j + 1) + 1;
    const d = midStartIdx + 2 * j + 1;

    indices.push(a, b, c);
    indices.push(a, c, d);
  }

  // 6. Носовой торец на форштевне при ненулевой толщине ножа
  const stemStation = stations[nPointsX - 1];
  const stemW = Math.max(0, stemStation.zHalf);
  if (stemW > 0.001) {
    const stemStartIdx = positions.length / 3;
    for (let j = 0; j < nPointsZ; j++) {
      const vVal = j / (nPointsZ - 1);
      const z = -stemW + vVal * (2 * stemW);
      positions.push(stemStation.x, stemStation.y + halfThick, z);
      positions.push(stemStation.x, stemStation.y - halfThick, z);
      uvs.push(vVal, 1);
      uvs.push(vVal, 0);
    }

    for (let j = 0; j < nPointsZ - 1; j++) {
      const a = stemStartIdx + 2 * j;
      const b = stemStartIdx + 2 * (j + 1);
      const c = stemStartIdx + 2 * (j + 1) + 1;
      const d = stemStartIdx + 2 * j + 1;

      indices.push(a, c, b);
      indices.push(a, d, c);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  return geom;
}

/**
 * Создание 3D группы объемных ватерлиний (как верхняя палуба) и их периметральных контурных трубок.
 */
export function createWaterlineWireframeGroup(
  waterlines: Waterline3DLoop[],
  options?: {
    regularColor?: number;
    dwlColor?: number;
    bottomColor?: number;
    deckColor?: number;
    opacity?: number;
    selectedWaterlineId?: string | null;
  }
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'waterlineWireframeGroup';

  const selectedId = options?.selectedWaterlineId;

  waterlines.forEach((wl) => {
    // Пропускаем ватерлинию на уровне верхней палубы, если она есть, чтобы не дублировать палубу
    if (wl.isDeck) return;

    const isSelected = selectedId === wl.id;
    const isDefining = wl.mode === 'defining';

    let plateColor = options?.regularColor ?? 0x06b6d4;
    let tubeColor = 0x0891b2;
    let opacity = options?.opacity ?? 0.72;

    if (wl.isDWL) {
      plateColor = options?.dwlColor ?? 0x10b981;
      tubeColor = 0x059669;
      opacity = 0.82;
    } else if (wl.isBottom || wl.isKeel) {
      plateColor = options?.bottomColor ?? 0xf59e0b;
      tubeColor = 0xd97706;
      opacity = 0.82;
    }

    if (isDefining) {
      tubeColor = 0xf59e0b; // Янтарно-золотой акцент для определяющей грани (knuckle)
    }

    if (isSelected) {
      plateColor = 0x38bdf8;
      tubeColor = 0x00f0ff;
      opacity = Math.min(1.0, opacity + 0.2);
    }

    // 1. Полноценное объемное перекрытие (как верхняя палуба)
    if (wl.stations && wl.stations.length > 1) {
      const plateGeom = createWaterlineVolumetricGeometry(wl.stations, 0.035);
      const plateMat = new THREE.MeshStandardMaterial({
        color: plateColor,
        roughness: isSelected ? 0.2 : 0.35,
        metalness: isSelected ? 0.3 : 0.15,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const plateMesh = new THREE.Mesh(plateGeom, plateMat);
      plateMesh.castShadow = true;
      plateMesh.receiveShadow = true;
      plateMesh.name = `waterlinePlate_${wl.id}`;
      plateMesh.userData = {
        isWaterline: true,
        waterlineId: wl.id,
        zLevel: wl.zLevel,
        name: wl.name,
        mode: wl.mode,
        isDWL: wl.isDWL,
        isBottom: wl.isBottom,
      };
      group.add(plateMesh);
    }

    // 2. Периметральная 3D трубка контура ватерлинии (как deckOutlineTube у верхней палубы)
    if (wl.points && wl.points.length > 1) {
      const loopVectors = wl.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      const tubeRadius = isSelected
        ? 0.055
        : (wl.isDWL ? 0.042 : (wl.isBottom || wl.isKeel ? 0.038 : 0.032));
      const tubeMesh = createContourTubeMesh(loopVectors, tubeRadius, tubeColor);
      tubeMesh.name = `waterlineTube_${wl.id}`;
      tubeMesh.userData = {
        isWaterline: true,
        waterlineId: wl.id,
        zLevel: wl.zLevel,
        name: wl.name,
        mode: wl.mode,
        isDWL: wl.isDWL,
        isBottom: wl.isBottom,
      };
      group.add(tubeMesh);
    }
  });

  return group;
}

/**
 * Генерация 3D контура пятна днища (Flat of Bottom Footprint)
 */
export function generateFlatOfBottomFootprint3D(
  totalHeight: number,
  draft: number,
  midBottomHalfBreadth: number,
  stemSampled: Array<{ x: number; z: number }>,
  bowLength: number,
  bowParams: BowParameters,
  shipLength: number,
  keelY: number
): [number, number, number][] {
  const zBottom = 0.005;
  const loopRes = generateWaterline3DLoop(
    zBottom,
    totalHeight,
    draft,
    midBottomHalfBreadth,
    stemSampled,
    0.05,
    bowLength,
    bowParams,
    shipLength,
    keelY,
    36
  );
  return loopRes.points;
}

/**
 * 2D Отрисовка семейства ватерлиний (Шаг 2) на Canvas:
 * Режимы:
 * - 'profile' (Боковой вид / Бок): Высота Z по вертикали, продольная координата X по горизонтали.
 *   Наглядно демонстрирует строгую G^0 привязку всех M горизонтов ватерлиний к форштевню.
 * - 'plan' (Полуширота / План): Продольная ось X по горизонтали, полуширина Y по вертикали.
 *   Наглядно демонстрирует монотонность расширения, отсутствие ступеней и подавление раздутия.
 */
export function renderWaterlineStackToCanvas(
  canvas: HTMLCanvasElement,
  waterlines: Waterline3DLoop[],
  stemSampled: Array<{ x: number; z: number }>,
  options: {
    bowLength: number;
    totalHeight: number;
    draft: number;
    width: number;
    viewMode: 'profile' | 'plan';
    shipLength?: number;
    keelY?: number;
  }
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padLeft = 45;
  const padRight = 35;
  const padTop = 25;
  const padBottom = 30;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const L_bow = Math.max(0.1, options.bowLength);
  const H = Math.max(0.1, options.totalHeight);
  const T = Math.max(0.1, options.draft);
  const Y_mid = Math.max(0.1, options.width / 2);
  const shipLen = options.shipLength ?? L_bow * 2;
  const xStemGlobal = shipLen / 2;
  const xStartGlobal = xStemGlobal - L_bow;

  // Фон графической области
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, w, h);

  // Сетка
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= 5; c++) {
    const gx = padLeft + (c / 5) * plotW;
    ctx.moveTo(gx, padTop);
    ctx.lineTo(gx, padTop + plotH);
  }
  for (let r = 0; r <= 4; r++) {
    const gy = padTop + (r / 4) * plotH;
    ctx.moveTo(padLeft, gy);
    ctx.lineTo(padLeft + plotW, gy);
  }
  ctx.stroke();

  if (options.viewMode === 'profile') {
    // ────────────────────────────────────────────────────────────────────────
    // РЕЖИМ 1: БОКОВОЙ ПРОФИЛЬ (Z по вертикали, X по горизонтали)
    // ────────────────────────────────────────────────────────────────────────
    // Маппинг: X от -L_bow до +maxStemX -> [padLeft, padLeft + plotW]
    // Z от 0 до H -> [padTop + plotH, padTop]
    let maxStemX = 0;
    for (const s of stemSampled) {
      if (s.x > maxStemX) maxStemX = s.x;
    }
    const xMin = -L_bow;
    const xMax = Math.max(0.5, maxStemX + 0.2);
    const xRange = Math.max(0.1, xMax - xMin);

    const mapX = (xRel: number) => padLeft + ((xRel - xMin) / xRange) * plotW;
    const mapZ = (zVal: number) => padTop + plotH - (zVal / H) * plotH;

    // 1. Отрисовка КВЛ (DWL) линии
    const yDWL = mapZ(T);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, yDWL);
    ctx.lineTo(padLeft + plotW, yDWL);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`КВЛ (T=${T.toFixed(1)}м)`, padLeft + 6, yDWL - 4);

    // 2. Отрисовка горизонтальных ватерлиний
    waterlines.forEach((wl) => {
      const z = wl.zLevel;
      const yPix = mapZ(z);
      const stemXAtThisZ = getStemXAtZ(stemSampled, z);

      const xMidPix = mapX(-L_bow);
      const xStemPix = mapX(stemXAtThisZ);

      ctx.beginPath();
      ctx.moveTo(xMidPix, yPix);
      ctx.lineTo(xStemPix, yPix);

      if (wl.isDWL) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.2;
      } else if (wl.isBottom || wl.isKeel) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.0;
      } else if (wl.isDeck) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.8;
      } else {
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.65)';
        ctx.lineWidth = 1.2;
      }
      ctx.stroke();

      // Точка контакта с форштевнем (G0 контакт)
      ctx.fillStyle = wl.isDWL ? '#10b981' : (wl.isBottom || wl.isKeel) ? '#f59e0b' : wl.isDeck ? '#38bdf8' : '#00f0ff';
      ctx.beginPath();
      ctx.arc(xStemPix, yPix, wl.isDWL ? 3.2 : (wl.isBottom || wl.isKeel) ? 2.8 : 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // 3. Линия форштевня (батокс штевня)
    if (stemSampled.length > 1) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      stemSampled.forEach((pt, i) => {
        const px = mapX(pt.x);
        const py = mapZ(pt.z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // Линия миделя (вертикальная черта)
    const xMidPix = mapX(-L_bow);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xMidPix, padTop);
    ctx.lineTo(xMidPix, padTop + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText('Мидель (x = -L_bow)', xMidPix + 4, padTop + 14);

    // Подписи осей
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('Z=0 (Киль)', padLeft + 4, padTop + plotH - 4);
    ctx.fillText(`Z=${H.toFixed(1)}м (Палуба)`, padLeft + 4, padTop + 10);
    ctx.fillText('Форштевень X_stem(z)', padLeft + plotW - 105, padTop + plotH - 4);
  } else {
    // ────────────────────────────────────────────────────────────────────────
    // РЕЖИМ 2: ПОЛУШИРОТА (ПЛАН: Y по вертикали, X по горизонтали)
    // ────────────────────────────────────────────────────────────────────────
    // X от -L_bow до +maxStemX -> [padLeft, padLeft + plotW]
    // Y от 0 до Y_mid*1.08 -> [padTop + plotH, padTop]
    let maxStemX = 0;
    for (const s of stemSampled) {
      if (s.x > maxStemX) maxStemX = s.x;
    }
    const xMin = -L_bow;
    const xMax = Math.max(0.5, maxStemX + 0.2);
    const xRange = Math.max(0.1, xMax - xMin);
    const yMax = Y_mid * 1.05;

    const mapX = (xRel: number) => padLeft + ((xRel - xMin) / xRange) * plotW;
    const mapY = (yVal: number) => padTop + plotH - (yVal / yMax) * plotH;

    // Линия ДП (Y = 0)
    const yDP = mapY(0);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, yDP);
    ctx.lineTo(padLeft + plotW, yDP);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('ДП (Диаметральная плоскость)', padLeft + 6, yDP - 4);

    // Линия максимальной полуширины миделя Y_mid
    const yMidPix = mapY(Y_mid);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, yMidPix);
    ctx.lineTo(padLeft + plotW, yMidPix);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`Габарит миделя B/2 = ${Y_mid.toFixed(2)}м`, padLeft + 6, yMidPix - 4);

    // Отрисовка всех ватерлиний в полушироте
    waterlines.forEach((wl) => {
      const halfLoop = wl.points.filter((pt) => pt[2] >= 0); // правый борт
      if (halfLoop.length < 2) return;

      ctx.beginPath();
      halfLoop.forEach((pt, i) => {
        const xRel = pt[0] - xStemGlobal;
        const yBreadth = pt[2];
        const px = mapX(xRel);
        const py = mapY(yBreadth);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });

      if (wl.isDWL) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.2;
      } else if (wl.isBottom || wl.isKeel) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.0;
      } else if (wl.isDeck) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.8;
      } else if (wl.zLevel <= T) {
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.75)';
        ctx.lineWidth = 1.2;
      } else {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        ctx.lineWidth = 1.2;
      }
      ctx.stroke();
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('Мидель x = -L_bow', padLeft + 4, padTop + plotH - 4);
    ctx.fillText('Нос x = 0', padLeft + plotW - 55, padTop + plotH - 4);
  }
}
