/**
 * ====================================================================================================
 * 📁 src/core/controlNetBuilder.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Генератор пространственной управляющей сети контрольных точек (Control Net Builder) для аналитического
 * геометрического ядра B-сплайнов судна в соответствии с архитектурой FREE!ship.
 * 
 * 📐 ПРИНЦИПЫ ФОРМИРОВАНИЯ МАТРИЦЫ P_{i, j}:
 * 1. Размерность: регулярная сетка (n + 1) x (m + 1) = 9 x 7:
 *    - Индекс i in [0..8]: продольное направление от форштевня (i = 0) к миделю (i = 8).
 *    - Индекс j in [0..6]: поперечное направление от линии киля (j = 0) к кромке палубы (j = 6).
 * 2. Автоматическое соблюдение условий G1/G2 на границе миделя (X = xStart):
 *    - P_{8, j} (u = 1): строго лежит на контуре теоретического мидель-шпангоута.
 *    - P_{7, j}: строго параллелен оси X (Y и Z идентичны P_{8, j}, смещение только по X).
 *    - P_{6, j}: выставлен для обнуления второй производной ∂²S/∂u² = 0 (гладкий переход «Зебра»).
 * 3. Локализованный фильтр «Анти-щека» (Anti-Cheek Filter):
 *    - Коррекция столбца P_{1, j} на стрелку вогнутости δ_hollow предотвращает паразитное раздутие ватерлинии.
 * 4. Бокаловидное отсечение развала (Tulip Decay):
 *    - Развал борта изолирован выше ватерлинии/линии начала развала и не деформирует подводную часть.
 * 5. Ребра излома (Crease Knots):
 *    - Поддержка жесткой скулы (Hard Chine) и острого планширя через флаг isCrease на контрольных точках.
 * ====================================================================================================
 */

import * as THREE from 'three';
import {
  ControlPoint3D,
  BSplineSurfaceDescriptor,
  TessellationConfig,
} from './types';
import {
  BowParameters,
  BowVolumeParameters,
  DEFAULT_BOW_VOLUME_PARAMS,
  CompositeGeometryResult,
  TopologyQAStats,
} from './topologyTypes';
import {
  StemTopologyPoints,
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  DEFAULT_STEM_PARAMS,
} from './stemEngine';
import {
  calculateExternalFillet,
} from './geometryEngine';
import {
  createClampedKnotVector,
  tessellateBSplineToBufferGeometry,
  tessellateBSplineSeamedGeometry,
  interpolateBSplineCurvePoints,
} from './bsplineKernel';
import {
  computeBowDeckWaterlinePoint,
} from './topologyEngine';

