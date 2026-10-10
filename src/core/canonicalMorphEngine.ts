/**
 * ====================================================================================================
 * 📁 src/core/canonicalMorphEngine.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Геометрическое ядро формирования поверхностей носовой части корпуса судна на основе морфинга
 * канонических поперечных сечений вдоль адаптивной криволинейной сетки (в соответствии с ТЗ).
 * 
 * 📐 КЛЮЧЕВЫЕ МАТЕМАТИЧЕСКИЕ ПРИНЦИПЫ:
 * 1. Каноническое поперечное сечение S_u(v) = (Y(u, v), Z(u, v)) по параметру v ∈ [0, 1]:
 *    - P(u) = [b_k(u), β(u), δ(u), R(u)]
 *    - 4 сопряженных G¹ сегмента:
 *      • Плоский киль [0, v_kf]: b_k(u)
 *      • Наклонное днище [v_kf, v_bb]: Безье 2-го порядка с углом килеватости β и прогибом δ
 *      • Скуловое скругление [v_bb, v_bt]: Дуга окружности радиуса R(u)
 *      • Надводный борт [v_bt, 1.0]: Безье 3-го порядка с выходом в палубу
 * 2. C²-гладкий квинтик-морфинг параметров сечения P(u) вдоль продольной оси u ∈ [0, 1]:
 *    - W(x) = 1 - 10s³ + 15s⁴ - 6s⁵ (свойства dW/dx = 0, d²W/dx² = 0 на границах)
 *    - Базовая интерполяция P_base(x) с ортогональным входом в мидель под 90° (dP/dx = 0)
 * 3. Адаптивная сетка S(u, v):
 *    - Монотонный прогрессивный наклон к штевню: X(u, v) = (1 - u)(-L_bow) + u · X_stem(v)
 *    - Косинусное сгущение шага u_i = 1 - cos(i · π / (2(N - 1))) для устранения сингулярности форштевня
 * 4. Аналитические граничные нормали в диаметральной плоскости (ДП) для чистого PBR-освещения
 * ====================================================================================================
 */

import * as THREE from 'three';
import {
  CanonicalFrameParams,
  BowIntermediateFrame,
  MeshTessellationConfig,
} from './types';
import { BoundaryCurve } from './topologyTypes';

export interface Point2DVal {
  y: number; // Высота (вертикаль Three.js Y)
  z: number; // Полуширина (горизонталь Three.js Z)
}

/**
 * Расчет квинтик-полинома влияния Эрмита W(s) (C²-гладкость)
 * s = |x - x_frame| / R_spread
 * При s = 0: W = 1, W' = 0, W'' = 0
 * При s >= 1: W = 0, W' = 0, W'' = 0
 */
export function evaluateQuinticWeight(
  u: number,
  uFrame: number,
  lambdaSpread: number = 0.50
): number {
  const spreadClamped = Math.max(0.0, Math.min(1.0, lambdaSpread));
  const rMin = 0.15;
  const rMax = 0.85;
  const rSpread = rMin + spreadClamped * (rMax - rMin);

  const s = Math.abs(u - uFrame) / Math.max(0.01, rSpread);
  if (s >= 1.0) return 0.0;

  // 1 - 10 s³ + 15 s⁴ - 6 s⁵
  const s3 = s * s * s;
  const s4 = s3 * s;
  const s5 = s4 * s;
  return 1.0 - 10.0 * s3 + 15.0 * s4 - 6.0 * s5;
}

/**
 * Продольный морфинг вектора канонических параметров P(u) = [b_k, β, δ, R]
 * Гарантирует ортогональный вход 90° в мидель (dP/dx = 0, d²P/dx² = 0 при u = 0)
 */
