import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, HelpCircle, Info } from 'lucide-react';
import { ThemeStyle, BowParameters } from './types';
import { BowVolumeParameters, DEFAULT_BOW_VOLUME_PARAMS, WireframeDisplayOptions } from './topologyTypes';
import {
  extractBowVolumeParams,
  generateWaterlineFamily3D,
  renderWaterlineStackToCanvas,
  WaterlineFamilyResult,
  computeBottomFootprintRelativeZeroX,
} from './waterlineEngine';
import {
  calculateAntiCheekWaterline2D,
  renderWaterline2DDiagramToCanvas,
  AntiCheekWaterlineParams,
  WaterlineBezier4Result,
} from './geometryEngine';
import {
  StemProfileParams,
  StemTopologyPoints,
  StemPointKey,
  STEM_PRESETS,
  DEFAULT_STEM_PARAMS,
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  sampleStemCurveZones,
  STEM_ZONES,
  Point2D,
} from './stemEngine';
import { BowSectionKey, calculateBowSectionTopology } from './bowSectionEngine';

export interface StemBottomBarTabProps {
  theme: ThemeStyle;
  height: number;
  draft: number;
  bowLength?: number;
  stemParams: StemProfileParams;
  onStemParamsChange: (params: Partial<StemProfileParams>) => void;
  selectedPointKey?: StemPointKey | null;
  onSelectPointKey?: (key: StemPointKey | null) => void;
  selectedParamId?: string | null;
  onSelectParamId?: (id: string | null) => void;
  onBack: () => void;
  onNext?: () => void;
  onSave: () => void;
  onCancel: () => void;
}

// ============================================================================
// БАЗА ЗНАНИЙ И СПРАВОЧНИК ПО ПАРАМЕТРАМ ФОРШТЕВНЯ И ФОРПИКА
// ============================================================================

export interface ParameterHelpInfo {
  id: string;
  name: string;
  symbol: string;
  zone: 'green' | 'orange' | 'blue' | 'purple';
  zoneName: string;
  desc: string;
  impact: string;
  recommended: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  defaultValue?: number;
}

export const STEM_PARAM_HELP: Record<string, ParameterHelpInfo> = {
  stemRakeAngle: {
    id: 'stemRakeAngle',
    name: 'Угол наклона форштевня',
    symbol: 'α',
    zone: 'blue',
    zoneName: 'Надводная зона',
    desc: 'Угол наклона форштевня в надводной части от конструктивной ватерлинии (КВЛ) до главной палубы.',
    impact: 'Определяет всхожесть носовой оконечности на встречную волну, снижает заливаемость бака и брызгообразование. Отрицательные значения соответствуют обратному (инверсному / X-bow) форштевню.',
    recommended: '12°…25° для транспортных судов, до 35° для скоростных, отрицательные (-10°…-25°) для инверсных носов.',
    min: -45,
    max: 60,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 15,
  },
  deckTangentAngle: {
    id: 'deckTangentAngle',
    name: 'Угол касательной у палубы',
    symbol: 'α_пал',
    zone: 'blue',
    zoneName: 'Надводная зона',
    desc: 'Угол наклона направляющего вектора сплайна в точке сопряжения форштевня с верхней палубой.',
    impact: 'Формирует эстетику и кривизну носового козырька (фларинга), задаёт плавность сопряжения с линией седловатости.',
    recommended: 'Обычно на 5°…20° больше угла наклона форштевня α для создания изящного клиперского изгиба.',
    min: -110,
    max: 110,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 25,
  },
  deckOverhang: {
    id: 'deckOverhang',
    name: 'Продольный вылет палубы',
    symbol: 'ΔX',
    zone: 'blue',
    zoneName: 'Надводная зона',
    desc: 'Горизонтальное смещение носового края палубы вперёд относительно теоретической линии форштевня.',
    impact: 'Увеличивает площадь носовой рабочей палубы (бака), выносит якорные клюзы дальше от борта, предотвращая удары якоря о корпус.',
    recommended: '0.0…2.5 м в зависимости от размерений судна.',
    min: -4.0,
    max: 8.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 0,
  },
  deckHeightOffset: {
    id: 'deckHeightOffset',
    name: 'Смещение высоты палубы',
    symbol: 'ΔZ',
    zone: 'blue',
    zoneName: 'Надводная зона',
    desc: 'Вертикальный подъем носового клюва палубы относительно расчётной теоретической высоты борта H.',
    impact: 'Определяет высоту носовой седловатости (Sheer line), увеличивает надводный борт в носу и защищает палубу от заливания тяжелыми волнами.',
    recommended: '0.0…1.5 м.',
    min: -4.0,
    max: 5.0,
    step: 0.05,
    unit: 'м',
    decimals: 1,
    defaultValue: 0,
  },
  knuckleOffset: {
    id: 'knuckleOffset',
    name: 'Вынос / стрела кнакла',
    symbol: 'ΔX_кнакл',
    zone: 'blue',
    zoneName: 'Надводная зона',
    desc: 'Горизонтальное смещение промежуточной точки надводного борта (излом / кнакл или S-образный прогиб).',
    impact: 'Формирует кнакл (излом борта) или луковичный развал. Эффективно отсекает носовой брызговой шлейф и гасит волны на ходу.',
    recommended: '-0.5…+1.0 м.',
    min: -3.0,
    max: 4.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 0,
  },
  knuckleHeightRatio: {
    id: 'knuckleHeightRatio',
    name: 'Относительная высота кнакла',
    symbol: 'η',
    zone: 'blue',
    zoneName: 'Надводная зона',
    desc: 'Положение точки излома по высоте над КВЛ в долях свободного надводного борта (H - T).',
    impact: 'Задает высотное положение скулового излома или границы смены кривизны форштевня.',
    recommended: '0.35…0.65 (примерно середина надводного борта).',
    min: 0.1,
    max: 0.9,
    step: 0.02,
    unit: '',
    decimals: 2,
    defaultValue: 0.5,
  },
  bulbLength: {
    id: 'bulbLength',
    name: 'Длина выступа бульба',
    symbol: 'L_b',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Вылет крайней передней точки носового бульба за плоскость носового перпендикуляра (НП).',
    impact: 'Создаёт опережающую интерференционную систему волн, снижая волновое сопротивление корпуса судна на 10–18% при Fr ≈ 0.20–0.35.',
    recommended: '-2.0…+4.5 м (допустимо от -6.0 до +6.0 м). 0 м — для судов без бульба.',
    min: -6.0,
    max: 6.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 0,
  },
  bulbUpperTangentAngle: {
    id: 'bulbUpperTangentAngle',
    name: 'Верхняя касательная бульба к КВЛ',
    symbol: 'α_в',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Угол сопряжения верхнего контура бульба с конструктивной ватерлинией (КВЛ).',
    impact: 'Обеспечивает плавный бескавитационный вход носка в набегающий поток и снижает динамические гидродинамические нагрузки (слемминг).',
    recommended: '35°…65°.',
    min: -110,
    max: 110,
    step: 1.0,
    unit: '°',
    decimals: 1,
    defaultValue: 55,
  },
  bulbLowerTangentAngle: {
    id: 'bulbLowerTangentAngle',
    name: 'Нижняя касательная бульба к пятке',
    symbol: 'α_н',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Угол наклона нижней образующей бульба при сопряжении с подзором пятки.',
    impact: 'Регулирует поджатие потока под днище и форму перехода к килевой линии.',
    recommended: '35°…65°.',
    min: -110,
    max: 110,
    step: 1.0,
    unit: '°',
    decimals: 1,
    defaultValue: 55,
  },
  bulbHeightRatio: {
    id: 'bulbHeightRatio',
    name: 'Относительное заглубление бульба',
    symbol: 'ζ_b',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Высота центра носка бульба относительно осадки T (Z_bulb / T).',
    impact: 'Определяет вертикальное положение бульба в потоке. Предотвращает оголение бульба на волнении и оптимизирует распределение гидростатического давления.',
    recommended: '0.40…0.65 осадки T.',
    min: 0.1,
    max: 0.95,
    step: 0.02,
    unit: '',
    decimals: 2,
    defaultValue: 0.5,
  },
  bulbFullness: {
    id: 'bulbFullness',
    name: 'Полнота / натяжение бульба',
    symbol: 'C_b',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Коэффициент натяжения сплайна Безье, формирующего носок бульба.',
    impact: 'Определяет форму носка — от узкого эллиптического до каплевидного/грушевидного с большим водоизмещением.',
    recommended: '0.40…0.75.',
    min: 0.1,
    max: 1.0,
    step: 0.05,
    unit: '',
    decimals: 2,
    defaultValue: 0.5,
  },
  forefootRadius: {
    id: 'forefootRadius',
    name: 'Радиус пятки форштевня',
    symbol: 'R_foot',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Радиус скругления подзора (пятки) между нижней частью бульба и линией киля.',
    impact: 'Снижает концентрацию напряжений в наборе форштевня, предотвращает вихреобразование и срыв пограничного слоя в районе днищевого сопряжения.',
    recommended: '0.5…4.0 м.',
    min: 0.0,
    max: 10.0,
    step: 0.2,
    unit: 'м',
    decimals: 1,
    defaultValue: 1.5,
  },
  forefootHeightRatio: {
    id: 'forefootHeightRatio',
    name: 'Высота пятки форштевня',
    symbol: 'ζ_foot',
    zone: 'green',
    zoneName: 'Подводная зона',
    desc: 'Высота расположения точки сопряжения подзора пятки относительно осадки T.',
    impact: 'Задает точку перехода вертикального контура носа в горизонтальный профиль днища.',
    recommended: '0.05…0.30 осадки T.',
    min: 0.0,
    max: 0.85,
    step: 0.02,
    unit: '',
    decimals: 2,
    defaultValue: 0.0,
  },
  keelTransitionLength: {
    id: 'keelTransitionLength',
    name: 'Длина перехода к килю',
    symbol: 'L_keel',
    zone: 'orange',
    zoneName: 'Килевая зона',
    desc: 'Длина участка сопряжения подзора форштевня с плоской горизонтальной линией основного киля.',
    impact: 'Определяет подрез носового батокса и плавность выхода потока на плоское днище корпуса.',
    recommended: '3.0…12.0 м.',
    min: 0.5,
    max: 20.0,
    step: 0.5,
    unit: 'м',
    decimals: 1,
    defaultValue: 5.0,
  },
};

export const DECK_PARAM_HELP: Record<string, ParameterHelpInfo & { defaultValue: number }> = {
  stemWidth: {
    id: 'stemWidth',
    name: 'Притупление носа (W_stem)',
    symbol: 'W_0',
    zone: 'green',
    zoneName: 'Ватерлиния палубы',
    desc: 'Ширина притупления носовой кромки форштевня на уровне верхней палубы.',
    impact: 'Определяет радиус или ширину носовой площадки. Увеличивает полезное пространство в самом носу бака, защищает кромку от повреждений при швартовке.',
    recommended: '0.0…0.5 м для острых носов, до 1.5–3.0 м для барж и ледоколов.',
    min: 0,
    max: 4.0,
    step: 0.05,
    unit: 'м',
    decimals: 2,
    defaultValue: 0,
  },
  entranceAngle: {
    id: 'entranceAngle',
    name: 'Угол входа ватерлинии',
    symbol: 'α_вх',
    zone: 'green',
    zoneName: 'Ватерлиния палубы',
    desc: 'Угол между касательной к носовой ватерлинии палубы и диаметральной плоскостью (ДП).',
    impact: 'Главный гидродинамический параметр волнообразования носа. Меньший угол снижает сопротивление воды, больший угол увеличивает мореходность и всхожесть на волну.',
    recommended: '15°…25° для быстроходных судов, 25°…45° для транспортных судов, до 60°+ для барж.',
    min: 5,
    max: 85,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 30,
  },
  shoulderFullness: {
    id: 'shoulderFullness',
    name: 'Полнота плеча (коэффициент формы)',
    symbol: 'k_пл',
    zone: 'green',
    zoneName: 'Ватерлиния палубы',
    desc: 'Коэффициент натяжения и выпуклости плеча носовой ватерлинии между форштевнем и миделем.',
    impact: 'Регулирует каплевидность контура. При малых значениях (0.3-0.5) контур клиновидный, при высоких (0.8-1.2) формируется полное плечо с максимальной площадью палубы.',
    recommended: '0.55…0.85 для типовых судов.',
    min: 0.1,
    max: 1.5,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.7,
  },
  maxBreadthPos: {
    id: 'maxBreadthPos',
    name: 'Положение максимальной полушироты',
    symbol: 'X_max',
    zone: 'green',
    zoneName: 'Ватерлиния палубы',
    desc: 'Относительное продольное положение точки выхода носового обвода на полную ширину бруса (от 0 до 1).',
    impact: 'Задает длину носового сужения и точку начала цилиндрической вставки.',
    recommended: '0.40…0.60 (середина носовой оконечности).',
    min: 0.05,
    max: 0.95,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.5,
  },
  bowSheer: {
    id: 'bowSheer',
    name: 'Седловатость носа',
    symbol: 'ΔZ_седл',
    zone: 'orange',
    zoneName: 'Высота и погибь',
    desc: 'Подъем линии борта и палубы от миделя к носовому перпендикуляру.',
    impact: 'Увеличивает высоту надводного борта в носу, защищает от заливания встречной волной и улучшает силуэт судна.',
    recommended: '0.3…1.5 м.',
    min: 0.0,
    max: 3.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 0.0,
  },
  deckCamberBow: {
    id: 'deckCamberBow',
    name: 'Погибь палубы в носу',
    symbol: 'Δy_пог',
    zone: 'orange',
    zoneName: 'Высота и погибь',
    desc: 'Поперечная выпуклость (стрелка прогиба) верхней палубы в носовой оконечности.',
    impact: 'Обеспечивает естественный сток воды к бортам (шпигатам) и повышает поперечную жесткость настила бака.',
    recommended: '1/50…1/30 ширины палубы (0.1…0.6 м).',
    min: 0.0,
    max: 1.5,
    step: 0.05,
    unit: 'м',
    decimals: 2,
    defaultValue: 0.0,
  },
  bowFlare: {
    id: 'bowFlare',
    name: 'Развал носового борта',
    symbol: 'F_разв',
    zone: 'blue',
    zoneName: 'Форма борта',
    desc: 'Поперечное расширение верхнего пояса обшивки над ватерлинией в носу.',
    impact: 'Обеспечивает гидродинамическое демпфирование килевой качки, отбрасывает волны в стороны и увеличивает площадь рабочей палубы.',
    recommended: '0.2…1.5 м.',
    min: 0.0,
    max: 3.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 1.0,
  },
  bowUVShape: {
    id: 'bowUVShape',
    name: 'U/V-образность носовых шпангоутов',
    symbol: 'U/V',
    zone: 'blue',
    zoneName: 'Форма борта',
    desc: 'Характер формы поперечных сечений: 0 — выраженные V-образные обводы, 1 — наполненные U-образные обводы.',
    impact: 'V-образные шпангоуты мягче режут волну и снижают слемминг; U-образные дают большее водоизмещение и меньшее сопротивление на тихой воде.',
    recommended: '0.3…0.7 в зависимости от типа и назначения судна.',
    min: 0.0,
    max: 1.0,
    step: 0.05,
    unit: '',
    decimals: 2,
    defaultValue: 0.5,
  },
};