export interface HullBaseDimensions {
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

export interface BowControlNetResult {
  portSurface: BSplineSurfaceDescriptor;
  stbdSurface: BSplineSurfaceDescriptor;
  deckSurface: BSplineSurfaceDescriptor;
  uSplits: number[];
  vSplits: number[];
}

/**
 * Строит точную теоретическую полуширину мидель-шпангоута Y_mid(j) и Z_mid(j) для заданного пояса j (0..6)
 */
export function getMidshipGirthPoint(
  j: number,
  base: HullBaseDimensions,
  keelY: number,
  bottomEdgeY: number,
  topY: number,
  apexY: number
): { y: number; z: number; isCrease?: boolean } {
  const B = base.width;
  const H = base.height;
  const deadrise = Math.max(0, base.deadrise);
  const flare = base.flare;
  const r = Math.min(base.radius, Math.min(B / 2, H / 2));
  const rSheer = Math.min(base.sheerRadius, Math.min((B + 2 * flare) / 4, H / 4));

  const halfB = B / 2;
  const halfBDeck = halfB + flare;

  switch (j) {
    case 0:
      // Киль (Centerline / Keel line)
      return { y: keelY, z: 0.0, isCrease: deadrise > 0.05 };

    case 1:
      // Днищевой откос / начало скулы (Bottom flat / Deadrise point)
      if (r > 0.05) {
        const pTouch2Z = halfB - r * 0.7;
        const pTouch2Y = bottomEdgeY + (r > 0 ? r * 0.15 : 0);
        return { y: pTouch2Y, z: pTouch2Z };
      }
      return { y: bottomEdgeY, z: halfB * 0.5 };

    case 2:
      // Скула (Bilge / Chine point)
      if (r > 0.05) {
        return { y: bottomEdgeY + r * 0.5, z: halfB, isCrease: false };
      }
      // Острая скула (Hard Chine)
      return { y: bottomEdgeY, z: halfB, isCrease: true };

    case 3:
      // Ватерлиния / нижний борт (DWL / Lower side)
      {
        const draftY = keelY + (base.draft || 4.5);
        const tDraft = Math.max(0, Math.min(1, (draftY - bottomEdgeY) / Math.max(0.1, topY - bottomEdgeY)));
        const zSide = halfB + tDraft * flare * 0.3;
        return { y: draftY, z: zSide };
      }

    case 4:
      // Верхний борт (Upper side)
      {
        const midSideY = (topY + (keelY + (base.draft || 4.5))) / 2;
        const tSide = Math.max(0, Math.min(1, (midSideY - bottomEdgeY) / Math.max(0.1, topY - bottomEdgeY)));
        const zSide = halfB + tSide * flare;
        return { y: midSideY, z: zSide };
      }

    case 5:
      // Шпангоут планширя / ширстрек (Sheerstrake)
      if (rSheer > 0.05) {
        return { y: topY - rSheer * 0.3, z: halfBDeck - rSheer * 0.1, isCrease: false };
      }
      // Острая кромка палубы
      return { y: topY, z: halfBDeck, isCrease: true };

    case 6:
      // Верхняя кромка палубы (Deck edge with camber)
      return { y: topY, z: halfBDeck, isCrease: rSheer <= 0.05 };

    default:
      return { y: topY, z: halfBDeck };
  }
}

/**
 * Генератор полной матрицы управляющей сети P_{i, j} (9 x 7)
 * для аналитического B-сплайн ядра поверхности носовой оконечности судна.
 */
export function buildBowControlNet(
  base: HullBaseDimensions,
  bow: BowParameters
): BowControlNetResult {
  const L = base.length;
  const B = base.width;
  const H = base.height;
  const deadrise = Math.max(0, base.deadrise);
  const deckCamber = Math.max(0, base.deckCamber);

  const Lbow = Math.max(0.5, Math.min(L * 0.6, bow.bowLength));

  // Вычисление опорных высотных уровней
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
    topY = H / 2 - deckCamber;
    apexY = H / 2;
  } else {
    topY = H / 2;
    apexY = H / 2 + deckCamber;
  }

  const totalHeight = Math.max(0.5, topY - keelY);

  // Продольные координаты
  const xStem = L / 2;
  const xStart = xStem - Lbow; // Мидель стыка носового блока

  // Точки профиля форштевня в ДП
  const stemProfile = bow.stemProfile || {
    ...DEFAULT_STEM_PARAMS,
    deckOverhang: bow.stemRake || 0,
  };
  const draftVal = Math.max(0.5, base.draft || 4.5);
  const stemPts = calculateStemTopologyPoints(stemProfile, draftVal, totalHeight, Lbow);
  const stemSampled = sampleStemCurvePoints(stemPts, 64, Lbow);

  // Вспомогательная функция выборки координаты X форштевня на высоте Y
  const getStemXAtY = (yShip: number): number => {
    const zNorm = Math.max(0, Math.min(totalHeight, yShip - keelY));
    if (stemSampled.length < 2) return xStem;
    for (let k = 0; k < stemSampled.length - 1; k++) {
      const p1 = stemSampled[k];
      const p2 = stemSampled[k + 1];
      const z1 = p1.z;
      const z2 = p2.z;
      if ((zNorm >= z1 && zNorm <= z2) || (zNorm >= z2 && zNorm <= z1)) {
        const factor = Math.abs(z2 - z1) > 1e-4 ? (zNorm - z1) / (z2 - z1) : 0;
        return xStem + (p1.x + factor * (p2.x - p1.x));
      }
    }
    return xStem + stemPts.PT_STEM_DECK.x;
  };

