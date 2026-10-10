/**
 * ====================================================================================================
 * 📁 src/core/bsplineKernel.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Математический вычислитель аналитического геометрического ядра на базе тензорных B-сплайнов
 * (Tensor-Product B-Spline Surfaces) в соответствии с архитектурными стандартами программы FREE!ship.
 * 
 * 📐 МАТЕМАТИЧЕСКИЙ БАЗИС:
 * 1. Рекуррентный базис Кокса — де Боора произвольного порядка p:
 *    N_{i, 0}(u) = 1, если u_i <= u < u_{i+1}, иначе 0.
 *    N_{i, k}(u) = (u - u_i)/(u_{i+k} - u_i) * N_{i, k-1}(u) + (u_{i+k+1} - u)/(u_{i+k+1} - u_{i+1}) * N_{i+1, k-1}(u)
 * 2. Аналитическое дифференцирование базиса:
 *    dN_{i, p}/du = p * [ N_{i, p-1}/(u_{i+p} - u_i) - N_{i+1, p-1}/(u_{i+p+1} - u_{i+1}) ]
 * 3. Зажатые узловые векторы (Clamped Knot Vectors) с кратными узлами для ребер излома (Crease Knots):
 *    mult(v_k) = q => Снижение гладкости до C0 (G0) для жесткой скулы (hard chine) и кромки палубы.
 * 4. Точный аналитический расчет вектора нормали через частные производные:
 *    n(u, v) = (∂S/∂u × ∂S/∂v) / ||∂S/∂u × ∂S/∂v||
 * 5. Высокопроизводительная триангуляция (Tessellator) с прямой мутацией Float32Array для стабильных 60 FPS.
 * ====================================================================================================
 */

import * as THREE from 'three';
import {
  ControlPoint3D,
  BSplineSurfaceDescriptor,
  TessellationConfig,
} from './types';

/**
 * Вычисляет значение базисной функции B-сплайна Кокса — де Боора N_{i, p}(u)
 * и её аналитической первой производной dN_{i, p}(u)/du.
 */
export function evaluateCoxDeBoorAndDeriv(
  i: number,
  p: number,
  u: number,
  knots: number[]
): { value: number; deriv: number } {
  const m = knots.length - 1;
  if (i < 0 || i + p + 1 > m) {
    return { value: 0, deriv: 0 };
  }

  // Ограничиваем параметр u допустимым интервалом узлового вектора
  const uClamped = Math.max(knots[0], Math.min(knots[m], u));
  const isRightBoundary = uClamped >= knots[m] - 1e-12;

  // Таблица значений базисных функций N[k][j], где k - степень (0..p)
  // Для вычисления производной степени p нам требуются значения степени (p - 1)
  const N: number[][] = [];
  for (let k = 0; k <= p; k++) {
    N[k] = new Array(p + 1 - k + 1).fill(0);
  }

  // Шаг 1: Базис нулевой степени (p = 0)
  // Для вычисления N_{i, p} нам понадобятся функции с индексами j = i .. i + p
  for (let j = 0; j <= p; j++) {
    const knotIdx = i + j;
    if (knotIdx >= m) {
      N[0][j] = 0;
      continue;
    }
    const uLeft = knots[knotIdx];
    const uRight = knots[knotIdx + 1];

    if (isRightBoundary) {
      // На правой границе активен последний ненулевой полуинтервал
      if (uClamped >= uLeft && uClamped <= uRight && uLeft < uRight) {
        // Проверяем, является ли это последним интервалом
        if (knotIdx === m - p - 1 || uRight >= knots[m] - 1e-12) {
          N[0][j] = 1.0;
        } else {
          N[0][j] = 0.0;
        }
      } else {
        N[0][j] = 0.0;
      }
    } else {
      if (uClamped >= uLeft && uClamped < uRight && uLeft < uRight) {
        N[0][j] = 1.0;
      } else {
        N[0][j] = 0.0;
      }
    }
  }

  // Шаг 2: Рекуррентный подъем по степеням k = 1 .. p
  for (let k = 1; k <= p; k++) {
    for (let j = 0; j <= p - k; j++) {
      const knotIdx = i + j;
      let leftTerm = 0;
      let rightTerm = 0;

      const denom1 = knots[knotIdx + k] - knots[knotIdx];
      if (Math.abs(denom1) > 1e-12) {
        leftTerm = ((uClamped - knots[knotIdx]) / denom1) * N[k - 1][j];
      }

      const denom2 = knots[knotIdx + k + 1] - knots[knotIdx + 1];
      if (Math.abs(denom2) > 1e-12) {
        rightTerm = ((knots[knotIdx + k + 1] - uClamped) / denom2) * N[k - 1][j + 1];
      }

      N[k][j] = leftTerm + rightTerm;
    }
  }

  const value = N[p][0];

  // Шаг 3: Аналитический расчет производной dN_{i, p}/du
  let deriv = 0;
  if (p > 0) {
    let dTerm1 = 0;
    let dTerm2 = 0;

    const denom1 = knots[i + p] - knots[i];
    if (Math.abs(denom1) > 1e-12) {
      dTerm1 = N[p - 1][0] / denom1;
    }

    const denom2 = knots[i + p + 1] - knots[i + 1];
    if (Math.abs(denom2) > 1e-12) {
      dTerm2 = N[p - 1][1] / denom2;
    }

    deriv = p * (dTerm1 - dTerm2);
  }

  return { value, deriv };
}

