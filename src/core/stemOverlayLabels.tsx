import React from 'react';
import { StemPointKey, StemTopologyPoints, STEM_ZONES } from './stemEngine';

export const STEM_LABELS_RU: Record<StemPointKey, { name: string; desc: string }> = {
  PT_STEM_DECK: { name: 'Палуба', desc: 'Верхняя носовая точка палубы (Z = H)' },
  CTRL_STEM_UPPER: { name: 'Кас. палубы (Угол)', desc: 'Угол касательной сплайна форштевня (Колёсико мыши / Drag)' },
  PT_STEM_KNUCKLE: { name: 'Кнакл (Излом)', desc: 'Точка излома форштевня / ледовый зуб' },
  PT_STEM_DWL: { name: 'КВЛ', desc: 'Конструктивная ватерлиния (Фикс. 0.0, T)' },
  CTRL_STEM_BULB_UPPER: { name: 'Кас. КВЛ-бульб (Угол)', desc: 'Угол касательной перехода от КВЛ к носку бульба' },
  PT_BULB_APEX: { name: 'Носок бульба', desc: 'Крайняя передняя точка капли бульба' },
  CTRL_STEM_BULB_LOWER: { name: 'Кас. бульб-пятка (Угол)', desc: 'Угол касательной перехода от носка бульба к пятке' },
  PT_FOREFOOT: { name: 'Пятка (Подзор)', desc: 'Нижняя точка перехода форштевня' },
  PT_KEEL_TANGENT: { name: 'Линия киля', desc: 'Точка сопряжения с килем (Z = 0)' },
};

/**
 * Определение принадлежности точки форштевня к одной из трех функциональных зон
 * Зона 1: Волнорезная часть (от ПВ до КВЛ) - цвет небесно-голубой (#38bdf8)
 * Зона 2: Пятка (от КВЛ до пятки) - цвет изумрудно-зеленый (#10b981)
 * Зона 3: Носовое плечо (от пятки до конца / миделя) - цвет янтарный (#f59e0b)
 */
export function getStemPointZone(key: StemPointKey): {
  id: 'wavebreaker' | 'forefoot' | 'shoulder';
  label: string;
  dotColor: string;
  badgeClass: string;
  title: string;
} {
  if (key === 'PT_STEM_DECK' || key === 'CTRL_STEM_UPPER' || key === 'PT_STEM_KNUCKLE') {
    return {
      id: 'wavebreaker',
      label: '1. Волнорез',
      dotColor: 'bg-sky-400',
      badgeClass: 'bg-sky-950/80 text-sky-300 border border-sky-500/50',
      title: 'Зона 1: Волнорезная часть (от ПВ до КВЛ)',
    };
  }
  if (key === 'PT_KEEL_TANGENT') {
    return {
      id: 'shoulder',
      label: '3. Плечо',
      dotColor: 'bg-amber-400',
      badgeClass: 'bg-amber-950/80 text-amber-300 border border-amber-500/50',
      title: 'Зона 3: Носовое плечо (от пятки до конца / миделя)',
    };
  }
  return {
    id: 'forefoot',
    label: '2. Пятка',
    dotColor: 'bg-emerald-400',
    badgeClass: 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50',
    title: 'Зона 2: Пятка (от КВЛ до пятки)',
  };
}

// Фиксированный вертикальный порядок расположения плашек справа сверху вниз (от палубы к килю)
export const STEM_ORDER: StemPointKey[] = [
  'PT_STEM_DECK',
  'CTRL_STEM_UPPER',
  'PT_STEM_KNUCKLE',
  'PT_STEM_DWL',
  'CTRL_STEM_BULB_UPPER',
  'PT_BULB_APEX',
  'CTRL_STEM_BULB_LOWER',
  'PT_FOREFOOT',
  'PT_KEEL_TANGENT',
];

interface StemOverlayLabelsProps {
  stemPts: StemTopologyPoints | null;
  selectedStemPointKey: StemPointKey | null;
  onSelectStemPointKey: (key: StemPointKey) => void;
  deckTangentAngle?: number;
  bulbUpperTangentAngle?: number;
  bulbLowerTangentAngle?: number;
}