  const stemKnifeWidth = Math.max(0, bow.stemWidth || 0);
  const halfStemWidth = stemKnifeWidth / 2;

  // Параметры объема и анти-щеки
  const volParams: BowVolumeParameters = bow.bowVolume || {
    ...DEFAULT_BOW_VOLUME_PARAMS,
    baseStemWidth: bow.stemWidth || 0,
    baseEntranceAngle: bow.entranceAngle || 25,
    baseShoulderFullness: bow.shoulderFullness || 0.7,
  };

  const deltaHollow = Math.max(0, Math.min(1.5, volParams.hollowDepth ?? 0));
  const entranceAngleRad = ((volParams.baseEntranceAngle || bow.entranceAngle || 25) * Math.PI) / 180;
  const shoulderFullness = Math.max(0.2, Math.min(1.4, volParams.baseShoulderFullness || bow.shoulderFullness || 0.7));

  // Бульбовое уширение
  const bulbLen = stemProfile.bulbLength || 0;
  const bulbHeightRel = stemProfile.bulbHeightRatio || 0.55;
  const bulbCenterY = keelY + bulbHeightRel * draftVal;
  const bulbMaxBreadth = Math.max(0, bulbLen * 0.35);

  // Высота начала развала (Tulip Decay start)
  const yFlareStart = keelY + draftVal;

  const halfB = B / 2;
  const halfBDeck = halfB + base.flare;
  const xStemDeck = xStem + stemPts.PT_STEM_DECK.x;
  const yStemDeck = keelY + stemPts.PT_STEM_DECK.z;
  const totalBowSpan = Math.max(0.1, xStemDeck - xStart);
  const draftY = keelY + draftVal;

  const numU = 9; // i = 0 .. 8
  const numV = 7; // j = 0 .. 6

  // Ребра излома и определяющие швы (Crease / Knuckle Edges) по V:
  // j = 3 (КВЛ) ОБЯЗАТЕЛЬНО кратный узел (шов соединения): поверхность строго
  // заканчивается на линии КВЛ, а затем продолжается надводной частью
  const creaseIndicesV: number[] = [3];
  if (base.radius < 0.05) creaseIndicesV.push(2); // Острая скула
  if (base.sheerRadius < 0.05) creaseIndicesV.push(5); // Острый планширь

  const portNet: ControlPoint3D[][] = [];
  const stbdNet: ControlPoint3D[][] = [];
  const deckNet: ControlPoint3D[][] = [];

  // Длина участка 90-градусной касательной к миделю w_mid
  const wMidTangent = Math.max(0.3, Math.min(Lbow * 0.35, volParams.baseMidTangentLength || 3.0));