/**
 * Вычисляет все ненулевые базисные функции и их первые производные для заданного параметра u.
 * Оптимизированный быстрый алгоритм вычисления полного вектора весов за O(p^2).
 */
export function evaluateAllBasisAndDeriv(
  u: number,
  p: number,
  knots: number[],
  numControlPoints: number
): { values: Float64Array; derivs: Float64Array } {
  const values = new Float64Array(numControlPoints);
  const derivs = new Float64Array(numControlPoints);

  const m = knots.length - 1;
  const uClamped = Math.max(knots[0], Math.min(knots[m], u));

  for (let i = 0; i < numControlPoints; i++) {
    // Быстрый отсев: если u вне интервала носителя [knots[i], knots[i + p + 1]]
    if (uClamped < knots[i] - 1e-12 || uClamped > knots[i + p + 1] + 1e-12) {
      continue;
    }
    const { value, deriv } = evaluateCoxDeBoorAndDeriv(i, p, uClamped, knots);
    values[i] = value;
    derivs[i] = deriv;
  }

  return { values, derivs };
}

/**
 * Генерирует зажатый (clamped) узловой вектор для B-сплайна степени p с (n + 1) контрольными точками.
 * Первые и последние (p + 1) узлов кратны 0.0 и 1.0 соответственно.
 * Поддерживает кратные внутренние узлы (creaseKnots) для ребер излома (Hard Chine, плоский киль, планширь).
 */
export function createClampedKnotVector(
  numControlPoints: number,
  degree: number,
  creaseIndices?: number[]
): number[] {
  const p = degree;
  const n = numControlPoints - 1;
  const totalKnots = n + p + 2;

  const knots: number[] = new Array(totalKnots);

  // Первые (p + 1) узлов зажаты в 0.0
  for (let i = 0; i <= p; i++) {
    knots[i] = 0.0;
  }

  // Последние (p + 1) узлов зажаты в 1.0
  for (let i = totalKnots - p - 1; i < totalKnots; i++) {
    knots[i] = 1.0;
  }

  // Количество внутренних узлов
  const numInterior = totalKnots - 2 * (p + 1);
  if (numInterior > 0) {
    if (creaseIndices && creaseIndices.length > 0) {
      // Режим ребер излома и определяющих швов (Crease Knots & Seams):
      // Распределяем узлы так, чтобы в местах швов (например КВЛ j=3)
      // кратность узла повышалась строго до p (G0 шов, точная интерполяция ряда контрольных точек)
      const creaseSet = new Set(creaseIndices);

      if (creaseSet.has(3) && numInterior === p) {
        // Стандартная матрица 9x7 с p=3: 3 внутренних узла.
        // При шве на КВЛ (j=3, v=0.5) задаем тройной узел [0.5, 0.5, 0.5]
        for (let i = 0; i < numInterior; i++) {
          knots[p + 1 + i] = 0.5;
        }
      } else {
        for (let i = 0; i < numInterior; i++) {
          const knotIdx = p + 1 + i;
          const ctrlIdx = i + 1;
          if (creaseSet.has(ctrlIdx)) {
            const tVal = ctrlIdx / (numControlPoints - 1);
            knots[knotIdx] = tVal;
          } else {
            knots[knotIdx] = (i + 1) / (numInterior + 1);
          }
        }
        knots.sort((a, b) => a - b);
      }
    } else {
      // Равномерное распределение внутренних узлов
      for (let i = 0; i < numInterior; i++) {
        knots[p + 1 + i] = (i + 1) / (numInterior + 1);
      }
    }
  }

  return knots;
}

