const SETTINGS_KEY = "aiexcel_settings";

export interface AddinSettings {
  backendUrl: string;
  aiRecalcEnabled: boolean;
}

const defaults: AddinSettings = {
  backendUrl: "http://localhost:3001",
  aiRecalcEnabled: false,
};

export function loadSettings(): AddinSettings {
  try {
    const raw = Office.context.document.settings.get(SETTINGS_KEY) as string | null;
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<AddinSettings>) } : defaults;
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: AddinSettings): Promise<void> {
  Office.context.document.settings.set(SETTINGS_KEY, JSON.stringify(settings));
  await new Promise<void>((resolve, reject) =>
    Office.context.document.settings.saveAsync((result) => {
      result.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(result.error);
    })
  );
}