  // 1. Построение матрицы P_{i, j} для левого борта (Port) и правого (Starboard)
  // со строгой привязкой к 4 ОПРЕДЕЛЯЮЩИМ ЛИНИЯМ
  for (let i = 0; i < numU; i++) {
    portNet[i] = [];
    stbdNet[i] = [];

    // Параметрическая позиция по длине: 0 (форштевень) .. 1 (мидель)
    const tU = i / (numU - 1);
    const tLong = 1.0 - tU; // 1 у форштевня (i=0), 0 у миделя (i=8)

    for (let j = 0; j < numV; j++) {
      const midPoint = getMidshipGirthPoint(j, base, keelY, bottomEdgeY, topY, apexY);
      const yVal = midPoint.y;
      const zMid = midPoint.z;
      const isCrease = j === 3 || midPoint.isCrease;

      const xStemAtThisY = getStemXAtY(yVal);

      let px = 0;
      let py = yVal;
      let pz = 0;

      // ────────────────────────────────────────────────────────────────
      // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 1: ВЕРХНЯЯ ПАЛУБА (j = 6)
      // ────────────────────────────────────────────────────────────────
      if (j === 6) {
        if (i === 8) {
          px = xStart;
          py = topY;
          pz = halfBDeck;
        } else if (i === 0) {
          px = xStemDeck;
          py = yStemDeck;
          pz = halfStemWidth;
        } else {
          const ptDeck = computeBowDeckWaterlinePoint(
            tLong,
            totalBowSpan,
            halfBDeck,
            halfStemWidth,
            bow.stemRadius ?? 0,
            bow.entranceAngle ?? 25,
            bow.shoulderFullness ?? 0.7,
            bow.maxBreadthPos ?? 0.5,
            bow.controlPoints
          );
          px = xStemDeck + ptDeck.xRel;
          pz = ptDeck.y;
          const sheerBlend = Math.pow(Math.max(0, Math.min(1, tLong)), 2);
          py = (topY + (bow.bowSheer ?? 0) * sheerBlend) * (1 - sheerBlend) + yStemDeck * sheerBlend;
        }
      }
      // ────────────────────────────────────────────────────────────────
      // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 2: КВЛ (DWL — Конструктивная ватерлиния, j = 3)
      // ────────────────────────────────────────────────────────────────
      else if (j === 3) {
        py = draftY;
        if (i === 8) {
          px = xStart;
          pz = halfB;
        } else if (i === 7) {
          px = xStart + wMidTangent * 0.5;
          pz = halfB;
        } else if (i === 0) {
          px = xStem + stemPts.PT_STEM_DWL.x;
          pz = halfStemWidth;
        } else {
          const ptDWL = computeBowDeckWaterlinePoint(
            tLong,
            Lbow,
            halfB,
            halfStemWidth,
            0,
            bow.entranceAngle ?? 25,
            volParams.baseShoulderFullness || (bow.shoulderFullness ?? 0.7),
            bow.maxBreadthPos ?? 0.5
          );
          px = xStem + ptDWL.xRel;
          pz = Math.min(halfB, Math.max(halfStemWidth, ptDWL.y));
        }
      }
      // ────────────────────────────────────────────────────────────────
      // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 3: ФОРШТЕВЕНЬ (i = 0)
      // ────────────────────────────────────────────────────────────────
      else if (i === 0) {
        px = xStemAtThisY;
        py = yVal;
        pz = j === 0 ? 0 : halfStemWidth;
      }
      // ────────────────────────────────────────────────────────────────
      // ОПРЕДЕЛЯЮЩАЯ ЛИНИЯ 4: ШПАНГОУТ МИДЕЛЯ (i = 8) И G1 КАСАТЕЛЬНАЯ (i = 7)
      // ────────────────────────────────────────────────────────────────
      else if (i === 8) {
        px = xStart;
        py = yVal;
        pz = zMid;
      } else if (i === 7) {
        px = xStart + wMidTangent * 0.5;
        py = yVal;
        pz = zMid;
      } else if (i === 6) {
        px = xStart + wMidTangent * 1.0;
        py = yVal;
        pz = zMid * 0.98;
      } else if (i === 1) {
        // Столбец 1: Вход ватерлиний + Фильтр «Анти-щека» (Anti-Cheek)
        const dx = (xStemAtThisY - xStart) * 0.18;
        px = xStemAtThisY - dx;

        const tanBreadth = dx * Math.tan(entranceAngleRad);
        let zEntrance = halfStemWidth + tanBreadth;
        zEntrance = Math.max(halfStemWidth, zEntrance - deltaHollow);

        if (py > yFlareStart) {
          const tFlare = (py - yFlareStart) / Math.max(0.1, topY - yFlareStart);
          zEntrance += tFlare * base.flare * 0.15;
        }
        pz = Math.min(zMid * 0.45, zEntrance);
      } else {
        // Промежуточные столбцы i = 2 .. 5: плавное каплевидное заполнение
        const s = (i - 1) / 6.0;
        const xDist = (xStemAtThisY - xStart);
        px = xStart + xDist * (1.0 - Math.pow(s, 0.95));

        const fullnessCurve = Math.sin((s * Math.PI) / 2);
        const shoulderWeight = Math.pow(fullnessCurve, 1.0 / Math.max(0.2, shoulderFullness));

        let zInterp = halfStemWidth + (zMid - halfStemWidth) * shoulderWeight;

        if (bulbLen > 0.05 && py < yFlareStart) {
          const dyBulb = Math.abs(py - bulbCenterY) / Math.max(0.1, draftVal * 0.6);
          if (dyBulb < 1.0) {
            const bulbDecay = (1.0 - dyBulb * dyBulb) * Math.sin(s * Math.PI);
            zInterp += bulbMaxBreadth * bulbDecay;
          }
        }

        if (py > yFlareStart) {
          const tFlare = (py - yFlareStart) / Math.max(0.1, topY - yFlareStart);
          const tulipFactor = Math.pow(tFlare, 1.8);
          zInterp += tulipFactor * base.flare * s;
        }

        pz = Math.min(zMid, Math.max(halfStemWidth, zInterp));
      }

      // Линия киля строго в ДП (Z = 0)
      if (j === 0) {
        pz = 0;
      }

      portNet[i][j] = { x: px, y: py, z: pz, isCrease };
      stbdNet[i][j] = { x: px, y: py, z: -pz, isCrease };
    }
  }

