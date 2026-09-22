import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanForAnswerLeakage } from '../../../src/core/file-isolation.mjs';
import { runHiddenEvaluator } from '../../../cases/3d-globe-backface-occlusion/evaluator/test-suite.mjs';

const root = resolve(import.meta.dirname, '../../..');
const fixturePath = join(root, 'cases/3d-globe-backface-occlusion/fixture');

// 1. 验证 Fixture 零敏感泄露
const leakages = scanForAnswerLeakage(fixturePath, { detailed: true });
assert.equal(leakages.length, 0, 'Starter fixture should have 0 leakage findings');

// 2. 验证初始 Stub 准确报告未完成
const initialResult = await runHiddenEvaluator(fixturePath);
assert.equal(initialResult.status, 'error', 'Stub fixture must fail hidden evaluation');

// 3. 验证注入标准实现后 100% 通过
const tmp = mkdtempSync(join(tmpdir(), '3d-globe-verify-'));
try {
  cpSync(fixturePath, tmp, { recursive: true });

  const solutionCode = `
import { Vector3, ensureVector3, latLngToVector3 } from './math3d.js';

export function isPointOccludedBySphere(point, cameraPosition, globeRadius) {
  const p = ensureVector3(point);
  const cam = ensureVector3(cameraPosition);
  const R = Number(globeRadius);

  const povDist = cam.length();
  if (povDist <= R) {
    return { occluded: false, povDist, povEdgeDist: 0, povPosDist: cam.distanceTo(p) };
  }

  const povEdgeDist = Math.sqrt(Math.max(0, povDist ** 2 - R ** 2));
  const povPosDist = cam.distanceTo(p);

  return {
    occluded: povPosDist > povEdgeDist,
    povDist,
    povEdgeDist,
    povPosDist,
  };
}

export function computePerspectiveScale(povPosDist, povDist, globeRadius, options = {}) {
  const { perspectiveMaxScale = 1.0, perspectiveMinScale = 0.4 } = options;
  const R = Number(globeRadius);
  const povCenterDist = povDist - R;
  const povEdgeDist = Math.sqrt(Math.max(0, povDist ** 2 - R ** 2));

  if (povEdgeDist <= povCenterDist) {
    return perspectiveMaxScale;
  }

  const ratio = (povPosDist - povCenterDist) / (povEdgeDist - povCenterDist);
  const clampedRatio = Math.max(0, Math.min(1, ratio));

  return perspectiveMaxScale - clampedRatio * (perspectiveMaxScale - perspectiveMinScale);
}

export function projectSpherePointToScreen(point, camera, screen, globeRadius = null) {
  const p = ensureVector3(point);
  const camPos = ensureVector3(camera.position);

  if (globeRadius != null) {
    const occ = isPointOccludedBySphere(p, camPos, globeRadius);
    if (occ.occluded) {
      return { visible: false, occluded: true };
    }
  }

  const target = ensureVector3(camera.target || { x: 0, y: 0, z: 0 });
  const up = ensureVector3(camera.up || { x: 0, y: 1, z: 0 });

  const forward = new Vector3().subVectors(target, camPos).normalize();
  const right = new Vector3().crossVectors(forward, up).normalize();
  const camUp = new Vector3().crossVectors(right, forward);

  const v = new Vector3().subVectors(p, camPos);
  const zView = v.dot(forward);

  if (zView <= 0) {
    return { visible: false, occluded: false };
  }

  const xView = v.dot(right);
  const yView = v.dot(camUp);

  const fovRad = ((camera.fov || 50) * Math.PI) / 360;
  const tanHalf = Math.tan(fovRad);
  const aspect = camera.aspect || (screen.width / screen.height);

  const ndcX = xView / (zView * tanHalf * aspect);
  const ndcY = yView / (zView * tanHalf);

  const visible = Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;

  const screenX = (ndcX * 0.5 + 0.5) * screen.width;
  const screenY = (-ndcY * 0.5 + 0.5) * screen.height;

  return {
    visible,
    occluded: false,
    screenX,
    screenY,
    ndc: { x: ndcX, y: ndcY },
  };
}

export function layoutSphereTooltips(items, globeOptions) {
  if (!Array.isArray(items)) return [];
  const { globeRadius, camera, screen, layout = {} } = globeOptions;
  const { perspectiveMaxScale = 1.0, perspectiveMinScale = 0.4 } = layout;

  const camPos = ensureVector3(camera.position);
  const povDist = camPos.length();

  return items.map(item => {
    let pt = item.point;
    if (!pt && typeof item.lat === 'number' && typeof item.lng === 'number') {
      pt = latLngToVector3(item.lat, item.lng, globeRadius, item.altitude || 0);
    }
    pt = ensureVector3(pt);

    const occ = isPointOccludedBySphere(pt, camPos, globeRadius);
    if (occ.occluded) {
      return {
        ...item,
        visible: false,
        occluded: true,
        scale: perspectiveMinScale,
        screenX: 0,
        screenY: 0,
      };
    }

    const scale = computePerspectiveScale(occ.povPosDist, povDist, globeRadius, {
      perspectiveMaxScale,
      perspectiveMinScale,
    });

    const proj = projectSpherePointToScreen(pt, camera, screen, globeRadius);
    return {
      ...item,
      visible: proj.visible,
      occluded: proj.occluded,
      scale,
      screenX: proj.screenX,
      screenY: proj.screenY,
    };
  });
}
`;

  writeFileSync(join(tmp, 'src/occlusion.js'), solutionCode, 'utf8');

  const fixedResult = await runHiddenEvaluator(tmp);
  assert.equal(fixedResult.status, 'success', 'Real implementation must pass all checks');
  assert.equal(fixedResult.details.every(d => d.passed), true, 'All 6 criteria must pass');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: 'success',
  summary: '3d-globe-backface-occlusion case, fixture isolation, and evaluator contracts verified.',
  next_actions: [],
  artifacts: ['cases/3d-globe-backface-occlusion'],
}));
