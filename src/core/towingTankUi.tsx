/**
 * ====================================================================================================
 * 📁 src/core/towingTankUi.tsx
 * ====================================================================================================
 * 📌 НАЗНАЧЕНИЕ:
 * Высокоточный инженерный HUD-интерфейс режима «Виртуальный опытовый бассейн» (Virtual Towing Tank):
 * 1. Интерактивное управление скоростью хода судна (0..35 узлов, пресеты, число Фруда Fn).
 * 2. Переключатели визуальных слоев (Давление Бернулли, Линии тока, Брызги, Волны Кельвина, Дифферент).
 * 3. Карточки телеметрии (R_T, R_F, R_W, P_E, Trim, Heave, Bow Wave, Deck Safety Index).
 * 4. Пресеты ракурсов камеры для удобного гидродинамического анализа.
 * 5. Быстрая оперативная подстройка угла входа и бульба с моментальным откликом гидродинамики.
 * ====================================================================================================
 */

import React, { useState } from 'react';
import { HydroTelemetry } from './hydroEngine';
import { TowingTankVisualOptions } from './towingTankEngine';
import { BowParameters } from './topologyTypes';
import { ShipLogo } from './Logo';

export interface TowingTankUiProps {
  telemetry: HydroTelemetry;
  speedKnots: number;
  onSpeedChange: (speed: number) => void;
  visualOptions: TowingTankVisualOptions;
  onVisualOptionsChange: (opts: Partial<TowingTankVisualOptions>) => void;
  bowParams: BowParameters;
  onBowParamsChange: (partial: Partial<BowParameters>) => void;
  onExit: () => void;
  onSetCameraView: (view: 'isometric' | 'profile' | 'bow' | 'top' | 'wake') => void;
}

