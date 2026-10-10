/**
 * ====================================================================================================
 * 📁 src/core/sparkEffect.ts
 * ====================================================================================================
 * Высокодетализированный эффект синхронной двухсторонней газовой резки (плазмореза) и сварки.
 * 
 * Правила жизненного цикла:
 * 1. ВО ВРЕМЯ АНИМАЦИИ РЕЗКИ (phase = 'cutting'):
 *    - Активны белые сферические головки резаков с раскаленным пламенным ореолом.
 *    - Генерируются физические снопы искр, динамический свет и раскаленная линия пропила.
 * 2. ПОСЛЕ ЗАВЕРШЕНИЯ РЕЗКИ (фазы separating, editing, reversing):
 *    - Все белые шарики, ореолы, искры, линии и текстуры реза ПОЛНОСТЬЮ СКРЫВАЮТСЯ (stop).
 *    - Корпус судна и поперечное сечение остаются идеально чистыми.
 * 3. ВО ВРЕМЯ АНИМАЦИИ СВАРКИ (phase = 'welding'):
 *    - Активны сварочные головки (белые шарики + электрический индиго-ореол + дуга).
 *    - Генерируются электрические снопы искр, яркий свет и формируется 3D-сварочный шов.
 * 4. ПОСЛЕ СВАРКИ (phase = 'fading' -> 'idle'):
 *    - Шарики и дуги мгновенно отключаются (stopTorches).
 *    - Сварочный шов остывает и плавно растворяется в ноль, возвращая чистый монолитный корпус.
 * ====================================================================================================
 */

import * as THREE from 'three';

export interface SparkParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

export type SparkEffectMode = 'cut' | 'weld';

export interface DualContourBranches {
  leftBranch: THREE.Vector3[];
  rightBranch: THREE.Vector3[];
}

export interface BranchPathData {
  points: THREE.Vector3[];
  cumulativeDistances: number[];
  totalLength: number;
}

function createBranchPath(points: THREE.Vector3[]): BranchPathData {
  if (!points || points.length === 0) {
    return { points: [], cumulativeDistances: [0], totalLength: 0 };
  }
  const cumDists: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].distanceTo(points[i - 1]);
    total += d;
    cumDists.push(total);
  }
  return {
    points,
    cumulativeDistances: cumDists,
    totalLength: total,
  };
}

function getPathStateAtProgress(path: BranchPathData, progress: number): {
  pos: THREE.Vector3;
  activePoints: THREE.Vector3[];
} {
  const { points, cumulativeDistances, totalLength } = path;
  if (!points.length) {
    return { pos: new THREE.Vector3(), activePoints: [] };
  }
  if (points.length === 1 || totalLength <= 0.00001) {
    return { pos: points[0].clone(), activePoints: [points[0].clone(), points[0].clone()] };
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const targetDist = clampedProgress * totalLength;

  // Поиск сегмента k, на котором лежит targetDist
  let k = 0;
  while (k < cumulativeDistances.length - 2 && cumulativeDistances[k + 1] < targetDist) {
    k++;
  }

  const d0 = cumulativeDistances[k];
  const d1 = cumulativeDistances[k + 1];
  const segLen = d1 - d0;
  const alpha = segLen > 0.000001 ? (targetDist - d0) / segLen : 0;

  const currentPos = new THREE.Vector3().lerpVectors(
    points[k],
    points[k + 1],
    Math.max(0, Math.min(1, alpha))
  );

  // Набираем пройденные точки для шва
  const activePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= k; i++) {
    activePoints.push(points[i].clone());
  }
  if (currentPos.distanceTo(points[k]) > 0.0001) {
    activePoints.push(currentPos.clone());
  }

  if (activePoints.length === 1) {
    activePoints.push(currentPos.clone());
  }

  return { pos: currentPos, activePoints };
}

export class GasCutEffect {
  public group: THREE.Group;

  // 1. Источники динамического света для левого и правого резаков
  private torchLightLeft: THREE.PointLight;
  private torchLightRight: THREE.PointLight;
  private ambientTorchLight: THREE.PointLight;

