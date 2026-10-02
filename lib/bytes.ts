const MB = 1024 * 1024;
const GB = 1024 * MB;

/** 容量の表示用(`1.5GB`・`123MB`・`4.5MB`・`820KB`)。画面とサーバーのメッセージで同じ書き方にする */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)}GB`;
  if (bytes < MB) return `${Math.max(0, Math.round(bytes / 1024))}KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)}MB`;
}
