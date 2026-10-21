const blockedExternalHosts = ["twitter.com", "x.com", "t.co"];

export function isAllowedExternalLink(value: string | undefined | null): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return url.protocol === "https:" && !blockedExternalHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

export function isBlockedTwitterLink(value: string | undefined | null): boolean {
  if (!value?.trim()) return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return blockedExternalHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}