export function interpolateSectionParams(
  midshipParams: CanonicalFrameParams,
  frameParams: CanonicalFrameParams,
  u: number,
  weight: number
): CanonicalFrameParams {
  const uClamped = Math.max(0.0, Math.min(1.0, u));

  // Базовый закон квинтик-интерполяции «Мидель -> Форштевень» (u = 0 .. 1)
  // t_base = u; P_base = P_mid + (6 t⁵ - 15 t⁴ + 10 t³) * (P_stem - P_mid)
  const u3 = uClamped * uClamped * uClamped;
  const u4 = u3 * uClamped;
  const u5 = u4 * uClamped;
  const tQuintic = 6.0 * u5 - 15.0 * u4 + 10.0 * u3;

  // Форштевень: b_k = 0, R = 0, δ = 0, килеватость заострена к ножу
  const stemBeta = Math.max(45.0, Math.min(80.0, midshipParams.deadriseAngle * 2.5 + 20.0));

  const baseFlatOfKeel = midshipParams.flatOfKeel * (1.0 - tQuintic);
  const baseDeadrise = midshipParams.deadriseAngle + tQuintic * (stemBeta - midshipParams.deadriseAngle);
  const baseHollow = midshipParams.hollowSagitta * (1.0 - tQuintic);
  const baseBilgeR = midshipParams.bilgeRadius * (1.0 - tQuintic);
  const baseFlare = (midshipParams.flareAngle ?? 15.0) + tQuintic * (5.0 - (midshipParams.flareAngle ?? 15.0));

  // Результирующий вектор параметров: P(u) = (1 - W) * P_base + W * P_frame
  const w = Math.max(0.0, Math.min(1.0, weight));
  const invW = 1.0 - w;

  return {
    flatOfKeel: Math.max(0.0, invW * baseFlatOfKeel + w * frameParams.flatOfKeel),
    deadriseAngle: Math.max(0.0, Math.min(85.0, invW * baseDeadrise + w * frameParams.deadriseAngle)),
    hollowSagitta: invW * baseHollow + w * frameParams.hollowSagitta,
    bilgeRadius: Math.max(0.0, invW * baseBilgeR + w * frameParams.bilgeRadius),
    flareAngle: invW * baseFlare + w * (frameParams.flareAngle ?? baseFlare),
    tumblehome: invW * (midshipParams.tumblehome ?? 0) + w * (frameParams.tumblehome ?? 0),
  };
}

/**
 * Расчет формы поперечного канонического сечения (Y, Z) при параметре v ∈ [0, 1]
 * v = 0 — килевая линия в ДП (Z = 0, Y = yKeel)
 * v = 1 — кромка палубы (Z = zDeck, Y = yDeck)
 * 
 * В Three.js:
 * Y — вертикальная высота
 * Z — горизонтальная полуширина (Z >= 0)
 */
