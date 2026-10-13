// Show validation reasons without echoing the submitted result references.
export function researchExportErrorMessage(detail, status, language = 'zh') {
  const zh = language !== 'en';
  const concise = (value) => value.trim().slice(0, 500);
  if (typeof detail === 'string' && detail.trim()) return concise(detail);
  if (typeof detail?.message === 'string' && detail.message.trim()) return concise(detail.message);
  if (Array.isArray(detail)) {
    if (detail.some((error) => error?.type === 'too_long'
      && Array.isArray(error.loc) && error.loc.join('.') === 'body.sources')) {
      return zh ? '每张科研图最多包含 8 个模型，请选择 2–8 个模型后重试。'
        : 'Each figure supports at most 8 models. Select 2–8 models and retry.';
    }
    const reasons = detail.slice(0, 3).flatMap((error) => {
      if (typeof error?.msg !== 'string') return [];
      const location = Array.isArray(error.loc)
        ? error.loc.filter((part) => part !== 'body').slice(0, 5).join('.') : '';
      return [`${location ? `${location}: ` : ''}${error.msg}`];
    });
    if (reasons.length) return concise(`${zh ? '参数无效：' : 'Invalid parameters: '}${reasons.join('; ')}`);
  }
  const fallback = {
    401: zh ? '登录已失效，请重新登录。' : 'Your session expired. Sign in again.',
    403: zh ? '没有访问此结果的权限。' : 'You do not have access to this result.',
    409: zh ? '结果已过期或条件已变化，请重新获取结果。' : 'The result expired or changed. Refresh it.',
    422: zh ? '导出参数无效，请检查设置。' : 'Invalid export parameters. Check the settings.',
    429: zh ? '导出服务忙碌，请稍后重试。' : 'Export service is busy. Retry shortly.',
  };
  return fallback[status] || (zh ? `导出服务错误（${status}），请稍后重试。` : `Export service error (${status}). Retry shortly.`);
}
