export function initClubBadges(container) {
  for (const image of container.querySelectorAll('.club-badge img')) {
    const fallback = () => { image.hidden = true; };
    image.addEventListener('error', fallback, { once: true });
    if (image.complete && !image.naturalWidth) fallback();
  }
}
