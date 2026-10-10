import * as THREE from 'three';

/**
 * Опции для построения 3D размерной линии по ГОСТ 2.307-2011 / ЕСКД
 */
export interface GostDimension3DOptions {
  /** Начальная координата X */
  startX: number;
  /** Конечная координата X */
  endX: number;
  /** Высота Y размещения размерной линии */
  dimY: number;
  /** Положение Z размещения размерной линии */
  dimZ: number;
  /** Высота Y точки привязки на объекте (откуда идет выносная линия) */
  featureY: number;
  /** Положение Z точки привязки на объекте (откуда идет выносная линия) */
  featureZ: number;
  /** Главный текст размера (например, "L_квл = 100.00 м" или "L_носа = 25.00 м") */
  valueText: string;
  /** Дополнительный поясняющий текст (например, "25.0% от длины судна") */
  subText?: string;
  /** Заголовок / маркер (например, "ГАБАРИТ НОСА" или "ДЛИНА СУДНА ПО КВЛ") */
  badgeTitle?: string;
  /** Основной цвет размера (числовое значение Three.js, например 0x06b6d4 или 0x22c55e) */
  color?: number;
  /** Акцентный цвет для бейджа (CSS-строка, например "#06b6d4" или "#22c55e") */
  accentColor?: string;
  /** Фоновый цвет для бейджа */
  bgColor?: string;
  /** Радиус размерной трубки */
  lineRadius?: number;
  /** Вылет выносных линий за размерную линию */
  extensionOverhang?: number;
  /** Масштаб размерных стрелок */
  arrowScale?: number;
}

/**
 * Создает текстуру бейджа с размерным числом по ГОСТ
 */
export function createGostDimensionCanvasTexture(
  valueText: string,
  subText?: string,
  badgeTitle?: string,
  accentColor: string = '#06b6d4',
  bgColor: string = 'rgba(15, 23, 42, 0.92)'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 140;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Очистка
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Свечение и тень подложки
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // Плашка-контейнер
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(12, 12, 488, 116, 16);
    ctx.fill();

    // Сброс тени для четких линий
    ctx.shadowBlur = 0;

    // Двойная рамка в инженерном стиле
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(16, 16, 480, 108, 12);
    ctx.stroke();

    // Заголовок бейджа (если есть)
    let textCenterY = 70;
    if (badgeTitle && subText) {
      // 3 строки
      ctx.fillStyle = accentColor;
      ctx.font = 'bold 16px "SF Mono", "Segoe UI Mono", "Roboto Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeTitle.toUpperCase(), 256, 34);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(valueText, 256, 68);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 18px system-ui, -apple-system, sans-serif';
      ctx.fillText(subText, 256, 100);
    } else if (subText) {
      // 2 строки: Значение + пояснение
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(valueText, 256, 54);

      ctx.fillStyle = accentColor;
      ctx.font = 'bold 20px "SF Mono", "Segoe UI Mono", "Roboto Mono", monospace';
      ctx.fillText(subText, 256, 94);
    } else {
      // 1 строка: крупное значение
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(valueText, 256, textCenterY);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Создает 3D размерную стрелку по ГОСТ 2.307 (угол ~20°, острый вытянутый конус)
 */
export function createGostArrowMesh(
  color: number,
  direction: 'left' | 'right',
  scale: number = 1.0
): THREE.Group {
  const arrowGroup = new THREE.Group();

  const arrowLength = 1.1 * scale;
  const arrowRadius = 0.22 * scale;

  const arrowMat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.65,
    roughness: 0.2,
    metalness: 0.8,
    side: THREE.DoubleSide,
  });

  const coneGeom = new THREE.ConeGeometry(arrowRadius, arrowLength, 16);
  const coneMesh = new THREE.Mesh(coneGeom, arrowMat);

  // Поворачиваем конус вдоль оси X
  if (direction === 'left') {
    // Острие направлено влево (-X), вершина в X = 0
    coneMesh.rotation.z = Math.PI / 2;
    coneMesh.position.set(arrowLength / 2, 0, 0);
  } else {
    // Острие направлено вправо (+X), вершина в X = 0
    coneMesh.rotation.z = -Math.PI / 2;
    coneMesh.position.set(-arrowLength / 2, 0, 0);
  }

  arrowGroup.add(coneMesh);

  return arrowGroup;
}

/**
 * Строит полную ГОСТ-размерную цепочку в 3D:
 * 1. Выносные линии от объекта к размерной линии с вылетом (overhang).
 * 2. Размерная линия параллельно объекту (сплошная трубка + яркая линия).
 * 3. Размерные стрелки по ГОСТ на обоих концах.
 * 4. Четкое яркое размерное число в центре (Billboard Sprite).
 */
