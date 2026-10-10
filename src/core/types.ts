/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/types.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Данный файл является единым источником типизации данных (Single Source of Truth) для всего проекта
 * «3D Брус - Редактор». Здесь определены все ключевые структуры данных, интерфейсы параметров геометрии,
 * темы оформления интерфейса и математические примитивы для 2D/3D расчетов.
 * 
 * 📦 СОСТАВ ХРАНИМОЙ ИНФОРМАЦИИ:
 * 1. `BrusParams` — полный набор геометрических и визуальных параметров бруса:
 *    - `length` (длина в метрах, L)
 *    - `width` (базовая ширина в метрах, B)
 *    - `height` (высота борта в метрах, H)
 *    - `draft` (величина осадки/ватерлинии в метрах, T)
 *    - `draftColorIndex` (индекс цвета подводной части: красный/синий/зеленый)
 *    - `radius` (радиус скругления скулы в метрах, R)
 *    - `flare` (развал бортов наружу в метрах)
 *    - `deadrise` (килеватость днища в метрах)
 *    - `gridSize` (размер ячейки сетки пространства)
 *    - `brusColor` (шестнадцатеричный цвет материала бруса)
 * 2. `ThemeStyle` — стили оформления панели управления: 'minimalism' | 'scandinavian' | 'industrial'.
 * 3. `Point2D` — 2D точка с координатами {x, y} для сечений и векторов.
 * 4. `FilletResult` — математический результат расчета внешнего скругления (центр сопряжения и точки касания).
 * 5. `DRAFT_COLORS` — предустановленные оттенки для подводной части корпуса.
 * ====================================================================================================
 */

export interface BrusParams {
  /** Длина бруса в метрах */
  length: number;
  /** Базовая ширина днища бруса в метрах */
  width: number;
  /** Высота бруса в метрах */
  height: number;
  /** Осадка (уровень ватерлинии от нижней точки киля) в метрах */
  draft: number;
  /** Индекс цвета подводной части корпуса (0, 1, 2) */
  draftColorIndex: number;
  /** Радиус скругления скулы в метрах */
  radius: number;
  /** Развал (+) / Завал (-) бортов в метрах (изменение полуширины палубы относительно днища) */
  flare: number;
  /** Килеватость днища в метрах (подъем скулы относительно киля) */
  deadrise: number;
  /** Учитывать килеватость в общую высоту бруса (H) */
  deadriseInHeight?: boolean;
  /** Высота погиби палубы в метрах (подъем центра палубы) */
  deckCamber: number;
  /** Учитывать погибь палубы в общую высоту бруса (H) */
  deckCamberInHeight?: boolean;
  /** Радиус скругления ширстрека в метрах (сопряжение борта и палубы) */
  sheerRadius: number;
  /** Отображение верхней крышки (палубы) */
  showDeckCover: boolean;
  /** Размер ячейки 3D сетки пространства в метрах */
  gridSize: number;
  /** Цвет материала бруса (HEX число) */
  brusColor: number;
}

export type ThemeStyle = 'minimalism' | 'scandinavian' | 'industrial';

// ─── B-SPLINE & CONTROL NET GEOMETRIC ENGINE TYPES (FREE!ship Architecture) ───

/**
 * Параметры канонического поперечного шпангоута
 */
export interface CanonicalFrameParams {
  flatOfKeel: number;       // b_k: полуширина плоского киля (м)
  deadriseAngle: number;    // beta: угол килеватости (градусы)
  hollowSagitta: number;    // delta: стрелка вогнутости днища (м)
  bilgeRadius: number;      // R: радиус скулового скругления (м)
  flareAngle?: number;      // угол развала борта у палубы (градусы)
  tumblehome?: number;      // завал верхнего борта внутрь (0..1)
  length?: number;
}

/**
 * Параметры редактируемого носового шпангоута в пространстве
 */
export interface BowIntermediateFrame {
  positionRatio: number;    // u_frame: положение по длине носа (0.1..0.66)
  spreadInfluence: number;  // lambda_spread: параметр «Распределение» (0.0..1.0)
  params: CanonicalFrameParams;
}

/**
 * Конфигуратор дискретизации сетки
 */
export interface MeshTessellationConfig {
  stationsCount: number;    // число станций u (например, 64)
  waterlinesCount: number;  // число поясов v (например, 48)
}

/**
 * Контрольная точка управляющей сети (свойства вершины FREE!ship)
 */
export interface ControlPoint3D {
  x: number;
  y: number;
  z: number;
  isCrease?: boolean; // Ребро излома (C0 / G0 стык)
}

/**
 * Описание B-сплайн поверхности (Tensor-Product B-Spline Surface)
 */
export interface BSplineSurfaceDescriptor {
  degreeU: number; // 3 (бикубический по U)
  degreeV: number; // 3 (бикубический по V)
  knotsU: number[]; // Зажатый узловой вектор U
  knotsV: number[]; // Зажатый узловой вектор V (с узлами Crease)
  controlNet: ControlPoint3D[][]; // Матрица (numU x numV)
}

/**
 * Конфигурация дискретизации аналитического ядра
 */
export interface TessellationConfig {
  uSegments: number; // Шаг разбиения по длине (например, 48)
  vSegments: number; // Шаг разбиения по высоте (например, 32)
}

export * from './topologyTypes';
export * from './stemEngine';

export interface Point2D {
  x: number;
  y: number;
}

export interface FilletResult {
  /** Центр окружности скругления */
  center: Point2D;
  /** Первая точка касания (на первой прямой) */
  touch1: Point2D;
  /** Вторая точка касания (на второй прямой) */
  touch2: Point2D;
  /** Радиус скругления */
  radius: number;
}

/** Предустановленная палитра цветов для подводной части (осадки) */
export const DRAFT_COLORS: number[] = [
  0xd4a5a5, // Коралловый / Красноватый сурик
  0xa5b8d4, // Морской стальной / Синий
  0xa5d4b8, // Мятный / Бирюзово-зеленый
];