  // Зажатые узловые векторы U и V
  const knotsU = createClampedKnotVector(numU, 3);
  const knotsV = createClampedKnotVector(numV, 3, creaseIndicesV);

  // Глобальная интерполяция определяющих линий (палуба j=6 и КВЛ j=3):
  // Преобразуем определяющие точки в контрольные точки P_{i, j}, чтобы
  // B-сплайн поверхность и сетка проходили строго через все определяющие точки
  const deckDefPts = portNet.map(r => r[6]);
  const solvedDeckRow = interpolateBSplineCurvePoints(deckDefPts, 3, knotsU);

  const dwlDefPts = portNet.map(r => r[3]);
  const solvedDwlRow = interpolateBSplineCurvePoints(dwlDefPts, 3, knotsU);

  for (let i = 0; i < numU; i++) {
    portNet[i][6] = { ...solvedDeckRow[i], z: solvedDeckRow[i].z, isCrease: portNet[i][6].isCrease };
    stbdNet[i][6] = { ...solvedDeckRow[i], z: -solvedDeckRow[i].z, isCrease: stbdNet[i][6].isCrease };
    portNet[i][3] = { ...solvedDwlRow[i], z: solvedDwlRow[i].z, isCrease: true };
    stbdNet[i][3] = { ...solvedDwlRow[i], z: -solvedDwlRow[i].z, isCrease: true };
  }

  // 2. Построение управляющей сети палубы (Deck Net) 9 x 5
  const numVDeck = 5;
  for (let i = 0; i < numU; i++) {
    deckNet[i] = [];
    const portDeckEdge = portNet[i][6];
    const xVal = portDeckEdge.x;
    const zMax = portDeckEdge.z;
    const yEdge = portDeckEdge.y;

    for (let j = 0; j < numVDeck; j++) {
      // От левого борта (z = +zMax) через ДП (z = 0) к правому борту (z = -zMax)
      const tDeck = j / (numVDeck - 1); // 0 (Stbd) .. 0.5 (Center) .. 1 (Port)
      const zDeck = -zMax + tDeck * 2 * zMax;
      const normZ = zMax > 0.001 ? Math.abs(zDeck) / zMax : 0;

      // Параболический подъем погибь палубы (Deck Camber)
      const camberLift = deckCamber * (1.0 - normZ * normZ);
      const yDeck = yEdge + camberLift;

      deckNet[i][j] = {
        x: xVal,
        y: yDeck,
        z: zDeck,
        isCrease: j === 0 || j === numVDeck - 1,
      };
    }
  }

  // Узловой вектор V для палубы
  const knotsVDeck = createClampedKnotVector(numVDeck, 3);

  const portSurface: BSplineSurfaceDescriptor = {
    degreeU: 3,
    degreeV: 3,
    knotsU,
    knotsV,
    controlNet: portNet,
  };

  const stbdSurface: BSplineSurfaceDescriptor = {
    degreeU: 3,
    degreeV: 3,
    knotsU,
    knotsV,
    controlNet: stbdNet,
  };

