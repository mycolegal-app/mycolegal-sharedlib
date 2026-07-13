# Plan técnico — Motor de minutación arancelaria a sharedlib

**Estado:** propuesta, pendiente de aprobación. No tocar código hasta el visto bueno.
**Fecha:** 2026-07-13
**Decisión de negocio (fijada por el notario):** los coeficientes del arancel notarial son
**únicos por notaría** (RD 1426/1989). No hay divergencia legítima entre apps.
**Segunda decisión:** el arancel se **versiona por fecha** — un acto se minuta (y se reminuta)
con el arancel vigente en su fecha de devengo, no con el de hoy. Entra en la migración inicial.

---

## 1. Situación actual: cuatro motores para un solo arancel

| # | Motor | Dónde | Config | Estado real en prod |
|---|-------|-------|--------|---------------------|
| 1 | Puro, lista cerrada de 12 tipos, escala fija en código | `tributos/src/lib/aranceles/` (277 líneas) | Ninguna (hardcode) | Solo lo llama el botón de sugerencia de Notaría → **0 usos reales** |
| 2 | Matriz concepto×supuesto por org | `legifirma/src/lib/minutacion-motor.ts` (440 líneas + tests) | Tablas `Minutacion*` (platform) | **En uso**: 8 cálculos persistidos con traza, 7 precios asignados (237,69 €) |
| 3 | Fórmulas JSON por org | `notaria/src/lib/minutacion/calculator.ts` (130 líneas) | Tabla `minuta_aranceles` | **Nunca ha calculado nada**: 0 minutas, 0 líneas |
| 4 | Proxy HTTP hacia (1) | `notaria/src/lib/aranceles-client.ts` + `/api/minutas/[id]/calcular-arancel` | — | Botón "sugerir arancel", sin uso real |

### Datos de producción (consulta read-only, 2026-07-13)

```
minuta_aranceles (catálogo Notaría) ......  25 filas / 5 orgs  → 5 códigos × 5 orgs = SEED, 0 editadas
minutas emitidas (Notaría) ...............   0
minuta_conceptos (líneas) ................   0
minutacion_conceptos (LegiFirma) .........  65 filas / 5 orgs  (13 códigos × 5), 3 EDITADOS por el notario
minutacion_esquemas ......................  10 (5 activos, 1 por org), 1 EDITADO
minutacion_esquema_reglas ................ 240
minutacion_escala_tramos .................  50
minutacion_tipologias ....................  30 (6 núcleo × 5 orgs)
actuaciones (LegiFirma) ..................  24 en 1 org
  · con precioSugerido + arancelMeta .....   8   ← el motor calculó y dejó traza
  · con precioAsignado ...................   7   (suma 237,69 €)
  · con fechaPrecio (E5) .................  17
  · con fechaFacturado (E6) ..............   3
  · con override de esquema ..............   0   ← normal: es override opcional, no señal de no-uso
```

**Lectura:** el lado a preservar es LegiFirma (config real, con ediciones manuales del notario y
cálculos ya persistidos). El lado de Notaría es un seed sin estrenar: **se borra, no se migra**.
Éste es el momento óptimo para unificar — en cuanto Notaría emita minutas reales, el coste sube.

---

## 2. Hallazgo: el seed de Notaría no es el arancel

`notaria/src/lib/minutacion/seed-aranceles.ts` se autodescribe como *"subset representativo…
para que el seed sirva también como ejemplo vivo de cada estructura"*. Es un **fixture de demo**,
no el RD. Dos consecuencias concretas:

**`N3-PCT-FIJO` es un invento.** Su propia descripción dice *"Tarifa plana sobre la base imponible
(uso interno)"*. No corresponde a ninguna figura del RD 1426/1989: existe únicamente para que el
seed ejercite el tercer tipo de fórmula (`PORCENTAJE`) del calculator. **Se descarta**, y con él
la fórmula `PORCENTAJE` — no hay que portarla al modelo unificado.

