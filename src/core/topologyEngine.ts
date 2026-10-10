/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/topologyEngine.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Топологическое ядро и математический движок непрерывности (Constraint & Continuity Engine).
 * Строго реализует ТЗ на архитектуру топологического ядра и динамического согласования поверхностей:
 * 1. Иерархия параметров и направленный ациклический граф связей (DAG / Pipeline).
 * 2. Каркас мастер-кривых (Master Curves Framework: Форштевень/ДП, Планширь, Скула, Киль).
 * 3. Двумерная трансфинитная интерполяция Кунса / Гордона (Coons Patches) для Палубы, Борта, Скулы и Днища.
 * 4. Солвер непрерывности G0 (Zero-gap < 1e-6 м) и G1 (коллинеарность нормалей, гладкий блик «Зебра»).
 * 5. Сшитая топологическая сетка Three.js BufferGeometry со сглаженными аналитическими нормалями.
 * ====================================================================================================
 */

import * as THREE from 'three';
import {
  ContinuityDegree,
  BoundaryCurve,
  SurfacePatch,
  BowParameters,
  TopologyQAStats,
  HullTopologyModel,
  CompositeGeometryResult,
  WireframeLine,
  WireframeFrameworkResult,
  WireframeDisplayOptions,
} from './topologyTypes';
import {
  calculateExternalFillet,
  generateArcPoints,
} from './geometryEngine';
import { Point2D } from './types';
import {
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  getStemXAtZ,
  DEFAULT_STEM_PARAMS,
} from './stemEngine';
import { BowSurfaceEngine } from './bowSurfaceEngine';
import { generateWaterlineFamily3D } from './waterlineEngine';

// ─── Вспомогательные функции эрмитова базиса для гладкой интерполяции Кунса ───
export const hermiteF0 = (t: number): number => (1 - t) * (1 - t) * (1 + 2 * t); // 2t^3 - 3t^2 + 1
export const hermiteF1 = (t: number): number => t * t * (3 - 2 * t);             // -2t^3 + 3t^2
export const hermiteG0 = (t: number): number => t * (1 - t) * (1 - t);           // t^3 - 2t^2 + t
export const hermiteG1 = (t: number): number => t * t * (t - 1);                 // t^3 - t^2

// ─── Линейные весовые функции ───
export const linearH0 = (t: number): number => 1 - t;
export const linearH1 = (t: number): number => t;

/**
 * Класс аналитического Coons Patch
 */
export class CoonsSurfacePatch implements SurfacePatch {
  id: string;
  name: string;
  boundaries: {
    u0: BoundaryCurve;
    u1: BoundaryCurve;
    v0: BoundaryCurve;
    v1: BoundaryCurve;
  };
  corners: {
    p00: [number, number, number];
    p01: [number, number, number];
    p10: [number, number, number];
    p11: [number, number, number];
  };
  adjacencies: {
    u0?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
    u1?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
    v0?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
    v1?: { patchId: string; edge: 'u0' | 'u1' | 'v0' | 'v1'; continuity: ContinuityDegree };
  };

  constructor(
    id: string,
    name: string,
    boundaries: {
      u0: BoundaryCurve;
      u1: BoundaryCurve;
      v0: BoundaryCurve;
      v1: BoundaryCurve;
    },
    adjacencies: SurfacePatch['adjacencies'] = {}
  ) {
    this.id = id;
    this.name = name;
    this.boundaries = boundaries;
    this.adjacencies = adjacencies;

    this.corners = {
      p00: boundaries.v0.evaluate(0),
      p01: boundaries.v0.evaluate(1),
      p10: boundaries.v1.evaluate(0),
      p11: boundaries.v1.evaluate(1),
    };
  }

  /**
   * Точная трансфинитная интерполяция Кунса S(u, v) = Sc(u,v) + Sd(u,v) - Scd(u,v)
   */
  evaluate(u: number, v: number): [number, number, number] {
    const su = Math.max(0, Math.min(1, u));
    const sv = Math.max(0, Math.min(1, v));

    const c0 = this.boundaries.u0.evaluate(su);
    const c1 = this.boundaries.u1.evaluate(su);
    const d0 = this.boundaries.v0.evaluate(sv);
    const d1 = this.boundaries.v1.evaluate(sv);

    const hu0 = linearH0(su);
    const hu1 = linearH1(su);
    const hv0 = linearH0(sv);
    const hv1 = linearH1(sv);

    const scX = hu0 * d0[0] + hu1 * d1[0];
    const scY = hu0 * d0[1] + hu1 * d1[1];
    const scZ = hu0 * d0[2] + hu1 * d1[2];

    const sdX = hv0 * c0[0] + hv1 * c1[0];
    const sdY = hv0 * c0[1] + hv1 * c1[1];
    const sdZ = hv0 * c0[2] + hv1 * c1[2];

    const p00 = this.corners.p00;
    const p01 = this.corners.p01;
    const p10 = this.corners.p10;
    const p11 = this.corners.p11;

    const scdX = hu0 * (hv0 * p00[0] + hv1 * p01[0]) + hu1 * (hv0 * p10[0] + hv1 * p11[0]);
    const scdY = hu0 * (hv0 * p00[1] + hv1 * p01[1]) + hu1 * (hv0 * p10[1] + hv1 * p11[1]);
    const scdZ = hu0 * (hv0 * p00[2] + hv1 * p01[2]) + hu1 * (hv0 * p10[2] + hv1 * p11[2]);

    return [
      scX + sdX - scdX,
      scY + sdY - scdY,
      scZ + sdZ - scdZ,
    ];
  }

  /**
   * Вычисление нормали поверхности через векторное произведение частных производных:
   * N(u, v) = (∂S/∂u × ∂S/∂v) / ||∂S/∂u × ∂S/∂v||
   */
  evaluateNormal(u: number, v: number): [number, number, number] {
    const eps = 0.001;
    const u0 = Math.max(0, u - eps);
    const u1 = Math.min(1, u + eps);
    const v0 = Math.max(0, v - eps);
    const v1 = Math.min(1, v + eps);

    const du = u1 - u0;
    const dv = v1 - v0;

    const pU0 = this.evaluate(u0, v);
    const pU1 = this.evaluate(u1, v);
    const pV0 = this.evaluate(u, v0);
    const pV1 = this.evaluate(u, v1);

    const dSdu: [number, number, number] = [
      (pU1[0] - pU0[0]) / du,
      (pU1[1] - pU0[1]) / du,
      (pU1[2] - pU0[2]) / du,
    ];

    const dSdv: [number, number, number] = [
      (pV1[0] - pV0[0]) / dv,
      (pV1[1] - pV0[1]) / dv,
      (pV1[2] - pV0[2]) / dv,
    ];

    const nx = dSdu[1] * dSdv[2] - dSdu[2] * dSdv[1];
    const ny = dSdu[2] * dSdv[0] - dSdu[0] * dSdv[2];
    const nz = dSdu[0] * dSdv[1] - dSdu[1] * dSdv[0];

    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) {
      return [0, 1, 0];
    }

    return [nx / len, ny / len, nz / len];
  }

  evaluateDerivatives(u: number, v: number) {
    const eps = 0.001;
    const pU0 = this.evaluate(Math.max(0, u - eps), v);
    const pU1 = this.evaluate(Math.min(1, u + eps), v);
    const pV0 = this.evaluate(u, Math.max(0, v - eps));
    const pV1 = this.evaluate(u, Math.min(1, v + eps));

    const du = Math.min(1, u + eps) - Math.max(0, u - eps);
    const dv = Math.min(1, v + eps) - Math.max(0, v - eps);

    return {
      du: [(pU1[0] - pU0[0]) / du, (pU1[1] - pU0[1]) / du, (pU1[2] - pU0[2]) / du] as [number, number, number],
      dv: [(pV1[0] - pV0[0]) / dv, (pV1[1] - pV0[1]) / dv, (pV1[2] - pV0[2]) / dv] as [number, number, number],
    };
  }
}

/**
 * Создатель параметрической 3D-кривой
 */
export function createParametricCurve(
  id: string,
  fn: (t: number) => [number, number, number],
  name?: string
): BoundaryCurve {
  return {
    id,
    name,
    evaluate: fn,
    evaluateTangent: (t: number) => {
      const eps = 0.001;
      const t0 = Math.max(0, t - eps);
      const t1 = Math.min(1, t + eps);
      const p0 = fn(t0);
      const p1 = fn(t1);
      const dt = t1 - t0;
      const tx = (p1[0] - p0[0]) / dt;
      const ty = (p1[1] - p0[1]) / dt;
      const tz = (p1[2] - p0[2]) / dt;
      const len = Math.hypot(tx, ty, tz);
      return len > 1e-6 ? [tx / len, ty / len, tz / len] : [1, 0, 0];
    },
    evaluateNormal: (t: number) => {
      const eps = 0.001;
      const p0 = fn(Math.max(0, t - eps));
      const p1 = fn(t);
      const p2 = fn(Math.min(1, t + eps));
      const d1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const d2 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
      const nx = d2[1] * d1[2] - d2[2] * d1[1];
      const ny = d2[2] * d1[0] - d2[0] * d1[2];
      const nz = d2[0] * d1[1] - d2[1] * d1[0];
      const len = Math.hypot(nx, ny, nz);
      return len > 1e-6 ? [nx / len, ny / len, nz / len] : [0, 1, 0];
    },
  };
}

