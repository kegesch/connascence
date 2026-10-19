// Auto-load shim: opencode loads plugins from .opencode/plugins/<name>/index.ts
// automatically. The implementation lives in plugin/ (shipped with the package);
// this file only adapts it to the auto-load location.
export { default } from '../../../plugin/index';
