/**
 * ====================================================================================================
 * 📁 ИНСТРУКЦИЯ И ОПИСАНИЕ ФАЙЛА: src/core/zebraShader.ts
 * ====================================================================================================
 * 
 * 📌 НАЗНАЧЕНИЕ:
 * Реализация специализированных CAD-шейдеров Three.js для визуальной верификации непрерывности:
 * 1. `ZebraStripesMaterial`: полосы отражения «Зебра» для проверки C1 / G1 тангенциальной непрерывности
 *    и C2 / G2 непрерывности кривизны.
 * 2. `CurvatureHeatmapMaterial`: тепловая карта гауссовой и средней кривизны для поиска складок и изломов.
 * ====================================================================================================
 */

import * as THREE from 'three';

/**
 * Шейдерный материал отражения полос «Зебра» (Zebra Striping Reflection)
 * Использует закон отражения вектора взгляда от нормали поверхности для вычисления
 * сферических или цилиндрических изофот (Isophote lines).
 */
export function createZebraStripesMaterial(params: {
  stripeFrequency?: number;
  stripeSharpness?: number;
  stripeColor1?: THREE.Color;
  stripeColor2?: THREE.Color;
  direction?: 'horizontal' | 'vertical' | 'spherical';
} = {}): THREE.ShaderMaterial {
  const stripeFrequency = params.stripeFrequency ?? 28.0;
  const stripeSharpness = params.stripeSharpness ?? 0.85;
  const stripeColor1 = params.stripeColor1 ?? new THREE.Color(0x0a0c10); // Темная полоса
  const stripeColor2 = params.stripeColor2 ?? new THREE.Color(0xf5f7fb); // Светлая полоса

  return new THREE.ShaderMaterial({
    uniforms: {
      uFrequency: { value: stripeFrequency },
      uSharpness: { value: stripeSharpness },
      uColor1: { value: stripeColor1 },
      uColor2: { value: stripeColor2 },
      uMode: { value: params.direction === 'horizontal' ? 0 : params.direction === 'vertical' ? 1 : 2 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uFrequency;
      uniform float uSharpness;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform int uMode;

      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N); // Вектор отражения в пространстве вида

        float coord = 0.0;
        if (uMode == 0) {
          // Горизонтальные полосы
          coord = R.y * 0.5 + 0.5;
        } else if (uMode == 1) {
          // Вертикальные полосы
          coord = R.x * 0.5 + 0.5;
        } else {
          // Сферические изофоты
          coord = length(R.xy);
        }

        float stripe = sin(coord * uFrequency * 3.14159265);
        // Сглаженный порог (anti-aliased threshold)
        float edge = smoothstep(-1.0 + uSharpness, 1.0 - uSharpness, stripe);

        // Добавим тонкое рассеянное освещение для объема
        float diffuse = max(0.2, dot(N, vec3(0.0, 1.0, 0.5)));
        vec3 finalColor = mix(uColor1, uColor2, edge) * (0.6 + 0.4 * diffuse);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

/**
 * Шейдерный материал тепловой карты кривизны (Curvature Heatmap)
 */
export function createCurvatureMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;

      // Цветовая палитра Turbo / Jet для градиента кривизны
      vec3 curvatureColor(float t) {
        t = clamp(t, 0.0, 1.0);
        return clamp(vec3(
          1.5 - abs(t * 4.0 - 3.0),
          1.5 - abs(t * 4.0 - 2.0),
          1.5 - abs(t * 4.0 - 1.0)
        ), 0.0, 1.0);
      }

      void main() {
        vec3 dNdx = dFdx(vNormal);
        vec3 dNdy = dFdy(vNormal);
        float curvature = length(dNdx) + length(dNdy);
        
        // Нормализация кривизны для наглядного отображения гладкости
        float t = clamp(curvature * 12.0, 0.0, 1.0);
        vec3 col = curvatureColor(t);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}
