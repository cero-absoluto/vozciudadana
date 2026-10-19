// Acceso mínimo a la API REST de GitHub (fetch nativo, sin dependencias). `request` es inyectable para pruebas offline.
export function makeApi({ token, apiUrl = 'https://api.github.com', fetchImpl = globalThis.fetch }) {
  const request = async (method, path, body) => {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub API ${method} ${path} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  // Sigue las páginas hasta una página corta (sin tope práctico). El techo (100 páginas = 10 000 elementos) NO trunca en
  // silencio: lanza error, así que quien llama falla cerrado (por ejemplo, el publicador no empuja) en vez de decidir con
  // datos incompletos, como una orden `stop` reciente que quedara fuera de la lista.
  const MAX_PAGES = 100;
  const paginate = async (path) => {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const chunk = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      out.push(...chunk);
      if (chunk.length < 100) return out;
    }
    throw new Error(`GitHub API GET ${path}: más de ${MAX_PAGES * 100} elementos; resultado incompleto rechazado`);
  };
  return { request, paginate };
}