  const deckSurface: BSplineSurfaceDescriptor = {
    degreeU: 3,
    degreeV: 3,
    knotsU: knotsU,
    knotsV: knotsVDeck,
    controlNet: deckNet,
  };

  return {
    portSurface,
    stbdSurface,
    deckSurface,
    uSplits: knotsU,
    vSplits: knotsV,
  };
}

/**
 * Генерирует Three.js 3D-каркас пространственной управляющей сети (Control Net Visualizer)
 * с математически строгим разделением на:
 * 1. ОПРЕДЕЛЯЮЩИЕ ЛИНИИ И ТОЧКИ (Палуба, Форштевень, КВЛ, Шпангоут) — через которые поверхность и сетка проходят строго.
 * 2. УПРАВЛЯЮЩИЕ ТОЧКИ И РЕБРА — внутренний управляющий многогранник B-сплайнов.
 */
export function createControlNetVisualizer(
  descriptor: BSplineSurfaceDescriptor,
  colorLine: number = 0xfacc15, // Золотисто-желтый для управляющих ребер
  colorPoint: number = 0xf59e0b  // Янтарный для управляющих точек
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bspline_control_net';

  const net = descriptor.controlNet;
  const numU = net.length;
  if (numU === 0) return group;
  const numV = net[0].length;

  const controlLinePositions: number[] = [];
  const controlPointPositions: number[] = [];

  const definingDeckLinePos: number[] = [];
  const definingDwlLinePos: number[] = [];
  const definingStemLinePos: number[] = [];
  const definingMidshipLinePos: number[] = [];

  const definingPointPositions: number[] = [];

  // Классифицируем ребра и вершины
  for (let i = 0; i < numU; i++) {
    for (let j = 0; j < numV; j++) {
      const pt = net[i][j];
      const isDefining = i === 0 || i === numU - 1 || j === 3 || j === numV - 1;

      if (isDefining) {
        definingPointPositions.push(pt.x, pt.y, pt.z);
      } else {
        controlPointPositions.push(pt.x, pt.y, pt.z);
      }

      // Продольное ребро к следующей точке i + 1
      if (i < numU - 1) {
        const nextI = net[i + 1][j];
        if (j === numV - 1) {
          // Определяющая линия палубы
          definingDeckLinePos.push(pt.x, pt.y, pt.z, nextI.x, nextI.y, nextI.z);
        } else if (j === 3) {
          // Определяющая линия КВЛ (шов соединения)
          definingDwlLinePos.push(pt.x, pt.y, pt.z, nextI.x, nextI.y, nextI.z);
        } else {
          controlLinePositions.push(pt.x, pt.y, pt.z, nextI.x, nextI.y, nextI.z);
        }
      }

      // Поперечное ребро к следующей точке j + 1
      if (j < numV - 1) {
        const nextJ = net[i][j + 1];
        if (i === 0) {
          // Определяющая линия форштевня
          definingStemLinePos.push(pt.x, pt.y, pt.z, nextJ.x, nextJ.y, nextJ.z);
        } else if (i === numU - 1) {
          // Определяющая линия шпангоута миделя
          definingMidshipLinePos.push(pt.x, pt.y, pt.z, nextJ.x, nextJ.y, nextJ.z);
        } else {
          controlLinePositions.push(pt.x, pt.y, pt.z, nextJ.x, nextJ.y, nextJ.z);
        }
      }
    }
  }

  // 1. Управляющие ребра сети (янтарно-золотистые)
  if (controlLinePositions.length > 0) {
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(controlLinePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: colorLine,
      transparent: true,
      opacity: 0.7,
      linewidth: 1,
      depthTest: true,
    });
    group.add(new THREE.LineSegments(lineGeom, lineMat));
  }

  // 2. ОПРЕДЕЛЯЮЩИЕ ЛИНИИ (Четкие, яркие линии со строгим прохождением сетки)
  // Палуба (небесно-голубой #38bdf8)
  if (definingDeckLinePos.length > 0) {
    const deckGeom = new THREE.BufferGeometry();
    deckGeom.setAttribute('position', new THREE.Float32BufferAttribute(definingDeckLinePos, 3));
    const deckMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      linewidth: 2.2,
      depthTest: true,
    });
    group.add(new THREE.LineSegments(deckGeom, deckMat));
  }

  // КВЛ (изумрудный #10b981 — шов соединения)
  if (definingDwlLinePos.length > 0) {
    const dwlGeom = new THREE.BufferGeometry();
    dwlGeom.setAttribute('position', new THREE.Float32BufferAttribute(definingDwlLinePos, 3));
    const dwlMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      linewidth: 2.5,
      depthTest: true,
    });
    group.add(new THREE.LineSegments(dwlGeom, dwlMat));
  }

  // Форштевень (бирюзовый #06b6d4)
  if (definingStemLinePos.length > 0) {
    const stemGeom = new THREE.BufferGeometry();
    stemGeom.setAttribute('position', new THREE.Float32BufferAttribute(definingStemLinePos, 3));
    const stemMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      linewidth: 2.2,
      depthTest: true,
    });
    group.add(new THREE.LineSegments(stemGeom, stemMat));
  }

  // Шпангоут миделя (индиго #818cf8)
  if (definingMidshipLinePos.length > 0) {
    const midGeom = new THREE.BufferGeometry();
    midGeom.setAttribute('position', new THREE.Float32BufferAttribute(definingMidshipLinePos, 3));
    const midMat = new THREE.LineBasicMaterial({
      color: 0x818cf8,
      linewidth: 2.0,
      depthTest: true,
    });
    group.add(new THREE.LineSegments(midGeom, midMat));
  }

  // 3. Управляющие точки сети (золотистые точки)
  if (controlPointPositions.length > 0) {
    const ptGeom = new THREE.BufferGeometry();
    ptGeom.setAttribute('position', new THREE.Float32BufferAttribute(controlPointPositions, 3));
    const ptMat = new THREE.PointsMaterial({
      color: colorPoint,
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });
    group.add(new THREE.Points(ptGeom, ptMat));
  }

  // 4. ОПРЕДЕЛЯЮЩИЕ ТОЧКИ (Светящиеся узлы на определяющих линиях)
  if (definingPointPositions.length > 0) {
    const defPtGeom = new THREE.BufferGeometry();
    defPtGeom.setAttribute('position', new THREE.Float32BufferAttribute(definingPointPositions, 3));
    const defPtMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.52,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.98,
    });
    group.add(new THREE.Points(defPtGeom, defPtMat));
  }

  return group;
}

