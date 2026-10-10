/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/LeftSidebar.tsx
 * ====================================================================================================
 * 
 * ⚠️ СТРОГОЕ АРХИТЕКТУРНОЕ ПРАВИЛО ПРОЕКТА (LIGHT THEME ONLY):
 * ВЕСЬ ИНТЕРФЕЙС В СВЕТЛЫХ ОТТЕНКАХ! НИКАКИХ ТЕМНЫХ ПЛАШЕК ИЛИ ГОЛУБЫХ ПОЛОС!
 * Выделение активной кнопки выполняется СТРОГО СЕРЫМ ЦВЕТОМ (neutral slate/gray, без голубого).
 * Внутри кнопки НЕТ никакой вертикальной палочки/маркера.
 * 
 * 📐 ГЕОМЕТРИЯ И СШИВКА ОКНА И КНОПОК (DXF СОГЛАСОВАНИЕ):
 * 1. Боковое окно по высоте ВСЕГДА строго равно высоте от верхней грани верхней кнопки
 *    до нижней грани нижней кнопки (вычисляется динамически по bounding box группы).
 * 2. НЕТ РАЗРЫВА между левой панелью кнопок и боковым окном (0px gap, бесшовная стыковка).
 * 3. Кнопки и поле — «мягкие квадраты» (Soft Squares: rounded-2xl), образующие единую фигуру.
 * 4. За один раз активна строго одна кнопка.
 * 5. Окно открывается ПРИ НАВЕДЕНИИ КУРСОРА (onMouseEnter), а не только при клике!
 * 6. На уровне активной кнопки размещается четкое название выбранного раздела.
 * ====================================================================================================
 */

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { ThemeStyle, BrusParams, BowParameters } from './types';
import { TowingTankVisualOptions } from './towingTankEngine';
import { OfficialShipLogo } from './Logo';

export type LeftNavTab =
  | 'none'
  | 'geometry'
  | 'extremities'
  | 'superstructures'
  | 'outfitting'
  | 'simulation'
  | 'export'
  | 'import'
  | 'view'
  | 'settings';

export interface LeftSidebarProps {
  currentActiveTab?: LeftNavTab;
  onSelectTab?: (tab: LeftNavTab) => void;
  // Прямые действия
  onOpenGeometry: () => void;
  onOpenExtremities: () => void;
  onToggleSimulation: () => void;
  isGeometryActive: boolean;
  isExtremitiesActive: boolean;
  isSimulationActive: boolean;
  // Управление видом
  showWireframe: boolean;
  onToggleWireframe: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  showLineLabels: boolean;
  onToggleLineLabels: () => void;
  onSetCameraView: (view: 'iso' | 'profile' | 'bow' | 'top') => void;
  // Настройки
  theme: ThemeStyle;
  onThemeChange: (theme: ThemeStyle) => void;
  params: BrusParams;
  onParamsChange: (partial: Partial<BrusParams>) => void;
  // Носовые параметры
  bowLength?: number;
  onBowLengthChange?: (len: number) => void;
  bowParams?: BowParameters;
  onBowParamsChange?: (partial: Partial<BowParameters>) => void;
  // Параметры симуляции
  tankSpeedKnots?: number;
  onTankSpeedChange?: (speed: number) => void;
  tankVisualOptions?: TowingTankVisualOptions;
  onToggleTankVisualOption?: (key: keyof TowingTankVisualOptions) => void;
  // Справка
  onOpenAbout?: () => void;
}

// ============================================================================
// 🎨 ВЕКТОРНЫЕ CAD-ИКОНКИ (В МОНОХРОМНОМ ИНЖЕНЕРНОМ СТИЛЕ)
// ============================================================================

export const LogoSlotIcon: React.FC<{ size?: number; className?: string }> = ({ size = 26, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <rect x="2" y="2" width="28" height="28" rx="8" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3" opacity="0.6" />
    <path d="M7 21C11 21 15 20.5 18 18C21 15.5 23 11 25 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M7 25C13 25 19 24 23 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    <circle cx="25" cy="7" r="2.2" fill="currentColor" />
  </svg>
);

export const MainGeometryIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M3 6L12 2L21 6V11C21 16 16.5 20.5 12 22C7.5 20.5 3 16 3 11V6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 2V22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.75" />
    <path d="M5.5 10.5C9 12 15 12 18.5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M6 14C8 17.5 10 18.5 12 18.8C14 18.5 16 17.5 18 14" stroke="currentColor" strokeWidth="1.3" opacity="0.6" strokeLinecap="round" />
  </svg>
);

export const ExtremitiesIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M3 4H10C15 4 18.5 6.5 20 10.5C20.8 12.8 20.2 15.2 18 16.5C16.2 17.5 13.5 17.5 12 16.5C10 15 8 13.5 3 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.5 16.5C15.5 18.5 18.5 19 20 17.5C21.2 16.2 21 14 19.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3 20H17" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.6" />
    <path d="M3 9.5H19" stroke="currentColor" strokeWidth="1.3" opacity="0.5" />
  </svg>
);

