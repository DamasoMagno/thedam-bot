export async function checkMessageContentAccess(
  token: string,
  {
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(
        'https://discord.com/api/v10/oauth2/applications/@me',
        {
          headers: { Authorization: 'Bot ' + token },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.ok) {
        const app = await response.json();
        return {
          enabled: Boolean(app.flags & ((1 << 18) | (1 << 19))),
          reason: 'Habilite Message Content Intent no Developer Portal.',
        };
      }
      if (response.status === 401 || response.status === 403)
        return {
          enabled: false,
          reason: 'Confira o token e as permissões da aplicação.',
        };
    } catch {}
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  return {
    enabled: false,
    reason:
      'Não foi possível consultar as permissões do Discord após três tentativas. Tente iniciar novamente mais tarde.',
  };
}