**`N2-CUANTIA-TRAMOS` está mal calculado.** Los tramos por el exceso sí coinciden con el RD
(0,45 % = 4,5 ‰, 0,15 % = 1,5 ‰, 0,1 % = 1 ‰, 0,05 % = 0,5 ‰, 0,03 % = 0,3 ‰), pero:

- aplica **0,45 % al primer tramo** (0 – 6.010,12 € → 27,05 €) cuando el RD fija una **cuota fija
  de 90,151816 €** para ese tramo. Error de ~63 € por minuta, siempre a la baja;
- aplica **0,01 % por encima de 6.010.121,04 €** cuando el RD declara ese tramo **libre**
  (el notario acuerda el importe con el cliente).

El modelo de LegiFirma (`ESCALA_N2_DEFAULT` en `minutacion-motor.ts`: `baseFijo 90,151816`,
`baseHasta 6.010,12`, tramos al por mil, tope libre) **sí es el RD**. Confirma que la dirección de
la convergencia es Notaría → LegiFirma, y no al revés.

---

## 2 bis. Hallazgo: el histórico se está corrompiendo hoy

En prod hay **3 conceptos y 1 esquema editados** después del seed. Como los coeficientes viven en
`MinutacionConcepto` (columnas `coefPrimero`/`coefSegundo`/`importeFijo`, únicas por
`(orgId, codigo)`) y el cálculo los lee en vivo, **editar un coeficiente reescribe retroactivamente
lo que habría costado un acto minutado el año pasado**. Los 8 cálculos ya persistidos se salvan sólo
porque `arancelMeta` guarda una traza; pero un recálculo daría otro importe.

Esto no es un problema nuevo que introduzca el versionado: es un bug latente que el versionado
**arregla**. Y es la razón por la que la unidad de versión no puede ser sólo el esquema tal como
está hoy: los coeficientes tienen que colgar de la versión, no del catálogo.

---

## 3. Diseño objetivo

Un solo motor (sharedlib), un solo modelo de datos (`Minutacion*` en platform), una sola
configuración por organización, **versionada por fecha**. Lo que varía por app son **los conceptos
y las tipologías** (las filas y columnas de la matriz), no los coeficientes.

```
                    ┌──────────────────────────────────────┐
                    │  @mycolegal-app/sharedlib/minutacion  │
                    │  primitivas puras, sin BD, testeadas  │
                    │  calc51/52/54 · calcEscalaN2 · eval   │
                    └───────────────┬──────────────────────┘
                        ┌───────────┴───────────┐
                   LegiFirma                 Notaría
              (conceptos ámbito          (conceptos ámbito
               LEGIFIRMA: 5.1–5.4)        NOTARIA: nº1/nº2/folios/copias)
                        └───────────┬───────────┘
                    ┌───────────────┴──────────────────────────────┐
                    │  Tablas Minutacion* (mycolegal_app)          │
                    │  Esquema = UNA VERSIÓN del arancel de la org │
                    │  (vigenteDesde/Hasta): escala nº 2,          │
                    │  reducciones, tramos Y coeficientes          │
                    └─────────────────────────────────────────────┘
```

**Regla de oro 1 — ámbito:** se etiqueta en `MinutacionConcepto` y `MinutacionTipologia`.
**Nunca en `MinutacionEsquema`** — el esquema guarda la escala y las reducciones, que son el
arancel de la notaría y son comunes a todas las apps. Etiquetar el esquema por app reintroduciría
coeficientes duplicados por la puerta de atrás.

**Regla de oro 2 — versión:** la unidad de versión es **el esquema**. Todo lo que puede cambiar con
el tiempo (escala, reducciones, tramos **y coeficientes**) cuelga de él. `MinutacionConcepto` queda
como **catálogo semántico** de la org: qué es cada concepto (código, nombre, fórmula, ámbito, flags
fiscales), no cuánto vale. El cuánto vale es propio de cada versión.