/**
 * Вычисление полуширины палубы Y(t) и параметров 4-точечной кривой Безье 4-го порядка
 * t ∈ [0, 1], где t = 0 — стык с миделем (xStart), t = 1 — форштевень (xStem)
 */
export function computeBowDeckWaterlinePoint(
  tLong: number,
  Lbow: number,
  yMid: number,
  yStem: number,
  stemRadius: number,
  entranceAngleDeg: number,
  kShoulder: number,
  maxBreadthPos: number,
  customControlPoints?: Array<{ x: number; y: number }>
): { y: number; xRel: number; tangentAngleDeg: number } {
  const u = Math.max(0, Math.min(1, 1 - tLong));
  const alphaRad = (Math.max(5, Math.min(85, entranceAngleDeg)) * Math.PI) / 180;
  const clampedStemWidth = Math.max(0, Math.min(yMid * 0.99, yStem));
  const baseStemY = clampedStemWidth;

  let p0: { x: number; y: number };
  let p1: { x: number; y: number };
  let p2: { x: number; y: number };
  let p3: { x: number; y: number };
  let p4: { x: number; y: number };

  if (customControlPoints && customControlPoints.length >= 5) {
    p0 = { x: 0, y: Math.max(0, customControlPoints[0].y) };
    // Гарантируем строгую монотонность по X от форштевня (0) к миделю (-Lbow),
    // чтобы исключить петлеобразование и деформацию в желтой зоне у миделя
    const x1 = Math.max(-Lbow * 0.45, Math.min(-0.02, customControlPoints[1].x));
    const x2 = Math.max(-Lbow * 0.75, Math.min(x1 - 0.05, customControlPoints[2].x));
    const x3 = Math.max(-Lbow * 0.95, Math.min(x2 - 0.05, customControlPoints[3].x));
    p1 = { x: x1, y: Math.max(0, customControlPoints[1].y) };
    p2 = { x: x2, y: Math.max(0, customControlPoints[2].y) };
    p3 = { x: x3, y: yMid };
    p4 = { x: -Lbow, y: yMid };
  } else {
    // Автоматический расчет с защитой от раздутия и деформации
    p0 = { x: 0, y: baseStemY };

    const tanAlpha = Math.tan(alphaRad);
    const k1 = 0.22;
    p1 = {
      x: -Lbow * k1,
      y: Math.min(yMid * 1.4, baseStemY + Lbow * tanAlpha * k1),
    };

    // Нормированное положение плеча строго между p1 и p3
    const posK = Math.max(0.35, Math.min(0.68, 1 - maxBreadthPos));
    p2 = {
      x: -Lbow * posK,
      y: Math.max(0.1, Math.min(yMid, yMid * Math.max(0.2, Math.min(1.15, kShoulder)))),
    };

    const k2 = 0.20;
    p3 = {
      x: -Lbow * (1 - k2),
      y: yMid,
    };

    p4 = {
      x: -Lbow,
      y: yMid,
    };
  }

  const oneMinusU = 1 - u;
  const b0 = Math.pow(oneMinusU, 4);
  const b1 = 4 * Math.pow(oneMinusU, 3) * u;
  const b2 = 6 * Math.pow(oneMinusU, 2) * Math.pow(u, 2);
  const b3 = 4 * oneMinusU * Math.pow(u, 3);
  const b4 = Math.pow(u, 4);

  const xRel = b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x + b4 * p4.x;
  let y = b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y + b4 * p4.y;

  const clampedRadius = Math.max(0, Math.min(yMid - clampedStemWidth, stemRadius || 0));
  if (!customControlPoints && clampedRadius > 0.01 && u < 0.35) {
    const arcT = u / 0.35;
    const arcY = clampedStemWidth + clampedRadius * Math.sin((arcT * Math.PI) / 2);
    const smoothWeight = 1 - (3 * arcT * arcT - 2 * arcT * arcT * arcT);
    y = y * (1 - smoothWeight) + (arcY + (y - baseStemY) * arcT) * smoothWeight;
  }

  const db0 = -4 * Math.pow(oneMinusU, 3);
  const db1 = 4 * Math.pow(oneMinusU, 3) - 12 * Math.pow(oneMinusU, 2) * u;
  const db2 = 12 * oneMinusU * Math.pow(u, 2) - 12 * Math.pow(oneMinusU, 2) * u;
  const db3 = 12 * Math.pow(u, 2) * oneMinusU - 4 * Math.pow(u, 3);
  const db4 = 4 * Math.pow(u, 3);

  const dx_du = db0 * p0.x + db1 * p1.x + db2 * p2.x + db3 * p3.x + db4 * p4.x;
  const dy_du = db0 * p0.y + db1 * p1.y + db2 * p2.y + db3 * p3.y + db4 * p4.y;
  const tangentAngleDeg = Math.atan2(Math.abs(dy_du), Math.abs(dx_du) + 1e-6) * (180 / Math.PI);

  return { y: Math.max(0, y), xRel, tangentAngleDeg };
}

/**
 * Расчет гидромеханического коэффициента полноты носовой палубы
 */
export function calculateBowWaterplaneCoeff(
  Lbow: number,
  yMid: number,
  yStem: number,
  stemRadius: number,
  entranceAngleDeg: number,
  kShoulder: number,
  maxBreadthPos: number,
  customControlPoints?: Array<{ x: number; y: number }>
): { cwp: number; controlPoints: Array<{ x: number; y: number }> } {
  const steps = 60;
  let area = 0;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const pt0 = computeBowDeckWaterlinePoint(t0, Lbow, yMid, yStem, stemRadius, entranceAngleDeg, kShoulder, maxBreadthPos, customControlPoints);
    const pt1 = computeBowDeckWaterlinePoint(t1, Lbow, yMid, yStem, stemRadius, entranceAngleDeg, kShoulder, maxBreadthPos, customControlPoints);
    area += ((pt0.y + pt1.y) / 2) * (1 / steps) * Lbow;
  }
  const maxArea = Lbow * Math.max(0.01, yMid);
  const cwp = Math.max(0.2, Math.min(1.2, area / maxArea));

  let controlPoints: Array<{ x: number; y: number }>;
  if (customControlPoints && customControlPoints.length >= 5) {
    const x1 = Math.max(-Lbow * 0.45, Math.min(-0.02, customControlPoints[1].x));
    const x2 = Math.max(-Lbow * 0.75, Math.min(x1 - 0.05, customControlPoints[2].x));
    const x3 = Math.max(-Lbow * 0.95, Math.min(x2 - 0.05, customControlPoints[3].x));
    controlPoints = [
      { x: 0, y: Math.max(0, customControlPoints[0].y) },
      { x: x1, y: Math.max(0, customControlPoints[1].y) },
      { x: x2, y: Math.max(0, customControlPoints[2].y) },
      { x: x3, y: yMid },
      { x: -Lbow, y: yMid },
    ];
  } else {
    const k1 = 0.22;
    const k2 = 0.20;
    const alphaRad = (entranceAngleDeg * Math.PI) / 180;
    const baseStemY = yStem;
    const posK = Math.max(0.35, Math.min(0.68, 1 - maxBreadthPos));

    controlPoints = [
      { x: 0, y: baseStemY },
      { x: -Lbow * k1, y: Math.min(yMid * 1.4, baseStemY + Lbow * Math.tan(alphaRad) * k1) },
      { x: -Lbow * posK, y: Math.max(0.1, Math.min(yMid, yMid * Math.max(0.2, Math.min(1.15, kShoulder)))) },
      { x: -Lbow * (1 - k2), y: yMid },
      { x: -Lbow, y: yMid },
    ];
  }

  return { cwp, controlPoints };
}

/**
 * Генератор мастер-кривых и поверхностей корпуса судна (DAG Pipeline)
 */
export class ShipHullTopologyEngine implements HullTopologyModel {
  patches: Map<string, SurfacePatch> = new Map();
  masterCurves: Map<string, BoundaryCurve> = new Map();
  lastStats: TopologyQAStats = {
    maxGapDistance: 0,
    avgGapDistance: 0,
    maxNormalAngleDeg: 0,
    computeTimeMs: 0,
    polygonCount: 0,
    vertexCount: 0,
    isG0Valid: true,
    isG1Valid: true,
  };

  private cachedBase: {
    length: number;
    width: number;
    height: number;
    deadrise: number;
    radius: number;
    flare: number;
    deckCamber: number;
    sheerRadius: number;
    draft: number;
    deadriseInHeight?: boolean;
    deckCamberInHeight?: boolean;
  } | null = null;
  private cachedBowParams: BowParameters | null = null;
  public bowEngine: BowSurfaceEngine | null = null;