export const StemOverlayLabels: React.FC<StemOverlayLabelsProps> = ({
  stemPts,
  selectedStemPointKey,
  onSelectStemPointKey,
  deckTangentAngle,
  bulbUpperTangentAngle,
  bulbLowerTangentAngle,
}) => {
  if (!stemPts) return null;

  return (
    <div className="absolute top-16 right-6 bottom-28 w-64 md:w-72 flex flex-col justify-between py-1 z-20 pointer-events-auto select-none">
      {/* Верхний компактный индикатор трех зон форштевня */}
      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/70 text-[10px] backdrop-blur-md shadow-md mb-1">
        <span className="flex items-center gap-1 text-sky-400 font-medium" title="1. Волнорезная часть: от ПВ до КВЛ">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          1. Волнорез
        </span>
        <span className="flex items-center gap-1 text-emerald-400 font-medium" title="2. Пятка: от КВЛ до пятки">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          2. Пятка
        </span>
        <span className="flex items-center gap-1 text-amber-400 font-medium" title="3. Носовое плечо: от пятки до конца">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          3. Плечо
        </span>
      </div>

      {STEM_ORDER.map((key) => {
        const pt = stemPts[key];
        if (!pt) return null;

        const isSel = selectedStemPointKey === key;
        const isCtrl = key.startsWith('CTRL_');
        const isDwl = key === 'PT_STEM_DWL';
        const meta = STEM_LABELS_RU[key];
        const zoneInfo = getStemPointZone(key);

        let coordText: string;
        if (isDwl) {
          coordText = 'L_квл: 0.00м (Фикс)';
        } else if (key === 'CTRL_STEM_UPPER') {
          const angle = deckTangentAngle !== undefined ? deckTangentAngle : 18;
          coordText = `Угол: ${angle >= 0 ? '+' : ''}${angle.toFixed(1)}° (Скролл ⟳)`;
        } else if (key === 'CTRL_STEM_BULB_UPPER') {
          const angle = bulbUpperTangentAngle !== undefined ? bulbUpperTangentAngle : 55;
          coordText = `Угол: ${angle >= 0 ? '+' : ''}${angle.toFixed(1)}° (Скролл ⟳)`;
        } else if (key === 'CTRL_STEM_BULB_LOWER') {
          const angle = bulbLowerTangentAngle !== undefined ? bulbLowerTangentAngle : 55;
          coordText = `Угол: ${angle >= 0 ? '+' : ''}${angle.toFixed(1)}° (Скролл ⟳)`;
        } else {
          coordText = `X: ${pt.x >= 0 ? '+' : ''}${pt.x.toFixed(2)}м  Z: ${pt.z.toFixed(2)}м`;
        }

        return (
          <div
            key={key}
            onClick={() => onSelectStemPointKey(key)}
            title={meta?.desc}
            className={`group flex items-center justify-between px-3 py-1.5 rounded-lg border text-left cursor-pointer transition-all duration-150 backdrop-blur-md shadow-md ${
              isSel
                ? 'bg-amber-500 border-amber-300 text-slate-950 ring-2 ring-amber-400/60 scale-[1.03] shadow-amber-500/30 font-medium'
                : isDwl
                ? 'bg-slate-900/85 border-slate-700/60 text-slate-400 hover:border-slate-500 hover:bg-slate-800/90'
                : isCtrl
                ? 'bg-slate-900/85 border-violet-500/50 text-violet-100 hover:border-violet-400 hover:bg-slate-850'
                : zoneInfo.id === 'wavebreaker'
                ? 'bg-slate-900/85 border-sky-500/40 text-slate-100 hover:border-sky-400 hover:bg-slate-850'
                : zoneInfo.id === 'forefoot'
                ? 'bg-slate-900/85 border-emerald-500/40 text-slate-100 hover:border-emerald-400 hover:bg-slate-850'
                : 'bg-slate-900/85 border-amber-500/40 text-slate-100 hover:border-amber-400 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 pr-1">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-150 ${
                  isSel ? 'bg-slate-950 shadow-inner' : zoneInfo.dotColor
                }`}
              />
              <div className="truncate">
                <div
                  className={`text-xs leading-tight truncate ${
                    isSel
                      ? 'text-slate-950 font-bold'
                      : isCtrl
                      ? 'text-violet-300 font-semibold'
                      : 'text-slate-100 font-semibold'
                  }`}
                >
                  {meta ? meta.name : key}
                </div>
                <div
                  className={`text-[10px] font-mono leading-none mt-0.5 truncate ${
                    isSel ? 'text-slate-900 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {coordText}
                </div>
              </div>
            </div>

            {/* Метка зоны и типа точки */}
            <div className="flex items-center gap-1 shrink-0">
              <span
                className={`text-[8px] px-1 py-0.5 rounded font-mono shrink-0 ${
                  isSel ? 'bg-slate-950/20 text-slate-950 font-bold' : zoneInfo.badgeClass
                }`}
                title={zoneInfo.title}
              >
                {zoneInfo.label}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider shrink-0 transition-colors ${
                  isSel
                    ? 'bg-slate-950/20 text-slate-950 font-bold'
                    : isDwl
                    ? 'bg-slate-800 text-slate-400 border border-slate-700'
                    : isCtrl
                    ? 'bg-violet-950/80 text-violet-300 border border-violet-600/70'
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                {isDwl ? 'КВЛ' : isCtrl ? '⟳' : 'ТОЧКА'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