**Regla de oro 3 — inmutabilidad *sólo cuando duele*:** una versión se congela **cuando se ha
usado**, no antes. Mientras ninguna minuta se haya calculado contra ella, se edita libremente
(borradores, correcciones de un coeficiente mal tecleado, la versión recién publicada que todavía
no ha minutado nada). **Al primer cálculo persistido contra ella, pasa a solo lectura**: a partir de
ahí, cambiar una tarifa es publicar una versión nueva con `vigenteDesde` a futuro.

Lo que se protege es el histórico real, no la pureza del modelo: si nadie ha minutado con esa
versión, editarla no reescribe nada, y forzar una versión nueva sería burocracia sin beneficio —
además de llenar la organización de versiones basura que el notario no entiende.

**Definición operativa de "usada":** existe al menos un cálculo **persistido** que la referencia
(un `precioSugerido`/minuta guardado, no una previsualización). Ver F0.d: hoy esa pregunta no se
puede contestar con un índice, y hay que poder contestarla.

---

## 4. Fases

### F0 — Modelo de datos (platform)

Migración **idempotente** (`IF NOT EXISTS` / DO-block) en `mycolegal-platform/prisma/`.

**F0.a — Ámbito por app**

1. `enum AmbitoMinutacion { COMUN, NOTARIA, LEGIFIRMA }`.
2. Columna `ambito AmbitoMinutacion @default(LEGIFIRMA)` en `MinutacionConcepto` y
   `MinutacionTipologia`. **Backfill: todas las filas existentes (65 conceptos + 30 tipologías)
   son de LegiFirma**, de ahí el default.
3. Índice `@@index([orgId, ambito, active])` en ambas (la UI filtra por ahí).

**F0.b — Fórmula nueva**

4. `enum FormulaMinutacion` += **`N2_ESCALA`** — escala regresiva del nº 2 **sin** la reducción del
   85 % (documentos de cuantía, nº 1/nº 2 del Anexo I). Hoy solo existe `N5_3`, que es la misma
   escala × 0,15 para legitimaciones con cuantía. El motor ya tiene `calcEscalaN2()`; `N2_ESCALA`
   es, literalmente, no aplicar el × 0,15.
5. **No** se añade `PORCENTAJE` (ver §2).

**F0.c — Versionado temporal (el esquema es la versión)**

6. `MinutacionEsquema` +=
   - `vigenteDesde DateTime?` — **`NULL` = borrador** (nunca se aplica; es el estado de un esquema
     clonado que aún se está preparando).
   - `vigenteHasta DateTime?` — `NULL` = versión abierta (la vigente).
   - `@@index([orgId, vigenteDesde])`.
7. **Nuevo modelo `MinutacionEsquemaConcepto`** — los coeficientes **de esa versión**:
   ```prisma
   model MinutacionEsquemaConcepto {
     id             String            @id @default(cuid())
     esquemaId      String
     esquema        MinutacionEsquema @relation(fields: [esquemaId], references: [id], onDelete: Cascade)
     conceptoCodigo String            // join por codigo dentro de la org del esquema
     coefPrimero    Decimal?          @db.Decimal(12, 6)
     coefSegundo    Decimal?          @db.Decimal(12, 6)
     importeFijo    Decimal?          @db.Decimal(12, 6)

     @@unique([esquemaId, conceptoCodigo])
     @@index([esquemaId])
     @@map("minutacion_esquema_conceptos")
   }
   ```
   Los coeficientes van por **concepto dentro de la versión**, no por celda de la matriz: el mismo
   concepto en dos columnas (supuestos) tiene el mismo coeficiente, y `MinutacionEsquemaRegla`
   sigue diciendo únicamente *aplica sí/no*.
8. **Backfill** (crítico, y es el único paso con datos vivos):
   para cada `MinutacionEsquema` × cada `MinutacionConcepto` de su org → insertar una fila con los
   coeficientes actuales del concepto. Son 10 esquemas × 13 conceptos ≈ **130 filas**. Con esto,
   las 3 ediciones manuales del notario quedan preservadas en todas sus versiones (es lo correcto:
   hasta hoy esos coeficientes *eran* los de todas).
