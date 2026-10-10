/**
 * ====================================================================================================
 * 📁 src/core/towingTankShaders.ts
 * ====================================================================================================
 * 📌 НАЗНАЧЕНИЕ:
 * Высокопроизводительные GLSL-шейдеры Three.js для режима «Виртуальный опытовый бассейн»:
 * 1. `createBernoulliPressureMaterial` — тепловая карта гидродинамического давления Бернулли на корпусе.
 * 2. `createKelvinWaterMaterial` — анимированная водная поверхность с корабельными волнами Кельвина.
 * 3. `createStreamlineShaderMaterial` — светящиеся анимированные линии тока с градиентом скорости.
 * ====================================================================================================
 */

import * as THREE from 'three';

/**
 * Шейдерный материал тепловой карты гидродинамического давления Бернулли
 * Рассчитывает градиент давления Delta_P = 0.5 * rho * (V_inf^2 - V_local^2)
 * Отображает пик давления (красный) у штевня/бульба и разрежение (синий) у плеча.
 */
export function createBernoulliPressureMaterial(params: {
  stemX: number;
  bowLength: number;
  draft: number;
  entranceAngleDeg: number;
  shoulderFullness: number;
  bulbLength: number;
  speedMs: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStemX: { value: params.stemX },
      uBowLength: { value: Math.max(0.1, params.bowLength) },
      uDraft: { value: Math.max(0.1, params.draft) },
      uEntranceAngle: { value: (params.entranceAngleDeg * Math.PI) / 180 },
      uShoulderFullness: { value: params.shoulderFullness },
      uBulbLength: { value: params.bulbLength },
      uSpeedMs: { value: params.speedMs },
      uTime: { value: 0.0 },
      uShowContours: { value: 1.0 },
      uOpacity: { value: 0.95 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

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
      uniform float uStemX;
      uniform float uBowLength;
      uniform float uDraft;
      uniform float uEntranceAngle;
      uniform float uShoulderFullness;
      uniform float uBulbLength;
      uniform float uSpeedMs;
      uniform float uTime;
      uniform float uShowContours;
      uniform float uOpacity;

      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      // Высококонтрастная спектральная инженерная палитра (Jet / Turbo)
      vec3 pressureColor(float cp) {
        // cp: -1.0 (сильное разрежение / ускорение) -> 0.0 (нейтраль) -> +1.0 (точка торможения потока)
        float t = clamp((cp + 0.8) / 1.8, 0.0, 1.0);
        
        vec3 c;
        if (t < 0.2) {
          c = mix(vec3(0.05, 0.1, 0.5), vec3(0.0, 0.4, 0.9), t / 0.2); // Глубокий синий -> Голубой
        } else if (t < 0.45) {
          c = mix(vec3(0.0, 0.4, 0.9), vec3(0.1, 0.85, 0.7), (t - 0.2) / 0.25); // Голубой -> Циан / Морская волна
        } else if (t < 0.65) {
          c = mix(vec3(0.1, 0.85, 0.7), vec3(0.3, 0.9, 0.2), (t - 0.45) / 0.2); // Циан -> Зеленый
        } else if (t < 0.85) {
          c = mix(vec3(0.3, 0.9, 0.2), vec3(0.95, 0.75, 0.1), (t - 0.65) / 0.2); // Зеленый -> Желто-янтарный
        } else {
          c = mix(vec3(0.95, 0.75, 0.1), vec3(0.95, 0.15, 0.1), (t - 0.85) / 0.15); // Янтарный -> Ярко-красный
        }
        return c;
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);

        float x = vWorldPosition.x;
        float y = vWorldPosition.y;
        float z = vWorldPosition.z;

        // Расстояние от форштевня вглубь носовой части (0 на штевне, 1 на миделе)
        float tBow = clamp((uStemX - x) / uBowLength, 0.0, 1.2);
        
        // Погружение относительно ватерлинии (0 на КВЛ, 1 на киле)
        float zDepth = clamp((uDraft - y) / max(0.1, uDraft), 0.0, 1.5);

        // 1. Коэффициент гидродинамического давления Cp = 1 - (V_local / V_inf)^2
        // Точка полного торможения потока (Stagnation point) на передней кромке штевня/бульба
        float stemProximity = exp(-max(0.0, uStemX - x) / (1.2 + uBulbLength * 0.25));
        float stemFrontality = max(0.0, dot(N, vec3(1.0, 0.0, 0.0)));
        
        // Пик давления на форштевне (Красный)
        float cpStagnation = 0.95 * stemProximity * (0.4 + 0.6 * stemFrontality) * sin(uEntranceAngle);

        // Зона разрежения у плеча (Синий/Циан) из-за ускорения потока
        float shoulderCenter = 0.55;
        float shoulderDist = abs(tBow - shoulderCenter);
        float shoulderSuction = -0.75 * exp(-shoulderDist * shoulderDist * 12.0) * (uShoulderFullness * 1.1);

        // Бульбовое пятно повышенного давления
        float bulbEffect = 0.0;
        if (uBulbLength > 0.1 && zDepth > 0.4) {
          bulbEffect = 0.45 * exp(-abs(zDepth - 0.7) * 4.0) * stemProximity;
        }

        // Результирующий безразмерный коэффициент давления Cp
        float Cp = clamp(cpStagnation + shoulderSuction + bulbEffect, -1.0, 1.0);

        // Если полигон выше КВЛ (надводный борт), давление плавно переходит в атмосферное (зеленовато-серое)
        if (y > uDraft) {
          float aboveFrac = clamp((y - uDraft) / 1.5, 0.0, 1.0);
          Cp = mix(Cp, 0.0, aboveFrac);
        }

        vec3 color = pressureColor(Cp);

        // Изолинии давления (Изобары / Контуры)
        if (uShowContours > 0.5) {
          float contourLine = abs(fract(Cp * 6.0) - 0.5) * 2.0;
          float isobars = smoothstep(0.0, 0.15, contourLine);
          color = mix(vec3(0.05, 0.05, 0.1), color, isobars);
        }

        // Диффузное затенение для сохранения 3D-объема
        float diffuse = max(0.3, dot(N, normalize(vec3(0.5, 1.0, 0.8))));
        color *= (0.7 + 0.3 * diffuse);

        gl_FragColor = vec4(color, uOpacity);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

/**
 * Шейдерный материал водной поверхности виртуального опытового бассейна
 * Включает волновой след Кельвина (19.47°), носовой бурун и впадину у плеча.
 */
export function createKelvinWaterMaterial(params: {
  stemX: number;
  shipLength: number;
  shipWidth: number;
  draft: number;
  speedKnots: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStemX: { value: params.stemX },
      uShipLength: { value: params.shipLength },
      uShipWidth: { value: params.shipWidth },
      uDraft: { value: params.draft },
      uSpeedKnots: { value: params.speedKnots },
      uTime: { value: 0.0 },
      uDeepColor: { value: new THREE.Color(0x06283d) }, // Глубокая океаническая синева
      uShallowColor: { value: new THREE.Color(0x1363df) }, // Яркий морской сапфир
      uFoamColor: { value: new THREE.Color(0xf0fdfa) }, // Белоснежная пена гребней
    },
    vertexShader: `
      uniform float uStemX;
      uniform float uShipLength;
      uniform float uShipWidth;
      uniform float uDraft;
      uniform float uSpeedKnots;
      uniform float uTime;

      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      varying float vWaveHeight;
      varying float vFoam;

      // Функция расчетной высоты волнового следа Кельвина
      float getKelvinDisplacement(vec2 pos, float speed) {
        float x = pos.x;
        float z = pos.y;
        float stemDistX = uStemX - x;

        float disp = 0.0;
        float foam = 0.0;

        // 1. Носовой бурун (Подпор перед штевнем и по бортам)
        if (abs(stemDistX) < 8.0 && abs(z) < uShipWidth * 1.6) {
          float bowAmp = (speed * 0.065);
          float bowDecay = exp(-stemDistX * stemDistX * 0.08) * exp(-abs(z) * 0.35);
          disp += bowAmp * bowDecay;
          foam += 0.8 * bowDecay;
        }

        // 2. Впадина у носового плеча (Shoulder Hollow)
        if (stemDistX > 4.0 && stemDistX < 18.0 && abs(z) < uShipWidth * 1.4) {
          float hollow = -0.045 * speed * sin((stemDistX - 4.0) * 0.35) * exp(-abs(z) * 0.25);
          disp += hollow;
        }

        // 3. Расходящиеся волны Кельвина (Divergent waves, полуугол 19.47° = 0.34 рад)
        if (stemDistX > 0.0) {
          float kelvinAngle = 0.34;
          float wakeZ = abs(z) - 0.5 * uShipWidth;
          if (wakeZ > 0.0) {
            float raySlope = wakeZ / max(1.0, stemDistX);
            // Пик волны вдоль каустики Кельвина raySlope ~ tan(19.47°) ~ 0.353
            float causticDist = abs(raySlope - 0.353);
            float causticAmp = exp(-causticDist * causticDist * 80.0) * exp(-stemDistX * 0.015);
            
            // Быстробегущие гребни волн
            float phase = stemDistX * 0.8 - uTime * (speed * 0.4);
            disp += (speed * 0.05) * causticAmp * sin(phase);
            if (disp > 0.4) foam += 0.6 * causticAmp;
          }

          // Поперечные волны за кормой (Transverse waves)
          if (abs(z) < uShipWidth * 1.2) {
            float sternPhase = stemDistX * 0.4 - uTime * (speed * 0.3);
            float sternWave = 0.03 * speed * sin(sternPhase) * exp(-stemDistX * 0.02);
            disp += sternWave;
          }
        }

        // 4. Фоновая морская зыбь (Герстнеровские гармоники)
        float oceanSwell = 0.12 * sin(pos.x * 0.15 + pos.y * 0.12 + uTime * 2.0)
                         + 0.08 * cos(pos.x * 0.25 - pos.y * 0.18 + uTime * 1.5);
        disp += oceanSwell;

        return disp;
      }

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        
        float disp = getKelvinDisplacement(worldPos.xz, uSpeedKnots);
        worldPos.y += disp;

        // Вычисление нормалей по конечным разностям для точных бликов воды
        float eps = 0.25;
        float dX = getKelvinDisplacement(vec2(worldPos.x + eps, worldPos.z), uSpeedKnots) - 
                   getKelvinDisplacement(vec2(worldPos.x - eps, worldPos.z), uSpeedKnots);
        float dZ = getKelvinDisplacement(vec2(worldPos.x, worldPos.z + eps), uSpeedKnots) - 
                   getKelvinDisplacement(vec2(worldPos.x, worldPos.z - eps), uSpeedKnots);

        vec3 N = normalize(vec3(-dX, 2.0 * eps, -dZ));
        vNormal = normalize(normalMatrix * N);
        vWorldPosition = worldPos.xyz;
        vWaveHeight = disp;

        // Интенсивность пены на высоких гребнях
        vFoam = clamp(disp * 0.8 + (disp > 0.5 ? 0.5 : 0.0), 0.0, 1.0);

        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uFoamColor;
      uniform float uSpeedKnots;

      varying vec3 vWorldPosition;
      varying vec3 vNormal;
      varying float vWaveHeight;
      varying float vFoam;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        // Оптический коэффициент Френеля (отражение неба под косыми углами)
        float fresnel = pow(1.0 - max(0.0, dot(N, V)), 4.0);

        // Градиент цвета воды по высоте гребня
        vec3 waterColor = mix(uDeepColor, uShallowColor, clamp(vWaveHeight * 0.5 + 0.3, 0.0, 1.0));
        
        // Небесный блик
        vec3 skyColor = vec3(0.7, 0.88, 1.0);
        waterColor = mix(waterColor, skyColor, fresnel * 0.65);

        // Солнечный блик (Specular highlight)
        vec3 lightDir = normalize(vec3(0.6, 1.0, 0.4));
        vec3 H = normalize(lightDir + V);
        float spec = pow(max(0.0, dot(N, H)), 64.0);
        waterColor += vec3(1.0, 1.0, 0.95) * spec * 0.8;

        // Подмешивание пены на гребнях волн
        float foamFactor = smoothstep(0.35, 0.85, vFoam);
        waterColor = mix(waterColor, uFoamColor, foamFactor * 0.85);

        gl_FragColor = vec4(waterColor, 0.88);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * Шейдерный материал для пульсирующих светящихся линий тока
 */
export function createStreamlineShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uSpeed: { value: 1.0 },
      uGlowColor: { value: new THREE.Color(0x38bdf8) },
    },
    vertexShader: `
      attribute float aProgress; // Прогресс вдоль линии от 0 до 1
      attribute float aVelocity; // Локальная скорость потока
      varying float vProgress;
      varying float vVelocity;

      void main() {
        vProgress = aProgress;
        vVelocity = aVelocity;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSpeed;
      uniform vec3 uGlowColor;
      varying float vProgress;
      varying float vVelocity;

      void main() {
        // Бегущие импульсы вдоль линии тока
        float wave = sin((vProgress * 15.0 - uTime * uSpeed * 4.0) * 3.14159265);
        float pulse = smoothstep(0.2, 0.9, wave);

        // Цветовое кодирование скорости потока:
        // Низкая скорость (торможение) -> Красный/Оранжевый
        // Средняя скорость -> Циан/Зеленый
        // Высокая скорость (ускорение) -> Ярко-синий/Белый
        vec3 speedCol = mix(vec3(0.2, 0.9, 0.4), vec3(0.0, 0.6, 1.0), clamp(vVelocity - 0.5, 0.0, 1.0));
        if (vVelocity < 0.7) {
          speedCol = mix(vec3(0.95, 0.3, 0.1), vec3(0.2, 0.9, 0.4), vVelocity / 0.7);
        }

        vec3 finalColor = mix(speedCol, vec3(1.0, 1.0, 1.0), pulse * 0.6);
        float alpha = 0.4 + 0.6 * pulse;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
