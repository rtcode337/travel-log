const MB = 1024 * 1024;

/** 容量の表示用(`123MB`・`4.5MB`・`820KB`)。画面とサーバーのメッセージで同じ書き方にする */
export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.max(0, Math.round(bytes / 1024))}KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)}MB`;
}