export const SuperstructuresIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M2 20H22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M4 20V14H20V20" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 14V8H18V14" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M8 11H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 8V3M10 4.5H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const OutfittingIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="8" cy="14" r="5" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="8" cy="14" r="2" fill="currentColor" />
    <path d="M8 9V3L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 7V13C19 14.5 17.5 15.5 16 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3 21H21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M18 18V21M21 18V21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const SimulationIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M12 3L6 11V16L12 18L18 16V11L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M2 13C4 11.5 6 12 7.5 13.5M16.5 13.5C18 12 20 11.5 22 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M1 18C4 16.5 7 17 9 19M15 19C17 17 20 16.5 23 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M12 18V22M10 20.5L12 22.5L14 20.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ExportIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M4 8L12 4L20 8M4 8L12 12M4 8V16L12 20M20 8L12 12M20 8V13M12 12V20" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M16 17L21 17M21 17L18.5 14.5M21 17L18.5 19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ImportIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M4 16L12 20L20 16M4 12L12 16L20 12" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.6" />
    <path d="M12 3V13M12 13L8 9M12 13L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 21H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const ViewIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M12 3V21M4 7.5L20 16.5M20 7.5L4 16.5" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
  </svg>
);

export const SettingsIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// 🧭 ОСНОВНОЙ КОМПОНЕНТ С БЕСШОВНЫМ СОЕДИНЕНИЕМ И ОТКРЫТИЕМ ПО НАВЕДЕНИЮ
// ============================================================================

/**
 * Генератор единого непрерывного SVG-контура для вкладки и активной кнопки
 * Обеспечивает 100% математическую бесшовность, отсутствие разрывов и скругления через радиусы
 * Система координат: (0,0) - верхний левый угол активной кнопки.
 * Кнопка занимает [0 .. Bw] по X, окно занимает [Bw .. Bw + W] по X.
 */
