/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/Logo.tsx
 * ====================================================================================================
 * 
 * ⚠️ СТРОГОЕ АРХИТЕКТУРНОЕ ПРАВИЛО ПРОЕКТА (LIGHT THEME ONLY):
 * ВЕСЬ ИНТЕРФЕЙС И ЗАГРУЗОЧНАЯ ЗАСТАВКА В СВЕТЛЫХ ОТТЕНКАХ!
 * Минималистичный стиль: только белое пространство (bg-white), анимация прилета цифр
 * по сплайновым обводам судна и их волновая кристаллизация в цветные ленты официального логотипа.
 * Никакого лишнего текста, полос загрузки или сторонних виджетов.
 * 
 * ⏱️ ТАЙМИНГ АНИМАЦИИ:
 * Точное время как в исходной программе:
 * - 0.0 - 1.0 сек: Подготовка траекторий
 * - 1.0 - 5.0 сек: Поток и разгон цифр по 20 сплайновым обводам
 * - 5.0 - 7.0 сек: Волновая кристаллизация цифр в гладкие цветные ленты
 * - 7.0 сек: Логотип сформирован -> плавное уменьшение и перелет в левый верхний угол к навигационной панели.
 * ====================================================================================================
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  SPLINE_ITEMS,
  STATIC_RIBBON_PATHS,
  buildRibbonPath,
  SplineItem,
} from './shipLogoData';

export interface OfficialShipLogoProps {
  size?: number | string;
  className?: string;
  color?: string;
}

/**
 * 🚢 ВЕКТОРНЫЙ ОФИЦИАЛЬНЫЙ ЛОГОТИП СУДНА (20 B-Spline обводов корпуса)
 */
