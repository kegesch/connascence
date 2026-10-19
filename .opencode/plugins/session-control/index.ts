// Auto-load shim: opencode loads plugins from .opencode/plugins/<name>/index.ts
// automatically. The implementation lives in plugin/ so it is typechecked and
// linted with the rest of the package.
export { default } from '../../../plugin/session-control';