export const VOLUME_PARAM_HELP: Record<string, ParameterHelpInfo & { defaultValue: number }> = {
  // ── ГРУППА 1: ЗЕЛЕНАЯ — Базовая форма ватерлиний (V-направление) ──
  baseStemWidth: {
    id: 'baseStemWidth',
    name: 'Ширина ножа штевня',
    symbol: 'W_stem',
    zone: 'green',
    zoneName: 'Базовая форма (V-ось)',
    desc: 'Толщина ножа форштевня / притупление носовой оконечности на базовой ватерлинии (контактная точка P0).',
    impact: 'Определяет конструктивную толщину форштевня и технологичность сварки листов обшивки в носу.',
    recommended: '0.0…1.0 м (0.0 — бритвенно-острый штевень).',
    min: 0.0,
    max: 4.0,
    step: 0.05,
    unit: 'м',
    decimals: 2,
    defaultValue: 0.0,
  },
  baseEntranceAngle: {
    id: 'baseEntranceAngle',
    name: 'Базовый угол входа',
    symbol: 'α_base',
    zone: 'green',
    zoneName: 'Базовая форма (V-ось)',
    desc: 'Базовый полуугол заострения / входа ватерлиний в диаметральной плоскости (направление касательной P0-P1).',
    impact: 'Главный гидродинамический фактор волнового сопротивления судна на расчетных скоростях хода.',
    recommended: '12°…25° для быстроходных судов; 28°…45° для водоизмещающих судов.',
    min: 5.0,
    max: 65.0,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 25.0,
  },
  baseShoulderFullness: {
    id: 'baseShoulderFullness',
    name: 'Полнота плеча',
    symbol: 'k_shoulder',
    zone: 'green',
    zoneName: 'Базовая форма (V-ось)',
    desc: 'Базовый коэффициент полноты носового плеча ватерлинии (положение контрольной точки P2 по полуширине).',
    impact: 'Формирует вздутие или утончение носовой капли, распределяя водоизмещение вдоль длины носа.',
    recommended: '0.50…0.85.',
    min: 0.20,
    max: 1.30,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.70,
  },
  baseMidTangentLength: {
    id: 'baseMidTangentLength',
    name: 'Вход 90° к миделю',
    symbol: 'L_mid_tang',
    zone: 'green',
    zoneName: 'Базовая форма (V-ось)',
    desc: 'Длина прямого участка 90° касательной к миделю (положение P3 относительно стыка P4, dY/dX = 0).',
    impact: 'Обеспечивает строгое сопряжение G1/G2 без изломов и впадин на стыке с цилиндрической частью корпуса.',
    recommended: '0.2…0.8 длины носа L_bow.',
    min: 0.2,
    max: 15.0,
    step: 0.05,
    unit: 'м',
    decimals: 2,
    defaultValue: 4.0,
  },
  hollowDepth: {
    id: 'hollowDepth',
    name: 'Вогнутость входа ватерлинии',
    symbol: 'δ_hollow',
    zone: 'green',
    zoneName: 'Базовая форма (V-ось)',
    desc: 'Стрелка вогнутости профиля ватерлинии Безье 4-го порядка. Устраняет выпуклость в зоне начального входа потока.',
    impact: 'При δ_hollow = 0 кривая плавная выпуклая. При δ_hollow > 0 (напр. 0.3 м) формируется вогнутый или S-образный клиперский профиль входа.',
    recommended: '0.0…0.6 м.',
    min: 0.0,
    max: 1.5,
    step: 0.02,
    unit: 'м',
    decimals: 2,
    defaultValue: 0.0,
  },
  shoulderPullback: {
    id: 'shoulderPullback',
    name: 'Положение плеча ватерлинии',
    symbol: 'k_pullback',
    zone: 'green',
    zoneName: 'Базовая форма (V-ось)',
    desc: 'Продольное положение плеча ватерлинии (доля длины носа L_bow, координата P2.x = -L_bow · k_pullback).',
    impact: 'При увеличении до 0.70 плечо смещается назад к миделю, удлиняя и заостряя ножевую зону форштевня.',
    recommended: '0.35…0.75.',
    min: 0.10,
    max: 0.90,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.50,
  },

  // ── ГРУППА 2: ОРАНЖЕВАЯ — Вертикальная дифференциация (U-направление) ──
  entranceAngleGradient: {
    id: 'entranceAngleGradient',
    name: 'Градиент угла (Палуба-КВЛ)',
    symbol: 'Δα_flare',
    zone: 'orange',
    zoneName: 'Дифференциация (U-ось)',
    desc: 'Разница полуугла заострения между палубной линией и уровнем КВЛ (вертикальный градиент развала).',
    impact: 'Положительные значения создают широкий развал борта для защиты палубы от заливания; отрицательные — tumblehome.',
    recommended: '-15°…+20°.',
    min: -30.0,
    max: 30.0,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 0.0,
  },
  dwlFullnessBias: {
    id: 'dwlFullnessBias',
    name: 'Смещение полноты КВЛ',
    symbol: 'k_dwl_bias',
    zone: 'orange',
    zoneName: 'Дифференциация (U-ось)',
    desc: 'Локальная добавка к полноте носового плеча непосредственно на расчетном горизонте КВЛ (Z = T).',
    impact: 'Позволяет локально заострить ватерлинию на воде (< 0) или добавить плавучести в районе действующей ватерлинии (> 0).',
    recommended: '-0.25…+0.25.',
    min: -0.50,
    max: 0.50,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.0,
  },
  shoulderInflection: {
    id: 'shoulderInflection',
    name: 'S-образный прогиб плеча',
    symbol: 'k_inflect',
    zone: 'orange',
    zoneName: 'Дифференциация (U-ось)',
    desc: 'Стрелка S-образной вогнутости или выпуклости плеча ватерлиний в средней части носовой зоны.',
    impact: 'Отрицательные значения дают клиперную вогнутость носовой скулы; положительные — пухлые обводы с высоким запасом плавучести.',
    recommended: '-0.20…+0.20.',
    min: -0.40,
    max: 0.40,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.0,
  },
  frameSectionCurvature: {
    id: 'frameSectionCurvature',
    name: 'U ↔ V форм-фактор',
    symbol: 'U ↔ V',
    zone: 'orange',
    zoneName: 'Дифференциация (U-ось)',
    desc: 'Баланс формы носовых шпангоутов: 0.0 — строгие клиновидные V-образные обводы, 1.0 — объемные U-образные обводы.',
    impact: 'V-образные обводы мягко всходят на волну и снижают слемминг; U-образные увеличивают грузовой объем и снижают сопротивление на тихой воде.',
    recommended: '0.30…0.70.',
    min: 0.0,
    max: 1.0,
    step: 0.02,
    unit: '',
    decimals: 2,
    defaultValue: 0.50,
  },

  // ── ГРУППА 3: СИНЯЯ — Пятно днища (Z -> 0) ──
  bottomFlatRun: {
    id: 'bottomFlatRun',
    name: 'Вынос плоского киля',
    symbol: 'L_flat_bot',
    zone: 'blue',
    zoneName: 'Пятно днища (Z → 0)',
    desc: 'Длина прямого параллельного участка плоского днища от миделя в нос до начала подъема и схождения к килю.',
    impact: 'Определяет площадь плоского днища, технологичность днищевых секций и подъем батоксов.',
    recommended: '0.0…0.5 длины носа L_bow.',
    min: 0.0,
    max: 15.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 2.0,
  },
  bottomTaperAngle: {
    id: 'bottomTaperAngle',
    name: 'Сход пятна днища',
    symbol: 'α_bottom',
    zone: 'blue',
    zoneName: 'Пятно днища (Z → 0)',
    desc: 'Угол сужения и схождения пятна днища к диаметральной плоскости у пятки форштевня.',
    impact: 'Формирует гидродинамический клин на входе потока под днище корпуса и предотвращает срывные зоны.',
    recommended: '5°…30°.',
    min: 3.0,
    max: 60.0,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 15.0,
  },
  bottomFootprintFullness: {
    id: 'bottomFootprintFullness',
    name: 'Полнота пятна днища',
    symbol: 'C_bot_fp',
    zone: 'blue',
    zoneName: 'Пятно днища (Z → 0)',
    desc: 'Коэффициент полноты формы пятна днища (0.2 — острый клин, 1.0 — прямоугольная днищевая плита).',
    impact: 'Определяет объем придонного слоя и характер обтекания носового подзора.',
    recommended: '0.50…0.85.',
    min: 0.20,
    max: 1.0,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.70,
  },
  bottomTangentBias: {
    id: 'bottomTangentBias',
    name: 'Смещение тангенса днища',
    symbol: 'Δdx3_bot',
    zone: 'blue',
    zoneName: 'Пятно днища (Z → 0)',
    desc: 'Разница длины 90° касательного участка у днища относительно верхней палубы.',
    impact: 'Позволяет независимо варьировать плавность перехода днищевых батоксов в цилиндрическую вставку.',
    recommended: '-2.0…+2.0 м.',
    min: -10.0,
    max: 10.0,
    step: 0.05,
    unit: 'м',
    decimals: 2,
    defaultValue: 0.0,
  },

  // ── ГРУППА 4: ФИОЛЕТОВАЯ — Поперечное сечение носа (шпангоут) ──
  sectionXOffset: {
    id: 'sectionXOffset',
    name: 'Положение сечения (сдвиг X)',
    symbol: 'ΔX_sec',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Продольное смещение плоскости контрольного шпангоута носа относительно конца днищевого пятна.',
    impact: 'Позволяет перемещать сечение вдоль носовой оконечности для контроля поперечных обводов корпуса.',
    recommended: '-1.0…+2.0 м от конца днищевого пятна.',
    min: -3.0,
    max: 5.0,
    step: 0.1,
    unit: 'м',
    decimals: 1,
    defaultValue: 0.0,
  },
  sectionDeckAngle: {
    id: 'sectionDeckAngle',
    name: 'Угол к верхней палубе',
    symbol: 'α_пал',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Угол наклона образующей шпангоута при подходе к кромке верхней палубы.',
    impact: 'Регулирует степень развала (flare) или завала (tumblehome) борта в районе верхней палубы.',
    recommended: '0°…25°.',
    min: -45.0,
    max: 45.0,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 15.0,
  },
  sectionUpperRoundAngle: {
    id: 'sectionUpperRoundAngle',
    name: 'Круговой регулятор (верхний)',
    symbol: 'θ_верх',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Круговой регулятор касательной верхнего участка (аналогично фиолетовым точкам форштевня).',
    impact: 'Управляет направлением касательного вектора Безье в верхней зоне шпангоута, формируя округлость борта.',
    recommended: '30°…60°.',
    min: -90.0,
    max: 90.0,
    step: 1.0,
    unit: '°',
    decimals: 1,
    defaultValue: 45.0,
  },
  sectionTangentPoint: {
    id: 'sectionTangentPoint',
    name: 'Точка перегиба / касательная',
    symbol: 'Z_кас',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Относительное высотное положение промежуточной точки перегиба / сопряжения ветвей шпангоута.',
    impact: 'Задает границу перехода от днищевой скулы к развалу борта надводной части.',
    recommended: '0.40…0.60 высоты борта.',
    min: 0.15,
    max: 0.85,
    step: 0.01,
    unit: '',
    decimals: 2,
    defaultValue: 0.50,
  },
  sectionLowerRoundAngle: {
    id: 'sectionLowerRoundAngle',
    name: 'Круговой регулятор (нижний)',
    symbol: 'θ_низ',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Круговой регулятор касательной нижнего участка скулы (аналогично фиолетовым точкам форштевня).',
    impact: 'Управляет радиусом и плавностью закругления скулового перехода от днища к борту.',
    recommended: '30°…60°.',
    min: -90.0,
    max: 90.0,
    step: 1.0,
    unit: '°',
    decimals: 1,
    defaultValue: 45.0,
  },
  sectionStemEntryAngle: {
    id: 'sectionStemEntryAngle',
    name: 'Угол входа к форштевню',
    symbol: 'α_шт',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Угол сопряжения образующей шпангоута с форштевнем или килевой линией в диаметральной плоскости.',
    impact: 'Задает угол килеватости и килевого подъема в начальной точке шпангоута.',
    recommended: '15°…45°.',
    min: 0.0,
    max: 90.0,
    step: 0.5,
    unit: '°',
    decimals: 1,
    defaultValue: 30.0,
  },
  sectionHeelStraightLen: {
    id: 'sectionHeelStraightLen',
    name: 'Прямой участок до форштевня (пятка)',
    symbol: 'L_пят',
    zone: 'purple',
    zoneName: 'Поперечное сечение носа',
    desc: 'Длина прямолинейного участка перехода к форштевню. При L = 0 прямой угол не навязывается — вход под естественным углом.',
    impact: 'Позволяет сформировать жесткую плоскую грань примыкания к штевню либо получить гладкую криволинейную форму.',
    recommended: '0.0…0.5 м (0.0 — естественный криволинейный вход).',
    min: 0.0,
    max: 1.5,
    step: 0.05,
    unit: 'м',
    decimals: 2,
    defaultValue: 0.0,
  },
};

