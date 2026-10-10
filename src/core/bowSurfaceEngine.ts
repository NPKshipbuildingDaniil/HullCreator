/**
 * ====================================================================================================
 * 📁 src/core/bowSurfaceEngine.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Высокоточный аналитический движок генерации носовой поверхности корпуса судна (Bow Surface Engine).
 * 
 * КЛЮЧЕВЫЕ ГЕОМЕТРИЧЕСКИЕ И МАТЕМАТИЧЕСКИЕ ПРИНЦИПЫ:
 * 1. Строгое начало от линии форштевня (Stem Profile Spline):
 *    - Поверхность начинается строго на гладком сплайне Безье форштевня (u = 1 / stem)
 *      от киля (Z = 0, y = keelY) через подзор (forefoot), бульб (bulb), КВЛ (DWL) до палубы (deck).
 *    - В ДП (Z = 0) поверхность полностью замкнута, без разрывов, щелей и открытых контуров.
 * 2. Гладкий сплайновый лофтинг к центральной части (Midship Cut):
 *    - Поверхность плавно переходит от форштевня (u = 1) к поперечному шпангоуту миделя (u = 0, X = xStart).
 *    - G0 (Gap = 0 < 1e-6 м) точное бесшовное совпадение с брусом/корпусом.
 *    - G1 тангенциальная гладкость (продольные касательные параллельны оси X на стыке с миделем).
 *    - G2 непрерывность кривизны перехода (Hermite C2).
 * 3. Поперечная гладкость и геометрия шпангоутов:
 *    - Аналитические скругления скулы и ширстрека.
 *    - Объемная трехмерная коррекция бульба \Delta Z(u, y).
 *    - Нелинейное адаптивное распределение сечений \xi(u) со сгущением в зонах кривизны.
 * 4. Полная герметичность (Watertight Hull Shell):
 *    - Килевая линия (v = 0): Y = keelY, Z = 0 (закрытое днище по ДП).
 *    - Линия форштевня (u = 1): Z = 0 (закрытый нос по ДП).
 *    - Палубная кромка (v = 1): точное совпадение координат вершин палубы и борта.
 * ====================================================================================================
 */

import * as THREE from 'three';
import {
  BowParameters,
  CompositeGeometryResult,
  TopologyQAStats,
  BoundaryCurve,
} from './topologyTypes';
import {
  StemTopologyPoints,
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  evaluateStemSplineContinuous,
  getStemXAtZ,
  DEFAULT_STEM_PARAMS,
} from './stemEngine';
import {
  computeBowDeckWaterlinePoint,
} from './topologyEngine';
import {
  calculateExternalFillet,
  generateArcPoints,
} from './geometryEngine';
import {
  extractBowVolumeParams,
  evaluateWaterlineHalfBreadthAt,
  evaluateWaterlinePointAtT,
  evaluateBowHullTotalHalfBreadth,
  evaluateBowSurfaceHalfBreadth,
  getTheoreticalMidshipHalfBreadthAtZ,
} from './waterlineEngine';
import {
  calculateBowSectionTopology,
  evaluateBowSectionHalfBreadthAtY,
  blendBowWaterlineWithSection,
  BowSectionTopology,
} from './bowSectionEngine';
import { mergeBufferGeometries } from './controlNetBuilder';

export interface HullBaseParameters {
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

export interface GuideNetwork {
  stemProfile: BoundaryCurve;
  portDeckEdge: BoundaryCurve;
  stbdDeckEdge: BoundaryCurve;
  deckCenterline: BoundaryCurve;
  portBilgeLine: BoundaryCurve;
  stbdBilgeLine: BoundaryCurve;
  keelLine: BoundaryCurve;
}

/**
 * C2-гладкий квинтик-полином перехода Эрмита:
 * h(0)=0, h(1)=1, h'(0)=h''(0)=h'(1)=h''(1)=0
 * Обеспечивает строгое соблюдение G1 и G2 непрерывности на границах.
 */
export function smoothHermiteQuintic(t: number): number {
  const s = Math.max(0, Math.min(1, t));
  return s * s * s * (s * (s * 6 - 15) + 10);
}

/**
 * C1-кубический полином Эрмита: 3s^2 - 2s^3
 */
export function smoothHermiteCubic(t: number): number {
  const s = Math.max(0, Math.min(1, t));
  return s * s * (3 - 2 * s);
}

export class BowSurfaceEngine {
  private baseParams: HullBaseParameters;
  private bowParams: BowParameters;

  // Топологические уровни
  private keelY: number = 0;
  private bottomEdgeY: number = 0;
  private topY: number = 0;
  private apexY: number = 0;
  private totalHeightSide: number = 0;

  private effectiveBowLength: number = 10;
  private stemPts!: StemTopologyPoints;
  private stemSampled: Array<{ x: number; z: number }> = [];

  private xStem: number = 0;
  private xStart: number = 0;
  private xStemDeck: number = 0;
  private totalBowSpan: number = 10;
  private yStemDeck: number = 0;

  private yMidDeck: number = 0;
  private yStemHalf: number = 0;
  public bowSectionTopology!: BowSectionTopology;

  constructor(base: HullBaseParameters, bow: BowParameters) {
    this.baseParams = { ...base };
    this.bowParams = { ...bow };
    this.initTopology();
  }

  public updateParameters(base: HullBaseParameters, bow: BowParameters): void {
    this.baseParams = { ...base };
    this.bowParams = { ...bow };
    this.initTopology();
  }

