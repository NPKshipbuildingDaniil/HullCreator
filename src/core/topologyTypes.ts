/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/topologyTypes.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Фундамент топологического ядра и геометрических структур данных для параметрического CAD-модуля судна.
 * Определяет типы непрерывности (G0, G1, G2), граничные параметрические мастер-кривые, бикубические
 * патчи Кунса (Coons Surfaces), узлы DAG-графа зависимостей и метрики контроля качества (QA Zero-gap/Zebra).
 * ====================================================================================================
 */

import * as THREE from 'three';
import { StemProfileParams } from './stemEngine';
import { BrusParams } from './types';

export type ShipDimensions = BrusParams;

// ─── 1. ТИПЫ ГЛАДКОСТИ СОПРЯЖЕНИЯ ───
export type ContinuityDegree = 'C0' | 'G0' | 'G1' | 'G2';

// ─── 2. ТАНГЕНЦИАЛЬНЫЕ И КАСАТЕЛЬНЫЕ ОГРАНИЧЕНИЯ ───
export interface TangentConstraint {
  direction: [number, number, number]; // Касательный 3D вектор
  weight: number;                      // Степень влияния/натяжения
}

// ─── 3. ГРАНИЧНАЯ ПАРАМЕТРИЧЕСКАЯ КРИВАЯ ───
export interface BoundaryCurve {
  id: string;
  name?: string;
  // Параметрическая функция положения точки t ∈ [0, 1]
  evaluate: (t: number) => [number, number, number];
  // Касательный вектор dP/dt
  evaluateTangent: (t: number) => [number, number, number];
  // Вектор нормали
  evaluateNormal: (t: number) => [number, number, number];
  // Кривизна κ(t)
  evaluateCurvature?: (t: number) => number;
}

// ─── 4. ИНТЕРФЕЙС ТОПОЛОГИЧЕСКОГО ПАТЧА ПОВЕРХНОСТИ ───
export interface SurfacePatch {
  id: string;
  name: string;
  // 4 ограничивающие кривые: u0 (юг, v=0), u1 (север, v=1), v0 (запад, u=0), v1 (восток, u=1)
  boundaries: {
    u0: BoundaryCurve; // S(u, 0)
    u1: BoundaryCurve; // S(u, 1)
    v0: BoundaryCurve; // S(0, v)
    v1: BoundaryCurve; // S(1, v)
  };
  // Угловые точки P_ij = S(i, j)
  corners: {
    p00: [number, number, number];
    p01: [number, number, number];
    p10: [number, number, number];
    p11: [number, number, number];
  };
  // Сопряжения с соседними патчами
  adjacencies: {
    u0?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
    u1?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
    v0?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
    v1?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
  };
  // Метод вычисления точки поверхности в параметрических координатах u, v ∈ [0, 1]
  evaluate: (u: number, v: number) => [number, number, number];
  // Метод вычисления точной аналитической нормали N(u, v) = ∂S/∂u × ∂S/∂v
  evaluateNormal: (u: number, v: number) => [number, number, number];
  // Частные производные
  evaluateDerivatives?: (u: number, v: number) => {
    du: [number, number, number];
    dv: [number, number, number];
  };
}

// ─── 4.5. ПАРАМЕТРЫ ОБЪЕМА И ВАТЕРЛИНИЙ НОСА (U x V МОДЕЛЬ) ───

export interface WaterlineBaseParams {
  /** Ширина ножа форштевня W_stem (0.0 .. 4.0 м, шаг 0.05 м) */
  baseStemWidth: number;
  /** Базовый полуугол заострения / входа α_entrance (5.0° .. 65.0°, шаг 0.5°) */
  baseEntranceAngle: number;
  /** Базовая полнота носового плеча k_shoulder (0.20 .. 1.30, шаг 0.01) */
  baseShoulderFullness: number;
  /** Длина участка 90° касательной к миделю L_mid_tangent (0.2 .. 0.8 * L_bow, м) */
  baseMidTangentLength: number;
}