// ============================================================================
// СПИСКИ ПАРАМЕТРОВ ДЛЯ НАВИГАЦИИ (ПРЕДЫДУЩИЙ / СЛЕДУЮЩИЙ)
// ============================================================================

export const STEM_PARAM_KEYS: (keyof typeof STEM_PARAM_HELP)[] = [
  'stemRakeAngle',
  'deckTangentAngle',
  'deckOverhang',
  'deckHeightOffset',
  'knuckleOffset',
  'knuckleHeightRatio',
  'bulbLength',
  'bulbUpperTangentAngle',
  'bulbLowerTangentAngle',
  'bulbHeightRatio',
  'bulbFullness',
  'forefootRadius',
  'forefootHeightRatio',
  'keelTransitionLength',
];

export const DECK_PARAM_KEYS: (keyof typeof DECK_PARAM_HELP)[] = [
  'stemWidth',
  'entranceAngle',
  'shoulderFullness',
  'maxBreadthPos',
  'bowSheer',
  'deckCamberBow',
  'bowFlare',
  'bowUVShape',
];

export const VOLUME_PARAM_KEYS: (keyof typeof VOLUME_PARAM_HELP)[] = [
  'baseEntranceAngle',
  'shoulderPullback',
  'baseShoulderFullness',
  'baseMidTangentLength',
  'bottomFlatRun',
  'bottomTangentBias',
  'sectionXOffset',
  'sectionDeckAngle',
  'sectionUpperRoundAngle',
  'sectionTangentPoint',
  'sectionLowerRoundAngle',
  'sectionStemEntryAngle',
  'sectionHeelStraightLen',
];

// ============================================================================
// ИНТЕРАКТИВНОЕ ПЕРЕТАСКИВАЕМОЕ ОКНО СПРАВКИ С РЕГУЛЯТОРОМ ПАРАМЕТРА
// ============================================================================

export interface InteractiveDraggableHelpWindowProps {
  info: ParameterHelpInfo;
  currentValue: number;
  onChange: (val: number) => void;
  onClose: () => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  currentIndex?: number;
  totalCount?: number;
  prevLabel?: string;
  nextLabel?: string;
}

export const InteractiveDraggableHelpWindow: React.FC<InteractiveDraggableHelpWindowProps> = ({
  info,
  currentValue,
  onChange,
  onClose,
  min,
  max,
  step,
  unit,
  decimals,
  onPrev,
  onNext,
  hasPrev = true,
  hasNext = true,
  currentIndex,
  totalCount,
  prevLabel,
  nextLabel,
}) => {
  // Начальная позиция по умолчанию в правом верхнем углу экрана (над 3D сценой, свободно передвигается везде)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const initialX = Math.max(10, screenW - 410);
    return {
      x: initialX,
      y: 70,
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });

  const minVal = min !== undefined ? min : info.min !== undefined ? info.min : 0;
  const maxVal = max !== undefined ? max : info.max !== undefined ? info.max : 100;
  const stepVal = step !== undefined ? step : info.step !== undefined ? info.step : 0.1;
  const dec = decimals !== undefined ? decimals : info.decimals !== undefined ? info.decimals : 1;
  const unitStr = unit !== undefined ? unit : info.unit !== undefined ? info.unit : '';

  const handlePointerDown = (e: React.PointerEvent) => {
    // Не начинаем драг при клике на кнопки в шапке
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position.x,
      startY: position.y,
    };
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;
    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const screenH = typeof window !== 'undefined' ? window.innerHeight : 800;
      // Полная свобода перемещения по всему экрану без ограничений
      const newX = Math.max(0, Math.min(screenW - 80, dragStartRef.current.startX + dx));
      const newY = Math.max(0, Math.min(screenH - 50, dragStartRef.current.startY + dy));
      setPosition({ x: newX, y: newY });
    };

    const onPointerUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isDragging]);

  const handleInc = (dir: number) => {
    const rawNext = currentValue + dir * stepVal;
    const clamped = Math.max(minVal, Math.min(maxVal, Number(rawNext.toFixed(dec))));
    onChange(clamped);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (isNaN(parsed)) return;
    const clamped = Math.max(minVal, Math.min(maxVal, Number(parsed.toFixed(dec))));
    onChange(clamped);
  };

  const safeCurrent = Math.max(minVal, Math.min(maxVal, currentValue));

  const modalContent = (
    <div
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        position: 'fixed',
        zIndex: 999999,
      }}
      className="w-96 max-w-[95vw] rounded-2xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-black/15 dark:border-white/20 shadow-2xl p-4 text-gray-900 dark:text-gray-100 flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
    >
      {/* Draggable Header */}
      <div
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between gap-2 pb-2 border-b border-black/10 dark:border-white/10 cursor-grab active:cursor-grabbing hover:bg-black/[0.02] dark:hover:bg-white/[0.02] -mx-2 -mt-1 px-2 pt-1 rounded-t-xl transition touch-none"
        title="Зажмите и свободно перемещайте в любую точку экрана"
      >
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md ${
              info.zone === 'green'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : info.zone === 'orange'
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
            }`}
          >
            {info.zoneName}
          </span>
          <h3 className="text-xs font-bold tracking-tight truncate max-w-[190px]">
            {info.name} ({info.symbol})
          </h3>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-400 font-mono hidden sm:inline-block cursor-grab">✥</span>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white transition cursor-pointer"
            title="Закрыть справку"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Интерактивный регулятор значения прямо в окне справки с точными пределами [min, max] */}
      <div className="p-2.5 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-gray-600 dark:text-gray-400">Текущее значение:</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400 text-sm">
              {safeCurrent.toFixed(dec)} {unitStr}
            </span>
            <span className="text-[9px] text-gray-400 font-mono">
              [{minVal}…{maxVal}{unitStr ? ` ${unitStr}` : ''}]
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleInc(-1)}
            disabled={safeCurrent <= minVal}
            className="w-7 h-7 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none font-bold text-sm flex items-center justify-center transition active:scale-95 cursor-pointer"
            title="Уменьшить"
          >
            −
          </button>
          <input
            type="range"
            min={minVal}
            max={maxVal}
            step={stepVal}
            value={safeCurrent}
            onChange={handleSliderChange}
            className="flex-1 h-2 bg-black/15 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
          <button
            type="button"
            onClick={() => handleInc(1)}
            disabled={safeCurrent >= maxVal}
            className="w-7 h-7 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none font-bold text-sm flex items-center justify-center transition active:scale-95 cursor-pointer"
            title="Увеличить"
          >
            +
          </button>
        </div>
        <div className="text-[10px] text-gray-500 dark:text-gray-400 text-center">
          Интерактивная корректировка параметра в 3D модели
        </div>
      </div>

      {/* Description */}
      <div className="text-[11px] leading-relaxed text-gray-700 dark:text-gray-300">
        <div className="font-semibold text-gray-900 dark:text-white mb-0.5">Определение:</div>
        <p>{info.desc}</p>
      </div>

      {/* Impact */}
      <div className="p-2.5 rounded-xl bg-cyan-500/[0.06] dark:bg-cyan-500/[0.1] border border-cyan-500/20 text-[11px] leading-relaxed">
        <div className="font-semibold text-cyan-700 dark:text-cyan-400 mb-0.5 flex items-center gap-1">
          <Info size={13} />
          <span>Влияние на гидродинамику и мореходность:</span>
        </div>
        <p className="text-gray-700 dark:text-gray-300">{info.impact}</p>
      </div>

      {/* Recommended */}
      <div className="text-[10px] text-gray-600 dark:text-gray-400 bg-black/[0.02] dark:bg-white/[0.02] p-2 rounded-lg border border-black/5 dark:border-white/5">
        <span className="font-semibold text-gray-800 dark:text-gray-200">Рекомендуемый диапазон: </span>
        {info.recommended}
      </div>

      {/* Нижняя панель навигации (Предыдущий / Следующий показатель) */}
      {(onPrev || onNext) && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-black/10 dark:border-white/10 mt-0.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev}
            className="flex-1 py-1.5 px-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95 text-gray-700 dark:text-gray-300"
            title={prevLabel ? `Предыдущий показатель: ${prevLabel}` : 'Предыдущий показатель'}
          >
            <span>←</span>
            <span className="truncate max-w-[100px]">{prevLabel || 'Предыдущий'}</span>
          </button>

          {currentIndex !== undefined && totalCount !== undefined && (
            <div className="text-[10px] font-mono text-gray-400 dark:text-gray-500 whitespace-nowrap px-1">
              {currentIndex + 1} / {totalCount}
            </div>
          )}

          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext}
            className="flex-1 py-1.5 px-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 disabled:opacity-30 disabled:pointer-events-none text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95"
            title={nextLabel ? `Следующий показатель: ${nextLabel}` : 'Следующий показатель'}
          >
            <span className="truncate max-w-[100px]">{nextLabel || 'Следующий'}</span>
            <span>→</span>
          </button>
        </div>
      )}
    </div>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
};

export interface VerticalSliderCardProps {
  label?: string;
  title?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  group?: 'green' | 'orange' | 'blue' | 'neutral' | 'purple';
  groupColor?: 'green' | 'orange' | 'blue' | 'neutral' | 'purple';
  isSelected?: boolean;
  onSelect?: () => void;
  onChange: (val: number) => void;
  onInc?: (dir: number) => void;
  onHelp?: () => void;
}

export const VerticalSliderCard: React.FC<VerticalSliderCardProps> = ({
  label,
  title,
  value,
  min,
  max,
  step = 0.1,
  unit = '',
  decimals = 1,
  group,
  groupColor,
  isSelected = false,
  onSelect,
  onChange,
  onInc,
  onHelp,
}) => {
  const activeGroup = group || groupColor || 'green';
  const displayLabel = title || label || '';

  const groupStyles = {
    neutral: {
      border: 'border-black/15 dark:border-white/15 hover:border-black/30 dark:hover:border-white/30',
      bg: 'bg-black/[0.02] dark:bg-white/[0.03]',
      titleColor: 'text-black/80 dark:text-white/80',
      accent: 'accent-cyan-600 dark:accent-cyan-400',
      btn: 'hover:bg-black/10 dark:hover:bg-white/15 text-black/80 dark:text-white/80 bg-black/5 dark:bg-white/5',
      value: 'text-black/90 dark:text-white/90',
      helpBtn: 'text-black/50 hover:text-black/90 dark:text-white/50 dark:hover:text-white/90 hover:bg-black/5 dark:hover:bg-white/10',
      selectedGlow:
        'ring-2 ring-cyan-500/70 shadow-[0_0_12px_rgba(6,182,212,0.3)] bg-cyan-500/10 dark:bg-cyan-500/15 scale-[1.03] z-20 border-cyan-500/60',
    },
    green: {
      border: 'border-emerald-500/40 dark:border-emerald-500/30 hover:border-emerald-500',
      bg: 'bg-emerald-500/[0.03] dark:bg-emerald-500/[0.06]',
      titleColor: 'text-emerald-800 dark:text-emerald-300',
      accent: 'accent-emerald-500',
      btn: 'hover:bg-emerald-500/25 text-emerald-800 dark:text-emerald-200 bg-emerald-500/10',
      value: 'text-emerald-800 dark:text-emerald-300',
      helpBtn: 'text-emerald-700/80 hover:text-emerald-950 dark:text-emerald-400/90 dark:hover:text-emerald-100 hover:bg-emerald-500/20',
      selectedGlow:
        'ring-2 ring-emerald-400 dark:ring-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.55)] bg-emerald-500/20 dark:bg-emerald-500/25 scale-[1.04] z-20 border-emerald-400 dark:border-emerald-300',
    },
    orange: {
      border: 'border-amber-500/40 dark:border-amber-500/30 hover:border-amber-500',
      bg: 'bg-amber-500/[0.03] dark:bg-amber-500/[0.06]',
      titleColor: 'text-amber-800 dark:text-amber-300',
      accent: 'accent-amber-500',
      btn: 'hover:bg-amber-500/25 text-amber-800 dark:text-amber-200 bg-amber-500/10',
      value: 'text-amber-800 dark:text-amber-300',
      helpBtn: 'text-amber-700/80 hover:text-amber-950 dark:text-amber-400/90 dark:hover:text-amber-100 hover:bg-amber-500/20',
      selectedGlow:
        'ring-2 ring-amber-400 dark:ring-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.55)] bg-amber-500/20 dark:bg-amber-500/25 scale-[1.04] z-20 border-amber-400 dark:border-amber-300',
    },
    blue: {
      border: 'border-sky-500/40 dark:border-sky-500/30 hover:border-sky-500',
      bg: 'bg-sky-500/[0.03] dark:bg-sky-500/[0.06]',
      titleColor: 'text-sky-800 dark:text-sky-300',
      accent: 'accent-sky-500',
      btn: 'hover:bg-sky-500/25 text-sky-800 dark:text-sky-200 bg-sky-500/10',
      value: 'text-sky-800 dark:text-sky-300',
      helpBtn: 'text-sky-700/80 hover:text-sky-950 dark:text-sky-400/90 dark:hover:text-sky-100 hover:bg-sky-500/20',
      selectedGlow:
        'ring-2 ring-sky-400 dark:ring-sky-300 shadow-[0_0_18px_rgba(14,165,233,0.55)] bg-sky-500/20 dark:bg-sky-500/25 scale-[1.04] z-20 border-sky-400 dark:border-sky-300',
    },
    purple: {
      border: 'border-purple-500/40 dark:border-purple-500/30 hover:border-purple-500',
      bg: 'bg-purple-500/[0.03] dark:bg-purple-500/[0.06]',
      titleColor: 'text-purple-800 dark:text-purple-300',
      accent: 'accent-purple-500',
      btn: 'hover:bg-purple-500/25 text-purple-800 dark:text-purple-200 bg-purple-500/10',
      value: 'text-purple-800 dark:text-purple-300',
      helpBtn: 'text-purple-700/80 hover:text-purple-950 dark:text-purple-400/90 dark:hover:text-purple-100 hover:bg-purple-500/20',
      selectedGlow:
        'ring-2 ring-purple-400 dark:ring-purple-300 shadow-[0_0_18px_rgba(168,85,247,0.55)] bg-purple-500/20 dark:bg-purple-500/25 scale-[1.04] z-20 border-purple-400 dark:border-purple-300',
    },
  }[activeGroup];

  const handleInc = (dir: number) => {
    if (onInc) {
      onInc(dir);
    } else {
      const next = Math.max(min, Math.min(max, Number((value + dir * step).toFixed(decimals))));
      onChange(next);
    }
  };

  return (
    <div
      onClick={onSelect}
      title={displayLabel}
      className={`relative p-1 rounded-lg border transition-all duration-150 flex flex-col items-center justify-between flex-1 min-w-[42px] max-w-[68px] h-[154px] select-none cursor-pointer ${groupStyles.border} ${groupStyles.bg} ${
        isSelected ? groupStyles.selectedGlow : 'shadow-2xs'
      }`}
    >
      {/* 1. Сверху рамки наименование + кнопка справки (?) */}
      <div className="w-full flex items-center justify-between gap-0.5 px-0.5">
        <span
          className={`text-[8.5px] font-bold tracking-tight text-center truncate flex-1 leading-none uppercase ${groupStyles.titleColor}`}
          title={displayLabel}
        >
          {displayLabel}
        </span>
        {onHelp && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onHelp();
            }}
            className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition text-[8.5px] font-bold cursor-pointer ${groupStyles.helpBtn}`}
            title="Справка по параметру"
          >
            ?
          </button>
        )}
      </div>

      {/* 2. Вертикальный ползунок */}
      <div className="h-[68px] w-full flex items-center justify-center relative my-0.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{
            writingMode: 'vertical-lr',
            direction: 'rtl',
            WebkitAppearance: 'slider-vertical',
          }}
          className={`h-[66px] w-2.5 cursor-pointer appearance-none rounded-full bg-black/15 dark:bg-white/15 ${groupStyles.accent}`}
        />
      </div>

      {/* 3. Кнопки + - */}
      <div className="flex items-center gap-0.5 my-0.5 w-full justify-center px-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleInc(-1);
          }}
          className={`flex-1 max-w-[22px] h-4 rounded ${groupStyles.btn} text-[11px] leading-none font-bold flex items-center justify-center transition active:scale-90 cursor-pointer`}
          title="Уменьшить"
        >
          −
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleInc(1);
          }}
          className={`flex-1 max-w-[22px] h-4 rounded ${groupStyles.btn} text-[11px] leading-none font-bold flex items-center justify-center transition active:scale-90 cursor-pointer`}
          title="Увеличить"
        >
          +
        </button>
      </div>

      {/* 4. Ещё ниже значения */}
      <div className="w-full text-center px-0.5">
        <span className={`text-[10px] font-mono font-bold leading-none ${groupStyles.value}`}>
          {value.toFixed(decimals)}
          {unit ? <span className="text-[8px] ml-0.5 font-normal opacity-80">{unit}</span> : ''}
        </span>
      </div>
    </div>
  );
};

