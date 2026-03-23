/**
 * Shared API endpoint extraction — regex-based, no LLM needed.
 * Used by the onboarding service to list discovered routes.
 */

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
  handler?: string;
}

export function extractApiEndpoints(
  fileMap: Map<string, string>,
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  for (const [filePath, content] of fileMap) {
    const lower = filePath.toLowerCase();

    // ── JS / TS: NestJS decorators ──
    if (lower.endsWith('.ts') || lower.endsWith('.js')) {
      const decoratorRegex =
        /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*(?:['`"]([^'`"]*?)['`"])?\s*\)/g;
      const controllerRegex =
        /@Controller\s*\(\s*(?:['`"]([^'`"]*?)['`"])?\s*\)/;
      const controllerMatch = controllerRegex.exec(content);
      const baseRoute = controllerMatch ? `/${controllerMatch[1] ?? ''}` : '';
      let match: RegExpExecArray | null;
      while ((match = decoratorRegex.exec(content)) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(),
          path: `${baseRoute}/${match[2] ?? ''}`.replace(/\/+/g, '/') || '/',
          file: filePath,
        });
      }

      // Express-style: app.get('/path', ...) or router.get('/path', ...)
      const expressRegex =
        /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
      while ((match = expressRegex.exec(content)) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: filePath,
        });
      }

      // Next.js App Router
      if (filePath.includes('/route.') || filePath.includes('\\route.')) {
        const routeRegex =
          /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
        while ((match = routeRegex.exec(content)) !== null) {
          const routePath = filePath
            .replace(/.*app|.*pages/, '')
            .replace(/\/route\.(ts|js)$/, '')
            .replace(/\\/g, '/');
          endpoints.push({
            method: match[1],
            path: routePath || '/',
            file: filePath,
          });
        }
      }
    }

    // ── Java / Kotlin: Spring Boot annotations ──
    if (lower.endsWith('.java') || lower.endsWith('.kt')) {
      const mappingRegex =
        /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?(?:['"]([^'"]*?)['"])?/g;
      const classMapping =
        /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*?)['"]/;
      const classMatch = classMapping.exec(content);
      const basePath = classMatch ? classMatch[1] : '';
      let match: RegExpExecArray | null;
      while ((match = mappingRegex.exec(content)) !== null) {
        const decorator = match[1];
        const method =
          decorator === 'RequestMapping'
            ? 'GET'
            : decorator.replace('Mapping', '').toUpperCase();
        const path =
          `${basePath}/${match[2] ?? ''}`.replace(/\/+/g, '/') || '/';
        endpoints.push({ method, path, file: filePath });
      }
    }

    // ── Python: Flask / FastAPI / Django ──
    if (lower.endsWith('.py')) {
      const pyRouteRegex =
        /(?:@\w+\.(?:route\s*\(\s*['"]([^'"]+)['"]\s*,\s*methods\s*=\s*\[([^\]]+)\])|@\w+\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"])/g;
      let match: RegExpExecArray | null;
      while ((match = pyRouteRegex.exec(content)) !== null) {
        if (match[1]) {
          const methods = match[2]
            .replace(/['"]\s*/g, '')
            .split(',')
            .map((m) => m.trim().toUpperCase());
          for (const m of methods) {
            endpoints.push({ method: m, path: match[1], file: filePath });
          }
        } else if (match[3]) {
          endpoints.push({
            method: match[3].toUpperCase(),
            path: match[4],
            file: filePath,
          });
        }
      }

      // Django urls.py
      if (lower.includes('urls')) {
        const djangoRegex = /path\s*\(\s*['"]([^'"]+)['"]/g;
        while ((match = djangoRegex.exec(content)) !== null) {
          endpoints.push({
            method: 'ANY',
            path: `/${match[1]}`,
            file: filePath,
          });
        }
      }
    }

    // ── Go: net/http, Gin, Echo, Chi ──
    if (lower.endsWith('.go')) {
      const goHttpRegex = /(?:HandleFunc|Handle)\s*\(\s*"([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = goHttpRegex.exec(content)) !== null) {
        endpoints.push({ method: 'ANY', path: match[1], file: filePath });
      }
      const ginRegex = /\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"([^"]+)"/g;
      while ((match = ginRegex.exec(content)) !== null) {
        endpoints.push({ method: match[1], path: match[2], file: filePath });
      }
    }

    // ── C#: ASP.NET ──
    if (lower.endsWith('.cs')) {
      const aspRegex =
        /\[(Http(Get|Post|Put|Patch|Delete))\s*(?:\(\s*"([^"]*)")?/g;
      let match: RegExpExecArray | null;
      const routeAttr = /\[Route\s*\(\s*"([^"]*)"/;
      const routeMatch = routeAttr.exec(content);
      const aspBase = routeMatch ? routeMatch[1] : '';
      while ((match = aspRegex.exec(content)) !== null) {
        const path = `${aspBase}/${match[3] ?? ''}`.replace(/\/+/g, '/') || '/';
        endpoints.push({
          method: match[2].toUpperCase(),
          path,
          file: filePath,
        });
      }
    }

    // ── Ruby: Rails ──
    if (
      lower.endsWith('.rb') &&
      (lower.includes('routes') || lower.includes('controller'))
    ) {
      const railsRegex = /(?:get|post|put|patch|delete)\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = railsRegex.exec(content)) !== null) {
        const method = content
          .slice(match.index, match.index + 6)
          .trim()
          .toUpperCase();
        endpoints.push({ method, path: match[1], file: filePath });
      }
      const resourceRegex = /resources?\s+:([\w]+)/g;
      while ((match = resourceRegex.exec(content)) !== null) {
        endpoints.push({
          method: 'CRUD',
          path: `/${match[1]}`,
          file: filePath,
        });
      }
    }

    // ── PHP: Laravel ──
    if (lower.endsWith('.php')) {
      const laravelRegex =
        /Route::(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = laravelRegex.exec(content)) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: filePath,
        });
      }
    }
  }

  return endpoints;
}