/**
 * Глобальная интерполяция B-сплайн кривой через определяющие точки D_0 .. D_n.
 * Преобразует определяющие точки (через которые кривая и поверхность ОБЯЗАНЫ проходить точно)
 * в управляющие точки P_0 .. P_n контрольной сети B-сплайна:
 * \sum_{i=0}^n N_{i, p}(\bar{u}_k) P_i = D_k
 * 
 * В результате B-сплайн поверхность проходит строго через заданные определяющие точки
 * на верхней палубе, КВЛ, форштевне и шпангоуте миделя.
 */
export function interpolateBSplineCurvePoints(
  definingPoints: Array<{ x: number; y: number; z: number; isCrease?: boolean }>,
  p: number,
  knots: number[]
): Array<{ x: number; y: number; z: number; isCrease?: boolean }> {
  const n = definingPoints.length;
  if (n <= p || n < 3) return definingPoints.map(pt => ({ ...pt }));

  // 1. Вычисляем параметры \bar{u}_k (Greville abscissae / узловые средние)
  const uParams: number[] = new Array(n);
  uParams[0] = knots[0];
  uParams[n - 1] = knots[knots.length - 1];
  for (let k = 1; k < n - 1; k++) {
    let sum = 0;
    for (let j = 1; j <= p; j++) {
      sum += knots[k + j];
    }
    uParams[k] = sum / p;
  }

  // 2. Формируем матрицу A размера n x n: A[k][i] = N_{i, p}(\bar{u}_k)
  const A: number[][] = [];
  const bx: number[] = new Array(n);
  const by: number[] = new Array(n);
  const bz: number[] = new Array(n);

  for (let k = 0; k < n; k++) {
    A[k] = new Array(n).fill(0);
    const uVal = uParams[k];
    const basis = evaluateAllBasisAndDeriv(uVal, p, knots, n);
    for (let i = 0; i < n; i++) {
      A[k][i] = basis.values[i];
    }
    bx[k] = definingPoints[k].x;
    by[k] = definingPoints[k].y;
    bz[k] = definingPoints[k].z;
  }

  // 3. Решаем систему A * P = D методом исключения Гаусса с выбором главного элемента
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxVal) {
        maxVal = Math.abs(A[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) continue;

    if (maxRow !== col) {
      const tempRow = A[col];
      A[col] = A[maxRow];
      A[maxRow] = tempRow;

      const tx = bx[col]; bx[col] = bx[maxRow]; bx[maxRow] = tx;
      const ty = by[col]; by[col] = by[maxRow]; by[maxRow] = ty;
      const tz = bz[col]; bz[col] = bz[maxRow]; bz[maxRow] = tz;
    }

    const pivot = A[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      if (Math.abs(factor) < 1e-14) continue;
      for (let j = col; j < n; j++) {
        A[row][j] -= factor * A[col][j];
      }
      bx[row] -= factor * bx[col];
      by[row] -= factor * by[col];
      bz[row] -= factor * bz[col];
    }
  }

  // Обратная подстановка
  const px: number[] = new Array(n);
  const py: number[] = new Array(n);
  const pz: number[] = new Array(n);

  for (let row = n - 1; row >= 0; row--) {
    let sumX = bx[row];
    let sumY = by[row];
    let sumZ = bz[row];
    for (let col = row + 1; col < n; col++) {
      sumX -= A[row][col] * px[col];
      sumY -= A[row][col] * py[col];
      sumZ -= A[row][col] * pz[col];
    }
    const diag = Math.abs(A[row][row]) > 1e-12 ? A[row][row] : 1e-12;
    px[row] = sumX / diag;
    py[row] = sumY / diag;
    pz[row] = sumZ / diag;
  }

  return definingPoints.map((pt, i) => ({
    x: px[i],
    y: py[i],
    z: pz[i],
    isCrease: pt.isCrease,
  }));
}