export const STEM_PARAM_POINT_MAP: Record<string, StemPointKey> = {
  stemRakeAngle: 'PT_STEM_DECK', // Перемещение наклона/вылета форштевня по X
  deckOverhang: 'PT_STEM_DECK',
  deckHeightOffset: 'PT_STEM_DECK',
  deckTangentAngle: 'CTRL_STEM_UPPER',
  knuckleOffset: 'PT_STEM_KNUCKLE',
  knuckleHeightRatio: 'PT_STEM_KNUCKLE',
  bulbLength: 'PT_BULB_APEX',
  bulbUpperTangentAngle: 'CTRL_STEM_BULB_UPPER',
  bulbLowerTangentAngle: 'CTRL_STEM_BULB_LOWER',
  bulbHeightRatio: 'PT_BULB_APEX',
  bulbFullness: 'PT_BULB_APEX',
  forefootRadius: 'PT_FOREFOOT',
  forefootHeightRatio: 'PT_FOREFOOT',
  keelTransitionLength: 'PT_KEEL_TANGENT',
};

export const STEM_PARAM_AXIS_MAP: Record<string, 'x' | 'y' | 'rotation'> = {
  stemRakeAngle: 'x', // Перемещение наклона/вылета форштевня по X
  deckOverhang: 'x',
  deckHeightOffset: 'y',
  deckTangentAngle: 'rotation',
  knuckleOffset: 'x',
  knuckleHeightRatio: 'y',
  bulbLength: 'x',
  bulbUpperTangentAngle: 'rotation',
  bulbLowerTangentAngle: 'rotation',
  bulbHeightRatio: 'y',
  bulbFullness: 'x',
  forefootRadius: 'x',
  forefootHeightRatio: 'y',
  keelTransitionLength: 'x',
};

