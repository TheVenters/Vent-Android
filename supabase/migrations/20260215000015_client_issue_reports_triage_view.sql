-- ============================================================================
-- Convenience view for bug triage
-- ============================================================================

create or replace view public.client_issue_reports_triage
with (security_invoker = true) as
select
  r.id,
  r.created_at,
  r.user_id,
  r.category,
  r.severity,
  r.title,
  r.description,
  r.current_screen,
  r.platform,
  r.app_version,
  r.app_build,
  r.device_info,
  r.screenshot_path,
  (r.screenshot_path is not null) as has_screenshot,
  coalesce(r.metadata ->> 'uploadError', '') as screenshot_upload_error,
  r.metadata
from public.client_issue_reports r;