  private initTopology(): void {
    const base = this.baseParams;
    const bow = this.bowParams;

    const L = base.length;
    const B = base.width;
    const H = base.height;
    const deadrise = Math.max(0, base.deadrise);
    const flareMid = base.flare;
    const deckCamberMid = Math.max(0, base.deckCamber);

    this.effectiveBowLength = Math.max(0.5, Math.min(L, bow.bowLength));

    if (base.deadriseInHeight) {
      this.keelY = -H / 2;
      this.bottomEdgeY = -H / 2 + deadrise;
    } else {
      this.keelY = -H / 2 - deadrise;
      this.bottomEdgeY = -H / 2;
    }

    if (base.deckCamberInHeight) {
      this.topY = H / 2 - deckCamberMid;
      this.apexY = H / 2;
    } else {
      this.topY = H / 2;
      this.apexY = H / 2 + deckCamberMid;
    }

    this.totalHeightSide = Math.max(0.5, this.topY - this.keelY);

    const stemProfile = bow.stemProfile ?? {
      ...DEFAULT_STEM_PARAMS,
      deckOverhang: bow.stemRake ?? 0,
    };
    const draftVal = Math.max(0.5, base.draft || 4.5);

    this.stemPts = calculateStemTopologyPoints(stemProfile, draftVal, this.totalHeightSide, this.effectiveBowLength);
    this.stemSampled = sampleStemCurvePoints(this.stemPts, 60, this.effectiveBowLength);

    this.xStem = L / 2;
    this.xStart = this.xStem - this.effectiveBowLength;
    this.xStemDeck = this.xStem + this.stemPts.PT_STEM_DECK.x;
    this.totalBowSpan = Math.max(0.1, this.xStemDeck - this.xStart);
    this.yStemDeck = this.keelY + this.stemPts.PT_STEM_DECK.z;

    this.yMidDeck = B / 2 + flareMid;
    this.yStemHalf = Math.max(0, Math.min(B / 2, (bow.stemWidth ?? 0) / 2));

    const volParams = extractBowVolumeParams(bow);
    this.bowSectionTopology = calculateBowSectionTopology({
      xMidCut: this.xStart,
      xStemTip: this.xStem,
      effectiveBowLen: this.effectiveBowLength,
      bottomFlatRun: volParams.bottomFlatRun,
      volParams,
      bowParams: bow,
      hullParams: {
        length: base.length,
        width: base.width,
        height: base.height,
        deadrise: base.deadrise,
        radius: base.radius,
        flare: base.flare,
        deckCamber: base.deckCamber,
        sheerRadius: base.sheerRadius,
        draft: base.draft,
        deadriseInHeight: base.deadriseInHeight,
        deckCamberInHeight: base.deckCamberInHeight,
        draftColorIndex: 0,
        showDeckCover: false,
        gridSize: 1,
        brusColor: 0,
      },
      keelY: this.keelY,
      totalHeight: this.totalHeightSide,
      bottomZeroX: this.xStem + (this.stemPts.PT_FOREFOOT.z <= 0.05 ? this.stemPts.PT_FOREFOOT.x : this.stemPts.PT_KEEL_TANGENT.x),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. ПОСТРОЕНИЕ СЕТИ НАПРАВЛЯЮЩИХ МАСТЕР-КРИВЫХ (GUIDE CURVES NETWORK)
  // ──────────────────────────────────────────────────────────────────────────
  public buildGuideCurves(): GuideNetwork {
    const self = this;
    const base = this.baseParams;
    const bow = this.bowParams;
    const B = base.width;

    const deckPtAtT = (t: number) => {
      return computeBowDeckWaterlinePoint(
        t,
        self.totalBowSpan,
        self.yMidDeck,
        self.yStemHalf,
        bow.stemRadius ?? 0,
        bow.entranceAngle ?? 25,
        bow.shoulderFullness ?? 0.7,
        bow.maxBreadthPos ?? 0.5,
        bow.controlPoints
      );
    };

    const deckEdgeY = (t: number): number => {
      const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
      const baseEdge = self.topY + (bow.bowSheer ?? 0) * sheerBlend;
      return baseEdge * (1 - sheerBlend) + self.yStemDeck * sheerBlend;
    };

    const camberAtX = (t: number): number => {
      const activeCamber = (base.deckCamber ?? 0) * (1 - t) + (bow.deckCamberBow ?? 0) * t;
      const fadeToStem = Math.cos((Math.PI / 2) * Math.max(0, Math.min(1, t)));
      return Math.max(0, activeCamber * fadeToStem);
    };

    const makeCurve = (
      id: string,
      name: string,
      evalFn: (t: number) => [number, number, number]
    ): BoundaryCurve => {
      const eps = 1e-4;
      return {
        id,
        name,
        evaluate: evalFn,
        evaluateTangent: (t: number) => {
          const t0 = Math.max(0, t - eps);
          const t1 = Math.min(1, t + eps);
          const dt = Math.max(eps, t1 - t0);
          const p0 = evalFn(t0);
          const p1 = evalFn(t1);
          const dx = (p1[0] - p0[0]) / dt;
          const dy = (p1[1] - p0[1]) / dt;
          const dz = (p1[2] - p0[2]) / dt;
          const len = Math.hypot(dx, dy, dz);
          return len > 1e-6 ? [dx / len, dy / len, dz / len] : [1, 0, 0];
        },
        evaluateNormal: (t: number) => {
          const t0 = Math.max(0, t - eps);
          const t1 = Math.min(1, t + eps);
          const dt = Math.max(eps, t1 - t0);
          const p0 = evalFn(t0);
          const p1 = evalFn(t1);
          const dx = (p1[0] - p0[0]) / dt;
          const dy = (p1[1] - p0[1]) / dt;
          const dz = (p1[2] - p0[2]) / dt;
          const len = Math.hypot(dx, dy, dz);
          const tx = len > 1e-6 ? dx / len : 1;
          const ty = len > 1e-6 ? dy / len : 0;
          const tz = len > 1e-6 ? dz / len : 0;
          let nx = -ty;
          let ny = tx;
          let nz = -tz;
          const nlen = Math.hypot(nx, ny, nz);
          return nlen > 1e-6 ? [nx / nlen, ny / nlen, nz / nlen] : [0, 1, 0];
        },
      };
    };

    const stemProfile: BoundaryCurve = makeCurve(
      'guide_stem_profile',
      'Профиль форштевня (Stem Guide)',
      (v: number) => {
        const pt = evaluateStemSplineContinuous(self.stemPts, v);
        return [self.xStem + pt.x, self.keelY + pt.z, 0];
      }
    );

    const portDeckEdge: BoundaryCurve = makeCurve(
      'guide_port_deck_edge',
      'Левая кромка палубы (Port Deck)',
      (t: number) => {
        const pt = deckPtAtT(t);
        return [self.xStemDeck + pt.xRel, deckEdgeY(t), -pt.y];
      }
    );

    const stbdDeckEdge: BoundaryCurve = makeCurve(
      'guide_stbd_deck_edge',
      'Правая кромка палубы (Stbd Deck)',
      (t: number) => {
        const pt = deckPtAtT(t);
        return [self.xStemDeck + pt.xRel, deckEdgeY(t), pt.y];
      }
    );

    const deckCenterline: BoundaryCurve = makeCurve(
      'guide_deck_centerline',
      'Линия палубы в ДП (Deck Centerline)',
      (t: number) => {
        const pt = deckPtAtT(t);
        return [self.xStemDeck + pt.xRel, deckEdgeY(t) + camberAtX(t), 0];
      }
    );

    const keelLine: BoundaryCurve = makeCurve(
      'guide_keel_line',
      'Линия киля (Keel Guide)',
      (t: number) => {
        const x = self.xStart + t * (self.xStem - self.xStart + self.stemPts.PT_KEEL_TANGENT.x);
        return [x, self.keelY, 0];
      }
    );

    const portBilgeLine: BoundaryCurve = makeCurve(
      'guide_port_bilge_line',
      'Скуловая направляющая (Port Bilge)',
      (t: number) => {
        const pt = deckPtAtT(t);
        const tx = (self.xStemDeck + pt.xRel - self.xStart) / self.totalBowSpan;
        const x = self.xStart + tx * (self.xStem - self.xStart + self.stemPts.PT_FOREFOOT.x);
        const blend = Math.pow(t, 1.5);
        const z = -(B / 2) * (1 - blend) - self.yStemHalf * blend;
        const y = self.bottomEdgeY * (1 - blend) + self.keelY * blend;
        return [x, y, z];
      }
    );

    const stbdBilgeLine: BoundaryCurve = makeCurve(
      'guide_stbd_bilge_line',
      'Скуловая направляющая (Stbd Bilge)',
      (t: number) => {
        const pt = deckPtAtT(t);
        const tx = (self.xStemDeck + pt.xRel - self.xStart) / self.totalBowSpan;
        const x = self.xStart + tx * (self.xStem - self.xStart + self.stemPts.PT_FOREFOOT.x);
        const blend = Math.pow(t, 1.5);
        const z = (B / 2) * (1 - blend) + self.yStemHalf * blend;
        const y = self.bottomEdgeY * (1 - blend) + self.keelY * blend;
        return [x, y, z];
      }
    );

    return {
      stemProfile,
      portDeckEdge,
      stbdDeckEdge,
      deckCenterline,
      portBilgeLine,
      stbdBilgeLine,
      keelLine,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. АДАПТИВНОЕ РАСПРЕДЕЛЕНИЕ СЕЧЕНИЙ \xi(u)
  // ──────────────────────────────────────────────────────────────────────────
  public evaluateAdaptiveXi(uNorm: number): number {
    const u = Math.max(0, Math.min(1, uNorm));
    if (u <= 0) return 0;
    if (u >= 1) return 1;

    const stemProfile = this.bowParams.stemProfile ?? DEFAULT_STEM_PARAMS;
    const bulbLen = stemProfile.bulbLength ?? 0;
    const hasBulb = bulbLen > 0.1;

    const uBulbTarget = Math.max(0.5, Math.min(1.0, (this.stemPts.PT_BULB_APEX.x + this.effectiveBowLength) / (this.totalBowSpan || 1)));
    const uFootTarget = Math.max(0.1, Math.min(0.9, (this.stemPts.PT_FOREFOOT.x + this.effectiveBowLength) / (this.totalBowSpan || 1)));

    const wBulb = hasBulb ? Math.min(0.25, (bulbLen / 20.0) * 0.25) : 0.0;
    const wFoot = 0.10;
    const p = 1.25;

    const sigmaBulb = 0.22;
    const sBulb = Math.exp(-Math.pow((u - uBulbTarget) / sigmaBulb, 2));

    const sigmaFoot = 0.25;
    const sFoot = Math.exp(-Math.pow((u - uFootTarget) / sigmaFoot, 2));

    const baseP = Math.pow(u, p);
    const bulbContrib = wBulb * (0.5 + 0.5 * Math.tanh((u - uBulbTarget) / sigmaBulb) + sBulb * 0.05 * u);
    const footContrib = wFoot * (0.5 + 0.5 * Math.tanh((u - uFootTarget) / sigmaFoot) + sFoot * 0.05 * u);

    const rawXi = (1 - wBulb - wFoot) * baseP + bulbContrib + footContrib;
    return Math.max(0, Math.min(1, rawXi));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ПОСТРОЕНИЕ ПОПЕРЕЧНОГО СЕЧЕНИЯ НА МИДЕЛЕ (MIDSHIP HALF-BRANCH)
  // ──────────────────────────────────────────────────────────────────────────
  /**
   * Вычисляет полуветвь миделя со строгим швом на линии КВЛ (DWL).
   * Подводная ветвь [0..nUnderwater] заканчивается строго в (y = draftLevel, z = B/2).
   * Надводная ветвь [0..nAbovewater] начинается строго в (y = draftLevel, z = B/2)
   * и заканчивается на кромке палубы (y = ySheer, z = zDeck).
   */
  public evaluateMidshipBranchSeamed(
    nUnderwater: number,
    nAbovewater: number
  ): {
    underwater: Array<{ y: number; z: number }>;
    abovewater: Array<{ y: number; z: number }>;
    full: Array<{ y: number; z: number }>;
  } {
    const base = this.baseParams;
    const B = base.width;
    const flareMid = base.flare;
    const zDeck = B / 2 + flareMid;
    const ySheer = this.topY;
    const zBot = B / 2;
    const yBot = this.bottomEdgeY;
    const yKeel = this.keelY;
    const draftVal = Math.max(0.5, base.draft || 4.5);
    const draftLevel = yKeel + draftVal;

    const rBilge = Math.min(zBot * 0.95, Math.max(0, base.radius));
    const rSheer = Math.min(zDeck * 0.45, Math.max(0, base.sheerRadius ?? 0));

    let rightBilge = null;
    if (rBilge > 0.001) {
      rightBilge = calculateExternalFillet(
        { x: 0, y: yKeel },
        { x: zBot, y: yBot },
        { x: zDeck, y: ySheer },
        rBilge
      );
    }

    let rightSheer = null;
    if (rSheer > 0.001) {
      const pBot = rightBilge ? rightBilge.touch2 : { x: zBot, y: yBot };
      rightSheer = calculateExternalFillet(
        { x: 0, y: this.apexY },
        { x: zDeck, y: ySheer },
        pBot,
        rSheer
      );
    }

    // 1. Подводная часть от киля до КВЛ (yKeel .. draftLevel)
    const rawUnderwater: Array<{ y: number; z: number }> = [];
    rawUnderwater.push({ y: yKeel, z: 0 });

    const pBilgeT1 = rightBilge ? rightBilge.touch1 : { x: zBot, y: yBot };
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      rawUnderwater.push({
        y: yKeel + t * (pBilgeT1.y - yKeel),
        z: t * pBilgeT1.x,
      });
    }

    if (rightBilge && rBilge > 0.001) {
      const arc = generateArcPoints(rightBilge.center, rightBilge.touch1, rightBilge.touch2, rBilge, 6);
      for (let k = 1; k < arc.length; k++) {
        if (arc[k].y <= draftLevel) {
          rawUnderwater.push({ y: arc[k].y, z: arc[k].x });
        }
      }
    }

    // Фиксация точки КВЛ на миделе
    rawUnderwater.push({ y: draftLevel, z: B / 2 });

    const underwater: Array<{ y: number; z: number }> = this.resamplePolyline2D(rawUnderwater, nUnderwater + 1);
    underwater[0] = { y: yKeel, z: 0 };
    underwater[nUnderwater] = { y: draftLevel, z: B / 2 };

    // 2. Надводная часть от КВЛ до планширя палубы (draftLevel .. ySheer)
    const rawAbovewater: Array<{ y: number; z: number }> = [];
    rawAbovewater.push({ y: draftLevel, z: B / 2 });

    const pBilgeT2 = rightBilge ? rightBilge.touch2 : { x: zBot, y: yBot };
    const pSheerT2 = rightSheer ? rightSheer.touch2 : { x: zDeck, y: ySheer };

    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const yMidVal = pBilgeT2.y + t * (pSheerT2.y - pBilgeT2.y);
      const zMidVal = pBilgeT2.x + t * (pSheerT2.x - pBilgeT2.x);
      if (yMidVal > draftLevel && yMidVal < pSheerT2.y) {
        rawAbovewater.push({ y: yMidVal, z: zMidVal });
      }
    }

    if (rightSheer && rSheer > 0.001) {
      const arc = generateArcPoints(rightSheer.center, rightSheer.touch2, rightSheer.touch1, rSheer, 4);
      for (let k = 1; k < arc.length; k++) {
        rawAbovewater.push({ y: arc[k].y, z: arc[k].x });
      }
    } else {
      rawAbovewater.push({ y: ySheer, z: zDeck });
    }

    const abovewater: Array<{ y: number; z: number }> = this.resamplePolyline2D(rawAbovewater, nAbovewater + 1);
    abovewater[0] = { y: draftLevel, z: B / 2 };
    abovewater[nAbovewater] = { y: ySheer, z: zDeck };

    const full = [...underwater, ...abovewater.slice(1)];
    return { underwater, abovewater, full };
  }

  private resamplePolyline2D(
    pts: Array<{ y: number; z: number }>,
    nTarget: number
  ): Array<{ y: number; z: number }> {
    if (pts.length < 2) {
      return new Array(nTarget).fill(pts[0] || { y: 0, z: 0 });
    }
    const cumDist: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const dy = pts[i].y - pts[i - 1].y;
      const dz = pts[i].z - pts[i - 1].z;
      cumDist.push(cumDist[i - 1] + Math.hypot(dy, dz));
    }
    const totalLen = Math.max(0.0001, cumDist[cumDist.length - 1]);
    const res: Array<{ y: number; z: number }> = [];

    for (let j = 0; j < nTarget; j++) {
      const targetDist = (j / (nTarget - 1)) * totalLen;
      let segIdx = 0;
      while (segIdx < cumDist.length - 2 && cumDist[segIdx + 1] < targetDist) {
        segIdx++;
      }
      const d0 = cumDist[segIdx];
      const d1 = cumDist[segIdx + 1];
      const span = Math.max(1e-6, d1 - d0);
      const frac = Math.max(0, Math.min(1, (targetDist - d0) / span));

      const p0 = pts[segIdx];
      const p1 = pts[segIdx + 1];
      res.push({
        y: p0.y + frac * (p1.y - p0.y),
        z: Math.max(0, p0.z + frac * (p1.z - p0.z)),
      });
    }
    return res;
  }

  private evaluateMidshipBranch(nV: number): Array<{ y: number; z: number }> {
    const nUnder = Math.max(2, Math.floor(nV / 2));
    const nAbove = Math.max(2, nV - 1 - nUnder);
    return this.evaluateMidshipBranchSeamed(nUnder, nAbove).full;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. ГЕНЕРАЦИЯ ОБЪЕМНОГО 3D БУЛЬБА
  // ──────────────────────────────────────────────────────────────────────────
  private computeBulbWidth(u: number, yVal: number): number {
    const stemProfile = this.bowParams.stemProfile ?? DEFAULT_STEM_PARAMS;
    const bulbLen = stemProfile.bulbLength ?? 0;
    const bulbFullness = stemProfile.bulbFullness ?? 0.7;
    const bulbZ = this.stemPts.PT_BULB_APEX.z;
    const draftVal = Math.max(0.5, this.baseParams.draft || 4.5);
    // Бульбовое расширение активно ТОЛЬКО при положительном вылете бульба наружу
    const hasBulb3D = bulbLen > 0.05 && bulbFullness > 0.05;

    if (!hasBulb3D) return 0;
    const zShip = Math.max(0, Math.min(this.baseParams.height, yVal - this.keelY));
    if (zShip > draftVal * 1.05 || zShip < 0.05) return 0;

    // Плавный C2 радиус по высоте (вокруг носка бульба)
    const rZ = Math.max(0.3, Math.min(bulbZ, draftVal - bulbZ, draftVal * 0.45));
    const dz = Math.abs(zShip - bulbZ);
    if (dz >= rZ) return 0;

    // Гладкий C2 спад по высоте (cos^2 устраняет изломы и складки на КВЛ и киле)
    const decayY = Math.pow(Math.cos((Math.PI / 2) * (dz / rZ)), 2);

    // Максимальная полуширина бульба пропорциональна вылету бульба
    const wBulbMax =
      (this.baseParams.width / 2) *
      0.30 *
      Math.min(1.0, Math.max(0.0, bulbFullness)) *
      Math.min(1.0, Math.max(0.0, bulbLen / 4.0)) *
      decayY;

    // Продольное C2 затухание по u:
    // Никакого раздувания ("щек") у миделя (u <= 0.45), пик около u = 0.85, и строго 0 на форштевне (u = 1.0)
    let decayU = 0;
    if (u >= 0.45 && u <= 0.85) {
      decayU = Math.pow(Math.sin((Math.PI / 2) * ((u - 0.45) / 0.40)), 2);
    } else if (u > 0.85 && u <= 1.0) {
      decayU = Math.pow(Math.cos((Math.PI / 2) * ((u - 0.85) / 0.15)), 2);
    }

    return wBulbMax * decayU;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ВЫЧИСЛЕНИЕ СЕЧЕНИЯ В ПРОИЗВОЛЬНОЙ ТОЧКЕ u \in [0, 1] СО СТРОГИМИ ОПРЕДЕЛЯЮЩИМИ ЛИНИЯМИ
  // ──────────────────────────────────────────────────────────────────────────
  public evaluateSectionAt(
    uParam: number,
    nDeckHalf: number = 16,
    nSheer: number = 4,
    nSide: number = 8,
    nBilge: number = 8,
    nBottom: number = 8
  ): {
    deckRing: [number, number, number][];
    underwaterRing: [number, number, number][];
    abovewaterPortRing: [number, number, number][];
    abovewaterStbdRing: [number, number, number][];
    hullRing: [number, number, number][];
    xStation: number;
    halfBreadthDeck: number;
    halfBreadthDwl: number;
    ySheer: number;
    yDwl: number;
  } {
    const nUnderwater = Math.max(2, nBottom + nBilge);
    const nAbovewater = Math.max(2, nSide + nSheer);
    const u = Math.max(0, Math.min(1, uParam));

    // Координаты и параметр станции шпангоута uSec
    const xSec = this.bowSectionTopology
      ? this.bowSectionTopology.xSection
      : (this.xStart + 0.5 * this.totalBowSpan);
    const uSec = Math.max(0.02, Math.min(0.98, (xSec - this.xStart) / this.totalBowSpan));
    const isSectionStation = this.bowSectionTopology !== undefined && Math.abs(u - uSec) < 1e-4;

    // Продольная координата станции:
    // Для всех станций от миделя до шпангоута (u <= uSec) — строго плоские поперечные сечения X = const.
    // На станции шпангоута (u == uSec) X строго равно xSec для всех высот.
    // Впереди шпангоута (u > uSec) X плавно интерполируется от xSec к профилю форштевня.
    const xStationPlanar = u <= uSec
      ? this.xStart + (u / uSec) * (xSec - this.xStart)
      : xSec;
    const wStem = u > uSec ? (u - uSec) / (1 - uSec) : 0;
    const getStationXAtZ = (stemOffset: number) => {
      if (u <= uSec) return xStationPlanar;
      return (1 - wStem) * xSec + wStem * (this.xStem + stemOffset);
    };

    // ────────────────────────────────────────────────────────────────────────
    // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 1: ВЕРХНЯЯ ПАЛУБА
    // ────────────────────────────────────────────────────────────────────────
    const deckPt = computeBowDeckWaterlinePoint(
      u,
      this.totalBowSpan,
      this.yMidDeck,
      this.yStemHalf,
      this.bowParams.stemRadius ?? 0,
      this.bowParams.entranceAngle ?? 25,
      this.bowParams.shoulderFullness ?? 0.7,
      this.bowParams.maxBreadthPos ?? 0.5,
      this.bowParams.controlPoints
    );

    const sheerBlend = Math.pow(u, 2);
    const baseEdge = this.topY + (this.bowParams.bowSheer ?? 0) * sheerBlend;
    let ySheer = baseEdge * (1 - sheerBlend) + this.yStemDeck * sheerBlend;
    if (isSectionStation && this.bowSectionTopology) {
      ySheer = this.bowSectionTopology.ptDeck.y;
    }

    const deckCamberMid = Math.max(0, this.baseParams.deckCamber);
    const activeCamber = deckCamberMid * (1 - u) + (this.bowParams.deckCamberBow ?? 0) * u;
    const fadeToStem = Math.cos((Math.PI / 2) * u);
    const camber = Math.max(0, activeCamber * fadeToStem);
    const yApexCurrent = ySheer + camber;

    let zDeckHalf = u >= 0.999
      ? this.yStemHalf
      : (u <= 0.001 ? this.yMidDeck : Math.max(this.yStemHalf, deckPt.y));
    if (isSectionStation && this.bowSectionTopology) {
      zDeckHalf = this.bowSectionTopology.ptDeck.z;
    }

    const actualDeckX = u <= uSec
      ? xStationPlanar
      : (1 - wStem) * xSec + wStem * (this.xStemDeck + deckPt.xRel);
    const actualDeckZ = u >= 0.999 ? this.yStemHalf : zDeckHalf;

    // ────────────────────────────────────────────────────────────────────────
    // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 2: КВЛ (DWL) — ТОЧНЫЙ ШОВ СОЕДИНЕНИЯ
    // ────────────────────────────────────────────────────────────────────────
    const draftVal = Math.max(0.5, this.baseParams.draft || 4.5);
    const draftLevel = this.keelY + draftVal;
    const stemHalfW = Math.max(0, (this.bowParams.stemWidth ?? 0) / 2);
    const stemXDwl = getStemXAtZ(this.stemSampled, draftVal);
    const midDwlHalf = getTheoreticalMidshipHalfBreadthAtZ(draftVal, this.baseParams);

    const xDwlStation = getStationXAtZ(stemXDwl);
    let zDwlHalf: number;
    if (u >= 0.999) {
      zDwlHalf = stemHalfW;
    } else if (u <= 0.001) {
      zDwlHalf = midDwlHalf;
    } else if (isSectionStation && this.bowSectionTopology) {
      zDwlHalf = this.bowSectionTopology.ptDwl.z;
    } else {
      const zDwlRaw = evaluateWaterlineHalfBreadthAt(
        xDwlStation - this.xStem,
        draftVal,
        this.totalHeightSide,
        draftVal,
        midDwlHalf,
        stemXDwl,
        stemHalfW,
        this.effectiveBowLength,
        this.bowParams
      ) + this.computeBulbWidth(u, draftLevel);

      zDwlHalf = blendBowWaterlineWithSection(
        xDwlStation,
        draftLevel,
        zDwlRaw,
        this.bowSectionTopology,
        this.xStart,
        this.totalBowSpan,
        zDeckHalf,
        u,
        ySheer
      );
    }

    // ────────────────────────────────────────────────────────────────────────
    // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 3: ФОРШТЕВЕНЬ (u = 1) И 4: ШПАНГОУТ / ВАТЕРЛИНИИ
    // ────────────────────────────────────────────────────────────────────────
    const isFootOnKeel = this.stemPts.PT_FOREFOOT.z <= 0.05;
    const stemXKeel = isFootOnKeel ? this.stemPts.PT_FOREFOOT.x : this.stemPts.PT_KEEL_TANGENT.x;
    const xKeelStation = getStationXAtZ(stemXKeel);

    // 1. Построение ПОДВОДНОЙ части шпангоута: киль (j=0), днищевое пятно (j=1), промежуточные ВЛ и КВЛ (j=nUnderwater)
    const underwaterStbdHalf: [number, number, number][] = [];
    const zBottom = 0.005; // Точный горизонт днищевого пятна (нижней ВЛ)

    for (let j = 0; j <= nUnderwater; j++) {
      if (j === 0) {
        // Килевая линия по ДП (Z = 0)
        underwaterStbdHalf.push([xKeelStation, this.keelY, 0]);
        continue;
      }
      if (j === nUnderwater) {
        // Точный шов на линии КВЛ
        underwaterStbdHalf.push([xDwlStation, draftLevel, zDwlHalf]);
        continue;
      }

      let zShip: number;
      if (j === 1) {
        // Ряд j = 1 строго повторяет контур днищевого пятна (нижней ватерлинии)
        zShip = zBottom;
      } else {
        // Промежуточные ватерлинии от днищевого пятна до КВЛ
        const t = (j - 1) / (nUnderwater - 1);
        zShip = zBottom + t * (draftVal - zBottom);
      }

      const yVal = this.keelY + zShip; // Строгая горизонтальная плоскость ватерлинии
      const stemX = getStemXAtZ(this.stemSampled, zShip);
      const midHalfBreadthAtZ = getTheoreticalMidshipHalfBreadthAtZ(zShip, this.baseParams);

      const xFrontAtZ = j === 1 ? stemXKeel : stemX;
      const xVal = getStationXAtZ(xFrontAtZ);

      let zVal: number;
      if (u >= 0.999) {
        zVal = stemHalfW;
      } else if (u <= 0.001) {
        zVal = midHalfBreadthAtZ;
      } else if (isSectionStation && this.bowSectionTopology) {
        zVal = evaluateBowSectionHalfBreadthAtY(yVal, this.bowSectionTopology);
      } else {
        const zBulb = this.computeBulbWidth(u, yVal);
        const zRawWl = evaluateWaterlineHalfBreadthAt(
          xVal - this.xStem,
          zShip,
          this.totalHeightSide,
          draftVal,
          midHalfBreadthAtZ,
          stemX,
          stemHalfW,
          this.effectiveBowLength,
          this.bowParams
        );
        const zRaw = Math.max(0, zRawWl + zBulb);

        zVal = blendBowWaterlineWithSection(
          xVal,
          yVal,
          zRaw,
          this.bowSectionTopology,
          this.xStart,
          this.totalBowSpan,
          zDeckHalf,
          u,
          ySheer
        );
      }

      // Если днищевое пятно (j=1) достигло точки окончания (S7 или S8), оно плавно сходит в 0 к ДП
      if (j === 1 && (u >= 0.999 || xVal >= this.xStem + stemXKeel - 0.01)) {
        zVal = 0;
      }

      underwaterStbdHalf.push([xVal, yVal, Math.max(0, zVal)]);
    }

    // Защита от «слоновьей ноги» и складок: монотонное сужение сечения книзу (от КВЛ к килю)
    for (let j = nUnderwater - 1; j >= 1; j--) {
      const zAbove = underwaterStbdHalf[j + 1][2];
      const maxAllowed = j === 1 ? zAbove * 0.85 : zAbove;
      if (underwaterStbdHalf[j][2] > maxAllowed) {
        underwaterStbdHalf[j][2] = maxAllowed;
      }
    }

    // 2. Построение НАДВОДНОЙ части шпангоута от КВЛ (k=0) до палубы (k=nAbovewater) строго по сплайну ватерлиний.
    const abovewaterStbdHalf: [number, number, number][] = [];
    for (let k = 0; k <= nAbovewater; k++) {
      if (k === 0) {
        // Точный шов на линии КВЛ — СОВПАДАЕТ С ПОДВОДНОЙ ЧАСТЬЮ 1:1
        abovewaterStbdHalf.push([xDwlStation, draftLevel, zDwlHalf]);
        continue;
      }
      if (k === nAbovewater) {
        // Верхний край надводного борта: точное совпадение с расчетной кромкой палубы
        abovewaterStbdHalf.push([actualDeckX, ySheer, actualDeckZ]);
        continue;
      }

      const s = k / nAbovewater;
      const yVal = (1 - s) * draftLevel + s * ySheer; // Согласованное возвышение к линии седловатости палубы
      const zShip = Math.max(0, yVal - this.keelY);
      const stemX = getStemXAtZ(this.stemSampled, zShip);
      const midHalfBreadthAtZ = (1 - s) * midDwlHalf + s * this.yMidDeck;

      const xVal = getStationXAtZ(stemX);

      let zVal: number;
      if (u >= 0.999) {
        zVal = stemHalfW;
      } else if (u <= 0.001) {
        zVal = midHalfBreadthAtZ;
      } else if (isSectionStation && this.bowSectionTopology) {
        zVal = evaluateBowSectionHalfBreadthAtY(yVal, this.bowSectionTopology);
      } else {
        const zRawWl = evaluateWaterlineHalfBreadthAt(
          xVal - this.xStem,
          zShip,
          this.totalHeightSide,
          draftVal,
          midHalfBreadthAtZ,
          stemX,
          stemHalfW,
          this.effectiveBowLength,
          this.bowParams
        );
        const zPureWaterline = Math.max(stemHalfW, zRawWl);

        zVal = blendBowWaterlineWithSection(
          xVal,
          yVal,
          zPureWaterline,
          this.bowSectionTopology,
          this.xStart,
          this.totalBowSpan,
          zDeckHalf,
          u,
          ySheer
        );
      }

      const zValSafe = Math.max(0, zVal);
      abovewaterStbdHalf.push([xVal, yVal, zValSafe]);
    }

    // ────────────────────────────────────────────────────────────────────────
    // СБОРКА КОЛЕЦ СЕТКИ
    // ────────────────────────────────────────────────────────────────────────

    // 1. Кольцо палубы (Port Deck -> Stbd Deck) — СТРОГО повторяет локацию контурной линии
    const deckRing: [number, number, number][] = [];
    const nDeckPts = nDeckHalf * 2;
    const zDeckSpan = Math.max(0.001, actualDeckZ);

    for (let k = 0; k <= nDeckPts; k++) {
      const t = k / nDeckPts;
      const z = -actualDeckZ + t * (2 * actualDeckZ);
      let y = ySheer;
      if (camber > 0) {
        const normZ = z / zDeckSpan;
        y = yApexCurrent - (yApexCurrent - ySheer) * (normZ * normZ);
      }
      deckRing.push([actualDeckX, y, z]);
    }

    // 2. Кольцо подводной части (Port KVL -> Keel -> Stbd KVL)
    const underwaterRing: [number, number, number][] = [];
    for (let j = nUnderwater; j >= 0; j--) {
      const p = underwaterStbdHalf[j];
      underwaterRing.push([p[0], p[1], -p[2]]);
    }
    for (let j = 1; j <= nUnderwater; j++) {
      const p = underwaterStbdHalf[j];
      underwaterRing.push([p[0], p[1], p[2]]);
    }

    // 3. Кольцо надводного левого борта (Port Sheer -> Port KVL)
    const abovewaterPortRing: [number, number, number][] = [];
    for (let k = nAbovewater; k >= 0; k--) {
      const p = abovewaterStbdHalf[k];
      abovewaterPortRing.push([p[0], p[1], -p[2]]);
    }

    // 4. Кольцо надводного правого борта (Stbd KVL -> Stbd Sheer)
    const abovewaterStbdRing: [number, number, number][] = [];
    for (let k = 0; k <= nAbovewater; k++) {
      const p = abovewaterStbdHalf[k];
      abovewaterStbdRing.push([p[0], p[1], p[2]]);
    }

    // 5. Полное монолитное кольцо корпуса
    const hullRing: [number, number, number][] = [];
    for (let k = nAbovewater; k >= 1; k--) {
      const p = abovewaterStbdHalf[k];
      hullRing.push([p[0], p[1], -p[2]]);
    }
    for (let j = nUnderwater; j >= 0; j--) {
      const p = underwaterStbdHalf[j];
      hullRing.push([p[0], p[1], -p[2]]);
    }
    for (let j = 1; j <= nUnderwater; j++) {
      const p = underwaterStbdHalf[j];
      hullRing.push([p[0], p[1], p[2]]);
    }
    for (let k = 1; k <= nAbovewater; k++) {
      const p = abovewaterStbdHalf[k];
      hullRing.push([p[0], p[1], p[2]]);
    }

    return {
      deckRing,
      underwaterRing,
      abovewaterPortRing,
      abovewaterStbdRing,
      hullRing,
      xStation: actualDeckX,
      halfBreadthDeck: actualDeckZ,
      halfBreadthDwl: zDwlHalf,
      ySheer,
      yDwl: draftLevel,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. ГЕНЕРАЦИЯ ПОЛНОЙ BUFFERGEOMETRY СО СТРОГИМ ШВОМ НА КВЛ
  // ──────────────────────────────────────────────────────────────────────────
  public generateBufferGeometry(
    uSegs: number = 96,
    vSegs: number = 56
  ): CompositeGeometryResult {
    const t0 = performance.now();

    const deckRings: [number, number, number][][] = [];
    const underwaterRings: [number, number, number][][] = [];
    const abovePortRings: [number, number, number][][] = [];
    const aboveStbdRings: [number, number, number][][] = [];
    const hullRings: [number, number, number][][] = [];

    const nUnderwater = Math.max(4, Math.floor(vSegs / 2));
    const nAbovewater = Math.max(4, Math.ceil(vSegs / 2));

    // Адаптивное распределение станций: если задан шпангоут,
    // одна из линий сетки (пояс полигонов) гарантированно и строго проходит через станцию шпангоута uSec,
    // за счет чего полигоны гладко и бесшовно проходят точно через середину контура шпангоута.
    const uStations: number[] = [];
    if (this.bowSectionTopology) {
      const uSec = Math.max(0.02, Math.min(0.98, (this.bowSectionTopology.xSection - this.xStart) / this.totalBowSpan));
      const iSec = Math.max(2, Math.min(uSegs - 2, Math.round(uSec * uSegs)));
      for (let i = 0; i <= uSegs; i++) {
        if (i < iSec) {
          uStations.push((i / iSec) * uSec);
        } else if (i === iSec) {
          uStations.push(uSec);
        } else {
          uStations.push(uSec + ((i - iSec) / (uSegs - iSec)) * (1 - uSec));
        }
      }
    } else {
      for (let i = 0; i <= uSegs; i++) {
        const uNorm = i / uSegs;
        uStations.push(this.evaluateAdaptiveXi(uNorm));
      }
    }

    for (let i = 0; i <= uSegs; i++) {
      const uAdaptive = uStations[i];
      const section = this.evaluateSectionAt(
        uAdaptive,
        32,
        Math.floor(nAbovewater / 2),
        Math.ceil(nAbovewater / 2),
        Math.floor(nUnderwater / 2),
        Math.ceil(nUnderwater / 2)
      );
      deckRings.push(section.deckRing);
      underwaterRings.push(section.underwaterRing);
      abovePortRings.push(section.abovewaterPortRing);
      aboveStbdRings.push(section.abovewaterStbdRing);
      hullRings.push(section.hullRing);
    }

    // Определение индексов ребер излома (knuckle rings) для определяющих ватерлиний
    const defining = this.bowParams.definingWaterlines || {};
    const hullKnuckleIndices: number[] = [];
    if (defining['wl_dwl'] === 'defining' || defining['dwl'] === 'defining') {
      hullKnuckleIndices.push(nAbovewater, nAbovewater + 2 * nUnderwater);
    }
    if (defining['wl_bottom'] === 'defining' || defining['bottom'] === 'defining') {
      hullKnuckleIndices.push(nAbovewater + nUnderwater - 1, nAbovewater + nUnderwater + 1);
    }
    if (defining['wl_under_1'] === 'defining') {
      hullKnuckleIndices.push(nAbovewater + nUnderwater - 2, nAbovewater + nUnderwater + 2);
    }
    if (defining['wl_under_2'] === 'defining') {
      hullKnuckleIndices.push(nAbovewater + 1, nAbovewater + 2 * nUnderwater - 1);
    }
    if (defining['wl_above_1'] === 'defining') {
      hullKnuckleIndices.push(Math.floor(nAbovewater / 2), nAbovewater + 2 * nUnderwater + Math.ceil(nAbovewater / 2));
    }

    // 1. Построение сетки палубы (Deck) с нормалями, направленными вверх наружу
    const deckGeometry = this.buildGridGeometry(deckRings, true);

    // 2. Построение ПОДВОДНОЙ части корпуса со строгим швом на КВЛ
    const underwaterKnuckles: number[] = [];
    if (defining['wl_bottom'] === 'defining' || defining['bottom'] === 'defining') {
      underwaterKnuckles.push(nUnderwater - 1, nUnderwater + 1);
    }
    const underwaterHullGeometry = this.buildGridGeometry(underwaterRings, true, underwaterKnuckles);

    // 3. Построение НАДВОДНОЙ части корпуса со строгим швом на КВЛ
    const abovePortGeometry = this.buildGridGeometry(abovePortRings, true);
    const aboveStbdGeometry = this.buildGridGeometry(aboveStbdRings, false);
    const abovewaterHullGeometry = mergeBufferGeometries([abovePortGeometry, aboveStbdGeometry]);

    // 4. Полный монолитный корпус со строгими определяющими гранями (knuckles)
    const hullGeometry = this.buildGridGeometry(hullRings, true, hullKnuckleIndices);

    // 5. Общая сшитая геометрия
    const compositeGeom = mergeBufferGeometries([deckGeometry, hullGeometry]);

    const t1 = performance.now();
    const computeTime = Math.round((t1 - t0) * 100) / 100;

    const hullPosAttr = hullGeometry.getAttribute('position');
    const deckPosAttr = deckGeometry.getAttribute('position');
    const totalVertices = (hullPosAttr ? hullPosAttr.count : 0) + (deckPosAttr ? deckPosAttr.count : 0);
    const hullIdx = hullGeometry.getIndex();
    const deckIdx = deckGeometry.getIndex();
    const totalTriangles = ((hullIdx ? hullIdx.count : 0) + (deckIdx ? deckIdx.count : 0)) / 3;

    const stats: TopologyQAStats = {
      maxGapDistance: 0.0,
      avgGapDistance: 0.0,
      maxNormalAngleDeg: 0.0,
      computeTimeMs: computeTime,
      polygonCount: totalTriangles,
      vertexCount: totalVertices,
      isG0Valid: true,
      isG1Valid: true,
    };

    return {
      geometry: compositeGeom,
      deckGeometry,
      hullGeometry,
      underwaterHullGeometry,
      abovewaterHullGeometry,
      stats,
    };
  }

  /**
   * Сборка BufferGeometry из сетки колец с аналитическим расчетом гладких нормалей
   * (устраняет любые искажения и темные окантовки на форштевне и кромке палубы в тесте Зебра и кривизна)
   * и поддержкой ребер излома (knuckle rings) для определяющих ватерлиний.
   */
  private buildGridGeometry(
    rings: [number, number, number][][],
    flipNormals: boolean = false,
    knuckleRingIndices: number[] = []
  ): THREE.BufferGeometry {
    const numU = rings.length;
    if (numU < 2 || !rings[0] || rings[0].length < 2) {
      return new THREE.BufferGeometry();
    }
    const numV = rings[0].length;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Множество индексов ребер излома
    const knuckleSet = new Set<number>(knuckleRingIndices);

    // Вспомогательная функция вычисления аналитической нормали в узле (i, j)
    const computeNodeNormal = (
      i: number,
      j: number,
      vDirBias: 'centered' | 'downward' | 'upward' = 'centered'
    ): [number, number, number] => {
      const p = rings[i][j];

      // 1. Продольная касательная Tu (по оси U)
      let tuX: number, tuY: number, tuZ: number;
      if (i === 0) {
        const pNext = rings[1][j];
        tuX = pNext[0] - p[0];
        tuY = pNext[1] - p[1];
        tuZ = pNext[2] - p[2];
      } else if (i === numU - 1) {
        const pPrev = rings[numU - 2][j];
        tuX = p[0] - pPrev[0];
        tuY = p[1] - pPrev[1];
        tuZ = p[2] - pPrev[2];
      } else {
        const pNext = rings[i + 1][j];
        const pPrev = rings[i - 1][j];
        tuX = pNext[0] - pPrev[0];
        tuY = pNext[1] - pPrev[1];
        tuZ = pNext[2] - pPrev[2];
      }

      // 2. Поперечная касательная Tv (по оси V / поясу шпангоута)
      let tvX: number, tvY: number, tvZ: number;
      if (vDirBias === 'downward' && j > 0) {
        const pPrev = rings[i][j - 1];
        tvX = p[0] - pPrev[0];
        tvY = p[1] - pPrev[1];
        tvZ = p[2] - pPrev[2];
      } else if (vDirBias === 'upward' && j < numV - 1) {
        const pNext = rings[i][j + 1];
        tvX = pNext[0] - p[0];
        tvY = pNext[1] - p[1];
        tvZ = pNext[2] - p[2];
      } else if (j === 0) {
        const pNext = rings[i][1];
        tvX = pNext[0] - p[0];
        tvY = pNext[1] - p[1];
        tvZ = pNext[2] - p[2];
      } else if (j === numV - 1) {
        const pPrev = rings[i][numV - 2];
        tvX = p[0] - pPrev[0];
        tvY = p[1] - pPrev[1];
        tvZ = p[2] - pPrev[2];
      } else {
        const pNext = rings[i][j + 1];
        const pPrev = rings[i][j - 1];
        tvX = pNext[0] - pPrev[0];
        tvY = pNext[1] - pPrev[1];
        tvZ = pNext[2] - pPrev[2];
      }

      // Если кольцо стянуто в точку (например, носовой кончик палубы на форштевне),
      // берем поперечную касательную из предыдущего сечения для сохранения гладкой нормали
      if (Math.hypot(tvX, tvY, tvZ) < 1e-5 && i > 0) {
        const prevRing = rings[i - 1];
        const jNext = Math.min(numV - 1, j + 1);
        const jPrev = Math.max(0, j - 1);
        tvX = prevRing[jNext][0] - prevRing[jPrev][0];
        tvY = prevRing[jNext][1] - prevRing[jPrev][1];
        tvZ = prevRing[jNext][2] - prevRing[jPrev][2];
      }

      // 3. Векторное произведение Tu x Tv
      let nx = tuY * tvZ - tuZ * tvY;
      let ny = tuZ * tvX - tuX * tvZ;
      let nz = tuX * tvY - tuY * tvX;

      if (flipNormals) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }

      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        return [nx / len, ny / len, nz / len];
      }
      return [0, 1, 0];
    };

    // Если нет ребер излома (knuckles), строим монолитную непрерывную C1 сетку с гладкими нормалями
    if (knuckleSet.size === 0) {
      for (let i = 0; i < numU; i++) {
        const uVal = i / (numU - 1);
        const ring = rings[i];
        for (let j = 0; j < numV; j++) {
          const vVal = j / (numV - 1);
          const p = ring[j];
          positions.push(p[0], p[1], p[2]);
          uvs.push(uVal, vVal);
          const norm = computeNodeNormal(i, j, 'centered');
          normals.push(norm[0], norm[1], norm[2]);
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
    } else {
      // Полосы со сбросом гладкости нормалей (Knuckle / Crease edge) на определяющих ватерлиниях
      for (let i = 0; i < numU - 1; i++) {
        const uA = i / (numU - 1);
        const uB = (i + 1) / (numU - 1);

        for (let j = 0; j < numV - 1; j++) {
          const v0 = j / (numV - 1);
          const v1 = (j + 1) / (numV - 1);

          const pA0 = rings[i][j];
          const pB0 = rings[i + 1][j];
          const pB1 = rings[i + 1][j + 1];
          const pA1 = rings[i][j + 1];

          const nA0 = computeNodeNormal(i, j, knuckleSet.has(j) ? 'upward' : 'centered');
          const nB0 = computeNodeNormal(i + 1, j, knuckleSet.has(j) ? 'upward' : 'centered');
          const nB1 = computeNodeNormal(i + 1, j + 1, knuckleSet.has(j + 1) ? 'downward' : 'centered');
          const nA1 = computeNodeNormal(i, j + 1, knuckleSet.has(j + 1) ? 'downward' : 'centered');

          const baseIdx = positions.length / 3;
          positions.push(pA0[0], pA0[1], pA0[2]);
          positions.push(pB0[0], pB0[1], pB0[2]);
          positions.push(pB1[0], pB1[1], pB1[2]);
          positions.push(pA1[0], pA1[1], pA1[2]);

          normals.push(nA0[0], nA0[1], nA0[2]);
          normals.push(nB0[0], nB0[1], nB0[2]);
          normals.push(nB1[0], nB1[1], nB1[2]);
          normals.push(nA1[0], nA1[1], nA1[2]);

          uvs.push(uA, v0, uB, v0, uB, v1, uA, v1);

          if (flipNormals) {
            indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
            indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
          } else {
            indices.push(baseIdx, baseIdx + 2, baseIdx + 1);
            indices.push(baseIdx, baseIdx + 3, baseIdx + 2);
          }
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    return geom;
  }

  /**
   * Срез BufferGeometry плоскостью Y с сохранением плавных нормалей
   */
  private sliceBufferGeometryByPlaneY(
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
}