/**
 * Тесселяция B-сплайн поверхности с математически строгим швом по КВЛ (v = vSeam).
 * Поверхность строго заканчивается на линии КВЛ, а затем продолжается,
 * поэтому линия КВЛ состоит ровно из сегментов сетки обшивки без произвольных секущих плоскостей.
 */
export function tessellateBSplineSeamedGeometry(
  surface: BSplineSurfaceDescriptor,
  config: TessellationConfig,
  vSeam: number = 0.5,
  outwardNormalHint?: [number, number, number]
): {
  lowerGeometry: THREE.BufferGeometry;
  upperGeometry: THREE.BufferGeometry;
  fullGeometry: THREE.BufferGeometry;
} {
  const { uSegments, vSegments } = config;
  const vSegLower = Math.max(2, Math.floor(vSegments / 2));
  const vSegUpper = Math.max(2, Math.ceil(vSegments / 2));

  const shouldFlipWinding = Boolean(
    outwardNormalHint &&
    (outwardNormalHint[2] > 0.5 || outwardNormalHint[1] > 0.5)
  );

  // 1. Подводная часть [0, vSeam]
  const numLowerVerts = (uSegments + 1) * (vSegLower + 1);
  const numLowerIndices = uSegments * vSegLower * 6;
  const lowerPos = new Float32Array(numLowerVerts * 3);
  const lowerNorm = new Float32Array(numLowerVerts * 3);
  const lowerUvs = new Float32Array(numLowerVerts * 2);
  const lowerIdx = numLowerVerts > 65535 ? new Uint32Array(numLowerIndices) : new Uint16Array(numLowerIndices);

  let lIdx = 0;
  for (let i = 0; i <= uSegments; i++) {
    const u = i / uSegments;
    for (let j = 0; j <= vSegLower; j++) {
      const v = (j / vSegLower) * vSeam;
      const evalRes = evaluateSurfacePointAndNormal(u, v, surface);

      const base = lIdx * 3;
      lowerPos[base] = evalRes.position[0];
      lowerPos[base + 1] = evalRes.position[1];
      lowerPos[base + 2] = evalRes.position[2];

      let nx = evalRes.normal[0], ny = evalRes.normal[1], nz = evalRes.normal[2];
      if (outwardNormalHint) {
        const dot = nx * outwardNormalHint[0] + ny * outwardNormalHint[1] + nz * outwardNormalHint[2];
        if (dot < 0) { nx = -nx; ny = -ny; nz = -nz; }
      }
      lowerNorm[base] = nx;
      lowerNorm[base + 1] = ny;
      lowerNorm[base + 2] = nz;

      lowerUvs[lIdx * 2] = u;
      lowerUvs[lIdx * 2 + 1] = v;
      lIdx++;
    }
  }

  let lTri = 0;
  const strideLower = vSegLower + 1;
  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegLower; j++) {
      const p00 = i * strideLower + j;
      const p01 = i * strideLower + (j + 1);
      const p10 = (i + 1) * strideLower + j;
      const p11 = (i + 1) * strideLower + (j + 1);

      if (shouldFlipWinding) {
        lowerIdx[lTri++] = p00; lowerIdx[lTri++] = p11; lowerIdx[lTri++] = p10;
        lowerIdx[lTri++] = p00; lowerIdx[lTri++] = p01; lowerIdx[lTri++] = p11;
      } else {
        lowerIdx[lTri++] = p00; lowerIdx[lTri++] = p10; lowerIdx[lTri++] = p11;
        lowerIdx[lTri++] = p00; lowerIdx[lTri++] = p11; lowerIdx[lTri++] = p01;
      }
    }
  }

  const lowerGeom = new THREE.BufferGeometry();
  lowerGeom.setAttribute('position', new THREE.BufferAttribute(lowerPos, 3));
  lowerGeom.setAttribute('normal', new THREE.BufferAttribute(lowerNorm, 3));
  lowerGeom.setAttribute('uv', new THREE.BufferAttribute(lowerUvs, 2));
  lowerGeom.setIndex(new THREE.BufferAttribute(lowerIdx, 1));

  // 2. Надводная часть [vSeam, 1.0]
  const numUpperVerts = (uSegments + 1) * (vSegUpper + 1);
  const numUpperIndices = uSegments * vSegUpper * 6;
  const upperPos = new Float32Array(numUpperVerts * 3);
  const upperNorm = new Float32Array(numUpperVerts * 3);
  const upperUvs = new Float32Array(numUpperVerts * 2);
  const upperIdx = numUpperVerts > 65535 ? new Uint32Array(numUpperIndices) : new Uint16Array(numUpperIndices);

  let uIdx = 0;
  for (let i = 0; i <= uSegments; i++) {
    const u = i / uSegments;
    for (let j = 0; j <= vSegUpper; j++) {
      const v = vSeam + (j / vSegUpper) * (1.0 - vSeam);
      const evalRes = evaluateSurfacePointAndNormal(u, v, surface);

      const base = uIdx * 3;
      upperPos[base] = evalRes.position[0];
      upperPos[base + 1] = evalRes.position[1];
      upperPos[base + 2] = evalRes.position[2];

      let nx = evalRes.normal[0], ny = evalRes.normal[1], nz = evalRes.normal[2];
      if (outwardNormalHint) {
        const dot = nx * outwardNormalHint[0] + ny * outwardNormalHint[1] + nz * outwardNormalHint[2];
        if (dot < 0) { nx = -nx; ny = -ny; nz = -nz; }
      }
      upperNorm[base] = nx;
      upperNorm[base + 1] = ny;
      upperNorm[base + 2] = nz;

      upperUvs[uIdx * 2] = u;
      upperUvs[uIdx * 2 + 1] = v;
      uIdx++;
    }
  }

  let uTri = 0;
  const strideUpper = vSegUpper + 1;
  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegUpper; j++) {
      const p00 = i * strideUpper + j;
      const p01 = i * strideUpper + (j + 1);
      const p10 = (i + 1) * strideUpper + j;
      const p11 = (i + 1) * strideUpper + (j + 1);

      if (shouldFlipWinding) {
        upperIdx[uTri++] = p00; upperIdx[uTri++] = p11; upperIdx[uTri++] = p10;
        upperIdx[uTri++] = p00; upperIdx[uTri++] = p01; upperIdx[uTri++] = p11;
      } else {
        upperIdx[uTri++] = p00; upperIdx[uTri++] = p10; upperIdx[uTri++] = p11;
        upperIdx[uTri++] = p00; upperIdx[uTri++] = p11; upperIdx[uTri++] = p01;
      }
    }
  }

  const upperGeom = new THREE.BufferGeometry();
  upperGeom.setAttribute('position', new THREE.BufferAttribute(upperPos, 3));
  upperGeom.setAttribute('normal', new THREE.BufferAttribute(upperNorm, 3));
  upperGeom.setAttribute('uv', new THREE.BufferAttribute(upperUvs, 2));
  upperGeom.setIndex(new THREE.BufferAttribute(upperIdx, 1));

  // 3. Полная монолитная геометрия через объединение (merge)
  const fullGeom = new THREE.BufferGeometry();
  const totalVerts = numLowerVerts + numUpperVerts;
  const totalIdx = numLowerIndices + numUpperIndices;

  const fullPos = new Float32Array(totalVerts * 3);
  const fullNorm = new Float32Array(totalVerts * 3);
  const fullUvs = new Float32Array(totalVerts * 2);
  const fullIndices = totalVerts > 65535 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);

  fullPos.set(lowerPos, 0);
  fullPos.set(upperPos, numLowerVerts * 3);
  fullNorm.set(lowerNorm, 0);
  fullNorm.set(upperNorm, numLowerVerts * 3);
  fullUvs.set(lowerUvs, 0);
  fullUvs.set(upperUvs, numLowerVerts * 2);

  fullIndices.set(lowerIdx, 0);
  for (let k = 0; k < numUpperIndices; k++) {
    fullIndices[numLowerIndices + k] = upperIdx[k] + numLowerVerts;
  }

  fullGeom.setAttribute('position', new THREE.BufferAttribute(fullPos, 3));
  fullGeom.setAttribute('normal', new THREE.BufferAttribute(fullNorm, 3));
  fullGeom.setAttribute('uv', new THREE.BufferAttribute(fullUvs, 2));
  fullGeom.setIndex(new THREE.BufferAttribute(fullIndices, 1));

  return {
    lowerGeometry: lowerGeom,
    upperGeometry: upperGeom,
    fullGeometry: fullGeom,
  };
}

