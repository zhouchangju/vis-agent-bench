import { isObject, overrideIfUndefined } from './utils.js';

export function judgeIsNormalDvRadar(option) {
  if (typeof option?.series === 'undefined') {
    return false;
  }
  const dvRadarSeries = option.series.filter(item => item.type === 'dvRadar');
  return dvRadarSeries.length > 0;
}

export function parseRadarSysShape(radarSystems, ...args) {
  const [, , optionToken] = args;
  radarSystems.forEach(radar => {
    const themeRadarSysShape = optionToken?.dvRadar?.radarSysShape;
    radar.shape = overrideIfUndefined(radar.shape, themeRadarSysShape);
  });
}

export function parseRadarSysRadius(radarSystems, ...args) {
  const [, , optionToken] = args;

  radarSystems.forEach(radar => {
    const themeRadarSysRadius = optionToken?.dvRadar?.radarSysRadius;
    // 待修复缺陷：当 radar.radius 为数值或字符串时，因非对象导致被强制重写为 themeRadarSysRadius
    if (!isObject(radar.radius)) {
      radar.radius = themeRadarSysRadius;
    } else {
      radar.radius = overrideIfUndefined(radar.radius, themeRadarSysRadius);
    }
  });
}

export function dvRadarThemeParse(...args) {
  const [option] = args;
  if (!judgeIsNormalDvRadar(option)) {
    return;
  }

  let radarSys = option.radar;
  if (!radarSys) return;
  if (!Array.isArray(radarSys)) {
    radarSys = [radarSys];
  }

  parseRadarSysShape(radarSys, ...args);
  parseRadarSysRadius(radarSys, ...args);
}