export interface WaterlineGradientParams {
  /** Разница углов заострения между палубой и КВЛ Δα_flare (-30.0° .. +30.0°, шаг 0.5°) */
  entranceAngleGradient: number;
  /** Локальное заострение/наполнение на уровне КВЛ k_dwl_bias (-0.50 .. +0.50, шаг 0.01) */
  dwlFullnessBias: number;
  /** S-образный прогиб/вогнутость плеча k_inflection (-0.40 .. +0.40, шаг 0.01) */
  shoulderInflection: number;
  /** U <-> V форм-фактор шпангоутов (0.0: V-образные .. 0.5: параболические .. 1.0: U-образные) */
  frameSectionCurvature: number;
}

export interface BottomFootprintParams {
  /** Вынос плоского киля вперед от миделя L_flat_bottom (0.0 .. 0.8 * L_bow, м) */
  bottomFlatRun: number;
  /** Угол схождения пятна днища к ДП у киля α_bottom (3.0° .. 60.0°, шаг 0.5°) */
  bottomTaperAngle: number;
  /** Полнота пятна днища C_bottom_footprint (0.20 .. 1.00, шаг 0.01) */
  bottomFootprintFullness: number;
  /** Разница длины тангенса 90° у днища Δdx3_bottom (-0.3*L_bow .. +0.3*L_bow, м) */
  bottomTangentBias: number;
}

export interface BowVolumeParameters {
  // ── Группа 1 (Зеленая): Базовая форма ватерлиний (V-направление) ──
  baseStemWidth: number;
  baseEntranceAngle: number;
  baseShoulderFullness: number;
  baseMidTangentLength: number;
  /** Стрелка вогнутости ножа / Анти-щека δ_hollow (0.0 .. 1.5 м) */
  hollowDepth?: number;
  /** Положение плеча k_pullback (доля от L_bow, 0.10 .. 0.90) */
  shoulderPullback?: number;

  // ── Группа 2 (Оранжевая): Вертикальная дифференциация (U-направление) ──
  entranceAngleGradient: number;
  dwlFullnessBias: number;
  shoulderInflection: number;
  frameSectionCurvature: number;

  // ── Группа 3 (Синяя): Пятно днища (Z -> 0) ──
  bottomFlatRun: number;
  bottomTaperAngle: number;
  bottomFootprintFullness: number;
  bottomTangentBias: number;

  // ── Группа 4: Поперечное сечение носа (Шпангоут от конца пятна днища до палубы) ──
  /** Продольное смещение плоскости сечения от конца днищевого пятна (м) */
  sectionXOffset?: number;
  /** Угол наклона у верхней палубы (градусы, -45° .. +45°) */
  sectionDeckAngle?: number;
  /** Круговой регулятор верхнего участка (градусы, -90° .. +90°, фиолетовый) */
  sectionUpperRoundAngle?: number;
  /** Промежуточная точка/высота касательной (0.15 .. 0.85) */
  sectionTangentPoint?: number;
  /** Круговой регулятор нижнего участка (градусы, -90° .. +90°, фиолетовый) */
  sectionLowerRoundAngle?: number;
  /** Угол входа к форштевню/килю (градусы, 0° .. 90°) */
  sectionStemEntryAngle?: number;
  /** Длина прямого участка до форштевня / пятка (м, 0.0 .. 1.5 м). При 0 прямизна не форсируется */
  sectionHeelStraightLen?: number;

  // Вложенные структуры (опционально)
  baseV?: WaterlineBaseParams;
  gradientU?: WaterlineGradientParams;
  bottom?: BottomFootprintParams;

  // Поля обратной совместимости
  tangentWeightMid?: number;
  tangentWeightStem?: number;
  waterlineInflection?: number;
  dwlEntranceAngle?: number;
  dwlShoulderFullness?: number;
  bottomFlatLength?: number;
}

