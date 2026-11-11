const gifs = [
  'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
  'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif',
];
export function chooseReplyMedia({
  chance = 0.25,
  random = Math.random,
}: { chance?: number; random?: () => number } = {}) {
  if (random() >= chance) return undefined;
  return [
    {
      image: {
        url: gifs[Math.min(gifs.length - 1, Math.floor(random() * gifs.length))],
      },
    },
  ];
}
