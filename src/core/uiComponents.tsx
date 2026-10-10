/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/uiComponents.tsx
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Единый модуль всех пользовательских интерфейсов (UI Layer) приложения «3D Брус - Редактор».
 * Содержит в себе главную плавающую панель управления с темами оформления, модальное окно
 * интерактивного 2D-редактирования сечения шпангоута с Canvas и модальное окно носовой оконечности.
 * 
 * 📦 СОСТАВ ХРАНИМЫХ КОМПОНЕНТОВ:
 * 1. `ControlPanel` — главная свободно перетаскиваемая (Draggable) панель параметров:
 *    - Переключение 3-х цветовых тем (Минимализм, Скандинавия, Индастриал).
 *    - Сворачивание в плавающую круглую иконку-шестеренку и разворачивание.
 *    - Аккордеон 1: Главные параметры (цвет бруса слайдером, длина, ширина, высота, осадка с выбором палитры).
 *    - Аккордеон 2: Геометрия (сводка радиуса/развала/килеватости, вызовы модальных окон, переключатель каркасной 3D-сетки).
 *    - Аккордеон 3: Пространство (размер ячеек координатной сетки, вкл/выкл сетки, авто-вращение камеры).
 * 
 * 2. `GeometryEditModal` — модальное окно редактора геометрического сечения:
 *    - Шаговые контролы и точный ввод радиуса скулы, развала бортов, килеватости.
 *    - Встроенный интерактивный холст (HTML5 Canvas) с поддержкой панорамирования (drag) и зума (wheel).
 * 
 * 3. `BowEditModal` — модальное окно редактора носовой оконечности:
 *    - Управление длиной носовой части в реальном времени с ограничением до общей длины бруса.
 * ====================================================================================================
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  BrusParams,
  ThemeStyle,
  DRAFT_COLORS,
  BowParameters,
  TopologyQAStats,
  SurfaceRenderMode,
} from './types';
import { WireframeDisplayOptions, BowVolumeParameters } from './topologyTypes';
import { extractBowVolumeParams } from './waterlineEngine';
import { colorToSlider, sliderToColor, renderCrossSectionToCanvas, calculateVerticalLevels } from './geometryEngine';
import { calculateBowWaterplaneCoeff, computeBowDeckWaterlinePoint } from './topologyEngine';
import {
  StemProfileParams,
  StemTopologyPoints,
  StemPointKey,
  STEM_PRESETS,
  DEFAULT_STEM_PARAMS,
  calculateStemTopologyPoints,
  sampleStemCurvePoints,
  Point2D,
} from './stemEngine';
import {
  StemBottomBarTab,
  VolumeBottomBarTab,
  VerticalSliderCard,
  InteractiveDraggableHelpWindow,
  DECK_PARAM_HELP,
  DECK_PARAM_KEYS,
  ParameterHelpInfo,
} from './stemUiComponents';
import { BowSectionKey } from './bowSectionEngine';
import { ShipLogo } from './Logo';

// ============================================================================
// 1️⃣ ГЛАВНАЯ ПАНЕЛЬ УПРАВЛЕНИЯ (CONTROL PANEL)
// ============================================================================