/**
 * Точный расчет точки поверхности S(u, v), частных производных dS/du, dS/dv
 * и единичного вектора аналитической нормали n(u, v).
 */
export function evaluateSurfacePointAndNormal(
  u: number,
  v: number,
  surface: BSplineSurfaceDescriptor
): {
  position: [number, number, number];
  normal: [number, number, number];
  du: [number, number, number];
  dv: [number, number, number];
} {
  const { degreeU, degreeV, knotsU, knotsV, controlNet } = surface;
  const numU = controlNet.length;
  const numV = controlNet[0].length;

  const basisU = evaluateAllBasisAndDeriv(u, degreeU, knotsU, numU);
  const basisV = evaluateAllBasisAndDeriv(v, degreeV, knotsV, numV);

  let px = 0, py = 0, pz = 0;
  let duX = 0, duY = 0, duZ = 0;
  let dvX = 0, dvY = 0, dvZ = 0;

  for (let i = 0; i < numU; i++) {
    const Nu = basisU.values[i];
    const dNu = basisU.derivs[i];

    if (Math.abs(Nu) < 1e-12 && Math.abs(dNu) < 1e-12) continue;

    for (let j = 0; j < numV; j++) {
      const Nv = basisV.values[j];
      const dNv = basisV.derivs[j];

      if (Math.abs(Nv) < 1e-12 && Math.abs(dNv) < 1e-12) continue;

      const pt = controlNet[i][j];

      const wPos = Nu * Nv;
      px += wPos * pt.x;
      py += wPos * pt.y;
      pz += wPos * pt.z;

      const wDu = dNu * Nv;
      duX += wDu * pt.x;
      duY += wDu * pt.y;
      duZ += wDu * pt.z;

      const wDv = Nu * dNv;
      dvX += wDv * pt.x;
      dvY += wDv * pt.y;
      dvZ += wDv * pt.z;
    }
  }

  // Аналитический вектор нормали n = ∂S/∂u × ∂S/∂v
  let nx = duY * dvZ - duZ * dvY;
  let ny = duZ * dvX - duX * dvZ;
  let nz = duX * dvY - duY * dvX;

  let normLen = Math.sqrt(nx * nx + ny * ny + nz * nz);

  // Защита от вырождения производных на полюсах (например, при смыкании в точке носка штевня)
  if (normLen < 1e-8) {
    // Численная аппроксимация нормали в окрестности эпсилон
    const eps = 1e-3;
    const uAlt = u > 0.5 ? u - eps : u + eps;
    const vAlt = v > 0.5 ? v - eps : v + eps;

    const bUAlt = evaluateAllBasisAndDeriv(uAlt, degreeU, knotsU, numU);
    const bVAlt = evaluateAllBasisAndDeriv(vAlt, degreeV, knotsV, numV);

    let altDuX = 0, altDuY = 0, altDuZ = 0;
    let altDvX = 0, altDvY = 0, altDvZ = 0;

    for (let i = 0; i < numU; i++) {
      for (let j = 0; j < numV; j++) {
        const pt = controlNet[i][j];
        const wDu = bUAlt.derivs[i] * bVAlt.values[j];
        altDuX += wDu * pt.x;
        altDuY += wDu * pt.y;
        altDuZ += wDu * pt.z;

        const wDv = bUAlt.values[i] * bVAlt.derivs[j];
        altDvX += wDv * pt.x;
        altDvY += wDv * pt.y;
        altDvZ += wDv * pt.z;
      }
    }

    nx = altDuY * altDvZ - altDuZ * altDvY;
    ny = altDuZ * altDvX - altDuX * altDvZ;
    nz = altDuX * altDvY - altDuY * altDvX;
    normLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  }

  if (normLen > 1e-12) {
    nx /= normLen;
    ny /= normLen;
    nz /= normLen;
  } else {
    // Вектор наружу по умолчанию
    nx = 0;
    ny = 1;
    nz = 0;
  }

  return {
    position: [px, py, pz],
    normal: [nx, ny, nz],
    du: [duX, duY, duZ],
    dv: [dvX, dvY, dvZ],
  };
}

