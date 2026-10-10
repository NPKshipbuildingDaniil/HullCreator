const fs = require('fs');

const content = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `      const yMidDeck = params.width / 2 + params.flare;

      const deckLoopPts: THREE.Vector3[] = [];
      const deckSamples = 50;
      // Левый борт (Port: z < 0) от миделя t=0 к форштевню t=1
      for (let i = 0; i <= deckSamples; i++) {
        const t = i / deckSamples;
        const pt = computeBowDeckWaterlinePoint(
          t,
          totalBowSpan,
          yMidDeck,
          (activeBowParams.stemWidth ?? 0) / 2,
          activeBowParams.stemRadius ?? 0,
          activeBowParams.entranceAngle ?? 25,
          activeBowParams.shoulderFullness ?? 0.7,
          activeBowParams.maxBreadthPos ?? 0.5,
          activeBowParams.controlPoints
        );
        const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
        const baseEdge = topY + (activeBowParams.bowSheer ?? 0) * sheerBlend;
        const y = baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
        const px = xStemDeck + pt.xRel;
        if (Number.isFinite(px) && Number.isFinite(y) && Number.isFinite(pt.y)) {
          deckLoopPts.push(new THREE.Vector3(px, y, -pt.y));
        }
      }
      // Правый борт (Starboard: z > 0) от форштевня t=1 к миделю t=0
      for (let i = deckSamples; i >= 0; i--) {
        const t = i / deckSamples;
        const pt = computeBowDeckWaterlinePoint(
          t,
          totalBowSpan,
          yMidDeck,
          (activeBowParams.stemWidth ?? 0) / 2,
          activeBowParams.stemRadius ?? 0,
          activeBowParams.entranceAngle ?? 25,
          activeBowParams.shoulderFullness ?? 0.7,
          activeBowParams.maxBreadthPos ?? 0.5,
          activeBowParams.controlPoints
        );
        const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
        const baseEdge = topY + (activeBowParams.bowSheer ?? 0) * sheerBlend;
        const y = baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
        const px = xStemDeck + pt.xRel;
        if (Number.isFinite(px) && Number.isFinite(y) && Number.isFinite(pt.y)) {
          deckLoopPts.push(new THREE.Vector3(px, y, pt.y));
        }
      }
      // Замыкаем контур по миделю
      if (deckLoopPts.length > 2) {
        deckLoopPts.push(deckLoopPts[0].clone());
        const deckOutlineTube = createContourTubeMesh(deckLoopPts, 0.05, 0x111111);
        frontGroup.add(deckOutlineTube);
      }`;

const replacementStr = `      const yMidDeck = params.width / 2 + params.flare;

      const deckSamples = 50;
      
      const deckPtsBlue: THREE.Vector3[] = [];
      const deckPtsGreen: THREE.Vector3[] = [];
      const deckPtsYellow: THREE.Vector3[] = [];
      
      // Подавление дублирования точек
      const getDeckPt = (t: number, isStarboard: boolean) => {
        const pt = computeBowDeckWaterlinePoint(
          t,
          totalBowSpan,
          yMidDeck,
          (activeBowParams.stemWidth ?? 0) / 2,
          activeBowParams.stemRadius ?? 0,
          activeBowParams.entranceAngle ?? 25,
          activeBowParams.shoulderFullness ?? 0.7,
          activeBowParams.maxBreadthPos ?? 0.5,
          activeBowParams.controlPoints
        );
        const sheerBlend = Math.pow(Math.max(0, Math.min(1, t)), 2);
        const baseEdge = topY + (activeBowParams.bowSheer ?? 0) * sheerBlend;
        const y = baseEdge * (1 - sheerBlend) + yStemDeck * sheerBlend;
        const px = xStemDeck + pt.xRel;
        return new THREE.Vector3(px, y, isStarboard ? pt.y : -pt.y);
      };

      const pBreak = activeBowParams.maxBreadthPos ?? 0.5;
      const t1 = Math.max(0.01, pBreak * 0.5); // Run (Уход) ends
      const t2 = Math.max(t1 + 0.01, pBreak + (1.0 - pBreak) * 0.4); // Shoulder (Плечо) ends
      
      const deckLoopPts: THREE.Vector3[] = []; // for labels anchoring

      // Левый борт (Port: z < 0)
      for (let i = 0; i <= deckSamples; i++) {
        const t = i / deckSamples;
        const pt = getDeckPt(t, false);
        if (Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z)) {
          deckLoopPts.push(pt);
          if (t <= t1) deckPtsYellow.push(pt);
          else if (t <= t2) {
             if (deckPtsGreen.length === 0 && deckPtsYellow.length > 0) deckPtsGreen.push(deckPtsYellow[deckPtsYellow.length - 1]);
             deckPtsGreen.push(pt);
          } else {
             if (deckPtsBlue.length === 0 && deckPtsGreen.length > 0) deckPtsBlue.push(deckPtsGreen[deckPtsGreen.length - 1]);
             deckPtsBlue.push(pt);
          }
        }
      }

      // Правый борт (Starboard: z > 0)
      const deckPtsBlueStbd: THREE.Vector3[] = [];
      const deckPtsGreenStbd: THREE.Vector3[] = [];
      const deckPtsYellowStbd: THREE.Vector3[] = [];
      
      for (let i = 0; i <= deckSamples; i++) {
        const t = i / deckSamples;
        const pt = getDeckPt(t, true);
        if (Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z)) {
          if (t <= t1) deckPtsYellowStbd.push(pt);
          else if (t <= t2) {
             if (deckPtsGreenStbd.length === 0 && deckPtsYellowStbd.length > 0) deckPtsGreenStbd.push(deckPtsYellowStbd[deckPtsYellowStbd.length - 1]);
             deckPtsGreenStbd.push(pt);
          } else {
             if (deckPtsBlueStbd.length === 0 && deckPtsGreenStbd.length > 0) deckPtsBlueStbd.push(deckPtsGreenStbd[deckPtsGreenStbd.length - 1]);
             deckPtsBlueStbd.push(pt);
          }
        }
      }
      
      // Рендерим 3 цветных сегмента для палубы
      if (deckPtsYellow.length > 1) frontGroup.add(createContourTubeMesh(deckPtsYellow, 0.05, 0xf59e0b));
      if (deckPtsGreen.length > 1) frontGroup.add(createContourTubeMesh(deckPtsGreen, 0.05, 0x10b981));
      if (deckPtsBlue.length > 1) frontGroup.add(createContourTubeMesh(deckPtsBlue, 0.05, 0x38bdf8));
      
      if (deckPtsYellowStbd.length > 1) frontGroup.add(createContourTubeMesh(deckPtsYellowStbd, 0.05, 0xf59e0b));
      if (deckPtsGreenStbd.length > 1) frontGroup.add(createContourTubeMesh(deckPtsGreenStbd, 0.05, 0x10b981));
      if (deckPtsBlueStbd.length > 1) frontGroup.add(createContourTubeMesh(deckPtsBlueStbd, 0.05, 0x38bdf8));
      
      // Замыкаем контур по миделю (светло-желтый/серый)
      if (deckPtsYellow.length > 0 && deckPtsYellowStbd.length > 0) {
        const midshipLine = [deckPtsYellow[0], deckPtsYellowStbd[0]];
        frontGroup.add(createContourTubeMesh(midshipLine, 0.05, 0xf59e0b));
      }`;

const newContent = content.replace(targetStr, replacementStr);
fs.writeFileSync('src/App.tsx', newContent, 'utf8');