9. `MinutacionConcepto`: `coefPrimero`/`coefSegundo`/`importeFijo` quedan **deprecados**.
   **No se dropean en F0** — se dejan como plantilla de alta (valores por defecto al crear una
   versión nueva) y se marcan como tal en el comentario del schema. Dropearlos exigiría que todos
   los consumidores estuvieran ya migrados; se hace en un commit posterior a F3, si se hace.
10. **Vigencia de los datos actuales:** los 5 esquemas `activo = true` → `vigenteDesde = '1990-01-01'`,
    `vigenteHasta = NULL`. Fecha deliberadamente antigua para que **cualquier cálculo pasado resuelva**
    (los 8 `arancelMeta` de prod incluidos). Los 5 esquemas no activos → `vigenteDesde = NULL`
    (borradores).
11. **`activo` se deprecia** en favor de la vigencia (mantenerlo sería una segunda fuente de verdad
    que se desincroniza). Se conserva la columna durante F2–F3 para no romper el código existente y
    se elimina al final. Regla mientras coexistan: `activo` ⇔ *vigente hoy*.
12. **No solapamiento:** dos versiones de la misma org no pueden solapar fechas. Validación en la
    app al publicar; opcionalmente constraint `EXCLUDE USING gist (orgId WITH =, daterange(...) WITH &&)`
    (requiere `btree_gist`) — recomendado, pero si complica la migración basta la validación.

**F0.d — Poder saber si una versión se ha usado**

13. Hoy el esquema aplicado **sí se registra, pero enterrado en un JSON**: el motor lo devuelve en
    `DesgloseMinuta.esquemaId` y acaba en `arancelMeta.minuta.esquemaId`. No es consultable con
    índice ni tiene integridad referencial, así que la regla de oro 3 no se puede aplicar de forma
    fiable sobre eso.
14. Añadir a `Actuacion` (LegiFirma) una columna **`minutacionEsquemaAplicadoId String?`** con FK e
    índice — **distinta del `minutacionEsquemaId` actual, que es el _override_ de entrada**. Una
    dice "con qué versión quiero que se calcule"; la otra, "con qué versión se calculó de verdad".
    Confundirlas es fácil y sería un bug feo: nombrar y comentar con cuidado.
    Equivalente en `Minuta` (Notaría) cuando se conecte en F3.
15. **Backfill**: `minutacionEsquemaAplicadoId := arancelMeta->'minuta'->>'esquemaId'` para las 8
    actuaciones con cálculo persistido. Verificable: las 8 deben quedar apuntando a un esquema real
    de su org.
16. Con eso, *"¿esta versión se ha usado?"* es un `count` indexado, y el bloqueo de edición es
    barato de comprobar en cada guardado.

Replicar los modelos en los `schema.prisma` curados de LegiFirma y **añadirlos al de Notaría**
(hoy no los tiene). Sin migración propia: las tablas ya existen en `mycolegal_app`.

> Recordatorio: editar `schema.prisma` y crear la migración **en el mismo commit**.

### F1 — Extraer el motor a sharedlib

Nuevo módulo `mycolegal-sharedlib/minutacion.ts` (módulo plano en la raíz, como `global-settings.ts`),
añadido a `files[]` de `package.json`. Contenido, movido **tal cual** desde
`legifirma/src/lib/minutacion-motor.ts`:

- primitivas puras: `redondeoCentimo`, `calc51`, `calc52`, `calc54`, `calcEscalaN2`, `calc53`;
- tipos: `EscalaN2Config`, `EscalaN2Result`, `ESCALA_N2_DEFAULT`;
- evaluador de concepto: dada una fórmula + coeficientes + magnitudes (folios, firmas, cuantía)
  → importe de línea;
