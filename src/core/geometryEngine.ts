/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/geometryEngine.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Этот модуль является математическим и графическим движком (Geometry Engine) приложения.
 * Он содержит аналитические геометрические алгоритмы для расчетов судовых обводов, генерации
 * полигональной 3D-сетки Three.js и отрисовки чертежного 2D-сечения с размерными линиями на Canvas.
 * 
 * 📦 СОСТАВ ХРАНИМОЙ ИНФОРМАЦИИ И ФУНКЦИЙ:
 * 1. Вспомогательные цветовые функции:
 *    - `sliderToColor(value)` / `colorToSlider(hex)`: конвертация оттенков серого шкалы [0..100] <-> HEX.
 * 
 * 2. Аналитическая геометрия:
 *    - `calculateExternalFillet(A, B, C, R)`: находит центр сопряжения и точки касания для скругления
 *      угла между отрезками BA и BC заданным радиусом R.
 *    - `generateArcPoints(center, start, end, radius, segments)`: строит массив точек дуги скругления.
 * 
 * 3. Построение 3D-модели корпуса/бруса:
 *    - `createHollowBrus(params, brusMat, draftMat)`: строит полную 3D группу бруса (простой параллелепипед
 *      или сложный корпус с V-образным днищем, скругленной скулой, развалом бортов и разделением на подводную/надводную зоны).
 *    - `createSimpleBrus(...)`: быстрое построение прямоугольного бруса.
 *    - `createComplexBrus(...)`: параметрическое построение днища, скул, наклонных бортов и торцевых шпангоутов.
 *    - `createWallWithDraft(...)`: расчет сечения бортовой стенки плоскостью ватерлинии с разделением материалов.
 *    - `createEndWall(...)`: триангуляция торцевого шпангоута с учетом криволинейного контура и ватерлинии.
 *    - `createDraftLineMesh(...)`: создание контурной синей 3D линии на уровне осадки.
 * 
 * 4. Чертежная 2D-отрисовка (Canvas Renderer):
 *    - `renderCrossSectionToCanvas(...)`: чистая функция отрисовки поперечного сечения, сетки, координатных осей,
 *      касательных скругления, размерных стрелок развала, килеватости и радиуса.
 * ====================================================================================================
 */

import * as THREE from 'three';
import { BrusParams, FilletResult, Point2D } from './types';

// ============================================================================
// 🎨 ЦВЕТОВЫЕ ПРЕОБРАЗОВАНИЯ
// ============================================================================

// Диапазон шкалы серого:
// Минимальный темный ограничен благородным графитом (85 / #555555),
// а верхний предел расширен до чистого белого судового цвета (255 / #FFFFFF).
const MIN_GRAY = 85;
const MAX_GRAY = 255;

export function sliderToColor(value: number): number {
  const colorValue = Math.round(MIN_GRAY + (Math.max(0, Math.min(100, value)) / 100) * (MAX_GRAY - MIN_GRAY));
  return (colorValue << 16) | (colorValue << 8) | colorValue;
}

export function colorToSlider(hex: number): number {
  const r = (hex >> 16) & 0xff;
  return Math.max(0, Math.min(100, Math.round(((r - MIN_GRAY) / (MAX_GRAY - MIN_GRAY)) * 100)));
}

// ============================================================================
// 📐 АНАЛИТИЧЕСКАЯ ГЕОМЕТРИЯ: СОПРЯЖЕНИЯ И СКРУГЛЕНИЯ
// ============================================================================

/**
 * Вычисляет внешнее скругление заданным радиусом между вершинами A -> B -> C
 */
export function calculateExternalFillet(
  A: Point2D,
  B: Point2D,
  C: Point2D,
  R: number
): FilletResult | null {
  const BA = { x: A.x - B.x, y: A.y - B.y };
  const BC = { x: C.x - B.x, y: C.y - B.y };

  const lenBA = Math.hypot(BA.x, BA.y);
  const lenBC = Math.hypot(BC.x, BC.y);

  if (lenBA < 0.001 || lenBC < 0.001) return null;

  const uBA = { x: BA.x / lenBA, y: BA.y / lenBA };
  const uBC = { x: BC.x / lenBC, y: BC.y / lenBC };

  const dotProduct = uBA.x * uBC.x + uBA.y * uBC.y;
  const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));

  if (angle < 0.01 || angle > Math.PI - 0.01) return null;

  const cross = BA.x * BC.y - BA.y * BC.x;

  let normalBA: Point2D;
  let normalBC: Point2D;

  if (cross > 0) {
    normalBA = { x: -uBA.y, y: uBA.x };
    normalBC = { x: uBC.y, y: -uBC.x };
  } else {
    normalBA = { x: uBA.y, y: -uBA.x };
    normalBC = { x: -uBC.y, y: uBC.x };
  }

  const bisectorOut = {
    x: normalBA.x + normalBC.x,
    y: normalBA.y + normalBC.y,
  };

  const lenBisector = Math.hypot(bisectorOut.x, bisectorOut.y);
  if (lenBisector < 0.001) return null;

  const uBisectorOut = {
    x: bisectorOut.x / lenBisector,
    y: bisectorOut.y / lenBisector,
  };

  const halfAngle = angle / 2;
  const distToCenter = R / Math.sin(halfAngle);

  const O: Point2D = {
    x: B.x + uBisectorOut.x * distToCenter,
    y: B.y + uBisectorOut.y * distToCenter,
  };

  const BO = { x: O.x - B.x, y: O.y - B.y };

  const proj1 = BO.x * uBA.x + BO.y * uBA.y;
  const T1: Point2D = {
    x: B.x + proj1 * uBA.x,
    y: B.y + proj1 * uBA.y,
  };

  const proj2 = BO.x * uBC.x + BO.y * uBC.y;
  const T2: Point2D = {
    x: B.x + proj2 * uBC.x,
    y: B.y + proj2 * uBC.y,
  };

  return {
    center: O,
    touch1: T1,
    touch2: T2,
    radius: R,
  };
}

/**
 * Генерирует дискретные точки дуги скругления
 */
export function generateArcPoints(
  center: Point2D,
  start: Point2D,
  end: Point2D,
  radius: number,
  segments: number = 32
): Point2D[] {
  const angleStart = Math.atan2(start.y - center.y, start.x - center.x);
  const angleEnd = Math.atan2(end.y - center.y, end.x - center.x);

  let angleDiff = angleEnd - angleStart;
  if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

  const points: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = angleStart + t * angleDiff;
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    points.push({ x, y });
  }

  return points;
}

// ============================================================================
// 🧊 3D ГЕНЕРАТОР МОДЕЛИ БРУСА (THREE.JS)
// ============================================================================

/**
 * Вычисляет вертикальные уровни геометрии сечения с учетом опций включения килеватости и погиби в высоту H:
 * - deadriseInHeight: если true, киль находится на -h/2, а кромка днища/скула поднимается до (-h/2 + deadrise).
 *                     если false, кромка днища на -h/2, а киль опускается вниз до (-h/2 - deadrise).
 * - deckCamberInHeight: если true, вершина палубы находится на +h/2, а планшир/борта опускаются до (+h/2 - camber).
 *                       если false, планшир/борта на +h/2, а вершина палубы поднимается до (+h/2 + camber).
 */
export function calculateVerticalLevels(params: {
  height: number;
  deadrise: number;
  deckCamber?: number;
  deadriseInHeight?: boolean;
  deckCamberInHeight?: boolean;
}): {
  keelY: number;
  bottomEdgeY: number;
  topY: number;
  apexY: number;
  totalHeight: number;
} {
  const h = params.height;
  const deadrise = Math.max(0, params.deadrise);
  const camber = Math.max(0, params.deckCamber ?? 0);
  const deadriseInHeight = Boolean(params.deadriseInHeight);
  const deckCamberInHeight = Boolean(params.deckCamberInHeight);

  let keelY: number;
  let bottomEdgeY: number;
  if (deadriseInHeight) {
    keelY = -h / 2;
    bottomEdgeY = -h / 2 + deadrise;
  } else {
    keelY = -h / 2 - deadrise;
    bottomEdgeY = -h / 2;
  }

  let topY: number;
  let apexY: number;
  if (deckCamberInHeight) {
    topY = h / 2 - camber;
    apexY = h / 2;
  } else {
    topY = h / 2;
    apexY = h / 2 + camber;
  }

  const totalHeight = apexY - keelY;

  return { keelY, bottomEdgeY, topY, apexY, totalHeight };
}

export function buildContour2DPoints(params: {
  width: number;
  height: number;
  radius: number;
  flare: number;
  deadrise: number;
  deckCamber?: number;
  sheerRadius?: number;
  deadriseInHeight?: boolean;
  deckCamberInHeight?: boolean;
}): Point2D[] {
  const w = params.width;
  const flare = params.flare;
  const deadrise = Math.max(0, params.deadrise);
  const camber = Math.max(0, params.deckCamber ?? 0);

  const { keelY, bottomEdgeY, topY, apexY } = calculateVerticalLevels(params);
  const sideHeight = Math.max(0.01, topY - bottomEdgeY);

  const bottomWidth = w;
  const topWidth = Math.max(0.1, w + 2 * flare);

  const maxRadius = Math.min(bottomWidth / 2, sideHeight);
  const r = Math.min(params.radius, Math.max(0, maxRadius));

  const maxSheerRadius = Math.min(topWidth / 2, sideHeight / 2);
  const rSheer = Math.min(Math.max(0, params.sheerRadius ?? 0), Math.max(0, maxSheerRadius));

  const pts: Point2D[] = [];
  const arcSegments = 32;

  // 1. Скуловые скругления (Bilge Fillets)
  let leftBilgeFillet: FilletResult | null = null;
  let rightBilgeFillet: FilletResult | null = null;

  if (r > 0) {
    if (deadrise > 0) {
      leftBilgeFillet = calculateExternalFillet(
        { x: -topWidth / 2, y: topY },
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: 0, y: keelY },
        r
      );
      rightBilgeFillet = calculateExternalFillet(
        { x: 0, y: keelY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        { x: topWidth / 2, y: topY },
        r
      );
    } else {
      leftBilgeFillet = calculateExternalFillet(
        { x: -topWidth / 2, y: topY },
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        r
      );
      rightBilgeFillet = calculateExternalFillet(
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        { x: topWidth / 2, y: topY },
        r
      );
    }
  }

  // 2. Скругления ширстрека (Sheerstrake Fillets)
  let leftSheerFillet: FilletResult | null = null;
  let rightSheerFillet: FilletResult | null = null;

  if (rSheer > 0) {
    const pLeftBot = leftBilgeFillet ? leftBilgeFillet.touch1 : { x: -bottomWidth / 2, y: bottomEdgeY };
    const pRightBot = rightBilgeFillet ? rightBilgeFillet.touch2 : { x: bottomWidth / 2, y: bottomEdgeY };

    leftSheerFillet = calculateExternalFillet(
      pLeftBot,
      { x: -topWidth / 2, y: topY },
      { x: 0, y: apexY },
      rSheer
    );

    rightSheerFillet = calculateExternalFillet(
      { x: 0, y: apexY },
      { x: topWidth / 2, y: topY },
      pRightBot,
      rSheer
    );
  }

  // --- Сборка контура шпангоута ---

  // 1. Киль / центр днища
  if (deadrise > 0) {
    pts.push({ x: 0, y: keelY });
  } else {
    pts.push({ x: 0, y: bottomEdgeY });
  }

  // 2. Левая скула
  if (r > 0 && leftBilgeFillet) {
    pts.push({ x: leftBilgeFillet.touch2.x, y: leftBilgeFillet.touch2.y });
    const arc = generateArcPoints(leftBilgeFillet.center, leftBilgeFillet.touch2, leftBilgeFillet.touch1, r, arcSegments);
    for (let i = 1; i < arc.length; i++) {
      pts.push(arc[i]);
    }
  } else {
    pts.push({ x: -bottomWidth / 2, y: bottomEdgeY });
  }

  // 3. Левый борт и левый ширстрек
  if (rSheer > 0 && leftSheerFillet) {
    pts.push({ x: leftSheerFillet.touch1.x, y: leftSheerFillet.touch1.y });
    const arc = generateArcPoints(leftSheerFillet.center, leftSheerFillet.touch1, leftSheerFillet.touch2, rSheer, arcSegments);
    for (let i = 1; i < arc.length; i++) {
      pts.push(arc[i]);
    }
  } else {
    pts.push({ x: -topWidth / 2, y: topY });
  }

  // 4. Палуба со сплайном погиби (Deck Camber)
  const zDeckLeft = leftSheerFillet ? leftSheerFillet.touch2.x : -topWidth / 2;
  const yDeckLeft = leftSheerFillet ? leftSheerFillet.touch2.y : topY;
  const zDeckRight = rightSheerFillet ? rightSheerFillet.touch1.x : topWidth / 2;
  const yDeckRight = rightSheerFillet ? rightSheerFillet.touch1.y : topY;

  const deckSegments = 32;
  const z0 = Math.max(0.001, (zDeckRight - zDeckLeft) / 2);
  const yEdge = (yDeckLeft + yDeckRight) / 2;

  for (let i = 1; i < deckSegments; i++) {
    const t = i / deckSegments;
    const z = zDeckLeft + t * (zDeckRight - zDeckLeft);
    let y = yDeckLeft + t * (yDeckRight - yDeckLeft);
    if (camber > 0) {
      const normZ = z / z0;
      y = apexY - (apexY - yEdge) * (normZ * normZ);
    }
    pts.push({ x: z, y: y });
  }

  // 5. Правый ширстрек
  if (rSheer > 0 && rightSheerFillet) {
    pts.push({ x: rightSheerFillet.touch1.x, y: rightSheerFillet.touch1.y });
    const arc = generateArcPoints(rightSheerFillet.center, rightSheerFillet.touch1, rightSheerFillet.touch2, rSheer, arcSegments);
    for (let i = 1; i < arc.length; i++) {
      pts.push(arc[i]);
    }
  } else {
    pts.push({ x: topWidth / 2, y: topY });
  }

  // 6. Правый борт и правая скула
  if (r > 0 && rightBilgeFillet) {
    pts.push({ x: rightBilgeFillet.touch2.x, y: rightBilgeFillet.touch2.y });
    const arc = generateArcPoints(rightBilgeFillet.center, rightBilgeFillet.touch2, rightBilgeFillet.touch1, r, arcSegments);
    for (let i = 1; i < arc.length; i++) {
      pts.push(arc[i]);
    }
  } else {
    pts.push({ x: bottomWidth / 2, y: bottomEdgeY });
  }

  // 7. Замыкание на киль / центр днища
  if (deadrise > 0) {
    pts.push({ x: 0, y: keelY });
  } else {
    pts.push({ x: 0, y: bottomEdgeY });
  }

  return pts;
}