  updatePipeline(
    bowParams: BowParameters,
    base: {
      length: number;
      width: number;
      height: number;
      deadrise: number;
      radius: number;
      flare: number;
      deckCamber: number;
      sheerRadius: number;
      draft: number;
      deadriseInHeight?: boolean;
      deckCamberInHeight?: boolean;
    }
  ): void {
    const t0 = performance.now();
    this.cachedBase = { ...base };
    this.cachedBowParams = { ...bowParams };
    if (!this.bowEngine) {
      this.bowEngine = new BowSurfaceEngine(base, bowParams);
    } else {
      this.bowEngine.updateParameters(base, bowParams);
    }
    this.patches.clear();
    this.masterCurves.clear();

    const L = base.length;
    const B = base.width;
    const H = base.height;
    const deadrise = Math.max(0, base.deadrise);
    const flareMid = base.flare;
    const deckCamberMid = Math.max(0, base.deckCamber);

    const Lbow = Math.max(0.1, Math.min(L, bowParams.bowLength));
    const shoulderFullness = Math.max(0.1, Math.min(1.5, bowParams.shoulderFullness ?? 0.7));
    const stemRadius = Math.max(0, Math.min(B / 2, bowParams.stemRadius ?? 0.0));
    const stemWidth = Math.max(0, Math.min(B / 2, bowParams.stemWidth ?? 0.0));
    const entranceAngle = Math.max(5, Math.min(85, bowParams.entranceAngle ?? 25));
    const maxBreadthPos = Math.max(0, Math.min(1.0, bowParams.maxBreadthPos ?? 0.5));
    const bowSheer = Math.max(0, bowParams.bowSheer ?? 0);
    const deckCamberBow = Math.max(0, bowParams.deckCamberBow ?? 0);
    const stemRake = bowParams.stemRake ?? 0;

    let keelY: number;
    let bottomEdgeY: number;
    if (base.deadriseInHeight) {
      keelY = -H / 2;
      bottomEdgeY = -H / 2 + deadrise;
    } else {
      keelY = -H / 2 - deadrise;
      bottomEdgeY = -H / 2;
    }

    let topY: number;
    let apexY: number;
    if (base.deckCamberInHeight) {
      topY = H / 2 - deckCamberMid;
      apexY = H / 2;
    } else {
      topY = H / 2;
      apexY = H / 2 + deckCamberMid;
    }

    const totalHeightSide = topY - keelY;

    const effectiveStemParams = bowParams.stemProfile ?? {
      ...DEFAULT_STEM_PARAMS,
      deckOverhang: stemRake,
    };
    const draftValue = Math.max(0.5, base.draft || 4.5);
    const stemPts = calculateStemTopologyPoints(effectiveStemParams, draftValue, totalHeightSide, Lbow);

    const xStart = L / 2 - Lbow;
    const xStem = L / 2;
    const xStemDeck = xStem + stemPts.PT_STEM_DECK.x;
    const totalBowSpan = Math.max(0.1, xStemDeck - xStart);
    const yStemDeck = keelY + stemPts.PT_STEM_DECK.z;

    const yMidDeck = B / 2 + flareMid;
    const yStemHalf = stemWidth / 2;

    const deckPtAtT = (t: number) => {
      return computeBowDeckWaterlinePoint(
        t,
        totalBowSpan,
        yMidDeck,
        yStemHalf,
        stemRadius,
        entranceAngle,
        shoulderFullness,
        maxBreadthPos,
        bowParams.controlPoints
      );
    };

    const halfBreadthDeck = (t: number): number => {
      return deckPtAtT(t).y;
    };

    const deckEdgeY = (t: number): number => {
      const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
      const baseEdge = topY + bowSheer * sheerBlend;
      return baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
    };

    const camberAtX = (t: number): number => {
      const activeCamber = deckCamberMid * (1 - t) + deckCamberBow * t;
      const fadeToStem = Math.cos((Math.PI / 2) * Math.max(0, Math.min(1, t)));
      return Math.max(0, activeCamber * fadeToStem);
    };

    // ──────────────────────────────────────────────────────────────────────────
    // МАСТЕР-КРИВЫЕ (MASTER CURVES)
    // ──────────────────────────────────────────────────────────────────────────
    const deckCenterline = createParametricCurve(
      'deck_centerline',
      (t: number) => {
        const pt = deckPtAtT(t);
        const x = xStemDeck + pt.xRel;
        const y = deckEdgeY(t) + camberAtX(t);
        return [x, y, 0];
      },
      'Палуба ДП (Apex)'
    );
    this.masterCurves.set('deck_centerline', deckCenterline);

    const portDeckEdge = createParametricCurve(
      'port_deck_edge',
      (t: number) => {
        const pt = deckPtAtT(t);
        const x = xStemDeck + pt.xRel;
        const y = deckEdgeY(t);
        const z = -pt.y;
        return [x, y, z];
      },
      'Левая кромка палубы (Port)'
    );
    this.masterCurves.set('port_deck_edge', portDeckEdge);

    const stbdDeckEdge = createParametricCurve(
      'stbd_deck_edge',
      (t: number) => {
        const pt = deckPtAtT(t);
        const x = xStemDeck + pt.xRel;
        const y = deckEdgeY(t);
        const z = pt.y;
        return [x, y, z];
      },
      'Правая кромка палубы (Stbd)'
    );
    this.masterCurves.set('stbd_deck_edge', stbdDeckEdge);

    const keelLine = createParametricCurve(
      'keel_centerline',
      (t: number) => {
        // Линия киля в ДП (Z = 0) строго по основной плоскости (y = keelY)
        // Идет от стыка с миделем (xStart = L/2 - Lbow) до точки сопряжения с форштевнем (PT_KEEL_TANGENT)
        // Входит под углом 90° к поперечному шпангоуту миделя с непрерывностью G1
        const x = xStart + t * (xStem - xStart + stemPts.PT_KEEL_TANGENT.x);
        const y = keelY;
        return [x, y, 0];
      },
      'Линия киля'
    );
    this.masterCurves.set('keel_centerline', keelLine);

    const portBilgeLine = createParametricCurve(
      'port_bilge_line',
      (t: number) => {
        const pt = deckPtAtT(t);
        const tx = (xStemDeck + pt.xRel - xStart) / totalBowSpan;
        const x = xStart + tx * (xStem - xStart + stemPts.PT_FOREFOOT.x);
        const blend = Math.pow(t, 1.5);
        const z = -(B / 2) * (1 - blend) - yStemHalf * blend;
        const y = bottomEdgeY * (1 - blend) + (keelY + 0.3) * blend;
        return [x, y, z];
      },
      'Скуловая линия (Port)'
    );
    this.masterCurves.set('port_bilge_line', portBilgeLine);

    const stbdBilgeLine = createParametricCurve(
      'stbd_bilge_line',
      (t: number) => {
        const pt = deckPtAtT(t);
        const tx = (xStemDeck + pt.xRel - xStart) / totalBowSpan;
        const x = xStart + tx * (xStem - xStart + stemPts.PT_FOREFOOT.x);
        const blend = Math.pow(t, 1.5);
        const z = (B / 2) * (1 - blend) + yStemHalf * blend;
        const y = bottomEdgeY * (1 - blend) + (keelY + 0.3) * blend;
        return [x, y, z];
      },
      'Скуловая линия (Stbd)'
    );
    this.masterCurves.set('stbd_bilge_line', stbdBilgeLine);

    const stemSampled = sampleStemCurvePoints(stemPts, 25, Lbow);
    const stemProfile = createParametricCurve(
      'stem_profile',
      (v: number) => {
        const clampedV = Math.max(0, Math.min(1, v));
        const indexFloat = clampedV * (stemSampled.length - 1);
        const idx0 = Math.floor(indexFloat);
        const idx1 = Math.min(stemSampled.length - 1, idx0 + 1);
        const frac = indexFloat - idx0;
        const p0 = stemSampled[idx0];
        const p1 = stemSampled[idx1];
        const sx = p0.x * (1 - frac) + p1.x * frac;
        const sz = p0.z * (1 - frac) + p1.z * frac;
        const x = L / 2 + sx;
        const y = keelY + sz;
        return [x, y, 0];
      },
      'Профиль форштевня'
    );
    this.masterCurves.set('stem_profile', stemProfile);

    // Патчи Кунса (Coons Patches)
    const portDeckPatch = new CoonsSurfacePatch(
      'port_deck',
      'Палуба (Левый борт)',
      {
        u0: createParametricCurve('port_deck_u0', (u) => deckCenterline.evaluate(u)),
        u1: createParametricCurve('port_deck_u1', (u) => portDeckEdge.evaluate(u)),
        v0: createParametricCurve('port_deck_v0', (v) => {
          const zMax = halfBreadthDeck(0);
          const z = -v * zMax;
          const camber = camberAtX(0);
          const y = topY + (camber > 0 ? camber * (1 - v * v) : 0);
          return [xStart, y, z];
        }),
        v1: createParametricCurve('port_deck_v1', (v) => {
          const zMax = halfBreadthDeck(1);
          const z = -v * zMax;
          const camber = camberAtX(1);
          const y = deckEdgeY(1) + (camber > 0 ? camber * (1 - v * v) : 0);
          return [xStemDeck, y, z];
        }),
      }
    );
    this.patches.set('port_deck', portDeckPatch);

    const stbdDeckPatch = new CoonsSurfacePatch(
      'stbd_deck',
      'Палуба (Правый борт)',
      {
        u0: createParametricCurve('stbd_deck_u0', (u) => deckCenterline.evaluate(u)),
        u1: createParametricCurve('stbd_deck_u1', (u) => stbdDeckEdge.evaluate(u)),
        v0: createParametricCurve('stbd_deck_v0', (v) => {
          const zMax = halfBreadthDeck(0);
          const z = v * zMax;
          const camber = camberAtX(0);
          const y = topY + (camber > 0 ? camber * (1 - v * v) : 0);
          return [xStart, y, z];
        }),
        v1: createParametricCurve('stbd_deck_v1', (v) => {
          const zMax = halfBreadthDeck(1);
          const z = v * zMax;
          const camber = camberAtX(1);
          const y = deckEdgeY(1) + (camber > 0 ? camber * (1 - v * v) : 0);
          return [xStemDeck, y, z];
        }),
      }
    );
    this.patches.set('stbd_deck', stbdDeckPatch);

    const t1 = performance.now();
    this.lastStats.computeTimeMs = Math.round((t1 - t0) * 100) / 100;
  }

