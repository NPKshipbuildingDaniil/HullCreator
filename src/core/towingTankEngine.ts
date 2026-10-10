/**
 * ====================================================================================================
 * 📁 src/core/towingTankEngine.ts
 * ====================================================================================================
 * 📌 НАЗНАЧЕНИЕ:
 * 3D-контроллер виртуального опытового бассейна (Virtual Towing Tank Controller):
 * 1. Управление сеткой водной поверхности и волнами Кельвина.
 * 2. Генерация и анимация светящихся линий тока (Streamlines).
 * 3. Физический эмиттер носовых брызг и срыва струй (Spray & Splash System).
 * 4. Управление материалом тепловой карты давлений Бернулли на обшивке.
 * 5. Динамическая посадка корпуса (Heave/Sinkage и Pitch/Trim).
 * ====================================================================================================
 */

import * as THREE from 'three';
import { BrusParams } from './types';
import { BowParameters } from './topologyTypes';
import {
  HydroTelemetry,
  computeHydrodynamics,
  generateFlowStreamlines,
  StreamlinePath,
} from './hydroEngine';
import {
  createBernoulliPressureMaterial,
  createKelvinWaterMaterial,
  createStreamlineShaderMaterial,
} from './towingTankShaders';

export interface TowingTankVisualOptions {
  showPressureHeatmap: boolean;
  showStreamlines: boolean;
  showSpray: boolean;
  showKelvinWake: boolean;
  showDynamicAttitude: boolean;
  showWireframeMesh: boolean;
}

export class TowingTankController {
  private group: THREE.Group = new THREE.Group();
  private waterMesh: THREE.Mesh | null = null;
  private waterMaterial: THREE.ShaderMaterial | null = null;
  private streamlinesGroup: THREE.Group = new THREE.Group();
  private streamlineMaterial: THREE.ShaderMaterial | null = null;
  private pressureMaterial: THREE.ShaderMaterial | null = null;

  // Система брызг и пены
  private sprayParticles: THREE.Points | null = null;
  private sprayGeometry: THREE.BufferGeometry | null = null;
  private sprayPositions: Float32Array | null = null;
  private sprayVelocities: Float32Array | null = null;
  private sprayLifetimes: Float32Array | null = null;
  private readonly maxSprayCount = 650;

  private currentSpeedKnots = 18.5;
  private telemetry: HydroTelemetry | null = null;

  constructor() {
    this.group.name = 'TowingTank_RootGroup';
    this.group.add(this.streamlinesGroup);
    this.initSpraySystem();
  }

  public getRootGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Инициализация или пересборка всех элементов опытового бассейна
   */
  public rebuild(
    params: BrusParams,
    bowParams: BowParameters,
    bowLength: number,
    speedKnots: number,
    options: TowingTankVisualOptions
  ): HydroTelemetry {
    this.currentSpeedKnots = speedKnots;
    const xStem = params.length / 2;
    const dwlDraft = Math.max(0.5, params.draft);

    // 1. Вычисляем гидродинамику
    this.telemetry = computeHydrodynamics(params, bowParams, bowLength, speedKnots);

    // 2. Создаем/обновляем водную поверхность с волнами Кельвина
    this.setupWaterSurface(params, bowLength, dwlDraft, options.showKelvinWake);

    // 3. Создаем линии тока обтекания
    if (options.showStreamlines) {
      this.setupStreamlines(params, bowParams, bowLength, this.telemetry);
    } else {
      this.clearStreamlines();
    }

    // 4. Настраиваем материал давлений Бернулли
    this.setupPressureMaterial(params, bowParams, bowLength);

    // 5. Видимость брызг
    if (this.sprayParticles) {
      this.sprayParticles.visible = options.showSpray && speedKnots > 2.0;
    }

    return this.telemetry;
  }

  public getPressureMaterial(): THREE.ShaderMaterial | null {
    return this.pressureMaterial;
  }

  public getTelemetry(): HydroTelemetry | null {
    return this.telemetry;
  }

  /**
   * Ежекадровое обновление анимаций (шейдерное время, брызги, линии тока)
   */
  public update(deltaSec: number, params: BrusParams, bowParams: BowParameters, options: TowingTankVisualOptions) {
    const elapsedSec = performance.now() * 0.001;
    const speedRatio = Math.max(0.1, this.currentSpeedKnots / 15.0);

    // 1. Обновляем время в шейдере воды
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = elapsedSec;
      this.waterMaterial.uniforms.uSpeedKnots.value = this.currentSpeedKnots;
    }