export interface DualBranches3D {
  leftBranch: THREE.Vector3[];
  rightBranch: THREE.Vector3[];
}

export function getCrossSectionHalfBranches3D(params: {
  width: number;
  height: number;
  radius: number;
  flare: number;
  deadrise: number;
  deckCamber?: number;
  sheerRadius?: number;
  showDeckCover?: boolean;
  deadriseInHeight?: boolean;
  deckCamberInHeight?: boolean;
}): DualBranches3D {
  const w = params.width;
  const flare = params.flare;
  const deadrise = Math.max(0, params.deadrise);
  const camber = Math.max(0, params.deckCamber ?? 0);
  const sheerRadius = Math.max(0, params.sheerRadius ?? 0);
  const hasDeck = Boolean(params.showDeckCover);

  const { keelY, bottomEdgeY, topY, apexY } = calculateVerticalLevels(params);
  const sideHeight = Math.max(0.01, topY - bottomEdgeY);
  const bottomWidth = w;
  const topWidth = Math.max(0.1, w + 2 * flare);

  const maxRadius = Math.min(bottomWidth / 2, sideHeight);
  const r = Math.min(params.radius, Math.max(0, maxRadius));

  const maxSheerRadius = Math.min(topWidth / 2, sideHeight / 2);
  const rSheer = Math.min(sheerRadius, Math.max(0, maxSheerRadius));

  const arcSegments = 24;

  // 1. Bilge fillets
  let leftBilgeFillet: FilletResult | null = null;
  let rightBilgeFillet: FilletResult | null = null;
  if (r > 0) {
    if (deadrise > 0) {
      leftBilgeFillet = calculateExternalFillet(
        { x: -topWidth / 2, y: topY },
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: 0, y: keelY },
        r
      );
      rightBilgeFillet = calculateExternalFillet(
        { x: 0, y: keelY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        { x: topWidth / 2, y: topY },
        r
      );
    } else {
      leftBilgeFillet = calculateExternalFillet(
        { x: -topWidth / 2, y: topY },
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        r
      );
      rightBilgeFillet = calculateExternalFillet(
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        { x: topWidth / 2, y: topY },
        r
      );
    }
  }

  // 2. Sheer fillets
  let leftSheerFillet: FilletResult | null = null;
  let rightSheerFillet: FilletResult | null = null;
  if (rSheer > 0 && hasDeck) {
    const pLeftBot = leftBilgeFillet ? leftBilgeFillet.touch1 : { x: -bottomWidth / 2, y: bottomEdgeY };
    const pRightBot = rightBilgeFillet ? rightBilgeFillet.touch2 : { x: bottomWidth / 2, y: bottomEdgeY };

    leftSheerFillet = calculateExternalFillet(
      pLeftBot,
      { x: -topWidth / 2, y: topY },
      { x: 0, y: apexY },
      rSheer
    );
    rightSheerFillet = calculateExternalFillet(
      { x: 0, y: apexY },
      { x: topWidth / 2, y: topY },
      pRightBot,
      rSheer
    );
  }

  // --- ЛЕВАЯ ВЕТВЬ (от киля вверх) ---
  const leftPts: Point2D[] = [];
  leftPts.push({ x: 0, y: deadrise > 0 ? keelY : bottomEdgeY });

  if (r > 0 && leftBilgeFillet) {
    leftPts.push({ x: leftBilgeFillet.touch2.x, y: leftBilgeFillet.touch2.y });
    const arc = generateArcPoints(leftBilgeFillet.center, leftBilgeFillet.touch2, leftBilgeFillet.touch1, r, arcSegments);
    for (let i = 1; i < arc.length; i++) {
      leftPts.push(arc[i]);
    }
  } else {
    leftPts.push({ x: -bottomWidth / 2, y: bottomEdgeY });
  }

  if (hasDeck) {
    if (rSheer > 0 && leftSheerFillet) {
      leftPts.push({ x: leftSheerFillet.touch1.x, y: leftSheerFillet.touch1.y });
      const arc = generateArcPoints(leftSheerFillet.center, leftSheerFillet.touch1, leftSheerFillet.touch2, rSheer, arcSegments);
      for (let i = 1; i < arc.length; i++) {
        leftPts.push(arc[i]);
      }
    } else {
      leftPts.push({ x: -topWidth / 2, y: topY });
    }

    const zDeckLeft = leftSheerFillet ? leftSheerFillet.touch2.x : -topWidth / 2;
    const yDeckLeft = leftSheerFillet ? leftSheerFillet.touch2.y : topY;
    const deckSegments = 24;
    const z0 = Math.max(0.001, topWidth / 2);

    for (let i = 1; i <= deckSegments; i++) {
      const t = i / deckSegments;
      const z = zDeckLeft + t * (0 - zDeckLeft);
      let y = yDeckLeft + t * (apexY - yDeckLeft);
      if (camber > 0) {
        const normZ = z / z0;
        y = apexY - (apexY - yDeckLeft) * (normZ * normZ);
      }
      if (i === deckSegments) {
        y = apexY;
      }
      leftPts.push({ x: z, y });
    }
  } else {
    // Палуба отключена: заканчиваем на верхнем левом краю борта
    leftPts.push({ x: -topWidth / 2, y: topY });
  }

  // --- ПРАВАЯ ВЕТВЬ (от киля вверх) ---
  const rightPts: Point2D[] = [];
  rightPts.push({ x: 0, y: deadrise > 0 ? keelY : bottomEdgeY });

  if (r > 0 && rightBilgeFillet) {
    rightPts.push({ x: rightBilgeFillet.touch1.x, y: rightBilgeFillet.touch1.y });
    const arc = generateArcPoints(rightBilgeFillet.center, rightBilgeFillet.touch1, rightBilgeFillet.touch2, r, arcSegments);
    for (let i = 1; i < arc.length; i++) {
      rightPts.push(arc[i]);
    }
  } else {
    rightPts.push({ x: bottomWidth / 2, y: bottomEdgeY });
  }

  if (hasDeck) {
    if (rSheer > 0 && rightSheerFillet) {
      rightPts.push({ x: rightSheerFillet.touch2.x, y: rightSheerFillet.touch2.y });
      const arc = generateArcPoints(rightSheerFillet.center, rightSheerFillet.touch2, rightSheerFillet.touch1, rSheer, arcSegments);
      for (let i = 1; i < arc.length; i++) {
        rightPts.push(arc[i]);
      }
    } else {
      rightPts.push({ x: topWidth / 2, y: topY });
    }

    const zDeckRight = rightSheerFillet ? rightSheerFillet.touch1.x : topWidth / 2;
    const yDeckRight = rightSheerFillet ? rightSheerFillet.touch1.y : topY;
    const deckSegments = 24;
    const z0 = Math.max(0.001, topWidth / 2);

    for (let i = 1; i <= deckSegments; i++) {
      const t = i / deckSegments;
      const z = zDeckRight + t * (0 - zDeckRight);
      let y = yDeckRight + t * (apexY - yDeckRight);
      if (camber > 0) {
        const normZ = z / z0;
        y = apexY - (apexY - yDeckRight) * (normZ * normZ);
      }
      if (i === deckSegments) {
        y = apexY;
      }
      rightPts.push({ x: z, y });
    }
  } else {
    // Палуба отключена: заканчиваем на верхнем правом краю борта
    rightPts.push({ x: topWidth / 2, y: topY });
  }

  const cleanBranch = (pts: Point2D[]): THREE.Vector3[] => {
    const res: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const v = new THREE.Vector3(0, pts[i].y, pts[i].x);
      if (i === 0 || v.distanceTo(res[res.length - 1]) > 0.0001) {
        res.push(v);
      }
    }
    return res;
  };

  return {
    leftBranch: cleanBranch(leftPts),
    rightBranch: cleanBranch(rightPts),
  };
}

export function getCrossSectionContour3D(params: {
  width: number;
  height: number;
  radius: number;
  flare: number;
  deadrise: number;
  deckCamber?: number;
  sheerRadius?: number;
  showDeckCover?: boolean;
  deadriseInHeight?: boolean;
  deckCamberInHeight?: boolean;
}): THREE.Vector3[] {
  // Обводка поперечного сечения (шпангоут) всегда строится полным замкнутым контуром
  // с учетом погиби палубы и радиуса ширстрека для наглядного отображения геометрических параметров
  const pts2D = buildContour2DPoints(params);
  const points3D: THREE.Vector3[] = [];

  for (let i = 0; i < pts2D.length; i++) {
    points3D.push(new THREE.Vector3(0, pts2D[i].y, pts2D[i].x));
  }

  // Удаляем дублирующиеся подряд идущие точки
  const cleaned: THREE.Vector3[] = [];
  for (let i = 0; i < points3D.length; i++) {
    if (i === 0 || points3D[i].distanceTo(points3D[i - 1]) > 0.0001) {
      cleaned.push(points3D[i]);
    }
  }

  // Замыкаем контур
  if (cleaned.length > 0) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (first.distanceTo(last) > 0.001) {
      cleaned.push(first.clone());
    }
  }

  return cleaned;
}

