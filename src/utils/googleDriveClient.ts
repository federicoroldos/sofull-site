const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DOWNLOAD_URL = 'https://www.googleapis.com/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const BACKUP_FILENAME = 'sofull.json';
const LEGACY_BACKUP_FILENAME = 'ramyeon-dictionary.json';

export class DriveAuthError extends Error {
  constructor(message = 'Google Drive access expired. Please sign in again.') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

const handleDriveError = async (response: Response, fallback: string) => {
  const errorText = await response.text();
  if (response.status === 401) {
    throw new DriveAuthError();
  }
  throw new Error(`${fallback}: ${errorText || response.statusText}`);
};

const escapeQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const buildAppDataQuery = (name: string) =>
  `name = '${escapeQueryValue(name)}' and trashed = false and 'appDataFolder' in parents`;

const createAppDataFile = async (token: string, name: string) => {
  const createResponse = await fetch(FILES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/json',
      parents: ['appDataFolder']
    })
  });

  if (!createResponse.ok) {
    await handleDriveError(createResponse, 'Error creating appData file');
  }

  const data = (await createResponse.json()) as { id?: string };
  if (!data.id) {
    throw new Error('Could not resolve appData file id');
  }
  return data.id;
};

const listAppDataFileId = async (token: string, name: string) => {
  const query = buildAppDataQuery(name);
  const listUrl = `${FILES_URL}?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id,name)`;
  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!listResponse.ok) {
    await handleDriveError(listResponse, 'Error listing appData files');
  }

  const listData = (await listResponse.json()) as { files?: Array<{ id: string }> };
  return listData.files?.[0]?.id ?? null;
};

const migrateLegacyAppDataFile = async (token: string, legacyId: string) => {
  const content = await downloadFromAppData(token, legacyId);
  const newId = await createAppDataFile(token, BACKUP_FILENAME);
  await uploadToAppData(token, newId, content || '');
  return newId;
};

export const ensureAppDataFile = async (token: string, name = BACKUP_FILENAME) => {
  const primaryId = await listAppDataFileId(token, name);
  if (primaryId) return primaryId;
  if (name === BACKUP_FILENAME) {
    const legacyId = await listAppDataFileId(token, LEGACY_BACKUP_FILENAME);
    if (legacyId) {
      try {
        return await migrateLegacyAppDataFile(token, legacyId);
      } catch {
        return legacyId;
      }
    }
  }
  return createAppDataFile(token, name);
};

export async function uploadToAppData(token: string, fileId: string, content: string) {
  const url = `${UPLOAD_URL}/${fileId}?uploadType=media`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: content
  });

  if (!response.ok) {
    await handleDriveError(response, 'Error uploading to Drive');
  }
}

export async function downloadFromAppData(token: string, fileId: string) {
  const url = `${DOWNLOAD_URL}/${fileId}?alt=media`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    await handleDriveError(response, 'Error downloading from Drive');
  }

  return response.text();
}

interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webViewLink?: string;
}

export const ensureFolder = async (token: string, name: string, parentId?: string) => {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Folder name is required.');

  const parentFilter = parentId ? ` and '${escapeQueryValue(parentId)}' in parents` : '';
  const query = `name = '${escapeQueryValue(normalizedName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentFilter}`;
  const listUrl = `${FILES_URL}?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)&orderBy=createdTime asc&pageSize=1`;
  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!listResponse.ok) {
    await handleDriveError(listResponse, 'Error listing folders');
  }

  const listData = (await listResponse.json()) as { files?: Array<{ id: string }> };
  if (listData.files?.[0]?.id) {
    return listData.files[0].id;
  }

  const createResponse = await fetch(FILES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: normalizedName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    })
  });

  if (!createResponse.ok) {
    await handleDriveError(createResponse, 'Error creating folder');
  }

  const createdFolder = (await createResponse.json()) as { id?: string };
  if (!createdFolder.id) {
    throw new Error('Could not resolve folder id.');
  }
  return createdFolder.id;
};

export const uploadFileMultipart = async (
  token: string,
  file: File,
  folderId: string,
  nameOverride?: string
): Promise<DriveFileMetadata> => {
  const boundary = `sofull-${crypto.randomUUID?.() || Date.now()}`;
  const metadata = {
    name: nameOverride?.trim() || file.name,
    mimeType: file.type || 'application/octet-stream',
    parents: [folderId]
  };

  const body = new Blob(
    [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      `${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\n`,
      `Content-Type: ${metadata.mimeType}\r\n\r\n`,
      file,
      '\r\n',
      `--${boundary}--`
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const uploadResponse = await fetch(
    `${UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,thumbnailLink,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!uploadResponse.ok) {
    await handleDriveError(uploadResponse, 'Error uploading image');
  }

  const data = (await uploadResponse.json()) as Partial<DriveFileMetadata>;
  if (!data.id || !data.name || !data.mimeType) {
    throw new Error('Invalid Drive upload response.');
  }
  return data as DriveFileMetadata;
};

export const fetchFileBlob = async (token: string, fileId: string) => {
  const url = `${DOWNLOAD_URL}/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    await handleDriveError(response, 'Error downloading Drive image');
  }

  return response.blob();
};

export const deleteDriveFile = async (token: string, fileId: string) => {
  const url = `${FILES_URL}/${encodeURIComponent(fileId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    await handleDriveError(response, 'Error deleting Drive file');
  }
};

export const updateDriveFileName = async (token: string, fileId: string, name: string) => {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('File name is required.');
  }

  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,mimeType`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: normalizedName })
  });

  if (!response.ok) {
    await handleDriveError(response, 'Error updating Drive file');
  }

  const data = (await response.json()) as Partial<DriveFileMetadata>;
  if (!data.id || !data.name || !data.mimeType) {
    throw new Error('Invalid Drive update response.');
  }
  return data as DriveFileMetadata;
};
