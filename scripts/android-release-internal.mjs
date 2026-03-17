import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const androidDir = path.join(projectRoot, "android");
const capacitorConfigPath = path.join(projectRoot, "capacitor.config.ts");
const packageJsonPath = path.join(projectRoot, "package.json");
const localEnvPath = path.join(projectRoot, ".env.android.release.local");
const androidPublisherScope = "https://www.googleapis.com/auth/androidpublisher";
const androidPublisherApiBase =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
}

function resolveLocalPath(filePath) {
  if (!filePath) {
    return "";
  }

  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);
}

function getDefaultVersionName() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
  const utcDay = String(now.getUTCDate()).padStart(2, "0");
  const utcHour = String(now.getUTCHours()).padStart(2, "0");
  const utcMinute = String(now.getUTCMinutes()).padStart(2, "0");
  const stamp = `${utcYear}${utcMonth}${utcDay}.${utcHour}${utcMinute}`;
  const baseVersion =
    typeof packageJson.version === "string" &&
    packageJson.version.trim() &&
    packageJson.version !== "0.0.0"
      ? packageJson.version.trim()
      : "internal";

  return `${baseVersion}.${stamp}`;
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function getServiceAccountCredentials() {
  if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.ANDROID_PUBLISHER_CREDENTIALS) {
    return JSON.parse(process.env.ANDROID_PUBLISHER_CREDENTIALS);
  }

  if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH) {
    return JSON.parse(
      fs.readFileSync(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH, "utf8")
    );
  }

  throw new Error("Google Play service account credentials are not configured.");
}

function getApplicationId() {
  if (process.env.GOOGLE_PLAY_PACKAGE_NAME) {
    return process.env.GOOGLE_PLAY_PACKAGE_NAME;
  }

  if (!fs.existsSync(capacitorConfigPath)) {
    return "com.sofull.site";
  }

  const configSource = fs.readFileSync(capacitorConfigPath, "utf8");
  const match = configSource.match(/appId:\s*['"]([^'"]+)['"]/u);
  return match?.[1] || "com.sofull.site";
}

function createJwtAssertion(serviceAccount) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: serviceAccount.client_email,
    scope: androidPublisherScope,
    aud: "https://oauth2.googleapis.com/token",
    exp: issuedAt + 3600,
    iat: issuedAt,
  };
  const unsignedToken =
    `${base64UrlEncode(JSON.stringify(header))}.` +
    `${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function fetchJson(url, options, errorLabel) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`${errorLabel} failed (${response.status}): ${responseText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function getGoogleAccessToken() {
  const serviceAccount = getServiceAccountCredentials();
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createJwtAssertion(serviceAccount),
  });
  const tokenResponse = await fetchJson(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    },
    "Google OAuth token request"
  );

  return tokenResponse.access_token;
}

async function withPlayEdit(packageName, accessToken, callback) {
  const edit = await fetchJson(
    `${androidPublisherApiBase}/${encodeURIComponent(packageName)}/edits`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
    "Google Play edit creation"
  );

  try {
    return await callback(edit.id);
  } finally {
    try {
      await fetch(
        `${androidPublisherApiBase}/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(
          edit.id
        )}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        }
      );
    } catch (error) {
      console.warn(`Skipping Play edit cleanup for ${edit.id}: ${error.message}`);
    }
  }
}

function getHighestTrackVersionCode(tracksResponse) {
  const versionCodes =
    tracksResponse?.tracks?.flatMap((track) =>
      (track.releases || []).flatMap((release) =>
        (release.versionCodes || []).map((value) => Number.parseInt(value, 10))
      )
    ) || [];
  const numericCodes = versionCodes.filter((value) => Number.isInteger(value) && value > 0);

  return numericCodes.length > 0 ? Math.max(...numericCodes) : 0;
}

async function getDefaultVersionCode() {
  const packageName = getApplicationId();
  const accessToken = await getGoogleAccessToken();

  const highestVersionCode = await withPlayEdit(packageName, accessToken, async (editId) => {
    const tracksResponse = await fetchJson(
      `${androidPublisherApiBase}/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(
        editId
      )}/tracks`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
      "Google Play tracks lookup"
    );

    return getHighestTrackVersionCode(tracksResponse);
  });

  return String(highestVersionCode + 1);
}

function ensureRequiredEnv() {
  const missing = [];
  const requiredSigningVars = [
    "ANDROID_KEYSTORE_PATH",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD",
  ];

  for (const key of requiredSigningVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  const hasPlayCredentials =
    Boolean(process.env.ANDROID_PUBLISHER_CREDENTIALS) ||
    Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) ||
    Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH);

  if (!hasPlayCredentials) {
    missing.push(
      "ANDROID_PUBLISHER_CREDENTIALS or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH"
    );
  }

  if (missing.length > 0) {
    const details = missing.map((entry) => `- ${entry}`).join("\n");
    throw new Error(
      `Missing required Android release env vars:\n${details}\n\n` +
        `Set them in the shell or in ${path.basename(localEnvPath)}.`
    );
  }
}

loadEnvFile(localEnvPath);

if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON && !process.env.ANDROID_PUBLISHER_CREDENTIALS) {
  process.env.ANDROID_PUBLISHER_CREDENTIALS = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
}

if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH) {
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH = resolveLocalPath(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH
  );
}

async function main() {
  process.env.GOOGLE_PLAY_TRACK = process.env.GOOGLE_PLAY_TRACK || "internal";

  ensureRequiredEnv();

  process.env.ANDROID_VERSION_CODE =
    process.env.ANDROID_VERSION_CODE || (await getDefaultVersionCode());
  process.env.ANDROID_VERSION_NAME =
    process.env.ANDROID_VERSION_NAME || getDefaultVersionName();

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

  console.log(
    `Publishing Android release ${process.env.ANDROID_VERSION_NAME} ` +
      `(versionCode ${process.env.ANDROID_VERSION_CODE}) to Google Play ${process.env.GOOGLE_PLAY_TRACK}.`
  );

  run(npmCommand, ["run", "android:build"], projectRoot);
  run(gradleCommand, ["publishReleaseBundle"], androidDir);
}

await main();