  // 2. Визуальные сферические тела резаков (белые шарики + ореолы)
  private torchCoreLeft: THREE.Mesh;
  private torchCoreRight: THREE.Mesh;
  private torchGlowLeft: THREE.Mesh;
  private torchGlowRight: THREE.Mesh;

  // 3. Раскаленные линии пропила / дуги
  private seamLeftOuterLine: THREE.Line;
  private seamLeftCoreLine: THREE.Line;
  private seamLeftGeom: THREE.BufferGeometry;
  private seamLeftCoreGeom: THREE.BufferGeometry;

  private seamRightOuterLine: THREE.Line;
  private seamRightCoreLine: THREE.Line;
  private seamRightGeom: THREE.BufferGeometry;
  private seamRightCoreGeom: THREE.BufferGeometry;

  // 4. 3D-шов сварки (с чешуйками)
  private weldBeadMesh: THREE.Mesh;
  private weldBeadGeom: THREE.BufferGeometry;
  private weldBeadMat: THREE.MeshStandardMaterial;

  // 5. Система искр
  private sparksPoints: THREE.Points;
  private sparksGeometry: THREE.BufferGeometry;
  private particles: SparkParticle[] = [];

  // Параметризованные ветви контура
  private leftPath: BranchPathData = { points: [], cumulativeDistances: [0], totalLength: 0 };
  private rightPath: BranchPathData = { points: [], cumulativeDistances: [0], totalLength: 0 };

  public isActive: boolean = false;
  private mode: SparkEffectMode = 'cut';
  private progress: number = 0;
  private hasDeck: boolean = false;

