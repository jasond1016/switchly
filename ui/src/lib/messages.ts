export const MESSAGES = {
  quota: {
    syncingAccount: (accountID: string) => `正在同步账号 ${accountID} 的 Quota...`,
    syncAccountSuccess: (accountID: string) => `✓ 账号 ${accountID} Quota 同步成功`,
    syncAccountFailed: (message: string) => `Quota 同步失败: ${message}`,
    syncingAll: "正在同步所有账号 Quota...",
    syncAllPartial: (succeeded: number, failed: number) => `⚠ 同步完成: ${succeeded} 个成功, ${failed} 个失败`,
    syncAllSuccess: (succeeded: number) => `✓ 全部 ${succeeded} 个账号 Quota 同步成功`,
    syncAllFailed: (message: string) => `Sync All 失败: ${message}`,
  },
  dashboard: {
    switchedAccount: (accountID: string) => `已切换到账号 ${accountID}`,
    simulateLimitDone: "已触发限额模拟，请检查账号切换结果",
    importedAccount: (accountID: string, action: "created" | "updated") =>
      action === "updated" ? `已更新本地账号 ${accountID}` : `已导入本地账号 ${accountID}`,
  },
} as const;
