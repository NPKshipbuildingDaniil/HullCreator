/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/App.tsx
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Главная точка входа и координатор приложения «3D Брус - Редактор».
 * Управляет жизненным циклом 3D-сцены Three.js, анимационным циклом (Render Loop),
 * освещением, тенями, адаптивной камерой (OrbitControls), динамической сеткой пространства,
 * а также связывает глобальное реактивное состояние параметров с визуальным UI-слоем и геометрическим движком.
 * 
 * 📦 СОСТАВ ХРАНИМОЙ ИНФОРМАЦИИ И ЛОГИКИ:
 * 1. Состояние приложения:
 *    - `params`: реактивные параметры бруса (длина, ширина, высота, осадка, радиус, развал, килеватость, цвета).
 *    - `theme`: выбранный визуальный стиль интерфейса ('minimalism' | 'scandinavian' | 'industrial').
 *    - `bowLength`: длина носовой оконечности.
 *    - `showWireframe`, `showGrid`, `autoRotate`: флаги отображения сетки, координатного пространства и автовращения.
 *    - `isGeometryModalOpen`, `isBowModalOpen`: состояния открытия модальных окон.
 * 
 * 2. 3D Сцена Three.js:
 *    - Настройка направленного и рассеянного света со сглаженными тенями (Shadow Map).
 *    - Настройка координатной сетки пола (GridHelper), адаптирующейся под `gridSize`.
 *    - Генерация и обновление параметрической 3D-модели бруса через `createHollowBrus`.
 *    - Построение линии ватерлинии (Draft Line) через `createDraftLineMesh`.
 *    - Построение полупрозрачного параллелепипеда носовой части.
 *    - Обработка изменения размеров окна браузера (ResizeObserver / window resize).
 * ====================================================================================================
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BrusParams,
  ThemeStyle,
  DRAFT_COLORS,
  BowParameters,
  TopologyQAStats,
  SurfaceRenderMode,
} from './core/types';
import { WireframeDisplayOptions, BowVolumeParameters } from './core/topologyTypes';
import {
  createSplitHollowBrus,
  getCrossSectionContour3D,
  getCrossSectionHalfBranches3D,
  createContourTubeMesh,
  calculateVerticalLevels,
} from './core/geometryEngine';
import { GasCutEffect } from './core/sparkEffect';
import {
  ControlPanel,
  GeometryBottomBar,
  BowBottomBar,
} from './core/uiComponents';
import { STEM_PARAM_AXIS_MAP } from './core/stemUiComponents';
import { StemOverlayLabels } from './core/stemOverlayLabels';
import {
  ShipHullTopologyEngine,
  computeBowDeckWaterlinePoint,
  calculateBowWaterplaneCoeff,
} from './core/topologyEngine';
import { createGostDimension3D } from './core/dimension3D';
import {
  StemPointKey,
  StemTopologyPoints,
  StemProfileParams,
  DEFAULT_STEM_PARAMS,
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  sampleStemCurveZones,
  getStemControlPolygon,
  getStemXAtZ,
  STEM_ZONES,
} from './core/stemEngine';
import {
  generateWaterlineFamily3D,
  createWaterlineWireframeGroup,
  evaluateWaterlineCurve,
  extractBowVolumeParams,
  getTheoreticalMidshipHalfBreadthAtZ,
} from './core/waterlineEngine';
import {
  BowSectionKey,
  BowSectionTopology,
  calculateBowSectionTopology,
  createBowSection3DGroup,
} from './core/bowSectionEngine';
import { createZebraStripesMaterial, createCurvatureMaterial } from './core/zebraShader';
import { TowingTankController, TowingTankVisualOptions } from './core/towingTankEngine';
import { TowingTankUi } from './core/towingTankUi';
import { HydroTelemetry, computeHydrodynamics } from './core/hydroEngine';
import { createBernoulliPressureMaterial } from './core/towingTankShaders';
import { generateBSplineCompositeGeometry } from './core/controlNetBuilder';
import { ShipLogoIntro, AboutModal } from './core/Logo';
import { LeftSidebar, LeftNavTab } from './core/LeftSidebar';

type BowEditStepType = 'none' | 'length' | 'deck' | 'stem' | 'volume' | 'shaping' | 'framework' | 'towing_tank' | 'surface';
type EditAnimState = 'idle' | 'cutting' | 'separating' | 'editing' | 'reversing' | 'welding' | 'fading';

function createTextSprite(text: string, subtext?: string, isSelected: boolean = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 110;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (isSelected) {
      // Изысканный нежный пастельный фон (Soft Pastel Ice Ivory / Slate Mist)
      ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(248, 250, 252, 0.97)'; // Пастельный чистый светлый фон
      ctx.beginPath();
      ctx.roundRect(8, 8, 424, 94, 16);
      ctx.fill();

      // Мягкая пастельная акцентная рамка
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#38bdf8'; // Нежно-голубой пастельный контур
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Главный заголовок: глубокий темно-графитовый цвет для превосходной читаемости
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 23px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 220, subtext ? 40 : 55);

      if (subtext) {
        ctx.font = 'bold 18px monospace';
        ctx.fillStyle = '#0284c7'; // Пастельно-лазурный акцент
        ctx.fillText(subtext, 220, 74);
      }
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(241, 245, 249, 0.90)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 424, 94, 16);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 23px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 220, subtext ? 40 : 55);

      if (subtext) {
        ctx.font = 'bold 17px monospace';
        ctx.fillStyle = '#64748b';
        ctx.fillText(subtext, 220, 74);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.0, 0.75, 1);
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * Создание стильной плавающей 3D-плашки со словами над линиями и областями корпуса
 */
function createFloatingCalloutBadge(
  title: string,
  subtitle?: string,
  accentColor: string = '#06b6d4'
) {
  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 110;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Подложка (CAD Glassmorphism Arctic)
    ctx.fillStyle = 'rgba(11, 19, 43, 0.92)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 424, 94, 20);
    ctx.fill();

    // Обводка с акцентным цветом линии
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Цветной светящийся маркер слева
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.arc(38, 55, 11, 0, Math.PI * 2);
    ctx.fill();

    // Кольцо вокруг маркера
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Заголовок
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 66, subtitle ? 40 : 55);

    // Подзаголовок
    if (subtitle) {
      ctx.font = '600 18px monospace';
      ctx.fillStyle = accentColor;
      ctx.fillText(subtitle, 66, 73);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.0, 0.75, 1);
  sprite.renderOrder = 9999;
  return sprite;
}

/**
 * Тонкая световая выносная линия от 3D-кривой к плавающей плашке
 */
function createCalloutLeaderLine(
  startPos: THREE.Vector3,
  endPos: THREE.Vector3,
  colorHex: number = 0x06b6d4
) {
  const geom = new THREE.BufferGeometry().setFromPoints([startPos, endPos]);
  const mat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  });
  const line = new THREE.Line(geom, mat);
  line.renderOrder = 9998;
  return line;
}

function create3DTransformGizmo(pointIndex: number, pos: THREE.Vector3) {
  const gizmoGroup = new THREE.Group();
  gizmoGroup.position.copy(pos);
  gizmoGroup.userData = { isGizmoRoot: true, pointIndex };

  const arrowLength = 2.4;
  const cylRadius = 0.08;
  const coneRadius = 0.22;
  const coneHeight = 0.55;

  // 1. Стрелка вдоль оси X (+X / -X Продольно) - для всех точек P0, P1, P2, P3
  {
    const xGroup = new THREE.Group();
    xGroup.userData = { isGizmo: true, axis: 'x', pointIndex };

    const xMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Красный
      emissive: 0xef4444,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8,
    });

    const xCylGeom = new THREE.CylinderGeometry(cylRadius, cylRadius, arrowLength, 16);
    const xCylMesh = new THREE.Mesh(xCylGeom, xMat);
    xCylMesh.rotation.z = -Math.PI / 2;
    xCylMesh.userData = { isGizmo: true, axis: 'x', pointIndex };
    xGroup.add(xCylMesh);

    // Конус на положительном конце (+X к форштевню)
    const xConeGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
    const xConeMeshPlus = new THREE.Mesh(xConeGeom, xMat);
    xConeMeshPlus.rotation.z = -Math.PI / 2;
    xConeMeshPlus.position.set(arrowLength / 2 + coneHeight / 2, 0, 0);
    xConeMeshPlus.userData = { isGizmo: true, axis: 'x', pointIndex };
    xGroup.add(xConeMeshPlus);

    // Конус на отрицательном конце (-X к миделю)
    const xConeMeshMinus = new THREE.Mesh(xConeGeom, xMat);
    xConeMeshMinus.rotation.z = Math.PI / 2;
    xConeMeshMinus.position.set(-arrowLength / 2 - coneHeight / 2, 0, 0);
    xConeMeshMinus.userData = { isGizmo: true, axis: 'x', pointIndex };
    xGroup.add(xConeMeshMinus);

    // Невидимый хитбокс для стрелки X
    const xHitGeom = new THREE.CylinderGeometry(0.5, 0.5, arrowLength + coneHeight * 2, 8);
    const xHitMesh = new THREE.Mesh(xHitGeom, new THREE.MeshBasicMaterial({ visible: false }));
    xHitMesh.rotation.z = -Math.PI / 2;
    xHitMesh.userData = { isGizmo: true, axis: 'x', pointIndex };
    xGroup.add(xHitMesh);

    gizmoGroup.add(xGroup);
  }

  // 2. Стрелка вдоль оси Z (+Z / -Z Поперечно в сторону) - только для P0, P1, P2 (P3 строго зафиксирована по ширине)
  if (pointIndex !== 3) {
    const zGroup = new THREE.Group();
    zGroup.userData = { isGizmo: true, axis: 'z', pointIndex };

    const zMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4, // Циановый
      emissive: 0x06b6d4,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8,
    });

    const zCylGeom = new THREE.CylinderGeometry(cylRadius, cylRadius, arrowLength, 16);
    const zCylMesh = new THREE.Mesh(zCylGeom, zMat);
    zCylMesh.rotation.x = Math.PI / 2;
    zCylMesh.userData = { isGizmo: true, axis: 'z', pointIndex };
    zGroup.add(zCylMesh);

    // Конус на положительном конце (+Z к борту)
    const zConeGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
    const zConeMeshPlus = new THREE.Mesh(zConeGeom, zMat);
    zConeMeshPlus.rotation.x = Math.PI / 2;
    zConeMeshPlus.position.set(0, 0, arrowLength / 2 + coneHeight / 2);
    zConeMeshPlus.userData = { isGizmo: true, axis: 'z', pointIndex };
    zGroup.add(zConeMeshPlus);

    // Конус на отрицательном конце (-Z к ДП)
    const zConeMeshMinus = new THREE.Mesh(zConeGeom, zMat);
    zConeMeshMinus.rotation.x = -Math.PI / 2;
    zConeMeshMinus.position.set(0, 0, -arrowLength / 2 - coneHeight / 2);
    zConeMeshMinus.userData = { isGizmo: true, axis: 'z', pointIndex };
    zGroup.add(zConeMeshMinus);

    // Невидимый хитбокс для стрелки Z
    const zHitGeom = new THREE.CylinderGeometry(0.5, 0.5, arrowLength + coneHeight * 2, 8);
    const zHitMesh = new THREE.Mesh(zHitGeom, new THREE.MeshBasicMaterial({ visible: false }));
    zHitMesh.rotation.x = Math.PI / 2;
    zHitMesh.userData = { isGizmo: true, axis: 'z', pointIndex };
    zGroup.add(zHitMesh);

    gizmoGroup.add(zGroup);
  }

  // 3. Плоскостной манипулятор (XZ Plane Handle) - для P0, P1 и P2
  if (pointIndex === 0 || pointIndex === 1 || pointIndex === 2) {
    const planeGroup = new THREE.Group();
    planeGroup.userData = { isGizmo: true, axis: 'both', pointIndex };

    const planeSize = 1.2;
    const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const planeMesh = new THREE.Mesh(planeGeom, planeMat);
    planeMesh.rotation.x = -Math.PI / 2;
    planeMesh.position.set(planeSize / 2 + 0.15, 0, planeSize / 2 + 0.15);
    planeMesh.userData = { isGizmo: true, axis: 'both', pointIndex };
    planeGroup.add(planeMesh);

    // Рамка вокруг плоскости
    const planeEdges = new THREE.EdgesGeometry(planeGeom);
    const planeLineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const planeLines = new THREE.LineSegments(planeEdges, planeLineMat);
    planeLines.rotation.x = -Math.PI / 2;
    planeLines.position.set(planeSize / 2 + 0.15, 0, planeSize / 2 + 0.15);
    planeGroup.add(planeLines);

    gizmoGroup.add(planeGroup);
  }

  // 4. Двойное кольцо вокруг активной сферы
  const ringGeom = new THREE.RingGeometry(0.55, 0.68, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  ringMesh.rotation.x = Math.PI / 2;
  gizmoGroup.add(ringMesh);

  return gizmoGroup;
}

function createTrajectoryAndLimitsMesh(
  key: StemPointKey,
  pos: THREE.Vector3,
  stemPts: StemTopologyPoints,
  xStem: number,
  keelY: number,
  safeDraft: number,
  totalHeight: number,
  effectiveBowLen: number,
  allowedAxes: 'x' | 'y' | 'both' | 'rotation' | 'none' = 'both'
): THREE.Group {
  const group = new THREE.Group();
  if (allowedAxes === 'none') return group;

  const redMat = new THREE.LineDashedMaterial({
    color: 0xef4444,
    dashSize: 0.35,
    gapSize: 0.20,
    linewidth: 2.5,
    transparent: true,
    opacity: 0.95,
  });
  const limitGeom = new THREE.SphereGeometry(0.09, 14, 14);
  const limitMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

  const addDashedLine = (p1: THREE.Vector3, p2: THREE.Vector3) => {
    const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(geom, redMat);
    line.computeLineDistances();
    group.add(line);

    // Концевые лимитные точки красного цвета
    const s1 = new THREE.Mesh(limitGeom, limitMat);
    s1.position.copy(p1);
    group.add(s1);

    const s2 = new THREE.Mesh(limitGeom, limitMat);
    s2.position.copy(p2);
    group.add(s2);
  };

  const showX = allowedAxes === 'x' || allowedAxes === 'both';
  const showY = allowedAxes === 'y' || allowedAxes === 'both';
  const showRot = allowedAxes === 'rotation';

  if (key === 'PT_STEM_DECK') {
    // Лимит вылета палубы по горизонтали [-3м .. +10м]
    if (showX) {
      addDashedLine(
        new THREE.Vector3(xStem - 3.0, pos.y, 0),
        new THREE.Vector3(xStem + 10.0, pos.y, 0)
      );
    }
    // Лимит высоты палубы по вертикали [-3м .. +5м]
    if (showY) {
      addDashedLine(
        new THREE.Vector3(pos.x, keelY + safeDraft + 0.2, 0),
        new THREE.Vector3(pos.x, keelY + totalHeight + 5.0, 0)
      );
    }
  } else if (key === 'PT_STEM_KNUCKLE') {
    // Лимит выноса кнакла [-5м .. +5м]
    if (showX) {
      addDashedLine(
        new THREE.Vector3(pos.x - 5.0, pos.y, 0),
        new THREE.Vector3(pos.x + 5.0, pos.y, 0)
      );
    }
    // Лимит высоты кнакла [0.05 .. 0.95]
    if (showY) {
      addDashedLine(
        new THREE.Vector3(pos.x, keelY + safeDraft + 0.15, 0),
        new THREE.Vector3(pos.x, keelY + totalHeight - 0.2, 0)
      );
    }
  } else if (key === 'PT_BULB_APEX') {
    // Лимит длины бульба по горизонтали [-10м .. +15м]
    if (showX) {
      addDashedLine(
        new THREE.Vector3(xStem - 10.0, pos.y, 0),
        new THREE.Vector3(xStem + 15.0, pos.y, 0)
      );
    }
    // Лимит высоты носка бульба по вертикали [0.1 .. 0.95] * draft
    if (showY) {
      addDashedLine(
        new THREE.Vector3(pos.x, keelY + safeDraft * 0.10, 0),
        new THREE.Vector3(pos.x, keelY + safeDraft * 0.95, 0)
      );
    }
  } else if (key === 'PT_FOREFOOT') {
    // Лимит радиуса пятки по горизонтали [0 .. 15м]
    if (showX) {
      addDashedLine(
        new THREE.Vector3(xStem - 15.0, pos.y, 0),
        new THREE.Vector3(xStem + stemPts.PT_BULB_APEX.x, pos.y, 0)
      );
    }
    // Лимит высоты пятки по вертикали [0 .. 0.85] * draft
    if (showY) {
      addDashedLine(
        new THREE.Vector3(pos.x, keelY, 0),
        new THREE.Vector3(pos.x, keelY + safeDraft * 0.85, 0)
      );
    }
  } else if (key === 'PT_KEEL_TANGENT') {
    // Лимит сопряжения с килем по горизонтали [1м .. effectiveBowLen]
    if (showX) {
      addDashedLine(
        new THREE.Vector3(xStem - effectiveBowLen, keelY, 0),
        new THREE.Vector3(xStem + stemPts.PT_FOREFOOT.x - 0.2, keelY, 0)
      );
    }
  } else if (key.startsWith('CTRL_STEM_') && showRot) {
    // Дуговой лимит поворота касательной: красный дуговой сектор стоит НЕПОДВИЖНО в якорной точке,
    // в то время как фиолетовый элемент (контрольная точка и манипулятор) вращается по дуге
    let anchorPos: THREE.Vector3;
    let minAngleRad = (-60 * Math.PI) / 180;
    let maxAngleRad = (85 * Math.PI) / 180;
    let isUpper = false;

    if (key === 'CTRL_STEM_UPPER') {
      anchorPos = new THREE.Vector3(xStem + stemPts.PT_STEM_DECK.x, keelY + stemPts.PT_STEM_DECK.z, 0);
      minAngleRad = (-45 * Math.PI) / 180;
      maxAngleRad = (80 * Math.PI) / 180;
      isUpper = true;
    } else if (key === 'CTRL_STEM_BULB_UPPER') {
      anchorPos = new THREE.Vector3(xStem + stemPts.PT_BULB_APEX.x, keelY + stemPts.PT_BULB_APEX.z, 0);
      minAngleRad = (15 * Math.PI) / 180;
      maxAngleRad = (85 * Math.PI) / 180;
    } else {
      // CTRL_STEM_BULB_LOWER
      anchorPos = new THREE.Vector3(xStem + stemPts.PT_BULB_APEX.x, keelY + stemPts.PT_BULB_APEX.z, 0);
      minAngleRad = (15 * Math.PI) / 180;
      maxAngleRad = (85 * Math.PI) / 180;
    }

    const radius = Math.max(0.4, Math.hypot(pos.x - anchorPos.x, pos.y - anchorPos.y));
    const arcPts: THREE.Vector3[] = [];
    const steps = 36;
    for (let i = 0; i <= steps; i++) {
      const a = minAngleRad + (i / steps) * (maxAngleRad - minAngleRad);
      let px: number;
      let py: number;
      if (isUpper) {
        px = anchorPos.x - radius * Math.sin(a);
        py = anchorPos.y - radius * Math.cos(a);
      } else {
        px = anchorPos.x + radius * Math.sin(a);
        py = anchorPos.y + (key === 'CTRL_STEM_BULB_UPPER' ? radius * Math.cos(a) : -radius * Math.cos(a));
      }
      arcPts.push(new THREE.Vector3(px, py, 0));
    }
    const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPts);
    const arcLine = new THREE.Line(arcGeom, redMat);
    arcLine.computeLineDistances();
    group.add(arcLine);

    // Концевые красные лимитные сферы
    const s1 = new THREE.Mesh(limitGeom, limitMat);
    s1.position.copy(arcPts[0]);
    group.add(s1);

    const s2 = new THREE.Mesh(limitGeom, limitMat);
    s2.position.copy(arcPts[arcPts.length - 1]);
    group.add(s2);

    // Тонкий фиолетовый рычаг-касательная от неподвижного якоря к подвижной контрольной точке
    const leverGeom = new THREE.BufferGeometry().setFromPoints([anchorPos, pos]);
    const leverMat = new THREE.LineBasicMaterial({
      color: 0xc084fc,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.85,
    });
    group.add(new THREE.Line(leverGeom, leverMat));
  }

  return group;
}

