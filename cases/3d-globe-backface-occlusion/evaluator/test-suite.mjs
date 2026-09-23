import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

export async function runHiddenEvaluator(workspacePath = process.cwd()) {
  const targetModulePath = resolve(workspacePath, 'src/occlusion.js');
  const targetUrl = `${pathToFileURL(targetModulePath).href}?t=${Date.now()}`;

  let mod;
  try {
    mod = await import(targetUrl);
  } catch (error) {
    return {
      status: 'error',
      summary: `Failed to import ${targetModulePath}: ${error.message}`,
      next_actions: ['Ensure src/occlusion.js exists and has no syntax errors.'],
      artifacts: [targetModulePath],
    };
  }

  const {
    isPointOccludedBySphere,
    computePerspectiveScale,
    projectSpherePointToScreen,
    layoutSphereTooltips,
  } = mod;

  if (typeof isPointOccludedBySphere !== 'function') {
    return {
      status: 'error',
      summary: 'isPointOccludedBySphere is not exported from src/occlusion.js',
      next_actions: ['Export isPointOccludedBySphere from src/occlusion.js'],
      artifacts: [targetModulePath],
    };
  }

  const results = [];

  // Test 1: 正背面基础遮挡判定
  try {
    const cam = { x: 0, y: 0, z: 300 };
    const R = 100;
    const frontPoint = { x: 0, y: 0, z: 100 };
    const backPoint = { x: 0, y: 0, z: -100 };

    const frontRes = isPointOccludedBySphere(frontPoint, cam, R);
    const backRes = isPointOccludedBySphere(backPoint, cam, R);

    assert.equal(frontRes.occluded, false, '球体正前方点位必须判定为可视');
    assert.equal(backRes.occluded, true, '球体正背面点位必须判定为遮挡');
    assert.ok(frontRes.povPosDist < frontRes.povEdgeDist, '前方点位距相机距离应小于切点距离');
    assert.ok(backRes.povPosDist > backRes.povEdgeDist, '背面点位距相机距离应大于切点距离');
    results.push({ name: 'P0_SPHERE_OCCLUSION_FRONT_BACK', passed: true });
  } catch (e) {
    results.push({ name: 'P0_SPHERE_OCCLUSION_FRONT_BACK', passed: false, error: e.message });
  }

  // Test 2: 地平线切线临界精度
  try {
    const cam = { x: 0, y: 0, z: 200 };
    const R = 100;
    // D_pov = 200, R = 100 => Z_horizon = 10000 / 200 = 50.
    // 切线前方测试点：Z = 55, r_xy = sqrt(10000 - 55^2) = sqrt(6975)
    const rFront = Math.sqrt(100 ** 2 - 55 ** 2);
    const frontPoint = { x: 0, y: rFront, z: 55 };
    const frontRes = isPointOccludedBySphere(frontPoint, cam, R);

    // 切线后方测试点：Z = 45, r_xy = sqrt(10000 - 45^2) = sqrt(7975)
    const rBack = Math.sqrt(100 ** 2 - 45 ** 2);
    const backPoint = { x: 0, y: rBack, z: 45 };
    const backRes = isPointOccludedBySphere(backPoint, cam, R);

    assert.equal(frontRes.occluded, false, '切线前方点位 (Z=55) 必须可视');
    assert.equal(backRes.occluded, true, '切线后方点位 (Z=45) 必须遮挡');
    results.push({ name: 'P0_SPHERE_OCCLUSION_HORIZON_TANGENT', passed: true });
  } catch (e) {
    results.push({ name: 'P0_SPHERE_OCCLUSION_HORIZON_TANGENT', passed: false, error: e.message });
  }

  // Test 3: 相机围绕球体旋转鲁棒性 (X轴与Y轴)
  try {
    const R = 100;
    // 相机转到 +X 轴 (300, 0, 0)
    const camX = { x: 300, y: 0, z: 0 };
    const pEast = { x: 100, y: 0, z: 0 };
    const pWest = { x: -100, y: 0, z: 0 };
    assert.equal(isPointOccludedBySphere(pEast, camX, R).occluded, false, '相机在+X时，+X极点应可视');
    assert.equal(isPointOccludedBySphere(pWest, camX, R).occluded, true, '相机在+X时，-X极点应被遮挡');

    // 相机转到 +Y 轴 (0, 300, 0)
    const camY = { x: 0, y: 300, z: 0 };
    const pNorth = { x: 0, y: 100, z: 0 };
    const pSouth = { x: 0, y: -100, z: 0 };
    assert.equal(isPointOccludedBySphere(pNorth, camY, R).occluded, false, '相机在+Y时，北极点应可视');
    assert.equal(isPointOccludedBySphere(pSouth, camY, R).occluded, true, '相机在+Y时，南极点应被遮挡');
    results.push({ name: 'P0_CAMERA_ROTATION_ORBIT', passed: true });
  } catch (e) {
    results.push({ name: 'P0_CAMERA_ROTATION_ORBIT', passed: false, error: e.message });
  }

  // Test 4: 透视缩放系数动态范围与单调性
  try {
    assert(typeof computePerspectiveScale === 'function', 'computePerspectiveScale 需为函数');
    const R = 100;
    const povDist = 300;
    const povCenterDist = 200; // 300 - 100
    const povEdgeDist = Math.sqrt(300 ** 2 - 100 ** 2); // sqrt(80000) ~ 282.84
    const opts = { perspectiveMaxScale: 1.0, perspectiveMinScale: 0.4 };

    const scaleCenter = computePerspectiveScale(povCenterDist, povDist, R, opts);
    const scaleEdge = computePerspectiveScale(povEdgeDist, povDist, R, opts);
    const scaleMid = computePerspectiveScale((povCenterDist + povEdgeDist) / 2, povDist, R, opts);

    assert.ok(Math.abs(scaleCenter - 1.0) < 0.02, `最近点缩放需接近 1.0，实际: ${scaleCenter}`);
    assert.ok(Math.abs(scaleEdge - 0.4) < 0.02, `切点缩放需接近 0.4，实际: ${scaleEdge}`);
    assert.ok(scaleCenter > scaleMid && scaleMid > scaleEdge, '缩放系数需随视距严格单调递减');
    results.push({ name: 'P0_PERSPECTIVE_SCALE', passed: true });
  } catch (e) {
    results.push({ name: 'P0_PERSPECTIVE_SCALE', passed: false, error: e.message });
  }

  // Test 5: 屏幕投影几何精度与背面剔除
  try {
    assert(typeof projectSpherePointToScreen === 'function', 'projectSpherePointToScreen 需为函数');
    const camera = {
      position: { x: 0, y: 0, z: 300 },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
      aspect: 800 / 600,
      up: { x: 0, y: 1, z: 0 },
    };
    const screen = { width: 800, height: 600 };
    const R = 100;

    // 正对相机视线中心的极点 (0, 0, 100) -> 必须精确位于屏幕物理像素中心 (400, 300)
    const centerRes = projectSpherePointToScreen({ x: 0, y: 0, z: 100 }, camera, screen, R);
    assert.equal(centerRes.visible, true);
    assert.ok(Math.abs(centerRes.screenX - 400) <= 1, `屏幕中心 X 应为 400，实际: ${centerRes.screenX}`);
    assert.ok(Math.abs(centerRes.screenY - 300) <= 1, `屏幕中心 Y 应为 300，实际: ${centerRes.screenY}`);

    // 背面极点 (0, 0, -100) 传入 globeRadius 时必须直接判定不可见
    const backRes = projectSpherePointToScreen({ x: 0, y: 0, z: -100 }, camera, screen, R);
    assert.equal(backRes.visible, false, '背面极点投影必须标记 visible: false');
    assert.equal(backRes.occluded, true, '背面极点投影必须标记 occluded: true');

    results.push({ name: 'P0_SCREEN_PROJECTION_ACCURACY', passed: true });
  } catch (e) {
    results.push({ name: 'P0_SCREEN_PROJECTION_ACCURACY', passed: false, error: e.message });
  }

  // Test 6: 批量排版与遮挡过滤
  try {
    assert(typeof layoutSphereTooltips === 'function', 'layoutSphereTooltips 需为函数');
    const camera = {
      position: { x: 0, y: 0, z: 300 },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
      aspect: 800 / 600,
      up: { x: 0, y: 1, z: 0 },
    };
    const screen = { width: 800, height: 600 };
    const R = 100;

    const items = [
      { id: 'beijing', lat: 39.9, lng: 116.4, width: 60, height: 30 },
      { id: 'front_pole', point: { x: 0, y: 0, z: 100 }, width: 60, height: 30 },
      { id: 'back_pole', point: { x: 0, y: 0, z: -100 }, width: 60, height: 30 },
    ];

    const laidOut = layoutSphereTooltips(items, {
      globeRadius: R,
      camera,
      screen,
      layout: { perspectiveMaxScale: 1.0, perspectiveMinScale: 0.4 },
    });

    assert.equal(laidOut.length, 3, '输出项数量应保持一致');
    const frontItem = laidOut.find(i => i.id === 'front_pole');
    const backItem = laidOut.find(i => i.id === 'back_pole');

    assert.ok(frontItem, 'front_pole 应存在');
    assert.ok(backItem, 'back_pole 应存在');
    assert.equal(frontItem.visible, true, 'front_pole 应可见');
    assert.equal(backItem.visible, false, 'back_pole 必须被遮挡剔除');
    assert.ok(frontItem.scale >= 0.4 && frontItem.scale <= 1.0, '可见项 scale 需在有效区间内');
    assert.ok(Number.isFinite(frontItem.screenX), 'screenX 需为有效数值');
    assert.ok(Number.isFinite(frontItem.screenY), 'screenY 需为有效数值');

    results.push({ name: 'P0_BATCH_TOOLTIP_CULLING_AND_LAYOUT', passed: true });
  } catch (e) {
    results.push({ name: 'P0_BATCH_TOOLTIP_CULLING_AND_LAYOUT', passed: false, error: e.message });
  }

  const failed = results.filter(r => !r.passed);
  const allPassed = failed.length === 0;

  return {
    status: allPassed ? 'success' : 'error',
    summary: allPassed
      ? 'All 6/6 3D occlusion and projection criteria passed.'
      : `${failed.length}/6 criteria failed: ${failed.map(f => f.name).join(', ')}`,
    details: results,
    next_actions: allPassed
      ? []
      : ['Check vector derivation and perspective transform in src/occlusion.js'],
    artifacts: [targetModulePath],
  };
}

if (process.argv[1] === import.meta.filename) {
  const targetDir = process.argv[2] || resolve(import.meta.dirname, '../fixture');
  const result = await runHiddenEvaluator(targetDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'success' ? 0 : 1);
}