function generateTabContour(
  Bw: number,
  Bh: number,
  W: number,
  H: number,
  y0: number,
  isTop: boolean,
  isBottom: boolean
): string {
  const Rf = 14; // Радиус плавного сопряжения (fillet)
  const Rb = 16; // Радиус скругления внешних углов кнопки
  const Rw = 20; // Радиус правых углов окна
  const Rl = 16; // Радиус левых углов окна
  const y1 = y0 + Bh;

  if (isTop) {
    return [
      `M ${Rb},0`,
      `L ${Bw + W - Rw},0`,
      `A ${Rw},${Rw} 0 0,1 ${Bw + W},${Rw}`,
      `L ${Bw + W},${H - Rw}`,
      `A ${Rw},${Rw} 0 0,1 ${Bw + W - Rw},${H}`,
      `L ${Bw + Rl},${H}`,
      `A ${Rl},${Rl} 0 0,1 ${Bw},${H - Rl}`,
      `L ${Bw},${Bh + Rf}`,
      `A ${Rf},${Rf} 0 0,0 ${Bw - Rf},${Bh}`,
      `L ${Rb},${Bh}`,
      `A ${Rb},${Rb} 0 0,1 0,${Bh - Rb}`,
      `L 0,${Rb}`,
      `A ${Rb},${Rb} 0 0,1 ${Rb},0`,
      'Z',
    ].join(' ');
  }

  if (isBottom) {
    return [
      `M ${Bw + Rl},0`,
      `L ${Bw + W - Rw},0`,
      `A ${Rw},${Rw} 0 0,1 ${Bw + W},${Rw}`,
      `L ${Bw + W},${H - Rw}`,
      `A ${Rw},${Rw} 0 0,1 ${Bw + W - Rw},${H}`,
      `L ${Rb},${H}`,
      `A ${Rb},${Rb} 0 0,1 0,${H - Rb}`,
      `L 0,${y0 + Rb}`,
      `A ${Rb},${Rb} 0 0,1 ${Rb},${y0}`,
      `L ${Bw - Rf},${y0}`,
      `A ${Rf},${Rf} 0 0,0 ${Bw},${y0 - Rf}`,
      `L ${Bw},${Rl}`,
      `A ${Rl},${Rl} 0 0,1 ${Bw + Rl},0`,
      'Z',
    ].join(' ');
  }

  // Промежуточная кнопка (сопряжение сверху и снизу кнопки)
  return [
    `M ${Bw + Rl},0`,
    `L ${Bw + W - Rw},0`,
    `A ${Rw},${Rw} 0 0,1 ${Bw + W},${Rw}`,
    `L ${Bw + W},${H - Rw}`,
    `A ${Rw},${Rw} 0 0,1 ${Bw + W - Rw},${H}`,
    `L ${Bw + Rl},${H}`,
    `A ${Rl},${Rl} 0 0,1 ${Bw},${H - Rl}`,
    `L ${Bw},${y1 + Rf}`,
    `A ${Rf},${Rf} 0 0,0 ${Bw - Rf},${y1}`,
    `L ${Rb},${y1}`,
    `A ${Rb},${Rb} 0 0,1 0,${y1 - Rb}`,
    `L 0,${y0 + Rb}`,
    `A ${Rb},${Rb} 0 0,1 ${Rb},${y0}`,
    `L ${Bw - Rf},${y0}`,
    `A ${Rf},${Rf} 0 0,0 ${Bw},${y0 - Rf}`,
    `L ${Bw},${Rl}`,
    `A ${Rl},${Rl} 0 0,1 ${Bw + Rl},0`,
    'Z',
  ].join(' ');
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  currentActiveTab = 'none',
  onSelectTab,
  onOpenGeometry,
  onOpenExtremities,
  onToggleSimulation,
  isGeometryActive,
  isExtremitiesActive,
  isSimulationActive,
  showWireframe,
  onToggleWireframe,
  showGrid,
  onToggleGrid,
  autoRotate,
  onToggleAutoRotate,
  showLineLabels,
  onToggleLineLabels,
  onSetCameraView,
  theme,
  onThemeChange,
  params,
  onParamsChange,
  bowLength = 25,
  onBowLengthChange,
  bowParams,
  onBowParamsChange,
  tankSpeedKnots = 18.5,
  onTankSpeedChange,
  tankVisualOptions,
  onToggleTankVisualOption,
  onOpenAbout,
}) => {
  // Выбранная при наведении или клике вкладка
  const [hoveredTab, setHoveredTab] = useState<LeftNavTab>('none');
  const [pinnedTab, setPinnedTab] = useState<LeftNavTab>('none');

  // Активная вкладка (pinnedTab имеет приоритет, если зафиксирован кликом)
  const activeTab: LeftNavTab = pinnedTab !== 'none' ? pinnedTab : hoveredTab;

  // Refs элементов для геометрических расчетов высот
  const sidebarRef = useRef<HTMLDivElement>(null);
  const centerGroupRef = useRef<HTMLDivElement>(null);
  const bottomGroupRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<{ [key in LeftNavTab]?: HTMLButtonElement | null }>({});

  // Таймер задержки скрытия при уходе мыши
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Список центральных инструментов
  const centerToolIds: LeftNavTab[] = [
    'geometry',
    'extremities',
    'superstructures',
    'outfitting',
    'simulation',
    'export',
    'import',
  ];

  // Обработчики наведения мыши (HOVER TRIGGER)
  const handleMouseEnterButton = (tab: LeftNavTab) => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setHoveredTab(tab);
    onSelectTab?.(tab);
  };

  const handleMouseLeaveButton = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      if (pinnedTab === 'none') {
        setHoveredTab('none');
        onSelectTab?.('none');
      }
    }, 180);
  };

  const handlePanelMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const handlePanelMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      if (pinnedTab === 'none') {
        setHoveredTab('none');
        onSelectTab?.('none');
      }
    }, 180);
  };

  // Клик по кнопке фиксирует/расфиксирует окно
  const handleButtonClick = (tab: LeftNavTab) => {
    if (pinnedTab === tab) {
      setPinnedTab('none');
      setHoveredTab('none');
      onSelectTab?.('none');
    } else {
      setPinnedTab(tab);
      setHoveredTab(tab);
      onSelectTab?.(tab);
    }
  };

  // Метаданные инструментов
  const centerTools = [
    {
      id: 'geometry' as LeftNavTab,
      label: 'Основная геометрия',
      sublabel: 'Главные размерения и мидель-шпангоут',
      icon: <MainGeometryIcon size={22} />,
    },
    {
      id: 'extremities' as LeftNavTab,
      label: 'Оконечности',
      sublabel: 'Носовой бульб, форштевень и корма',
      icon: <ExtremitiesIcon size={22} />,
    },
    {
      id: 'superstructures' as LeftNavTab,
      label: 'Надстройки',
      sublabel: 'Ярусы рубки и ходовой мостик',
      icon: <SuperstructuresIcon size={22} />,
    },
    {
      id: 'outfitting' as LeftNavTab,
      label: 'Насыщение',
      sublabel: 'Палубные механизмы и дельные вещи',
      icon: <OutfittingIcon size={22} />,
    },
    {
      id: 'simulation' as LeftNavTab,
      label: 'Симуляция',
      sublabel: 'Опытовый бассейн CFD и волны Кельвина',
      icon: <SimulationIcon size={22} />,
    },
    {
      id: 'export' as LeftNavTab,
      label: 'Экспорт',
      sublabel: 'Выгрузка 3D CAD, STL, OBJ, CSV',
      icon: <ExportIcon size={22} />,
    },
    {
      id: 'import' as LeftNavTab,
      label: 'Импорт',
      sublabel: 'Загрузка проекта и плазовых ординат',
      icon: <ImportIcon size={22} />,
    },
  ];

  const bottomTools = [
    {
      id: 'view' as LeftNavTab,
      label: 'Вид',
      sublabel: 'Ракурсы камеры, каркас, сетка пола',
      icon: <ViewIcon size={22} />,
    },
    {
      id: 'settings' as LeftNavTab,
      label: 'Настройки',
      sublabel: 'Темы, параметры среды и единицы',
      icon: <SettingsIcon size={22} />,
    },
  ];

  // Расчет точной геометрии окна и кнопки на основе DOM-элементов
  const computeGeometry = useCallback((tab: LeftNavTab) => {
    if (tab === 'none') return null;

    const isCenterGroup = centerToolIds.includes(tab);
    const topTab: LeftNavTab = isCenterGroup ? 'geometry' : 'view';
    const bottomTab: LeftNavTab = isCenterGroup ? 'import' : 'settings';

    const topEl = buttonRefs.current[topTab];
    const bottomEl = buttonRefs.current[bottomTab];
    const activeEl = buttonRefs.current[tab];

    const centerIdx = centerToolIds.indexOf(tab);
    const bottomIdx = bottomTools.findIndex((t) => t.id === tab);
    const idx = isCenterGroup ? Math.max(0, centerIdx) : Math.max(0, bottomIdx);

    if (topEl && bottomEl && activeEl) {
      const topRect = topEl.getBoundingClientRect();
      const bottomRect = bottomEl.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();

      const pTop = Math.round(topRect.top);
      const pHeight = Math.round(bottomRect.bottom - topRect.top);
      const rTop = Math.round(activeRect.top - topRect.top);

      return {
        panelLeft: Math.round(activeRect.left),
        panelTop: pTop,
        panelHeight: pHeight,
        relBtnTop: rTop,
        btnWidth: Math.round(activeRect.width) || 48,
        btnHeight: Math.round(activeRect.height) || 48,
        isTop: idx === 0,
        isBottom: isCenterGroup ? idx === 6 : idx === 1,
      };
    }

    return {
      panelLeft: 10,
      panelTop: isCenterGroup ? 200 : 600,
      panelHeight: isCenterGroup ? 384 : 104,
      relBtnTop: idx * 56,
      btnWidth: 48,
      btnHeight: 48,
      isTop: idx === 0,
      isBottom: isCenterGroup ? idx === 6 : idx === 1,
    };
  }, [centerToolIds, bottomTools]);

  const [geoState, setGeoState] = useState<{
    panelLeft: number;
    panelTop: number;
    panelHeight: number;
    relBtnTop: number;
    btnWidth: number;
    btnHeight: number;
    isTop: boolean;
    isBottom: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (activeTab === 'none') {
      setGeoState(null);
    } else {
      setGeoState(computeGeometry(activeTab));
    }
  }, [activeTab, computeGeometry]);

  useEffect(() => {
    const handleResize = () => {
      if (activeTab !== 'none') {
        setGeoState(computeGeometry(activeTab));
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTab, computeGeometry]);

  const geo = geoState || (activeTab !== 'none' ? computeGeometry(activeTab) : null);

  const PANEL_WIDTH = 384;
  const currentTool = [...centerTools, ...bottomTools].find((t) => t.id === activeTab);
  const PASTEL_COLOR = '#E6EDF5'; // Нежный пастельный серо-голубой цвет

  const tabContourPath = currentTool && geo
    ? generateTabContour(
        geo.btnWidth,
        geo.btnHeight,
        PANEL_WIDTH,
        geo.panelHeight,
        geo.relBtnTop,
        geo.isTop,
        geo.isBottom
      )
    : '';

  return (
    <>
      {/* ==================================================================== */}
      {/* 🧭 ЛЕВАЯ ВЕРТИКАЛЬНАЯ КОЛОНКА КНОПОК                                */}
      {/* ==================================================================== */}
      <aside
        ref={sidebarRef}
        className="fixed top-0 left-0 bottom-0 z-40 w-[68px] shrink-0 bg-slate-50/95 border-r border-[#A8AEB8]/40 flex flex-col justify-between items-center py-3 select-none shadow-md shadow-slate-900/5 overflow-visible"
        aria-label="Основная панель инструментов судового CAD"
      >
        {/* 1. ВЕРХНИЙ СЛОТ ДЛЯ ЛОГОТИПА (мягкий квадрат без текста) */}
        <div className="flex flex-col items-center shrink-0 w-full px-2">
          <div
            id="sidebar-logo-slot"
            role="button"
            tabIndex={0}
            onClick={() => {
              if (onOpenAbout) onOpenAbout();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (onOpenAbout) onOpenAbout();
              }
            }}
            className="flex items-center justify-center w-12 h-12 rounded-2xl bg-white text-slate-800 shadow-xs transition-colors cursor-pointer active:scale-95 p-1"
            style={{ border: '1.5px solid #A8AEB8' }}
          >
            <OfficialShipLogo size={36} />
          </div>
          <div className="w-8 h-[1px] bg-slate-300 mt-2.5" />
        </div>

        {/* 2. ЦЕНТРАЛЬНАЯ ГРУППА ИЗ 7 КНОПОК */}
        <div
          ref={centerGroupRef}
          className="flex flex-col items-center justify-center gap-2 my-auto w-full px-2.5"
          style={{ height: '384px' }}
        >
          {centerTools.map((tool) => {
            const isSelected = activeTab === tool.id;

            return (
              <div key={tool.id} className="relative w-full flex justify-center">
                <button
                  ref={(el) => {
                    buttonRefs.current[tool.id] = el;
                  }}
                  type="button"
                  onMouseEnter={() => handleMouseEnterButton(tool.id)}
                  onMouseLeave={handleMouseLeaveButton}
                  onClick={() => handleButtonClick(tool.id)}
                  aria-label={tool.label}
                  aria-pressed={isSelected}
                  style={{
                    border: isSelected ? '1.5px solid transparent' : '1.5px solid #A8AEB8',
                  }}
                  className={`relative flex items-center justify-center w-12 h-12 rounded-2xl shadow-xs transition-colors duration-150 cursor-pointer outline-none z-30 ${
                    isSelected
                      ? 'bg-transparent text-slate-800 font-bold'
                      : 'bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <div className="transition-transform duration-150">
                    {tool.icon}
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* 3. НИЖНЯЯ ГРУППА ИЗ 2 СИСТЕМНЫХ КНОПОК (ВИД И НАСТРОЙКИ) */}
        <div
          ref={bottomGroupRef}
          className="flex flex-col items-center gap-2 shrink-0 w-full px-2.5"
          style={{ height: '104px' }}
        >
          <div className="w-8 h-[1px] bg-slate-300 mb-1" />

          {bottomTools.map((tool) => {
            const isSelected = activeTab === tool.id;

            return (
              <div key={tool.id} className="relative w-full flex justify-center">
                <button
                  ref={(el) => {
                    buttonRefs.current[tool.id] = el;
                  }}
                  type="button"
                  onMouseEnter={() => handleMouseEnterButton(tool.id)}
                  onMouseLeave={handleMouseLeaveButton}
                  onClick={() => handleButtonClick(tool.id)}
                  aria-label={tool.label}
                  aria-pressed={isSelected}
                  style={{
                    border: isSelected ? '1.5px solid transparent' : '1.5px solid #A8AEB8',
                  }}
                  className={`relative flex items-center justify-center w-12 h-12 rounded-2xl shadow-xs transition-colors duration-150 cursor-pointer outline-none z-30 ${
                    isSelected
                      ? 'bg-transparent text-slate-800 font-bold'
                      : 'bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <div className="transition-transform duration-150">
                    {tool.icon}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* 📐 БОКОВОЕ ОКНО: БЕЗ РАЗРЫВА, СТРОГО ПО ВЫСОТЕ ГРУППЫ КНОПОК          */}
      {/* ==================================================================== */}
      {activeTab !== 'none' && currentTool && geo && (
        <div
          ref={panelRef}
          role="region"
          aria-label={currentTool.label}
          className="fixed z-50 flex overflow-visible text-slate-800 pointer-events-none select-none"
          style={{
            top: `${geo.panelTop}px`,
            left: `${geo.panelLeft}px`,
            width: `${geo.btnWidth + PANEL_WIDTH}px`,
            height: `${geo.panelHeight}px`,
            filter: 'drop-shadow(0 14px 24px rgba(15, 23, 42, 0.08))',
          }}
        >
          {/* СЛОЙ 1: ЕДИНЫЙ SVG С БЕЛОЙ ПОДЛОЖКОЙ, ПАСТЕЛЬНОЙ ЗАЛИВКОЙ И ОКАНТОВКОЙ */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={geo.btnWidth + PANEL_WIDTH}
            height={geo.panelHeight}
            viewBox={`0 0 ${geo.btnWidth + PANEL_WIDTH} ${geo.panelHeight}`}
            style={{
              overflow: 'visible',
              zIndex: 10,
            }}
          >
            <defs>
              <clipPath id="tab-contour-clip">
                <path d={tabContourPath} />
              </clipPath>
            </defs>

            {/* Базовая белая подложка на всю форму */}
            <path d={tabContourPath} fill="#FFFFFF" stroke="none" />

            {/* Непрерывная пастельная заливка (кнопка + заголовок окна + непрерывный переход) */}
            <g clipPath="url(#tab-contour-clip)">
              {/* Верхний заголовок окна */}
              <rect x={geo.btnWidth - 2} y={-4} width={PANEL_WIDTH + 8} height={52} fill={PASTEL_COLOR} />

              {/* Активная кнопка */}
              <rect x={-4} y={geo.relBtnTop - 2} width={geo.btnWidth + 8} height={geo.btnHeight + 4} fill={PASTEL_COLOR} />

              {/* Непрерывный мостик цвета от верхнего заголовка к кнопке */}
              {!geo.isTop && (
                <rect x={geo.btnWidth - 18} y={0} width={36} height={geo.relBtnTop + geo.btnHeight + 2} fill={PASTEL_COLOR} />
              )}

              {/* Разделительная черта под заголовком окна */}
              <line
                x1={geo.btnWidth}
                y1={48}
                x2={geo.btnWidth + PANEL_WIDTH}
                y2={48}
                stroke="#A8AEB8"
                strokeWidth="1"
                strokeOpacity="0.4"
              />
            </g>

            {/* ЕДИНЫЙ НЕПРЕРЫВНЫЙ КОНТУР-ОКАНТОВКА (толще на 60%: 1.5px * 1.6 = 2.4px, цвет #A8AEB8) */}
            <path
              d={tabContourPath}
              fill="none"
              stroke="#A8AEB8"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>

          {/* КОНТЕЙНЕР СОДЕРЖИМОГО ОКНА (СДВИНУТ НА ШИРИНУ КНОПКИ ВПРАВО) */}
          <div
            className="absolute top-0 bottom-0 right-0 flex flex-col pointer-events-auto select-auto"
            style={{
              left: `${geo.btnWidth}px`,
              width: `${PANEL_WIDTH}px`,
              zIndex: 25,
            }}
            onMouseEnter={handlePanelMouseEnter}
            onMouseLeave={handlePanelMouseLeave}
          >
            {/* СЛОЙ 2: ВЕРХНИЙ ЗАГОЛОВОК ОКНА (ЦВЕТ И РАЗДЕЛИТЕЛЬ ИДУТ ИЗ SVG) */}
            <div className="w-full h-12 flex items-center justify-between shrink-0 px-4">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-lg bg-white/80 text-slate-800 flex items-center justify-center shadow-2xs"
                style={{ border: '1px solid #A8AEB8' }}
              >
                {currentTool.icon}
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 leading-tight">
                  {currentTool.label}
                </h3>
                <p className="text-[10px] text-slate-500 leading-none mt-0.5">
                  {currentTool.sublabel}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPinnedTab(pinnedTab === activeTab ? 'none' : activeTab)}
                className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                  pinnedTab === activeTab
                    ? 'bg-slate-300 text-slate-900 font-bold'
                    : 'bg-white/80 hover:bg-white text-slate-600 hover:text-slate-900'
                }`}
                style={{ border: '1px solid #A8AEB8' }}
              >
                {pinnedTab === activeTab ? '📌' : '📍'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPinnedTab('none');
                  setHoveredTab('none');
                  onSelectTab?.('none');
                }}
                className="w-6 h-6 rounded-lg bg-white/80 hover:bg-white text-slate-500 hover:text-slate-800 flex items-center justify-center text-xs transition-colors cursor-pointer"
                style={{ border: '1px solid #A8AEB8' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* СЛОЙ 4: СКРОЛЛИРУЕМОЕ ТЕЛО ПАРАМЕТРОВ РАЗДЕЛА */}
          <div
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5 text-xs text-slate-700 rounded-br-[20px]"
            style={{ zIndex: 20 }}
          >
            {/* 1. РАЗДЕЛ: ОСНОВНАЯ ГЕОМЕТРИЯ */}
            {activeTab === 'geometry' && (
              <div className="space-y-3 animate-in fade-in duration-100">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Главные размерения (L, B, H, T)
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'length', label: 'Длина (L)', val: params.length, max: 200 },
                    { key: 'width', label: 'Ширина (B)', val: params.width, max: 50 },
                    { key: 'height', label: 'Высота (H)', val: params.height, max: 30 },
                    { key: 'draft', label: 'Осадка (T)', val: params.draft, max: params.height },
                  ].map((item) => (
                    <div key={item.key} className="p-2 rounded-xl bg-white border border-slate-250 space-y-1">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-600 font-medium">{item.label}</span>
                        <span className="font-mono font-bold text-slate-900">{item.val.toFixed(1)}м</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={item.max}
                        step={0.5}
                        value={item.val}
                        onChange={(e) => onParamsChange({ [item.key]: parseFloat(e.target.value) })}
                        className="w-full accent-slate-700 cursor-pointer"
                      />
                    </div>
                  ))}
                </div>

                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block pt-1">
                  Форма мидель-шпангоута
                </span>

                <div className="space-y-1.5">
                  {[
                    { key: 'radius', label: 'Радиус скулы (R)', val: params.radius, max: params.width / 2 },
                    { key: 'flare', label: 'Развал бортов (+)', val: params.flare, max: params.width * 0.4 },
                    { key: 'deadrise', label: 'Килеватость днища', val: params.deadrise, max: params.height * 0.3 },
                    { key: 'deckCamber', label: 'Погибь палубы', val: params.deckCamber, max: 2 },
                  ].map((item) => (
                    <div key={item.key} className="p-2 rounded-xl bg-white border border-slate-250 flex items-center justify-between">
                      <span className="text-slate-600 font-medium text-[11px]">{item.label}</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={item.max}
                          step={0.05}
                          value={item.val}
                          onChange={(e) => onParamsChange({ [item.key]: parseFloat(e.target.value) })}
                          className="w-24 accent-slate-700 cursor-pointer"
                        />
                        <span className="font-mono font-bold text-slate-900 w-10 text-right">
                          {item.val.toFixed(2)}м
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenGeometry();
                    setHoveredTab('none');
                    setPinnedTab('none');
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs transition-colors cursor-pointer text-center"
                >
                  Интерактивный 3D-разрез шпангоута
                </button>
              </div>
            )}

            {/* 2. РАЗДЕЛ: ОКОНЕЧНОСТИ */}
            {activeTab === 'extremities' && (
              <div className="space-y-3 animate-in fade-in duration-100">
                <div className="p-2.5 rounded-xl bg-white border border-slate-250 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-800">Длина носовой части (L_bow)</span>
                    <span className="font-mono font-bold text-slate-900">{bowLength} м</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={Math.min(params.length * 0.45, 80)}
                    step={1}
                    value={bowLength}
                    onChange={(e) => onBowLengthChange?.(parseFloat(e.target.value))}
                    className="w-full accent-slate-700 cursor-pointer"
                  />
                </div>

                {bowParams && (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-white border border-slate-250 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-medium">Угол заострения КВЛ</span>
                        <span className="font-mono font-bold text-slate-900">{bowParams.entranceAngle}°</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={60}
                        step={1}
                        value={bowParams.entranceAngle}
                        onChange={(e) => onBowParamsChange?.({ entranceAngle: parseFloat(e.target.value) })}
                        className="w-full accent-slate-700 cursor-pointer"
                      />
                    </div>

                    <div className="p-2.5 rounded-xl bg-white border border-slate-250 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-600 font-medium">Полнота ватерлинии</span>
                        <span className="font-mono font-bold text-slate-900">{bowParams.shoulderFullness.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={0.9}
                        step={0.02}
                        value={bowParams.shoulderFullness}
                        onChange={(e) => onBowParamsChange?.({ shoulderFullness: parseFloat(e.target.value) })}
                        className="w-full accent-slate-700 cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onOpenExtremities();
                    setHoveredTab('none');
                    setPinnedTab('none');
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs transition-colors cursor-pointer text-center"
                >
                  Пошаговый редактор форштевня и носа
                </button>
              </div>
            )}

            {/* 3. РАЗДЕЛ: НАДСТРОЙКИ */}
            {activeTab === 'superstructures' && (
              <div className="space-y-2.5 animate-in fade-in duration-100">
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Параметрические ярусы рубки судна и ходового мостика.
                </p>
                <div className="space-y-1.5 p-3 rounded-xl bg-white border border-slate-250">
                  <div className="flex justify-between text-slate-800 font-medium py-1">
                    <span>Ходовой мостик с крыльями</span>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-150 px-2 py-0.5 rounded">В плане</span>
                  </div>
                  <div className="flex justify-between text-slate-800 font-medium py-1">
                    <span>Жилая надстройка</span>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-150 px-2 py-0.5 rounded">В плане</span>
                  </div>
                  <div className="flex justify-between text-slate-800 font-medium py-1">
                    <span>Навигационная мачта</span>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-150 px-2 py-0.5 rounded">В плане</span>
                  </div>
                </div>
              </div>
            )}

            {/* 4. РАЗДЕЛ: НАСЫЩЕНИЕ */}
            {activeTab === 'outfitting' && (
              <div className="space-y-2.5 animate-in fade-in duration-100">
                <p className="text-slate-600 text-[11px] leading-relaxed">
                  Палубные механизмы, дельные вещи и оборудование.
                </p>
                <div className="space-y-1.5 p-3 rounded-xl bg-white border border-slate-250">
                  <div className="flex justify-between text-slate-800 font-medium py-1">
                    <span>Швартовные кнехты</span>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-150 px-2 py-0.5 rounded">Готово</span>
                  </div>
                  <div className="flex justify-between text-slate-800 font-medium py-1">
                    <span>Якорный брашпиль</span>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-150 px-2 py-0.5 rounded">Готово</span>
                  </div>
                  <div className="flex justify-between text-slate-800 font-medium py-1">
                    <span>Грузовые люки</span>
                    <span className="text-[10px] font-mono text-slate-600 bg-slate-150 px-2 py-0.5 rounded">Готово</span>
                  </div>
                </div>
              </div>
            )}

            {/* 5. РАЗДЕЛ: СИМУЛЯЦИЯ */}
            {activeTab === 'simulation' && (
              <div className="space-y-3 animate-in fade-in duration-100">
                <div className="p-2.5 rounded-xl bg-white border border-slate-250 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-800">Скорость хода</span>
                    <span className="font-mono font-bold text-slate-900">{tankSpeedKnots.toFixed(1)} уз</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={35}
                    step={0.5}
                    value={tankSpeedKnots}
                    onChange={(e) => onTankSpeedChange?.(parseFloat(e.target.value))}
                    className="w-full accent-slate-700 cursor-pointer"
                  />
                </div>

                {tankVisualOptions && onToggleTankVisualOption && (
                  <div className="space-y-1.5">
                    {[
                      { key: 'showKelvinWake', label: 'Волны Кельвина' },
                      { key: 'showPressureHeatmap', label: 'Тепловая карта давлений' },
                      { key: 'showStreamlines', label: 'Линии тока' },
                      { key: 'showDynamicAttitude', label: 'Динамическая посадка' },
                    ].map((opt) => (
                      <label
                        key={opt.key}
                        className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-250 cursor-pointer"
                      >
                        <span className="text-slate-700 text-[11px] font-medium">{opt.label}</span>
                        <input
                          type="checkbox"
                          checked={tankVisualOptions[opt.key as keyof TowingTankVisualOptions]}
                          onChange={() => onToggleTankVisualOption(opt.key as keyof TowingTankVisualOptions)}
                          className="w-4 h-4 accent-slate-700 cursor-pointer"
                        />
                      </label>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onToggleSimulation();
                    setHoveredTab('none');
                    setPinnedTab('none');
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs transition-colors cursor-pointer text-center"
                >
                  Полноэкранный опытовый бассейн
                </button>
              </div>
            )}

            {/* 6. РАЗДЕЛ: ЭКСПОРТ */}
            {activeTab === 'export' && (
              <div className="space-y-2.5 animate-in fade-in duration-100">
                <button
                  type="button"
                  onClick={() => {
                    const data = { project: '3D Hull CAD', timestamp: new Date().toISOString(), params, bowLength, bowParams };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `hull_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full p-2.5 rounded-xl bg-white hover:bg-slate-200 border border-slate-300 flex items-center justify-between transition-colors cursor-pointer text-left"
                >
                  <div>
                    <span className="font-bold text-slate-900 block text-xs">Параметры проекта (JSON)</span>
                    <span className="text-[10px] text-slate-500">Снимок геометрии бруса</span>
                  </div>
                  <span className="font-mono text-slate-700 font-bold text-[10px] bg-slate-200 px-2 py-0.5 rounded">.JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const csv = [
                      'Параметр,Значение,Единица',
                      `L,${params.length},м`,
                      `B,${params.width},м`,
                      `H,${params.height},м`,
                      `T,${params.draft},м`,
                    ].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `hull_dims_${Date.now()}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full p-2.5 rounded-xl bg-white hover:bg-slate-200 border border-slate-300 flex items-center justify-between transition-colors cursor-pointer text-left"
                >
                  <div>
                    <span className="font-bold text-slate-900 block text-xs">Таблица размерений (CSV)</span>
                    <span className="text-[10px] text-slate-500">Спецификация L, B, H, T</span>
                  </div>
                  <span className="font-mono text-slate-700 font-bold text-[10px] bg-slate-200 px-2 py-0.5 rounded">.CSV</span>
                </button>
              </div>
            )}

            {/* 7. РАЗДЕЛ: ИМПОРТ */}
            {activeTab === 'import' && (
              <div className="space-y-3 animate-in fade-in duration-100">
                <label className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-slate-350 hover:border-slate-500 rounded-2xl cursor-pointer bg-white transition-colors">
                  <ImportIcon size={24} className="text-slate-500 mb-1" />
                  <span className="text-slate-800 font-bold text-xs">Загрузить файл JSON</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        try {
                          const data = JSON.parse(event.target?.result as string);
                          if (data.params) onParamsChange(data.params);
                          if (data.bowLength && onBowLengthChange) onBowLengthChange(data.bowLength);
                          if (data.bowParams && onBowParamsChange) onBowParamsChange(data.bowParams);
                        } catch (err) {
                          console.error(err);
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
            )}

            {/* 8. РАЗДЕЛ: ВИД */}
            {activeTab === 'view' && (
              <div className="space-y-3 animate-in fade-in duration-100">
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'iso', label: '3D Изометрия' },
                    { id: 'profile', label: 'Бок (Профиль)' },
                    { id: 'bow', label: 'Нос (Корпус)' },
                    { id: 'top', label: 'Сверху (План)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSetCameraView(p.id as any)}
                      className="px-2.5 py-2 rounded-xl bg-white hover:bg-slate-200 text-slate-800 text-[11px] font-bold border border-slate-300 text-left transition-colors cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5 pt-1">
                  {[
                    { label: 'Каркас (Wireframe)', checked: showWireframe, fn: onToggleWireframe },
                    { label: 'Сетка пола', checked: showGrid, fn: onToggleGrid },
                    { label: 'Подписи линий', checked: showLineLabels, fn: onToggleLineLabels },
                    { label: 'Автовращение', checked: autoRotate, fn: onToggleAutoRotate },
                  ].map((t, idx) => (
                    <label key={idx} className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-250 cursor-pointer">
                      <span className="text-slate-700 text-[11px] font-medium">{t.label}</span>
                      <input type="checkbox" checked={t.checked} onChange={t.fn} className="w-4 h-4 accent-slate-700 cursor-pointer" />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 9. РАЗДЕЛ: НАСТРОЙКИ */}
            {activeTab === 'settings' && (
              <div className="space-y-3 animate-in fade-in duration-100">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Тема оформления
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'minimalism', label: 'Минимум' },
                      { id: 'scandinavian', label: 'Сканди' },
                      { id: 'industrial', label: 'Индастриал' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onThemeChange(t.id)}
                      className={`py-1.5 px-1 text-center rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        theme === t.id
                          ? 'bg-slate-300 text-slate-900 border-slate-400'
                          : 'bg-white hover:bg-slate-150 text-slate-600 border-slate-250'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block pt-1">
                  Шаг сетки пола
                </span>
                <div className="grid grid-cols-4 gap-1">
                  {[0.5, 1, 2, 5].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onParamsChange({ gridSize: g })}
                      className={`py-1.5 text-center rounded-xl text-xs font-mono font-bold border cursor-pointer ${
                        params.gridSize === g
                          ? 'bg-slate-300 text-slate-900 border-slate-400'
                          : 'bg-white hover:bg-slate-150 text-slate-600 border-slate-250'
                      }`}
                    >
                      {g}м
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onParamsChange({ radius: 0, flare: 0, deadrise: 0, deckCamber: 0, sheerRadius: 0 });
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 border border-slate-350 text-slate-800 text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Сбросить погибь, скулу и развал
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
};
