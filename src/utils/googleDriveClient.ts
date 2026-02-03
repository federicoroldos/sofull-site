const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DOWNLOAD_URL = 'https://www.googleapis.com/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const BACKUP_FILENAME = 'ramyeon-dictionary.json';
const APP_DATA_QUERY = `name = '${BACKUP_FILENAME}' and trashed = false and 'appDataFolder' in parents`;

export const ensureAppDataFile = async (token: string, name = BACKUP_FILENAME) => {
  const listUrl = `${FILES_URL}?q=${encodeURIComponent(APP_DATA_QUERY)}&spaces=appDataFolder&fields=files(id,name)`;
  const listResponse = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    throw new Error(`Error listing appData files: ${errorText || listResponse.statusText}`);
  }

  const listData = (await listResponse.json()) as { files?: Array<{ id: string }> };
  if (listData.files && listData.files.length > 0) {
    return listData.files[0].id;
  }

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
    const errorText = await createResponse.text();
    throw new Error(`Error creating appData file: ${errorText || createResponse.statusText}`);
  }

  const data = (await createResponse.json()) as { id?: string };
  if (!data.id) {
    throw new Error('Could not resolve appData file id');
  }
  return data.id;
};

export const uploadToAppData = async (token: string, fileId: string, content: string) => {
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
    const errorText = await response.text();
    throw new Error(`Error uploading to Drive: ${errorText || response.statusText}`);
  }
};

export const downloadFromAppData = async (token: string, fileId: string) => {
  const url = `${DOWNLOAD_URL}/${fileId}?alt=media`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error downloading from Drive: ${errorText || response.statusText}`);
  }

  return response.text();
};