- **nueva** rama `N2_ESCALA`;
- **nueva** función pura `resolverEsquemaVigente(esquemas, fecha)` — dado un array de versiones
  (`{id, vigenteDesde, vigenteHasta}`) y la **fecha de devengo**, devuelve la que aplica, o `null`.
  Los borradores (`vigenteDesde === null`) nunca resuelven. Es pura (no toca BD) y es la pieza que
  garantiza que las dos apps resuelven la versión con la misma regla.

**El cálculo pasa a exigir fecha de devengo explícita.** La firma del evaluador lleva `fecha`; no
hay `new Date()` por defecto dentro del motor — la app dice siempre con qué fecha se minuta, porque
"hoy" es una respuesta correcta sólo para actos nuevos.

Lo que **no** sube a sharedlib: la parte que toca BD (carga de las versiones, la matriz, las
tipologías). Eso se queda en cada app, que ya tiene su `prisma` — sharedlib no debe depender del
cliente Prisma de nadie (`@prisma/client` es peer **opcional**).

Los tests (`minutacion-motor.test.ts`) se mueven con el motor y son la red de seguridad: **la
extracción es un refactor de comportamiento idéntico, no la ocasión de "mejorar" el motor.**

Publicar con `publish-sharedlib.sh` **desde `main`** (0.9.7 → 0.10.0).

### F2 — LegiFirma consume sharedlib

- `minutacion-motor.ts` pasa a re-exportar desde `@mycolegal-app/sharedlib/minutacion`, o se borra
  y se actualizan los imports (`minutacion-aplicacion.ts`, `traslado-negociado.ts`,
  `api/actuaciones/[id]/calcular-arancel`, `api/minutacion/consulta`, `admin/minutacion/aplicacion`).
- Seed de conceptos existente (`aranceles-seed.ts` / `aranceles-defaults.ts`): marcar los 13
  conceptos y las 6 tipologías núcleo con `ambito: LEGIFIRMA`, y escribir los coeficientes en
  `MinutacionEsquemaConcepto` de la versión que crea, no en el catálogo.
- La carga de coeficientes pasa de leer `MinutacionConcepto` a leer `MinutacionEsquemaConcepto` de
  la **versión resuelta por fecha** (`resolverEsquemaVigente`). La fecha de devengo en LegiFirma es
  la **fecha de la actuación** (no la de hoy, ni la del cálculo).
- El override por actuación (`minutacionEsquemaId`) sigue funcionando: si está, gana sobre la
  resolución por fecha. Es la vía de escape para un caso pactado.
- **UI:** la pantalla de esquema **sigue siendo de edición directa mientras la versión no se haya
  usado** — que es el caso hoy en 4 de las 5 orgs, y el caso siempre de un borrador o de una
  versión recién publicada. Sólo cuando la versión tiene cálculos persistidos contra ella
  (`count(minutacionEsquemaAplicadoId = version) > 0`) pasa a solo lectura, y la pantalla ofrece
  **"publicar una versión nueva"** (clonar → editar → fijar `vigenteDesde` → publicar, lo que cierra
  el `vigenteHasta` de la anterior).
- El aviso al notario tiene que decir **por qué** está bloqueada: *"esta versión ya se ha usado para
  minutar N actuaciones; para cambiar tarifas, publica una versión nueva"*. Un campo deshabilitado
  sin explicación es una llamada al soporte.
- Persistir `minutacionEsquemaAplicadoId` en cada cálculo guardado (F0.d). Sin esto, la regla no se
  puede aplicar y todo lo demás sobra.
- **Test de regresión con datos reales:** los 8 `arancelMeta` ya persistidos en prod se convierten
  en casos de test — el motor de sharedlib debe reproducir el mismo importe al céntimo, resolviendo
  la versión por la fecha de cada actuación. Si uno solo cambia, la extracción está mal.
- Bump de sharedlib + consumidores en el **mismo commit** (nunca un commit intermedio sin bumpear).

### F3 — Notaría consume el motor compartido