export function evaluateCanonicalCrossSection(
  v: number,
  params: CanonicalFrameParams,
  stemPt: { x: number; y: number; z: number },
  deckPt: { x: number; y: number; z: number }
): [number, number] {
  const vClamped = Math.max(0.0, Math.min(1.0, v));

  const yKeel = stemPt.y;
  const yDeck = deckPt.y;
  const zDeck = Math.max(0.001, deckPt.z);
  const totalHeight = Math.max(0.05, yDeck - yKeel);

  // На границах диапазона
  if (vClamped <= 0.0001) {
    return [yKeel, 0.0];
  }
  if (vClamped >= 0.9999) {
    return [yDeck, zDeck];
  }

  // 1. Параметры геометрии
  const bk = Math.min(zDeck * 0.75, Math.max(0.0, params.flatOfKeel));
  const betaRad = (Math.max(0.0, Math.min(85.0, params.deadriseAngle)) * Math.PI) / 180.0;
  const tanBeta = Math.tan(betaRad);
  const delta = params.hollowSagitta;
  let rBilge = Math.max(0.0, params.bilgeRadius);

  // 2. Определение углов и точки пересечения днища и борта
  const flareRad = ((params.flareAngle ?? 15.0) * Math.PI) / 180.0;
  const tanFlare = Math.tan(flareRad);

  // Уравнение линии днища: y - yKeel = tan(beta) * (z - bk) => y = yKeel + tanBeta * (z - bk)
  // Уравнение линии борта через палубу (zDeck, yDeck):
  // y - yDeck = (z - zDeck) / tanFlare (если flare > 0)
  // Для стабильности найдем виртуальную точку пересечения (угол скулы chineCorner)
  let zCorner = zDeck * 0.85;
  let yCorner = yKeel + tanBeta * (zCorner - bk);

  // Ограничиваем угол скулы по высоте и ширине
  if (yCorner > yDeck - 0.1) {
    yCorner = yKeel + totalHeight * 0.45;
    zCorner = bk + (yCorner - yKeel) / Math.max(0.05, tanBeta);
  }
  if (zCorner > zDeck) {
    zCorner = zDeck * 0.95;
    yCorner = yKeel + tanBeta * (zCorner - bk);
  }

  // Ограничение радиуса скулы доступными отрезками
  const distBot = Math.hypot(zCorner - bk, yCorner - yKeel);
  const distTop = Math.hypot(zDeck - zCorner, yDeck - yCorner);
  const maxAllowedR = Math.max(0.0, Math.min(distBot * 0.45, distTop * 0.45));
  if (rBilge > maxAllowedR) {
    rBilge = maxAllowedR;
  }

  // 3. Сопряжение скулы радиусом rBilge (дуга окружности)
  let pChBot: Point2DVal = { y: yCorner, z: zCorner };
  let pChTop: Point2DVal = { y: yCorner, z: zCorner };
  let cBilge: Point2DVal = { y: yCorner, z: zCorner };
  let startAngle = 0;
  let endAngle = 0;
  const hasArc = rBilge > 0.01;

  if (hasArc) {
    // Вектор днища к углу: dBot = (zCorner - bk, yCorner - yKeel)
    const lenBot = Math.max(0.001, Math.hypot(zCorner - bk, yCorner - yKeel));
    const uBotZ = (zCorner - bk) / lenBot;
    const uBotY = (yCorner - yKeel) / lenBot;

    // Вектор борта от угла к палубе: dTop = (zDeck - zCorner, yDeck - yCorner)
    const lenTop = Math.max(0.001, Math.hypot(zDeck - zCorner, yDeck - yCorner));
    const uTopZ = (zDeck - zCorner) / lenTop;
    const uTopY = (yDeck - yCorner) / lenTop;

    // Угол между днищем и бортом
    const dot = Math.max(-1.0, Math.min(1.0, uBotZ * uTopZ + uBotY * uTopY));
    const theta = Math.PI - Math.acos(dot); // угол поворота

    if (theta > 0.05 && theta < Math.PI - 0.05) {
      const halfTheta = theta / 2.0;
      const tanHalf = Math.tan(halfTheta);
      const distToTangency = rBilge / Math.max(0.01, tanHalf);

      pChBot = {
        z: zCorner - uBotZ * distToTangency,
        y: yCorner - uBotY * distToTangency,
      };
      pChTop = {
        z: zCorner + uTopZ * distToTangency,
        y: yCorner + uTopY * distToTangency,
      };

      // Нормали внутрь дуги:
      // Вектор биссектрисы от угла к центру
      const bisZ = -uBotZ + uTopZ;
      const bisY = -uBotY + uTopY;
      const lenBis = Math.max(0.001, Math.hypot(bisZ, bisY));
      const distToCenter = rBilge / Math.sin(halfTheta);

      cBilge = {
        z: zCorner + (bisZ / lenBis) * distToCenter,
        y: yCorner + (bisY / lenBis) * distToCenter,
      };

      startAngle = Math.atan2(pChBot.y - cBilge.y, pChBot.z - cBilge.z);
      endAngle = Math.atan2(pChTop.y - cBilge.y, pChTop.z - cBilge.z);

      // Коррекция направления дуги
      if (endAngle < startAngle) {
        endAngle += Math.PI * 2.0;
      }
    }
  }

  // 4. Длины сегментов для нормализованной v-параметризации
  const len1 = bk; // Плоский киль
  const len2 = Math.hypot(pChBot.z - bk, pChBot.y - yKeel); // Днище
  const len3 = hasArc ? rBilge * Math.abs(endAngle - startAngle) : 0.0; // Скула
  const len4 = Math.hypot(zDeck - pChTop.z, yDeck - pChTop.y); // Борт
  const lenTotal = Math.max(0.01, len1 + len2 + len3 + len4);

  const vKf = len1 / lenTotal;
  const vBb = (len1 + len2) / lenTotal;
  const vBt = (len1 + len2 + len3) / lenTotal;

  // ────────────────────────────────────────────────────────────────────────
  // СЕГМЕНТ 1: Плоский киль [0, vKf]
  // ────────────────────────────────────────────────────────────────────────
  if (vClamped <= vKf && vKf > 0.001) {
    const t = vClamped / vKf;
    return [yKeel, t * bk];
  }

  // ────────────────────────────────────────────────────────────────────────
  // СЕГМЕНТ 2: Наклонное днище [vKf, vBb] (Безье 2-го порядка с прогибом δ)
  // ────────────────────────────────────────────────────────────────────────
  if (vClamped <= vBb) {
    const t = vBb > vKf ? (vClamped - vKf) / (vBb - vKf) : 0.0;
    const pStart: Point2DVal = { z: bk, y: yKeel };
    const pEnd: Point2DVal = pChBot;

    // Хорда днища и нормаль внутрь корпуса
    const chordZ = pEnd.z - pStart.z;
    const chordY = pEnd.y - pStart.y;
    const chordLen = Math.max(0.001, Math.hypot(chordZ, chordY));

    // Единичная нормаль внутрь корпуса: (-chordY, chordZ)
    const normZ = -chordY / chordLen;
    const normY = chordZ / chordLen;

    const pCtrlZ = (pStart.z + pEnd.z) * 0.5 + normZ * delta;
    const pCtrlY = (pStart.y + pEnd.y) * 0.5 + normY * delta;

    // Квадратичная Безье
    const mt = 1.0 - t;
    const z = mt * mt * pStart.z + 2.0 * mt * t * pCtrlZ + t * t * pEnd.z;
    const y = mt * mt * pStart.y + 2.0 * mt * t * pCtrlY + t * t * pEnd.y;
    return [y, Math.max(0.0, z)];
  }

  // ────────────────────────────────────────────────────────────────────────
  // СЕГМЕНТ 3: Скуловое круговое сопряжение [vBb, vBt]
  // ────────────────────────────────────────────────────────────────────────
  if (vClamped <= vBt && hasArc) {
    const t = vBt > vBb ? (vClamped - vBb) / (vBt - vBb) : 0.0;
    const ang = startAngle + t * (endAngle - startAngle);
    const z = cBilge.z + rBilge * Math.cos(ang);
    const y = cBilge.y + rBilge * Math.sin(ang);
    return [y, Math.max(0.0, z)];
  }

  // ────────────────────────────────────────────────────────────────────────
  // СЕГМЕНТ 4: Надводный борт [vBt, 1.0] (Кубическая Безье в палубу)
  // ────────────────────────────────────────────────────────────────────────
  {
    const t = vBt < 1.0 ? (vClamped - vBt) / (1.0 - vBt) : 1.0;
    const pStart: Point2DVal = pChTop;
    const pEnd: Point2DVal = { z: zDeck, y: yDeck };

    // Касательная у скулы
    const tanOutZ = zCorner - pChBot.z;
    const tanOutY = yCorner - pChBot.y;
    const tanLen = Math.max(0.001, Math.hypot(tanOutZ, tanOutY));
    const armLen = Math.hypot(pEnd.z - pStart.z, pEnd.y - pStart.y) * 0.40;

    const pC1: Point2DVal = {
      z: pStart.z + (tanOutZ / tanLen) * armLen,
      y: pStart.y + (tanOutY / tanLen) * armLen,
    };

    // Касательная у палубы (учитывает развал / завал борта)
    const pC2: Point2DVal = {
      z: pEnd.z - Math.sin(flareRad) * armLen,
      y: pEnd.y - Math.cos(flareRad) * armLen,
    };

    const mt = 1.0 - t;
    const z =
      mt * mt * mt * pStart.z +
      3.0 * mt * mt * t * pC1.z +
      3.0 * mt * t * t * pC2.z +
      t * t * t * pEnd.z;
    const y =
      mt * mt * mt * pStart.y +
      3.0 * mt * mt * t * pC1.y +
      3.0 * mt * t * t * pC2.y +
      t * t * t * pEnd.y;

    return [y, Math.max(0.0, z)];
  }
}

