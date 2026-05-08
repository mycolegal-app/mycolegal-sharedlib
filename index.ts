// @mycolegal-app/sharedlib — barrel principal.
//
// Reservado para tipos y utilidades puras sin side-effects.
// Los módulos con dependencias opcionales (Prisma, jose, Next) se importan
// por subpath:
//   import { ... } from "@mycolegal-app/sharedlib/auth";
//   import { ... } from "@mycolegal-app/sharedlib/api";
//   import { ... } from "@mycolegal-app/sharedlib/db";
//
// Ver SHAREDLIB_PLAN.md para el catálogo completo.
export {};