function create3DStemTransformGizmo(
  key: StemPointKey,
  pos: THREE.Vector3,
  currentAngle?: number,
  allowedAxes: 'x' | 'y' | 'both' | 'rotation' | 'none' = 'both'
) {
  const gizmoGroup = new THREE.Group();
  gizmoGroup.position.copy(pos);
  gizmoGroup.userData = { isStemGizmoRoot: true, stemKey: key };

  if (allowedAxes === 'none') {
    // Кольцо вокруг активной точки форштевня в плоскости ДП
    const ringGeom = new THREE.RingGeometry(0.45, 0.58, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    gizmoGroup.add(ringMesh);
    return gizmoGroup;
  }

  // Если это точка касательной (CTRL_STEM_UPPER, CTRL_STEM_BULB_UPPER, CTRL_STEM_BULB_LOWER) — создаем ротационный манипулятор (две закручивающиеся стрелки)
  if (allowedAxes === 'rotation' || key === 'CTRL_STEM_UPPER' || key === 'CTRL_STEM_BULB_UPPER' || key === 'CTRL_STEM_BULB_LOWER') {
    const rotGroup = new THREE.Group();
    rotGroup.userData = { isStemGizmo: true, isRotationGizmo: true, axis: 'rotation', stemKey: key };

    const rotMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc, // Фиолетово-пурпурный
      emissive: 0xa855f7,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.7,
      side: THREE.DoubleSide,
    });

    const radius = 0.65;
    const tubeRadius = 0.045;
    const coneRadius = 0.12;
    const coneHeight = 0.28;

    // Дуга 1 (Верхняя половина: от 0.15*PI до 0.85*PI)
    const arc1Geom = new THREE.TorusGeometry(radius, tubeRadius, 16, 32, Math.PI * 0.70);
    const arc1Mesh = new THREE.Mesh(arc1Geom, rotMat);
    arc1Mesh.rotation.z = Math.PI * 0.15;
    arc1Mesh.userData = { isStemGizmo: true, isRotationGizmo: true, axis: 'rotation', stemKey: key };
    rotGroup.add(arc1Mesh);

    // Стрелка/конус на конце Дуги 1 (строго по касательной к дуге)
    const a1 = Math.PI * 0.85;
    const tip1Pos = new THREE.Vector3(radius * Math.cos(a1), radius * Math.sin(a1), 0);
    const cone1Geom = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
    cone1Geom.translate(0, coneHeight / 2, 0);
    const cone1Mesh = new THREE.Mesh(cone1Geom, rotMat);
    cone1Mesh.position.copy(tip1Pos);
    cone1Mesh.rotation.z = a1; // Строго по касательной к окружности
    cone1Mesh.userData = { isStemGizmo: true, isRotationGizmo: true, axis: 'rotation', stemKey: key };
    rotGroup.add(cone1Mesh);

    // Дуга 2 (Нижняя половина: от 1.15*PI до 1.85*PI)
    const arc2Geom = new THREE.TorusGeometry(radius, tubeRadius, 16, 32, Math.PI * 0.70);
    const arc2Mesh = new THREE.Mesh(arc2Geom, rotMat);
    arc2Mesh.rotation.z = Math.PI * 1.15;
    arc2Mesh.userData = { isStemGizmo: true, isRotationGizmo: true, axis: 'rotation', stemKey: key };
    rotGroup.add(arc2Mesh);

    // Стрелка/конус на конце Дуги 2 (строго по касательной к дуге)
    const a2 = Math.PI * 1.85;
    const tip2Pos = new THREE.Vector3(radius * Math.cos(a2), radius * Math.sin(a2), 0);
    const cone2Geom = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
    cone2Geom.translate(0, coneHeight / 2, 0);
    const cone2Mesh = new THREE.Mesh(cone2Geom, rotMat);
    cone2Mesh.position.copy(tip2Pos);
    cone2Mesh.rotation.z = a2; // Строго по касательной к окружности
    cone2Mesh.userData = { isStemGizmo: true, isRotationGizmo: true, axis: 'rotation', stemKey: key };
    rotGroup.add(cone2Mesh);

    // Центральное светящееся кольцо
    const centerRingGeom = new THREE.RingGeometry(0.12, 0.18, 32);
    const centerRingMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const centerRing = new THREE.Mesh(centerRingGeom, centerRingMat);
    rotGroup.add(centerRing);

    // Широкий невидимый хит-бокс (кольцо-диск) для мгновенного и надежного захвата клика, вращения мышью и колесика
    const hitDiskGeom = new THREE.RingGeometry(0.02, radius + 0.40, 32);
    const hitDiskMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hitDisk = new THREE.Mesh(hitDiskGeom, hitDiskMat);
    hitDisk.userData = { isStemGizmo: true, isRotationGizmo: true, axis: 'rotation', stemKey: key };
    rotGroup.add(hitDisk);

    gizmoGroup.add(rotGroup);
    return gizmoGroup;
  }

  const arrowLength = 2.4;
  const cylRadius = 0.075;
  const coneRadius = 0.22;
  const coneHeight = 0.55;
  const coneGeom = new THREE.ConeGeometry(coneRadius, coneHeight, 16);

  // 1. Стрелка вдоль оси X (Красная: Продольно вперед/назад вдоль корабля)
  if (allowedAxes === 'x' || allowedAxes === 'both') {
    const xGroup = new THREE.Group();
    xGroup.userData = { isStemGizmo: true, axis: 'x', stemKey: key };

    const xMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Красный
      emissive: 0xef4444,
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.8,
    });

    const xCylGeom = new THREE.CylinderGeometry(cylRadius, cylRadius, arrowLength, 16);
    const xCylMesh = new THREE.Mesh(xCylGeom, xMat);
    xCylMesh.rotation.z = -Math.PI / 2;
    xCylMesh.userData = { isStemGizmo: true, axis: 'x', stemKey: key };
    xGroup.add(xCylMesh);

    // Конус +X
    const xConeMeshPlus = new THREE.Mesh(coneGeom, xMat);
    xConeMeshPlus.rotation.z = -Math.PI / 2;
    xConeMeshPlus.position.set(arrowLength / 2 + coneHeight / 2, 0, 0);
    xConeMeshPlus.userData = { isStemGizmo: true, axis: 'x', stemKey: key };
    xGroup.add(xConeMeshPlus);

    // Конус -X
    const xConeMeshMinus = new THREE.Mesh(coneGeom, xMat);
    xConeMeshMinus.rotation.z = Math.PI / 2;
    xConeMeshMinus.position.set(-arrowLength / 2 - coneHeight / 2, 0, 0);
    xConeMeshMinus.userData = { isStemGizmo: true, axis: 'x', stemKey: key };
    xGroup.add(xConeMeshMinus);

    // Хитбокс X
    const xHitGeom = new THREE.CylinderGeometry(0.45, 0.45, arrowLength + coneHeight * 2, 8);
    const xHitMesh = new THREE.Mesh(xHitGeom, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false }));
    xHitMesh.rotation.z = -Math.PI / 2;
    xHitMesh.userData = { isStemGizmo: true, axis: 'x', stemKey: key };
    xGroup.add(xHitMesh);

    gizmoGroup.add(xGroup);
  }

  // 2. Стрелка вдоль оси Y в 3D (Зеленая: По высоте Z_ship вверх/вниз)
  // Для линии киля (PT_KEEL_TANGENT) стрелка вверх отсутствует — перемещение строго по Z=0
  if ((allowedAxes === 'y' || allowedAxes === 'both') && key !== 'PT_KEEL_TANGENT') {
    const yGroup = new THREE.Group();
    yGroup.userData = { isStemGizmo: true, axis: 'y', stemKey: key };

    const yMat = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Изумрудный / Зеленый
      emissive: 0x10b981,
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.8,
    });

    const yCylGeom = new THREE.CylinderGeometry(cylRadius, cylRadius, arrowLength, 16);
    const yCylMesh = new THREE.Mesh(yCylGeom, yMat);
    yCylMesh.userData = { isStemGizmo: true, axis: 'y', stemKey: key };
    yGroup.add(yCylMesh);

    // Конус +Y (Вверх)
    const yConeMeshPlus = new THREE.Mesh(coneGeom, yMat);
    yConeMeshPlus.position.set(0, arrowLength / 2 + coneHeight / 2, 0);
    yConeMeshPlus.userData = { isStemGizmo: true, axis: 'y', stemKey: key };
    yGroup.add(yConeMeshPlus);

    // Конус -Y (Вниз)
    const yConeMeshMinus = new THREE.Mesh(coneGeom, yMat);
    yConeMeshMinus.rotation.x = Math.PI;
    yConeMeshMinus.position.set(0, -arrowLength / 2 - coneHeight / 2, 0);
    yConeMeshMinus.userData = { isStemGizmo: true, axis: 'y', stemKey: key };
    yGroup.add(yConeMeshMinus);

    // Хитбокс Y
    const yHitGeom = new THREE.CylinderGeometry(0.45, 0.45, arrowLength + coneHeight * 2, 8);
    const yHitMesh = new THREE.Mesh(yHitGeom, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false }));
    yHitMesh.userData = { isStemGizmo: true, axis: 'y', stemKey: key };
    yGroup.add(yHitMesh);

    gizmoGroup.add(yGroup);

    // 3. Плоскостной манипулятор в ДП (XY Plane Handle)
    if (allowedAxes === 'both') {
      const planeGroup = new THREE.Group();
      planeGroup.userData = { isStemGizmo: true, axis: 'both', stemKey: key };
      const planeSize = 1.1;
      const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      });
      const planeMesh = new THREE.Mesh(planeGeom, planeMat);
      planeMesh.position.set(planeSize / 2 + 0.15, planeSize / 2 + 0.15, 0);
      planeMesh.userData = { isStemGizmo: true, axis: 'both', stemKey: key };
      planeGroup.add(planeMesh);

      const planeEdges = new THREE.EdgesGeometry(planeGeom);
      const planeLineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
      const planeLines = new THREE.LineSegments(planeEdges, planeLineMat);
      planeLines.position.set(planeSize / 2 + 0.15, planeSize / 2 + 0.15, 0);
      planeGroup.add(planeLines);

      gizmoGroup.add(planeGroup);
    }
  }

  // 4. Кольцо вокруг активной точки форштевня в плоскости ДП
  const ringGeom = new THREE.RingGeometry(0.45, 0.58, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  gizmoGroup.add(ringMesh);

  return gizmoGroup;
}