  constructor() {
    this.group = new THREE.Group();

    // ─── ДИНАМИЧЕСКИЕ ИСТОЧНИКИ СВЕТА ───
    this.torchLightLeft = new THREE.PointLight(0xff6600, 0, 45);
    this.torchLightRight = new THREE.PointLight(0xff6600, 0, 45);
    this.ambientTorchLight = new THREE.PointLight(0xffaa22, 0, 60);

    this.group.add(this.torchLightLeft);
    this.group.add(this.torchLightRight);
    this.group.add(this.ambientTorchLight);

    // ─── БЕЛЫЕ СФЕРИЧЕСКИЕ ШАРИКИ (ГОЛОВКИ РЕЗАКОВ / ДУГИ) ───
    const coreGeom = new THREE.SphereGeometry(0.38, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.torchCoreLeft = new THREE.Mesh(coreGeom, coreMat);
    this.torchCoreRight = new THREE.Mesh(coreGeom, coreMat.clone());
    this.torchCoreLeft.visible = false;
    this.torchCoreRight.visible = false;
    this.torchCoreLeft.renderOrder = 10;
    this.torchCoreRight.renderOrder = 10;

    this.group.add(this.torchCoreLeft);
    this.group.add(this.torchCoreRight);

    // Ореол пламени / дуги (Additive Glow)
    const glowGeom = new THREE.SphereGeometry(0.95, 16, 16);
    const glowMatLeft = new THREE.MeshBasicMaterial({
      color: 0xff7700,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMatRight = glowMatLeft.clone();

    this.torchGlowLeft = new THREE.Mesh(glowGeom, glowMatLeft);
    this.torchGlowRight = new THREE.Mesh(glowGeom, glowMatRight);
    this.torchGlowLeft.visible = false;
    this.torchGlowRight.visible = false;
    this.torchGlowLeft.renderOrder = 11;
    this.torchGlowRight.renderOrder = 11;

    this.group.add(this.torchGlowLeft);
    this.group.add(this.torchGlowRight);

    // ─── РАСКАЛЕННЫЕ ШВЫ ───
    this.seamLeftGeom = new THREE.BufferGeometry();
    this.seamLeftCoreGeom = new THREE.BufferGeometry();
    this.seamRightGeom = new THREE.BufferGeometry();
    this.seamRightCoreGeom = new THREE.BufferGeometry();

    const outerLineMat = new THREE.LineBasicMaterial({
      color: 0xff3300,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
    });
    const coreLineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1.5,
      transparent: true,
      opacity: 1.0,
    });

    this.seamLeftOuterLine = new THREE.Line(this.seamLeftGeom, outerLineMat);
    this.seamLeftCoreLine = new THREE.Line(this.seamLeftCoreGeom, coreLineMat);

    this.seamRightOuterLine = new THREE.Line(this.seamRightGeom, outerLineMat.clone());
    this.seamRightCoreLine = new THREE.Line(this.seamRightCoreGeom, coreLineMat.clone());

    this.group.add(this.seamLeftOuterLine);
    this.group.add(this.seamLeftCoreLine);
    this.group.add(this.seamRightOuterLine);
    this.group.add(this.seamRightCoreLine);

    // ─── 3D СВАРОЧНЫЙ ШОВ (WELD BEAD MESH) ───
    this.weldBeadGeom = new THREE.BufferGeometry();
    this.weldBeadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x0099ff,
      emissiveIntensity: 0.8,
      roughness: 0.6,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    this.weldBeadMesh = new THREE.Mesh(this.weldBeadGeom, this.weldBeadMat);
    this.weldBeadMesh.renderOrder = 6;
    this.group.add(this.weldBeadMesh);

    // ─── ЧАСТИЦЫ ИСКР ───
    this.sparksGeometry = new THREE.BufferGeometry();
    const sparksMat = new THREE.PointsMaterial({
      size: 0.75,
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparksPoints = new THREE.Points(this.sparksGeometry, sparksMat);
    this.group.add(this.sparksPoints);

    // По умолчанию вне анимации все полностью скрыто
    this.group.visible = false;
  }

  /**
   * Установка контура в виде двух синхронных ветвей (от киля вверх)
   */
  public setBranches(branches: DualContourBranches, hasDeck: boolean = false) {
    this.leftPath = createBranchPath(branches.leftBranch);
    this.rightPath = createBranchPath(branches.rightBranch);
    this.hasDeck = hasDeck;
    if (!this.isActive) {
      this.reset();
    }
  }

  public setContour(points3D: THREE.Vector3[], hasDeck: boolean = false) {
    if (!points3D.length) return;
    const n = points3D.length;
    const half = Math.floor(n / 2);
    const leftBranch = points3D.slice(0, half + 1);
    const rightBranch = [points3D[0], ...points3D.slice(half).reverse()];
    this.setBranches({ leftBranch, rightBranch }, hasDeck);
  }

  /**
   * Запуск анимации резки или сварки
   */
  public start(mode: SparkEffectMode = 'cut') {
    this.mode = mode;
    this.isActive = true;
    this.progress = 0;
    this.particles = [];

    this.group.visible = true;
    this.torchCoreLeft.visible = true;
    this.torchCoreRight.visible = true;
    this.torchGlowLeft.visible = true;
    this.torchGlowRight.visible = true;

    if (mode === 'weld') {
      // Сварка: электрический индиго / ультрамарин / ослепительно белый
      this.torchLightLeft.color.setHex(0x55ccff);
      this.torchLightRight.color.setHex(0x55ccff);
      this.ambientTorchLight.color.setHex(0x3388ff);

      (this.torchGlowLeft.material as THREE.MeshBasicMaterial).color.setHex(0x22aaff);
      (this.torchGlowRight.material as THREE.MeshBasicMaterial).color.setHex(0x22aaff);

      (this.seamLeftOuterLine.material as THREE.LineBasicMaterial).color.setHex(0x00aaff);
      (this.seamRightOuterLine.material as THREE.LineBasicMaterial).color.setHex(0x00aaff);
      (this.seamLeftCoreLine.material as THREE.LineBasicMaterial).color.setHex(0xe6f7ff);
      (this.seamRightCoreLine.material as THREE.LineBasicMaterial).color.setHex(0xe6f7ff);

      this.weldBeadMat.opacity = 1.0;
      this.weldBeadMat.color.setHex(0xffffff);
      this.weldBeadMat.emissive.setHex(0x0099ff);
      this.weldBeadMat.emissiveIntensity = 1.0;
    } else {
      // Газовая резка: раскаленный оранжево-красный / пламенный янтарный
      this.torchLightLeft.color.setHex(0xff6600);
      this.torchLightRight.color.setHex(0xff6600);
      this.ambientTorchLight.color.setHex(0xff4400);

      (this.torchGlowLeft.material as THREE.MeshBasicMaterial).color.setHex(0xff5500);
      (this.torchGlowRight.material as THREE.MeshBasicMaterial).color.setHex(0xff5500);

      (this.seamLeftOuterLine.material as THREE.LineBasicMaterial).color.setHex(0xff2200);
      (this.seamRightOuterLine.material as THREE.LineBasicMaterial).color.setHex(0xff2200);
      (this.seamLeftCoreLine.material as THREE.LineBasicMaterial).color.setHex(0xfff0aa);
      (this.seamRightCoreLine.material as THREE.LineBasicMaterial).color.setHex(0xfff0aa);

      this.weldBeadMat.opacity = 0.0;
    }
  }

  /**
   * Отключение горелок/шариков и источников света (оставляя шов для остывания)
   */
  public stopTorches() {
    this.torchCoreLeft.visible = false;
    this.torchCoreRight.visible = false;
    this.torchGlowLeft.visible = false;
    this.torchGlowRight.visible = false;
    this.torchLightLeft.intensity = 0;
    this.torchLightRight.intensity = 0;
    this.ambientTorchLight.intensity = 0;
    this.particles = [];
    this.updateSparksGeometry();
  }

  /**
   * Полная остановка и скрытие всех элементов (шариков, швов, линий)
   */
  public stop() {
    this.isActive = false;
    this.group.visible = false;
    this.torchCoreLeft.visible = false;
    this.torchCoreRight.visible = false;
    this.torchGlowLeft.visible = false;
    this.torchGlowRight.visible = false;
    this.torchLightLeft.intensity = 0;
    this.torchLightRight.intensity = 0;
    this.ambientTorchLight.intensity = 0;
    this.particles = [];
    this.updateSparksGeometry();

    // Очищаем линии и шов, чтобы корпус судна был идеально чистым
    this.seamLeftGeom.setFromPoints([]);
    this.seamLeftCoreGeom.setFromPoints([]);
    this.seamRightGeom.setFromPoints([]);
    this.seamRightCoreGeom.setFromPoints([]);
    this.weldBeadGeom.setFromPoints([]);
    this.weldBeadMat.opacity = 0;
  }

  public reset() {
    this.particles = [];
    this.progress = 0;
    this.updateSparksGeometry();
    this.seamLeftGeom.setFromPoints([]);
    this.seamLeftCoreGeom.setFromPoints([]);
    this.seamRightGeom.setFromPoints([]);
    this.seamRightCoreGeom.setFromPoints([]);
    this.weldBeadGeom.setFromPoints([]);
    this.weldBeadMat.opacity = 0;
    this.torchCoreLeft.visible = false;
    this.torchCoreRight.visible = false;
    this.torchGlowLeft.visible = false;
    this.torchGlowRight.visible = false;
    this.group.visible = false;
  }

  /**
   * Обновление положения шва в режиме раздвижки секций
   */
  public updatePositions(_frontOffset: number) {
    // Вне резки и сварки вспомогательные маркеры не выводятся
  }

  /**
   * Обновление анимации резки/сварки
   */
  public update(progress: number, delta: number = 0.016) {
    if (!this.leftPath.points.length || !this.rightPath.points.length) return;
    this.isActive = true;
    this.progress = Math.max(0, Math.min(1, progress));

    this.group.visible = true;
    this.torchCoreLeft.visible = true;
    this.torchCoreRight.visible = true;
    this.torchGlowLeft.visible = true;
    this.torchGlowRight.visible = true;

    // Вычисляем положение резаков строго по длине дуги
    const stateLeft = getPathStateAtProgress(this.leftPath, this.progress);
    const stateRight = getPathStateAtProgress(this.rightPath, this.progress);

    const posLeft = stateLeft.pos;
    const posRight = stateRight.pos;

    // Обновляем геометрию головок резаков
    this.torchCoreLeft.position.copy(posLeft);
    this.torchGlowLeft.position.copy(posLeft);
    this.torchLightLeft.position.copy(posLeft);

    this.torchCoreRight.position.copy(posRight);
    this.torchGlowRight.position.copy(posRight);
    this.torchLightRight.position.copy(posRight);

    // Общая подсветка между резаками
    const midPos = new THREE.Vector3().addVectors(posLeft, posRight).multiplyScalar(0.5);
    if (this.hasDeck) {
      this.ambientTorchLight.position.copy(midPos);
      this.ambientTorchLight.visible = true;
    } else {
      this.ambientTorchLight.visible = false;
    }

    // Мерцание дуг
    const pulse = 0.85 + Math.random() * 0.35;
    this.torchGlowLeft.scale.setScalar(pulse);
    this.torchGlowRight.scale.setScalar(pulse);

    if (this.mode === 'weld') {
      // Сварка: ослепительное мерцание
      const intensity = 8.0 + Math.random() * 8.0;
      this.torchLightLeft.intensity = intensity;
      this.torchLightRight.intensity = intensity;
      this.ambientTorchLight.intensity = 4.0 + Math.random() * 4.0;

      const isWhite = Math.random() > 0.45;
      const lightCol = isWhite ? 0xffffff : 0x77ddff;
      this.torchLightLeft.color.setHex(lightCol);
      this.torchLightRight.color.setHex(lightCol);

      // Формируем 3D чешуйчатую линию сварки
      this.updateWeldBead(stateLeft.activePoints, stateRight.activePoints);
    } else {
      // Газорезка: пламенное горение
      const intensity = 7.0 + Math.random() * 5.0;
      this.torchLightLeft.intensity = intensity;
      this.torchLightRight.intensity = intensity;
      this.ambientTorchLight.intensity = 3.5 + Math.random() * 3.0;

      const isYellow = Math.random() > 0.5;
      this.torchLightLeft.color.setHex(isYellow ? 0xffaa00 : 0xff4400);
      this.torchLightRight.color.setHex(isYellow ? 0xffaa00 : 0xff4400);
    }

    // ─── ГЕНЕРАЦИЯ ИСКР ДЛЯ ОБЕИХ СТОРОН ───
    if (this.isActive && progress < 1.0) {
      this.emitSparks(posLeft, 'left');
      this.emitSparks(posRight, 'right');

      if (this.hasDeck && progress > 0.92) {
        this.emitSparks(midPos, 'center');
      }
    }

    // ─── ОБНОВЛЕНИЕ ФИЗИКИ ИСКР ───
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 16 * delta;
      p.vel.multiplyScalar(0.97);
      p.pos.addScaledVector(p.vel, delta);
    }

    this.updateSparksGeometry();

    // Обновляем раскаленные швы
    this.seamLeftGeom.setFromPoints(stateLeft.activePoints);
    this.seamLeftCoreGeom.setFromPoints(stateLeft.activePoints);

    this.seamRightGeom.setFromPoints(stateRight.activePoints);
    this.seamRightCoreGeom.setFromPoints(stateRight.activePoints);
  }

  /**
   * Генерация 3D линии сварочного шва с чешуйками
   */
  private updateWeldBead(leftPts: THREE.Vector3[], rightPts: THREE.Vector3[]) {
    const allPts = [...leftPts.slice().reverse(), ...rightPts.slice(1)];
    if (allPts.length < 2) return;

    const beadRadius = 0.14;
    const radialSegs = 8;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < allPts.length; i++) {
      const pt = allPts[i];
      const pPrev = i === 0 ? pt : allPts[i - 1];
      const pNext = i === allPts.length - 1 ? pt : allPts[i + 1];

      const dir = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
      const normYZ = new THREE.Vector3(0, -dir.z, dir.y).normalize();

      const scaleRipple = 1.0 + 0.18 * Math.sin(i * 3.5);

      for (let j = 0; j < radialSegs; j++) {
        const a = (j / radialSegs) * Math.PI * 2;
        const ox = Math.cos(a) * beadRadius * 0.7 * scaleRipple;
        const oyz = Math.sin(a) * beadRadius * scaleRipple;

        positions.push(
          pt.x + ox,
          pt.y + normYZ.y * oyz,
          pt.z + normYZ.z * oyz
        );
      }
    }

    for (let i = 0; i < allPts.length - 1; i++) {
      const ringA = i * radialSegs;
      const ringB = (i + 1) * radialSegs;
      for (let j = 0; j < radialSegs; j++) {
        const nextJ = (j + 1) % radialSegs;
        indices.push(ringA + j, ringB + j, ringA + nextJ);
        indices.push(ringB + j, ringB + nextJ, ringA + nextJ);
      }
    }

    this.weldBeadGeom.dispose();
    this.weldBeadGeom = new THREE.BufferGeometry();
    this.weldBeadGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.weldBeadGeom.setIndex(indices);
    this.weldBeadGeom.computeVertexNormals();
    this.weldBeadMesh.geometry = this.weldBeadGeom;
  }

  /**
   * Плавное остывание и исчезновение линий сварки
   */
  public updateFade(fadeProgress: number) {
    const t = Math.max(0, Math.min(1, fadeProgress));
    const invT = 1 - t;

    // Сварочный шов: остывает от белого/голубого к темно-стальному, затем исчезает
    if (t < 0.4) {
      const coolT = t / 0.4;
      this.weldBeadMat.emissive.lerpColors(new THREE.Color(0xff4400), new THREE.Color(0x220500), coolT);
      this.weldBeadMat.emissiveIntensity = 0.8 * (1 - coolT);
      this.weldBeadMat.color.lerpColors(new THREE.Color(0xffffff), new THREE.Color(0x333333), coolT);
    } else {
      this.weldBeadMat.emissiveIntensity = 0;
      this.weldBeadMat.opacity = invT;
    }

    (this.seamLeftOuterLine.material as THREE.LineBasicMaterial).opacity = invT;
    (this.seamLeftCoreLine.material as THREE.LineBasicMaterial).opacity = invT;
    (this.seamRightOuterLine.material as THREE.LineBasicMaterial).opacity = invT;
    (this.seamRightCoreLine.material as THREE.LineBasicMaterial).opacity = invT;

    if (t >= 1) {
      this.stop();
    }
  }

  private emitSparks(emitterPos: THREE.Vector3, side: 'left' | 'right' | 'center') {
    const isWeld = this.mode === 'weld';
    const sparkCount = isWeld ? Math.floor(10 + Math.random() * 12) : Math.floor(8 + Math.random() * 10);

    const sideZSign = side === 'left' ? -1 : side === 'right' ? 1 : (Math.random() - 0.5) * 2;

    for (let i = 0; i < sparkCount; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.2) * 10 + 2,
        sideZSign * (2 + Math.random() * 10) + (Math.random() - 0.5) * 4
      );

      const maxLife = 0.35 + Math.random() * 0.45;
      let color: THREE.Color;

      if (isWeld) {
        if (Math.random() > 0.35) {
          color = new THREE.Color().setHSL(0.55 + Math.random() * 0.08, 0.95, 0.75 + Math.random() * 0.25);
        } else {
          color = new THREE.Color().setHSL(0.1 + Math.random() * 0.05, 1.0, 0.6 + Math.random() * 0.4);
        }
      } else {
        color = new THREE.Color().setHSL(0.06 + Math.random() * 0.08, 1.0, 0.5 + Math.random() * 0.5);
      }

      this.particles.push({
        pos: emitterPos.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2
        )),
        vel,
        life: maxLife,
        maxLife,
        size: 0.3 + Math.random() * 0.6,
        color,
      });
    }
  }

  private updateSparksGeometry() {
    const positions: number[] = [];
    const colors: number[] = [];

    for (const p of this.particles) {
      positions.push(p.pos.x, p.pos.y, p.pos.z);
      const ratio = p.life / p.maxLife;
      colors.push(p.color.r * ratio, p.color.g * ratio, p.color.b * ratio);
    }

    this.sparksGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.sparksGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.sparksGeometry.attributes.position.needsUpdate = true;
    if (this.sparksGeometry.attributes.color) {
      this.sparksGeometry.attributes.color.needsUpdate = true;
    }
  }

  public dispose() {
    this.torchCoreLeft.geometry.dispose();
    this.torchCoreRight.geometry.dispose();
    this.torchGlowLeft.geometry.dispose();
    this.torchGlowRight.geometry.dispose();

    this.seamLeftGeom.dispose();
    this.seamLeftCoreGeom.dispose();
    this.seamRightGeom.dispose();
    this.seamRightCoreGeom.dispose();

    this.weldBeadGeom.dispose();

    this.sparksGeometry.dispose();
    (this.sparksPoints.material as THREE.Material).dispose();
  }
}