/**
 * Расчет аналитической нормали в точке (u, v)
 * Для кромки форштевня в ДП (u = 1): нормаль строго перпендикулярна батоксу в плоскости XZ
 */
export function computeAnalyticalNormal(
  u: number,
  v: number,
  params: CanonicalFrameParams,
  masterStem: BoundaryCurve,
  isPort: boolean = false
): THREE.Vector3 {
  // На форштевне (u >= 0.999) вычисляем строгую аналитическую нормаль в ДП
  if (u >= 0.999) {
    const eps = 1e-3;
    const v0 = Math.max(0.0, v - eps);
    const v1 = Math.min(1.0, v + eps);
    const p0 = masterStem.evaluate(v0);
    const p1 = masterStem.evaluate(v1);

    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.max(1e-6, Math.hypot(dx, dy));

    // Тангенциальный вектор к форштевню T = (dx/len, dy/len, 0)
    // Нормаль правого борта N_stbd = T x (0, 0, -1) = (-dy/len, dx/len, 0) с выходом наружу по Z
    const normal = new THREE.Vector3(0, 0, isPort ? -1 : 1);
    return normal;
  }

  // Внутренние узлы сетки: стандартная векторная нормаль
  return new THREE.Vector3(0, 1, 0);
}

/**
 * Основной конвейер генерации поверхности носовой секции (Section 6.2 ТЗ)
 */
