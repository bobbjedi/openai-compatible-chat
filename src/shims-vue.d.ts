// Mocks all files ending in `.vue` showing them as plain Vue instances
/* eslint-disable */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'vue-router' {
  export function createRouter(options: any): any;
  export function createMemoryHistory(base?: string): any;
  export function createWebHistory(base?: string): any;
  export function createWebHashHistory(base?: string): any;
  export type RouteRecordRaw = any;
}