/**
 * Высокоскоростной дискретизатор (Tessellator): переводит математическую B-сплайн поверхность
 * в THREE.BufferGeometry с аналитическими нормалями.
 * Поддерживает повторное использование существующих массивов Float32Array для стабильных 60 FPS (< 5 мс).
 */
export function tessellateBSplineToBufferGeometry(
  surface: BSplineSurfaceDescriptor,
  config: TessellationConfig,
  targetGeometry?: THREE.BufferGeometry,
  outwardNormalHint?: [number, number, number]
): THREE.BufferGeometry {
  const { uSegments, vSegments } = config;
  const numVertices = (uSegments + 1) * (vSegments + 1);
  const numIndices = uSegments * vSegments * 6;

  const geom = targetGeometry || new THREE.BufferGeometry();

  let posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
  let normAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
  let uvAttr = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  let indexAttr = geom.getIndex();

  let positions: Float32Array;
  let normals: Float32Array;
  let uvs: Float32Array;
  let indices: Uint32Array | Uint16Array;

  if (posAttr && posAttr.count === numVertices) {
    positions = posAttr.array as Float32Array;
    normals = (normAttr ? normAttr.array : new Float32Array(numVertices * 3)) as Float32Array;
    uvs = (uvAttr ? uvAttr.array : new Float32Array(numVertices * 2)) as Float32Array;
    indices = (indexAttr ? indexAttr.array : (numVertices > 65535 ? new Uint32Array(numIndices) : new Uint16Array(numIndices))) as any;
  } else {
    positions = new Float32Array(numVertices * 3);
    normals = new Float32Array(numVertices * 3);
    uvs = new Float32Array(numVertices * 2);
    indices = numVertices > 65535 ? new Uint32Array(numIndices) : new Uint16Array(numIndices);
  }

  // Расчет сетки вершин
  let vIdx = 0;
  for (let i = 0; i <= uSegments; i++) {
    const u = i / uSegments;
    for (let j = 0; j <= vSegments; j++) {
      const v = j / vSegments;

      const evalResult = evaluateSurfacePointAndNormal(u, v, surface);

      const basePos = vIdx * 3;
      positions[basePos] = evalResult.position[0];
      positions[basePos + 1] = evalResult.position[1];
      positions[basePos + 2] = evalResult.position[2];

      let nx = evalResult.normal[0];
      let ny = evalResult.normal[1];
      let nz = evalResult.normal[2];

      if (outwardNormalHint) {
        const dot = nx * outwardNormalHint[0] + ny * outwardNormalHint[1] + nz * outwardNormalHint[2];
        if (dot < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
      }

      normals[basePos] = nx;
      normals[basePos + 1] = ny;
      normals[basePos + 2] = nz;

      const baseUv = vIdx * 2;
      uvs[baseUv] = u;
      uvs[baseUv + 1] = v;

      vIdx++;
    }
  }

  // Расчет индексов треугольников
  let iIdx = 0;
  const stride = vSegments + 1;
  const shouldFlipWinding = Boolean(
    outwardNormalHint &&
    (outwardNormalHint[2] > 0.5 || outwardNormalHint[1] > 0.5)
  );

  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegments; j++) {
      const p00 = i * stride + j;
      const p01 = i * stride + (j + 1);
      const p10 = (i + 1) * stride + j;
      const p11 = (i + 1) * stride + (j + 1);

      if (shouldFlipWinding) {
        // Треугольник 1
        indices[iIdx++] = p00;
        indices[iIdx++] = p11;
        indices[iIdx++] = p10;

        // Треугольник 2
        indices[iIdx++] = p00;
        indices[iIdx++] = p01;
        indices[iIdx++] = p11;
      } else {
        // Треугольник 1
        indices[iIdx++] = p00;
        indices[iIdx++] = p10;
        indices[iIdx++] = p11;

        // Треугольник 2
        indices[iIdx++] = p00;
        indices[iIdx++] = p11;
        indices[iIdx++] = p01;
      }
    }
  }

  if (!posAttr || posAttr.count !== numVertices) {
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
  } else {
    posAttr.needsUpdate = true;
    if (normAttr) normAttr.needsUpdate = true;
    if (uvAttr) uvAttr.needsUpdate = true;
    if (indexAttr) indexAttr.needsUpdate = true;
  }

  return geom;
}

