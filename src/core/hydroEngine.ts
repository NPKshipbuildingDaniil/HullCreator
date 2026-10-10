/**
 * ====================================================================================================
 * 📁 src/core/hydroEngine.ts
 * ====================================================================================================
 * 📌 НАЗНАЧЕНИЕ:
 * Математический модуль экспресс-гидродинамики судна и расчета мореходных качеств
 * на базе полуэмпирических методов теории корабля:
 * 1. Метод ITTC-1957 (International Towing Tank Conference) для гидродинамического трения.
 * 2. Метод Холтропа — Меннена (Holtrop & Mennen) для волнового сопротивления и влияния бульба.
 * 3. Расчет волнообразования (носовой бурун, расходящиеся волны Кельвина).
 * 4. Динамическая посадка (Squat effect: ходовой дифферент и просадка корпуса).
 * 5. Критерий заливаемости бака и мореходной безопасности палубы.
 * 6. Расчет поля давлений Бернулли вдоль корпуса для тепловых карт.
 * ====================================================================================================
 */

import { BrusParams } from './types';
import { BowParameters } from './topologyTypes';

export interface HydroTelemetry {
  /** Скорость хода в узлах */
  speedKnots: number;
  /** Скорость хода в м/с */
  speedMs: number;
  /** Число Фруда по длине КВЛ: Fn = V / sqrt(g * L_wl) */
  froudeNumber: number;
  /** Число Рейнольдса: Re = (V * L_wl) / nu */
  reynoldsNumber: number;
  /** Гидродинамический режим движения */
  regime: 'displacement' | 'semi-displacement' | 'planing';
  /** Название режима движения на русском */
  regimeLabel: string;
  /** Коэффициент трения ITTC-1957 (Cf) */
  frictionCoeff: number;
  /** Форм-фактор корпуса (1 + k) */
  formFactor: number;
  /** Смоченная площадь поверхности корпуса S_wet (м²) */
  wettedSurfaceArea: number;
  /** Сопротивление трения R_F (кН) */
  frictionResistanceKN: number;
  /** Волновое сопротивление R_W (кН) */
  waveResistanceKN: number;
  /** Дополнительное сопротивление бульба / эффект волногашения (кН) */
  bulbEffectKN: number;
  /** Полное буксировочное сопротивление R_T (кН) */
  totalResistanceKN: number;
  /** Эффективная буксировочная мощность P_E (кВт) */
  effectivePowerKW: number;
  /** Эффективная буксировочная мощность P_E (л.с.) */
  effectivePowerHP: number;
  /** Динамический ходовой дифферент (градусы, '+' дифферент на нос, '-' на корму) */
  dynamicTrimDeg: number;
  /** Динамическая просадка корпуса (Squat effect / Heave) в метрах */
  dynamicSinkageM: number;
  /** Высота носового буруна (подпорной волны у форштевня) zeta_bow (м) */
  bowWaveHeightM: number;
  /** Высота свободного надводного борта в носу H_freeboard (м) */
  bowFreeboardM: number;
  /** Индекс безопасности палубы от заливания водой DeckSafety (0..100%) */
  deckSafetyIndex: number;
  /** Категория безопасности заливания */
  deckSafetyStatus: 'safe' | 'warning' | 'danger';
  /** Доля трения в общем сопротивлении (%) */
  frictionRatioPercent: number;
  /** Доля волнового сопротивления в общем сопротивлении (%) */
  waveRatioPercent: number;
}

export interface StreamlinePoint {
  x: number;
  y: number;
  z: number;
  u: number; // Нормализованная скорость обтекания (1.0 = скорость набегающего потока)
  pressure: number; // Безразмерный коэффициент давления Cp
}

export interface StreamlinePath {
  id: string;
  name: string;
  side: 'starboard' | 'port' | 'keel';
  points: StreamlinePoint[];
}

/**
 * Расчет смоченной поверхности бруса с учетом носовой формы
 */
export function estimateWettedSurface(params: BrusParams, bowLength: number): number {
  const L = params.length;
  const B = params.width;
  const T = Math.min(params.draft, params.height + params.deadrise);
  const R = params.radius;
  const deadrise = params.deadrise;
  const flare = params.flare;

  // Длина параллельной цилиндрической вставки
  const L_mid = Math.max(0, L - bowLength);

  // Периметр смоченного шпангоута на миделе
  // Днище (половина ширины) + скула + борт
  const bottomHalf = Math.max(0, B / 2 - R);
  const bottomLength = 2 * Math.sqrt(bottomHalf * bottomHalf + deadrise * deadrise);
  const bilgeArc = Math.PI * 0.5 * R;
  const sideLength = Math.max(0, T - deadrise);
  const midPerimeter = bottomLength + 2 * bilgeArc + 2 * sideLength;

  // Площадь смоченной поверхности мидельной части
  const S_mid = midPerimeter * L_mid;

  // Смоченная поверхность носовой части (интегральное сужение)
  const bowReductionFactor = 0.72; // Коэффициент полноты носового конуса
  const S_bow = midPerimeter * bowLength * bowReductionFactor;

  return Math.max(10, S_mid + S_bow);
}