export const DEFAULT_BOW_VOLUME_PARAMS: BowVolumeParameters = {
  baseStemWidth: 0.0,
  baseEntranceAngle: 25.0,
  baseShoulderFullness: 0.70,
  baseMidTangentLength: 4.0,
  hollowDepth: 0.0,
  shoulderPullback: 0.50,

  entranceAngleGradient: 0.0,
  dwlFullnessBias: 0.0,
  shoulderInflection: 0.0,
  frameSectionCurvature: 0.50,

  bottomFlatRun: 2.0,
  bottomTaperAngle: 15.0,
  bottomFootprintFullness: 0.70,
  bottomTangentBias: 0.0,

  sectionXOffset: 0.0,
  sectionDeckAngle: 15.0,
  sectionUpperRoundAngle: 45.0,
  sectionTangentPoint: 0.50,
  sectionLowerRoundAngle: 45.0,
  sectionStemEntryAngle: 30.0,
  sectionHeelStraightLen: 0.0,

  // Legacy mappings
  tangentWeightMid: 4.0,
  tangentWeightStem: 3.0,
  waterlineInflection: 0.0,
  dwlEntranceAngle: 25.0,
  dwlShoulderFullness: 0.70,
  bottomFlatLength: 2.0,
};

// ─── 5. ПАРАМЕТРЫ НОСОВОЙ ОКОНЕЧНОСТИ (BOW PARAMETERS) ───
export interface BowParameters {
  /** Длина носовой зоны L_bow в метрах (0.1L .. 0.5L) */
  bowLength: number;
  /** Ширина форштевня / притупление носа W_stem (y_stem = W_stem / 2) в метрах (0.0 .. 0.5 B_deck) */
  stemWidth: number;
  /** Радиус скругления носа в плане R_stem в метрах (0.0 .. 0.5 B_deck) */
  stemRadius: number;
  /** Полуугол входа / заострения палубной ватерлинии α_entrance в градусах (5° .. 85°) */
  entranceAngle: number;
  /** Коэффициент полноты плеча / вздутия капли k_shoulder (0.1 .. 1.5) */
  shoulderFullness: number;
  /** Смещение точки максимальной полушироты maxBreadthPos (0.0 .. 1.0) */
  maxBreadthPos: number;
  /** Подъем палубы к форштевню / седловатость носа (Bow Sheer) в метрах */
  bowSheer: number;
  /** Погибь верхней палубы в носу (Deck Camber Bow) в метрах */
  deckCamberBow: number;
  /** Развал носового борта (Bow Flare ΔB_bow) в метрах */
  bowFlare: number;
  /** Степень нелинейности перехода развала борта от миделя к носу (1..4) */
  flareExponent: number;
  /** Наклон форштевня (Stem Rake / вылет носа вперед) в метрах */
  stemRake: number;
  /** Округление скулы в носу (U-образность vs V-образность) (0: V-образный, 1: U-образный) */
  bowUVShape: number;
  /** Пользовательские 5 опорных точек Безье P0..P4 для свободного перемещения */
  controlPoints?: Array<{ x: number; y: number }>;
  /** Параметры контура форштевня в ДП (Z in [0, H]) */
  stemProfile?: StemProfileParams;
  /** Параметры объема носовой оконечности, ватерлиний и пятна днища */
  bowVolume?: BowVolumeParameters;
  /** Параметры поперечного сечения носа */
  bowSection?: {
    sectionXOffset?: number;
    sectionDeckAngle?: number;
    sectionUpperRoundAngle?: number;
    sectionTangentPoint?: number;
    sectionLowerRoundAngle?: number;
    sectionStemEntryAngle?: number;
    sectionHeelStraightLen?: number;
    [key: string]: number | undefined;
  };
  /** Прямой доступ к параметрам объема для обратной совместимости */
  tangentWeightMid?: number;
  tangentWeightStem?: number;
  waterlineInflection?: number;
  dwlEntranceAngle?: number;
  dwlShoulderFullness?: number;
  bottomFlatLength?: number;
  bottomTaperAngle?: number;
  bottomFootprintFullness?: number;
  /** Режим геометрического ядра расчета поверхности: 'bspline' (B-Spline Control Net Engine FREE!ship) или 'coons' */
  surfaceEngineMode?: 'bspline' | 'coons';
  /** Отображение пространственной управляющей сети контрольных точек (Control Net) в 3D */
  showControlNet?: boolean;
  /** Режим ватерлиний: 'smooth' (управляющая/гладкая) или 'defining' (определяющая/грань/knuckle) */
  definingWaterlines?: Record<string, 'smooth' | 'defining'>;
}

