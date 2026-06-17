/**
 * Map DB fields to admin UI subtitle column label.
 * @returns {'Yes' | 'No' | 'Processing' | 'Failed'}
 */
export function getSubtitleDisplayStatus({ ai_status, has_vtt }) {
  const status = ai_status || 'pending';

  if (status === 'processing') return 'Processing';
  if (status === 'failed') return 'Failed';
  if (has_vtt) return 'Yes';
  return 'No';
}

export function subtitleStatusBadgeClass(displayStatus) {
  switch (displayStatus) {
    case 'Yes':
      return 'bg-green-100 text-green-800';
    case 'Processing':
      return 'bg-blue-100 text-blue-800';
    case 'Failed':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
