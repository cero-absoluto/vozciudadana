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
  const paginate = async (path) => {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const chunk = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      out.push(...chunk);
      if (chunk.length < 100) break;
    }
    return out;
  };
  return { request, paginate };
}