// ─── 6. МЕТРИКИ КОНТРОЛЯ КАЧЕСТВА ТОПОЛОГИИ (QA CONTINUITY STATS) ───
export interface TopologyQAStats {
  /** Максимальный зазор на стыках (Zero-Gap tolerance: д.б. < 1e-6 м) */
  maxGapDistance: number;
  /** Среднее отклонение на границах патчей в метрах */
  avgGapDistance: number;
  /** Максимальный угол расхождения нормалей на границах в градусах (д.б. < 0.05°) */
  maxNormalAngleDeg: number;
  /** Время полного цикла пересчета в миллисекундах */
  computeTimeMs: number;
  /** Число полигонов сетки */
  polygonCount: number;
  /** Общее количество вершин */
  vertexCount: number;
  /** Статус проверки гладкости G0 */
  isG0Valid: boolean;
  /** Статус проверки гладкости G1 */
  isG1Valid: boolean;
}

// ─── 7. РЕЖИМЫ ОТОБРАЖЕНИЯ И АНАЛИЗА ПОВЕРХНОСТЕЙ ───
export type SurfaceRenderMode = 'shaded' | 'zebra' | 'curvature' | 'wireframe';

// ─── 8. ТОПОЛОГИЧЕСКАЯ ОБОЛОЧКА ВСЕГО КОРПУСА (HULL TOPOLOGY MODEL) ───
export interface CompositeGeometryResult {
  geometry: THREE.BufferGeometry;
  deckGeometry: THREE.BufferGeometry;
  hullGeometry: THREE.BufferGeometry;
  underwaterHullGeometry: THREE.BufferGeometry;
  abovewaterHullGeometry: THREE.BufferGeometry;
  stats: TopologyQAStats;
}

// ─── 9. СТРУКТУРЫ ТЕОРЕТИЧЕСКОГО КАРКАСА (THEORETICAL WIREFRAME FRAMEWORK) ───
export interface WireframeLine {
  id: string;
  name: string;
  type: 'station' | 'waterline' | 'buttock' | 'longitudinal' | 'boundary' | 'diagonal';
  points: [number, number, number][];
  isHighlight?: boolean;
  label?: string;
  stationNumber?: number;
  waterlineLevel?: number;
}

export interface WireframeFrameworkResult {
  stations: WireframeLine[];       // Шпангоуты (поперечные сечения)
  waterlines: WireframeLine[];     // Ватерлинии (горизонтальные сечения)
  buttocks: WireframeLine[];       // Батоксы (продольные вертикальные сечения)
  longitudinals: WireframeLine[];  // Продольные образующие / стрингеры
  boundaries: WireframeLine[];     // Опорные мастер-границы (форштевень, киль, скула, планширь)
  allLines: WireframeLine[];
}

export interface WireframeDisplayOptions {
  showStations?: boolean;
  showWaterlines?: boolean;
  showButtocks?: boolean;
  showLongitudinals?: boolean;
  showBoundaries?: boolean;
  stationCount?: number;
  waterlineCount?: number;
  buttockCount?: number;
  showControlNet?: boolean;
  hullSurfaceVisibility?: 'hidden' | 'ghost' | 'shaded';
  hullOpacity?: number; // 0.0 (полностью скрыта) .. 1.0 (сплошная обшивка)
}

export interface HullTopologyModel {
  patches: Map<string, SurfacePatch>;
  masterCurves: Map<string, BoundaryCurve>;
  updatePipeline: (bowParams: BowParameters, baseDimensions: { length: number; width: number; height: number; deadrise: number; radius: number; flare: number; deckCamber: number; sheerRadius: number; draft: number; deadriseInHeight?: boolean; deckCamberInHeight?: boolean }) => void;
  generateCompositeBufferGeometry: (uSegments: number, vSegments: number) => CompositeGeometryResult;
  generateWireframeFramework?: (options?: WireframeDisplayOptions) => WireframeFrameworkResult;
}