export const TowingTankUi: React.FC<TowingTankUiProps> = ({
  telemetry,
  speedKnots,
  onSpeedChange,
  visualOptions,
  onVisualOptionsChange,
  bowParams,
  onBowParamsChange,
  onExit,
  onSetCameraView,
}) => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'tuning'>('telemetry');

  // Пресеты скоростей
  const speedPresets = [
    { label: 'Малый ход', knots: 8.0 },
    { label: 'Эконом', knots: 14.0 },
    { label: 'Крейсерский', knots: 18.5 },
    { label: 'Полный', knots: 24.0 },
    { label: 'Форсаж', knots: 30.0 },
  ];

  const entranceAngle = bowParams.entranceAngle ?? 30;
  const bulbLength = bowParams.stemProfile?.bulbLength ?? 0;
  const shoulderFullness = bowParams.shoulderFullness ?? 0.7;

  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-4 md:p-6 select-none">
      {/* ───────────────────────────────────────────────────────────── */}
      {/* ВЕРХНЯЯ ПАНЕЛЬ: ЗАГОЛОВОК, КНОПКА ВЫХОДА И РАКУРСЫ КАМЕРЫ   */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 text-white px-5 py-3 rounded-2xl backdrop-blur-md shadow-2xl border border-cyan-500/30 pointer-events-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 font-bold text-xs uppercase tracking-wider rounded-xl border border-cyan-500/40 transition flex items-center gap-1.5 cursor-pointer active:scale-95"
            title="Вернуться в 3D редактор корпуса"
          >
            <span>◄</span> Редактор формы
          </button>
          <div className="h-5 w-[1px] bg-slate-700 hidden sm:block" />
          <div className="flex items-center gap-2.5">
            <ShipLogo size={28} inverted={true} />
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm uppercase tracking-wider text-cyan-300">
                  Виртуальный опытовый бассейн
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 hidden md:inline font-mono">
                  ITTC-1957 & Holtrop-Mennen CFD Express
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Быстрые ракурсы камеры */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl text-xs">
          <span className="text-slate-400 font-medium px-1.5 hidden lg:inline">Ракурс:</span>
          <button
            onClick={() => onSetCameraView('isometric')}
            className="px-2 py-1 rounded-lg hover:bg-cyan-600/30 text-slate-200 hover:text-white transition font-medium text-[11px]"
          >
            📐 Изометрия
          </button>
          <button
            onClick={() => onSetCameraView('profile')}
            className="px-2 py-1 rounded-lg hover:bg-cyan-600/30 text-slate-200 hover:text-white transition font-medium text-[11px]"
          >
            🚢 Профиль
          </button>
          <button
            onClick={() => onSetCameraView('bow')}
            className="px-2 py-1 rounded-lg hover:bg-cyan-600/30 text-slate-200 hover:text-white transition font-medium text-[11px]"
          >
            🌊 Носовой бурун
          </button>
          <button
            onClick={() => onSetCameraView('top')}
            className="px-2 py-1 rounded-lg hover:bg-cyan-600/30 text-slate-200 hover:text-white transition font-medium text-[11px]"
          >
            🌐 Линии тока
          </button>
          <button
            onClick={() => onSetCameraView('wake')}
            className="px-2 py-1 rounded-lg hover:bg-cyan-600/30 text-slate-200 hover:text-white transition font-medium text-[11px]"
          >
            ⚓ След Кельвина
          </button>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* СРЕДНЯЯ ЗОНА: ЛЕВАЯ И ПРАВАЯ ИНЖЕНЕРНЫЕ ПАНЕЛИ               */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row items-start justify-between gap-4 my-3 pointer-events-none overflow-hidden">
        {/* ЛЕВАЯ ПАНЕЛЬ: УПРАВЛЕНИЕ СКОРОСТЬЮ, РЕЖИМАМИ И СЛОЯМИ */}
        <div className="w-full md:w-96 bg-slate-900/90 text-white p-4 rounded-2xl backdrop-blur-md shadow-2xl border border-slate-700/60 pointer-events-auto space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Секция 1: Скорость хода */}
          <div className="space-y-2 pb-3 border-b border-slate-800">
            <div className="flex justify-between items-baseline">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-400">
                Скорость хода (V)
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black font-mono text-cyan-400">
                  {speedKnots.toFixed(1)}
                </span>
                <span className="text-xs text-slate-400">узлов</span>
                <span className="text-xs text-slate-500 font-mono">({telemetry.speedMs} м/с)</span>
              </div>
            </div>

            {/* Ползунок скорости */}
            <input
              type="range"
              min="0.5"
              max="35"
              step="0.5"
              value={speedKnots}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />

            {/* Пресеты скоростей */}
            <div className="grid grid-cols-5 gap-1 pt-1">
              {speedPresets.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => onSpeedChange(p.knots)}
                  className={`py-1 text-[10px] font-bold rounded-md border transition active:scale-95 ${
                    Math.abs(speedKnots - p.knots) < 0.3
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {p.knots} уз
                </button>
              ))}
            </div>

            {/* Число Фруда Fn и режим движения */}
            <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
              <div>
                <span className="text-slate-400 font-medium">Число Фруда: </span>
                <span className="font-mono font-bold text-cyan-300">Fn = {telemetry.froudeNumber}</span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  telemetry.regime === 'displacement'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : telemetry.regime === 'semi-displacement'
                    ? 'bg-amber-950 text-amber-400 border border-amber-800'
                    : 'bg-red-950 text-red-400 border border-red-800'
                }`}
              >
                {telemetry.regime === 'displacement'
                  ? 'Водоизмещающий'
                  : telemetry.regime === 'semi-displacement'
                  ? 'Переходный'
                  : 'Глиссирование'}
              </span>
            </div>
          </div>

          {/* Секция 2: Слои визуализации симуляции */}
          <div className="space-y-2 pb-2">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400 block mb-1">
              Слои визуализации
            </span>

            <div className="grid grid-cols-1 gap-1.5 text-xs font-medium">
              <label className="flex items-center justify-between p-2 bg-slate-800/60 rounded-xl hover:bg-slate-800 cursor-pointer transition">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <span>Поле давлений Бернулли</span>
                </span>
                <input
                  type="checkbox"
                  checked={visualOptions.showPressureHeatmap}
                  onChange={(e) => onVisualOptionsChange({ showPressureHeatmap: e.target.checked })}
                  className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 bg-slate-800/60 rounded-xl hover:bg-slate-800 cursor-pointer transition">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  <span>Линии тока обтекания (3D)</span>
                </span>
                <input
                  type="checkbox"
                  checked={visualOptions.showStreamlines}
                  onChange={(e) => onVisualOptionsChange({ showStreamlines: e.target.checked })}
                  className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 bg-slate-800/60 rounded-xl hover:bg-slate-800 cursor-pointer transition">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-300" />
                  <span>Бурун и срыв брызг</span>
                </span>
                <input
                  type="checkbox"
                  checked={visualOptions.showSpray}
                  onChange={(e) => onVisualOptionsChange({ showSpray: e.target.checked })}
                  className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 bg-slate-800/60 rounded-xl hover:bg-slate-800 cursor-pointer transition">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  <span>Волновой след Кельвина</span>
                </span>
                <input
                  type="checkbox"
                  checked={visualOptions.showKelvinWake}
                  onChange={(e) => onVisualOptionsChange({ showKelvinWake: e.target.checked })}
                  className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 bg-slate-800/60 rounded-xl hover:bg-slate-800 cursor-pointer transition">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span>Динамическая посадка (Squat)</span>
                </span>
                <input
                  type="checkbox"
                  checked={visualOptions.showDynamicAttitude}
                  onChange={(e) => onVisualOptionsChange({ showDynamicAttitude: e.target.checked })}
                  className="w-4 h-4 accent-cyan-400 rounded cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Быстрая оперативная подстройка формы (Live-tuning) */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400 block">
              Быстрая проверка параметров формы
            </span>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Угол входа КВЛ (α):</span>
                  <span className="font-mono text-cyan-300 font-bold">{entranceAngle.toFixed(1)}°</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="1"
                  value={entranceAngle}
                  onChange={(e) => onBowParamsChange({ entranceAngle: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Вынос бульба (L_bulb):</span>
                  <span className="font-mono text-cyan-300 font-bold">{bulbLength.toFixed(1)} м</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={bulbLength}
                  onChange={(e) => {
                    const nextVal = parseFloat(e.target.value);
                    onBowParamsChange({
                      stemProfile: {
                        ...(bowParams.stemProfile || {}),
                        bulbLength: nextVal,
                      },
                    });
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-cyan-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ПРАВАЯ ПАНЕЛЬ: ЭКСПРЕСС-ТЕЛЕМЕТРИЯ И ГИДРОДИНАМИКА */}
        <div className="w-full md:w-[420px] bg-slate-900/90 text-white p-4 rounded-2xl backdrop-blur-md shadow-2xl border border-slate-700/60 pointer-events-auto space-y-3.5 max-h-[78vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs uppercase font-bold tracking-wider text-cyan-400 flex items-center gap-1.5">
              <span>📊</span> Экспресс-телеметрия гидродинамики
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              S_wet = {telemetry.wettedSurfaceArea} м²
            </span>
          </div>

          {/* Главная метрика: Полное сопротивление и Мощность */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                Полное сопр. (R_T)
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-amber-400">
                  {telemetry.totalResistanceKN}
                </span>
                <span className="text-xs text-slate-400">кН</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                {(telemetry.totalResistanceKN / 9.81).toFixed(1)} тонн тяги
              </span>
            </div>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                Буксир. мощность (P_E)
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-cyan-400">
                  {telemetry.effectivePowerKW > 1000
                    ? (telemetry.effectivePowerKW / 1000).toFixed(2)
                    : telemetry.effectivePowerKW}
                </span>
                <span className="text-xs text-slate-400">
                  {telemetry.effectivePowerKW > 1000 ? 'МВт' : 'кВт'}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                {telemetry.effectivePowerHP.toLocaleString()} л.с.
              </span>
            </div>
          </div>

          {/* Структура сопротивления: Трение против Волн */}
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-300">Баланс сопротивления:</span>
              <span className="text-[11px] font-mono text-slate-400">
                1+k = {telemetry.formFactor}
              </span>
            </div>

            {/* Двухцветный прогресс-бар */}
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${telemetry.frictionRatioPercent}%` }}
                className="bg-emerald-500 h-full transition-all duration-300"
                title={`Трение: ${telemetry.frictionResistanceKN} кН (${telemetry.frictionRatioPercent}%)`}
              />
              <div
                style={{ width: `${telemetry.waveRatioPercent}%` }}
                className="bg-cyan-500 h-full transition-all duration-300"
                title={`Волновое: ${telemetry.waveResistanceKN} кН (${telemetry.waveRatioPercent}%)`}
              />
            </div>

            <div className="flex justify-between text-[11px] font-mono">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Трение R_F: {telemetry.frictionResistanceKN} кН ({telemetry.frictionRatioPercent}%)</span>
              </div>
              <div className="flex items-center gap-1.5 text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-cyan-500" />
                <span>Волны R_W: {telemetry.waveResistanceKN} кН ({telemetry.waveRatioPercent}%)</span>
              </div>
            </div>

            {telemetry.bulbEffectKN > 0 && (
              <div className="text-[10px] text-emerald-300 bg-emerald-950/60 px-2 py-1 rounded-lg border border-emerald-800 flex justify-between">
                <span>Эффект волногашения бульбом:</span>
                <span className="font-bold font-mono">−{telemetry.bulbEffectKN} кН экономии</span>
              </div>
            )}
          </div>

          {/* Мореходные качества, дифферент и заливаемость палубы */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                Ходовой дифферент (θ)
              </span>
              <span className="text-base font-bold font-mono text-slate-200">
                {telemetry.dynamicTrimDeg > 0 ? `+${telemetry.dynamicTrimDeg}° (нос)` : `${telemetry.dynamicTrimDeg}° (корма)`}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
                Просадка: {(telemetry.dynamicSinkageM * 100).toFixed(1)} см
              </span>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                Носовой бурун (ζ_bow)
              </span>
              <span className="text-base font-bold font-mono text-cyan-300">
                {telemetry.bowWaveHeightM} м
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
                Борт: {telemetry.bowFreeboardM} м
              </span>
            </div>
          </div>

          {/* Индикатор заливаемости палубы */}
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Защита палубы от заливания
              </span>
              <span className="text-xs font-semibold text-slate-300">
                {telemetry.deckSafetyStatus === 'safe'
                  ? 'Безопасно (Сухой бак)'
                  : telemetry.deckSafetyStatus === 'warning'
                  ? 'Умеренное брызгообразование'
                  : 'Опасность заливания палубы!'}
              </span>
            </div>
            <div
              className={`px-3 py-1.5 rounded-xl text-center font-mono font-black text-sm border ${
                telemetry.deckSafetyStatus === 'safe'
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-700'
                  : telemetry.deckSafetyStatus === 'warning'
                  ? 'bg-amber-950 text-amber-400 border-amber-700'
                  : 'bg-red-950 text-red-400 border-red-700 animate-pulse'
              }`}
            >
              {telemetry.deckSafetyIndex}%
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* НИЖНЯЯ ЦВЕТОВАЯ ШКАЛА ДАВЛЕНИЯ БЕРНУЛЛИ                       */}
      {/* ───────────────────────────────────────────────────────────── */}
      {visualOptions.showPressureHeatmap && (
        <div className="self-center bg-slate-900/90 text-white px-5 py-2.5 rounded-2xl backdrop-blur-md shadow-2xl border border-slate-700/60 pointer-events-auto flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 hidden sm:inline">
            Шкала давления Cp:
          </span>
          <span className="text-[11px] font-mono text-cyan-400 font-bold">−1.0 (Разрежение)</span>
          <div className="w-48 sm:w-64 h-3 rounded-full bg-gradient-to-r from-blue-700 via-cyan-400 via-emerald-400 via-amber-400 to-red-600 border border-slate-600" />
          <span className="text-[11px] font-mono text-red-400 font-bold">+1.0 (Торможение)</span>
        </div>
      )}
    </div>
  );
};