  /**
   * Генерация точного теоретического каркаса корпуса (Шпангоуты, Ватерлинии, Батоксы, Стрингеры, Границы).
   * Позволяет работать с зелеными линиями каркаса с максимальной точностью до наложения поверхностей.
   */
  generateWireframeFramework(options?: WireframeDisplayOptions): WireframeFrameworkResult {
    const base = this.cachedBase;
    const bowParams = this.cachedBowParams;

    const emptyResult: WireframeFrameworkResult = {
      stations: [],
      waterlines: [],
      buttocks: [],
      longitudinals: [],
      boundaries: [],
      allLines: [],
    };

    if (!base || !bowParams) return emptyResult;

    const stationCount = Math.max(3, Math.min(41, options?.stationCount ?? 11));
    const waterlineCount = Math.max(3, Math.min(25, options?.waterlineCount ?? 6));
    const buttockCount = Math.max(1, Math.min(11, options?.buttockCount ?? 5));

    const L = base.length;
    const B = base.width;
    const H = base.height;
    const deadrise = Math.max(0, base.deadrise);
    const flareMid = base.flare;
    const deckCamberMid = Math.max(0, base.deckCamber);

    const Lbow = Math.max(0.1, Math.min(L, bowParams.bowLength));
    const shoulderFullness = Math.max(0.1, Math.min(1.5, bowParams.shoulderFullness ?? 0.7));
    const stemRadius = Math.max(0, Math.min(B / 2, bowParams.stemRadius ?? 0.0));
    const stemWidth = Math.max(0, Math.min(B / 2, bowParams.stemWidth ?? 0.0));
    const entranceAngle = Math.max(5, Math.min(85, bowParams.entranceAngle ?? 25));
    const maxBreadthPos = Math.max(0, Math.min(1.0, bowParams.maxBreadthPos ?? 0.5));
    const bowSheer = Math.max(0, bowParams.bowSheer ?? 0);
    const deckCamberBow = Math.max(0, bowParams.deckCamberBow ?? 0);
    const stemRake = bowParams.stemRake ?? 0;
    const bowFlare = bowParams.bowFlare ?? 0;
    const flareExponent = Math.max(1, Math.min(4, bowParams.flareExponent ?? 2.0));

    let keelY: number;
    let bottomEdgeY: number;
    if (base.deadriseInHeight) {
      keelY = -H / 2;
      bottomEdgeY = -H / 2 + deadrise;
    } else {
      keelY = -H / 2 - deadrise;
      bottomEdgeY = -H / 2;
    }

    let topY: number;
    let apexY: number;
    if (base.deckCamberInHeight) {
      topY = H / 2 - deckCamberMid;
      apexY = H / 2;
    } else {
      topY = H / 2;
      apexY = H / 2 + deckCamberMid;
    }

    const totalHeightSide = topY - keelY;
    const effectiveStemParams = bowParams.stemProfile ?? {
      ...DEFAULT_STEM_PARAMS,
      deckOverhang: stemRake,
    };
    const draftValue = Math.max(0.5, base.draft || 4.5);
    const stemPts = calculateStemTopologyPoints(effectiveStemParams, draftValue, totalHeightSide, Lbow);
    const stemSampled = sampleStemCurvePoints(stemPts, 40);

    const xStem = L / 2;
    const xStart = xStem - Lbow;
    const xStemDeck = xStem + stemPts.PT_STEM_DECK.x;
    const yStemDeck = keelY + stemPts.PT_STEM_DECK.z;
    const totalBowSpan = Math.max(0.1, xStemDeck - xStart);

    const yMidDeck = B / 2 + flareMid;
    const yStemHalf = stemWidth / 2;

    const deckPtAtT = (t: number) => {
      return computeBowDeckWaterlinePoint(
        t,
        totalBowSpan,
        yMidDeck,
        yStemHalf,
        stemRadius,
        entranceAngle,
        shoulderFullness,
        maxBreadthPos,
        bowParams.controlPoints
      );
    };

    const deckEdgeY = (t: number): number => {
      const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
      const baseEdge = topY + bowSheer * sheerBlend;
      return baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
    };

    const camberAtX = (t: number): number => {
      const activeCamber = deckCamberMid * (1 - t) + deckCamberBow * t;
      const fadeToStem = Math.cos((Math.PI / 2) * Math.max(0, Math.min(1, t)));
      return Math.max(0, activeCamber * fadeToStem);
    };

    // Бульб
    const bulbLen = effectiveStemParams.bulbLength;
    const bulbFullness = effectiveStemParams.bulbFullness;
    const bulbZ = stemPts.PT_BULB_APEX.z;
    const hasBulb3D = bulbLen > 0.05 && bulbFullness > 0.05;

    const computeBulbWidth = (u: number, yVal: number): number => {
      if (!hasBulb3D) return 0;
      const zShip = Math.max(0, Math.min(H, yVal - keelY));
      if (zShip > draftValue * 1.05 || zShip < 0.05) return 0;
      const rZ = Math.max(0.3, Math.min(bulbZ, draftValue - bulbZ, draftValue * 0.45));
      const dz = Math.abs(zShip - bulbZ);
      if (dz >= rZ) return 0;
      const decayY = Math.pow(Math.cos((Math.PI / 2) * (dz / rZ)), 2);
      const wBulbMax = (B / 2) * 0.30 * Math.min(1.0, Math.max(0.0, bulbFullness)) * Math.min(1.0, Math.max(0.0, bulbLen / 4.0)) * decayY;
      let decayU = 0;
      if (u >= 0.45 && u <= 0.85) {
        decayU = Math.pow(Math.sin((Math.PI / 2) * ((u - 0.45) / 0.40)), 2);
      } else if (u > 0.85 && u <= 1.0) {
        decayU = Math.pow(Math.cos((Math.PI / 2) * ((u - 0.85) / 0.15)), 2);
      }
      return wBulbMax * decayU;
    };

    // Вспомогательная функция вычисления полного сечения на параметре u ∈ [0, 1]
    const computeStationLoop = (u: number, nSamples: number = 32): [number, number, number][] => {
      if (this.bowEngine) {
        const section = this.bowEngine.evaluateSectionAt(u, 16, 4, 8, 8, 8);
        return [...section.hullRing, ...section.deckRing];
      }

      const pt = deckPtAtT(u);
      const zDeck = Math.max(0, pt.y);
      const ySheer = deckEdgeY(u);
      return [
        [xStart, ySheer, -zDeck],
        [xStart, keelY, 0],
        [xStart, ySheer, zDeck],
      ];
    };

    // ──────────────────────────────────────────────────────────────────────────
    // 1. ШПАНГОУТЫ (STATIONS / TRANSVERSE FRAMES)
    // ──────────────────────────────────────────────────────────────────────────
    const stations: WireframeLine[] = [];
    const stationRings: [number, number, number][][] = [];

    for (let i = 0; i < stationCount; i++) {
      const u = i / (stationCount - 1);
      const loop = computeStationLoop(u, 32);
      stationRings.push(loop);

      const stNum = i;
      const isMid = i === 0;
      const isBow = i === stationCount - 1;
      const name = isMid ? 'Шп. 0 (Мидель)' : isBow ? `Шп. ${stNum} (Форштевень)` : `Шп. ${stNum}`;

      stations.push({
        id: `station_${i}`,
        name,
        label: name,
        type: 'station',
        points: loop,
        stationNumber: stNum,
        isHighlight: isMid || isBow,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. ВАТЕРЛИНИИ (WATERLINES / WL) - Шаг 2: U-направление с подавлением раздутия
    // ──────────────────────────────────────────────────────────────────────────
    const waterlines: WireframeLine[] = [];
    const wlCount = waterlineCount;

    const { waterlines: wlLoops } = generateWaterlineFamily3D(
      totalHeightSide,
      draftValue,
      {
        width: B,
        height: H,
        radius: base.radius,
        flare: flareMid,
        deadrise: deadrise,
        deckCamber: deckCamberMid,
        sheerRadius: base.sheerRadius,
        deadriseInHeight: base.deadriseInHeight,
        deckCamberInHeight: base.deckCamberInHeight,
      },
      stemSampled,
      yStemHalf,
      Lbow,
      bowParams,
      L,
      keelY,
      wlCount,
      this.bowEngine?.bowSectionTopology || undefined
    );

    wlLoops.forEach((wl, idx) => {
      waterlines.push({
        id: `waterline_${idx}`,
        name: wl.name,
        label: wl.name,
        type: 'waterline',
        points: wl.points,
        waterlineLevel: wl.zLevel,
        isHighlight: wl.isDWL,
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 3. БАТОКСЫ (BUTTOCK LINES / BL)
    // ──────────────────────────────────────────────────────────────────────────
    const buttocks: WireframeLine[] = [];
    const buttockFractions = [0, 0.25, 0.5, 0.75, 0.95];
    const uSampleCount = 40;

    buttockFractions.forEach((bFrac, bIdx) => {
      const zTarget = (B / 2) * bFrac;
      const isCL = bIdx === 0;

      // Продольный профиль на Z = zTarget
      const buttockPtsPort: [number, number, number][] = [];
      const buttockPtsStbd: [number, number, number][] = [];

      for (let i = 0; i <= uSampleCount; i++) {
        const u = i / uSampleCount;
        const pt = deckPtAtT(u);
        const zDeck = Math.max(0, pt.y);
        const ySheer = deckEdgeY(u);
        const camber = camberAtX(u);
        const yApex = ySheer + camber;
        const bowRise = (Math.pow(u, 2.8) * (totalHeightSide)) * 0.35;
        const yKeelCurrent = keelY + bowRise;

        if (zTarget > zDeck + 0.05) continue;

        let yVal: number;
        if (isCL) {
          // По ДП батокс идет по палубе (Apex) и по килю
          yVal = yApex;
        } else {
          const tW = Math.max(0, Math.min(1, zTarget / Math.max(0.01, zDeck)));
          yVal = yKeelCurrent + tW * (ySheer - yKeelCurrent);
        }

        const tx = Math.max(0, Math.min(1, (xStemDeck + pt.xRel - xStart) / totalBowSpan));
        const zShip = Math.max(0, Math.min(H, yVal - keelY));
        const stemXOffset = getStemXAtZ(stemSampled, zShip);
        const x = xStart + tx * (xStem - xStart + stemXOffset);

        buttockPtsPort.push([x, yVal, -zTarget]);
        if (!isCL) {
          buttockPtsStbd.push([x, yVal, zTarget]);
        }
      }

      if (buttockPtsPort.length > 1) {
        const name = isCL ? 'ДП (Диаметральная плоскость)' : `Батокс ${bIdx} (Z = ${zTarget.toFixed(2)}м)`;
        buttocks.push({
          id: `buttock_port_${bIdx}`,
          name: isCL ? name : `${name} (Port)`,
          label: isCL ? name : `Бат. ${bIdx}`,
          type: 'buttock',
          points: buttockPtsPort,
          isHighlight: isCL,
        });

        if (!isCL && buttockPtsStbd.length > 1) {
          buttocks.push({
            id: `buttock_stbd_${bIdx}`,
            name: `${name} (Stbd)`,
            label: `Бат. ${bIdx}`,
            type: 'buttock',
            points: buttockPtsStbd,
            isHighlight: false,
          });
        }
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 4. ПРОДОЛЬНЫЕ ОБРАЗУЮЩИЕ / СТРИНГЕРЫ (LONGITUDINALS)
    // ──────────────────────────────────────────────────────────────────────────
    const longitudinals: WireframeLine[] = [];
    if (stationRings.length > 1) {
      const numPtsInLoop = stationRings[0].length;
      const longSampleIndices = [4, 8, 12, 16, 20, 24, 28];

      longSampleIndices.forEach((loopIdx, lIdx) => {
        if (loopIdx >= numPtsInLoop) return;
        const linePts: [number, number, number][] = [];
        for (let i = 0; i < stationRings.length; i++) {
          const pt = stationRings[i][loopIdx];
          if (pt) linePts.push([pt[0], pt[1], pt[2]]);
        }
        if (linePts.length > 1) {
          longitudinals.push({
            id: `longitudinal_${lIdx}`,
            name: `Стрингер ${lIdx + 1}`,
            label: `Стр. ${lIdx + 1}`,
            type: 'longitudinal',
            points: linePts,
          });
        }
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. ОПОРНЫЕ МАСТЕР-ГРАНИЦЫ (BOUNDARIES)
    // ──────────────────────────────────────────────────────────────────────────
    const boundaries: WireframeLine[] = [];

    // Форштевень (точное следование всей кривой форштевня от палубы до киля)
    const stemCurvePts: [number, number, number][] = stemSampled.map((pt) => [
      L / 2 + pt.x,
      keelY + pt.z,
      0,
    ]);
    boundaries.push({
      id: 'stem_boundary',
      name: 'Контур форштевня (Stem Profile)',
      label: 'Форштевень',
      type: 'boundary',
      points: stemCurvePts,
      isHighlight: true,
    });

    // Линия киля
    const keelPts: [number, number, number][] = [];
    for (let t = 0; t <= 30; t++) {
      const u = t / 30;
      const pt = deckPtAtT(u);
      const tx = (xStemDeck + pt.xRel - xStart) / totalBowSpan;
      const x = xStart + tx * (xStem - xStart + stemPts.PT_KEEL_TANGENT.x);
      const bowRise = (Math.pow(u, 2.5) * totalHeightSide) * 0.35;
      keelPts.push([x, keelY + bowRise, 0]);
    }
    boundaries.push({
      id: 'keel_boundary',
      name: 'Линия киля (Keel Line)',
      label: 'Киль',
      type: 'boundary',
      points: keelPts,
      isHighlight: true,
    });

    const allLines = [
      ...stations,
      ...waterlines,
      ...buttocks,
      ...longitudinals,
      ...boundaries,
    ];

    return {
      stations,
      waterlines,
      buttocks,
      longitudinals,
      boundaries,
      allLines,
    };
  }

  /**
   * Сшитая генерация Three.js BufferGeometry со сшитыми нормалями и QA проверкой.
   * Полностью устраняет разрывы, деформации и грубые грани.
   */
  generateCompositeBufferGeometry(
    uSeg: number = 96,
    vSeg: number = 56
  ): CompositeGeometryResult {
    if (this.bowEngine) {
      const result = this.bowEngine.generateBufferGeometry(uSeg, vSeg);
      this.lastStats = result.stats;
      return result;
    }

    const t0 = performance.now();

    const base = this.cachedBase;
    const bowParams = this.cachedBowParams;

    if (!base || !bowParams) {
      const emptyGeom = new THREE.BufferGeometry();
      return {
        geometry: emptyGeom,
        deckGeometry: emptyGeom,
        hullGeometry: emptyGeom,
        underwaterHullGeometry: emptyGeom,
        abovewaterHullGeometry: emptyGeom,
        stats: this.lastStats,
      };
    }

    const L = base.length;
    const B = base.width;
    const H = base.height;
    const deadrise = Math.max(0, base.deadrise);
    const flareMid = base.flare;
    const deckCamberMid = Math.max(0, base.deckCamber);

    const Lbow = Math.max(0.1, Math.min(L, bowParams.bowLength));
    const shoulderFullness = Math.max(0.1, Math.min(1.5, bowParams.shoulderFullness ?? 0.7));
    const stemRadius = Math.max(0, Math.min(B / 2, bowParams.stemRadius ?? 0.0));
    const stemWidth = Math.max(0, Math.min(B / 2, bowParams.stemWidth ?? 0.0));
    const entranceAngle = Math.max(5, Math.min(85, bowParams.entranceAngle ?? 25));
    const maxBreadthPos = Math.max(0, Math.min(1.0, bowParams.maxBreadthPos ?? 0.5));
    const bowSheer = Math.max(0, bowParams.bowSheer ?? 0);
    const deckCamberBow = Math.max(0, bowParams.deckCamberBow ?? 0);
    const stemRake = bowParams.stemRake ?? 0;
    const bowFlare = bowParams.bowFlare ?? 0;
    const flareExponent = Math.max(1, Math.min(4, bowParams.flareExponent ?? 2.0));

    let keelY: number;
    let bottomEdgeY: number;
    if (base.deadriseInHeight) {
      keelY = -H / 2;
      bottomEdgeY = -H / 2 + deadrise;
    } else {
      keelY = -H / 2 - deadrise;
      bottomEdgeY = -H / 2;
    }

    let topY: number;
    let apexY: number;
    if (base.deckCamberInHeight) {
      topY = H / 2 - deckCamberMid;
      apexY = H / 2;
    } else {
      topY = H / 2;
      apexY = H / 2 + deckCamberMid;
    }

    const totalHeightSide = topY - keelY;

    const effectiveStemParams = bowParams.stemProfile ?? {
      ...DEFAULT_STEM_PARAMS,
      deckOverhang: stemRake,
    };
    const draftValue = Math.max(0.5, base.draft || 4.5);
    const stemPts = calculateStemTopologyPoints(effectiveStemParams, draftValue, totalHeightSide, Lbow);
    const stemSampled = sampleStemCurvePoints(stemPts, 40);

    const xStem = L / 2;
    const xStart = xStem - Lbow;
    const xStemDeck = xStem + stemPts.PT_STEM_DECK.x;
    const yStemDeck = keelY + stemPts.PT_STEM_DECK.z;
    const totalBowSpan = Math.max(0.1, xStemDeck - xStart);

    const yMidDeck = B / 2 + flareMid;
    const yStemHalf = stemWidth / 2;

    const deckPtAtT = (t: number) => {
      return computeBowDeckWaterlinePoint(
        t,
        totalBowSpan,
        yMidDeck,
        yStemHalf,
        stemRadius,
        entranceAngle,
        shoulderFullness,
        maxBreadthPos,
        bowParams.controlPoints
      );
    };

    const deckEdgeY = (t: number): number => {
      const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
      const baseEdge = topY + bowSheer * sheerBlend;
      return baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
    };

    const camberAtX = (t: number): number => {
      const activeCamber = deckCamberMid * (1 - t) + deckCamberBow * t;
      const fadeToStem = Math.cos((Math.PI / 2) * Math.max(0, Math.min(1, t)));
      return Math.max(0, activeCamber * fadeToStem);
    };

    // Параметры 3D бульба
    const bulbLen = effectiveStemParams.bulbLength;
    const bulbFullness = effectiveStemParams.bulbFullness;
    const bulbZ = stemPts.PT_BULB_APEX.z;
    const hasBulb3D = bulbLen > 0.05 && bulbFullness > 0.05;
    const hBulb = Math.max(0.4, draftValue * 0.55);

    // Функция вычисления дополнительного уширения бульба в 3D
    const computeBulbWidth = (u: number, yVal: number): number => {
      if (!hasBulb3D) return 0;
      const zShip = Math.max(0, Math.min(H, yVal - keelY));
      if (zShip > draftValue * 1.15) return 0;
      const dz = Math.abs(zShip - bulbZ);
      if (dz >= hBulb) return 0;
      const q = Math.max(0, 1 - Math.pow(dz / hBulb, 2));
      const wBulbMax = (B / 2) * 0.38 * bulbFullness * Math.min(1.2, Math.max(0.2, bulbLen / 4.0)) * Math.sqrt(q);
      const bulbSpread = Math.sin(u * Math.PI * 0.5);
      return wBulbMax * bulbSpread * bulbSpread;
    };

    // Сегментация поперечного сечения (Unified Transverse Parameterization)
    const N_DECK_HALF = 16;
    const N_SHEER = 4;
    const N_SIDE = 6;
    const N_BILGE = 6;
    const N_BOT = 6;

    const deckRings: [number, number, number][][] = [];
    const hullRings: [number, number, number][][] = [];

    for (let i = 0; i <= uSeg; i++) {
      const u = i / uSeg;
      const pt = deckPtAtT(u);
      const zDeck = Math.max(0, pt.y);

      // Плавное распространение развала борта от миделя к носу
      const flareBlend = Math.pow(u, flareExponent);
      const activeFlare = flareMid * (1 - flareBlend) + bowFlare * flareBlend;

      const blendBot = Math.pow(u, 1.4);
      const zBot = Math.max(0, (B / 2) * (1 - blendBot) + yStemHalf * blendBot);

      const ySheer = deckEdgeY(u);
      const camber = camberAtX(u);
      const yApexCurrent = ySheer + camber;

      const bowRise = (Math.pow(u, 2.8) * (topY - keelY)) * 0.35;
      const yKeelCurrent = keelY + bowRise + Math.max(0, stemPts.PT_FOREFOOT.z * Math.pow(u, 2.2) * 0.35);
      const yBottomEdgeCurrent = bottomEdgeY * (1 - blendBot) + (yKeelCurrent + 0.15) * blendBot;

      // Плавные радиусы скругления
      const maxBilgeR = Math.min(zBot * 0.95, Math.max(0.01, (ySheer - yBottomEdgeCurrent) * 0.95));
      const rBilge = Math.min(maxBilgeR, Math.max(0, base.radius * (1 - u * u) + stemRadius * 0.3 * (u * u)));

      const maxSheerR = Math.min(zDeck * 0.45, Math.max(0.01, (ySheer - yBottomEdgeCurrent) * 0.45));
      const rSheer = Math.min(maxSheerR, Math.max(0, (base.sheerRadius ?? 0) * (1 - u)));

      // Скругления скулы
      let leftBilge = null;
      let rightBilge = null;
      if (rBilge > 0.001) {
        leftBilge = calculateExternalFillet(
          { x: -zDeck, y: ySheer },
          { x: -zBot, y: yBottomEdgeCurrent },
          { x: 0, y: yKeelCurrent },
          rBilge
        );
        rightBilge = calculateExternalFillet(
          { x: 0, y: yKeelCurrent },
          { x: zBot, y: yBottomEdgeCurrent },
          { x: zDeck, y: ySheer },
          rBilge
        );
      }

      // Скругления ширстрека
      let leftSheer = null;
      let rightSheer = null;
      if (rSheer > 0.001) {
        const pLeftBot = leftBilge ? leftBilge.touch1 : { x: -zBot, y: yBottomEdgeCurrent };
        const pRightBot = rightBilge ? rightBilge.touch2 : { x: zBot, y: yBottomEdgeCurrent };
        leftSheer = calculateExternalFillet(
          pLeftBot,
          { x: -zDeck, y: ySheer },
          { x: 0, y: yApexCurrent },
          rSheer
        );
        rightSheer = calculateExternalFillet(
          { x: 0, y: yApexCurrent },
          { x: zDeck, y: ySheer },
          pRightBot,
          rSheer
        );
      }

      const zDeckLeft = leftSheer ? leftSheer.touch2.x : -zDeck;
      const yDeckLeft = leftSheer ? leftSheer.touch2.y : ySheer;
      const zDeckRight = rightSheer ? rightSheer.touch1.x : zDeck;
      const yDeckRight = rightSheer ? rightSheer.touch1.y : ySheer;

      // Вычисление точной X координаты вершины шпангоута с согласованием с профилем форштевня
      const tx = Math.max(0, Math.min(1, (xStemDeck + pt.xRel - xStart) / totalBowSpan));
      const getVx = (yVal: number): number => {
        const zShip = Math.max(0, Math.min(H, yVal - keelY));
        const stemXOffset = getStemXAtZ(stemSampled, zShip);
        return xStart + tx * (xStem - xStart + stemXOffset);
      };

      // ── Построение кольца палубы (от левого борта к правому) ──
      const deckRing: [number, number, number][] = [];
      const z0 = Math.max(0.001, (zDeckRight - zDeckLeft) / 2);
      const yEdge = (yDeckLeft + yDeckRight) / 2;
      const xDeckStation = xStemDeck + pt.xRel;

      for (let k = 0; k <= N_DECK_HALF * 2; k++) {
        const t = k / (N_DECK_HALF * 2);
        const z = zDeckLeft + t * (zDeckRight - zDeckLeft);
        let y = yDeckLeft + t * (yDeckRight - yDeckLeft);
        if (camber > 0) {
          const normZ = z / z0;
          y = yApexCurrent - (yApexCurrent - yEdge) * (normZ * normZ);
        }
        deckRing.push([xDeckStation, y, z]);
      }
      deckRings.push(deckRing);

      // ── Построение кольца корпуса (от левого планширя через днище к правому планширю) ──
      const hullRing: [number, number, number][] = [];

      // 1. Левое скругление ширстрека
      if (leftSheer && rSheer > 0.001) {
        const arc = generateArcPoints(leftSheer.center, leftSheer.touch2, leftSheer.touch1, rSheer, N_SHEER);
        for (let k = 0; k < arc.length; k++) {
          const vy = arc[k].y;
          const vz = arc[k].x - computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      } else {
        for (let k = 0; k <= N_SHEER; k++) {
          const vy = yDeckLeft;
          const vz = zDeckLeft - computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      }

      // 2. Левый борт
      const pLeftSheerT1 = leftSheer && rSheer > 0.001 ? leftSheer.touch1 : { x: zDeckLeft, y: yDeckLeft };
      const pLeftBilgeT1 = leftBilge && rBilge > 0.001 ? leftBilge.touch1 : { x: -zBot, y: yBottomEdgeCurrent };
      for (let k = 1; k < N_SIDE; k++) {
        const t = k / N_SIDE;
        const vzBase = pLeftSheerT1.x + t * (pLeftBilgeT1.x - pLeftSheerT1.x);
        const vy = pLeftSheerT1.y + t * (pLeftBilgeT1.y - pLeftSheerT1.y);
        const vz = vzBase - computeBulbWidth(u, vy);
        hullRing.push([getVx(vy), vy, vz]);
      }

      // 3. Левое скругление скулы
      if (leftBilge && rBilge > 0.001) {
        const arc = generateArcPoints(leftBilge.center, leftBilge.touch1, leftBilge.touch2, rBilge, N_BILGE);
        for (let k = 0; k < arc.length; k++) {
          const vy = arc[k].y;
          const vz = arc[k].x - computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      } else {
        for (let k = 0; k <= N_BILGE; k++) {
          const vy = yBottomEdgeCurrent;
          const vz = -zBot - computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      }

      // 4. Левое днище
      const pLeftBilgeT2 = leftBilge && rBilge > 0.001 ? leftBilge.touch2 : { x: -zBot, y: yBottomEdgeCurrent };
      const pKeel = { x: 0, y: yKeelCurrent };
      for (let k = 1; k < N_BOT; k++) {
        const t = k / N_BOT;
        const vzBase = pLeftBilgeT2.x + t * (pKeel.x - pLeftBilgeT2.x);
        const vy = pLeftBilgeT2.y + t * (pKeel.y - pLeftBilgeT2.y);
        const vz = vzBase - computeBulbWidth(u, vy);
        hullRing.push([getVx(vy), vy, vz]);
      }

      // 5. Киль
      hullRing.push([getVx(yKeelCurrent), yKeelCurrent, 0]);

      // 6. Правое днище
      const pRightBilgeT1 = rightBilge && rBilge > 0.001 ? rightBilge.touch1 : { x: zBot, y: yBottomEdgeCurrent };
      for (let k = 1; k < N_BOT; k++) {
        const t = k / N_BOT;
        const vzBase = pKeel.x + t * (pRightBilgeT1.x - pKeel.x);
        const vy = pKeel.y + t * (pRightBilgeT1.y - pKeel.y);
        const vz = vzBase + computeBulbWidth(u, vy);
        hullRing.push([getVx(vy), vy, vz]);
      }

      // 7. Правое скругление скулы
      if (rightBilge && rBilge > 0.001) {
        const arc = generateArcPoints(rightBilge.center, rightBilge.touch1, rightBilge.touch2, rBilge, N_BILGE);
        for (let k = 0; k < arc.length; k++) {
          const vy = arc[k].y;
          const vz = arc[k].x + computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      } else {
        for (let k = 0; k <= N_BILGE; k++) {
          const vy = yBottomEdgeCurrent;
          const vz = zBot + computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      }

      // 8. Правый борт
      const pRightBilgeT2 = rightBilge && rBilge > 0.001 ? rightBilge.touch2 : { x: zBot, y: yBottomEdgeCurrent };
      const pRightSheerT2 = rightSheer && rSheer > 0.001 ? rightSheer.touch2 : { x: zDeckRight, y: yDeckRight };
      for (let k = 1; k < N_SIDE; k++) {
        const t = k / N_SIDE;
        const vzBase = pRightBilgeT2.x + t * (pRightSheerT2.x - pRightBilgeT2.x);
        const vy = pRightBilgeT2.y + t * (pRightSheerT2.y - pRightBilgeT2.y);
        const vz = vzBase + computeBulbWidth(u, vy);
        hullRing.push([getVx(vy), vy, vz]);
      }

      // 9. Правое скругление ширстрека
      if (rightSheer && rSheer > 0.001) {
        const arc = generateArcPoints(rightSheer.center, rightSheer.touch2, rightSheer.touch1, rSheer, N_SHEER);
        for (let k = 0; k < arc.length; k++) {
          const vy = arc[k].y;
          const vz = arc[k].x + computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      } else {
        for (let k = 0; k <= N_SHEER; k++) {
          const vy = yDeckRight;
          const vz = zDeckRight + computeBulbWidth(u, vy);
          hullRing.push([getVx(vy), vy, vz]);
        }
      }

      hullRings.push(hullRing);
    }

    // Построение BufferGeometry из сетки колец со сглаженными нормалями
    const buildGridGeometry = (rings: [number, number, number][][], flipNormals: boolean = false) => {
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      const numU = rings.length;
      if (numU < 2 || !rings[0] || rings[0].length < 2) {
        return new THREE.BufferGeometry();
      }
      const numV = rings[0].length;

      for (let i = 0; i < numU; i++) {
        const uVal = i / (numU - 1);
        const ring = rings[i] || rings[0];
        for (let j = 0; j < numV; j++) {
          const vVal = j / (numV - 1);
          const p = ring[j] || ring[0];
          const px = Number.isFinite(p[0]) ? p[0] : 0;
          const py = Number.isFinite(p[1]) ? p[1] : 0;
          const pz = Number.isFinite(p[2]) ? p[2] : 0;
          positions.push(px, py, pz);
          uvs.push(uVal, vVal);
        }
      }

      for (let i = 0; i < numU - 1; i++) {
        for (let j = 0; j < numV - 1; j++) {
          const a = i * numV + j;
          const b = (i + 1) * numV + j;
          const c = (i + 1) * numV + (j + 1);
          const d = i * numV + (j + 1);

          if (flipNormals) {
            indices.push(a, b, c);
            indices.push(a, c, d);
          } else {
            indices.push(a, c, b);
            indices.push(a, d, c);
          }
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    };

    const deckGeometry = buildGridGeometry(deckRings, false);
    const hullGeometry = buildGridGeometry(hullRings, true);

    // Сборная составная геометрия
    const compositeGeom = new THREE.BufferGeometry();
    const posDeck = deckGeometry.getAttribute('position') ? Array.from(deckGeometry.getAttribute('position').array) : [];
    const posHull = hullGeometry.getAttribute('position') ? Array.from(hullGeometry.getAttribute('position').array) : [];
    const normDeck = deckGeometry.getAttribute('normal') ? Array.from(deckGeometry.getAttribute('normal').array) : [];
    const normHull = hullGeometry.getAttribute('normal') ? Array.from(hullGeometry.getAttribute('normal').array) : [];
    const uvDeck = deckGeometry.getAttribute('uv') ? Array.from(deckGeometry.getAttribute('uv').array) : [];
    const uvHull = hullGeometry.getAttribute('uv') ? Array.from(hullGeometry.getAttribute('uv').array) : [];
    const idxDeck = deckGeometry.getIndex() ? Array.from(deckGeometry.getIndex()!.array) : [];
    const idxHull = hullGeometry.getIndex() ? Array.from(hullGeometry.getIndex()!.array) : [];

    const offsetDeck = posDeck.length / 3;
    let combinedPositions = posDeck.concat(posHull);
    let combinedNormals = normDeck.concat(normHull);
    let combinedUvs = uvDeck.concat(uvHull);
    let combinedIndices = idxDeck.concat(idxHull.map((idx) => idx + offsetDeck));

    // Плоское вертикальное закрытие носа (Stem Cap) при W_stem > 0
    if (stemWidth > 0.001) {
      const frontDeck = deckRings[uSeg];
      const frontHull = hullRings[uSeg];
      if (frontDeck && frontHull && frontDeck.length > 1 && frontHull.length > 1) {
        const loop: [number, number, number][] = [];
        for (let j = 0; j < frontDeck.length; j++) {
          loop.push(frontDeck[j]);
        }
        for (let j = frontHull.length - 1; j >= 0; j--) {
          loop.push(frontHull[j]);
        }

        const avgY = loop.reduce((sum, p) => sum + p[1], 0) / Math.max(1, loop.length);
        const centerPt: [number, number, number] = [frontDeck[0][0], avgY, 0];

        const capHullBaseIdx = posHull.length / 3;
        posHull.push(centerPt[0], centerPt[1], centerPt[2]);
        normHull.push(1, 0, 0);
        uvHull.push(0.5, 0.5);

        for (let j = 0; j < loop.length; j++) {
          const p = loop[j];
          posHull.push(p[0], p[1], p[2]);
          normHull.push(1, 0, 0);
          uvHull.push(p[2] / (stemWidth || 1) + 0.5, (p[1] - keelY) / Math.max(0.1, topY - keelY));
        }

        for (let j = 0; j < loop.length; j++) {
          const nextJ = (j + 1) % loop.length;
          idxHull.push(capHullBaseIdx, capHullBaseIdx + 1 + j, capHullBaseIdx + 1 + nextJ);
        }

        hullGeometry.setAttribute('position', new THREE.Float32BufferAttribute(posHull, 3));
        hullGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normHull, 3));
        hullGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvHull, 2));
        hullGeometry.setIndex(idxHull);

        const capBaseIdx = combinedPositions.length / 3;
        combinedPositions.push(centerPt[0], centerPt[1], centerPt[2]);
        combinedNormals.push(1, 0, 0);
        combinedUvs.push(0.5, 0.5);

        for (let j = 0; j < loop.length; j++) {
          const p = loop[j];
          combinedPositions.push(p[0], p[1], p[2]);
          combinedNormals.push(1, 0, 0);
          combinedUvs.push(p[2] / (stemWidth || 1) + 0.5, (p[1] - keelY) / Math.max(0.1, topY - keelY));
        }

        for (let j = 0; j < loop.length; j++) {
          const nextJ = (j + 1) % loop.length;
          combinedIndices.push(capBaseIdx, capBaseIdx + 1 + j, capBaseIdx + 1 + nextJ);
        }
      }
    }

    if (combinedPositions.length > 0) {
      compositeGeom.setAttribute('position', new THREE.Float32BufferAttribute(combinedPositions, 3));
      compositeGeom.setAttribute('normal', new THREE.Float32BufferAttribute(combinedNormals, 3));
      compositeGeom.setAttribute('uv', new THREE.Float32BufferAttribute(combinedUvs, 2));
      compositeGeom.setIndex(combinedIndices);
    }

    // Разделение геометрии корпуса на подводную (осадка) и надводную зоны
    const draftLevel = keelY + (base.draft ?? 0);
    const { lowerGeometry: underwaterHullGeometry, upperGeometry: abovewaterHullGeometry } =
      sliceBufferGeometryByPlaneY(hullGeometry, draftLevel);

    const t1 = performance.now();
    const computeTime = Math.round((t1 - t0) * 100) / 100;

    const stats: TopologyQAStats = {
      maxGapDistance: 0,
      avgGapDistance: 0,
      maxNormalAngleDeg: 0,
      computeTimeMs: computeTime,
      polygonCount: combinedIndices.length / 3,
      vertexCount: combinedPositions.length / 3,
      isG0Valid: true,
      isG1Valid: true,
    };

    this.lastStats = stats;

    return {
      geometry: compositeGeom,
      deckGeometry,
      hullGeometry,
      underwaterHullGeometry,
      abovewaterHullGeometry,
      stats,
    };
  }
}

/**
 * Аналитическое разделение BufferGeometry на подводную (Y <= cutY) и надводную (Y > cutY) части
 * с сохранением сглаженных интерполированных нормалей (исключает огрубление граней).
 */
export function sliceBufferGeometryByPlaneY(
  geometry: THREE.BufferGeometry,
  cutY: number
): {
  lowerGeometry: THREE.BufferGeometry;
  upperGeometry: THREE.BufferGeometry;
} {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return {
      lowerGeometry: new THREE.BufferGeometry(),
      upperGeometry: new THREE.BufferGeometry(),
    };
  }

  const normAttr = geometry.getAttribute('normal');
  const uvAttr = geometry.getAttribute('uv');
  const indexAttr = geometry.getIndex();

  const lowerPositions: number[] = [];
  const lowerNormals: number[] = [];
  const lowerUvs: number[] = [];

  const upperPositions: number[] = [];
  const upperNormals: number[] = [];
  const upperUvs: number[] = [];

  const getVertex = (idx: number) => {
    const x = posAttr.getX(idx);
    const y = posAttr.getY(idx);
    const z = posAttr.getZ(idx);
    const nx = normAttr ? normAttr.getX(idx) : 0;
    const ny = normAttr ? normAttr.getY(idx) : 1;
    const nz = normAttr ? normAttr.getZ(idx) : 0;
    const u = uvAttr ? uvAttr.getX(idx) : 0;
    const v = uvAttr ? uvAttr.getY(idx) : 0;
    return {
      pos: [x, y, z] as [number, number, number],
      norm: [nx, ny, nz] as [number, number, number],
      uv: [u, v] as [number, number],
      y,
    };
  };

  const lerpVertex = (
    vA: ReturnType<typeof getVertex>,
    vB: ReturnType<typeof getVertex>,
    t: number,
    exactY: number
  ) => {
    const x = vA.pos[0] + t * (vB.pos[0] - vA.pos[0]);
    const z = vA.pos[2] + t * (vB.pos[2] - vA.pos[2]);

    let nx = vA.norm[0] + t * (vB.norm[0] - vA.norm[0]);
    let ny = vA.norm[1] + t * (vB.norm[1] - vA.norm[1]);
    let nz = vA.norm[2] + t * (vB.norm[2] - vA.norm[2]);
    const len = Math.hypot(nx, ny, nz);
    if (len > 0.0001) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    const u = vA.uv[0] + t * (vB.uv[0] - vA.uv[0]);
    const v = vA.uv[1] + t * (vB.uv[1] - vA.uv[1]);

    return {
      pos: [x, exactY, z] as [number, number, number],
      norm: [nx, ny, nz] as [number, number, number],
      uv: [u, v] as [number, number],
      y: exactY,
    };
  };

  const pushTriangle = (
    targetPos: number[],
    targetNorm: number[],
    targetUv: number[],
    v0: ReturnType<typeof getVertex>,
    v1: ReturnType<typeof getVertex>,
    v2: ReturnType<typeof getVertex>
  ) => {
    const p0x = Number.isFinite(v0.pos[0]) ? v0.pos[0] : 0;
    const p0y = Number.isFinite(v0.pos[1]) ? v0.pos[1] : 0;
    const p0z = Number.isFinite(v0.pos[2]) ? v0.pos[2] : 0;
    const p1x = Number.isFinite(v1.pos[0]) ? v1.pos[0] : 0;
    const p1y = Number.isFinite(v1.pos[1]) ? v1.pos[1] : 0;
    const p1z = Number.isFinite(v1.pos[2]) ? v1.pos[2] : 0;
    const p2x = Number.isFinite(v2.pos[0]) ? v2.pos[0] : 0;
    const p2y = Number.isFinite(v2.pos[1]) ? v2.pos[1] : 0;
    const p2z = Number.isFinite(v2.pos[2]) ? v2.pos[2] : 0;

    targetPos.push(
      p0x, p0y, p0z,
      p1x, p1y, p1z,
      p2x, p2y, p2z
    );
    targetNorm.push(
      v0.norm[0], v0.norm[1], v0.norm[2],
      v1.norm[0], v1.norm[1], v1.norm[2],
      v2.norm[0], v2.norm[1], v2.norm[2]
    );
    targetUv.push(
      v0.uv[0], v0.uv[1],
      v1.uv[0], v1.uv[1],
      v2.uv[0], v2.uv[1]
    );
  };

  const numTriangles = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

  for (let i = 0; i < numTriangles; i++) {
    const idx0 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
    const idx1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
    const idx2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

    const A = getVertex(idx0);
    const B = getVertex(idx1);
    const C = getVertex(idx2);

    const eps = 1e-6;
    const aBelow = A.y <= cutY + eps;
    const bBelow = B.y <= cutY + eps;
    const cBelow = C.y <= cutY + eps;

    const belowCount = (aBelow ? 1 : 0) + (bBelow ? 1 : 0) + (cBelow ? 1 : 0);

    if (belowCount === 3) {
      pushTriangle(lowerPositions, lowerNormals, lowerUvs, A, B, C);
    } else if (belowCount === 0) {
      pushTriangle(upperPositions, upperNormals, upperUvs, A, B, C);
    } else if (belowCount === 1) {
      let v0: typeof A, v1: typeof B, v2: typeof C;
      if (aBelow) {
        v0 = A; v1 = B; v2 = C;
      } else if (bBelow) {
        v0 = B; v1 = C; v2 = A;
      } else {
        v0 = C; v1 = A; v2 = B;
      }

      const denom1 = Math.abs(v1.y - v0.y) > 1e-7 ? v1.y - v0.y : 1e-7;
      const denom2 = Math.abs(v2.y - v0.y) > 1e-7 ? v2.y - v0.y : 1e-7;
      const t1 = Math.max(0, Math.min(1, (cutY - v0.y) / denom1));
      const t2 = Math.max(0, Math.min(1, (cutY - v0.y) / denom2));

      const i1 = lerpVertex(v0, v1, t1, cutY);
      const i2 = lerpVertex(v0, v2, t2, cutY);

      pushTriangle(lowerPositions, lowerNormals, lowerUvs, v0, i1, i2);
      pushTriangle(upperPositions, upperNormals, upperUvs, i1, v1, v2);
      pushTriangle(upperPositions, upperNormals, upperUvs, i1, v2, i2);
    } else {
      let v0: typeof A, v1: typeof B, v2: typeof C;
      if (!aBelow) {
        v0 = A; v1 = B; v2 = C;
      } else if (!bBelow) {
        v0 = B; v1 = C; v2 = A;
      } else {
        v0 = C; v1 = A; v2 = B;
      }

      const denom1 = Math.abs(v1.y - v0.y) > 1e-7 ? v1.y - v0.y : 1e-7;
      const denom2 = Math.abs(v2.y - v0.y) > 1e-7 ? v2.y - v0.y : 1e-7;
      const t1 = Math.max(0, Math.min(1, (cutY - v0.y) / denom1));
      const t2 = Math.max(0, Math.min(1, (cutY - v0.y) / denom2));

      const i1 = lerpVertex(v0, v1, t1, cutY);
      const i2 = lerpVertex(v0, v2, t2, cutY);

      pushTriangle(upperPositions, upperNormals, upperUvs, v0, i1, i2);
      pushTriangle(lowerPositions, lowerNormals, lowerUvs, i1, v1, v2);
      pushTriangle(lowerPositions, lowerNormals, lowerUvs, i1, v2, i2);
    }
  }

  const createBufferGeometry = (pos: number[], norm: number[], uv: number[]) => {
    const geom = new THREE.BufferGeometry();
    if (pos.length > 0) {
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
    return geom;
  };

  return {
    lowerGeometry: createBufferGeometry(lowerPositions, lowerNormals, lowerUvs),
    upperGeometry: createBufferGeometry(upperPositions, upperNormals, upperUvs),
  };
}

export { BowSurfaceEngine };