export function createGostDimension3D(options: GostDimension3DOptions): THREE.Group {
  const {
    startX,
    endX,
    dimY,
    dimZ,
    featureY,
    featureZ,
    valueText,
    subText,
    badgeTitle,
    color = 0x06b6d4,
    accentColor = '#06b6d4',
    bgColor = 'rgba(15, 23, 42, 0.92)',
    lineRadius = 0.035,
    extensionOverhang = 1.0,
    arrowScale = 1.0,
  } = options;

  const group = new THREE.Group();

  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const spanX = Math.max(0.01, maxX - minX);
  const midX = (minX + maxX) / 2;

  const lineMat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.5,
    roughness: 0.3,
    metalness: 0.7,
  });

  const extLineMat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.6,
    transparent: true,
    opacity: 0.85,
  });

  // 1. ВЫНОСНЫЕ ЛИНИИ (Extension Lines по ГОСТ)
  // Левая выносная линия: от (minX, featureY, featureZ) через (minX, dimY, dimZ) с вылетом
  const zSign = dimZ >= featureZ ? 1 : -1;
  const extTargetZ = dimZ + zSign * extensionOverhang;

  // Левая выносная линия
  const extLeftPts = [
    new THREE.Vector3(minX, featureY, featureZ),
    new THREE.Vector3(minX, dimY, extTargetZ),
  ];
  const extLeftGeom = new THREE.BufferGeometry().setFromPoints(extLeftPts);
  const extLeftLine = new THREE.Line(extLeftGeom, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
  group.add(extLeftLine);

  // Тонкий цилиндр для объема левой выносной линии
  const extLeftLen = extLeftPts[0].distanceTo(extLeftPts[1]);
  if (extLeftLen > 0.01) {
    const extCylGeom = new THREE.CylinderGeometry(lineRadius * 0.7, lineRadius * 0.7, extLeftLen, 8);
    const extCylMesh = new THREE.Mesh(extCylGeom, extLineMat);
    extCylMesh.position.copy(extLeftPts[0]).add(extLeftPts[1]).multiplyScalar(0.5);
    extCylMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      extLeftPts[1].clone().sub(extLeftPts[0]).normalize()
    );
    group.add(extCylMesh);
  }

  // Правая выносная линия
  const extRightPts = [
    new THREE.Vector3(maxX, featureY, featureZ),
    new THREE.Vector3(maxX, dimY, extTargetZ),
  ];
  const extRightGeom = new THREE.BufferGeometry().setFromPoints(extRightPts);
  const extRightLine = new THREE.Line(extRightGeom, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
  group.add(extRightLine);

  // Тонкий цилиндр для объема правой выносной линии
  const extRightLen = extRightPts[0].distanceTo(extRightPts[1]);
  if (extRightLen > 0.01) {
    const extCylGeom = new THREE.CylinderGeometry(lineRadius * 0.7, lineRadius * 0.7, extRightLen, 8);
    const extCylMesh = new THREE.Mesh(extCylGeom, extLineMat);
    extCylMesh.position.copy(extRightPts[0]).add(extRightPts[1]).multiplyScalar(0.5);
    extCylMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      extRightPts[1].clone().sub(extRightPts[0]).normalize()
    );
    group.add(extCylMesh);
  }

  // 2. РАЗМЕРНАЯ ЛИНИЯ (Dimension Line)
  // Цилиндрический стержень размерной линии
  const dimLineGeom = new THREE.CylinderGeometry(lineRadius, lineRadius, spanX, 8);
  const dimLineMesh = new THREE.Mesh(dimLineGeom, lineMat);
  dimLineMesh.rotation.z = Math.PI / 2;
  dimLineMesh.position.set(midX, dimY, dimZ);
  group.add(dimLineMesh);

  // 3. РАЗМЕРНЫЕ СТРЕЛКИ ПО ГОСТ (Arrowheads)
  // Левая стрелка: острие касается левой выносной линии в точке (minX, dimY, dimZ)
  const leftArrow = createGostArrowMesh(color, 'left', arrowScale);
  leftArrow.position.set(minX, dimY, dimZ);
  group.add(leftArrow);

  // Правая стрелка: острие касается правой выносной линии в точке (maxX, dimY, dimZ)
  const rightArrow = createGostArrowMesh(color, 'right', arrowScale);
  rightArrow.position.set(maxX, dimY, dimZ);
  group.add(rightArrow);

  // Опорные точки на концах (маленькие шарики-маркеры в точке касания)
  const dotGeom = new THREE.SphereGeometry(lineRadius * 1.5, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color });
  const leftDot = new THREE.Mesh(dotGeom, dotMat);
  leftDot.position.set(minX, dimY, dimZ);
  group.add(leftDot);

  const rightDot = new THREE.Mesh(dotGeom, dotMat);
  rightDot.position.set(maxX, dimY, dimZ);
  group.add(rightDot);

  // 4. РАЗМЕРНОЕ ЧИСЛО В ЦЕНТРЕ (Billboard Sprite)
  const texture = createGostDimensionCanvasTexture(valueText, subText, badgeTitle, accentColor, bgColor);
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);

  // Адаптивный размер спрайта
  const spriteWidth = Math.min(8.0, Math.max(3.6, spanX * 0.45));
  const spriteHeight = spriteWidth * (140 / 512);
  sprite.scale.set(spriteWidth, spriteHeight, 1);

  // Позиционируем спрайт по центру размерной линии
  sprite.position.set(midX, dimY + spriteHeight * 0.45 + 0.15, dimZ);
  sprite.renderOrder = 998;
  group.add(sprite);

  return group;
}