/**
 * Комплексный расчет гидродинамики и телеметрии судна
 */
export function computeHydrodynamics(
  params: BrusParams,
  bowParams: BowParameters,
  bowLength: number,
  speedKnots: number
): HydroTelemetry {
  const speed = Math.max(0.1, speedKnots);
  const V = speed * 0.514444; // узлы -> м/с
  const g = 9.80665;
  const rho = 1025; // Морская вода, кг/м³
  const nu = 1.188e-6; // Кинематическая вязкость воды (м²/с) при 15°C

  const L_wl = Math.max(5, params.length);
  const B_mid = Math.max(1, params.width);
  const T_draft = Math.max(0.2, params.draft);
  const H_total = Math.max(T_draft + 0.1, params.height + (params.deckCamber ?? 0));

  // 1. Число Рейнольдса и Фруда
  const Re = Math.max(1e5, (V * L_wl) / nu);
  const Fn = V / Math.sqrt(g * L_wl);

  // Классификация режима
  let regime: 'displacement' | 'semi-displacement' | 'planing' = 'displacement';
  let regimeLabel = 'Водоизмещающий (Fn < 0.40)';
  if (Fn >= 1.0) {
    regime = 'planing';
    regimeLabel = 'Глиссирующий (Fn ≥ 1.00)';
  } else if (Fn >= 0.4) {
    regime = 'semi-displacement';
    regimeLabel = 'Переходный (0.40 ≤ Fn < 1.00)';
  }

  // 2. Смоченная площадь
  const Swet = estimateWettedSurface(params, bowLength);

  // 3. Сопротивление трения по ITTC-1957
  const Cf = 0.075 / Math.pow(Math.log10(Re) - 2, 2);

  // Форм-фактор (1 + k) по методу Холтропа
  const entranceAngleDeg = bowParams.entranceAngle ?? 30;
  const shoulderFullness = bowParams.shoulderFullness ?? 0.7;
  const bulbLength = bowParams.stemProfile?.bulbLength ?? 0;
  const hasBulb = bulbLength > 0.5;

  const B_over_L = B_mid / L_wl;
  const T_over_B = T_draft / B_mid;
  const formFactor_k = 0.08 + 0.12 * Math.pow(B_over_L, 0.8) + 0.05 * shoulderFullness + (params.flare > 0 ? 0.02 : 0);
  const onePlusK = 1 + formFactor_k;

  // Сопротивление трения (кН)
  const Rf = (0.5 * rho * Math.pow(V, 2) * Swet * Cf * onePlusK) / 1000;

  // 4. Волновое сопротивление R_W (метод Холтропа с учетом угла заострения и бульба)
  const alphaRad = (entranceAngleDeg * Math.PI) / 180;
  // Влияние бульба на гашение носовой волны
  const bulbWaveReduction = hasBulb ? Math.max(0.65, 1.0 - (bulbLength / (bowLength || 10)) * 0.45) : 1.0;

  // Волновой коэффициент Cw
  // При Fn < 0.4 волновое сопротивление растет пропорционально Fn^4, затем переходит в горб сопротивления
  const waveFnExponent = Fn < 0.45 ? 4.2 : 3.4;
  const CwBase = 0.0018 * Math.pow(Fn, waveFnExponent) * Math.sin(alphaRad) * Math.pow(shoulderFullness, 1.2);
  const Cw = CwBase * bulbWaveReduction;

  const Rw = Math.max(0.01, (0.5 * rho * Math.pow(V, 2) * Swet * Cw) / 1000);

  // Эффект бульба в кН (разница с безнабульбовым вариантом)
  const RwWithoutBulb = (0.5 * rho * Math.pow(V, 2) * Swet * CwBase) / 1000;
  const bulbEffectKN = hasBulb ? RwWithoutBulb - Rw : 0;

  // Полное сопротивление R_T и мощность P_E
  const Rt = Rf + Rw;
  const Pe = Rt * V; // кВт
  const PeHP = Pe * 1.35962; // л.с.

  // 5. Высота носового буруна (Bow Wave Crest)
  // Волновой подпор у форштевня: zeta_bow = (V^2 / 2g) * sin^1.2(alpha) * bulb_factor
  const bowWaveHeight = Math.min(
    H_total * 1.5,
    (Math.pow(V, 2) / (2 * g)) * Math.pow(Math.sin(alphaRad), 1.1) * (hasBulb ? 0.82 : 1.0)
  );

  // 6. Надводный борт и критерий заливаемости палубы
  const sheerBow = bowParams.bowSheer ?? 0;
  const bowFreeboard = H_total + sheerBow - T_draft;
  const safeMargin = bowFreeboard - bowWaveHeight;
  const safetyRatio = Math.max(0, Math.min(1.0, safeMargin / Math.max(0.5, bowFreeboard)));
  const deckSafetyIndex = Math.round(safetyRatio * 100);

  let deckSafetyStatus: 'safe' | 'warning' | 'danger' = 'safe';
  if (deckSafetyIndex < 35) {
    deckSafetyStatus = 'danger';
  } else if (deckSafetyIndex < 70) {
    deckSafetyStatus = 'warning';
  }

  // 7. Динамическая посадка (Squat effect: ходовой дифферент и просадка)
  // На малых Fn дифферент слегка на нос из-за провала у плеча, на больших Fn (полуглиссирование) задирает нос
  let dynamicTrimDeg = 0;
  let dynamicSinkageM = 0;

  if (Fn < 0.35) {
    // Водоизмещающий режим: легкая просадка носа из-за разрежения у плеча
    dynamicTrimDeg = +0.25 * Math.pow(Fn / 0.35, 2) * Math.sin(alphaRad);
    dynamicSinkageM = 0.08 * Math.pow(Fn / 0.35, 2) * (T_draft / 4.5);
  } else if (Fn < 0.65) {
    // Переходный режим: просадка кормы, выход носа из воды
    const transRatio = (Fn - 0.35) / 0.30;
    dynamicTrimDeg = +0.25 * (1 - transRatio) - 1.6 * transRatio;
    dynamicSinkageM = 0.08 + 0.25 * transRatio;
  } else {
    // Высокие скорости: ярко выраженный дифферент на корму (глиссирование)
    dynamicTrimDeg = -1.6 - 1.8 * Math.min(1.5, Fn - 0.65);
    dynamicSinkageM = 0.33 - 0.15 * Math.min(1.0, Fn - 0.65);
  }

  const frictionRatioPercent = Math.round((Rf / Math.max(0.001, Rt)) * 100);
  const waveRatioPercent = 100 - frictionRatioPercent;

  return {
    speedKnots: Number(speed.toFixed(1)),
    speedMs: Number(V.toFixed(2)),
    froudeNumber: Number(Fn.toFixed(3)),
    reynoldsNumber: Math.round(Re),
    regime,
    regimeLabel,
    frictionCoeff: Number(Cf.toFixed(6)),
    formFactor: Number(onePlusK.toFixed(3)),
    wettedSurfaceArea: Number(Swet.toFixed(1)),
    frictionResistanceKN: Number(Rf.toFixed(1)),
    waveResistanceKN: Number(Rw.toFixed(1)),
    bulbEffectKN: Number(bulbEffectKN.toFixed(1)),
    totalResistanceKN: Number(Rt.toFixed(1)),
    effectivePowerKW: Number(Pe.toFixed(1)),
    effectivePowerHP: Number(PeHP.toFixed(0)),
    dynamicTrimDeg: Number(dynamicTrimDeg.toFixed(2)),
    dynamicSinkageM: Number(dynamicSinkageM.toFixed(3)),
    bowWaveHeightM: Number(bowWaveHeight.toFixed(2)),
    bowFreeboardM: Number(bowFreeboard.toFixed(2)),
    deckSafetyIndex,
    deckSafetyStatus,
    frictionRatioPercent,
    waveRatioPercent,
  };
}