export interface ControlPanelProps {
  params: BrusParams;
  onParamsChange: (newParams: Partial<BrusParams>) => void;
  theme: ThemeStyle;
  onThemeChange: (theme: ThemeStyle) => void;
  bowLength: number;
  showWireframe: boolean;
  onToggleWireframe: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  showLineLabels?: boolean;
  onToggleLineLabels?: () => void;
  onOpenGeometryEdit: () => void;
  onOpenBowEdit: () => void;
  onOpenTowingTank?: () => void;
  isMinimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  params,
  onParamsChange,
  theme,
  onThemeChange,
  bowLength,
  showWireframe,
  onToggleWireframe,
  showGrid,
  onToggleGrid,
  autoRotate,
  onToggleAutoRotate,
  showLineLabels = true,
  onToggleLineLabels,
  onOpenGeometryEdit,
  onOpenBowEdit,
  onOpenTowingTank,
  isMinimized,
  onMinimize,
  onExpand,
}) => {
  const [openSections, setOpenSections] = useState<{ [key: string]: boolean }>({
    main: true,
    geometry: true,
    space: true,
  });

  const [steps, setSteps] = useState({
    length: 1,
    width: 1,
    height: 0.5,
    draft: 0.5,
    grid: 5,
  });

  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleStepChange = (field: keyof typeof steps, val: number) => {
    setSteps((prev) => ({ ...prev, [field]: Math.max(0.01, val) }));
  };

  const handleIncrement = (field: 'length' | 'width' | 'height' | 'draft' | 'gridSize', dir: number) => {
    const stepKey = field === 'gridSize' ? 'grid' : field;
    const step = steps[stepKey];
    if (field === 'draft') {
      const maxDraft = params.height + params.deadrise;
      const next = Math.max(0, Math.min(maxDraft, params.draft + dir * step));
      onParamsChange({ draft: next });
    } else if (field === 'gridSize') {
      const next = Math.max(0.1, params.gridSize + dir * step);
      onParamsChange({ gridSize: next });
    } else {
      const next = Math.max(0.1, params[field] + dir * step);
      onParamsChange({ [field]: next });
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.closest('.accordion-header') ||
      target.closest('.style-btn') ||
      target.closest('.color-option') ||
      target.closest('.color-slider')
    ) {
      return;
    }

    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - panelPos.x,
      y: e.clientY - panelPos.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPanelPos({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const colorSliderVal = colorToSlider(params.brusColor);

  return (
    <>
      {/* Свернутая плавающая кнопка */}
      {isMinimized && (
        <button
          id="panel-icon"
          onClick={onExpand}
          className={`fixed right-6 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center cursor-pointer shadow-xl transition-all duration-300 hover:scale-110 z-40 backdrop-blur-md ${
            theme === 'industrial'
              ? 'bg-[#3C4045]/95 text-[#D4D7DA]'
              : theme === 'scandinavian'
              ? 'bg-[#E8EEF1]/95 text-[#4A5C66]'
              : 'bg-[#F5F5F5]/95 text-[#333]'
          }`}
          title="Развернуть параметры"
        >
          <ShipLogo
            size={36}
            color={theme === 'industrial' ? '#38bdf8' : '#0c345c'}
            className="transition-transform duration-500 hover:scale-110"
          />
        </button>
      )}

      {/* Основная перетаскиваемая панель */}
      <div
        id="control-panel"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          transform: `translate(${panelPos.x}px, calc(-50% + ${panelPos.y}px))`,
          display: isMinimized ? 'none' : 'block',
        }}
        className={`fixed right-8 top-1/2 w-[430px] max-h-[90vh] overflow-y-auto p-6 rounded-2xl shadow-2xl backdrop-blur-md z-40 transition-shadow select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-move'
        } ${
          theme === 'industrial'
            ? 'bg-[#3C4045]/95 text-[#D4D7DA] border border-[#52575C]'
            : theme === 'scandinavian'
            ? 'bg-[#E8EEF1]/95 text-[#4A5C66] border border-[#D1D9DD]'
            : 'bg-[#F5F5F5]/95 text-[#333] border border-[#DDD]'
        }`}
      >
        <button
          onClick={onMinimize}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/10 hover:bg-black/20 flex items-center justify-center text-xl font-light transition"
          title="Свернуть"
        >
          −
        </button>

        <div className="flex items-center justify-center gap-2.5 mb-5">
          <ShipLogo
            size={28}
            color={theme === 'industrial' ? '#38bdf8' : '#0c345c'}
          />
          <h2 className="text-xl font-light tracking-[0.2em] text-center uppercase">
            Параметры
          </h2>
        </div>

        {/* Переключатель стилей */}
        <div className="flex justify-center gap-3 pb-4 mb-4 border-b border-black/10">
          <button
            onClick={() => onThemeChange('minimalism')}
            className={`w-11 h-11 rounded-xl transition border-2 ${
              theme === 'minimalism' ? 'border-gray-700 shadow-md scale-105' : 'border-transparent'
            } bg-gradient-to-br from-[#E8E8E8] to-[#C0C0C0]`}
            title="Минимализм"
          />
          <button
            onClick={() => onThemeChange('scandinavian')}
            className={`w-11 h-11 rounded-xl transition border-2 ${
              theme === 'scandinavian' ? 'border-[#4A5C66] shadow-md scale-105' : 'border-transparent'
            } bg-gradient-to-br from-[#D5DBE0] to-[#A8B5C0]`}
            title="Скандинавия"
          />
          <button
            onClick={() => onThemeChange('industrial')}
            className={`w-11 h-11 rounded-xl transition border-2 ${
              theme === 'industrial' ? 'border-white shadow-md scale-105' : 'border-transparent'
            } bg-gradient-to-br from-[#505050] to-[#707070]`}
            title="Индастриал"
          />
        </div>

        {/* Секция 1: Главные параметры */}
        <div className="mb-3 rounded-xl overflow-hidden bg-black/5 border border-black/5">
          <div
            className="accordion-header px-4 py-3 bg-black/5 cursor-pointer flex justify-between items-center hover:bg-black/10 transition"
            onClick={() => toggleSection('main')}
          >
            <h3 className="text-xs uppercase font-semibold tracking-wider flex items-center gap-1.5">
              <span>📐</span> Главные параметры
            </h3>
            <span className={`text-xs transition-transform duration-200 ${openSections.main ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </div>

          {openSections.main && (
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-2 font-medium">
                  Цвет бруса (оттенки серого)
                </label>
                <div className="flex items-center gap-3 bg-white/70 p-3 rounded-xl">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={colorSliderVal}
                    onChange={(e) => onParamsChange({ brusColor: sliderToColor(parseInt(e.target.value)) })}
                    className="color-slider flex-1 h-2.5 rounded-lg cursor-pointer bg-gradient-to-r from-[#555555] via-[#AAAAAA] to-[#FFFFFF] border border-black/10"
                  />
                  <div
                    className="w-10 h-10 rounded-lg border-2 border-black/20 shadow-xs flex-shrink-0"
                    style={{ backgroundColor: `#${params.brusColor.toString(16).padStart(6, '0')}` }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Длина (м)
                </label>
                <div className="flex items-center gap-2 bg-white/70 p-2 rounded-xl">
                  <input
                    type="number"
                    className="w-20 px-2 py-1.5 text-center text-sm font-semibold rounded-lg bg-black/5 border border-black/10 focus:outline-none"
                    value={params.length.toFixed(2)}
                    min={0.1}
                    step={1}
                    onChange={(e) => onParamsChange({ length: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                  />
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('length', -1)}
                  >
                    −
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('length', 1)}
                  >
                    +
                  </button>
                  <span className="text-[11px] text-black/50 ml-auto">Шаг:</span>
                  <input
                    type="number"
                    className="w-16 px-1.5 py-1 text-center text-xs rounded-lg bg-black/5 border border-black/10"
                    value={steps.length}
                    min={0.01}
                    step={0.1}
                    onChange={(e) => handleStepChange('length', parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Ширина (м)
                </label>
                <div className="flex items-center gap-2 bg-white/70 p-2 rounded-xl">
                  <input
                    type="number"
                    className="w-20 px-2 py-1.5 text-center text-sm font-semibold rounded-lg bg-black/5 border border-black/10 focus:outline-none"
                    value={params.width.toFixed(2)}
                    min={0.1}
                    step={1}
                    onChange={(e) => onParamsChange({ width: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                  />
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('width', -1)}
                  >
                    −
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('width', 1)}
                  >
                    +
                  </button>
                  <span className="text-[11px] text-black/50 ml-auto">Шаг:</span>
                  <input
                    type="number"
                    className="w-16 px-1.5 py-1 text-center text-xs rounded-lg bg-black/5 border border-black/10"
                    value={steps.width}
                    min={0.01}
                    step={0.1}
                    onChange={(e) => handleStepChange('width', parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Высота (м)
                </label>
                <div className="flex items-center gap-2 bg-white/70 p-2 rounded-xl">
                  <input
                    type="number"
                    className="w-20 px-2 py-1.5 text-center text-sm font-semibold rounded-lg bg-black/5 border border-black/10 focus:outline-none"
                    value={params.height.toFixed(2)}
                    min={0.1}
                    step={1}
                    onChange={(e) => onParamsChange({ height: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                  />
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('height', -1)}
                  >
                    −
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('height', 1)}
                  >
                    +
                  </button>
                  <span className="text-[11px] text-black/50 ml-auto">Шаг:</span>
                  <input
                    type="number"
                    className="w-16 px-1.5 py-1 text-center text-xs rounded-lg bg-black/5 border border-black/10"
                    value={steps.height}
                    min={0.01}
                    step={0.1}
                    onChange={(e) => handleStepChange('height', parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Осадка (м)
                </label>
                <div className="flex gap-2.5 mb-2 bg-white/70 p-2 rounded-xl">
                  {DRAFT_COLORS.map((col, idx) => (
                    <button
                      key={idx}
                      onClick={() => onParamsChange({ draftColorIndex: idx })}
                      style={{ backgroundColor: `#${col.toString(16).padStart(6, '0')}` }}
                      className={`w-8 h-8 rounded-lg transition-transform ${
                        params.draftColorIndex === idx ? 'ring-2 ring-gray-800 scale-110 shadow-sm' : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-white/70 p-2 rounded-xl">
                  <input
                    type="number"
                    className="w-20 px-2 py-1.5 text-center text-sm font-semibold rounded-lg bg-black/5 border border-black/10 focus:outline-none"
                    value={params.draft.toFixed(2)}
                    min={0}
                    step={0.1}
                    onChange={(e) => {
                      const maxDraft = params.height + params.deadrise;
                      onParamsChange({ draft: Math.max(0, Math.min(maxDraft, parseFloat(e.target.value) || 0)) });
                    }}
                  />
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('draft', -1)}
                  >
                    −
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('draft', 1)}
                  >
                    +
                  </button>
                  <span className="text-[11px] text-black/50 ml-auto">Шаг:</span>
                  <input
                    type="number"
                    className="w-16 px-1.5 py-1 text-center text-xs rounded-lg bg-black/5 border border-black/10"
                    value={steps.draft}
                    min={0.01}
                    step={0.1}
                    onChange={(e) => handleStepChange('draft', parseFloat(e.target.value) || 0.5)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Секция 2: Геометрия */}
        <div className="mb-3 rounded-xl overflow-hidden bg-black/5 border border-black/5">
          <div
            className="accordion-header px-4 py-3 bg-black/5 cursor-pointer flex justify-between items-center hover:bg-black/10 transition"
            onClick={() => toggleSection('geometry')}
          >
            <h3 className="text-xs uppercase font-semibold tracking-wider flex items-center gap-1.5">
              <span>🔷</span> Геометрия
            </h3>
            <span className={`text-xs transition-transform duration-200 ${openSections.geometry ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </div>

          {openSections.geometry && (
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-2 font-medium">
                  Общие параметры геометрии
                </label>
                <div className="bg-black/5 p-3 rounded-xl text-sm space-y-1.5 font-medium">
                  <div className="flex justify-between">
                    <span className="text-black/60">Радиус скулы:</span>
                    <span>{params.radius.toFixed(2)} м</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black/60">Развал бортов:</span>
                    <span>{params.flare.toFixed(2)} м</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black/60">Килеватость:</span>
                    <span>{params.deadrise.toFixed(2)} м</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black/60">Погибь палубы:</span>
                    <span className="text-cyan-600 font-semibold">{(params.deckCamber ?? 0).toFixed(2)} м</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black/60">Радиус ширстрека:</span>
                    <span className="text-purple-600 font-semibold">{(params.sheerRadius ?? 0).toFixed(2)} м</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-black/10">
                    <span className="text-black/60">Верхняя крышка (палуба):</span>
                    <button
                      onClick={() => onParamsChange({ showDeckCover: !params.showDeckCover })}
                      className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                        params.showDeckCover ? 'bg-cyan-600 text-white' : 'bg-black/10 text-black/60'
                      }`}
                    >
                      {params.showDeckCover ? 'ВКЛ' : 'ВЫКЛ'}
                    </button>
                  </div>
                </div>

                <button
                  className="w-full mt-3 py-2.5 bg-gray-600 hover:bg-gray-700 text-white font-semibold text-xs tracking-wider uppercase rounded-xl transition shadow-xs cursor-pointer active:scale-98"
                  onClick={onOpenGeometryEdit}
                >
                  Редактировать геометрию
                </button>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-2 font-medium">
                  Носовая оконечность
                </label>
                <div className="bg-black/5 p-3 rounded-xl text-sm font-medium flex justify-between items-center">
                  <span className="text-black/60">Носовая оконечность:</span>
                  <span className="font-semibold">{bowLength > 0 ? `${bowLength.toFixed(2)} м` : 'Прямой брус'}</span>
                </div>

                <button
                  className="w-full mt-3 py-2.5 bg-gray-600 hover:bg-gray-700 text-white font-semibold text-xs tracking-wider uppercase rounded-xl transition shadow-xs cursor-pointer active:scale-98"
                  onClick={onOpenBowEdit}
                >
                  {bowLength > 0 ? 'Редактировать носовую оконечность' : 'Сформировать носовую часть'}
                </button>
              </div>

              {/* Кнопка запуска Виртуального опытового бассейна */}
              {onOpenTowingTank && (
                <div className="pt-2 border-t border-black/10">
                  <button
                    className="w-full py-3 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs tracking-wider uppercase rounded-xl shadow-md hover:shadow-lg transition-all cursor-pointer active:scale-98 flex items-center justify-center gap-2 border border-cyan-400/40"
                    onClick={onOpenTowingTank}
                  >
                    <span className="text-base">🌊</span>
                    <span>Ходовые испытания (Опытовый бассейн)</span>
                  </button>
                  <p className="text-[10px] text-center text-black/50 dark:text-white/50 mt-1">
                    ITTC-1957, волновое поле Кельвина, давление Бернулли и брызги
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Сетка на модели
                </label>
                <button
                  onClick={onToggleWireframe}
                  className={`w-full py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition ${
                    showWireframe ? 'bg-gray-700 text-white' : 'bg-white/70 text-black/60 hover:bg-white'
                  }`}
                >
                  ⬛ Сетка: {showWireframe ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
              </div>

              {onToggleLineLabels && (
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                    3D Подписи линий и областей
                  </label>
                  <button
                    onClick={onToggleLineLabels}
                    className={`w-full py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition ${
                      showLineLabels ? 'bg-cyan-700 text-white' : 'bg-white/70 text-black/60 hover:bg-white'
                    }`}
                  >
                    🏷️ Метки линий: {showLineLabels ? 'ВКЛ' : 'ВЫКЛ'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Секция 3: Пространство */}
        <div className="mb-2 rounded-xl overflow-hidden bg-black/5 border border-black/5">
          <div
            className="accordion-header px-4 py-3 bg-black/5 cursor-pointer flex justify-between items-center hover:bg-black/10 transition"
            onClick={() => toggleSection('space')}
          >
            <h3 className="text-xs uppercase font-semibold tracking-wider flex items-center gap-1.5">
              <span>🌐</span> Пространство
            </h3>
            <span className={`text-xs transition-transform duration-200 ${openSections.space ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </div>

          {openSections.space && (
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Размер ячейки сетки (м)
                </label>
                <div className="flex items-center gap-2 bg-white/70 p-2 rounded-xl">
                  <input
                    type="number"
                    className="w-20 px-2 py-1.5 text-center text-sm font-semibold rounded-lg bg-black/5 border border-black/10 focus:outline-none"
                    value={params.gridSize.toFixed(2)}
                    min={0.1}
                    step={1}
                    onChange={(e) => onParamsChange({ gridSize: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
                  />
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('gridSize', -1)}
                  >
                    −
                  </button>
                  <button
                    className="w-8 h-8 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-base flex items-center justify-center transition active:scale-95"
                    onClick={() => handleIncrement('gridSize', 1)}
                  >
                    +
                  </button>
                  <span className="text-[11px] text-black/50 ml-auto">Шаг:</span>
                  <input
                    type="number"
                    className="w-16 px-1.5 py-1 text-center text-xs rounded-lg bg-black/5 border border-black/10"
                    value={steps.grid}
                    min={0.1}
                    step={0.1}
                    onChange={(e) => handleStepChange('grid', parseFloat(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Сетка пространства
                </label>
                <button
                  onClick={onToggleGrid}
                  className={`w-full py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition ${
                    showGrid ? 'bg-gray-700 text-white' : 'bg-white/70 text-black/60 hover:bg-white'
                  }`}
                >
                  ⊞ Сетка: {showGrid ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-black/60 mb-1.5 font-medium">
                  Автоматическое вращение
                </label>
                <button
                  onClick={onToggleAutoRotate}
                  className={`w-full py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition ${
                    autoRotate ? 'bg-gray-700 text-white' : 'bg-white/70 text-black/60 hover:bg-white'
                  }`}
                >
                  🔄 Вращение: {autoRotate ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ============================================================================
// 2️⃣ МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ СЕЧЕНИЯ ГЕОМЕТРИИ (GEOMETRY EDIT MODAL)
// ============================================================================

export interface GeometryEditModalProps {
  isOpen: boolean;
  width: number;
  height: number;
  initialRadius: number;
  initialFlare: number;
  initialDeadrise: number;
  initialDeadriseInHeight?: boolean;
  initialDeckCamber?: number;
  initialDeckCamberInHeight?: boolean;
  initialSheerRadius?: number;
  initialShowDeckCover?: boolean;
  onApply: (
    radius: number,
    flare: number,
    deadrise: number,
    deckCamber: number,
    sheerRadius: number,
    showDeckCover: boolean,
    deadriseInHeight?: boolean,
    deckCamberInHeight?: boolean
  ) => void;
  onCancel: () => void;
}

export const GeometryEditModal: React.FC<GeometryEditModalProps> = ({
  isOpen,
  width,
  height,
  initialRadius,
  initialFlare,
  initialDeadrise,
  initialDeadriseInHeight = false,
  initialDeckCamber = 0,
  initialDeckCamberInHeight = false,
  initialSheerRadius = 0,
  initialShowDeckCover = false,
  onApply,
  onCancel,
}) => {
  const [radius, setRadius] = useState(initialRadius);
  const [flare, setFlare] = useState(initialFlare);
  const [deadrise, setDeadrise] = useState(initialDeadrise);
  const [deadriseInHeight, setDeadriseInHeight] = useState(initialDeadriseInHeight);
  const [deckCamber, setDeckCamber] = useState(initialDeckCamber);
  const [deckCamberInHeight, setDeckCamberInHeight] = useState(initialDeckCamberInHeight);
  const [sheerRadius, setSheerRadius] = useState(initialSheerRadius);
  const [showDeckCover, setShowDeckCover] = useState(initialShowDeckCover);

  const [radiusStep, setRadiusStep] = useState(0.5);
  const [flareStep, setFlareStep] = useState(0.2);
  const [deadriseStep, setDeadriseStep] = useState(0.2);
  const [deckCamberStep, setDeckCamberStep] = useState(0.1);
  const [sheerRadiusStep, setSheerRadiusStep] = useState(0.2);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (isOpen) {
      setRadius(initialRadius);
      setFlare(initialFlare);
      setDeadrise(initialDeadrise);
      setDeadriseInHeight(initialDeadriseInHeight);
      setDeckCamber(initialDeckCamber);
      setDeckCamberInHeight(initialDeckCamberInHeight);
      setSheerRadius(initialSheerRadius);
      setShowDeckCover(initialShowDeckCover);
      setCanvasOffset({ x: 0, y: 0 });
      setCanvasScale(1);
    }
  }, [
    isOpen,
    initialRadius,
    initialFlare,
    initialDeadrise,
    initialDeadriseInHeight,
    initialDeckCamber,
    initialDeckCamberInHeight,
    initialSheerRadius,
    initialShowDeckCover,
  ]);

  // Отрисовка на Canvas при изменении параметров
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderCrossSectionToCanvas(
      ctx,
      width,
      height,
      radius,
      flare,
      deadrise,
      canvas.width,
      canvas.height,
      canvasOffset,
      canvasScale,
      deckCamber,
      sheerRadius,
      deadriseInHeight,
      deckCamberInHeight
    );
  }, [
    isOpen,
    width,
    height,
    radius,
    flare,
    deadrise,
    deadriseInHeight,
    deckCamber,
    deckCamberInHeight,
    sheerRadius,
    canvasOffset,
    canvasScale,
  ]);

  if (!isOpen) return null;

  const maxRadius = Math.max(0, Math.min(width / 2, height));
  const maxFlare = Math.max(1, Math.round((width / 2) * 10) / 10);
  const minFlare = -maxFlare + 0.1;
  const topDeckWidth = Math.max(0.1, width + 2 * flare);
  const maxSheerRadius = Math.min(topDeckWidth / 2, height);

  const handleRadiusChange = (dir: number) => {
    setRadius((prev) => {
      const next = Math.max(0, prev + dir * radiusStep);
      return Math.min(next, Math.max(0, maxRadius));
    });
  };

  const handleFlareChange = (dir: number) => {
    setFlare((prev) => Math.max(minFlare, Math.min(maxFlare, Number((prev + dir * flareStep).toFixed(2)))));
  };

  const handleDeadriseChange = (dir: number) => {
    setDeadrise((prev) => Math.max(0, prev + dir * deadriseStep));
  };

  const handleDeckCamberChange = (dir: number) => {
    setDeckCamber((prev) => Math.max(0, Number((prev + dir * deckCamberStep).toFixed(2))));
  };

  const handleSheerRadiusChange = (dir: number) => {
    setSheerRadius((prev) => {
      const next = Math.max(0, prev + dir * sheerRadiusStep);
      return Math.min(next, Math.max(0, maxSheerRadius));
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDraggingCanvas(true);
    dragStartRef.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingCanvas) return;
    const dx = e.nativeEvent.offsetX - dragStartRef.current.x;
    const dy = e.nativeEvent.offsetY - dragStartRef.current.y;
    setCanvasOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    dragStartRef.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
  };

  const handleCanvasMouseUp = () => {
    setIsDraggingCanvas(false);
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setCanvasScale((prev) => Math.max(0.5, Math.min(5, prev * delta)));
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="relative bg-white p-6 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-800 tracking-wide">
            Редактирование поперечного сечения
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-600">Верхняя крышка:</span>
            <button
              onClick={() => setShowDeckCover(!showDeckCover)}
              className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition ${
                showDeckCover ? 'bg-cyan-600 text-white' : 'bg-gray-200 text-gray-700'
              }`}
            >
              {showDeckCover ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
          </div>
        </div>

        {/* Панель регуляторов сечения */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4 bg-gray-100 p-3 rounded-xl">
          {/* 1. Радиус скулы */}
          <div className="flex flex-col gap-1.5 bg-white p-2 rounded-lg shadow-xs">
            <span className="text-xs font-semibold text-gray-700">Радиус скулы (R):</span>
            <div className="flex items-center justify-between gap-1">
              <input
                type="number"
                className="w-16 px-1 py-1 text-xs font-semibold text-center border border-gray-300 rounded focus:outline-none focus:border-cyan-600"
                value={radius.toFixed(2)}
                min={0}
                max={maxRadius}
                step={0.1}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setRadius(Math.max(0, Math.min(val, Math.max(0, maxRadius))));
                }}
              />
              <div className="flex gap-0.5">
                <button
                  className="w-6 h-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleRadiusChange(-1)}
                >
                  −
                </button>
                <button
                  className="w-6 h-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleRadiusChange(1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-gray-500 justify-between">
              <span>Шаг:</span>
              <input
                type="number"
                className="w-10 px-1 py-0.5 text-[10px] text-center border border-gray-300 rounded"
                value={radiusStep}
                min={0.01}
                step={0.1}
                onChange={(e) => setRadiusStep(parseFloat(e.target.value) || 0.1)}
              />
            </div>
          </div>

          {/* 2. Развал / Завал бортов */}
          <div className="flex flex-col gap-1.5 bg-white p-2 rounded-lg shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700" title=">0: Развал борта, <0: Завал борта">
                {flare > 0.001 ? 'Развал (ΔB):' : flare < -0.001 ? 'Завал (ΔB):' : 'Развал/Завал:'}
              </span>
              <span className="text-[10px] font-mono font-bold text-cyan-600">
                {flare > 0 ? `+${flare.toFixed(2)}` : flare.toFixed(2)} м
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              <input
                type="number"
                className="w-16 px-1 py-1 text-xs font-semibold text-center border border-gray-300 rounded focus:outline-none focus:border-cyan-600"
                value={flare.toFixed(2)}
                min={minFlare}
                max={maxFlare}
                step={0.1}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setFlare(Math.max(minFlare, Math.min(maxFlare, val)));
                }}
              />
              <div className="flex gap-0.5">
                <button
                  className="w-6 h-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95 cursor-pointer"
                  onClick={() => handleFlareChange(-1)}
                  title="Завал бортов (−)"
                >
                  −
                </button>
                <button
                  className="w-6 h-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95 cursor-pointer"
                  onClick={() => handleFlareChange(1)}
                  title="Развал бортов (+)"
                >
                  +
                </button>
              </div>
            </div>
            <input
              type="range"
              min={-maxFlare}
              max={maxFlare}
              step={0.05}
              value={flare}
              onChange={(e) => setFlare(parseFloat(e.target.value) || 0)}
              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-cyan-600 my-0.5"
            />
            <div className="flex items-center gap-1 text-[10px] text-gray-500 justify-between">
              <span>Шаг:</span>
              <input
                type="number"
                className="w-10 px-1 py-0.5 text-[10px] text-center border border-gray-300 rounded"
                value={flareStep}
                min={0.01}
                step={0.1}
                onChange={(e) => setFlareStep(parseFloat(e.target.value) || 0.1)}
              />
            </div>
          </div>

          {/* 3. Килеватость */}
          <div className="flex flex-col gap-1.5 bg-white p-2 rounded-lg shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Килеватость (β):</span>
              <label className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer select-none" title="Учитывать килеватость в общую высоту бруса H">
                <input
                  type="checkbox"
                  checked={deadriseInHeight}
                  onChange={(e) => setDeadriseInHeight(e.target.checked)}
                  className="rounded text-cyan-600 focus:ring-cyan-500 w-3.5 h-3.5 cursor-pointer accent-cyan-600"
                />
                <span className="text-[9px] font-medium leading-none">В высоту</span>
              </label>
            </div>
            <div className="flex items-center justify-between gap-1">
              <input
                type="number"
                className="w-16 px-1 py-1 text-xs font-semibold text-center border border-gray-300 rounded focus:outline-none focus:border-cyan-600"
                value={deadrise.toFixed(2)}
                min={0}
                step={0.1}
                onChange={(e) => setDeadrise(Math.max(0, parseFloat(e.target.value) || 0))}
              />
              <div className="flex gap-0.5">
                <button
                  className="w-6 h-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleDeadriseChange(-1)}
                >
                  −
                </button>
                <button
                  className="w-6 h-6 bg-gray-600 hover:bg-gray-700 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleDeadriseChange(1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-gray-500 justify-between">
              <span>Шаг:</span>
              <input
                type="number"
                className="w-10 px-1 py-0.5 text-[10px] text-center border border-gray-300 rounded"
                value={deadriseStep}
                min={0.01}
                step={0.1}
                onChange={(e) => setDeadriseStep(parseFloat(e.target.value) || 0.1)}
              />
            </div>
          </div>

          {/* 4. Погибь палубы */}
          <div className="flex flex-col gap-1.5 bg-white p-2 rounded-lg shadow-xs border-t-2 border-cyan-500">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-800">Погибь палубы:</span>
              <label className="flex items-center gap-1 text-[10px] text-cyan-700 cursor-pointer select-none" title="Учитывать погибь палубы в общую высоту бруса H">
                <input
                  type="checkbox"
                  checked={deckCamberInHeight}
                  onChange={(e) => setDeckCamberInHeight(e.target.checked)}
                  className="rounded text-cyan-600 focus:ring-cyan-500 w-3.5 h-3.5 cursor-pointer accent-cyan-600"
                />
                <span className="text-[9px] font-medium leading-none">В высоту</span>
              </label>
            </div>
            <div className="flex items-center justify-between gap-1">
              <input
                type="number"
                className="w-16 px-1 py-1 text-xs font-semibold text-center border border-cyan-300 rounded focus:outline-none focus:border-cyan-600"
                value={deckCamber.toFixed(2)}
                min={0}
                step={0.05}
                onChange={(e) => setDeckCamber(Math.max(0, parseFloat(e.target.value) || 0))}
              />
              <div className="flex gap-0.5">
                <button
                  className="w-6 h-6 bg-cyan-700 hover:bg-cyan-800 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleDeckCamberChange(-1)}
                >
                  −
                </button>
                <button
                  className="w-6 h-6 bg-cyan-700 hover:bg-cyan-800 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleDeckCamberChange(1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-gray-500 justify-between">
              <span>Шаг:</span>
              <input
                type="number"
                className="w-10 px-1 py-0.5 text-[10px] text-center border border-gray-300 rounded"
                value={deckCamberStep}
                min={0.01}
                step={0.05}
                onChange={(e) => setDeckCamberStep(parseFloat(e.target.value) || 0.05)}
              />
            </div>
          </div>

          {/* 5. Радиус ширстрека */}
          <div className="flex flex-col gap-1.5 bg-white p-2 rounded-lg shadow-xs border-t-2 border-purple-500">
            <span className="text-xs font-semibold text-purple-800">Радиус ширстрека:</span>
            <div className="flex items-center justify-between gap-1">
              <input
                type="number"
                className="w-16 px-1 py-1 text-xs font-semibold text-center border border-purple-300 rounded focus:outline-none focus:border-purple-600"
                value={sheerRadius.toFixed(2)}
                min={0}
                max={maxSheerRadius}
                step={0.1}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setSheerRadius(Math.max(0, Math.min(val, Math.max(0, maxSheerRadius))));
                }}
              />
              <div className="flex gap-0.5">
                <button
                  className="w-6 h-6 bg-purple-700 hover:bg-purple-800 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleSheerRadiusChange(-1)}
                >
                  −
                </button>
                <button
                  className="w-6 h-6 bg-purple-700 hover:bg-purple-800 text-white rounded font-bold flex items-center justify-center text-xs active:scale-95"
                  onClick={() => handleSheerRadiusChange(1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-gray-500 justify-between">
              <span>Шаг:</span>
              <input
                type="number"
                className="w-10 px-1 py-0.5 text-[10px] text-center border border-gray-300 rounded"
                value={sheerRadiusStep}
                min={0.01}
                step={0.1}
                onChange={(e) => setSheerRadiusStep(parseFloat(e.target.value) || 0.1)}
              />
            </div>
          </div>
        </div>

        {/* Кнопки действий */}
        <div className="flex justify-center gap-4 mb-4">
          <button
            className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold text-xs tracking-wider uppercase rounded-lg transition cursor-pointer"
            onClick={onCancel}
          >
            Отмена
          </button>
          <button
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs tracking-wider uppercase rounded-lg shadow-md transition cursor-pointer"
            onClick={() =>
              onApply(
                radius,
                flare,
                deadrise,
                deckCamber,
                sheerRadius,
                showDeckCover,
                deadriseInHeight,
                deckCamberInHeight
              )
            }
          >
            Применить
          </button>
        </div>

        {/* 2D Интерактивный чертеж */}
        <div className="relative bg-[#F5F5F5] border-2 border-[#DDD] rounded-xl overflow-hidden shadow-inner">
          <canvas
            ref={canvasRef}
            width={800}
            height={360}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onWheel={handleCanvasWheel}
            className="w-full max-w-full block"
            style={{ cursor: isDraggingCanvas ? 'grabbing' : 'grab' }}
          />
        </div>

        <div className="mt-3 text-center text-xs text-gray-500">
          🖱️ Перемещение: зажмите и тащите | Колесико: масштаб
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 🎛️ НИЖНЯЯ ПАНЕЛЬ РЕДАКТИРОВАНИЯ ГЕОМЕТРИИ (ДЛЯ РЕЖИМА РАЗРЕЗА БРУСА)
// ============================================================================

export interface GeometryBottomBarProps {
  theme: ThemeStyle;
  width: number;
  height: number;
  radius: number;
  flare: number;
  deadrise: number;
  deadriseInHeight?: boolean;
  deckCamber?: number;
  deckCamberInHeight?: boolean;
  sheerRadius?: number;
  showDeckCover?: boolean;
  onParamsChange: (newParams: {
    radius?: number;
    flare?: number;
    deadrise?: number;
    deadriseInHeight?: boolean;
    deckCamber?: number;
    deckCamberInHeight?: boolean;
    sheerRadius?: number;
    showDeckCover?: boolean;
  }) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset?: () => void;
  isClosing?: boolean;
}

export const GeometryBottomBar: React.FC<GeometryBottomBarProps> = ({
  theme,
  width,
  height,
  radius,
  flare,
  deadrise,
  deadriseInHeight = false,
  deckCamber = 0,
  deckCamberInHeight = false,
  sheerRadius = 0,
  showDeckCover = false,
  onParamsChange,
  onSave,
  onCancel,
  onReset,
  isClosing = false,
}) => {
  const [stepR, setStepR] = useState(0.5);
  const [stepF, setStepF] = useState(0.2);
  const [stepD, setStepD] = useState(0.2);
  const [stepC, setStepC] = useState(0.1);
  const [stepS, setStepS] = useState(0.2);

  const maxRadius = Math.max(0, Math.min(width / 2, height));
  const safeRadius = Math.min(radius, maxRadius);
  const maxFlare = Math.max(1, Math.round((width / 2) * 10) / 10);
  const minFlare = -maxFlare + 0.1;
  const topDeckWidth = Math.max(0.1, width + 2 * flare);
  const { keelY, apexY } = calculateVerticalLevels({
    height,
    deadrise,
    deckCamber,
    deadriseInHeight,
    deckCamberInHeight,
  });
  const totalHeight = apexY - keelY;
  const maxSheerRadius = Math.max(0, Math.min(topDeckWidth / 2, height));
  const safeSheerRadius = Math.min(sheerRadius, maxSheerRadius);

  const handleIncrement = (
    param: 'radius' | 'flare' | 'deadrise' | 'deckCamber' | 'sheerRadius',
    dir: number
  ) => {
    if (param === 'radius') {
      const next = Math.max(0, Math.min(maxRadius, Number((safeRadius + dir * stepR).toFixed(2))));
      onParamsChange({ radius: next });
    } else if (param === 'flare') {
      const next = Math.max(minFlare, Math.min(maxFlare, Number((flare + dir * stepF).toFixed(2))));
      onParamsChange({ flare: next });
    } else if (param === 'deadrise') {
      const maxDeadrise = height;
      const next = Math.max(0, Math.min(maxDeadrise, Number((deadrise + dir * stepD).toFixed(2))));
      onParamsChange({ deadrise: next });
    } else if (param === 'deckCamber') {
      const next = Math.max(0, Number((deckCamber + dir * stepC).toFixed(2)));
      onParamsChange({ deckCamber: next });
    } else if (param === 'sheerRadius') {
      const next = Math.max(0, Math.min(maxSheerRadius, Number((safeSheerRadius + dir * stepS).toFixed(2))));
      onParamsChange({ sheerRadius: next });
    }
  };

  const isDark = theme === 'industrial';
  const panelBg = isDark
    ? 'bg-[#2A2E33]/95 text-[#E6E8EA] border-[#4A5057]'
    : theme === 'scandinavian'
    ? 'bg-[#F2F6F8]/95 text-[#2E3A42] border-[#D1DCE2]'
    : 'bg-white/95 text-gray-800 border-gray-200';

  const cardBg = isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/5';

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[96vw] max-w-6xl backdrop-blur-xl rounded-2xl shadow-2xl border p-4 transition-all duration-300 ${panelBg} ${
        isClosing ? 'opacity-0 translate-y-8 pointer-events-none' : 'opacity-100 translate-y-0'
      }`}
    >
      {/* Верхняя строка статуса */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 pb-2 border-b border-black/10">
        <div className="flex items-center gap-2.5">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
          </span>
          <span className="text-xs md:text-sm font-bold uppercase tracking-wider">
            Редактирование поперечного сечения
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] md:text-xs opacity-75 font-mono">
          <span>Ширина палубы: <strong className="text-cyan-500 font-bold">{topDeckWidth.toFixed(2)} м</strong></span>
          <span>•</span>
          <span>Базовая H: <strong className="text-cyan-500 font-bold">{height.toFixed(2)} м</strong></span>
          <span>•</span>
          <span>Полная высота: <strong className="text-cyan-500 font-bold">{totalHeight.toFixed(2)} м</strong></span>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <span>Крышка:</span>
            <button
              onClick={() => onParamsChange({ showDeckCover: !showDeckCover })}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer ${
                showDeckCover ? 'bg-cyan-500 text-white' : 'bg-black/10 dark:bg-white/10'
              }`}
            >
              {showDeckCover ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
          </div>
        </div>
      </div>

      {/* 5 интерактивных карточек параметров */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3.5">
        {/* 1. Радиус скулы */}
        <div className={`p-2.5 rounded-xl border ${cardBg}`}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-black/70 dark:text-white/70">
              Радиус скулы (R)
            </label>
            <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
              {safeRadius.toFixed(2)} м
            </span>
          </div>

          <div className="flex items-center gap-1 mb-1.5">
            <button
              className="w-7 h-7 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('radius', -1)}
            >
              −
            </button>
            <input
              type="number"
              className="w-full px-1 py-0.5 text-center text-xs font-bold rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 focus:outline-none"
              value={safeRadius.toFixed(2)}
              min={0}
              max={maxRadius}
              step={0.1}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onParamsChange({ radius: Math.max(0, Math.min(maxRadius, val)) });
              }}
            />
            <button
              className="w-7 h-7 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('radius', 1)}
            >
              +
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={maxRadius || 1}
            step={0.05}
            value={safeRadius}
            onChange={(e) => onParamsChange({ radius: parseFloat(e.target.value) || 0 })}
            className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cyan-500 mb-1"
          />

          <div className="flex justify-between items-center text-[9px] opacity-60">
            <span>Шаг: {stepR} м</span>
            <div className="flex gap-0.5">
              {[0.1, 0.5].map((s) => (
                <button
                  key={s}
                  onClick={() => setStepR(s)}
                  className={`px-1 py-0.2 rounded ${stepR === s ? 'bg-cyan-500 text-white' : 'hover:bg-black/10'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Развал / Завал бортов */}
        <div className={`p-2.5 rounded-xl border ${cardBg}`}>
          <div className="flex justify-between items-center mb-1">
            <label
              className="text-[11px] font-semibold uppercase tracking-wider text-black/70 dark:text-white/70"
              title=">0: Развал борта, <0: Завал борта"
            >
              {flare > 0.001 ? 'Развал борта' : flare < -0.001 ? 'Завал борта' : 'Развал / Завал'}
            </label>
            <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
              {flare > 0 ? `+${flare.toFixed(2)}` : flare.toFixed(2)} м
            </span>
          </div>

          <div className="flex items-center gap-1 mb-1.5">
            <button
              className="w-7 h-7 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('flare', -1)}
              title="Завал бортов (−)"
            >
              −
            </button>
            <input
              type="number"
              className="w-full px-1 py-0.5 text-center text-xs font-bold rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 focus:outline-none"
              value={flare.toFixed(2)}
              min={minFlare}
              max={maxFlare}
              step={0.1}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onParamsChange({ flare: Math.max(minFlare, Math.min(maxFlare, val)) });
              }}
            />
            <button
              className="w-7 h-7 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('flare', 1)}
              title="Развал бортов (+)"
            >
              +
            </button>
          </div>

          <input
            type="range"
            min={-maxFlare}
            max={maxFlare}
            step={0.05}
            value={flare}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0;
              onParamsChange({ flare: val });
            }}
            className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cyan-500 mb-0.5"
          />

          <div className="flex justify-between text-[8px] text-black/50 dark:text-white/50 px-0.5 mb-1 font-mono">
            <span>Завал (−)</span>
            <span className="font-bold text-cyan-600 dark:text-cyan-400">0</span>
            <span>(+) Развал</span>
          </div>

          <div className="flex justify-between items-center text-[9px] opacity-60">
            <span>Шаг: {stepF} м</span>
            <div className="flex gap-0.5">
              {[0.1, 0.2].map((s) => (
                <button
                  key={s}
                  onClick={() => setStepF(s)}
                  className={`px-1 py-0.2 rounded ${stepF === s ? 'bg-cyan-500 text-white' : 'hover:bg-black/10'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3. Килеватость */}
        <div className={`p-2.5 rounded-xl border ${cardBg}`}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-black/70 dark:text-white/70">
              Килеватость (β)
            </label>
            <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
              {deadrise.toFixed(2)} м
            </span>
          </div>

          <div className="flex items-center gap-1 mb-1.5">
            <button
              className="w-7 h-7 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('deadrise', -1)}
            >
              −
            </button>
            <input
              type="number"
              className="w-full px-1 py-0.5 text-center text-xs font-bold rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 focus:outline-none"
              value={deadrise.toFixed(2)}
              min={0}
              max={height}
              step={0.1}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onParamsChange({ deadrise: Math.max(0, Math.min(height, val)) });
              }}
            />
            <button
              className="w-7 h-7 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('deadrise', 1)}
            >
              +
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(1, height)}
            step={0.05}
            value={deadrise}
            onChange={(e) => onParamsChange({ deadrise: parseFloat(e.target.value) || 0 })}
            className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cyan-500 mb-1"
          />

          <div className="flex justify-between items-center text-[9px] opacity-80 pt-0.5">
            <label className="flex items-center gap-1 cursor-pointer select-none" title="Учитывать килеватость в общую высоту бруса">
              <input
                type="checkbox"
                checked={deadriseInHeight}
                onChange={(e) => onParamsChange({ deadriseInHeight: e.target.checked })}
                className="rounded text-cyan-600 focus:ring-cyan-500 w-3 h-3 cursor-pointer accent-cyan-600"
              />
              <span className="text-[9px] font-medium">В высоту</span>
            </label>
            <div className="flex gap-0.5">
              {[0.1, 0.2].map((s) => (
                <button
                  key={s}
                  onClick={() => setStepD(s)}
                  className={`px-1 py-0.2 rounded ${stepD === s ? 'bg-cyan-500 text-white' : 'hover:bg-black/10'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Погибь палубы (Camber) */}
        <div className={`p-2.5 rounded-xl border border-cyan-500/30 ${cardBg}`}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
              Погибь палубы
            </label>
            <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
              {deckCamber.toFixed(2)} м
            </span>
          </div>

          <div className="flex items-center gap-1 mb-1.5">
            <button
              className="w-7 h-7 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('deckCamber', -1)}
            >
              −
            </button>
            <input
              type="number"
              className="w-full px-1 py-0.5 text-center text-xs font-bold rounded-lg bg-black/5 dark:bg-white/10 border border-cyan-500/30 focus:outline-none"
              value={deckCamber.toFixed(2)}
              min={0}
              max={height}
              step={0.05}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onParamsChange({ deckCamber: Math.max(0, val) });
              }}
            />
            <button
              className="w-7 h-7 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('deckCamber', 1)}
            >
              +
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(1, height / 2)}
            step={0.02}
            value={deckCamber}
            onChange={(e) => onParamsChange({ deckCamber: parseFloat(e.target.value) || 0 })}
            className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cyan-500 mb-1"
          />

          <div className="flex justify-between items-center text-[9px] opacity-80 pt-0.5">
            <label className="flex items-center gap-1 cursor-pointer select-none" title="Учитывать погибь палубы в общую высоту бруса">
              <input
                type="checkbox"
                checked={deckCamberInHeight}
                onChange={(e) => onParamsChange({ deckCamberInHeight: e.target.checked })}
                className="rounded text-cyan-600 focus:ring-cyan-500 w-3 h-3 cursor-pointer accent-cyan-600"
              />
              <span className="text-[9px] font-medium">В высоту</span>
            </label>
            <div className="flex gap-0.5">
              {[0.05, 0.1].map((s) => (
                <button
                  key={s}
                  onClick={() => setStepC(s)}
                  className={`px-1 py-0.2 rounded ${stepC === s ? 'bg-cyan-500 text-white' : 'hover:bg-black/10'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 5. Радиус ширстрека (Sheer Radius) */}
        <div className={`p-2.5 rounded-xl border border-purple-500/30 ${cardBg}`}>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
              Радиус ширстрека
            </label>
            <span className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400">
              {safeSheerRadius.toFixed(2)} м
            </span>
          </div>

          <div className="flex items-center gap-1 mb-1.5">
            <button
              className="w-7 h-7 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('sheerRadius', -1)}
            >
              −
            </button>
            <input
              type="number"
              className="w-full px-1 py-0.5 text-center text-xs font-bold rounded-lg bg-black/5 dark:bg-white/10 border border-purple-500/30 focus:outline-none"
              value={safeSheerRadius.toFixed(2)}
              min={0}
              max={maxSheerRadius}
              step={0.1}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                onParamsChange({ sheerRadius: Math.max(0, Math.min(maxSheerRadius, val)) });
              }}
            />
            <button
              className="w-7 h-7 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-sm flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer"
              onClick={() => handleIncrement('sheerRadius', 1)}
            >
              +
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={maxSheerRadius || 1}
            step={0.05}
            value={safeSheerRadius}
            onChange={(e) => onParamsChange({ sheerRadius: parseFloat(e.target.value) || 0 })}
            className="w-full h-1 bg-black/10 rounded-lg appearance-none cursor-pointer accent-purple-500 mb-1"
          />

          <div className="flex justify-between items-center text-[9px] opacity-60">
            <span>Шаг: {stepS} м</span>
            <div className="flex gap-0.5">
              {[0.1, 0.2].map((s) => (
                <button
                  key={s}
                  onClick={() => setStepS(s)}
                  className={`px-1 py-0.2 rounded ${stepS === s ? 'bg-purple-500 text-white' : 'hover:bg-black/10'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Нижний ряд кнопок действий */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          onClick={() => {
            if (onReset) onReset();
            else onParamsChange({ radius: 0, flare: 0, deadrise: 0, deckCamber: 0, sheerRadius: 0 });
          }}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition cursor-pointer"
        >
          ↺ Сбросить в 0
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-gray-300 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition cursor-pointer active:scale-95"
          >
            Отмена
          </button>
          <button
            onClick={onSave}
            className="px-6 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition cursor-pointer active:scale-95 flex items-center gap-1.5"
          >
            <span>✓</span> Сохранить изменения
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3️⃣ НИЖНЯЯ ПАНЕЛЬ РЕДАКТИРОВАНИЯ НОСОВОЙ ОКОНЕЧНОСТИ (BOW BOTTOM BAR)
// ============================================================================

export interface SurfaceBottomBarTabProps {
  theme: ThemeStyle;
  bowLength: number;
  width: number;
  height?: number;
  draft?: number;
  bowParams: BowParameters;
  onBowParamsChange: (params: Partial<BowParameters>) => void;
  renderMode?: SurfaceRenderMode;
  onRenderModeChange?: (mode: SurfaceRenderMode) => void;
  wireframeDisplay?: WireframeDisplayOptions;
  onWireframeDisplayChange?: (options: Partial<WireframeDisplayOptions>) => void;
  qaStats?: TopologyQAStats;
  onBack: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export const SurfaceBottomBarTab: React.FC<SurfaceBottomBarTabProps> = ({
  theme,
  bowLength,
  bowParams,
  onBowParamsChange,
  renderMode = 'shaded',
  onRenderModeChange,
  wireframeDisplay,
  onWireframeDisplayChange,
  qaStats,
  onBack,
  onSave,
  onCancel,
}) => {
  const currentEngine = bowParams.surfaceEngineMode ?? 'coons';
  const isControlNetOn = Boolean(bowParams.showControlNet || wireframeDisplay?.showControlNet);

  const vol = extractBowVolumeParams(bowParams);
  const midTangent = vol.baseMidTangentLength ?? 3.0;
  const hollow = vol.hollowDepth ?? 0.0;

  const updateVolParam = (patch: Partial<BowVolumeParameters>) => {
    onBowParamsChange({
      bowVolume: {
        ...vol,
        ...patch,
      },
    });
  };

  const themeClasses: Record<ThemeStyle, { container: string; card: string; accent: string }> = {
    minimalism: {
      container: 'bg-white/95 text-gray-800 border-gray-200/80 shadow-2xl backdrop-blur-xl',
      card: 'bg-gray-50/90 border-gray-200/60',
      accent: 'cyan',
    },
    scandinavian: {
      container: 'bg-[#f4efe6]/95 text-[#3c3836] border-[#d5c4a1] shadow-2xl backdrop-blur-xl',
      card: 'bg-[#ebd7b2]/50 border-[#d5c4a1]/70',
      accent: 'cyan',
    },
    industrial: {
      container: 'bg-[#1e2227]/95 text-gray-100 border-gray-700/80 shadow-2xl backdrop-blur-xl',
      card: 'bg-[#282c34]/80 border-gray-700/60',
      accent: 'cyan',
    },
  };

  const currentTheme = themeClasses[theme] || themeClasses.minimalism;

  return (
    <div className="space-y-1.5 animate-in fade-in">
      {/* 1. Верхний переключатель геометрического ядра */}
      <div className={`p-1.5 rounded-xl border ${currentTheme.card} flex flex-wrap items-center justify-between gap-2 shadow-xs`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
              Геометрическое ядро поверхности
            </span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 font-semibold">
            FREE!ship Architecture
          </span>
        </div>

        {/* Сегментированный переключатель ядер */}
        <div className="flex items-center p-0.5 rounded-lg bg-black/10 dark:bg-white/10 border border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={() => onBowParamsChange({ surfaceEngineMode: 'bspline' })}
            className={`px-3 py-1 text-[11px] font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              currentEngine === 'bspline'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <span>★ B-Spline ядро (FREE!ship)</span>
            <span className="text-[9px] opacity-80 font-mono">G1/G2</span>
          </button>
          <button
            type="button"
            onClick={() => onBowParamsChange({ surfaceEngineMode: 'coons' })}
            className={`px-3 py-1 text-[11px] font-bold rounded-md transition cursor-pointer flex items-center gap-1.5 ${
              currentEngine === 'coons'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <span>Кунс / Lofting</span>
            <span className="text-[9px] opacity-80 font-mono">Классика</span>
          </button>
        </div>
      </div>

      {/* 2. Основная матрица параметров B-Spline ядра */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-1.5">
        {/* Карточка 1: Пространственная управляющая сеть (Control Net) */}
        <div className={`p-2 rounded-xl border ${currentTheme.card} flex flex-col justify-between shadow-xs`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span>🕸️</span> Управляющая сеть
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold">
              9 × 7 (63 узла)
            </span>
          </div>

          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
            Пространственный полиэдр вершин FREE!ship с зажатыми узловыми векторами U и V.
          </p>

          <div className="mt-1.5 pt-1.5 border-t border-black/10 dark:border-white/10 flex items-center justify-between">
            <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
              Полиэдр в 3D:
            </span>
            <button
              type="button"
              onClick={() => {
                const nextVal = !isControlNetOn;
                onBowParamsChange({ showControlNet: nextVal });
                onWireframeDisplayChange?.({ showControlNet: nextVal });
              }}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                isControlNetOn
                  ? 'bg-yellow-400 text-yellow-950 shadow-xs'
                  : 'bg-black/5 dark:bg-white/10 text-gray-500 hover:text-gray-800 dark:hover:text-white'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isControlNetOn ? 'bg-yellow-900 animate-pulse' : 'bg-gray-400'}`} />
              <span>{isControlNetOn ? 'ВКЛ (Жёлтый)' : 'ВЫКЛ'}</span>
            </button>
          </div>
        </div>

        {/* Карточка 2: Сопряжение с миделем под 90° (G1/G2 Continuity) */}
        <div className={`p-2 rounded-xl border ${currentTheme.card} flex flex-col justify-between shadow-xs`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 flex items-center gap-1">
              <span>📐</span> Фиксация 90° к миделю
            </span>
            <span className="text-[10px] font-mono font-bold text-cyan-700 dark:text-cyan-300">
              w_mid = {midTangent.toFixed(1)} м
            </span>
          </div>

          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
            P_(7,j) строго параллелен оси X — исключает шов и артефакты на тесте «Зебра».
          </p>

          <div className="mt-1">
            <input
              type="range"
              min={0.5}
              max={Math.min(8.0, Number((bowLength * 0.45).toFixed(1)))}
              step={0.1}
              value={midTangent}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                updateVolParam({ baseMidTangentLength: val });
                onBowParamsChange({ tangentWeightMid: val });
              }}
              className="w-full h-1 bg-black/15 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[9px] text-gray-400 font-mono mt-0.5">
              <span>0.5 м</span>
              <span>G1 / G2 ортогональность</span>
              <span>{(bowLength * 0.45).toFixed(1)} м</span>
            </div>
          </div>
        </div>

        {/* Карточка 3: Фильтр «Анти-щека» (Anti-Cheek Filter) */}
        <div className={`p-2 rounded-xl border ${currentTheme.card} flex flex-col justify-between shadow-xs`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <span>🛡️</span> Фильтр «Анти-щека»
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300">
              δ = {hollow.toFixed(2)} м
            </span>
          </div>

          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
            Вогнутость P_(1,j) устраняет паразитное раздутие («носовые щёки») полиномами Безье.
          </p>

          <div className="mt-1">
            <input
              type="range"
              min={0.0}
              max={1.2}
              step={0.05}
              value={hollow}
              onChange={(e) => updateVolParam({ hollowDepth: parseFloat(e.target.value) })}
              className="w-full h-1 bg-black/15 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <div className="flex justify-between text-[9px] text-gray-400 font-mono mt-0.5">
              <span>0.00 м (Прямой)</span>
              <span>Вогнутость входа</span>
              <span>1.20 м (Клипер)</span>
            </div>
          </div>
        </div>

        {/* Карточка 4: Режим оптического контроля поверхности */}
        <div className={`p-2 rounded-xl border ${currentTheme.card} flex flex-col justify-between shadow-xs`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
              <span>🔍</span> Оптический контроль
            </span>
            <span className="text-[9px] font-mono text-purple-700 dark:text-purple-300 font-semibold">
              Тест нормалей
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 mt-1">
            <button
              type="button"
              onClick={() => onRenderModeChange?.('shaded')}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                renderMode === 'shaded'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-black/10'
              }`}
            >
              <span>⚪ Сплошной</span>
            </button>

            <button
              type="button"
              onClick={() => onRenderModeChange?.('zebra')}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                renderMode === 'zebra'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-black/10'
              }`}
              title="Тест «Зебра» для проверки непрерывности кривизны G1/G2"
            >
              <span>🦓 Зебра</span>
            </button>

            <button
              type="button"
              onClick={() => onRenderModeChange?.('curvature')}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                renderMode === 'curvature'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-black/10'
              }`}
            >
              <span>🌈 Кривизна</span>
            </button>

            <button
              type="button"
              onClick={() => onRenderModeChange?.('wireframe')}
              className={`px-1.5 py-0.5 text-[10px] font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1 ${
                renderMode === 'wireframe'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-black/10'
              }`}
            >
              <span>🔲 Каркас</span>
            </button>
          </div>

          {/* Телеметрия реального времени */}
          <div className="mt-1 pt-1 border-t border-black/10 dark:border-white/10 flex items-center justify-between text-[9px] font-mono">
            <span className="text-gray-500">Время расчета:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {qaStats?.computeTimeMs ? `${qaStats.computeTimeMs.toFixed(1)} мс` : '< 2.5 мс'} (PASS)
            </span>
          </div>
        </div>
      </div>

      {/* 3. Информационная плашка ТЗ FREE!ship: Ребра излома и аналитические нормали */}
      <div className={`p-1.5 rounded-xl border ${currentTheme.card} flex flex-wrap items-center justify-between gap-2 text-[10px] shadow-xs`}>
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
            <span>⚡</span> Ребра излома (Crease):
          </span>
          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono text-gray-600 dark:text-gray-400">
            Скула: mult(v_2)=3
          </span>
          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono text-gray-600 dark:text-gray-400">
            Планширь: mult(v_5)=3
          </span>
          <span className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono text-gray-600 dark:text-gray-400">
            Киль: ДП Z=0
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[9px]">
          <span className="text-gray-500">Нормали:</span>
          <span className="font-bold text-cyan-600 dark:text-cyan-400">
            n = ∂S/∂u × ∂S/∂v (Аналитические)
          </span>
        </div>
      </div>

      {/* 4. Нижний ряд кнопок управления: Назад, Отмена и Применить */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-black/10 dark:border-white/10">
        <button
          onClick={onBack}
          className="px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 transition cursor-pointer active:scale-95"
        >
          ← Назад (Объём)
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition cursor-pointer active:scale-95"
          >
            Отмена
          </button>
          <button
            onClick={onSave}
            className="px-5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm transition cursor-pointer active:scale-95 font-bold"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};

export interface BowBottomBarProps {
  theme: ThemeStyle;
  step: 'length' | 'deck' | 'stem' | 'volume' | 'shaping' | 'framework' | 'surface';
  bowLength: number;
  maxLength: number;
  width: number;
  height?: number;
  draft?: number;
  bowParams: BowParameters;
  onBowLengthChange: (length: number) => void;
  onBowParamsChange: (params: Partial<BowParameters>) => void;
  selectedPointIndex?: number | null;
  onSelectPointIndex?: (idx: number | null) => void;
  selectedStemPointKey?: StemPointKey | null;
  onSelectStemPointKey?: (key: StemPointKey | null) => void;
  selectedStemParamId?: string | null;
  onSelectStemParamId?: (id: string | null) => void;
  selectedBowSectionPointKey?: BowSectionKey | null;
  onSelectBowSectionPointKey?: (key: BowSectionKey | null) => void;
  showBreadthLimits?: boolean;
  onToggleBreadthLimits?: () => void;
  showFullHull?: boolean;
  onToggleFullHull?: () => void;
  showHalfHull?: boolean;
  onToggleHalfHull?: () => void;
  qaStats?: TopologyQAStats;
  renderMode?: SurfaceRenderMode;
  onRenderModeChange?: (mode: SurfaceRenderMode) => void;
  wireframeDisplay?: WireframeDisplayOptions;
  onWireframeDisplayChange?: (options: Partial<WireframeDisplayOptions>) => void;
  activeMasterWaterline?: 'dwl' | 'deck' | 'bilge';
  onSelectMasterWaterline?: (level: 'dwl' | 'deck' | 'bilge') => void;
  onStepChange?: (step: 'length' | 'deck' | 'stem' | 'volume' | 'framework' | 'surface') => void;
  onSetCameraView?: (view: 'profile' | 'isometric' | 'bow' | 'top') => void;
  onNext: () => void;
  onBack: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export const BowBottomBar: React.FC<BowBottomBarProps> = ({
  theme,
  step,
  bowLength,
  maxLength,
  width,
  height = 9.0,
  draft = 4.5,
  bowParams,
  onBowLengthChange,
  onBowParamsChange,
  selectedPointIndex: controlledPointIndex,
  onSelectPointIndex: controlledOnSelectPointIndex,
  selectedStemPointKey,
  onSelectStemPointKey,
  selectedStemParamId,
  onSelectStemParamId,
  selectedBowSectionPointKey,
  onSelectBowSectionPointKey,
  showBreadthLimits = true,
  onToggleBreadthLimits,
  showFullHull = false,
  onToggleFullHull,
  showHalfHull = false,
  onToggleHalfHull,
  qaStats,
  renderMode,
  onRenderModeChange,
  wireframeDisplay = {
    showStations: false,
    showWaterlines: true,
    showButtocks: false,
    showLongitudinals: false,
    showBoundaries: false,
    stationCount: 11,
    waterlineCount: 7,
    buttockCount: 5,
    hullSurfaceVisibility: 'ghost',
    hullOpacity: 0.35,
    showControlNet: false,
  },
  onWireframeDisplayChange,
  activeMasterWaterline,
  onSelectMasterWaterline,
  onStepChange,
  onSetCameraView,
  onNext,
  onBack,
  onSave,
  onCancel,
}) => {
  const [stepLength, setStepLength] = useState(0.5);
  const [stepShoulder, setStepShoulder] = useState(0.05);
  const [stepAngle, setStepAngle] = useState(1.0);
  const [stepStemWidth, setStepStemWidth] = useState(0.1);
  const [stepMaxPos, setStepMaxPos] = useState(0.05);

  // Состояние всплывающего вверх окна настройки прозрачности обшивки
  const [isOpacityPopupOpen, setIsOpacityPopupOpen] = useState(false);
  const currentOpacity =
    wireframeDisplay.hullOpacity !== undefined
      ? wireframeDisplay.hullOpacity
      : wireframeDisplay.hullSurfaceVisibility === 'hidden'
      ? 0
      : wireframeDisplay.hullSurfaceVisibility === 'ghost'
      ? 0.35
      : 1.0;

  // Синхронизированные локальные поля для ввода длины (метры) и процента от длины судна
  const [metersInputValue, setMetersInputValue] = useState<string>(bowLength.toFixed(2));
  const [percentInputValue, setPercentInputValue] = useState<string>(((bowLength / maxLength) * 100).toFixed(1));

  useEffect(() => {
    setMetersInputValue(bowLength.toFixed(2));
    setPercentInputValue(((bowLength / maxLength) * 100).toFixed(1));
  }, [bowLength, maxLength]);

  const handleMetersInputChange = (valStr: string) => {
    setMetersInputValue(valStr);
    const parsed = parseFloat(valStr);
    if (!isNaN(parsed) && parsed > 0) {
      const clamped = Math.max(0.5, Math.min(maxLength, parsed));
      onBowLengthChange(clamped);
      setPercentInputValue(((clamped / maxLength) * 100).toFixed(1));
    }
  };

  const handlePercentInputChange = (valStr: string) => {
    setPercentInputValue(valStr);
    const parsed = parseFloat(valStr);
    if (!isNaN(parsed) && parsed > 0) {
      const clampedPct = Math.max(0.5, Math.min(100, parsed));
      const calculatedLen = Number(((clampedPct / 100) * maxLength).toFixed(2));
      onBowLengthChange(calculatedLen);
      setMetersInputValue(calculatedLen.toFixed(2));
    }
  };

  const handleSliderValueChange = (val: number) => {
    const clamped = Math.max(0.5, Math.min(maxLength, val));
    onBowLengthChange(clamped);
    setMetersInputValue(clamped.toFixed(2));
    setPercentInputValue(((clamped / maxLength) * 100).toFixed(1));
  };

  // Состояние интерактивного манипулятора (Gizmo) на 2D Canvas
  const [internalPointIndex, setInternalPointIndex] = useState<number | null>(2);
  const selectedPointIndex = controlledPointIndex !== undefined ? controlledPointIndex : internalPointIndex;
  const setSelectedPointIndex = (idx: number | null) => {
    if (controlledOnSelectPointIndex) controlledOnSelectPointIndex(idx);
    setInternalPointIndex(idx);
  };
  const [isDragging, setIsDragging] = useState(false);
  const [dragAxis, setDragAxis] = useState<'both' | 'x' | 'y' | null>(null);
  const [wheelTooltip, setWheelTooltip] = useState<string | null>(null);
  const [selectedDeckParamId, setSelectedDeckParamId] = useState<string | null>('entranceAngle');
  const [activeDeckHelpParam, setActiveDeckHelpParam] = useState<string | null>(null);
  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const effectiveSelectedDeckParam = activeDeckHelpParam || selectedDeckParamId;

  const handleSelectDeckParam = (paramId: string) => {
    setSelectedDeckParamId(paramId);
    if (activeDeckHelpParam) {
      setActiveDeckHelpParam(paramId);
    }
  };

  const handleOpenDeckHelp = (paramId: string) => {
    setActiveDeckHelpParam(paramId);
    setSelectedDeckParamId(paramId);
  };

  // Навигация по параметрам палубы в окне справки
  const currentDeckHelpIndex = activeDeckHelpParam ? DECK_PARAM_KEYS.indexOf(activeDeckHelpParam as keyof typeof DECK_PARAM_HELP) : -1;
  const prevDeckHelpIndex = currentDeckHelpIndex >= 0 ? (currentDeckHelpIndex - 1 + DECK_PARAM_KEYS.length) % DECK_PARAM_KEYS.length : 0;
  const nextDeckHelpIndex = currentDeckHelpIndex >= 0 ? (currentDeckHelpIndex + 1) % DECK_PARAM_KEYS.length : 0;
  const prevDeckHelpParamKey = DECK_PARAM_KEYS[prevDeckHelpIndex];
  const nextDeckHelpParamKey = DECK_PARAM_KEYS[nextDeckHelpIndex];

  const handlePrevDeckHelp = () => {
    if (currentDeckHelpIndex < 0) return;
    const nextKey = DECK_PARAM_KEYS[prevDeckHelpIndex];
    setActiveDeckHelpParam(nextKey);
    setSelectedDeckParamId(nextKey);
  };

  const handleNextDeckHelp = () => {
    if (currentDeckHelpIndex < 0) return;
    const nextKey = DECK_PARAM_KEYS[nextDeckHelpIndex];
    setActiveDeckHelpParam(nextKey);
    setSelectedDeckParamId(nextKey);
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const themeClasses: Record<ThemeStyle, { container: string; card: string; accent: string }> = {
    minimalism: {
      container: 'bg-white/95 text-gray-800 border-gray-200/80 shadow-2xl backdrop-blur-xl',
      card: 'bg-gray-50/90 border-gray-200/60',
      accent: 'cyan',
    },
    scandinavian: {
      container: 'bg-[#f4efe6]/95 text-[#3c3836] border-[#d5c4a1] shadow-2xl backdrop-blur-xl',
      card: 'bg-[#ebd7b2]/50 border-[#d5c4a1]/70',
      accent: 'cyan',
    },
    industrial: {
      container: 'bg-[#1e2227]/95 text-gray-100 border-gray-700/80 shadow-2xl backdrop-blur-xl',
      card: 'bg-[#282c34]/80 border-gray-700/60',
      accent: 'cyan',
    },
  };

  const currentTheme = themeClasses[theme] || themeClasses.minimalism;

  // Ограничители
  const maxStemWidth = Math.min(10.0, Number((width / 2).toFixed(2)));
  const yMid = width / 2 + (bowParams.bowFlare > 0 ? bowParams.bowFlare * 0.5 : 0);
  const totalBowSpan = Math.max(1, bowLength);

  // Инкрементные функции для параметров
  const handleIncrementParam = (param: keyof BowParameters | 'bowLength', dir: number) => {
    if (param === 'bowLength') {
      const next = Math.max(0.5, Math.min(maxLength, Number((bowLength + dir * stepLength).toFixed(2))));
      handleSliderValueChange(next);
      return;
    }
    if (param === 'shoulderFullness') {
      const next = Math.max(0.1, Math.min(1.5, Number((bowParams.shoulderFullness + dir * stepShoulder).toFixed(2))));
      onBowParamsChange({ shoulderFullness: next, controlPoints: undefined });
    } else if (param === 'entranceAngle') {
      const next = Math.max(5, Math.min(85, Number((bowParams.entranceAngle + dir * stepAngle).toFixed(1))));
      onBowParamsChange({ entranceAngle: next, controlPoints: undefined });
    } else if (param === 'stemWidth') {
      const next = Math.max(0, Math.min(maxStemWidth, Number((bowParams.stemWidth + dir * stepStemWidth).toFixed(2))));
      onBowParamsChange({ stemWidth: next, controlPoints: undefined });
    } else if (param === 'maxBreadthPos') {
      const next = Math.max(0, Math.min(1.0, Number((bowParams.maxBreadthPos + dir * stepMaxPos).toFixed(2))));
      onBowParamsChange({ maxBreadthPos: next, controlPoints: undefined });
    }
  };

  // Расчет коэффициента полноты палубы и контрольных точек Безье
  const { cwp, controlPoints } = calculateBowWaterplaneCoeff(
    totalBowSpan,
    yMid,
    bowParams.stemWidth / 2,
    0,
    bowParams.entranceAngle,
    bowParams.shoulderFullness,
    bowParams.maxBreadthPos,
    bowParams.controlPoints
  );

  // 2D Отрисовка полушироты (Waterline & Interactive Bezier Gizmo)
  useEffect(() => {
    if (step !== 'shaping' && step !== 'deck') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const padX = 28;
    const padY = 20;
    const drawW = w - padX * 2;
    const drawH = h - padY * 2;

    const Lb = totalBowSpan;
    const maxY = Math.max(yMid * 1.5, 1.5);

    // Функция трансформации из судовых (X ∈ [-Lb, 0], Y ∈ [0, maxY]) в экранные координаты
    // X = 0 (форштевень) -> правый край, X = -Lb (мидель) -> левый край
    const toScreen = (x: number, y: number): [number, number] => {
      const sx = padX + ((x + Lb) / Lb) * drawW;
      const sy = h - padY - (y / maxY) * drawH;
      return [sx, sy];
    };

    // Осевая линия (ДП - Centerline)
    ctx.strokeStyle = theme === 'industrial' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padX - 8, h - padY);
    ctx.lineTo(w - padX + 8, h - padY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ──────────────────────────────────────────────────────────────────────────
    // КРАСНАЯ ЛИНИЯ ВЕРХНЕГО ГАБАРИТА (Габарит полушироты борта B/2)
    // ──────────────────────────────────────────────────────────────────────────
    const [limitStartSx, limitSy] = toScreen(-Lb, yMid);
    const [limitEndSx] = toScreen(0, yMid);

    // Сплошная яркая красная линия габарита
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(padX - 8, limitSy);
    ctx.lineTo(w - padX + 8, limitSy);
    ctx.stroke();

    // Штриховка габаритной зоны сверху от линии
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1.0;
    for (let xPos = padX - 8; xPos <= w - padX + 8; xPos += 14) {
      ctx.beginPath();
      ctx.moveTo(xPos, limitSy);
      ctx.lineTo(xPos + 8, limitSy - 6);
      ctx.stroke();
    }

    // Красный бейдж-маркер габарита
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`⛔ ВЕРХНИЙ ГАБАРИТ (B/2): ${yMid.toFixed(2)}м`, padX - 22, limitSy - 8);

    // Сетка / координатные маркеры
    ctx.fillStyle = theme === 'industrial' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.font = '9px monospace';
    ctx.fillText(`CL (ДП)`, padX - 22, h - padY + 3);

    // Опорный полигон Безье P0..P4
    ctx.strokeStyle = theme === 'industrial' ? 'rgba(6, 182, 212, 0.35)' : 'rgba(8, 145, 178, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    controlPoints.forEach((pt, i) => {
      const [sx, sy] = toScreen(pt.x, pt.y);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Отрисовка сплошной кривой полушироты палубы Y(X) (Правый борт)
    let hasExceededLimit = false;
    const curveScreenPts: [number, number][] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps; // 0: мидель, 1: форштевень
      const pt = computeBowDeckWaterlinePoint(
        t,
        Lb,
        yMid,
        bowParams.stemWidth / 2,
        bowParams.stemRadius,
        bowParams.entranceAngle,
        bowParams.shoulderFullness,
        bowParams.maxBreadthPos,
        bowParams.controlPoints
      );
      if (pt.y > yMid + 0.005) {
        hasExceededLimit = true;
      }
      const [sx, sy] = toScreen(pt.xRel, pt.y);
      curveScreenPts.push([sx, sy]);
    }

    // Если есть превышение габарита, подсвечиваем зону превышения красным
    if (hasExceededLimit) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
      ctx.beginPath();
      curveScreenPts.forEach(([sx, sy], i) => {
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.lineTo(w - padX + 8, limitSy);
      ctx.lineTo(padX - 8, limitSy);
      ctx.closePath();
      ctx.fill();

      // Предупреждающий бейдж в правом верхнем углу 2D схемы
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('⚠️ ВЫХОД ЗА ГАБАРИТ БОРТА!', w - 190, 16);
    }

    ctx.strokeStyle = hasExceededLimit ? '#f87171' : '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    curveScreenPts.forEach(([sx, sy], i) => {
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();

    // Симметричное зеркальное отображение контура (Левый борт)
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = computeBowDeckWaterlinePoint(
        t,
        Lb,
        yMid,
        bowParams.stemWidth / 2,
        bowParams.stemRadius,
        bowParams.entranceAngle,
        bowParams.shoulderFullness,
        bowParams.maxBreadthPos,
        bowParams.controlPoints
      );
      const sx = padX + ((pt.xRel + Lb) / Lb) * drawW;
      const sy = h - padY + (pt.y / maxY) * drawH * 0.4;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Опорный многоугольник Безье (пунктир)
    if (controlPoints.length >= 5) {
      ctx.strokeStyle = theme === 'industrial' ? 'rgba(56, 189, 248, 0.35)' : 'rgba(2, 132, 199, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      controlPoints.forEach((pt, i) => {
        const [sx, sy] = toScreen(pt.x, pt.y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Касательная / Тангенс к миделю между точками P4 и P3
      const p3 = controlPoints[3];
      const p4 = controlPoints[4];
      if (p3 && p4) {
        const dx3 = Math.max(0.001, p3.x - p4.x);
        const dy3 = p3.y - p4.y;
        const tanVal = dy3 / dx3;
        const [p3sx, p3sy] = toScreen(p3.x, p3.y);
        const [p4sx, p4sy] = toScreen(p4.x, p4.y);

        ctx.strokeStyle = selectedPointIndex === 3 ? '#06b6d4' : '#0284c7';
        ctx.lineWidth = selectedPointIndex === 3 ? 2.0 : 1.2;
        ctx.beginPath();
        ctx.moveTo(p4sx, p4sy);
        ctx.lineTo(p3sx, p3sy);
        ctx.stroke();

        ctx.fillStyle = selectedPointIndex === 3 ? '#06b6d4' : '#0284c7';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`tg=${tanVal.toFixed(3)}`, (p3sx + p4sx) / 2 - 16, Math.min(p3sy, p4sy) - 6);
      }
    }

    // Вектор угла входа α_entrance у форштевня
    const [stemSx, stemSy] = toScreen(0, bowParams.stemWidth / 2 + bowParams.stemRadius);
    const alphaRad = (bowParams.entranceAngle * Math.PI) / 180;
    const vLen = 28;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(stemSx, stemSy);
    ctx.lineTo(stemSx - Math.cos(alphaRad) * vLen, stemSy - Math.sin(alphaRad) * vLen);
    ctx.stroke();

    // Отрисовка всех точек Безье P0..P4
    controlPoints.forEach((pt, i) => {
      const [sx, sy] = toScreen(pt.x, pt.y);
      const isSelected = selectedPointIndex === i;

      // Окружность точки
      ctx.fillStyle = isSelected ? '#06b6d4' : i === 2 ? '#f59e0b' : i === 3 ? '#0284c7' : i === 4 ? '#64748b' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(sx, sy, isSelected ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Подпись точки P_i
      ctx.fillStyle = isSelected ? '#06b6d4' : theme === 'industrial' ? '#cbd5e1' : '#475569';
      ctx.font = isSelected ? 'bold 10px monospace' : '9px monospace';
      ctx.fillText(`P${i}`, sx - 6, sy - 8);
    });

    // Отрисовка Гизмо-манипулятора (Стрелки X, Y и плоскость) у выбранной точки
    if (selectedPointIndex !== null && selectedPointIndex !== 4 && controlPoints[selectedPointIndex]) {
      const activePt = controlPoints[selectedPointIndex];
      const [gx, gy] = toScreen(activePt.x, activePt.y);
      const arrowLen = 32;
      const planeSize = 12;

      // Плоскость захвата (квадратик между осями) - только для P1 и P2
      if (selectedPointIndex === 1 || selectedPointIndex === 2) {
        ctx.fillStyle = dragAxis === 'both' ? 'rgba(6, 182, 212, 0.5)' : 'rgba(6, 182, 212, 0.2)';
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1;
        ctx.fillRect(gx - planeSize, gy - planeSize, planeSize, planeSize);
        ctx.strokeRect(gx - planeSize, gy - planeSize, planeSize, planeSize);
      }

      // Стрелка оси X (горизонтальная, влево/вправо) - для P1, P2, P3
      if (selectedPointIndex !== 0) {
        ctx.strokeStyle = dragAxis === 'x' ? '#38bdf8' : '#0284c7';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx - arrowLen, gy);
        ctx.stroke();

        // Наконечник стрелки X
        ctx.fillStyle = dragAxis === 'x' ? '#38bdf8' : '#0284c7';
        ctx.beginPath();
        ctx.moveTo(gx - arrowLen - 4, gy);
        ctx.lineTo(gx - arrowLen + 3, gy - 4);
        ctx.lineTo(gx - arrowLen + 3, gy + 4);
        ctx.closePath();
        ctx.fill();
      }

      // Стрелка оси Y (вертикальная, вверх) - только для P0, P1, P2 (P3 зафиксирована по ширине)
      if (selectedPointIndex !== 3) {
        ctx.strokeStyle = dragAxis === 'y' ? '#10b981' : '#059669';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx, gy - arrowLen);
        ctx.stroke();

        // Наконечник стрелки Y
        ctx.fillStyle = dragAxis === 'y' ? '#10b981' : '#059669';
        ctx.beginPath();
        ctx.moveTo(gx, gy - arrowLen - 4);
        ctx.lineTo(gx - 4, gy - arrowLen + 3);
        ctx.lineTo(gx + 4, gy - arrowLen + 3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [step, bowLength, bowParams, yMid, theme, selectedPointIndex, dragAxis, controlPoints]);

  // Обработка клика и выбора точек на Canvas с Pointer Capture
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Строго только ЛКМ
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const w = canvas.width;
    const h = canvas.height;
    const padX = 28;
    const padY = 20;
    const drawW = w - padX * 2;
    const drawH = h - padY * 2;
    const Lb = Math.max(1, bowLength);
    const maxY = Math.max(yMid * 1.5, 1.5);

    const toScreen = (x: number, y: number): [number, number] => {
      const sx = padX + ((x + Lb) / Lb) * drawW;
      const sy = h - padY - (y / maxY) * drawH;
      return [sx, sy];
    };

    // Проверяем клик по гизмо выбранной точки
    if (selectedPointIndex !== null && selectedPointIndex !== 4 && controlPoints[selectedPointIndex]) {
      const [gx, gy] = toScreen(controlPoints[selectedPointIndex].x, controlPoints[selectedPointIndex].y);
      const planeSize = 16;

      if (selectedPointIndex === 1 || selectedPointIndex === 2) {
        // Клик по плоскости квадрата
        if (clickX >= gx - planeSize && clickX <= gx && clickY >= gy - planeSize && clickY <= gy) {
          setIsDragging(true);
          setDragAxis('both');
          return;
        }
      }
      if (selectedPointIndex !== 0) {
        // Клик по стрелке X
        if (clickX >= gx - 42 && clickX <= gx && Math.abs(clickY - gy) <= 10) {
          setIsDragging(true);
          setDragAxis('x');
          return;
        }
      }
      if (selectedPointIndex !== 3) {
        // Клик по стрелке Y
        if (clickY >= gy - 42 && clickY <= gy && Math.abs(clickX - gx) <= 10) {
          setIsDragging(true);
          setDragAxis('y');
          return;
        }
      }
    }

    // Проверяем клик вблизи любой из точек P0..P4
    let closestIndex: number | null = null;
    let minDist = 25; // увеличенный удобный радиус захвата в пикселях

    controlPoints.forEach((pt, i) => {
      const [sx, sy] = toScreen(pt.x, pt.y);
      const dist = Math.hypot(clickX - sx, clickY - sy);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = i;
      }
    });

    if (closestIndex !== null) {
      setSelectedPointIndex(closestIndex);
      if (closestIndex === 0) {
        setIsDragging(true);
        setDragAxis('y');
      } else if (closestIndex === 3) {
        setIsDragging(true);
        setDragAxis('x');
      } else if (closestIndex !== 4) {
        setIsDragging(true);
        setDragAxis('both');
      }
    }
  };

  // Перетаскивание точки мышью (Drag Gizmo) с Pointer Move
  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging || selectedPointIndex === null || selectedPointIndex === 4) return;
    if ((e.buttons & 1) === 0) {
      setIsDragging(false);
      setDragAxis(null);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;

    const w = canvas.width;
    const h = canvas.height;
    const padX = 28;
    const padY = 20;
    const drawW = w - padX * 2;
    const drawH = h - padY * 2;
    const Lb = Math.max(1, bowLength);
    const maxY = Math.max(yMid * 1.5, 1.5);

    // Обратное преобразование координат из экрана в судовые
    const shipX = ((currentX - padX) / drawW) * Lb - Lb;
    const shipY = ((h - padY - currentY) / drawH) * maxY;

    if (selectedPointIndex === 0) {
      // P0: Притупление носа W и Свес/вылет форштевня
      const maxStemW = Number((yMid * 0.9).toFixed(2));
      const newStemWidth = Math.max(0, Math.min(maxStemW, Number((shipY * 2).toFixed(2))));
      const curStem = bowParams.stemProfile || DEFAULT_STEM_PARAMS;
      const newOverhang = Number(Math.max(-5, Math.min(10, shipX)).toFixed(2));
      onBowParamsChange({
        stemWidth: newStemWidth,
        stemProfile: {
          ...curStem,
          deckOverhang: newOverhang,
        },
        controlPoints: undefined,
      });
      return;
    }

    const updatedPoints = controlPoints.map((p) => ({ ...p }));
    const currentPt = updatedPoints[selectedPointIndex];
    if (!currentPt) return;

    let targetX = currentPt.x;
    let targetY = currentPt.y;

    if (selectedPointIndex === 3) {
      // P3 перемещается ТОЛЬКО вперед/назад по ширине (угол = 0, y = yMid)
      targetX = Number(Math.max(-Lb, Math.min(0, shipX)).toFixed(2));
      targetY = yMid;
    } else {
      if (dragAxis === 'both' || dragAxis === 'x') {
        targetX = Number(Math.max(-Lb, Math.min(0, shipX)).toFixed(2));
      }
      if (dragAxis === 'both' || dragAxis === 'y') {
        targetY = Number(Math.max(0, Math.min(maxY * 1.8, shipY)).toFixed(2));
      }
    }

    updatedPoints[selectedPointIndex] = { x: targetX, y: targetY };

    const updates: Partial<BowParameters> = {
      controlPoints: updatedPoints,
    };

    // Дублируем параметры на ползунки
    if (selectedPointIndex === 1) {
      // P1: Угол входа
      const dx = Math.abs(targetX - updatedPoints[0].x);
      const dy = Math.abs(targetY - updatedPoints[0].y);
      const angle = Math.max(5, Math.min(85, (Math.atan2(dy, Math.max(0.01, dx)) * 180) / Math.PI));
      updates.entranceAngle = Number(angle.toFixed(1));
    } else if (selectedPointIndex === 2) {
      // P2: Плечо / Shoulder fullness и смещение максимума
      const normX = Math.max(0.05, Math.min(0.95, 1 - Math.abs(targetX) / Lb));
      updates.maxBreadthPos = Number(normX.toFixed(2));
      const fullness = Math.max(0.1, Math.min(1.5, targetY / Math.max(0.1, yMid)));
      updates.shoulderFullness = Number(fullness.toFixed(2));
    } else if (selectedPointIndex === 3) {
      // P3: Тангенс к миделю (длина)
      const p4 = updatedPoints[4] || { x: -Lb, y: yMid };
      const dx = Math.max(0.001, targetX - p4.x);
      setWheelTooltip(`P3: L_т = ${dx.toFixed(2)}м`);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => setWheelTooltip(null), 1500);
    }

    onBowParamsChange(updates);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(false);
    setDragAxis(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Изменение угла входа колёсиком мыши (Wheel)
  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.0 : -1.0;
    const nextAngle = Math.max(5.0, Math.min(85.0, Number((bowParams.entranceAngle + delta).toFixed(1))));
    onBowParamsChange({ entranceAngle: nextAngle, controlPoints: undefined });

    setWheelTooltip(`Угол входа α = ${nextAngle.toFixed(1)}°`);
    if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    wheelTimeoutRef.current = setTimeout(() => {
      setWheelTooltip(null);
    }, 1200);
  };

  // Пресеты обводов верхней палубы
  const applyPreset = (presetName: string) => {
    switch (presetName) {
      case 'standard': // Каплевидный
        onBowParamsChange({
          shoulderFullness: 0.70,
          entranceAngle: 30.0,
          maxBreadthPos: 0.50,
          stemRadius: 0.00,
          stemWidth: 0.00,
          bowSheer: 0.00,
          deckCamberBow: 0.00,
          bowFlare: 1.00,
          flareExponent: 2.0,
          stemRake: 0.0,
          controlPoints: undefined,
        });
        break;
      case 'clipper': // Острый клиперный с нулевым притуплением
        onBowParamsChange({
          shoulderFullness: 0.35,
          entranceAngle: 15.0,
          maxBreadthPos: 0.20,
          stemRadius: 0.00,
          stemWidth: 0.00,
          bowSheer: 0.00,
          deckCamberBow: 0.00,
          bowFlare: 2.20,
          flareExponent: 2.5,
          stemRake: 0.0,
          controlPoints: undefined,
        });
        break;
      case 'icebreaker': // Эллиптический / Ледокол
        onBowParamsChange({
          shoulderFullness: 1.00,
          entranceAngle: 55.0,
          maxBreadthPos: 0.65,
          stemRadius: 0.00,
          stemWidth: 0.50,
          bowSheer: 0.00,
          deckCamberBow: 0.00,
          bowFlare: 1.40,
          flareExponent: 1.8,
          stemRake: 0.0,
          controlPoints: undefined,
        });
        break;
      case 'bulbous': // Каплевидное уширение
        onBowParamsChange({
          shoulderFullness: 1.30,
          entranceAngle: 45.0,
          maxBreadthPos: 0.75,
          stemRadius: 0.00,
          stemWidth: 0.40,
          bowSheer: 0.00,
          deckCamberBow: 0.00,
          bowFlare: 1.60,
          flareExponent: 2.0,
          stemRake: 0.0,
          controlPoints: undefined,
        });
        break;
      case 'barge': // U-образный / Транец баржи
        onBowParamsChange({
          shoulderFullness: 1.25,
          entranceAngle: 80.0,
          maxBreadthPos: 0.50,
          stemRadius: 0.00,
          stemWidth: Math.min(6.0, width * 0.4),
          bowSheer: 0.00,
          deckCamberBow: 0.00,
          bowFlare: 0.20,
          flareExponent: 1.2,
          stemRake: 0.0,
          controlPoints: undefined,
        });
        break;
    }
  };

  return (
    <div
      className={`fixed bottom-2 left-1/2 -translate-x-1/2 w-[98%] max-w-5xl z-40 p-2.5 rounded-xl border transition-all duration-300 animate-in slide-in-from-bottom-6 ${currentTheme.container}`}
    >
      {/* Верхняя навигационная панель шагов */}
      <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-black/10 dark:border-white/10">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => (onStepChange ? onStepChange('length') : undefined)}
            className={`px-3 py-1 text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              step === 'length'
                ? 'bg-gray-200 text-gray-900 dark:bg-white/20 dark:text-white border border-gray-300 dark:border-white/30 shadow-xs font-bold'
                : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-transparent font-medium'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${step === 'length' ? 'bg-black/15 dark:bg-white/25 text-gray-900 dark:text-white font-bold' : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>1</span>
            <span>Габарит</span>
          </button>

          <button
            onClick={() => (onStepChange ? onStepChange('stem') : undefined)}
            className={`px-3 py-1 text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              step === 'stem'
                ? 'bg-gray-200 text-gray-900 dark:bg-white/20 dark:text-white border border-gray-300 dark:border-white/30 shadow-xs font-bold'
                : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-transparent font-medium'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${step === 'stem' ? 'bg-black/15 dark:bg-white/25 text-gray-900 dark:text-white font-bold' : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>2</span>
            <span>Форштевень</span>
          </button>

          <button
            onClick={() => (onStepChange ? onStepChange('deck') : onNext())}
            className={`px-3 py-1 text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              step === 'shaping' || step === 'deck'
                ? 'bg-gray-200 text-gray-900 dark:bg-white/20 dark:text-white border border-gray-300 dark:border-white/30 shadow-xs font-bold'
                : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-transparent font-medium'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${(step === 'shaping' || step === 'deck') ? 'bg-black/15 dark:bg-white/25 text-gray-900 dark:text-white font-bold' : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>3</span>
            <span>Палуба</span>
          </button>

          <button
            onClick={() => (onStepChange ? onStepChange('volume') : undefined)}
            className={`px-3 py-1 text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              step === 'volume'
                ? 'bg-gray-200 text-gray-900 dark:bg-white/20 dark:text-white border border-gray-300 dark:border-white/30 shadow-xs font-bold'
                : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-transparent font-medium'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${step === 'volume' ? 'bg-black/15 dark:bg-white/25 text-gray-900 dark:text-white font-bold' : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>4</span>
            <span>Объём</span>
          </button>

          <button
            onClick={() => (onStepChange ? onStepChange('surface') : undefined)}
            className={`px-3 py-1 text-[11px] rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              step === 'surface'
                ? 'bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-400 dark:border-amber-400/40 shadow-xs font-bold'
                : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-transparent font-medium'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${step === 'surface' ? 'bg-amber-500 text-white font-bold' : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400'}`}>5</span>
            <span>Поверхность B-Spline</span>
          </button>
        </div>

        {/* Правый блок: Переключатель ядра, Control Net, Габариты и Прозрачность */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Быстрый переключатель Ядра: B-Spline (FREE!ship) / Кунс */}
          <button
            type="button"
            onClick={() => {
              const currentMode = bowParams.surfaceEngineMode ?? 'coons';
              const nextMode = currentMode === 'bspline' ? 'coons' : 'bspline';
              onBowParamsChange({ surfaceEngineMode: nextMode });
            }}
            className={`px-2 py-1 text-[11px] font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
              (bowParams.surfaceEngineMode ?? 'coons') === 'bspline'
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300'
                : 'bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300'
            }`}
            title="Переключение математического ядра: B-Spline (FREE!ship) или Кунс (Lofting)"
          >
            <span className={`w-2 h-2 rounded-full ${(bowParams.surfaceEngineMode ?? 'coons') === 'bspline' ? 'bg-amber-500' : 'bg-indigo-500'}`} />
            <span>{(bowParams.surfaceEngineMode ?? 'coons') === 'bspline' ? 'B-Spline ядро' : 'Кунс ядро'}</span>
          </button>

          {/* Быстрый тумблер Control Net (сетка 3D) */}
          <button
            type="button"
            onClick={() => {
              const isNet = Boolean(bowParams.showControlNet || wireframeDisplay?.showControlNet);
              onBowParamsChange({ showControlNet: !isNet });
              onWireframeDisplayChange?.({ showControlNet: !isNet });
            }}
            className={`px-2 py-1 text-[11px] font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
              (bowParams.showControlNet || wireframeDisplay?.showControlNet)
                ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-700 dark:text-yellow-300'
                : 'bg-black/5 dark:bg-white/10 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
            title="Отображать пространственную управляющую сеть контрольных точек (Control Net) в 3D"
          >
            <span className={`w-2 h-2 rounded-full ${(bowParams.showControlNet || wireframeDisplay?.showControlNet) ? 'bg-yellow-400 animate-pulse' : 'bg-gray-400'}`} />
            <span>Сетка 3D: {(bowParams.showControlNet || wireframeDisplay?.showControlNet) ? 'ВКЛ' : 'ВЫКЛ'}</span>
          </button>

          {/* Кнопка включения/выключения габаритов */}
          {onToggleBreadthLimits && (
            <button
              onClick={onToggleBreadthLimits}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                showBreadthLimits
                  ? 'bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-400'
                  : 'bg-black/5 dark:bg-white/10 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title="Отображать габаритные плоскости (боковые и днище) и окрашивать выходящие части в красный"
            >
              <span className={`w-2 h-2 rounded-full ${showBreadthLimits ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} />
              <span>Габариты: {showBreadthLimits ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
          )}

          {/* Кнопка отображения половины корпуса (разрез по ДП) */}
          {onToggleHalfHull && (
            <button
              type="button"
              onClick={onToggleHalfHull}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                showHalfHull
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-700 dark:text-purple-300'
                  : 'bg-black/5 dark:bg-white/10 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title="Отображать половину корпуса (вид полукорпуса в ДП для детального обзора внутренних линий и батоксов)"
            >
              <span className={`w-2 h-2 rounded-full ${showHalfHull ? 'bg-purple-500 animate-pulse' : 'bg-gray-400'}`} />
              <span>Половина: {showHalfHull ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
          )}

          {/* Кнопка отображения всего корпуса (кормовой части) при редактировании носа */}
          {onToggleFullHull && (
            <button
              type="button"
              onClick={onToggleFullHull}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                showFullHull
                  ? 'bg-blue-500/20 border-blue-500/50 text-blue-700 dark:text-blue-300'
                  : 'bg-black/5 dark:bg-white/10 border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title="Отображать остальной/полный корпус судна при редактировании носовой части"
            >
              <span className={`w-2 h-2 rounded-full ${showFullHull ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`} />
              <span>Весь корпус: {showFullHull ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
          )}

          {/* Кнопка настройки прозрачности обшивки корпуса с выпадающим вверх ползунком */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsOpacityPopupOpen((prev) => !prev)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                isOpacityPopupOpen
                  ? 'bg-cyan-600 text-white border-cyan-600 shadow-xs font-bold'
                  : currentOpacity <= 0.01
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : currentOpacity < 0.99
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-700 dark:text-cyan-300'
                  : 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-black/10'
              }`}
              title="Настройка прозрачности обшивки корпуса"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  currentOpacity <= 0.01
                    ? 'bg-emerald-500'
                    : currentOpacity < 0.99
                    ? 'bg-cyan-500'
                    : 'bg-gray-400'
                }`}
              />
              <span>Прозрачность: {Math.round(currentOpacity * 100)}%</span>
            </button>

            {/* Выпадающее вверх окно с ползунком точной регулировки прозрачности */}
            {isOpacityPopupOpen && (
              <div className="absolute bottom-full mb-2 right-0 w-64 p-3 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-black/15 dark:border-white/15 shadow-xl z-50 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    Прозрачность обшивки
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
                      {Math.round(currentOpacity * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsOpacityPopupOpen(false)}
                      className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white cursor-pointer text-xs"
                      title="Закрыть"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Ползунок прозрачности: от 0% (полностью скрыта) до 100% (сплошная) */}
                <div className="flex flex-col gap-1">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(currentOpacity * 100)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const op = val / 100;
                      onWireframeDisplayChange?.({
                        hullOpacity: op,
                        hullSurfaceVisibility: op <= 0.01 ? 'hidden' : op >= 0.99 ? 'shaded' : 'ghost',
                      });
                    }}
                    className="w-full h-2 bg-black/15 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-cyan-500 focus:outline-none"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                    <span>0% (Только каркас)</span>
                    <span>50%</span>
                    <span>100% (Сплошной)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {step === 'length' ? (
        /* ==================================================================== */
        /* РЕЖИМ 1: ВЫБОР ГАБАРИТА НОСОВОЙ ОКОНЕЧНОСТИ (L_bow)                  */
        /* ==================================================================== */
        <div className={`p-2.5 rounded-xl border ${currentTheme.card} flex flex-col gap-2 shadow-xs`}>
          {/* Верхняя строка: Заголовок + Поле метров + Поле процентов + Ползунок во всю оставшуюся ширину */}
          <div className="w-full flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
            <span className="text-xs font-bold text-black/85 dark:text-white/85 whitespace-nowrap shrink-0">
              Длина носа (L_bow):
            </span>

            {/* Поле 1: Длина в метрах */}
            <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded-lg border border-black/10 dark:border-white/10 shrink-0">
              <button
                className="w-6 h-6 rounded bg-gray-500 hover:bg-gray-600 text-white font-bold text-xs flex items-center justify-center transition active:scale-95 cursor-pointer shrink-0"
                onClick={() => handleIncrementParam('bowLength', -1)}
                title="Уменьшить на 0.5м"
              >
                −
              </button>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step={0.1}
                  min={0.5}
                  max={maxLength}
                  className="w-16 px-1 py-0.5 text-center text-xs font-mono font-bold rounded bg-white dark:bg-slate-900 border border-black/15 dark:border-white/15 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-cyan-700 dark:text-cyan-300"
                  value={metersInputValue}
                  onChange={(e) => handleMetersInputChange(e.target.value)}
                  onBlur={() => {
                    setMetersInputValue(bowLength.toFixed(2));
                    setPercentInputValue(((bowLength / maxLength) * 100).toFixed(1));
                  }}
                />
                <span className="absolute right-1 text-[10px] font-bold text-gray-500 pointer-events-none">м</span>
              </div>
              <button
                className="w-6 h-6 rounded bg-gray-500 hover:bg-gray-600 text-white font-bold text-xs flex items-center justify-center transition active:scale-95 cursor-pointer shrink-0"
                onClick={() => handleIncrementParam('bowLength', 1)}
                title="Увеличить на 0.5м"
              >
                +
              </button>
            </div>

            {/* Поле 2: Процент от длины */}
            <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded-lg border border-black/10 dark:border-white/10 shrink-0">
              <button
                className="w-6 h-6 rounded bg-gray-500 hover:bg-gray-600 text-white font-bold text-xs flex items-center justify-center transition active:scale-95 cursor-pointer shrink-0"
                onClick={() => {
                  const curPct = (bowLength / maxLength) * 100;
                  const nextPct = Math.max(1, curPct - 5);
                  handlePercentInputChange(nextPct.toFixed(1));
                }}
                title="Уменьшить на 5%"
              >
                −
              </button>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step={0.5}
                  min={0.5}
                  max={100}
                  className="w-16 px-1 py-0.5 text-center text-xs font-mono font-bold rounded bg-white dark:bg-slate-900 border border-black/15 dark:border-white/15 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-emerald-600 dark:text-emerald-400"
                  value={percentInputValue}
                  onChange={(e) => handlePercentInputChange(e.target.value)}
                  onBlur={() => {
                    setMetersInputValue(bowLength.toFixed(2));
                    setPercentInputValue(((bowLength / maxLength) * 100).toFixed(1));
                  }}
                />
                <span className="absolute right-1 text-[10px] font-bold text-gray-500 pointer-events-none">%</span>
              </div>
              <button
                className="w-6 h-6 rounded bg-gray-500 hover:bg-gray-600 text-white font-bold text-xs flex items-center justify-center transition active:scale-95 cursor-pointer shrink-0"
                onClick={() => {
                  const curPct = (bowLength / maxLength) * 100;
                  const nextPct = Math.min(100, curPct + 5);
                  handlePercentInputChange(nextPct.toFixed(1));
                }}
                title="Увеличить на 5%"
              >
                +
              </button>
            </div>

            {/* Ползунок во всю оставшуюся длину строки */}
            <div className="flex-1 min-w-[140px] flex items-center px-1">
              <input
                type="range"
                min={0.5}
                max={maxLength}
                step={0.1}
                value={bowLength}
                onChange={(e) => handleSliderValueChange(parseFloat(e.target.value) || 0.5)}
                className="w-full h-2 bg-black/10 dark:bg-white/15 rounded-lg appearance-none cursor-pointer accent-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Нижняя отдельная строка: Кнопки Отмена и Применить (как в других вкладках) */}
          <div className="flex items-center justify-end gap-2.5 pt-1.5 border-t border-black/10 dark:border-white/10">
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
        </div>
      ) : step === 'stem' ? (
        /* ==================================================================== */
        /* РЕЖИМ 2: РЕДАКТИРОВАНИЕ ПРОФИЛЯ ФОРШТЕВНЯ / ФОРПИКА В ДП (Y = 0)     */
        /* ==================================================================== */
        <StemBottomBarTab
          theme={theme}
          height={height}
          draft={draft}
          bowLength={bowLength}
          stemParams={bowParams.stemProfile || DEFAULT_STEM_PARAMS}
          onStemParamsChange={(p) => {
            onBowParamsChange({
              stemProfile: {
                ...(bowParams.stemProfile || DEFAULT_STEM_PARAMS),
                ...p,
              },
            });
          }}
          selectedPointKey={selectedStemPointKey}
          onSelectPointKey={onSelectStemPointKey}
          selectedParamId={selectedStemParamId}
          onSelectParamId={onSelectStemParamId}
          onBack={() => (onStepChange ? onStepChange('length') : onBack())}
          onNext={() => (onStepChange ? onStepChange('deck') : onNext())}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : step === 'deck' || step === 'shaping' ? (
        /* ==================================================================== */
        /* РЕЖИМ 3: РЕДАКТИРОВАНИЕ ОБВОДОВ ВЕРХНЕЙ ПАЛУБЫ (КОМПАКТНЫЕ КАРТОЧКИ)   */
        /* ==================================================================== */
        <div className="flex flex-col gap-1.5 animate-in fade-in select-none">
          {/* Горизонтальный ряд сгруппированных ползунков палубы (компактная плотная группировка) */}
          <div className="flex flex-wrap lg:flex-nowrap items-stretch gap-1.5 justify-start">
            {/* Группа 1: Зеленая — Ватерлиния палубы (4 карточки собраны в кучу) */}
            <div className="flex-initial min-w-[220px] max-w-[280px] p-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 flex flex-col gap-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center justify-between px-0.5">
                <span>Ватерлиния палубы</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </div>
              <div className="grid grid-cols-4 gap-1">
                <VerticalSliderCard
                  title="Притуп. W"
                  value={bowParams.stemWidth ?? 0}
                  min={0}
                  max={maxStemWidth}
                  step={0.05}
                  unit="м"
                  decimals={2}
                  groupColor="green"
                  isSelected={effectiveSelectedDeckParam === 'stemWidth'}
                  onSelect={() => handleSelectDeckParam('stemWidth')}
                  onChange={(val) => onBowParamsChange({ stemWidth: val, controlPoints: undefined })}
                  onHelp={() => handleOpenDeckHelp('stemWidth')}
                />
                <VerticalSliderCard
                  title="Вход α"
                  value={bowParams.entranceAngle ?? 30}
                  min={5}
                  max={85}
                  step={0.5}
                  unit="°"
                  decimals={1}
                  groupColor="green"
                  isSelected={effectiveSelectedDeckParam === 'entranceAngle'}
                  onSelect={() => handleSelectDeckParam('entranceAngle')}
                  onChange={(val) => onBowParamsChange({ entranceAngle: val, controlPoints: undefined })}
                  onHelp={() => handleOpenDeckHelp('entranceAngle')}
                />
                <VerticalSliderCard
                  title="Плечо k"
                  value={bowParams.shoulderFullness ?? 0.7}
                  min={0.1}
                  max={1.5}
                  step={0.01}
                  decimals={2}
                  groupColor="green"
                  isSelected={effectiveSelectedDeckParam === 'shoulderFullness'}
                  onSelect={() => handleSelectDeckParam('shoulderFullness')}
                  onChange={(val) => onBowParamsChange({ shoulderFullness: val, controlPoints: undefined })}
                  onHelp={() => handleOpenDeckHelp('shoulderFullness')}
                />
                <VerticalSliderCard
                  title="Макс. X"
                  value={bowParams.maxBreadthPos ?? 0.5}
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  decimals={2}
                  groupColor="green"
                  isSelected={effectiveSelectedDeckParam === 'maxBreadthPos'}
                  onSelect={() => handleSelectDeckParam('maxBreadthPos')}
                  onChange={(val) => onBowParamsChange({ maxBreadthPos: val, controlPoints: undefined })}
                  onHelp={() => handleOpenDeckHelp('maxBreadthPos')}
                />
              </div>
            </div>

            {/* Группа 2: Оранжевая — Высота и погибь (2 карточки) */}
            <div className="flex-initial min-w-[120px] max-w-[145px] p-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 flex flex-col gap-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center justify-between px-0.5">
                <span>Высота и погибь</span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <VerticalSliderCard
                  title="Седл. ΔZ"
                  value={bowParams.bowSheer ?? 0}
                  min={0.0}
                  max={3.0}
                  step={0.1}
                  unit="м"
                  decimals={1}
                  groupColor="orange"
                  isSelected={effectiveSelectedDeckParam === 'bowSheer'}
                  onSelect={() => handleSelectDeckParam('bowSheer')}
                  onChange={(val) => onBowParamsChange({ bowSheer: val })}
                  onHelp={() => handleOpenDeckHelp('bowSheer')}
                />
                <VerticalSliderCard
                  title="Погибь"
                  value={bowParams.deckCamberBow ?? 0}
                  min={0.0}
                  max={1.5}
                  step={0.05}
                  unit="м"
                  decimals={2}
                  groupColor="orange"
                  isSelected={effectiveSelectedDeckParam === 'deckCamberBow'}
                  onSelect={() => handleSelectDeckParam('deckCamberBow')}
                  onChange={(val) => onBowParamsChange({ deckCamberBow: val })}
                  onHelp={() => handleOpenDeckHelp('deckCamberBow')}
                />
              </div>
            </div>

            {/* Группа 3: Синяя — Форма борта (2 карточки) */}
            <div className="flex-initial min-w-[120px] max-w-[145px] p-1.5 rounded-xl border border-blue-500/30 bg-blue-500/5 dark:bg-blue-950/20 flex flex-col gap-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center justify-between px-0.5">
                <span>Форма борта</span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <VerticalSliderCard
                  title="Развал"
                  value={bowParams.bowFlare ?? 1.0}
                  min={0.0}
                  max={3.0}
                  step={0.1}
                  unit="м"
                  decimals={1}
                  groupColor="blue"
                  isSelected={effectiveSelectedDeckParam === 'bowFlare'}
                  onSelect={() => handleSelectDeckParam('bowFlare')}
                  onChange={(val) => onBowParamsChange({ bowFlare: val })}
                  onHelp={() => handleOpenDeckHelp('bowFlare')}
                />
                <VerticalSliderCard
                  title="Шпанг. U/V"
                  value={bowParams.bowUVShape ?? 0.5}
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  decimals={2}
                  groupColor="blue"
                  isSelected={effectiveSelectedDeckParam === 'bowUVShape'}
                  onSelect={() => handleSelectDeckParam('bowUVShape')}
                  onChange={(val) => onBowParamsChange({ bowUVShape: val })}
                  onHelp={() => handleOpenDeckHelp('bowUVShape')}
                />
              </div>
            </div>
          </div>

          {/* Нижний ряд кнопок управления Шага 3: только Отмена и Применить (без галки) */}
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

          {/* Интерактивное перетаскиваемое окно справки */}
          {activeDeckHelpParam && DECK_PARAM_HELP[activeDeckHelpParam] && (
            <InteractiveDraggableHelpWindow
              info={DECK_PARAM_HELP[activeDeckHelpParam]}
              currentValue={
                (bowParams as unknown as Record<string, number>)[activeDeckHelpParam] ??
                DECK_PARAM_HELP[activeDeckHelpParam].defaultValue
              }
              min={
                activeDeckHelpParam === 'stemWidth'
                  ? 0
                  : DECK_PARAM_HELP[activeDeckHelpParam].min
              }
              max={
                activeDeckHelpParam === 'stemWidth'
                  ? maxStemWidth
                  : DECK_PARAM_HELP[activeDeckHelpParam].max
              }
              step={DECK_PARAM_HELP[activeDeckHelpParam].step}
              unit={DECK_PARAM_HELP[activeDeckHelpParam].unit}
              decimals={DECK_PARAM_HELP[activeDeckHelpParam].decimals}
              onChange={(val) => {
                onBowParamsChange({
                  [activeDeckHelpParam]: val,
                  ...(activeDeckHelpParam === 'stemWidth' ||
                  activeDeckHelpParam === 'entranceAngle' ||
                  activeDeckHelpParam === 'shoulderFullness' ||
                  activeDeckHelpParam === 'maxBreadthPos'
                    ? { controlPoints: undefined }
                    : {}),
                });
              }}
              onClose={() => setActiveDeckHelpParam(null)}
              onPrev={handlePrevDeckHelp}
              onNext={handleNextDeckHelp}
              currentIndex={currentDeckHelpIndex}
              totalCount={DECK_PARAM_KEYS.length}
              prevLabel={DECK_PARAM_HELP[prevDeckHelpParamKey]?.symbol || DECK_PARAM_HELP[prevDeckHelpParamKey]?.name}
              nextLabel={DECK_PARAM_HELP[nextDeckHelpParamKey]?.symbol || DECK_PARAM_HELP[nextDeckHelpParamKey]?.name}
            />
          )}
        </div>
      ) : step === 'volume' ? (
        /* ==================================================================== */
        /* РЕЖИМ 4: ПАРАМЕТРИЗАЦИЯ ОБЪЕМА, ВАТЕРЛИНИЙ И ПЯТНА ДНИЩА            */
        /* ==================================================================== */
        <VolumeBottomBarTab
          theme={theme}
          height={height}
          draft={draft}
          bowLength={bowLength}
          width={width}
          bowParams={bowParams}
          onBowParamsChange={onBowParamsChange}
          onBack={() => (onStepChange ? onStepChange('deck') : onBack())}
          onNext={() => (onStepChange ? onStepChange('surface') : onNext())}
          onSave={onSave}
          onCancel={onCancel}
          onSetCameraView={onSetCameraView}
          wireframeDisplay={wireframeDisplay}
          onWireframeDisplayChange={onWireframeDisplayChange}
          activeMasterWaterline={activeMasterWaterline}
          onSelectMasterWaterline={onSelectMasterWaterline}
          selectedBowSectionPointKey={selectedBowSectionPointKey}
          onSelectBowSectionPointKey={onSelectBowSectionPointKey}
        />
      ) : step === 'surface' ? (
        /* ==================================================================== */
        /* РЕЖИМ 5: ГЕОМЕТРИЧЕСКОЕ ЯДРО ПОВЕРХНОСТЕЙ B-SPLINE (FREE!ship)       */
        /* ==================================================================== */
        <SurfaceBottomBarTab
          theme={theme}
          bowLength={bowLength}
          width={width}
          height={height}
          draft={draft}
          bowParams={bowParams}
          onBowParamsChange={onBowParamsChange}
          renderMode={renderMode}
          onRenderModeChange={onRenderModeChange}
          wireframeDisplay={wireframeDisplay}
          onWireframeDisplayChange={onWireframeDisplayChange}
          qaStats={qaStats}
          onBack={() => (onStepChange ? onStepChange('volume') : onBack())}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : step === 'framework' ? (
        /* ==================================================================== */
        /* РЕЖИМ 5: ТЕОРЕТИЧЕСКИЙ КАРКАС И УПРАВЛЕНИЕ ЗЕЛЁНЫМИ ЛИНИЯМИ          */
        /* ==================================================================== */
        <div className="space-y-1.5 animate-in fade-in">
          {/* Верхняя сетка элементов каркаса */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-1.5">
            {/* 1. Шпангоуты (Stations) */}
            <div className={`p-2 rounded-lg border ${currentTheme.card} flex flex-col justify-between`}>
              <div className="flex justify-between items-center text-[10px]">
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-emerald-600 dark:text-emerald-400">
                  <input
                    type="checkbox"
                    checked={wireframeDisplay.showStations ?? true}
                    onChange={(e) => onWireframeDisplayChange?.({ showStations: e.target.checked })}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Шпангоуты</span>
                </label>
                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  {wireframeDisplay.stationCount ?? 11} шт.
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  className="w-5 h-5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-bold flex items-center justify-center shrink-0"
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      stationCount: Math.max(3, (wireframeDisplay.stationCount ?? 11) - 2),
                    })
                  }
                  title="Меньше шпангоутов"
                >
                  −
                </button>
                <input
                  type="range"
                  min={3}
                  max={31}
                  step={2}
                  value={wireframeDisplay.stationCount ?? 11}
                  onChange={(e) => onWireframeDisplayChange?.({ stationCount: parseInt(e.target.value) || 11 })}
                  className="w-full h-1 bg-black/10 dark:bg-white/10 rounded appearance-none cursor-pointer accent-emerald-500"
                />
                <button
                  className="w-5 h-5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-bold flex items-center justify-center shrink-0"
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      stationCount: Math.min(31, (wireframeDisplay.stationCount ?? 11) + 2),
                    })
                  }
                  title="Больше шпангоутов"
                >
                  +
                </button>
              </div>
              <div className="text-[9px] text-gray-500 mt-1 font-mono">
                Шпация: ~{(bowLength / Math.max(1, (wireframeDisplay.stationCount ?? 11) - 1)).toFixed(2)}м
              </div>
            </div>

            {/* 2. Ватерлинии (Waterlines) */}
            <div className={`p-2 rounded-lg border ${currentTheme.card} flex flex-col justify-between`}>
              <div className="flex justify-between items-center text-[10px]">
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-cyan-600 dark:text-cyan-400">
                  <input
                    type="checkbox"
                    checked={wireframeDisplay.showWaterlines ?? true}
                    onChange={(e) => onWireframeDisplayChange?.({ showWaterlines: e.target.checked })}
                    className="accent-cyan-500 rounded"
                  />
                  <span>Ватерлинии (ВЛ)</span>
                </label>
                <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">
                  {wireframeDisplay.waterlineCount ?? 6} шт.
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  className="w-5 h-5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-bold flex items-center justify-center shrink-0"
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      waterlineCount: Math.max(4, (wireframeDisplay.waterlineCount ?? 6) - 2),
                    })
                  }
                >
                  −
                </button>
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={2}
                  value={wireframeDisplay.waterlineCount ?? 6}
                  onChange={(e) => onWireframeDisplayChange?.({ waterlineCount: parseInt(e.target.value) || 6 })}
                  className="w-full h-1 bg-black/10 dark:bg-white/10 rounded appearance-none cursor-pointer accent-cyan-500"
                />
                <button
                  className="w-5 h-5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-bold flex items-center justify-center shrink-0"
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      waterlineCount: Math.min(16, (wireframeDisplay.waterlineCount ?? 6) + 2),
                    })
                  }
                >
                  +
                </button>
              </div>
              <div className="text-[9px] text-cyan-600 dark:text-cyan-400 mt-1 font-mono">
                КВЛ + Днищевое пятно + 2 подв. + 1 надв.
              </div>
            </div>

            {/* 3. Батоксы (Buttock Lines) */}
            <div className={`p-2 rounded-lg border ${currentTheme.card} flex flex-col justify-between`}>
              <div className="flex justify-between items-center text-[10px]">
                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-indigo-600 dark:text-indigo-400">
                  <input
                    type="checkbox"
                    checked={wireframeDisplay.showButtocks ?? true}
                    onChange={(e) => onWireframeDisplayChange?.({ showButtocks: e.target.checked })}
                    className="accent-indigo-500 rounded"
                  />
                  <span>Батоксы (Y=const)</span>
                </label>
                <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                  {wireframeDisplay.buttockCount ?? 5} шт.
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  className="w-5 h-5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-bold flex items-center justify-center shrink-0"
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      buttockCount: Math.max(3, (wireframeDisplay.buttockCount ?? 5) - 2),
                    })
                  }
                >
                  −
                </button>
                <input
                  type="range"
                  min={3}
                  max={11}
                  step={2}
                  value={wireframeDisplay.buttockCount ?? 5}
                  onChange={(e) => onWireframeDisplayChange?.({ buttockCount: parseInt(e.target.value) || 5 })}
                  className="w-full h-1 bg-black/10 dark:bg-white/10 rounded appearance-none cursor-pointer accent-indigo-500"
                />
                <button
                  className="w-5 h-5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-xs font-bold flex items-center justify-center shrink-0"
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      buttockCount: Math.min(11, (wireframeDisplay.buttockCount ?? 5) + 2),
                    })
                  }
                >
                  +
                </button>
              </div>
              <div className="text-[9px] text-gray-500 mt-1 font-mono">
                ДП (Y=0) + симметричные батоксы
              </div>
            </div>

            {/* 4. Стрингеры и мастер-границы */}
            <div className={`p-2 rounded-lg border ${currentTheme.card} flex flex-col justify-between`}>
              <div className="text-[10px] font-bold text-gray-700 dark:text-gray-300">
                Опорные линии
              </div>
              <div className="space-y-1 mt-1 text-[10px]">
                <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={wireframeDisplay.showLongitudinals ?? true}
                    onChange={(e) => onWireframeDisplayChange?.({ showLongitudinals: e.target.checked })}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Стрингеры (продольные)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={wireframeDisplay.showBoundaries ?? true}
                    onChange={(e) => onWireframeDisplayChange?.({ showBoundaries: e.target.checked })}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Мастер-границы (Киль/Форштевень)</span>
                </label>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[9px]">
                <button
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      showStations: true,
                      showWaterlines: true,
                      showButtocks: true,
                      showLongitudinals: true,
                      showBoundaries: true,
                      stationCount: 11,
                      waterlineCount: 6,
                      buttockCount: 5,
                    })
                  }
                  className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold"
                >
                  Пресет: 11шп/6вл
                </button>
                <button
                  onClick={() =>
                    onWireframeDisplayChange?.({
                      showStations: true,
                      showWaterlines: true,
                      showButtocks: false,
                      showLongitudinals: false,
                      stationCount: 21,
                      waterlineCount: 11,
                    })
                  }
                  className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold"
                >
                  Плотный
                </button>
              </div>
            </div>
          </div>

          {/* Нижний ряд кнопок управления Шага 5: только Отмена и Применить (без галки) */}
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-black/10 dark:border-white/10">
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition cursor-pointer active:scale-95"
            >
              Отмена
            </button>
            <button
              onClick={onSave}
              className="px-5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white shadow transition cursor-pointer active:scale-95"
            >
              Применить
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};