export const OfficialShipLogo: React.FC<OfficialShipLogoProps> = ({
  size = 40,
  className = '',
  color,
}) => {
  return (
    <svg
      viewBox="-305 45 1674 849"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block select-none overflow-hidden shrink-0 ${className}`}
      aria-label="Официальный логотип судна и 3D-бруса"
    >
      <defs>
        <clipPath id="officialCropClip">
          <rect x="-305" y="45" width="1674" height="849" />
        </clipPath>
      </defs>
      <g clipPath="url(#officialCropClip)">
        {STATIC_RIBBON_PATHS.map((item, idx) => (
          <path
            key={idx}
            d={item.d}
            fill={color || item.color}
            opacity={1}
          />
        ))}
      </g>
    </svg>
  );
};

/** Совместимость со всеми компонентами проекта */
export const ShipLogo = OfficialShipLogo;

// ============================================================================
// 🎬 МИНИМАЛИСТИЧНОЕ ИНТРО: ТОЛЬКО АНИМАЦИЯ ПРИЛЕТА ЦИФР И ПЕРЕЛЕТ ЛОГОТИПА
// ============================================================================

export interface ShipLogoIntroProps {
  onComplete: () => void;
}

export const ShipLogoIntro: React.FC<ShipLogoIntroProps> = ({ onComplete }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const splinesGroupRef = useRef<SVGGElement>(null);
  const digitsGroupRef = useRef<SVGGElement>(null);

  // Состояние перелета в левый верхний угол
  const [isFlyingToCorner, setIsFlyingToCorner] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [targetCoords, setTargetCoords] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({
    left: 10,
    top: 12,
    width: 48,
    height: 48,
  });

  // Запуск перелета в верхний левый угол
  const triggerFlightToCorner = useCallback(() => {
    // Получаем точные координаты слота логотипа в левой панели
    const slotElement = document.getElementById('sidebar-logo-slot');
    if (slotElement) {
      const rect = slotElement.getBoundingClientRect();
      setTargetCoords({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }

    setIsFlyingToCorner(true);

    // Растворение белой подложки
    setTimeout(() => {
      setIsFadingOut(true);
    }, 450);

    // Окончание заставки
    setTimeout(() => {
      onComplete();
    }, 950);
  }, [onComplete]);

  // Возможность мягко пропустить анимацию по нажатию клавиши Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        triggerFlightToCorner();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerFlightToCorner]);

  // Воспроизведение оригинальной математической анимации прилета цифр
  useEffect(() => {
    const digitColor = '#3355cc';
    const waveDuration = 2.0;
    const phaseWaveStart = 5.0; // секунды до начала волновой кристаллизации
    const totalAnimationDuration = 7.0; // точное исходное время программы

    const splinesGroup = splinesGroupRef.current;
    const digitsGroup = digitsGroupRef.current;
    if (!splinesGroup || !digitsGroup) return;

    splinesGroup.innerHTML = '';
    digitsGroup.innerHTML = '';

    const ribbonElements: SVGPathElement[] = [];
    SPLINE_ITEMS.forEach((item) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', buildRibbonPath(item, item.origCtrlPts));
      p.setAttribute('fill', item.color);
      p.style.opacity = '0.03';
      splinesGroup.appendChild(p);
      ribbonElements.push(p);
    });

    const minRho = -625;
    const rhoSpan = 1335;

    const simItems = SPLINE_ITEMS.map((item) => {
      const vPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      vPath.setAttribute('d', item.virtualPathD);
      const digitSpacing = 16;
      const count = Math.max(4, Math.floor(item.mainLen / digitSpacing));
      const digits: {
        elem: SVGTextElement;
        offsetDelayRatio: number;
        targetDist: number;
        curDist: number;
        rhoNorm: number;
      }[] = [];

      for (let i = 0; i < count; i++) {
        const char = Math.random() > 0.5 ? '1' : '0';
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('class', 'stream-digit');
        txt.textContent = char;
        txt.style.fill = digitColor;
        txt.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        txt.style.fontWeight = '800';
        txt.style.textAnchor = 'middle';
        txt.style.dominantBaseline = 'central';
        txt.style.paintOrder = 'stroke fill';
        txt.style.stroke = '#ffffff';
        txt.style.strokeWidth = '2px';
        txt.style.display = 'none';
        digitsGroup.appendChild(txt);

        const targetDist = item.totalLen - i * digitSpacing;
        const finalPt = vPath.getPointAtLength(targetDist);
        const digitRhoNorm = Math.max(0, Math.min(1, (finalPt.x - finalPt.y - minRho) / rhoSpan));

        digits.push({
          elem: txt,
          offsetDelayRatio: (i / count) * 0.45,
          targetDist,
          curDist: 0,
          rhoNorm: digitRhoNorm,
        });
      }

      return { item, vPath, digits };
    });

    let animationFrameId: number;
    const startTime = performance.now();
    let hasFinishedAnimation = false;

    const loop = (now: number) => {
      const elapsedSec = (now - startTime) / 1000;

      simItems.forEach((sim) => {
        const { item, vPath, digits } = sim;
        if (elapsedSec < item.tStart) return;

        const localTime = Math.min(item.duration, elapsedSec - item.tStart);
        const progress = localTime / item.duration;

        digits.forEach((d) => {
          const effectiveProgress = Math.max(
            0,
            Math.min(1, (progress - d.offsetDelayRatio) / (1 - d.offsetDelayRatio))
          );
          d.curDist = effectiveProgress * d.targetDist;

          if (d.curDist > 2 && d.curDist <= item.totalLen) {
            d.elem.style.display = 'block';
            const pt1 = vPath.getPointAtLength(d.curDist);
            const lookAhead = Math.min(item.totalLen, d.curDist + 2);
            const pt2 = vPath.getPointAtLength(lookAhead);

            const angleDeg = (Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * 180) / Math.PI;
            let currentWidth = item.wStart;
            if (d.curDist >= item.appLen) {
              const mainT = (d.curDist - item.appLen) / item.mainLen;
              currentWidth = item.wStart + (item.wEnd - item.wStart) * mainT;
            } else {
              currentWidth = item.wStart * 0.85;
            }
            const fontSize = Math.max(9, Math.round(currentWidth * 1.15));
            d.elem.style.fontSize = fontSize + 'px';
            d.elem.setAttribute(
              'transform',
              `translate(${pt1.x.toFixed(1)}, ${pt1.y.toFixed(1)}) rotate(${angleDeg.toFixed(1)})`
            );
          } else {
            d.elem.style.display = 'none';
          }
        });
      });

      if (elapsedSec >= phaseWaveStart) {
        const waveElapsed = elapsedSec - phaseWaveStart;
        const waveSoftness = 0.35;
        simItems.forEach((sim, idx) => {
          const ribbon = ribbonElements[idx];
          const localSplineT =
            (waveElapsed - sim.item.splineRhoNorm * (waveDuration - waveSoftness)) / waveSoftness;
          const splineAlpha = Math.max(0, Math.min(1, localSplineT));

          ribbon.style.opacity = (0.03 + 0.97 * splineAlpha).toFixed(3);

          sim.digits.forEach((d) => {
            const localDigitT =
              (waveElapsed - d.rhoNorm * (waveDuration - waveSoftness)) / waveSoftness;
            const digitAlpha = Math.max(0, Math.min(1, localDigitT));
            d.elem.style.opacity = (1 - digitAlpha).toFixed(3);
          });
        });
      }

      if (elapsedSec < totalAnimationDuration) {
        animationFrameId = requestAnimationFrame(loop);
      } else if (!hasFinishedAnimation) {
        hasFinishedAnimation = true;
        digitsGroup.innerHTML = '';
        ribbonElements.forEach((r, idx) => {
          r.setAttribute('d', buildRibbonPath(SPLINE_ITEMS[idx], SPLINE_ITEMS[idx].origCtrlPts));
          r.style.opacity = '1';
        });

        // Логотип сформирован -> запуск плавного полета в левый верхний угол
        triggerFlightToCorner();
      }
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [triggerFlightToCorner]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-white select-none overflow-hidden transition-opacity duration-500 ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      aria-label="Минималистичный экран загрузки логотипа"
    >
      {/* Анимированный контейнер логотипа */}
      <div
        ref={containerRef}
        className="transition-all duration-750 ease-[cubic-bezier(0.16,1,0.3,1)] flex items-center justify-center"
        style={
          isFlyingToCorner
            ? {
                position: 'fixed',
                left: `${targetCoords.left}px`,
                top: `${targetCoords.top}px`,
                width: `${targetCoords.width}px`,
                height: `${targetCoords.height}px`,
                transform: 'none',
                zIndex: 60,
                padding: '4px',
              }
            : {
                position: 'relative',
                width: '92vmin',
                height: '92vmin',
                maxWidth: '860px',
                maxHeight: '860px',
              }
        }
      >
        <svg
          viewBox="-305 45 1674 849"
          className="w-full h-full overflow-hidden"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <clipPath id="introCropClip">
              <rect x="-305" y="45" width="1674" height="849" />
            </clipPath>
          </defs>
          <g clipPath="url(#introCropClip)">
            <g ref={splinesGroupRef} id="splinesGroup" />
            <g ref={digitsGroupRef} id="digitsGroup" />
          </g>
        </svg>
      </div>
    </div>
  );
};

// ============================================================================
// ℹ️ МОДАЛЬНОЕ ОКНО «О ПРОГРАММЕ» С ОФИЦИАЛЬНЫМ ЛОГОТИПОМ
// ============================================================================

export const AboutModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg p-6 rounded-3xl bg-white border border-slate-200 shadow-2xl text-slate-800">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
        >
          ✕
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="w-32 h-20 mb-3 flex items-center justify-center">
            <OfficialShipLogo size="100%" />
          </div>

          <h2 className="text-lg font-bold text-slate-900">3D Брус / Naval CAD & CFD</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            Параметрический редактор бруса и судовых обводов с топологическим моделированием носовой оконечности и гидродинамическим опытовым бассейном.
          </p>

          <div className="w-full mt-4 pt-4 border-t border-slate-100 text-left text-xs space-y-2 text-slate-600">
            <div className="flex justify-between">
              <span>Математическое ядро:</span>
              <span className="font-semibold text-slate-800">NURBS / B-Spline</span>
            </div>
            <div className="flex justify-between">
              <span>Гидродинамика:</span>
              <span className="font-semibold text-slate-800">CFD 60 FPS, волны Кельвина</span>
            </div>
            <div className="flex justify-between">
              <span>Официальный логотип:</span>
              <span className="font-semibold text-slate-800">20 параметрических обводов</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
