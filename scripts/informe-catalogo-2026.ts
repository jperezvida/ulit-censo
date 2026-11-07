/** Genera docs/fase2/CATALOGO-2026.md desde el catálogo 2026 (sin datos censales). */
import { writeFileSync } from 'node:fs';
import { informeCatalogo2026 } from '../src/domain/informeCatalogo';

writeFileSync(new URL('../docs/fase2/CATALOGO-2026.md', import.meta.url), informeCatalogo2026());
console.log('docs/fase2/CATALOGO-2026.md actualizado');