    // 2. Обновляем время в линиях тока
    if (this.streamlineMaterial) {
      this.streamlineMaterial.uniforms.uTime.value = elapsedSec;
      this.streamlineMaterial.uniforms.uSpeed.value = speedRatio;
    }

    // 3. Обновляем время в шейдере давлений
    if (this.pressureMaterial) {
      this.pressureMaterial.uniforms.uTime.value = elapsedSec;
      this.pressureMaterial.uniforms.uSpeedMs.value = this.currentSpeedKnots * 0.514444;
    }

    // 4. Обновляем физику брызг у форштевня
    if (options.showSpray && this.currentSpeedKnots > 2.0) {
      this.updateSprayPhysics(deltaSec, params, bowParams);
    }
  }

  /**
   * Настройка водной поверхности с плотной сеткой для шейдерного волнообразования
   */
  private setupWaterSurface(
    params: BrusParams,
    bowLength: number,
    draft: number,
    showWake: boolean
  ) {
    if (this.waterMesh) {
      this.group.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh = null;
    }

    const waterLength = Math.max(220, params.length * 2.2);
    const waterWidth = Math.max(140, params.width * 7.5);
    const xStem = params.length / 2;

    // Плотная сетка полигонов (140x120) для плавной отрисовки волнового поля
    const segsX = 140;
    const segsZ = 120;
    const geom = new THREE.PlaneGeometry(waterLength, waterWidth, segsX, segsZ);
    geom.rotateX(-Math.PI / 2); // Горизонтальная плоскость XZ

    this.waterMaterial = createKelvinWaterMaterial({
      stemX: xStem,
      shipLength: params.length,
      shipWidth: params.width,
      draft,
      speedKnots: this.currentSpeedKnots,
    });

    this.waterMesh = new THREE.Mesh(geom, this.waterMaterial);
    this.waterMesh.position.set(0, draft, 0); // Высота на уровне КВЛ
    this.waterMesh.renderOrder = 2;
    this.waterMesh.visible = showWake;

    this.group.add(this.waterMesh);
  }

  /**
   * Создание и компоновка 3D линий тока (Streamlines)
   */
  private setupStreamlines(
    params: BrusParams,
    bowParams: BowParameters,
    bowLength: number,
    telemetry: HydroTelemetry
  ) {
    this.clearStreamlines();

    const paths: StreamlinePath[] = generateFlowStreamlines(params, bowParams, bowLength, telemetry);
    this.streamlineMaterial = createStreamlineShaderMaterial();

    paths.forEach((p) => {
      const pts = p.points;
      if (pts.length < 2) return;

      const numPoints = pts.length;
      const positions = new Float32Array(numPoints * 3);
      const progress = new Float32Array(numPoints);
      const velocities = new Float32Array(numPoints);

      for (let i = 0; i < numPoints; i++) {
        positions[i * 3 + 0] = pts[i].x;
        positions[i * 3 + 1] = pts[i].y;
        positions[i * 3 + 2] = pts[i].z;
        progress[i] = i / (numPoints - 1);
        velocities[i] = pts[i].u;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
      geom.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 1));

      const line = new THREE.Line(geom, this.streamlineMaterial!);
      line.renderOrder = 10;
      this.streamlinesGroup.add(line);
    });
  }

  private clearStreamlines() {
    while (this.streamlinesGroup.children.length > 0) {
      const obj = this.streamlinesGroup.children[0] as THREE.Line;
      this.streamlinesGroup.remove(obj);
      obj.geometry.dispose();
    }
  }

  /**
   * Создание материала давлений Бернулли
   */
  private setupPressureMaterial(params: BrusParams, bowParams: BowParameters, bowLength: number) {
    const xStem = params.length / 2;
    this.pressureMaterial = createBernoulliPressureMaterial({
      stemX: xStem,
      bowLength,
      draft: params.draft,
      entranceAngleDeg: bowParams.entranceAngle ?? 30,
      shoulderFullness: bowParams.shoulderFullness ?? 0.7,
      bulbLength: bowParams.stemProfile?.bulbLength ?? 0,
      speedMs: this.currentSpeedKnots * 0.514444,
    });
  }

  /**
   * Инициализация буферов частиц срыва брызг (Spray System)
   */
  private initSpraySystem() {
    this.sprayGeometry = new THREE.BufferGeometry();
    this.sprayPositions = new Float32Array(this.maxSprayCount * 3);
    this.sprayVelocities = new Float32Array(this.maxSprayCount * 3);
    this.sprayLifetimes = new Float32Array(this.maxSprayCount);

    for (let i = 0; i < this.maxSprayCount; i++) {
      this.sprayPositions[i * 3 + 0] = 0;
      this.sprayPositions[i * 3 + 1] = -100; // Спрятаны под воду
      this.sprayPositions[i * 3 + 2] = 0;
      this.sprayLifetimes[i] = Math.random();
    }

    this.sprayGeometry.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3));

    // Создаем круглую светящуюся текстуру капли
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.3, 'rgba(200, 240, 255, 0.8)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(32, 32, 32, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.PointsMaterial({
      size: 0.65,
      map: texture,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.sprayParticles = new THREE.Points(this.sprayGeometry, mat);
    this.sprayParticles.renderOrder = 20;
    this.group.add(this.sprayParticles);
  }

  /**
   * Физический пересчет движения капель брызг
   */
  private updateSprayPhysics(deltaSec: number, params: BrusParams, bowParams: BowParameters) {
    if (!this.sprayPositions || !this.sprayVelocities || !this.sprayLifetimes || !this.sprayGeometry) return;

    const xStem = params.length / 2;
    const dwl = params.draft;
    const entranceAngleRad = ((bowParams.entranceAngle ?? 30) * Math.PI) / 180;
    const speedRatio = this.currentSpeedKnots / 18.0;
    const gravity = 9.8;

    for (let i = 0; i < this.maxSprayCount; i++) {
      this.sprayLifetimes[i] += deltaSec * (1.2 + speedRatio * 0.8);

      if (this.sprayLifetimes[i] >= 1.0) {
        // Респавн капли в точке режущей кромки носа на уровне ватерлинии
        this.sprayLifetimes[i] = 0.0;
        const sideSign = i % 2 === 0 ? 1 : -1;
        const zSpread = (Math.random() * 0.4 + 0.1) * sideSign;
        const xOffset = Math.random() * 0.6;

        this.sprayPositions[i * 3 + 0] = xStem - xOffset;
        this.sprayPositions[i * 3 + 1] = dwl + Math.random() * 0.3;
        this.sprayPositions[i * 3 + 2] = zSpread;

        // Скорость вылета: назад, в сторону под углом входа и вверх
        const vSide = (2.5 + speedRatio * 4.0) * Math.sin(entranceAngleRad) * sideSign;
        const vUp = (1.5 + speedRatio * 3.5) * (0.8 + Math.random() * 0.6);
        const vBack = -(1.0 + speedRatio * 3.0);

        this.sprayVelocities[i * 3 + 0] = vBack + (Math.random() - 0.5);
        this.sprayVelocities[i * 3 + 1] = vUp;
        this.sprayVelocities[i * 3 + 2] = vSide;
      } else {
        // Движение по баллистической траектории
        this.sprayVelocities[i * 3 + 1] -= gravity * deltaSec; // Гравитация
        this.sprayPositions[i * 3 + 0] += this.sprayVelocities[i * 3 + 0] * deltaSec;
        this.sprayPositions[i * 3 + 1] += this.sprayVelocities[i * 3 + 1] * deltaSec;
        this.sprayPositions[i * 3 + 2] += this.sprayVelocities[i * 3 + 2] * deltaSec;

        // Если упала ниже воды — мгновенно гасим
        if (this.sprayPositions[i * 3 + 1] < dwl - 0.1) {
          this.sprayLifetimes[i] = 1.0;
        }
      }
    }

    this.sprayGeometry.attributes.position.needsUpdate = true;
  }

  public dispose() {
    this.clearStreamlines();
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      if (this.waterMaterial) this.waterMaterial.dispose();
    }
    if (this.sprayParticles) {
      this.sprayParticles.geometry.dispose();
    }
  }
}