/**
 * Создает 3D-модель верхней крышки (палубы) по контуру сечения с погибью
 */
export function createDeckCoverMesh(
  params: {
    width: number;
    height: number;
    flare: number;
    deckCamber?: number;
    sheerRadius?: number;
    deckCamberInHeight?: boolean;
  },
  deckMaterial?: THREE.Material,
  sliceThickness: number = 0.5
): THREE.Mesh {
  const w = params.width;
  const flare = params.flare;
  const camber = Math.max(0, params.deckCamber ?? 0);
  const topWidth = w + 2 * flare;
  const { topY, apexY } = calculateVerticalLevels({
    height: params.height,
    deadrise: 0,
    deckCamber: params.deckCamber,
    deckCamberInHeight: params.deckCamberInHeight,
  });
  const deckSegments = 32;

  const pts: { z: number; y: number }[] = [];
  for (let i = 0; i <= deckSegments; i++) {
    const t = i / deckSegments;
    const z = -topWidth / 2 + t * topWidth;
    const normZ = z / (topWidth / 2);
    const y = camber > 0 ? apexY - camber * (normZ * normZ) : topY;
    pts.push({ z, y });
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const halfT = sliceThickness / 2;
  const plateThick = 0.12;

  // 2 X-среза (перед и зад крышки)
  const xVals = [-halfT, halfT];
  for (let xi = 0; xi < 2; xi++) {
    const x = xVals[xi];
    for (let zi = 0; zi <= deckSegments; zi++) {
      const p = pts[zi];
      // Верх
      positions.push(x, p.y + plateThick / 2, p.z);
      normals.push(0, 1, 0);
      uvs.push(xi, zi / deckSegments);

      // Низ
      positions.push(x, p.y - plateThick / 2, p.z);
      normals.push(0, -1, 0);
      uvs.push(xi, zi / deckSegments);
    }
  }

  const stride = (deckSegments + 1) * 2;
  for (let zi = 0; zi < deckSegments; zi++) {
    const topA = 0 * stride + zi * 2;
    const topB = 1 * stride + zi * 2;
    const topC = 1 * stride + (zi + 1) * 2;
    const topD = 0 * stride + (zi + 1) * 2;

    indices.push(topA, topB, topD);
    indices.push(topB, topC, topD);

    const botA = topA + 1;
    const botB = topB + 1;
    const botC = topC + 1;
    const botD = topD + 1;

    indices.push(botA, botD, botB);
    indices.push(botB, botD, botC);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = deckMaterial || new THREE.MeshStandardMaterial({
    color: 0x1e242b,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Вспомогательная функция равномерной дискретизации 3D-полилинии по длине дуги.
 * Устраняет разницу в плотности точек между прямыми участками и скруглениями,
 * обеспечивая строго одинаковую толщину и идеальную гладкость трубок Безье/сечений.
 */
function resamplePolylineUniform(pts: THREE.Vector3[], maxStep: number = 0.06, isClosed: boolean = false): THREE.Vector3[] {
  if (pts.length < 2) return pts;
  const result: THREE.Vector3[] = [];
  const count = isClosed ? pts.length - 1 : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const dist = p1.distanceTo(p2);
    if (dist < 1e-6) continue;
    const numSub = Math.max(1, Math.ceil(dist / maxStep));
    for (let s = 0; s < numSub; s++) {
      const t = s / numSub;
      result.push(new THREE.Vector3().lerpVectors(p1, p2, t));
    }
  }
  if (!isClosed) {
    result.push(pts[pts.length - 1].clone());
  } else if (result.length > 0) {
    result.push(result[0].clone());
  }
  return result;
}

/**
 * Строит точную 3D трубку строго ПОСТОЯННОГО круглого сечения вдоль любой 3D-кривой
 * (форштевень в ДП, шпангоуты в плоскости сечения или произвольные пространственные контуры).
 * Гарантирует идеальную круглость сечения, одинаковый диаметр на всём протяжении и полное отсутствие
 * сплющивания, скручивания или деформаций при перемещении точек.
 */
export function createContourTubeMesh(
  points3D: THREE.Vector3[],
  tubeRadius: number = 0.28,
  color: number = 0x050505
): THREE.Mesh {
  const rad = Math.max(0.005, tubeRadius);
  const rawPts = points3D.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (rawPts.length < 2) {
    return new THREE.Mesh(new THREE.BufferGeometry());
  }

  // Проверяем, замкнута ли кривая (первая и последняя точки совпадают)
  const isClosed = rawPts[0].distanceTo(rawPts[rawPts.length - 1]) < 0.001 && rawPts.length > 2;
  const pts = resamplePolylineUniform(rawPts, 0.06, isClosed);
  const n = pts.length;

  if (n < 2) {
    return new THREE.Mesh(new THREE.BufferGeometry());
  }

  const effectiveCount = isClosed ? n - 1 : n;

  const radialSegments = 24;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // 1. Вычисляем нормализованные биссектрисы касательных T_i для каждой вершины
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < effectiveCount; i++) {
    const prevIdx = i === 0 ? (isClosed ? effectiveCount - 1 : 0) : i - 1;
    const nextIdx = i === effectiveCount - 1 ? (isClosed ? 0 : effectiveCount - 1) : i + 1;

    const tIn = (i === 0 && !isClosed)
      ? new THREE.Vector3().subVectors(pts[1], pts[0]).normalize()
      : new THREE.Vector3().subVectors(pts[i], pts[prevIdx]).normalize();

    const tOut = (i === effectiveCount - 1 && !isClosed)
      ? new THREE.Vector3().subVectors(pts[effectiveCount - 1], pts[effectiveCount - 2]).normalize()
      : new THREE.Vector3().subVectors(pts[nextIdx], pts[i]).normalize();

    let T = new THREE.Vector3().addVectors(tIn, tOut);
    if (T.lengthSq() < 1e-6) {
      T = tOut.clone();
    } else {
      T.normalize();
    }
    tangents.push(T);
  }

  // 2. Строим ортонормированный базис (Normal, Binormal), строго перпендикулярный касательной T_i
  const normalsFrame: THREE.Vector3[] = [];
  const binormalsFrame: THREE.Vector3[] = [];

  // Проверяем плоскость расположения кривой
  let isXYPlane = true; // Диаметральная плоскость ДП (Z = 0)
  let isYZPlane = true; // Плоскость шпангоута (X = 0)
  for (let i = 0; i < effectiveCount; i++) {
    if (Math.abs(pts[i].z) > 0.001) isXYPlane = false;
    if (Math.abs(pts[i].x) > 0.001) isYZPlane = false;
  }

  if (isXYPlane) {
    // В ДП (Z = 0):
    for (let i = 0; i < effectiveCount; i++) {
      const T = tangents[i];
      let N = new THREE.Vector3(-T.y, T.x, 0);
      if (N.lengthSq() < 1e-6) N = new THREE.Vector3(0, 1, 0);
      else N.normalize();
      const B = new THREE.Vector3(0, 0, 1);
      normalsFrame.push(N);
      binormalsFrame.push(B);
    }
  } else if (isYZPlane) {
    // В плоскости шпангоута (X = 0):
    for (let i = 0; i < effectiveCount; i++) {
      const T = tangents[i];
      let N = new THREE.Vector3(0, -T.z, T.y);
      if (N.lengthSq() < 1e-6) N = new THREE.Vector3(0, 1, 0);
      else N.normalize();
      const B = new THREE.Vector3(1, 0, 0);
      normalsFrame.push(N);
      binormalsFrame.push(B);
    }
  } else {
    // Универсальный Parallel Transport Frame (Bishop Frame) для пространственной 3D кривой
    const T0 = tangents[0];
    let N0 = new THREE.Vector3(0, 0, 1).cross(T0);
    if (N0.lengthSq() < 1e-4) {
      N0 = new THREE.Vector3(0, 1, 0).cross(T0);
    }
    N0.normalize();
    const B0 = new THREE.Vector3().crossVectors(T0, N0).normalize();

    normalsFrame.push(N0);
    binormalsFrame.push(B0);

    for (let i = 1; i < effectiveCount; i++) {
      const Tprev = tangents[i - 1];
      const Tcurr = tangents[i];
      const Nprev = normalsFrame[i - 1];

      // Double Reflection (RMF)
      const v1 = new THREE.Vector3().subVectors(pts[i], pts[i - 1]);
      const c1 = Math.max(1e-8, v1.dot(v1));
      const rL = Nprev.clone().addScaledVector(v1, (-2 / c1) * v1.dot(Nprev));
      const tL = Tprev.clone().addScaledVector(v1, (-2 / c1) * v1.dot(Tprev));

      const v2 = new THREE.Vector3().subVectors(Tcurr, tL);
      const c2 = Math.max(1e-8, v2.dot(v2));
      let Ncurr = rL.clone().addScaledVector(v2, (-2 / c2) * v2.dot(rL));
      Ncurr.normalize();
      const Bcurr = new THREE.Vector3().crossVectors(Tcurr, Ncurr).normalize();

      normalsFrame.push(Ncurr);
      binormalsFrame.push(Bcurr);
    }
  }

  // 3. Генерация вершин постоянного круглого сечения радиуса rad
  for (let i = 0; i < effectiveCount; i++) {
    const p = pts[i];
    const N = normalsFrame[i];
    const B = binormalsFrame[i];

    for (let j = 0; j < radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Вектор нормали к цилиндрической поверхности
      const normX = cosA * N.x + sinA * B.x;
      const normY = cosA * N.y + sinA * B.y;
      const normZ = cosA * N.z + sinA * B.z;

      // Вершина на строго цилиндрическом сечении радиуса rad
      const vx = p.x + rad * normX;
      const vy = p.y + rad * normY;
      const vz = p.z + rad * normZ;

      positions.push(vx, vy, vz);
      normals.push(normX, normY, normZ);
    }
  }

  // 4. Триангуляция колец
  const segments = isClosed ? effectiveCount : effectiveCount - 1;
  for (let i = 0; i < segments; i++) {
    const ringA = i * radialSegments;
    const ringB = ((i + 1) % effectiveCount) * radialSegments;

    for (let j = 0; j < radialSegments; j++) {
      const nextJ = (j + 1) % radialSegments;

      const a = ringA + j;
      const b = ringB + j;
      const c = ringB + nextJ;
      const d = ringA + nextJ;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // 5. Заглушки для незамкнутых трубок на концах
  if (!isClosed && effectiveCount >= 2) {
    // Начальная заглушка (i = 0)
    const centerStartIdx = positions.length / 3;
    positions.push(pts[0].x, pts[0].y, pts[0].z);
    const startNorm = tangents[0].clone().negate();
    normals.push(startNorm.x, startNorm.y, startNorm.z);

    for (let j = 0; j < radialSegments; j++) {
      const nextJ = (j + 1) % radialSegments;
      indices.push(centerStartIdx, nextJ, j);
    }

    // Конечная заглушка (i = effectiveCount - 1)
    const endRingBase = (effectiveCount - 1) * radialSegments;
    const centerEndIdx = positions.length / 3;
    const pEnd = pts[effectiveCount - 1];
    positions.push(pEnd.x, pEnd.y, pEnd.z);
    const endNorm = tangents[effectiveCount - 1];
    normals.push(endNorm.x, endNorm.y, endNorm.z);

    for (let j = 0; j < radialSegments; j++) {
      const nextJ = (j + 1) % radialSegments;
      indices.push(centerEndIdx, endRingBase + j, endRingBase + nextJ);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * ============================================================================
 * 🚢 ТОПОЛОГИЯ ПОВЕРХНОСТЕЙ КОРПУСА (HULL SURFACES TOPOLOGY & PARAMETRIC GRAPH)
 * ============================================================================
 * Все поверхности корпуса строго взаимосвязаны и образуют замкнутую C1-гладкую
 * многогранную оболочку. Каждая поверхность параметрически зависит от соседних:
 * 
 * 1. [ДНИЩЕВАЯ ОБШИВКА / Bottom Shell Plating]:
 *    - Примыкает к: Киль (ДП, Z=0) и Скуловой пояс (Bilge Strake).
 *    - Зависит от: width (B), height (H), deadrise (β).
 *    - Граничные условия: (0, keelY) <-> bilge.touch2 (левый) / bilge.touch1 (правый).
 * 
 * 2. [СКУЛОВОЙ ПОЯС / Bilge Strake Fillets (Left/Right)]:
 *    - Примыкает к: Днищу (снизу) и Бортовой обшивке (сверху).
 *    - Зависит от: radius (R), deadrise (β), flare (ΔB), width (B).
 *    - Гладкость C1: касание с днищем в touch2/touch1, с бортом в touch1/touch2.
 * 
 * 3. [БОРТОВАЯ ОБШИВКА / Side Shell Plating (Left/Right)]:
 *    - Примыкает к: Скуловому поясу (снизу) и Ширстрековому поясу (сверху).
 *    - Зависит от: height (H), flare (ΔB), radius (R), sheerRadius (R_sheer), draft (d).
 *    - Граничные точки: bilge.touch1 (низ) <-> sheer.touch1 (верх).
 *    - Разделение: делится ватерлинией draftLevel на подводный и надводный пояса.
 * 
 * 4. [ШИРСТРЕКОВЫЙ ПОЯС / Sheerstrake Fillets (Left/Right)]:
 *    - Примыкает к: Бортовой обшивке (снаружи) и Верхней палубе (изнутри).
 *    - Зависит от: sheerRadius (R_sheer), deckCamber (погибь), flare (ΔB), height (H).
 *    - Гладкость C1: касание с бортом в sheer.touch1 и с палубой в sheer.touch2.
 * 
 * 5. [ВЕРХНЯЯ ПАЛУБА / Upper Deck Plating]:
 *    - Примыкает к: Левому и Правому ширстрекам (или кромкам наклонных бортов).
 *    - Зависит от: deckCamber (стрелка погиби), sheerRadius, topWidth.
 *    - Профиль: параболический сплайн Y(Z) = apexY - (apexY - yEdge) * (Z / Z0)^2.
 * 
 * 6. [ТОРЦЕВЫЕ ШПАНГОУТЫ / End Bulkheads (Транец и Форштевень)]:
 *    - Примыкают ко ВСЕМ продольным поясам обшивки с нулевым зазором (0-tolerance).
 *    - Строятся строго по замкнутому 2D-контуру buildContour2DPoints, с
 *      автоматической триангуляцией и разделением по уровню ватерлинии (осадке).
 * ============================================================================
 */

export interface SplitHollowBrusResult {
  group: THREE.Group;
  rearGroup: THREE.Group;
  frontGroup: THREE.Group;
}

export function createSplitHollowBrus(
  params: BrusParams,
  brusMaterial: THREE.Material,
  draftMaterial: THREE.Material,
  frontOffset: number = 0,
  bowLength: number = 0,
  isRearTransparent: boolean = false,
  rearBrusMaterial?: THREE.Material,
  rearDraftMaterial?: THREE.Material,
  isEditingBow: boolean = false
): SplitHollowBrusResult {
  const group = new THREE.Group();
  const rearGroup = new THREE.Group();
  const frontGroup = new THREE.Group();

  const l = params.length;
  const w = params.width;
  const h = params.height;
  const d = params.draft;
  const r = params.radius;
  const flare = params.flare;
  const deadrise = params.deadrise;
  const deckCamber = params.deckCamber ?? 0;
  const sheerRadius = params.sheerRadius ?? 0;
  const showDeckCover = params.showDeckCover ?? false;

  const maxRadius = Math.min((w - 2 * flare) / 2, h);
  const radius = Math.min(r, Math.max(0, maxRadius));

  const safeBowLen = Math.max(0, Math.min(l, bowLength));

  if (isEditingBow && safeBowLen > 0) {
    // Режим редактирования носовой оконечности:
    // Центральная и кормовая часть корпуса (от -L/2 до L/2 - safeBowLen) строго размещается в rearGroup,
    // которая в режиме редактирования носовой оконечности полностью скрывается (visible = false).
    const splitX = l / 2 - safeBowLen;
    const activeRearBrusMat = (isRearTransparent && rearBrusMaterial) ? rearBrusMaterial : brusMaterial;
    const activeRearDraftMat = (isRearTransparent && rearDraftMaterial) ? rearDraftMaterial : draftMaterial;

    buildHullSegment(
      rearGroup,
      -l / 2,
      splitX,
      w,
      h,
      d,
      radius,
      flare,
      deadrise,
      deckCamber,
      sheerRadius,
      showDeckCover,
      activeRearBrusMat,
      activeRearDraftMat,
      true, // startCap (транец на корме)
      true, // endCap (переборка на шпангоуте стыковки носа)
      params.deadriseInHeight,
      params.deckCamberInHeight
    );
  } else {
    // Режим нормального отображения судна, анимации резки/сварки и редактирования сечения/центральной части:
    // Разделение ВСЕГДА происходит строго по миделю (X = 0).
    // rearGroup = кормовая половина корпуса (от -L/2 до 0)
    // frontGroup = носовая половина центральной части (от 0 до L/2 - safeBowLen) + пристыкованный нос (добавляется в App.tsx)
    // При анимации отделения frontOffset носовая половина центральной части и носовая часть улетают вместе!
    const activeRearBrusMat = (isRearTransparent && rearBrusMaterial) ? rearBrusMaterial : brusMaterial;
    const activeRearDraftMat = (isRearTransparent && rearDraftMaterial) ? rearDraftMaterial : draftMaterial;

    // 1. Кормовая секция (от -L/2 до 0): имеет транец на -L/2, БЕЗ переборки в месте разреза X=0
    buildHullSegment(
      rearGroup,
      -l / 2,
      0,
      w,
      h,
      d,
      radius,
      flare,
      deadrise,
      deckCamber,
      sheerRadius,
      showDeckCover,
      activeRearBrusMat,
      activeRearDraftMat,
      true, // startCap (транец на корме)
      false, // endCap: false — НИКАКИХ ПЕРЕГОРОДОК В СЕЧЕНИИ РАЗРЕЗА!
      params.deadriseInHeight,
      params.deckCamberInHeight
    );

    // 2. Носовая половина центральной части (от 0 до L/2 - safeBowLen)
    const xFrontEnd = safeBowLen > 0 ? Math.max(0, l / 2 - safeBowLen) : l / 2;
    if (xFrontEnd > 0.001) {
      buildHullSegment(
        frontGroup,
        0,
        xFrontEnd,
        w,
        h,
        d,
        radius,
        flare,
        deadrise,
        deckCamber,
        sheerRadius,
        showDeckCover,
        brusMaterial,
        draftMaterial,
        false, // startCap: false — НИКАКИХ ПЕРЕГОРОДОК В СЕЧЕНИИ РАЗРЕЗА!
        safeBowLen === 0, // endCap только если носа нет
        params.deadriseInHeight,
        params.deckCamberInHeight
      );
    }
  }

  frontGroup.position.x = frontOffset;

  group.add(rearGroup);
  group.add(frontGroup);

  return { group, rearGroup, frontGroup };
}

export function createHollowBrus(
  params: BrusParams,
  brusMaterial: THREE.Material,
  draftMaterial: THREE.Material
): THREE.Group {
  const { group } = createSplitHollowBrus(params, brusMaterial, draftMaterial, 0);
  return group;
}

function buildHullSegment(
  targetGroup: THREE.Group,
  xStart: number,
  xEnd: number,
  w: number,
  h: number,
  d: number,
  radius: number,
  flare: number,
  deadrise: number,
  deckCamber: number,
  sheerRadius: number,
  showDeckCover: boolean,
  brusMaterial: THREE.Material,
  draftMaterial: THREE.Material,
  hasStartCap: boolean,
  hasEndCap: boolean,
  deadriseInHeight?: boolean,
  deckCamberInHeight?: boolean
) {
  const segments = 32;
  const len = xEnd - xStart;
  const xCenter = (xStart + xEnd) / 2;
  const r = radius;

  const { keelY, bottomEdgeY, topY, apexY } = calculateVerticalLevels({
    height: h,
    deadrise,
    deckCamber,
    deadriseInHeight,
    deckCamberInHeight,
  });
  const bottomWidth = w;
  const topWidth = w + 2 * flare;
  const draftLevel = keelY + d;

  const maxSheerRadius = Math.min(topWidth / 4, h / 2);
  const rSheer = Math.min(Math.max(0, sheerRadius), Math.max(0, maxSheerRadius));

  const isSimple = r === 0 && flare === 0 && deadrise === 0 && deckCamber === 0 && rSheer === 0;

  if (isSimple) {
    // Простой прямоугольный брус
    const bottomMat = d > 0 ? draftMaterial : brusMaterial;
    const bottomGeom = new THREE.PlaneGeometry(len, w);
    const bottomMesh = new THREE.Mesh(bottomGeom, bottomMat);
    bottomMesh.rotation.x = -Math.PI / 2;
    bottomMesh.position.set(xCenter, -h / 2, 0);
    bottomMesh.receiveShadow = true;
    targetGroup.add(bottomMesh);

    createSimpleWallSegment(targetGroup, len, h, d, xCenter, -w / 2, 0, brusMaterial, draftMaterial);
    createSimpleWallSegment(targetGroup, len, h, d, xCenter, w / 2, Math.PI, brusMaterial, draftMaterial);

    if (showDeckCover) {
      const topGeom = new THREE.PlaneGeometry(len, w);
      const topMesh = new THREE.Mesh(topGeom, brusMaterial);
      topMesh.rotation.x = Math.PI / 2;
      topMesh.position.set(xCenter, topY, 0);
      topMesh.receiveShadow = true;
      targetGroup.add(topMesh);
    }

    if (hasStartCap) {
      createSimpleWallSegment(targetGroup, w, h, d, xStart, 0, -Math.PI / 2, brusMaterial, draftMaterial);
    }
    if (hasEndCap) {
      createSimpleWallSegment(targetGroup, w, h, d, xEnd, 0, Math.PI / 2, brusMaterial, draftMaterial);
    }
    return;
  }

  // --- Расчет сопряжений скулы и ширстрека ---

  // 1. Скуловые скругления (Bilge Fillets)
  let leftBilgeFillet: FilletResult | null = null;
  let rightBilgeFillet: FilletResult | null = null;

  if (r > 0) {
    if (deadrise > 0) {
      leftBilgeFillet = calculateExternalFillet(
        { x: -topWidth / 2, y: topY },
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: 0, y: keelY },
        r
      );
      rightBilgeFillet = calculateExternalFillet(
        { x: 0, y: keelY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        { x: topWidth / 2, y: topY },
        r
      );
    } else {
      leftBilgeFillet = calculateExternalFillet(
        { x: -topWidth / 2, y: topY },
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        r
      );
      rightBilgeFillet = calculateExternalFillet(
        { x: -bottomWidth / 2, y: bottomEdgeY },
        { x: bottomWidth / 2, y: bottomEdgeY },
        { x: topWidth / 2, y: topY },
        r
      );
    }
  }

  // 2. Ширстрековые скругления (Sheerstrake Fillets)
  let leftSheerFillet: FilletResult | null = null;
  let rightSheerFillet: FilletResult | null = null;

  if (rSheer > 0) {
    const pLeftBot = leftBilgeFillet ? leftBilgeFillet.touch1 : { x: -bottomWidth / 2, y: bottomEdgeY };
    const pRightBot = rightBilgeFillet ? rightBilgeFillet.touch2 : { x: bottomWidth / 2, y: bottomEdgeY };

    leftSheerFillet = calculateExternalFillet(
      pLeftBot,
      { x: -topWidth / 2, y: topY },
      { x: 0, y: apexY },
      rSheer
    );

    rightSheerFillet = calculateExternalFillet(
      { x: 0, y: apexY },
      { x: topWidth / 2, y: topY },
      pRightBot,
      rSheer
    );
  }

  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  // ==========================================================================
  // 1. ДНИЩЕВАЯ ОБШИВКА (BOTTOM SHELL PLATING)
  // Аннотация: Соединяется в ДП с Килем (0, keelY), по бокам со Скуловыми скруглениями (touch2 / touch1).
  // Окрашивается точно по ватерлинии draftLevel: под водой draftMaterial, выше brusMaterial.
  // ==========================================================================
  if (deadrise > 0) {
    const bottomLeftZ = leftBilgeFillet ? leftBilgeFillet.touch2.x : -bottomWidth / 2;
    const bottomLeftY = leftBilgeFillet ? leftBilgeFillet.touch2.y : bottomEdgeY;
    const bottomRightZ = rightBilgeFillet ? rightBilgeFillet.touch1.x : bottomWidth / 2;
    const bottomRightY = rightBilgeFillet ? rightBilgeFillet.touch1.y : bottomEdgeY;

    // Левая ветвь днища (от киля к левой скуле)
    createStripWithDraftSpan(
      targetGroup,
      xStart,
      xEnd,
      { x: 0, y: keelY },
      { x: bottomLeftZ, y: bottomLeftY },
      draftLevel,
      indices,
      false,
      brusMaterial,
      draftMaterial
    );

    // Правая ветвь днища (от киля к правой скуле)
    createStripWithDraftSpan(
      targetGroup,
      xStart,
      xEnd,
      { x: 0, y: keelY },
      { x: bottomRightZ, y: bottomRightY },
      draftLevel,
      indices,
      true,
      brusMaterial,
      draftMaterial
    );
  } else {
    const bottomMat = draftLevel > bottomEdgeY ? draftMaterial : brusMaterial;
    if (r > 0 && leftBilgeFillet && rightBilgeFillet) {
      const leftBottomZ = leftBilgeFillet.touch2.x;
      const rightBottomZ = rightBilgeFillet.touch1.x;
      const bottomCenterWidth = rightBottomZ - leftBottomZ;

      if (bottomCenterWidth > 0) {
        const bottomCenterGeom = new THREE.PlaneGeometry(len, bottomCenterWidth);
        const bottomCenterMesh = new THREE.Mesh(bottomCenterGeom, bottomMat);
        bottomCenterMesh.rotation.x = -Math.PI / 2;
        bottomCenterMesh.position.set(xCenter, bottomEdgeY, (leftBottomZ + rightBottomZ) / 2);
        bottomCenterMesh.receiveShadow = true;
        targetGroup.add(bottomCenterMesh);
      }
    } else {
      const bottomGeom = new THREE.PlaneGeometry(len, bottomWidth);
      const bottomMesh = new THREE.Mesh(bottomGeom, bottomMat);
      bottomMesh.rotation.x = -Math.PI / 2;
      bottomMesh.position.set(xCenter, bottomEdgeY, 0);
      bottomMesh.receiveShadow = true;
      targetGroup.add(bottomMesh);
    }
  }

  // ==========================================================================
  // 2. СКУЛОВЫЕ СКРУГЛЕНИЯ (BILGE STRAKE FILLET SURFACES)
  // Аннотация: Соединяются с днищем в touch2 (левый) / touch1 (правый) и с бортом в touch1 / touch2.
  // ==========================================================================
  if (leftBilgeFillet && rightBilgeFillet && r > 0) {
    const leftArcPoints = generateArcPoints(
      { x: leftBilgeFillet.center.x, y: leftBilgeFillet.center.y },
      { x: leftBilgeFillet.touch2.x, y: leftBilgeFillet.touch2.y },
      { x: leftBilgeFillet.touch1.x, y: leftBilgeFillet.touch1.y },
      r,
      segments
    );

    for (let i = 0; i < leftArcPoints.length - 1; i++) {
      createStripWithDraftSpan(
        targetGroup,
        xStart,
        xEnd,
        leftArcPoints[i],
        leftArcPoints[i + 1],
        draftLevel,
        indices,
        false,
        brusMaterial,
        draftMaterial
      );
    }

    const rightArcPoints = generateArcPoints(
      { x: rightBilgeFillet.center.x, y: rightBilgeFillet.center.y },
      { x: rightBilgeFillet.touch1.x, y: rightBilgeFillet.touch1.y },
      { x: rightBilgeFillet.touch2.x, y: rightBilgeFillet.touch2.y },
      r,
      segments
    );

    for (let i = 0; i < rightArcPoints.length - 1; i++) {
      createStripWithDraftSpan(
        targetGroup,
        xStart,
        xEnd,
        rightArcPoints[i],
        rightArcPoints[i + 1],
        draftLevel,
        indices,
        true,
        brusMaterial,
        draftMaterial
      );
    }
  }

  // ==========================================================================
  // 3. БОРТОВАЯ ОБШИВКА (SIDE SHELL PLATING)
  // Аннотация: Соединяется со скулой снизу (touch1/touch2) и с ширстреком сверху (touch1/touch2).
  // ==========================================================================
  // Границы левого борта:
  const leftWallBottomZ = leftBilgeFillet ? leftBilgeFillet.touch1.x : -bottomWidth / 2;
  const leftWallBottomY = leftBilgeFillet ? leftBilgeFillet.touch1.y : bottomEdgeY;
  const leftWallTopZ = leftSheerFillet ? leftSheerFillet.touch1.x : -topWidth / 2;
  const leftWallTopY = leftSheerFillet ? leftSheerFillet.touch1.y : topY;

  createStripWithDraftSpan(
    targetGroup,
    xStart,
    xEnd,
    { x: leftWallBottomZ, y: leftWallBottomY },
    { x: leftWallTopZ, y: leftWallTopY },
    draftLevel,
    indices,
    false,
    brusMaterial,
    draftMaterial
  );

  // Границы правого борта:
  const rightWallBottomZ = rightBilgeFillet ? rightBilgeFillet.touch2.x : bottomWidth / 2;
  const rightWallBottomY = rightBilgeFillet ? rightBilgeFillet.touch2.y : bottomEdgeY;
  const rightWallTopZ = rightSheerFillet ? rightSheerFillet.touch2.x : topWidth / 2;
  const rightWallTopY = rightSheerFillet ? rightSheerFillet.touch2.y : topY;

  createStripWithDraftSpan(
    targetGroup,
    xStart,
    xEnd,
    { x: rightWallBottomZ, y: rightWallBottomY },
    { x: rightWallTopZ, y: rightWallTopY },
    draftLevel,
    indices,
    true,
    brusMaterial,
    draftMaterial
  );

  // ==========================================================================
  // 4. ШИРСТРЕКОВЫЙ ПОЯС (SHEERSTRAKE FILLET SURFACES)
  // Аннотация: Соединяется с бортом в touch1 (левый) / touch2 (правый) и с палубой в touch2 / touch1.
  // ==========================================================================
  if (rSheer > 0 && leftSheerFillet && rightSheerFillet) {
    // Левый ширстрек (от борта к палубе)
    const leftSheerArc = generateArcPoints(
      { x: leftSheerFillet.center.x, y: leftSheerFillet.center.y },
      { x: leftSheerFillet.touch1.x, y: leftSheerFillet.touch1.y },
      { x: leftSheerFillet.touch2.x, y: leftSheerFillet.touch2.y },
      rSheer,
      segments
    );

    for (let i = 0; i < leftSheerArc.length - 1; i++) {
      createStripWithDraftSpan(
        targetGroup,
        xStart,
        xEnd,
        leftSheerArc[i],
        leftSheerArc[i + 1],
        draftLevel,
        indices,
        false,
        brusMaterial,
        draftMaterial
      );
    }

    // Правый ширстрек (от палубы к борту)
    const rightSheerArc = generateArcPoints(
      { x: rightSheerFillet.center.x, y: rightSheerFillet.center.y },
      { x: rightSheerFillet.touch1.x, y: rightSheerFillet.touch1.y },
      { x: rightSheerFillet.touch2.x, y: rightSheerFillet.touch2.y },
      rSheer,
      segments
    );

    for (let i = 0; i < rightSheerArc.length - 1; i++) {
      createStripWithDraftSpan(
        targetGroup,
        xStart,
        xEnd,
        rightSheerArc[i],
        rightSheerArc[i + 1],
        draftLevel,
        indices,
        true,
        brusMaterial,
        draftMaterial
      );
    }
  }

  // ==========================================================================
  // 5. ВЕРХНЯЯ ПАЛУБА / КРЫШКА (UPPER DECK PLATING)
  // Аннотация: Соединяется с левым ширстреком в leftSheer.touch2 и с правым в rightSheer.touch1.
  // ==========================================================================
  if (showDeckCover) {
    const zDeckLeft = leftSheerFillet ? leftSheerFillet.touch2.x : -topWidth / 2;
    const yDeckLeft = leftSheerFillet ? leftSheerFillet.touch2.y : topY;
    const zDeckRight = rightSheerFillet ? rightSheerFillet.touch1.x : topWidth / 2;
    const yDeckRight = rightSheerFillet ? rightSheerFillet.touch1.y : topY;

    const deckSegments = 32;
    const z0 = Math.max(0.001, (zDeckRight - zDeckLeft) / 2);
    const yEdge = (yDeckLeft + yDeckRight) / 2;

    const deckPts: Point2D[] = [];
    for (let i = 0; i <= deckSegments; i++) {
      const t = i / deckSegments;
      const z = zDeckLeft + t * (zDeckRight - zDeckLeft);
      let y = yDeckLeft + t * (yDeckRight - yDeckLeft);
      if (deckCamber > 0) {
        const normZ = z / z0;
        y = apexY - (apexY - yEdge) * (normZ * normZ);
      }
      deckPts.push({ x: z, y });
    }

    for (let i = 0; i < deckPts.length - 1; i++) {
      createStripWithDraftSpan(
        targetGroup,
        xStart,
        xEnd,
        deckPts[i],
        deckPts[i + 1],
        draftLevel,
        indices,
        false,
        brusMaterial,
        draftMaterial
      );
    }
  }

  // ==========================================================================
  // 6. ТОРЦЕВЫЕ ШПАНГОУТЫ / СЕЧЕНИЯ (END BULKHEADS / TRANSOM & BOW)
  // Аннотация: Строятся со 100% точностью по замкнутому контуру buildContour2DPoints,
  // примыкают ко всем поверхностям оболочки и делятся ватерлинией draftLevel.
  // ==========================================================================
  if (hasStartCap) {
    createEndWall(
      targetGroup,
      xStart,
      w,
      h,
      radius,
      flare,
      deadrise,
      deckCamber,
      sheerRadius,
      d,
      true,
      draftLevel,
      brusMaterial,
      draftMaterial,
      deadriseInHeight,
      deckCamberInHeight
    );
  }
  if (hasEndCap) {
    createEndWall(
      targetGroup,
      xEnd,
      w,
      h,
      radius,
      flare,
      deadrise,
      deckCamber,
      sheerRadius,
      d,
      false,
      draftLevel,
      brusMaterial,
      draftMaterial,
      deadriseInHeight,
      deckCamberInHeight
    );
  }
}

function createSimpleWallSegment(
  group: THREE.Group,
  width: number,
  h: number,
  d: number,
  x: number,
  z: number,
  rotY: number,
  brusMaterial: THREE.Material,
  draftMaterial: THREE.Material,
  xOverride?: number
) {
  const posX = xOverride !== undefined ? xOverride : x;
  if (d > 0 && d < h) {
    const bottomGeom = new THREE.PlaneGeometry(width, d);
    const bottomMesh = new THREE.Mesh(bottomGeom, draftMaterial);
    bottomMesh.position.set(posX, -h / 2 + d / 2, z);
    bottomMesh.rotation.y = rotY;
    bottomMesh.castShadow = true;
    group.add(bottomMesh);

    const topGeom = new THREE.PlaneGeometry(width, h - d);
    const topMesh = new THREE.Mesh(topGeom, brusMaterial);
    topMesh.position.set(posX, -h / 2 + d + (h - d) / 2, z);
    topMesh.rotation.y = rotY;
    topMesh.castShadow = true;
    group.add(topMesh);
  } else {
    const geom = new THREE.PlaneGeometry(width, h);
    const mesh = new THREE.Mesh(geom, d >= h ? draftMaterial : brusMaterial);
    mesh.position.set(posX, 0, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    group.add(mesh);
  }
}

function createStripWithDraftSpan(
  group: THREE.Group,
  xStart: number,
  xEnd: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  draftLevel: number,
  indices: Uint16Array,
  isRight: boolean,
  brusMaterial: THREE.Material,
  draftMaterial: THREE.Material
) {
  const xA = isRight ? xEnd : xStart;
  const xB = isRight ? xStart : xEnd;

  const yMin = Math.min(p1.y, p2.y);
  const yMax = Math.max(p1.y, p2.y);

  if (draftLevel <= yMin) {
    // Полностью над ватерлинией (выше осадки)
    const vertices = new Float32Array([
      xA, p1.y, p1.x,
      xB, p1.y, p1.x,
      xB, p2.y, p2.x,
      xA, p2.y, p2.x,
    ]);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, brusMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  } else if (draftLevel >= yMax) {
    // Полностью под ватерлинией (ниже осадки)
    const vertices = new Float32Array([
      xA, p1.y, p1.x,
      xB, p1.y, p1.x,
      xB, p2.y, p2.x,
      xA, p2.y, p2.x,
    ]);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, draftMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  } else {
    // Плоскость ватерлинии Y = draftLevel пересекает поверхность на высоте draftLevel!
    const t = (draftLevel - p1.y) / (p2.y - p1.y);
    const midX = p1.x + t * (p2.x - p1.x);

    if (p1.y < p2.y) {
      // p1 ниже p2: нижняя часть от p1 до draftLevel под водой, верхняя от draftLevel до p2 над водой
      const lowerVertices = new Float32Array([
        xA, p1.y, p1.x,
        xB, p1.y, p1.x,
        xB, draftLevel, midX,
        xA, draftLevel, midX,
      ]);

      const lowerGeom = new THREE.BufferGeometry();
      lowerGeom.setAttribute('position', new THREE.BufferAttribute(lowerVertices, 3));
      lowerGeom.setIndex(new THREE.BufferAttribute(indices, 1));
      lowerGeom.computeVertexNormals();

      const lowerMesh = new THREE.Mesh(lowerGeom, draftMaterial);
      lowerMesh.castShadow = true;
      lowerMesh.receiveShadow = true;
      group.add(lowerMesh);

      const upperVertices = new Float32Array([
        xA, draftLevel, midX,
        xB, draftLevel, midX,
        xB, p2.y, p2.x,
        xA, p2.y, p2.x,
      ]);

      const upperGeom = new THREE.BufferGeometry();
      upperGeom.setAttribute('position', new THREE.BufferAttribute(upperVertices, 3));
      upperGeom.setIndex(new THREE.BufferAttribute(indices, 1));
      upperGeom.computeVertexNormals();

      const upperMesh = new THREE.Mesh(upperGeom, brusMaterial);
      upperMesh.castShadow = true;
      upperMesh.receiveShadow = true;
      group.add(upperMesh);
    } else {
      // p1 выше p2: верхняя часть от p1 до draftLevel над водой, нижняя от draftLevel до p2 под водой
      const upperVertices = new Float32Array([
        xA, p1.y, p1.x,
        xB, p1.y, p1.x,
        xB, draftLevel, midX,
        xA, draftLevel, midX,
      ]);

      const upperGeom = new THREE.BufferGeometry();
      upperGeom.setAttribute('position', new THREE.BufferAttribute(upperVertices, 3));
      upperGeom.setIndex(new THREE.BufferAttribute(indices, 1));
      upperGeom.computeVertexNormals();

      const upperMesh = new THREE.Mesh(upperGeom, brusMaterial);
      upperMesh.castShadow = true;
      upperMesh.receiveShadow = true;
      group.add(upperMesh);

      const lowerVertices = new Float32Array([
        xA, draftLevel, midX,
        xB, draftLevel, midX,
        xB, p2.y, p2.x,
        xA, p2.y, p2.x,
      ]);

      const lowerGeom = new THREE.BufferGeometry();
      lowerGeom.setAttribute('position', new THREE.BufferAttribute(lowerVertices, 3));
      lowerGeom.setIndex(new THREE.BufferAttribute(indices, 1));
      lowerGeom.computeVertexNormals();

      const lowerMesh = new THREE.Mesh(lowerGeom, draftMaterial);
      lowerMesh.castShadow = true;
      lowerMesh.receiveShadow = true;
      group.add(lowerMesh);
    }
  }
}

function createEndWall(
  group: THREE.Group,
  x: number,
  width: number,
  height: number,
  radius: number,
  flare: number,
  deadrise: number,
  deckCamber: number,
  sheerRadius: number,
  draft: number,
  isBack: boolean,
  draftLevel: number,
  brusMaterial: THREE.Material,
  draftMaterial: THREE.Material,
  deadriseInHeight?: boolean,
  deckCamberInHeight?: boolean
) {
  const { keelY, apexY } = calculateVerticalLevels({
    height,
    deadrise,
    deckCamber,
    deadriseInHeight,
    deckCamberInHeight,
  });

  // Строим полный точный 2D-контур шпангоута (со всеми сопряжениями, скулой, ширстреком и погибью)
  const rawContour = buildContour2DPoints({
    width,
    height,
    radius,
    flare,
    deadrise,
    deckCamber,
    sheerRadius,
    deadriseInHeight,
    deckCamberInHeight,
  });

  // Удаляем избыточные дублирующиеся подряд идущие точки для стабильной триангуляции Three.js Shape
  const fullContour: Point2D[] = [];
  for (let i = 0; i < rawContour.length; i++) {
    if (
      i === 0 ||
      Math.hypot(rawContour[i].x - rawContour[i - 1].x, rawContour[i].y - rawContour[i - 1].y) > 0.0005
    ) {
      fullContour.push(rawContour[i]);
    }
  }

  // Если осадка нулевая или полностью покрывает корпус
  if (draft === 0 || draftLevel <= keelY || draftLevel >= apexY) {
    const shape = new THREE.Shape();
    if (fullContour.length > 0) {
      shape.moveTo(fullContour[0].x, fullContour[0].y);
      for (let i = 1; i < fullContour.length; i++) {
        shape.lineTo(fullContour[i].x, fullContour[i].y);
      }
      shape.closePath();
    }

    const geometry = new THREE.ShapeGeometry(shape);
    const material = draftLevel >= apexY ? draftMaterial : brusMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = x;
    mesh.rotation.y = isBack ? -Math.PI / 2 : Math.PI / 2;
    mesh.castShadow = true;
    group.add(mesh);
    return;
  }

  // Разделение контура горизонтальной плоскостью ватерлинии Y = draftLevel
  const lowerContour: Point2D[] = [];
  const upperContour: Point2D[] = [];
  const intersectionPoints: Point2D[] = [];

  for (let i = 0; i < fullContour.length; i++) {
    const current = fullContour[i];
    const next = fullContour[(i + 1) % fullContour.length];

    const currentBelow = current.y <= draftLevel;
    const nextBelow = next.y <= draftLevel;

    if (currentBelow) {
      lowerContour.push({ x: current.x, y: current.y });
    } else {
      upperContour.push({ x: current.x, y: current.y });
    }

    // Линейное пересечение отрезка с плоскостью Y = draftLevel
    if (currentBelow !== nextBelow && Math.abs(next.y - current.y) > 0.00001) {
      const t = (draftLevel - current.y) / (next.y - current.y);
      const intersectX = current.x + t * (next.x - current.x);
      const intersectPoint = { x: intersectX, y: draftLevel };

      lowerContour.push(intersectPoint);
      upperContour.push(intersectPoint);
      intersectionPoints.push(intersectPoint);
    }
  }

  // Строим подводный шпангоут
  if (lowerContour.length >= 3) {
    const lowerShape = new THREE.Shape();
    lowerShape.moveTo(lowerContour[0].x, lowerContour[0].y);
    for (let i = 1; i < lowerContour.length; i++) {
      lowerShape.lineTo(lowerContour[i].x, lowerContour[i].y);
    }
    lowerShape.closePath();

    const lowerGeometry = new THREE.ShapeGeometry(lowerShape);
    const lowerMesh = new THREE.Mesh(lowerGeometry, draftMaterial);
    lowerMesh.position.x = x;
    lowerMesh.rotation.y = isBack ? -Math.PI / 2 : Math.PI / 2;
    lowerMesh.castShadow = true;
    group.add(lowerMesh);
  }

  // Строим надводный шпангоут
  if (upperContour.length >= 3) {
    const upperShape = new THREE.Shape();
    upperShape.moveTo(upperContour[0].x, upperContour[0].y);
    for (let i = 1; i < upperContour.length; i++) {
      upperShape.lineTo(upperContour[i].x, upperContour[i].y);
    }
    upperShape.closePath();

    const upperGeometry = new THREE.ShapeGeometry(upperShape);
    const upperMesh = new THREE.Mesh(upperGeometry, brusMaterial);
    upperMesh.position.x = x;
    upperMesh.rotation.y = isBack ? -Math.PI / 2 : Math.PI / 2;
    upperMesh.castShadow = true;
    group.add(upperMesh);
  }
}

// ============================================================================
// 📊 2D CANVAS ЧЕРТЕЖ ШПАНГОУТА / СЕЧЕНИЯ
// ============================================================================

export function renderCrossSectionToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
  flare: number,
  deadrise: number,
  canvasWidth: number,
  canvasHeight: number,
  canvasOffset: { x: number; y: number },
  canvasScale: number,
  deckCamber: number = 0,
  sheerRadius: number = 0,
  deadriseInHeight?: boolean,
  deckCamberInHeight?: boolean
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const padding = 40;

  ctx.save();
  ctx.translate(canvasOffset.x + canvasWidth / 2, canvasOffset.y + canvasHeight / 2 - padding);
  ctx.scale(canvasScale, canvasScale);

  const bottomWidth = width;
  const topWidth = Math.max(0.1, width + 2 * flare);
  const { keelY, bottomEdgeY, topY, apexY } = calculateVerticalLevels({
    height,
    deadrise,
    deckCamber,
    deadriseInHeight,
    deckCamberInHeight,
  });
  const totalHeight = apexY - keelY;

  const maxDimension = Math.max(bottomWidth, topWidth, totalHeight);
  const scale = (Math.min(canvasWidth, canvasHeight) * 0.45) / Math.max(1, maxDimension);

  const gridBounds = {
    minY: -canvasHeight / (2 * canvasScale) + padding / canvasScale,
    maxY: canvasHeight / (2 * canvasScale) - padding / canvasScale,
    minX: -canvasWidth / (2 * canvasScale),
    maxX: canvasWidth / (2 * canvasScale),
  };

  // Сетка с динамическим шагом в метрах
  ctx.strokeStyle = '#E8E8E8';
  ctx.lineWidth = 1 / canvasScale;
  const stepMeters = maxDimension > 50 ? 10 : maxDimension > 20 ? 5 : maxDimension > 5 ? 2 : 1;
  const gridStep = stepMeters * scale;

  for (let i = -25; i <= 25; i++) {
    ctx.beginPath();
    ctx.moveTo(i * gridStep, Math.max(gridBounds.minY, -300 / canvasScale));
    ctx.lineTo(i * gridStep, Math.min(gridBounds.maxY, 300 / canvasScale));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(Math.max(gridBounds.minX, -500 / canvasScale), i * gridStep);
    ctx.lineTo(Math.min(gridBounds.maxX, 500 / canvasScale), i * gridStep);
    ctx.stroke();
  }

  // Оси
  ctx.strokeStyle = '#BDBDBD';
  ctx.lineWidth = 1.5 / canvasScale;
  ctx.beginPath();
  ctx.moveTo(0, Math.max(gridBounds.minY, -300 / canvasScale));
  ctx.lineTo(0, Math.min(gridBounds.maxY, 300 / canvasScale));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(Math.max(gridBounds.minX, -500 / canvasScale), 0);
  ctx.lineTo(Math.min(gridBounds.maxX, 500 / canvasScale), 0);
  ctx.stroke();

  // Получаем точный контур сечения (в метрах)
  const rawPts = buildContour2DPoints({
    width,
    height,
    radius,
    flare,
    deadrise,
    deckCamber,
    sheerRadius,
    deadriseInHeight,
    deckCamberInHeight,
  });

  // Преобразуем координаты в экранные пиксели (Canvas Y инвертирован: y_canvas = -y_model * scale)
  const screenPts = rawPts.map((p) => ({
    x: p.x * scale,
    y: -p.y * scale,
  }));

  // Отрисовка заливки сечения
  ctx.fillStyle = 'rgba(160, 160, 160, 0.4)';
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 3.5 / canvasScale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (screenPts.length > 0) {
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Верхняя точка палубы
  if (deckCamber > 0) {
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2.5 / canvasScale;
    ctx.beginPath();
    const apexScreenY = -apexY * scale;
    ctx.arc(0, apexScreenY, 4 / canvasScale, 0, Math.PI * 2);
    ctx.fillStyle = '#0284c7';
    ctx.fill();
  }

  // Размерные стрелки
  ctx.strokeStyle = '#FF5722';
  ctx.fillStyle = '#FF5722';
  ctx.lineWidth = 1.5 / canvasScale;
  ctx.setLineDash([]);

  function drawArrow(cx: CanvasRenderingContext2D, x: number, y: number, dir: number, sc: number) {
    const size = 8 / sc;
    cx.beginPath();
    cx.moveTo(x, y);
    cx.lineTo(x + (dir > 0 ? -size : size), y - size / 2);
    cx.lineTo(x + (dir > 0 ? -size : size), y + size / 2);
    cx.closePath();
    cx.fill();
  }

  function drawArrowVertical(cx: CanvasRenderingContext2D, x: number, y: number, dir: number, sc: number) {
    const size = 8 / sc;
    cx.beginPath();
    cx.moveTo(x, y);
    cx.lineTo(x - size / 2, y + (dir > 0 ? size : -size));
    cx.lineTo(x + size / 2, y + (dir > 0 ? size : -size));
    cx.closePath();
    cx.fill();
  }

  const topY_px = -topY * scale;
  const bottomEdgeY_px = -bottomEdgeY * scale;
  const keelY_px = -keelY * scale;
  const topWidthPx = topWidth * scale;
  const widthPx = bottomWidth * scale;
  const maxHalfWPx = Math.max(topWidthPx, widthPx) / 2;

  if (flare > 0.001) {
    const dimY = topY_px - 15 / canvasScale;

    ctx.beginPath();
    ctx.moveTo(widthPx / 2, dimY);
    ctx.lineTo(topWidthPx / 2, dimY);
    ctx.stroke();

    drawArrow(ctx, widthPx / 2, dimY, 1, canvasScale);
    drawArrow(ctx, topWidthPx / 2, dimY, -1, canvasScale);

    ctx.font = `bold ${12 / canvasScale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`Развал: +${flare.toFixed(2)} м`, (widthPx / 2 + topWidthPx / 2) / 2, dimY - 10 / canvasScale);
  } else if (flare < -0.001) {
    const dimY = topY_px - 15 / canvasScale;

    ctx.beginPath();
    ctx.moveTo(topWidthPx / 2, dimY);
    ctx.lineTo(widthPx / 2, dimY);
    ctx.stroke();

    drawArrow(ctx, topWidthPx / 2, dimY, 1, canvasScale);
    drawArrow(ctx, widthPx / 2, dimY, -1, canvasScale);

    ctx.font = `bold ${12 / canvasScale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`Завал: ${flare.toFixed(2)} м`, (topWidthPx / 2 + widthPx / 2) / 2, dimY - 10 / canvasScale);
  }

  if (deadrise > 0) {
    const dimX = -maxHalfWPx - 40 / canvasScale;

    ctx.beginPath();
    ctx.moveTo(dimX, bottomEdgeY_px);
    ctx.lineTo(dimX, keelY_px);
    ctx.stroke();

    drawArrowVertical(ctx, dimX, bottomEdgeY_px, -1, canvasScale);
    drawArrowVertical(ctx, dimX, keelY_px, 1, canvasScale);

    ctx.font = `bold ${12 / canvasScale}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.save();
    ctx.translate(dimX - 10 / canvasScale, bottomEdgeY_px + 20 / canvasScale);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Килеватость: ${deadrise.toFixed(2)} м`, 0, 0);
    ctx.restore();
  }

  if (deckCamber > 0) {
    const apexScreenY = -apexY * scale;
    const baseDeckY = -topY * scale;
    const dimX = 25 / canvasScale;

    ctx.strokeStyle = '#0284c7';
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.moveTo(dimX, baseDeckY);
    ctx.lineTo(dimX, apexScreenY);
    ctx.stroke();

    drawArrowVertical(ctx, dimX, baseDeckY, 1, canvasScale);
    drawArrowVertical(ctx, dimX, apexScreenY, -1, canvasScale);

    ctx.font = `bold ${11 / canvasScale}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`Погибь: ${deckCamber.toFixed(2)} м`, dimX + 8 / canvasScale, (baseDeckY + apexScreenY) / 2 + 4 / canvasScale);
  }

  if (radius > 0) {
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = '#10b981';
    ctx.font = `bold ${11 / canvasScale}px sans-serif`;
    ctx.textAlign = 'center';

    const labelY = Math.min(keelY_px + 25 / canvasScale, gridBounds.maxY - 10 / canvasScale);
    ctx.fillText(`Радиус скулы: ${radius.toFixed(2)} м`, 0, labelY);
  }

  if (sheerRadius > 0) {
    ctx.strokeStyle = '#8b5cf6';
    ctx.fillStyle = '#8b5cf6';
    ctx.font = `bold ${11 / canvasScale}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`Ширстрек R: ${sheerRadius.toFixed(2)} м`, maxHalfWPx + 30 / canvasScale, topY_px + 10 / canvasScale);
  }

  // Информационный блок
  ctx.fillStyle = '#424242';
  ctx.font = `${11 / canvasScale}px sans-serif`;
  ctx.textAlign = 'left';
  const infoX = -maxHalfWPx;
  const startY = topY_px - (deckCamber > 0 ? deckCamber * scale + 35 / canvasScale : 45 / canvasScale);
  ctx.fillText(`Днище: ${width.toFixed(2)} м | Палуба: ${topWidth.toFixed(2)} м`, infoX, startY);
  ctx.fillText(`Высота (базовая H): ${height.toFixed(2)} м`, infoX, startY - 15 / canvasScale);
  ctx.fillText(`Полная высота: ${totalHeight.toFixed(2)} м`, infoX, startY - 30 / canvasScale);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#757575';
  ctx.fillText(`Масштаб: ${(canvasScale * 100).toFixed(0)}%`, maxHalfWPx, startY);

  ctx.restore();
}

// ============================================================================
// 🌊 ШАГ 1: МАТЕМАТИЧЕСКОЕ ЯДРО БАЗОВОЙ 2D-ВАТЕРЛИНИИ С ФУНКЦИЕЙ «АНТИ-ЩЕКА»
// ============================================================================

/**
 * Входные параметры расчета базовой 2D-ватерлинии Безье 4-го порядка
 */
export interface AntiCheekWaterlineParams {
  /** Длина носовой части L_bow (м) */
  L_bow: number;
  /** Полуширина борта на данном горизонте Y_mid (м) */
  Y_mid: number;
  /** Толщина ножа форштевня W_stem (м) */
  W_stem: number;
  /** Полуугол заострения входа alpha (градусы или радианы) */
  alpha: number;
  /** Длина прямого входа в мидель w_mid / midTangentLength (м) */
  w_mid: number;
  /** Положение плеча k_pullback / shoulderPullback (доля от L_bow, 0..1) */
  k_pullback: number;
  /** Глубина вогнутости ножа delta_hollow / hollowDepth (м) */
  delta_hollow: number;
  /** Количество точек дискретизации кривой (по умолчанию 60) */
  numPoints?: number;
}

/**
 * Результат расчета базовой 2D-ватерлинии Безье 4-го порядка
 */
export interface WaterlineBezier4Result {
  /** 5 опорных точек Безье: P0..P4 */
  controlPoints: [Point2D, Point2D, Point2D, Point2D, Point2D];
  /** Дискретные точки кривой Y(X) в судовой СК (X от 0 до -L_bow, Y >= 0) */
  points: Point2D[];
  /** Вспомогательный вектор хорды V_ch = P2 - P0 */
  chordVector: Point2D;
  /** Единичный вектор нормали N_ch к хорде (направлен наружу от ДП) */
  chordNormal: Point2D;
  /** Фактическая величина вогнутости delta_hollow */
  appliedHollow: number;
  /** Числовая производная dY/dX в точке стыка с миделем X = -L_bow: (Y(-L_bow + 0.001) - Y(-L_bow)) / 0.001 */
  derivativeAtMidship: number;
  /** Флаг строгой корректности 90° касательной (|dY/dX| < 1e-4) */
  is90DegTangentValid: boolean;
  /** Аналитическая функция вычисления P(t) при t ∈ [0, 1] */
  evaluateAtT: (t: number) => Point2D;
  /** Функция вычисления Y(X) для любого X ∈ [-L_bow, 0] */
  evaluateAtX: (x: number) => number;
}

/**
 * Изолированная функция расчета координат одной горизонтальной ватерлинии Безье 4-го порядка
 * с гарантией касания 90° к миделю (dY/dX = 0) и устранением паразитной выпуклости («щеки»)
 * через параметр стрелки вогнутости delta_hollow.
 */
export function calculateAntiCheekWaterline2D(params: AntiCheekWaterlineParams): WaterlineBezier4Result {
  const L_bow = Math.max(0.1, params.L_bow);
  const Y_mid = Math.max(0.001, params.Y_mid);
  const W_stem = Math.max(0.0, params.W_stem);
  const delta_hollow = Math.max(0.0, params.delta_hollow);

  // w_mid: длина прямого входа в мидель (фиксатор нулевой производной)
  const safe_w_mid = Math.max(0.01, Math.min(L_bow * 0.95, params.w_mid));

  // k_pullback: положение плеча (доля от L_bow)
  const safe_k_pullback = Math.max(0.05, Math.min(0.95, params.k_pullback));

  // alpha: полуугол заострения входа. Если > 1.57 (или > ~3° в радианах, т.е. градусы) — переводим в радианы.
  const alphaRad = params.alpha > 1.57 ? (params.alpha * Math.PI) / 180 : (params.alpha <= 0 ? 0.436 : params.alpha);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. МАТЕМАТИКА 5 ОПОРНЫХ ТОЧЕК БЕЗЬЕ (P0 .. P4)
  // ──────────────────────────────────────────────────────────────────────────

  // P0 = (0, W_stem / 2) — точка на форштевне
  const P0: Point2D = {
    x: 0,
    y: W_stem / 2,
  };

  // P2 = (-L_bow * k_pullback, Y_mid * 0.85) — носовое плечо
  const P2: Point2D = {
    x: -L_bow * safe_k_pullback,
    y: Y_mid * 0.85,
  };

  // Вспомогательный вектор хорды от P0 к плечу P2: V_ch = P2 - P0
  const V_ch: Point2D = {
    x: P2.x - P0.x,
    y: P2.y - P0.y,
  };
  const len_ch = Math.hypot(V_ch.x, V_ch.y);

  // Нормаль к хорде N_ch:
  // Для вектора хорды с V_ch.x < 0 и V_ch.y > 0 нормаль, направленная наружу (ny > 0):
  // N_ch = [ |V_ch.y|, -V_ch.x ] / |V_ch|
  // При формуле P1 = P0 + L_bow * 0.25 * [-cos alpha, sin alpha] - N_ch * delta_hollow
  // вычитание - N_ch * delta_hollow при delta_hollow > 0 втягивает P1 внутрь к оси X (ДП), устраняя «щеку»!
  let n_ch_x = 0;
  let n_ch_y = 1;
  if (len_ch > 1e-7) {
    let nx = -V_ch.y / len_ch;
    let ny = V_ch.x / len_ch;
    // Обеспечиваем внешнее направление нормали (ny > 0), чтобы вычитание уменьшало Y:
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    n_ch_x = nx;
    n_ch_y = ny;
  }
  const N_ch: Point2D = { x: n_ch_x, y: n_ch_y };

  // P1 = P0 + L_bow * 0.25 * [-cos alpha, sin alpha] - N_ch * delta_hollow
  let P1_x = P0.x + L_bow * 0.25 * (-Math.cos(alphaRad)) - n_ch_x * delta_hollow;
  let P1_y = P0.y + L_bow * 0.25 * Math.sin(alphaRad) - n_ch_y * delta_hollow;

  // Ограничитель: если при delta_hollow > 0 кривая пересекает ось X (Y < 0), P1.y = max(W_stem / 2, P1.y)
  P1_y = Math.max(W_stem / 2, P1_y);

  const P1: Point2D = { x: P1_x, y: P1_y };

  // P3 = (-L_bow + w_mid, Y_mid) — фиксатор нулевой производной (строго Y_mid!)
  const P3: Point2D = {
    x: -L_bow + safe_w_mid,
    y: Y_mid,
  };

  // P4 = (-L_bow, Y_mid) — стык с миделем
  const P4: Point2D = {
    x: -L_bow,
    y: Y_mid,
  };

  const controlPoints: [Point2D, Point2D, Point2D, Point2D, Point2D] = [P0, P1, P2, P3, P4];

  // ──────────────────────────────────────────────────────────────────────────
  // 2. АНАЛИТИЧЕСКАЯ ФУНКЦИЯ БЕРНШТЕЙНА 4-Й СТЕПЕНИ
  // ──────────────────────────────────────────────────────────────────────────
  const evaluateAtT = (t: number): Point2D => {
    const clampedT = Math.max(0, Math.min(1, t));
    const invT = 1 - clampedT;
    const invT2 = invT * invT;
    const invT3 = invT2 * invT;
    const invT4 = invT3 * invT;

    const t2 = clampedT * clampedT;
    const t3 = t2 * clampedT;
    const t4 = t3 * clampedT;

    const b0 = invT4;
    const b1 = 4 * clampedT * invT3;
    const b2 = 6 * t2 * invT2;
    const b3 = 4 * t3 * invT;
    const b4 = t4;

    return {
      x: b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x + b4 * P4.x,
      y: Math.max(0, b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y + b4 * P4.y),
    };
  };

  // Функция вычисления Y(X) методом бисекции
  const evaluateAtX = (targetX: number): number => {
    if (targetX >= P0.x) return P0.y;
    if (targetX <= P4.x) return P4.y;

    let low = 0;
    let high = 1;
    let bestT = 0.5;

    for (let i = 0; i < 28; i++) {
      const mid = (low + high) / 2;
      const pt = evaluateAtT(mid);
      if (Math.abs(pt.x - targetX) < 1e-7) {
        bestT = mid;
        break;
      }
      // X(t) убывает от 0 до -L_bow:
      if (pt.x > targetX) {
        low = mid;
      } else {
        high = mid;
      }
      bestT = mid;
    }

    return evaluateAtT(bestT).y;
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ДИСКРЕТИЗАЦИЯ КРИВОЙ
  // ──────────────────────────────────────────────────────────────────────────
  const numPts = Math.max(16, params.numPoints ?? 60);
  const points: Point2D[] = [];
  for (let i = 0; i <= numPts; i++) {
    points.push(evaluateAtT(i / numPts));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. ТЕСТ НА ПРЯМОЙ УГОЛ (90° К МИДЕЛЮ): ЧИСЛОВАЯ ПРОИЗВОДНАЯ
  // ──────────────────────────────────────────────────────────────────────────
  // Проверяем строго: (Y(-L_bow + 0.001) - Y(-L_bow)) / 0.001
  const xMid = -L_bow;
  const yAtMid = Y_mid;
  const yNearMid = evaluateAtX(xMid + 0.001);
  const derivativeAtMidship = (yNearMid - yAtMid) / 0.001;
  const is90DegTangentValid = Math.abs(derivativeAtMidship) < 1e-4;

  return {
    controlPoints,
    points,
    chordVector: V_ch,
    chordNormal: N_ch,
    appliedHollow: delta_hollow,
    derivativeAtMidship,
    is90DegTangentValid,
    evaluateAtT,
    evaluateAtX,
  };
}

/** Синоним функции для гибкости интеграции */
export const calculateWaterlineBezier4 = calculateAntiCheekWaterline2D;

/**
 * Отрисовка 2D-диаграммы ватерлинии Безье 4-го порядка с проверкой "Анти-щека" и касания 90°
 */
export function renderWaterline2DDiagramToCanvas(
  canvas: HTMLCanvasElement,
  result: WaterlineBezier4Result,
  params: AntiCheekWaterlineParams
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const L_bow = params.L_bow;
  const Y_mid = params.Y_mid;

  const padLeft = 45;
  const padRight = 35;
  const padTop = 30;
  const padBottom = 35;

  const drawW = width - padLeft - padRight;
  const drawH = height - padTop - padBottom;

  const scaleX = drawW / Math.max(0.1, L_bow);
  const scaleY = (drawH * 0.85) / Math.max(0.01, Y_mid * 1.25);
  const scale = Math.min(scaleX, scaleY);

  const baselineY = height - padBottom;
  const stemCanvasX = width - padRight;

  const toCanvas = (pt: Point2D) => ({
    x: stemCanvasX + pt.x * scale,
    y: baselineY - pt.y * scale,
  });

  // 1. Фон
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // Сетка
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  const gridStep = Math.max(0.5, Math.round(L_bow / 8));
  for (let gx = 0; gx <= L_bow; gx += gridStep) {
    const cx = stemCanvasX - gx * scale;
    ctx.beginPath();
    ctx.moveTo(cx, padTop);
    ctx.lineTo(cx, baselineY + 15);
    ctx.stroke();

    ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`-${gx.toFixed(0)}м`, cx, baselineY + 12);
  }

  // 2. ДП и Мидель
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.moveTo(padLeft - 10, baselineY);
  ctx.lineTo(stemCanvasX + 15, baselineY);
  ctx.stroke();

  const midX = stemCanvasX - L_bow * scale;
  ctx.beginPath();
  ctx.moveTo(midX, padTop - 10);
  ctx.lineTo(midX, baselineY + 15);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('ДП (CL, Y=0)', stemCanvasX - 85, baselineY - 4);
  ctx.textAlign = 'center';
  ctx.fillText('Мидель (X = -L_bow)', midX, padTop - 12);

  // 3. Опорный многоугольник
  const [P0, P1, P2, P3, P4] = result.controlPoints;
  const cP0 = toCanvas(P0);
  const cP1 = toCanvas(P1);
  const cP2 = toCanvas(P2);
  const cP3 = toCanvas(P3);
  const cP4 = toCanvas(P4);

  // Хорда V_ch от P0 к P2
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(cP0.x, cP0.y);
  ctx.lineTo(cP2.x, cP2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Отрезки полигона
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cP0.x, cP0.y);
  ctx.lineTo(cP1.x, cP1.y);
  ctx.lineTo(cP2.x, cP2.y);
  ctx.lineTo(cP3.x, cP3.y);
  ctx.lineTo(cP4.x, cP4.y);
  ctx.stroke();

  // 4. Отрисовка ватерлинии
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  result.points.forEach((pt, i) => {
    const cp = toCanvas(pt);
    if (i === 0) ctx.moveTo(cp.x, cp.y);
    else ctx.lineTo(cp.x, cp.y);
  });
  ctx.stroke();

  // Зеркальная ветвь
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  result.points.forEach((pt, i) => {
    const cp = {
      x: stemCanvasX + pt.x * scale,
      y: baselineY + pt.y * scale,
    };
    if (i === 0) ctx.moveTo(cp.x, cp.y);
    else ctx.lineTo(cp.x, cp.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 5. Участок касания 90° к миделю
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cP4.x, cP4.y);
  ctx.lineTo(cP3.x, cP3.y);
  ctx.stroke();

  // 6. Точки P0..P4
  const ptsMeta = [
    { pt: cP0, label: 'P0', color: '#38bdf8' },
    { pt: cP1, label: 'P1', color: '#06b6d4' },
    { pt: cP2, label: 'P2', color: '#f59e0b' },
    { pt: cP3, label: 'P3', color: '#10b981' },
    { pt: cP4, label: 'P4', color: '#a855f7' },
  ];

  ptsMeta.forEach(({ pt }, idx) => {
    ctx.fillStyle = ptsMeta[idx].color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, idx === 1 && result.appliedHollow > 0 ? 5.5 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`P${idx}`, pt.x, pt.y - 8);
  });

  // 7. Информационный бейдж
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = result.is90DegTangentValid ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(10, 10, 310, 48, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = result.is90DegTangentValid ? '#34d399' : '#f87171';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Касание 90° к миделю: dY/dX = ${result.derivativeAtMidship.toFixed(4)}`, 18, 26);

  ctx.fillStyle = result.appliedHollow > 0 ? '#38bdf8' : '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText(
    result.appliedHollow > 0
      ? `Анти-щека: δ_hollow = ${result.appliedHollow.toFixed(2)}м (вогнутый вход)`
      : `Анти-щека: δ_hollow = 0.00м (стандартный выпуклый)`,
    18,
    46
  );
}

// ─── ЭКСПОРТ КИНЕМАТИЧЕСКОГО ЯДРА КАНОНИЧЕСКОГО МОРФИНГА (ТЗ Раздел 6.2) ───
export {
  evaluateQuinticWeight,
  interpolateSectionParams,
  evaluateCanonicalCrossSection,
  computeAnalyticalNormal,
  generateBowHullGeometry,
} from './canonicalMorphEngine';


