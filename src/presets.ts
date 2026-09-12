export interface MediaPreset {
  id: string;
  title: string;
  category: 'movie' | 'image' | 'audio';
  url: string;
  description: string;
  thumbnail: string;
}

export const MEDIA_PRESETS: MediaPreset[] = [
  // Movies & Short Films
  {
    id: 'movie-bigbuckbunny',
    title: 'Big Buck Bunny (Trailer)',
    category: 'movie',
    url: 'https://media.w3.org/2010/05/bunny/trailer.mp4',
    description: 'Blender Foundation animated classic short film sample',
    thumbnail: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-sintel',
    title: 'Sintel (Fantasy Trailer HD)',
    category: 'movie',
    url: 'https://media.w3.org/2010/05/sintel/trailer_hd.mp4',
    description: 'Epic emotional fantasy short film from the Blender open-movie project',
    thumbnail: 'https://images.unsplash.com/photo-1514533450685-4493e01d1fdc?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-bluemoon',
    title: 'View From A Blue Moon (Action HD)',
    category: 'movie',
    url: 'https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-576p.mp4',
    description: 'Breathtaking action cinematic movie trailer in high definition',
    thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-water',
    title: 'Nature & Water Stream',
    category: 'movie',
    url: 'https://media.w3.org/2010/05/video/movie_300.mp4',
    description: 'Cinematic preview of ocean waves and water flow',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'movie-local-sample',
    title: 'Lounge Demo Video (Local Storage)',
    category: 'movie',
    url: '/uploads/1788967697862-318783671-test_video.mp4',
    description: 'High-speed local video streamed directly from the SyncSpace server storage',
    thumbnail: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=400&auto=format&fit=crop&q=80'
  },

  // Photos & High-Res Wallpapers
  {
    id: 'photo-nebula',
    title: 'Deep Cosmic Nebula (Space 4K)',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80',
    description: 'Vibrant interstellar clouds and stellar nurseries',
    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'photo-cyberpunk',
    title: 'Cyberpunk Metropolis Night',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1600&auto=format&fit=crop&q=80',
    description: 'Neon-lit futuristic skyscraper district in the rain',
    thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'photo-aurora',
    title: 'Aurora Borealis Glaciers',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&auto=format&fit=crop&q=80',
    description: 'Spectacular green and purple northern lights over frozen waters',
    thumbnail: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'photo-lake',
    title: 'Alpine Emerald Lake Sunset',
    category: 'image',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&auto=format&fit=crop&q=80',
    description: 'Crystal reflections and towering jagged mountain peaks',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&auto=format&fit=crop&q=80'
  }
];