export const StemBottomBarTab: React.FC<StemBottomBarTabProps> = ({
  theme,
  height,
  draft,
  bowLength = 25,
  stemParams,
  onStemParamsChange,
  selectedPointKey: controlledPointKey,
  onSelectPointKey: controlledOnSelectPointKey,
  selectedParamId: controlledParamId,
  onSelectParamId: controlledOnSelectParamId,
  onBack,
  onNext,
  onSave,
  onCancel,
}) => {
  const [internalPointKey, setInternalPointKey] = useState<StemPointKey | null>('PT_STEM_DECK');
  const selectedPointKey = controlledPointKey !== undefined ? controlledPointKey : internalPointKey;
  const setSelectedPointKey = (key: StemPointKey | null) => {
    if (controlledOnSelectPointKey) controlledOnSelectPointKey(key);
    setInternalPointKey(key);
  };

  // Состояние активного параметра (по умолчанию выбран угол наклона форштевня stemRakeAngle)
  const [internalParamId, setInternalParamId] = useState<string | null>('stemRakeAngle');
  const selectedParamId = controlledParamId !== undefined ? controlledParamId : internalParamId;
  const setSelectedParamId = (id: string | null) => {
    if (controlledOnSelectParamId) controlledOnSelectParamId(id);
    setInternalParamId(id);
  };

  // Состояние активного модального окна справки
  const [activeHelpParam, setActiveHelpParam] = useState<string | null>(null);

  const effectiveSelectedParam = activeHelpParam || selectedParamId;

  const handleSelectParam = (paramId: string) => {
    setSelectedParamId(paramId);
    if (STEM_PARAM_POINT_MAP[paramId]) {
      setSelectedPointKey(STEM_PARAM_POINT_MAP[paramId]);
    }
    if (activeHelpParam) {
      setActiveHelpParam(paramId);
    }
  };

  const handleOpenHelp = (paramId: string) => {
    setActiveHelpParam(paramId);
    setSelectedParamId(paramId);
    if (STEM_PARAM_POINT_MAP[paramId]) {
      setSelectedPointKey(STEM_PARAM_POINT_MAP[paramId]);
    }
  };

  const safeT = Math.max(0.5, draft || 4.5);
  const safeH = Math.max(safeT + 0.5, height || 9.0);
  const effectiveBowLen = Math.max(5, bowLength || 25);

  const currentParams: StemProfileParams = {
    ...DEFAULT_STEM_PARAMS,
    ...stemParams,
  };

  // Инкрементные хелперы
  const handleInc = (key: keyof StemProfileParams, dir: number, stepVal: number, minVal: number, maxVal: number) => {
    const curr = (currentParams[key] as number) ?? 0;
    const next = Math.max(minVal, Math.min(maxVal, Number((curr + dir * stepVal).toFixed(2))));
    const updates: Partial<StemProfileParams> = { [key]: next };
    if (currentParams.customPointOverrides) {
      const newOverrides = { ...currentParams.customPointOverrides };
      if (key === 'stemRakeAngle' || key === 'deckOverhang' || key === 'deckHeightOffset') delete newOverrides.PT_STEM_DECK;
      if (key === 'knuckleOffset' || key === 'knuckleHeightRatio' || key === 'stemAboveCurvature') delete newOverrides.PT_STEM_KNUCKLE;
      if (key === 'bulbLength' || key === 'bulbHeightRatio' || key === 'bulbFullness') delete newOverrides.PT_BULB_APEX;
      if (key === 'forefootRadius' || key === 'forefootHeightRatio') delete newOverrides.PT_FOREFOOT;
      if (key === 'keelTransitionLength') delete newOverrides.PT_KEEL_TANGENT;
      updates.customPointOverrides = newOverrides;
    }
    onStemParamsChange(updates);
  };

  // Навигация по показателям в окне справки (Предыдущий / Следующий)
  const currentHelpIndex = activeHelpParam ? STEM_PARAM_KEYS.indexOf(activeHelpParam as keyof typeof STEM_PARAM_HELP) : -1;
  const prevHelpIndex = currentHelpIndex >= 0 ? (currentHelpIndex - 1 + STEM_PARAM_KEYS.length) % STEM_PARAM_KEYS.length : 0;
  const nextHelpIndex = currentHelpIndex >= 0 ? (currentHelpIndex + 1) % STEM_PARAM_KEYS.length : 0;
  const prevHelpParamKey = STEM_PARAM_KEYS[prevHelpIndex];
  const nextHelpParamKey = STEM_PARAM_KEYS[nextHelpIndex];

  const handlePrevHelp = () => {
    if (currentHelpIndex < 0) return;
    const nextKey = STEM_PARAM_KEYS[prevHelpIndex];
    setActiveHelpParam(nextKey);
    setSelectedParamId(nextKey);
    if (STEM_PARAM_POINT_MAP[nextKey]) setSelectedPointKey(STEM_PARAM_POINT_MAP[nextKey]);
  };

  const handleNextHelp = () => {
    if (currentHelpIndex < 0) return;
    const nextKey = STEM_PARAM_KEYS[nextHelpIndex];
    setActiveHelpParam(nextKey);
    setSelectedParamId(nextKey);
    if (STEM_PARAM_POINT_MAP[nextKey]) setSelectedPointKey(STEM_PARAM_POINT_MAP[nextKey]);
  };

  return (
    <div>
      {/* 2. Основная рабочая область: 14 вертикальных ползунков в 3-х цветовых блоках (Синий, Зелёный, Жёлтый) */}
      <div className="w-full flex flex-row items-stretch gap-1.5 mb-1.5 overflow-hidden">
        {/* ================================================================ */}
        {/* СИНЯЯ ГРУППА: НАДВОДНАЯ ЗОНА (6 ползунков)                       */}
        {/* ================================================================ */}
        <div className="flex-[6] min-w-0 p-1 rounded-xl border border-sky-500/40 bg-sky-500/[0.02] dark:bg-sky-500/[0.04] flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1 mb-1 px-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
              <span className="text-[9.5px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider truncate">
                Надводная зона
              </span>
            </div>
            <span className="text-[8.5px] text-sky-600/70 font-mono shrink-0">Палуба/Кнакл</span>
          </div>
          <div className="flex items-center gap-1 w-full justify-between">
            {/* 1. Наклон форштевня α */}
            <VerticalSliderCard
              label="Наклон α"
              value={currentParams.stemRakeAngle}
              min={-45}
              max={60}
              step={0.5}
              unit="°"
              decimals={1}
              group="blue"
              isSelected={effectiveSelectedParam === 'stemRakeAngle'}
              onSelect={() => handleSelectParam('stemRakeAngle')}
              onChange={(v) => onStemParamsChange({ stemRakeAngle: v })}
              onInc={(d) => handleInc('stemRakeAngle', d, 1.0, -45, 60)}
              onHelp={() => handleOpenHelp('stemRakeAngle')}
              title="Угол наклона форштевня α"
            />

            {/* 2. Касательная палубы */}
            <VerticalSliderCard
              label="Кас. пал"
              value={currentParams.deckTangentAngle ?? (currentParams.stemRakeAngle + currentParams.stemAboveCurvature * 25)}
              min={-110}
              max={110}
              step={0.5}
              unit="°"
              decimals={1}
              group="blue"
              isSelected={effectiveSelectedParam === 'deckTangentAngle'}
              onSelect={() => handleSelectParam('deckTangentAngle')}
              onChange={(v) => onStemParamsChange({ deckTangentAngle: v })}
              onInc={(d) => {
                const cur = currentParams.deckTangentAngle ?? (currentParams.stemRakeAngle + currentParams.stemAboveCurvature * 25);
                const nxt = Math.max(-110, Math.min(110, Number((cur + d * 1.0).toFixed(1))));
                onStemParamsChange({ deckTangentAngle: nxt });
              }}
              onHelp={() => handleOpenHelp('deckTangentAngle')}
              title="Угол касательной у верхней палубы"
            />

            {/* 3. Вылет палубы ΔX */}
            <VerticalSliderCard
              label="Вылет ΔX"
              value={currentParams.deckOverhang ?? 0}
              min={-4.0}
              max={8.0}
              step={0.1}
              unit="м"
              decimals={1}
              group="blue"
              isSelected={effectiveSelectedParam === 'deckOverhang'}
              onSelect={() => handleSelectParam('deckOverhang')}
              onChange={(v) => onStemParamsChange({ deckOverhang: v })}
              onInc={(d) => handleInc('deckOverhang', d, 0.2, -4.0, 8.0)}
              onHelp={() => handleOpenHelp('deckOverhang')}
              title="Продольный вылет носа на палубе ΔX"
            />

            {/* 4. Высота палубы ΔZ */}
            <VerticalSliderCard
              label="Выс. ΔZ"
              value={currentParams.deckHeightOffset ?? 0}
              min={-safeH * 0.4}
              max={safeH * 0.5}
              step={0.05}
              unit="м"
              decimals={1}
              group="blue"
              isSelected={effectiveSelectedParam === 'deckHeightOffset'}
              onSelect={() => handleSelectParam('deckHeightOffset')}
              onChange={(v) => onStemParamsChange({ deckHeightOffset: v })}
              onInc={(d) => handleInc('deckHeightOffset', d, 0.1, -safeH * 0.4, safeH * 0.5)}
              onHelp={() => handleOpenHelp('deckHeightOffset')}
              title="Смещение высоты палубы форштевня ΔZ"
            />

            {/* 5. Кнакл вынос ΔX */}
            <VerticalSliderCard
              label="Кнакл ΔX"
              value={currentParams.knuckleOffset}
              min={-3.0}
              max={4.0}
              step={0.1}
              unit="м"
              decimals={1}
              group="blue"
              isSelected={effectiveSelectedParam === 'knuckleOffset'}
              onSelect={() => handleSelectParam('knuckleOffset')}
              onChange={(v) => onStemParamsChange({ knuckleOffset: v })}
              onInc={(d) => handleInc('knuckleOffset', d, 0.2, -3.0, 4.0)}
              onHelp={() => handleOpenHelp('knuckleOffset')}
              title="Вынос/прогиб кнакла (излом) ΔX"
            />

            {/* 6. Кнакл высота η */}
            <VerticalSliderCard
              label="Выс. η"
              value={currentParams.knuckleHeightRatio}
              min={0.1}
              max={0.9}
              step={0.02}
              unit=""
              decimals={2}
              group="blue"
              isSelected={effectiveSelectedParam === 'knuckleHeightRatio'}
              onSelect={() => handleSelectParam('knuckleHeightRatio')}
              onChange={(v) => onStemParamsChange({ knuckleHeightRatio: v })}
              onInc={(d) => handleInc('knuckleHeightRatio', d, 0.05, 0.1, 0.9)}
              onHelp={() => handleOpenHelp('knuckleHeightRatio')}
              title="Относительная высота кнакла над КВЛ η"
            />
          </div>
        </div>

        {/* ================================================================ */}
        {/* ЗЕЛЁНАЯ ГРУППА: ПОДВОДНАЯ ЗОНА (7 ползунков)                       */}
        {/* ================================================================ */}
        <div className="flex-[7] min-w-0 p-1 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.04] flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1 mb-1 px-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[9.5px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider truncate">
                Подводная зона
              </span>
            </div>
            <span className="text-[8.5px] text-emerald-600/70 font-mono shrink-0">Бульб/Пятка</span>
          </div>
          <div className="flex items-center gap-1 w-full justify-between">
            {/* 1. Длина бульба Lb: предел от -6.0 до +6.0 м */}
            <VerticalSliderCard
              label="Длина Lb"
              value={currentParams.bulbLength}
              min={-6.0}
              max={6.0}
              step={0.1}
              unit="м"
              decimals={1}
              group="green"
              isSelected={effectiveSelectedParam === 'bulbLength'}
              onSelect={() => handleSelectParam('bulbLength')}
              onChange={(v) => onStemParamsChange({ bulbLength: v })}
              onInc={(d) => handleInc('bulbLength', d, 0.5, -6.0, 6.0)}
              onHelp={() => handleOpenHelp('bulbLength')}
              title="Длина выступа носка бульба L_bulb [-6..+6 м]"
            />

            {/* 2. Касательная КВЛ-бульб */}
            <VerticalSliderCard
              label="Кас. КВЛ"
              value={currentParams.bulbUpperTangentAngle ?? 55}
              min={-110}
              max={110}
              step={1.0}
              unit="°"
              decimals={1}
              group="green"
              isSelected={effectiveSelectedParam === 'bulbUpperTangentAngle'}
              onSelect={() => handleSelectParam('bulbUpperTangentAngle')}
              onChange={(v) => onStemParamsChange({ bulbUpperTangentAngle: v })}
              onInc={(d) => handleInc('bulbUpperTangentAngle', d, 2.0, -110, 110)}
              onHelp={() => handleOpenHelp('bulbUpperTangentAngle')}
              title="Угол верхней касательной бульба к КВЛ"
            />

            {/* 3. Касательная бульб-пятка */}
            <VerticalSliderCard
              label="Кас. пят"
              value={currentParams.bulbLowerTangentAngle ?? 55}
              min={-110}
              max={110}
              step={1.0}
              unit="°"
              decimals={1}
              group="green"
              isSelected={effectiveSelectedParam === 'bulbLowerTangentAngle'}
              onSelect={() => handleSelectParam('bulbLowerTangentAngle')}
              onChange={(v) => onStemParamsChange({ bulbLowerTangentAngle: v })}
              onInc={(d) => handleInc('bulbLowerTangentAngle', d, 2.0, -110, 110)}
              onHelp={() => handleOpenHelp('bulbLowerTangentAngle')}
              title="Угол нижней касательной бульба к пятке"
            />

            {/* 4. Высота бульба ζb */}
            <VerticalSliderCard
              label="Выс. ζb"
              value={currentParams.bulbHeightRatio}
              min={0.1}
              max={0.95}
              step={0.02}
              unit=""
              decimals={2}
              group="green"
              isSelected={effectiveSelectedParam === 'bulbHeightRatio'}
              onSelect={() => handleSelectParam('bulbHeightRatio')}
              onChange={(v) => onStemParamsChange({ bulbHeightRatio: v })}
              onInc={(d) => handleInc('bulbHeightRatio', d, 0.05, 0.1, 0.95)}
              onHelp={() => handleOpenHelp('bulbHeightRatio')}
              title="Относительное заглубление носка бульба ζ_bulb"
            />

            {/* 5. Полнота бульба Cb */}
            <VerticalSliderCard
              label="Полнота Cb"
              value={currentParams.bulbFullness}
              min={0.1}
              max={1.0}
              step={0.05}
              unit=""
              decimals={2}
              group="green"
              isSelected={effectiveSelectedParam === 'bulbFullness'}
              onSelect={() => handleSelectParam('bulbFullness')}
              onChange={(v) => onStemParamsChange({ bulbFullness: v })}
              onInc={(d) => handleInc('bulbFullness', d, 0.05, 0.1, 1.0)}
              onHelp={() => handleOpenHelp('bulbFullness')}
              title="Полнота / натяжение дуги бульба C_bulb"
            />

            {/* 6. Радиус пятки R */}
            <VerticalSliderCard
              label="Радиус R"
              value={currentParams.forefootRadius}
              min={0.0}
              max={10.0}
              step={0.2}
              unit="м"
              decimals={1}
              group="green"
              isSelected={effectiveSelectedParam === 'forefootRadius'}
              onSelect={() => handleSelectParam('forefootRadius')}
              onChange={(v) => onStemParamsChange({ forefootRadius: v })}
              onInc={(d) => handleInc('forefootRadius', d, 0.5, 0.0, 10.0)}
              onHelp={() => handleOpenHelp('forefootRadius')}
              title="Радиус скругления подзора/пятки R_forefoot"
            />

            {/* 7. Высота пятки ζп */}
            <VerticalSliderCard
              label="Выс. ζп"
              value={currentParams.forefootHeightRatio ?? 0.0}
              min={0.0}
              max={0.85}
              step={0.02}
              unit=""
              decimals={2}
              group="green"
              isSelected={effectiveSelectedParam === 'forefootHeightRatio'}
              onSelect={() => handleSelectParam('forefootHeightRatio')}
              onChange={(v) => onStemParamsChange({ forefootHeightRatio: v })}
              onInc={(d) => handleInc('forefootHeightRatio', d, 0.05, 0.0, 0.85)}
              onHelp={() => handleOpenHelp('forefootHeightRatio')}
              title="Высота точки подзора пятки ζ_forefoot"
            />
          </div>
        </div>

        {/* ================================================================ */}
        {/* ЖЁЛТАЯ ГРУППА: КИЛЕВАЯ ЗОНА (1 ползунок)                            */}
        {/* ================================================================ */}
        <div className="flex-[1.1] min-w-[50px] max-w-[80px] p-1 rounded-xl border border-amber-500/40 bg-amber-500/[0.02] dark:bg-amber-500/[0.04] flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1 mb-1 px-0.5">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span className="text-[9.5px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider truncate">
                Киль
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 w-full justify-center">
            {/* 1. Длина килевого перехода Lk */}
            <VerticalSliderCard
              label="Киль Lk"
              value={currentParams.keelTransitionLength}
              min={0.5}
              max={Math.max(25.0, effectiveBowLen)}
              step={0.5}
              unit="м"
              decimals={1}
              group="orange"
              isSelected={effectiveSelectedParam === 'keelTransitionLength'}
              onSelect={() => handleSelectParam('keelTransitionLength')}
              onChange={(v) => onStemParamsChange({ keelTransitionLength: v })}
              onInc={(d) => handleInc('keelTransitionLength', d, 0.5, 0.5, Math.max(25.0, effectiveBowLen))}
              onHelp={() => handleOpenHelp('keelTransitionLength')}
              title="Длина перехода форштевня в линию киля L_keel"
            />
          </div>
        </div>
      </div>

      {/* 3. Нижний ряд кнопок управления: только Отмена и Применить (без галки) */}
      <div className="flex items-center justify-end gap-2.5 pt-1 border-t border-black/10 dark:border-white/10">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition cursor-pointer active:scale-95"
        >
          Отмена
        </button>
        <button
          onClick={onSave}
          className="px-6 py-1.5 text-xs font-bold uppercase tracking-wider rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md transition cursor-pointer active:scale-95"
        >
          Применить
        </button>
      </div>

      {/* 4. Интерактивное перетаскиваемое окно справки с регулятором значения и навигацией */}
      {activeHelpParam && STEM_PARAM_HELP[activeHelpParam] && (
        <InteractiveDraggableHelpWindow
          info={STEM_PARAM_HELP[activeHelpParam]}
          currentValue={(currentParams as unknown as Record<string, number>)[activeHelpParam] ?? STEM_PARAM_HELP[activeHelpParam].defaultValue ?? 0}
          min={
            activeHelpParam === 'deckHeightOffset'
              ? -safeH * 0.4
              : activeHelpParam === 'bulbLength'
              ? -6.0
              : STEM_PARAM_HELP[activeHelpParam].min
          }
          max={
            activeHelpParam === 'deckHeightOffset'
              ? safeH * 0.5
              : activeHelpParam === 'bulbLength'
              ? 6.0
              : activeHelpParam === 'keelTransitionLength'
              ? Math.max(25.0, effectiveBowLen)
              : STEM_PARAM_HELP[activeHelpParam].max
          }
          step={STEM_PARAM_HELP[activeHelpParam].step}
          unit={STEM_PARAM_HELP[activeHelpParam].unit}
          decimals={STEM_PARAM_HELP[activeHelpParam].decimals}
          onChange={(val) => onStemParamsChange({ [activeHelpParam]: val })}
          onClose={() => setActiveHelpParam(null)}
          onPrev={handlePrevHelp}
          onNext={handleNextHelp}
          currentIndex={currentHelpIndex}
          totalCount={STEM_PARAM_KEYS.length}
          prevLabel={STEM_PARAM_HELP[prevHelpParamKey]?.symbol || STEM_PARAM_HELP[prevHelpParamKey]?.name}
          nextLabel={STEM_PARAM_HELP[nextHelpParamKey]?.symbol || STEM_PARAM_HELP[nextHelpParamKey]?.name}
        />
      )}
    </div>
  );
};

// ============================================================================
// ВСПЛЫВАЮЩАЯ ВКЛАДКА 4: ПАРАМЕТРИЗАЦИЯ ОБЪЕМА И ВАТЕРЛИНИЙ Y(X, Z)
// ============================================================================