export const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Глобальное реактивное состояние параметров бруса
  const [params, setParams] = useState<BrusParams>({
    length: 120.75,
    width: 17.80,
    height: 9.0,
    draft: 4.5,
    draftColorIndex: 0,
    radius: 0,
    flare: 0,
    deadrise: 0,
    deadriseInHeight: false,
    deckCamber: 0,
    deckCamberInHeight: false,
    sheerRadius: 0,
    showDeckCover: false,
    gridSize: 10,
    brusColor: 0xd0d0d0,
  });

  // Дополнительные параметры и UI-флаги
  const [theme, setTheme] = useState<ThemeStyle>('minimalism');
  const [hasBowApplied, setHasBowApplied] = useState<boolean>(false);
  const [bowLength, setBowLength] = useState<number>(0);
  const [tempBowLength, setTempBowLength] = useState<number>(25);
  const [bowEditStep, setBowEditStep] = useState<BowEditStepType>('none');
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [showLineLabels, setShowLineLabels] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [isPanelMinimized, setIsPanelMinimized] = useState<boolean>(false);
  const [activeNavTab, setActiveNavTab] = useState<LeftNavTab>('none');
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);

  // Параметры носовой оконечности и топологического ядра
  const [bowParams, setBowParams] = useState<BowParameters>({
    bowLength: 25,
    stemWidth: 0.0,
    stemRadius: 0.0,
    entranceAngle: 30.0,
    shoulderFullness: 0.70,
    maxBreadthPos: 0.50,
    bowSheer: 0.0,
    deckCamberBow: 0.0,
    bowFlare: 1.00,
    flareExponent: 2.0,
    stemRake: 0.0,
    bowUVShape: 0.5,
    stemProfile: DEFAULT_STEM_PARAMS,
    surfaceEngineMode: 'coons',
    showControlNet: false,
  });
  const [tempBowParams, setTempBowParams] = useState<BowParameters>(bowParams);
  const savedBowParamsRef = useRef<BowParameters>(bowParams);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(2);
  const selectedPointIndexRef = useRef<number | null>(2);
  selectedPointIndexRef.current = selectedPointIndex;
  const [selectedStemPointKey, setSelectedStemPointKey] = useState<StemPointKey | null>('PT_STEM_DECK');
  const [selectedStemParamId, setSelectedStemParamId] = useState<string | null>('stemRakeAngle');
  const [selectedBowSectionPointKey, setSelectedBowSectionPointKey] = useState<BowSectionKey | null>(null);
  const draggedGizmoAxisRef = useRef<'both' | 'x' | 'z' | null>(null);
  const [showBreadthLimits, setShowBreadthLimits] = useState<boolean>(true);
  const [showFullHullInBowEdit, setShowFullHullInBowEdit] = useState<boolean>(false);
  const [showHalfHull, setShowHalfHull] = useState<boolean>(false);

  // Режим анализа поверхности и метрики QA
  const [surfaceRenderMode, setSurfaceRenderMode] = useState<SurfaceRenderMode>('shaded');
  const [wireframeDisplay, setWireframeDisplay] = useState<WireframeDisplayOptions>({
    showStations: false,
    showWaterlines: true,
    showButtocks: false,
    showLongitudinals: false,
    showBoundaries: false,
    stationCount: 11,
    waterlineCount: 6,
    buttockCount: 5,
    hullSurfaceVisibility: 'shaded',
    hullOpacity: 1.0,
    showControlNet: false,
  });
  const [activeMasterWaterline, setActiveMasterWaterline] = useState<'dwl' | 'bilge'>('dwl');
  const activeMasterWaterlineRef = useRef<'dwl' | 'bilge'>('dwl');
  activeMasterWaterlineRef.current = activeMasterWaterline;

  const [selectedWaterlineId, setSelectedWaterlineId] = useState<string | null>('wl_dwl');
  const selectedWaterlineIdRef = useRef<string | null>('wl_dwl');
  selectedWaterlineIdRef.current = selectedWaterlineId;

  const topologyEngineRef = useRef<ShipHullTopologyEngine>(new ShipHullTopologyEngine());
  const lastQAStatsRef = useRef<TopologyQAStats | undefined>(undefined);

  // Стабильные рефы для событий указателя и 3D взаимодействия
  const tempBowParamsRef = useRef<BowParameters>(tempBowParams);
  tempBowParamsRef.current = tempBowParams;
  const paramsRef = useRef<BrusParams>(params);
  paramsRef.current = params;
  const tempBowLengthRef = useRef<number>(tempBowLength);
  tempBowLengthRef.current = tempBowLength;
  const bowLengthRef = useRef<number>(bowLength);
  bowLengthRef.current = bowLength;
  const bowEditStepRef = useRef<BowEditStepType>(bowEditStep);
  bowEditStepRef.current = bowEditStep;

  // Режим редактирования геометрии и анимации разреза
  const [animState, setAnimState] = useState<EditAnimState>('idle');

  // ─── РЕЖИМ ВИРТУАЛЬНОГО ОПЫТОВОГО БАССЕЙНА (TOWING TANK) ───
  const [isTowingTankMode, setIsTowingTankMode] = useState<boolean>(false);
  const isTowingTankModeRef = useRef<boolean>(false);
  isTowingTankModeRef.current = isTowingTankMode;

  const [tankSpeedKnots, setTankSpeedKnots] = useState<number>(18.5);
  const tankSpeedKnotsRef = useRef<number>(18.5);
  tankSpeedKnotsRef.current = tankSpeedKnots;

  const [tankVisualOptions, setTankVisualOptions] = useState<TowingTankVisualOptions>({
    showPressureHeatmap: true,
    showStreamlines: true,
    showSpray: true,
    showKelvinWake: true,
    showDynamicAttitude: true,
    showWireframeMesh: false,
  });
  const tankVisualOptionsRef = useRef<TowingTankVisualOptions>(tankVisualOptions);
  tankVisualOptionsRef.current = tankVisualOptions;

  const towingTankControllerRef = useRef<TowingTankController | null>(null);
  const [telemetry, setTelemetry] = useState<HydroTelemetry>(() =>
    computeHydrodynamics(
      params,
      bowParams,
      25,
      18.5
    )
  );

  // Ссылки на Three.js объекты
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const brusContainerRef = useRef<THREE.Group | null>(null);
  const frontGroupRef = useRef<THREE.Group | null>(null);
  const rearGroupRef = useRef<THREE.Group | null>(null);
  const topologicalBowGroupRef = useRef<THREE.Group | null>(null);
  const tubeMeshRef = useRef<THREE.Mesh | null>(null);
  const gasCutEffectRef = useRef<GasCutEffect | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const bowBoxRef = useRef<THREE.Group | THREE.Mesh | null>(null);
  const bowControlPoints3DGroupRef = useRef<THREE.Group | null>(null);
  const stem3DGroupRef = useRef<THREE.Group | null>(null);
  const bowSection3DGroupRef = useRef<THREE.Group | null>(null);
  const dragged3DPointIndexRef = useRef<number | null>(null);
  const draggedStemPointKeyRef = useRef<StemPointKey | null>(null);
  const draggedStemGizmoAxisRef = useRef<'both' | 'x' | 'y' | null>(null);
  const dragStartBowLengthRef = useRef<number>(25);
  const reqIdRef = useRef<number | null>(null);

  // Сохраненные состояния перед анимацией
  const savedParamsRef = useRef<BrusParams>(params);
  const savedCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(130, 80, 130));
  const savedCamTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));

  // Анимационные переменные
  const animProgressRef = useRef<{
    phase: EditAnimState;
    startTime: number;
    cutDuration: number;
    sepDuration: number;
    revDuration: number;
    weldDuration: number;
    fadeDuration: number;
    frontOffset: number;
    maxFrontOffset: number;
    tubeRadius: number;
    maxTubeRadius: number;
    camStartPos: THREE.Vector3;
    camEndPos: THREE.Vector3;
    camStartTarget: THREE.Vector3;
    camEndTarget: THREE.Vector3;
  }>({
    phase: 'idle',
    startTime: 0,
    cutDuration: 2800,
    sepDuration: 1800,
    revDuration: 1600,
    weldDuration: 2800,
    fadeDuration: 1800,
    frontOffset: 0,
    maxFrontOffset: 75,
    tubeRadius: 0,
    maxTubeRadius: 0.08,
    camStartPos: new THREE.Vector3(130, 80, 130),
    camEndPos: new THREE.Vector3(45, 5, 20),
    camStartTarget: new THREE.Vector3(0, 0, 0),
    camEndTarget: new THREE.Vector3(0, 0, 0),
  });

  // Вспомогательная функция плавности (cubic ease in-out)
  const easeInOutCubic = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // 1. Инициализация Three.js сцены
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Сцена
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    // Камера
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 4000);
    camera.position.set(130, 80, 130);
    cameraRef.current = camera;

    // Рендерер
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Контроллеры камеры
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 2000;
    controls.minDistance = 5;
    controls.maxPolarAngle = Math.PI / 2 + 0.25;
    controlsRef.current = controls;

    // Освещение
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight1.position.set(150, 200, 150);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 2048;
    dirLight1.shadow.mapSize.height = 2048;
    dirLight1.shadow.camera.near = 1;
    dirLight1.shadow.camera.far = 600;
    dirLight1.shadow.camera.left = -150;
    dirLight1.shadow.camera.right = 150;
    dirLight1.shadow.camera.top = 150;
    dirLight1.shadow.camera.bottom = -150;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.45);
    dirLight2.position.set(-150, 150, -150);
    scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.45);
    dirLight3.position.set(150, 150, -150);
    scene.add(dirLight3);

    // Сетка пола (по самому низу бруса — на уровне киля / ОП)
    const { keelY: initKeelY } = calculateVerticalLevels({
      height: params.height,
      deadrise: params.deadrise,
      deckCamber: params.deckCamber,
      deadriseInHeight: params.deadriseInHeight,
      deckCamberInHeight: params.deckCamberInHeight,
    });
    const gridHelper = new THREE.GridHelper(300, 30, 0x888888, 0xcccccc);
    gridHelper.position.y = initKeelY;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // Эффект газовой резки
    const gasCutEffect = new GasCutEffect();
    scene.add(gasCutEffect.group);
    gasCutEffectRef.current = gasCutEffect;

    // Контроллер виртуального опытового бассейна (Towing Tank)
    const towingTank = new TowingTankController();
    towingTank.getRootGroup().visible = false;
    scene.add(towingTank.getRootGroup());
    towingTankControllerRef.current = towingTank;

    // Анимационный цикл
    let lastTime = performance.now();
    const animate = () => {
      reqIdRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      const anim = animProgressRef.current;

      // ─── 1. ФАЗА ГАЗОВОЙ РЕЗКИ ───
      if (anim.phase === 'cutting') {
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.cutDuration);
        if (gasCutEffectRef.current) {
          gasCutEffectRef.current.update(progress, delta);
        }

        if (progress >= 1) {
          // Переход к фазе отделения и полета вперед
          anim.phase = 'separating';
          anim.startTime = now;
          anim.camStartPos.copy(camera.position);
          anim.camStartTarget.copy(controls.target);
          anim.camEndPos.set(45, 5, 20);
          anim.camEndTarget.set(0, 0, 0);
          if (gasCutEffectRef.current) {
            gasCutEffectRef.current.stop();
          }
          setAnimState('separating');
        }
      }

      // ─── 2. ФАЗА ОТДЕЛЕНИЯ И НАВЕДЕНИЯ КАМЕРЫ ───
      else if (anim.phase === 'separating') {
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.sepDuration);
        const ease = easeInOutCubic(progress);

        anim.frontOffset = ease * anim.maxFrontOffset;
        anim.tubeRadius = Math.max(0.01, ease * anim.maxTubeRadius);

        if (frontGroupRef.current) {
          frontGroupRef.current.position.x = anim.frontOffset;
        }

        if (gasCutEffectRef.current) {
          gasCutEffectRef.current.updatePositions(anim.frontOffset);
        }

        // Плавная анимация камеры
        camera.position.lerpVectors(anim.camStartPos, anim.camEndPos, ease);
        controls.target.lerpVectors(anim.camStartTarget, anim.camEndTarget, ease);

        if (progress >= 1) {
          anim.phase = 'editing';
          setAnimState('editing');
        }
      }

      // ─── 2.1 ФАЗА РЕДАКТИРОВАНИЯ ───
      else if (anim.phase === 'editing') {
        if (gasCutEffectRef.current) {
          gasCutEffectRef.current.updatePositions(anim.frontOffset);
        }
      }

      // ─── 3. ФАЗА ОБРАТНОЙ АНИМАЦИИ (СБЛИЖЕНИЕ СЕКЦИЙ) ───
      else if (anim.phase === 'reversing') {
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.revDuration);
        const ease = easeInOutCubic(progress);

        anim.frontOffset = (1 - ease) * anim.maxFrontOffset;
        anim.tubeRadius = Math.max(0.001, (1 - ease) * anim.maxTubeRadius);

        if (frontGroupRef.current) {
          frontGroupRef.current.position.x = anim.frontOffset;
        }

        if (gasCutEffectRef.current) {
          gasCutEffectRef.current.updatePositions(anim.frontOffset);
        }

        // Плавный возврат камеры
        camera.position.lerpVectors(anim.camStartPos, anim.camEndPos, ease);
        controls.target.lerpVectors(anim.camStartTarget, anim.camEndTarget, ease);

        if (progress >= 1) {
          // Секции сомкнулись! Запускаем процесс сварки по периметру
          anim.frontOffset = 0;
          anim.tubeRadius = 0;
          if (frontGroupRef.current) frontGroupRef.current.position.x = 0;
          if (gasCutEffectRef.current) {
            gasCutEffectRef.current.updatePositions(0);
          }

          anim.phase = 'welding';
          anim.startTime = now;
          if (gasCutEffectRef.current) {
            gasCutEffectRef.current.start('weld');
          }
          setAnimState('welding');
        }
      }

      // ─── 4. ФАЗА СВАРКИ ПО ПЕРИМЕТРУ ───
      else if (anim.phase === 'welding') {
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.weldDuration);
        if (gasCutEffectRef.current) {
          gasCutEffectRef.current.update(progress, delta);
        }

        if (progress >= 1) {
          if (gasCutEffectRef.current) {
            gasCutEffectRef.current.stopTorches();
          }
          anim.phase = 'fading';
          anim.startTime = now;
          setAnimState('fading');
        }
      }

      // ─── 5. ФАЗА ОСТЫВАНИЯ И ИСЧЕЗНОВЕНИЯ ЛИНИЙ СВАРКИ И ПЯТЕН ───
      else if (anim.phase === 'fading') {
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.fadeDuration);
        if (gasCutEffectRef.current) {
          gasCutEffectRef.current.updateFade(progress);
        }

        if (progress >= 1) {
          anim.phase = 'idle';
          setAnimState('idle');
        }
      }

      // ─── 6. ОБНОВЛЕНИЕ СИМУЛЯЦИИ ОПЫТОВОГО БАССЕЙНА ───
      if (towingTankControllerRef.current && isTowingTankModeRef.current) {
        towingTankControllerRef.current.update(
          delta,
          paramsRef.current,
          tempBowParamsRef.current,
          tankVisualOptionsRef.current
        );
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      if (towingTankControllerRef.current) {
        towingTankControllerRef.current.dispose();
      }
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // 2. Обновление сетки
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (gridHelperRef.current) {
      scene.remove(gridHelperRef.current);
      gridHelperRef.current.geometry.dispose();
      gridHelperRef.current = null;
    }

    if (showGrid) {
      const size = 300;
      const divisions = Math.max(2, Math.round(size / Math.max(0.1, params.gridSize)));
      const grid = new THREE.GridHelper(size, divisions, 0x888888, 0xcccccc);
      
      // Плоскость сетки располагается по самому низу бруса (на уровне киля / ОП)
      const { keelY } = calculateVerticalLevels({
        height: params.height,
        deadrise: params.deadrise,
        deckCamber: params.deckCamber,
        deadriseInHeight: params.deadriseInHeight,
        deckCamberInHeight: params.deckCamberInHeight,
      });
      grid.position.y = keelY;
      scene.add(grid);
      gridHelperRef.current = grid;
    }
  }, [
    params.gridSize,
    showGrid,
    params.height,
    params.deadrise,
    params.deckCamber,
    params.deadriseInHeight,
    params.deckCamberInHeight,
  ]);

  // 3. Обновление автовращения (выключаем в режиме редактирования)
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate && animState === 'idle';
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [autoRotate, animState]);

  // 3.1 Обновление плоскости отсечения для режима полукорпуса (разрез по ДП)
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.clippingPlanes = showHalfHull
        ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.001)]
        : [];
    }
  }, [showHalfHull]);

  // 4. Построение и обновление 3D-модели бруса и контурного цилиндра
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Удаляем старый брус
    if (brusContainerRef.current) {
      scene.remove(brusContainerRef.current);
      brusContainerRef.current.traverse((child) => {
        if ((child as THREE.Mesh).geometry) {
          (child as THREE.Mesh).geometry.dispose();
        }
        if ((child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });
      brusContainerRef.current = null;
    }

    // Удаляем старую трубку контура
    if (tubeMeshRef.current) {
      scene.remove(tubeMeshRef.current);
      tubeMeshRef.current.geometry.dispose();
      tubeMeshRef.current = null;
    }

    // Материалы для носовой части / бруса (непрозрачные, матовые судовые)
    const brusMat = new THREE.MeshStandardMaterial({
      color: params.brusColor,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      wireframe: showWireframe,
    });

    const draftColor = DRAFT_COLORS[params.draftColorIndex] ?? DRAFT_COLORS[0];
    const draftMat = new THREE.MeshStandardMaterial({
      color: draftColor,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      wireframe: showWireframe,
    });

    const effectiveOpacity =
      wireframeDisplay.hullOpacity !== undefined
        ? wireframeDisplay.hullOpacity
        : wireframeDisplay.hullSurfaceVisibility === 'hidden'
        ? 0
        : wireframeDisplay.hullSurfaceVisibility === 'ghost'
        ? 0.35
        : 1.0;

    const surfaceVis =
      effectiveOpacity <= 0.01
        ? 'hidden'
        : effectiveOpacity >= 0.99
        ? 'shaded'
        : 'ghost';
    const isGhostMode = surfaceVis === 'ghost';

    // Материалы для задней части корпуса (в обычном режиме непрозрачные, матовые, строго совпадают с основной поверхностью)
    const rearBrusMat = new THREE.MeshStandardMaterial({
      color: params.brusColor,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      wireframe: showWireframe,
      transparent: isGhostMode,
      opacity: isGhostMode ? effectiveOpacity : 1.0,
      depthWrite: !isGhostMode,
    });

    const rearDraftMat = new THREE.MeshStandardMaterial({
      color: draftColor,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      wireframe: showWireframe,
      transparent: isGhostMode,
      opacity: isGhostMode ? effectiveOpacity : 1.0,
      depthWrite: !isGhostMode,
    });

    // Режим непосредственного редактирования обводов носа (со 2-го шага: stem, volume, shaping, deck, surface, framework)
    const isSculptingBow =
      bowEditStep === 'shaping' ||
      bowEditStep === 'deck' ||
      bowEditStep === 'stem' ||
      bowEditStep === 'volume' ||
      bowEditStep === 'surface' ||
      bowEditStep === 'framework';
    const isShaping = animState === 'idle' && isSculptingBow;
    const isRearTransparent = isGhostMode;

    // На шаге задания длины (bowEditStep === 'length') показываем существующий сохраненный корпус,
    // либо прямой брус, если обводы ещё не создавались
    const effectiveBowLength = isSculptingBow
      ? tempBowLength
      : isTowingTankMode
      ? (hasBowApplied && bowLength > 0 ? bowLength : (tempBowLength > 0 ? tempBowLength : 25))
      : hasBowApplied && bowLength > 0
      ? bowLength
      : 0;

    const { group, rearGroup, frontGroup } = createSplitHollowBrus(
      params,
      isGhostMode ? rearBrusMat : brusMat,
      isGhostMode ? rearDraftMat : draftMat,
      animProgressRef.current.frontOffset,
      effectiveBowLength,
      isRearTransparent,
      rearBrusMat,
      rearDraftMat,
      isSculptingBow
    );

    // При непосредственном редактировании обводов носовой оконечности центральная/кормовая часть корпуса
    // скрывается либо отображается в соответствии с тумблером 'Весь корпус'.
    // На шаге 'length' показывается весь брус целиком с габаритами длины носа.
    if (isSculptingBow) {
      rearGroup.visible = showFullHullInBowEdit;
    }

    if (surfaceVis === 'hidden' || effectiveOpacity <= 0.01) {
      rearGroup.visible = false;
      frontGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh &&
            !child.name.startsWith('waterline') &&
            !child.name.startsWith('station') &&
            !child.name.startsWith('buttock') &&
            !child.name.startsWith('longitudinal') &&
            !child.name.startsWith('boundary') &&
            !child.name.startsWith('deckOutlineTube') &&
            !child.name.startsWith('bspline_control_net')) {
          child.visible = false;
        }
      });
    }

    // Если задана длина носовой оконечности (> 0),
    // вычисляем обводы поверхности носовой части
    if (effectiveBowLength > 0) {
      // Пересчитываем DAG-пайплайн топологии
      const activeBowParams: BowParameters = {
        ...(isSculptingBow ? tempBowParams : bowParams),
        bowLength: effectiveBowLength,
      };

      topologyEngineRef.current.updatePipeline(activeBowParams, {
        length: params.length,
        width: params.width,
        height: params.height,
        deadrise: params.deadrise,
        radius: params.radius,
        flare: params.flare,
        deckCamber: params.deckCamber,
        sheerRadius: params.sheerRadius,
        draft: params.draft,
        deadriseInHeight: params.deadriseInHeight,
        deckCamberInHeight: params.deckCamberInHeight,
      });

      const useBSpline = (activeBowParams.surfaceEngineMode ?? 'coons') === 'bspline';

      let deckGeometry: THREE.BufferGeometry;
      let hullGeometry: THREE.BufferGeometry;
      let underwaterHullGeometry: THREE.BufferGeometry;
      let abovewaterHullGeometry: THREE.BufferGeometry;
      let controlNetGroup: THREE.Group | null = null;

      if (useBSpline) {
        const bsplineRes = generateBSplineCompositeGeometry(
          {
            length: params.length,
            width: params.width,
            height: params.height,
            deadrise: params.deadrise,
            radius: params.radius,
            flare: params.flare,
            deckCamber: params.deckCamber,
            sheerRadius: params.sheerRadius,
            draft: params.draft,
            deadriseInHeight: params.deadriseInHeight,
            deckCamberInHeight: params.deckCamberInHeight,
          },
          activeBowParams,
          { uSegments: 64, vSegments: 32 }
        );
        deckGeometry = bsplineRes.deckGeometry;
        hullGeometry = bsplineRes.hullGeometry;
        underwaterHullGeometry = bsplineRes.underwaterHullGeometry;
        abovewaterHullGeometry = bsplineRes.abovewaterHullGeometry;
        controlNetGroup = bsplineRes.controlNetGroup;
        lastQAStatsRef.current = bsplineRes.stats;
      } else {
        const coonsRes = topologyEngineRef.current.generateCompositeBufferGeometry(96, 56);
        deckGeometry = coonsRes.deckGeometry;
        hullGeometry = coonsRes.hullGeometry;
        underwaterHullGeometry = coonsRes.underwaterHullGeometry;
        abovewaterHullGeometry = coonsRes.abovewaterHullGeometry;
        lastQAStatsRef.current = coonsRes.stats;
      }

      // Проверка выхода за габариты и окрашивание превышающих частей в красный цвет
      const { keelY: checkKeelY, topY: checkTopY } = calculateVerticalLevels({
        height: params.height,
        deadrise: params.deadrise,
        deckCamber: params.deckCamber,
        deadriseInHeight: params.deadriseInHeight,
        deckCamberInHeight: params.deckCamberInHeight,
      });

      const boundHalfTop = params.width / 2 + params.flare;
      const boundHalfBot = params.width / 2;

      const applyCollisionColors = (geom: THREE.BufferGeometry, baseColorHex: string | number) => {
        const posAttr = geom.getAttribute('position');
        if (!posAttr) return;
        const count = posAttr.count;
        const colors = new Float32Array(count * 3);
        const baseColor = new THREE.Color(baseColorHex);
        const redColor = new THREE.Color(0xef4444);

        for (let i = 0; i < count; i++) {
          const vy = posAttr.getY(i);
          const vz = posAttr.getZ(i);
          const tY = Math.max(0, Math.min(1, (vy - checkKeelY) / Math.max(0.01, checkTopY - checkKeelY)));
          const allowedZ = boundHalfBot + tY * (boundHalfTop - boundHalfBot);

          const isExceeded = Math.abs(vz) > allowedZ + 0.02 || vy < checkKeelY - 0.02;

          if (isExceeded && showBreadthLimits) {
            colors[i * 3] = redColor.r;
            colors[i * 3 + 1] = redColor.g;
            colors[i * 3 + 2] = redColor.b;
          } else {
            colors[i * 3] = baseColor.r;
            colors[i * 3 + 1] = baseColor.g;
            colors[i * 3 + 2] = baseColor.b;
          }
        }
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      };

      if (deckGeometry) applyCollisionColors(deckGeometry, params.brusColor);
      if (abovewaterHullGeometry) applyCollisionColors(abovewaterHullGeometry, params.brusColor);
      if (underwaterHullGeometry) applyCollisionColors(underwaterHullGeometry, draftColor);

      let activeDeckMat: THREE.Material;
      let activeAbovewaterHullMat: THREE.Material;
      let activeUnderwaterHullMat: THREE.Material;

      // surfaceVis уже вычислен выше на основе wireframeDisplay.hullSurfaceVisibility

      if (isTowingTankMode && tankVisualOptions.showPressureHeatmap) {
        const pressureMat = towingTankControllerRef.current?.getPressureMaterial() || createBernoulliPressureMaterial({
          stemX: params.length / 2,
          bowLength: effectiveBowLength,
          draft: params.draft,
          entranceAngleDeg: activeBowParams.entranceAngle ?? 30,
          shoulderFullness: activeBowParams.shoulderFullness ?? 0.7,
          bulbLength: activeBowParams.stemProfile?.bulbLength ?? 0,
          speedMs: tankSpeedKnots * 0.514444,
        });
        activeDeckMat = pressureMat;
        activeAbovewaterHullMat = pressureMat;
        activeUnderwaterHullMat = pressureMat;
      } else if (isShaping) {
        if (surfaceVis === 'ghost') {
          // Полупрозрачный "призрак" (Ghost Silhouette)
          activeDeckMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 1.0,
            metalness: 0.0,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          activeAbovewaterHullMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 1.0,
            metalness: 0.0,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          activeUnderwaterHullMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 1.0,
            metalness: 0.0,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
        } else if (surfaceRenderMode === 'zebra') {
          activeDeckMat = createZebraStripesMaterial({ direction: 'horizontal' });
          activeAbovewaterHullMat = createZebraStripesMaterial({ direction: 'horizontal' });
          activeUnderwaterHullMat = createZebraStripesMaterial({ direction: 'horizontal' });
        } else if (surfaceRenderMode === 'curvature') {
          activeDeckMat = createCurvatureMaterial();
          activeAbovewaterHullMat = createCurvatureMaterial();
          activeUnderwaterHullMat = createCurvatureMaterial();
        } else if (surfaceRenderMode === 'wireframe' || showWireframe) {
          activeDeckMat = new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true, side: THREE.DoubleSide });
          activeAbovewaterHullMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, wireframe: true, side: THREE.DoubleSide });
          activeUnderwaterHullMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, wireframe: true, side: THREE.DoubleSide });
        } else {
          // Shaded PBR: сплошная поверхность, в точности совпадающая по оптике и тону с нередактируемым корпусом
          activeDeckMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.DoubleSide,
            wireframe: showWireframe,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          activeAbovewaterHullMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.DoubleSide,
            wireframe: showWireframe,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          activeUnderwaterHullMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.DoubleSide,
            wireframe: showWireframe,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
        }
      } else {
        // Режим обычного отображения (после сохранения): материалы строго совпадают с брусом и осадкой
        activeDeckMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 1.0,
          metalness: 0.0,
          side: THREE.DoubleSide,
          wireframe: showWireframe,
        });
        activeAbovewaterHullMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 1.0,
          metalness: 0.0,
          side: THREE.DoubleSide,
          wireframe: showWireframe,
        });
        activeUnderwaterHullMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 1.0,
          metalness: 0.0,
          side: THREE.DoubleSide,
          wireframe: showWireframe,
        });
      }

      if (isGhostMode) {
        activeDeckMat.transparent = true;
        activeDeckMat.opacity = effectiveOpacity * 0.85;
        activeDeckMat.depthWrite = false;

        activeAbovewaterHullMat.transparent = true;
        activeAbovewaterHullMat.opacity = effectiveOpacity;
        activeAbovewaterHullMat.depthWrite = false;

        activeUnderwaterHullMat.transparent = true;
        activeUnderwaterHullMat.opacity = effectiveOpacity;
        activeUnderwaterHullMat.depthWrite = false;
      }

      // Добавляем меши поверхности, если они не скрыты (режим 'hidden' оставляет только каркас)
      if (surfaceVis !== 'hidden' && effectiveOpacity > 0.01) {
        const deckMesh = new THREE.Mesh(deckGeometry, activeDeckMat);
        deckMesh.receiveShadow = true;
        frontGroup.add(deckMesh);

        if (abovewaterHullGeometry && abovewaterHullGeometry.getAttribute('position') && abovewaterHullGeometry.getAttribute('position').count > 0) {
          const aboveMesh = new THREE.Mesh(abovewaterHullGeometry, activeAbovewaterHullMat);
          aboveMesh.receiveShadow = true;
          frontGroup.add(aboveMesh);
        }

        if (underwaterHullGeometry && underwaterHullGeometry.getAttribute('position') && underwaterHullGeometry.getAttribute('position').count > 0) {
          const underMesh = new THREE.Mesh(underwaterHullGeometry, activeUnderwaterHullMat);
          underMesh.receiveShadow = true;
          frontGroup.add(underMesh);
        }
      }

      // Добавляем 3D-каркас управляющей сети B-сплайнов FREE!ship (если включен тумблер или на шаге 'surface')
      if (controlNetGroup && (activeBowParams.showControlNet || wireframeDisplay.showControlNet || bowEditStep === 'surface')) {
        frontGroup.add(controlNetGroup);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // 3D-ОБВОД ВЕРХНЕЙ ПАЛУБЫ (Тонкий четкий черный контур)
      // ──────────────────────────────────────────────────────────────────────────
      const stemProfileForDeck = activeBowParams.stemProfile ?? {
        ...DEFAULT_STEM_PARAMS,
        deckOverhang: activeBowParams.stemRake ?? 0,
      };
      const { keelY, topY } = calculateVerticalLevels({
        height: params.height,
        deadrise: params.deadrise,
        deckCamber: params.deckCamber,
        deadriseInHeight: params.deadriseInHeight,
        deckCamberInHeight: params.deckCamberInHeight,
      });
      const totalHeightSide = topY - keelY;
      const stemPtsForDeck = calculateStemTopologyPoints(stemProfileForDeck, params.draft, totalHeightSide, effectiveBowLength);
      const stemSampledForWl = sampleStemCurvePoints(stemPtsForDeck, 48, effectiveBowLength);
      const xStem = params.length / 2;
      const xStartDeck = xStem - effectiveBowLength;
      const xStemDeck = xStem + stemPtsForDeck.PT_STEM_DECK.x;
      const totalBowSpan = Math.max(0.1, xStemDeck - xStartDeck);
      const yStemDeck = keelY + stemPtsForDeck.PT_STEM_DECK.z;
      const yMidDeck = params.width / 2 + params.flare;

      const deckLoopPts: THREE.Vector3[] = [];
      const deckSamples = 50;

      const deckPtsBlue: THREE.Vector3[] = [];
      const deckPtsGreen: THREE.Vector3[] = [];
      const deckPtsYellow: THREE.Vector3[] = [];

      const getDeckPt = (t: number, isStarboard: boolean) => {
        const pt = computeBowDeckWaterlinePoint(
          t,
          totalBowSpan,
          yMidDeck,
          (activeBowParams.stemWidth ?? 0) / 2,
          activeBowParams.stemRadius ?? 0,
          activeBowParams.entranceAngle ?? 25,
          activeBowParams.shoulderFullness ?? 0.7,
          activeBowParams.maxBreadthPos ?? 0.5,
          activeBowParams.controlPoints
        );
        const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
        const baseEdge = topY + (activeBowParams.bowSheer ?? 0) * sheerBlend;
        const y = baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
        const px = xStemDeck + pt.xRel;
        return new THREE.Vector3(px, y, isStarboard ? pt.y : -pt.y);
      };

      const pBreak = activeBowParams.maxBreadthPos ?? 0.5;
      const t1 = Math.max(0.01, pBreak * 0.5); // Run (Уход) ends
      const t2 = Math.max(t1 + 0.01, pBreak + (1.0 - pBreak) * 0.4); // Shoulder (Плечо) ends

      const deckPtsYellowPort: THREE.Vector3[] = [];
      const deckPtsGreenPort: THREE.Vector3[] = [];
      const deckPtsBluePort: THREE.Vector3[] = [];

      const deckPtsYellowStbd: THREE.Vector3[] = [];
      const deckPtsGreenStbd: THREE.Vector3[] = [];
      const deckPtsBlueStbd: THREE.Vector3[] = [];

      // Параллельное симметричное сэмплирование от миделя t=0 к форштевню t=1
      for (let i = 0; i <= deckSamples; i++) {
        const t = i / deckSamples;
        const ptPort = getDeckPt(t, false);
        const ptStbd = getDeckPt(t, true);

        if (Number.isFinite(ptPort.x) && Number.isFinite(ptPort.y) && Number.isFinite(ptPort.z) &&
            Number.isFinite(ptStbd.x) && Number.isFinite(ptStbd.y) && Number.isFinite(ptStbd.z)) {
          
          if (t <= t1) {
            deckPtsYellowPort.push(ptPort);
            deckPtsYellowStbd.push(ptStbd);
          } else if (t <= t2) {
            if (deckPtsGreenPort.length === 0 && deckPtsYellowPort.length > 0) {
              deckPtsGreenPort.push(deckPtsYellowPort[deckPtsYellowPort.length - 1]);
              deckPtsGreenStbd.push(deckPtsYellowStbd[deckPtsYellowStbd.length - 1]);
            }
            deckPtsGreenPort.push(ptPort);
            deckPtsGreenStbd.push(ptStbd);
          } else {
            if (deckPtsBluePort.length === 0 && deckPtsGreenPort.length > 0) {
              deckPtsBluePort.push(deckPtsGreenPort[deckPtsGreenPort.length - 1]);
              deckPtsBlueStbd.push(deckPtsGreenStbd[deckPtsGreenStbd.length - 1]);
            }
            deckPtsBluePort.push(ptPort);
            deckPtsBlueStbd.push(ptStbd);
          }
        }
      }

      // Общий контур для якорных спрайтов
      deckLoopPts.push(
        ...deckPtsYellowPort,
        ...deckPtsGreenPort,
        ...deckPtsBluePort,
        ...[...deckPtsBlueStbd, ...deckPtsGreenStbd, ...deckPtsYellowStbd].reverse()
      );

      // Рендерим 3 цветных сегмента для палубы (только на шаге редактирования палубы или при включенном каркасе границ):
      const showDeckZoneTubes = bowEditStep === 'deck' || wireframeDisplay.showBoundaries;
      if (showDeckZoneTubes) {
        if (deckPtsYellowPort.length > 1) frontGroup.add(createContourTubeMesh(deckPtsYellowPort, 0.04, 0xf59e0b));
        if (deckPtsGreenPort.length > 1) frontGroup.add(createContourTubeMesh(deckPtsGreenPort, 0.04, 0x10b981));
        if (deckPtsBluePort.length > 1) frontGroup.add(createContourTubeMesh(deckPtsBluePort, 0.04, 0x38bdf8));

        if (deckPtsYellowStbd.length > 1) frontGroup.add(createContourTubeMesh(deckPtsYellowStbd, 0.04, 0xf59e0b));
        if (deckPtsGreenStbd.length > 1) frontGroup.add(createContourTubeMesh(deckPtsGreenStbd, 0.04, 0x10b981));
        if (deckPtsBlueStbd.length > 1) frontGroup.add(createContourTubeMesh(deckPtsBlueStbd, 0.04, 0x38bdf8));
      }

      // ──────────────────────────────────────────────────────────────────────────
      // КАРКАС ВАТЕРЛИНИЙ (ШАГ 2: U-НАПРАВЛЕНИЕ, 32 ГОРИЗОНТА)
      // Подавление раздутия объема, строгая привязка G^0 к форштевню и миделю
      // ──────────────────────────────────────────────────────────────────────────
      const shouldRenderWaterlineWireframe =
        effectiveBowLength > 0 &&
        wireframeDisplay.showWaterlines !== false &&
        (bowEditStep === 'volume' ||
          bowEditStep === 'framework' ||
          showWireframe ||
          surfaceVis === 'hidden' ||
          surfaceVis === 'ghost');

      let bowSectionTopology: BowSectionTopology | undefined = undefined;
      if (effectiveBowLength > 0) {
        const xStemTip = xStem;
        const xMidCut = params.length / 2 - effectiveBowLength;
        const activeVolParams = extractBowVolumeParams(activeBowParams);
        const bottomFlatRun = activeVolParams.bottomFlatRun;

        bowSectionTopology = calculateBowSectionTopology({
          xMidCut,
          xStemTip,
          effectiveBowLen: effectiveBowLength,
          bottomFlatRun,
          volParams: activeVolParams,
          bowParams: activeBowParams,
          hullParams: params,
          keelY,
          totalHeight: totalHeightSide,
          bottomZeroX: params.length / 2 + (stemPtsForDeck.PT_FOREFOOT.z <= 0.05 ? stemPtsForDeck.PT_FOREFOOT.x : stemPtsForDeck.PT_KEEL_TANGENT.x),
        });
      }

      if (shouldRenderWaterlineWireframe) {
        const { waterlines: family3D } = generateWaterlineFamily3D(
          totalHeightSide,
          params.draft,
          {
            width: params.width,
            height: params.height,
            radius: params.radius,
            flare: params.flare,
            deadrise: params.deadrise,
            deckCamber: params.deckCamber,
            sheerRadius: params.sheerRadius,
            deadriseInHeight: params.deadriseInHeight,
            deckCamberInHeight: params.deckCamberInHeight,
          },
          stemSampledForWl,
          (activeBowParams.stemWidth ?? 0) / 2,
          effectiveBowLength,
          activeBowParams,
          params.length,
          keelY,
          wireframeDisplay.waterlineCount ?? 6,
          bowSectionTopology
        );

        const wireframeLinesGroup = createWaterlineWireframeGroup(family3D, {
          regularColor: 0x06b6d4, // бирюзово-неоновый для промежуточных ВЛ
          dwlColor: 0x10b981,     // изумрудный для КВЛ
          bottomColor: 0xf59e0b,  // янтарный для днищевого пятна
          deckColor: 0x38bdf8,    // небесный для палубы
          opacity: surfaceVis === 'hidden' ? 0.95 : 0.8,
          selectedWaterlineId,
        });
        wireframeLinesGroup.name = 'step2WaterlinesWireframe';
        frontGroup.add(wireframeLinesGroup);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // ТЕОРЕТИЧЕСКИЙ КАРКАС СУДНА (Шпангоуты и батоксы временно убраны с 3D поверхности)
      // ──────────────────────────────────────────────────────────────────────────
      const shouldRenderFramework =
        effectiveBowLength > 0 &&
        (wireframeDisplay.showLongitudinals ||
          wireframeDisplay.showBoundaries);

      if (shouldRenderFramework && topologyEngineRef.current.generateWireframeFramework) {
        const framework = topologyEngineRef.current.generateWireframeFramework(wireframeDisplay);
        const frameworkGroup = new THREE.Group();
        frameworkGroup.name = 'hullFrameworkWireframeGroup';

        // Примечание: Шпангоуты (зелёные) и Батоксы временно исключены с 3D поверхности (отложены)

        // 3. Стрингеры / продольные образующие (Longitudinals)
        if (wireframeDisplay.showLongitudinals && framework.longitudinals && framework.longitudinals.length > 0) {
          framework.longitudinals.forEach((lg) => {
            if (lg.points.length > 1) {
              const pts = lg.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
              const lineMat = new THREE.LineBasicMaterial({
                color: 0xec4899,
                linewidth: 1.2,
                transparent: true,
                opacity: surfaceVis === 'hidden' ? 0.9 : 0.65,
              });
              const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
              line.name = `longitudinal_${lg.id}`;
              frameworkGroup.add(line);
            }
          });
        }

        // 4. Опорные мастер-границы (Boundaries: форштевень, киль)
        if (wireframeDisplay.showBoundaries !== false && framework.boundaries && framework.boundaries.length > 0) {
          framework.boundaries.forEach((bd) => {
            if (bd.points.length > 1) {
              const pts = bd.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
              const lineMat = new THREE.LineBasicMaterial({
                color: 0xfacc15,
                linewidth: 2.2,
                transparent: true,
                opacity: 0.95,
              });
              const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
              line.name = `boundary_${bd.id}`;
              frameworkGroup.add(line);
            }
          });
        }

        if (frameworkGroup.children.length > 0) {
          frontGroup.add(frameworkGroup);
        }
      }

      // ──────────────────────────────────────────────────────────────────────────
      // БОКОВЫЕ ГАБАРИТЫ КОРПУСА (Красные продленные стенки до форштевня)
      // ──────────────────────────────────────────────────────────────────────────
      if (showBreadthLimits) {
        const boundsGroup = new THREE.Group();
        const xCut = params.length / 2 - effectiveBowLength;
        const xNose = xStem;
        const xMidSpan = (xCut + xNose) / 2;

        const { keelY, topY } = calculateVerticalLevels({
          height: params.height,
          deadrise: params.deadrise,
          deckCamber: params.deckCamber,
          deadriseInHeight: params.deadriseInHeight,
          deckCamberInHeight: params.deckCamberInHeight,
        });

        const halfWidthTop = params.width / 2 + params.flare;
        const halfWidthBot = params.width / 2;

        // Полупрозрачный красный материал для габаритных плоскостей
        const boundPlaneMat = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          roughness: 0.8,
          metalness: 0.0,
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        // Каркасный красный материал
        const boundLineMat = new THREE.LineBasicMaterial({
          color: 0xef4444,
          linewidth: 2.5,
          transparent: true,
          opacity: 0.95,
        });

        [-1, 1].forEach((side) => {
          const zPosTop = side * halfWidthTop;
          const zPosBot = side * halfWidthBot;

          // Вертикальная/наклонная плоскость габарита борта
          const planeGeom = new THREE.BufferGeometry();
          const planeVerts = new Float32Array([
            xCut, keelY, zPosBot,
            xNose, keelY, zPosBot,
            xNose, topY, zPosTop,

            xCut, keelY, zPosBot,
            xNose, topY, zPosTop,
            xCut, topY, zPosTop,
          ]);
          planeGeom.setAttribute('position', new THREE.BufferAttribute(planeVerts, 3));
          planeGeom.computeVertexNormals();
          const planeMesh = new THREE.Mesh(planeGeom, boundPlaneMat);
          boundsGroup.add(planeMesh);

          // Продольные контурные линии габарита (палуба и днище)
          const topLinePts = [new THREE.Vector3(xCut, topY, zPosTop), new THREE.Vector3(xNose, topY, zPosTop)];
          const topLineGeom = new THREE.BufferGeometry().setFromPoints(topLinePts);
          boundsGroup.add(new THREE.Line(topLineGeom, boundLineMat));

          const botLinePts = [new THREE.Vector3(xCut, keelY, zPosBot), new THREE.Vector3(xNose, keelY, zPosBot)];
          const botLineGeom = new THREE.BufferGeometry().setFromPoints(botLinePts);
          boundsGroup.add(new THREE.Line(botLineGeom, boundLineMat));

          // Вертикальные стойки
          const startPostPts = [new THREE.Vector3(xCut, keelY, zPosBot), new THREE.Vector3(xCut, topY, zPosTop)];
          boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(startPostPts), boundLineMat));

          const endPostPts = [new THREE.Vector3(xNose, keelY, zPosBot), new THREE.Vector3(xNose, topY, zPosTop)];
          boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(endPostPts), boundLineMat));

          const midPostPts = [new THREE.Vector3(xMidSpan, keelY, zPosBot), new THREE.Vector3(xMidSpan, topY, zPosTop)];
          boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(midPostPts), boundLineMat));
        });

        // 2. Нижний горизонтальный габарит днища на уровне keelY (наравне с боковыми габаритами)
        const botPlaneGeom = new THREE.BufferGeometry();
        const botPlaneVerts = new Float32Array([
          xCut, keelY, -halfWidthBot,
          xNose, keelY, -halfWidthBot,
          xNose, keelY, halfWidthBot,

          xCut, keelY, -halfWidthBot,
          xNose, keelY, halfWidthBot,
          xCut, keelY, halfWidthBot,
        ]);
        botPlaneGeom.setAttribute('position', new THREE.BufferAttribute(botPlaneVerts, 3));
        botPlaneGeom.computeVertexNormals();
        const botPlaneMesh = new THREE.Mesh(botPlaneGeom, boundPlaneMat);
        boundsGroup.add(botPlaneMesh);

        // Поперечные контурные линии нижнего габарита
        const cutBotLine = [new THREE.Vector3(xCut, keelY, -halfWidthBot), new THREE.Vector3(xCut, keelY, halfWidthBot)];
        boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cutBotLine), boundLineMat));

        const noseBotLine = [new THREE.Vector3(xNose, keelY, -halfWidthBot), new THREE.Vector3(xNose, keelY, halfWidthBot)];
        boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(noseBotLine), boundLineMat));

        const midBotLine = [new THREE.Vector3(xMidSpan, keelY, -halfWidthBot), new THREE.Vector3(xMidSpan, keelY, halfWidthBot)];
        boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(midBotLine), boundLineMat));

        // Продольная центральная линия ДП по нижнему габариту
        const keelCenterLine = [new THREE.Vector3(xCut, keelY, 0), new THREE.Vector3(xNose, keelY, 0)];
        boundsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(keelCenterLine), boundLineMat));

        frontGroup.add(boundsGroup);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // 3D-ИНТЕРАКТИВНЫЕ ТОЧКИ УПРАВЛЕНИЯ P0..P4 С GIZMO И БЕЙДЖАМИ (палуба, шейпинг или объём носа)
      // ──────────────────────────────────────────────────────────────────────────
      if (bowEditStep === 'deck' || bowEditStep === 'shaping' || bowEditStep === 'volume') {
        const isVolume = bowEditStep === 'volume';
        const points3DGroup = new THREE.Group();
        const polygonPts: THREE.Vector3[] = [];
        const currentSelectedIdx = selectedPointIndex !== null ? selectedPointIndex : (selectedPointIndexRef.current ?? (isVolume ? 2 : 1));

        if (isVolume) {
          // Опорная ватерлиния для 3D-редактирования объема: 'dwl' (КВЛ) или 'bilge' (Скула/днище).
          // Верхняя палуба и форштевень строго зафиксированы!
          const masterZ =
            activeMasterWaterline === 'bilge'
              ? 0.005
              : params.draft;

          const stemXAtMaster = getStemXAtZ(stemSampledForWl, masterZ);
          const midBreadthAtMaster = getTheoreticalMidshipHalfBreadthAtZ(masterZ, {
            width: params.width,
            height: params.height,
            radius: params.radius,
            flare: params.flare,
            deadrise: params.deadrise,
            deckCamber: params.deckCamber,
            sheerRadius: params.sheerRadius,
            deadriseInHeight: params.deadriseInHeight,
            deckCamberInHeight: params.deckCamberInHeight,
          });

          const masterEval = evaluateWaterlineCurve(
            masterZ,
            totalHeightSide,
            params.draft,
            midBreadthAtMaster,
            stemXAtMaster,
            (activeBowParams.stemWidth ?? 0) / 2,
            effectiveBowLength,
            activeBowParams,
            60
          );

          const pts3D = masterEval.controlPoints;
          const y3dLevel = keelY + masterZ;

          // Подсветка активной мастер-ватерлинии более ярким, толстым контуром
          const masterLoopPts: THREE.Vector3[] = [];
          for (let k = 0; k < masterEval.points.length; k++) {
            const pt = masterEval.points[k];
            masterLoopPts.push(new THREE.Vector3(xStem + pt.x, y3dLevel, pt.y));
          }
          for (let k = masterEval.points.length - 1; k >= 0; k--) {
            const pt = masterEval.points[k];
            masterLoopPts.push(new THREE.Vector3(xStem + pt.x, y3dLevel, -pt.y));
          }
          if (masterLoopPts.length > 2) {
            const highlightGeom = new THREE.BufferGeometry().setFromPoints(masterLoopPts);
            const highlightColor = activeMasterWaterline === 'dwl' ? 0x10b981 : 0xf59e0b;
            const highlightMat = new THREE.LineBasicMaterial({
              color: highlightColor,
              linewidth: 3.5,
              transparent: true,
              opacity: 0.98,
            });
            points3DGroup.add(new THREE.Line(highlightGeom, highlightMat));
          }

          const volParams = extractBowVolumeParams(activeBowParams);
          const pointMeta = [
            {
              name: activeMasterWaterline === 'dwl' ? 'D0: Форштевень (КВЛ)' : 'D0: Форштевень (Днище)',
              sub: `X: ${(xStem + pts3D[0].x).toFixed(2)}м`,
            },
            {
              name: activeMasterWaterline === 'dwl' ? 'D1: Угол входа КВЛ' : 'D1: Заострение днища',
              sub: activeMasterWaterline === 'bilge'
                ? `Угол: ${volParams.bottomTaperAngle.toFixed(1)}°`
                : `Угол: ${volParams.baseEntranceAngle.toFixed(1)}°`,
            },
            {
              name: activeMasterWaterline === 'dwl' ? 'D2: Плечо КВЛ' : 'D2: Полнота днища',
              sub: activeMasterWaterline === 'bilge'
                ? `Полнота: ${volParams.bottomFootprintFullness.toFixed(2)}`
                : `Полнота: ${volParams.baseShoulderFullness.toFixed(2)}`,
            },
            {
              name: activeMasterWaterline === 'bilge' ? 'D3: Выход днища' : 'D3: Тангенс к миделю',
              sub: activeMasterWaterline === 'bilge'
                ? `L_пл: ${volParams.bottomFlatRun.toFixed(1)}м`
                : `L_т: ${volParams.baseMidTangentLength.toFixed(1)}м`,
            },
            {
              name: activeMasterWaterline === 'bilge' ? 'D4: Край днищевого пятна' : 'D4: Стык с миделем',
              sub: activeMasterWaterline === 'bilge'
                ? `B_пятна/2: ${midBreadthAtMaster.toFixed(2)}м`
                : `B/2: ${midBreadthAtMaster.toFixed(2)}м`,
            },
          ];

          pts3D.forEach((pt, i) => {
            const x3d = xStem + pt.x;
            const z3d = pt.y;
            const y3d = y3dLevel;
            const pos = new THREE.Vector3(x3d, y3d, z3d);
            polygonPts.push(pos);

            const isSelected = i === currentSelectedIdx;
            const ptColors = [0x38bdf8, 0x06b6d4, 0xf59e0b, 0x0284c7, 0x64748b];
            const color = isSelected ? 0xf59e0b : (ptColors[i] ?? 0x06b6d4);

            const sphereRadius = isSelected ? 0.18 : 0.13;
            const sphereGeom = new THREE.SphereGeometry(sphereRadius, 20, 20);
            const sphereMat = new THREE.MeshStandardMaterial({
              color,
              roughness: 0.2,
              metalness: 0.6,
              emissive: color,
              emissiveIntensity: isSelected ? 0.95 : 0.45,
            });
            const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
            sphereMesh.position.copy(pos);
            sphereMesh.userData = { isControlPoint: true, pointIndex: i };

            const hitGeom = new THREE.SphereGeometry(0.45, 12, 12);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false });
            const hitMesh = new THREE.Mesh(hitGeom, hitMat);
            hitMesh.userData = { isControlPoint: true, pointIndex: i };
            sphereMesh.add(hitMesh);

            const meta = pointMeta[i] || { name: `P${i}`, sub: '' };
            const textSprite = createTextSprite(meta.name, meta.sub, isSelected);
            textSprite.position.set(0, isSelected ? 1.8 : 1.3, 0);
            sphereMesh.add(textSprite);

            points3DGroup.add(sphereMesh);

            // 3D Transform Gizmo для выбранной активной точки (P1, P2, P3)
            if (isSelected && i !== 4 && i !== 0) {
              const gizmo = create3DTransformGizmo(i, pos);
              points3DGroup.add(gizmo);
            }
          });
        } else {
          const { controlPoints: pts3D } = calculateBowWaterplaneCoeff(
            totalBowSpan,
            yMidDeck,
            (activeBowParams.stemWidth ?? 0) / 2,
            0,
            activeBowParams.entranceAngle ?? 30,
            activeBowParams.shoulderFullness ?? 0.7,
            activeBowParams.maxBreadthPos ?? 0.5,
            activeBowParams.controlPoints
          );

          const p3_3d = pts3D[3] || { x: -totalBowSpan * 0.75, y: yMidDeck };
          const p4_3d = pts3D[4] || { x: -totalBowSpan, y: yMidDeck };
          const dx3_3d = Math.max(0.001, p3_3d.x - p4_3d.x);

          const pointMeta = [
            { name: 'D0: Форштевень палубы', sub: `W: ${(activeBowParams.stemWidth ?? 0).toFixed(2)}м` },
            { name: 'D1: Угол входа палубы', sub: `Угол: ${(activeBowParams.entranceAngle ?? 30).toFixed(1)}°` },
            { name: 'D2: Плечо палубы', sub: `Полнота: ${(activeBowParams.shoulderFullness ?? 0.7).toFixed(2)}` },
            { name: 'D3: Тангенс к миделю', sub: `L_т: ${dx3_3d.toFixed(2)}м` },
            { name: 'D4: Стык с миделем', sub: `Зафиксирован: -${totalBowSpan.toFixed(1)}м` },
          ];

          pts3D.forEach((pt, i) => {
            const t = Math.max(0, Math.min(1, 1 - Math.abs(pt.x) / totalBowSpan));
            const x3d = (i === 0) ? xStemDeck : (xStemDeck + pt.x);
            const z3d = pt.y; // Правый борт (при i=0: stemWidth / 2)
            const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
            const activeCamber = params.deckCamber * (1 - t) + (activeBowParams.deckCamberBow ?? 0.0) * t;
            const fadeToStem = Math.cos((Math.PI / 2) * t);
            const camber = Math.max(0, activeCamber * fadeToStem);
            const baseEdgeY = topY + (activeBowParams.bowSheer ?? 0.0) * sheerBlend;
            const ySheer = (i === 0) ? yStemDeck : (baseEdgeY * (1 - sheerBlend) + yStemDeck * sheerBlend);
            const y3d = ySheer + camber;

            const safeX = Number.isFinite(x3d) ? x3d : params.length / 2;
            const safeY = Number.isFinite(y3d) ? y3d : topY;
            const safeZ = Number.isFinite(z3d) ? z3d : 0;
            const pos = new THREE.Vector3(safeX, safeY, safeZ);
            polygonPts.push(pos);

            const isSelected = i === currentSelectedIdx;

            // Цвета точек: P0 (бирюзовый), P1 (циановый), P2 (янтарный/оранжевый), P3 (синий), P4 (серый замкнутый якорь)
            const ptColors = [0x38bdf8, 0x06b6d4, 0xf59e0b, 0x0284c7, 0x64748b];
            const color = isSelected ? 0xf59e0b : (ptColors[i] ?? 0x06b6d4);

            const sphereRadius = isSelected ? 0.16 : 0.12;
            const sphereGeom = new THREE.SphereGeometry(sphereRadius, 20, 20);
            const sphereMat = new THREE.MeshStandardMaterial({
              color,
              roughness: 0.2,
              metalness: 0.6,
              emissive: color,
              emissiveIntensity: isSelected ? 0.9 : 0.4,
            });
            const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
            sphereMesh.position.copy(pos);
            sphereMesh.userData = { isControlPoint: true, pointIndex: i };

            const hitGeom = new THREE.SphereGeometry(0.4, 12, 12);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false });
            const hitMesh = new THREE.Mesh(hitGeom, hitMat);
            hitMesh.userData = { isControlPoint: true, pointIndex: i };
            sphereMesh.add(hitMesh);

            const meta = pointMeta[i] || { name: `P${i}`, sub: '' };
            const textSprite = createTextSprite(meta.name, meta.sub, isSelected);
            textSprite.position.set(0, isSelected ? 1.8 : 1.3, 0);
            sphereMesh.add(textSprite);

            points3DGroup.add(sphereMesh);

            // 3D Transform Gizmo (Стрелки и Плоскость) для выбранной активной точки (P0, P1, P2, P3)
            if (isSelected && i !== 4 && (bowEditStep === 'shaping' || bowEditStep === 'deck')) {
              const gizmo = create3DTransformGizmo(i, pos);
              points3DGroup.add(gizmo);
            }
          });
        }

        // Опорный полигон Безье в 3D (пунктирный/яркий каркас между точками)
        if (polygonPts.length > 1) {
          const validPts = polygonPts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
          if (validPts.length > 1) {
            const polyGeom = new THREE.BufferGeometry().setFromPoints(validPts);
            const polyMat = new THREE.LineBasicMaterial({
              color: 0x06b6d4,
              linewidth: 2,
              transparent: true,
              opacity: 0.75,
            });
            const polyLine = new THREE.Line(polyGeom, polyMat);
            points3DGroup.add(polyLine);
          }
        }

        frontGroup.add(points3DGroup);
        bowControlPoints3DGroupRef.current = points3DGroup;
      }

      // ──────────────────────────────────────────────────────────────────────────
      // 3D-ОТОБРАЖЕНИЕ ФОРШТЕВНЯ В ДИАМЕТРАЛЬНОЙ ПЛОСКОСТИ (Z = 0)
      // ──────────────────────────────────────────────────────────────────────────
      const stem3DGroup = new THREE.Group();
      const stemProfile = activeBowParams.stemProfile || DEFAULT_STEM_PARAMS;
      const stemPts = calculateStemTopologyPoints(stemProfile, params.draft, totalHeightSide, effectiveBowLength);
      const stemZones = sampleStemCurveZones(stemPts, 40, effectiveBowLength);

      // 1. Отрисовка 3D-трубок Безье по 3 функциональным зонам форштевня (всегда отображается)
      // Зона 1: Волнорез (Палуба → КВЛ) — Небесно-голубой
      const z1Pts = stemZones.zone1_wavebreaker.map((pt) => new THREE.Vector3(xStem + pt.x, keelY + pt.z, 0));
      if (z1Pts.length > 1) {
        const tube1 = createContourTubeMesh(z1Pts, 0.08, STEM_ZONES.wavebreaker.color3D);
        stem3DGroup.add(tube1);
      }

      // Зона 2: Пятка и бульб (КВЛ → Пятка) — Изумрудно-зеленый
      const z2Pts = stemZones.zone2_forefoot.map((pt) => new THREE.Vector3(xStem + pt.x, keelY + pt.z, 0));
      if (z2Pts.length > 1) {
        const tube2 = createContourTubeMesh(z2Pts, 0.08, STEM_ZONES.forefoot.color3D);
        stem3DGroup.add(tube2);
      }

      // Зона 3: Носовое плечо (Пятка → Стык с миделем) — Янтарно-оранжевый
      const z3Pts = stemZones.zone3_shoulder.map((pt) => new THREE.Vector3(xStem + pt.x, keelY + pt.z, 0));
      if (z3Pts.length > 1) {
        const tube3 = createContourTubeMesh(z3Pts, 0.08, STEM_ZONES.shoulder.color3D);
        stem3DGroup.add(tube3);
      }

      // 2. 3D Опорный многоугольник Безье и точки S0..S8 (в режиме редактирования форштевня)
      if (bowEditStep === 'stem') {
        const polygon3DPts = stemZones.controlPolygon.map(
          (node) => new THREE.Vector3(xStem + node.point.x, keelY + node.point.z, 0)
        );
        if (polygon3DPts.length > 1) {
          const polyGeom = new THREE.BufferGeometry().setFromPoints(polygon3DPts);
          const polyMat = new THREE.LineDashedMaterial({
            color: 0x94a3b8,
            dashSize: 0.6,
            gapSize: 0.35,
            transparent: true,
            opacity: 0.75,
          });
          const polyLine = new THREE.Line(polyGeom, polyMat);
          polyLine.computeLineDistances();
          stem3DGroup.add(polyLine);
        }

        // 3. 9 Ключевых и контрольных точек Bezier-сплайна форштевня (S0..S8)
        const STEM_LABELS_RU: Record<StemPointKey, { indexName: string; name: string }> = {
          PT_STEM_DECK: { indexName: 'S0', name: 'Палуба' },
          CTRL_STEM_UPPER: { indexName: 'S1', name: 'Кас. палубы (Угол)' },
          PT_STEM_KNUCKLE: { indexName: 'S2', name: 'Кнакл (Излом)' },
          PT_STEM_DWL: { indexName: 'S3', name: 'КВЛ (Фикс)' },
          CTRL_STEM_BULB_UPPER: { indexName: 'S4', name: 'Кас. КВЛ-бульб (Угол)' },
          PT_BULB_APEX: { indexName: 'S5', name: 'Носок бульба' },
          CTRL_STEM_BULB_LOWER: { indexName: 'S6', name: 'Кас. бульб-пятка (Угол)' },
          PT_FOREFOOT: { indexName: 'S7', name: 'Пятка' },
          PT_KEEL_TANGENT: { indexName: 'S8', name: 'Линия киля' },
        };

        const curDeckTangentAngle = stemProfile.deckTangentAngle ?? (stemProfile.stemRakeAngle + stemProfile.stemAboveCurvature * 25);
        const curBulbUpperAngle = stemProfile.bulbUpperTangentAngle ?? 55;
        const curBulbLowerAngle = stemProfile.bulbLowerTangentAngle ?? 55;

        (Object.entries(stemPts) as [StemPointKey, { x: number; z: number }][]).forEach(([key, pt]) => {
          const pos = new THREE.Vector3(xStem + pt.x, keelY + pt.z, 0);
          const isSel = selectedStemPointKey === key;
          const isCtrl = key.startsWith('CTRL_');
          const isDwl = key === 'PT_STEM_DWL';
          const meta = STEM_LABELS_RU[key];
          
          let color = 0x06b6d4;
          if (isSel) color = 0xf59e0b;
          else if (isDwl) color = 0x94a3b8;
          else if (isCtrl) color = 0xc084fc;
          else if (key === 'PT_STEM_DECK' || key === 'PT_STEM_KNUCKLE') color = STEM_ZONES.wavebreaker.color3D;
          else if (key === 'PT_BULB_APEX' || key === 'PT_FOREFOOT') color = STEM_ZONES.forefoot.color3D;
          else if (key === 'PT_KEEL_TANGENT') color = STEM_ZONES.shoulder.color3D;

          // Уменьшенные компактные 3D-точки Безье на форштевне
          const sphereGeom = new THREE.SphereGeometry(isSel ? 0.16 : isCtrl ? 0.10 : 0.12, 16, 16);
          const sphereMat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: isSel ? 0.9 : 0.4,
            roughness: 0.2,
          });
          const sphere = new THREE.Mesh(sphereGeom, sphereMat);
          sphere.position.copy(pos);
          sphere.userData = { isStemPoint: true, stemKey: key };

          // Аккуратный хит-бокс для точного и комфортного захвата мышью в 3D
          const hitGeom = new THREE.SphereGeometry(0.45, 12, 12);
          const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false });
          const hitMesh = new THREE.Mesh(hitGeom, hitMat);
          hitMesh.userData = { isStemPoint: true, stemKey: key };
          sphere.add(hitMesh);

          // Текстовый бейдж над точкой в 3D при выборе
          if (isSel) {
            const labelTitle = meta ? `${meta.indexName}: ${meta.name}` : key;
            let subText = '';
            if (key === 'CTRL_STEM_UPPER') subText = `⟳ ${curDeckTangentAngle.toFixed(1)}° (Скролл)`;
            else if (key === 'CTRL_STEM_BULB_UPPER') subText = `⟳ ${curBulbUpperAngle.toFixed(1)}° (Скролл)`;
            else if (key === 'CTRL_STEM_BULB_LOWER') subText = `⟳ ${curBulbLowerAngle.toFixed(1)}° (Скролл)`;
            else subText = `X: ${pt.x >= 0 ? '+' : ''}${pt.x.toFixed(2)}м  Z: ${pt.z.toFixed(2)}м`;

            const textSprite = createTextSprite(labelTitle, subText, true);
            textSprite.position.set(0, 1.4, 0);
            sphere.add(textSprite);
          }

          stem3DGroup.add(sphere);

          // 3D Transform Gizmo (Стрелки X/Y и Вращение) и Красная Траектория с лимитными точками для выбранной точки форштевня
          if (isSel && !isDwl && bowEditStep === 'stem') {
            let gizmoAngle: number | undefined = undefined;
            if (key === 'CTRL_STEM_UPPER') gizmoAngle = curDeckTangentAngle;
            else if (key === 'CTRL_STEM_BULB_UPPER') gizmoAngle = curBulbUpperAngle;
            else if (key === 'CTRL_STEM_BULB_LOWER') gizmoAngle = curBulbLowerAngle;

            const isRot = key.startsWith('CTRL_');
            let allowedAxes: 'x' | 'y' | 'both' | 'rotation' | 'none' = 'both';

            if (selectedStemParamId && STEM_PARAM_AXIS_MAP[selectedStemParamId]) {
              // 1. Выбор через параметр из UI -> показываем строго одно направление (X, Y или вращение)
              allowedAxes = STEM_PARAM_AXIS_MAP[selectedStemParamId];
            } else {
              // 2. Выбор напрямую через клик в 3D -> показываем ВСЕ доступные и возможные направления
              allowedAxes = isRot ? 'rotation' : key === 'PT_KEEL_TANGENT' ? 'x' : 'both';
            }

            // 1. Отображение красной траектории и лимитных точек перемещения для выбранных осей
            const trajectoryMesh = createTrajectoryAndLimitsMesh(
              key,
              pos,
              stemPts,
              xStem,
              keelY,
              params.draft,
              totalHeightSide,
              effectiveBowLength,
              allowedAxes
            );
            stem3DGroup.add(trajectoryMesh);

            const stemGizmo = create3DStemTransformGizmo(key, pos, gizmoAngle, allowedAxes);
            stem3DGroup.add(stemGizmo);
          }
        });
      }

      frontGroup.add(stem3DGroup);
      stem3DGroupRef.current = stem3DGroup;

      // ──────────────────────────────────────────────────────────────────────────
      // ПЛАВАЮЩИЕ 3D-ПЛАШКИ СО СЛОВАМИ ДЛЯ КЛЮЧЕВЫХ ЛИНИЙ И ОБЛАСТЕЙ КОРПУСА
      // (*Верхняя палуба, Форштевень, Бульб и пятка, Линия киля)
      // Отображаются только в режиме общего обзора, чтобы не дублировать и не перекрывать плашки точек
      // ──────────────────────────────────────────────────────────────────────────
      if (showLineLabels && (bowEditStep === 'none' || bowEditStep === 'length')) {
        const floatingLabelsGroup = new THREE.Group();

        // 1. Линия верхней палубы
        if (deckLoopPts.length > 4) {
          const sampleIdx = Math.floor(deckLoopPts.length * 0.28);
          const anchorPt = deckLoopPts[sampleIdx];
          const badgePos = new THREE.Vector3(anchorPt.x, anchorPt.y + 0.95, anchorPt.z + 0.6);
          const leaderLine = createCalloutLeaderLine(anchorPt, badgePos, 0x38bdf8);
          const badgeSprite = createFloatingCalloutBadge('Верхняя палуба', 'Планширь борта', '#38bdf8');
          badgeSprite.position.copy(badgePos);
          floatingLabelsGroup.add(leaderLine);
          floatingLabelsGroup.add(badgeSprite);
        }

        // 2. Линия форштевня (Волнорезная часть / ДП)
        if (z1Pts.length > 1) {
          const midIdx = Math.floor(z1Pts.length * 0.5);
          const anchorPt = z1Pts[midIdx];
          const badgePos = new THREE.Vector3(anchorPt.x + 1.4, anchorPt.y + 0.4, anchorPt.z);
          const leaderLine = createCalloutLeaderLine(anchorPt, badgePos, 0x06b6d4);
          const badgeSprite = createFloatingCalloutBadge('Форштевень', 'Линия штевня (ДП)', '#06b6d4');
          badgeSprite.position.copy(badgePos);
          floatingLabelsGroup.add(leaderLine);
          floatingLabelsGroup.add(badgeSprite);
        }

        // 3. Область бульба и пятки (зеленая функциональная зона)
        if (z2Pts.length > 1) {
          const apexIdx = Math.floor(z2Pts.length * 0.45);
          const anchorPt = z2Pts[apexIdx];
          const badgePos = new THREE.Vector3(anchorPt.x + 1.5, anchorPt.y - 0.25, anchorPt.z);
          const leaderLine = createCalloutLeaderLine(anchorPt, badgePos, 0x10b981);
          const badgeSprite = createFloatingCalloutBadge('Бульб и пятка', 'Зона сопряжения', '#10b981');
          badgeSprite.position.copy(badgePos);
          floatingLabelsGroup.add(leaderLine);
          floatingLabelsGroup.add(badgeSprite);
        }

        // 4. Линия киля (Носовое плечо)
        if (z3Pts.length > 1) {
          const keelIdx = Math.floor(z3Pts.length * 0.4);
          const anchorPt = z3Pts[keelIdx];
          const badgePos = new THREE.Vector3(anchorPt.x - 0.7, anchorPt.y - 0.85, anchorPt.z);
          const leaderLine = createCalloutLeaderLine(anchorPt, badgePos, 0xf59e0b);
          const badgeSprite = createFloatingCalloutBadge('Линия киля', 'Носовое плечо', '#f59e0b');
          badgeSprite.position.copy(badgePos);
          floatingLabelsGroup.add(leaderLine);
          floatingLabelsGroup.add(badgeSprite);
        }

        frontGroup.add(floatingLabelsGroup);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // 3D-ОТОБРАЖЕНИЕ ПОПЕРЕЧНОГО СЕЧЕНИЯ НОСА (BOW SECTION)
      // ──────────────────────────────────────────────────────────────────────────
      if (bowEditStep === 'volume' || bowEditStep === 'shaping') {
        const bowSectionParams = activeBowParams.bowSection || {
          bottomTangentAngle: 15,
          sideTangentAngle: 15,
          flareTangentAngle: 30,
          bilgeRadius: params.radius * 0.8,
        };
        const activeZLevel = activeMasterWaterline === 'bilge' ? 0.005 : params.draft;
        const currentMidBreadth = getTheoreticalMidshipHalfBreadthAtZ(activeZLevel, {
          width: params.width,
          height: params.height,
          radius: params.radius,
          flare: params.flare,
          deadrise: params.deadrise,
          deckCamber: params.deckCamber,
          sheerRadius: params.sheerRadius,
          deadriseInHeight: params.deadriseInHeight,
          deckCamberInHeight: params.deckCamberInHeight,
        });

        const xStemTip = xStem; // front tip
        const xMidCut = params.length / 2 - effectiveBowLength; // back end of bow
        const activeVolParams = extractBowVolumeParams(activeBowParams);
        const bottomFlatRun = activeVolParams.bottomFlatRun;

        const activeSectionTopology = bowSectionTopology ?? calculateBowSectionTopology({
          xMidCut,
          xStemTip,
          effectiveBowLen: effectiveBowLength,
          bottomFlatRun,
          volParams: activeVolParams,
          bowParams: activeBowParams,
          hullParams: params,
          keelY,
          totalHeight: totalHeightSide,
          bottomZeroX: params.length / 2 + (stemPts.PT_FOREFOOT.z <= 0.05 ? stemPts.PT_FOREFOOT.x : stemPts.PT_KEEL_TANGENT.x),
        });

        const bowSectionGroup = createBowSection3DGroup(
          activeSectionTopology,
          selectedBowSectionPointKey
        );
        frontGroup.add(bowSectionGroup);
        bowSection3DGroupRef.current = bowSectionGroup;
      }
    }

    scene.add(group);
    brusContainerRef.current = group;
    rearGroupRef.current = rearGroup;
    frontGroupRef.current = frontGroup;

    // 3D-контур разреза и симметричные ветви
    const contour3D = getCrossSectionContour3D({
      width: params.width,
      height: params.height,
      radius: params.radius,
      flare: params.flare,
      deadrise: params.deadrise,
      deadriseInHeight: params.deadriseInHeight,
      deckCamber: params.deckCamber,
      deckCamberInHeight: params.deckCamberInHeight,
      sheerRadius: params.sheerRadius,
      showDeckCover: params.showDeckCover,
    });

    const dualBranches = getCrossSectionHalfBranches3D({
      width: params.width,
      height: params.height,
      radius: params.radius,
      flare: params.flare,
      deadrise: params.deadrise,
      deadriseInHeight: params.deadriseInHeight,
      deckCamber: params.deckCamber,
      deckCamberInHeight: params.deckCamberInHeight,
      sheerRadius: params.sheerRadius,
      showDeckCover: params.showDeckCover,
    });

    // Обновляем контур для синхронной двухсторонней резки / сварки (от киля вверх)
    if (gasCutEffectRef.current) {
      gasCutEffectRef.current.setBranches(dualBranches, params.showDeckCover !== false);
    }

    // Если находимся в процессе или режиме редактирования, добавляем точную черную обводку контура
    if (animState === 'separating' || animState === 'editing' || animState === 'reversing') {
      const activeRadius = animState === 'editing' ? animProgressRef.current.maxTubeRadius : animProgressRef.current.tubeRadius;
      if (activeRadius > 0.005) {
        const tubeMesh = createContourTubeMesh(contour3D, activeRadius, 0x0a0a0a);
        scene.add(tubeMesh);
        tubeMeshRef.current = tubeMesh;
      }
    }
  }, [params, showWireframe, showLineLabels, animState, bowLength, tempBowLength, bowEditStep, hasBowApplied, bowParams, tempBowParams, surfaceRenderMode, selectedPointIndex, selectedStemPointKey, selectedBowSectionPointKey, showBreadthLimits, wireframeDisplay, activeMasterWaterline]);

  // 5. Отрисовка зелёного куба габарита носовой части и 3D размеров по ГОСТ (шаг 1: задание длины)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (bowBoxRef.current) {
      scene.remove(bowBoxRef.current);
      bowBoxRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        } else if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        } else if (child instanceof THREE.Sprite) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
      bowBoxRef.current = null;
    }

    if (bowEditStep === 'length' && tempBowLength > 0) {
      const { keelY, apexY } = calculateVerticalLevels({
        height: params.height,
        deadrise: params.deadrise,
        deckCamber: params.deckCamber,
        deadriseInHeight: params.deadriseInHeight,
        deckCamberInHeight: params.deckCamberInHeight,
      });
      // Добавляем зазор по высоте и ширине для устранения Z-fighting и конфликтов с поверхностями
      const totalHeight = Math.max(0.1, apexY - keelY + 0.6);
      const centerY = (apexY + keelY) / 2;
      const maxTopWidth = Math.max(params.width, params.width + 2 * params.flare);
      const bowWidth = maxTopWidth + 0.8;
      // Длина куба и положение торцов строго по границе носового блока
      const boxLength = Math.max(0.01, tempBowLength);
      const centerX = params.length / 2 - tempBowLength / 2;

      const boxGroup = new THREE.Group();

      // Зелёный полупрозрачный куб
      const geom = new THREE.BoxGeometry(boxLength, totalHeight, bowWidth);
      const solidMat = new THREE.MeshBasicMaterial({
        color: 0x22c55e, // Emerald Green
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const solidBox = new THREE.Mesh(geom, solidMat);
      solidBox.position.set(centerX, centerY, 0);
      boxGroup.add(solidBox);

      // Четкая зелёная каркасная обводка (ребра куба)
      const edgesGeom = new THREE.EdgesGeometry(geom);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x16a34a, // Dark emerald
        linewidth: 2.5,
        transparent: true,
        opacity: 0.95,
      });
      const wireBox = new THREE.LineSegments(edgesGeom, lineMat);
      wireBox.position.set(centerX, centerY, 0);
      boxGroup.add(wireBox);

      // ─────────────────────────────────────────────────────────────
      // РАЗМЕРЫ ПО ГОСТ 2.307-2011 (ЕСКД) В 3D ПРОСТРАНСТВЕ
      // ─────────────────────────────────────────────────────────────
      const maxHalfWidth = maxTopWidth / 2;
      const dwlY = keelY + params.draft;
      const xStern = -params.length / 2;
      const xBow = params.length / 2;
      const xCut = params.length / 2 - tempBowLength;

      // 1. РАЗМЕР 2: ДЛИНА НОСОВОЙ ЧАСТИ (L_bow) — ближе к брусу и зелёному кубу
      const bowDimZ = maxHalfWidth + 2.2;
      const bowDimGroup = createGostDimension3D({
        startX: xCut,
        endX: xBow,
        dimY: dwlY,
        dimZ: bowDimZ,
        featureY: dwlY,
        featureZ: maxHalfWidth + 0.4,
        valueText: `L_носа = ${tempBowLength.toFixed(2)} м`,
        subText: `${((tempBowLength / params.length) * 100).toFixed(1)}% от длины судна`,
        badgeTitle: 'ДЛИНА НОСА (L_BOW)',
        color: 0x22c55e, // Яркий изумрудный
        accentColor: '#22c55e',
        bgColor: 'rgba(5, 46, 22, 0.94)',
        lineRadius: 0.04,
        extensionOverhang: 0.9,
        arrowScale: 1.1,
      });
      boxGroup.add(bowDimGroup);

      // 2. РАЗМЕР 1: ДЛИНА СУДНА ПО КВЛ (L_квл) — дальше от бруса
      const shipDimZ = maxHalfWidth + 5.8;
      const shipDimGroup = createGostDimension3D({
        startX: xStern,
        endX: xBow,
        dimY: dwlY,
        dimZ: shipDimZ,
        featureY: dwlY,
        featureZ: maxHalfWidth + 0.4,
        valueText: `L_квл = ${params.length.toFixed(2)} м`,
        subText: 'Полная длина судна по КВЛ',
        badgeTitle: 'ДЛИНА СУДНА (L_КВЛ)',
        color: 0x06b6d4, // Яркий лазурный
        accentColor: '#06b6d4',
        bgColor: 'rgba(8, 51, 68, 0.94)',
        lineRadius: 0.04,
        extensionOverhang: 0.9,
        arrowScale: 1.2,
      });
      boxGroup.add(shipDimGroup);

      scene.add(boxGroup);
      bowBoxRef.current = boxGroup;
    }
  }, [bowEditStep, tempBowLength, params]);

  // 6. Интерактивное перемещение контрольных точек P0..P3 прямо на 3D модели носовой палубы
  useEffect(() => {
    const dom = rendererRef.current?.domElement;
    if (!dom) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dragPlane = new THREE.Plane();
    const intersectionPoint = new THREE.Vector3();
    const dragStartStem3DIntersection = new THREE.Vector3();
    let dragStartStem3DParams: StemProfileParams = DEFAULT_STEM_PARAMS;
    let dragStartStem3DPts: StemTopologyPoints | null = null;
    let dragStartStem3DAngle = 18;
    const dragStartBowSection3DIntersection = new THREE.Vector3();
    let dragStartBowSectionParams: BowParameters = tempBowParamsRef.current;
    let draggedBowSectionPointKey: BowSectionKey | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // Строго только ЛКМ (левая кнопка мыши)
      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!cameraRef.current) return;
      raycaster.setFromCamera(mouse, cameraRef.current);

      if ((bowEditStepRef.current === 'shaping' || bowEditStepRef.current === 'deck' || bowEditStepRef.current === 'volume') && bowControlPoints3DGroupRef.current) {
        const hits = raycaster.intersectObjects(bowControlPoints3DGroupRef.current.children, true);
        const hitGizmo = hits.find((h) => h.object.userData?.isGizmo);
        const hitPt = hits.find((h) => h.object.userData?.isControlPoint);

        if (hitGizmo) {
          const pIdx = hitGizmo.object.userData.pointIndex;
          let axis = (hitGizmo.object.userData.axis || 'both') as 'x' | 'z' | 'both';
          if (pIdx === 3) axis = 'x';
          if (pIdx !== 4 && typeof pIdx === 'number') {
            dragged3DPointIndexRef.current = pIdx;
            draggedGizmoAxisRef.current = axis;
            setSelectedPointIndex(pIdx);
            if (controlsRef.current) controlsRef.current.enabled = false;
            dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hitGizmo.point);
            try {
              dom.setPointerCapture(e.pointerId);
            } catch {
              // ignore
            }
            e.preventDefault();
          }
        } else if (hitPt) {
          const pIdx = hitPt.object.userData.pointIndex;
          if (typeof pIdx === 'number') {
            setSelectedPointIndex(pIdx);
            // Точка P4 зафиксирована; P3 только по X (вперед/назад), P0, P1 и P2 по плоскости
            if (pIdx !== 4) {
              dragged3DPointIndexRef.current = pIdx;
              draggedGizmoAxisRef.current = pIdx === 3 ? 'x' : 'both';
              if (controlsRef.current) controlsRef.current.enabled = false;
              dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hitPt.point);
              try {
                dom.setPointerCapture(e.pointerId);
              } catch {
                // ignore
              }
              e.preventDefault();
            }
          }
        }
      } else if (bowEditStepRef.current === 'stem' && stem3DGroupRef.current) {
        const hits = raycaster.intersectObjects(stem3DGroupRef.current.children, true);
        const hitGizmo = hits.find((h) => h.object.userData?.isStemGizmo);
        const hitStem = hits.find((h) => h.object.userData?.isStemPoint);

        if (hitGizmo) {
          const key = hitGizmo.object.userData.stemKey as StemPointKey;
          let axis = (hitGizmo.object.userData.axis || 'both') as 'x' | 'y' | 'both';
          if (key === 'PT_KEEL_TANGENT') {
            axis = 'x';
          }
          if (key !== 'PT_STEM_DWL') {
            setSelectedStemPointKey(key);
            draggedStemPointKeyRef.current = key;
            draggedStemGizmoAxisRef.current = axis;
            if (controlsRef.current) controlsRef.current.enabled = false;
            // Плоскость ДП (Z = 0) с нормалью (0, 0, 1)
            dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0));
            if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
              dragStartStem3DIntersection.copy(intersectionPoint);
            } else {
              dragStartStem3DIntersection.copy(hitGizmo.point);
            }
            dragStartStem3DParams = { ...(tempBowParamsRef.current.stemProfile || DEFAULT_STEM_PARAMS) };
            dragStartBowLengthRef.current = tempBowLengthRef.current || bowLengthRef.current || 25;
            const currParams = paramsRef.current;
            const { keelY: cKeelY, topY: cTopY } = calculateVerticalLevels({
              height: currParams.height,
              deadrise: currParams.deadrise,
              deckCamber: currParams.deckCamber,
              deadriseInHeight: currParams.deadriseInHeight,
              deckCamberInHeight: currParams.deckCamberInHeight,
            });
            const cTotalHeight = cTopY - cKeelY;
            dragStartStem3DPts = calculateStemTopologyPoints(dragStartStem3DParams, currParams.draft, cTotalHeight, dragStartBowLengthRef.current);
            const currStemProf = tempBowParamsRef.current.stemProfile || DEFAULT_STEM_PARAMS;
            if (key === 'CTRL_STEM_UPPER') {
              dragStartStem3DAngle = currStemProf.deckTangentAngle ?? (currStemProf.stemRakeAngle + currStemProf.stemAboveCurvature * 25);
            } else if (key === 'CTRL_STEM_BULB_UPPER') {
              dragStartStem3DAngle = currStemProf.bulbUpperTangentAngle ?? 55;
            } else if (key === 'CTRL_STEM_BULB_LOWER') {
              dragStartStem3DAngle = currStemProf.bulbLowerTangentAngle ?? 55;
            }
            try {
              dom.setPointerCapture(e.pointerId);
            } catch {
              // ignore
            }
            e.preventDefault();
          }
        } else if (hitStem) {
          const key = hitStem.object.userData.stemKey as StemPointKey;
          setSelectedStemPointKey(key);
          setSelectedStemParamId(null);
          // Точка КВЛ (PT_STEM_DWL) жестко зафиксирована и не двигается
          if (key !== 'PT_STEM_DWL') {
            draggedStemPointKeyRef.current = key;
            draggedStemGizmoAxisRef.current = (key === 'PT_KEEL_TANGENT') ? 'x' : 'both';
            if (controlsRef.current) controlsRef.current.enabled = false;
            // Плоскость ДП (Z = 0) с нормалью (0, 0, 1)
            dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0));
            if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
              dragStartStem3DIntersection.copy(intersectionPoint);
            } else {
              dragStartStem3DIntersection.copy(hitStem.point);
            }
            dragStartStem3DParams = { ...(tempBowParamsRef.current.stemProfile || DEFAULT_STEM_PARAMS) };
            dragStartBowLengthRef.current = tempBowLengthRef.current || bowLengthRef.current || 25;
            const currParams = paramsRef.current;
            const { keelY: cKeelY, topY: cTopY } = calculateVerticalLevels({
              height: currParams.height,
              deadrise: currParams.deadrise,
              deckCamber: currParams.deckCamber,
              deadriseInHeight: currParams.deadriseInHeight,
              deckCamberInHeight: currParams.deckCamberInHeight,
            });
            const cTotalHeight = cTopY - cKeelY;
            dragStartStem3DPts = calculateStemTopologyPoints(dragStartStem3DParams, currParams.draft, cTotalHeight, dragStartBowLengthRef.current);
            const currStemProf = tempBowParamsRef.current.stemProfile || DEFAULT_STEM_PARAMS;
            if (key === 'CTRL_STEM_UPPER') {
              dragStartStem3DAngle = currStemProf.deckTangentAngle ?? (currStemProf.stemRakeAngle + currStemProf.stemAboveCurvature * 25);
            } else if (key === 'CTRL_STEM_BULB_UPPER') {
              dragStartStem3DAngle = currStemProf.bulbUpperTangentAngle ?? 55;
            } else if (key === 'CTRL_STEM_BULB_LOWER') {
              dragStartStem3DAngle = currStemProf.bulbLowerTangentAngle ?? 55;
            }
            try {
              dom.setPointerCapture(e.pointerId);
            } catch {
              // ignore
            }
            e.preventDefault();
          }
        }
      } else if ((bowEditStepRef.current === 'volume' || bowEditStepRef.current === 'shaping') && bowSection3DGroupRef.current) {
        const hits = raycaster.intersectObjects(bowSection3DGroupRef.current.children, true);
        const hitSectionPt = hits.find((h) => h.object.userData?.isBowSectionPoint);
        if (hitSectionPt) {
          const key = hitSectionPt.object.userData.sectionKey as BowSectionKey;
          setSelectedBowSectionPointKey(key);
          draggedBowSectionPointKey = key;
          dragStartBowSection3DIntersection.copy(hitSectionPt.point);
          dragStartBowSectionParams = { ...tempBowParamsRef.current };
          if (cameraRef.current) {
            dragPlane.setFromNormalAndCoplanarPoint(
              cameraRef.current.getWorldDirection(new THREE.Vector3()).negate(),
              hitSectionPt.point
            );
          }
          if (controlsRef.current) controlsRef.current.enabled = false;
          try {
            dom.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          e.preventDefault();
        }
      }

      // Проверка клика по любой 3D ватерлинии в сцене
      if (sceneRef.current) {
        const sceneHits = raycaster.intersectObjects(sceneRef.current.children, true);
        const hitWl = sceneHits.find((h) => h.object.userData?.isWaterline);
        if (hitWl) {
          const wlId = hitWl.object.userData.waterlineId;
          if (wlId) {
            setSelectedWaterlineId(wlId);
          }
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // 1. Перемещение точек палубы
      if ((bowEditStepRef.current === 'shaping' || bowEditStepRef.current === 'deck') && dragged3DPointIndexRef.current !== null && cameraRef.current) {
        if ((e.buttons & 1) === 0) {
          dragged3DPointIndexRef.current = null;
          draggedGizmoAxisRef.current = null;
          if (controlsRef.current) controlsRef.current.enabled = true;
          return;
        }

        const pIdx = dragged3DPointIndexRef.current;
        if (pIdx === 4) return;

        raycaster.setFromCamera(mouse, cameraRef.current);
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
          const currentParams = paramsRef.current;
          const currentBowParams = tempBowParamsRef.current;
          const effectiveBowLength = tempBowLengthRef.current || bowLengthRef.current;
          const effectiveBowSpan = Math.max(1, effectiveBowLength);
          const yMidDeck = currentParams.width / 2 + currentParams.flare;

          const axis = draggedGizmoAxisRef.current || (pIdx === 0 ? 'z' : pIdx === 3 ? 'x' : 'both');
          const updates: Partial<BowParameters> = {};

          const xStem = currentParams.length / 2;
          const shipX = intersectionPoint.x - xStem;
          const shipY = Math.max(0, Math.abs(intersectionPoint.z));

          if (pIdx === 0) {
            // Управление форштевнем P0 (одновременно как с палубы, так и с форпика):
            // 1. По ширине Z -> stemWidth (притупление носа)
            if (axis === 'z' || axis === 'both') {
              const maxStemWidth = Number((yMidDeck * 0.9).toFixed(2));
              const newStemWidth = Math.max(0, Math.min(maxStemWidth, Number((shipY * 2).toFixed(2))));
              if (Number.isFinite(newStemWidth)) {
                updates.stemWidth = newStemWidth;
              }
            }
            // 2. По длине X -> вылет носа / свес форштевня (deckOverhang в stemProfile)
            if (axis === 'x' || axis === 'both') {
              const curStem = currentBowParams.stemProfile || DEFAULT_STEM_PARAMS;
              const { keelY, topY } = calculateVerticalLevels({
                height: currentParams.height,
                deadrise: currentParams.deadrise,
                deckCamber: currentParams.deckCamber,
                deadriseInHeight: currentParams.deadriseInHeight,
                deckCamberInHeight: currentParams.deckCamberInHeight,
              });
              const totalHeightSide = topY - keelY;
              const safeDraft = Math.max(0.5, currentParams.draft || 4.5);
              const freeboard = Math.max(0.5, totalHeightSide - safeDraft);
              const rakeAngle = Number.isFinite(curStem.stemRakeAngle) ? curStem.stemRakeAngle : 16;
              const rakeRad = (rakeAngle * Math.PI) / 180;
              const rawOverhang = shipX - freeboard * Math.tan(rakeRad);
              const newOverhang = Number(Math.max(-5, Math.min(10, rawOverhang)).toFixed(2));
              const safeNewOverhang = Number.isFinite(newOverhang) ? newOverhang : 0;
              updates.stemProfile = {
                ...curStem,
                deckOverhang: safeNewOverhang,
              };
              updates.stemRake = safeNewOverhang;
            }
            updates.controlPoints = undefined;
          } else {
            const { controlPoints: pts } = calculateBowWaterplaneCoeff(
              effectiveBowSpan,
              yMidDeck,
              (currentBowParams.stemWidth ?? 0) / 2,
              0,
              currentBowParams.entranceAngle ?? 30,
              currentBowParams.shoulderFullness ?? 0.7,
              currentBowParams.maxBreadthPos ?? 0.5,
              currentBowParams.controlPoints
            );

            const updatedPoints = pts.map((p) => ({ ...p }));
            let targetX = updatedPoints[pIdx].x;
            let targetY = updatedPoints[pIdx].y;

            if (pIdx === 3) {
              const xVal = Number(Math.max(-effectiveBowSpan, Math.min(0, shipX)).toFixed(2));
              targetX = Number.isFinite(xVal) ? xVal : targetX;
              targetY = yMidDeck;
            } else {
              if (axis === 'x' || axis === 'both') {
                const xVal = Number(Math.max(-effectiveBowSpan, Math.min(0, shipX)).toFixed(2));
                if (Number.isFinite(xVal)) targetX = xVal;
              }
              if (axis === 'z' || axis === 'both') {
                const yVal = Number(Math.max(0, Math.min(yMidDeck * 1.8, shipY)).toFixed(2));
                if (Number.isFinite(yVal)) targetY = yVal;
              }
            }

            updatedPoints[pIdx] = { x: targetX, y: targetY };
            updates.controlPoints = updatedPoints;

            if (pIdx === 1) {
              const dx = Math.abs(targetX - updatedPoints[0].x);
              const dy = Math.abs(targetY - updatedPoints[0].y);
              const angle = Math.max(
                5,
                Math.min(85, (Math.atan2(dy, Math.max(0.01, dx)) * 180) / Math.PI)
              );
              if (Number.isFinite(angle)) {
                updates.entranceAngle = Number(angle.toFixed(1));
              }
            } else if (pIdx === 2) {
              const normX = Math.max(
                0.05,
                Math.min(0.95, 1 - Math.abs(targetX) / effectiveBowSpan)
              );
              if (Number.isFinite(normX)) {
                updates.maxBreadthPos = Number(normX.toFixed(2));
              }
              const fullness = Math.max(0.1, Math.min(1.8, targetY / Math.max(0.1, yMidDeck)));
              if (Number.isFinite(fullness)) {
                updates.shoulderFullness = Number(fullness.toFixed(2));
              }
            }
          }

          setTempBowParams((prev) => ({
            ...prev,
            ...updates,
          }));
        }
      }
      // 1b. Перемещение точек выбранной мастер-ватерлинии (Шаг 4: Объём носа)
      else if (bowEditStepRef.current === 'volume' && dragged3DPointIndexRef.current !== null && cameraRef.current) {
        if ((e.buttons & 1) === 0) {
          dragged3DPointIndexRef.current = null;
          draggedGizmoAxisRef.current = null;
          if (controlsRef.current) controlsRef.current.enabled = true;
          return;
        }

        const pIdx = dragged3DPointIndexRef.current;
        if (pIdx === 4 || pIdx === 0) return; // P0 и P4 зафиксированы

        raycaster.setFromCamera(mouse, cameraRef.current);
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
          const currentParams = paramsRef.current;
          const currentBowParams = tempBowParamsRef.current;
          const effectiveBowLength = tempBowLengthRef.current || bowLengthRef.current;
          const effectiveBowSpan = Math.max(1, effectiveBowLength);
          const axis = draggedGizmoAxisRef.current || (pIdx === 3 ? 'x' : 'both');

          const xStem = currentParams.length / 2;
          const shipX = intersectionPoint.x - xStem;
          const shipZ = Math.max(0.01, Math.abs(intersectionPoint.z));

          const currentVol = extractBowVolumeParams(currentBowParams);
          const updatedVol = { ...currentVol };
          const rootUpdates: Partial<BowParameters> = {};

          const activeWaterline = activeMasterWaterlineRef.current;

          if (activeWaterline === 'dwl') {
            if (pIdx === 1) {
              const dx = Math.max(0.05, -shipX);
              const dz = Math.max(0.01, shipZ - (updatedVol.baseStemWidth / 2));
              const angleDeg = Math.max(5, Math.min(75, Number(((Math.atan2(dz, dx) * 180) / Math.PI).toFixed(1))));
              if (Number.isFinite(angleDeg)) {
                updatedVol.baseEntranceAngle = angleDeg;
                rootUpdates.dwlEntranceAngle = angleDeg;
              }
            } else if (pIdx === 2) {
              if (axis === 'x' || axis === 'both') {
                const normPos = Math.max(0.1, Math.min(0.95, Number((1 - Math.abs(shipX) / effectiveBowSpan).toFixed(2))));
                if (Number.isFinite(normPos)) {
                  updatedVol.shoulderPullback = normPos;
                }
              }
              if (axis === 'z' || axis === 'both') {
                const midHalfB = currentParams.width / 2;
                const fullness = Math.max(0.2, Math.min(1.4, Number((shipZ / Math.max(0.1, midHalfB)).toFixed(2))));
                if (Number.isFinite(fullness)) {
                  updatedVol.baseShoulderFullness = fullness;
                  updatedVol.dwlFullnessBias = Number((fullness - 0.7).toFixed(2));
                }
              }
            } else if (pIdx === 3) {
              const dx3 = Math.max(0.2, Math.min(effectiveBowSpan * 0.85, Number((shipX + effectiveBowSpan).toFixed(2))));
              if (Number.isFinite(dx3)) {
                updatedVol.baseMidTangentLength = dx3;
              }
            }
          } else if (activeWaterline === 'bilge') {
            if (pIdx === 1) {
              const dx = Math.max(0.05, -shipX);
              const dz = Math.max(0.01, shipZ);
              const taperDeg = Math.max(5, Math.min(65, Number(((Math.atan2(dz, dx) * 180) / Math.PI).toFixed(1))));
              if (Number.isFinite(taperDeg)) {
                updatedVol.bottomTaperAngle = taperDeg;
              }
            } else if (pIdx === 2) {
              if (axis === 'x' || axis === 'both') {
                const curvature = Math.max(0.1, Math.min(0.9, Number((1 - Math.abs(shipX) / effectiveBowSpan).toFixed(2))));
                if (Number.isFinite(curvature)) {
                  updatedVol.frameSectionCurvature = curvature;
                }
              }
              if (axis === 'z' || axis === 'both') {
                const midHalfB = currentParams.width / 2;
                const footprint = Math.max(0.3, Math.min(1.2, Number((shipZ / Math.max(0.1, midHalfB)).toFixed(2))));
                if (Number.isFinite(footprint)) {
                  updatedVol.bottomFootprintFullness = footprint;
                }
              }
            } else if (pIdx === 3) {
              const flatRun = Math.max(0.2, Math.min(effectiveBowSpan * 0.85, Number((shipX + effectiveBowSpan).toFixed(2))));
              if (Number.isFinite(flatRun)) {
                updatedVol.bottomFlatRun = flatRun;
              }
            }
          }

          setTempBowParams((prev) => ({
            ...prev,
            ...rootUpdates,
            bowVolume: updatedVol,
            baseStemWidth: updatedVol.baseStemWidth,
            baseEntranceAngle: updatedVol.baseEntranceAngle,
            baseShoulderFullness: updatedVol.baseShoulderFullness,
            baseMidTangentLength: updatedVol.baseMidTangentLength,
            hollowDepth: updatedVol.hollowDepth,
            shoulderPullback: updatedVol.shoulderPullback,
            entranceAngleGradient: updatedVol.entranceAngleGradient,
            dwlFullnessBias: updatedVol.dwlFullnessBias,
            shoulderInflection: updatedVol.shoulderInflection,
            frameSectionCurvature: updatedVol.frameSectionCurvature,
            bottomFlatRun: updatedVol.bottomFlatRun,
            bottomTaperAngle: updatedVol.bottomTaperAngle,
            bottomFootprintFullness: updatedVol.bottomFootprintFullness,
          }));
        }
      }
      // 2. Перемещение 11 точек профиля форштевня в 3D (ДП)
      else if (bowEditStepRef.current === 'stem' && draggedStemPointKeyRef.current && cameraRef.current) {
        if ((e.buttons & 1) === 0) {
          draggedStemPointKeyRef.current = null;
          draggedStemGizmoAxisRef.current = null;
          if (controlsRef.current) controlsRef.current.enabled = true;
          return;
        }

        const key = draggedStemPointKeyRef.current;
        if (key === 'PT_STEM_DWL') {
          // Точка КВЛ не может двигаться
          draggedStemPointKeyRef.current = null;
          draggedStemGizmoAxisRef.current = null;
          return;
        }

        raycaster.setFromCamera(mouse, cameraRef.current);
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
          const currentParams = paramsRef.current;
          const { keelY: curKY, topY: curTY } = calculateVerticalLevels({
            height: currentParams.height,
            deadrise: currentParams.deadrise,
            deckCamber: currentParams.deckCamber,
            deadriseInHeight: currentParams.deadriseInHeight,
            deckCamberInHeight: currentParams.deckCamberInHeight,
          });
          const safeT = Math.max(0.5, currentParams.draft || 4.5);
          const safeH = Math.max(safeT + 0.5, curTY - curKY);
          const axis = draggedStemGizmoAxisRef.current || (key === 'PT_KEEL_TANGENT' ? 'x' : 'both');

          const rawDeltaX = intersectionPoint.x - dragStartStem3DIntersection.x;
          const rawDeltaY = intersectionPoint.y - dragStartStem3DIntersection.y;

          const deltaX = (axis === 'y') ? 0 : rawDeltaX;
          const deltaY = (axis === 'x') ? 0 : rawDeltaY;

          const stemUpdates: Partial<StemProfileParams> = {};

          if (key === 'CTRL_STEM_UPPER' || key === 'CTRL_STEM_BULB_UPPER' || key === 'CTRL_STEM_BULB_LOWER') {
            // Плавное редактирование угла касательных вращением луча
            const xStem = currentParams.length / 2;
            const { keelY, topY } = calculateVerticalLevels({
              height: currentParams.height,
              deadrise: currentParams.deadrise,
              deckCamber: currentParams.deckCamber,
              deadriseInHeight: currentParams.deadriseInHeight,
              deckCamberInHeight: currentParams.deckCamberInHeight,
            });
            const totalH = topY - keelY;
            const stemPts = calculateStemTopologyPoints(dragStartStem3DParams, currentParams.draft, totalH, dragStartBowLengthRef.current);
            
            const centerPt = (key === 'CTRL_STEM_BULB_UPPER' || key === 'CTRL_STEM_BULB_LOWER')
              ? stemPts.PT_BULB_APEX
              : stemPts.PT_STEM_DECK;

            const originX = xStem + centerPt.x;
            const originY = keelY + centerPt.z;
            
            // Векторы от родительской точки (носок бульба или палуба) к начальной и текущей точке луча мыши
            const startDx = dragStartStem3DIntersection.x - originX;
            const startDy = dragStartStem3DIntersection.y - originY;
            const curDx = intersectionPoint.x - originX;
            const curDy = intersectionPoint.y - originY;

            let startAngle = 0;
            let curAngle = 0;

            if (key === 'CTRL_STEM_UPPER') {
              // Касательная палубы: луч от палубы направлен вниз и назад в сторону миделя (-X, -Z)
              startAngle = (Math.atan2(-startDx, -startDy) * 180) / Math.PI;
              curAngle = (Math.atan2(-curDx, -curDy) * 180) / Math.PI;
            } else if (key === 'CTRL_STEM_BULB_UPPER') {
              // Касательная КВЛ-бульб: луч от носка бульба вверх и назад к КВЛ (+dx вперед, +dy вверх)
              startAngle = (Math.atan2(startDx, startDy) * 180) / Math.PI;
              curAngle = (Math.atan2(curDx, curDy) * 180) / Math.PI;
            } else {
              // CTRL_STEM_BULB_LOWER: Касательная бульб-пятка: луч от носка бульба вниз к пятке (+dx вперед, -dy вниз)
              startAngle = (Math.atan2(startDx, -startDy) * 180) / Math.PI;
              curAngle = (Math.atan2(curDx, -curDy) * 180) / Math.PI;
            }

            let deltaAngle = curAngle - startAngle;
            // Корректная нормализация циклического перехода через +/- 180° без скачков
            if (deltaAngle > 180) deltaAngle -= 360;
            if (deltaAngle < -180) deltaAngle += 360;

            const safeAngle = Number(Math.max(-110, Math.min(110, dragStartStem3DAngle + deltaAngle)).toFixed(1));
            
            if (key === 'CTRL_STEM_UPPER') {
              stemUpdates.deckTangentAngle = safeAngle;
            } else if (key === 'CTRL_STEM_BULB_UPPER') {
              stemUpdates.bulbUpperTangentAngle = safeAngle;
            } else if (key === 'CTRL_STEM_BULB_LOWER') {
              stemUpdates.bulbLowerTangentAngle = safeAngle;
            }
          } else {
            // УПРАВЛЯЮЩИЕ ТОЧКИ СПЛАЙНА В 3D: дельта-сдвиг от стартовой позиции точки (без скачков)
            const curStemProf = dragStartStem3DParams;
            const startPts = dragStartStem3DPts || calculateStemTopologyPoints(curStemProf, safeT, safeH, hasBowApplied ? bowLength : 25);
            const startPt = startPts[key];

            const targetX = Number((startPt.x + deltaX).toFixed(2));
            const targetZ = Number((startPt.z + deltaY).toFixed(2));

            if (key === 'PT_STEM_DECK') {
              const clampedZ = Math.max(safeT + 0.1, targetZ);
              const freeboard = Math.max(0.1, clampedZ - safeT);
              const rakeAngle = curStemProf.stemRakeAngle ?? 16;
              const rakeRad = (rakeAngle * Math.PI) / 180;
              stemUpdates.deckHeightOffset = Number((clampedZ - safeH).toFixed(2));
              stemUpdates.deckOverhang = Number((targetX - freeboard * Math.tan(rakeRad)).toFixed(2));
            } else if (key === 'PT_STEM_KNUCKLE') {
              const deckZ = startPts.PT_STEM_DECK.z;
              const clampedZ = Math.max(safeT + 0.05, Math.min(deckZ - 0.05, targetZ));
              const freeboard = Math.max(0.1, deckZ - safeT);
              const eta = Math.max(0.05, Math.min(0.95, (clampedZ - safeT) / freeboard));
              stemUpdates.knuckleHeightRatio = Number(eta.toFixed(2));
              const rakeAngle = curStemProf.stemRakeAngle ?? 16;
              const rakeRad = (rakeAngle * Math.PI) / 180;
              const chordX = (clampedZ - safeT) * Math.tan(rakeRad);
              const curvature = curStemProf.stemAboveCurvature ?? 0.08;
              const curvDeltaX = -curvature * freeboard * 0.35 * Math.sin(Math.PI * eta);
              stemUpdates.knuckleOffset = Number((targetX - chordX - curvDeltaX).toFixed(2));
            } else if (key === 'PT_BULB_APEX') {
              const clampedX = Math.max(-15, Math.min(25, targetX));
              const clampedZ = Math.max(0.05, Math.min(safeT - 0.05, targetZ));
              stemUpdates.bulbLength = Number(clampedX.toFixed(2));
              stemUpdates.bulbHeightRatio = Number((clampedZ / safeT).toFixed(2));
            } else if (key === 'PT_FOREFOOT') {
              const startApexX = startPts.PT_BULB_APEX.x;
              const k_undercut = Number.isFinite(curStemProf.undercutFactor) ? curStemProf.undercutFactor! : 0.35;
              const footBase = startApexX > 0 ? startApexX * k_undercut : startApexX;
              const rFoot = Math.max(0, footBase - targetX);
              stemUpdates.forefootRadius = Number(rFoot.toFixed(2));
              // Точка Пятка априори имеет Z = 0, оператор может корректировать её по высоте
              const clampedZ = Math.max(0.0, Math.min(safeT * 0.85, targetZ));
              // Магнитное прилипание к линии киля (Z=0.0) при опускании близко к днищу
              const snappedZ = clampedZ < 0.06 ? 0.0 : clampedZ;
              stemUpdates.forefootHeightRatio = Number((snappedZ / safeT).toFixed(2));
            } else if (key === 'PT_KEEL_TANGENT') {
              const footX = startPts.PT_FOREFOOT.x;
              const keelLen = Math.max(0.5, Math.min(tempBowLength, footX - targetX));
              stemUpdates.keelTransitionLength = Number(keelLen.toFixed(2));
            }
          }

          setTempBowParams((prev) => {
            const nextStemProfile = {
              ...(prev.stemProfile || DEFAULT_STEM_PARAMS),
              ...stemUpdates,
            };
            return {
              ...prev,
              stemRake: nextStemProfile.deckOverhang ?? prev.stemRake ?? 0,
              stemProfile: nextStemProfile,
            };
          });
        }
      } else if ((bowEditStepRef.current === 'volume' || bowEditStepRef.current === 'shaping') && draggedBowSectionPointKey !== null && cameraRef.current) {
        if ((e.buttons & 1) === 0) {
          draggedBowSectionPointKey = null;
          if (controlsRef.current) controlsRef.current.enabled = true;
          return;
        }

        raycaster.setFromCamera(mouse, cameraRef.current);
        if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
          const key = draggedBowSectionPointKey;
          const startPt = dragStartBowSection3DIntersection;
          const deltaX = intersectionPoint.x - startPt.x;
          const deltaZ = Math.abs(intersectionPoint.z) - Math.abs(startPt.z);
          const deltaY = intersectionPoint.y - startPt.y;

          const startVol = extractBowVolumeParams(dragStartBowSectionParams);
          const updatedVol: BowVolumeParameters = { ...startVol };

          if (key === 'PT_SEC_STEM') {
            const curOffset = startVol.sectionXOffset ?? 0;
            updatedVol.sectionXOffset = Number((curOffset + deltaX).toFixed(2));
          } else if (key === 'wl_deck' || key === 'PT_SEC_DECK') {
            const curAngle = startVol.sectionDeckAngle ?? 15.0;
            updatedVol.sectionDeckAngle = Math.max(-45, Math.min(45, Number((curAngle + deltaZ * 12).toFixed(1))));
          } else if (key === 'wl_above_1' || key === 'CTRL_SEC_UPPER') {
            const curAngle = startVol.sectionUpperRoundAngle ?? 45.0;
            updatedVol.sectionUpperRoundAngle = Math.max(-90, Math.min(90, Number((curAngle + deltaZ * 15).toFixed(1))));
          } else if (key === 'wl_dwl' || key === 'PT_SEC_DWL' || key === 'PT_SEC_TANGENT') {
            const curFullness = startVol.baseShoulderFullness ?? 0.70;
            updatedVol.baseShoulderFullness = Math.max(0.2, Math.min(1.4, Number((curFullness + deltaZ * 0.4).toFixed(2))));
            const curTang = startVol.sectionTangentPoint ?? 0.50;
            if (Math.abs(deltaY) > 0.1) {
              updatedVol.sectionTangentPoint = Math.max(0.15, Math.min(0.85, Number((curTang + deltaY * 0.1).toFixed(2))));
            }
          } else if (key === 'wl_under_1' || key === 'CTRL_SEC_LOWER') {
            const curAngle = startVol.sectionLowerRoundAngle ?? 45.0;
            updatedVol.sectionLowerRoundAngle = Math.max(-90, Math.min(90, Number((curAngle + deltaZ * 15).toFixed(1))));
          } else if (key === 'wl_under_2') {
            const curAngle = startVol.sectionStemEntryAngle ?? 30.0;
            updatedVol.sectionStemEntryAngle = Math.max(0, Math.min(90, Number((curAngle + deltaZ * 12).toFixed(1))));
          } else if (key === 'wl_bottom' || key === 'PT_SEC_HEEL') {
            const curLen = startVol.sectionHeelStraightLen ?? 0.0;
            updatedVol.sectionHeelStraightLen = Math.max(0, Number((curLen + deltaZ).toFixed(2)));
          }

          setTempBowParams((prev) => ({
            ...prev,
            bowVolume: updatedVol,
            ...updatedVol,
          }));
        }
      } else if (cameraRef.current) {
        // Подсветка курсора при наведении
        raycaster.setFromCamera(mouse, cameraRef.current);
        if ((bowEditStepRef.current === 'shaping' || bowEditStepRef.current === 'deck') && bowControlPoints3DGroupRef.current) {
          const hits = raycaster.intersectObjects(bowControlPoints3DGroupRef.current.children, true);
          const hitGizmo = hits.find((h) => h.object.userData?.isGizmo);
          const hitPt = hits.find((h) => h.object.userData?.isControlPoint);

          if (hitGizmo) {
            const axis = hitGizmo.object.userData.axis;
            if (axis === 'x') dom.style.cursor = 'ew-resize';
            else if (axis === 'z') dom.style.cursor = 'ns-resize';
            else dom.style.cursor = 'grab';
          } else if (hitPt && hitPt.object.userData.pointIndex !== 4) {
            dom.style.cursor = 'grab';
          } else {
            dom.style.cursor = 'default';
          }
        } else if (bowEditStepRef.current === 'stem' && stem3DGroupRef.current) {
          const hits = raycaster.intersectObjects(stem3DGroupRef.current.children, true);
          const hitGizmo = hits.find((h) => h.object.userData?.isStemGizmo);
          const hitStem = hits.find((h) => h.object.userData?.isStemPoint);
          if (hitGizmo) {
            const isRot = hitGizmo.object.userData.isRotationGizmo;
            const axis = hitGizmo.object.userData.axis;
            if (isRot) dom.style.cursor = 'grab';
            else if (axis === 'x') dom.style.cursor = 'ew-resize';
            else if (axis === 'y') dom.style.cursor = 'ns-resize';
            else dom.style.cursor = 'grab';
          } else if (hitStem) {
            const key = hitStem.object.userData.stemKey as StemPointKey;
            if (key === 'CTRL_STEM_UPPER' || key === 'CTRL_STEM_BULB_UPPER' || key === 'CTRL_STEM_BULB_LOWER') {
              dom.style.cursor = 'pointer';
            } else {
              dom.style.cursor = key === 'PT_STEM_DWL' ? 'not-allowed' : 'grab';
            }
          } else {
            dom.style.cursor = 'default';
          }
        } else if ((bowEditStepRef.current === 'volume' || bowEditStepRef.current === 'shaping') && bowSection3DGroupRef.current) {
          const hits = raycaster.intersectObjects(bowSection3DGroupRef.current.children, true);
          const hitSectionPt = hits.find((h) => h.object.userData?.isBowSectionPoint);
          if (hitSectionPt) {
            dom.style.cursor = 'pointer';
          } else {
            dom.style.cursor = 'default';
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (dragged3DPointIndexRef.current !== null || draggedStemPointKeyRef.current !== null || draggedBowSectionPointKey !== null) {
        dragged3DPointIndexRef.current = null;
        draggedStemPointKeyRef.current = null;
        draggedBowSectionPointKey = null;
        draggedGizmoAxisRef.current = null;
        draggedStemGizmoAxisRef.current = null;
        if (controlsRef.current) controlsRef.current.enabled = true;
        try {
          dom.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        dom.style.cursor = 'default';
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (bowEditStepRef.current !== 'stem' || !cameraRef.current) return;
      const rect = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);

      if (stem3DGroupRef.current) {
        const hits = raycaster.intersectObjects(stem3DGroupRef.current.children, true);
        const hitTangent = hits.find((h) => 
          h.object.userData?.stemKey === 'CTRL_STEM_UPPER' ||
          h.object.userData?.stemKey === 'CTRL_STEM_BULB_UPPER' ||
          h.object.userData?.stemKey === 'CTRL_STEM_BULB_LOWER'
        );

        // Когда наводимся на закручивающиеся стрелки или точки касательных и крутим колесико мыши
        if (hitTangent) {
          e.preventDefault();
          e.stopPropagation();
          const targetKey = hitTangent.object.userData.stemKey as StemPointKey;
          const delta = e.deltaY < 0 ? 1 : -1;
          const step = e.shiftKey ? 0.5 : 1.5;
          setTempBowParams((prev) => {
            const curStem = prev.stemProfile || DEFAULT_STEM_PARAMS;
            const updates: Partial<StemProfileParams> = {};
            if (targetKey === 'CTRL_STEM_UPPER') {
              const curAngle = curStem.deckTangentAngle ?? (curStem.stemRakeAngle + curStem.stemAboveCurvature * 25);
              updates.deckTangentAngle = Math.max(-110, Math.min(110, Number((curAngle + delta * step).toFixed(1))));
            } else if (targetKey === 'CTRL_STEM_BULB_UPPER') {
              const curAngle = curStem.bulbUpperTangentAngle ?? 55;
              updates.bulbUpperTangentAngle = Math.max(-110, Math.min(110, Number((curAngle + delta * step).toFixed(1))));
            } else if (targetKey === 'CTRL_STEM_BULB_LOWER') {
              const curAngle = curStem.bulbLowerTangentAngle ?? 55;
              updates.bulbLowerTangentAngle = Math.max(-110, Math.min(110, Number((curAngle + delta * step).toFixed(1))));
            }
            return {
              ...prev,
              stemProfile: {
                ...curStem,
                ...updates,
              },
            };
          });
        }
      }
    };

    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
    };
  }, [bowEditStep, selectedPointIndex, selectedStemPointKey, selectedBowSectionPointKey]);

  // ─── ЗАПУСК АНИМАЦИИ РЕДАКТИРОВАНИЯ ГЕОМЕТРИИ ───
  const handleStartGeometryCut = () => {
    if (animState !== 'idle') return;

    // Сохраняем исходные параметры и камеру
    savedParamsRef.current = { ...params };
    if (cameraRef.current) {
      savedCamPosRef.current.copy(cameraRef.current.position);
    }
    if (controlsRef.current) {
      savedCamTargetRef.current.copy(controlsRef.current.target);
    }

    const dualBranches = getCrossSectionHalfBranches3D({
      width: params.width,
      height: params.height,
      radius: params.radius,
      flare: params.flare,
      deadrise: params.deadrise,
      deadriseInHeight: params.deadriseInHeight,
      deckCamber: params.deckCamber,
      deckCamberInHeight: params.deckCamberInHeight,
      sheerRadius: params.sheerRadius,
      showDeckCover: params.showDeckCover,
    });

    const anim = animProgressRef.current;
    anim.phase = 'cutting';
    anim.startTime = performance.now();
    anim.frontOffset = 0;
    anim.tubeRadius = 0;

    if (gasCutEffectRef.current) {
      gasCutEffectRef.current.setBranches(dualBranches, Boolean(params.showDeckCover));
      gasCutEffectRef.current.start('cut');
    }

    setAnimState('cutting');
  };

  // ─── СОХРАНЕНИЕ И ОБРАТНАЯ АНИМАЦИЯ (С ПОСЛЕДУЮЩЕЙ СВАРКОЙ) ───
  const handleSaveGeometry = () => {
    if (animState !== 'editing') return;

    const dualBranches = getCrossSectionHalfBranches3D({
      width: params.width,
      height: params.height,
      radius: params.radius,
      flare: params.flare,
      deadrise: params.deadrise,
      deadriseInHeight: params.deadriseInHeight,
      deckCamber: params.deckCamber,
      deckCamberInHeight: params.deckCamberInHeight,
      sheerRadius: params.sheerRadius,
      showDeckCover: params.showDeckCover,
    });

    if (gasCutEffectRef.current) {
      gasCutEffectRef.current.setBranches(dualBranches, Boolean(params.showDeckCover));
    }

    const anim = animProgressRef.current;
    anim.phase = 'reversing';
    anim.startTime = performance.now();
    if (cameraRef.current) anim.camStartPos.copy(cameraRef.current.position);
    if (controlsRef.current) anim.camStartTarget.copy(controlsRef.current.target);
    anim.camEndPos.copy(savedCamPosRef.current);
    anim.camEndTarget.copy(savedCamTargetRef.current);

    setAnimState('reversing');
  };

  // ─── ОТМЕНА И ОБРАТНАЯ АНИМАЦИЯ (С ВОССТАНОВЛЕНИЕМ И СВАРКОЙ) ───
  const handleCancelGeometry = () => {
    if (animState !== 'editing') return;

    // Восстанавливаем старые параметры
    setParams(savedParamsRef.current);

    const dualBranches = getCrossSectionHalfBranches3D({
      width: savedParamsRef.current.width,
      height: savedParamsRef.current.height,
      radius: savedParamsRef.current.radius,
      flare: savedParamsRef.current.flare,
      deadrise: savedParamsRef.current.deadrise,
      deadriseInHeight: savedParamsRef.current.deadriseInHeight,
      deckCamber: savedParamsRef.current.deckCamber,
      deckCamberInHeight: savedParamsRef.current.deckCamberInHeight,
      sheerRadius: savedParamsRef.current.sheerRadius,
      showDeckCover: savedParamsRef.current.showDeckCover,
    });

    if (gasCutEffectRef.current) {
      gasCutEffectRef.current.setBranches(dualBranches, Boolean(savedParamsRef.current.showDeckCover));
    }

    const anim = animProgressRef.current;
    anim.phase = 'reversing';
    anim.startTime = performance.now();
    if (cameraRef.current) anim.camStartPos.copy(cameraRef.current.position);
    if (controlsRef.current) anim.camStartTarget.copy(controlsRef.current.target);
    anim.camEndPos.copy(savedCamPosRef.current);
    anim.camEndTarget.copy(savedCamTargetRef.current);

    setAnimState('reversing');
  };

  const handleParamsChange = (newParams: Partial<BrusParams>) => {
    setParams((prev) => ({ ...prev, ...newParams }));
  };

  // ─── ХЕНДЛЕРЫ ОПЫТОВОГО БАССЕЙНА (TOWING TANK) ───
  const handleOpenTowingTank = () => {
    const defaultLength = hasBowApplied && bowLength > 0 ? bowLength : Math.min(params.length * 0.3, 25);
    setTempBowLength(defaultLength);
    setTempBowParams(bowParams);
    setIsTowingTankMode(true);
    setIsPanelMinimized(true);
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(0x0a1128); // Атмосферный глубокий морской фон
    }
  };

  const handleExitTowingTank = () => {
    setIsTowingTankMode(false);
    setIsPanelMinimized(false);
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(0xf0f0f0); // Возврат к светлому CAD-фону
    }
  };

  const handleSetCameraView = (view: 'profile' | 'isometric' | 'bow' | 'top') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const xMid = params.length / 4;
    const yMid = params.height / 2;
    controls.target.set(xMid, yMid, 0);

    const dist = Math.max(params.length, params.width, params.height) * 1.4;

    if (view === 'profile') {
      camera.position.set(xMid, yMid, dist);
    } else if (view === 'top') {
      camera.position.set(xMid, yMid + dist, 0);
    } else if (view === 'bow') {
      camera.position.set(params.length / 2 + dist * 0.7, yMid, 0);
    } else {
      camera.position.set(xMid + dist * 0.7, yMid + dist * 0.5, dist * 0.7);
    }
    controls.update();
  };

  const handleSetTankCameraView = (view: 'isometric' | 'profile' | 'bow' | 'top' | 'wake') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const L = params.length;
    const B = params.width;
    const H = params.height;
    const T = params.draft;

    const cam = cameraRef.current;
    const ctr = controlsRef.current;

    if (view === 'isometric') {
      cam.position.set(L * 0.85, H * 3.2, B * 3.2);
      ctr.target.set(L * 0.15, T * 0.9, 0);
    } else if (view === 'profile') {
      cam.position.set(0, T * 1.2, B * 4.2);
      ctr.target.set(0, T * 0.9, 0);
    } else if (view === 'bow') {
      cam.position.set(L * 0.65, H * 1.6, B * 1.6);
      ctr.target.set(L * 0.45, T * 0.9, 0);
    } else if (view === 'top') {
      cam.position.set(L * 0.1, H * 8.0, 0.001);
      ctr.target.set(L * 0.1, T * 0.9, 0);
    } else if (view === 'wake') {
      cam.position.set(-L * 0.85, H * 2.8, B * 2.5);
      ctr.target.set(0, T * 0.9, 0);
    }
    ctr.update();
  };

  const handleToggleGeometryFlow = () => {
    if (animState === 'editing') {
      handleSaveGeometry();
    } else {
      handleStartGeometryCut();
    }
  };

  const handleOpenBowEditFlow = () => {
    if (bowEditStep !== 'none') {
      setBowEditStep('none');
      setIsPanelMinimized(false);
      return;
    }
    const defaultLength = hasBowApplied && bowLength > 0 ? bowLength : Math.min(params.length * 0.3, 25);
    setTempBowLength(defaultLength);
    setTempBowParams(bowParams);
    savedBowParamsRef.current = bowParams;
    setBowEditStep('length');
    setIsPanelMinimized(true);
  };

  const handleToggleSimulationFlow = () => {
    if (isTowingTankMode) {
      handleExitTowingTank();
    } else {
      handleOpenTowingTank();
    }
  };

  // Синхронизация и перерасчет опытового бассейна
  useEffect(() => {
    if (!towingTankControllerRef.current) return;
    const effectiveBowLen = hasBowApplied && bowLength > 0 ? bowLength : (tempBowLength > 0 ? tempBowLength : 25);
    const activeBow = bowEditStep !== 'none' ? tempBowParams : bowParams;

    if (isTowingTankMode) {
      const tel = towingTankControllerRef.current.rebuild(
        params,
        activeBow,
        effectiveBowLen,
        tankSpeedKnots,
        tankVisualOptions
      );
      setTelemetry(tel);
      towingTankControllerRef.current.getRootGroup().visible = true;

      // Динамическая посадка корпуса (Trim & Sinkage)
      if (brusContainerRef.current) {
        if (tankVisualOptions.showDynamicAttitude) {
          brusContainerRef.current.rotation.z = (tel.dynamicTrimDeg * Math.PI) / 180;
          brusContainerRef.current.position.y = -tel.dynamicSinkageM;
        } else {
          brusContainerRef.current.rotation.z = 0;
          brusContainerRef.current.position.y = 0;
        }
      }

      if (gridHelperRef.current) {
        gridHelperRef.current.visible = false;
      }
    } else {
      towingTankControllerRef.current.getRootGroup().visible = false;
      if (brusContainerRef.current) {
        brusContainerRef.current.rotation.z = 0;
        brusContainerRef.current.position.y = 0;
      }
      if (gridHelperRef.current) {
        gridHelperRef.current.visible = showGrid;
      }
    }
  }, [
    isTowingTankMode,
    tankSpeedKnots,
    tankVisualOptions,
    params,
    bowParams,
    tempBowParams,
    bowLength,
    tempBowLength,
    hasBowApplied,
    bowEditStep,
    showGrid,
  ]);

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none bg-[#f0f0f0]">
      {/* 3D Canvas Контейнер */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Левая узкая колонка навигации во всю высоту экрана (CAD Nav Rail) */}
      <LeftSidebar
        currentActiveTab={activeNavTab}
        onSelectTab={setActiveNavTab}
        onOpenGeometry={handleToggleGeometryFlow}
        onOpenExtremities={handleOpenBowEditFlow}
        onToggleSimulation={handleToggleSimulationFlow}
        isGeometryActive={animState === 'editing'}
        isExtremitiesActive={bowEditStep !== 'none'}
        isSimulationActive={isTowingTankMode}
        showWireframe={showWireframe}
        onToggleWireframe={() => setShowWireframe(!showWireframe)}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(!showGrid)}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        showLineLabels={showLineLabels}
        onToggleLineLabels={() => setShowLineLabels(!showLineLabels)}
        onSetCameraView={(v) => {
          if (v === 'iso') handleSetCameraView('isometric');
          else handleSetCameraView(v);
        }}
        theme={theme}
        onThemeChange={setTheme}
        params={params}
        onParamsChange={handleParamsChange}
        bowLength={hasBowApplied && bowLength > 0 ? bowLength : tempBowLength}
        onBowLengthChange={(len) => {
          setTempBowLength(len);
          if (hasBowApplied) setBowLength(len);
        }}
        bowParams={bowEditStep !== 'none' ? tempBowParams : bowParams}
        onBowParamsChange={(partial) => {
          setBowParams((prev) => ({ ...prev, ...partial }));
          setTempBowParams((prev) => ({ ...prev, ...partial }));
        }}
        tankSpeedKnots={tankSpeedKnots}
        onTankSpeedChange={setTankSpeedKnots}
        tankVisualOptions={tankVisualOptions}
        onToggleTankVisualOption={(key) =>
          setTankVisualOptions((prev) => ({ ...prev, [key]: !prev[key] }))
        }
        onOpenAbout={() => setIsAboutOpen(true)}
      />

      {/* Основная плавающая панель параметров (скрывается или блокируется во время редактирования) */}
      {!isTowingTankMode && (
        <ControlPanel
          params={params}
          onParamsChange={handleParamsChange}
          theme={theme}
          onThemeChange={setTheme}
          bowLength={bowLength}
          showWireframe={showWireframe}
          onToggleWireframe={() => setShowWireframe(!showWireframe)}
          showLineLabels={showLineLabels}
          onToggleLineLabels={() => setShowLineLabels(!showLineLabels)}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid(!showGrid)}
          autoRotate={autoRotate}
          onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
          onOpenGeometryEdit={handleStartGeometryCut}
          onOpenBowEdit={() => {
            const defaultLength = hasBowApplied && bowLength > 0 ? bowLength : Math.min(params.length * 0.3, 25);
            setTempBowLength(defaultLength);
            setTempBowParams(bowParams);
            savedBowParamsRef.current = bowParams;
            setBowEditStep('length');
            setIsPanelMinimized(true);
          }}
          onOpenTowingTank={handleOpenTowingTank}
          isMinimized={isPanelMinimized || animState !== 'idle' || bowEditStep !== 'none'}
          onMinimize={() => setIsPanelMinimized(true)}
          onExpand={() => setIsPanelMinimized(false)}
        />
      )}

      {/* Интерфейс Опытового Бассейна (Towing Tank Mode) */}
      {isTowingTankMode && (
        <TowingTankUi
          speedKnots={tankSpeedKnots}
          onSpeedChange={setTankSpeedKnots}
          telemetry={telemetry}
          visualOptions={tankVisualOptions}
          onToggleVisualOption={(key) =>
            setTankVisualOptions((prev) => ({ ...prev, [key]: !prev[key] }))
          }
          onSetCameraView={handleSetTankCameraView}
          onExit={handleExitTowingTank}
          bowParams={bowEditStep !== 'none' ? tempBowParams : bowParams}
          onBowParamsChange={(partial) => {
            setBowParams((prev) => ({ ...prev, ...partial }));
            setTempBowParams((prev) => ({ ...prev, ...partial }));
          }}
        />
      )}

      {/* Интерактивная нижняя панель параметров геометрии (заменяет всплывающее окно) */}
      {!isTowingTankMode && (animState === 'editing' || animState === 'reversing') && (
        <GeometryBottomBar
          theme={theme}
          width={params.width}
          height={params.height}
          radius={params.radius}
          flare={params.flare}
          deadrise={params.deadrise}
          deadriseInHeight={params.deadriseInHeight}
          deckCamber={params.deckCamber}
          deckCamberInHeight={params.deckCamberInHeight}
          sheerRadius={params.sheerRadius}
          showDeckCover={params.showDeckCover}
          onParamsChange={handleParamsChange}
          onSave={handleSaveGeometry}
          onCancel={handleCancelGeometry}
          onReset={() =>
            handleParamsChange({
              radius: 0,
              flare: 0,
              deadrise: 0,
              deadriseInHeight: false,
              deckCamber: 0,
              deckCamberInHeight: false,
              sheerRadius: 0,
            })
          }
          isClosing={animState === 'reversing'}
        />
      )}



      {/* Интерактивная нижняя панель носовой оконечности */}
      {!isTowingTankMode && bowEditStep !== 'none' && (
        <BowBottomBar
          theme={theme}
          step={bowEditStep === 'shaping' ? 'deck' : bowEditStep}
          bowLength={tempBowLength}
          maxLength={params.length}
          width={params.width}
          height={params.height}
          draft={params.draft}
          bowParams={tempBowParams}
          selectedPointIndex={selectedPointIndex}
          onSelectPointIndex={setSelectedPointIndex}
          selectedStemPointKey={selectedStemPointKey}
          onSelectStemPointKey={setSelectedStemPointKey}
          selectedStemParamId={selectedStemParamId}
          onSelectStemParamId={setSelectedStemParamId}
          selectedBowSectionPointKey={selectedBowSectionPointKey}
          onSelectBowSectionPointKey={setSelectedBowSectionPointKey}
          showBreadthLimits={showBreadthLimits}
          onToggleBreadthLimits={() => setShowBreadthLimits((prev) => !prev)}
          showFullHull={showFullHullInBowEdit}
          onToggleFullHull={() => setShowFullHullInBowEdit((prev) => !prev)}
          showHalfHull={showHalfHull}
          onToggleHalfHull={() => setShowHalfHull((prev) => !prev)}
          onBowLengthChange={setTempBowLength}
          onBowParamsChange={(partial) => setTempBowParams((prev) => ({ ...prev, ...partial }))}
          renderMode={surfaceRenderMode}
          onRenderModeChange={setSurfaceRenderMode}
          wireframeDisplay={wireframeDisplay}
          onWireframeDisplayChange={(opts) => setWireframeDisplay((prev) => ({ ...prev, ...opts }))}
          activeMasterWaterline={activeMasterWaterline}
          onSelectMasterWaterline={setActiveMasterWaterline}
          onStepChange={(st) => {
            setBowEditStep(st);
            if (st === 'stem') {
              setSelectedStemPointKey('PT_STEM_DECK');
              setSelectedStemParamId('stemRakeAngle');
            }
          }}
          onSetCameraView={handleSetCameraView}
          qaStats={lastQAStatsRef.current}
          onNext={() => setBowEditStep('deck')}
          onBack={() => setBowEditStep('length')}
          onSave={() => {
            setBowLength(tempBowLength);
            setBowParams(tempBowParams);
            savedBowParamsRef.current = tempBowParams;
            setHasBowApplied(true);
            setBowEditStep('none');
            setIsPanelMinimized(false);
          }}
          onCancel={() => {
            setTempBowLength(hasBowApplied ? bowLength : 25);
            setTempBowParams(savedBowParamsRef.current);
            setBowEditStep('none');
            setIsPanelMinimized(false);
          }}
        />
      )}

      {/* Модальное окно «О программе и логотипе» */}
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />

      {/* Анимация загрузки официального логотипа с перелетом в левый верхний угол */}
      {showIntro && <ShipLogoIntro onComplete={() => setShowIntro(false)} />}
    </div>
  );
};

export default App;