- Añadir `Minutacion*` al `schema.prisma` de Notaría (F0).
- Seed de conceptos con `ambito: NOTARIA`, **con las cifras correctas del RD** (no las del seed
  viejo): documento de cuantía (`N2_ESCALA`), documento sin cuantía (`FIJO` 30,05 €), folio de
  matriz (`POR_FOLIO`), copia simple (`POR_FOLIO` 3,01 €), copia autorizada (`N2_ESCALA` sobre el
  valor del protocolo). Vía el motor de seeds de sharedlib (L1/L2, idempotente).
- La pantalla de minuta (`/api/protocolos/[id]/minuta/calcular` y el persistido) pasa a usar el
  motor compartido, resolviendo la versión del arancel por la **fecha de autorización del
  protocolo** (ésa es la fecha de devengo en Notaría, no la fecha en que se emite la minuta).
  Es exactamente el caso de uso que motivó el versionado: minutar en 2027 una escritura de 2026.
- `MinutaConcepto` (líneas de la minuta emitida) **se queda**; su FK `arancelId → MinutaArancel`
  se sustituye por `conceptoCodigo` (join por código dentro de la org, igual que hace
  `MinutacionEsquemaRegla`). **0 filas en prod → sin migración de datos.**
- **Se borra:** `lib/minutacion/calculator.ts`, `lib/minutacion/seed-aranceles.ts`,
  `api/catalogs/aranceles/*`, y el modelo `MinutaArancel` (DROP de `minuta_aranceles`, 25 filas de
  seed sin usar). La UI de catálogo de aranceles de Notaría se reemplaza por la de esquema/matriz
  (misma que LegiFirma; candidata a compartirse en `ui`, pero eso es opcional y va aparte).

### F4 — Eliminar el cálculo de aranceles de Tributos

Decisión del usuario: **Tributos es fiscalidad (Modelo 600 + asesor autonómico); el arancel
notarial no pinta nada ahí.** Se borra por completo:

- `tributos/src/lib/aranceles/` (`calcular.ts`, `escalas.ts`, `tipos.ts`);
- `tributos/src/app/api/inter/aranceles/calcular/` (endpoint inter);
- `tributos/src/app/api/aranceles/simular/` y la pantalla `(dashboard)/aranceles/`;
- entrada de navegación, claves de permiso asociadas (y su catálogo en `instrumentation.node.ts` —
  quitar la clave del catálogo *y* de los roles, o quedará un 403 silencioso al revés);
- e2e que cubran el simulador.

En Notaría: `lib/aranceles-client.ts`, `api/minutas/[id]/calcular-arancel/`,
`components/minutas/calcular-arancel-button.tsx` y su i18n.

En platform: **§6.5 del `INTEGRATIONS_CONTRACT.md`** (es la fuente del error original: afirmaba
que LegiFirma consumía el endpoint, lo cual nunca fue cierto).

Se pierden los modificadores que solo existían en Tributos (`descuentoColegial`, `regimenForal`,
`urgencia`). **Se descartan**: el propio código dice que salvo Navarra *"se documentan pero no
aplican"*. Si el notario los pide algún día, entran como conceptos/reglas del esquema, que es donde
les corresponde estar.

Limpiar también el comentario fósil del `schema.prisma` de LegiFirma que aún dice
*"H5 — cálculo arancelario (owner: tributos)"*.

### F5 — Verificación y despliegue

1. `minutacion-motor.test.ts` (movido a sharedlib) verde, **incluidos los 8 casos reales de prod**.
2. Tests nuevos de vigencia: acto anterior a `vigenteDesde` de la versión nueva → minuta con la
   vieja; acto sin versión vigente a su fecha → error explícito, **nunca** caer a "la de hoy";
   borrador (`vigenteDesde = NULL`) → nunca resuelve.
3. Tests de la regla de congelación: versión sin usos → editable; se minuta una actuación contra
   ella → el mismo guardado que antes pasaba ahora falla con un error explicativo; clonar y publicar
   versión nueva → editable otra vez y la vieja intacta.
