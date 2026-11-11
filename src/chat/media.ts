const gifIds = [
  'JIX9t2j0ZTN9S',
  '13CoXDiaCcCoyk',
  'mlvseq9yvZhba',
  'VbnUQpnihPSIgIXuZv',
  '3oriO0OEd9QIDdllqo',
  'GeimqsH0TLDt4tScGw',
  '11s7Ke7jcNxCHS',
  'nR4L10XlJcSeQ',
  '6VoDJzfRjJNbG',
  'duzpaTbCUy9Vu',
  'ZqlvCTNHpqrio',
  '26BRv0ThflsHCqDrG',
  'l0HlUxcWRsqROFYuk',
  'Dh5q0sShxgp13DwrvG',
  'l3q2K5jinAlChoCLS',
  'Od0QRnzwRBYmDU3eEO',
  '3o7TKTDn976rzVgky4',
  'l41lVsYDBC0UVQJCE',
];
export function createReplyMediaPicker() {
  const recent: string[] = [];
  return ({
    chance = 0.25,
    random = Math.random,
  }: { chance?: number; random?: () => number } = {}) => {
    if (random() >= chance) return undefined;
    const available = gifIds.filter((id) => !recent.includes(id));
    const id =
      available[
        Math.min(available.length - 1, Math.floor(random() * available.length))
      ]!;
    recent.push(id);
    if (recent.length > Math.min(8, gifIds.length - 1)) recent.shift();
    return [{ image: { url: `https://media.giphy.com/media/${id}/giphy.gif` } }];
  };
}
export const chooseReplyMedia = createReplyMediaPicker();