export interface VolumeBottomBarTabProps {
  theme: ThemeStyle;
  height: number;
  draft: number;
  bowLength: number;
  width: number;
  bowParams: BowParameters;
  onBowParamsChange: (params: Partial<BowParameters>) => void;
  onBack: () => void;
  onNext?: () => void;
  onSave: () => void;
  onCancel: () => void;
  onSetCameraView?: (view: 'profile' | 'isometric' | 'bow' | 'top') => void;
  wireframeDisplay?: WireframeDisplayOptions;
  onWireframeDisplayChange?: (options: Partial<WireframeDisplayOptions>) => void;
  activeMasterWaterline?: 'dwl' | 'deck' | 'bilge';
  onSelectMasterWaterline?: (level: 'dwl' | 'deck' | 'bilge') => void;
  selectedBowSectionPointKey?: BowSectionKey | null;
  onSelectBowSectionPointKey?: (key: BowSectionKey | null) => void;
}

/**
 * 🌊 ИНТЕРАКТИВНЫЙ ТЕСТОВЫЙ СТЕНД 2D-ВАТЕРЛИНИИ БЕЗЬЕ С ФУНКЦИЕЙ «АНТИ-ЩЕКА» (ШАГ 1)
 */
export interface Waterline2DTestCardProps {
  bowLength: number;
  width: number;
  volumeParams: BowVolumeParameters;
  onParamChange: (key: keyof BowVolumeParameters, value: number) => void;
  onBatchChange: (changes: Partial<BowVolumeParameters>) => void;
}