4. e2e de LegiFirma (actuación → E5 precio) y de Notaría (protocolo → minuta) verdes.
4. Orden de despliegue: **platform (migración F0) → sharedlib publicada → LegiFirma → Notaría →
   Tributos**. La migración es aditiva (columnas nullable, tabla nueva, valor de enum), así que las
   revisiones viejas siguen funcionando mientras `activo` y los coeficientes del catálogo sigan
   ahí: no hay ventana de incompatibilidad.
5. Tras desplegar: reconsultar los 8 `arancelMeta` en prod y confirmar que un recálculo da el mismo
   importe **resolviendo por la fecha de cada actuación**.
6. Comprobar en prod que el backfill dejó ~130 filas en `minutacion_esquema_conceptos` y que
   ninguna org tiene dos versiones solapadas.

---

## 5. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| El refactor cambia importes ya facturados (237,69 € en 7 actuaciones) | Extracción sin cambios de comportamiento + test de regresión con los 8 `arancelMeta` reales |
| Los conceptos de Notaría contaminan la matriz de LegiFirma | Campo `ambito`; cada app filtra. Verificar en la UI de matriz de LegiFirma tras F3 |
| Un notario ya editó sus coeficientes (3 conceptos + 1 esquema) | La migración es aditiva y no toca coeficientes: el backfill los **copia** a cada versión. **No re-seedear conceptos existentes** (el seed es idempotente por `(orgId, codigo)` — comprobar que no hace `update` de coeficientes) |
| El backfill de coeficientes se salta un (esquema, concepto) → línea a 0 € silenciosa | El evaluador debe **fallar explícito** si falta la fila de coeficientes de un concepto que la fórmula necesita, en vez de calcular con `null`→0. Contar filas esperadas (esquemas × conceptos de la org) tras la migración |
| El versionado se cablea a medias y una app resuelve por fecha y la otra por `activo` | `activo` se deprecia con fecha de caducidad explícita (se borra al cerrar F3) y la resolución vive en **una sola función pura compartida** (`resolverEsquemaVigente`) |
| Se confunde el override de entrada (`minutacionEsquemaId`) con la versión aplicada (`minutacionEsquemaAplicadoId`) y el bloqueo de edición se calcula sobre la columna equivocada → una versión usada se deja editar | Nombres explícitos + comentario en el schema + test: minutar una actuación **sin** override debe dejar `minutacionEsquemaAplicadoId` relleno y `minutacionEsquemaId` a `null` |
| Una versión se congela por un cálculo que luego se descartó | Solo cuenta lo **persistido**. Las previsualizaciones (`/minuta/calcular`, panel E5 antes de guardar) no escriben `minutacionEsquemaAplicadoId` |
| Un acto antiguo no tiene versión vigente a su fecha → la app cae a "la de hoy" y reescribe el pasado | Por eso los esquemas actuales se abren en `1990-01-01`. Y si aun así no resuelve: **error explícito**, nunca fallback silencioso (test dedicado) |
| Quitar permisos de Tributos deja 403 silenciosos | Quitar la clave del catálogo de permisos *y* de los roles en el mismo commit |
| Notaría se queda sin botón de sugerencia antes de tener motor | F4 (Notaría) va **después** de F3. En realidad el botón no tiene uso real (0 minutas), así que el riesgo es nominal |

## 6. Lo que este plan NO hace

- No unifica la **UI** de matriz/esquema entre LegiFirma y Notaría (candidata a `ui`, va aparte).
  Sí incluye, en cambio, el cambio de UI de "editar el activo" a "publicar versión" (F2), que es
  requisito del versionado, no un extra.
- No toca la minutación de ninguna otra app (no la hay).
- No dropea todavía las columnas de coeficientes de `MinutacionConcepto` ni la columna `activo`:
  quedan deprecadas y se retiran en un commit de limpieza posterior a F3, cuando ningún consumidor
  las lea. Dropearlas en F0 obligaría a un despliegue atómico de las tres apps.
- No versiona el **catálogo semántico** (qué conceptos existen), solo sus importes. Añadir un
  concepto nuevo no crea una versión; cambiar lo que cuesta, sí.
