-- ============================================================================
-- Bug report screenshots: allow HEIC/HEIF uploads from iOS
-- ============================================================================

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence'
]::text[]
where id = 'bug-report-screenshots';