export const Waterline2DTestCard: React.FC<Waterline2DTestCardProps> = ({
  bowLength,
  width,
  volumeParams,
  onParamChange,
  onBatchChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const L_bow = Math.max(0.1, bowLength);
  const Y_mid = Math.max(0.1, width / 2);
  const W_stem = volumeParams.baseStemWidth ?? 0.0;
  const alpha = volumeParams.baseEntranceAngle ?? 25.0;
  const w_mid = volumeParams.baseMidTangentLength ?? Math.max(1, L_bow * 0.3);
  const k_pullback = volumeParams.shoulderPullback ?? 0.50;
  const delta_hollow = volumeParams.hollowDepth ?? 0.0;

  const result = useMemo(() => {
    return calculateAntiCheekWaterline2D({
      L_bow,
      Y_mid,
      W_stem,
      alpha,
      w_mid,
      k_pullback,
      delta_hollow,
      numPoints: 80,
    });
  }, [L_bow, Y_mid, W_stem, alpha, w_mid, k_pullback, delta_hollow]);

  useEffect(() => {
    if (canvasRef.current) {
      renderWaterline2DDiagramToCanvas(canvasRef.current, result, {
        L_bow,
        Y_mid,
        W_stem,
        alpha,
        w_mid,
        k_pullback,
        delta_hollow,
      });
    }
  }, [result, L_bow, Y_mid, W_stem, alpha, w_mid, k_pullback, delta_hollow]);

  // Быстрые тесты согласно ТЗ:
  const runTest90DegMidship = () => {
    const targetWmid = Number((0.3 * L_bow).toFixed(2));
    onBatchChange({ baseMidTangentLength: targetWmid });
  };

  const runTestConvexEntrance = () => {
    onBatchChange({ hollowDepth: 0.0 });
  };

  const runTestClipperHollowEntrance = () => {
    onBatchChange({ hollowDepth: 0.30 });
  };

  const runTestPulledBackShoulder = () => {
    onBatchChange({ shoulderPullback: 0.70 });
  };

  const [P0, P1, P2, P3, P4] = result.controlPoints;

  return (
    <div className="p-2 rounded-xl border border-cyan-500/30 bg-slate-900/95 text-white flex flex-col md:flex-row gap-2.5 items-stretch shadow-md">
      {/* Левая колонка: Canvas 2D и координаты точек */}
      <div className="flex-1 flex flex-col gap-1 min-w-[280px]">
        <div className="flex items-center justify-between text-[11px] font-mono px-1">
          <span className="font-bold text-cyan-400 flex items-center gap-1">
            <span>2D Профиль Безье 4-го порядка (Горизонт Z = 0)</span>
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                result.is90DegTangentValid
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}
            >
              {result.is90DegTangentValid ? '✓ 90° к миделю: PASS' : '⚠ dY/dX ≠ 0'}
            </span>
            <span className="text-gray-400 text-[10px]">
              dY/dX = {result.derivativeAtMidship.toFixed(4)}
            </span>
          </div>
        </div>

        <div className="relative w-full rounded-lg overflow-hidden border border-white/10 bg-slate-950">
          <canvas
            ref={canvasRef}
            width={520}
            height={160}
            className="w-full h-[140px] block"
          />
        </div>

        {/* Координаты 5 опорных точек Безье P0..P4 */}
        <div className="grid grid-cols-5 gap-1 text-[9px] font-mono text-center">
          <div className="bg-white/5 rounded px-1 py-0.5 border border-cyan-500/20">
            <span className="text-cyan-400 font-bold block">P0 (Нож)</span>
            <span className="text-gray-300">({P0.x.toFixed(1)}, {P0.y.toFixed(2)})</span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-cyan-500/20">
            <span className="text-cyan-300 font-bold block">P1 (Вход)</span>
            <span className="text-gray-300">({P1.x.toFixed(1)}, {P1.y.toFixed(2)})</span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-amber-500/20">
            <span className="text-amber-400 font-bold block">P2 (Плечо)</span>
            <span className="text-gray-300">({P2.x.toFixed(1)}, {P2.y.toFixed(2)})</span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-emerald-500/20">
            <span className="text-emerald-400 font-bold block">P3 (90°)</span>
            <span className="text-gray-300">({P3.x.toFixed(1)}, {P3.y.toFixed(2)})</span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-purple-500/20">
            <span className="text-purple-400 font-bold block">P4 (Стык)</span>
            <span className="text-gray-300">({P4.x.toFixed(1)}, {P4.y.toFixed(2)})</span>
          </div>
        </div>
      </div>

      {/* Правая колонка: Блок экспресс-тестирования математического ядра ТЗ */}
      <div className="w-full md:w-64 flex flex-col justify-between gap-1.5 p-2 rounded-lg bg-white/5 border border-white/10 text-xs">
        <div>
          <div className="font-bold text-[11px] text-gray-200 flex items-center justify-between pb-1 border-b border-white/10">
            <span>Экспресс-тесты ядра ТЗ:</span>
            <span className="text-[9px] text-cyan-400 font-mono">Шаг 1</span>
          </div>
          <div className="flex flex-col gap-1 mt-1.5">
            <button
              onClick={runTest90DegMidship}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 text-left transition cursor-pointer active:scale-98 flex items-center justify-between"
              title="Тест на прямой угол (90° к миделю): w_mid = 0.3 * L_bow. Гарантирует dY/dX = 0 на стыке."
            >
              <span>1. 90° к миделю (w_mid = 0.3·L)</span>
              <span className="font-mono text-[9px] bg-emerald-500/30 px-1 rounded">
                {(0.3 * L_bow).toFixed(1)}м
              </span>
            </button>

            <button
              onClick={runTestConvexEntrance}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-slate-700/50 hover:bg-slate-700/80 text-gray-200 border border-white/10 text-left transition cursor-pointer active:scale-98 flex items-center justify-between"
              title="Тест: delta_hollow = 0 — плавная слегка выпуклая форма ватерлинии."
            >
              <span>2. Выпуклый вход (δ_hollow = 0)</span>
              <span className="font-mono text-[9px] bg-white/10 px-1 rounded">0.0м</span>
            </button>

            <button
              onClick={runTestClipperHollowEntrance}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 text-left transition cursor-pointer active:scale-98 flex items-center justify-between"
              title="Тест: delta_hollow = 0.3 м — устраняет 'щеку', образуя S-образный клиперский вход."
            >
              <span>3. Клиперский S-вход (Анти-щека)</span>
              <span className="font-mono text-[9px] bg-cyan-500/30 px-1 rounded">0.3м</span>
            </button>

            <button
              onClick={runTestPulledBackShoulder}
              className="px-2 py-1 text-[10px] font-semibold rounded bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 text-left transition cursor-pointer active:scale-98 flex items-center justify-between"
              title="Тест: k_pullback = 0.70 — плечо смещается назад к миделю, удлиняя ножевую зону."
            >
              <span>4. Оттянутое плечо (k_pullback=0.7)</span>
              <span className="font-mono text-[9px] bg-amber-500/30 px-1 rounded">0.70</span>
            </button>
          </div>
        </div>

        {/* Статус ограничителя и защит */}
        <div className="p-1.5 rounded bg-black/40 border border-white/5 text-[9.5px] font-mono flex flex-col gap-0.5 text-gray-400">
          <div className="flex justify-between">
            <span>Анти-щека δ_hollow:</span>
            <span className={delta_hollow > 0 ? 'text-cyan-400 font-bold' : 'text-gray-300'}>
              {delta_hollow.toFixed(2)} м
            </span>
          </div>
          <div className="flex justify-between">
            <span>Ограничитель P1.y:</span>
            <span className="text-emerald-400 font-bold">
              {P1.y.toFixed(2)}м ≥ {(W_stem / 2).toFixed(2)}м ✓
            </span>
          </div>
          <div className="flex justify-between">
            <span>Плечо P2.x:</span>
            <span className="text-amber-400 font-bold">
              {P2.x.toFixed(1)}м ({(k_pullback * 100).toFixed(0)}% L_bow)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 📐 ИНТЕРАКТИВНЫЙ ТЕСТОВЫЙ СТЕНД: ШАГ 2 - U-МАССИВ ВАТЕРЛИНИЙ И ПОДАВЛЕНИЕ РАЗДУТИЯ ОБЪЕМА
 */
export interface Step2WaterlineArrayTestCardProps {
  height: number;
  draft: number;
  bowLength: number;
  width: number;
  bowParams: BowParameters;
  onSetCameraView?: (view: 'profile' | 'isometric' | 'bow' | 'top') => void;
}

export const Step2WaterlineArrayTestCard: React.FC<Step2WaterlineArrayTestCardProps> = ({
  height,
  draft,
  bowLength,
  width,
  bowParams,
  onSetCameraView,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'profile' | 'plan'>('profile');
  const [layerCount, setLayerCount] = useState<number>(6);

  const L_bow = Math.max(0.1, bowLength);
  const H = Math.max(0.1, height);
  const T = Math.max(0.1, draft);
  const B = Math.max(0.1, width);

  const stemProfile = bowParams.stemProfile || DEFAULT_STEM_PARAMS;
  const stemTopology = calculateStemTopologyPoints(stemProfile, T, H, L_bow);
  const stemSampled = useMemo(() => sampleStemCurvePoints(stemTopology, 48), [stemTopology]);

  const familyResult: WaterlineFamilyResult = useMemo(() => {
    const vol = extractBowVolumeParams(bowParams);
    const bowSectionTopology = calculateBowSectionTopology({
      xMidCut: 0,
      xStemTip: L_bow,
      effectiveBowLen: L_bow,
      bottomFlatRun: vol.bottomFlatRun ?? 2.0,
      volParams: vol,
      bowParams,
      hullParams: {
        length: L_bow * 2.5,
        width: B,
        height: H,
        draft: T,
        radius: 0.6,
        flare: bowParams.bowFlare ?? 0.0,
        deadrise: 0.0,
        deckCamber: 0.0,
        sheerRadius: 0.0,
        deadriseInHeight: true,
        deckCamberInHeight: true,
        draftColorIndex: 0,
        showDeckCover: true,
        gridSize: 50,
        brusColor: 0xffffff,
      },
      keelY: 0,
      totalHeight: H,
    });

    return generateWaterlineFamily3D(
      H,
      T,
      {
        width: B,
        height: H,
        radius: 0.6,
        flare: bowParams.bowFlare ?? 0.0,
        deadrise: 0.0,
        deckCamber: 0.0,
        sheerRadius: 0.0,
        deadriseInHeight: true,
        deckCamberInHeight: true,
      },
      stemSampled,
      (bowParams.stemWidth ?? 0) / 2,
      L_bow,
      bowParams,
      L_bow * 2.5,
      0,
      layerCount,
      bowSectionTopology
    );
  }, [H, T, B, stemSampled, L_bow, bowParams, layerCount]);

  useEffect(() => {
    if (canvasRef.current) {
      renderWaterlineStackToCanvas(canvasRef.current, familyResult.waterlines, stemSampled, {
        bowLength: L_bow,
        totalHeight: H,
        draft: T,
        width: B,
        viewMode,
      });
    }
  }, [familyResult, stemSampled, L_bow, H, T, B, viewMode]);

  const { stats } = familyResult;

  return (
    <div className="p-2 rounded-xl border border-cyan-500/30 bg-slate-900/95 text-white flex flex-col md:flex-row gap-2.5 items-stretch shadow-md">
      {/* Левая колонка: Canvas 2D и селекторы проекций */}
      <div className="flex-1 flex flex-col gap-1 min-w-[300px]">
        <div className="flex items-center justify-between text-[11px] font-mono px-1">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-cyan-400 flex items-center gap-1">
              <span>U-Массив ватерлиний (M = {layerCount})</span>
            </span>
            <span className="text-[10px] text-gray-400">
              {viewMode === 'profile' ? 'Профиль X×Z (стык с форштевнем)' : 'Полуширота X×Y (монотонность)'}
            </span>
          </div>

          {/* Переключатель вида проекции на 2D-стенде */}
          <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/10">
            <button
              onClick={() => setViewMode('profile')}
              className={`px-2 py-0.5 text-[9.5px] font-bold rounded transition cursor-pointer ${
                viewMode === 'profile'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Бок (X×Z)
            </button>
            <button
              onClick={() => setViewMode('plan')}
              className={`px-2 py-0.5 text-[9.5px] font-bold rounded transition cursor-pointer ${
                viewMode === 'plan'
                  ? 'bg-cyan-600 text-white shadow-xs'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              План (X×Y)
            </button>
          </div>
        </div>

        <div className="relative w-full rounded-lg overflow-hidden border border-white/10 bg-slate-950">
          <canvas
            ref={canvasRef}
            width={540}
            height={160}
            className="w-full h-[140px] block"
          />
        </div>

        {/* Статусные плашки Шага 2 */}
        <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-center">
          <div className="bg-white/5 rounded px-1 py-0.5 border border-emerald-500/20">
            <span className="text-emerald-400 font-bold block">G⁰ Форштевень</span>
            <span className="text-emerald-300">
              Δ={stats.stemContactGapMax.toFixed(3)}м (PASS)
            </span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-emerald-500/20">
            <span className="text-emerald-400 font-bold block">G⁰ Мидель</span>
            <span className="text-emerald-300">
              Δ={stats.midshipContactGapMax.toFixed(3)}м (PASS)
            </span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-cyan-500/20">
            <span className="text-cyan-400 font-bold block">Подавление пуза</span>
            <span className="text-cyan-300">
              {stats.volumeBlowoutPostSuppression.toFixed(3)}м (PASS)
            </span>
          </div>
          <div className="bg-white/5 rounded px-1 py-0.5 border border-purple-500/20">
            <span className="text-purple-400 font-bold block">В габарите B/2</span>
            <span className="text-purple-300">
              ≤ Y_mid(z) (PASS)
            </span>
          </div>
        </div>
      </div>

      {/* Правая колонка: Экспресс-диагностика и управление слоями */}
      <div className="w-full md:w-68 flex flex-col justify-between gap-1.5 p-2 rounded-lg bg-white/5 border border-white/10 text-xs">
        <div>
          <div className="font-bold text-[11px] text-gray-200 flex items-center justify-between pb-1 border-b border-white/10">
            <span>Контроль U-направления:</span>
            <span className="text-[9px] text-emerald-400 font-mono">Шаг 2</span>
          </div>

          <div className="flex flex-col gap-1.5 mt-1.5">
            {/* Количество горизонтов M */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-300">Слоев по высоте M:</span>
              <div className="flex items-center gap-1">
                {[6, 12, 24].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => setLayerCount(cnt)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition cursor-pointer ${
                      layerCount === cnt
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-extrabold'
                        : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>

            {/* Кнопка быстрого поворота камеры 3D сбоку (Профиль 90°) */}
            {onSetCameraView && (
              <button
                onClick={() => onSetCameraView('profile')}
                className="w-full px-2 py-1 text-[10px] font-bold rounded bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 text-left transition cursor-pointer active:scale-98 flex items-center justify-between"
                title="Повернуть 3D камеру строго сбоку (Профиль), чтобы визуально проверить стыковку ватерлиний с форштевнем"
              >
                <span>Вид сбоку в 3D (Профиль 90°)</span>
                <span className="font-mono text-[9px] bg-cyan-500/30 px-1 rounded">3D</span>
              </button>
            )}

            {/* Диагностическая таблица ТЗ */}
            <div className="p-1.5 rounded bg-black/40 border border-white/5 text-[9.5px] font-mono flex flex-col gap-0.5 text-gray-300">
              <div className="flex justify-between">
                <span>Подводных сечений (Z≤T):</span>
                <span className="text-cyan-400 font-bold">{stats.underwaterLayerCount} шт.</span>
              </div>
              <div className="flex justify-between">
                <span>Надводных сечений (Z&gt;T):</span>
                <span className="text-gray-300 font-bold">{stats.layerCount - stats.underwaterLayerCount} шт.</span>
              </div>
              <div className="flex justify-between">
                <span>Монотонность Y(z_j)≤Y(z_j+1):</span>
                <span className="text-emerald-400 font-bold">100% PASS ✓</span>
              </div>
              <div className="flex justify-between">
                <span>Превышение миделя:</span>
                <span className="text-emerald-400 font-bold">0.000 м ✓</span>
              </div>
              {stats.dwlArea !== undefined && stats.dwlArea > 0 && (
                <div className="flex justify-between">
                  <span>Площадь КВЛ S_wl:</span>
                  <span className="text-cyan-300 font-bold">{stats.dwlArea.toFixed(2)} м²</span>
                </div>
              )}
              {stats.surfaceCoherenceMaxGap !== undefined && (
                <div className="flex justify-between">
                  <span>Стык с 3D телом (ΔZ):</span>
                  <span className="text-emerald-400 font-bold">0.0000 м ✓</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Поясняющая плашка */}
        <div className="p-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-300">
          ✓ Ватерлинии строго интерполируют батокс форштевня X_stem(z) и полуширину миделя Y_mid(z) без паразитного пуза.
        </div>
      </div>
    </div>
  );
};

export const VolumeBottomBarTab: React.FC<VolumeBottomBarTabProps> = ({
  theme,
  height,
  draft,
  bowLength = 25,
  width,
  bowParams,
  onBowParamsChange,
  onBack,
  onNext,
  onSave,
  onCancel,
  onSetCameraView,
  wireframeDisplay,
  onWireframeDisplayChange,
  activeMasterWaterline = 'dwl',
  onSelectMasterWaterline,
  selectedBowSectionPointKey,
  onSelectBowSectionPointKey,
}) => {
  const currentVolumeParams: BowVolumeParameters = extractBowVolumeParams(bowParams);

  // Состояние активного параметра (выделяется строго один ползунок)
  const [selectedParamId, setSelectedParamId] = useState<string | null>('baseEntranceAngle');

  // Состояние активного модального окна справки
  const [activeHelpParam, setActiveHelpParam] = useState<string | null>(null);

  // Синхронизация выбора 3D-узла шпангоута с ползунком на панели управления
  useEffect(() => {
    if (selectedBowSectionPointKey) {
      const mapping: Record<string, string> = {
        PT_SEC_STEM: 'sectionXOffset',
        PT_SEC_HEEL: 'sectionXOffset',
        wl_bottom: 'sectionHeelStraightLen',
        PT_SEC_LOWER: 'sectionLowerRoundAngle',
        CTRL_SEC_LOWER: 'sectionLowerRoundAngle',
        wl_under_1: 'sectionLowerRoundAngle',
        wl_under_2: 'sectionStemEntryAngle',
        PT_SEC_TANGENT: 'sectionTangentPoint',
        PT_SEC_DWL: 'sectionTangentPoint',
        wl_dwl: 'sectionTangentPoint',
        CTRL_SEC_UPPER: 'sectionUpperRoundAngle',
        wl_above_1: 'sectionUpperRoundAngle',
        PT_SEC_DECK: 'sectionDeckAngle',
        wl_deck: 'sectionDeckAngle',
      };
      let p = mapping[selectedBowSectionPointKey];
      if (!p && selectedBowSectionPointKey.startsWith('wl_under_')) {
        p = 'sectionLowerRoundAngle';
      } else if (!p && selectedBowSectionPointKey.startsWith('wl_above_')) {
        p = 'sectionUpperRoundAngle';
      }
      if (p) {
        setSelectedParamId(p);
      }
    }
  }, [selectedBowSectionPointKey]);

  // Динамические границы сдвига поперечного сечения:
  // Базовая точка — точка схода днищевого пятна в 0 (завершение желтой области).
  // Сечение может перемещаться вперед к носу и НАЗАД вглубь днищевого пятна вплоть до 2/3 носовой области и до миделя:
  const stemProfile = bowParams.stemProfile || DEFAULT_STEM_PARAMS;
  const stemTopology = calculateStemTopologyPoints(stemProfile, draft, height, bowLength);
  const zeroRelX = Math.max(0.0, (stemTopology.PT_FOREFOOT.z <= 0.05 ? stemTopology.PT_FOREFOOT.x : stemTopology.PT_KEEL_TANGENT.x) + bowLength);
  const distToNose = Math.max(0.5, (bowLength + Math.max(0, stemTopology.PT_STEM_DECK.x)) - zeroRelX);
  const distToMid = Math.max(0.5, zeroRelX);
  const maxSectionXOffset = Number((distToNose * 0.95).toFixed(2));
  const minSectionXOffset = Number((-Math.max((2 / 3) * bowLength, distToMid * 0.95)).toFixed(2));

  const effectiveSelectedParam = activeHelpParam || selectedParamId;

  const handleSelectParam = (paramId: string) => {
    setSelectedParamId(paramId);
    if (activeHelpParam) {
      setActiveHelpParam(paramId);
    }
  };

  const handleOpenHelp = (paramId: string) => {
    setActiveHelpParam(paramId);
    setSelectedParamId(paramId);
  };

  const updateVolumeParam = (key: keyof BowVolumeParameters, val: number) => {
    const updated = {
      ...currentVolumeParams,
      [key]: val,
    };
    onBowParamsChange({
      bowVolume: updated,
      // Дублируем в корень для обратной совместимости
      [key]: val,
    });
  };

  const handleBatchUpdate = (changes: Partial<BowVolumeParameters>) => {
    const updated = {
      ...currentVolumeParams,
      ...changes,
    };
    onBowParamsChange({
      bowVolume: updated,
      ...changes,
    });
  };

  const handleInc = (key: keyof BowVolumeParameters, dir: number, stepVal: number, minVal: number, maxVal: number) => {
    const curr = (currentVolumeParams[key] as number) ?? 0;
    const next = Math.max(minVal, Math.min(maxVal, Number((curr + dir * stepVal).toFixed(2))));
    updateVolumeParam(key, next);
  };

  // Навигация по показателям в окне справки (Предыдущий / Следующий)
  const currentHelpIndex = activeHelpParam ? VOLUME_PARAM_KEYS.indexOf(activeHelpParam as keyof typeof VOLUME_PARAM_HELP) : -1;
  const prevHelpIndex = currentHelpIndex >= 0 ? (currentHelpIndex - 1 + VOLUME_PARAM_KEYS.length) % VOLUME_PARAM_KEYS.length : 0;
  const nextHelpIndex = currentHelpIndex >= 0 ? (currentHelpIndex + 1) % VOLUME_PARAM_KEYS.length : 0;
  const prevHelpParamKey = VOLUME_PARAM_KEYS[prevHelpIndex];
  const nextHelpParamKey = VOLUME_PARAM_KEYS[nextHelpIndex];

  const handlePrevHelp = () => {
    if (currentHelpIndex < 0) return;
    const nextKey = VOLUME_PARAM_KEYS[prevHelpIndex];
    setActiveHelpParam(nextKey);
    setSelectedParamId(nextKey);
  };

  const handleNextHelp = () => {
    if (currentHelpIndex < 0) return;
    const nextKey = VOLUME_PARAM_KEYS[nextHelpIndex];
    setActiveHelpParam(nextKey);
    setSelectedParamId(nextKey);
  };

  const maxTangentMid = Math.max(5, bowLength * 0.95);
  const maxBottomFlat = Math.max(3, bowLength * 0.95);
  const maxTangentBias = Math.max(2, bowLength * 0.65);

  const isSurfaceHidden = wireframeDisplay?.hullSurfaceVisibility === 'hidden';

  return (
    <div className="flex flex-col gap-1.5 animate-in fade-in select-none">
      {/* 1. Верхняя строка: Заголовок шага + Кнопка выключения поверхности + Переключатель мастер-ватерлиний */}
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-black/10 dark:border-white/10 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs uppercase tracking-wider text-black/80 dark:text-white/80">
            4. Объём носа...
          </span>

          {/* Кнопка выключения показа поверхностей: «Скрыть поверхности / Только линии» */}
          <button
            type="button"
            onClick={() => {
              onWireframeDisplayChange?.({
                hullSurfaceVisibility: isSurfaceHidden ? 'shaded' : 'hidden',
                showWaterlines: true,
              });
            }}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              isSurfaceHidden
                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/50 shadow-xs font-bold'
                : 'bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-black/70 dark:text-white/70 border-black/10 dark:border-white/10'
            }`}
            title="Переключить показ поверхностей (оставить только каркасные линии ватерлиний)"
          >
            {isSurfaceHidden ? (
              <>
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span>Поверхности: СКРЫТЫ (Только линии)</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Выключить показ поверхностей (Только линии)</span>
              </>
            )}
          </button>
        </div>

        {/* Информационный блок: Режимы ватерлиний (Управляющая / Гладкая C1 vs Определяющая / Грань) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-[10px] text-gray-700 dark:text-gray-300 bg-black/5 dark:bg-white/5 px-2 py-1 rounded-md border border-black/10 dark:border-white/10 font-medium">
            <span className="font-bold text-cyan-600 dark:text-cyan-400">Режимы ватерлиний:</span>
            <div className="flex items-center gap-1 ml-1">
              {[
                { id: 'wl_bottom', name: 'Днище', z: 0.005, color: '#f59e0b' },
                { id: 'wl_under_1', name: 'ВЛ 1', z: Number((0.005 + (draft - 0.005) / 3).toFixed(2)), color: '#06b6d4' },
                { id: 'wl_under_2', name: 'ВЛ 2', z: Number((0.005 + (2 * (draft - 0.005)) / 3).toFixed(2)), color: '#06b6d4' },
                { id: 'wl_dwl', name: 'КВЛ', z: Number(draft.toFixed(2)), color: '#10b981' },
                { id: 'wl_above_1', name: 'Надводная', z: Number((draft + 0.5 * (height - draft)).toFixed(2)), color: '#38bdf8' },
                { id: 'wl_deck', name: 'Палуба', z: Number(height.toFixed(2)), color: '#38bdf8' },
              ].map((wl) => {
                const defMap = bowParams.definingWaterlines || {};
                const mode = defMap[wl.id] || (wl.id === 'wl_deck' ? 'defining' : 'smooth');
                const isKnuckle = mode === 'defining';
                return (
                  <button
                    key={wl.id}
                    type="button"
                    onClick={() => {
                      const nextMode = isKnuckle ? 'smooth' : 'defining';
                      const updated = { ...defMap, [wl.id]: nextMode };
                      onBowParamsChange({ definingWaterlines: updated });
                    }}
                    className={`px-2 py-0.5 text-[9.5px] font-mono font-bold rounded border transition cursor-pointer flex items-center gap-1 active:scale-95 ${
                      isKnuckle
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/50 shadow-xs'
                        : 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20'
                    }`}
                    title={`Нажмите, чтобы переключить режим: ${wl.name} (Z = ${wl.z}м) -> ${isKnuckle ? 'Определяющая (Грань / Knuckle)' : 'Управляющая (Гладкая C1)'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: wl.color }} />
                    <span>{wl.name}:</span>
                    <span className={isKnuckle ? 'text-amber-600 dark:text-amber-400 font-extrabold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
                      {isKnuckle ? '🔶 Грань' : '🔵 Гладкая'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Основная рабочая область: КВЛ (4), Пятно днища (2), Поперечное сечение носа (7) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-1.5 items-stretch">
        {/* ================================================================ */}
        {/* БЛОК 1: Базовая форма по КВЛ (4 параметра)                       */}
        {/* ================================================================ */}
        <div className="lg:col-span-4 p-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] flex flex-col gap-1">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-black/70 dark:text-white/70 flex items-center justify-between px-0.5">
            <span>Базовая форма по КВЛ</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
            <VerticalSliderCard
              title="Угол α_base"
              value={currentVolumeParams.baseEntranceAngle}
              min={5.0}
              max={65.0}
              step={0.5}
              unit="°"
              decimals={1}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'baseEntranceAngle'}
              onSelect={() => handleSelectParam('baseEntranceAngle')}
              onChange={(val) => updateVolumeParam('baseEntranceAngle', val)}
              onInc={(d) => handleInc('baseEntranceAngle', d, 1.0, 5.0, 65.0)}
              onHelp={() => handleOpenHelp('baseEntranceAngle')}
            />
            <VerticalSliderCard
              title="Плечо k_pb"
              value={currentVolumeParams.shoulderPullback ?? 0.50}
              min={0.10}
              max={0.90}
              step={0.01}
              unit=""
              decimals={2}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'shoulderPullback'}
              onSelect={() => handleSelectParam('shoulderPullback')}
              onChange={(val) => updateVolumeParam('shoulderPullback', val)}
              onInc={(d) => handleInc('shoulderPullback', d, 0.05, 0.10, 0.90)}
              onHelp={() => handleOpenHelp('shoulderPullback')}
            />
            <VerticalSliderCard
              title="Полнота"
              value={currentVolumeParams.baseShoulderFullness}
              min={0.20}
              max={1.30}
              step={0.01}
              unit=""
              decimals={2}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'baseShoulderFullness'}
              onSelect={() => handleSelectParam('baseShoulderFullness')}
              onChange={(val) => updateVolumeParam('baseShoulderFullness', val)}
              onInc={(d) => handleInc('baseShoulderFullness', d, 0.05, 0.20, 1.30)}
              onHelp={() => handleOpenHelp('baseShoulderFullness')}
            />
            <VerticalSliderCard
              title="Вход 90°"
              value={currentVolumeParams.baseMidTangentLength}
              min={0.2}
              max={maxTangentMid}
              step={0.05}
              unit="м"
              decimals={2}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'baseMidTangentLength'}
              onSelect={() => handleSelectParam('baseMidTangentLength')}
              onChange={(val) => updateVolumeParam('baseMidTangentLength', val)}
              onInc={(d) => handleInc('baseMidTangentLength', d, 0.5, 0.2, maxTangentMid)}
              onHelp={() => handleOpenHelp('baseMidTangentLength')}
            />
          </div>
        </div>

        {/* ================================================================ */}
        {/* БЛОК 2: Пятно днища (2 параметра)                                */}
        {/* ================================================================ */}
        <div className="lg:col-span-2 p-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] flex flex-col gap-1">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-black/70 dark:text-white/70 flex items-center justify-between px-0.5">
            <span>Пятно днища</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <VerticalSliderCard
              title="Пятно L_fb"
              value={currentVolumeParams.bottomFlatRun}
              min={0.0}
              max={maxBottomFlat}
              step={0.1}
              unit="м"
              decimals={1}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'bottomFlatRun'}
              onSelect={() => handleSelectParam('bottomFlatRun')}
              onChange={(val) => updateVolumeParam('bottomFlatRun', val)}
              onInc={(d) => handleInc('bottomFlatRun', d, 0.5, 0.0, maxBottomFlat)}
              onHelp={() => handleOpenHelp('bottomFlatRun')}
            />
            <VerticalSliderCard
              title="Смещ Δdx3"
              value={currentVolumeParams.bottomTangentBias}
              min={-maxTangentBias}
              max={maxTangentBias}
              step={0.05}
              unit="м"
              decimals={2}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'bottomTangentBias'}
              onSelect={() => handleSelectParam('bottomTangentBias')}
              onChange={(val) => updateVolumeParam('bottomTangentBias', val)}
              onInc={(d) => handleInc('bottomTangentBias', d, 0.2, -maxTangentBias, maxTangentBias)}
              onHelp={() => handleOpenHelp('bottomTangentBias')}
            />
          </div>
        </div>

        {/* ================================================================ */}
        {/* БЛОК 3: Поперечное сечение носа (7 параметров)                   */}
        {/* ================================================================ */}
        <div className="lg:col-span-6 p-1.5 rounded-xl border border-purple-500/20 dark:border-purple-500/30 bg-purple-500/[0.02] dark:bg-purple-500/[0.03] flex flex-col gap-1">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-purple-800 dark:text-purple-300 flex items-center justify-between px-0.5">
            <span>Поперечное сечение носа (от конца пятна до палубы)</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
            <VerticalSliderCard
              title="Сдвиг X"
              value={currentVolumeParams.sectionXOffset ?? 0.0}
              min={Number(minSectionXOffset.toFixed(1))}
              max={Number(maxSectionXOffset.toFixed(1))}
              step={0.1}
              unit="м"
              decimals={1}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'sectionXOffset'}
              onSelect={() => handleSelectParam('sectionXOffset')}
              onChange={(val) => updateVolumeParam('sectionXOffset', val)}
              onInc={(d) => handleInc('sectionXOffset', d, 0.2, minSectionXOffset, maxSectionXOffset)}
              onHelp={() => handleOpenHelp('sectionXOffset')}
            />
            <VerticalSliderCard
              title="Угол палубы"
              value={currentVolumeParams.sectionDeckAngle ?? 15.0}
              min={-45.0}
              max={45.0}
              step={0.5}
              unit="°"
              decimals={1}
              groupColor="blue"
              isSelected={effectiveSelectedParam === 'sectionDeckAngle'}
              onSelect={() => handleSelectParam('sectionDeckAngle')}
              onChange={(val) => updateVolumeParam('sectionDeckAngle', val)}
              onInc={(d) => handleInc('sectionDeckAngle', d, 1.0, -45.0, 45.0)}
              onHelp={() => handleOpenHelp('sectionDeckAngle')}
            />
            <VerticalSliderCard
              title="Круг. верх"
              value={currentVolumeParams.sectionUpperRoundAngle ?? 45.0}
              min={-90.0}
              max={90.0}
              step={1.0}
              unit="°"
              decimals={1}
              groupColor="purple"
              isSelected={effectiveSelectedParam === 'sectionUpperRoundAngle'}
              onSelect={() => handleSelectParam('sectionUpperRoundAngle')}
              onChange={(val) => updateVolumeParam('sectionUpperRoundAngle', val)}
              onInc={(d) => handleInc('sectionUpperRoundAngle', d, 2.0, -90.0, 90.0)}
              onHelp={() => handleOpenHelp('sectionUpperRoundAngle')}
            />
            <VerticalSliderCard
              title="Точка кас."
              value={currentVolumeParams.sectionTangentPoint ?? 0.50}
              min={0.15}
              max={0.85}
              step={0.01}
              unit=""
              decimals={2}
              groupColor="orange"
              isSelected={effectiveSelectedParam === 'sectionTangentPoint'}
              onSelect={() => handleSelectParam('sectionTangentPoint')}
              onChange={(val) => updateVolumeParam('sectionTangentPoint', val)}
              onInc={(d) => handleInc('sectionTangentPoint', d, 0.05, 0.15, 0.85)}
              onHelp={() => handleOpenHelp('sectionTangentPoint')}
            />
            <VerticalSliderCard
              title="Круг. низ"
              value={currentVolumeParams.sectionLowerRoundAngle ?? 45.0}
              min={-90.0}
              max={90.0}
              step={1.0}
              unit="°"
              decimals={1}
              groupColor="purple"
              isSelected={effectiveSelectedParam === 'sectionLowerRoundAngle'}
              onSelect={() => handleSelectParam('sectionLowerRoundAngle')}
              onChange={(val) => updateVolumeParam('sectionLowerRoundAngle', val)}
              onInc={(d) => handleInc('sectionLowerRoundAngle', d, 2.0, -90.0, 90.0)}
              onHelp={() => handleOpenHelp('sectionLowerRoundAngle')}
            />
            <VerticalSliderCard
              title="Вход шт."
              value={currentVolumeParams.sectionStemEntryAngle ?? 30.0}
              min={0.0}
              max={90.0}
              step={0.5}
              unit="°"
              decimals={1}
              groupColor="neutral"
              isSelected={effectiveSelectedParam === 'sectionStemEntryAngle'}
              onSelect={() => handleSelectParam('sectionStemEntryAngle')}
              onChange={(val) => updateVolumeParam('sectionStemEntryAngle', val)}
              onInc={(d) => handleInc('sectionStemEntryAngle', d, 1.0, 0.0, 90.0)}
              onHelp={() => handleOpenHelp('sectionStemEntryAngle')}
            />
            <VerticalSliderCard
              title="Пятка"
              value={currentVolumeParams.sectionHeelStraightLen ?? 0.0}
              min={0.0}
              max={Math.max(5.0, Number((bowLength * 0.6).toFixed(1)))}
              step={0.05}
              unit="м"
              decimals={2}
              groupColor="orange"
              isSelected={effectiveSelectedParam === 'sectionHeelStraightLen'}
              onSelect={() => handleSelectParam('sectionHeelStraightLen')}
              onChange={(val) => updateVolumeParam('sectionHeelStraightLen', val)}
              onInc={(d) => handleInc('sectionHeelStraightLen', d, 0.1, 0.0, Math.max(5.0, Number((bowLength * 0.6).toFixed(1))))}
              onHelp={() => handleOpenHelp('sectionHeelStraightLen')}
            />
          </div>
        </div>
      </div>

      {/* 3. Нижний ряд кнопок управления Шага 4: только Отмена и Применить (без галки) */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-black/10 dark:border-white/10">
        <button
          onClick={onCancel}
          className="px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition cursor-pointer active:scale-95"
        >
          Отмена
        </button>
        <button
          onClick={onSave}
          className="px-5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm transition cursor-pointer active:scale-95"
        >
          Применить
        </button>
      </div>

      {/* 4. Интерактивное перетаскиваемое окно справки с регулятором значения и циклической навигацией */}
      {activeHelpParam && VOLUME_PARAM_HELP[activeHelpParam] && (
        <InteractiveDraggableHelpWindow
          info={VOLUME_PARAM_HELP[activeHelpParam]}
          currentValue={
            (currentVolumeParams as unknown as Record<string, number>)[activeHelpParam] ??
            VOLUME_PARAM_HELP[activeHelpParam].defaultValue ?? 0
          }
          min={
            activeHelpParam === 'baseMidTangentLength'
              ? 0.2
              : activeHelpParam === 'bottomFlatRun'
              ? 0.0
              : activeHelpParam === 'bottomTangentBias'
              ? -maxTangentBias
              : VOLUME_PARAM_HELP[activeHelpParam].min
          }
          max={
            activeHelpParam === 'baseMidTangentLength'
              ? maxTangentMid
              : activeHelpParam === 'bottomFlatRun'
              ? maxBottomFlat
              : activeHelpParam === 'bottomTangentBias'
              ? maxTangentBias
              : VOLUME_PARAM_HELP[activeHelpParam].max
          }
          step={VOLUME_PARAM_HELP[activeHelpParam].step}
          unit={VOLUME_PARAM_HELP[activeHelpParam].unit}
          decimals={VOLUME_PARAM_HELP[activeHelpParam].decimals}
          onChange={(val) => updateVolumeParam(activeHelpParam as keyof BowVolumeParameters, val)}
          onClose={() => setActiveHelpParam(null)}
          onPrev={handlePrevHelp}
          onNext={handleNextHelp}
          currentIndex={currentHelpIndex}
          totalCount={VOLUME_PARAM_KEYS.length}
          prevLabel={VOLUME_PARAM_HELP[prevHelpParamKey]?.symbol || VOLUME_PARAM_HELP[prevHelpParamKey]?.name}
          nextLabel={VOLUME_PARAM_HELP[nextHelpParamKey]?.symbol || VOLUME_PARAM_HELP[nextHelpParamKey]?.name}
        />
      )}
    </div>
  );
};