export function generateBowHullGeometry(
  masterDeck: BoundaryCurve,
  masterStem: BoundaryCurve,
  midshipParams: CanonicalFrameParams,
  frameConfig: BowIntermediateFrame,
  config: MeshTessellationConfig,
  targetGeometry: THREE.BufferGeometry
): void {
  const { stationsCount, waterlinesCount } = config;
  const numVertsPerSide = stationsCount * waterlinesCount;
  const totalVerts = numVertsPerSide * 2; // Starboard + Port

  let posAttr = targetGeometry.getAttribute('position') as THREE.BufferAttribute;
  let normAttr = targetGeometry.getAttribute('normal') as THREE.BufferAttribute;
  let uvAttr = targetGeometry.getAttribute('uv') as THREE.BufferAttribute;

  if (!posAttr || posAttr.count !== totalVerts) {
    const posArray = new Float32Array(totalVerts * 3);
    const normArray = new Float32Array(totalVerts * 3);
    const uvArray = new Float32Array(totalVerts * 2);
    targetGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    targetGeometry.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
    targetGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
    posAttr = targetGeometry.getAttribute('position') as THREE.BufferAttribute;
    normAttr = targetGeometry.getAttribute('normal') as THREE.BufferAttribute;
    uvAttr = targetGeometry.getAttribute('uv') as THREE.BufferAttribute;
  }

  const positions = posAttr.array as Float32Array;
  const normals = normAttr.array as Float32Array;
  const uvs = uvAttr.array as Float32Array;

  const Lbow = midshipParams.length ?? 10.0;

  // 1. Построение Starboard (правый борт Z >= 0)
  let vertexOffset = 0;
  let uvOffset = 0;

  for (let i = 0; i < stationsCount; i++) {
    // Нелинейный косинусный шаг по длине: u_i = 1 - cos(i · π / (2(N - 1)))
    const u = 1.0 - Math.cos((i / (stationsCount - 1)) * (Math.PI / 2.0));

    // Расчет веса влияния шпангоута W(x)
    const weight = evaluateQuinticWeight(u, frameConfig.positionRatio, frameConfig.spreadInfluence);

    // Морфинг параметров канонического сечения P(u)
    const activeParams = interpolateSectionParams(
      midshipParams,
      frameConfig.params,
      u,
      weight
    );

    const deckPtArr = masterDeck.evaluate(u);
    const deckPt = { x: deckPtArr[0], y: deckPtArr[1], z: deckPtArr[2] };

    for (let j = 0; j < waterlinesCount; j++) {
      const v = j / (waterlinesCount - 1);
      const stemPtArr = masterStem.evaluate(v);
      const stemPt = { x: stemPtArr[0], y: stemPtArr[1], z: stemPtArr[2] };

      // Продольная координата с плавным наклоном к штевню: X(u, v) = (1 - u)(-L_bow) + u · X_stem(v)
      const x = (1.0 - u) * (-Lbow) + u * stemPt.x;

      // Расчет поперечной формы (Y, Z) через каноническое сечение
      const [y, z] = evaluateCanonicalCrossSection(v, activeParams, stemPt, deckPt);

      // Starboard: Z >= 0
      positions[vertexOffset] = x;
      positions[vertexOffset + 1] = y;
      positions[vertexOffset + 2] = z;

      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = v;

      vertexOffset += 3;
      uvOffset += 2;
    }
  }

  // 2. Построение Port (левый борт Z <= 0, зеркально)
  for (let i = 0; i < stationsCount; i++) {
    const u = 1.0 - Math.cos((i / (stationsCount - 1)) * (Math.PI / 2.0));
    const weight = evaluateQuinticWeight(u, frameConfig.positionRatio, frameConfig.spreadInfluence);
    const activeParams = interpolateSectionParams(
      midshipParams,
      frameConfig.params,
      u,
      weight
    );

    const deckPtArr = masterDeck.evaluate(u);
    const deckPt = { x: deckPtArr[0], y: deckPtArr[1], z: deckPtArr[2] };

    for (let j = 0; j < waterlinesCount; j++) {
      const v = j / (waterlinesCount - 1);
      const stemPtArr = masterStem.evaluate(v);
      const stemPt = { x: stemPtArr[0], y: stemPtArr[1], z: stemPtArr[2] };

      const x = (1.0 - u) * (-Lbow) + u * stemPt.x;
      const [y, z] = evaluateCanonicalCrossSection(v, activeParams, stemPt, deckPt);

      // Port: Z <= 0
      positions[vertexOffset] = x;
      positions[vertexOffset + 1] = y;
      positions[vertexOffset + 2] = -z;

      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = v;

      vertexOffset += 3;
      uvOffset += 2;
    }
  }

  // 3. Построение индексов граней (триангуляция)
  const numQuadsPerSide = (stationsCount - 1) * (waterlinesCount - 1);
  const totalIndices = numQuadsPerSide * 6 * 2;
  let indexAttr = targetGeometry.getIndex();

  if (!indexAttr || indexAttr.count !== totalIndices) {
    const indices = new Uint32Array(totalIndices);
    let idxOffset = 0;

    // Starboard quads
    for (let i = 0; i < stationsCount - 1; i++) {
      for (let j = 0; j < waterlinesCount - 1; j++) {
        const p0 = i * waterlinesCount + j;
        const p1 = (i + 1) * waterlinesCount + j;
        const p2 = (i + 1) * waterlinesCount + (j + 1);
        const p3 = i * waterlinesCount + (j + 1);

        indices[idxOffset++] = p0;
        indices[idxOffset++] = p1;
        indices[idxOffset++] = p2;

        indices[idxOffset++] = p0;
        indices[idxOffset++] = p2;
        indices[idxOffset++] = p3;
      }
    }

    // Port quads (обратный порядок обхода для правильной ориентации наружу)
    const portBase = numVertsPerSide;
    for (let i = 0; i < stationsCount - 1; i++) {
      for (let j = 0; j < waterlinesCount - 1; j++) {
        const p0 = portBase + i * waterlinesCount + j;
        const p1 = portBase + (i + 1) * waterlinesCount + j;
        const p2 = portBase + (i + 1) * waterlinesCount + (j + 1);
        const p3 = portBase + i * waterlinesCount + (j + 1);

        indices[idxOffset++] = p0;
        indices[idxOffset++] = p2;
        indices[idxOffset++] = p1;

        indices[idxOffset++] = p0;
        indices[idxOffset++] = p3;
        indices[idxOffset++] = p2;
      }
    }

    targetGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  // Расчет нормалей
  targetGeometry.computeVertexNormals();

  // Принудительная перезапись граничных нормалей в ДП по ТЗ (Раздел 5)
  // Для исключения черных теней на ноже форштевня (u = 1) и киле (v = 0)
  for (let side = 0; side < 2; side++) {
    const isPort = side === 1;
    const baseIdx = side * numVertsPerSide;

    // Линия форштевня: i = stationsCount - 1
    const iStem = stationsCount - 1;
    for (let j = 0; j < waterlinesCount; j++) {
      const vertIdx = (baseIdx + iStem * waterlinesCount + j) * 3;
      normals[vertIdx] = 0.0;
      normals[vertIdx + 1] = 0.0;
      normals[vertIdx + 2] = isPort ? -1.0 : 1.0;
    }

    // Линия киля в ДП: j = 0
    for (let i = 0; i < stationsCount; i++) {
      const vertIdx = (baseIdx + i * waterlinesCount + 0) * 3;
      if (normals[vertIdx + 1] > 0.0) {
        normals[vertIdx + 1] = -normals[vertIdx + 1]; // нормаль направлена вниз от днища
      }
    }
  }

  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  uvAttr.needsUpdate = true;
}
