export const GOOGLE_DRIVE_CLIENT_ID_KEY = 'cine_codice_google_client_id_v1';
export const GOOGLE_DRIVE_BACKUP_FOLDER_NAME = 'Cine Codice Backups';
export const GOOGLE_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file';
export const DEFAULT_GDRIVE_BACKUP_FILENAME = 'cine-codice-latest.ccodex';

let cachedAccessToken = '';
let cachedTokenExpiresAt = 0;

export function getConfiguredGoogleClientId() {
  const envClientId =
    (typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
    '';

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(GOOGLE_DRIVE_CLIENT_ID_KEY);
      if (saved && saved.trim()) {
        return saved.trim();
      }
    } catch {
      // ignore storage errors
    }
  }
  return String(envClientId || '').trim();
}

export function setConfiguredGoogleClientId(clientId) {
  const clean = String(clientId || '').trim();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (clean) {
        window.localStorage.setItem(GOOGLE_DRIVE_CLIENT_ID_KEY, clean);
      } else {
        window.localStorage.removeItem(GOOGLE_DRIVE_CLIENT_ID_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
  return clean;
}

export function setCachedGoogleAccessToken(token, expiresInSeconds = 3500) {
  cachedAccessToken = String(token || '').trim();
  cachedTokenExpiresAt = cachedAccessToken
    ? Date.now() + Number(expiresInSeconds || 3500) * 1000
    : 0;
}

export function getCachedGoogleAccessToken() {
  if (cachedAccessToken && Date.now() < cachedTokenExpiresAt) {
    return cachedAccessToken;
  }
  return '';
}

export async function requestGoogleDriveAccessToken({ clientId } = {}) {
  const existing = getCachedGoogleAccessToken();
  if (existing) return existing;

  const resolvedClientId = String(clientId || getConfiguredGoogleClientId()).trim();
  if (!resolvedClientId) {
    throw new Error(
      'Configure o Google Client ID (OAuth 2.0 Web) antes de conectar ao Google Drive.'
    );
  }

  if (
    typeof window !== 'undefined' &&
    window.google?.accounts?.oauth2?.initTokenClient
  ) {
    return new Promise((resolve, reject) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: resolvedClientId,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: (response) => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          if (response?.access_token) {
            setCachedGoogleAccessToken(
              response.access_token,
              Number(response.expires_in) || 3500
            );
            resolve(response.access_token);
            return;
          }
          reject(new Error('Nenhum token OAuth retornado pelo Google Drive.'));
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  throw new Error(
    'Biblioteca Google Identity Services não carregada ou token de acesso manual necessário.'
  );
}

export async function listBackupsFromGoogleDrive({
  accessToken,
  useAppDataFolder = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = String(accessToken || getCachedGoogleAccessToken()).trim();
  if (!token) {
    throw new Error('Token de acesso do Google Drive ausente.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Implementação fetch indisponível.');
  }

  const spaces = useAppDataFolder ? 'appDataFolder' : 'drive';
  const query = encodeURIComponent(
    "trashed = false and (name contains '.ccodex' or name contains 'cine-codice')"
  );
  const url = `https://www.googleapis.com/drive/v3/files?spaces=${spaces}&q=${query}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime%20desc&pageSize=10`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Erro ao listar backups no Google Drive (${response.status}): ${errText || response.statusText}`
    );
  }

  const data = await response.json();
  return Array.isArray(data?.files) ? data.files : [];
}

export async function uploadBackupToGoogleDrive(
  ccodexPayload,
  {
    accessToken,
    fileName = DEFAULT_GDRIVE_BACKUP_FILENAME,
    useAppDataFolder = true,
    fetchImpl = globalThis.fetch,
  } = {}
) {
  const token = String(accessToken || getCachedGoogleAccessToken()).trim();
  if (!token) {
    throw new Error('Token de acesso do Google Drive ausente.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Implementação fetch indisponível.');
  }

  const contentString =
    typeof ccodexPayload === 'string'
      ? ccodexPayload
      : JSON.stringify(ccodexPayload);

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    ...(useAppDataFolder ? { parents: ['appDataFolder'] } : {}),
  };

  const boundary = '-------CineCodiceGDriveBoundaryV130';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    contentString +
    closeDelimiter;

  const response = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Falha ao enviar backup para o Google Drive (${response.status}): ${errText || response.statusText}`
    );
  }

  return response.json();
}

export async function downloadBackupFromGoogleDrive(
  fileId,
  { accessToken, fetchImpl = globalThis.fetch } = {}
) {
  const token = String(accessToken || getCachedGoogleAccessToken()).trim();
  if (!token) {
    throw new Error('Token de acesso do Google Drive ausente.');
  }
  const cleanId = String(fileId || '').trim();
  if (!cleanId) {
    throw new Error('ID do arquivo do Google Drive inválido.');
  }

  const response = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?alt=media`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Falha ao baixar backup do Google Drive (${response.status}): ${errText || response.statusText}`
    );
  }

  return response.text();
}

export async function restoreLatestBackupFromGoogleDrive({
  accessToken,
  useAppDataFolder = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const files = await listBackupsFromGoogleDrive({
    accessToken,
    useAppDataFolder,
    fetchImpl,
  });
  if (!files.length) {
    throw new Error('Nenhum backup .ccodex encontrado na sua conta do Google Drive.');
  }
  const latest = files[0];
  const rawContent = await downloadBackupFromGoogleDrive(latest.id, {
    accessToken,
    fetchImpl,
  });
  return {
    file: latest,
    rawContent,
  };
}