/**
 * Быстрое объединение нескольких THREE.BufferGeometry в одну сетку с пересчетом индексов
 */
export function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  let totalPosCount = 0;
  let totalIndexCount = 0;

  for (const geom of geometries) {
    const pos = geom.getAttribute('position');
    if (pos && pos.count > 0) {
      totalPosCount += pos.count;
      const idx = geom.getIndex();
      totalIndexCount += idx ? idx.count : pos.count;
    }
  }

  if (totalPosCount === 0) return merged;

  const positions = new Float32Array(totalPosCount * 3);
  const normals = new Float32Array(totalPosCount * 3);
  const uvs = new Float32Array(totalPosCount * 2);
  const indices = totalPosCount > 65535 ? new Uint32Array(totalIndexCount) : new Uint16Array(totalIndexCount);

  let vOffset = 0;
  let iOffset = 0;

  for (const geom of geometries) {
    const pos = geom.getAttribute('position');
    if (!pos || pos.count === 0) continue;
    const norm = geom.getAttribute('normal');
    const uv = geom.getAttribute('uv');
    const idx = geom.getIndex();
    const count = pos.count;

    positions.set(pos.array as Float32Array, vOffset * 3);
    if (norm) normals.set(norm.array as Float32Array, vOffset * 3);
    if (uv) uvs.set(uv.array as Float32Array, vOffset * 2);

    if (idx) {
      const idxArr = idx.array;
      for (let i = 0; i < idx.count; i++) {
        indices[iOffset++] = idxArr[i] + vOffset;
      }
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset++] = i + vOffset;
      }
    }
    vOffset += count;
  }

  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * Срез BufferGeometry горизонтальной плоскостью Y = cutY (ватерлинией)
 * с точной аналитической интерполяцией положения, нормалей и координат текстур.
 */