/**
 * Генерация набора 3D линий тока (Streamlines) вокруг носовой части корпуса
 */
export function generateFlowStreamlines(
  params: BrusParams,
  bowParams: BowParameters,
  bowLength: number,
  telemetry: HydroTelemetry
): StreamlinePath[] {
  const streamlines: StreamlinePath[] = [];
  const L = params.length;
  const B = params.width;
  const T = params.draft;
  const xStem = L / 2;
  const xMid = xStem - bowLength;
  const xStern = -L / 2;

  const numRibbonsPerSide = 7;
  const entranceAngleRad = ((bowParams.entranceAngle ?? 30) * Math.PI) / 180;
  const shoulderFullness = bowParams.shoulderFullness ?? 0.7;
  const bulbLen = bowParams.stemProfile?.bulbLength ?? 0;

  // Бортовые линии тока (Правый и Левый борт на разных уровнях погружения Z)
  for (let s = 0; s < 2; s++) {
    const isPort = s === 1;
    const sideSign = isPort ? -1 : 1;
    const sideLabel = isPort ? 'port' : 'starboard';

    for (let i = 0; i < numRibbonsPerSide; i++) {
      const zFrac = (i + 0.5) / numRibbonsPerSide; // 0 (киль) .. 1 (КВЛ)
      const currentZ = T * zFrac;
      const pts: StreamlinePoint[] = [];

      // Количество шагов вдоль корпуса от набегающего потока перед носом до кормы
      const steps = 40;
      for (let st = 0; st <= steps; st++) {
        const uNorm = st / steps; // 0..1
        // x от (xStem + 15) до xStern
        const xWorld = (xStem + 12) * (1 - uNorm) + (xMid - 20) * uNorm;

        let yHalf = 0;
        let localVel = 1.0;
        let cp = 0.0;

        if (xWorld > xStem) {
          // Набегающий поток перед носом (торможение)
          const distToStem = xWorld - xStem;
          const spread = Math.exp(-distToStem / 4.0);
          yHalf = (0.2 + (1 - zFrac) * (bulbLen > 0 ? 0.8 : 0.2)) * (1 - spread) + (B / 2) * spread * 0.15;
          localVel = Math.max(0.1, 1.0 - 0.7 * Math.exp(-distToStem / 2.5));
          cp = 1.0 - Math.pow(localVel, 2); // Пик давления
        } else if (xWorld >= xMid) {
          // Носовая часть (обтекание кривой Безье с разгоном у плеча)
          const tBow = Math.max(0, Math.min(1, (xStem - xWorld) / Math.max(0.1, bowLength)));
          // Профиль полушироты ватерлинии на данном горизонте
          const maxLocalHalfBreadth = (B / 2) * (0.3 + 0.7 * Math.pow(zFrac, 0.5));
          const bowCurve = Math.pow(tBow, 1.0 / Math.max(0.2, shoulderFullness));
          yHalf = (0.05 + maxLocalHalfBreadth * bowCurve) + 0.15 * Math.sin(tBow * Math.PI);

          // Ускорение потока у плеча (tBow ~ 0.5..0.8)
          const shoulderAccel = Math.sin(tBow * Math.PI) * 0.45 * (entranceAngleRad / 0.6);
          localVel = 0.5 + 0.6 * tBow + shoulderAccel;
          cp = 1.0 - Math.pow(localVel, 2); // Разрежение (синяя зона)
        } else {
          // Параллельная средняя часть корпуса
          yHalf = (B / 2) * (0.3 + 0.7 * Math.pow(zFrac, 0.5));
          localVel = 1.02;
          cp = 1.0 - Math.pow(localVel, 2);
        }

        // Подъем / прогиб по вертикали из-за носовой волны
        const waveDip = (telemetry.bowWaveHeightM * 0.6) * Math.exp(-Math.abs(xWorld - xStem) / 5.0) * Math.cos((xStem - xWorld) * 0.4);
        const yWorld = currentZ + waveDip;

        pts.push({
          x: xWorld,
          y: yWorld,
          z: yHalf * sideSign,
          u: localVel,
          pressure: cp,
        });
      }

      streamlines.push({
        id: `stream_${sideLabel}_${i}`,
        name: `Линия тока ${i + 1} (${sideLabel})`,
        side: sideLabel as 'starboard' | 'port',
        points: pts,
      });
    }
  }

  // Днищевая линия тока вдоль киля (с обтеканием бульба)
  const keelPts: StreamlinePoint[] = [];
  for (let k = 0; k <= 35; k++) {
    const frac = k / 35;
    const x = (xStem + 14) * (1 - frac) + (xMid - 25) * frac;
    let y = 0.05;
    let localVel = 1.0;

    if (x > xStem) {
      y = 0.05;
      localVel = Math.max(0.2, 1.0 - 0.6 * Math.exp(-(x - xStem) / 3.0));
    } else if (x >= xMid) {
      const t = (xStem - x) / Math.max(0.1, bowLength);
      // Бульбовый подныр под днище
      y = 0.05 + (bulbLen > 0 ? 0.3 * Math.sin(t * Math.PI) : 0);
      localVel = 0.8 + 0.35 * Math.sin(t * Math.PI);
    } else {
      y = 0.05;
      localVel = 1.0;
    }

    keelPts.push({
      x,
      y,
      z: 0,
      u: localVel,
      pressure: 1.0 - Math.pow(localVel, 2),
    });
  }

  streamlines.push({
    id: 'stream_keel_dp',
    name: 'Килевая линия тока (ДП)',
    side: 'keel',
    points: keelPts,
  });

  return streamlines;
}