// ─── ФУНКЦИИ ВЕРИФИКАЦИИ И ЮНИТ-ТЕСТИРОВАНИЯ (DoD) ───

/**
 * Верификация фундаментального свойства B-сплайнов: Разбиение единицы (Partition of Unity).
 * Для любого u in [0, 1] сумма sum(N_{i, p}(u)) === 1.00000000 с точностью не хуже 1e-9.
 */
export function verifyPartitionOfUnity(
  degree: number,
  knots: number[],
  numControlPoints: number,
  numSamples: number = 100
): { maxError: number; isValid: boolean } {
  let maxError = 0;

  for (let s = 0; s <= numSamples; s++) {
    const u = s / numSamples;
    const { values } = evaluateAllBasisAndDeriv(u, degree, knots, numControlPoints);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
    }
    const err = Math.abs(sum - 1.0);
    if (err > maxError) maxError = err;
  }

  return {
    maxError,
    isValid: maxError < 1e-9,
  };
}

/**
 * Верификация аналитических производных методом конечных разностей.
 * Расхождение между аналитической производной и (N(u+eps) - N(u-eps))/(2*eps) не более 1e-6.
 */
export function verifyDerivativeAccuracy(
  degree: number,
  knots: number[],
  numControlPoints: number,
  numSamples: number = 50,
  eps: number = 1e-5
): { maxError: number; isValid: boolean } {
  let maxError = 0;

  for (let s = 1; s < numSamples; s++) {
    const u = s / numSamples;
    const evalU = evaluateAllBasisAndDeriv(u, degree, knots, numControlPoints);
    const evalPlus = evaluateAllBasisAndDeriv(u + eps, degree, knots, numControlPoints);
    const evalMinus = evaluateAllBasisAndDeriv(u - eps, degree, knots, numControlPoints);

    for (let i = 0; i < numControlPoints; i++) {
      const numericDeriv = (evalPlus.values[i] - evalMinus.values[i]) / (2 * eps);
      const analyticDeriv = evalU.derivs[i];
      const err = Math.abs(numericDeriv - analyticDeriv);
      if (err > maxError) maxError = err;
    }
  }

  return {
    maxError,
    isValid: maxError < 1e-6,
  };
}