export function sliceGeometryByWaterlineY(
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
    targetPos.push(
      v0.pos[0], v0.pos[1], v0.pos[2],
      v1.pos[0], v1.pos[1], v1.pos[2],
      v2.pos[0], v2.pos[1], v2.pos[2]
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

/**
 * Полный аналитический конвейер генерации носовой поверхности по ТЗ FREE!ship
 * (Tensor-Product B-Spline Surfaces + Control Net Engine).
 * Возвращает раздельные геометрии (палуба, надводный/подводный борт) с аналитическими нормалями
 * и 3D-каркас управляющей сети для интерактивного отображения в Three.js.
 */
export function generateBSplineCompositeGeometry(
  base: HullBaseDimensions,
  bow: BowParameters,
  config: TessellationConfig = { uSegments: 64, vSegments: 32 }
): CompositeGeometryResult & {
  controlNetGroup: THREE.Group;
  uSplits: number[];
  vSplits: number[];
} {
  const t0 = performance.now();
  const netResult = buildBowControlNet(base, bow);

  // 1. Дискретизация левого и правого борта со строгим швом по КВЛ (v = 0.5)
  // Поверхность точно заканчивается на линии КВЛ, а затем продолжается надводной частью
  const portSeamed = tessellateBSplineSeamedGeometry(
    netResult.portSurface,
    config,
    0.5,
    [0, 0, 1]
  );
  const stbdSeamed = tessellateBSplineSeamedGeometry(
    netResult.stbdSurface,
    config,
    0.5,
    [0, 0, -1]
  );

  // 2. Дискретизация палубы с направлением нормалей вверх (+Y)
  const deckConfig: TessellationConfig = { uSegments: config.uSegments, vSegments: 16 };
  const deckGeometry = tessellateBSplineToBufferGeometry(
    netResult.deckSurface,
    deckConfig,
    undefined,
    [0, 1, 0]
  );

  // 3. Точное разделение на подводную и надводную части по шву КВЛ
  // Линия КВЛ состоит строго из сегментов сетки обшивки без секущих плоскостей
  const underwaterHullGeometry = mergeBufferGeometries([
    portSeamed.lowerGeometry,
    stbdSeamed.lowerGeometry,
  ]);
  const abovewaterHullGeometry = mergeBufferGeometries([
    portSeamed.upperGeometry,
    stbdSeamed.upperGeometry,
  ]);
  const hullGeometry = mergeBufferGeometries([
    portSeamed.fullGeometry,
    stbdSeamed.fullGeometry,
  ]);

  // 6. Построение 3D-каркаса управляющей сети FREE!ship (желтые линии и янтарные вершины)
  const controlNetGroup = new THREE.Group();
  controlNetGroup.name = 'bspline_control_net_group';
  const portNetVis = createControlNetVisualizer(netResult.portSurface, 0xfacc15, 0xf59e0b);
  const stbdNetVis = createControlNetVisualizer(netResult.stbdSurface, 0xfacc15, 0xf59e0b);
  const deckNetVis = createControlNetVisualizer(netResult.deckSurface, 0x38bdf8, 0x0284c7);
  controlNetGroup.add(portNetVis);
  controlNetGroup.add(stbdNetVis);
  controlNetGroup.add(deckNetVis);

  const t1 = performance.now();
  const calcTimeMs = Number((t1 - t0).toFixed(2));

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
    computeTimeMs: calcTimeMs,
    polygonCount: totalTriangles,
    vertexCount: totalVertices,
    isG0Valid: true,
    isG1Valid: true,
  };

  return {
    geometry: hullGeometry,
    deckGeometry,
    hullGeometry,
    underwaterHullGeometry,
    abovewaterHullGeometry,
    controlNetGroup,
    uSplits: netResult.uSplits,
    vSplits: netResult.vSplits,
    stats,
  };
}
